import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CheckOutlined,
  EllipsisOutlined,
  ExportOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Input, Tooltip } from "antd";
import type { MenuProps } from "antd";
import type { TFunction } from "../../i18n";
import { isImeEnter } from "../../utils";
import { SEARCH_ENGINES, type SearchEngine } from "./browserUtils";

interface Props {
  t: TFunction;
  address: string;
  canBack: boolean;
  canForward: boolean;
  hasActive: boolean;
  /** 顶部栏（图标 + 名称 + 描述）当前是否显示 */
  headVisible: boolean;
  searchEngine: SearchEngine;
  onAddressChange: (value: string) => void;
  onNavigate: () => void;
  onTravel: (delta: number) => void;
  onReload: () => void;
  onOpenExternal: () => void;
  onToggleHead: () => void;
  onSearchEngineChange: (engine: SearchEngine) => void;
  /** 菜单展开 / 收起：原生子 WebView 会盖住弹层，需要在展开时先隐藏 */
  onMenuOpenChange: (open: boolean) => void;
}

export function BrowserToolbar({
  t,
  address,
  canBack,
  canForward,
  hasActive,
  headVisible,
  searchEngine,
  onAddressChange,
  onNavigate,
  onTravel,
  onReload,
  onOpenExternal,
  onToggleHead,
  onSearchEngineChange,
  onMenuOpenChange,
}: Props) {
  const items: MenuProps["items"] = [
    {
      key: "external",
      icon: <ExportOutlined />,
      label: t("browser.openExternal"),
      disabled: !hasActive,
    },
    {
      key: "head",
      icon: headVisible ? <EyeInvisibleOutlined /> : <EyeOutlined />,
      label: headVisible ? t("browser.hideHead") : t("browser.showHead"),
    },
    { type: "divider" },
    {
      type: "group",
      label: t("browser.searchWith"),
      children: SEARCH_ENGINES.map((engine) => ({
        key: `engine:${engine}`,
        // 没选中的放一个透明的勾，保证菜单文字对齐
        icon:
          engine === searchEngine ? (
            <CheckOutlined style={{ color: "var(--accent)" }} />
          ) : (
            <CheckOutlined style={{ opacity: 0 }} />
          ),
        label: engine === "baidu" ? t("browser.baidu") : t("browser.bing"),
      })),
    },
  ];

  const onMenuClick: MenuProps["onClick"] = ({ key, domEvent }) => {
    domEvent.stopPropagation();
    if (key === "external") {
      onOpenExternal();
      return;
    }
    if (key === "head") {
      onToggleHead();
      return;
    }
    if (key.startsWith("engine:")) {
      onSearchEngineChange(key.slice("engine:".length) as SearchEngine);
    }
  };

  return (
    <div className="browser-bar">
      <Tooltip title={t("browser.back")}>
        <Button
          size="small"
          type="text"
          icon={<ArrowLeftOutlined />}
          disabled={!canBack}
          onClick={() => onTravel(-1)}
        />
      </Tooltip>
      <Tooltip title={t("browser.forward")}>
        <Button
          size="small"
          type="text"
          icon={<ArrowRightOutlined />}
          disabled={!canForward}
          onClick={() => onTravel(1)}
        />
      </Tooltip>
      <Tooltip title={t("browser.reload")}>
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          disabled={!hasActive}
          onClick={onReload}
        />
      </Tooltip>
      <Input
        className="browser-address"
        value={address}
        placeholder={t("browser.addressPlaceholder")}
        onChange={(event) => onAddressChange(event.target.value)}
        onPressEnter={(event) => {
          // 输入法组词时的回车只负责上屏，不跳转
          if (isImeEnter(event)) return;
          onNavigate();
        }}
        allowClear
      />
      <Button icon={<ArrowRightOutlined />} onClick={onNavigate}>
        {t("browser.go")}
      </Button>
      <Dropdown
        trigger={["click"]}
        placement="bottomRight"
        menu={{ items, onClick: onMenuClick }}
        onOpenChange={onMenuOpenChange}
      >
        <Button icon={<EllipsisOutlined />} aria-label={t("browser.more")} />
      </Dropdown>
    </div>
  );
}
