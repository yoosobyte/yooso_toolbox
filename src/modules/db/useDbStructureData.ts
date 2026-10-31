import { useEffect, useRef, useState } from "react";
import { errText } from "../../utils";
import { parseColumnType, type ColumnDefinition } from "./ddl";
import {
  dbDatabaseCollation,
  dbTableColumns,
  type DbQueryResult,
} from "./api";

interface Options {
  connectionId: string;
  database: string;
  table: string;
  refreshToken: number;
}

/**
 * 表结构页的数据来源：列定义、库默认排序规则和刷新计数。
 * 只负责取数，不涉及选中、编辑和 DDL 操作。
 */
export default function useDbStructureData({
  connectionId,
  database,
  table,
  refreshToken,
}: Options) {
  const [rows, setRows] = useState<ColumnDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [defaultCollation, setDefaultCollation] = useState("");
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

  const refresh = () => setReload((counter) => counter + 1);

  return { rows, loading, error, defaultCollation, reload, refresh };
}
