import { useEffect } from "react";
import { CloseOutlined, HomeOutlined, PlusOutlined } from "@ant-design/icons";
import type { TFunction } from "../../i18n";
import useTabDragScroll from "../../components/useTabDragScroll";
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
  const {
    tabsBarRef,
    onTabsPointerDown,
    onTabsPointerMove,
    onTabsPointerUp,
    onTabsClickCapture,
  } = useTabDragScroll();

  /* 打开 / 切换标签时把它滚进可视区（只横向，不牵动页面） */
  useEffect(() => {
    const bar = tabsBarRef.current;
    if (!bar || !activeId) return;
    const active = bar.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    active?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeId, tabs.length, tabsBarRef]);

  return (
    <div className="browser-tabs">
      {/* 主页固定在左侧，不随标签栏横向滚动 */}
      <div
        className={`browser-tab browser-tab-home${hasActive ? "" : " active"}`}
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

      <div
        className="browser-tabs-scroll"
        ref={tabsBarRef}
        onPointerDown={onTabsPointerDown}
        onPointerMove={onTabsPointerMove}
        onPointerUp={onTabsPointerUp}
        onPointerCancel={onTabsPointerUp}
        onClickCapture={onTabsClickCapture}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
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

        {/* 「+」跟在最后一个标签右侧，随标签一起横向滚动；点击回到主页 */}
        <button
          type="button"
          className="browser-tab-add"
          title={t("browser.home")}
          aria-label={t("browser.home")}
          onClick={onHome}
        >
          <PlusOutlined />
        </button>
      </div>
    </div>
  );
}
