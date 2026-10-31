import QRCode from "qrcode";

/**
 * 二维码渲染工具：
 * 只用 `qrcode` 生成模块矩阵，SVG / Canvas 都由这里自己画，
 * 这样预览是矢量、导出 PNG 时也能统一叠加 Logo。
 */

export type EcLevel = "L" | "M" | "Q" | "H";

export type LogoShape = "original" | "rect" | "circle" | "rounded";

export interface QrLogo {
  /** 图片 dataURL */
  dataUrl: string;
  /** Logo 边长占二维码边长的比例（0.12 - 0.3） */
  ratio: number;
  /** Logo 四周留白，单位为模块 */
  padding: number;
  /** 底板形状：原图 / 矩形 / 圆形 / 圆角矩形 */
  shape: LogoShape;
  /** 是否带投影 */
  shadow: boolean;
}

/** 画布四边留白（模块） */
export interface QrPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 叠加在二维码画布上的文字（坐标 0..1，相对整张画布；size 单位为模块） */
/** 文字标注可选字体（值 → font-family 栈） */
export const CAPTION_FONTS: Record<string, string> = {
  system: "system-ui, -apple-system, 'PingFang SC', sans-serif",
  sans: "'Helvetica Neue', Arial, 'PingFang SC', sans-serif",
  serif: "Georgia, 'Songti SC', SimSun, serif",
  mono: "'Cascadia Mono', Consolas, monospace",
  kai: "'Kaiti SC', 'KaiTi', STKaiti', serif",
};

export interface QrCaption {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  /** 字体 key，见 CAPTION_FONTS */
  font: string;
  /** true = 竖排 */
  vertical: boolean;
}

export function captionFont(font: string): string {
  return CAPTION_FONTS[font] ?? CAPTION_FONTS.system;
}

export interface QrOptions {
  text: string;
  ecLevel: EcLevel;
  /** 静区宽度，单位为模块 */
  margin: number;
  fg: string;
  bg: string;
  logo: QrLogo | null;
  /** 码点圆角半径（0 - 0.5，相对一个模块） */
  dotRadius?: number;
  /** 画布（背景）圆角比例（0 - 0.5，相对短边） */
  bgRadius?: number;
  /** 画布四边留白（模块），用来放上下左右的文字 */
  captionPad?: QrPadding;
  captions?: QrCaption[];
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface QrMatrix {
  version: number;
  /** 模块数量（不含静区） */
  size: number;
  /** 行优先的模块数据：1 表示深色 */
  data: Uint8Array;
}

export interface LogoBox {
  /** 相对模块区的坐标（不含静区） */
  x: number;
  y: number;
  /** 含留白的边长 */
  side: number;
  /** 留白宽度 */
  padding: number;
  /** 实际画图片的边长 */
  inner: number;
}

/** 嵌入 Logo 会挡掉约 5% 的区域，固定用最高纠错级别 H 保证可扫 */
export function effectiveLevel(options: Pick<QrOptions, "ecLevel" | "logo">): EcLevel {
  return options.logo ? "H" : options.ecLevel;
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image load failed"));
    image.src = src;
  });
}

export function buildMatrix(options: Pick<QrOptions, "text" | "ecLevel" | "logo">): QrMatrix {
  const created = QRCode.create(options.text, {
    errorCorrectionLevel: effectiveLevel(options),
  });
  return {
    version: created.version,
    size: created.modules.size,
    data: created.modules.data,
  };
}

export function logoBox(matrixSize: number, logo: QrLogo): LogoBox {
  const ratio = Math.min(0.3, Math.max(0.12, logo.ratio));
  // 下限只保证「看得见」，不要用 6：小矩阵（21 模块）下 6 会显得远比滑块比例大
  const side = Math.max(3, Math.round(matrixSize * ratio));
  const padding = Math.max(0, Math.round(logo.padding));
  const inner = Math.max(2, side - padding * 2);
  return {
    // 用浮点坐标，保证无论在哪个尺寸下 Logo 中心都与二维码中心严格重合
    x: (matrixSize - side) / 2,
    y: (matrixSize - side) / 2,
    side,
    padding,
    inner,
  };
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function modulesPath(
  data: Uint8Array,
  size: number,
  margin: number,
  radius: number,
): string {
  let path = "";
  const r = Math.max(0, Math.min(0.5, radius));
  for (let row = 0; row < size; row += 1) {
    const base = row * size;
    for (let col = 0; col < size; col += 1) {
      if (!data[base + col]) continue;
      const x = col + margin;
      const y = row + margin;
      if (r <= 0) {
        path += `M${x} ${y}h1v1h-1z`;
        continue;
      }
      const rr = r;
      const straight = 1 - rr * 2;
      path +=
        `M${x + rr} ${y}` +
        `h${straight}a${rr} ${rr} 0 0 1 ${rr} ${rr}` +
        `v${straight}a${rr} ${rr} 0 0 1 ${-rr} ${rr}` +
        `h${-straight}a${rr} ${rr} 0 0 1 ${-rr} ${-rr}` +
        `v${-straight}a${rr} ${rr} 0 0 1 ${rr} ${-rr}z`;
    }
  }
  return path;
}

/** 生成完整 SVG 字符串；`pixelSize` 只影响 width/height，viewBox 仍是模块坐标 */
export function qrSvg(options: QrOptions, pixelSize?: number): string {
  const matrix = buildMatrix(options);
  const margin = Math.max(0, Math.round(options.margin));
  const total = matrix.size + margin * 2;
  const pad = options.captionPad ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const padTop = Math.max(0, Math.round(pad.top));
  const padRight = Math.max(0, Math.round(pad.right));
  const padBottom = Math.max(0, Math.round(pad.bottom));
  const padLeft = Math.max(0, Math.round(pad.left));
  const canvasWidth = total + padLeft + padRight;
  const canvasHeight = total + padTop + padBottom;
  const dim = pixelSize ?? total * 10;
  const dimHeight = Math.round((dim * canvasHeight) / canvasWidth);
  const parts: string[] = [];
  const bg = escapeAttr(options.bg);
  const fg = escapeAttr(options.fg);

  const bgRadius = Math.max(0, Math.min(0.5, options.bgRadius ?? 0));
  const bgRx =
    bgRadius > 0 ? Math.min(canvasWidth, canvasHeight) * bgRadius : 0;
  parts.push(
    `<rect width="${canvasWidth}" height="${canvasHeight}"` +
      `${bgRx > 0 ? ` rx="${bgRx}"` : ""} fill="${bg}"/>`,
  );
  parts.push(
    `<g transform="translate(${padLeft} ${padTop})"><path d="${modulesPath(matrix.data, matrix.size, margin, options.dotRadius ?? 0)}" fill="${fg}"/>`,
  );

  if (options.logo) {
    const logo = options.logo;
    const box = logoBox(matrix.size, logo);
    const x = margin + box.x;
    const y = margin + box.y;
    const inner = box.padding > 0 ? box.inner : box.side;
    const innerX = x + (box.side - inner) / 2;
    const innerY = y + (box.side - inner) / 2;
    const image = `<image href="${escapeAttr(logo.dataUrl)}" x="${innerX}" y="${innerY}" width="${inner}" height="${inner}" preserveAspectRatio="xMidYMid meet"/>`;
    const shadow = logo.shadow
      ? `<defs><filter id="qr-logo-shadow" x="-30%" y="-30%" width="160%" height="160%">` +
        `<feDropShadow dx="0" dy="${(box.side * 0.04).toFixed(2)}" stdDeviation="${(box.side * 0.06).toFixed(2)}" flood-color="#000" flood-opacity="0.35"/>` +
        `</filter></defs>`
      : "";

    if (logo.shape === "original") {
      parts.push(shadow);
      parts.push(
        `<g${logo.shadow ? ' filter="url(#qr-logo-shadow)"' : ""}>${image}</g>`,
      );
    } else if (logo.shape === "circle") {
      const radius = box.side / 2;
      parts.push(shadow);
      parts.push(
        `<g${logo.shadow ? ' filter="url(#qr-logo-shadow)"' : ""}>` +
          `<circle cx="${x + radius}" cy="${y + radius}" r="${radius}" fill="${bg}"/>` +
          `<clipPath id="qr-logo-clip"><circle cx="${x + radius}" cy="${y + radius}" r="${radius}"/></clipPath>` +
          `<g clip-path="url(#qr-logo-clip)">${image}</g></g>`,
      );
    } else {
      const r = logo.shape === "rounded" ? Math.max(1, box.side * 0.16).toFixed(2) : "0";
      parts.push(shadow);
      parts.push(
        `<g${logo.shadow ? ' filter="url(#qr-logo-shadow)"' : ""}>` +
          `<rect x="${x}" y="${y}" width="${box.side}" height="${box.side}" rx="${r}" fill="${bg}"/>` +
          `<clipPath id="qr-logo-clip"><rect x="${x}" y="${y}" width="${box.side}" height="${box.side}" rx="${r}"/></clipPath>` +
          `<g clip-path="url(#qr-logo-clip)">${image}</g></g>`,
      );
    }
  }

  parts.push("</g>");

  for (const cap of options.captions ?? []) {
    const text = cap.text.trim();
    if (!text) continue;
    const cx = canvasWidth * cap.x;
    const cy = canvasHeight * cap.y;
    const family = escapeAttr(captionFont(cap.font));
    const color = escapeAttr(cap.color);
    if (cap.vertical) {
      const chars = Array.from(text);
      const startY = cy - ((chars.length - 1) * cap.size) / 2;
      chars.forEach((ch, index) => {
        parts.push(
          `<text x="${cx}" y="${startY + index * cap.size}" fill="${color}" font-size="${cap.size}" ` +
            `font-family="${family}" font-weight="600" text-anchor="middle" dominant-baseline="central">${escapeText(ch)}</text>`,
        );
      });
    } else {
      parts.push(
        `<text x="${cx}" y="${cy}" fill="${color}" font-size="${cap.size}" font-family="${family}" ` +
          `font-weight="600" text-anchor="middle" dominant-baseline="central">${escapeText(text)}</text>`,
      );
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dimHeight}" ` +
    `viewBox="0 0 ${canvasWidth} ${canvasHeight}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `${parts.join("")}</svg>`
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
    return;
  }
  ctx.fillRect(x, y, width, height);
}

/**
 * 把二维码画到 canvas 上（用于导出 PNG）。
 * 每个模块都用整数像素对齐，避免半像素导致边缘发虚。
 */
export function drawQr(
  canvas: HTMLCanvasElement,
  options: QrOptions,
  pixelSize: number,
  logoImage?: HTMLImageElement | null,
) {
  const matrix = buildMatrix(options);
  const margin = Math.max(0, Math.round(options.margin));
  const total = matrix.size + margin * 2;
  const pad = options.captionPad ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const padTop = Math.max(0, Math.round(pad.top));
  const padRight = Math.max(0, Math.round(pad.right));
  const padBottom = Math.max(0, Math.round(pad.bottom));
  const padLeft = Math.max(0, Math.round(pad.left));
  const canvasWidth = total + padLeft + padRight;
  const canvasHeight = total + padTop + padBottom;
  const scale = pixelSize / total;

  canvas.width = Math.round((pixelSize * canvasWidth) / total);
  canvas.height = Math.round((pixelSize * canvasHeight) / total);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前环境不支持 Canvas 2D");

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = options.bg;
  const bgRadius = Math.max(0, Math.min(0.5, options.bgRadius ?? 0));
  if (bgRadius > 0) {
    roundRect(
      ctx,
      0,
      0,
      canvas.width,
      canvas.height,
      Math.min(canvas.width, canvas.height) * bgRadius,
    );
  } else {
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.save();
  ctx.translate(padLeft * scale, padTop * scale);
  ctx.fillStyle = options.fg;

  for (let row = 0; row < matrix.size; row += 1) {
    const base = row * matrix.size;
    const y0 = Math.round((row + margin) * scale);
    const y1 = Math.round((row + margin + 1) * scale);
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.data[base + col]) continue;
      const x0 = Math.round((col + margin) * scale);
      const x1 = Math.round((col + margin + 1) * scale);
      const w = Math.max(1, x1 - x0);
      const h = Math.max(1, y1 - y0);
      const radius = Math.max(0, Math.min(0.5, options.dotRadius ?? 0));
      if (radius <= 0) {
        ctx.fillRect(x0, y0, w, h);
      } else {
        roundRect(ctx, x0, y0, w, h, Math.min(w, h) * radius);
      }
    }
  }

  if (options.logo && logoImage) {
    const logo = options.logo;
    const box = logoBox(matrix.size, logo);
    const sidePx = box.side * scale;
    const x = (margin + box.x) * scale;
    const y = (margin + box.y) * scale;
    const innerPx = (box.padding > 0 ? box.inner : box.side) * scale;
    const innerX = x + ((sidePx - innerPx) / 2);
    const innerY = y + ((sidePx - innerPx) / 2);

    if (logo.shadow) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = sidePx * 0.12;
      ctx.shadowOffsetY = sidePx * 0.04;
    }

    if (logo.shape !== "original") {
      ctx.fillStyle = options.bg;
      if (logo.shape === "circle") {
        ctx.beginPath();
        ctx.arc(x + sidePx / 2, y + sidePx / 2, sidePx / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (logo.shape === "rounded") {
        roundRect(ctx, x, y, sidePx, sidePx, sidePx * 0.16);
      } else {
        ctx.fillRect(x, y, sidePx, sidePx);
      }
    }
    if (logo.shadow) ctx.restore();

    ctx.save();
    if (logo.shape === "circle") {
      ctx.beginPath();
      ctx.arc(x + sidePx / 2, y + sidePx / 2, sidePx / 2, 0, Math.PI * 2);
      ctx.clip();
    } else if (logo.shape !== "original") {
      ctx.beginPath();
      if (logo.shape === "rounded") {
        ctx.roundRect(x, y, sidePx, sidePx, sidePx * 0.16);
      } else {
        ctx.rect(x, y, sidePx, sidePx);
      }
      ctx.clip();
    }

    const naturalWidth = logoImage.naturalWidth || logoImage.width;
    const naturalHeight = logoImage.naturalHeight || logoImage.height;
    if (naturalWidth > 0 && naturalHeight > 0 && innerPx > 0) {
      const fit = Math.min(innerPx / naturalWidth, innerPx / naturalHeight);
      const width = naturalWidth * fit;
      const height = naturalHeight * fit;
      ctx.drawImage(
        logoImage,
        innerX + (innerPx - width) / 2,
        innerY + (innerPx - height) / 2,
        width,
        height,
      );
    }
    ctx.restore();
  }

  ctx.restore();

  for (const cap of options.captions ?? []) {
    const text = cap.text.trim();
    if (!text) continue;
    const sizePx = cap.size * scale;
    ctx.fillStyle = cap.color;
    ctx.font = `600 ${sizePx}px ${captionFont(cap.font)}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const cx = canvasWidth * cap.x * scale;
    const cy = canvasHeight * cap.y * scale;
    if (cap.vertical) {
      const chars = Array.from(text);
      const startY = cy - ((chars.length - 1) * sizePx) / 2;
      chars.forEach((ch, index) => {
        ctx.fillText(ch, cx, startY + index * sizePx);
      });
    } else {
      ctx.fillText(text, cx, cy);
    }
  }
}
