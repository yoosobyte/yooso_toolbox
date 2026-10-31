import { useEffect, useState, type ReactNode } from "react";
import { App as AntdApp, Button, Spin } from "antd";
import { ImportOutlined, SafetyOutlined } from "@ant-design/icons";
import AppLogo from "./AppLogo";
import { useUiStore } from "./stores/uiStore";
import { useT } from "./i18n";
import { inTauri } from "./save";
import { vaultAutoUnlock, vaultReset, vaultStatus } from "./api";
import { importBackupFile, pickBackupFile, reloadApp } from "./backup";
import { errText } from "./utils";

/** 凭据库门禁：本机绑定自动解锁；解不开时只提供重置入口 */
export default function VaultGate({ children }: { children: ReactNode }) {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!inTauri()) {
      setReady(true);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const status = await vaultStatus();
        if (status.unlocked || !status.configured) {
          if (alive) setReady(true);
          return;
        }
        await vaultAutoUnlock();
        if (alive) setReady(true);
      } catch (reason) {
        if (alive) setError(errText(reason));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const reset = () => {
    modal.confirm({
      title: t("vault.reset"),
      content: t("vault.resetConfirm"),
      okText: t("vault.reset"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await vaultReset();
          setError(null);
          setReady(true);
          message.success(t("vault.resetDone"));
        } catch (reason) {
          message.error(errText(reason));
        }
      },
    });
  };

  const importFromBackup = async () => {
    const source = await pickBackupFile();
    if (!source) return;
    modal.confirm({
      title: t("vault.import"),
      content: t("vault.importResetHint"),
      okText: t("vault.import"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          // 旧凭据库解不开：先重置成本机新库，再导入备份
          await vaultReset();
          await importBackupFile(source);
          setError(null);
          message.success(t("backup.imported"));
          reloadApp();
        } catch (reason) {
          message.error(errText(reason));
        }
      },
    });
  };

  if (ready) return <>{children}</>;

  return (
    <div className="vault-screen">
      <div className="vault-card">
        <span className="vault-logo">
          <AppLogo />
        </span>
        <div className="vault-title">{t("vault.title")}</div>
        {error ? (
          <>
            <div className="vault-desc">{t("vault.autoFailed")}</div>
            <Button block icon={<ImportOutlined />} onClick={() => void importFromBackup()}>
              {t("vault.import")}
            </Button>
            <Button block icon={<SafetyOutlined />} onClick={reset}>
              {t("vault.reset")}
            </Button>
            <div className="vault-hint">{error}</div>
          </>
        ) : (
          <Spin />
        )}
        <div className="vault-hint">{t("vault.autoHint")}</div>
      </div>
    </div>
  );
}
