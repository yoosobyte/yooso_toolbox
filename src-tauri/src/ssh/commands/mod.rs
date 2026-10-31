use std::sync::Arc;

use tauri::State;

use crate::ssh::SshSession;
use crate::AppState;

mod process;
mod session;
mod shell;
mod sftp;
#[cfg(test)]
mod tests;

// #[tauri::command] 会同时生成 __cmd__* 宏，generate_handler! 通过同名路径引用它们，
// 所以这里用 glob 把命令函数和这些生成宏一起 re-export。
pub use self::process::*;
pub use self::session::*;
pub use self::shell::*;
pub use self::sftp::*;

fn err(error: anyhow::Error) -> String {
    format!("{error:#}")
}

async fn get_session(
    state: &State<'_, AppState>,
    session_id: &str,
) -> Result<Arc<SshSession>, String> {
    state
        .sessions
        .lock()
        .await
        .get(session_id)
        .cloned()
        .ok_or_else(|| "会话不存在或已断开".to_string())
}
