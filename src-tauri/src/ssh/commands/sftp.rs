use std::path::PathBuf;

use tauri::ipc::Channel;
use tauri::State;

use crate::core::models::{SftpEntry, TransferEvent};
use crate::ssh::{self, sftp};
use crate::AppState;

use super::{err, get_session};

/* ------------------------------------------------------------------ */
/* SFTP                                                               */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn sftp_home(state: State<'_, AppState>, session_id: String) -> Result<String, String> {
    let session = get_session(&state, &session_id).await?;
    let sftp = ssh::ensure_sftp(&session).await.map_err(err)?;
    sftp::home_dir(&sftp).await.map_err(err)
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
