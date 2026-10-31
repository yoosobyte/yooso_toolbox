# NTFS 文件搜索（Everything 风格）设计与关键实现

> 目标：毫秒级搜索、全盘索引、实时感知文件变化。
> 适用范围：Windows NTFS 卷；非 NTFS 盘降级为目录遍历；MFT / USN 需要管理员权限。
> 当前项目已有 `src-tauri/src/files/`（目录遍历 + 内存索引），本文是把它升级为 MFT + USN 的方案。

## 1. 模块划分

```text
src-tauri/src/search/
  mod.rs          # Tauri 命令、全局 SearchState、后台任务启动
  volume.rs       # 卷句柄、NTFS 卷信息、管理员检测、卷枚举
  mft.rs          # $MFT 枚举 / 记录解析 / FRN → 完整路径
  usn.rs          # USN Journal 查询、读取循环、增量状态持久化
  index.rs        # 内存索引结构、搜索、并发读写
  fallback.rs     # 非 NTFS 的遍历扫描（复用现有 walk）
src/modules/files/  # React UI：进度、搜索框、结果列表
```

依赖：

```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.62", features = [
  "Win32_Foundation",
  "Win32_Storage_FileSystem",
  "Win32_System_IO",
  "Win32_Security",
] }
# 可选：并行搜索 / 更快子串匹配
rayon = "1"
memchr = "2"
```

`windows` 只用于 `CreateFileW` / `DeviceIoControl` / `CloseHandle` / `GetDriveTypeW` 等少量 API；
也可以直接用 `extern "system"` 声明 kernel32，减少 feature 维护成本。

## 2. 模块一：初始索引（读取 MFT）

### 2.1 打开卷句柄

```rust
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, GENERIC_READ, HANDLE};
use windows::Win32::Storage::FileSystem::{
    CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};

const FSCTL_GET_NTFS_VOLUME_DATA: u32 = 0x0009_0064;
const FSCTL_ENUM_USN_DATA: u32 = 0x0009_00B3;
const FSCTL_GET_NTFS_FILE_RECORD: u32 = 0x0009_0068;

fn open_volume(letter: char) -> windows::core::Result<HANDLE> {
    let path: Vec<u16> = format!("\\\\.\\{letter}:").encode_utf16().chain([0]).collect();
    unsafe {
        CreateFileW(
            PCWSTR(path.as_ptr()),
            GENERIC_READ.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            None,
        )
    }
}
```

> 非管理员会得到 `ERROR_ACCESS_DENIED (5)`：`CreateFileW(\\\\.\\C:)` 需要 `SeManageVolumePrivilege` 之外的卷读权限，
> 实际表现为拒绝访问。必须提前检测并提示（见第 5 节）。

### 2.2 卷信息

```rust
#[repr(C)]
struct NtfsVolumeData {
    volume_serial_number: i64,
    number_sectors: i64,
    total_clusters: i64,
    free_clusters: i64,
    total_reserved: i64,
    bytes_per_sector: u32,
    bytes_per_cluster: u32,
    bytes_per_file_record_segment: u32,
    clusters_per_file_record_segment: u32,
    mft_valid_data_length: i64,
    mft_start_lcn: i64,
    mft2_start_lcn: i64,
    mft_zone_start: i64,
    mft_zone_end: i64,
}

fn volume_data(volume: HANDLE) -> windows::core::Result<NtfsVolumeData> {
    let mut data = std::mem::MaybeUninit::<NtfsVolumeData>::zeroed();
    let mut returned = 0u32;
    unsafe {
        windows::Win32::System::IO::DeviceIoControl(
            volume,
            FSCTL_GET_NTFS_VOLUME_DATA,
            None,
            0,
            Some(data.as_mut_ptr().cast()),
            std::mem::size_of::<NtfsVolumeData>() as u32,
            Some(&mut returned),
            None,
        )?;
        Ok(data.assume_init())
    }
}
```

`mft_valid_data_length` 是 MFT 有效数据长度，`bytes_per_file_record_segment` 是单条记录大小（通常 1024）。

### 2.3 枚举 MFT 记录：两条路径

**推荐快路径：`FSCTL_ENUM_USN_DATA`**

它直接遍历 MFT，返回 `USN_RECORD_V2`，包含：

- `FileReferenceNumber`（FRN）
- `ParentFileReferenceNumber`（父目录 FRN）
- `FileName`（UTF-16）
- `FileAttributes`（目录 / 文件）
- `TimeStamp`（记录时间）
- 不含文件大小 —— 大小可以按需 `std::fs::metadata` 补，或再用
  `FSCTL_GET_NTFS_FILE_RECORD` 解析 `$FILE_NAME` / `$DATA` 属性（见 2.5）。

百万级记录通常几秒内枚举完，远快于逐条 `FSCTL_GET_NTFS_FILE_RECORD`。

```rust
#[repr(C)]
struct MftEnumData {
    start_frn: u64,
    low_usn: i64,
    high_usn: i64,
}

fn enum_mft(volume: HANDLE) -> windows::core::Result<Vec<RawMftEntry>> {
    let mut out = vec![RawMftEntry::default(); 0];
    let mut input = MftEnumData { start_frn: 0, low_usn: 0, high_usn: i64::MAX };
    let mut buffer = vec![0u8; 4 * 1024 * 1024];

    loop {
        let mut returned = 0u32;
        let ok = unsafe {
            windows::Win32::System::IO::DeviceIoControl(
                volume,
                FSCTL_ENUM_USN_DATA,
                Some((&input as *const MftEnumData).cast()),
                std::mem::size_of::<MftEnumData>() as u32,
                Some(buffer.as_mut_ptr().cast()),
                buffer.len() as u32,
                Some(&mut returned),
                None,
            )
        };
        let Ok(()) = ok else { break };

        if returned < 8 {
            break;
        }
        // 输出前 8 字节：下一次枚举的起始 FRN
        let next = u64::from_le_bytes(buffer[0..8].try_into().unwrap());
        let mut offset = 8usize;
        while offset + 60 <= returned as usize {
            let record_len =
                u32::from_le_bytes(buffer[offset..offset + 4].try_into().unwrap()) as usize;
            if record_len < 60 || offset + record_len > returned as usize {
                break;
            }
            let record = &buffer[offset..offset + record_len];
            let frn = u64::from_le_bytes(record[8..16].try_into().unwrap());
            let parent = u64::from_le_bytes(record[16..24].try_into().unwrap());
            let attrs = u32::from_le_bytes(record[52..56].try_into().unwrap());
            let name_len = u16::from_le_bytes(record[56..58].try_into().unwrap()) as usize;
            let name_off = u16::from_le_bytes(record[58..60].try_into().unwrap()) as usize;
            let name = String::from_utf16_lossy(
                &record[name_off..name_off + name_len]
                    .chunks_exact(2)
                    .map(|c| u16::from_le_bytes([c[0], c[1]]))
                    .collect::<Vec<_>>(),
            );
            out.push(RawMftEntry {
                frn,
                parent,
                name,
                is_dir: attrs & 0x10 != 0, // FILE_ATTRIBUTE_DIRECTORY
            });
            offset += record_len;
        }
        if next == 0 {
            break;
        }
        input.start_frn = next;
    }
    Ok(out)
}
```

**慢路径：`FSCTL_GET_NTFS_FILE_RECORD`**

用于按需读取某条 MFT 记录的完整属性（大小、时间、父引用）：

```rust
#[repr(C)]
struct FileRecordInput { file_reference_number: u64 }

// 输入 8 字节 FRN，输出 NTFS_FILE_RECORD_OUTPUT_BUFFER：
//   u64 FileReferenceNumber + u32 FileRecordLength + u32 Padding + 记录数据
fn read_record(volume: HANDLE, frn: u64) -> windows::core::Result<Vec<u8>> {
    let input = FileRecordInput { file_reference_number: frn };
    let mut out = vec![0u8; 4096];
    let mut returned = 0u32;
    unsafe {
        windows::Win32::System::IO::DeviceIoControl(
            volume,
            FSCTL_GET_NTFS_FILE_RECORD,
            Some((&input as *const FileRecordInput).cast()),
            8,
            Some(out.as_mut_ptr().cast()),
            out.len() as u32,
            Some(&mut returned),
            None,
        )?;
    }
    Ok(out)
}
```

> 直接用 `FSCTL_ENUM_USN_DATA` 建索引、用 `std::fs::metadata` 给最终命中的前 N 条补大小，
> 是性价比最高的组合。`FSCTL_GET_NTFS_FILE_RECORD` 逐条调用在百万级文件上会慢一到两个数量级，
> 适合“按需详情”或校验，不适合全量索引。

### 2.4 FRN → 完整路径

MFT 记录只有“名字 + 父 FRN”，需要自己还原路径：

```rust
fn build_path(
    frn: u64,
    map: &HashMap<u64, (u64, String, bool)>, // frn -> (parent, name, is_dir)
    cache: &mut HashMap<u64, String>,
) -> String {
    if frn == 5 {
        return String::new(); // NTFS 根目录固定 FRN 5
    }
    if let Some(path) = cache.get(&frn) {
        return path.clone();
    }
    let Some((parent, name, _)) = map.get(&frn) else {
        return String::new();
    };
    let parent_path = build_path(*parent, map, cache);
    let path = format!("{parent_path}\\{name}");
    cache.insert(frn, path.clone());
    path
}
```

索引里只存 `frn / parent / name / is_dir`，**不要给每个文件都存完整路径**（1M 条会多出上百 MB）；
搜索命中前 300 条时再按上面的缓存还原路径即可。

### 2.5 内存索引结构

- 名字统一小写，`Vec<IndexEntry>` 按 `lower_name` 排序：前缀搜索二分，`starts_with` 秒出。
- 子串搜索：`memchr::memmem::find` 或 `rayon` 并行扫；1M 条通常在 10–30 ms。
- 需要更强能力时换 FST（前缀/自动机）或 LMDB（持久化 + 前缀游标），但先做 `Vec + 并行子串` 就够。

```rust
struct IndexEntry {
    frn: u64,
    parent_frn: u64,
    name: String,
    lower: String,
    is_dir: bool,
}
```

### 2.6 非 NTFS 降级

`GetVolumeInformationW` 拿文件系统名，不是 `NTFS` 就走 `fallback::walk`（现有
`src-tauri/src/files` 的目录遍历逻辑可以直接搬过来），索引结构和搜索接口保持一致，
只在状态里标记 `mode: "scan"`。

## 3. 模块二：USN Journal 实时更新

### 3.1 查询日志

```rust
#[repr(C)]
struct UsnJournalData {
    usn_journal_id: u64,
    first_usn: i64,
    next_usn: i64,
    lowest_valid_usn: i64,
    max_usn: i64,
    maximum_size: u64,
    allocation_delta: u64,
}

fn query_journal(volume: HANDLE) -> windows::core::Result<UsnJournalData> {
    let mut data = std::mem::MaybeUninit::<UsnJournalData>::zeroed();
    let mut returned = 0u32;
    unsafe {
        windows::Win32::System::IO::DeviceIoControl(
            volume,
            FSCTL_QUERY_USN_JOURNAL,
            None, 0,
            Some(data.as_mut_ptr().cast()),
            std::mem::size_of::<UsnJournalData>() as u32,
            Some(&mut returned),
            None,
        )?;
        Ok(data.assume_init())
    }
}
```

`FSCTL_QUERY_USN_JOURNAL = 0x0009_00F4`。

若返回 `ERROR_JOURNAL_NOT_ACTIVE (1179)`：说明该卷没启用 USN Journal，实时更新不可用，
只能退化成定时重建 / 手动刷新。

### 3.2 读取循环

```rust
#[repr(C)]
struct ReadUsnJournalData {
    start_usn: i64,
    reason_mask: u32,
    return_only_on_close: u32,
    timeout: u64,
    bytes_to_wait_for: u64,
    usn_journal_id: u64,
}

fn read_usn(volume: HANDLE, start: i64, journal_id: u64) -> windows::core::Result<Vec<u8>> {
    let input = ReadUsnJournalData {
        start_usn: start,
        reason_mask: 0xFFFF_FFFF,
        return_only_on_close: 0,
        timeout: 0,
        bytes_to_wait_for: 0,
        usn_journal_id: journal_id,
    };
    let mut out = vec![0u8; 1024 * 1024];
    let mut returned = 0u32;
    unsafe {
        windows::Win32::System::IO::DeviceIoControl(
            volume,
            FSCTL_READ_USN_JOURNAL,
            Some((&input as *const ReadUsnJournalData).cast()),
            std::mem::size_of::<ReadUsnJournalData>() as u32,
            Some(out.as_mut_ptr().cast()),
            out.len() as u32,
            Some(&mut returned),
            None,
        )?;
    }
    out.truncate(returned as usize);
    Ok(out)
}
```

`FSCTL_READ_USN_JOURNAL = 0x0009_00BB`。输出前 8 字节是下一次读取的 `NextUsn`，随后是
`USN_RECORD_V2` 列表（解析方式与 2.3 相同，额外读 `Reason` 字段 offset 40）。

变更处理：

| Reason | 处理 |
| --- | --- |
| `USN_REASON_FILE_CREATE` (0x100) | 插入/更新 `frn` |
| `USN_REASON_FILE_DELETE` (0x200) | 删除 `frn`（含子项） |
| `USN_REASON_RENAME_NEW_NAME` (0x2000) | 更新 `frn` 的 parent + name |
| `USN_REASON_RENAME_OLD_NAME` (0x1000) | 通常忽略，等 NEW_NAME 记录 |
| 其它（写数据、改属性） | 只更新时间戳，不动名字 |

USN 记录里的 `FileReferenceNumber` 对硬链接可能对应多个名字，索引按 FRN 存一份即可，
搜索展示其中一个路径（Everything 默认也是这种近似）。

### 3.3 启动增量补全

持久化到应用数据目录（每个卷一个文件）：

```json
{ "journal_id": 123456, "next_usn": 987654321 }
```

启动顺序：

1. 读取保存的 `(journal_id, next_usn)`。
2. `FSCTL_QUERY_USN_JOURNAL` 拿当前 `journal_id / first_usn / next_usn`。
3. 如果 `journal_id` 相同且 `saved.next_usn >= first_usn`：
   - 读取 `[saved.next_usn, current.next_usn)` 的增量并应用 → 不需要全盘重建。
4. 如果 `journal_id` 变了、或 `saved.next_usn < first_usn`（日志被截断/重建）：
   - 全量 MFT 枚举重建，再记录新的 `next_usn`。
5. 启动实时循环，从当前 `next_usn` 继续读。

```rust
let state = load_state(volume_guid)?;
let journal = query_journal(volume)?;
if state.as_ref().map(|s| s.journal_id) == Some(journal.usn_journal_id)
    && state.as_ref().map(|s| s.next_usn >= journal.first_usn).unwrap_or(false)
{
    let mut cursor = state.unwrap().next_usn;
    while cursor < journal.next_usn {
        let batch = read_usn(volume, cursor, journal.usn_journal_id)?;
        cursor = apply_batch(&batch); // 返回下一游标
    }
} else {
    rebuild_from_mft()?;
}
```

## 4. 模块三：Tauri 命令与前端

### 4.1 Rust 状态与命令

```rust
pub struct SearchState {
    pub index: RwLock<Index>,
    pub status: RwLock<Status>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub ready: bool,
    pub building: bool,
    pub mode: String,   // "mft" | "scan"
    pub count: usize,
    pub scanned: usize,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn start_indexing(
    drive: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, SearchState>,
) -> Result<(), String> {
    // 1. 检测管理员 / NTFS
    // 2. MFT 枚举（阻塞线程）+ 保存 journal 状态 + 启动 USN 任务
    // 3. 失败则 fallback::build(...)
    tokio::task::spawn_blocking(move || build_index(drive, app, state))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn search_files(
    query: String,
    limit: Option<usize>,
    state: tauri::State<'_, SearchState>,
) -> Vec<FileHit> {
    state.index.read().unwrap().search(&query, limit.unwrap_or(300))
}

#[tauri::command]
pub fn get_index_status(state: tauri::State<'_, SearchState>) -> Status {
    state.status.read().unwrap().clone()
}
```

进度建议用事件推送，避免前端高频轮询：

```rust
app.emit("search://progress", Progress { scanned, total }).ok();
```

前端（React，项目现有体系）：

```tsx
const [status, setStatus] = useState<Status | null>(null);
const [results, setResults] = useState<FileHit[]>([]);

useEffect(() => {
  const unlisten = listen<Status>("search://progress", (e) => setStatus(e.payload));
  invoke<Status>("get_index_status").then(setStatus);
  invoke("start_indexing", { drive: null });
  return () => { unlisten.then((fn) => fn()); };
}, []);

useEffect(() => {
  if (!query.trim()) return setResults([]);
  const timer = setTimeout(async () => {
    setResults(await invoke<FileHit[]>("search_files", { query, limit: 300 }));
  }, 80); // 80ms 防抖，输入即出
  return () => clearTimeout(timer);
}, [query]);
```

UI 只保留：搜索框、进度条（`status.scanned`）、结果列表、右键菜单。
**不要做目录树浏览**——Everything 的交互就是“输入即结果”。

## 5. 权限、降级与错误处理

### 5.1 管理员权限

两种方式，推荐“运行时检测 + 按需提权”：

1. 启动时检测：

```rust
fn is_elevated() -> bool {
    // OpenProcessToken + GetTokenInformation(TokenElevation)
}
```

2. 未提权时：
   - 仍可用扫描索引（现有 `files` 模块）保证功能可用；
   - UI 显示“以管理员身份运行可启用 MFT 极速索引”；
   - 点击后用 `ShellExecuteW(..., "runas", exe, ...)` 重新拉起自身。

如果希望安装后默认管理员运行，在 `build.rs` 注入 manifest：

```rust
fn main() {
    let manifest = r#"<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges>
      <requestedExecutionLevel level="requireAdministrator" uiAccess="false"/>
    </requestedPrivileges></security>
  </trustInfo>
</assembly>"#;
    tauri_build::try_build(
        tauri_build::Attributes::new().windows_attributes(
            tauri_build::WindowsAttributes::new().app_manifest(manifest),
        ),
    )
    .expect("failed to run tauri-build");
}
```

> 代价是每次启动都弹 UAC，且普通用户无法安装/运行。更推荐“默认 asInvoker + 按需提权重启”。

### 5.2 非 NTFS / USN 不可用

- `GetVolumeInformationW` 返回的文件系统不是 `NTFS` → 该卷走 `fallback::walk`；
- `FSCTL_QUERY_USN_JOURNAL` 返回 `ERROR_JOURNAL_NOT_ACTIVE` → 仍可 MFT 全量索引，但实时更新不可用，
  改为每 N 分钟增量重建，并在状态里提示；
- 卷被 BitLocker 锁定 / 网络盘 / 权限不足 → 捕获错误，跳过该卷并记录到状态。

## 6. 参考实现与 crate

- `windows` crate：卷句柄、`DeviceIoControl`、manifest。上面的 FFI 结构体可直接对照 Microsoft 文档。
- [`ntfs`](https://crates.io/crates/ntfs)：纯 Rust 的 NTFS 读取库，能解析 MFT / 属性；
  适合“读记录”，但不做 USN 监听，且需要你自己处理卷句柄。
- `usn-journal` 类 crate 可封装 `FSCTL_*`，但维护状态和性能需自己验证（上百万条时优先自己写循环）。
- ISearch（Tauri 2 + SvelteKit）、FastSeek（Tauri v2 + MFT + USN）可以作为工程结构参考：
  它们的目录划分基本就是本文的 `volume / mft / usn / index`。

## 7. 落地顺序建议

1. 先把 `volume.rs` + `mft.rs` 的枚举跑通：管理员模式下列出 C: 的记录数，和 `dir /s` 对比数量级。
2. 接 `index.rs`：前缀/子串搜索，压测 1M 条输入延迟（目标 < 30 ms）。
3. 接 `usn.rs`：先做“全量 + 实时”，再做“保存 USN → 启动补全”。
4. 最后替换 `src/modules/files` 的扫描索引，保留 fallback 和“非管理员可用”的降级路径。

## 8. 本机实测（管理员权限）

用两个最小探针（`CreateFileW` + `DeviceIoControl`，不依赖第三方 crate）在开发机验证：

```text
C:  records=613879  dirs=118756  batches=18  elapsed=1.37s
D:  records=325215  dirs=37783   batches=8   elapsed=0.50s
USN journal: id=134373798477374262, first=637534208, next=672677680
READ_USN_JOURNAL @NextUsn: 8 bytes / 0 records（正常空读）
```

结论：

- `FSCTL_ENUM_USN_DATA` 枚举约 94 万条 MFT 记录总耗时约 1.9s，作为全盘初始索引完全可接受；
- 枚举结束时 `DeviceIoControl` 返回 `ERROR_HANDLE_EOF (38)` 是正常结束，不是错误；
- `FSCTL_QUERY_USN_JOURNAL` 在 C: 上可用；
- **`FSCTL_READ_USN_JOURNAL` 的 `StartUsn` 要使用上次返回的 `NextUsn`**；
  传入任意偏移（例如 `NextUsn - 1_000_000`）实测会得到 `ERROR_INVALID_PARAMETER (87)`。
  所以增量补全必须持久化“上次读到的 NextUsn”，而不是自己估算偏移。

