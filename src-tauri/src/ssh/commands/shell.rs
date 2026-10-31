use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use tauri::State;

use crate::ssh::{self, TermCmd};
use crate::AppState;

use super::{err, get_session};

#[tauri::command]
pub async fn ssh_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let session = get_session(&state, &session_id).await?;
    let bytes = STANDARD
        .decode(data.as_bytes())
        .map_err(|error| format!("数据编码错误：{error}"))?;
    session
        .writer
        .send(TermCmd::Data(bytes))
        .map_err(|_| "会话已关闭".to_string())
}

#[tauri::command]
pub async fn ssh_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let session = get_session(&state, &session_id).await?;
    session
        .writer
        .send(TermCmd::Resize(cols, rows))
        .map_err(|_| "会话已关闭".to_string())
}

#[tauri::command]
pub async fn ssh_disconnect(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let session = state.sessions.lock().await.remove(&session_id);
    if let Some(session) = session {
        let _ = session.writer.send(TermCmd::Close);
        ssh::shutdown(&session.handle).await;
    }
    Ok(())
}

/// 读取远端 shell 进程的当前目录（用于「跟随终端目录」）。
/// 不往终端里发送任何命令，避免污染用户的会话和命令历史。
///
/// 多标签/多连接时必须精确认出「本连接」的交互式 shell：
/// 1) 优先匹配与本次 exec 同一个父进程（同一个 sshd 会话进程）下的 shell；
/// 2) 兜底用 SSH_CONNECTION（每条 TCP 连接的客户端源端口不同）在 /proc 里比对环境变量。
pub(crate) const CMD_SHELL_CWD: &str = concat!(
    "mypid=$$; ",
    "ppid=$(awk '{print $4}' /proc/$mypid/stat 2>/dev/null); ",
    "found=\"\"; ",
    "if [ -n \"$ppid\" ]; then ",
    "  for p in /proc/[0-9]*; do ",
    "    [ \"$(awk '{print $4}' \"$p/stat\" 2>/dev/null)\" = \"$ppid\" ] || continue; ",
    "    c=$(cat \"$p/comm\" 2>/dev/null) || continue; ",
    "    case \"$c\" in bash|zsh|sh|dash|fish) ;; *) continue ;; esac; ",
    "    t=$(readlink \"$p/fd/0\" 2>/dev/null) || continue; ",
    "    case \"$t\" in /dev/pts/*) found=$(readlink \"$p/cwd\" 2>/dev/null); break ;; esac; ",
    "  done; ",
    "fi; ",
    "[ -n \"$found\" ] && { echo \"$found\"; exit 0; }; ",
    "conn=$(tr '\\0' '\\n' < /proc/$mypid/environ 2>/dev/null | sed -n 's/^SSH_CONNECTION=//p' | head -n1); ",
    "[ -n \"$conn\" ] || exit 0; ",
    "for p in /proc/[0-9]*; do ",
    "  c=$(cat \"$p/comm\" 2>/dev/null) || continue; ",
    "  case \"$c\" in bash|zsh|sh|dash|fish) ;; *) continue ;; esac; ",
    "  t=$(readlink \"$p/fd/0\" 2>/dev/null) || continue; ",
    "  case \"$t\" in /dev/pts/*) ;; *) continue ;; esac; ",
    "  [ -r \"$p/environ\" ] || continue; ",
    "  tr '\\0' '\\n' < \"$p/environ\" 2>/dev/null | grep -qxF \"SSH_CONNECTION=$conn\" || continue; ",
    "  readlink \"$p/cwd\" 2>/dev/null; break; ",
    "done"
);

/// 从 `rc` 输出里取第一行绝对路径（`None` 表示没找到 shell）
pub(crate) fn parse_shell_cwd(output: &str) -> Option<String> {
    output
        .lines()
        .map(|line| line.trim())
        .find(|line| line.starts_with('/'))
        .map(|line| line.to_string())
}

#[tauri::command]
pub async fn ssh_shell_cwd(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<String>, String> {
    let session = get_session(&state, &session_id).await?;
    let (_, output) = ssh::remote_exec(&session.handle, CMD_SHELL_CWD)
        .await
        .map_err(err)?;
    Ok(parse_shell_cwd(&output))
}
