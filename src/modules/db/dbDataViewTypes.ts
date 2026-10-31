import type { DbFilter } from "./api";

export interface DbDataViewProps {
  connectionId: string;
  database: string;
  table: string;
  refreshToken: number;
}

export interface DraftFilter extends DbFilter {
  id: string;
  enabled: boolean;
  conjunction: "and" | "or";
}

export interface DbDataSort {
  column: string;
  dir: "asc" | "desc";
}

export const PAGE_SIZES = [50, 100, 200, 500];
export const OPERATORS = [
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

export function isUnary(operator: string): boolean {
  return operator === "isNull" || operator === "isNotNull";
}
