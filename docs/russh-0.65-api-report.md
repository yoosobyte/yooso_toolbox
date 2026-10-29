# russh 0.65.0 + russh-sftp 3.0.1 — exact API report

Source of truth (vendored registry):
`C:\Users\Administrator\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\russh-0.65.0\`
`C:\Users\Administrator\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\russh-sftp-3.0.1\`
`C:\Users\Administrator\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\ssh-key-0.7.0-rc.11\`

**Verification.** Every signature below was read in the vendored source (`file:line` given). In addition, a
scratch crate in `C:\Users\Administrator\AppData\Local\Temp\russh_verify` was **compiled successfully**
(`cargo build --offline`, rustc 1.99.1 MSVC, 39 s) containing verbatim copies of the snippets marked ✅ —
including the `Handler` impl, connect, password + keyboard-interactive auth, PTY/shell/exec, `data`,
`wait()`, `into_stream()`, all SFTP calls, fingerprints, and static assertions
`assert_send/assert_sync/assert_unpin` for `Handle`, `Channel`, `ChannelStream`, `SftpSession`.
Two negative claims were compiler-proven (`E0599`): `Handle<H>: !Clone`, `client::Config: !Clone`.

---

## 0. Cargo.toml — the only combination that needs no cmake/nasm on Windows

`russh-0.65.0/Cargo.toml:36-52`:

```toml
[features]
_bench = ["dep:criterion"]
aws-lc-rs = ["dep:aws-lc-rs"]
default = [
    "flate2",
    "aws-lc-rs",     # <-- DEFAULT CRYPTO BACKEND = aws-lc-rs (needs cmake AND nasm on Windows)
    "rsa",
]
des = ["dep:des"]
dsa = ["ssh-key/dsa"]
ring = ["dep:ring"]
rsa = ["dep:rsa", "dep:pkcs1", "ssh-key/rsa"]
serde = ["ssh-key/serde"]
```

`russh-0.65.0/src/lib.rs:90-96` — one backend is mandatory:

```rust
#[cfg(not(any(feature = "ring", feature = "aws-lc-rs")))]
compile_error!("`russh` requires enabling either the `ring` or `aws-lc-rs` feature as a crypto backend.");
#[cfg(any(feature = "ring", feature = "aws-lc-rs"))]
include!("lib_inner.rs");
```

**Put exactly this in the consumer `Cargo.toml`** (✅ compiled, no cmake, no nasm, no network beyond crates.io):

```toml
[dependencies]
russh = { version = "0.65.0", default-features = false, features = ["ring", "rsa"] }
russh-sftp = "3.0.1"                       # has NO default features and NO dependency on russh
tokio = { version = "1", features = ["rt-multi-thread", "macros", "io-util", "net", "time", "sync"] }
bytes = "1"                                 # only to name ChannelMsg::Data's Bytes / Channel::data_bytes
```

* `ring` → C build via MSVC `cc` only. `aws-lc-rs` → needs `cmake` **and** `nasm`; do not use it on this box.
* `rsa` is pure Rust (`rsa =0.10.0-rc.18`, `pkcs1 =0.8.0-rc.4`, both pinned pre-releases) and is what enables
  RSA host/user keys. Without it, RSA signing fails at runtime with
  `ssh_key::Error::AlgorithmUnsupported` (`src/helpers.rs:207-223`, added deliberately — see the comment there).
* `flate2` (zlib compression) is optional and pure-Rust (`miniz_oxide`) — safe to add if you need compression,
  otherwise the client simply never negotiates compression (`src/negotiation.rs:203-205`).
* `edition = "2024"`, `rust-version = "1.89"` (`Cargo.toml:13-14`) → Rust ≥ 1.89 required; 1.99.1 is fine.

---

## 1. SSH client connect

### 1.1 `connect` / `connect_stream` (`src/client/mod.rs:1188`, `:1208`)

```rust
// src/client/mod.rs:1187-1202
#[cfg(not(target_arch = "wasm32"))]
pub async fn connect<H: Handler + Send + 'static, A: tokio::net::ToSocketAddrs>(
    config: Arc<Config>,          // NB: Arc<Config>, NOT Config
    addrs: A,
    handler: H,
) -> Result<Handle<H>, H::Error>; // NB: error type is the HANDLER's error, not russh::Error

// src/client/mod.rs:1208-1216
pub async fn connect_stream<H, R>(
    config: Arc<Config>,
    mut stream: R,
    handler: H,
) -> Result<Handle<H>, H::Error>
where
    H: Handler + Send + 'static,
    R: AsyncRead + AsyncWrite + Unpin + Send + 'static;
```

### 1.2 `client::Config` (`src/client/mod.rs:2722-2772`) — **not `Clone`** (compiler-proven `E0599`)

```rust
#[derive(Debug)]                 // :2722  <-- Debug only. No Clone. Wrap it in Arc and reuse that.
pub struct Config {
    pub client_id: SshId,                          // :2725  russh::SshId::Standard(Cow<'static,str>) | Raw(..)
    pub limits: Limits,                            // :2727  russh::Limits { rekey_write_limit, rekey_read_limit, rekey_time_limit }
    pub window_size: u32,                          // :2729
    pub maximum_packet_size: u32,                  // :2731
    pub channel_buffer_size: usize,                // :2733
    pub preferred: negotiation::Preferred,         // :2735  public path: russh::Preferred
    pub inactivity_timeout: Option<std::time::Duration>,   // :2737
    pub keepalive_interval: Option<std::time::Duration>,   // :2739
    pub keepalive_max: usize,                      // :2741
    pub anonymous: bool,                           // :2743
    pub gex: GexParams,                            // :2745  client::GexParams (client/mod.rs:2597)
    pub nodelay: bool,                             // :2747
}

impl Default for Config {        // :2750-2772
    fn default() -> Config {
        Config {
            client_id: SshId::Standard(Cow::Borrowed(concat!("SSH-2.0-", env!("CARGO_PKG_NAME"), "_", env!("CARGO_PKG_VERSION")))),
            limits: Limits::default(),          // 1 GiB / 1 GiB / 3600 s
            window_size: 2097152,               // 2 MiB
            maximum_packet_size: 32768,
            channel_buffer_size: 100,
            preferred: Default::default(),
            inactivity_timeout: None,
            keepalive_interval: None,
            keepalive_max: 3,
            anonymous: false,
            gex: Default::default(),
            nodelay: false,                     // Nagle ON by default
        }
    }
}
```

### 1.3 `client::Handle` (`src/client/mod.rs:316-322`) — **not `Clone`** (`E0599`), but **`Send + Sync`** ✅

```rust
pub struct Handle<H: Handler> {          // :316  no #[derive], and it has a Drop impl (:324)
    sender: Sender<Msg>,
    receiver: UnboundedReceiver<Reply>,
    join: russh_util::runtime::JoinHandle<Result<(), H::Error>>,
    channel_buffer_size: usize,
    agent_session_binding: Option<crate::keys::agent::AgentSessionBinding>,
}
```

`Handle` implements `Future` (`src/client/mod.rs:1166-1178`), so you can `.await` it to join the session loop:

```rust
impl<H: Handler> Future for Handle<H> { type Output = Result<(), H::Error>; }
```

Free functions on the handle that matter (`&self` unless stated):

```rust
pub fn is_closed(&self) -> bool                                        // :331
pub async fn channel_open_session(&self) -> Result<Channel<Msg>, crate::Error>   // :844
pub async fn disconnect(&self, reason: Disconnect, description: &str, language_tag: &str)
    -> Result<(), crate::Error>                                        // :1034
pub async fn data(&self, id: ChannelId, data: impl Into<bytes::Bytes>)
    -> Result<(), bytes::Bytes>                                        // :1055  (server-initiated channels; not Channel::data)
pub async fn send_keepalive(&self, want_reply: bool) -> Result<(), Error>        // :1081
pub async fn send_ping(&self) -> Result<(), Error>                               // :1089
pub async fn rekey_soon(&self) -> Result<(), Error>                              // :1071
```

### 1.4 `client::Handler` (`src/client/mod.rs:2782-3202`) — **native async-fn trait, NO `#[async_trait]`**

```rust
// :2780-2782  doc comment says: "Note: this is an async trait. The trait functions return `impl Future`,
//              and you can simply define them as `async fn` instead."
pub trait Handler: Sized + Send {
    type Error: From<crate::Error> + Send + core::fmt::Debug;   // :2783

    // ---- the only method you must override (default rejects every key) ----
    fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,              // :2806-2811  NOT &ssh_key::PublicKey
    ) -> impl Future<Output = Result<bool, Self::Error>> + Send {
        async { Ok(false) }
    }

    // ---- everything else, in source order (all have defaults) ----
    fn auth_banner(&mut self, banner: &str, session: &mut Session)
        -> impl Future<Output = Result<(), Self::Error>> + Send;                       // :2790
    fn kex_done(&mut self, shared_secret: Option<&[u8]>, names: &russh::Names, session: &mut Session)
        -> impl Future<Output = Result<(), Self::Error>> + Send;                       // :2832
    fn channel_open_confirmation(&mut self, id: ChannelId, max_packet_size: u32, window_size: u32, session: &mut Session)
        -> impl Future<Output = Result<(), Self::Error>> + Send;                       // :2845
    fn channel_success(&mut self, channel: ChannelId, session: &mut Session) -> ...;   // :2857
    fn channel_failure(&mut self, channel: ChannelId, session: &mut Session) -> ...;   // :2867
    fn channel_close(&mut self, channel: ChannelId, session: &mut Session) -> ...;     // :2877
    fn channel_eof(&mut self, channel: ChannelId, session: &mut Session) -> ...;       // :2887
    fn channel_open_failure(&mut self, channel: ChannelId, reason: ChannelOpenFailure,
                            description: &str, language: &str, session: &mut Session) -> ...;  // :2897
    fn server_channel_open_forwarded_tcpip(&mut self, channel: Channel<Msg>, connected_address: &str,
        connected_port: u32, originator_address: &str, originator_port: u32,
        reply: ChannelOpenHandle, session: &mut Session) -> ...;                       // :2915
    fn server_channel_open_forwarded_streamlocal(&mut self, channel: Channel<Msg>,
        socket_path: &str, reply: ChannelOpenHandle, session: &mut Session) -> ...;    // :2937
    fn server_channel_open_agent_forward(&mut self, channel: Channel<Msg>,
        reply: ChannelOpenHandle, session: &mut Session) -> ...;                       // :2956
    fn should_accept_unknown_server_channel(&mut self, id: ChannelId, channel_type: &str)
        -> impl Future<Output = bool> + Send { async { false } }                       // :2973  (NOT a Result)
    fn server_channel_open_unknown(&mut self, channel: Channel<Msg>,
        reply: ChannelOpenHandle, session: &mut Session) -> ...;                       // :2989
    fn server_channel_open_session(&mut self, channel: Channel<Msg>,
        reply: ChannelOpenHandle, session: &mut Session) -> ...;                       // :3004
    fn server_channel_open_direct_tcpip(&mut self, channel: Channel<Msg>, host_to_connect: &str,
        port_to_connect: u32, originator_address: &str, originator_port: u32,
        reply: ChannelOpenHandle, session: &mut Session) -> ...;                       // :3023
    fn server_channel_open_direct_streamlocal(&mut self, channel: Channel<Msg>,
        socket_path: &str, reply: ChannelOpenHandle, session: &mut Session) -> ...;    // :3045
    fn server_channel_open_x11(&mut self, channel: Channel<Msg>, originator_address: &str,
        originator_port: u32, reply: ChannelOpenHandle, session: &mut Session) -> ...; // :3064
    fn data(&mut self, channel: ChannelId, data: &[u8], session: &mut Session) -> ...;  // :3083
    fn extended_data(&mut self, channel: ChannelId, ext: u32, data: &[u8], session: &mut Session) -> ...; // :3097
    fn xon_xoff(&mut self, channel: ChannelId, client_can_do: bool, session: &mut Session) -> ...;       // :3111
    fn exit_status(&mut self, channel: ChannelId, exit_status: u32, session: &mut Session) -> ...;       // :3122
    fn exit_signal(&mut self, channel: ChannelId, signal_name: Sig, core_dumped: bool,
                   error_message: &str, lang_tag: &str, session: &mut Session) -> ...;  // :3133
    fn window_adjusted(&mut self, channel: ChannelId, new_size: u32, session: &mut Session) -> ...;      // :3151
    fn adjust_window(&mut self, channel: ChannelId, window: u32) -> u32 { window }        // :3163  NOT async
    fn openssh_ext_host_keys_announced(&mut self, keys: Vec<PublicKey>, session: &mut Session) -> ...;   // :3175
    fn disconnected(&mut self, reason: DisconnectReason<Self::Error>) -> ...;              // :3190
}
```

`PublicKeyOrCertificate` is `russh::keys::PublicKeyOrCertificate` (`src/keys/mod.rs:89` re-exports
`crate::cert::PublicKeyOrCertificate`; the `cert` module itself is private, `src/lib_inner.rs:19`):

```rust
// src/cert.rs:10-18
#[derive(Debug)]
pub enum PublicKeyOrCertificate {
    PublicKey { key: PublicKey, hash_alg: Option<HashAlg> },   // ssh_key::PublicKey + Option<ssh_key::HashAlg>
    Certificate(Certificate),                                  // ssh_key::Certificate
}
impl PublicKeyOrCertificate {
    pub fn public_key(&self) -> PublicKey;                      // :63  owned clone; cert -> PublicKey::new(cert.public_key().clone(), "")
    pub fn certificate(&self) -> Option<&Certificate>;          // :72
}
```

✅ Minimal, compiled handler:

```rust
use russh::client;
use russh::keys::{HashAlg, PublicKeyOrCertificate};

struct Client;

impl client::Handler for Client {
    type Error = russh::Error;                 // anyhow::Error also works (russh's own examples use it)

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let pk = server_public_key.public_key();          // ssh_key::PublicKey
        let fp = pk.fingerprint(HashAlg::Sha256);         // ssh_key::Fingerprint
        println!("{} {}", fp, pk.algorithm().as_str());   // "SHA256:... ssh-ed25519"
        Ok(true)                                          // return false => handshake aborts
    }
}
```

---

## 2. Authentication

`AuthResult` (`src/auth.rs:153-168`, re-exported as `russh::client::AuthResult` at `src/client/mod.rs:59`):

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthResult {
    Success,
    Failure { remaining_methods: MethodSet, partial_success: bool },
}
impl AuthResult { pub fn success(&self) -> bool { matches!(self, AuthResult::Success) } }  // :165
```

All on `Handle<H>`, **all take `&mut self`**:

```rust
// src/client/mod.rs:346
pub async fn authenticate_none<U: Into<String>>(&mut self, user: U) -> Result<AuthResult, crate::Error>;

// src/client/mod.rs:362
pub async fn authenticate_password<U: Into<String>, P: Into<String>>(
    &mut self, user: U, password: P,
) -> Result<AuthResult, crate::Error>;

// src/client/mod.rs:383
pub async fn authenticate_keyboard_interactive_start<U: Into<String>, S: Into<Option<String>>>(
    &mut self, user: U, submethods: S,        // pass None::<String> for "no submethods"
) -> Result<KeyboardInteractiveAuthResponse, crate::Error>;

// src/client/mod.rs:409
pub async fn authenticate_keyboard_interactive_respond(
    &mut self, responses: Vec<String>,        // len must match prompts.len()
) -> Result<KeyboardInteractiveAuthResponse, crate::Error>;

// src/client/mod.rs:493
pub async fn authenticate_publickey<U: Into<String>>(
    &mut self, user: U, key: PrivateKeyWithHashAlg,      // russh::keys::PrivateKeyWithHashAlg, by value
) -> Result<AuthResult, crate::Error>;

// src/client/mod.rs:510
pub async fn authenticate_openssh_cert<U: Into<String>>(
    &mut self, user: U, key: Arc<PrivateKey>, cert: Certificate,
) -> Result<AuthResult, crate::Error>;

// src/client/mod.rs:809
pub async fn best_supported_rsa_hash(&self) -> Result<Option<Option<HashAlg>>, Error>;
```

`KeyboardInteractiveAuthResponse` (`src/client/mod.rs:278-293`):

```rust
#[derive(Debug)]
pub enum KeyboardInteractiveAuthResponse {
    Success,
    Failure { remaining_methods: MethodSet, partial_success: bool },
    InfoRequest { name: String, instructions: String, prompts: Vec<Prompt> },
}
#[derive(Debug)] pub struct Prompt { pub prompt: String, pub echo: bool }   // :296
```

✅ Compiled password + keyboard-interactive (`&mut Handle`), success is `.success()` on `AuthResult` and
pattern-matching on `KeyboardInteractiveAuthResponse` (there is no `.success()` there):

```rust
use russh::client::{AuthResult, Handle, KeyboardInteractiveAuthResponse};

async fn auth(session: &mut Handle<Client>) -> anyhow::Result<()> {
    let res: AuthResult = session.authenticate_password("user", "pass").await?;
    if !res.success() { anyhow::bail!("password auth failed"); }

    let mut resp = session
        .authenticate_keyboard_interactive_start("user", None::<String>)
        .await?;
    loop {
        match resp {
            KeyboardInteractiveAuthResponse::Success => break,
            KeyboardInteractiveAuthResponse::Failure { remaining_methods, partial_success } => {
                anyhow::bail!("ki failed: {remaining_methods:?} partial={partial_success}")
            }
            KeyboardInteractiveAuthResponse::InfoRequest { name, instructions, prompts } => {
                let _ = (name, instructions);
                let answers: Vec<String> = prompts.iter().map(|p| p.prompt.clone()).collect();
                resp = session.authenticate_keyboard_interactive_respond(answers).await?;
            }
        }
    }
    Ok(())
}
```

Gotcha inside `Handle::wait_recv_reply` (`:462-484`): if the reply channel is **closed** (session died), the
method returns `Ok(AuthResult::Failure { remaining_methods: MethodSet::empty(), partial_success: false })`
— a dead connection looks like a wrong password, not an `Err`. Check `handle.is_closed()` if you need to tell
them apart.

Public-key auth needs `PrivateKeyWithHashAlg` (`src/keys/key.rs:85-98`):

```rust
pub struct PrivateKeyWithHashAlg { key: Arc<PrivateKey>, hash_alg: Option<HashAlg> }
impl PrivateKeyWithHashAlg {
    pub fn new(key: Arc<crate::keys::PrivateKey>, hash_alg: Option<crate::keys::HashAlg>) -> Self; // :95
    pub fn hash_alg(&self) -> Option<HashAlg>;   // :109
}
// usage (from examples/client_exec_simple.rs:111-119):
// PrivateKeyWithHashAlg::new(Arc::new(key_pair), session.best_supported_rsa_hash().await?.flatten())
```

---

## 3. Session / channel

`Channel` is `russh::Channel<Send>`; for a client the concrete type is `Channel<russh::client::Msg>`.
`ChannelWriteHalf<S>` and `ChannelReadHalf` are also public (`src/lib_inner.rs:63`).

### 3.1 PTY / shell / exec / subsystem / window size

Identical on `Channel<S>` (`:511`, `:535`, `:542`, `:552`, `:596`) and on `ChannelWriteHalf<S>` (`:207`, `:230`, `:237`, `:251`, `:301`);
all take `&self` and return `Result<(), russh::Error>`:

```rust
pub async fn request_pty(
    &self,
    want_reply: bool,
    term: &str,                       // &str, not String
    col_width: u32,                   // u32 (not u16/u32 pairs)
    row_height: u32,
    pix_width: u32,
    pix_height: u32,
    terminal_modes: &[(Pty, u32)],    // russh::Pty, e.g. &[(Pty::IUTF8, 1)] or &[]
) -> Result<(), Error>;

pub async fn request_shell(&self, want_reply: bool) -> Result<(), Error>;
pub async fn exec<A: Into<Vec<u8>>>(&self, want_reply: bool, command: A) -> Result<(), Error>;
pub async fn request_subsystem<A: Into<String>>(&self, want_reply: bool, name: A) -> Result<(), Error>;
pub async fn window_change(&self, col_width: u32, row_height: u32, pix_width: u32, pix_height: u32)
    -> Result<(), Error>;             // <-- there is NO `request_pty_size` in 0.65
pub async fn set_env<A: Into<String>, B: Into<String>>(&self, want_reply: bool, variable_name: A,
    variable_value: B) -> Result<(), Error>;
pub async fn signal(&self, signal: Sig) -> Result<(), Error>;
pub async fn agent_forward(&self, want_reply: bool) -> Result<(), Error>;
```

`Pty` (`src/pty.rs:3-5`) is `#[derive(Debug, Copy, Clone, PartialEq, Eq)] pub enum Pty { TTY_OP_END = 0, VINTR = 1, … , IUTF8 = 42, ISIG = 50, ICANON = 51, ECHO = 53, … }`.

### 3.2 Reading: `ChannelMsg` (`src/channels/mod.rs:18-114`) — `#[non_exhaustive]`!

```rust
#[derive(Debug)]
#[non_exhaustive]                       // :19  ==> your match MUST have a `_ => ...` arm
pub enum ChannelMsg {
    Open { id: ChannelId, max_packet_size: u32, window_size: u32 },
    Data { data: Bytes },                       // :27   bytes::Bytes (not Vec<u8>, not CryptoVec)
    ExtendedData { data: Bytes, ext: u32 },     // :30
    Eof,                                        // :34
    Close,                                      // :35
    RequestPty { want_reply: bool, term: String, col_width: u32, row_height: u32,
                 pix_width: u32, pix_height: u32, terminal_modes: Vec<(Pty, u32)> },
    RequestShell { want_reply: bool },
    Exec { want_reply: bool, command: Vec<u8> },
    Signal { signal: Sig },
    RequestSubsystem { want_reply: bool, name: String },
    RequestX11 { want_reply: bool, single_connection: bool, x11_authentication_protocol: String,
                 x11_authentication_cookie: String, x11_screen_number: u32 },
    SetEnv { want_reply: bool, variable_name: String, variable_value: String },
    WindowChange { col_width: u32, row_height: u32, pix_width: u32, pix_height: u32 },
    AgentForward { want_reply: bool },
    XonXoff { client_can_do: bool },
    ExitStatus { exit_status: u32 },            // :95
    ExitSignal { signal_name: Sig, core_dumped: bool, error_message: String, lang_tag: String },
    WindowAdjusted { new_size: u32 },
    Success,
    Failure,
    OpenFailure(ChannelOpenFailure),            // :113  tuple variant
}

// src/channels/mod.rs:656-659
pub async fn wait(&mut self) -> Option<ChannelMsg>;   // None == channel closed / stream ended
```

Also: `pub fn split(self) -> (ChannelReadHalf, ChannelWriteHalf<S>)` (`:505`), and on `ChannelReadHalf`:
`pub async fn wait(&mut self) -> Option<ChannelMsg>` (`:158`), `pub fn make_reader(&mut self) -> impl AsyncRead + '_` (`:164`).

### 3.3 Writing: `data` now takes an `AsyncRead` (`src/channels/mod.rs:613-641`)

```rust
pub async fn data<R: tokio::io::AsyncRead + Unpin>(&self, data: R) -> Result<(), Error>;       // :614
pub async fn data_bytes(&self, data: impl Into<Bytes>) -> Result<(), Error>;                   // :619
pub async fn extended_data<R: tokio::io::AsyncRead + Unpin>(&self, ext: u32, data: R) -> Result<(), Error>; // :626
pub async fn extended_data_bytes(&self, ext: u32, data: impl Into<Bytes>) -> Result<(), Error>;            // :635

// AsyncWrite views (do NOT consume the channel):
pub fn make_writer(&self) -> impl AsyncWrite + 'static;                 // :691
pub fn make_writer_ext(&self, ext: Option<u32>) -> impl AsyncWrite + 'static;  // :697
```

`Channel` itself does **not** implement `AsyncWrite` — you need `make_writer()` or `into_stream()`.
`&[u8]` does implement `tokio::io::AsyncRead`, so `channel.data(&buf[..n]).await?` still compiles and sends
exactly `n` bytes (this is what `examples/client_exec_interactive.rs:175` does).

### 3.4 EOF / close

```rust
pub async fn eof(&self) -> Result<(), Error>;      // :643  sends SSH_MSG_CHANNEL_EOF
pub async fn close(&self) -> Result<(), Error>;    // :652  sends SSH_MSG_CHANNEL_CLOSE
```

### 3.5 `Channel` → `AsyncRead + AsyncWrite` (for russh-sftp)

```rust
// src/channels/mod.rs:661-675
pub fn into_stream(self) -> ChannelStream<S>;      // consumes self

// src/channels/channel_stream.rs:11-63
pub struct ChannelStream<S> where S: From<(ChannelId, ChannelMsg)> + Send + 'static { /* tx, rx */ }
impl<S: From<(ChannelId, ChannelMsg)> + Send> AsyncRead  for ChannelStream<S> { .. }   // :28
impl<S: From<(ChannelId, ChannelMsg)> + 'static + Send + Sync> AsyncWrite for ChannelStream<S> { .. } // :41  (poll_shutdown sends Close)
```

✅ `ChannelStream<russh::client::Msg>` is `Send + Unpin` (asserted in the compile test) → satisfies
`SftpSession::new`'s `S: AsyncRead + AsyncWrite + Unpin + Send + 'static`.

### 3.6 Concurrency: `Handle` is NOT `Clone` — use `Arc<Handle<H>>`

Compiler-proven: `let h2 = h.clone();` → `error[E0599]: no method named 'clone' found for struct 'russh::client::Handle<H>'`.
But `Handle<H>` **is** `Send + Sync` (asserted), and every channel-open method takes `&self`, so:

```rust
use std::sync::Arc;
use russh::client::Handle;

// 1) auth needs `&mut Handle` -> do it BEFORE sharing
let mut session = russh::client::connect(Arc::new(cfg), ("host", 22), Client).await?;
session.authenticate_password("u", "p").await?.success().then_some(()).ok_or_else(|| anyhow::anyhow!("auth"))?;

// 2) share it
let handle: Arc<Handle<Client>> = Arc::new(session);
for i in 0..3 {
    let h = handle.clone();                       // Arc clone, cheap
    tokio::spawn(async move {
        let mut ch = h.channel_open_session().await.unwrap();
        ch.exec(true, format!("echo {i}")).await.unwrap();
        while let Some(_msg) = ch.wait().await {}
    });
}
```

✅ Exactly this shape (including the `tokio::spawn`) compiled. `Handle<H>` can also be awaited as a `Future`
to join the session task (`impl Future for Handle<H>`, `src/client/mod.rs:1166`).

---

## 4. Server key fingerprint + algorithm name

`ssh_key` is re-exported **inside `russh::keys`** (`src/keys/mod.rs:74-78`), not at the crate root:

```rust
// src/keys/mod.rs:74-78
pub use format::*;
pub use signature;                                              // russh::keys::signature
pub use ssh_encoding;                                           // russh::keys::ssh_encoding
pub use ssh_key::{self, Algorithm, Certificate, EcdsaCurve, HashAlg, PrivateKey, PublicKey};
//  ^ hence: russh::keys::ssh_key::*, russh::keys::{PublicKey, PrivateKey, HashAlg, Algorithm, Certificate}
//  ^ `russh::ssh_key` does NOT exist.
pub use crate::cert::PublicKeyOrCertificate;                    // :89
pub use known_hosts::{check_known_hosts, check_known_hosts_path}; // :87
```

Fingerprint (`ssh-key-0.7.0-rc.11/src/public.rs:378-384`, `src/fingerprint.rs:183-192`):

```rust
pub fn fingerprint(&self, hash_alg: HashAlg) -> Fingerprint;   // public.rs:382
pub fn algorithm(&self) -> Algorithm;                          // public.rs:361
impl Display for Fingerprint { /* writes "{prefix}:{base64}"  ->  "SHA256:Nh0Me49..." */ } // fingerprint.rs:189-190
// HashAlg derives Default with #[default] Sha256 (algorithm.rs:416-421); Fingerprint does NOT impl Default.
// Algorithm::as_str(&self) -> &str  (algorithm.rs:202) => "ssh-ed25519", "rsa-sha2-256", "ecdsa-sha2-nistp256", ...
// Fingerprint also has: prefix() -> "SHA256"|"SHA512" (:93), as_bytes() -> &[u8] (:110), algorithm() -> HashAlg (:84)
```

✅ Compiled helper:

```rust
use russh::keys::{HashAlg, PublicKeyOrCertificate};

pub fn describe(key: &PublicKeyOrCertificate) -> (String, String) {
    let pk = key.public_key();                                  // ssh_key::PublicKey
    let fp = pk.fingerprint(HashAlg::Sha256).to_string();       // "SHA256:base64" (no padding)
    let alg = pk.algorithm().as_str().to_string();              // "ssh-ed25519"
    (fp, alg)
}
// OpenSSH-style compare:  fp == "SHA256:" + BASE64_NOPAD(sha256(pk.key_data().encoded()))
```

Known-hosts helpers, if you want the built-in verification
(`src/keys/known_hosts.rs:15`, `:24`, taking the `ssh_key::PublicKey` you got from `public_key()`):

```rust
pub fn check_known_hosts(host: &str, port: u16, pubkey: &ssh_key::PublicKey) -> Result<bool, Error>;
pub fn check_known_hosts_path<P: AsRef<Path>>(host: &str, port: u16, pubkey: &ssh_key::PublicKey, path: P)
    -> Result<bool, Error>;
```

---

## 5. russh-sftp 3.0.1

* Re-export location: **`russh_sftp::client::SftpSession`** (`src/client/mod.rs:8-10`:
  `pub use handler::Handler; pub use rawsession::RawSftpSession; pub use session::SftpSession;`).
  **There is no `russh_sftp::SftpSession`** (`src/lib.rs:24-36` only declares `pub mod client;`).
* It does **not** depend on `russh` at all (normal deps: `src/Cargo.toml:54-98`; `russh = "0.63.2"` appears only
  under `[dev-dependencies]`, `:116-117`) → no version-pin conflict with russh 0.65.
* No features are needed; the only feature is optional `async-trait` (`Cargo.toml:34-35`), and there is no
  `default` key. **Tokio is mandatory** (`tokio` dep with `io-util, rt, sync, time, macros`, `Cargo.toml:84-93`):
  `File` implements `tokio::io::{AsyncRead, AsyncWrite, AsyncSeek}` and `SftpSession::new` bounds on
  `tokio::io::{AsyncRead, AsyncWrite}` — you must import `tokio::io::AsyncReadExt` / `AsyncWriteExt` yourself.

### 5.1 Session (`src/client/session.rs`)

```rust
pub struct SftpSession { /* Arc<RawSftpSession>, Features */ }                   // :31
pub async fn new<S>(stream: S) -> SftpResult<Self>                              // :38
where S: AsyncRead + AsyncWrite + Unpin + Send + 'static;                       // tokio::io traits
pub async fn new_with_config<S>(stream: S, cfg: Config) -> SftpResult<Self>     // :46  (same bounds)

pub fn set_timeout(&self, secs: u64);                                          // :88   default 10 s
pub async fn close(&self) -> SftpResult<()>;                                   // :93

pub async fn open<T: Into<String>>(&self, filename: T) -> SftpResult<File>;     // :98   OpenFlags::READ
pub async fn create<T: Into<String>>(&self, filename: T) -> SftpResult<File>;   // :105  CREATE|TRUNCATE|WRITE
pub async fn open_with_flags<T: Into<String>>(&self, filename: T, flags: OpenFlags) -> SftpResult<File>; // :114
pub async fn open_with_flags_and_attributes<T: Into<String>>(&self, filename: T, flags: OpenFlags,
    attributes: FileAttributes) -> SftpResult<File>;                           // :124
pub async fn canonicalize<T: Into<String>>(&self, path: T) -> SftpResult<String>;   // :135  -> String (not PathBuf)
pub async fn create_dir<T: Into<String>>(&self, path: T) -> SftpResult<()>;         // :144
pub async fn read<P: Into<String>>(&self, path: P) -> SftpResult<Vec<u8>>;          // :152  whole file
pub async fn write<P: Into<String>>(&self, path: P, data: &[u8]) -> SftpResult<()>; // :163
pub async fn try_exists<P: Into<String>>(&self, path: P) -> SftpResult<bool>;       // :171  NoSuchFile => Ok(false)
pub async fn read_dir<P: Into<String>>(&self, path: P) -> SftpResult<ReadDir>;      // :180  -> ReadDir: Iterator<Item = DirEntry>
pub async fn read_link<P: Into<String>>(&self, path: P) -> SftpResult<String>;      // :211
pub async fn remove_dir<P: Into<String>>(&self, path: P) -> SftpResult<()>;         // :220
pub async fn remove_file<T: Into<String>>(&self, filename: T) -> SftpResult<()>;    // :225
pub async fn rename<O: Into<String>, N: Into<String>>(&self, oldpath: O, newpath: N) -> SftpResult<()>; // :230
pub async fn symlink<P: Into<String>, T: Into<String>>(&self, path: P, target: T) -> SftpResult<()>;   // :239
pub async fn metadata<P: Into<String>>(&self, path: P) -> SftpResult<Metadata>;          // :248  = SSH_FXP_STAT
pub async fn set_metadata<P: Into<String>>(&self, path: P, metadata: Metadata) -> Result<(), Error>; // :253
pub async fn symlink_metadata<P: Into<String>>(&self, path: P) -> SftpResult<Metadata>;  // :261  = SSH_FXP_LSTAT
pub async fn hardlink<O: Into<String>, N: Into<String>>(&self, o: O, n: N) -> SftpResult<bool>; // :265
pub async fn fs_info<P: Into<String>>(&self, path: P) -> SftpResult<Option<Statvfs>>;   // :279
pub async fn expand_path<P: Into<String>>(&self, path: P) -> SftpResult<Option<String>>;// :289
```

**There are no `stat`/`lstat` methods on `SftpSession`** in 3.0.1 — use `metadata` / `symlink_metadata`.
(`stat`/`lstat` exist only on the low-level `RawSftpSession`, `src/client/rawsession.rs:637` / `:450`,
usable via `RawSftpSession::new<S>(stream) -> Self` `:201`, `pub type SftpResult<T> = Result<T, Error>` `:34`.)

`SftpResult<T>` = `russh_sftp::client::rawsession::SftpResult<T>` = `Result<T, russh_sftp::client::error::Error>`
(`Error` variants: `Status(Status)`, `IO(String)`, `Timeout`, `Limited(String)`, `UnexpectedPacket`,
`UnexpectedBehavior(String)` — `src/client/error.rs:9-29`).

`Config` here is **`russh_sftp::client::Config`** (different type from `russh::client::Config`; name clash if both are glob-imported):

```rust
// src/client/mod.rs:31-55
#[derive(Clone, Debug)]
pub struct Config {
    pub max_packet_len: u32,            // 262144
    pub max_concurrent_reads: usize,    // 16
    pub max_concurrent_writes: usize,   // 16
    pub max_write_packet_len: u32,      // 32768
    pub request_timeout_secs: u64,      // 10
}
```

`OpenFlags` (`src/protocol/open.rs:8-19`, `bitflags`): `READ 0x01, WRITE 0x02, APPEND 0x04, CREATE 0x08, TRUNCATE 0x10, EXCLUDE 0x20`.

### 5.2 `DirEntry` / `ReadDir` (`src/client/fs/dir.rs`)

```rust
#[derive(Debug)] pub struct DirEntry { /* parent: Arc<str>, file: String, metadata: Metadata */ }  // :8
impl DirEntry {
    pub fn file_name(&self) -> String;          // :16   owned String, not &str / OsString
    pub fn file_type(&self) -> FileType;        // :21
    pub fn metadata(&self) -> Metadata;         // :26   owned clone
    pub fn path(&self) -> String;               // :38   parent + "/" + name (POSIX join, no canonicalize)
}
pub struct ReadDir { /* VecDeque<(String, Metadata)> */ }                                    // :50
impl Iterator for ReadDir { type Item = DirEntry; }                                           // :55
//   ^ it skips "." and ".." itself (:61) and is NOT async; it never returns Err per item.
```

### 5.3 `Metadata` = `FileAttributes` (`src/client/fs/mod.rs:13` `pub type Metadata = FileAttributes;`)

```rust
// src/protocol/file_attrs.rs:192-202
#[derive(Debug, Default, Clone)]
pub struct FileAttributes {
    pub size: Option<u64>, pub uid: Option<u32>, pub user: Option<String>,
    pub gid: Option<u32>,  pub group: Option<String>, pub permissions: Option<u32>,
    pub atime: Option<u32>, pub mtime: Option<u32>,   // unix seconds, u32
}
impl FileAttributes {
    pub fn is_dir(&self) -> bool;          // :227
    pub fn is_regular(&self) -> bool;      // :228   <-- "is file" is `is_regular()`, there is no `is_file()`
    pub fn is_symlink(&self) -> bool;      // :229
    pub fn is_character(&self) -> bool;    // :230
    pub fn is_block(&self) -> bool;        // :231
    pub fn is_fifo(&self) -> bool;         // :232
    pub fn file_type(&self) -> FileType;   // :247
    pub fn is_empty(&self) -> bool;        // :252
    pub fn len(&self) -> u64;              // :257   size.unwrap_or(0)
    pub fn permissions(&self) -> FilePermissions;   // :262
    pub fn accessed(&self) -> std::io::Result<SystemTime>;   // :267
    pub fn modified(&self) -> std::io::Result<SystemTime>;   // :275  Err(InvalidData) when mtime is None
    pub fn empty() -> Self;  pub fn dummy() -> Self;
}
// FileType (same file :59-87): is_dir(), is_file(), is_symlink(), is_other()
```

### 5.4 `File` (`src/client/fs/file.rs`) — implements tokio's `AsyncRead` + `AsyncWrite` + `AsyncSeek`

```rust
pub struct File { /* session, handle, state, pos, closed, features */ }          // :164
impl File {
    pub async fn metadata(&self) -> SftpResult<Metadata>;                        // :195  (fstat)
    pub async fn set_metadata(&self, metadata: Metadata) -> SftpResult<()>;      // :200
    pub async fn sync_all(&self) -> SftpResult<()>;                              // :211  no-op if server lacks fsync@openssh.com
    pub async fn close(mut self) -> io::Result<()>;                              // :222  CONSUMES self; awaits pending writes
}
impl AsyncRead  for File { .. }   // :282
impl AsyncSeek  for File { .. }   // :299
impl AsyncWrite for File { .. }   // :358   (poll_write pipelines up to max_concurrent_writes)
impl Drop       for File { .. }   // :272   best-effort close_nowait if not closed
```

There is no `SftpSession::read_to_end`; use `AsyncReadExt::read_to_end(&mut file)`, `read_to_string`,
`file.rewind()`, `file.stream_position()`, `AsyncWriteExt::write_all`, `flush`, `shutdown` (all ✅ compiled).

✅ Compiled end-to-end SFTP snippet (subsystem → typed calls → whole-file read → chunked write):

```rust
use russh::client::{self, Handle};
use russh_sftp::client::fs::Metadata;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn sftp(session: &mut Handle<Client>) -> anyhow::Result<()> {
    let channel = session.channel_open_session().await?;
    channel.request_subsystem(true, "sftp").await?;          // MUST be before SftpSession::new
    let sftp = SftpSession::new(channel.into_stream()).await?;

    let cwd: String = sftp.canonicalize(".").await?;
    println!("cwd = {cwd}");

    for entry in sftp.read_dir("/tmp").await? {              // ReadDir: Iterator<Item = DirEntry>
        let name: String = entry.file_name();
        let path: String = entry.path();
        let md: Metadata = entry.metadata();
        println!("{name} {path} dir={} file={} link={} size={} mtime={:?}",
                 md.is_dir(), md.is_regular(), md.is_symlink(), md.len(), md.modified());
    }

    if sftp.try_exists("/tmp/f").await? {
        let mut f = sftp.open("/tmp/f").await?;              // READ
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).await?;
        f.close().await?;                                     // consumes f

        let mut out = sftp.create("/tmp/g").await?;           // CREATE|TRUNCATE|WRITE
        for chunk in buf.chunks(32 * 1024) { out.write_all(chunk).await?; }
        out.sync_all().await?;
        out.shutdown().await?;                                // = close
    }

    let mut rw = sftp
        .open_with_flags("/tmp/h", OpenFlags::CREATE | OpenFlags::WRITE | OpenFlags::TRUNCATE | OpenFlags::READ)
        .await?;
    rw.write_all(b"x").await?;
    let _md: Metadata = rw.metadata().await?;
    rw.close().await?;

    sftp.create_dir("/tmp/d").await?;
    sftp.rename("/tmp/d", "/tmp/e").await?;
    sftp.remove_file("/tmp/h").await?;
    sftp.remove_dir("/tmp/e").await?;
    sftp.close().await?;
    Ok(())
}
```

`SftpSession` is `Send + Sync` (asserted) → `Arc<SftpSession>` shared across tasks compiles ✅ (calls are `&self`).
`Metadata`, `DirEntry`, `ReadDir` are `Send`.

---

## 6. Feature flags / re-exports / compatibility (summary)

| Question | Answer | Evidence |
|---|---|---|
| russh default crypto backend | **`aws-lc-rs`** (needs cmake+nasm on Windows) | `Cargo.toml:39-43` |
| cmake/nasm-free build | `default-features = false, features = ["ring","rsa"]` | ✅ compiled 39 s, no cmake/nasm |
| Is a backend mandatory? | yes, `compile_error!` otherwise | `src/lib.rs:90-93` |
| Does russh re-export `ssh_key`? | yes, as **`russh::keys::ssh_key`** (also `keys::{PublicKey, PrivateKey, HashAlg, Algorithm, Certificate, PublicKeyOrCertificate}`); **not** `russh::ssh_key` | `src/keys/mod.rs:74-78, 89` |
| Does russh re-export `russh_sftp`? | **no.** Separate crate, and it has **no** dependency on russh → no version coupling | `russh-sftp/Cargo.toml:54-117` |
| `russh_sftp::client::SftpSession`? | yes (`pub use session::SftpSession;`); no root re-export | `src/client/mod.rs:10`, `src/lib.rs:24-36` |
| Does russh-sftp need tokio? | yes, hard dep; API is tokio `AsyncRead/AsyncWrite` based | `Cargo.toml:84-93`, `session.rs:2,38-40` |
| Features needed by russh-sftp? | none | `Cargo.toml:34-35` |
| MSRV | russh: 1.89 (edition 2024); russh-sftp: edition 2021 | `Cargo.toml:13-14` |
| Compatible with each other? | yes; verified by compiling both together | scratch crate build |

---

## 7. `russh-0.65.0/examples/` — ground truth

Files: `client_exec_interactive.rs`, `client_exec_simple.rs`, `client_open_direct_tcpip.rs`, `echoserver.rs`,
`echoserver_certificates.rs`, `ratatui_app.rs`, `ratatui_shared_app.rs`, `sftp_client.rs`, `sftp_server.rs`, `test.rs`.

> ⚠️ Note: russh 0.65's *own* `sftp_client.rs` example is built against its dev-dependency **russh-sftp 2.3.0**
> (`Cargo.toml:448-449`), not 3.0.1. The calls it uses happen to exist in 3.0.1 as well (verified by compiling
> them), but treat `russh-sftp-3.0.1/examples/client.rs` as the authority for sftp.

### `examples/client_exec_simple.rs` (full text)

```rust
use std::borrow::Cow;
///
/// Run this example with:
/// cargo run --example client_exec_simple -- -k <private key path> <host> <command>
///
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use clap::Parser;
use log::info;
use russh::keys::*;
use russh::*;
use tokio::io::AsyncWriteExt;
use tokio::net::ToSocketAddrs;

#[tokio::main]
async fn main() -> Result<()> {
    env_logger::builder()
        .filter_level(log::LevelFilter::Debug)
        .init();

    // CLI options are defined later in this file
    let cli = Cli::parse();

    info!("Connecting to {}:{}", cli.host, cli.port);
    info!("Key path: {:?}", cli.private_key);
    info!("OpenSSH Certificate path: {:?}", cli.openssh_certificate);

    // Session is a wrapper around a russh client, defined down below
    let mut ssh = Session::connect(
        cli.private_key,
        cli.username.unwrap_or("root".to_string()),
        cli.openssh_certificate,
        (cli.host, cli.port),
    )
    .await?;
    info!("Connected");

    let code = ssh
        .call(
            &cli.command
                .into_iter()
                .map(|x| shell_escape::escape(x.into())) // arguments are escaped manually since the SSH protocol doesn't support quoting
                .collect::<Vec<_>>()
                .join(" "),
        )
        .await?;

    println!("Exitcode: {code:?}");
    ssh.close().await?;
    Ok(())
}

struct Client {}

// More SSH event handlers
// can be defined in this trait
// In this example, we're only using Channel, so these aren't needed.
impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// This struct is a convenience wrapper
/// around a russh client
pub struct Session {
    session: client::Handle<Client>,
}

impl Session {
    async fn connect<P: AsRef<Path>, A: ToSocketAddrs>(
        key_path: P,
        user: impl Into<String>,
        openssh_cert_path: Option<P>,
        addrs: A,
    ) -> Result<Self> {
        let key_pair = load_secret_key(key_path, None)?;

        // load ssh certificate
        let mut openssh_cert = None;
        if openssh_cert_path.is_some() {
            openssh_cert = Some(load_openssh_certificate(openssh_cert_path.unwrap())?);
        }

        let config = client::Config {
            inactivity_timeout: Some(Duration::from_secs(5)),
            preferred: Preferred {
                kex: Cow::Owned(vec![
                    russh::kex::CURVE25519_PRE_RFC_8731,
                    russh::kex::EXTENSION_SUPPORT_AS_CLIENT,
                ]),
                ..Default::default()
            },
            ..<_>::default()
        };

        let config = Arc::new(config);
        let sh = Client {};

        let mut session = client::connect(config, addrs, sh).await?;
        // use publickey authentication, with or without certificate
        if openssh_cert.is_none() {
            let auth_res = session
                .authenticate_publickey(
                    user,
                    PrivateKeyWithHashAlg::new(
                        Arc::new(key_pair),
                        session.best_supported_rsa_hash().await?.flatten(),
                    ),
                )
                .await?;

            if !auth_res.success() {
                anyhow::bail!("Authentication (with publickey) failed");
            }
        } else {
            let auth_res = session
                .authenticate_openssh_cert(user, Arc::new(key_pair), openssh_cert.unwrap())
                .await?;

            if !auth_res.success() {
                anyhow::bail!("Authentication (with publickey+cert) failed");
            }
        }

        Ok(Self { session })
    }

    async fn call(&mut self, command: &str) -> Result<u32> {
        let mut channel = self.session.channel_open_session().await?;
        channel.exec(true, command).await?;

        let mut code = None;
        let mut stdout = tokio::io::stdout();

        loop {
            // There's an event available on the session channel
            let Some(msg) = channel.wait().await else {
                break;
            };
            match msg {
                // Write data to the terminal
                ChannelMsg::Data { ref data } => {
                    stdout.write_all(data).await?;
                    stdout.flush().await?;
                }
                // The command has returned an exit code
                ChannelMsg::ExitStatus { exit_status } => {
                    code = Some(exit_status);
                    // cannot leave the loop immediately, there might still be more data to receive
                }
                _ => {}
            }
        }
        Ok(code.expect("program did not exit cleanly"))
    }

    async fn close(&mut self) -> Result<()> {
        self.session
            .disconnect(Disconnect::ByApplication, "", "English")
            .await?;
        Ok(())
    }
}

#[derive(clap::Parser)]
#[clap(trailing_var_arg = true)]
pub struct Cli {
    #[clap(index = 1)]
    host: String,

    #[clap(long, short, default_value_t = 22)]
    port: u16,

    #[clap(long, short)]
    username: Option<String>,

    #[clap(long, short = 'k')]
    private_key: PathBuf,

    #[clap(long, short = 'o')]
    openssh_certificate: Option<PathBuf>,

    #[clap(index = 2, required = true)]
    command: Vec<String>,
}
```

### `examples/sftp_client.rs` (full text) — note: examples' dev-dep is russh-sftp **2.3.0**

```rust
use std::sync::Arc;

use log::{LevelFilter, error, info};
use russh::keys::*;
use russh::*;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

struct Client;

impl client::Handler for Client {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        info!("check_server_key: {server_public_key:?}");
        Ok(true)
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        info!("data on channel {:?}: {}", channel, data.len());
        Ok(())
    }
}

#[tokio::main]
async fn main() {
    env_logger::builder()
        .filter_level(LevelFilter::Debug)
        .init();

    let config = russh::client::Config::default();
    let sh = Client {};
    let mut session = russh::client::connect(Arc::new(config), ("localhost", 22), sh)
        .await
        .unwrap();
    if session
        .authenticate_password("root", "password")
        .await
        .unwrap()
        .success()
    {
        let channel = session.channel_open_session().await.unwrap();
        channel.request_subsystem(true, "sftp").await.unwrap();
        let sftp = SftpSession::new(channel.into_stream()).await.unwrap();
        info!("current path: {:?}", sftp.canonicalize(".").await.unwrap());

        // create dir and symlink
        let path = "./some_kind_of_dir";
        let symlink = "./symlink";

        sftp.create_dir(path).await.unwrap();
        sftp.symlink(path, symlink).await.unwrap();

        info!("dir info: {:?}", sftp.metadata(path).await.unwrap());
        info!(
            "symlink info: {:?}",
            sftp.symlink_metadata(path).await.unwrap()
        );

        // scanning directory
        for entry in sftp.read_dir(".").await.unwrap() {
            info!("file in directory: {:?}", entry.file_name());
        }

        sftp.remove_file(symlink).await.unwrap();
        sftp.remove_dir(path).await.unwrap();

        // interaction with i/o
        let filename = "test_new.txt";
        let mut file = sftp
            .open_with_flags(
                filename,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE | OpenFlags::READ,
            )
            .await
            .unwrap();
        info!("metadata by handle: {:?}", file.metadata().await.unwrap());

        file.write_all(b"magic text").await.unwrap();
        info!("flush: {:?}", file.flush().await); // or file.sync_all()
        info!(
            "current cursor position: {:?}",
            file.stream_position().await
        );

        let mut str = String::new();

        file.rewind().await.unwrap();
        file.read_to_string(&mut str).await.unwrap();
        file.rewind().await.unwrap();

        info!(
            "our magical contents: {}, after rewind: {:?}",
            str,
            file.stream_position().await
        );

        file.shutdown().await.unwrap();
        sftp.remove_file(filename).await.unwrap();

        // should fail because handle was closed
        error!("should fail: {:?}", file.read_u8().await);
    }
}
```

### `examples/client_exec_interactive.rs` (key parts; full file is 231 lines)

PTY + shell-less exec loop (`:139-201`) — note `channel.data(&buf[..n])` and `Some(msg) = channel.wait()`
inside `tokio::select!`:

```rust
let mut channel = self.session.channel_open_session().await?;
let (w, h) = termion::terminal_size()?;
channel
    .request_pty(false, &env::var("TERM").unwrap_or("xterm".into()), w as u32, h as u32, 0, 0, &[])
    .await?;
channel.exec(true, command).await?;

loop {
    tokio::select! {
        r = stdin.read(&mut buf), if !stdin_closed => {
            match r {
                Ok(0) => { stdin_closed = true; channel.eof().await?; },
                Ok(n) => channel.data(&buf[..n]).await?,      // &[u8] : AsyncRead
                Err(e) => return Err(e.into()),
            };
        },
        Some(msg) = channel.wait() => {
            match msg {
                ChannelMsg::Data { ref data } => { stdout.write_all(data).await?; stdout.flush().await?; },
                ChannelMsg::ExitStatus { exit_status } => { code = exit_status; if !stdin_closed { channel.eof().await?; } break; },
                _ => {}
            }
        },
    }
}
```

### `examples/client_open_direct_tcpip.rs` (key part, `:135-143`)

```rust
let mut channel = self.session
    .channel_open_direct_tcpip(
        forward_addr.ip().to_string(),
        forward_addr.port().into(),          // u32
        originator_addr.ip().to_string(),
        originator_addr.port().into(),       // u32
    ).await?;
```

---

## 8. Gotchas / deltas vs. russh 0.40–0.50 (the stuff that breaks copy-pasted tutorial code)

1. **`Handle` is no longer `Clone`** (compiler-proven `E0599`; `src/client/mod.rs:316` + `Drop` at `:324`).
   Every 0.40–0.50 tutorial that does `let handle = session.handle();` or `session.clone()` will not compile.
   Use `Arc<Handle<H>>` — `Handle` is `Send + Sync` and all channel-openers take `&self`. But note
   `authenticate_*` take `&mut self`, so authenticate **before** wrapping in `Arc`.
2. **`client::Config` is no longer `Clone`** either (`#[derive(Debug)]` only, `:2722`); `connect` wants
   `Arc<Config>` so build it once.
3. **`check_server_key` signature changed twice over**: parameter is
   `&russh::keys::PublicKeyOrCertificate` (an enum), **not** `&ssh_key::PublicKey`. There is no `&mut Session`
   argument. Call `.public_key()` to get the `ssh_key::PublicKey`.
4. **The `Handler` trait is a native async-fn trait.** Do **not** add `#[async_trait]` (and `async-trait` is not
   even a dependency of russh 0.65). Write plain `async fn check_server_key(...)`. Every method returns
   `impl Future<...> + Send`; `adjust_window` is the one synchronous method.
5. **`Channel::data` changed shape**: it was `data(&mut self, &[u8])`, now `data(&self, impl AsyncRead + Unpin)`
   plus `data_bytes(impl Into<Bytes>)`. Old calls `channel.data(&buf[..n])` still compile (`&[u8]: AsyncRead`)
   and still send exactly `n` bytes — but a `Vec<u8>` **does not** implement `AsyncRead`; use
   `data_bytes(vec)` / `data_bytes(Bytes::from(vec))` for owned buffers (zero-copy).
6. **`Channel` is not an `AsyncWrite`.** Use `make_writer()` (borrows, `'static`), `make_writer_ext(Some(1))`
   for stderr, or `into_stream()` (consumes, bidirectional).
7. **`ChannelMsg` is `#[non_exhaustive]`** → every `match` needs a `_ =>` arm. `Data { data }` is
   `bytes::Bytes`, not `Vec<u8>`/`CryptoVec`; use `&data[..]` or `data.as_ref()`.
8. **`request_pty_size` does not exist**; the resize call is `window_change(cols, rows, pix_w, pix_h)`.
   `request_pty` takes `term: &str` and `terminal_modes: &[(Pty, u32)]` (pass `&[]`), all sizes `u32`.
9. `Channel::wait` still takes `&mut self` (that's why the examples keep `let mut channel`), even though the
   write methods only need `&self`.
10. **`russh::ssh_key` does not exist** — the path is `russh::keys::ssh_key` (or the flat re-exports
    `russh::keys::{PublicKey, HashAlg, Algorithm, Certificate, PrivateKey}`).
11. **`Fingerprint` has no `Default`** (compile-proven `E0277`); `HashAlg` does (`Sha256`). Use
    `pk.fingerprint(HashAlg::Sha256)`; `Display` yields `SHA256:<unpadded base64>` exactly like OpenSSH.
12. **`Connect` error type is `H::Error`, not `russh::Error`** — pick `type Error = russh::Error` (or
    `anyhow::Error`) once and everything (`?`) lines up.
13. **russh-sftp path args are `impl Into<String>`** — `&Path`/`PathBuf` do **not** work. Convert:
    `p.to_string_lossy().into_owned()` (Windows `\` separators are *not* translated; the server is POSIX —
    build remote paths with `/`).
14. **`SftpSession::read_dir` returns `ReadDir`, a lazy `Iterator<Item = DirEntry>`** (not a `Vec`, not a
    `Result` per entry, not `async`). `let v: Vec<_> = sftp.read_dir(p).await?;` fails — add `.collect()`.
    It filters `.` and `..` for you.
15. **`SftpSession` has no `stat`/`lstat`** — use `metadata()` (stat) and `symlink_metadata()` (lstat).
    `Metadata` is a type alias for `FileAttributes`; to test "is a file" use **`is_regular()`**, not `is_file()`.
    `modified()` returns `std::io::Result<SystemTime>` (error when the server omits `mtime`), *not* `Option`.
16. `File::close()` **consumes** `self` and returns `io::Result<()>`; `File` also has a `Drop` that fires a
    best-effort async close — so don't rely on `Drop` for durability, call `sync_all()`/`close()`.
    `File::sync_all()` is a silent no-op when the server lacks `fsync@openssh.com`.
17. Two different `Config` types (`russh::client::Config` vs `russh_sftp::client::Config`) — don't glob-import both.
18. `russh` requires the `ring`/`aws-lc-rs` feature *or it won't compile at all*; the default (`aws-lc-rs`)
    pulls in cmake+nasm on Windows. Disable default features.
19. Session liveness: `Handle::is_closed()` + `impl Future for Handle` are the supported ways to notice/join a
    dead connection; a closed session makes `authenticate_*` return `Ok(Failure)` rather than `Err`.
