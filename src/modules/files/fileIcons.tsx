import {
  CustomerServiceOutlined,
  DesktopOutlined,
  DownloadOutlined,
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  FileZipOutlined,
  FolderOpenOutlined,
  HomeOutlined,
  PictureOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

const ROOT_ICONS: Record<string, ReactNode> = {
  home: <HomeOutlined />,
  downloads: <DownloadOutlined />,
  desktop: <DesktopOutlined />,
  documents: <FileTextOutlined />,
  pictures: <PictureOutlined />,
  music: <CustomerServiceOutlined />,
  videos: <VideoCameraOutlined />,
};

export function rootIcon(key: string): ReactNode {
  return ROOT_ICONS[key] ?? <FolderOpenOutlined />;
}

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "heic"]);
const ARCHIVE = new Set(["zip", "rar", "7z", "gz", "tar", "bz2", "xz"]);
const TEXT = new Set([
  "txt", "md", "json", "js", "ts", "tsx", "jsx", "rs", "html", "css", "xml", "yml", "yaml",
  "toml", "ini", "log", "sh", "bat", "ps1", "py", "java", "c", "cpp", "h", "sql",
]);
const VIDEO = new Set(["mp4", "mov", "mkv", "avi", "webm", "flv"]);
const AUDIO = new Set(["mp3", "wav", "flac", "aac", "m4a", "ogg"]);

export function fileIcon(entry: { name: string; isDir: boolean }): ReactNode {
  if (entry.isDir) return <FolderOpenOutlined />;
  const ext = entry.name.includes(".")
    ? entry.name.split(".").pop()?.toLowerCase() ?? ""
    : "";
  if (IMAGE.has(ext)) return <FileImageOutlined />;
  if (ARCHIVE.has(ext)) return <FileZipOutlined />;
  if (VIDEO.has(ext)) return <VideoCameraOutlined />;
  if (AUDIO.has(ext)) return <CustomerServiceOutlined />;
  if (TEXT.has(ext)) return <FileTextOutlined />;
  return <FileOutlined />;
}
