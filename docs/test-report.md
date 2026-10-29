# SSH / SFTP 功能测试报告

- 版本：Yooso Toolbox 0.1.0（本次为 `tauri build --no-bundle` 的 release exe，未打安装包）
- 测试时间：2026-10-30
- 目标服务器：阿里云 CentOS，`203.0.113.10:22`，OpenSSH 8.0，root 密码登录
- 主机指纹：`<host-key-fingerprint>`
- 界面截图目录：[docs/uitest](uitest/)

---

## 一、后端集成测试（cargo test）

命令：

```powershell
$env:TEST_SSH_HOST="203.0.113.10"; $env:TEST_SSH_USER="root"; $env:TEST_SSH_PASSWORD="..."
cargo test -- --include-ignored --nocapture --test-threads=1
```

### 1. 单元测试（不联网，5 项全通过）

| 用例 | 覆盖内容 | 结果 |
|---|---|---|
| `display_name_rules` | 进程名补全规则：绝对路径 basename 优先、argv 被改写时回落 comm | ✅ |
| `elapsed_parser_works` | `ps` 的 `etime`（`42` / `05:10` / `01:05:10` / `3-01:05:10`）解析 | ✅ |
| `shell_cwd_parser_works` | `/proc` cwd 输出解析（含空白、空输出） | ✅ |
| `metrics_parser_works` | 监控采样解析：CPU 两次取样算 25%、内存/磁盘 kB→B、网卡求和 | ✅ |
| `process_parser_works` | 进程解析：内存倒序、自身进程过滤、启动时间换算 | ✅ |

> 说明：`process_parser_works` 第一次跑失败，是我把测试样本的期望值写错了（忘了 `systemd` 的 12 MB 会排在第一位），修正断言后通过——不是产品缺陷。

### 2. 集成测试 `remote_features_smoke`（真实服务器）

一条连接上依次验证：

| # | 验证点 | 实测结果 |
|---|---|---|
| 1 | 密码认证 + 主机指纹记录 | ✅ `method=password`，指纹与预期一致 |
| 2 | 交互式 shell 回显 | ✅ `echo YOOSO_CMD_$((6*7))` → `YOOSO_CMD_42` |
| 3 | 跟随终端目录 | ✅ 初始 `/root`；`cd /tmp` 后读到 `/tmp` |
| 4 | 系统监控采样 | ✅ CPU 3.8% / 2 核；内存 2.47 GB / 3.74 GB；磁盘 18.5 GB / 41.9 GB；网卡 rx/tx 累计值 |
| 4b | 两次采样单调性 | ✅ 网卡累计计数未倒退 |
| 5 | 进程列表 | ✅ 109 条，按内存倒序，自身进程被过滤 |
| 6 | 结束进程 | ✅ `kill -TERM 3044337` 返回 0，随后 `kill -0` 失败（进程已退出） |
| 7 | SFTP 主目录列举 | ✅ `/root` 28 项 |
| 7b | 新建目录 | ✅ `/root/yooso-test-<id>` 出现在列表中 |
| 7c | 上传文件 | ✅ 32 字节，远端 size 一致 |
| 7d | 下载回环 | ✅ 内容逐字节比对一致 |
| 7e | 重命名 | ✅ `upload.txt → renamed.txt` |
| 7f | 同目录复制 | ✅ 生成 `renamed.txt - 副本` |
| 7g | 递归删除 | ✅ 目录从列表消失 |

### 3. 集成测试 `ssh_sftp_smoke`（既有用例）

| 验证点 | 实测结果 |
|---|---|
| 认证 + 主机密钥 | ✅ |
| 终端回显 | ✅ `YOOSO_SMOKE_2` |
| SFTP 列目录 | ✅ 28 项 |
| 上传 + 下载回环 | ✅ 30 字节一致 |
| 传输进度事件 | ✅ 收到 |
| **目录上传（本地 tar.gz + 远端解压）** | ✅ `["a.txt", "sub"]`，子目录 `b.txt` 完整 |
| **目录复制（`cp -a`）** | ✅ 生成 `... - 副本`，内容完整 |

---

## 二、界面端到端测试（截图见 `docs/uitest/`）

| # | 操作 | 结果 | 截图 |
|---|---|---|---|
| 1 | 点击会话卡片连接 | ✅ 终端出现 banner、`✔ 已连接`、状态栏指标立即显示 | `02-terminal.png` |
| 2 | 终端粘贴并执行 `echo UI_TEST_$((5*8)); uname -sr` | ✅ 输出 `UI_TEST_40` 与 `Linux 5.10.134-18.al8.x86_64` | `02-terminal.png` |
| 3 | `cd /etc` 后打开 SFTP | ✅ 面板显示 `/etc`（跟随生效） | `03-sftp-open.png` |
| 4 | 点击「复制路径」 | ✅ 提示「路径已复制」 | `04-copy-path.png` |
| 5 | 终端 `cd /var` | ✅ 面板自动跳到 `/var`，列表刷新 | `05-follow-cwd.png` |
| 6 | 列表空白处右键 | ✅ 菜单左下角贴鼠标弹出（粘贴/新建文件夹/上传文件/上传文件夹/刷新） | `06-context-menu.png` |
| 7 | 「新建文件夹」→ 输入 `uitest-dir` → 确定 | ✅ 提示「文件夹已创建」，列表出现该目录 | `07-mkdir-typed.png` / `08-mkdir-done.png` |
| 8 | 滚动到该目录 → 右键 | ✅ 行菜单：下载 / 复制 / 重命名 / 删除 | `10-row-menu.png` |
| 9 | 重命名 → `renamed-dir` → 确定 | ✅ 提示「重命名成功」；终端 `ls -d /var/renamed-dir` 确认存在 | `12b` / `13` / `15-rename-verified.png` |
| 10 | 右键系统目录 `opt` → 删除 | ✅ 弹出「删除文件夹 / 确认删除「opt」？文件夹会被递归删除」，点取消未执行 | `17-delete-confirm.png` |
| 11 | 点状态栏图表图标 | ✅ 进程管理器打开，109 个进程，默认内存倒序 | `18-process-modal.png` |
| 12 | 搜索框输入 `sshd` | ✅ `匹配 3 / 共 108 个进程`，仅剩 3 条 sshd | `19-process-search.png` |
| 13 | 关闭弹窗 / 面板 | ✅ 终端恢复全高，指标继续刷新 | `20-closed.png` |

---

## 三、未覆盖 / 建议

以下路径本次没有自动化（依赖系统原生对话框或需要真实拖拽）：

1. **上传/下载的 GUI 流程**：`上传文件`、`上传文件夹`、双击下载都会弹 Windows 原生文件对话框，自动化点击不可靠。该链路的底层（`sftp::upload_path` / `download_file` / `copy_path`）已由集成测试覆盖。
2. **拖拽上传**：需要真实 OS 级拖放事件，未覆盖；同一底层函数已验证。
3. **密钥登录**：本次只测了密码登录。密钥分支需要测试机上放一个私钥并配置 `authorized_keys`。
4. **弱网 / 断线重连**：未模拟网络中断；重连按钮的 UI 存在，逻辑为重建终端与连接。
