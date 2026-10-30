use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;

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
