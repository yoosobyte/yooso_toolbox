import { InboxOutlined, WarningOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { RedisKeyDetail, RedisValue } from "./api";
import type { JsonValue } from "../text/JsonTree";
import type { RedisStringMode } from "./browserTypes";
import RedisStringValue from "./RedisStringValue";

interface Props {
  detail: RedisKeyDetail;
  structured: JsonValue | null;
  stringMode: RedisStringMode;
  onStringModeChange: (mode: RedisStringMode) => void;
  jsonCollapsed: Set<string>;
  jsonPaths: string[];
  onToggleJson: (path: string) => void;
  onJsonCollapsedChange: (next: Set<string>) => void;
  editValue: string;
  onEditValueChange: (value: string) => void;
  saving: boolean;
  onSave: () => void;
  onCopyValue: (value: string) => void;
}

/** 按值类型渲染详情内容；string 交给独立的编辑器组件 */
export default function RedisValueDetail({
  detail,
  structured,
  stringMode,
  onStringModeChange,
  jsonCollapsed,
  jsonPaths,
  onToggleJson,
  onJsonCollapsedChange,
  editValue,
  onEditValueChange,
  saving,
  onSave,
  onCopyValue,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const value: RedisValue = detail.value;

  switch (value.kind) {
    case "none":
      return (
        <div className="redis-empty">
          <span className="redis-empty-icon">
            <InboxOutlined />
          </span>
          <div>{t("redis.none")}</div>
        </div>
      );
    case "string":
      return (
        <RedisStringValue
          value={value.value}
          structured={structured}
          stringMode={stringMode}
          onStringModeChange={onStringModeChange}
          jsonCollapsed={jsonCollapsed}
          jsonPaths={jsonPaths}
          onToggleJson={onToggleJson}
          onJsonCollapsedChange={onJsonCollapsedChange}
          editValue={editValue}
          onEditValueChange={onEditValueChange}
          saving={saving}
          onSave={onSave}
          onCopyValue={onCopyValue}
        />
      );
    case "hash":
      return (
        <div className="redis-value-scroll">
          <div className="redis-kv-head">
            <span>{t("redis.field")}</span>
            <span>{t("redis.valueColumn")}</span>
          </div>
          {value.entries.map((entry) => (
            <div className="redis-kv-row" key={entry.field}>
              <span className="redis-mono">{entry.field}</span>
              <span className="redis-mono">{entry.value}</span>
            </div>
          ))}
          {value.truncated && (
            <div className="redis-truncated">{t("redis.truncated", { limit: 500 })}</div>
          )}
        </div>
      );
    case "list":
      return (
        <div className="redis-value-scroll">
          {value.items.map((item, index) => (
            <div className="redis-list-row" key={index}>
              <span className="redis-index">{index + 1}</span>
              <span className="redis-mono">{item}</span>
            </div>
          ))}
          {value.truncated && (
            <div className="redis-truncated">{t("redis.truncated", { limit: 500 })}</div>
          )}
        </div>
      );
    case "set":
      return (
        <div className="redis-value-scroll">
          <div className="redis-chip-list">
            {value.items.map((item, index) => (
              <span className="redis-chip redis-mono" key={`${item}-${index}`}>
                {item}
              </span>
            ))}
          </div>
          {value.truncated && (
            <div className="redis-truncated">{t("redis.truncated", { limit: 500 })}</div>
          )}
        </div>
      );
    case "zset":
      return (
        <div className="redis-value-scroll">
          <div className="redis-kv-head">
            <span>{t("redis.member")}</span>
            <span>{t("redis.score")}</span>
          </div>
          {value.items.map((item, index) => (
            <div className="redis-kv-row" key={`${item.member}-${index}`}>
              <span className="redis-mono">{item.member}</span>
              <span className="redis-mono">{item.score}</span>
            </div>
          ))}
          {value.truncated && (
            <div className="redis-truncated">{t("redis.truncated", { limit: 500 })}</div>
          )}
        </div>
      );
    case "stream":
      return (
        <div className="redis-value-scroll">
          {value.entries.map((entry) => (
            <div className="redis-stream-row" key={entry.id}>
              <div className="redis-stream-id">
                {t("redis.streamId")}: {entry.id}
              </div>
              {entry.fields.map((field, index) => (
                <div className="redis-kv-row" key={`${entry.id}-${index}`}>
                  <span className="redis-mono">{field.field}</span>
                  <span className="redis-mono">{field.value}</span>
                </div>
              ))}
            </div>
          ))}
          {value.truncated && (
            <div className="redis-truncated">{t("redis.truncated", { limit: 100 })}</div>
          )}
        </div>
      );
    default:
      return (
        <div className="redis-empty">
          <span className="redis-empty-icon">
            <WarningOutlined />
          </span>
          <div>{t("redis.unsupportedType", { type: value.kind })}</div>
        </div>
      );
  }
}
