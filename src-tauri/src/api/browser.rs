use tauri::Manager;

/// 在指定子 WebView 中执行一段 JS（用于兼容性修补/诊断）
#[tauri::command]
pub fn browser_eval(app: tauri::AppHandle, label: String, script: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview {label} not found"))?;
    webview.eval(&script).map_err(|error| error.to_string())
}
