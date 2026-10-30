import { useEffect, useState } from "react";
import { App as AntdApp, Button, Checkbox, Input, InputNumber, Modal } from "antd";
import { useRedisStore } from "../../stores/redisStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { redisTest, type RedisConfig } from "./api";

interface Props {
  open: boolean;
  initial: RedisConfig | null;
  onClose: () => void;
  onSaved: (config: RedisConfig) => void;
}

function emptyDraft(): RedisConfig {
  return {
    id: crypto.randomUUID(),
    name: "",
    host: "127.0.0.1",
    port: 6379,
    username: "",
    password: "",
    savePassword: true,
    db: 0,
    color: null,
    lastUsedAt: null,
    createdAt: null,
  };
}

export default function RedisForm({ open, initial, onClose, onSaved }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();
  const [draft, setDraft] = useState<RedisConfig>(emptyDraft);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setDraft({
        ...initial,
        username: initial.username ?? "",
        password: initial.password ?? "",
      });
    } else {
      setDraft(emptyDraft());
    }
    setTestResult(null);
  }, [open, initial]);

  const patch = (next: Partial<RedisConfig>) => setDraft((prev) => ({ ...prev, ...next }));

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const info = await redisTest(draft);
      setTestResult({ ok: true, text: t("redis.testOk", { version: info.version }) });
    } catch (error) {
      setTestResult({ ok: false, text: t("redis.testFailed", { error: errText(error) }) });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!draft.host.trim()) return;
    setSaving(true);
    try {
      const next = {
        ...draft,
        name: draft.name.trim() || `${draft.host.trim()}:${draft.port}`,
        host: draft.host.trim(),
        username: draft.username?.trim() ? draft.username.trim() : null,
      };
      const connections = await useRedisStore.getState().save(next);
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
      title={initial ? t("redis.editConnection") : t("redis.newConnection")}
      onCancel={onClose}
      onOk={() => void save()}
      okText={t("common.save")}
      okButtonProps={{ disabled: !draft.host.trim() }}
      cancelText={t("common.cancel")}
      confirmLoading={saving}
      width={560}
      destroyOnHidden
    >
      <div className="redis-form">
        <div className="redis-form-grid">
          <label className="redis-field">
            <span className="redis-label">{t("redis.connectionName")}</span>
            <Input
              value={draft.name}
              placeholder={t("redis.connectionNamePlaceholder")}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </label>
          <label className="redis-field">
            <span className="redis-label">{t("redis.db")}</span>
            <InputNumber
              min={0}
              max={255}
              value={draft.db}
              onChange={(value) => patch({ db: Number(value) || 0 })}
              style={{ width: "100%" }}
            />
          </label>
          <label className="redis-field redis-field-host">
            <span className="redis-label">{t("redis.host")}</span>
            <Input
              value={draft.host}
              placeholder="127.0.0.1"
              onChange={(event) => patch({ host: event.target.value })}
            />
          </label>
          <label className="redis-field">
            <span className="redis-label">{t("redis.port")}</span>
            <InputNumber
              min={1}
              max={65535}
              value={draft.port}
              onChange={(value) => patch({ port: Number(value) || 6379 })}
              style={{ width: "100%" }}
            />
          </label>
          <label className="redis-field">
            <span className="redis-label">{t("redis.username")}</span>
            <Input
              value={draft.username ?? ""}
              placeholder={t("redis.usernamePlaceholder")}
              autoComplete="off"
              onChange={(event) => patch({ username: event.target.value })}
            />
          </label>
          <label className="redis-field">
            <span className="redis-label">{t("redis.password")}</span>
            <Input.Password
              value={draft.password ?? ""}
              placeholder={t("redis.passwordPlaceholder")}
              autoComplete="new-password"
              onChange={(event) => patch({ password: event.target.value })}
            />
          </label>
        </div>

        <div className="redis-check">
          <Checkbox
            checked={draft.savePassword}
            onChange={(event) => patch({ savePassword: event.target.checked })}
          >
            {t("redis.savePassword")}
          </Checkbox>
          <span className="redis-hint">{t("redis.savePasswordHint")}</span>
        </div>

        <div className="redis-test-row">
          <Button size="small" onClick={() => void test()} loading={testing}>
            {testing ? t("redis.testing") : t("redis.test")}
          </Button>
          {testResult && (
            <span className={testResult.ok ? "redis-test-ok" : "redis-test-error"}>
              {testResult.text}
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}
