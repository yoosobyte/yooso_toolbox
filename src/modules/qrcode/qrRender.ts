import QRCode from "qrcode";

/**
 * 二维码渲染工具：
 * 只用 `qrcode` 生成模块矩阵，SVG / Canvas 都由这里自己画，
 * 这样预览是矢量、导出 PNG 时也能统一叠加 Logo。
 */

export type EcLevel = "L" | "M" | "Q" | "H";

export interface QrLogo {
  /** 图片 dataURL */
  dataUrl: string;
  /** Logo 边长占二维码边长的比例（0.12 - 0.3） */
  ratio: number;
  /** Logo 四周留白，单位为模块 */
  padding: number;
}

export interface QrOptions {
  text: string;
  ecLevel: EcLevel;
  /** 静区宽度，单位为模块 */
  margin: number;
  fg: string;
  bg: string;
  logo: QrLogo | null;
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
  const side = Math.max(6, Math.round(matrixSize * ratio));
  const padding = Math.max(0, Math.round(logo.padding));
  const inner = Math.max(2, side - padding * 2);
  return {
    x: Math.floor((matrixSize - side) / 2),
    y: Math.floor((matrixSize - side) / 2),
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

function modulesPath(data: Uint8Array, size: number, margin: number): string {
  let path = "";
  for (let row = 0; row < size; row += 1) {
    const base = row * size;
    for (let col = 0; col < size; col += 1) {
      if (data[base + col]) path += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  return path;
}

/** 生成完整 SVG 字符串；`pixelSize` 只影响 width/height，viewBox 仍是模块坐标 */
export function qrSvg(options: QrOptions, pixelSize?: number): string {
  const matrix = buildMatrix(options);
  const margin = Math.max(0, Math.round(options.margin));
  const total = matrix.size + margin * 2;
  const dim = pixelSize ?? total * 10;
  const parts: string[] = [];
  const bg = escapeAttr(options.bg);
  const fg = escapeAttr(options.fg);

  parts.push(`<rect width="${total}" height="${total}" fill="${bg}"/>`);
  parts.push(`<path d="${modulesPath(matrix.data, matrix.size, margin)}" fill="${fg}"/>`);

  if (options.logo) {
    const box = logoBox(matrix.size, options.logo);
    const x = margin + box.x;
    const y = margin + box.y;
    const radius = Math.max(1, box.side * 0.16).toFixed(2);
    parts.push(
      `<rect x="${x}" y="${y}" width="${box.side}" height="${box.side}" rx="${radius}" fill="${bg}"/>`,
    );
    const inner = box.padding > 0 ? box.inner : box.side;
    const innerX = x + (box.side - inner) / 2;
    const innerY = y + (box.side - inner) / 2;
    parts.push(
      `<image href="${escapeAttr(options.logo.dataUrl)}" x="${innerX}" y="${innerY}" width="${inner}" height="${inner}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code">` +
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
  const scale = pixelSize / total;

  canvas.width = pixelSize;
  canvas.height = pixelSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前环境不支持 Canvas 2D");

  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = options.bg;
  ctx.fillRect(0, 0, pixelSize, pixelSize);
  ctx.fillStyle = options.fg;

  for (let row = 0; row < matrix.size; row += 1) {
    const base = row * matrix.size;
    const y0 = Math.round((row + margin) * scale);
    const y1 = Math.round((row + margin + 1) * scale);
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.data[base + col]) continue;
      const x0 = Math.round((col + margin) * scale);
      const x1 = Math.round((col + margin + 1) * scale);
      ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
    }
  }

  if (options.logo && logoImage) {
    const box = logoBox(matrix.size, options.logo);
    const sidePx = box.side * scale;
    const x = (margin + box.x) * scale;
    const y = (margin + box.y) * scale;
    ctx.fillStyle = options.bg;
    roundRect(ctx, x, y, sidePx, sidePx, sidePx * 0.16);

    const innerPx = box.inner * scale;
    const innerX = x + box.padding * scale;
    const innerY = y + box.padding * scale;
    const naturalWidth = logoImage.naturalWidth || logoImage.width;
    const naturalHeight = logoImage.naturalHeight || logoImage.height;
    if (naturalWidth > 0 && naturalHeight > 0) {
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
  }
}
