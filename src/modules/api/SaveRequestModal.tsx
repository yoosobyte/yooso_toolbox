import { Input, Modal, Segmented } from "antd";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";

interface Props {
  open: boolean;
  name: string;
  mode: "update" | "new";
  currentId: string | null;
  /** 「更新现有」时被覆盖的请求名，仅用于提示文案 */
  updateName: string;
  onNameChange: (name: string) => void;
  onModeChange: (mode: "update" | "new") => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 保存请求弹窗：名称 + 更新现有 / 另存为新 */
export default function SaveRequestModal({
  open,
  name,
  mode,
  currentId,
  updateName,
  onNameChange,
  onModeChange,
  onCancel,
  onConfirm,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      onOk={onConfirm}
      okText={t("common.save")}
      cancelText={t("common.cancel")}
      title={t("api.saveAs")}
      width={460}
      destroyOnClose
    >
      <div className="api-save-body">
        {currentId && (
          <Segmented
            size="small"
            block
            value={mode}
            onChange={(value) => onModeChange(value as "update" | "new")}
            options={[
              { label: t("api.saveModeUpdate"), value: "update" },
              { label: t("api.saveModeNew"), value: "new" },
            ]}
          />
        )}
        <Input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={t("api.requestName")}
          onPressEnter={onConfirm}
        />
        <div className="api-save-hint">
          {mode === "update" && currentId
            ? t("api.saveUpdateHint", { name: updateName })
            : t("api.saveNewHint")}
        </div>
      </div>
    </Modal>
  );
}
