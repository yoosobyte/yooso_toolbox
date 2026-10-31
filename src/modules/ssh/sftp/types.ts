import type { SftpEntry } from "../../../types";

/** 新建目录 / 重命名弹窗状态 */
export type SftpDialogState = { kind: "mkdir" | "rename"; value: string } | null;

export type SftpMenuAlign = "auto" | "bottom-left";

/** 右键菜单状态；target 为 null 表示在空白处右键 */
export type SftpMenuState = {
  x: number;
  y: number;
  target: SftpEntry | null;
  align?: SftpMenuAlign;
} | null;
