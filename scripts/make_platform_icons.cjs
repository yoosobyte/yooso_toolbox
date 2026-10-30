/*
 * Build platform-specific app icons from app-icon.png.
 * macOS uses ~80% content inside a 1024 canvas (Apple icon grid),
 * Windows uses ~92% content so the taskbar icon doesn't look oversized.
 *
 * Requires pngjs (already a Tauri CLI transitive dependency).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { PNG } = require("pngjs");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "app-icon.png");
const work = path.join(root, ".icon-build");
const iconsDir = path.join(root, "src-tauri", "icons");

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

function sipsResize(input, output, size) {
  execFileSync("sips", ["-z", String(size), String(size), input, "--out", output], {
    stdio: "ignore",
  });
}

function composePadded(input, output, contentSize, canvasSize) {
  const src = PNG.sync.read(fs.readFileSync(input));
  const dst = new PNG({ width: canvasSize, height: canvasSize });
  dst.data.fill(0);
  const x = Math.floor((canvasSize - contentSize) / 2);
  const y = Math.floor((canvasSize - contentSize) / 2);
  for (let row = 0; row < src.height; row++) {
    const sourceStart = row * src.width * 4;
    const targetStart = ((y + row) * canvasSize + x) * 4;
    src.data.copy(dst.data, targetStart, sourceStart, sourceStart + src.width * 4);
  }
  fs.writeFileSync(output, PNG.sync.write(dst));
}

function makeSource(name, contentSize) {
  const resized = path.join(work, `${name}-content.png`);
  const padded = path.join(work, `${name}-1024.png`);
  sipsResize(source, resized, contentSize);
  composePadded(resized, padded, contentSize, 1024);
  return padded;
}

function makeIcns(macSource) {
  const iconset = path.join(work, "icon.iconset");
  fs.mkdirSync(iconset, { recursive: true });
  const entries = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  for (const [size, name] of entries) {
    sipsResize(macSource, path.join(iconset, name), size);
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(iconsDir, "icon.icns")], {
    stdio: "ignore",
  });
}

function makeIco(winSource) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = sizes.map((size) => {
    const file = path.join(work, `win-${size}.png`);
    sipsResize(winSource, file, size);
    return { size, data: fs.readFileSync(file) };
  });
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(images.length * 16);
  let offset = 6 + dir.length;
  images.forEach(({ size, data }, index) => {
    const entry = index * 16;
    dir.writeUInt8(size === 256 ? 0 : size, entry);
    dir.writeUInt8(size === 256 ? 0 : size, entry + 1);
    dir.writeUInt8(0, entry + 2);
    dir.writeUInt8(0, entry + 3);
    dir.writeUInt16LE(1, entry + 4);
    dir.writeUInt16LE(32, entry + 6);
    dir.writeUInt32LE(data.length, entry + 8);
    dir.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  fs.writeFileSync(path.join(iconsDir, "icon.ico"), Buffer.concat([header, dir, ...images.map((item) => item.data)]));
}

const macSource = makeSource("mac", 824);
const winSource = makeSource("win", 942);

makeIcns(macSource);
makeIco(winSource);

// PNG fallbacks (Linux / Windows taskbar) use the Windows proportion.
const pngSizes = [
  [32, "32x32.png"],
  [64, "64x64.png"],
  [128, "128x128.png"],
  [256, "128x128@2x.png"],
  [512, "icon.png"],
];
for (const [size, name] of pngSizes) {
  sipsResize(winSource, path.join(iconsDir, name), size);
}

// Keep the Windows Store square assets in sync with the Windows proportion.
const squareLogos = [
  [30, "Square30x30Logo.png"],
  [44, "Square44x44Logo.png"],
  [71, "Square71x71Logo.png"],
  [89, "Square89x89Logo.png"],
  [107, "Square107x107Logo.png"],
  [142, "Square142x142Logo.png"],
  [150, "Square150x150Logo.png"],
  [284, "Square284x284Logo.png"],
  [310, "Square310x310Logo.png"],
  [50, "StoreLogo.png"],
];
for (const [size, name] of squareLogos) {
  sipsResize(winSource, path.join(iconsDir, name), size);
}

console.log("wrote macOS icns (824/1024 content), Windows ico/png (942/1024 content)");
