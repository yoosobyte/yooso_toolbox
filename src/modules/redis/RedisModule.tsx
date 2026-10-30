import { useEffect, useState } from "react";
import { App as AntdApp, Button, Select, Segmented, Typography } from "antd";
import {
  CodeOutlined,
  DisconnectOutlined,
  KeyOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useRedisStore } from "../../stores/redisStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import RedisConnectionList from "./RedisConnectionList";
import RedisForm from "./RedisForm";
import RedisBrowser from "./RedisBrowser";
import { RedisIcon } from "./icons";
import RedisConsole from "./RedisConsole";
import {
  redisConnect,
  redisDisconnect,
  redisSelect,
  type RedisConfig,
  type RedisConnectInfo,
} from "./api";

type Tab = "keys" | "console";

export default function RedisModule() {
  const t = useT(useUiStore((state) => state.lang));
  const { message, modal } = AntdApp.useApp();
  const connections = useRedisStore((state) => state.connections);
  const load = useRedisStore((state) => state.load);
  const markUsed = useRedisStore((state) => state.markUsed);

  const [active, setActive] = useState<RedisConfig | null>(null);
  const [info, setInfo] = useState<RedisConnectInfo | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [db, setDb] = useState(0);
  const [tab, setTab] = useState<Tab>("keys");
  const [refreshToken, setRefreshToken] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RedisConfig | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const connect = async (config: RedisConfig) => {
    if (connectingId) return;
    setConnectingId(config.id);
    try {
      const next = await redisConnect(config);
      if (active && active.id !== config.id) {
        await redisDisconnect(active.id).catch(() => undefined);
      }
      setActive(config);
      setInfo(next);
      setDb(next.db);
      setTab("keys");
      setRefreshToken((value) => value + 1);
      markUsed(config.id);
      message.success(t("redis.connected"));
    } catch (error) {
      message.error(errText(error));
    } finally {
      setConnectingId(null);
    }
  };

  const disconnect = async () => {
    if (!active) return;
    try {
      await redisDisconnect(active.id);
    } catch {
      /* 连接可能已经失效，忽略 */
    }
    setActive(null);
    setInfo(null);
    setTab("keys");
    message.success(t("redis.disconnected"));
  };

  const changeDb = async (value: number) => {
    if (!active) return;
    try {
      await redisSelect(active.id, value);
      setDb(value);
      setRefreshToken((token) => token + 1);
    } catch (error) {
      message.error(errText(error));
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (config: RedisConfig) => {
    setEditing(config);
    setFormOpen(true);
  };

  const deleteConnection = (config: RedisConfig) => {
    modal.confirm({
      title: t("redis.deleteConnection"),
      content: t("redis.deleteConnectionConfirm", {
        name: config.name || `${config.host}:${config.port}`,
      }),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          if (active?.id === config.id) {
            await redisDisconnect(config.id).catch(() => undefined);
            setActive(null);
            setInfo(null);
          }
          await useRedisStore.getState().remove(config.id);
          message.success(t("common.delete"));
        } catch (error) {
          message.error(errText(error));
        }
      },
    });
  };

  const dbMax = Math.max(15, db);
  const dbOptions = Array.from({ length: dbMax + 1 }, (_, index) => ({
    value: index,
    label: String(index),
  }));

  return (
    <div className="module redis-module">
      <header className="module-head">
        <span className="module-icon">
          <CodeOutlined />
        </span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            Redis
          </Typography.Text>
          <div className="module-desc">{t("module.redisDesc")}</div>
        </div>
        <span style={{ flex: 1 }} />
        {active && info && (
          <div className="redis-head-status">
            <span className="redis-status-dot" />
            <span className="redis-head-name" title={active.name || active.host}>
              {active.name || `${active.host}:${active.port}`}
            </span>
            <span className="redis-head-ver">Redis {info.version}</span>
            <span className="redis-db-label">{t("redis.dbLabel")}</span>
            <Select
              size="small"
              value={db}
              options={dbOptions}
              className="redis-db-select"
              onChange={(value) => void changeDb(Number(value))}
            />
            <Button
              size="small"
              icon={<DisconnectOutlined />}
              onClick={() => void disconnect()}
            >
              {t("redis.disconnect")}
            </Button>
          </div>
        )}
      </header>

      <div className="redis-body">
        <RedisConnectionList
          connections={connections}
          activeId={active?.id ?? null}
          connectingId={connectingId}
          onConnect={(config) => void connect(config)}
          onCreate={openCreate}
          onEdit={openEdit}
          onDelete={deleteConnection}
        />

        <section className="redis-main">
          {active ? (
            <>
              <div className="redis-tabs">
                <Segmented
                  value={tab}
                  onChange={(value) => setTab(value as Tab)}
                  options={[
                    {
                      value: "keys",
                      label: (
                        <span className="redis-tab-label">
                          <KeyOutlined /> {t("redis.tabKeys")}
                        </span>
                      ),
                    },
                    {
                      value: "console",
                      label: (
                        <span className="redis-tab-label">
                          <CodeOutlined /> {t("redis.tabConsole")}
                        </span>
                      ),
                    },
                  ]}
                />
                <span style={{ flex: 1 }} />
                <span className="redis-hint">
                  {t("redis.connected")} · DB {db}
                </span>
              </div>

              <div
                className="redis-slot"
                style={{ display: tab === "keys" ? "flex" : "none" }}
              >
                <RedisBrowser
                  key={active.id}
                  connectionId={active.id}
                  db={db}
                  refreshToken={refreshToken}
                />
              </div>
              <div
                className="redis-slot"
                style={{ display: tab === "console" ? "flex" : "none" }}
              >
                <RedisConsole key={active.id} connectionId={active.id} db={db} />
              </div>
            </>
          ) : (
            <div className="redis-welcome">
              <span className="redis-welcome-icon">
                <RedisIcon />
              </span>
              <div className="redis-welcome-title">{t("redis.selectConnection")}</div>
              <div className="redis-hint">{t("redis.emptyConnections")}</div>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                {t("redis.newConnection")}
              </Button>
            </div>
          )}
        </section>
      </div>

      <RedisForm
        open={formOpen}
        initial={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(config) => {
          setEditing(null);
          void connect(config);
        }}
      />
    </div>
  );
}
