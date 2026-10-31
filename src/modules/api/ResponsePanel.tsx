import { useState } from "react";
import { Button, Tooltip } from "antd";
import {
  AlignLeftOutlined,
  CodeOutlined,
  CopyOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import type { ApiResponse, HttpMethod } from "../../types";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { formatBytes } from "../../utils";
import { useCopy } from "./useCopy";
import { HeaderTable } from "./KeyValueEditor";
import { statusColor } from "./helpers";
import ResponseCode from "./ResponseCode";
import type { RespTab } from "./constants";

interface Props {
  response: ApiResponse | null;
  error: string | null;
  lastSent: { method: HttpMethod; url: string } | null;
  curl: string;
  tab: RespTab;
  onTabChange: (tab: RespTab) => void;
}

/** 响应查看器：状态 / 耗时 / 大小 + 复制 cURL、正文、响应头 + 正文 / 响应头切换 */
export default function ResponsePanel({
  response,
  error,
  lastSent,
  curl,
  tab,
  onTabChange,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const copy = useCopy();
  const [pretty, setPretty] = useState(true);

  return (
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
            onClick={() => copy(curl, "cURL")}
          >
            {t("api.copyAsCurl")}
          </Button>
        </Tooltip>
        {response && (
          <Tooltip
            title={tab === "body" ? t("api.copyResponseBody") : t("api.copyResponseHeaders")}
          >
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              onClick={() =>
                tab === "body"
                  ? copy(response.body, t("api.responseBody"))
                  : copy(
                      response.headers.map((h) => `${h.key}: ${h.value}`).join("\n"),
                      t("api.responseHeaders"),
                    )
              }
            >
              {tab === "body" ? t("api.copyResponseBody") : t("api.copyResponseHeaders")}
            </Button>
          </Tooltip>
        )}
        {response && tab === "body" && (
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
            className={`api-seg-item${tab === "body" ? " active" : ""}`}
            onClick={() => onTabChange("body")}
          >
            {t("api.responseBody")}
          </button>
          <button
            type="button"
            className={`api-seg-item${tab === "headers" ? " active" : ""}`}
            onClick={() => onTabChange("headers")}
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
        {response && tab === "body" && (
          response.body ? (
            <ResponseCode text={response.body} pretty={pretty} />
          ) : (
            <div className="api-empty">{t("api.noBody")}</div>
          )
        )}
        {response && tab === "headers" && <HeaderTable headers={response.headers} />}
      </div>
    </div>
  );
}
