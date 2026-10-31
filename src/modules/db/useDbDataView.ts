import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { App as AntdApp } from "antd";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
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
import {
  isUnary,
  type DbDataSort,
  type DbDataViewProps,
  type DraftFilter,
} from "./dbDataViewTypes";

export default function useDbDataView({
  connectionId,
  database,
  table,
  refreshToken,
}: DbDataViewProps) {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();
  const [result, setResult] = useState<DbQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [sort, setSort] = useState<DbDataSort | null>(null);
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

  const closeMenu = () => setMenu(null);

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

  const removeFilter = (id: string) => {
    setDraft((prev) => prev.filter((item) => item.id !== id));
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

  const updateNewRow = (index: number, value: string) =>
    setNewRow((current) =>
      current
        ? current.map((item, itemIndex) => (itemIndex === index ? value : item))
        : current,
    );

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
    } catch (reason) {
      message.error(errText(reason));
    } finally {
      setInserting(false);
    }
  };

  const refreshData = () => {
    setNewRow(null);
    setReload((value) => value + 1);
  };

  const changePage = (nextPage: number, nextSize: number) => {
    if (nextSize !== pageSize) {
      setPageSize(nextSize);
      setPage(0);
    } else {
      setPage(nextPage - 1);
    }
  };

  const resetKey = `${page}|${pageSize}|${sort?.column ?? ""}|${sort?.dir ?? ""}|${JSON.stringify(filters)}|${reload}|${refreshToken}`;

  const draftRow = newRow
    ? {
        values: newRow,
        placeholders: result?.columns.map(
          (column) => columnComments[column.name] || column.name,
        ),
        onChange: updateNewRow,
        onSave: () => void saveRow(),
        onCancel: cancelRow,
      }
    : null;

  const addDisabled = !result || result.columns.length === 0 || newRow !== null;
  const deleteDisabled = !canMutate || selectedRows.size === 0;
  const saveDisabled = !newRow || !draftDirty;
  const cancelDisabled = !newRow;

  return {
    t,
    result,
    loading,
    error,
    page,
    pageSize,
    sort,
    filterOpen,
    filterApplying,
    filterCount: filters.length,
    draft,
    selectedRows,
    selectedCount: selectedRows.size,
    menu,
    inserting,
    canMutate,
    total,
    paginationTotal,
    resetKey,
    draftRow,
    addDisabled,
    deleteDisabled,
    saveDisabled,
    cancelDisabled,
    handleSort,
    selectRow,
    openRowMenu,
    closeMenu,
    deleteSelected,
    commitCell,
    openFilter,
    addFilter,
    patchFilter,
    removeFilter,
    applyFilters,
    resetFilters,
    addRow,
    cancelRow,
    saveRow,
    refreshData,
    changePage,
  };
}
