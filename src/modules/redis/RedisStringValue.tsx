import { Button, Segmented, Tooltip } from "antd";
import { CopyOutlined, ExpandAltOutlined, ShrinkOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import JsonTree, { type JsonValue } from "../text/JsonTree";
import type { RedisStringMode } from "./browserTypes";

interface Props {
  value: string;
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

/** string 值编辑器：JSON 树 / 原文切换、全展开和保存 */
export default function RedisStringValue({
  value,
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
  const jsonAllExpanded = jsonPaths.length === 0 || jsonCollapsed.size === 0;

  return (
    <div className="redis-string-editor">
      {structured !== null && (
        <div className="redis-string-toolbar">
          <Segmented
            size="small"
            value={stringMode}
            onChange={(next) => onStringModeChange(next as RedisStringMode)}
            options={[
              { value: "tree", label: t("text.tree") },
              { value: "text", label: t("text.raw") },
            ]}
          />
          {stringMode === "tree" && jsonPaths.length > 0 && (
            <Button
              size="small"
              type="text"
              icon={jsonAllExpanded ? <ShrinkOutlined /> : <ExpandAltOutlined />}
              onClick={() =>
                onJsonCollapsedChange(jsonAllExpanded ? new Set(jsonPaths) : new Set<string>())
              }
            >
              {jsonAllExpanded ? t("text.collapseAll") : t("text.expandAll")}
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Tooltip title={t("redis.copyValue")} placement="left">
            <Button
              size="small"
              type="text"
              className="redis-copy-value"
              icon={<CopyOutlined />}
              onClick={() => onCopyValue(value)}
            />
          </Tooltip>
        </div>
      )}

      {structured !== null && stringMode === "tree" ? (
        <div className="redis-json-tree">
          <JsonTree
            value={structured}
            collapsed={jsonCollapsed}
            onToggle={onToggleJson}
            itemsLabel={t("text.items")}
            keysLabel={t("text.keys")}
          />
        </div>
      ) : (
        <>
          <textarea
            className="redis-string-input"
            value={editValue}
            spellCheck={false}
            onChange={(event) => onEditValueChange(event.target.value)}
          />
          <div className="redis-string-foot">
            <span className="redis-hint">{t("redis.stringHint")}</span>
            <Button
              size="small"
              type="primary"
              onClick={onSave}
              loading={saving}
              disabled={editValue === value}
            >
              {t("redis.save")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
