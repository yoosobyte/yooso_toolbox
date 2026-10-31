use std::sync::{Arc, Mutex as StdMutex};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::{mpsc, OnceCell};
use tokio::time::{sleep, Duration};

use super::process::{
    display_name, parse_elapsed, parse_metrics, parse_processes, CMD_METRICS, CMD_PROCESSES,
};
use super::shell::{parse_shell_cwd, CMD_SHELL_CWD};

use crate::core::models::{SessionConfig, SshEvent};
use crate::core::store::Store;
use crate::ssh::sftp;
use crate::ssh::{self, SshSession, TermCmd};

    /* ---------------- 纯函数单元测试 ---------------- */

    #[test]
    fn display_name_rules() {
        // 绝对路径且 basename 更长 → 用 basename（补回内核截断的部分）
        assert_eq!(
            display_name(
                "AliYunDunMonito",
                "/usr/local/aegis/aegis_client/AliYunDunMonitor --flag"
            ),
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
        assert!(
            (sample.cpu_total - 25.0).abs() < 0.01,
            "cpu_total={}",
            sample.cpu_total
        );
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
        println!(
            "[1] 认证成功 method={} fingerprint={:?}",
            outcome.auth_method, outcome.fingerprint
        );
        assert!(store
            .known_host(&format!("{}:{}", config.host, config.port))
            .is_some());
        let handle = Arc::new(handle);

        // 2) 交互式 shell 回显
        let sink = Arc::new(StdMutex::new(Vec::<u8>::new()));
        let (dummy_tx, _dummy_rx) = mpsc::unbounded_channel::<TermCmd>();
        let writer = match ssh::open_terminal(
            handle.clone(),
            100,
            30,
            collect_channel(sink.clone()),
        )
        .await
        {
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
                assert!(
                    transcript.contains("YOOSO_CMD_OK"),
                    "终端未回显: {transcript:?}"
                );
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
        assert_eq!(
            cwd.as_deref(),
            Some("/tmp"),
            "跟随目录没有匹配到本连接的 shell"
        );

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
        println!(
            "[5] 进程数={} 前三个={:?}",
            procs.len(),
            procs
                .iter()
                .take(3)
                .map(|p| format!("{}({})", p.name, p.pid))
                .collect::<Vec<_>>()
        );
        assert!(!procs.is_empty(), "进程列表为空");
        assert!(
            procs.windows(2).all(|w| w[0].rss >= w[1].rss),
            "没有按内存倒序"
        );
        assert!(
            procs.iter().all(|p| !p.command.contains("@@cpu1")),
            "自身进程未被过滤"
        );

        // 6) 结束进程：起一个 sleep，按 pid 干掉
        let (_, output) =
            ssh::remote_exec(&handle, "setsid sleep 300 >/dev/null 2>&1 & echo $!").await?;
        let pid: u32 = output
            .lines()
            .find_map(|line| line.trim().parse::<u32>().ok())
            .ok_or_else(|| anyhow::anyhow!("没有拿到 sleep 的 pid: {output:?}"))?;
        sleep(Duration::from_millis(300)).await;
        let (alive_code, _) =
            ssh::remote_exec(&handle, &format!("kill -0 {pid} 2>/dev/null")).await?;
        assert_eq!(alive_code, 0, "sleep 进程没有起来");
        let (code, msg) = ssh::remote_exec(&handle, &format!("kill -TERM {pid} 2>&1")).await?;
        sleep(Duration::from_millis(500)).await;
        let (after_code, _) =
            ssh::remote_exec(&handle, &format!("kill -0 {pid} 2>/dev/null")).await?;
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
        assert!(listed
            .iter()
            .any(|item| item.name == format!("yooso-test-{stamp}") && item.is_dir));
        println!("[7] mkdir 成功: {remote_dir}");

        let local_file = dir.join("upload.txt");
        let payload = b"yooso ssh/sftp integration test\n".to_vec();
        std::fs::write(&local_file, &payload)?;
        let channel = Channel::<crate::core::models::TransferEvent>::new(|_body| Ok(()));
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
        let names: Vec<String> = sftp::list_dir(&sftp, &remote_dir)
            .await?
            .into_iter()
            .map(|i| i.name)
            .collect();
        assert!(
            names.contains(&"renamed.txt".to_string()),
            "重命名失败: {names:?}"
        );
        println!("[7] 重命名成功");

        sftp::copy_path(&sftp, &handle, &renamed, &remote_dir).await?;
        let names: Vec<String> = sftp::list_dir(&sftp, &remote_dir)
            .await?
            .into_iter()
            .map(|i| i.name)
            .collect();
        assert!(
            names.iter().any(|n| n.contains("副本")),
            "同目录复制没有生成副本: {names:?}"
        );
        println!("[7] 复制生成副本成功: {names:?}");

        sftp::remove_path(&sftp, &remote_dir, true).await?;
        let listed = sftp::list_dir(&sftp, &home).await?;
        assert!(
            !listed
                .iter()
                .any(|item| item.name == format!("yooso-test-{stamp}")),
            "目录没有删掉"
        );
        println!("[7] 递归删除成功");

        ssh::shutdown(&handle).await;
        let _ = std::fs::remove_dir_all(&dir);
        println!("\n全部通过 ✔");
        Ok(())
    }
