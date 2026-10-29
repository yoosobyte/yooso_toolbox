"""生成 Yooso Toolbox 应用图标（1024x1024），供 `tauri icon` 派生各尺寸。"""

from PIL import Image, ImageDraw, ImageFilter
import math

SIZE = 1024
SS = 4  # 超采样倍数，保证边缘平滑
W = SIZE * SS

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))

# ---------- 渐变背景（圆角矩形 + 对角渐变） ----------
grad = Image.new("RGBA", (W, W))
gdraw = ImageDraw.Draw(grad)
c1 = (37, 99, 235)    # #2563eb
c2 = (124, 58, 237)   # #7c3aed
c3 = (168, 85, 247)   # #a855f7
for y in range(W):
    t = y / (W - 1)
    if t < 0.55:
        k = t / 0.55
        r = int(c1[0] + (c2[0] - c1[0]) * k)
        g = int(c1[1] + (c2[1] - c1[1]) * k)
        b = int(c1[2] + (c2[2] - c1[2]) * k)
    else:
        k = (t - 0.55) / 0.45
        r = int(c2[0] + (c3[0] - c2[0]) * k)
        g = int(c2[1] + (c3[1] - c2[1]) * k)
        b = int(c2[2] + (c3[2] - c2[2]) * k)
    gdraw.line([(0, y), (W, y)], fill=(r, g, b, 255))

mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.235), fill=255)
img.paste(grad, (0, 0), mask)

# ---------- 左上角柔光 ----------
glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse(
    [-W * 0.25, -W * 0.45, W * 0.75, W * 0.45], fill=(255, 255, 255, 46)
)
glow = glow.filter(ImageFilter.GaussianBlur(W * 0.06))
img = Image.alpha_composite(img, Image.composite(glow, Image.new("RGBA", (W, W), (0, 0, 0, 0)), mask))

# ---------- 终端提示符 ">" + "_" ----------
layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(layer)

stroke = int(W * 0.072)
cy = W // 2
left_x = int(W * 0.30)
mid_x = int(W * 0.505)
right_x = int(W * 0.72)

chevron = [(left_x, cy - W * 0.155), (mid_x - stroke * 0.2, cy), (left_x, cy + W * 0.155)]
d.line(chevron, fill=(255, 255, 255, 255), width=stroke, joint="curve")
for point in (chevron[0], chevron[2]):
    d.ellipse(
        [point[0] - stroke / 2, point[1] - stroke / 2, point[0] + stroke / 2, point[1] + stroke / 2],
        fill=(255, 255, 255, 255),
    )
d.ellipse(
    [chevron[1][0] - stroke / 2, chevron[1][1] - stroke / 2,
     chevron[1][0] + stroke / 2, chevron[1][1] + stroke / 2],
    fill=(255, 255, 255, 255),
)

bar_h = int(stroke * 0.92)
d.rounded_rectangle(
    [right_x, cy + W * 0.105 - bar_h / 2, right_x + W * 0.155, cy + W * 0.105 + bar_h / 2],
    radius=bar_h / 2,
    fill=(255, 255, 255, 255),
)

# 阴影：先画黑色偏移版本再模糊
shadow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
shadow.paste(layer, (0, int(W * 0.012)), layer)
shadow = shadow.filter(ImageFilter.GaussianBlur(W * 0.014))
shadow_alpha = shadow.split()[3].point(lambda v: int(v * 0.45))
shadow.putalpha(shadow_alpha)
img = Image.alpha_composite(img, shadow)
img = Image.alpha_composite(img, layer)

# ---------- 缩小到目标尺寸 ----------
img = img.resize((SIZE, SIZE), Image.LANCZOS)
img.save("app-icon.png")
print("written app-icon.png", img.size)
