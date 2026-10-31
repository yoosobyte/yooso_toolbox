import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { App as AntdApp } from "antd";
import { errText } from "../../utils";
import type { TFunction } from "../../i18n";
import {
  buildAddColumnSql,
  buildDropColumnsSql,
  buildModifyColumnSql,
  nextCopyName,
  qualified,
  quoteIdent,
  type ColumnDefinition,
  type ColumnPosition,
} from "./ddl";
import { dbExecDdl } from "./api";
import {
  canUsePrimaryKey,
  defaultLengthForType,
  emptyColumn,
  stripAutoIncrement,
  supportsAutoIncrement,
  supportsCollation,
  typeOptionsFor,
} from "./dbStructureColumnMeta";
import type {
  EditableField,
  EditingCell,
  StructureTypeOption,
} from "./dbStructureTypes";

interface Options {
  t: TFunction;
  connectionId: string;
  database: string;
  table: string;
  refreshToken: number;
  rows: ColumnDefinition[];
  defaultCollation: string;
  reload: number;
  reloadData: () => void;
}

export interface DbStructureEditor {
  selectedRows: Set<number>;
  editing: EditingCell | null;
  draft: ColumnDefinition | null;
  applying: boolean;
  enabled: boolean;
  oneSelected: boolean;
  canApply: boolean;
  typeOptions: StructureTypeOption[];
  selectRow: (rowIndex: number, event: ReactMouseEvent) => void;
  startAdd: () => void;
  startInsert: () => void;
  startCopy: () => void;
  startEdit: (rowIndex: number, field: EditableField) => void;
  updateEditingValue: (value: string) => void;
  finishEdit: () => Promise<void>;
  cancelEditing: () => void;
  toggleNullable: (rowIndex: number, nullable: boolean) => Promise<void>;
  changeType: (rowIndex: number, type: string) => Promise<void>;
  togglePrimary: (rowIndex: number) => Promise<void>;
  toggleAutoIncrement: (rowIndex: number, checked: boolean) => Promise<void>;
  changeDraftType: (type: string) => void;
  updateDraftField: (field: EditableField, value: string) => void;
  updateDraftNullable: (nullable: boolean) => void;
  updateDraftAutoIncrement: (checked: boolean) => void;
  applyDraft: () => Promise<void>;
  cancelDraft: () => void;
  deleteSelected: () => void;
  refresh: () => void;
}

/**
 * 表结构页的交互状态：行选中、单元格编辑、新增列草稿，以及所有列级 DDL 操作。
 * 数据加载由 useDbStructureData 负责，这里只消费 rows 并在变更后触发刷新。
 */
export default function useDbStructureEditor({
  t,
  connectionId,
  database,
  table,
  refreshToken,
  rows,
  defaultCollation,
  reload,
  reloadData,
}: Options): DbStructureEditor {
  const { message, modal } = AntdApp.useApp();
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [draft, setDraft] = useState<ColumnDefinition | null>(null);
  const [draftPosition, setDraftPosition] = useState<ColumnPosition>({ kind: "end" });
  const [applying, setApplying] = useState(false);
  const cancelEditRef = useRef(false);

  useEffect(() => {
    setSelectedRows(new Set());
    setAnchor(null);
    setEditing(null);
    setDraft(null);
  }, [connectionId, database, table, refreshToken, reload]);

  const qualifiedName = qualified(database, table);

  const selectedNames = () =>
    Array.from(selectedRows)
      .map((rowIndex) => rows[rowIndex]?.field)
      .filter(Boolean);

  const selectRow = (rowIndex: number, event: ReactMouseEvent) => {
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    setSelectedRows((previous) => {
      const next = new Set(previous);
      if (event.shiftKey && anchor !== null) {
        next.clear();
        const start = Math.min(anchor, rowIndex);
        const end = Math.max(anchor, rowIndex);
        for (let index = start; index <= end; index += 1) next.add(index);
      } else if (event.ctrlKey || event.metaKey) {
        if (next.has(rowIndex)) next.delete(rowIndex);
        else next.add(rowIndex);
      } else {
        next.clear();
        next.add(rowIndex);
      }
      return next;
    });
    if (!additive) setAnchor(rowIndex);
    else if (anchor === null) setAnchor(rowIndex);
  };

  const beginDraft = (column: ColumnDefinition, position: ColumnPosition) => {
    setDraft(column);
    setDraftPosition(position);
    setSelectedRows(new Set());
    setAnchor(null);
    setEditing(null);
  };

  const startAdd = () => {
    if (draft) return;
    beginDraft(emptyColumn(defaultCollation), { kind: "end" });
  };

  const startInsert = () => {
    if (draft) return;
    if (selectedRows.size !== 1) {
      message.info(t("db.selectColumnFirst"));
      return;
    }
    const rowIndex = Array.from(selectedRows)[0];
    const current = rows[rowIndex];
    if (!current) return;
    beginDraft(
      emptyColumn(defaultCollation),
      rowIndex === 0 || !rows[rowIndex - 1]?.field
        ? { kind: "first" }
        : { kind: "after", column: rows[rowIndex - 1].field },
    );
  };

  const startCopy = () => {
    if (draft) return;
    if (selectedRows.size !== 1) {
      message.info(t("db.selectColumnFirst"));
      return;
    }
    const rowIndex = Array.from(selectedRows)[0];
    const current = rows[rowIndex];
    if (!current) return;
    const used = new Set(rows.map((row) => row.field));
    beginDraft(
      {
        ...current,
        field: nextCopyName(current.field, used),
        key: "",
        privileges: "",
        extra: current.extra.replace(/\bauto_increment\b/gi, "").trim(),
      },
      current.field
        ? { kind: "after", column: current.field }
        : { kind: "end" },
    );
  };

  const startEdit = (rowIndex: number, field: EditableField) => {
    if (applying || draft) return;
    const row = rows[rowIndex];
    if (!row) return;
    setEditing({ row: rowIndex, field, value: String(row[field]) });
  };

  const updateEditingValue = (value: string) => {
    setEditing((current) => (current ? { ...current, value } : current));
  };

  const cancelEditing = () => {
    cancelEditRef.current = true;
  };

  const finishEdit = async () => {
    const currentEdit = editing;
    if (!currentEdit) return;
    setEditing(null);
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      return;
    }
    const current = rows[currentEdit.row];
    if (!current) return;
    const value =
      currentEdit.field === "field" ? currentEdit.value.trim() : currentEdit.value;
    if (value === String(current[currentEdit.field])) return;
    if (!value && currentEdit.field === "field") {
      message.warning(t("db.columnRequired"));
      reloadData();
      return;
    }
    const next = { ...current, [currentEdit.field]: value };
    setApplying(true);
    try {
      await dbExecDdl(
        connectionId,
        buildModifyColumnSql({
          database,
          table,
          oldName: current.field,
          column: next,
        }),
      );
      message.success(t("db.columnUpdated"));
      reloadData();
    } catch (reason) {
      message.error(errText(reason));
    } finally {
      setApplying(false);
    }
  };

  const toggleNullable = async (rowIndex: number, nullable: boolean) => {
    if (applying || draft) return;
    const current = rows[rowIndex];
    if (!current) return;
    setApplying(true);
    try {
      await dbExecDdl(
        connectionId,
        buildModifyColumnSql({
          database,
          table,
          oldName: current.field,
          column: { ...current, nullable },
        }),
      );
      message.success(t("db.columnUpdated"));
      reloadData();
    } catch (reason) {
      message.error(errText(reason));
    } finally {
      setApplying(false);
    }
  };

  const typeOptions = typeOptionsFor(rows);

  const changeType = async (rowIndex: number, type: string) => {
    if (applying || draft) return;
    const current = rows[rowIndex];
    if (!current) return;
    const length = defaultLengthForType(type);
    const extra = supportsAutoIncrement(type)
      ? current.extra
      : stripAutoIncrement(current.extra);
    const collation = supportsCollation(type)
      ? current.collation || defaultCollation
      : "";
    const suffix = supportsCollation(type) ? "" : current.suffix;
    if (
      type === current.type &&
      length === current.length &&
      extra === current.extra &&
      collation === current.collation &&
      suffix === current.suffix
    ) {
      return;
    }
    setApplying(true);
    try {
      await dbExecDdl(
        connectionId,
        buildModifyColumnSql({
          database,
          table,
          oldName: current.field,
          column: { ...current, type, length, extra, collation, suffix },
        }),
      );
      message.success(t("db.columnUpdated"));
      reloadData();
    } catch (reason) {
      message.error(errText(reason));
    } finally {
      setApplying(false);
    }
  };

  const changeDraftType = (type: string) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            type,
            length: defaultLengthForType(type),
            extra: supportsAutoIncrement(type)
              ? current.extra
              : stripAutoIncrement(current.extra),
            collation: supportsCollation(type)
              ? current.collation || defaultCollation
              : "",
            suffix: supportsCollation(type) ? "" : current.suffix,
          }
        : current,
    );
  };

  const updateDraftField = (field: EditableField, value: string) => {
    setDraft((current) =>
      current ? { ...current, [field]: value } : current,
    );
  };

  const updateDraftNullable = (nullable: boolean) => {
    setDraft((current) => (current ? { ...current, nullable } : current));
  };

  const updateDraftAutoIncrement = (checked: boolean) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            extra: checked
              ? `${current.extra} auto_increment`.trim()
              : stripAutoIncrement(current.extra),
          }
        : current,
    );
  };

  const togglePrimary = async (rowIndex: number) => {
    if (applying || draft) return;
    const current = rows[rowIndex];
    if (!current) return;
    const hasPrimary = current.key.toUpperCase().includes("PRI");
    const otherPrimary = rows.some(
      (row, index) => index !== rowIndex && row.key.toUpperCase().includes("PRI"),
    );
    if (!canUsePrimaryKey(current)) {
      message.warning(t("db.keyUnsupported"));
      return;
    }
    const target = quoteIdent(current.field);
    const statement = hasPrimary
      ? `ALTER TABLE ${qualifiedName} DROP PRIMARY KEY`
      : otherPrimary
        ? `ALTER TABLE ${qualifiedName} DROP PRIMARY KEY, ADD PRIMARY KEY (${target})`
        : `ALTER TABLE ${qualifiedName} ADD PRIMARY KEY (${target})`;
    setApplying(true);
    try {
      await dbExecDdl(connectionId, statement);
      message.success(t("db.columnUpdated"));
      reloadData();
    } catch (reason) {
      message.error(errText(reason));
    } finally {
      setApplying(false);
    }
  };

  const toggleAutoIncrement = async (rowIndex: number, checked: boolean) => {
    if (applying || draft) return;
    const current = rows[rowIndex];
    if (!current || !supportsAutoIncrement(current.type)) return;
    const extra = checked
      ? current.extra.toLowerCase().includes("auto_increment")
        ? current.extra
        : `${current.extra} auto_increment`.trim()
      : stripAutoIncrement(current.extra);
    setApplying(true);
    try {
      await dbExecDdl(
        connectionId,
        buildModifyColumnSql({
          database,
          table,
          oldName: current.field,
          column: { ...current, extra },
        }),
      );
      message.success(t("db.columnUpdated"));
      reloadData();
    } catch (reason) {
      message.error(errText(reason));
    } finally {
      setApplying(false);
    }
  };

  const canApply = Boolean(draft?.field.trim() && draft?.type.trim() && !applying);

  const applyDraft = async () => {
    if (!draft || applying) return;
    if (!draft.field.trim() || !draft.type.trim()) {
      message.warning(t("db.columnRequired"));
      return;
    }
    setApplying(true);
    try {
      await dbExecDdl(
        connectionId,
        buildAddColumnSql({
          database,
          table,
          column: draft,
          position: draftPosition,
        }),
      );
      message.success(t("db.columnAdded"));
      setDraft(null);
      reloadData();
    } catch (reason) {
      message.error(errText(reason));
    } finally {
      setApplying(false);
    }
  };

  const deleteSelected = () => {
    if (draft || applying) return;
    const names = selectedNames();
    if (names.length === 0) return;
    modal.confirm({
      title: t("db.deleteColumn"),
      content: t("db.deleteColumnsConfirm", { columns: names.join(", ") }),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await dbExecDdl(
            connectionId,
            buildDropColumnsSql(database, table, names),
          );
          message.success(t("db.columnDropped"));
          setSelectedRows(new Set());
          setAnchor(null);
          reloadData();
        } catch (reason) {
          message.error(errText(reason));
        }
      },
    });
  };

  const enabled = !applying && !draft;
  const oneSelected = selectedRows.size === 1 && enabled;

  const cancelDraft = () => setDraft(null);

  const refresh = () => {
    setDraft(null);
    setEditing(null);
    reloadData();
  };

  return {
    selectedRows,
    editing,
    draft,
    applying,
    enabled,
    oneSelected,
    canApply,
    typeOptions,
    selectRow,
    startAdd,
    startInsert,
    startCopy,
    startEdit,
    updateEditingValue,
    finishEdit,
    cancelEditing,
    toggleNullable,
    changeType,
    togglePrimary,
    toggleAutoIncrement,
    changeDraftType,
    updateDraftField,
    updateDraftNullable,
    updateDraftAutoIncrement,
    applyDraft,
    cancelDraft,
    deleteSelected,
    refresh,
  };
}
