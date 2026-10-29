use std::path::PathBuf;
use std::sync::Arc;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::OnceCell;
use uuid::Uuid;

use crate::models::{
    ConnectResult, MetricsSample, ProcessInfo, ProbeResult, SessionConfig, SftpEntry, SshEvent,
    TransferEvent,
};
use crate::sftp;
use crate::ssh::{self, SshSession, TermCmd};
use crate::AppState;

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

/* ------------------------------------------------------------------ */
/* 会话配置                                                            */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn session_list(state: State<'_, AppState>) -> Result<Vec<SessionConfig>, String> {
    Ok(state.store.list())
}

#[tauri::command]
pub async fn session_upsert(
    state: State<'_, AppState>,
    config: SessionConfig,
) -> Result<Vec<SessionConfig>, String> {
    state.store.upsert(config).map_err(err)
}

#[tauri::command]
pub async fn session_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<SessionConfig>, String> {
    state.store.delete(&id).map_err(err)
}

#[tauri::command]
pub async fn session_touch(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.store.touch(&id).map_err(err)
}

/* ------------------------------------------------------------------ */
/* SSH                                                                */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn ssh_probe(
    state: State<'_, AppState>,
    config: SessionConfig,
) -> Result<ProbeResult, String> {
    ssh::probe(&config, state.store.clone())
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn ssh_connect(
    state: State<'_, AppState>,
    config: SessionConfig,
    cols: u32,
    rows: u32,
    on_event: Channel<SshEvent>,
) -> Result<ConnectResult, String> {
    let (handle, outcome) = ssh::connect_and_auth(&config, state.store.clone())
        .await
        .map_err(err)?;

    let handle = Arc::new(handle);
    let writer = ssh::open_terminal(handle.clone(), cols, rows, on_event.clone())
        .await
        .map_err(err)?;

    let session_id = Uuid::new_v4().to_string();
    let session = Arc::new(SshSession {
        handle,
        writer,
        sftp: OnceCell::new(),
    });
    state
        .sessions
        .lock()
        .await
        .insert(session_id.clone(), session);

    let _ = state.store.touch(&config.id);
    let _ = on_event.send(SshEvent::Connected {
        message: outcome.fingerprint.clone(),
    });

    Ok(ConnectResult {
        session_id,
        server_fingerprint: outcome.fingerprint,
    })
}

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
pub async fn ssh_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let session = state.sessions.lock().await.remove(&session_id);
    if let Some(session) = session {
        let _ = session.writer.send(TermCmd::Close);
        ssh::shutdown(&session.handle).await;
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* SFTP                                                               */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn sftp_home(state: State<'_, AppState>, session_id: String) -> Result<String, String> {
    let session = get_session(&state, &session_id).await?;
    let sftp = ssh::ensure_sftp(&session).await.map_err(err)?;
    sftp::home_dir(&sftp).await.map_err(err)
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

/* ---------------- 远端系统监控 ---------------- */

#[derive(Default, Clone, Copy)]
struct CpuTimes {
    total: u64,
    idle: u64,
}

fn parse_cpu_line(line: &str) -> Option<CpuTimes> {
    let mut parts = line.split_whitespace();
    parts.next()?;
    let values: Vec<u64> = parts.take(8).filter_map(|v| v.parse().ok()).collect();
    if values.len() < 4 {
        return None;
    }
    let idle = values[3] + values.get(4).copied().unwrap_or(0);
    Some(CpuTimes {
        total: values.iter().sum(),
        idle,
    })
}

fn cpu_percent(before: CpuTimes, after: CpuTimes) -> f32 {
    let total = after.total.saturating_sub(before.total);
    let idle = after.idle.saturating_sub(before.idle);
    if total == 0 {
        return 0.0;
    }
    let busy = 100.0 * (1.0 - idle as f64 / total as f64);
    busy.clamp(0.0, 100.0) as f32
}

/// 一次 exec 采集全部指标的命令
pub(crate) const CMD_METRICS: &str = concat!(
    "echo @@cpu1; grep -E '^cpu' /proc/stat; ",
    "sleep 0.4; ",
    "echo @@cpu2; grep -E '^cpu' /proc/stat; ",
    "echo @@mem; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo; ",
    "echo @@disk; df -P -k / 2>/dev/null | tail -n 1; ",
    "echo @@net; awk -F: '/:/ { n=$1; gsub(/ /,\"\",n); if (n==\"lo\") next; ",
    "split($2,f,\" \"); rx+=f[1]; tx+=f[9] } END { print rx+0, tx+0 }' /proc/net/dev"
);

/// 解析 CMD_METRICS 的输出
pub(crate) fn parse_metrics(output: &str) -> MetricsSample {
    let mut section = "";
    let mut cpu1: Vec<CpuTimes> = Vec::new();
    let mut cpu2: Vec<CpuTimes> = Vec::new();
    let mut mem_total: u64 = 0;
    let mut mem_available: u64 = 0;
    let mut disk_total: u64 = 0;
    let mut disk_used: u64 = 0;
    let mut net_rx: u64 = 0;
    let mut net_tx: u64 = 0;

    for raw in output.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        match line {
            "@@cpu1" => {
                section = "cpu1";
                continue;
            }
            "@@cpu2" => {
                section = "cpu2";
                continue;
            }
            "@@mem" => {
                section = "mem";
                continue;
            }
            "@@disk" => {
                section = "disk";
                continue;
            }
            "@@net" => {
                section = "net";
                continue;
            }
            _ => {}
        }
        match section {
            "cpu1" => {
                if let Some(times) = parse_cpu_line(line) {
                    cpu1.push(times);
                }
            }
            "cpu2" => {
                if let Some(times) = parse_cpu_line(line) {
                    cpu2.push(times);
                }
            }
            "mem" => {
                let mut parts = line.split_whitespace();
                let key = parts.next().unwrap_or_default().trim_end_matches(':');
                let value: u64 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                match key {
                    "MemTotal" => mem_total = value * 1024,
                    "MemAvailable" => mem_available = value * 1024,
                    _ => {}
                }
            }
            "disk" => {
                let fields: Vec<&str> = line.split_whitespace().collect();
                if fields.len() >= 3 {
                    disk_total = fields[1].parse::<u64>().unwrap_or(0) * 1024;
                    disk_used = fields[2].parse::<u64>().unwrap_or(0) * 1024;
                }
            }
            "net" => {
                // awk 已在远端把各网卡（不含 lo）的累计收发字节求和成两个数字
                let fields: Vec<u64> = line
                    .split_whitespace()
                    .filter_map(|v| v.parse().ok())
                    .collect();
                if fields.len() >= 2 {
                    net_rx = fields[0];
                    net_tx = fields[1];
                }
            }
            _ => {}
        }
    }

    let cpu_total = match (cpu1.first(), cpu2.first()) {
        (Some(a), Some(b)) => cpu_percent(*a, *b),
        _ => 0.0,
    };
    let cpu_cores: Vec<f32> = cpu1
        .iter()
        .skip(1)
        .zip(cpu2.iter().skip(1))
        .map(|(a, b)| cpu_percent(*a, *b))
        .collect();

    MetricsSample {
        cpu_total,
        cpu_cores,
        mem_total,
        mem_used: mem_total.saturating_sub(mem_available),
        disk_total,
        disk_used,
        net_rx,
        net_tx,
    }
}

/// 采集一次远端系统指标：CPU（总计 + 单核）、内存、根分区磁盘、网卡累计字节。
/// 一次 exec 完成，CPU 通过远端 400ms 两次取样计算，避免占用本地连接。
#[tauri::command]
pub async fn ssh_metrics(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<MetricsSample, String> {
    let session = get_session(&state, &session_id).await?;
    let (_, output) = ssh::remote_exec(&session.handle, CMD_METRICS)
        .await
        .map_err(err)?;
    Ok(parse_metrics(&output))
}

/* ---------------- 进程列表 ---------------- */

/// 计算用于展示的进程名。
/// `comm` 被内核截断到 15 字节，所以当命令行第一个参数是绝对路径时，
/// 用它的 basename 作为更完整的名字（AliYunDunMonito → AliYunDunMonitor）。
/// 有些守护进程会改写 argv（比如 PM2 的 argv0 变成 "v6.0.8:"），
/// 所以只信任以 `/` 开头的 argv0。这里不做长度截断，超长交给前端省略号。
fn display_name(comm: &str, command_line: &str) -> String {
    let argv0 = command_line.split_whitespace().next().unwrap_or("");
    if !argv0.starts_with('/') {
        return comm.to_string();
    }
    let base = argv0.rsplit('/').next().unwrap_or(argv0);
    if base.is_empty() || base.len() <= comm.len() {
        return comm.to_string();
    }
    base.to_string()
}

/// 解析形如 `[[DD-]hh:]mm:ss` 的已运行时长（秒）
fn parse_elapsed(value: &str) -> i64 {
    let value = value.trim();
    let (days, rest) = match value.split_once('-') {
        Some((day, rest)) => (day.parse::<i64>().unwrap_or(0), rest),
        None => (0, value),
    };
    let parts: Vec<i64> = rest.split(':').filter_map(|v| v.parse().ok()).collect();
    let (hours, minutes, seconds) = match parts.len() {
        3 => (parts[0], parts[1], parts[2]),
        2 => (0, parts[0], parts[1]),
        1 => (0, 0, parts[0]),
        _ => (0, 0, 0),
    };
    days * 86400 + hours * 3600 + minutes * 60 + seconds
}

pub(crate) const CMD_PROCESSES: &str = "ps -eo pid=,pcpu=,rss=,etime=,comm=,args= 2>/dev/null";

/// 解析 CMD_PROCESSES 输出；`now` 用于把「已运行时长」换算成启动时间戳
pub(crate) fn parse_processes(output: &str, now: i64) -> Vec<ProcessInfo> {
    let mut list: Vec<ProcessInfo> = Vec::new();
    for line in output.lines() {
        let mut parts = line.split_whitespace();
        let Some(pid) = parts.next().and_then(|v| v.parse::<u32>().ok()) else {
            continue;
        };
        let cpu = parts.next().and_then(|v| v.parse::<f32>().ok()).unwrap_or(0.0);
        let rss_kb = parts.next().and_then(|v| v.parse::<u64>().ok()).unwrap_or(0);
        let elapsed = parts.next().map(parse_elapsed).unwrap_or(0);
        let comm = parts.next().unwrap_or("-").to_string();
        let command_line = parts.collect::<Vec<_>>().join(" ");
        // 过滤掉监控/列表自身造成的临时进程，避免列表里出现自己
        if command_line.contains("@@cpu1")
            || command_line.contains("ps -eo pid=,pcpu=,rss=,etime=,comm=,args=")
        {
            continue;
        }
        // comm 被内核限制在 15 字节（TASK_COMM_LEN，top/htop 也一样会截断）。
        // 这里改用命令行第一个参数的 basename 作为显示名，前端负责超长省略。
        let name = display_name(&comm, &command_line);
        list.push(ProcessInfo {
            pid,
            name,
            cpu,
            rss: rss_kb * 1024,
            started: if elapsed > 0 { now - elapsed } else { now },
            command: command_line,
        });
    }

    // 默认按内存倒序，最多返回 500 条，避免列表过大
    list.sort_by(|a, b| b.rss.cmp(&a.rss));
    list.truncate(500);
    list
}

#[tauri::command]
pub async fn ssh_processes(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Vec<ProcessInfo>, String> {
    let session = get_session(&state, &session_id).await?;
    let (_, output) = ssh::remote_exec(&session.handle, CMD_PROCESSES)
        .await
        .map_err(err)?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    Ok(parse_processes(&output, now))
}

/// 结束远端进程（先 SIGTERM，失败则报错，不静默升级为 SIGKILL）
#[tauri::command]
pub async fn ssh_kill_process(
    state: State<'_, AppState>,
    session_id: String,
    pid: u32,
) -> Result<(), String> {
    let session = get_session(&state, &session_id).await?;
    let command = format!("kill -TERM {pid} 2>&1");
    let (code, output) = ssh::remote_exec(&session.handle, &command)
        .await
        .map_err(err)?;
    if code != 0 {
        let detail = output.trim();
        return Err(if detail.is_empty() {
            format!("结束进程 {pid} 失败（退出码 {code}）")
        } else {
            detail.to_string()
        });
    }
    Ok(())
}

#[tauri::command]
pub async fn sftp_list(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<SftpEntry>, String> {
    let session = get_session(&state, &session_id).await?;
    let sftp = ssh::ensure_sftp(&session).await.map_err(err)?;
    sftp::list_dir(&sftp, &path).await.map_err(err)
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let session = get_session(&state, &session_id).await?;
    let sftp = ssh::ensure_sftp(&session).await.map_err(err)?;
    sftp::create_dir(&sftp, &path).await.map_err(err)
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let session = get_session(&state, &session_id).await?;
    let sftp = ssh::ensure_sftp(&session).await.map_err(err)?;
    sftp::rename(&sftp, &from, &to).await.map_err(err)
}

#[tauri::command]
pub async fn sftp_remove(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let session = get_session(&state, &session_id).await?;
    let sftp = ssh::ensure_sftp(&session).await.map_err(err)?;
    sftp::remove_path(&sftp, &path, is_dir).await.map_err(err)
}

#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    session_id: String,
    local_path: String,
    remote_dir: String,
    on_event: Channel<TransferEvent>,
) -> Result<(), String> {
    let session = get_session(&state, &session_id).await?;
    let sftp = ssh::ensure_sftp(&session).await.map_err(err)?;
    let local = PathBuf::from(&local_path);
    sftp::upload_path(&sftp, &session.handle, &local, &remote_dir, &on_event)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn sftp_copy(
    state: State<'_, AppState>,
    session_id: String,
    from: String,
    to_dir: String,
) -> Result<(), String> {
    let session = get_session(&state, &session_id).await?;
    let sftp = ssh::ensure_sftp(&session).await.map_err(err)?;
    sftp::copy_path(&sftp, &session.handle, &from, &to_dir)
        .await
        .map_err(err)
}

#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    session_id: String,
    remote_path: String,
    local_path: String,
    on_event: Channel<TransferEvent>,
) -> Result<(), String> {
    let session = get_session(&state, &session_id).await?;
    let sftp = ssh::ensure_sftp(&session).await.map_err(err)?;
    let local = PathBuf::from(&local_path);
    sftp::download_file(&sftp, &remote_path, &local, &on_event)
        .await
        .map_err(err)
}

/* ------------------------------------------------------------------ */
/* 本地文件保存（二维码导出等前端生成的内容）                           */
/* ------------------------------------------------------------------ */

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
/* 翻译（必应翻译接口直连）                                             */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn translate_text(
    state: State<'_, AppState>,
    text: String,
    from: String,
    to: String,
    line: Option<String>,
) -> Result<crate::translate::TranslateResult, String> {
    state
        .translator
        .translate(&text, &from, &to, line.as_deref().unwrap_or("cn"))
        .await
}

/* ------------------------------------------------------------------ */
/* 测试：解析器单元测试 + 真实服务器集成测试                            */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{SessionConfig, SshEvent};
    use crate::sftp;
    use crate::ssh::{self, SshSession, TermCmd};
    use crate::store::Store;
    use std::sync::{Arc, Mutex as StdMutex};
    use tauri::ipc::{Channel, InvokeResponseBody};
    use tokio::sync::{mpsc, OnceCell};
    use tokio::time::{sleep, Duration};

    /* ---------------- 纯函数单元测试 ---------------- */

    #[test]
    fn display_name_rules() {
        // 绝对路径且 basename 更长 → 用 basename（补回内核截断的部分）
        assert_eq!(
            display_name("AliYunDunMonito", "/usr/local/aegis/aegis_client/AliYunDunMonitor --flag"),
            "AliYunDunMonitor"
        );
        // 守护进程改写 argv（PM2 的 argv0 是版本号）→ 回落到 comm
        assert_eq!(display_name("PM2", "v6.0.8: God PM2 v6.0.8"), "PM2");
        // 不是绝对路径 → 用 comm
        assert_eq!(display_name("java", "java --add-opens java.base"), "java");
        assert_eq!(display_name("sshd", "sshd: root [priv]"), "sshd");
        // basename 不比 comm 长 → 保持 comm
        assert_eq!(display_name("bash", "/bin/bash -c true"), "bash");
    }

    #[test]
    fn elapsed_parser_works() {
        assert_eq!(parse_elapsed("42"), 42);
        assert_eq!(parse_elapsed("05:10"), 310);
        assert_eq!(parse_elapsed("01:05:10"), 3910);
        assert_eq!(parse_elapsed("3-01:05:10"), 3 * 86400 + 3910);
    }

    #[test]
    fn shell_cwd_parser_works() {
        assert_eq!(parse_shell_cwd("/tmp\n").as_deref(), Some("/tmp"));
        assert_eq!(
            parse_shell_cwd("\n  /var/log \n").as_deref(),
            Some("/var/log")
        );
        assert_eq!(parse_shell_cwd(""), None);
        assert_eq!(parse_shell_cwd("no absolute path here"), None);
    }

    #[test]
    fn metrics_parser_works() {
        let output = concat!(
            "@@cpu1\n",
            "cpu  100 0 100 800 0 0 0 0 0 0\n",
            "cpu0 50 0 50 400 0 0 0 0 0 0\n",
            "cpu1 50 0 50 400 0 0 0 0 0 0\n",
            "@@cpu2\n",
            "cpu  200 0 200 1400 0 0 0 0 0 0\n",
            "cpu0 100 0 100 700 0 0 0 0 0 0\n",
            "cpu1 100 0 100 700 0 0 0 0 0 0\n",
            "@@mem\n",
            "MemTotal:        4000000 kB\n",
            "MemAvailable:    1000000 kB\n",
            "@@disk\n",
            "/dev/vda1 41152736 12345678 26700000  32% /\n",
            "@@net\n",
            "123 456\n"
        );
        let sample = parse_metrics(output);

        assert_eq!(sample.mem_total, 4_000_000 * 1024);
        assert_eq!(sample.mem_used, 3_000_000 * 1024);
        assert_eq!(sample.disk_total, 41_152_736 * 1024);
        assert_eq!(sample.disk_used, 12_345_678 * 1024);
        assert_eq!(sample.net_rx, 123);
        assert_eq!(sample.net_tx, 456);

        // 总 delta: (200+200+1400) - (100+100+800) = 800；空闲 delta: 600 → 25%
        assert!((sample.cpu_total - 25.0).abs() < 0.01, "cpu_total={}", sample.cpu_total);
        assert_eq!(sample.cpu_cores.len(), 2);
        assert!((sample.cpu_cores[0] - 25.0).abs() < 0.01);
    }

    #[test]
    fn process_parser_works() {
        let output = concat!(
            "     1  0.0 12345 10-00:00:01 systemd /sbin/init\n",
            "  1234  2.5  2048 01:02:03 AliYunDunMonito /usr/local/aegis/AliYunDunMonitor --flag\n",
            "  2222  0.0   512     05:10 PM2 v6.0.8: God PM2\n",
            "  3333  0.0   100     00:01 ps ps -eo pid=,pcpu=,rss=,etime=,comm=,args=\n"
        );
        let now = 1_800_000_000i64;
        let list = parse_processes(output, now);

        assert_eq!(list.len(), 3, "自身的 ps 行应被过滤掉");
        // 按内存倒序：systemd(12345) > AliYunDunMonitor(2048) > PM2(512)
        assert_eq!(list[0].pid, 1);
        assert_eq!(list[1].pid, 1234);
        assert_eq!(list[1].name, "AliYunDunMonitor");
        assert_eq!(list[1].rss, 2048 * 1024);
        assert_eq!(list[1].started, now - 3723);
        assert_eq!(list[2].name, "PM2");
        assert!(list.iter().all(|item| !item.command.contains("ps -eo")));
    }

    /* ---------------- 真实服务器集成测试 ---------------- */

    fn test_config() -> SessionConfig {
        SessionConfig {
            id: "cmd-smoke".into(),
            name: "cmd-smoke".into(),
            host: std::env::var("TEST_SSH_HOST").unwrap_or_else(|_| "test.rebex.net".into()),
            port: std::env::var("TEST_SSH_PORT")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(22),
            username: std::env::var("TEST_SSH_USER").unwrap_or_else(|_| "demo".into()),
            auth_type: "password".into(),
            password: Some(
                std::env::var("TEST_SSH_PASSWORD").unwrap_or_else(|_| "password".into()),
            ),
            private_key_path: None,
            passphrase: None,
            color: None,
            save_password: true,
            pinned: false,
            last_used_at: None,
            created_at: None,
        }
    }

    fn collect_channel(sink: Arc<StdMutex<Vec<u8>>>) -> Channel<SshEvent> {
        Channel::<SshEvent>::new(move |body| {
            if let InvokeResponseBody::Json(text) = body {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                    if value.get("type").and_then(|v| v.as_str()) == Some("data") {
                        if let Some(data) = value.get("data").and_then(|v| v.as_str()) {
                            if let Ok(bytes) = STANDARD.decode(data) {
                                sink.lock().unwrap().extend_from_slice(&bytes);
                            }
                        }
                    }
                }
            }
            Ok(())
        })
    }

    /// 一条连接上依次验证：认证 → 交互式 shell → 跟随目录 → 监控采样 → 进程列表 → 结束进程 → SFTP 增删改查。
    /// 运行：`cargo test remote_features_smoke -- --ignored --nocapture`
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "需要外网与可用 SSH 服务器"]
    async fn remote_features_smoke() -> anyhow::Result<()> {
        let dir = std::env::temp_dir().join(format!("yooso-cmd-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir)?;
        let store = Arc::new(Store::from_dir(dir.clone())?);
        let config = test_config();

        let (handle, outcome) = ssh::connect_and_auth(&config, store.clone()).await?;
        println!("[1] 认证成功 method={} fingerprint={:?}", outcome.auth_method, outcome.fingerprint);
        assert!(store.known_host(&format!("{}:{}", config.host, config.port)).is_some());
        let handle = Arc::new(handle);

        // 2) 交互式 shell 回显
        let sink = Arc::new(StdMutex::new(Vec::<u8>::new()));
        let (dummy_tx, _dummy_rx) = mpsc::unbounded_channel::<TermCmd>();
        let writer = match ssh::open_terminal(handle.clone(), 100, 30, collect_channel(sink.clone())).await {
            Ok(writer) => {
                sleep(Duration::from_millis(1500)).await;
                writer.send(TermCmd::Data(b"echo YOOSO_CMD_OK\n".to_vec()))?;
                let mut transcript = String::new();
                for _ in 0..40 {
                    sleep(Duration::from_millis(250)).await;
                    transcript = String::from_utf8_lossy(&sink.lock().unwrap()).to_string();
                    if transcript.contains("YOOSO_CMD_OK") {
                        break;
                    }
                }
                assert!(transcript.contains("YOOSO_CMD_OK"), "终端未回显: {transcript:?}");
                println!("[2] 交互式 shell 回显正常");
                writer
            }
            Err(error) => {
                println!("[2] 跳过 shell（服务器不提供）: {error:#}");
                dummy_tx
            }
        };

        // 3) 跟随终端目录
        let (_, output) = ssh::remote_exec(&handle, CMD_SHELL_CWD).await?;
        let cwd = parse_shell_cwd(&output);
        println!("[3] CMD_SHELL_CWD -> {cwd:?}");
        assert!(cwd.is_some(), "没有识别到交互式 shell 的 cwd");

        let _ = writer.send(TermCmd::Data(b"cd /tmp\n".to_vec()));
        sleep(Duration::from_millis(900)).await;
        let (_, output) = ssh::remote_exec(&handle, CMD_SHELL_CWD).await?;
        let cwd = parse_shell_cwd(&output);
        println!("[3] cd /tmp 之后 CMD_SHELL_CWD -> {cwd:?}");
        assert_eq!(cwd.as_deref(), Some("/tmp"), "跟随目录没有匹配到本连接的 shell");

        // 4) 监控采样两次（第二次网卡字节数应增长）
        let (_, output) = ssh::remote_exec(&handle, CMD_METRICS).await?;
        let first = parse_metrics(&output);
        println!(
            "[4] 监控: cpu={:.1}% 核心={} 内存={}/{} 磁盘={}/{} 网卡 rx={} tx={}",
            first.cpu_total,
            first.cpu_cores.len(),
            first.mem_used,
            first.mem_total,
            first.disk_used,
            first.disk_total,
            first.net_rx,
            first.net_tx
        );
        assert!(first.mem_total > 0, "内存总量为 0");
        assert!(first.disk_total > 0, "磁盘总量为 0");
        assert!(!first.cpu_cores.is_empty(), "没有单核数据");
        assert!((0.0..=100.0).contains(&first.cpu_total));

        let (_, output) = ssh::remote_exec(&handle, CMD_METRICS).await?;
        let second = parse_metrics(&output);
        assert!(second.net_rx >= first.net_rx, "网卡接收计数倒退了");
        assert!(second.net_tx >= first.net_tx, "网卡发送计数倒退了");
        println!("[4] 两次采样一致（累计计数单调不减）");

        // 5) 进程列表
        let (_, output) = ssh::remote_exec(&handle, CMD_PROCESSES).await?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs() as i64;
        let procs = parse_processes(&output, now);
        println!("[5] 进程数={} 前三个={:?}", procs.len(), procs.iter().take(3).map(|p| format!("{}({})", p.name, p.pid)).collect::<Vec<_>>());
        assert!(!procs.is_empty(), "进程列表为空");
        assert!(procs.windows(2).all(|w| w[0].rss >= w[1].rss), "没有按内存倒序");
        assert!(procs.iter().all(|p| !p.command.contains("@@cpu1")), "自身进程未被过滤");

        // 6) 结束进程：起一个 sleep，按 pid 干掉
        let (_, output) = ssh::remote_exec(&handle, "setsid sleep 300 >/dev/null 2>&1 & echo $!").await?;
        let pid: u32 = output
            .lines()
            .find_map(|line| line.trim().parse::<u32>().ok())
            .ok_or_else(|| anyhow::anyhow!("没有拿到 sleep 的 pid: {output:?}"))?;
        sleep(Duration::from_millis(300)).await;
        let (alive_code, _) = ssh::remote_exec(&handle, &format!("kill -0 {pid} 2>/dev/null")).await?;
        assert_eq!(alive_code, 0, "sleep 进程没有起来");
        let (code, msg) = ssh::remote_exec(&handle, &format!("kill -TERM {pid} 2>&1")).await?;
        sleep(Duration::from_millis(500)).await;
        let (after_code, _) = ssh::remote_exec(&handle, &format!("kill -0 {pid} 2>/dev/null")).await?;
        println!("[6] kill -TERM {pid}: code={code} msg={msg:?} 存活检查={after_code}");
        assert_eq!(code, 0);
        assert_ne!(after_code, 0, "进程仍然存活");

        // 7) SFTP：列目录 / 新建 / 上传 / 下载 / 重命名 / 复制 / 删除
        let sftp = ssh::ensure_sftp(&Arc::new(SshSession {
            handle: handle.clone(),
            writer,
            sftp: OnceCell::new(),
        }))
        .await?;
        let home = sftp::home_dir(&sftp).await?;
        let entries = sftp::list_dir(&sftp, &home).await?;
        println!("[7] SFTP home={home}（{} 项）", entries.len());
        assert!(!entries.is_empty(), "主目录为空？");

        let stamp = uuid::Uuid::new_v4().to_string()[..8].to_string();
        let remote_dir = format!("{}/yooso-test-{stamp}", home.trim_end_matches('/'));
        sftp::create_dir(&sftp, &remote_dir).await?;
        let listed = sftp::list_dir(&sftp, &home).await?;
        assert!(listed.iter().any(|item| item.name == format!("yooso-test-{stamp}") && item.is_dir));
        println!("[7] mkdir 成功: {remote_dir}");

        let local_file = dir.join("upload.txt");
        let payload = b"yooso ssh/sftp integration test\n".to_vec();
        std::fs::write(&local_file, &payload)?;
        let channel = Channel::<crate::models::TransferEvent>::new(|_body| Ok(()));
        sftp::upload_path(&sftp, &handle, &local_file, &remote_dir, &channel).await?;
        let remote_file = format!("{remote_dir}/upload.txt");
        let after_upload = sftp::list_dir(&sftp, &remote_dir).await?;
        let uploaded = after_upload
            .iter()
            .find(|item| item.name == "upload.txt")
            .ok_or_else(|| anyhow::anyhow!("上传后没看到文件"))?;
        assert_eq!(uploaded.size, payload.len() as u64);
        println!("[7] 上传成功 {} 字节", payload.len());

        let downloaded = dir.join("download.txt");
        sftp::download_file(&sftp, &remote_file, &downloaded, &channel).await?;
        assert_eq!(std::fs::read(&downloaded)?, payload, "下载内容不一致");
        println!("[7] 下载回环比对一致");

        let renamed = format!("{remote_dir}/renamed.txt");
        sftp::rename(&sftp, &remote_file, &renamed).await?;
        let names: Vec<String> = sftp::list_dir(&sftp, &remote_dir).await?.into_iter().map(|i| i.name).collect();
        assert!(names.contains(&"renamed.txt".to_string()), "重命名失败: {names:?}");
        println!("[7] 重命名成功");

        sftp::copy_path(&sftp, &handle, &renamed, &remote_dir).await?;
        let names: Vec<String> = sftp::list_dir(&sftp, &remote_dir).await?.into_iter().map(|i| i.name).collect();
        assert!(names.iter().any(|n| n.contains("副本")), "同目录复制没有生成副本: {names:?}");
        println!("[7] 复制生成副本成功: {names:?}");

        sftp::remove_path(&sftp, &remote_dir, true).await?;
        let listed = sftp::list_dir(&sftp, &home).await?;
        assert!(!listed.iter().any(|item| item.name == format!("yooso-test-{stamp}")), "目录没有删掉");
        println!("[7] 递归删除成功");

        ssh::shutdown(&handle).await;
        let _ = std::fs::remove_dir_all(&dir);
        println!("\n全部通过 ✔");
        Ok(())
    }
}

/* ---------------- 升级检查 ---------------- */

/// 远端版本描述文件：第一行最新版本号，第二行安装包直链
pub(crate) const UPDATE_URL: &str = "https://qnres.yoosobyte.com/yooso-toolbox/version.txt";

/// 按点分段比较版本号，返回 latest 是否比 current 新
pub(crate) fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |value: &str| -> Vec<u64> {
        value
            .trim()
            .trim_start_matches('v')
            .split(|c: char| !c.is_ascii_digit())
            .filter(|part| !part.is_empty())
            .filter_map(|part| part.parse::<u64>().ok())
            .collect()
    };
    let a = parse(latest);
    let b = parse(current);
    let len = a.len().max(b.len());
    for index in 0..len {
        let left = a.get(index).copied().unwrap_or(0);
        let right = b.get(index).copied().unwrap_or(0);
        if left != right {
            return left > right;
        }
    }
    false
}

/// 解析版本 txt：忽略空行，第一行版本号、第二行下载地址
pub(crate) fn parse_update_file(text: &str, current: &str) -> crate::models::UpdateInfo {
    let mut lines = text
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty());
    let latest = lines
        .next()
        .unwrap_or_default()
        .trim_start_matches('v')
        .to_string();
    let url = lines.next().unwrap_or_default().to_string();
    crate::models::UpdateInfo {
        has_update: !latest.is_empty() && is_newer(&latest, current),
        latest,
        url,
        current: current.to_string(),
    }
}

#[tauri::command]
pub async fn check_update() -> Result<crate::models::UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(UPDATE_URL)
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("HTTP 错误：{error}"))?;
    let text = response
        .text()
        .await
        .map_err(|error| format!("读取响应失败：{error}"))?;
    Ok(parse_update_file(&text, env!("CARGO_PKG_VERSION")))
}
/* ---------------- HTTP 请求（API 调试） ---------------- */

#[tauri::command]
pub async fn http_request(
    spec: crate::http::HttpRequestSpec,
) -> Result<crate::http::HttpResponseData, String> {
    crate::http::execute(spec).await
}