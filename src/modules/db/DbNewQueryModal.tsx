import { useEffect, useState } from "react";
import { App as AntdApp, Input, Modal } from "antd";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { isImeEnter } from "../../utils";

interface Props {
  open: boolean;
  database: string;
  onClose: () => void;
  onCreate: (name: string) => void;
}

export default function DbNewQueryModal({ open, database, onClose, onCreate }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const create = () => {
    const value = name.trim();
    if (!value) {
      message.warning(t("db.queryNameRequired"));
      return;
    }
    onCreate(value);
    onClose();
  };

  return (
    <Modal
      open={open}
      title={t("db.newQuery")}
      okText={t("db.createQuery")}
      cancelText={t("common.cancel")}
      onOk={create}
      onCancel={onClose}
    >
      <div className="db-field">
        <span className="db-label">{t("db.queryName")}</span>
        <Input
          autoFocus
          value={name}
          placeholder={t("db.queryNamePlaceholder")}
          onChange={(event) => setName(event.target.value)}
          onPressEnter={(event) => {
            if (isImeEnter(event)) return;
            create();
          }}
        />
        <span className="db-hint">
          {t("db.currentDatabase", { name: database })}
        </span>
      </div>
    </Modal>
  );
}
