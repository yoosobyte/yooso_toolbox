import { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { App as AntdApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import App from "./App";
import { darkThemeConfig, lightThemeConfig } from "./theme";
import { useUiStore, watchSystem } from "./stores/uiStore";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("root element not found");
}

// 屏蔽浏览器默认右键菜单：应用里所有右键都由自己的菜单接管
document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

function Root() {
  const lang = useUiStore((state) => state.lang);
  const activeTheme = useUiStore((state) => state.activeTheme);

  useEffect(() => watchSystem(), []);

  useEffect(() => {
    dayjs.locale(lang === "zh" ? "zh-cn" : "en");
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  return (
    <ConfigProvider
      locale={lang === "zh" ? zhCN : enUS}
      theme={activeTheme === "light" ? lightThemeConfig : darkThemeConfig}
      componentSize="middle"
    >
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  );
}

// 说明：故意不使用 React.StrictMode。StrictMode 在开发模式下会重复执行 effect，
// 对「挂载即建立 SSH 连接」的终端组件会造成一次多余的连接与资源泄漏。
ReactDOM.createRoot(rootEl).render(<Root />);
