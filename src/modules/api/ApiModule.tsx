import { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Tooltip, Typography } from "antd";
import { ApiOutlined } from "@ant-design/icons";
import { httpRequest } from "../../api";
import type {
  ApiRequest,
  ApiResponse,
  HistoryEntry,
  HttpMethod,
  SavedRequest,
} from "../../types";
import { useApiStore } from "../../stores/apiStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { SideResizer } from "../../components/SideResizer";
import { buildCurl, buildFinalUrl, emptyRequest, originOf } from "./helpers";
import type { RespTab } from "./constants";
import RequestSidebar from "./RequestSidebar";
import RequestBar from "./RequestBar";
import RequestEditor from "./RequestEditor";
import ResponsePanel from "./ResponsePanel";
import SaveRequestModal from "./SaveRequestModal";

export default function ApiModule() {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();

  const saved = useApiStore((state) => state.saved);
  const history = useApiStore((state) => state.history);
  const saveRequest = useApiStore((state) => state.saveRequest);
  const removeRequest = useApiStore((state) => state.removeRequest);
  const pushHistory = useApiStore((state) => state.pushHistory);
  const clearHistory = useApiStore((state) => state.clearHistory);

  const [request, setRequest] = useState<ApiRequest>(emptyRequest);
  const [title, setTitle] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [respTab, setRespTab] = useState<RespTab>("body");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveMode, setSaveMode] = useState<"update" | "new">("new");
  const [lastSent, setLastSent] = useState<{ method: HttpMethod; url: string } | null>(null);
  const sideWidth = useUiStore((state) => state.sideWidth);
  const setSideWidth = useUiStore((state) => state.setSideWidth);

  const patch = (next: Partial<ApiRequest>) => setRequest((prev) => ({ ...prev, ...next }));

  const enabledHeaders = useMemo(
    () =>
      request.headers
        .filter((item) => item.enabled && item.key.trim())
        .map((item) => ({ key: item.key.trim(), value: item.value })),
    [request.headers],
  );

  /** 最终地址：URL 里已有的 query + 参数表里启用的行 */
  const finalUrl = useMemo(() => buildFinalUrl(request), [request.url, request.params]);

  /** 最近用过的地址（去重），做成「搜索历史」式的下拉 */
  const recentUrls = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const item of history) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      list.push(item.url);
      if (list.length >= 15) break;
    }
    return list;
  }, [history]);

  const send = async () => {
    const url = finalUrl.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      message.warning(t("api.urlPlaceholder"));
      return;
    }
    setSending(true);
    setError(null);
    setLastSent({ method: request.method, url });
    try {
      const hasBody = request.bodyType !== "none" && request.body.trim().length > 0;
      const result = await httpRequest({
        method: request.method,
        url,
        headers: enabledHeaders,
        body: hasBody ? request.body : undefined,
        bodyType: hasBody ? request.bodyType : "none",
      });
      setResponse(result);
      setRespTab("body");
      pushHistory({ method: request.method, url, status: result.status, timeMs: result.timeMs });
    } catch (err) {
      setResponse(null);
      setError(errText(err));
    } finally {
      setSending(false);
    }
  };

  /* ⌘/Ctrl + Enter 发送 */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      event.preventDefault();
      void send();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const loadRequest = (item: SavedRequest) => {
    setRequest({ ...item.request });
    setTitle(item.name);
    setCurrentId(item.id);
    setResponse(null);
    setError(null);
  };

  const resetRequest = () => {
    setRequest(emptyRequest());
    setTitle("");
    setCurrentId(null);
    setResponse(null);
    setError(null);
  };

  const loadHistory = (item: HistoryEntry) => {
    patch({ method: item.method, url: item.url });
    setResponse(null);
    setError(null);
  };

  const removeSaved = (id: string) => {
    removeRequest(id);
    if (currentId === id) resetRequest();
  };

  const openSave = () => {
    const existing = saved.find((item) => item.id === currentId);
    // 地址换了域（前缀完全不同）就默认新建，避免把别的请求覆盖掉
    const sameTarget = existing ? originOf(existing.request.url) === originOf(request.url) : false;
    setSaveMode(existing && sameTarget ? "update" : "new");
    setSaveName(existing && sameTarget ? existing.name : title || t("api.titlePlaceholder"));
    setSaveOpen(true);
  };

  const confirmSave = () => {
    const name = saveName.trim() || t("api.titlePlaceholder");
    const id = saveMode === "update" && currentId ? currentId : crypto.randomUUID();
    saveRequest({ id, name, request });
    setTitle(name);
    setCurrentId(id);
    setSaveOpen(false);
    message.success(saveMode === "update" ? t("api.savedAt") : t("api.savedNew"));
  };

  /** 响应区「复制 cURL」用的命令文本 */
  const curl = buildCurl(request, finalUrl, enabledHeaders);
  /** 「更新现有」提示里显示的请求名 */
  const updateName = saved.find((item) => item.id === currentId)?.name ?? "";

  return (
    <div className="module api-module">
      <header className="module-head">
        <span className="module-icon">
          <ApiOutlined />
        </span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            API
          </Typography.Text>
          <div className="module-desc">{t("module.apiDesc")}</div>
        </div>
        <span style={{ flex: 1 }} />
        {title && <span className="api-current-name">{title}</span>}
        <Tooltip title={t("api.sendHint")}>
          <span className="api-hint">⌘ / Ctrl + Enter</span>
        </Tooltip>
      </header>

      <div className="api-body">
        <RequestSidebar
          width={sideWidth}
          saved={saved}
          history={history}
          currentId={currentId}
          onNew={resetRequest}
          onLoad={loadRequest}
          onRemove={removeSaved}
          onPickHistory={loadHistory}
          onClearHistory={clearHistory}
        />

        <SideResizer width={sideWidth} onChange={setSideWidth} />

        <section className="api-main">
          <RequestBar
            request={request}
            sending={sending}
            recentUrls={recentUrls}
            finalUrl={finalUrl}
            onPatch={patch}
            onSend={send}
            onReset={resetRequest}
            onOpenSave={openSave}
          />

          <RequestEditor request={request} finalUrl={finalUrl} onPatch={patch} />

          <ResponsePanel
            response={response}
            error={error}
            lastSent={lastSent}
            curl={curl}
            tab={respTab}
            onTabChange={setRespTab}
          />
        </section>
      </div>

      <SaveRequestModal
        open={saveOpen}
        name={saveName}
        mode={saveMode}
        currentId={currentId}
        updateName={updateName}
        onNameChange={setSaveName}
        onModeChange={setSaveMode}
        onCancel={() => setSaveOpen(false)}
        onConfirm={confirmSave}
      />
    </div>
  );
}
