import { useEffect, useState } from "react";
import { Spin } from "antd";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import useDbStructureData from "./useDbStructureData";
import useDbStructureEditor from "./useDbStructureEditor";
import DbStructureToolbar from "./DbStructureToolbar";
import DbStructureTable from "./DbStructureTable";
import DbStructureActions from "./DbStructureActions";
import DbStructureContextMenu from "./DbStructureContextMenu";

interface Props {
  connectionId: string;
  database: string;
  table: string;
  refreshToken: number;
}

export default function DbStructureView({ connectionId, database, table, refreshToken }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { rows, loading, error, defaultCollation, reload, refresh } = useDbStructureData({
    connectionId,
    database,
    table,
    refreshToken,
  });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const editor = useDbStructureEditor({
    t,
    connectionId,
    database,
    table,
    refreshToken,
    rows,
    defaultCollation,
    reload,
    reloadData: refresh,
  });

  return (
    <div
      className="db-structure-view"
      onMouseDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (event.shiftKey && !target.closest("input, textarea")) {
          event.preventDefault();
          window.getSelection()?.removeAllRanges();
        }
      }}
      onMouseUpCapture={(event) => {
        const target = event.target as HTMLElement;
        if (event.shiftKey && !target.closest("input, textarea")) {
          window.getSelection()?.removeAllRanges();
        }
      }}
    >
      <DbStructureToolbar t={t} />

      <div className="db-structure-area">
        {error ? (
          <div className="db-error">{error}</div>
        ) : loading && rows.length === 0 ? (
          <div className="db-grid-loading">
            <Spin size="small" />
          </div>
        ) : (
          <DbStructureTable
            rows={rows}
            editor={editor}
            t={t}
            onRowContextMenu={(event, rowIndex) => {
              if (!editor.selectedRows.has(rowIndex)) {
                editor.selectRow(rowIndex, event);
              }
              setMenu({ x: event.clientX, y: event.clientY });
            }}
          />
        )}
      </div>

      <DbStructureActions editor={editor} rowCount={rows.length} t={t} />

      {menu && (
        <DbStructureContextMenu
          x={menu.x}
          y={menu.y}
          selectedCount={editor.selectedRows.size}
          canDelete={
            editor.selectedRows.size > 0 && !editor.applying && !editor.draft
          }
          onDelete={() => {
            setMenu(null);
            editor.deleteSelected();
          }}
        />
      )}
    </div>
  );
}
