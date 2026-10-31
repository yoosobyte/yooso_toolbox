import type {
  EditableField,
  EditingCell,
  StructureCellOptions,
} from "./dbStructureTypes";

interface Props {
  rowIndex: number;
  field: EditableField;
  display: string;
  editing: EditingCell | null;
  options?: StructureCellOptions;
  onStartEdit: (rowIndex: number, field: EditableField) => void;
  onValueChange: (value: string) => void;
  onFinishEdit: () => Promise<void>;
  onCancelEdit: () => void;
}

/** 列定义表格里可点击进入编辑的单元格 */
export default function DbStructureEditableCell({
  rowIndex,
  field,
  display,
  editing,
  options,
  onStartEdit,
  onValueChange,
  onFinishEdit,
  onCancelEdit,
}: Props) {
  return (
    <td
      className={`db-structure-cell db-structure-editable${options?.mono ? " db-structure-mono" : ""}`}
      title={display || undefined}
      onClick={() => {
        const isEditing =
          editing !== null && editing.row === rowIndex && editing.field === field;
        if (!isEditing) onStartEdit(rowIndex, field);
      }}
    >
      {editing && editing.row === rowIndex && editing.field === field ? (
        <input
          className="db-structure-input"
          autoFocus
          value={editing.value}
          placeholder={options?.placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          onFocus={(event) => {
            const end = event.currentTarget.value.length;
            event.currentTarget.setSelectionRange(end, end);
          }}
          onBlur={() => void onFinishEdit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              onCancelEdit();
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <span className={display ? undefined : "db-structure-empty"}>
          {display || (options?.blankWhenEmpty ? "" : "—")}
        </span>
      )}
    </td>
  );
}
