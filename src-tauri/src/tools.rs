/// 计算文本的 MD5（小写十六进制）
#[tauri::command]
pub fn md5_hash(text: String) -> String {
    format!("{:x}", md5::compute(text.as_bytes()))
}
