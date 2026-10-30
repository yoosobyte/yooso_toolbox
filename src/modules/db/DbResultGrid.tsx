import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Input, Spin } from "antd";
import { CaretDownOutlined, CaretUpOutlined, SortAscendingOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { DbColumnInfo } from "./api";

interface Props {
  columns: DbColumnInfo[];
  rows: (string | null)[][];
  loading?: boolean;
  emptyText?: string;
  draft?: {
    values: string[];
    placeholders?: string[];
    onChange: (index: number, value: string) => void;
    onSave: () => void;
    onCancel: () => void;
  } | null;
  sort?: { column: string; dir: "asc" | "desc" } | null;
  onSort?: (column: string) => void;
  selectedRows?: Set<number>;
  onRowSelect?: (rowIndex: number, event: ReactMouseEvent) => void;
  onRowContextMenu?: (event: ReactMouseEvent, rowIndex: number) => void;
  editable?: boolean;
  resetKey?: string;
  onCellCommit?: (rowIndex: number, columnIndex: number, value: string) => void;
}

interface CellPos {
  row: number;
  col: number;
}

interface CellRange {
  start: CellPos;
  end: CellPos;
}

interface EditingCell {
  row: number;
  col: number;
  value: string;
  original: string;
}

const TYPE_LABELS: Record<string, string> = {
  MYSQL_TYPE_TINY: "tinyint",
  MYSQL_TYPE_SHORT: "smallint",
  MYSQL_TYPE_LONG: "int",
  MYSQL_TYPE_LONGLONG: "bigint",
  MYSQL_TYPE_FLOAT: "float",
  MYSQL_TYPE_DOUBLE: "double",
  MYSQL_TYPE_NEWDECIMAL: "decimal",
  MYSQL_TYPE_DECIMAL: "decimal",
  MYSQL_TYPE_VAR_STRING: "varchar",
  MYSQL_TYPE_STRING: "char",
  MYSQL_TYPE_BLOB: "blob",
  MYSQL_TYPE_TINY_BLOB: "tinyblob",
  MYSQL_TYPE_MEDIUM_BLOB: "mediumblob",
  MYSQL_TYPE_LONG_BLOB: "longblob",
  MYSQL_TYPE_DATE: "date",
  MYSQL_TYPE_TIME: "time",
  MYSQL_TYPE_DATETIME: "datetime",
  MYSQL_TYPE_TIMESTAMP: "timestamp",
  MYSQL_TYPE_JSON: "json",
};

function typeLabel(typeName: string): string {
  return TYPE_LABELS[typeName] ?? typeName.replace(/^MYSQL_TYPE_/, "").toLowerCase();
}

export default function DbResultGrid({
  columns,
  rows,
  loading = false,
  emptyText,
  draft,
  sort,
  onSort,
  selectedRows,
  onRowSelect,
  onRowContextMenu,
  editable = false,
  resetKey,
  onCellCommit,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const [range, setRange] = useState<CellRange | null>(null);
  const [activeCell, setActiveCell] = useState<CellPos | null>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const dragRef = useRef<{ start: CellPos; event: ReactMouseEvent; moved: boolean } | null>(null);
  const cancelEditRef = useRef(false);
  const commitLockRef = useRef(false);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [widths, setWidths] = useState<Record<string, number> | null>(null);
  const [resizing, setResizing] = useState(false);
  const columnSignature = columns.map((column) => `${column.name}:${column.typeName}`).join("|");

  useEffect(() => {
    setRange(null);
    setActiveCell(null);
    setEditing(null);
  }, [resetKey, columnSignature]);

  useEffect(() => {
    setWidths(null);
  }, [columnSignature]);

  useEffect(() => {
    if (!resizing) return;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [resizing]);

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const table = tableRef.current;
      if (table && event.target instanceof Node && table.contains(event.target)) return;
      if (!editing && !activeCell) return;
      commitEdit();
      setActiveCell(null);
      setRange(null);
    };
    document.addEventListener("mousedown", onDocumentMouseDown, true);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown, true);
  }, [editing, activeCell]);

  useEffect(() => {
    const onMouseUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      if (drag.moved) return;

      const additive = drag.event.shiftKey || drag.event.metaKey || drag.event.ctrlKey;
      onRowSelect?.(drag.start.row, drag.event);
      setActiveCell(drag.start);
      if (!additive && editable && onCellCommit) {
        const value = rows[drag.start.row]?.[drag.start.col] ?? "";
        setEditing({ ...drag.start, value, original: value });
      }
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [editable, onCellCommit, onRowSelect, rows]);

  const columnKey = (index: number) => {
    const column = columns[index];
    return `${column?.name ?? ""}:${index}`;
  };

  const startResize = (event: ReactMouseEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    const table = tableRef.current;
    const header = (event.currentTarget as HTMLElement).closest("th");
    if (!table || !header) return;

    const captured: Record<string, number> = {};
    const cells = Array.from(table.querySelectorAll("thead th")).slice(1);
    cells.forEach((cell, cellIndex) => {
      captured[columnKey(cellIndex)] = (cell as HTMLElement).getBoundingClientRect().width;
    });

    const key = columnKey(index);
    const startX = event.clientX;
    const startWidth = header.getBoundingClientRect().width;
    setWidths(captured);
    setResizing(true);

    const onMove = (moveEvent: MouseEvent) => {
      const next = Math.max(80, startWidth + moveEvent.clientX - startX);
      setWidths((current) => (current ? { ...current, [key]: next } : current));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizing(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const totalWidth = widths
    ? 28 + columns.reduce((sum, _column, index) => sum + (widths[columnKey(index)] ?? 160), 0)
    : undefined;

  const beginEdit = (row: number, col: number) => {
    if (!editable || !onCellCommit) return;
    const value = rows[row]?.[col] ?? "";
    setEditing({ row, col, value, original: value });
  };

  const commitEdit = () => {
    if (commitLockRef.current) return;
    const current = editing;
    if (!current) return;
    commitLockRef.current = true;
    setEditing(null);
    if (onCellCommit && current.value !== current.original) {
      onCellCommit(current.row, current.col, current.value);
    }
    window.setTimeout(() => {
      commitLockRef.current = false;
    }, 0);
  };

  const handleCellMouseDown = (event: ReactMouseEvent, row: number, col: number) => {
    if (event.button !== 0) return;
    if (editing) commitEdit();
    event.preventDefault();
    dragRef.current = {
      start: { row, col },
      event,
      moved: false,
    };
    setRange({ start: { row, col }, end: { row, col } });
  };

  const handleCellMouseEnter = (row: number, col: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.start.row !== row || drag.start.col !== col) drag.moved = true;
    setRange({ start: drag.start, end: { row, col } });
  };

  const minRow = range ? Math.min(range.start.row, range.end.row) : -1;
  const maxRow = range ? Math.max(range.start.row, range.end.row) : -1;
  const minCol = range ? Math.min(range.start.col, range.end.col) : -1;
  const maxCol = range ? Math.max(range.start.col, range.end.col) : -1;

  return (
    <div className="db-grid-scroll">
      <table
        ref={tableRef}
        className={`db-grid${widths ? " db-grid-resizable" : ""}`}
        style={totalWidth ? { width: totalWidth, minWidth: totalWidth } : undefined}
      >
        {widths && (
          <colgroup>
            <col style={{ width: 28 }} />
            {columns.map((_column, index) => (
              <col key={columnKey(index)} style={{ width: widths[columnKey(index)] ?? 160 }} />
            ))}
          </colgroup>
        )}
        <thead>
          <tr>
            <th className="db-row-num" aria-label="row" />
            {columns.map((column, index) => {
              const sorted = sort?.column === column.name;
              const direction = sorted ? sort.dir : null;
              return (
                <th
                  key={`${column.name}-${index}`}
                  className={onSort ? "db-th-sortable" : undefined}
                  title={onSort ? `${column.typeName} · ${t("db.sortHint")}` : column.typeName}
                  aria-sort={
                    onSort
                      ? direction === "asc"
                        ? "ascending"
                        : direction === "desc"
                          ? "descending"
                          : "none"
                      : undefined
                  }
                  tabIndex={onSort ? 0 : undefined}
                  onClick={onSort ? () => onSort(column.name) : undefined}
                  onKeyDown={
                    onSort
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSort(column.name);
                          }
                        }
                      : undefined
                  }
                >
                  <div className="db-col-head">
                    <div className="db-col-text">
                      <div className="db-col-name">{column.name}</div>
                      <div className="db-col-type">{typeLabel(column.typeName)}</div>
                    </div>
                    {onSort && (
                      <span className={`db-sort-icon${sorted ? " active" : ""}`}>
                        {direction === "asc" ? (
                          <CaretUpOutlined />
                        ) : direction === "desc" ? (
                          <CaretDownOutlined />
                        ) : (
                          <SortAscendingOutlined />
                        )}
                      </span>
                    )}
                  </div>
                  <span
                    className="db-col-resizer"
                    onMouseDown={(event) => startResize(event, index)}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr className="db-grid-status-row">
              <td colSpan={Math.max(1, columns.length + 1)}>
                <div className="db-grid-loading">
                  <Spin size="small" />
                </div>
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && !draft && (
            <tr className="db-grid-status-row">
              <td colSpan={Math.max(1, columns.length + 1)}>
                <div className="db-grid-empty">{emptyText ?? t("db.emptyResult")}</div>
              </td>
            </tr>
          )}
          {!loading && rows.map((row, rowIndex) => {
            const rowSelected = selectedRows?.has(rowIndex) ?? false;
            return (
              <tr
                key={rowIndex}
                className={rowSelected ? "db-row-selected" : undefined}
                onContextMenu={
                  onRowContextMenu
                    ? (event) => {
                        event.preventDefault();
                        onRowContextMenu(event, rowIndex);
                      }
                    : undefined
                }
              >
                <td
                  className="db-row-num db-row-select"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => onRowSelect?.(rowIndex, event)}
                />
                {columns.map((column, columnIndex) => {
                  const value = row[columnIndex] ?? null;
                  const isEditing =
                    editing?.row === rowIndex && editing.col === columnIndex;
                  const isActive =
                    activeCell?.row === rowIndex && activeCell.col === columnIndex;
                  const inRange =
                    rowIndex >= minRow &&
                    rowIndex <= maxRow &&
                    columnIndex >= minCol &&
                    columnIndex <= maxCol;

                  return (
                    <td
                      key={`${column.name}-${columnIndex}`}
                      title={value ?? "NULL"}
                      className={[
                        value === null ? "db-null-cell" : "",
                        inRange ? "db-cell-in-range" : "",
                        isActive ? "db-cell-active" : "",
                        isEditing ? "db-cell-editing" : "",
                        editable ? "db-cell-editable" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onMouseDown={(event) => handleCellMouseDown(event, rowIndex, columnIndex)}
                      onMouseEnter={() => handleCellMouseEnter(rowIndex, columnIndex)}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (editable) beginEdit(rowIndex, columnIndex);
                      }}
                    >
                      {isEditing ? (
                        <Input
                          className="db-cell-input"
                          variant="borderless"
                          autoFocus
                          value={editing.value}
                          onFocus={(event) => {
                            const input = event.currentTarget;
                            const end = input.value.length;
                            input.setSelectionRange(end, end);
                          }}
                          onChange={(event) =>
                            setEditing((current) =>
                              current ? { ...current, value: event.target.value } : current,
                            )
                          }
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={(event) => event.stopPropagation()}
                          onDoubleClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              cancelEditRef.current = true;
                              event.currentTarget.blur();
                            }
                          }}
                          onBlur={() => {
                            if (cancelEditRef.current) {
                              cancelEditRef.current = false;
                              setEditing(null);
                              return;
                            }
                            commitEdit();
                          }}
                        />
                      ) : value === null ? (
                        <span className="db-null">NULL</span>
                      ) : (
                        value
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {!loading && draft && (
            <tr className="db-draft-row">
              <td className="db-row-num" />
              {columns.map((column, index) => (
                <td key={`draft-${column.name}-${index}`}>
                  <Input
                    className="db-cell-input db-draft-input"
                    variant="borderless"
                    autoFocus={index === 0}
                    value={draft.values[index] ?? ""}
                    placeholder={draft.placeholders?.[index] ?? column.name}
                    onChange={(event) => draft.onChange(index, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        draft.onSave();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        draft.onCancel();
                      }
                    }}
                  />
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
