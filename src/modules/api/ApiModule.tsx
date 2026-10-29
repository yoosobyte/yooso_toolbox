import { useEffect, useMemo, useState } from "react";
import {
  App as AntdApp,
  Button,
  Dropdown,
  Input,
  Modal,
  Segmented,
  Select,
  Tooltip,
  Typography,
} from "antd";
import {
  AlignLeftOutlined,
  ClearOutlined,
  CloudServerOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  InboxOutlined, LoadingOutlined,
  OrderedListOutlined,
  PlusOutlined,
  SaveOutlined,
  SearchOutlined,
  SendOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { httpRequest } from "../../api";
import type {
  ApiRequest,
  ApiResponse,
  BodyType,
  HistoryEntry,
  HttpMethod,
  KeyValue,
  SavedRequest,
} from "../../types";
import { useApiStore } from "../../stores/apiStore";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { copyText } from "../../clipboard";
import { errText, formatBytes } from "../../utils";
import KeyValueEditor, { HeaderTable, emptyRow } from "./KeyValueEditor";

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** 请求栏右侧图标按钮：和下拉 / 输入框严格等高 */
const BAR_BTN = { height: 40, width: 40, minWidth: 40 } as const;

const METHOD_COLOR: Record<string, string> = {
  GET: "#22c55e",
  POST: "#f59e0b",
  PUT: "#3b82f6",
  PATCH: "#a855f7",
  DELETE: "#f87171",
  HEAD: "#8b9bb4",
  OPTIONS: "#8b9bb4",
};

const emptyRequest = (): ApiRequest => ({
  method: "GET",
  url: "",
  params: [emptyRow()],
  headers: [emptyRow()],
  bodyType: "none",
  body: "",
});

type ReqTab = "params" | "headers" | "body";
type RespTab = "body" | "headers";

/** 把 URL 里已有的 query 拆出来，避免和参数表重复 */
function splitQuery(url: string): { base: string; pairs: [string, string][] } {
  const index = url.indexOf("?");
  if (index < 0) return { base: url, pairs: [] };
  const base = url.slice(0, index);
  const pairs: [string, string][] = url
    .slice(index + 1)
    .split("&")
    .filter(Boolean)
    .map((chunk) => {
      const [key, value = ""] = chunk.split("=");
      return [decodeURIComponent(key), decodeURIComponent(value)] as [string, string];
    });
  return { base, pairs };
}

/** 方法标签：带底色的胶囊 */
function MethodChip({ method, size = "sm" }: { method: HttpMethod; size?: "sm" | "md" }) {
  const color = METHOD_COLOR[method] ?? "#8b9bb4";
  return (
    <span
      className={`method-chip method-chip-${size}`}
      style={{ color, background: `${color}1f`, borderColor: `${color}33` }}
    >
      {method}
    </span>
  );
}

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
  const [reqTab, setReqTab] = useState<ReqTab>("params");
  const [respTab, setRespTab] = useState<RespTab>("body");
  const [pretty, setPretty] = useState(true);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveMode, setSaveMode] = useState<"update" | "new">("new");
  const [keyword, setKeyword] = useState("");
  const [lastSent, setLastSent] = useState<{ method: HttpMethod; url: string } | null>(null);

  const patch = (next: Partial<ApiRequest>) => setRequest((prev) => ({ ...prev, ...next }));

  const enabledHeaders = useMemo(
    () =>
      request.headers
        .filter((item) => item.enabled && item.key.trim())
        .map((item) => ({ key: item.key.trim(), value: item.value })),
    [request.headers],
  );

  /** 最终地址：URL 里已有的 query + 参数表里启用的行 */
  const finalUrl = useMemo(() => {
    const { base, pairs } = splitQuery(request.url.trim());
    const extra = request.params
      .filter((item) => item.enabled && item.key.trim())
      .map((item) => [item.key.trim(), item.value] as [string, string]);
    const merged = [...pairs];
    for (const [key, value] of extra) {
      const index = merged.findIndex(([existing]) => existing === key);
      if (index >= 0) merged[index] = [key, value];
      else merged.push([key, value]);
    }
    if (!merged.length) return base;
    const query = merged
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    return `${base}?${query}`;
  }, [request.url, request.params]);

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

  /** 左侧搜索过滤 */
  const keywordTrim = keyword.trim().toLowerCase();
  const shownSaved = keywordTrim
    ? saved.filter((item) => item.name.toLowerCase().includes(keywordTrim))
    : saved;
  const shownHistory = keywordTrim
    ? history.filter(
        (item) =>
          item.url.toLowerCase().includes(keywordTrim) ||
          item.method.toLowerCase().includes(keywordTrim),
      )
    : history;

  const copy = (text: string, label: string) => {
    if (!text?.trim()) {
      message.warning(t("api.nothingToCopy"));
      return;
    }
    void copyText(text).then(
      () => message.success(t("api.copied", { label })),
      () => message.error(t("common.copyFailed")),
    );
  };

  const curlCommand = () => {
    const lines = [`curl -X ${request.method} '${finalUrl}'`];
    const headers = [...enabledHeaders];
    const hasType = headers.some((item) => item.key.toLowerCase() === "content-type");
    if (!hasType && request.bodyType === "json") {
      headers.push({ key: "Content-Type", value: "application/json" });
    }
    if (!hasType && request.bodyType === "form") {
      headers.push({ key: "Content-Type", value: "application/x-www-form-urlencoded" });
    }
    for (const header of headers) {
      lines.push(`-H '${header.key}: ${header.value.replace(/'/g, "'\\''")}'`);
    }
    if (request.bodyType !== "none" && request.body.trim()) {
      lines.push(`--data-raw '${request.body.replace(/'/g, "'\\''")}'`);
    }
    return lines.join(" \\\n  ");
  };

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

  /** 取 URL 的源（scheme://host），判断还是不是同一个接口 */
  const originOf = (url: string) => {
    try {
      return new URL(url.trim()).origin;
    } catch {
      return url.trim();
    }
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

  const responseBody = useMemo(() => {
    if (!response) return "";
    if (!pretty) return response.body;
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return response.body;
    }
  }, [response, pretty]);

  const statusColor = (status: number) =>
    status >= 200 && status < 300
      ? "var(--success)"
      : status >= 400
        ? "var(--danger)"
        : "var(--warn)";

  const bodyOptions: { label: string; value: BodyType }[] = [
    { label: t("api.bodyDefault"), value: "none" },
    { label: "JSON", value: "json" },
    { label: t("api.bodyText"), value: "text" },
    { label: t("api.bodyForm"), value: "form" },
  ];

  const paramCount = request.params.filter((item) => item.enabled && item.key.trim()).length;
  const headerCount = enabledHeaders.length;

  return (
    <div className="module api-module">
      <header className="module-head">
        <span className="module-icon">
          <CloudServerOutlined />
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
        <aside className="api-side">
          <Button
            size="large"
            icon={<PlusOutlined />}
            block
            onClick={resetRequest}
          >
            {t("api.newRequest")}
          </Button>

          <div className="api-side-card">
            <div className="api-search">
              <Input
                variant="borderless"
                allowClear
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                prefix={<SearchOutlined style={{ color: "var(--text-mute)" }} />}
                placeholder={t("api.search")}
              />
            </div>
            <div className="api-search-sep" />

            <div className="api-side-scroll">
            <div className="api-group">
              <div className="api-group-head">
                <FolderOpenOutlined />
                <span>{t("api.requestSection")}</span>
                <span className="api-count">{saved.length}</span>
              </div>
              {shownSaved.length === 0 && (
                <div className="api-side-empty">
                  {keywordTrim ? t("api.emptySearch") : t("api.emptySaved")}
                </div>
              )}
              {shownSaved.map((item) => (
                <div
                  key={item.id}
                  className={`api-item${item.id === currentId ? " active" : ""}`}
                  onClick={() => loadRequest(item)}
                >
                  <MethodChip method={item.request.method} />
                  <span className="api-item-name">{item.name}</span>
                  <button
                    type="button"
                    className="api-item-remove"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeRequest(item.id);
                      if (currentId === item.id) resetRequest();
                    }}
                  >
                    <DeleteOutlined />
                  </button>
                </div>
              ))}
            </div>

            <div className="api-group">
              <div className="api-group-head">
                <HistoryOutlined />
                <span>{t("api.historySection")}</span>
                <span className="api-count">{history.length}</span>
                {history.length > 0 && (
                  <button type="button" className="api-group-action" onClick={clearHistory}>
                    <DeleteOutlined />
                    {t("api.clearHistory")}
                  </button>
                )}
              </div>
              {shownHistory.length === 0 && (
                <div className="api-side-empty">
                  {keywordTrim ? t("api.emptySearch") : t("api.emptyHistory")}
                </div>
              )}
              {shownHistory.map((item: HistoryEntry) => (
                <div
                  key={item.id}
                  className="api-item api-item-history"
                  onClick={() => {
                    patch({ method: item.method, url: item.url });
                    setResponse(null);
                    setError(null);
                  }}
                >
                  <MethodChip method={item.method} />
                  <span className="api-item-name" title={item.url}>
                    {item.url}
                  </span>
                  <span className="api-item-time">{dayjs(item.at).format("HH:mm")}</span>
                </div>
              ))}
            </div>
          </div>
          </div>
        </aside>

        <section className="api-main">
          <div className="api-bar">
            <Select
              className="api-method"
              size="large"
              value={request.method}
              onChange={(value) => patch({ method: value as HttpMethod })}
              options={METHODS.map((method) => ({
                value: method,
                label: (
                  <span style={{ color: METHOD_COLOR[method], fontWeight: 600 }}>{method}</span>
                ),
              }))}
            />
            <Input
                size="large"
                value={request.url}
                placeholder={t("api.urlPlaceholder")}
                onChange={(event) => patch({ url: event.target.value })}
                onPressEnter={() => void send()}
                suffix={
                  sending ? (
                      <LoadingOutlined />
                  ) : (
                      <SendOutlined
                          style={{ cursor: "pointer", }}
                          onClick={() => void send()}
                      />
                  )
                }
            />
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              menu={{
                items: recentUrls.length
                  ? recentUrls.map((url) => ({ key: url, label: url }))
                  : [{ key: "__empty", label: t("api.emptyUrlHistory"), disabled: true }],
                onClick: ({ key }) => {
                  if (key !== "__empty") patch({ url: key });
                },
              }}
            >
              <Tooltip title={t("api.urlHistory")} placement="bottomRight">
                <Button style={BAR_BTN} icon={<HistoryOutlined />} />
              </Tooltip>
            </Dropdown>
            <Tooltip title={t("api.copyUrl")}>
              <Button
                style={BAR_BTN}
                icon={<CopyOutlined />}
                onClick={() => copy(finalUrl, "URL")}
              />
            </Tooltip>
            <Tooltip title={t("api.clear")}>
              <Button style={BAR_BTN} icon={<ClearOutlined />} onClick={resetRequest} />
            </Tooltip>
            <Tooltip title={t("api.saveAs")}>
              <Button style={BAR_BTN} icon={<SaveOutlined />} onClick={openSave} />
            </Tooltip>
          </div>

          <div className="api-card api-card-request">
            <div className="api-card-head">
              <div className="api-seg">
                {(["params", "headers", "body"] as ReqTab[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`api-seg-item${reqTab === key ? " active" : ""}`}
                    onClick={() => setReqTab(key)}
                  >
                    {key === "params" ? (
                      <OrderedListOutlined />
                    ) : key === "headers" ? (
                      <TagsOutlined />
                    ) : (
                      <CodeOutlined />
                    )}
                    {t(`api.${key}`)}
                    {key === "params" && paramCount > 0 && (
                      <span className="api-tab-badge">{paramCount}</span>
                    )}
                    {key === "headers" && headerCount > 0 && (
                      <span className="api-tab-badge">{headerCount}</span>
                    )}
                  </button>
                ))}
              </div>
              <span style={{ flex: 1 }} />
              <span className="api-final-url" title={finalUrl}>
                {finalUrl || "—"}
              </span>
              {reqTab === "params" && paramCount > 0 && (
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() =>
                    copy(
                      request.params
                        .filter((item) => item.enabled && item.key.trim())
                        .map(
                          (item) =>
                            `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value)}`,
                        )
                        .join("&"),
                      t("api.params"),
                    )
                  }
                >
                  {t("api.copyParams")}
                </Button>
              )}
              {reqTab === "headers" && headerCount > 0 && (
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() =>
                    copy(
                      enabledHeaders.map((item) => `${item.key}: ${item.value}`).join("\n"),
                      t("api.headers"),
                    )
                  }
                >
                  {t("api.copyRequestHeaders")}
                </Button>
              )}
              {reqTab === "body" && request.body.trim().length > 0 && (
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => copy(request.body, t("api.body"))}
                >
                  {t("api.copyRequestBody")}
                </Button>
              )}
            </div>

            <div className="api-card-body">
              {reqTab === "params" && (
                <KeyValueEditor
                  rows={request.params}
                  onChange={(rows: KeyValue[]) => patch({ params: rows })}
                  keyPlaceholder={t("api.paramKeyPlaceholder")}
                  valuePlaceholder={t("api.paramValuePlaceholder")}
                />
              )}
              {reqTab === "headers" && (
                <KeyValueEditor
                  rows={request.headers}
                  onChange={(rows: KeyValue[]) => patch({ headers: rows })}
                  keyLabel={t("api.headerKey")}
                  valueLabel={t("api.headerValue")}
                  keyPlaceholder={t("api.headerKeyPlaceholder")}
                  valuePlaceholder={t("api.headerValuePlaceholder")}
                />
              )}
              {reqTab === "body" && (
                <div className="api-body-editor">
                  <div className="api-body-tools">
                    <div className="api-seg">
                      {bodyOptions.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`api-seg-item${request.bodyType === option.value ? " active" : ""}`}
                          onClick={() =>
                            patch(
                              option.value === "none"
                                ? { bodyType: option.value, body: "" }
                                : { bodyType: option.value },
                            )
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Input.TextArea
                    className="api-body-area"
                    value={request.bodyType === "none" ? "" : request.body}
                    disabled={request.bodyType === "none"}
                    onChange={(event) => patch({ body: event.target.value })}
                    placeholder={
                      request.bodyType === "none"
                        ? t("api.bodyNoneHint")
                        : request.bodyType === "json"
                          ? '{ "hello": "world" }'
                          : request.bodyType === "form"
                            ? "a=1&b=2"
                            : ""
                    }
                    autoSize={{ minRows: 4, maxRows: 12 }}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="api-card api-card-response">
            <div className="api-card-head">
              <span className="api-response-title">{t("api.response")}</span>
              {response && (
                <>
                  <Tooltip title={lastSent ? `${lastSent.method} ${lastSent.url}` : undefined}>
                    <span
                      className="api-status-pill"
                      style={{
                        color: statusColor(response.status),
                        background: `${statusColor(response.status)}1f`,
                      }}
                    >
                      {lastSent ? `${lastSent.method} · ` : ""}
                      {response.status} {response.statusText}
                    </span>
                  </Tooltip>
                  <span className="api-meta">
                    {response.timeMs} ms · {formatBytes(response.size)}
                  </span>
                  {response.truncated && (
                    <span className="api-meta api-warn">{t("api.truncated")}</span>
                  )}
                </>
              )}
              <span style={{ flex: 1 }} />
              {/* 从左到右：复制 cURL → 复制正文/响应头 → 格式化 → 正文/响应头分段（最右） */}
              <Tooltip title={t("api.curlHint")}>
                <Button
                  size="small"
                  type="text"
                  icon={<CodeOutlined />}
                  onClick={() => copy(curlCommand(), "cURL")}
                >
                  {t("api.copyAsCurl")}
                </Button>
              </Tooltip>
              {response && (
                <Tooltip
                  title={
                    respTab === "body" ? t("api.copyResponseBody") : t("api.copyResponseHeaders")
                  }
                >
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={() =>
                      respTab === "body"
                        ? copy(response.body, t("api.responseBody"))
                        : copy(
                            response.headers.map((h) => `${h.key}: ${h.value}`).join("\n"),
                            t("api.responseHeaders"),
                          )
                    }
                  >
                    {respTab === "body" ? t("api.copyResponseBody") : t("api.copyResponseHeaders")}
                  </Button>
                </Tooltip>
              )}
              {response && respTab === "body" && (
                <Tooltip title={pretty ? t("api.raw") : t("api.pretty")}>
                  <Button
                    size="small"
                    type="text"
                    icon={<AlignLeftOutlined />}
                    onClick={() => setPretty((value) => !value)}
                    className="api-mini"
                  />
                </Tooltip>
              )}
              <div className="api-seg api-seg-sm">
                <button
                  type="button"
                  className={`api-seg-item${respTab === "body" ? " active" : ""}`}
                  onClick={() => setRespTab("body")}
                >
                  {t("api.responseBody")}
                </button>
                <button
                  type="button"
                  className={`api-seg-item${respTab === "headers" ? " active" : ""}`}
                  onClick={() => setRespTab("headers")}
                >
                  {t("api.responseHeaders")}
                </button>
              </div>
            </div>

            <div className="api-card-body api-response-body">
              {error && (
                <div className="api-error">
                  {t("api.failed")}：{error}
                </div>
              )}
              {!error && !response && (
                <div className="api-empty-state">
                  <span className="api-empty-icon">
                    <InboxOutlined />
                  </span>
                  <div className="api-empty-title">{t("api.responseEmptyTitle")}</div>
                  <div className="api-empty-hint">{t("api.responseEmptyHint")}</div>
                </div>
              )}
              {response && respTab === "body" && (
                response.body ? (
                  <pre className="api-pre">{responseBody}</pre>
                ) : (
                  <div className="api-empty">{t("api.noBody")}</div>
                )
              )}
              {response && respTab === "headers" && <HeaderTable headers={response.headers} />}
            </div>
          </div>
        </section>
      </div>

      <Modal
        open={saveOpen}
        onCancel={() => setSaveOpen(false)}
        onOk={confirmSave}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        title={t("api.saveAs")}
        width={460}
        destroyOnClose
      >
        <div className="api-save-body">
          {currentId && (
            <Segmented
              size="small"
              block
              value={saveMode}
              onChange={(value) => setSaveMode(value as "update" | "new")}
              options={[
                { label: t("api.saveModeUpdate"), value: "update" },
                { label: t("api.saveModeNew"), value: "new" },
              ]}
            />
          )}
          <Input
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
            placeholder={t("api.requestName")}
            onPressEnter={confirmSave}
          />
          <div className="api-save-hint">
            {saveMode === "update" && currentId
              ? t("api.saveUpdateHint", {
                  name: saved.find((item) => item.id === currentId)?.name ?? "",
                })
              : t("api.saveNewHint")}
          </div>
        </div>
      </Modal>
    </div>
  );
}
