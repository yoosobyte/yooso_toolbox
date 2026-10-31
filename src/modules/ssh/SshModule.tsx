import { useState } from "react";
import { Button, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import SessionList from "./SessionList";
import { SshNavIcon } from "../../components/NavIcons";
import SessionForm from "./SessionForm";
import TerminalTabs from "./TerminalTabs";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { SessionConfig } from "../../types";

export default function SshModule() {
  const t = useT(useUiStore((state) => state.lang));
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SessionConfig | null>(null);
  const openTab = useWorkspaceStore((state) => state.openTab);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (config: SessionConfig) => {
    setEditing(config);
    setFormOpen(true);
  };

  return (
    <div className="module">
      <header className="module-head">
        <span className="module-icon">
          <SshNavIcon />
        </span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            SSH / SFTP
          </Typography.Text>
          <div className="module-desc">{t("module.sshDesc")}</div>
        </div>
        <span style={{ flex: 1 }} />
        <Button icon={<PlusOutlined />} onClick={openCreate}>
          {t("session.new")}
        </Button>
      </header>

      <div className="ssh-body">
        <SessionList onEdit={openEdit} />
        <div className="terminal-area">
          <TerminalTabs onCreate={openCreate} />
        </div>
      </div>

      <SessionForm
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(config) => {
          if (!editing) openTab(config);
        }}
      />
    </div>
  );
}
