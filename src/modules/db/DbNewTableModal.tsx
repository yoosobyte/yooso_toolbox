import { useEffect, useState } from "react";
import { App as AntdApp, Input, Modal } from "antd";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { dbExecDdl } from "./api";
import { qualified } from "./ddl";

interface Props {
  open: boolean;
  connectionId: string;
  database: string;
  onClose: () => void;
  onCreated: (table: string) => void;
}

export default function DbNewTableModal({
  open,
  connectionId,
  database,
  onClose,
  onCreated,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const create = async () => {
    const table = name.trim();
    if (!table) {
      message.warning(t("db.tableNameRequired"));
      return;
    }
    setSaving(true);
    try {
      await dbExecDdl(
        connectionId,
        `CREATE TABLE ${qualified(database, table)} (\`id\` BIGINT NOT NULL AUTO_INCREMENT, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
      );
      message.success(t("db.tableCreated"));
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
      title={t("db.newTable")}
      okText={t("db.createTable")}
      cancelText={t("common.cancel")}
      confirmLoading={saving}
      onOk={() => void create()}
      onCancel={onClose}
    >
      <div className="db-field">
        <span className="db-label">{t("db.tableName")}</span>
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
