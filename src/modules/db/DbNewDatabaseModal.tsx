import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Input, Modal, Segmented, Select } from "antd";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { dbExecDdl } from "./api";
import { errText, isImeEnter } from "../../utils";

interface Props {
  open: boolean;
  connectionId: string;
  onClose: () => void;
  onCreated: (database: string) => void;
}

const CHARSETS = ["utf8mb4", "utf8", "gbk", "latin1"];

const COLLATIONS: Record<string, string[]> = {
  utf8mb4: [
    "utf8mb4_0900_ai_ci",
    "utf8mb4_general_ci",
    "utf8mb4_unicode_ci",
    "utf8mb4_bin",
  ],
  utf8: ["utf8_general_ci", "utf8_unicode_ci", "utf8_bin"],
  gbk: ["gbk_chinese_ci", "gbk_bin"],
  latin1: ["latin1_swedish_ci", "latin1_general_ci", "latin1_bin"],
};

const DEFAULT_COLLATION = "utf8mb4_0900_ai_ci";

/** 新建数据库（参照 Navicat：常规 / SQL 预览） */
export default function DbNewDatabaseModal({
  open,
  connectionId,
  onClose,
  onCreated,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();

  const [tab, setTab] = useState<"general" | "sql">("general");
  const [name, setName] = useState("");
  const [charset, setCharset] = useState("utf8mb4");
  const [collation, setCollation] = useState(DEFAULT_COLLATION);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab("general");
    setName("");
    setCharset("utf8mb4");
    setCollation(DEFAULT_COLLATION);
    setSaving(false);
  }, [open]);

  const sql = useMemo(
    () =>
      `CREATE DATABASE IF NOT EXISTS \`${name.trim()}\` DEFAULT CHARACTER SET ${charset} COLLATE ${collation};`,
    [name, charset, collation],
  );

  const submit = async () => {
    const value = name.trim();
    if (!value) {
      message.warning(t("db.databaseNameRequired"));
      return;
    }
    setSaving(true);
    try {
      await dbExecDdl(connectionId, sql);
      message.success(t("db.databaseCreated"));
      onCreated(value);
      onClose();
    } catch (error) {
      message.error(errText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("db.newDatabase")}
      width={560}
      onCancel={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            {t("db.ok")}
          </Button>
        </>
      }
    >
      <div className="db-newdb">
        <div className="db-newdb-tabs">
          <Segmented
            size="small"
            value={tab}
            onChange={(value) => setTab(value as "general" | "sql")}
            options={[
              { value: "general", label: t("db.general") },
              { value: "sql", label: t("db.sqlPreview") },
            ]}
          />
        </div>

        {tab === "general" ? (
          <div className="db-newdb-form">
            <div className="db-field">
              <span className="db-label">{t("db.databaseName")}</span>
              <Input
                autoFocus
                value={name}
                placeholder="demo"
                onChange={(event) => setName(event.target.value)}
                onPressEnter={(event) => {
                  if (isImeEnter(event)) return;
                  void submit();
                }}
              />
            </div>
            <div className="db-field">
              <span className="db-label">{t("db.charset")}</span>
              <Select
                value={charset}
                onChange={(value) => {
                  setCharset(value);
                  setCollation(COLLATIONS[value]?.[0] ?? DEFAULT_COLLATION);
                }}
                options={CHARSETS.map((item) => ({ value: item, label: item }))}
              />
            </div>
            <div className="db-field">
              <span className="db-label">{t("db.collation")}</span>
              <Select
                value={collation}
                onChange={setCollation}
                options={(COLLATIONS[charset] ?? []).map((item) => ({
                  value: item,
                  label: item,
                }))}
              />
            </div>
          </div>
        ) : (
          <pre className="db-newdb-sql">{sql}</pre>
        )}
      </div>
    </Modal>
  );
}
