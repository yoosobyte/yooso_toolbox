import type { HttpMethod } from "../../types";
import { METHOD_COLOR } from "./constants";

interface MethodChipProps {
  method: HttpMethod;
  size?: "sm" | "md";
}

/** 方法标签：带底色的胶囊 */
export default function MethodChip({ method, size = "sm" }: MethodChipProps) {
  const color = METHOD_COLOR[method] ?? "#8b9bb4";
  return (
    <span
      className={`method-chip method-chip-${size}`}
      style={{ color, background: `${color}1f`, borderColor: `${color}33` }}
    >
      {method}
    </span>
  );
}
