import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export type ContextMenuItem =
  | {
      key: string;
      icon?: ReactNode;
      label: string;
      danger?: boolean;
      disabled?: boolean;
      onClick: () => void;
    }
  | { type: "divider" };

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** auto：默认左上角贴鼠标，空间不足时翻转；bottom-left：左下角始终贴鼠标 */
  align?: "auto" | "bottom-left";
}

/** 应用自绘的右键菜单（全局已屏蔽浏览器默认菜单） */
export default function ContextMenu({ x, y, items, onClose, align = "auto" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // 下方空间不足时向上展开（菜单左下角贴住鼠标），右侧不足时向左展开
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();

    let nextX = x;
    let nextY = y;

    if (align === "bottom-left") {
      // 左下角贴住鼠标：菜单向左上展开
      nextY = y - rect.height;
    } else {
      if (nextX + rect.width > window.innerWidth) {
        nextX = x - rect.width;
      }
      if (nextY + rect.height > window.innerHeight) {
        nextY = y - rect.height;
      }
    }

    // 兜底：菜单本身比窗口还大时，至少保证左边/上边不出界
    nextX = Math.max(0, Math.min(nextX, window.innerWidth - rect.width));
    nextY = Math.max(0, Math.min(nextY, window.innerHeight - rect.height));

    setPos({ x: nextX, y: nextY });
  }, [x, y, align]);

  useEffect(() => {
    const close = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        "type" in item ? (
          <div className="ctx-sep" key={`sep-${index}`} />
        ) : (
          <button
            key={item.key}
            type="button"
            className={`ctx-item${item.danger ? " danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.icon ? <span className="ctx-icon">{item.icon}</span> : null}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
