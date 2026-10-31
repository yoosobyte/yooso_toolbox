import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Dropdown, Input, Tag, Tooltip, Typography } from "antd";
import type { MenuProps } from "antd";
import {
  ApiOutlined,
  LoadingOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  PushpinOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useSessionStore } from "../../stores/sessionStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { SessionConfig } from "../../types";
import { copyText } from "../../clipboard";
import { errText } from "../../utils";

interface Props {
  onEdit: (config: SessionConfig) => void;
}

export default function SessionList({ onEdit }: Props) {
  const { message, modal } = AntdApp.useApp();
  const lang = useUiStore((state) => state.lang);
  const t = useT(lang);
  const sessions = useSessionStore((state) => state.sessions);
  const loading = useSessionStore((state) => state.loading);
  const loaded = useSessionStore((state) => state.loaded);
  const load = useSessionStore((state) => state.load);
  const remove = useSessionStore((state) => state.remove);
  const markUsed = useSessionStore((state) => state.markUsed);
  const openTab = useWorkspaceStore((state) => state.openTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const [keyword, setKeyword] = useState("");
  /** 同一时间只允许一个会话菜单打开：右键与「…」互斥，后打开的覆盖先打开的 */
  const [openMenu, setOpenMenu] = useState<{
    id: string;
    trigger: "context" | "dots";
  } | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return sessions;
    return sessions.filter((item) =>
      `${item.name} ${item.host} ${item.username} ${item.port}`.toLowerCase().includes(kw),
    );
  }, [sessions, keyword]);

  const connect = (config: SessionConfig) => {
    openTab(config);
    markUsed(config.id);
  };

  const handleDelete = (config: SessionConfig) => {
    modal.confirm({
      title: t("session.deleteTitle"),
      content: t("session.deleteConfirm", { name: config.name }),
      okText: t("common.delete"),
      okButtonProps: { danger: true },
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          await remove(config.id);
          tabs.filter((tab) => tab.configId === config.id).forEach((tab) => closeTab(tab.id));
          message.success(t("session.deleted"));
        } catch (error) {
          message.error(t("session.deleteFailed", { error: errText(error) }));
        }
      },
    });
  };

  const handleClone = async (config: SessionConfig) => {
    const clone: SessionConfig = {
      ...config,
      id: crypto.randomUUID(),
      name: `${config.name}${t("session.cloneSuffix")}`,
      pinned: false,
      lastUsedAt: undefined,
      createdAt: Math.floor(Date.now() / 1000),
    };
    try {
      await useSessionStore.getState().save(clone);
      message.success(t("session.cloneDone"));
    } catch (error) {
      message.error(t("session.cloneFailed", { error: errText(error) }));
    }
  };

  const handlePin = async (config: SessionConfig) => {
    try {
      await useSessionStore.getState().save({ ...config, pinned: !config.pinned });
      message.success(config.pinned ? t("session.unpinDone") : t("session.pinDone"));
    } catch (error) {
      message.error(t("session.pinFailed", { error: errText(error) }));
    }
  };

  const copyHost = (config: SessionConfig) => {
    void copyText(config.host).then(
      () => message.success(t("session.copied", { host: config.host })),
      () => message.error(t("sftp.copyFailed")),
    );
  };

  const menuItems = (item: SessionConfig): MenuProps["items"] => [
    { key: "connect", icon: <ThunderboltOutlined />, label: t("session.connect") },
    {
      key: "pin",
      icon: <PushpinOutlined />,
      label: item.pinned ? t("session.unpin") : t("session.pin"),
    },
    { key: "edit", icon: <EditOutlined />, label: t("session.edit") },
    { key: "clone", icon: <CopyOutlined />, label: t("common.copy") },
    { type: "divider" },
    { key: "delete", icon: <DeleteOutlined />, label: t("common.delete"), danger: true },
  ];

  const handleMenu = (item: SessionConfig, key: string) => {
    if (key === "connect") connect(item);
    else if (key === "pin") void handlePin(item);
    else if (key === "edit") onEdit(item);
    else if (key === "clone") void handleClone(item);
    else if (key === "delete") handleDelete(item);
  };

  return (
    <section className="sessions">
      <div className="sessions-head">
        <Input
          allowClear
          size="small"
          prefix={<SearchOutlined style={{ color: "#64748b" }} />}
          placeholder={t("session.search")}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>

      <div className="sessions-list">
        {filtered.length === 0 ? (
          loading ? (
            <div className="ssh-list-empty">
              <span className="app-empty-glyph">
                <LoadingOutlined spin />
              </span>
              <div className="app-empty-title">{t("common.loading")}</div>
            </div>
          ) : (
            <div className="ssh-list-empty">
              <span className="app-empty-glyph">
                <ApiOutlined />
              </span>
              <div className="app-empty-title">
                {keyword ? t("session.noMatch") : t("session.empty")}
              </div>
              {!keyword && (
                <div className="app-empty-hint">{t("session.emptyHint")}</div>
              )}
            </div>
          )
        ) : (
          filtered.map((item) => {
            const opened = tabs.some((tab) => tab.configId === item.id);
            return (
              <Dropdown
                key={item.id}
                trigger={["contextMenu"]}
                open={openMenu?.id === item.id && openMenu.trigger === "context"}
                onOpenChange={(open) =>
                  setOpenMenu(open ? { id: item.id, trigger: "context" } : null)
                }
                menu={{
                  items: menuItems(item),
                  onClick: ({ key }) => handleMenu(item, key),
                }}
              >
                <div
                  className="session-card"
                  onClick={() => connect(item)}
                  title={`${item.username}@${item.host}:${item.port}`}
                >
                  <span className="accent-bar" style={{ background: item.color || "#3b82f6" }} />
                  <div className="session-name">
                    {item.pinned && <PushpinOutlined className="pin-mark" />}
                    {item.name}
                    {opened && (
                      <Tag
                        color="processing"
                        bordered={false}
                        style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: "16px" }}
                      >
                        {t("session.opened")}
                      </Tag>
                    )}
                  </div>
                  <div className="session-host-row">
                    <span className="session-host">
                      {item.username}@{item.host}:{item.port}
                    </span>
                    <Tooltip title={t("session.copyIp")}>
                      <button
                        type="button"
                        className="host-copy"
                        onClick={(event) => {
                          event.stopPropagation();
                          copyHost(item);
                        }}
                      >
                        <CopyOutlined />
                      </button>
                    </Tooltip>
                  </div>
                  <div className="session-actions" onClick={(event) => event.stopPropagation()}>
                    <Dropdown
                      trigger={["click"]}
                      open={openMenu?.id === item.id && openMenu.trigger === "dots"}
                      onOpenChange={(open) =>
                        setOpenMenu(open ? { id: item.id, trigger: "dots" } : null)
                      }
                      menu={{
                        items: menuItems(item),
                        onClick: ({ key }) => handleMenu(item, key),
                      }}
                    >
                      <Button size="small" type="text" icon={<EllipsisOutlined />} />
                    </Dropdown>
                  </div>
                </div>
              </Dropdown>
            );
          })
        )}
      </div>

      <div className="sessions-foot">
        <Typography.Text
          type="secondary"
          style={{ display: "block", fontSize: 10.5, textAlign: "center" }}
        >
          {t("session.footHint")}
        </Typography.Text>
      </div>
    </section>
  );
}
