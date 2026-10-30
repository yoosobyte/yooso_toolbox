import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { App as AntdApp, Button, Checkbox, Select, Spin, Tooltip } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  InsertRowAboveOutlined,
  KeyOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  TableOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import {
  buildAddColumnSql,
  buildDropColumnsSql,
  buildModifyColumnSql,
  nextCopyName,
  qualified,
  quoteIdent,
  parseColumnType,
  type ColumnDefinition,
  type ColumnPosition,
} from "./ddl";
import {
  dbDatabaseCollation,
  dbExecDdl,
  dbTableColumns,
  type DbQueryResult,
} from "./api";

interface Props {
  connectionId: string;
  database: string;
  table: string;
  refreshToken: number;
}

type EditableField = "field" | "length" | "defaultValue" | "comment";

const TYPE_OPTIONS = [
  "varchar",
  "char",
  "text",
  "tinytext",
  "mediumtext",
  "longtext",
  "int",
  "integer",
  "bigint",
  "smallint",
  "tinyint",
  "mediumint",
  "decimal",
  "numeric",
  "float",
  "double",
  "date",
  "datetime",
  "timestamp",
  "time",
  "year",
  "json",
  "blob",
  "tinyblob",
  "mediumblob",
  "longblob",
  "binary",
  "varbinary",
  "enum",
  "set",
  "bit",
];

const TYPE_LENGTH_DEFAULTS: Record<string, string> = {
  varchar: "255",
  char: "1",
  binary: "255",
  varbinary: "255",
  decimal: "10,2",
  numeric: "10,2",
  bit: "1",
};

const AUTO_INCREMENT_TYPES = new Set([
  "tinyint",
  "smallint",
  "mediumint",
  "int",
  "integer",
  "bigint",
]);

const COLLATION_TYPES = new Set([
  "char",
  "varchar",
  "tinytext",
  "text",
  "mediumtext",
  "longtext",
  "enum",
  "set",
]);

const defaultLengthForType = (type: string) => TYPE_LENGTH_DEFAULTS[type] ?? "";
const supportsAutoIncrement = (type: string) => AUTO_INCREMENT_TYPES.has(type);
const supportsCollation = (type: string) => COLLATION_TYPES.has(type);
const stripAutoIncrement = (value: string) =>
  value
    .replace(/\bauto_increment\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

const emptyColumn = (collation: string): ColumnDefinition => ({
  field: "",
  type: "varchar",
  length: "255",
  suffix: "",
  collation,
  nullable: true,
  key: "",
  defaultValue: "",
  extra: "",
  privileges: "",
  comment: "",
});

export default function DbStructureView({ connectionId, database, table, refreshToken }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();
  const [rows, setRows] = useState<ColumnDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [defaultCollation, setDefaultCollation] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [editing, setEditing] = useState<{
    row: number;
    field: EditableField;
    value: string;
  } | null>(null);
  const [draft, setDraft] = useState<ColumnDefinition | null>(null);
  const [draftPosition, setDraftPosition] = useState<ColumnPosition>({ kind: "end" });
  const [applying, setApplying] = useState(false);
  const cancelEditRef = useRef(false);
  const request = useRef(0);

  useEffect(() => {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    dbTableColumns(connectionId, database, table)
      .then((result: DbQueryResult) => {
        if (current !== request.current) return;
        const indexOf = (name: string) =>
          result.columns.findIndex(
            (column) => column.name.toLowerCase() === name.toLowerCase(),
          );
        const indexes = {
          field: indexOf("Field"),
          type: indexOf("Type"),
          collation: indexOf("Collation"),
          nullable: indexOf("Null"),
          key: indexOf("Key"),
          defaultValue: indexOf("Default"),
          extra: indexOf("Extra"),
          privileges: indexOf("Privileges"),
          comment: indexOf("Comment"),
        };
        const read = (row: (string | null)[], index: number) =>
          index >= 0 ? (row[index] ?? "") : "";
        const next = result.rows.map((row) => {
          const parsed = parseColumnType(read(row, indexes.type));
          return {
            field: read(row, indexes.field),
            type: parsed.type,
            length: parsed.length,
            suffix: parsed.suffix,
            collation: read(row, indexes.collation),
            nullable: read(row, indexes.nullable).toUpperCase() !== "NO",
            key: read(row, indexes.key),
            defaultValue: read(row, indexes.defaultValue),
            extra: read(row, indexes.extra),
            privileges: read(row, indexes.privileges),
            comment: read(row, indexes.comment),
          };
        });
        setRows(next);
      })
      .catch((reason) => {
        if (current !== request.current) return;
        setRows([]);
        setError(errText(reason));
      })
      .finally(() => {
        if (current === request.current) setLoading(false);
      });
  }, [connectionId, database, table, refreshToken, reload]);

  useEffect(() => {
    let alive = true;
    dbDatabaseCollation(connectionId, database)
      .then((value) => {
        if (alive) setDefaultCollation(value ?? "");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [connectionId, database]);

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
      setReload((counter) => counter + 1);
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
      setReload((counter) => counter + 1);
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
      setReload((counter) => counter + 1);
    } catch (reason) {
      message.error(errText(reason));
    } finally {
      setApplying(false);
    }
  };

  const typeOptions = Array.from(
    new Set([...TYPE_OPTIONS, ...rows.map((row) => row.type).filter(Boolean)]),
  ).map((value) => ({ value, label: value }));

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
      setReload((counter) => counter + 1);
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

  const canUsePrimaryKey = (column: ColumnDefinition): boolean => {
    const type = column.type.toLowerCase();
    return ![
      "tinytext",
      "text",
      "mediumtext",
      "longtext",
      "tinyblob",
      "blob",
      "mediumblob",
      "longblob",
      "json",
      "geometry",
      "point",
      "linestring",
      "polygon",
      "multipoint",
      "multilinestring",
      "multipolygon",
      "geometrycollection",
    ].includes(type);
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
      setReload((counter) => counter + 1);
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
      setReload((counter) => counter + 1);
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
      setReload((counter) => counter + 1);
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
          setReload((counter) => counter + 1);
        } catch (reason) {
          message.error(errText(reason));
        }
      },
    });
  };

  const enabled = !applying && !draft;
  const oneSelected = selectedRows.size === 1 && enabled;

  const editCell = (
    rowIndex: number,
    field: EditableField,
    display: string,
    options?: { mono?: boolean; placeholder?: string; blankWhenEmpty?: boolean },
  ) => {
    const isEditing =
      editing?.row === rowIndex && editing.field === field;
    return (
      <td
        className={`db-structure-cell db-structure-editable${options?.mono ? " db-structure-mono" : ""}`}
        title={display || undefined}
        onClick={() => {
          if (!isEditing) startEdit(rowIndex, field);
        }}
      >
        {isEditing ? (
          <input
            className="db-structure-input"
            autoFocus
            value={editing.value}
            placeholder={options?.placeholder}
            onChange={(event) =>
              setEditing((current) =>
                current ? { ...current, value: event.target.value } : current,
              )
            }
            onFocus={(event) => {
              const end = event.currentTarget.value.length;
              event.currentTarget.setSelectionRange(end, end);
            }}
            onBlur={() => void finishEdit()}
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
          />
        ) : (
          <span className={display ? undefined : "db-structure-empty"}>
            {display || (options?.blankWhenEmpty ? "" : "—")}
          </span>
        )}
      </td>
    );
  };

  const draftInput = (
    field: EditableField,
    placeholder: string,
    mono = false,
  ) => (
    <input
      className={`db-structure-input db-structure-draft-input${mono ? " db-structure-mono" : ""}`}
      autoFocus={field === "field"}
      value={String(draft?.[field] ?? "")}
      placeholder={placeholder}
      onChange={(event) =>
        setDraft((current) =>
          current ? { ...current, [field]: event.target.value } : current,
        )
      }
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void applyDraft();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setDraft(null);
        }
      }}
    />
  );

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
      <div className="db-view-toolbar">
        <Button size="small" type="text" icon={<TableOutlined />}>
          {t("db.tableStructure")}
        </Button>
      </div>

      <div className="db-structure-area">
        {error ? (
          <div className="db-error">{error}</div>
        ) : loading && rows.length === 0 ? (
          <div className="db-grid-loading">
            <Spin size="small" />
          </div>
        ) : (
          <div className="db-structure-scroll">
            <table className="db-structure-table">
              <colgroup>
                <col style={{ width: "2.5%" }} />
                <col style={{ width: "17%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "7%" }} />
                <col style={{ width: "6.5%" }} />
                <col style={{ width: "5.5%" }} />
                <col style={{ width: "8.5%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "33%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="db-structure-gutter" />
                  <th>{t("db.colField")}</th>
                  <th>{t("db.colType")}</th>
                  <th>{t("db.colLength")}</th>
                  <th className="db-structure-center">{t("db.colNullable")}</th>
                  <th className="db-structure-center">{t("db.colKey")}</th>
                  <th>{t("db.colDefault")}</th>
                  <th className="db-structure-center">{t("db.colAutoIncrement")}</th>
                  <th>{t("db.colComment")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr
                    key={`${row.field}-${rowIndex}`}
                    className={selectedRows.has(rowIndex) ? "db-row-selected" : undefined}
                  >
                    <td
                      className="db-structure-gutter db-row-select"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => selectRow(rowIndex, event)}
                    />
                    {editCell(rowIndex, "field", row.field, { placeholder: "column" })}
                    <td className="db-structure-cell">
                      <Select
                        className="db-structure-type-select"
                        size="small"
                        variant="borderless"
                        value={row.type}
                        disabled={!enabled}
                        options={typeOptions}
                        onChange={(value) => void changeType(rowIndex, value)}
                        popupMatchSelectWidth={false}
                        style={{ width: "100%" }}
                      />
                    </td>
                    {editCell(rowIndex, "length", row.length, {
                      mono: true,
                      placeholder: "length",
                      blankWhenEmpty: true,
                    })}
                    <td className="db-structure-cell db-structure-check">
                      <Checkbox
                        checked={row.nullable}
                        disabled={!enabled}
                        onChange={(event) => void toggleNullable(rowIndex, event.target.checked)}
                      />
                    </td>
                    <td
                      className="db-structure-cell db-structure-key"
                      onClick={() => void togglePrimary(rowIndex)}
                    >
                      {row.key.toUpperCase().includes("PRI") ? (
                        <Tooltip title="PRIMARY KEY">
                          <KeyOutlined />
                        </Tooltip>
                      ) : (
                        <span className="db-structure-empty" />
                      )}
                    </td>
                    {editCell(rowIndex, "defaultValue", row.defaultValue, { mono: true, placeholder: "default" })}
                    <td className="db-structure-cell db-structure-check">
                      {supportsAutoIncrement(row.type) ? (
                        <Checkbox
                          checked={row.extra.toLowerCase().includes("auto_increment")}
                          disabled={!enabled}
                          onChange={(event) => void toggleAutoIncrement(rowIndex, event.target.checked)}
                        />
                      ) : (
                        <span className="db-structure-empty" />
                      )}
                    </td>
                    {editCell(rowIndex, "comment", row.comment, { placeholder: "comment" })}
                  </tr>
                ))}

                {draft && (
                  <tr className="db-structure-draft">
                    <td className="db-structure-gutter" />
                    <td className="db-structure-cell">{draftInput("field", "column")}</td>
                    <td className="db-structure-cell">
                      <Select
                        className="db-structure-type-select"
                        size="small"
                        variant="borderless"
                        value={draft.type}
                        options={typeOptions}
                        onChange={changeDraftType}
                        popupMatchSelectWidth={false}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td className="db-structure-cell">{draftInput("length", "length", true)}</td>
                    <td className="db-structure-cell db-structure-check">
                      <Checkbox
                        checked={draft.nullable}
                        onChange={(event) =>
                          setDraft((current) =>
                            current ? { ...current, nullable: event.target.checked } : current,
                          )
                        }
                      />
                    </td>
                    <td className="db-structure-cell db-structure-key">
                      <span className="db-structure-empty" />
                    </td>
                    <td className="db-structure-cell">{draftInput("defaultValue", "default", true)}</td>
                    <td className="db-structure-cell db-structure-check">
                      {supportsAutoIncrement(draft.type) ? (
                        <Checkbox
                          checked={draft.extra.toLowerCase().includes("auto_increment")}
                          onChange={(event) =>
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    extra: event.target.checked
                                      ? `${current.extra} auto_increment`.trim()
                                      : stripAutoIncrement(current.extra),
                                  }
                                : current,
                            )
                          }
                        />
                      ) : (
                        <span className="db-structure-empty" />
                      )}
                    </td>
                    <td className="db-structure-cell">{draftInput("comment", "comment")}</td>
                  </tr>
                )}
              </tbody>
            </table>

            {rows.length === 0 && !draft && (
              <div className="db-grid-empty">{t("db.emptyResult")}</div>
            )}
          </div>
        )}
      </div>

      <div className="db-pager db-structure-pager">
        <Tooltip title={t("db.addColumn")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<PlusOutlined />}
            disabled={!!draft || applying}
            onClick={startAdd}
          />
        </Tooltip>
        <Tooltip title={t("db.deleteColumn")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<MinusOutlined />}
            disabled={selectedRows.size === 0 || !enabled}
            onClick={deleteSelected}
          />
        </Tooltip>
        <Tooltip title={t("db.copyColumn")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<CopyOutlined />}
            disabled={!oneSelected}
            onClick={startCopy}
          />
        </Tooltip>
        <Tooltip title={t("db.insertColumn")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<InsertRowAboveOutlined />}
            disabled={!oneSelected}
            onClick={startInsert}
          />
        </Tooltip>
        <Tooltip title={t("db.applyDdl")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<CheckOutlined />}
            loading={applying}
            disabled={!canApply}
            onClick={() => void applyDraft()}
          />
        </Tooltip>
        <Tooltip title={t("common.cancel")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<CloseOutlined />}
            disabled={!draft || applying}
            onClick={() => setDraft(null)}
          />
        </Tooltip>
        <Tooltip title={t("db.refreshData")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<ReloadOutlined />}
            disabled={applying}
            onClick={() => {
              setDraft(null);
              setEditing(null);
              setReload((counter) => counter + 1);
            }}
          />
        </Tooltip>
        <Tooltip title={t("db.deleteColumn")}>
          <Button
            size="small"
            type="text"
            className="db-action-btn"
            icon={<DeleteOutlined />}
            disabled={selectedRows.size === 0 || !enabled}
            onClick={deleteSelected}
          />
        </Tooltip>
        {selectedRows.size > 0 && (
          <span className="db-muted">
            {t("db.selectedColumns", { count: selectedRows.size })}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span className="db-total">
          {t("db.structureCount", { count: rows.length })}
        </span>
      </div>
    </div>
  );
}
