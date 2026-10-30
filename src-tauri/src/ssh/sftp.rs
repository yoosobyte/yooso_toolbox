use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use flate2::write::GzEncoder;
use flate2::Compression;
use russh::client::Handle;
use russh_sftp::client::SftpSession;
use tauri::ipc::Channel;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::core::models::{SftpEntry, TransferEvent};
use crate::ssh::{self, ClientHandler};

const CHUNK_SIZE: usize = 64 * 1024;

fn mode_to_string(mode: u32) -> String {
    let bits = [
        (0o400, 'r'),
        (0o200, 'w'),
        (0o100, 'x'),
        (0o040, 'r'),
        (0o020, 'w'),
        (0o010, 'x'),
        (0o004, 'r'),
        (0o002, 'w'),
        (0o001, 'x'),
    ];
    bits.iter()
        .map(|(bit, ch)| if mode & bit != 0 { *ch } else { '-' })
        .collect()
}

fn join_remote(dir: &str, name: &str) -> String {
    if dir.ends_with('/') {
        format!("{dir}{name}")
    } else {
        format!("{dir}/{name}")
    }
}

/// 生成可以安全塞进 shell 命令行的单引号字符串
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub async fn home_dir(sftp: &SftpSession) -> Result<String> {
    sftp.canonicalize(".")
        .await
        .map_err(|error| anyhow!("获取远端主目录失败：{error}"))
}

pub async fn list_dir(sftp: &SftpSession, path: &str) -> Result<Vec<SftpEntry>> {
    let entries = sftp
        .read_dir(path)
        .await
        .map_err(|error| anyhow!("读取目录失败：{error}"))?;

    let mut out = Vec::new();
    for entry in entries {
        let meta = entry.metadata();
        out.push(SftpEntry {
            name: entry.file_name(),
            path: entry.path(),
            is_dir: meta.is_dir(),
            is_symlink: meta.is_symlink(),
            size: meta.size.unwrap_or(0),
            modified: meta.mtime.map(|value| value as i64),
            permissions: meta.permissions.map(mode_to_string),
        });
    }
    Ok(out)
}

pub async fn create_dir(sftp: &SftpSession, path: &str) -> Result<()> {
    sftp.create_dir(path)
        .await
        .map_err(|error| anyhow!("创建目录失败：{error}"))
}

pub async fn rename(sftp: &SftpSession, from: &str, to: &str) -> Result<()> {
    sftp.rename(from, to)
        .await
        .map_err(|error| anyhow!("重命名失败：{error}"))
}

/// 递归删除（SFTP 的 remove_dir 只能删空目录）
pub fn remove_path<'a>(
    sftp: &'a SftpSession,
    path: &'a str,
    is_dir: bool,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
    Box::pin(async move {
        if !is_dir {
            return sftp
                .remove_file(path)
                .await
                .map_err(|error| anyhow!("删除文件失败：{error}"));
        }

        let entries = sftp
            .read_dir(path)
            .await
            .map_err(|error| anyhow!("读取目录失败：{error}"))?;

        for entry in entries {
            let meta = entry.metadata();
            let child_path = entry.path();
            if meta.is_dir() && !meta.is_symlink() {
                remove_path(sftp, &child_path, true).await?;
            } else {
                sftp.remove_file(&child_path)
                    .await
                    .map_err(|error| anyhow!("删除文件失败：{error}"))?;
            }
        }

        sftp.remove_dir(path)
            .await
            .map_err(|error| anyhow!("删除目录失败：{error}"))
    })
}

/* ------------------------------------------------------------------ */
/* 上传                                                               */
/* ------------------------------------------------------------------ */

/// 上传一个本地路径（文件或目录）到远端目录。
/// 目录会先本地打包成 tar.gz、上传后远端解压；解压不可用时回退为逐文件上传。
pub async fn upload_path(
    sftp: &SftpSession,
    handle: &Arc<Handle<ClientHandler>>,
    local_path: &Path,
    remote_dir: &str,
    events: &Channel<TransferEvent>,
) -> Result<()> {
    let result = upload_path_inner(sftp, handle, local_path, remote_dir, events).await;
    match &result {
        Ok(()) => {
            let _ = events.send(TransferEvent::Done);
        }
        Err(error) => {
            let _ = events.send(TransferEvent::Error {
                message: format!("{error:#}"),
            });
        }
    }
    result
}

async fn upload_path_inner(
    sftp: &SftpSession,
    handle: &Arc<Handle<ClientHandler>>,
    local_path: &Path,
    remote_dir: &str,
    events: &Channel<TransferEvent>,
) -> Result<()> {
    let meta = std::fs::metadata(local_path)
        .with_context(|| format!("读取本地路径失败：{}", local_path.display()))?;
    let name = local_path
        .file_name()
        .ok_or_else(|| anyhow!("无法确定文件名：{}", local_path.display()))?
        .to_string_lossy()
        .to_string();

    if meta.is_dir() {
        upload_dir(sftp, handle, local_path, &name, remote_dir, events).await
    } else {
        let remote_path = join_remote(remote_dir, &name);
        upload_file_inner(sftp, local_path, &remote_path, Some(events)).await?;
        Ok(())
    }
}

async fn upload_dir(
    sftp: &SftpSession,
    handle: &Arc<Handle<ClientHandler>>,
    dir: &Path,
    dir_name: &str,
    remote_dir: &str,
    events: &Channel<TransferEvent>,
) -> Result<()> {
    let archive: PathBuf =
        std::env::temp_dir().join(format!("yooso-{}.tar.gz", uuid::Uuid::new_v4()));
    pack_dir(dir, dir_name, &archive)?;

    let total = std::fs::metadata(&archive)
        .map(|meta| meta.len())
        .unwrap_or(0);
    let remote_archive = format!("/tmp/.yooso-{}.tar.gz", uuid::Uuid::new_v4());

    let uploaded = async {
        let mut local = tokio::fs::File::open(&archive).await?;
        let mut remote = sftp
            .create(&remote_archive)
            .await
            .map_err(|error| anyhow!("上传临时压缩包失败：{error}"))?;

        let mut buffer = vec![0u8; CHUNK_SIZE];
        let mut sent: u64 = 0;
        loop {
            let read = local.read(&mut buffer).await.context("读取压缩包失败")?;
            if read == 0 {
                break;
            }
            remote
                .write_all(&buffer[..read])
                .await
                .map_err(|error| anyhow!("写入远端压缩包失败：{error}"))?;
            sent += read as u64;
            let _ = events.send(TransferEvent::Progress {
                transferred: sent,
                total,
            });
        }
        remote
            .sync_all()
            .await
            .map_err(|error| anyhow!("刷新远端压缩包失败：{error}"))?;
        remote
            .shutdown()
            .await
            .map_err(|error| anyhow!("关闭远端压缩包失败：{error}"))?;
        Ok::<(), anyhow::Error>(())
    }
    .await;

    let _ = std::fs::remove_file(&archive);

    if let Err(error) = uploaded {
        let _ = ssh::remote_exec(handle, &format!("rm -f {}", shell_quote(&remote_archive))).await;
        // 远端 /tmp 可能不可写：不要让整个上传失败，回退为逐文件上传
        eprintln!("[sftp] 上传临时压缩包失败：{error:#}，回退为逐文件上传");
        return upload_dir_recursive(sftp, dir, remote_dir, events).await;
    }

    let command = format!(
        "mkdir -p {dir} && tar -xzf {archive} -C {dir} && rm -f {archive}",
        dir = shell_quote(remote_dir),
        archive = shell_quote(&remote_archive),
    );

    match ssh::remote_exec(handle, &command).await {
        Ok((0, _)) => Ok(()),
        Ok((code, output)) => {
            eprintln!("[sftp] 远端解压失败（exit {code}）：{output}，回退为逐文件上传");
            let _ =
                ssh::remote_exec(handle, &format!("rm -f {}", shell_quote(&remote_archive))).await;
            upload_dir_recursive(sftp, dir, remote_dir, events).await
        }
        Err(error) => {
            eprintln!("[sftp] 无法执行远端命令：{error:#}，回退为逐文件上传");
            upload_dir_recursive(sftp, dir, remote_dir, events).await
        }
    }
}

fn pack_dir(dir: &Path, dir_name: &str, archive: &Path) -> Result<()> {
    let file = std::fs::File::create(archive)
        .with_context(|| format!("创建临时压缩包失败：{}", archive.display()))?;
    let encoder = GzEncoder::new(file, Compression::fast());
    let mut builder = tar::Builder::new(encoder);
    builder
        .append_dir_all(dir_name, dir)
        .context("打包目录失败")?;
    let encoder = builder.into_inner().context("收尾压缩包失败")?;
    encoder.finish().context("写入压缩包失败")?;
    Ok(())
}

async fn upload_dir_recursive(
    sftp: &SftpSession,
    local_dir: &Path,
    remote_dir: &str,
    events: &Channel<TransferEvent>,
) -> Result<()> {
    let total = dir_size(local_dir);
    let mut transferred: u64 = 0;
    let mut stack: Vec<(PathBuf, String)> = vec![(local_dir.to_path_buf(), remote_dir.to_string())];

    while let Some((local, remote)) = stack.pop() {
        if sftp.metadata(&remote).await.is_err() {
            sftp.create_dir(&remote)
                .await
                .map_err(|error| anyhow!("创建目录 {remote} 失败：{error}"))?;
        }
        for entry in std::fs::read_dir(&local)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            let remote_child = join_remote(&remote, &name);
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                stack.push((entry.path(), remote_child));
            } else {
                let bytes = upload_file_inner(sftp, &entry.path(), &remote_child, None).await?;
                transferred += bytes;
                let _ = events.send(TransferEvent::Progress { transferred, total });
            }
        }
    }
    Ok(())
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0;
    for entry in entries.flatten() {
        match entry.metadata() {
            Ok(meta) if meta.is_dir() => total += dir_size(&entry.path()),
            Ok(meta) => total += meta.len(),
            Err(_) => {}
        }
    }
    total
}

async fn upload_file_inner(
    sftp: &SftpSession,
    local_path: &Path,
    remote_path: &str,
    events: Option<&Channel<TransferEvent>>,
) -> Result<u64> {
    let mut local = tokio::fs::File::open(local_path)
        .await
        .with_context(|| format!("打开本地文件失败：{}", local_path.display()))?;
    let total = local.metadata().await.map(|meta| meta.len()).unwrap_or(0);

    let mut remote = sftp
        .create(remote_path)
        .await
        .map_err(|error| anyhow!("创建远端文件失败：{error}"))?;

    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut transferred: u64 = 0;
    loop {
        let read = local.read(&mut buffer).await.context("读取本地文件失败")?;
        if read == 0 {
            break;
        }
        remote
            .write_all(&buffer[..read])
            .await
            .map_err(|error| anyhow!("写入远端文件失败：{error}"))?;
        transferred += read as u64;
        if let Some(events) = events {
            let _ = events.send(TransferEvent::Progress { transferred, total });
        }
    }

    remote
        .sync_all()
        .await
        .map_err(|error| anyhow!("刷新远端文件失败：{error}"))?;
    remote
        .shutdown()
        .await
        .map_err(|error| anyhow!("关闭远端文件失败：{error}"))?;
    Ok(transferred)
}

/* ------------------------------------------------------------------ */
/* 复制（粘贴）                                                        */
/* ------------------------------------------------------------------ */

/// 把远端路径复制到目标目录：优先用远端 `cp -a`，不可用时回退为 SFTP 逐文件复制
pub async fn copy_path(
    sftp: &SftpSession,
    handle: &Arc<Handle<ClientHandler>>,
    from: &str,
    to_dir: &str,
) -> Result<()> {
    let name = from
        .rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or("item")
        .to_string();

    let mut dest = join_remote(to_dir, &name);
    if dest == from {
        dest = unique_copy_name(sftp, to_dir, &name).await;
    }

    let command = format!("cp -a -- {} {}", shell_quote(from), shell_quote(&dest));
    match ssh::remote_exec(handle, &command).await {
        Ok((0, _)) => Ok(()),
        Ok((code, output)) => {
            eprintln!("[sftp] cp 失败（exit {code}）：{output}，回退为逐文件复制");
            copy_recursive(sftp, from, &dest).await
        }
        Err(error) => {
            eprintln!("[sftp] 无法执行 cp：{error:#}，回退为逐文件复制");
            copy_recursive(sftp, from, &dest).await
        }
    }
}

async fn unique_copy_name(sftp: &SftpSession, dir: &str, name: &str) -> String {
    for index in 1..100 {
        let candidate = if index == 1 {
            format!("{name} - 副本")
        } else {
            format!("{name} - 副本 ({index})")
        };
        let path = join_remote(dir, &candidate);
        if sftp.metadata(&path).await.is_err() {
            return path;
        }
    }
    join_remote(dir, &format!("{name} - 副本 {}", uuid::Uuid::new_v4()))
}

fn copy_recursive<'a>(
    sftp: &'a SftpSession,
    from: &'a str,
    to: &'a str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
    Box::pin(async move {
        let meta = sftp
            .metadata(from)
            .await
            .map_err(|error| anyhow!("读取源信息失败：{error}"))?;

        if !meta.is_dir() {
            let data = sftp
                .read(from)
                .await
                .map_err(|error| anyhow!("读取源文件失败：{error}"))?;
            return sftp
                .write(to, &data)
                .await
                .map_err(|error| anyhow!("写入目标文件失败：{error}"));
        }

        let _ = sftp.create_dir(to).await;
        let entries = sftp
            .read_dir(from)
            .await
            .map_err(|error| anyhow!("读取源目录失败：{error}"))?;
        for entry in entries {
            let child_from = entry.path();
            let child_to = join_remote(to, &entry.file_name());
            copy_recursive(sftp, &child_from, &child_to).await?;
        }
        Ok(())
    })
}

/* ------------------------------------------------------------------ */
/* 下载                                                               */
/* ------------------------------------------------------------------ */

pub async fn download_file(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &Path,
    events: &Channel<TransferEvent>,
) -> Result<()> {
    let result = download_inner(sftp, remote_path, local_path, events).await;
    match &result {
        Ok(()) => {
            let _ = events.send(TransferEvent::Done);
        }
        Err(error) => {
            let _ = events.send(TransferEvent::Error {
                message: format!("{error:#}"),
            });
        }
    }
    result
}

async fn download_inner(
    sftp: &SftpSession,
    remote_path: &str,
    local_path: &Path,
    events: &Channel<TransferEvent>,
) -> Result<()> {
    let total = sftp
        .metadata(remote_path)
        .await
        .ok()
        .and_then(|meta| meta.size)
        .unwrap_or(0);

    let mut remote = sftp
        .open(remote_path)
        .await
        .map_err(|error| anyhow!("打开远端文件失败：{error}"))?;

    if let Some(parent) = local_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("创建本地目录失败：{}", parent.display()))?;
    }
    let mut local = tokio::fs::File::create(local_path)
        .await
        .with_context(|| format!("创建本地文件失败：{}", local_path.display()))?;

    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut transferred: u64 = 0;
    loop {
        let read = remote
            .read(&mut buffer)
            .await
            .map_err(|error| anyhow!("读取远端文件失败：{error}"))?;
        if read == 0 {
            break;
        }
        local
            .write_all(&buffer[..read])
            .await
            .context("写入本地文件失败")?;
        transferred += read as u64;
        let _ = events.send(TransferEvent::Progress { transferred, total });
    }

    local.flush().await.context("刷新本地文件失败")?;
    remote
        .shutdown()
        .await
        .map_err(|error| anyhow!("关闭远端文件失败：{error}"))?;
    Ok(())
}
