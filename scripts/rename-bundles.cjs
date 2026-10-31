/*
 * 把 tauri build 产出的安装包改成纯 ASCII 文件名，避免七牛 / 浏览器
 * 处理中文文件名时的编码问题：
 *
 *   Windows: 悦盒_0.1.1_x64-setup.exe  ->  yooso_box_0.1.1_x64-setup.exe
 *   macOS  : 悦盒_0.1.1_aarch64.dmg    ->  yooso_box_0.1.1.dmg
 *
 * 用法：npm run tauri:build（打包后自动执行）
 *       或打完包后单独执行 npm run rename:bundles
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const config = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8")
);
const version = config.version;
const bundleDir = path.join(root, "src-tauri", "target", "release", "bundle");

const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

function move(dir, from, to) {
  const source = path.join(dir, from);
  const target = path.join(dir, to);
  if (source === target) return false;
  fs.rmSync(target, { force: true });
  fs.renameSync(source, target);
  console.log(`  ${from}  ->  ${to}`);
  return true;
}

let renamed = 0;
const versionPattern = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Windows：NSIS 安装包（只处理本次版本，避免把历史版本的包也改名覆盖）
const nsisDir = path.join(bundleDir, "nsis");
const nsisPattern = new RegExp(`_${versionPattern}_(x64|arm64|ia32)-setup\\.exe$`, "i");
for (const file of list(nsisDir)) {
  const match = file.match(nsisPattern);
  if (!match) continue;
  const arch = match[1].toLowerCase();
  if (move(nsisDir, file, `yooso_box_${version}_${arch}-setup.exe`)) renamed += 1;
}

// macOS：dmg。正常只会有一个；如果同时打了两个架构，保留架构后缀避免覆盖
const dmgDir = path.join(bundleDir, "dmg");
const dmgPattern = new RegExp(`_${versionPattern}_(x64|aarch64|arm64|universal)\\.dmg$`, "i");
const dmgs = list(dmgDir).filter((file) => /\.dmg$/i.test(file));
for (const file of dmgs) {
  const match = file.match(dmgPattern);
  if (!match) continue;
  const arch = match[1].toLowerCase();
  const suffix = dmgs.length > 1 ? `_${arch}` : "";
  if (move(dmgDir, file, `yooso_box_${version}${suffix}.dmg`)) renamed += 1;
}

if (renamed === 0) {
  console.log("没有找到需要改名的安装包（先执行 tauri build）");
} else {
  console.log(`已改名 ${renamed} 个安装包，版本 ${version}`);
}
