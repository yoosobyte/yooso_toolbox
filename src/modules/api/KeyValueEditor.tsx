import { Checkbox, Input, Tooltip } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { KeyValue } from "../../types";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { emptyRow } from "./helpers";

export { emptyRow };

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  /** 表头列名 */
  keyLabel?: string;
  valueLabel?: string;
  /** 输入框占位文案（默认跟列名一致） */
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

/** 标准表格：左右都有边框，表头固定，底部居中「添加一行」 */
export default function KeyValueEditor({
  rows,
  onChange,
  keyLabel,
  valueLabel,
  keyPlaceholder,
  valuePlaceholder,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));

  const patch = (id: string, next: Partial<KeyValue>) =>
    onChange(rows.map((row) => (row.id === id ? { ...row, ...next } : row)));

  return (
    <div className="kv-table">
      <div className="kv-thead">
        <span className="kv-cell" />
        <span className="kv-cell">{keyLabel ?? t("api.tableKey")}</span>
        <span className="kv-cell">{valueLabel ?? t("api.tableValue")}</span>
        <span className="kv-cell" />
      </div>

      {rows.map((row) => (
        <div className={`kv-tr${row.enabled ? "" : " disabled"}`} key={row.id}>
          <span className="kv-cell">
            <Checkbox
              checked={row.enabled}
              onChange={(event) => patch(row.id, { enabled: event.target.checked })}
            />
          </span>
          <Input
            variant="borderless"
            value={row.key}
            placeholder={keyPlaceholder ?? keyLabel ?? t("api.tableKey")}
            onChange={(event) => patch(row.id, { key: event.target.value })}
          />
          <Input
            variant="borderless"
            value={row.value}
            placeholder={valuePlaceholder ?? valueLabel ?? t("api.tableValue")}
            onChange={(event) => patch(row.id, { value: event.target.value })}
          />
          <span className="kv-cell">
            <Tooltip title={t("api.deleteRow")}>
              <button
                type="button"
                className="kv-remove"
                onClick={() => onChange(rows.filter((item) => item.id !== row.id))}
              >
                <DeleteOutlined />
              </button>
            </Tooltip>
          </span>
        </div>
      ))}

      <button type="button" className="kv-add-row" onClick={() => onChange([...rows, emptyRow()])}>
        <PlusOutlined /> {t("api.addRow")}
      </button>
    </div>
  );
}

interface HeaderTableProps {
  headers: { key: string; value: string }[];
}

/** 响应头表格（只读），与参数表同一套边框样式 */
export function HeaderTable({ headers }: HeaderTableProps) {
  const t = useT(useUiStore((state) => state.lang));
  return (
    <div className="kv-table">
      <div className="kv-thead">
        <span className="kv-cell" />
        <span className="kv-cell">{t("api.headerKey")}</span>
        <span className="kv-cell">{t("api.headerValue")}</span>
        <span className="kv-cell" />
      </div>
      {headers.map((header, index) => (
        <div className="kv-tr readonly" key={`${header.key}-${index}`}>
          <span className="kv-cell" />
          <span className="kv-text">{header.key}</span>
          <span className="kv-text">{header.value}</span>
          <span className="kv-cell" />
        </div>
      ))}
    </div>
  );
}
