import { useEffect, useState } from "react";
import { loadQueries, saveQueries, type DbQueryDef } from "./queries";

/** SQL 查询定义（页签内容）的加载、更新与本地持久化 */
export default function useDbQueries() {
  const [queryDefs, setQueryDefs] = useState<DbQueryDef[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadQueries().then((list) => {
      if (!alive) return;
      setQueryDefs(list);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const addQuery = (query: DbQueryDef) => {
    const next = [...queryDefs, query];
    setQueryDefs(next);
    if (loaded) void saveQueries(next);
  };

  const updateQuerySql = (id: string, sql: string) => {
    setQueryDefs((previous) => {
      const next = previous.map((query) =>
        query.id === id ? { ...query, sql } : query,
      );
      if (loaded) void saveQueries(next);
      return next;
    });
  };

  const renameQuery = (query: DbQueryDef, name: string) => {
    const next = queryDefs.map((item) =>
      item.id === query.id ? { ...item, name } : item,
    );
    setQueryDefs(next);
    if (loaded) void saveQueries(next);
  };

  const removeQuery = (id: string) => {
    const next = queryDefs.filter((item) => item.id !== id);
    setQueryDefs(next);
    if (loaded) void saveQueries(next);
  };

  return { queryDefs, addQuery, updateQuerySql, renameQuery, removeQuery };
}
