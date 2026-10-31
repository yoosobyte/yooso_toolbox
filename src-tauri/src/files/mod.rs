use std::path::{Path, PathBuf};
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
const SEARCH_DEPTH: usize = 12;

/// 搜索时跳过的目录：系统库、依赖目录，避免敏感内容和无谓遍历
const SKIP_DIRS: &[&str] = &[
    "Library",
    "node_modules",
    "target",
    ".git",
    "$RECYCLE.BIN",
    "System Volume Information",
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
    let home = home_dir()?;
    let mut roots = vec![home.clone()];
    roots.extend(
        root_candidates(&home)
            .into_iter()
            .map(|(_, _, path)| path)
            .filter(|path| path.is_dir()),
    );
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
        Err("只能访问个人目录下的文件".to_string())
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
    if is_hidden(name) || SYSTEM_NAMES.contains(&name) {
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
    name == "Library" || SKIP_DIRS.contains(&name)
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

fn walk_matches(root: &Path, query: &str, results: &mut Vec<FileEntry>) {
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        if results.len() >= MAX_SEARCH_RESULTS || depth > SEARCH_DEPTH {
            continue;
        }
        let read = match std::fs::read_dir(&dir) {
            Ok(value) => value,
            Err(_) => continue,
        };
        for item in read.flatten() {
            let name = item.file_name().to_string_lossy().to_string();
            if should_hide(&item, &name) || should_skip_dir(&name) {
                continue;
            }
            let path = item.path();
            let is_dir = item.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
            if name.to_lowercase().contains(query) {
                if let Some(entry) = entry_of(&path) {
                    results.push(entry);
                }
                if results.len() >= MAX_SEARCH_RESULTS {
                    return;
                }
            }
            if is_dir {
                stack.push((path, depth + 1));
            }
        }
    }
}

/// 按文件名搜索个人目录（不递归 Library / 隐藏目录 / 依赖目录）
#[tauri::command]
pub fn fs_search(query: String, limit: Option<usize>) -> Result<Vec<FileEntry>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    let home = home_dir()?;
    let mut results = Vec::new();

    // 个人目录顶层的文件也参与匹配
    if let Ok(read) = std::fs::read_dir(&home) {
        for item in read.flatten() {
            let name = item.file_name().to_string_lossy().to_string();
            if should_hide(&item, &name) {
                continue;
            }
            if name.to_lowercase().contains(&needle) {
                if let Some(entry) = entry_of(&item.path()) {
                    results.push(entry);
                }
            }
        }
    }

    for (_, _, path) in root_candidates(&home) {
        if results.len() >= MAX_SEARCH_RESULTS {
            break;
        }
        if path.is_dir() {
            walk_matches(&path, &needle, &mut results);
        }
    }

    let limit = limit.unwrap_or(MAX_SEARCH_RESULTS).min(MAX_SEARCH_RESULTS);
    results.truncate(limit);
    sort_entries(&mut results);
    Ok(results)
}

/// 删除到系统回收站（个人目录内）
#[tauri::command]
pub fn fs_delete(paths: Vec<String>) -> Result<(), String> {
    let home = home_dir()?;
    for raw in paths {
        let path = ensure_allowed(Path::new(&raw))?;
        if path == home {
            return Err("不能删除用户目录本身".to_string());
        }
        trash::delete(&path).map_err(|error| format!("删除失败: {error}"))?;
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
    Ok(target.to_string_lossy().to_string())
}
