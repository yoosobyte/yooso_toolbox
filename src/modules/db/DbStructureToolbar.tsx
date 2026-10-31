import { Button } from "antd";
import { TableOutlined } from "@ant-design/icons";
import type { TFunction } from "../../i18n";

interface Props {
  t: TFunction;
}

/** 表结构页顶部工具栏 */
export default function DbStructureToolbar({ t }: Props) {
  return (
    <div className="db-view-toolbar">
      <Button size="small" type="text" icon={<TableOutlined />}>
        {t("db.tableStructure")}
      </Button>
    </div>
  );
}
