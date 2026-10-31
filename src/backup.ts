import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { configImport } from "./api";

/** 弹出文件选择框，返回选中的备份文件路径 */
export async function pickBackupFile(): Promise<string | null> {
  const source = await openDialog({
    multiple: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  return typeof source === "string" ? source : null;
}

/** 导入备份文件；界面设置写回 localStorage，调用方负责刷新页面 */
export async function importBackupFile(path: string): Promise<void> {
  const result = await configImport(path);
  if (result.ui) {
    localStorage.setItem("yooso.ui", result.ui);
  }
}

/** 导入完成后重新加载应用，让所有模块重新读取配置 */
export function reloadApp(delay = 800) {
  window.setTimeout(() => window.location.reload(), delay);
}
