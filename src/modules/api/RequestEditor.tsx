import { useState } from "react";
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
            <Input.TextArea
              className="api-body-area"
              value={request.bodyType === "none" ? "" : request.body}
              disabled={request.bodyType === "none"}
              onChange={(event) => onPatch({ body: event.target.value })}
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
  );
}
