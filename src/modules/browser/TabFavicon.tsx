import { useEffect, useState } from "react";
import { inTauri } from "../../save";
import { faviconSources } from "./browserUtils";
import { loadFavicon } from "./favicon";

/**
 * tab 图标：先预加载验证能真正解码，再挂到 <img> 上。
 * 直接挂载时部分站点的 favicon 会返回 HTML/空图导致显示成黑块。
 */
export function TabFavicon({ url, icon }: { url: string; icon?: string }) {
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    if (icon) {
      setResolved(icon);
      return;
    }
    if (inTauri()) {
      // 原生环境：交给 Rust 抓取，避免跨域/防盗链导致拿不到图标
      void loadFavicon(url).then((data) => {
        if (!cancelled && data) setResolved(data);
      });
      return () => {
        cancelled = true;
      };
    }
    // 浏览器环境（调试用）：预加载探测
    const sources = faviconSources(url);
    const test = (source: string) =>
      new Promise<string | null>((resolve) => {
        const image = new Image();
        image.onload = () =>
          resolve(
            image.naturalWidth >= 8 && image.naturalHeight >= 8 ? source : null,
          );
        image.onerror = () => resolve(null);
        image.src = source;
      });
    (async () => {
      for (const source of sources) {
        const ok = await test(source);
        if (cancelled) return;
        if (ok) {
          setResolved(ok);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, icon]);

  if (!resolved) return <span className="browser-tab-favicon-placeholder" />;
  return <img className="browser-tab-favicon" src={resolved} alt="" />;
}
