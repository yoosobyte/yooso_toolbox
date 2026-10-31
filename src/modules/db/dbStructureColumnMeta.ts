import type { ColumnDefinition } from "./ddl";
import type { StructureTypeOption } from "./dbStructureTypes";

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

export const defaultLengthForType = (type: string) => TYPE_LENGTH_DEFAULTS[type] ?? "";
export const supportsAutoIncrement = (type: string) => AUTO_INCREMENT_TYPES.has(type);
export const supportsCollation = (type: string) => COLLATION_TYPES.has(type);
export const stripAutoIncrement = (value: string) =>
  value
    .replace(/\bauto_increment\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

export const emptyColumn = (collation: string): ColumnDefinition => ({
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

export function typeOptionsFor(rows: ColumnDefinition[]): StructureTypeOption[] {
  return Array.from(
    new Set([...TYPE_OPTIONS, ...rows.map((row) => row.type).filter(Boolean)]),
  ).map((value) => ({ value, label: value }));
}

export const canUsePrimaryKey = (column: ColumnDefinition): boolean => {
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
