use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

fn default_port() -> u16 {
    22
}

fn default_username() -> String {
    "root".to_string()
}

fn default_auth_type() -> String {
    "password".to_string()
}

/// 一条 SSH 会话配置，序列化后存放在应用配置目录的 sessions.json 中
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfig {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_username")]
    pub username: String,
    #[serde(default = "default_auth_type")]
    pub auth_type: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default = "default_true")]
    pub save_password: bool,
    /// 置顶显示
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub last_used_at: Option<i64>,
    #[serde(default)]
    pub created_at: Option<i64>,
}

impl SessionConfig {
    /// 用于日志/提示的简化描述，不含任何凭据
    pub fn target(&self) -> String {
        format!("{}@{}:{}", self.username, self.host, self.port)
    }
}

/// 终端 / 连接生命周期事件（通过 Tauri Channel 推送到前端）
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SshEvent {
    /// data 为 base64 编码的原始字节（终端可能包含非 UTF-8 序列）
    Data { data: String },
    Connected { message: Option<String> },
    Closed { reason: Option<String> },
}

/// 文件传输进度事件
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TransferEvent {
    Progress { transferred: u64, total: u64 },
    Done,
    Error { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    /// 秒级时间戳
    pub modified: Option<i64>,
    /// rwxr-xr-x 形式
    pub permissions: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResult {
    pub session_id: String,
    pub server_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub fingerprint: Option<String>,
    pub server_version: Option<String>,
    pub auth_method: Option<String>,
}

/// 远端系统监控采样（字节单位）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSample {
    /// CPU 总占用百分比 0-100
    pub cpu_total: f32,
    /// 每个逻辑核心的占用百分比
    pub cpu_cores: Vec<f32>,
    pub mem_total: u64,
    pub mem_used: u64,
    pub disk_total: u64,
    pub disk_used: u64,
    /// 自开机以来累计收发的字节数（前端据此算速率）
    pub net_rx: u64,
    pub net_tx: u64,
}

/// 远端单个进程的信息
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    /// 进程名（comm）
    pub name: String,
    /// CPU 占用百分比
    pub cpu: f32,
    /// 常驻内存（字节）
    pub rss: u64,
    /// 启动时间（Unix 秒，0 表示未知）
    pub started: i64,
    /// 启动命令（完整命令行）
    pub command: String,
}

/// 升级检查结果
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    /// 安装包直链（txt 第二行）
    pub url: String,
    pub has_update: bool,
}
