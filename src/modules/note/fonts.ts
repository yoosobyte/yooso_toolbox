/** 笔记正文字体偏好：只影响编辑器与 Markdown 预览，不改 UI 其它部分。 */

export type NoteFont = "system" | "sans" | "serif" | "mono" | "kai";

export const NOTE_FONT_STACKS: Record<NoteFont, string> = {
  system: "inherit",
  sans: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  serif: 'Georgia, "Songti SC", "SimSun", "Times New Roman", serif',
  mono: 'ui-monospace, "SFMono-Regular", "Cascadia Mono", Consolas, "Courier New", monospace',
  kai: '"Kaiti SC", "KaiTi", "STKaiti", "楷体", serif',
};

const KEY = "yooso.note.font";

export function loadNoteFont(): NoteFont {
  const raw = localStorage.getItem(KEY);
  return raw && raw in NOTE_FONT_STACKS ? (raw as NoteFont) : "mono";
}

export function saveNoteFont(font: NoteFont): void {
  localStorage.setItem(KEY, font);
}

const SIZE_KEY = "yooso.note.fontSize";

export const NOTE_FONT_SIZES = [
  12, 13, 14, 15, 16, 18, 20, 25, 30, 40, 50, 100,
] as const;

export function loadNoteFontSize(): number {
  const raw = localStorage.getItem(SIZE_KEY);
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value >= 10 && value <= 200 ? value : 13;
}

export function saveNoteFontSize(size: number): void {
  localStorage.setItem(SIZE_KEY, String(size));
}
