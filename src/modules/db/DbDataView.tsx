import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { App as AntdApp, Button, Checkbox, Input, Pagination, Select, Tooltip } from "antd";
import {
  CheckOutlined,
  ClearOutlined,
  CloseOutlined,
  DeleteOutlined,
  FilterOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import DbResultGrid from "./DbResultGrid";
import {
  dbDeleteRows,
  dbInsertRow,
  dbTableColumns,
  dbTableData,
  dbUpdateCell,
  type DbFilter,
  type DbKey,
  type DbQueryResult,
} from "./api";

interface Props {
  connectionId: string;
  database: string;
  table: string;
  refreshToken: number;
}

interface DraftFilter extends DbFilter {
  id: string;
  enabled: boolean;
  conjunction: "and" | "or";
}

const PAGE_SIZES = [50, 100, 200, 500];
const OPERATORS = [
  "eq",
  "neq",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "gt",
  "gte",
  "lt",
  "lte",
  "isNull",
  "isNotNull",
  "in",
  "notIn",
];

function isUnary(operator: string): boolean {
  return operator === "isNull" || operator === "isNotNull";
}

export default function DbDataView({ connectionId, database, table, refreshToken }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();
  const [result, setResult] = useState<DbQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [sort, setSort] = useState<{ column: string; dir: "asc" | "desc" } | null>(null);
  const [reload, setReload] = useState(0);

  const [filters, setFilters] = useState<DbFilter[]>([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterApplying, setFilterApplying] = useState(false);
  const [draft, setDraft] = useState<DraftFilter[]>([]);

  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [newRow, setNewRow] = useState<string[] | null>(null);
  const [inserting, setInserting] = useState(false);
  const [columnComments, setColumnComments] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const request = useRef(0);

  useEffect(() => {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    setSelectedRows(new Set());
    setAnchor(null);
    setMenu(null);
    dbTableData(
      connectionId,
      database,
      table,
      pageSize,
      page * pageSize,
      sort?.column ?? null,
      sort?.dir ?? null,
      filters,
      "and",
    )
      .then((next) => {
        if (current !== request.current) return;
        setResult(next);
      })
      .catch((reason) => {
        if (current !== request.current) return;
        setError(errText(reason));
      })
      .finally(() => {
        if (current === request.current) {
          setLoading(false);
          setFilterApplying(false);
        }
      });
  }, [
    connectionId,
    database,
    table,
    page,
    pageSize,
    sort?.column,
    sort?.dir,
    filters,
    refreshToken,
    reload,
  ]);

  useEffect(() => {
    let alive = true;
    setColumnComments({});
    dbTableColumns(connectionId, database, table)
      .then((structure) => {
        if (!alive) return;
        const fieldIndex = structure.columns.findIndex(
          (column) => column.name.toLowerCase() === "field",
        );
        const commentIndex = structure.columns.findIndex(
          (column) => column.name.toLowerCase() === "comment",
        );
        if (fieldIndex < 0 || commentIndex < 0) return;
        const comments: Record<string, string> = {};
        structure.rows.forEach((row) => {
          const name = row[fieldIndex] ?? "";
          const comment = row[commentIndex] ?? "";
          if (name && comment) comments[name] = comment;
        });
        setColumnComments(comments);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [connectionId, database, table]);

  useEffect(() => {
    setNewRow(null);
  }, [page, pageSize, sort?.column, sort?.dir, filters, refreshToken]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const primaryKey = result?.primaryKey ?? [];
  const canMutate = primaryKey.length > 0;
  const total = result?.total ?? null;
  const pageCount = total !== null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const canNext =
    pageCount !== null ? page + 1 < pageCount : (result?.rows.length ?? 0) >= pageSize;
  const paginationTotal =
    total ??
    page * pageSize + (result?.rows.length ?? 0) + (canNext ? 1 : 0);

  const handleSort = (column: string) => {
    setPage(0);
    setSort((prev) => {
      if (!prev || prev.column !== column) return { column, dir: "asc" };
      if (prev.dir === "asc") return { column, dir: "desc" };
      return null;
    });
  };

  const selectRow = (rowIndex: number, event: ReactMouseEvent) => {
    window.getSelection()?.removeAllRanges();
    if (event.shiftKey && anchor !== null) {
      const start = Math.min(anchor, rowIndex);
      const end = Math.max(anchor, rowIndex);
      setSelectedRows(new Set(Array.from({ length: end - start + 1 }, (_, i) => start + i)));
    } else if (event.metaKey || event.ctrlKey) {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        if (next.has(rowIndex)) next.delete(rowIndex);
        else next.add(rowIndex);
        return next;
      });
      setAnchor(rowIndex);
    } else {
      setSelectedRows(new Set([rowIndex]));
      setAnchor(rowIndex);
    }
    setMenu(null);
  };

  const openRowMenu = (event: ReactMouseEvent, rowIndex: number) => {
    event.preventDefault();
    if (!selectedRows.has(rowIndex)) {
      setSelectedRows(new Set([rowIndex]));
      setAnchor(rowIndex);
    }
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 70),
    });
  };

  const keyForRow = (rowIndex: number): DbKey[] => {
    if (!result) return [];
    return primaryKey.map((column) => {
      const columnIndex = result.columns.findIndex((item) => item.name === column);
      return {
        column,
        value: columnIndex >= 0 ? result.rows[rowIndex]?.[columnIndex] ?? null : null,
      };
    });
  };

  const deleteSelected = () => {
    if (!canMutate || selectedRows.size === 0) return;
    const indices = Array.from(selectedRows).filter(
      (index) => result && index < result.rows.length,
    );
    if (indices.length === 0) return;
    modal.confirm({
      title: t("db.deleteRowsTitle"),
      content: t("db.deleteRowsConfirm", { count: indices.length }),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const affected = await dbDeleteRows(
            connectionId,
            database,
            table,
            indices.map(keyForRow),
          );
          message.success(t("db.deletedRows", { count: affected }));
          setSelectedRows(new Set());
          setAnchor(null);
          setMenu(null);
          setPage(0);
          setReload((value) => value + 1);
        } catch (reason) {
          message.error(errText(reason));
        }
      },
    });
  };

  const commitCell = async (rowIndex: number, columnIndex: number, value: string) => {
    if (!result || !canMutate) return;
    const column = result.columns[columnIndex]?.name;
    if (!column) return;
    const old = result.rows[rowIndex]?.[columnIndex] ?? "";
    if (value === old) return;
    try {
      const affected = await dbUpdateCell(
        connectionId,
        database,
        table,
        column,
        value,
        keyForRow(rowIndex),
      );
      if (affected > 0) {
        setResult((current) => {
          if (!current) return current;
          return {
            ...current,
            rows: current.rows.map((row, index) =>
              index === rowIndex
                ? row.map((cell, cellIndex) => (cellIndex === columnIndex ? value : cell))
                : row,
            ),
          };
        });
        message.success(t("db.cellSaved"));
      } else {
        message.warning(t("db.cellNotSaved"));
      }
    } catch (reason) {
      message.error(errText(reason));
    }
  };

  const openFilter = () => {
    if (!filterOpen) {
      const source: DbFilter[] = filters.length
        ? filters
        : [{ column: result?.columns[0]?.name ?? "", operator: "eq", value: "" }];
      setDraft(
        source.map((filter) => ({
          ...filter,
          id: crypto.randomUUID(),
          enabled: true,
          conjunction: filter.conjunction ?? "and",
        })),
      );
    }
    setFilterOpen((value) => !value);
  };

  const addFilter = () => {
    setDraft((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        column: result?.columns[0]?.name ?? "",
        operator: "eq",
        value: "",
        enabled: true,
        conjunction: "and",
      },
    ]);
  };

  const patchFilter = (id: string, next: Partial<DraftFilter>) => {
    setDraft((prev) => prev.map((item) => (item.id === id ? { ...item, ...next } : item)));
  };

  const applyFilters = () => {
    const next = draft
      .filter(
        (filter) =>
          filter.enabled &&
          filter.column &&
          filter.operator &&
          (isUnary(filter.operator) || (filter.value ?? "").trim() !== ""),
      )
      .map((filter) => ({
        column: filter.column,
        operator: filter.operator,
        value: filter.value ?? "",
        conjunction: filter.conjunction,
      }));
    setFilterApplying(true);
    setFilters(next);
    setPage(0);
    setReload((value) => value + 1);
  };

  const resetFilters = () => {
    setDraft([]);
    setFilters([]);
    setFilterApplying(false);
    setPage(0);
    setFilterOpen(false);
  };

  const draftDirty = newRow?.some((value) => value !== "") ?? false;

  const addRow = () => {
    if (!result || result.columns.length === 0 || newRow) return;
    setNewRow(result.columns.map(() => ""));
  };

  const cancelRow = () => setNewRow(null);

  const saveRow = async () => {
    if (!newRow || !result || inserting) return;
    const values = result.columns
      .map((column, index) => ({
        column: column.name,
        value: newRow[index] ?? "",
      }))
      .filter((entry) => entry.value !== "");
    if (values.length === 0) return;
    setInserting(true);
    try {
      await dbInsertRow(connectionId, database, table, values);
      message.success(t("db.rowAdded"));
      setNewRow(null);
      setReload((value) => value + 1);
    } catch (error) {
      message.error(errText(error));
    } finally {
      setInserting(false);
    }
  };

  return (
    <div
      className="db-data-view"
      onClick={() => menu && setMenu(null)}
      onMouseDownCapture={(event) => {
        if (event.shiftKey) {
          event.preventDefault();
          window.getSelection()?.removeAllRanges();
        }
      }}
      onMouseUpCapture={(event) => {
        if (event.shiftKey) window.getSelection()?.removeAllRanges();
      }}
    >
      <div className="db-view-toolbar">
        <Button
          size="small"
          type="text"
          icon={<FilterOutlined />}
          disabled={!result}
          onClick={(event) => {
            event.stopPropagation();
            openFilter();
          }}
        >
          {t("db.filter")}
          {filters.length > 0 && (
            <span className="db-filter-count">{filters.length}</span>
          )}
        </Button>
      </div>

      {filterOpen && (
        <div className="db-filter-panel" onClick={(event) => event.stopPropagation()}>
          <div className="db-filter-head">
            <span className="db-filter-title">{t("db.filter")}</span>
            <Button size="small" type="text" icon={<PlusOutlined />} onClick={addFilter}>
              {t("db.filterAdd")}
            </Button>
            <span style={{ flex: 1 }} />
          </div>

          {draft.map((filter) => (
            <div
              className={`db-filter-row${filter.enabled ? "" : " db-filter-row-disabled"}`}
              key={filter.id}
            >
              <Tooltip title={t("db.filterEnabled")}>
                <Checkbox
                  checked={filter.enabled}
                  onChange={(event) =>
                    patchFilter(filter.id, { enabled: event.target.checked })
                  }
                />
              </Tooltip>
              <Select
                size="small"
                value={filter.column}
                disabled={!filter.enabled}
                options={(result?.columns ?? []).map((column) => ({
                  value: column.name,
                  label: column.name,
                }))}
                onChange={(value) => patchFilter(filter.id, { column: String(value) })}
                style={{ width: 150 }}
              />
              <Select
                size="small"
                value={filter.operator}
                disabled={!filter.enabled}
                options={OPERATORS.map((operator) => ({
                  value: operator,
                  label: t(`db.op.${operator}`),
                }))}
                onChange={(value) =>
                  patchFilter(filter.id, {
                    operator: String(value),
                    value: isUnary(String(value)) ? "" : filter.value,
                  })
                }
                style={{ width: 160 }}
              />
              <Input
                size="small"
                value={filter.value ?? ""}
                disabled={
                  !filter.enabled || isUnary(filter.operator)
                }
                placeholder={
                  isUnary(filter.operator)
                    ? "—"
                    : filter.operator === "in" || filter.operator === "notIn"
                      ? t("db.filterInPlaceholder")
                      : t("db.filterValuePlaceholder")
                }
                onChange={(event) => patchFilter(filter.id, { value: event.target.value })}
              />
              <Select
                size="small"
                value={filter.conjunction}
                disabled={!filter.enabled}
                options={[
                  { value: "and", label: t("db.filterAnd") },
                  { value: "or", label: t("db.filterOr") },
                ]}
                onChange={(value) =>
                  patchFilter(filter.id, { conjunction: value as "and" | "or" })
                }
                style={{ width: 88 }}
              />
              <Button
                size="small"
                type="default"
                className="db-filter-delete"
                title={t("common.delete")}
                icon={<CloseOutlined />}
                onClick={() =>
                  setDraft((prev) => prev.filter((item) => item.id !== filter.id))
                }
              />
            </div>
          ))}

          <div className="db-filter-footer">
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              loading={filterApplying}
              onClick={applyFilters}
            >
              {t("db.filterApply")}
            </Button>
            <Button size="small" icon={<ClearOutlined />} onClick={resetFilters}>
              {t("db.filterReset")}
            </Button>
          </div>
        </div>
      )}

      <div className="db-grid-area">
        {error ? (
          <div className="db-error">{error}</div>
        ) : (
          <DbResultGrid
            columns={result?.columns ?? []}
            rows={result?.rows ?? []}
            loading={loading}
            emptyText={t("db.emptyTable")}
            sort={sort}
            onSort={handleSort}
            selectedRows={selectedRows}
            onRowSelect={selectRow}
            onRowContextMenu={openRowMenu}
            editable={canMutate}
            resetKey={`${page}|${pageSize}|${sort?.column ?? ""}|${sort?.dir ?? ""}|${JSON.stringify(filters)}|${reload}|${refreshToken}`}
            onCellCommit={(rowIndex, columnIndex, value) => {
              void commitCell(rowIndex, columnIndex, value);
            }}
            draft={
              newRow
                ? {
                    values: newRow,
                    placeholders: result?.columns.map(
                      (column) => columnComments[column.name] || column.name,
                    ),
                    onChange: (index, value) =>
                      setNewRow((current) =>
                        current
                          ? current.map((item, itemIndex) =>
                              itemIndex === index ? value : item,
                            )
                          : current,
                      ),
                    onSave: () => void saveRow(),
                    onCancel: cancelRow,
                  }
                : null
            }
          />
        )}
      </div>

      <div className="db-pager">
        <Tooltip title={t("db.addRow")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<PlusOutlined />}
            disabled={!result || result.columns.length === 0 || newRow !== null}
            onClick={(event) => {
              event.stopPropagation();
              addRow();
            }}
          />
        </Tooltip>
        <Tooltip title={canMutate ? t("db.deleteRows") : t("db.noPrimaryKey")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<MinusOutlined />}
            disabled={!canMutate || selectedRows.size === 0}
            onClick={(event) => {
              event.stopPropagation();
              deleteSelected();
            }}
          />
        </Tooltip>
        <Tooltip title={t("common.save")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<CheckOutlined />}
            loading={inserting}
            disabled={!newRow || !draftDirty}
            onClick={() => void saveRow()}
          />
        </Tooltip>
        <Tooltip title={t("common.cancel")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<CloseOutlined />}
            disabled={!newRow}
            onClick={cancelRow}
          />
        </Tooltip>
        <Tooltip title={t("db.refreshData")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<ReloadOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              setNewRow(null);
              setReload((value) => value + 1);
            }}
          />
        </Tooltip>
        <Tooltip title={canMutate ? t("db.deleteRows") : t("db.noPrimaryKey")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<DeleteOutlined />}
            disabled={!canMutate || selectedRows.size === 0}
            onClick={(event) => {
              event.stopPropagation();
              deleteSelected();
            }}
          />
        </Tooltip>
        {selectedRows.size > 0 && (
          <span className="db-muted">{t("db.selectedRows", { count: selectedRows.size })}</span>
        )}
        {!canMutate && <span className="db-hint">{t("db.noPrimaryKey")}</span>}
        <span style={{ flex: 1 }} />
        <span className="db-total">
          {total !== null
            ? t("db.totalRows", { count: total })
            : t("db.rows", { count: result?.rows.length ?? 0 })}
        </span>
        <Pagination
          size="small"
          current={page + 1}
          pageSize={pageSize}
          total={paginationTotal}
          showSizeChanger
          pageSizeOptions={PAGE_SIZES.map(String)}
          onChange={(nextPage, nextSize) => {
            if (nextSize !== pageSize) {
              setPageSize(nextSize);
              setPage(0);
            } else {
              setPage(nextPage - 1);
            }
          }}
        />
      </div>

      {menu && (
        <div
          className="db-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            disabled={!canMutate || selectedRows.size === 0}
            onClick={() => {
              setMenu(null);
              deleteSelected();
            }}
          >
            <MinusOutlined />
            {t("db.deleteRows")} ({selectedRows.size})
          </button>
        </div>
      )}
    </div>
  );
}
