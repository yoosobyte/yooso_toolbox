import { useEffect, useState } from "react";
import { App as AntdApp, Button, Form, Input, InputNumber, Modal, Radio, Space, Switch, Tag } from "antd";
import { FolderOpenOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { AuthType, SessionConfig } from "../../types";
import { SESSION_COLORS, errText } from "../../utils";
import { useSessionStore } from "../../stores/sessionStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { sshProbe } from "../../api";

interface Props {
  open: boolean;
  initial: SessionConfig | null;
  onClose: () => void;
  onSaved?: (config: SessionConfig) => void;
}

interface FormValues {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  savePassword: boolean;
  color: string;
}

const DEFAULTS: FormValues = {
  name: "",
  host: "",
  port: 22,
  username: "root",
  authType: "password",
  password: "",
  privateKeyPath: "",
  passphrase: "",
  savePassword: true,
  color: SESSION_COLORS[0],
};

export default function SessionForm({ open, initial, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>();
  const { message } = AntdApp.useApp();
  const lang = useUiStore((state) => state.lang);
  const t = useT(lang);
  const save = useSessionStore((state) => state.save);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [color, setColor] = useState<string>(SESSION_COLORS[0]);
  const authType = Form.useWatch("authType", form) ?? "password";
  const savePassword = Form.useWatch("savePassword", form) ?? true;

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    const values: FormValues = initial
      ? {
          name: initial.name,
          host: initial.host,
          port: initial.port,
          username: initial.username,
          authType: initial.authType ?? "password",
          password: initial.password ?? "",
          privateKeyPath: initial.privateKeyPath ?? "",
          passphrase: initial.passphrase ?? "",
          savePassword: initial.savePassword ?? true,
          color: initial.color || SESSION_COLORS[0],
        }
      : DEFAULTS;
    form.setFieldsValue(values);
    setColor(values.color);
  }, [open, initial, form]);

  const buildConfig = (values: FormValues): SessionConfig => ({
    id: initial?.id ?? crypto.randomUUID(),
    name: values.name.trim() || values.host.trim(),
    host: values.host.trim(),
    port: values.port ?? 22,
    username: values.username.trim(),
    authType: values.authType,
    password: values.authType === "password" ? values.password ?? "" : undefined,
    privateKeyPath: values.authType === "key" ? values.privateKeyPath ?? "" : undefined,
    passphrase: values.authType === "key" ? values.passphrase ?? "" : undefined,
    savePassword: values.savePassword,
    color: values.color,
    createdAt: initial?.createdAt ?? Math.floor(Date.now() / 1000),
    lastUsedAt: initial?.lastUsedAt,
  });

  const handleSave = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const config = buildConfig(values);
    setSaving(true);
    try {
      await save(config);
      message.success(initial ? t("form.updated") : t("form.created"));
      onSaved?.(config);
      onClose();
    } catch (error) {
      message.error(t("form.saveFailed", { error: errText(error) }));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setTesting(true);
    try {
      const result = await sshProbe(buildConfig(values));
      const detail = `${result.serverVersion ?? "SSH"}${
        result.fingerprint ? ` · ${result.fingerprint.slice(0, 23)}…` : ""
      }`;
      message.success(t("form.testOkShort", { detail }));
    } catch (error) {
      message.error(t("form.testFailed", { error: errText(error) }));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={initial ? t("form.editTitle") : t("form.newTitle")}
      onCancel={onClose}
      width={560}
      destroyOnHidden
      maskClosable={!saving}
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          <Button icon={<ThunderboltOutlined />} loading={testing} onClick={handleTest}>
            {t("form.test")}
          </Button>
          <Space>
            <Button onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>
              {t("common.save")}
            </Button>
          </Space>
        </div>
      }
    >
      <Form form={form} layout="vertical" requiredMark="optional" initialValues={DEFAULTS}>
        <Form.Item
          name="name"
          label={t("form.sessionName")}
          rules={[{ required: true, message: t("form.nameRequired") }]}
          extra={t("form.nameExtra")}
        >
          <Input placeholder={t("form.namePlaceholder")} maxLength={40} />
        </Form.Item>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px", gap: 12 }}>
          <Form.Item
            name="host"
            label={t("form.hostLabel")}
            rules={[{ required: true, message: t("form.hostRequired") }]}
          >
            <Input placeholder={t("form.hostPlaceholder")} autoComplete="off" />
          </Form.Item>
          <Form.Item name="port" label={t("form.portLabel")} rules={[{ required: true }]}>
            <InputNumber min={1} max={65535} style={{ width: "100%" }} />
          </Form.Item>
        </div>

        <Form.Item name="username" label={t("form.userLabel")} rules={[{ required: true, message: t("form.userRequired") }]}>
          <Input placeholder="root" autoComplete="off" />
        </Form.Item>

        <Form.Item name="authType" label={t("form.authType")}>
          <Radio.Group optionType="button" buttonStyle="solid">
            <Radio.Button value="password">{t("form.authPassword")}</Radio.Button>
            <Radio.Button value="key">{t("form.authKey")}</Radio.Button>
          </Radio.Group>
        </Form.Item>

        {authType === "password" ? (
          <Form.Item name="password" label={t("form.password")}>
            <Input.Password
              placeholder={t("form.passwordPlaceholder")}
              autoComplete="new-password"
              disabled={!savePassword}
            />
          </Form.Item>
        ) : (
          <>
            <Form.Item
              name="privateKeyPath"
              label={t("form.keyFile")}
              rules={[{ required: true, message: t("form.keyRequired") }]}
            >
              <Input
                placeholder="C:\\Users\\you\\.ssh\\id_ed25519"
                addonAfter={
                  <Button
                    type="text"
                    size="small"
                    icon={<FolderOpenOutlined />}
                    onClick={async () => {
                      const picked = await openDialog({
                        title: t("form.keyDialog"),
                        multiple: false,
                        directory: false,
                      });
                      if (typeof picked === "string") {
                        form.setFieldValue("privateKeyPath", picked);
                      }
                    }}
                  />
                }
              />
            </Form.Item>
            <Form.Item name="passphrase" label={t("form.passphraseLabel")}>
              <Input.Password placeholder={t("form.passphrasePlaceholder")} />
            </Form.Item>
          </>
        )}

        <Form.Item
          name="savePassword"
          label={t("form.saveCredential")}
          valuePropName="checked"
          extra={
            <Tag color="orange" bordered={false} style={{ marginTop: 4 }}>
              {t("form.saveCredentialHint")}
            </Tag>
          }
        >
          <Switch />
        </Form.Item>

        <Form.Item label={t("form.color")}>
          <div style={{ display: "flex", gap: 8 }}>
            {SESSION_COLORS.map((item) => (
              <button
                key={item}
                type="button"
                aria-label={item}
                onClick={() => {
                  setColor(item);
                  form.setFieldValue("color", item);
                }}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  cursor: "pointer",
                  background: item,
                  border: color === item ? "2px solid #e5e7eb" : "2px solid transparent",
                  boxShadow: color === item ? `0 0 0 3px ${item}44` : "none",
                }}
              />
            ))}
          </div>
        </Form.Item>
        <Form.Item name="color" hidden>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  );
}
