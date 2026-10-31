import { CloseOutlined, HomeOutlined } from "@ant-design/icons";
import type { TFunction } from "../../i18n";
import { TabFavicon } from "./TabFavicon";
import type { BrowserTab } from "./types";

interface Props {
  tabs: BrowserTab[];
  activeId: string | null;
  /** 是否存在当前激活的 tab（决定首页 tab 是否高亮） */
  hasActive: boolean;
  t: TFunction;
  onHome: () => void;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
}

export function BrowserTabs({
  tabs,
  activeId,
  hasActive,
  t,
  onHome,
  onFocus,
  onClose,
}: Props) {
  return (
    <div className="browser-tabs">
      <div
        className={`browser-tab${hasActive ? "" : " active"}`}
        role="button"
        tabIndex={0}
        onClick={onHome}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onHome();
          }
        }}
      >
        <HomeOutlined />
        {t("browser.home")}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`browser-tab${tab.id === activeId ? " active" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => onFocus(tab.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onFocus(tab.id);
            }
          }}
        >
          <TabFavicon key={tab.url} url={tab.url} icon={tab.icon} />
          <span className="browser-tab-title">{tab.title}</span>
          <button
            type="button"
            className="browser-tab-close"
            title={t("common.close")}
            onClick={(event) => {
              event.stopPropagation();
              onClose(tab.id);
            }}
          >
            <CloseOutlined />
          </button>
        </div>
      ))}
    </div>
  );
}
