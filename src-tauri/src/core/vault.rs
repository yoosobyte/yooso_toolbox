//! 凭据库：随机数据密钥（DEK）+ 机器绑定密钥（KEK）自动解锁。
//!
//! - 首次启动生成 32 字节随机 DEK，并用「机器标识派生出的 KEK」包住存进 vault.json
//! - 启动时用同一台机器算出的 KEK 解出 DEK，无需输入任何密码
//! - 配置文件被拷到别的机器上，算不出同样的 KEK，解不开
//! - 兼容旧版「主密码」库：输入一次旧主密码后自动转换为自动解锁模式

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use anyhow::{anyhow, Result};
use argon2::Argon2;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

const VAULT_FILE: &str = "vault.json";

type SecretKey = Zeroizing<[u8; 32]>;

fn key_cell() -> &'static Mutex<Option<SecretKey>> {
    static CELL: OnceLock<Mutex<Option<SecretKey>>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(None))
}

fn install(key: SecretKey) -> Result<()> {
    *key_cell().lock().map_err(|_| anyhow!("内部状态错误"))? = Some(key);
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub v: u8,
    pub n: String,
    pub d: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    /// 是否已经初始化过凭据库
    pub configured: bool,
    /// 本次启动是否已解锁
    pub unlocked: bool,
}

fn vault_path(dir: &Path) -> PathBuf {
    dir.join(VAULT_FILE)
}

pub fn exists(dir: &Path) -> bool {
    vault_path(dir).exists()
}

fn read_value(dir: &Path) -> Result<serde_json::Value> {
    let raw = fs::read_to_string(vault_path(dir)).map_err(|_| anyhow!("凭据库尚未初始化"))?;
    Ok(serde_json::from_str(&raw)?)
}

fn version(dir: &Path) -> u64 {
    read_value(dir)
        .ok()
        .and_then(|value| value.get("v").and_then(|item| item.as_u64()))
        .unwrap_or(1)
}

fn derive(secret: &str, salt: &[u8]) -> Result<SecretKey> {
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::default()
        .hash_password_into(secret.as_bytes(), salt, key.as_mut())
        .map_err(|error| anyhow!("派生密钥失败: {error}"))?;
    Ok(key)
}

fn seal(key: &SecretKey, plain: &[u8]) -> Result<Envelope> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_ref()));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plain)
        .map_err(|_| anyhow!("加密失败"))?;
    Ok(Envelope {
        v: 1,
        n: STANDARD.encode(nonce),
        d: STANDARD.encode(ciphertext),
    })
}

fn open(key: &SecretKey, envelope: &Envelope) -> Result<Vec<u8>> {
    let nonce_bytes = STANDARD.decode(&envelope.n)?;
    let ciphertext = STANDARD.decode(&envelope.d)?;
    if nonce_bytes.len() != 12 {
        return Err(anyhow!("数据格式不正确"));
    }
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key.as_ref()));
    cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| anyhow!("凭据库数据已损坏"))
}

fn random_bytes<const N: usize>() -> [u8; N] {
    use aes_gcm::aead::rand_core::RngCore;
    let mut bytes = [0u8; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

/** 本机唯一标识：macOS 用 IOPlatformUUID，Windows 用注册表 MachineGuid，Linux 用 /etc/machine-id */
fn machine_id() -> Result<String> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .map_err(|error| anyhow!("读取机器标识失败: {error}"))?;
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            if let Some(rest) = line.split("IOPlatformUUID").nth(1) {
                if let Some(value) = rest.split('"').nth(1) {
                    return Ok(format!("mac:{}", value.trim()));
                }
            }
        }
        fallback_machine_id()
    }
    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("reg")
            .args([
                "query",
                r"HKLM\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output()
            .map_err(|error| anyhow!("读取机器标识失败: {error}"))?;
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 && parts[0] == "MachineGuid" {
                return Ok(format!("win:{}", parts[2]));
            }
        }
        fallback_machine_id()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(raw) = fs::read_to_string("/etc/machine-id") {
            let id = raw.trim();
            if !id.is_empty() {
                return Ok(format!("linux:{id}"));
            }
        }
        fallback_machine_id()
    }
    #[cfg(not(any(unix, windows)))]
    {
        fallback_machine_id()
    }
}

fn fallback_machine_id() -> Result<String> {
    let host = std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string());
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown-user".to_string());
    Ok(format!("fallback:{host}:{user}"))
}

fn machine_kek(salt: &[u8]) -> Result<SecretKey> {
    derive(&format!("yooso-machine:{}", machine_id()?), salt)
}

/* ------------------------------ 新版文件结构 ------------------------------ */

#[derive(Debug, Serialize, Deserialize)]
struct VaultV2 {
    v: u8,
    salt: String,
    wrap: Envelope,
}

pub fn status(dir: &Path) -> VaultStatus {
    let configured = exists(dir);
    let unlocked = key_cell()
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false);
    VaultStatus {
        configured,
        unlocked: configured && unlocked,
    }
}

/// 首次初始化：随机 DEK + 机器 KEK 包装
pub fn setup_auto(dir: &Path) -> Result<()> {
    let dek = Zeroizing::new(random_bytes::<32>());
    let salt = random_bytes::<16>();
    let kek = machine_kek(&salt)?;
    let wrap = seal(&kek, dek.as_ref())?;
    let file = VaultV2 {
        v: 2,
        salt: STANDARD.encode(salt),
        wrap,
    };
    write_atomic(&vault_path(dir), &serde_json::to_string_pretty(&file)?)?;
    install(dek)
}

/// 自动解锁（机器绑定）
pub fn auto_unlock(dir: &Path) -> Result<()> {
    if version(dir) < 2 {
        return Err(anyhow!("凭据库版本不受支持"));
    }
    let file: VaultV2 = serde_json::from_value(read_value(dir)?)?;
    let salt = STANDARD.decode(&file.salt)?;
    let kek = machine_kek(&salt)?;
    let bytes = open(&kek, &file.wrap)?;
    let dek = Zeroizing::new(
        <[u8; 32]>::try_from(bytes.as_slice()).map_err(|_| anyhow!("凭据库数据损坏"))?,
    );
    install(dek)
}

/// 重置：清空所有加密数据，重新生成自动解锁凭据库
pub fn reset(dir: &Path) -> Result<()> {
    for name in DATA_FILES {
        let _ = fs::remove_file(dir.join(name));
    }
    let _ = fs::remove_file(vault_path(dir));
    if let Ok(mut guard) = key_cell().lock() {
        *guard = None;
    }
    setup_auto(dir)
}

#[allow(dead_code)]
pub fn lock() {
    if let Ok(mut guard) = key_cell().lock() {
        *guard = None;
    }
}

#[allow(dead_code)]
pub fn is_unlocked() -> bool {
    key_cell()
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

fn current_key() -> Result<SecretKey> {
    key_cell()
        .lock()
        .map_err(|_| anyhow!("内部状态错误"))?
        .as_ref()
        .map(|key| key.clone())
        .ok_or_else(|| anyhow!("凭据库已锁定"))
}

/// 加密一段 JSON 文本（需要已解锁）
pub fn encrypt_text(plain: &str) -> Result<Envelope> {
    let key = current_key()?;
    seal(&key, plain.as_bytes())
}

/// 解密文件内容：
/// - 加密信封 → 用内存中的密钥解密
/// - 旧版明文 JSON → 原样返回（首次写入时会自动加密）
pub fn decrypt_text(raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.starts_with('{') && trimmed.contains("\"n\"") && trimmed.contains("\"d\"") {
        let envelope: Envelope = serde_json::from_str(trimmed)?;
        let key = current_key()?;
        let plain = open(&key, &envelope)?;
        return String::from_utf8(plain).map_err(|_| anyhow!("数据编码不正确"));
    }
    Ok(raw.to_string())
}

pub fn write_atomic(path: &Path, content: &str) -> Result<()> {
    let temp = path.with_extension("tmp");
    fs::write(&temp, content)?;
    fs::rename(&temp, path)?;
    Ok(())
}

/// 需要随数据密钥一起处理的数据文件
pub const DATA_FILES: &[&str] = &[
    "sessions.json",
    "redis.json",
    "db.json",
    "secrets.json",
];

/* ----------------------------- Tauri 命令 ----------------------------- */

#[tauri::command]
pub fn vault_status(state: tauri::State<'_, crate::AppState>) -> VaultStatus {
    status(state.store.dir())
}

#[tauri::command]
pub fn vault_auto_unlock(state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    auto_unlock(state.store.dir()).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn vault_reset(state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    reset(state.store.dir()).map_err(|error| error.to_string())
}
