import { useEffect, useState } from "react";
import { App as AntdApp, Input, Modal } from "antd";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { dbCloneTable } from "./api";

interface Props {
  open: boolean;
  connectionId: string;
  database: string;
  sourceTable: string;
  withData: boolean;
  onClose: () => void;
  onCreated: (table: string) => void;
}

export default function DbCloneTableModal({
  open,
  connectionId,
  database,
  sourceTable,
  withData,
  onClose,
  onCreated,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(`${sourceTable}_copy`);
  }, [open, sourceTable]);

  const create = async () => {
    const table = name.trim();
    if (!table) {
      message.warning(t("db.tableNameRequired"));
      return;
    }
    setSaving(true);
    try {
      await dbCloneTable(connectionId, database, sourceTable, table, withData);
      message.success(t("db.tableCopied"));
      onCreated(table);
      onClose();
    } catch (reason) {
      message.error(errText(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={withData ? t("db.copyStructureData") : t("db.copyStructure")}
      okText={t("db.createTable")}
      cancelText={t("common.cancel")}
      confirmLoading={saving}
      onOk={() => void create()}
      onCancel={onClose}
    >
      <div className="db-field">
        <span className="db-label">{t("db.newTableName")}</span>
        <Input
          autoFocus
          value={name}
          placeholder={t("db.tableNamePlaceholder")}
          onChange={(event) => setName(event.target.value)}
          onPressEnter={() => void create()}
        />
      </div>
    </Modal>
  );
}
