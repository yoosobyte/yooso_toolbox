import { Button, Pagination, Tooltip } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { PAGE_SIZES } from "./dbDataViewTypes";

interface Props {
  addDisabled: boolean;
  deleteDisabled: boolean;
  saveDisabled: boolean;
  cancelDisabled: boolean;
  inserting: boolean;
  canMutate: boolean;
  selectedCount: number;
  total: number | null;
  rowCount: number;
  page: number;
  pageSize: number;
  paginationTotal: number;
  onAdd: () => void;
  onDelete: () => void;
  onSave: () => void;
  onCancel: () => void;
  onRefresh: () => void;
  onPageChange: (nextPage: number, nextSize: number) => void;
}

export default function DbDataPager({
  addDisabled,
  deleteDisabled,
  saveDisabled,
  cancelDisabled,
  inserting,
  canMutate,
  selectedCount,
  total,
  rowCount,
  page,
  pageSize,
  paginationTotal,
  onAdd,
  onDelete,
  onSave,
  onCancel,
  onRefresh,
  onPageChange,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <div className="db-pager">
      <Tooltip title={t("db.addRow")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<PlusOutlined />}
          disabled={addDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onAdd();
          }}
        />
      </Tooltip>
      <Tooltip title={canMutate ? t("db.deleteRows") : t("db.noPrimaryKey")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<MinusOutlined />}
          disabled={deleteDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        />
      </Tooltip>
      <Tooltip title={t("common.save")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<CheckOutlined />}
          loading={inserting}
          disabled={saveDisabled}
          onClick={() => onSave()}
        />
      </Tooltip>
      <Tooltip title={t("common.cancel")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<CloseOutlined />}
          disabled={cancelDisabled}
          onClick={() => onCancel()}
        />
      </Tooltip>
      <Tooltip title={t("db.refreshData")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<ReloadOutlined />}
          onClick={(event) => {
            event.stopPropagation();
            onRefresh();
          }}
        />
      </Tooltip>
      <Tooltip title={canMutate ? t("db.deleteRows") : t("db.noPrimaryKey")}>
        <Button
          size="small"
          type="text"
          className="db-action-btn"
          icon={<DeleteOutlined />}
          disabled={deleteDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        />
      </Tooltip>
      {selectedCount > 0 && (
        <span className="db-muted">{t("db.selectedRows", { count: selectedCount })}</span>
      )}
      {!canMutate && <span className="db-hint">{t("db.noPrimaryKey")}</span>}
      <span style={{ flex: 1 }} />
      <span className="db-total">
        {total !== null
          ? t("db.totalRows", { count: total })
          : t("db.rows", { count: rowCount })}
      </span>
      <Pagination
        size="small"
        current={page + 1}
        pageSize={pageSize}
        total={paginationTotal}
        showSizeChanger
        pageSizeOptions={PAGE_SIZES.map(String)}
        onChange={(nextPage, nextSize) => onPageChange(nextPage, nextSize)}
      />
    </div>
  );
}
