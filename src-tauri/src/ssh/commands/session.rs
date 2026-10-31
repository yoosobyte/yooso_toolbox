use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::OnceCell;
use uuid::Uuid;

use crate::core::models::{ConnectResult, ProbeResult, SessionConfig, SshEvent};
use crate::ssh::{self, SshSession};
use crate::AppState;

use super::err;

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
    ssh::probe(&config, state.store.clone()).await.map_err(err)
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
