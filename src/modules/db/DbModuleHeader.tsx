import { Button, Typography } from "antd";
import { DisconnectOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { DbConfig, DbConnectInfo } from "./api";
import { DatabaseIcon } from "./icons";

interface Props {
  active: DbConfig | null;
  info: DbConnectInfo | null;
  onDisconnect: () => void;
}

/** 模块头部：标题、描述，以及已连接时的服务器状态与断开按钮 */
export default function DbModuleHeader({ active, info, onDisconnect }: Props) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <header className="module-head">
      <span className="module-icon">
        <DatabaseIcon />
      </span>
      <div>
        <Typography.Text strong style={{ fontSize: 14 }}>
          {t("module.db")}
        </Typography.Text>
        <div className="module-desc">{t("module.dbDesc")}</div>
      </div>
      <span style={{ flex: 1 }} />
      {active && info && (
        <div className="db-head-status">
          <span className="db-status-dot" />
          <span className="db-head-name" title={active.name || active.host}>
            {active.name || `${active.host}:${active.port}`}
          </span>
          <span className="db-head-ver">MySQL {info.version}</span>
          <span className="db-head-server">{info.server}</span>
          <Button size="small" icon={<DisconnectOutlined />} onClick={onDisconnect}>
            {t("db.disconnect")}
          </Button>
        </div>
      )}
    </header>
  );
}
