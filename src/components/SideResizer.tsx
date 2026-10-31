import { useRef } from "react";

interface SideResizerProps {
  width: number;
  min?: number;
  max?: number;
  /** 右侧至少要保留的宽度 */
  maxReserved?: number;
  onChange: (width: number) => void;
}

/** 左右分栏之间的拖动分隔条（放在两个面板中间） */
export function SideResizer({
  width,
  min = 200,
  max = 560,
  maxReserved = 360,
  onChange,
}: SideResizerProps) {
  const draggingRef = useRef(false);

  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    draggingRef.current = true;
    const startX = event.clientX;
    const startWidth = width;
    const containerWidth = event.currentTarget.parentElement?.clientWidth ?? 960;
    const maxWidth = Math.max(min, Math.min(max, containerWidth - maxReserved));

    document.body.classList.add("side-resizing");
    const onMove = (moveEvent: MouseEvent) => {
      if (!draggingRef.current) return;
      const next = startWidth + (moveEvent.clientX - startX);
      onChange(Math.min(maxWidth, Math.max(min, next)));
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.classList.remove("side-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return <div className="side-resizer" onMouseDown={onMouseDown} />;
}
