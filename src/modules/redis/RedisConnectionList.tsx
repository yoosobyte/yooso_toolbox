import { Button, Tooltip } from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { RedisIcon } from "./icons";
import type { RedisConfig } from "./api";

interface Props {
  width: number;
  connections: RedisConfig[];
  activeId: string | null;
  connectingId: string | null;
  onConnect: (config: RedisConfig) => void;
  onCreate: () => void;
  onEdit: (config: RedisConfig) => void;
  onDelete: (config: RedisConfig) => void;
}

export default function RedisConnectionList({
  width,
  connections,
  activeId,
  connectingId,
  onConnect,
  onCreate,
  onEdit,
  onDelete,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <aside className="redis-side" style={{ width }}>
      <Button type="default" block icon={<PlusOutlined />} onClick={onCreate}>
        {t("redis.newConnection")}
      </Button>

      <div className="redis-side-card">
        <div className="redis-side-head">
          <RedisIcon />
          <span>{t("redis.connections")}</span>
          <span className="redis-count">{connections.length}</span>
        </div>

        <div className="redis-conn-scroll">
          {connections.length === 0 && (
            <div className="redis-side-empty">{t("redis.emptyConnections")}</div>
          )}

          {connections.map((config) => {
            const active = config.id === activeId;
            const connecting = config.id === connectingId;
            return (
              <div
                key={config.id}
                className={`redis-conn${active ? " active" : ""}`}
                onClick={() => onConnect(config)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onConnect(config);
                  }
                }}
              >
                <div className="redis-conn-name">
                  <span className={`redis-conn-dot${connecting ? " busy" : ""}`} />
                  <span className="redis-conn-title">{config.name || `${config.host}:${config.port}`}</span>
                </div>
                <div className="redis-conn-host">
                  {config.host}:{config.port}
                  {config.db > 0 ? ` · DB ${config.db}` : ""}
                </div>
                {connecting && <div className="redis-connecting">{t("redis.connecting")}</div>}

                <div className="redis-conn-actions">
                  <Tooltip title={t("redis.editConnection")}>
                    <button
                      type="button"
                      className="redis-icon-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit(config);
                      }}
                    >
                      <EditOutlined />
                    </button>
                  </Tooltip>
                  <Tooltip title={t("redis.deleteConnection")}>
                    <button
                      type="button"
                      className="redis-icon-btn danger"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(config);
                      }}
                    >
                      <DeleteOutlined />
                    </button>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
