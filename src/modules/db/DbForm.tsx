import { useEffect, useState } from "react";
import { App as AntdApp, Button, Checkbox, Input, InputNumber, Modal, Select } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import { useDbStore } from "../../stores/dbStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { dbTest, type DbConfig } from "./api";
import { MysqlIcon } from "./icons";

interface Props {
  open: boolean;
  initial: DbConfig | null;
  onClose: () => void;
  onSaved: (config: DbConfig) => void;
}

const DB_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#a855f7",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#64748b",
];

function emptyDraft(): DbConfig {
  return {
    id: crypto.randomUUID(),
    name: "",
    color: "#3b82f6",
    kind: "mysql",
    host: "127.0.0.1",
    port: 3306,
    username: "root",
    password: "",
    savePassword: true,
    database: "",
    lastUsedAt: null,
    createdAt: null,
  };
}

export default function DbForm({ open, initial, onClose, onSaved }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();
  const [draft, setDraft] = useState<DbConfig>(emptyDraft);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setDraft({
        ...initial,
        kind: "mysql",
        username: initial.username ?? "root",
        password: initial.password ?? "",
        database: initial.database ?? "",
      });
    } else {
      setDraft(emptyDraft());
    }
    setTestResult(null);
  }, [open, initial]);

  const patch = (next: Partial<DbConfig>) => setDraft((prev) => ({ ...prev, ...next }));

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const info = await dbTest({
        ...draft,
        database: draft.database?.trim() ? draft.database.trim() : null,
      });
      setTestResult({ ok: true, text: t("db.testOk", { version: info.version }) });
    } catch (error) {
      setTestResult({ ok: false, text: t("db.testFailed", { error: errText(error) }) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!draft.host.trim()) return;
    setSaving(true);
    try {
      const next: DbConfig = {
        ...draft,
        name: draft.name.trim() || `${draft.host.trim()}:${draft.port}`,
        host: draft.host.trim(),
        username: draft.username?.trim() || "root",
        database: draft.database?.trim() ? draft.database.trim() : null,
      };
      const connections = await useDbStore.getState().save(next);
      const saved = connections.find((item) => item.id === next.id) ?? next;
      message.success(t("common.save"));
      onSaved(saved);
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
      title={initial ? t("db.editConnection") : t("db.newConnection")}
      onCancel={onClose}
      onOk={() => void save()}
      okText={t("common.save")}
      cancelText={t("common.cancel")}
      okButtonProps={{ disabled: !draft.host.trim() }}
      confirmLoading={saving}
      width={580}
      destroyOnHidden
    >
      <div className="db-form">
        <div className="db-form-grid">
          <label className="db-field">
            <span className="db-label">{t("db.name")}</span>
            <Input
              value={draft.name}
              placeholder={t("db.namePlaceholder")}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label className="db-field">
            <span className="db-label">{t("db.color")}</span>
            <div className="db-color-swatches">
              {Array.from(new Set([...DB_COLORS, draft.color].filter(Boolean))).map(
                (color) => {
                  const value = color ?? DB_COLORS[0];
                  return (
                    <button
                      key={value}
                      type="button"
                      className={`db-color-swatch${draft.color === value ? " active" : ""}`}
                      style={{
                        backgroundColor: `color-mix(in srgb, ${value} 22%, #fff)`,
                      }}
                      title={value}
                      onClick={() => patch({ color: value })}
                    >
                      {draft.color === value && <CheckOutlined />}
                    </button>
                  );
                },
              )}
            </div>
          </label>
          <label className="db-field">
            <span className="db-label">{t("db.type")}</span>
            <Select
              value={draft.kind}
              onChange={(value) => patch({ kind: value })}
              options={[
                {
                  value: "mysql",
                  label: (
                    <span className="db-type-option">
                      <MysqlIcon />
                      MySQL
                    </span>
                  ),
                },
              ]}
            />
            <span className="db-hint">{t("db.onlyMysqlHint")}</span>
          </label>

          <label className="db-field">
            <span className="db-label">{t("db.host")}</span>
            <Input
              value={draft.host}
              placeholder="127.0.0.1"
              onChange={(event) => patch({ host: event.target.value })}
            />
          </label>
          <label className="db-field">
            <span className="db-label">{t("db.port")}</span>
            <InputNumber
              min={1}
              max={65535}
              value={draft.port}
              style={{ width: "100%" }}
              onChange={(value) => patch({ port: Number(value) || 3306 })}
            />
          </label>

          <label className="db-field">
            <span className="db-label">{t("db.username")}</span>
            <Input
              value={draft.username ?? ""}
              placeholder="root"
              autoComplete="off"
              onChange={(event) => patch({ username: event.target.value })}
            />
          </label>
          <label className="db-field">
            <span className="db-label">{t("db.password")}</span>
            <Input.Password
              value={draft.password ?? ""}
              placeholder={t("db.passwordPlaceholder")}
              autoComplete="new-password"
              onChange={(event) => patch({ password: event.target.value })}
            />
          </label>

          <label className="db-field db-field-wide">
            <span className="db-label">{t("db.database")}</span>
            <Input
              value={draft.database ?? ""}
              placeholder={t("db.databasePlaceholder")}
              onChange={(event) => patch({ database: event.target.value })}
            />
          </label>
        </div>

        <div className="db-check">
          <Checkbox
            checked={draft.savePassword}
            onChange={(event) => patch({ savePassword: event.target.checked })}
          >
            {t("db.savePassword")}
          </Checkbox>
          <span className="db-hint">{t("db.savePasswordHint")}</span>
        </div>

        <div className="db-test-row">
          <Button size="small" onClick={() => void test()} loading={testing}>
            {testing ? t("db.testing") : t("db.test")}
          </Button>
          {testResult && (
            <span className={testResult.ok ? "db-test-ok" : "db-test-error"}>
              {testResult.text}
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}
