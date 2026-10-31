import { App as AntdApp, Input } from "antd";
import { copyText } from "../../clipboard";
import { saveText } from "../../save";
import { dbExecDdl, dbQuery, dbTableDdl } from "./api";
import { qualified } from "./ddl";
import { errText } from "../../utils";
import type { TFunction } from "../../i18n";
import { buildTableDumpSql, dumpFileName } from "./dbExport";
import { tableKey, type TableTarget } from "./dbModuleTypes";

interface Options {
  t: TFunction;
  activeId: string | null;
  closeTab: (key: string) => void;
  renameTableTab: (database: string, oldTable: string, newTable: string) => void;
  reloadAfterTableChange: (database: string) => void;
  closeTableMenu: () => void;
}

/** 表级操作：复制结构、导出 SQL、重命名/清空/删除表 */
export default function useDbTableActions({
  t,
  activeId,
  closeTab,
  renameTableTab,
  reloadAfterTableChange,
  closeTableMenu,
}: Options) {
  const { message, modal } = AntdApp.useApp();

  const copyTableStructure = async (database: string, table: string) => {
    if (!activeId) return;
    try {
      const ddl = await dbTableDdl(activeId, database, table);
      await copyText(ddl);
      message.success(t("db.structureCopied"));
    } catch (error) {
      message.error(errText(error));
    }
  };

  const exportTableSql = async (database: string, table: string) => {
    if (!activeId) return;
    try {
      const ddl = await dbTableDdl(activeId, database, table);
      const result = await dbQuery(
        activeId,
        database,
        `SELECT * FROM ${qualified(database, table)}`,
      );
      const path = await saveText(
        dumpFileName(database, table),
        buildTableDumpSql(database, table, ddl, result),
        [{ name: "SQL", extensions: ["sql"] }],
        "application/sql",
      );
      if (path) message.success(t("db.sqlSaved", { path }));
    } catch (error) {
      message.error(errText(error));
    }
  };

  const truncateTable = (target: TableTarget) => {
    closeTableMenu();
    if (!activeId) return;
    modal.confirm({
      title: t("db.truncateTable"),
      content: t("db.truncateConfirm", { table: target.table }),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await dbExecDdl(
            activeId,
            `TRUNCATE TABLE ${qualified(target.database, target.table)}`,
          );
          closeTab(tableKey(target.database, target.table));
          message.success(t("db.tableTruncated"));
          reloadAfterTableChange(target.database);
        } catch (reason) {
          message.error(errText(reason));
        }
      },
    });
  };

  const dropTable = (target: TableTarget) => {
    closeTableMenu();
    if (!activeId) return;
    modal.confirm({
      title: t("db.dropTable"),
      content: t("db.dropTableConfirm", { table: target.table }),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await dbExecDdl(
            activeId,
            `DROP TABLE ${qualified(target.database, target.table)}`,
          );
          closeTab(tableKey(target.database, target.table));
          message.success(t("db.tableDropped"));
          reloadAfterTableChange(target.database);
        } catch (reason) {
          message.error(errText(reason));
        }
      },
    });
  };

  const promptRenameTable = (target: TableTarget) => {
    if (!activeId) return;
    let nextName = target.table;
    modal.confirm({
      title: t("db.renameTable"),
      content: (
        <Input
          autoFocus
          defaultValue={target.table}
          placeholder={t("db.newTableName")}
          onChange={(event) => {
            nextName = event.target.value;
          }}
        />
      ),
      okText: t("common.save"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        const value = nextName.trim();
        if (!value) {
          message.warning(t("db.tableNameRequired"));
          return;
        }
        if (value === target.table) return;
        try {
          await dbExecDdl(
            activeId,
            `RENAME TABLE ${qualified(target.database, target.table)} TO ${qualified(target.database, value)}`,
          );
          message.success(t("db.tableRenamed"));
          renameTableTab(target.database, target.table, value);
        } catch (reason) {
          message.error(errText(reason));
        }
      },
    });
  };

  return { copyTableStructure, exportTableSql, truncateTable, dropTable, promptRenameTable };
}
