import { Checkbox, Select, Tooltip } from "antd";
import { KeyOutlined } from "@ant-design/icons";
import type { TFunction } from "../../i18n";
import type { ColumnDefinition } from "./ddl";
import type { DbStructureEditor } from "./useDbStructureEditor";
import { supportsAutoIncrement } from "./dbStructureColumnMeta";
import DbStructureEditableCell from "./DbStructureEditableCell";
import DbStructureDraftRow from "./DbStructureDraftRow";

interface Props {
  rows: ColumnDefinition[];
  editor: DbStructureEditor;
  t: TFunction;
  onRowContextMenu?: (event: React.MouseEvent, rowIndex: number) => void;
}

/** 列定义表格：表头、可编辑的数据行、新增列草稿行与空结果提示 */
export default function DbStructureTable({
  rows,
  editor,
  t,
  onRowContextMenu,
}: Props) {
  return (
    <div className="db-structure-scroll">
      <table className="db-structure-table">
        <colgroup>
          <col style={{ width: "2.5%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "6.5%" }} />
          <col style={{ width: "5.5%" }} />
          <col style={{ width: "8.5%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "33%" }} />
        </colgroup>
        <thead>
          <tr>
            <th className="db-structure-gutter" />
            <th>{t("db.colField")}</th>
            <th>{t("db.colType")}</th>
            <th>{t("db.colLength")}</th>
            <th className="db-structure-center">{t("db.colNullable")}</th>
            <th className="db-structure-center">{t("db.colKey")}</th>
            <th>{t("db.colDefault")}</th>
            <th className="db-structure-center">{t("db.colAutoIncrement")}</th>
            <th>{t("db.colComment")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={`${row.field}-${rowIndex}`}
              className={editor.selectedRows.has(rowIndex) ? "db-row-selected" : undefined}
              onContextMenu={
                onRowContextMenu
                  ? (event) => {
                      event.preventDefault();
                      onRowContextMenu(event, rowIndex);
                    }
                  : undefined
              }
            >
              <td
                className="db-structure-gutter db-row-select"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => editor.selectRow(rowIndex, event)}
              />
              <DbStructureEditableCell
                rowIndex={rowIndex}
                field="field"
                display={row.field}
                editing={editor.editing}
                options={{ placeholder: "column" }}
                onStartEdit={editor.startEdit}
                onValueChange={editor.updateEditingValue}
                onFinishEdit={editor.finishEdit}
                onCancelEdit={editor.cancelEditing}
              />
              <td className="db-structure-cell">
                <Select
                  className="db-structure-type-select"
                  size="small"
                  variant="borderless"
                  value={row.type}
                  disabled={!editor.enabled}
                  options={editor.typeOptions}
                  onChange={(value) => void editor.changeType(rowIndex, value)}
                  popupMatchSelectWidth={false}
                  style={{ width: "100%" }}
                />
              </td>
              <DbStructureEditableCell
                rowIndex={rowIndex}
                field="length"
                display={row.length}
                editing={editor.editing}
                options={{ mono: true, placeholder: "length", blankWhenEmpty: true }}
                onStartEdit={editor.startEdit}
                onValueChange={editor.updateEditingValue}
                onFinishEdit={editor.finishEdit}
                onCancelEdit={editor.cancelEditing}
              />
              <td className="db-structure-cell db-structure-check">
                <Checkbox
                  checked={!row.nullable}
                  disabled={!editor.enabled}
                  onChange={(event) =>
                    void editor.toggleNullable(rowIndex, !event.target.checked)
                  }
                />
              </td>
              <td
                className="db-structure-cell db-structure-key"
                onClick={() => void editor.togglePrimary(rowIndex)}
              >
                {row.key.toUpperCase().includes("PRI") ? (
                  <Tooltip title="PRIMARY KEY">
                    <KeyOutlined />
                  </Tooltip>
                ) : (
                  <span className="db-structure-empty" />
                )}
              </td>
              <DbStructureEditableCell
                rowIndex={rowIndex}
                field="defaultValue"
                display={row.defaultValue}
                editing={editor.editing}
                options={{ mono: true, placeholder: "default" }}
                onStartEdit={editor.startEdit}
                onValueChange={editor.updateEditingValue}
                onFinishEdit={editor.finishEdit}
                onCancelEdit={editor.cancelEditing}
              />
              <td className="db-structure-cell db-structure-check">
                {supportsAutoIncrement(row.type) ? (
                  <Checkbox
                    checked={row.extra.toLowerCase().includes("auto_increment")}
                    disabled={!editor.enabled}
                    onChange={(event) =>
                      void editor.toggleAutoIncrement(rowIndex, event.target.checked)
                    }
                  />
                ) : (
                  <span className="db-structure-empty" />
                )}
              </td>
              <DbStructureEditableCell
                rowIndex={rowIndex}
                field="comment"
                display={row.comment}
                editing={editor.editing}
                options={{ placeholder: "comment" }}
                onStartEdit={editor.startEdit}
                onValueChange={editor.updateEditingValue}
                onFinishEdit={editor.finishEdit}
                onCancelEdit={editor.cancelEditing}
              />
            </tr>
          ))}

          {editor.draft && (
            <DbStructureDraftRow
              draft={editor.draft}
              typeOptions={editor.typeOptions}
              onChangeType={editor.changeDraftType}
              onChangeField={editor.updateDraftField}
              onChangeNullable={editor.updateDraftNullable}
              onChangeAutoIncrement={editor.updateDraftAutoIncrement}
              onApply={editor.applyDraft}
              onCancel={editor.cancelDraft}
            />
          )}
        </tbody>
      </table>

      {rows.length === 0 && !editor.draft && (
        <div className="db-grid-empty">{t("db.emptyResult")}</div>
      )}
    </div>
  );
}
