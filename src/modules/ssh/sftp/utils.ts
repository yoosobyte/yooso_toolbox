import type { SftpEntry } from "../../../types";

export const FOLLOW_KEY = "yooso.sftpFollowCwd";

export const sortEntries = (list: SftpEntry[]): SftpEntry[] =>
  [...list].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, "zh-CN");
  });

export interface SftpCrumb {
  label: string;
  path: string;
}

/** 面包屑：路径每一段都可点击跳转 */
export function buildCrumbs(path: string): SftpCrumb[] {
  const parts = path.split("/").filter(Boolean);
  const list: SftpCrumb[] = path ? [{ label: "/", path: "/" }] : [];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    list.push({ label: part, path: acc });
  }
  return list;
}
