/*
 * 跨平台入口：调用 scripts/make_icons.py 生成全平台应用图标。
 * 这样 `npm run icons` 在 Windows / macOS 上都能直接用。
 *
 * 图标已经提交在 src-tauri/icons 下，只有改 logo 时才需要重新生成。
 */
const { spawnSync } = require("child_process");
const path = require("path");

const script = path.join(__dirname, "make_icons.py");
const candidates =
  process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
const tried = [];

for (const bin of candidates) {
  // 先确认能 import PIL（Windows 的 python.exe 有时只是应用商店占位符）
  const probe = spawnSync(bin, ["-c", "import PIL"], { stdio: "ignore" });
  if (probe.error || probe.status !== 0) {
    tried.push(bin);
    continue;
  }
  const run = spawnSync(bin, [script], { stdio: "inherit" });
  process.exit(run.status === null ? 1 : run.status);
}

console.error(
  [
    "未找到装有 Pillow 的 Python（已尝试：" + tried.join(", ") + "）。",
    "",
    "图标已提交在 src-tauri/icons 下，日常打包不需要重新生成；",
    "只有修改 logo 时才需要：",
    "  1. 安装 Python 3：https://www.python.org/downloads/",
    "  2. pip install pillow",
    "  3. npm run icons",
  ].join("\n")
);
process.exit(1);
