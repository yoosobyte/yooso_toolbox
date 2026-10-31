use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::UNIX_EPOCH;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use serde::Serialize;

/// 保存 base64 二进制内容（例如前端 canvas 导出的 PNG）
#[tauri::command]
pub async fn save_binary_file(path: String, data_base64: String) -> Result<(), String> {
    let bytes = STANDARD
        .decode(data_base64)
        .map_err(|error| format!("base64 解码失败: {error}"))?;
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|error| format!("写入失败: {error}"))
}

/// 保存纯文本内容（例如前端生成的 SVG）
#[tauri::command]
pub async fn save_text_file(path: String, text: String) -> Result<(), String> {
    tokio::fs::write(&path, text)
        .await
        .map_err(|error| format!("写入失败: {error}"))
}

/* ------------------------------------------------------------------ */
/* 文件浏览器 / 搜索（Everything 风格，只访问个人目录）                  */
/* ------------------------------------------------------------------ */

const MAX_SEARCH_RESULTS: usize = 500;
const SEARCH_DEPTH: usize = 32;

/// 索引时跳过的目录：系统目录、依赖目录、缓存目录
const SKIP_DIRS: &[&str] = &[
    "Windows",
    "WindowsApps",
    "Program Files",
    "Program Files (x86)",
    "ProgramData",
    "AppData",
    "Library",
    "$RECYCLE.BIN",
    "System Volume Information",
    "node_modules",
    "target",
    ".git",
    ".cargo",
    ".rustup",
    ".cache",
    ".npm",
];

/// Windows 用户目录下指向系统位置的 junction / 系统文件夹，不展示也不搜索
const SYSTEM_NAMES: &[&str] = &[
    "AppData",
    "Application Data",
    "Cookies",
    "Local Settings",
    "My Documents",
    "NetHood",
    "PrintHood",
    "Recent",
    "SendTo",
    "Templates",
    "「开始」菜单",
    "Start Menu",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// 秒级时间戳
    pub modified: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRoot {
    /// 前端用于翻译的名称：home / downloads / desktop / documents / pictures / music / videos
    pub key: String,
    pub name: String,
    pub path: String,
}

fn home_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    let key = "USERPROFILE";
    #[cfg(not(windows))]
    let key = "HOME";

    std::env::var_os(key)
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .ok_or_else(|| "无法定位用户目录".to_string())
}

/// 个人目录下的固定子目录（存在才返回）
fn root_candidates(home: &Path) -> Vec<(&'static str, &'static str, PathBuf)> {
    #[cfg(target_os = "macos")]
    let videos = ("videos", "影片", home.join("Movies"));
    #[cfg(not(target_os = "macos"))]
    let videos = ("videos", "视频", home.join("Videos"));

    vec![
        ("downloads", "下载", home.join("Downloads")),
        ("desktop", "桌面", home.join("Desktop")),
        ("documents", "文档", home.join("Documents")),
        ("pictures", "图片", home.join("Pictures")),
        ("music", "音乐", home.join("Music")),
        videos,
    ]
}

fn allowed_roots() -> Result<Vec<PathBuf>, String> {
    // 与索引范围保持一致：Windows 为所有固定磁盘，macOS/Linux 为个人目录
    let mut roots: Vec<PathBuf> = index_roots().into_iter().filter(|path| path.is_dir()).collect();
    if roots.is_empty() {
        if let Ok(home) = home_dir() {
            roots.push(home);
        }
    }
    Ok(roots)
}

/// 把路径规范化为绝对路径，并确认它位于允许的个人目录内
fn ensure_allowed(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| "路径不存在或无法访问".to_string())?;
    let allowed = allowed_roots()?.iter().any(|root| {
        root.canonicalize()
            .map(|root| canonical == root || canonical.starts_with(&root))
            .unwrap_or(false)
    });
    if allowed {
        Ok(canonical)
    } else {
        Err("只能访问本地磁盘上的文件".to_string())
    }
}

fn modified_at(metadata: &std::fs::Metadata) -> Option<i64> {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
}

fn entry_of(path: &Path) -> Option<FileEntry> {
    let metadata = std::fs::metadata(path).ok()?;
    let name = path.file_name()?.to_string_lossy().to_string();
    Some(FileEntry {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir: metadata.is_dir(),
        size: if metadata.is_dir() { 0 } else { metadata.len() },
        modified: modified_at(&metadata),
    })
}

fn sort_entries(entries: &mut [FileEntry]) {
    entries.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// 是否应在列表 / 搜索里隐藏：点文件、系统 junction、隐藏/系统属性的条目
fn should_hide(entry: &std::fs::DirEntry, name: &str) -> bool {
    if is_hidden(name) || SYSTEM_NAMES.iter().any(|skip| skip.eq_ignore_ascii_case(name)) {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if let Ok(metadata) = entry.metadata() {
            let attributes = metadata.file_attributes();
            if attributes & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM | FILE_ATTRIBUTE_REPARSE_POINT) != 0 {
                return true;
            }
        }
    }
    false
}

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIRS.iter().any(|skip| skip.eq_ignore_ascii_case(name))
}

/// 允许访问的根目录：个人目录 + 下载 / 桌面 / 文档 / 图片 / 音乐 / 视频
#[tauri::command]
pub fn fs_roots() -> Result<Vec<FileRoot>, String> {
    let home = home_dir()?;
    let mut roots = vec![FileRoot {
        key: "home".to_string(),
        name: "个人文件夹".to_string(),
        path: home.to_string_lossy().to_string(),
    }];
    for (key, name, path) in root_candidates(&home) {
        if path.is_dir() {
            roots.push(FileRoot {
                key: key.to_string(),
                name: name.to_string(),
                path: path.to_string_lossy().to_string(),
            });
        }
    }
    Ok(roots)
}

/// 列出目录内容（隐藏文件和 macOS 的 Library 不展示）
#[tauri::command]
pub fn fs_list(dir: String) -> Result<Vec<FileEntry>, String> {
    let home = home_dir()?;
    let path = ensure_allowed(Path::new(&dir))?;
    let mut entries = Vec::new();

    for item in std::fs::read_dir(&path)
        .map_err(|error| format!("读取目录失败: {error}"))?
    {
        let item = match item {
            Ok(value) => value,
            Err(_) => continue,
        };
        let name = item.file_name().to_string_lossy().to_string();
        if should_hide(&item, &name) || (path == home && should_skip_dir(&name)) {
            continue;
        }
        if let Some(entry) = entry_of(&item.path()) {
            entries.push(entry);
        }
    }

    sort_entries(&mut entries);
    Ok(entries)
}

/* ------------------------------------------------------------------ */
/* 内存索引：启动后扫描磁盘，搜索只查内存，做到输入即出结果              */
/* ------------------------------------------------------------------ */

#[derive(Clone)]
struct IndexedFile {
    name: String,
    lower: String,
    path: String,
    /// 小写完整路径，支持按路径搜索
    lower_path: String,
    is_dir: bool,
    size: u64,
    modified: Option<i64>,
}

#[derive(Default)]
struct FileIndex {
    entries: Vec<IndexedFile>,
    building: bool,
    ready: bool,
    scanned: usize,
}

static INDEX: OnceLock<Mutex<FileIndex>> = OnceLock::new();

fn index() -> &'static Mutex<FileIndex> {
    INDEX.get_or_init(|| Mutex::new(FileIndex::default()))
}

fn lock_index() -> std::sync::MutexGuard<'static, FileIndex> {
    index().lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub ready: bool,
    pub building: bool,
    pub count: usize,
    pub scanned: usize,
}

#[tauri::command]
pub fn fs_index_status() -> IndexStatus {
    let guard = lock_index();
    IndexStatus {
        ready: guard.ready,
        building: guard.building,
        count: guard.entries.len(),
        scanned: guard.scanned,
    }
}

/// 统一路径分隔符：`\` → `/`，并折叠连续的 `/`，用于“带斜杠的路径搜索”
fn normalize_slashes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_separator = false;
    for ch in input.chars() {
        if ch == '/' || ch == '\\' {
            if last_separator {
                continue;
            }
            last_separator = true;
            out.push('/');
        } else {
            last_separator = false;
            out.push(ch);
        }
    }
    out
}

fn indexed_of(path: &Path) -> Option<IndexedFile> {
    let metadata = std::fs::metadata(path).ok()?;
    let name = path.file_name()?.to_string_lossy().to_string();
    let full_path = path.to_string_lossy().to_string();
    Some(IndexedFile {
        lower: name.to_lowercase(),
        name,
        lower_path: normalize_slashes(&full_path.to_lowercase()),
        path: full_path,
        is_dir: metadata.is_dir(),
        size: if metadata.is_dir() { 0 } else { metadata.len() },
        modified: modified_at(&metadata),
    })
}

fn walk_index(dir: &Path, out: &mut Vec<IndexedFile>, depth: usize) {
    if depth > SEARCH_DEPTH {
        return;
    }
    let read = match std::fs::read_dir(dir) {
        Ok(value) => value,
        Err(_) => return,
    };
    for item in read.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if should_hide(&item, &name) || should_skip_dir(&name) {
            continue;
        }
        let path = item.path();
        if let Some(entry) = indexed_of(&path) {
            let is_dir = entry.is_dir;
            out.push(entry);
            if is_dir {
                walk_index(&path, out, depth + 1);
            }
        }
        if out.len() % 2000 == 0 {
            if let Ok(mut guard) = index().lock() {
                guard.scanned = out.len();
            }
        }
    }
}

#[cfg(windows)]
fn index_roots() -> Vec<PathBuf> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;

    // GetDriveTypeW: 3 = DRIVE_FIXED
    const DRIVE_FIXED: u32 = 3;

    let mut roots = Vec::new();
    for letter in b'C'..=b'Z' {
        let name = format!("{}:\\", letter as char);
        let wide: Vec<u16> = name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let kind = unsafe { GetDriveTypeW(PCWSTR(wide.as_ptr())) };
        if kind == DRIVE_FIXED && Path::new(&name).is_dir() {
            roots.push(PathBuf::from(&name));
        }
    }
    roots
}

/// macOS / Linux 只索引个人目录；Windows 索引所有固定磁盘（Everything 风格）
#[cfg(not(windows))]
fn index_roots() -> Vec<PathBuf> {
    // 个人目录本身已经递归包含下载 / 桌面 / 文档…，再单独加子目录会产生重复索引
    home_dir().into_iter().filter(|home| home.is_dir()).collect()
}

fn build_index() {
    let mut entries = Vec::new();
    for root in index_roots() {
        if root.is_dir() {
            walk_index(&root, &mut entries, 0);
        }
    }

    let mut guard = lock_index();
    guard.entries = entries;
    guard.building = false;
    guard.ready = true;
    guard.scanned = guard.entries.len();
}

/// 建立 / 重建内存索引（后台线程，立即返回）
#[tauri::command]
pub fn fs_index_build() -> Result<(), String> {
    {
        let mut guard = lock_index();
        if guard.building {
            return Ok(());
        }
        guard.building = true;
        guard.ready = false;
        guard.entries.clear();
        guard.scanned = 0;
    }
    std::thread::spawn(build_index);
    Ok(())
}

fn rank(entry: &IndexedFile, needle: &str) -> (u8, u8, usize) {
    // 0 完全匹配 / 1 名称前缀 / 2 名称包含 / 3 仅路径包含
    let (bucket, position) = if entry.lower == needle {
        (0, 0)
    } else if entry.lower.starts_with(needle) {
        (1, 0)
    } else if let Some(position) = entry.lower.find(needle) {
        (2, position)
    } else {
        (3, entry.lower_path.find(needle).unwrap_or(usize::MAX))
    };
    // 同分时文件优先于目录
    (bucket, if entry.is_dir { 1 } else { 0 }, position)
}

/// 在内存索引里搜索：空格分隔多个关键词，全部命中即可（顺序、中间内容不限）
#[tauri::command]
pub async fn fs_search(
    query: String,
    scope: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    // 放到阻塞线程池，避免几十万条扫描阻塞 IPC / 界面
    tokio::task::spawn_blocking(move || search_index(query, scope, limit))
        .await
        .map_err(|error| error.to_string())?
}

fn search_index(
    query: String,
    scope: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<FileEntry>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    // 带 / 或 \ 时按“路径片段”匹配：a/b/c、a//b//c、a\b\c、a\\b\\c 等价
    let path_mode = trimmed.contains('/') || trimmed.contains('\\');
    let tokens: Vec<String> = if path_mode {
        let normalized = normalize_slashes(&trimmed.to_lowercase());
        let normalized = normalized.trim_matches('/').to_string();
        if normalized.is_empty() {
            return Ok(Vec::new());
        }
        vec![normalized]
    } else {
        trimmed
            .split_whitespace()
            .map(|part| part.to_lowercase())
            .filter(|part| !part.is_empty())
            .collect()
    };
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    let guard = lock_index();
    let limit = limit.unwrap_or(MAX_SEARCH_RESULTS).min(MAX_SEARCH_RESULTS);

    // 先只算排名键，避免对几十万条命中做全量排序（输入单个字符时会非常卡）
    let mut matched: Vec<(u8, u8, usize, &IndexedFile)> = guard
        .entries
        .iter()
        .filter(|entry| {
            if let Some(prefix) = scope.as_deref() {
                if !prefix.is_empty() && !Path::new(&entry.path).starts_with(prefix) {
                    return false;
                }
            }
            // 路径一定包含文件名，只扫路径即可同时覆盖“文件名/路径”两种搜索
            tokens.iter().all(|token| entry.lower_path.contains(token))
        })
        .map(|entry| {
            let (bucket, dir_rank, position) = rank(entry, &tokens[0]);
            (bucket, dir_rank, position, entry)
        })
        .collect();

    if matched.len() > limit {
        // 只取出前 limit 个，再对这 limit 个排序；O(n) 而不是 O(n log n)
        matched.select_nth_unstable_by(limit, |left, right| {
            (left.0, left.1, left.2).cmp(&(right.0, right.1, right.2))
        });
        matched.truncate(limit);
    }
    matched.sort_by(|left, right| (left.0, left.1, left.2).cmp(&(right.0, right.1, right.2)));

    Ok(matched
        .into_iter()
        .map(|(_, _, _, entry)| FileEntry {
            name: entry.name.clone(),
            path: entry.path.clone(),
            is_dir: entry.is_dir,
            size: entry.size,
            modified: entry.modified,
        })
        .collect())
}

fn index_forget(path: &Path) {
    let mut guard = lock_index();
    guard
        .entries
        .retain(|entry| !Path::new(&entry.path).starts_with(path));
}

fn index_rename(from: &Path, to: &Path) {
    let mut guard = lock_index();
    for entry in guard.entries.iter_mut() {
        let path = Path::new(&entry.path);
        if let Ok(rest) = path.strip_prefix(from) {
            let next = to.join(rest);
            entry.path = next.to_string_lossy().to_string();
            entry.lower_path = normalize_slashes(&entry.path.to_lowercase());
            if let Some(name) = next.file_name() {
                entry.name = name.to_string_lossy().to_string();
                entry.lower = entry.name.to_lowercase();
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* 复制文件 / 文件夹到系统剪贴板（资源管理器 / 访达可粘贴）              */
/* ------------------------------------------------------------------ */

#[cfg(windows)]
fn clipboard_copy_files(paths: &[String]) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    const CF_HDROP: u32 = 15;

    #[repr(C)]
    struct DropFiles {
        p_files: u32,
        pt_x: i32,
        pt_y: i32,
        f_nc: i32,
        f_wide: i32,
    }

    let mut names: Vec<u16> = Vec::new();
    for path in paths {
        names.extend(std::ffi::OsStr::new(path).encode_wide());
        names.push(0);
    }
    names.push(0);

    let header = std::mem::size_of::<DropFiles>();
    let total = header + names.len() * 2;

    unsafe {
        OpenClipboard(None).map_err(|error| format!("打开剪贴板失败: {error}"))?;
        EmptyClipboard().map_err(|error| format!("清空剪贴板失败: {error}"))?;
        let handle: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE, total)
            .map_err(|error| format!("分配剪贴板内存失败: {error}"))?;
        let pointer = GlobalLock(handle);
        if pointer.is_null() {
            let _ = CloseClipboard();
            return Err("锁定剪贴板内存失败".to_string());
        }
        std::ptr::write(
            pointer as *mut DropFiles,
            DropFiles {
                p_files: header as u32,
                pt_x: 0,
                pt_y: 0,
                f_nc: 0,
                f_wide: 1,
            },
        );
        std::ptr::copy_nonoverlapping(
            names.as_ptr(),
            (pointer as *mut u8).add(header) as *mut u16,
            names.len(),
        );
        let _ = GlobalUnlock(handle);
        SetClipboardData(CF_HDROP, Some(HANDLE(handle.0)))
            .map_err(|error| format!("写入剪贴板失败: {error}"))?;
        let _ = CloseClipboard();
    }
    Ok(())
}

#[cfg(not(windows))]
fn clipboard_copy_files(paths: &[String]) -> Result<(), String> {
    // macOS：把文件 URL 放到剪贴板，Finder 可直接粘贴
    let items: Vec<String> = paths
        .iter()
        .map(|path| {
            format!(
                "POSIX file \"{}\"",
                path.replace('\\', "\\\\").replace('"', "\\\"")
            )
        })
        .collect();
    let script = format!("set the clipboard to {{{}}}", items.join(", "));
    let status = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .status()
        .map_err(|error| format!("调用 osascript 失败: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("写入剪贴板失败".to_string())
    }
}

/// 把文件 / 文件夹复制到系统剪贴板（可在资源管理器 / 访达中直接粘贴）
#[tauri::command]
pub fn fs_copy_to_clipboard(paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() {
        return Err("没有选择文件".to_string());
    }
    for raw in &paths {
        if !Path::new(raw).exists() {
            return Err(format!("路径不存在: {raw}"));
        }
    }
    clipboard_copy_files(&paths)
}

/* ------------------------------------------------------------------ */
/* 打开文件 / 在资源管理器（访达）中定位                                */
/* ------------------------------------------------------------------ */

#[cfg(windows)]
fn platform_open(path: &str, reveal: bool) -> Result<(), String> {
    use windows::core::{PCWSTR, w};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let (file, params) = if reveal {
        ("explorer.exe".to_string(), format!("/select,\"{path}\""))
    } else {
        (path.to_string(), String::new())
    };

    let file_wide: Vec<u16> = file.encode_utf16().chain(std::iter::once(0)).collect();
    let params_wide: Vec<u16> = params.encode_utf16().chain(std::iter::once(0)).collect();
    let params_ptr = if reveal {
        PCWSTR(params_wide.as_ptr())
    } else {
        PCWSTR::null()
    };

    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            PCWSTR(file_wide.as_ptr()),
            params_ptr,
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        Err("打开失败（系统拒绝或文件已不存在）".to_string())
    } else {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn platform_open(path: &str, reveal: bool) -> Result<(), String> {
    let mut command = std::process::Command::new("open");
    if reveal {
        command.arg("-R");
    }
    let status = command
        .arg(path)
        .status()
        .map_err(|error| format!("打开失败: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("打开失败".to_string())
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn platform_open(path: &str, reveal: bool) -> Result<(), String> {
    let target = if reveal {
        Path::new(path)
            .parent()
            .map(|parent| parent.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string())
    } else {
        path.to_string()
    };
    let status = std::process::Command::new("xdg-open")
        .arg(&target)
        .status()
        .map_err(|error| format!("打开失败: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("打开失败".to_string())
    }
}

/// 用系统默认程序打开文件 / 文件夹
#[tauri::command]
pub fn fs_open_path(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("文件不存在".to_string());
    }
    platform_open(&path, false)
}

/// 在资源管理器 / 访达中定位文件
#[tauri::command]
pub fn fs_reveal_path(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("文件不存在".to_string());
    }
    platform_open(&path, true)
}

/// 删除到系统回收站（本地磁盘内）
#[tauri::command]
pub fn fs_delete(paths: Vec<String>) -> Result<(), String> {
    let home = home_dir()?;
    for raw in paths {
        let path = ensure_allowed(Path::new(&raw))?;
        if path == home {
            return Err("不能删除用户目录本身".to_string());
        }
        trash::delete(&path).map_err(|error| format!("删除失败: {error}"))?;
        index_forget(&path);
    }
    Ok(())
}

/// 重命名（只改文件名，不允许带路径分隔符）
#[tauri::command]
pub fn fs_rename(path: String, new_name: String) -> Result<String, String> {
    let source = ensure_allowed(Path::new(&path))?;
    let name = new_name.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err("文件名不合法".to_string());
    }
    let parent = source.parent().ok_or_else(|| "无法定位父目录".to_string())?;
    let target = parent.join(name);
    if target.exists() {
        return Err("同名文件或文件夹已存在".to_string());
    }
    std::fs::rename(&source, &target).map_err(|error| format!("重命名失败: {error}"))?;
    index_rename(&source, &target);
    Ok(target.to_string_lossy().to_string())
}
