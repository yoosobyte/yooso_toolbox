mod api;
mod core;
mod database;
mod files;
mod redis;
mod ssh;
mod translate;
mod update;

use std::collections::HashMap;
use std::sync::Arc;

use tauri::Manager;
use tokio::sync::Mutex;

use crate::core::Store;
use ssh::SshSession;

pub struct AppState {
    pub store: Arc<Store>,
    pub sessions: Mutex<HashMap<String, Arc<SshSession>>>,
    pub translator: translate::Translator,
    pub redis: Mutex<HashMap<String, Arc<redis::RedisConnection>>>,
    pub db: Mutex<HashMap<String, Arc<database::DbConnection>>>,
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
                translator: translate::Translator::new(),
                redis: Mutex::new(HashMap::new()),
                db: Mutex::new(HashMap::new()),
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
            ssh::commands::session_list,
            ssh::commands::session_upsert,
            ssh::commands::session_delete,
            ssh::commands::session_touch,
            ssh::commands::ssh_probe,
            ssh::commands::ssh_connect,
            ssh::commands::ssh_write,
            ssh::commands::ssh_resize,
            ssh::commands::ssh_disconnect,
            ssh::commands::sftp_home,
            ssh::commands::ssh_shell_cwd,
            ssh::commands::ssh_metrics,
            ssh::commands::ssh_processes,
            ssh::commands::ssh_kill_process,
            update::check_update,
            api::http_request,
            ssh::commands::sftp_list,
            ssh::commands::sftp_mkdir,
            ssh::commands::sftp_rename,
            ssh::commands::sftp_remove,
            ssh::commands::sftp_copy,
            ssh::commands::sftp_upload,
            ssh::commands::sftp_download,
            files::save_binary_file,
            files::save_text_file,
            translate::translate_text,
            redis::redis_config_list,
            redis::redis_config_upsert,
            redis::redis_config_delete,
            redis::redis_test,
            redis::redis_connect,
            redis::redis_disconnect,
            redis::redis_select,
            redis::redis_scan,
            redis::redis_key_detail,
            redis::redis_set_string,
            redis::redis_delete,
            redis::redis_expire,
            redis::redis_rename,
            redis::redis_command,
            database::db_config_list,
            database::db_config_upsert,
            database::db_config_delete,
            database::db_test,
            database::db_connect,
            database::db_disconnect,
            database::db_databases,
            database::db_tables,
            database::db_table_columns,
            database::db_clone_table,
            database::db_database_collation,
            database::db_table_ddl,
            database::db_table_indexes,
            database::db_table_data,
            database::db_update_cell,
            database::db_delete_rows,
            database::db_insert_row,
            database::db_exec_ddl,
            database::db_query,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
