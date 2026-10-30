import { useEffect, useRef, useState } from "react";
import { App as AntdApp, Button, Input, Select, Spin, Tooltip } from "antd";
import {
  CheckOutlined,
  DeleteOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { dbExecDdl, dbTableColumns, dbTableIndexes } from "./api";
import { escapeSqlString, qualified, quoteIdent } from "./ddl";

interface Props {
  connectionId: string;
  database: string;
  table: string;
}

interface IndexRow {
  originalName: string;
  name: string;
  columns: string[];
  unique: boolean;
  method: string;
  comment: string;
  primary: boolean;
}

export default function DbIndexView({ connectionId, database, table }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();
  const [rows, setRows] = useState<IndexRow[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const request = useRef(0);

  useEffect(() => {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    const load = async () => {
      const result = await dbTableIndexes(connectionId, database, table);
      let fieldNames: string[] = [];
      try {
        const columns = await dbTableColumns(connectionId, database, table);
        const fieldIndex = columns.columns.findIndex(
          (column) => column.name.toLowerCase() === "field",
        );
        if (fieldIndex >= 0) {
          fieldNames = columns.rows
            .map((row) => row[fieldIndex] ?? "")
            .filter(Boolean);
        }
      } catch {
        fieldNames = [];
      }
      if (current !== request.current) return;
      const indexOf = (name: string) =>
        result.columns.findIndex(
          (column) => column.name.toLowerCase() === name.toLowerCase(),
        );
      const indexes = {
        key: indexOf("Key_name"),
        nonUnique: indexOf("Non_unique"),
        seq: indexOf("Seq_in_index"),
        column: indexOf("Column_name"),
        method: indexOf("Index_type"),
        comment: indexOf("Index_comment"),
      };
      const grouped = new Map<
        string,
        { columns: { seq: number; name: string }[]; unique: boolean; method: string; comment: string }
      >();
      result.rows.forEach((row) => {
        const name = row[indexes.key] ?? "";
        if (!name) return;
        const entry = grouped.get(name) ?? {
          columns: [],
          unique: (row[indexes.nonUnique] ?? "1") === "0",
          method: row[indexes.method] ?? "BTREE",
          comment: row[indexes.comment] ?? "",
        };
        entry.columns.push({
          seq: Number(row[indexes.seq] ?? "0"),
          name: row[indexes.column] ?? "",
        });
        grouped.set(name, entry);
      });
      const next: IndexRow[] = Array.from(grouped.entries()).map(([name, entry]) => ({
        originalName: name,
        name,
        columns: entry.columns
          .sort((a, b) => a.seq - b.seq)
          .map((column) => column.name)
          .filter(Boolean),
        unique: entry.unique,
        method: entry.method,
        comment: entry.comment,
        primary: name.toUpperCase() === "PRIMARY",
      }));
      const allFields = new Set(fieldNames);
      next.forEach((row) => row.columns.forEach((field) => allFields.add(field)));
      setFields(Array.from(allFields));
      setRows(next);
    };
    load()
      .catch((reason) => {
        if (current !== request.current) return;
        setRows([]);
        setError(errText(reason));
      })
      .finally(() => {
        if (current === request.current) setLoading(false);
      });
  }, [connectionId, database, table, reload]);

  const patch = (index: number, changes: Partial<IndexRow>) => {
    setRows((previous) =>
      previous.map((row, rowIndex) => (rowIndex === index ? { ...row, ...changes } : row)),
    );
  };

  const add = () => {
    setRows((previous) => [
      ...previous,
      {
        originalName: "",
        name: "",
        columns: [],
        unique: false,
        method: "BTREE",
        comment: "",
        primary: false,
      },
    ]);
  };

  const save = async (index: number) => {
    if (saving) return;
    const row = rows[index];
    if (!row || row.primary) return;
    const name = row.name.trim();
    if (!name) {
      message.warning(t("db.indexNameRequired"));
      return;
    }
    if (row.columns.length === 0) {
      message.warning(t("db.indexFieldsRequired"));
      return;
    }
    const columns = row.columns.map(quoteIdent).join(", ");
    const method = row.method ? ` USING ${row.method}` : "";
    const comment = row.comment.trim()
      ? ` COMMENT '${escapeSqlString(row.comment.trim())}'`
      : "";
    const prefix = row.unique ? "UNIQUE " : "";
    const sql = row.originalName
      ? `ALTER TABLE ${qualified(database, table)} DROP INDEX ${quoteIdent(row.originalName)}, ADD ${prefix}INDEX ${quoteIdent(name)} (${columns})${method}${comment}`
      : `CREATE ${prefix}INDEX ${quoteIdent(name)} ON ${qualified(database, table)} (${columns})${method}${comment}`;
    setSaving(true);
    try {
      await dbExecDdl(connectionId, sql);
      message.success(t("db.indexSaved"));
      setReload((value) => value + 1);
    } catch (reason) {
      message.error(errText(reason));
    } finally {
      setSaving(false);
    }
  };

  const remove = (index: number) => {
    const row = rows[index];
    if (!row || row.primary || saving) return;
    if (!row.originalName) {
      setRows((previous) => previous.filter((_item, rowIndex) => rowIndex !== index));
      return;
    }
    modal.confirm({
      title: t("db.deleteIndex"),
      content: t("db.deleteIndexConfirm", { name: row.originalName }),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await dbExecDdl(
            connectionId,
            `ALTER TABLE ${qualified(database, table)} DROP INDEX ${quoteIdent(row.originalName)}`,
          );
          message.success(t("db.indexDeleted"));
          setReload((value) => value + 1);
        } catch (reason) {
          message.error(errText(reason));
        }
      },
    });
  };

  const methodOptions = Array.from(
    new Set(["BTREE", "HASH", ...rows.map((row) => row.method).filter(Boolean)]),
  ).map((value) => ({ value, label: value }));

  return (
    <div className="db-index-view">
      <div className="db-view-toolbar">
        <Button size="small" type="text" icon={<KeyOutlined />}>
          {t("db.indexes")}
        </Button>
        <span style={{ flex: 1 }} />
        <Tooltip title={t("db.refreshData")}>
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => setReload((value) => value + 1)}
          />
        </Tooltip>
        <Button
          size="small"
          type="default"
          icon={<PlusOutlined />}
          onClick={add}
        >
          {t("db.addIndex")}
        </Button>
      </div>

      {error && <div className="db-error">{error}</div>}

      <div className="db-index-scroll">
        {loading && rows.length === 0 ? (
          <div className="db-grid-loading">
            <Spin size="small" />
          </div>
        ) : (
          <table className="db-index-table">
            <colgroup>
              <col style={{ width: "20%" }} />
              <col style={{ width: "30%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "19%" }} />
              <col style={{ width: "6%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t("db.indexName")}</th>
                <th>{t("db.indexFields")}</th>
                <th>{t("db.indexType")}</th>
                <th>{t("db.indexMethod")}</th>
                <th>{t("db.indexComment")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const disabled = row.primary || saving;
                const unsupportedMethod = !["BTREE", "HASH"].includes(row.method);
                return (
                  <tr key={row.originalName || `new-${index}`}>
                    <td>
                      {row.primary ? (
                        <span className="db-index-primary">{row.name}</span>
                      ) : (
                        <Input
                          size="small"
                          value={row.name}
                          disabled={saving}
                          onChange={(event) => patch(index, { name: event.target.value })}
                        />
                      )}
                    </td>
                    <td>
                      <Select
                        size="small"
                        mode="multiple"
                        value={row.columns}
                        disabled={disabled}
                        maxTagCount="responsive"
                        options={fields.map((field) => ({ value: field, label: field }))}
                        onChange={(value) => patch(index, { columns: value })}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <Select
                        size="small"
                        value={row.unique ? "unique" : "normal"}
                        disabled={disabled}
                        options={[
                          { value: "normal", label: t("db.indexNormal") },
                          { value: "unique", label: t("db.indexUnique") },
                        ]}
                        onChange={(value) => patch(index, { unique: value === "unique" })}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <Select
                        size="small"
                        value={row.method}
                        disabled={disabled || unsupportedMethod}
                        options={methodOptions}
                        onChange={(value) => patch(index, { method: value })}
                        style={{ width: "100%" }}
                      />
                    </td>
                    <td>
                      <Input
                        size="small"
                        value={row.comment}
                        disabled={disabled}
                        placeholder={t("db.indexComment")}
                        onChange={(event) => patch(index, { comment: event.target.value })}
                      />
                    </td>
                    <td className="db-index-actions">
                      {!row.primary && (
                        <>
                          <Tooltip title={t("db.saveIndex")}>
                            <Button
                              size="small"
                              type="text"
                              className="db-action-btn"
                              icon={<CheckOutlined />}
                              loading={saving}
                              disabled={!row.name.trim() || row.columns.length === 0 || unsupportedMethod}
                              onClick={() => void save(index)}
                            />
                          </Tooltip>
                          <Tooltip title={t("db.deleteIndex")}>
                            <Button
                              size="small"
                              type="text"
                              className="db-action-btn"
                              icon={<DeleteOutlined />}
                              disabled={saving}
                              onClick={() => remove(index)}
                            />
                          </Tooltip>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="db-pager">
        <span style={{ flex: 1 }} />
        <span className="db-total">
          {t("db.indexCount", { count: rows.length })}
        </span>
      </div>
    </div>
  );
}
