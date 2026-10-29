mod commands;
mod http;
mod models;
mod sftp;
mod ssh;
mod store;

use std::collections::HashMap;
use std::sync::Arc;

use tauri::Manager;
use tokio::sync::Mutex;

use ssh::SshSession;
use store::Store;

pub struct AppState {
    pub store: Arc<Store>,
    pub sessions: Mutex<HashMap<String, Arc<SshSession>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let store = Arc::new(Store::new(app.handle())?);
            println!("[yooso-toolbox] 配置目录: {}", store.dir().display());
            app.manage(AppState {
                store,
                sessions: Mutex::new(HashMap::new()),
            });

            // WebView2 默认会把 Ctrl+Shift+C（审查元素）、F12、Ctrl+R 等当成浏览器快捷键，
            // 导致终端里复制文本时弹出开发者工具。这里整体关掉，交给应用自己处理。
            #[cfg(windows)]
            {
                use tauri::Manager;
                use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                use windows::core::Interface;

                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| unsafe {
                        if let Ok(core) = webview.controller().CoreWebView2() {
                            if let Ok(settings) = core.Settings() {
                                if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                                    let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
                                }
                            }
                        }
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::session_list,
            commands::session_upsert,
            commands::session_delete,
            commands::session_touch,
            commands::ssh_probe,
            commands::ssh_connect,
            commands::ssh_write,
            commands::ssh_resize,
            commands::ssh_disconnect,
            commands::sftp_home,
            commands::ssh_shell_cwd,
            commands::ssh_metrics,
            commands::ssh_processes,
            commands::ssh_kill_process,
            commands::check_update,
            commands::http_request,
            commands::sftp_list,
            commands::sftp_mkdir,
            commands::sftp_rename,
            commands::sftp_remove,
            commands::sftp_copy,
            commands::sftp_upload,
            commands::sftp_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
