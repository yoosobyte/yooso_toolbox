use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

/// 新窗口请求转发给主界面的事件名
pub const NEW_WINDOW_EVENT: &str = "browser:new-window";
/// 页面标题变化事件：标签页标题实时跟随页面 `document.title`
pub const TITLE_EVENT: &str = "browser:title";

/// 标题事件负载：哪个子 WebView 变成了什么标题
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserTitlePayload {
    pub label: String,
    pub title: String,
}

/// 页面里「新标签打开」的拦截脚本。
///
/// 背景：百度等站点会自己 `preventDefault` 再自行开窗，这条路径在子 WebView 里
/// 会被 WebKit 吞掉（既不导航也不触发 `on_new_window`，表现为「点了没反应」）。
/// 所以我们在页面最外层（捕获阶段、早于站点脚本）把 `target=_blank` 的点击拦下来，
/// 把目标地址写进一个内部哨兵地址；Rust 的 `on_navigation` 看到它就取消这次导航，
/// 并通知主界面开新标签。
///
/// `window.open` 也做同样处理，但只限「用户刚刚点过页面」的 1.5 秒内，
/// 避免广告脚本在加载时批量弹标签页。
const LINK_GUARD_SCRIPT: &str = r#"(function(){
  if (window.__yoosoLinkGuard) return;
  window.__yoosoLinkGuard = true;
  var SENTINEL = 'https://yooso-open.invalid/?url=';
  var lastClick = 0;
  function handoff(url) {
    try { window.location.href = SENTINEL + encodeURIComponent(url); } catch (e) {}
  }
  window.addEventListener('mousedown', function () { lastClick = Date.now(); }, true);
  window.addEventListener('click', function (e) {
    try {
      if (e.defaultPrevented || e.button !== 0) return;
      var anchor = null;
      var path = e.composedPath ? e.composedPath() : null;
      if (path) {
        for (var i = 0; i < path.length; i += 1) {
          var node = path[i];
          if (node && node.tagName === 'A' && node.href) { anchor = node; break; }
        }
      } else {
        var el = e.target;
        while (el && el.tagName !== 'A') el = el.parentElement;
        anchor = el;
      }
      if (!anchor) return;
      var target = String(anchor.getAttribute('target') || '').toLowerCase();
      if (target !== '_blank' && target !== '_new') return;
      var href = String(anchor.href);
      if (!/^https?:/i.test(href)) return;
      e.preventDefault();
      e.stopPropagation();
      handoff(href);
    } catch (err) {}
  }, true);
  var originalOpen = window.open;
  window.open = function (url) {
    try {
      if (url && /^https?:/i.test(String(url)) && Date.now() - lastClick < 1500) {
        handoff(String(url));
        return null;
      }
    } catch (err) {}
    return originalOpen ? originalOpen.apply(window, arguments) : null;
  };
})();"#;

/// 拦截脚本交回地址用的哨兵主机名（`.invalid` 保证永远不会真的解析）
const OPEN_SENTINEL_HOST: &str = "yooso-open.invalid";

/// 从哨兵地址里取出要打开的 URL
fn sentinel_target(url: &tauri::Url) -> Option<String> {
    if url.host_str() != Some(OPEN_SENTINEL_HOST) {
        return None;
    }
    url.query_pairs()
        .find(|(key, _)| key == "url")
        .map(|(_, value)| value.into_owned())
}

/// 在指定子 WebView 中执行一段 JS（用于兼容性修补/诊断）
#[tauri::command]
pub fn browser_eval(app: tauri::AppHandle, label: String, script: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview {label} not found"))?;
    webview.eval(&script).map_err(|error| error.to_string())
}

/// 创建浏览器子 WebView。
///
/// 注意：这里必须是 async。同步 Tauri 命令在主线程执行时，`add_child` 会把创建
/// 任务投递到主线程并阻塞等待，Windows 上会直接死锁（表现就是子 WebView 不存在、
/// 页面一片空白）。async 命令运行在异步运行时线程上，主线程才能完成真正的创建。
///
/// 由 Rust 侧创建而不是前端 `new Webview(...)`，是为了能挂上 `on_navigation`
/// 与 `on_new_window`：前者接住拦截脚本转来的新标签地址，后者兜住表单 / iframe
/// 等其它路径发起的开窗请求，统一转成应用内的新标签页。
#[tauri::command]
pub async fn browser_create_webview(
    app: tauri::AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    user_agent: Option<String>,
) -> Result<(), String> {
    let window = app
        .get_window("main")
        .ok_or_else(|| "主窗口不存在".to_string())?;
    let target = url
        .parse::<tauri::Url>()
        .map_err(|error| format!("无效地址：{error}"))?;

    let emitter = app.clone();
    let nav_emitter = app.clone();
    let title_emitter = app.clone();
    let mut builder = WebviewBuilder::new(label, WebviewUrl::External(target))
        .focused(true)
        .accept_first_mouse(true)
        .initialization_script(LINK_GUARD_SCRIPT)
        .on_document_title_changed(move |webview, title| {
            // 页面标题会随加载、路由切换、未读数等实时变化，这里原样转给标签页
            let title = title.trim().to_string();
            if title.is_empty() {
                return;
            }
            let _ = title_emitter.emit_to(
                "main",
                TITLE_EVENT,
                BrowserTitlePayload {
                    label: webview.label().to_string(),
                    title,
                },
            );
        })
        .on_navigation(move |url| {
            // 页面里的「新标签打开」被拦截脚本转成了哨兵地址：取消导航并开标签
            if let Some(target) = sentinel_target(url) {
                let _ = nav_emitter.emit_to("main", NEW_WINDOW_EVENT, target);
                return false;
            }
            true
        })
        .on_new_window(move |target, _features| {
            // 兜底：表单 target=_blank、iframe 里的链接等
            if matches!(target.scheme(), "http" | "https") {
                let _ = emitter.emit_to("main", NEW_WINDOW_EVENT, target.to_string());
            }
            NewWindowResponse::Deny
        });
    if let Some(user_agent) = user_agent.filter(|value| !value.is_empty()) {
        builder = builder.user_agent(&user_agent);
    }

    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width.max(1.0), height.max(1.0)),
        )
        .map_err(|error| format!("创建浏览器 WebView 失败：{error}"))?;
    Ok(())
}
