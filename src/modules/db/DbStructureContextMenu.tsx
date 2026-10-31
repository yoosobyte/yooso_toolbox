import { MinusOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";

interface Props {
  x: number;
  y: number;
  selectedCount: number;
  canDelete: boolean;
  onDelete: () => void;
}

/** 表结构行的右键菜单：删除选中字段 */
export default function DbStructureContextMenu({
  x,
  y,
  selectedCount,
  canDelete,
  onDelete,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <div
      className="db-context-menu"
      style={{ left: x, top: y }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" disabled={!canDelete} onClick={onDelete}>
        <MinusOutlined />
        {t("db.deleteFields")} ({selectedCount})
      </button>
    </div>
  );
}
