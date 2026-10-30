export type ColumnPosition =
  | { kind: "end" }
  | { kind: "first" }
  | { kind: "after"; column: string };

export interface ColumnDefinition {
  field: string;
  type: string;
  length: string;
  suffix: string;
  collation: string;
  nullable: boolean;
  key: string;
  defaultValue: string;
  extra: string;
  privileges: string;
  comment: string;
}

export function quoteIdent(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

export function qualified(database: string, table: string): string {
  return `${quoteIdent(database)}.${quoteIdent(table)}`;
}

export function escapeSqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

export function parseColumnType(raw: string): {
  type: string;
  length: string;
  suffix: string;
} {
  const value = raw.trim();
  const match = value.match(/^([A-Za-z0-9_]+)(?:\(([^)]*)\))?(.*)$/);
  if (!match) return { type: value, length: "", suffix: "" };
  return {
    type: match[1] ?? value,
    length: match[2] ?? "",
    suffix: (match[3] ?? "").trim(),
  };
}

export function columnTypeSql(column: ColumnDefinition): string {
  return `${column.type}${column.length ? `(${column.length})` : ""}${
    column.suffix ? ` ${column.suffix}` : ""
  }`;
}

function safeFragment(value: string, label: string): string {
  if (/;|--|\/\*|\*\//.test(value)) {
    throw new Error(`${label} 包含非法字符`);
  }
  return value;
}

export function defaultLiteral(value: string): string {
  if (
    /^(NULL|CURRENT_TIMESTAMP(?:\(\d*\))?|CURRENT_DATE(?:\(\d*\))?|CURRENT_TIME(?:\(\d*\))?)$/i.test(
      value,
    ) ||
    /^-?\d+(\.\d+)?$/.test(value)
  ) {
    return value;
  }
  return `'${escapeSqlString(value)}'`;
}

export function columnDefinitionSql(column: ColumnDefinition): string {
  let clause = `${quoteIdent(column.field)} ${safeFragment(columnTypeSql(column), "类型")}`;
  clause += column.nullable ? " NULL" : " NOT NULL";

  if (column.collation) {
    if (!/^[A-Za-z0-9_]+$/.test(column.collation)) {
      throw new Error("排序规则包含非法字符");
    }
    clause += ` COLLATE ${column.collation}`;
  }

  if (column.defaultValue !== "") {
    clause += ` DEFAULT ${defaultLiteral(column.defaultValue)}`;
  }

  const extra = column.extra.replace(/\bDEFAULT_GENERATED\b/gi, "").trim();
  if (extra) clause += ` ${safeFragment(extra, "Extra")}`;

  if (column.comment) clause += ` COMMENT '${escapeSqlString(column.comment)}'`;

  return clause;
}

export function buildAddColumnSql(input: {
  database: string;
  table: string;
  column: ColumnDefinition;
  position: ColumnPosition;
}): string {
  if (!input.column.field.trim() || !input.column.type.trim()) {
    throw new Error("列名和类型不能为空");
  }
  let position = "";
  if (input.position.kind === "first") {
    position = " FIRST";
  } else if (input.position.kind === "after" && input.position.column) {
    position = ` AFTER ${quoteIdent(input.position.column)}`;
  }
  return `ALTER TABLE ${qualified(input.database, input.table)} ADD COLUMN ${columnDefinitionSql(
    input.column,
  )}${position}`;
}

export function buildModifyColumnSql(input: {
  database: string;
  table: string;
  oldName: string;
  column: ColumnDefinition;
}): string {
  if (!input.column.field.trim() || !input.column.type.trim()) {
    throw new Error("列名和类型不能为空");
  }
  const action =
    input.oldName === input.column.field
      ? `MODIFY COLUMN ${columnDefinitionSql(input.column)}`
      : `CHANGE COLUMN ${quoteIdent(input.oldName)} ${columnDefinitionSql(input.column)}`;
  return `ALTER TABLE ${qualified(input.database, input.table)} ${action}`;
}

export function buildDropColumnsSql(
  database: string,
  table: string,
  columns: string[],
): string {
  if (columns.length === 0) throw new Error("请先选择要删除的列");
  return `ALTER TABLE ${qualified(database, table)} ${columns
    .map((column) => `DROP COLUMN ${quoteIdent(column)}`)
    .join(", ")}`;
}

export function nextCopyName(base: string, used: Set<string>): string {
  const name = base.trim() || "column";
  let candidate = `${name}_copy`;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${name}_copy${index}`;
    index += 1;
  }
  return candidate;
}
