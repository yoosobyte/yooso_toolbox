import { useEffect, useRef, useState } from "react";
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
  onCloseOthers: (id: string) => void;
  onCloseAll: () => void;
  onCloseLeft: (id: string) => void;
  onCloseRight: (id: string) => void;
  /** 右键菜单开合：打开时要把原生 WebView 藏起来，否则菜单会被盖住 */
  onMenuOpenChange?: (open: boolean) => void;
}

export function BrowserTabs({
  tabs,
  activeId,
  hasActive,
  t,
  onHome,
  onFocus,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCloseLeft,
  onCloseRight,
  onMenuOpenChange,
}: Props) {
  const {
    tabsBarRef,
    onTabsPointerDown,
    onTabsPointerMove,
    onTabsPointerUp,
    onTabsClickCapture,
  } = useTabDragScroll();

  /** 右键菜单：坐标 + 目标标签 */
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  /** 正在播放收起动画的标签：动画结束再真正关闭 */
  const [closing, setClosing] = useState<string[]>([]);
  const closingTimers = useRef<number[]>([]);

  useEffect(() => {
    onMenuOpenChange?.(menu !== null);
  }, [menu, onMenuOpenChange]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);

  useEffect(() => () => closingTimers.current.forEach((id) => window.clearTimeout(id)), []);

  /** 先播收起动画，再真正关闭 */
  const animateClose = (ids: string[], action: () => void) => {
    if (ids.length === 0) {
      action();
      return;
    }
    setClosing((prev) => Array.from(new Set([...prev, ...ids])));
    const timer = window.setTimeout(() => {
      setClosing((prev) => prev.filter((id) => !ids.includes(id)));
      action();
    }, 160);
    closingTimers.current.push(timer);
  };

  const closeOne = (id: string) => animateClose([id], () => onClose(id));

  const menuAction = (id: string, action: "current" | "others" | "all" | "left" | "right") => {
    const ids = tabs.map((tab) => tab.id);
    const index = ids.indexOf(id);
    if (index < 0) return;
    if (action === "current") closeOne(id);
    else if (action === "all") animateClose(ids, onCloseAll);
    else if (action === "others") {
      animateClose(ids.filter((item) => item !== id), () => onCloseOthers(id));
    } else if (action === "left") {
      const targets = ids.slice(0, index);
      animateClose(targets, () => onCloseLeft(id));
    } else {
      const targets = ids.slice(index + 1);
      animateClose(targets, () => onCloseRight(id));
    }
    setMenu(null);
  };

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
            className={`browser-tab${tab.id === activeId ? " active" : ""}${
              closing.includes(tab.id) ? " is-closing" : ""
            }`}
            role="button"
            tabIndex={0}
            onClick={() => onFocus(tab.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              onFocus(tab.id);
              setMenu({ x: event.clientX, y: event.clientY, id: tab.id });
            }}
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
                closeOne(tab.id);
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
      {menu && (
        <div
          className="browser-tab-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => menuAction(menu.id, "current")}>
            {t("browser.closeCurrent")}
          </button>
          <button type="button" onClick={() => menuAction(menu.id, "others")}>
            {t("browser.closeOthers")}
          </button>
          <button type="button" onClick={() => menuAction(menu.id, "left")}>
            {t("browser.closeLeft")}
          </button>
          <button type="button" onClick={() => menuAction(menu.id, "right")}>
            {t("browser.closeRight")}
          </button>
          <div className="browser-tab-menu-sep" />
          <button type="button" onClick={() => menuAction(menu.id, "all")}>
            {t("browser.closeAll")}
          </button>
        </div>
      )}
    </div>
  );
}
