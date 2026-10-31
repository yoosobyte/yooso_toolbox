import { useEffect, useRef, useState } from "react";
import { Button, Input } from "antd";
import {
  CodeOutlined,
  CopyOutlined,
  OrderedListOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import type { ApiRequest, BodyType, KeyValue } from "../../types";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { useCopy } from "./useCopy";
import {
  formatJsonInput,
  highlightJsonText,
  isWhitespaceOnlyChange,
  mapCaret,
} from "../text/jsonHighlight";
import KeyValueEditor from "./KeyValueEditor";
import type { ReqTab } from "./constants";

const REQ_TABS: ReqTab[] = ["params", "headers", "body"];

interface Props {
  request: ApiRequest;
  finalUrl: string;
  onPatch: (next: Partial<ApiRequest>) => void;
}

/** 请求编辑器：参数 / 请求头 / 请求体三个 tab，以及复制当前 tab 内容 */
export default function RequestEditor({ request, finalUrl, onPatch }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const copy = useCopy();
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const caretRef = useRef<{ start: number; end: number } | null>(null);

  /* JSON 自动格式化后恢复光标 */
  useEffect(() => {
    const caret = caretRef.current;
    if (!caret) return;
    caretRef.current = null;
    const el = bodyRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(caret.start, caret.end);
  }, [request.body]);

  const handleBodyChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = event.target.value;
    if (request.bodyType !== "json") {
      onPatch({ body: raw });
      return;
    }
    // 只是敲了回车 / 空格 / Tab：原样保留，绝不格式化
    if (isWhitespaceOnlyChange(request.body, raw)) {
      onPatch({ body: raw });
      return;
    }
    // 非空白编辑：解析成功就格式化（回车/空格/Tab 已在上面放行）
    const formatted = formatJsonInput(raw);
    if (formatted !== null && formatted !== raw) {
      const el = event.currentTarget;
      caretRef.current = {
        start: mapCaret(raw, el.selectionStart, formatted),
        end: mapCaret(raw, el.selectionEnd, formatted),
      };
      onPatch({ body: formatted });
      return;
    }
    onPatch({ body: raw });
  };
  const [reqTab, setReqTab] = useState<ReqTab>("params");

  const paramCount = request.params.filter((item) => item.enabled && item.key.trim()).length;
  const headerCount = request.headers.filter((item) => item.enabled && item.key.trim()).length;

  const bodyOptions: { label: string; value: BodyType }[] = [
    { label: t("api.bodyDefault"), value: "none" },
    { label: "JSON", value: "json" },
    { label: t("api.bodyText"), value: "text" },
    { label: t("api.bodyForm"), value: "form" },
  ];

  return (
    <div className="api-card api-card-request">
      <div className="api-card-head">
        <div className="api-seg">
          {REQ_TABS.map((key) => (
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
                request.headers
                  .filter((item) => item.enabled && item.key.trim())
                  .map((item) => `${item.key.trim()}: ${item.value}`)
                  .join("\n"),
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
            onChange={(rows: KeyValue[]) => onPatch({ params: rows })}
            keyPlaceholder={t("api.paramKeyPlaceholder")}
            valuePlaceholder={t("api.paramValuePlaceholder")}
          />
        )}
        {reqTab === "headers" && (
          <KeyValueEditor
            rows={request.headers}
            onChange={(rows: KeyValue[]) => onPatch({ headers: rows })}
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
                      onPatch(
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
            {request.bodyType === "json" ? (
              <div className="api-json-editor">
                <pre className="api-json-highlight" aria-hidden="true">
                  {highlightJsonText(request.body)}
                  {"\n"}
                </pre>
                <textarea
                  ref={bodyRef}
                  className="api-json-input"
                  value={request.body}
                  spellCheck={false}
                  onChange={handleBodyChange}
                  onPaste={() => {
                    window.setTimeout(() => {
                      const el = bodyRef.current;
                      if (!el) return;
                      const formatted = formatJsonInput(el.value);
                      if (formatted !== null && formatted !== el.value) {
                        caretRef.current = {
                          start: mapCaret(el.value, el.selectionStart, formatted),
                          end: mapCaret(el.value, el.selectionEnd, formatted),
                        };
                        onPatch({ body: formatted });
                      }
                    }, 0);
                  }}
                  onScroll={(event) => {
                    const pre = event.currentTarget.previousElementSibling;
                    if (pre instanceof HTMLElement) {
                      pre.scrollTop = event.currentTarget.scrollTop;
                      pre.scrollLeft = event.currentTarget.scrollLeft;
                    }
                  }}
                />
              </div>
            ) : (
              <Input.TextArea
                className="api-body-area"
                value={request.bodyType === "none" ? "" : request.body}
                disabled={request.bodyType === "none"}
                onChange={handleBodyChange}
                placeholder={
                  request.bodyType === "none"
                    ? t("api.bodyNoneHint")
                    : request.bodyType === "form"
                      ? "a=1&b=2"
                      : ""
                }
                style={{ height: "100%", resize: "none" }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
