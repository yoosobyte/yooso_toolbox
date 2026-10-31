import { MinusOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";

interface Props {
  x: number;
  y: number;
  canDelete: boolean;
  selectedCount: number;
  onDelete: () => void;
}

export default function DbDataContextMenu({
  x,
  y,
  canDelete,
  selectedCount,
  onDelete,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <div
      className="db-context-menu"
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        disabled={!canDelete}
        onClick={() => onDelete()}
      >
        <MinusOutlined />
        {t("db.deleteRows")} ({selectedCount})
      </button>
    </div>
  );
}
