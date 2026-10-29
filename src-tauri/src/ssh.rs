use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use russh::client::{self, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::{load_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh::{ChannelMsg, Disconnect};
use russh_sftp::client::SftpSession;
use tauri::ipc::Channel;
use tokio::sync::{mpsc, OnceCell};

use crate::models::{ProbeResult, SessionConfig, SshEvent};
use crate::store::Store;

/// 终端写入侧的指令
pub enum TermCmd {
    Data(Vec<u8>),
    Resize(u32, u32),
    Close,
}

/// 一条已建立的 SSH 连接（终端 + 可选的 SFTP 子系统共用同一条连接）
pub struct SshSession {
    pub handle: Arc<Handle<ClientHandler>>,
    pub writer: mpsc::UnboundedSender<TermCmd>,
    pub sftp: OnceCell<Arc<SftpSession>>,
}

/// russh 客户端回调：主机密钥校验（TOFU + 变更告警）
pub struct ClientHandler {
    host: String,
    port: u16,
    store: Arc<Store>,
    fingerprint: Arc<Mutex<Option<String>>>,
}

impl client::Handler for ClientHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let public_key = server_public_key.public_key();
        let fingerprint = public_key.fingerprint(HashAlg::Sha256).to_string();

        if let Ok(mut slot) = self.fingerprint.lock() {
            *slot = Some(fingerprint.clone());
        }

        let known_key = format!("{}:{}", self.host, self.port);
        match self.store.known_host(&known_key) {
            Some(known) if known == fingerprint => Ok(true),
            Some(known) => bail!(
                "主机密钥已变更，连接被拒绝。\n已信任: {known}\n本次: {fingerprint}\n\
                 如确认是服务器更换了密钥，请删除配置文件 known_hosts.json 中的对应条目。"
            ),
            None => {
                self.store.remember_host(&known_key, &fingerprint);
                Ok(true)
            }
        }
    }
}

pub struct ProbeOutcome {
    pub fingerprint: Option<String>,
    pub auth_method: String,
}

/// 建链 + 认证，不打开 shell
pub async fn connect_and_auth(
    config: &SessionConfig,
    store: Arc<Store>,
) -> Result<(Handle<ClientHandler>, ProbeOutcome)> {
    if config.host.trim().is_empty() {
        bail!("主机地址不能为空");
    }
    if config.username.trim().is_empty() {
        bail!("用户名不能为空");
    }

    let fingerprint_slot = Arc::new(Mutex::new(None));
    let handler = ClientHandler {
        host: config.host.trim().to_string(),
        port: config.port,
        store,
        fingerprint: fingerprint_slot.clone(),
    };

    let ssh_config = Arc::new(client::Config {
        // 终端可能长时间无输出，关闭不活跃超时，改用 keepalive 保活
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        nodelay: true,
        ..Default::default()
    });

    let addr = (config.host.trim().to_string(), config.port);
    let mut session = tokio::time::timeout(
        Duration::from_secs(20),
        client::connect(ssh_config, addr, handler),
    )
    .await
    .map_err(|_| anyhow!("连接超时（20 秒），请检查主机地址、端口与网络"))??;

    let auth_method = match config.auth_type.as_str() {
        "key" => authenticate_with_key(&mut session, config).await?,
        _ => authenticate_with_password(&mut session, config).await?,
    };

    let fingerprint = fingerprint_slot
        .lock()
        .ok()
        .and_then(|slot| slot.clone());

    Ok((
        session,
        ProbeOutcome {
            fingerprint,
            auth_method,
        },
    ))
}

async fn authenticate_with_password(
    session: &mut Handle<ClientHandler>,
    config: &SessionConfig,
) -> Result<String> {
    let password = config
        .password
        .clone()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            anyhow!(
                "未设置密码：请在会话设置中填写密码（关闭「保存凭据」时重启应用后需要重新填写）"
            )
        })?;

    let result = session
        .authenticate_password(config.username.clone(), password.clone())
        .await
        .context("密码认证请求失败")?;

    if result.success() {
        return Ok("password".to_string());
    }

    // 部分服务器只开放 keyboard-interactive
    let mut response = session
        .authenticate_keyboard_interactive_start(config.username.clone(), None::<String>)
        .await
        .context("keyboard-interactive 认证请求失败")?;

    loop {
        match response {
            KeyboardInteractiveAuthResponse::Success => return Ok("keyboard-interactive".to_string()),
            KeyboardInteractiveAuthResponse::Failure { .. } => {
                bail!("认证失败：用户名或密码错误");
            }
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                // 每个提示都回填同一密码（绝大多数服务器只会有一个 Password: 提示）
                let answers = prompts.iter().map(|_| password.clone()).collect::<Vec<_>>();
                response = session
                    .authenticate_keyboard_interactive_respond(answers)
                    .await
                    .context("keyboard-interactive 认证响应失败")?;
            }
        }
    }
}

async fn authenticate_with_key(
    session: &mut Handle<ClientHandler>,
    config: &SessionConfig,
) -> Result<String> {
    let path = config
        .private_key_path
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("未配置私钥文件"))?;

    let passphrase = config.passphrase.clone().filter(|value| !value.is_empty());
    let key = load_secret_key(&path, passphrase.as_deref())
        .with_context(|| format!("读取私钥失败：{path}"))?;

    let hash_alg = session
        .best_supported_rsa_hash()
        .await
        .context("协商 RSA 签名算法失败")?
        .flatten();

    let result = session
        .authenticate_publickey(
            config.username.clone(),
            PrivateKeyWithHashAlg::new(Arc::new(key), hash_alg),
        )
        .await
        .context("公钥认证请求失败")?;

    if !result.success() {
        bail!("私钥认证失败：请确认私钥已加入服务器的 authorized_keys");
    }
    Ok("publickey".to_string())
}

/// 打开交互式 shell：pty + shell，并把读写拆成两个后台任务
pub async fn open_terminal(
    handle: Arc<Handle<ClientHandler>>,
    cols: u32,
    rows: u32,
    on_event: Channel<SshEvent>,
) -> Result<mpsc::UnboundedSender<TermCmd>> {
    let channel = handle
        .channel_open_session()
        .await
        .context("打开 SSH 会话通道失败")?;

    channel
        .request_pty(
            false,
            "xterm-256color",
            cols.max(2),
            rows.max(1),
            0,
            0,
            &[],
        )
        .await
        .context("申请伪终端失败")?;

    channel
        .request_shell(true)
        .await
        .context("启动远程 shell 失败")?;

    let (mut reader, writer) = channel.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<TermCmd>();

    // 读任务：把服务端输出转成 base64 事件
    let event_sender = on_event.clone();
    tokio::spawn(async move {
        let mut reason: Option<String> = None;
        loop {
            match reader.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    let _ = event_sender.send(SshEvent::Data {
                        data: STANDARD.encode(data.as_ref()),
                    });
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    let _ = event_sender.send(SshEvent::Data {
                        data: STANDARD.encode(data.as_ref()),
                    });
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    reason = Some(format!("远端退出码 {exit_status}"));
                    break;
                }
                Some(ChannelMsg::ExitSignal { error_message, .. }) => {
                    reason = Some(if error_message.is_empty() {
                        "远端进程被信号终止".to_string()
                    } else {
                        error_message
                    });
                    break;
                }
                Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                Some(_) => {}
            }
        }
        let _ = event_sender.send(SshEvent::Closed { reason });
    });

    // 写任务：处理键盘输入、窗口大小变化与关闭
    tokio::spawn(async move {
        while let Some(cmd) = rx.recv().await {
            match cmd {
                TermCmd::Data(bytes) => {
                    if writer.data_bytes(bytes).await.is_err() {
                        break;
                    }
                }
                TermCmd::Resize(cols, rows) => {
                    if writer
                        .window_change(cols.max(2), rows.max(1), 0, 0)
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                TermCmd::Close => {
                    let _ = writer.eof().await;
                    let _ = writer.close().await;
                    break;
                }
            }
        }
    });

    Ok(tx)
}

/// 关闭整条连接
pub async fn shutdown(handle: &Handle<ClientHandler>) {
    let _ = handle
        .disconnect(Disconnect::ByApplication, "by user", "zh-CN")
        .await;
}

/// 在远端执行一条命令，返回 (退出码, 合并后的输出)。
/// 用于「目录打包上传后解压」「复制文件」这类 SFTP 协议本身做不到的操作。
pub async fn remote_exec(handle: &Arc<Handle<ClientHandler>>, command: &str) -> Result<(u32, String)> {
    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|error| anyhow!("打开通道失败：{error}"))?;
    channel
        .exec(true, command)
        .await
        .map_err(|error| anyhow!("执行远端命令失败：{error}"))?;

    let mut exit_code: u32 = 0;
    let mut output: Vec<u8> = Vec::new();
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { data } => output.extend_from_slice(&data),
            ChannelMsg::ExtendedData { data, .. } => output.extend_from_slice(&data),
            ChannelMsg::ExitStatus { exit_status } => exit_code = exit_status,
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }
    Ok((exit_code, String::from_utf8_lossy(&output).into_owned()))
}

/// 供 SFTP 复用同一条 SSH 连接
pub async fn ensure_sftp(session: &Arc<SshSession>) -> Result<Arc<SftpSession>> {
    let sftp = session
        .sftp
        .get_or_try_init(|| async {
            let channel = session
                .handle
                .channel_open_session()
                .await
                .map_err(|error| anyhow!("打开 SFTP 通道失败：{error}"))?;
            channel
                .request_subsystem(true, "sftp")
                .await
                .map_err(|error| anyhow!("启动 sftp 子系统失败：{error}"))?;
            let sftp = SftpSession::new(channel.into_stream())
                .await
                .map_err(|error| anyhow!("建立 SFTP 会话失败：{error}"))?;
            sftp.set_timeout(30);
            Ok::<_, anyhow::Error>(Arc::new(sftp))
        })
        .await?;

    Ok(Arc::clone(sftp))
}

/// 仅供「测试连接」使用：建链 + 认证后立即断开，不打开终端
pub async fn probe(config: &SessionConfig, store: Arc<Store>) -> Result<ProbeResult> {
    let (handle, outcome) = connect_and_auth(config, store).await?;
    shutdown(&handle).await;
    Ok(ProbeResult {
        fingerprint: outcome.fingerprint,
        server_version: None,
        auth_method: Some(outcome.auth_method),
    })
}

/* ------------------------------------------------------------------ */
/* 端到端冒烟测试（需要外网，默认 #[ignore]）                          */
/* ------------------------------------------------------------------ */

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TransferEvent;
    use std::sync::Mutex as StdMutex;
    use tauri::ipc::{Channel, InvokeResponseBody};

    fn test_config() -> SessionConfig {
        SessionConfig {
            id: "smoke".into(),
            name: "smoke".into(),
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

    /// 真实连接一台 SSH 服务器，验证：认证 → 交互式 shell → SFTP 列目录 → 上传/下载回环。
    /// 运行：`cargo test ssh_sftp_smoke -- --ignored --nocapture`
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "需要外网与可用 SSH 服务器"]
    async fn ssh_sftp_smoke() -> Result<()> {
        let dir = std::env::temp_dir().join(format!("yooso-smoke-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir)?;
        let store = Arc::new(Store::from_dir(dir.clone())?);
        let config = test_config();

        let (handle, outcome) = connect_and_auth(&config, store.clone()).await?;
        println!(
            "认证成功: method={} fingerprint={:?}",
            outcome.auth_method, outcome.fingerprint
        );
        assert!(store.known_host(&format!("{}:{}", config.host, config.port)).is_some());

        // 1) 交互式 shell：发一条命令，检查回显（纯 SFTP 服务器会跳过）
        let sink = Arc::new(StdMutex::new(Vec::<u8>::new()));
        let handle = Arc::new(handle);
        let (dummy_tx, _dummy_rx) = mpsc::unbounded_channel::<TermCmd>();
        let sftp_only = std::env::var("TEST_SSH_SFTP_ONLY").is_ok();
        let writer = if sftp_only {
            println!("SFTP_ONLY 模式：跳过终端");
            dummy_tx
        } else {
            match open_terminal(handle.clone(), 100, 30, collect_channel(sink.clone())).await
            {
                Ok(writer) => {
                    tokio::time::sleep(Duration::from_millis(1500)).await;
                    writer
                        .send(TermCmd::Data(b"echo YOOSO_SMOKE_OK\n".to_vec()))
                        .map_err(|_| anyhow!("写入终端失败"))?;

                    let mut transcript = String::new();
                    for _ in 0..40 {
                        tokio::time::sleep(Duration::from_millis(250)).await;
                        transcript = String::from_utf8_lossy(&sink.lock().unwrap()).to_string();
                        if transcript.contains("YOOSO_SMOKE_OK") {
                            break;
                        }
                    }
                    println!(
                        "终端输出片段: {:?}",
                        transcript
                            .chars()
                            .rev()
                            .take(280)
                            .collect::<String>()
                            .chars()
                            .rev()
                            .collect::<String>()
                    );
                    if transcript.is_empty() {
                        // 例如 WingFTP 这类 SFTP-only 服务端：pty/shell 请求返回成功但没有真实 shell
                        println!("服务端未提供交互式 shell（无任何输出），跳过回显断言");
                    } else {
                        assert!(
                            transcript.contains("YOOSO_SMOKE_OK"),
                            "终端没有回显命令结果，实际输出: {transcript:?}"
                        );
                    }
                    writer
                }
                Err(error) => {
                    println!("跳过终端测试（该服务器未提供 shell）: {error:#}");
                    dummy_tx
                }
            }
        };

        // 2) SFTP：同一条连接上开子系统
        let session = Arc::new(SshSession {
            handle: handle.clone(),
            writer,
            sftp: OnceCell::new(),
        });
        let sftp = ensure_sftp(&session).await?;
        let home = crate::sftp::home_dir(&sftp).await?;
        let entries = crate::sftp::list_dir(&sftp, &home).await?;
        println!(
            "SFTP 主目录: {home}（{} 项）: {:?}",
            entries.len(),
            entries
                .iter()
                .map(|entry| format!(
                    "{}{}",
                    entry.name,
                    if entry.is_dir { "/" } else { "" }
                ))
                .collect::<Vec<_>>()
        );

        // 3) 上传 / 下载
        let file_name = format!("yooso-smoke-{}.txt", uuid::Uuid::new_v4());
        let source = dir.join(&file_name);
        let payload = b"yooso toolbox sftp smoke test\n".to_vec();
        std::fs::write(&source, &payload)?;
        let remote_dir =
            std::env::var("TEST_SSH_REMOTE_DIR").unwrap_or_else(|_| home.clone());
        let remote_path = format!("{}/{}", remote_dir.trim_end_matches('/'), file_name);
        let transfer_sink = Arc::new(StdMutex::new(0u64));
        let counter = transfer_sink.clone();
        let transfer_channel = Channel::<TransferEvent>::new(move |_body| {
            *counter.lock().unwrap() += 1;
            Ok(())
        });

        match crate::sftp::upload_path(&sftp, &handle, &source, &remote_dir, &transfer_channel)
            .await
        {
            Ok(()) => {
                println!("上传成功（{} 字节 -> {remote_path}）", payload.len());
                if std::env::var("TEST_SSH_SKIP_ROUNDTRIP").is_err() {
                    let target = dir.join("smoke-download.txt");
                    crate::sftp::download_file(
                        &sftp,
                        &remote_path,
                        &target,
                        &transfer_channel,
                    )
                    .await?;
                    let downloaded = std::fs::read(&target)?;
                    assert_eq!(downloaded, payload, "下载内容与上传内容不一致");
                    println!("上传/下载回环通过（{} 字节）", payload.len());
                }
                let _ = crate::sftp::remove_path(&sftp, &remote_path, false).await;
            }
            Err(error) => {
                // 演示账号可能只读，这里不判失败，但打印出来
                println!("跳过上传回环（远端不可写？）: {error:#}");
            }
        }

        // 4) 独立下载校验：从指定目录挑一个已有文件下载并比对大小
        if let Ok(download_dir) = std::env::var("TEST_SSH_DOWNLOAD_DIR") {
            let items = crate::sftp::list_dir(&sftp, &download_dir).await?;
            if let Some(file) = items.into_iter().find(|item| !item.is_dir) {
                let target = dir.join("smoke-download-demo.bin");
                crate::sftp::download_file(&sftp, &file.path, &target, &transfer_channel).await?;
                let size = std::fs::metadata(&target)?.len();
                println!("下载成功: {}（{size} 字节）", file.name);
                assert_eq!(size, file.size, "下载大小与远端元数据不一致");
            }
        }

        assert!(*transfer_sink.lock().unwrap() > 0, "没有收到传输进度事件");

        // 5) 目录上传（本地 tar.gz + 远端解压）与远端复制
        let folder_name = format!("yooso-dir-{}", uuid::Uuid::new_v4());
        let folder = dir.join(&folder_name);
        std::fs::create_dir_all(folder.join("sub"))?;
        std::fs::write(folder.join("a.txt"), b"alpha")?;
        std::fs::write(folder.join("sub/b.txt"), b"beta")?;

        match crate::sftp::upload_path(&sftp, &handle, &folder, &remote_dir, &transfer_channel)
            .await
        {
            Ok(()) => {
                let remote_folder =
                    format!("{}/{}", remote_dir.trim_end_matches('/'), folder_name);
                let entries = crate::sftp::list_dir(&sftp, &remote_folder).await?;
                let names: Vec<String> = entries.iter().map(|item| item.name.clone()).collect();
                println!("目录上传成功: {remote_folder} -> {names:?}");
                assert!(names.iter().any(|name| name == "a.txt"), "缺少 a.txt");
                assert!(names.iter().any(|name| name == "sub"), "缺少 sub 目录");
                let sub = crate::sftp::list_dir(&sftp, &format!("{remote_folder}/sub")).await?;
                assert!(
                    sub.iter().any(|item| item.name == "b.txt"),
                    "子目录缺少 b.txt"
                );

                // 复制到同一目录 → 自动生成「- 副本」
                crate::sftp::copy_path(&sftp, &handle, &remote_folder, &remote_dir).await?;
                let copy_path = format!(
                    "{}/{} - 副本",
                    remote_dir.trim_end_matches('/'),
                    folder_name
                );
                let copied = crate::sftp::list_dir(&sftp, &copy_path).await?;
                println!("复制成功: {copy_path}（{} 项）", copied.len());
                assert!(copied.iter().any(|item| item.name == "a.txt"), "副本内容不完整");

                let _ = crate::sftp::remove_path(&sftp, &remote_folder, true).await;
                let _ = crate::sftp::remove_path(&sftp, &copy_path, true).await;
            }
            Err(error) => println!("跳过目录上传测试（远端不可写？）: {error:#}"),
        }

        shutdown(&handle).await;
        let _ = std::fs::remove_dir_all(&dir);
        Ok(())
    }
}
