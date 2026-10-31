import { Button, Tooltip } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  InsertRowAboveOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { TFunction } from "../../i18n";
import type { DbStructureEditor } from "./useDbStructureEditor";

interface Props {
  editor: DbStructureEditor;
  rowCount: number;
  t: TFunction;
}

/** 表结构页底部操作栏：加列、删列、复制/插入、应用/取消 DDL 与刷新 */
export default function DbStructureActions({ editor, rowCount, t }: Props) {
  return (
    <div className="db-pager db-structure-pager">
      <Tooltip title={t("db.addColumn")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<PlusOutlined />}
          disabled={!!editor.draft || editor.applying}
          onClick={editor.startAdd}
        />
      </Tooltip>
      <Tooltip title={t("db.deleteColumn")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<MinusOutlined />}
          disabled={editor.selectedRows.size === 0 || !editor.enabled}
          onClick={editor.deleteSelected}
        />
      </Tooltip>
      <Tooltip title={t("db.copyColumn")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<CopyOutlined />}
          disabled={!editor.oneSelected}
          onClick={editor.startCopy}
        />
      </Tooltip>
      <Tooltip title={t("db.insertColumn")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<InsertRowAboveOutlined />}
          disabled={!editor.oneSelected}
          onClick={editor.startInsert}
        />
      </Tooltip>
      <Tooltip title={t("db.applyDdl")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<CheckOutlined />}
          loading={editor.applying}
          disabled={!editor.canApply}
          onClick={() => void editor.applyDraft()}
        />
      </Tooltip>
      <Tooltip title={t("common.cancel")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<CloseOutlined />}
          disabled={!editor.draft || editor.applying}
          onClick={editor.cancelDraft}
        />
      </Tooltip>
      <Tooltip title={t("db.refreshData")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<ReloadOutlined />}
          disabled={editor.applying}
          onClick={editor.refresh}
        />
      </Tooltip>
      <Tooltip title={t("db.deleteColumn")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<DeleteOutlined />}
          disabled={editor.selectedRows.size === 0 || !editor.enabled}
          onClick={editor.deleteSelected}
        />
      </Tooltip>
      {editor.selectedRows.size > 0 && (
        <span className="db-muted">
          {t("db.selectedColumns", { count: editor.selectedRows.size })}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <span className="db-total">
        {t("db.structureCount", { count: rowCount })}
      </span>
    </div>
  );
}
