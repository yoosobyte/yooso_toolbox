import { Checkbox, Select } from "antd";
import type { ColumnDefinition } from "./ddl";
import { supportsAutoIncrement } from "./dbStructureColumnMeta";
import type { EditableField, StructureTypeOption } from "./dbStructureTypes";

interface Props {
  draft: ColumnDefinition;
  typeOptions: StructureTypeOption[];
  onChangeType: (type: string) => void;
  onChangeField: (field: EditableField, value: string) => void;
  onChangeNullable: (nullable: boolean) => void;
  onChangeAutoIncrement: (checked: boolean) => void;
  onApply: () => Promise<void>;
  onCancel: () => void;
}

/** 新增列时出现在表尾的草稿行 */
export default function DbStructureDraftRow({
  draft,
  typeOptions,
  onChangeType,
  onChangeField,
  onChangeNullable,
  onChangeAutoIncrement,
  onApply,
  onCancel,
}: Props) {
  const draftInput = (field: EditableField, placeholder: string, mono = false) => (
    <input
      className={`db-structure-input db-structure-draft-input${mono ? " db-structure-mono" : ""}`}
      autoFocus={field === "field"}
      value={String(draft[field] ?? "")}
      placeholder={placeholder}
      onChange={(event) => onChangeField(field, event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void onApply();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );

  return (
    <tr className="db-structure-draft">
      <td className="db-structure-gutter" />
      <td className="db-structure-cell">{draftInput("field", "column")}</td>
      <td className="db-structure-cell">
        <Select
          className="db-structure-type-select"
          size="small"
          variant="borderless"
          value={draft.type}
          options={typeOptions}
          onChange={onChangeType}
          popupMatchSelectWidth={false}
          style={{ width: "100%" }}
        />
      </td>
      <td className="db-structure-cell">{draftInput("length", "length", true)}</td>
      <td className="db-structure-cell db-structure-check">
        <Checkbox
          checked={!draft.nullable}
          onChange={(event) => onChangeNullable(!event.target.checked)}
        />
      </td>
      <td className="db-structure-cell db-structure-key">
        <span className="db-structure-empty" />
      </td>
      <td className="db-structure-cell">{draftInput("defaultValue", "default", true)}</td>
      <td className="db-structure-cell db-structure-check">
        {supportsAutoIncrement(draft.type) ? (
          <Checkbox
            checked={draft.extra.toLowerCase().includes("auto_increment")}
            onChange={(event) => onChangeAutoIncrement(event.target.checked)}
          />
        ) : (
          <span className="db-structure-empty" />
        )}
      </td>
      <td className="db-structure-cell">{draftInput("comment", "comment")}</td>
    </tr>
  );
}
