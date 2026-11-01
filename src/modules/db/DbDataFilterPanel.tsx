import { Button, Checkbox, Input, Select, Tooltip } from "antd";
import {
  CheckOutlined,
  ClearOutlined,
  CloseOutlined,
  FilterFilled,
  FilterOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { DbColumnInfo } from "./api";
import { OPERATORS, isUnary, type DraftFilter } from "./dbDataViewTypes";

interface Props {
  columns: DbColumnInfo[];
  filterCount: number;
  filterOpen: boolean;
  filterApplying: boolean;
  draft: DraftFilter[];
  disabled: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onPatch: (id: string, patch: Partial<DraftFilter>) => void;
  onRemove: (id: string) => void;
  onApply: () => void;
  onReset: () => void;
}

export default function DbDataFilterPanel({
  columns,
  filterCount,
  filterOpen,
  filterApplying,
  draft,
  disabled,
  onToggle,
  onAdd,
  onPatch,
  onRemove,
  onApply,
  onReset,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <>
      <div className="db-view-toolbar">
        <Button
          size="small"
          type={filterOpen ? "default" : "text"}
          icon={
            filterOpen || filterCount > 0 ? <FilterFilled /> : <FilterOutlined />
          }
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {t("db.filter")}
          {filterCount > 0 && (
            <span className="db-filter-count">{filterCount}</span>
          )}
        </Button>
      </div>

      {filterOpen && (
        <div className="db-filter-panel" onClick={(event) => event.stopPropagation()}>
          <div className="db-filter-head">
            <span className="db-filter-title">{t("db.filter")}</span>
            <Button
              size="small"
              type="default"
              icon={<PlusOutlined />}
              onClick={onAdd}
            >
              {t("db.filterAdd")}
            </Button>
            <span style={{ flex: 1 }} />
          </div>

          {draft.map((filter, index) => (
            <div
              className={`db-filter-row${draft.length === 1 ? " db-filter-row-single" : ""}${filter.enabled ? "" : " db-filter-row-disabled"}`}
              key={filter.id}
            >
              {draft.length > 1 &&
                (index === 0 ? (
                  <span aria-hidden="true" />
                ) : (
                  <Tooltip title={t("db.filterJoinPrev")}>
                    <Select
                      size="small"
                      value={filter.conjunction}
                      disabled={!filter.enabled}
                      options={[
                        { value: "and", label: t("db.filterAnd") },
                        { value: "or", label: t("db.filterOr") },
                      ]}
                      onChange={(value) =>
                        onPatch(filter.id, { conjunction: value as "and" | "or" })
                      }
                      style={{ width: "100%" }}
                    />
                  </Tooltip>
                ))}
              <Tooltip title={t("db.filterEnabled")}>
                <Checkbox
                  checked={filter.enabled}
                  onChange={(event) =>
                    onPatch(filter.id, { enabled: event.target.checked })
                  }
                />
              </Tooltip>
              <Select
                size="small"
                value={filter.column}
                disabled={!filter.enabled}
                options={columns.map((column) => ({
                  value: column.name,
                  label: column.name,
                }))}
                onChange={(value) => onPatch(filter.id, { column: String(value) })}
                style={{ width: 150 }}
              />
              <Select
                size="small"
                value={filter.operator}
                disabled={!filter.enabled}
                options={OPERATORS.map((operator) => ({
                  value: operator,
                  label: t(`db.op.${operator}`),
                }))}
                onChange={(value) =>
                  onPatch(filter.id, {
                    operator: String(value),
                    value: isUnary(String(value)) ? "" : filter.value,
                  })
                }
                style={{ width: 160 }}
              />
              <Input
                size="small"
                value={filter.value ?? ""}
                disabled={
                  !filter.enabled || isUnary(filter.operator)
                }
                placeholder={
                  isUnary(filter.operator)
                    ? "—"
                    : filter.operator === "in" || filter.operator === "notIn"
                      ? t("db.filterInPlaceholder")
                      : t("db.filterValuePlaceholder")
                }
                onChange={(event) => onPatch(filter.id, { value: event.target.value })}
              />
              <Button
                size="small"
                type="default"
                className="db-filter-delete"
                title={t("common.delete")}
                icon={<CloseOutlined />}
                onClick={() => onRemove(filter.id)}
              />
            </div>
          ))}

          <div className="db-filter-footer">
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              loading={filterApplying}
              onClick={onApply}
            >
              {t("db.filterApply")}
            </Button>
            <Button size="small" icon={<ClearOutlined />} onClick={onReset}>
              {t("db.filterReset")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
