use tauri::State;

use crate::core::models::{MetricsSample, ProcessInfo};
use crate::ssh;
use crate::AppState;

use super::{err, get_session};

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
pub(super) fn display_name(comm: &str, command_line: &str) -> String {
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
pub(super) fn parse_elapsed(value: &str) -> i64 {
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
        let cpu = parts
            .next()
            .and_then(|v| v.parse::<f32>().ok())
            .unwrap_or(0.0);
        let rss_kb = parts
            .next()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(0);
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
