import {
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  MoreOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Dropdown, Switch, Tooltip } from "antd";
import type { TFunction } from "../../i18n";
import type { BrowserSite } from "./sites";

interface SiteCardProps {
  site: BrowserSite;
  t: TFunction;
  onOpen: (site: BrowserSite) => void;
  onEdit: (site: BrowserSite) => void;
  onRemove: (site: BrowserSite) => void;
  onToggleAutoOpen: (site: BrowserSite, autoOpen: boolean) => void;
  onMenuOpenChange: (open: boolean) => void;
}

function SiteCard({
  site,
  t,
  onOpen,
  onEdit,
  onRemove,
  onToggleAutoOpen,
  onMenuOpenChange,
}: SiteCardProps) {
  return (
    <div
      className="browser-card"
      role="button"
      tabIndex={0}
      onClick={(event) => {
        const target = event.target;
        // 下拉菜单/弹窗通过 portal 渲染，React 事件仍会冒泡到卡片，要忽略掉
        if (
          !(target instanceof Node) ||
          !event.currentTarget.contains(target)
        ) {
          return;
        }
        // 右侧开关 / 更多按钮的点击不触发卡片打开
        if (
          target instanceof Element &&
          target.closest(".browser-card-side")
        ) {
          return;
        }
        onOpen(site);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(site);
        }
      }}
    >
      <span className="browser-card-icon" style={{ background: site.color }}>
        {site.name.slice(0, 1).toUpperCase()}
      </span>
      <div className="browser-card-main">
        <div className="browser-card-name">{site.name}</div>
        <div className="browser-card-url">{site.url}</div>
      </div>
      <div className="browser-card-side">
        <Dropdown
          trigger={["click"]}
          onOpenChange={(open) => onMenuOpenChange(open)}
          menu={{
            items: [
              {
                key: "goto",
                label: t("browser.goto"),
                icon: <ExportOutlined />,
              },
              {
                key: "edit",
                label: t("browser.edit"),
                icon: <EditOutlined />,
              },
              { type: "divider" as const },
              {
                key: "delete",
                label: t("common.delete"),
                icon: <DeleteOutlined />,
                danger: true,
              },
            ],
            onClick: ({ key }) => {
              if (key === "goto") onOpen(site);
              else if (key === "edit") onEdit(site);
              else if (key === "delete") onRemove(site);
            },
          }}
        >
          <button
            type="button"
            className="browser-card-more"
            onClick={(event) => event.stopPropagation()}
          >
            <MoreOutlined />
          </button>
        </Dropdown>
        <Tooltip title={t("browser.autoOpen")}>
          <span
            className="browser-card-switch"
            onClick={(event) => event.stopPropagation()}
          >
            <Switch
              size="small"
              checked={site.autoOpen}
              onChange={(on) => onToggleAutoOpen(site, on)}
            />
          </span>
        </Tooltip>
      </div>
    </div>
  );
}

interface BrowserHomeProps {
  sites: BrowserSite[];
  t: TFunction;
  onOpenSite: (site: BrowserSite) => void;
  onEditSite: (site: BrowserSite) => void;
  onRemoveSite: (site: BrowserSite) => void;
  onToggleAutoOpen: (site: BrowserSite, autoOpen: boolean) => void;
  onMenuOpenChange: (open: boolean) => void;
  onAddSite: () => void;
}

export function BrowserHome({
  sites,
  t,
  onOpenSite,
  onEditSite,
  onRemoveSite,
  onToggleAutoOpen,
  onMenuOpenChange,
  onAddSite,
}: BrowserHomeProps) {
  return (
    <div className="browser-home">
      <div className="browser-home-head">
        <div className="browser-home-title">{t("browser.homeTitle")}</div>
        <div className="browser-home-desc">{t("browser.homeDesc")}</div>
      </div>
      <div className="browser-cards">
        {sites.map((site) => (
          <SiteCard
            key={site.id}
            site={site}
            t={t}
            onOpen={onOpenSite}
            onEdit={onEditSite}
            onRemove={onRemoveSite}
            onToggleAutoOpen={onToggleAutoOpen}
            onMenuOpenChange={onMenuOpenChange}
          />
        ))}
        <button
          type="button"
          className="browser-card browser-card-add"
          onClick={onAddSite}
        >
          <span className="browser-card-add-icon">
            <PlusOutlined />
          </span>
          <span>{t("browser.addSite")}</span>
        </button>
      </div>
    </div>
  );
}
