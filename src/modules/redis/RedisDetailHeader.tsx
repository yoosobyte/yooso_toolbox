import { Button, Tooltip } from "antd";
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  HourglassOutlined,
  KeyOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { RedisKeyDetail } from "./api";
import type { JsonValue } from "../text/JsonTree";
import { formatTtlLabel } from "./browserTypes";

interface Props {
  selectedKey: string | null;
  detail: RedisKeyDetail | null;
  structured: JsonValue | null;
  onCopyKey: () => void;
  onRename: () => void;
  onSetTtl: () => void;
  onRefresh: () => void;
  onDelete: () => void;
}

/** 详情面板头：键名、类型 / TTL 信息和键级操作按钮 */
export default function RedisDetailHeader({
  selectedKey,
  detail,
  structured,
  onCopyKey,
  onRename,
  onSetTtl,
  onRefresh,
  onDelete,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <div className="redis-detail-head">
      <KeyOutlined className="redis-detail-icon" />
      <span className="redis-detail-key" title={selectedKey ?? undefined}>
        {selectedKey ?? t("redis.detailTitle")}
      </span>
      {detail && (
        <>
          <span className={`redis-type-badge redis-type-${detail.kind}`}>{detail.kind}</span>
          {structured !== null && <span className="redis-json-badge">JSON</span>}
          <span className="redis-detail-meta">
            {formatTtlLabel(detail.ttl, t)}
            {detail.size !== null && detail.size !== undefined
              ? ` · ${t("redis.sizeLabel")} ${detail.size}`
              : ""}
          </span>
        </>
      )}
      <span style={{ flex: 1 }} />
      {detail && (
        <>
          <Tooltip title={t("redis.copyKey")}>
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={onCopyKey} />
          </Tooltip>
          <Tooltip title={t("redis.rename")}>
            <Button size="small" type="text" icon={<EditOutlined />} onClick={onRename} />
          </Tooltip>
          <Tooltip title={t("redis.setTtl")}>
            <Button size="small" type="text" icon={<HourglassOutlined />} onClick={onSetTtl} />
          </Tooltip>
          <Tooltip title={t("redis.refreshDetail")}>
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={onRefresh} />
          </Tooltip>
          <Tooltip title={t("redis.deleteKey")}>
            <Button size="small" type="text" icon={<DeleteOutlined />} onClick={onDelete} />
          </Tooltip>
        </>
      )}
    </div>
  );
}
