/** 可原地编辑的列字段 */
export type EditableField = "field" | "length" | "defaultValue" | "comment";

/** 正在编辑的单元格 */
export interface EditingCell {
  row: number;
  field: EditableField;
  value: string;
}

/** 可编辑单元格的展示选项 */
export interface StructureCellOptions {
  mono?: boolean;
  placeholder?: string;
  blankWhenEmpty?: boolean;
}

/** 列类型下拉的选项 */
export interface StructureTypeOption {
  value: string;
  label: string;
}
