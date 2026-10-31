import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * 文件列表拖拽上传：监听 WebView 拖拽事件并判断是否落在列表区域内。
 * listRef 交给列表容器，dragActive 用于显示拖拽提示层。
 */
export function useSftpDragDrop(sessionId: string | null, onDrop: (paths: string[]) => void) {
  const [dragActive, setDragActive] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  useEffect(() => {
    if (!sessionId) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload as {
          type: string;
          paths?: string[];
          position?: { x: number; y: number };
        };
        if (payload.type === "leave") {
          setDragActive(false);
          return;
        }
        const rect = listRef.current?.getBoundingClientRect();
        const position = payload.position;
        if (!rect || !position) return;

        const scale = window.devicePixelRatio || 1;
        const x = position.x / scale;
        const y = position.y / scale;
        const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

        if (payload.type === "enter" || payload.type === "over") {
          setDragActive(inside);
          return;
        }
        if (payload.type === "drop") {
          setDragActive(false);
          if (inside && payload.paths?.length) {
            dropRef.current(payload.paths);
          }
        }
      })
      .then((unlistenFn) => {
        if (disposed) unlistenFn();
        else unlisten = unlistenFn;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [sessionId]);

  return { dragActive, listRef };
}
