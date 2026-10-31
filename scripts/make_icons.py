#!/usr/bin/env python3
"""生成「悦盒 / Yooso Toolbox」全平台应用图标。

设计稿见 ``src/AppLogo.tsx``：黑色圆角方块 + 白色立方体线稿。
脚本只用 Pillow，跨平台（Windows / macOS / Linux）可运行：

    python3 scripts/make_icons.py

产物：

* ``src-tauri/icons/icon.ico``    Windows（16/24/32/48/64/128/256，满画布）
* ``src-tauri/icons/icon.icns``   macOS（16…1024，按 Apple 图标网格缩进）
* ``src-tauri/icons/*.png``       各尺寸 PNG / Windows Store 方图
* ``src-tauri/icons/installer-header.bmp`` / ``installer-sidebar.bmp``
                                  NSIS 安装器页眉 / 侧栏品牌图
* ``app-icon.png``                1024×1024 母图（macOS 版式）

要点：Windows 桌面/任务栏图标本身不做任何外框缩放，所以内容必须铺满
画布（参考 IDEA / WebStorm 的 .ico 均为 100%）；macOS 应用图标由系统
按 1024 画布、824 见方的网格展示，内容需要留出约 8% 的透明边，否则
在 Dock 和 Finder 里会比别的 App 小一圈。
"""

from __future__ import annotations

import io
import os
import struct
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "src-tauri", "icons")

# ---- 版式参数 ---------------------------------------------------------
# macOS：Apple 的 1024 画布网格里图标主体是 824（80.5%），
# 这里取 0.82（含阴影后约 0.88），和「终端」等系统 App 的体量一致。
MAC_CONTENT = 0.82
# Windows：图标直接铺满画布，和 WebStorm / VS Code 等一致。
WIN_CONTENT = 1.0

# 设计稿（64×64 视图）里的立方体线稿
CUBE_PATHS = [
    [(32.0, 13.5), (50.5, 23.5), (32.0, 33.5), (13.5, 23.5)],
    [(13.5, 23.5), (13.5, 41.0), (32.0, 51.0), (32.0, 33.5)],
    [(50.5, 23.5), (50.5, 41.0), (32.0, 51.0)],
]
CUBE_STROKE = 2.3          # 64 视图下的线宽
CUBE_SCALE = 1.0


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _mix(c1, c2, t):
    return tuple(int(round(_lerp(a, b, t))) for a, b in zip(c1, c2))


def _vertical_gradient(width: int, height: int, stops) -> Image.Image:
    """stops: [(position 0..1, (r, g, b)), ...]，返回 RGB 渐变图。"""
    column = Image.new("RGB", (1, height))
    px = column.load()
    for y in range(height):
        t = y / max(height - 1, 1)
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                k = (t - p0) / (p1 - p0) if p1 > p0 else 0.0
                px[0, y] = _mix(c0, c1, k)
                break
        else:
            px[0, y] = stops[-1][1]
    return column.resize((width, height), Image.NEAREST)


def _rounded_mask(size: int, box, radius: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
    return mask


def _stroke_polyline(draw: ImageDraw.ImageDraw, points, width: float, closed: bool = False):
    pts = list(points) + ([points[0]] if closed else [])
    draw.line(pts, fill=255, width=max(1, int(round(width))), joint="curve")
    r = width / 2.0
    for x, y in pts:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=255)


def _render(size: int, content: float, shadow: bool) -> Image.Image:
    """按目标像素尺寸直接矢量绘制（超采样后缩小），保证小尺寸清晰。"""
    ss = max(2, min(8, 2048 // size))
    canvas = size * ss

    tile = canvas * content
    off = (canvas - tile) / 2.0
    box = [off, off, off + tile - 1, off + tile - 1]
    radius = tile * 0.2344

    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))

    # 阴影（仅 macOS）：App Store 风格需要一点景深
    if shadow:
        alpha = Image.new("L", (canvas, canvas), 0)
        ImageDraw.Draw(alpha).rounded_rectangle(
            [box[0], box[1] + canvas * 0.012, box[2], box[3] + canvas * 0.012],
            radius=radius,
            fill=90,
        )
        alpha = alpha.filter(ImageFilter.GaussianBlur(canvas * 0.018))
        shadow_layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        shadow_layer.putalpha(alpha)
        img = Image.alpha_composite(img, shadow_layer)

    # 主体：黑色圆角方块 + 自上而下的渐变
    mask = _rounded_mask(canvas, box, radius)
    grad = _vertical_gradient(
        canvas,
        canvas,
        [
            (0.0, (0x15, 0x15, 0x1B)),
            (0.55, (0x08, 0x08, 0x0B)),
            (1.0, (0x00, 0x00, 0x00)),
        ],
    )
    img.paste(grad, (0, 0), mask)

    # 顶部高光描边：1/64 ≈ 1.56% 的线宽
    stroke_w = max(1, int(round(tile * 0.0156)))
    edge_mask = Image.new("L", (canvas, canvas), 0)
    ImageDraw.Draw(edge_mask).rounded_rectangle(
        [off + stroke_w / 2, off + stroke_w / 2,
         off + tile - 1 - stroke_w / 2, off + tile - 1 - stroke_w / 2],
        radius=max(1.0, radius - stroke_w / 2),
        outline=255,
        width=stroke_w,
    )
    ramp = Image.new("L", (1, canvas))
    rpx = ramp.load()
    for y in range(canvas):
        t = y / max(canvas - 1, 1)
        if t < 0.16:
            a = int(round(_lerp(0.5, 0.03, t / 0.16) * 255))
        else:
            a = int(round(_lerp(0.03, 0.05, (t - 0.16) / 0.84) * 255))
        rpx[0, y] = a
    ramp = ramp.resize((canvas, canvas), Image.NEAREST)
    edge_alpha = ImageChops.multiply(edge_mask, ramp)
    edge = Image.new("RGBA", (canvas, canvas), (255, 255, 255, 255))
    edge.putalpha(edge_alpha)
    img = Image.alpha_composite(img, edge)

    # 立方体线稿：16/24/32px 用固定的细线宽并略微放大，避免笔画糊在一起
    if size <= 20:
        glyph, glow_on, width_px = 1.14, False, 1.1 * canvas / size
    elif size <= 32:
        glyph, glow_on, width_px = 1.02, False, 1.15 * canvas / size
    else:
        glyph, glow_on = CUBE_SCALE, True
        width_px = CUBE_STROKE / 64.0 * tile

    glyph_img = Image.new("L", (canvas, canvas), 0)
    gdraw = ImageDraw.Draw(glyph_img)
    cx = cy = 32.0

    def to_px(p):
        x = (cx + (p[0] - cx) * glyph) / 64.0 * tile + off
        y = (cy + (p[1] - cy) * glyph) / 64.0 * tile + off
        return (x, y)

    for index, path in enumerate(CUBE_PATHS):
        _stroke_polyline(gdraw, [to_px(p) for p in path], width_px, closed=(index == 0))

    # 线稿带一点点辉光，和设计稿一致（小尺寸不加，避免发糊）
    if glow_on:
        glow = glyph_img.filter(ImageFilter.GaussianBlur(canvas * 0.006))
        glow = glow.point(lambda v: int(v * 0.35))
        white = Image.new("RGBA", (canvas, canvas), (255, 255, 255, 255))
        white.putalpha(glow)
        img = Image.alpha_composite(img, white)

    white2 = Image.new("RGBA", (canvas, canvas), (255, 255, 255, 255))
    white2.putalpha(glyph_img)
    img = Image.alpha_composite(img, white2)

    return img.resize((size, size), Image.LANCZOS)


def render_windows(size: int) -> Image.Image:
    return _render(size, WIN_CONTENT, shadow=False)


def render_macos(size: int) -> Image.Image:
    return _render(size, MAC_CONTENT, shadow=True)


# ---- ICO 编码 ---------------------------------------------------------
def _png_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _bmp_bytes(img: Image.Image) -> bytes:
    """ICO 内的 32bpp DIB（高度翻倍 + AND 掩码），兼容性最好。"""
    w, h = img.size
    pixels = img.load()
    rows = []
    for y in range(h - 1, -1, -1):
        row = bytearray()
        for x in range(w):
            r, g, b, a = pixels[x, y]
            row += bytes((b, g, r, a))
        rows.append(bytes(row))
    xor = b"".join(rows)
    and_stride = ((w + 31) // 32) * 4
    and_rows = []
    for y in range(h - 1, -1, -1):
        bits = bytearray(and_stride)
        for x in range(w):
            if pixels[x, y][3] == 0:
                bits[x // 8] |= 0x80 >> (x % 8)
        and_rows.append(bytes(bits))
    and_mask = b"".join(and_rows)
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(xor) + len(and_mask), 0, 0, 0, 0)
    return header + xor + and_mask


def write_ico(path: str, sizes) -> None:
    frames = []
    for size in sizes:
        img = render_windows(size)
        data = _png_bytes(img) if size >= 128 else _bmp_bytes(img)
        frames.append((size, data))

    header = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    entries, blobs = [], []
    for size, data in frames:
        entries.append(
            struct.pack(
                "<BBBBHHII",
                0 if size >= 256 else size,
                0 if size >= 256 else size,
                0, 0, 1, 32, len(data), offset,
            )
        )
        blobs.append(data)
        offset += len(data)
    with open(path, "wb") as f:
        f.write(header + b"".join(entries) + b"".join(blobs))


# ---- ICNS 编码 --------------------------------------------------------
def write_icns(path: str, entries) -> None:
    """entries: [(icns 类型, 尺寸)]，全部使用 PNG 数据（macOS 10.7+ 支持）。"""
    chunks = []
    for kind, size in entries:
        data = _png_bytes(render_macos(size))
        chunks.append(kind + struct.pack(">I", len(data) + 8) + data)
    body = b"".join(chunks)
    with open(path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(body) + 8) + body)


# ---- NSIS 安装器图片 ---------------------------------------------------
def _font(size: int, bold: bool = False):
    candidates = [
        r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyh.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def _centered_text(draw: ImageDraw.ImageDraw, text: str, font, top: int, width: int, fill):
    left, _, right, _ = draw.textbbox((0, 0), text, font=font)
    draw.text(((width - (right - left)) / 2 - left, top), text, font=font, fill=fill)


def make_installer_header(path: str) -> None:
    """NSIS 页面右上角横幅：150×57，白色底，和 MUI 默认页眉融合。"""
    width, height = 150, 57
    img = Image.new("RGB", (width, height), (255, 255, 255))
    icon = render_windows(44)
    img.paste(icon, (5, 6), icon)
    draw = ImageDraw.Draw(img)
    draw.text((54, 7), "悦盒", font=_font(17, True), fill=(22, 22, 26))
    draw.text((54, 31), "YOOSO TOOLBOX", font=_font(8), fill=(133, 133, 143))
    img.save(path, format="BMP")


def make_installer_sidebar(path: str) -> None:
    """NSIS 欢迎/完成页左侧图：164×314，深色渐变 + 图标 + 产品名。"""
    width, height = 164, 314
    img = _vertical_gradient(width, height, [(0.0, (34, 34, 45)), (0.55, (18, 18, 24)), (1.0, (8, 8, 11))])
    icon = render_windows(96)
    img.paste(icon, ((width - 96) // 2, 42), icon)
    draw = ImageDraw.Draw(img)
    _centered_text(draw, "悦盒", _font(26, True), 166, width, (246, 246, 250))
    _centered_text(draw, "YOOSO TOOLBOX", _font(9), 205, width, (150, 150, 164))
    draw.line([(width / 2 - 22, 240), (width / 2 + 22, 240)], fill=(96, 96, 112), width=1)
    img.save(path, format="BMP")


def main() -> int:
    os.makedirs(ICONS, exist_ok=True)

    # Windows：16~256，满画布
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    write_ico(os.path.join(ICONS, "icon.ico"), ico_sizes)

    # macOS：标准 icns 槽位
    icns_entries = [
        (b"icp4", 16), (b"icp5", 32), (b"icp6", 64),
        (b"ic07", 128), (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024),
        (b"ic11", 32), (b"ic12", 64), (b"ic13", 256), (b"ic14", 512),
    ]
    write_icns(os.path.join(ICONS, "icon.icns"), icns_entries)

    # Linux / Windows 任务栏用的 PNG
    for size, name in [
        (32, "32x32.png"), (64, "64x64.png"), (128, "128x128.png"),
        (256, "128x128@2x.png"), (512, "icon.png"),
    ]:
        render_windows(size).save(os.path.join(ICONS, name))

    # Windows Store 方图
    for size, name in [
        (30, "Square30x30Logo.png"), (44, "Square44x44Logo.png"),
        (50, "StoreLogo.png"), (71, "Square71x71Logo.png"),
        (89, "Square89x89Logo.png"), (107, "Square107x107Logo.png"),
        (142, "Square142x142Logo.png"), (150, "Square150x150Logo.png"),
        (284, "Square284x284Logo.png"), (310, "Square310x310Logo.png"),
    ]:
        render_windows(size).save(os.path.join(ICONS, name))

    # 母图（macOS 版式，1024）
    render_macos(1024).save(os.path.join(ROOT, "app-icon.png"))

    # NSIS 安装器页眉 / 侧栏图（打包时由 tauri.conf.json 引用）
    make_installer_header(os.path.join(ICONS, "installer-header.bmp"))
    make_installer_sidebar(os.path.join(ICONS, "installer-sidebar.bmp"))

    # 自检：每种尺寸的实际内容占比
    for name, size in [("win 48", 48), ("win 256", 256), ("mac 1024", 1024)]:
        img = render_windows(size) if name.startswith("win") else render_macos(size)
        bbox = img.split()[3].getbbox()
        ratio = (bbox[2] - bbox[0]) / size
        print("%-9s %4dpx  content %.1f%%  bbox=%s" % (name, size, ratio * 100, bbox))
    print("icons written to", ICONS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
