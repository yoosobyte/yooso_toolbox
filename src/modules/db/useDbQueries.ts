import { useState } from "react";
import { loadQueries, saveQueries, type DbQueryDef } from "./queries";

/** SQL 查询定义（页签内容）的加载、更新与本地持久化 */
export default function useDbQueries() {
  const [queryDefs, setQueryDefs] = useState<DbQueryDef[]>(() => loadQueries());

  const addQuery = (query: DbQueryDef) => {
    const next = [...queryDefs, query];
    setQueryDefs(next);
    saveQueries(next);
  };

  const updateQuerySql = (id: string, sql: string) => {
    setQueryDefs((previous) => {
      const next = previous.map((query) =>
        query.id === id ? { ...query, sql } : query,
      );
      saveQueries(next);
      return next;
    });
  };

  const renameQuery = (query: DbQueryDef, name: string) => {
    const next = queryDefs.map((item) =>
      item.id === query.id ? { ...item, name } : item,
    );
    setQueryDefs(next);
    saveQueries(next);
  };

  const removeQuery = (id: string) => {
    const next = queryDefs.filter((item) => item.id !== id);
    setQueryDefs(next);
    saveQueries(next);
  };

  return { queryDefs, addQuery, updateQuerySql, renameQuery, removeQuery };
}
