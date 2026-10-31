import { Input, InputNumber, Modal, Select } from "antd";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { isImeEnter } from "../../utils";

interface NewKeyDialogProps {
  open: boolean;
  keyName: string;
  value: string;
  ttlPreset: string;
  ttl: number | null;
  onKeyNameChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onTtlPresetChange: (value: string) => void;
  onTtlChange: (value: number | null) => void;
  onCancel: () => void;
  onOk: () => void;
}

/** 新建 string 键弹窗 */
export function NewKeyDialog({
  open,
  keyName,
  value,
  ttlPreset,
  ttl,
  onKeyNameChange,
  onValueChange,
  onTtlPresetChange,
  onTtlChange,
  onCancel,
  onOk,
}: NewKeyDialogProps) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <Modal
      open={open}
      title={t("redis.newKeyTitle")}
      onCancel={onCancel}
      onOk={onOk}
      okText={t("redis.create")}
      okButtonProps={{ disabled: !keyName.trim() }}
      cancelText={t("common.cancel")}
      width={460}
      destroyOnHidden
    >
      <div className="redis-form">
        <label className="redis-field">
          <span className="redis-label">{t("redis.keyName")}</span>
          <Input
            value={keyName}
            placeholder={t("redis.keyPlaceholder")}
            onChange={(event) => onKeyNameChange(event.target.value)}
          />
        </label>
        <label className="redis-field">
          <span className="redis-label">{t("redis.value")}</span>
          <Input.TextArea
            value={value}
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder={t("redis.valuePlaceholder")}
            onChange={(event) => onValueChange(event.target.value)}
          />
        </label>
        <label className="redis-field">
          <span className="redis-label">{t("redis.ttlOptional")}</span>
          <Select
            value={ttlPreset}
            onChange={(next) => onTtlPresetChange(String(next))}
            options={[
              { value: "never", label: t("redis.ttlNoExpire") },
              { value: "3600", label: t("redis.ttlHour") },
              { value: "86400", label: t("redis.ttlDay") },
              { value: "604800", label: t("redis.ttlWeek") },
              { value: "custom", label: t("redis.ttlCustom") },
            ]}
          />
          {ttlPreset === "custom" && (
            <InputNumber
              min={1}
              value={ttl}
              placeholder={t("redis.ttlHint")}
              onChange={(next) => onTtlChange(next === null ? null : Number(next))}
              style={{ width: "100%" }}
            />
          )}
        </label>
      </div>
    </Modal>
  );
}

interface RenameDialogProps {
  open: boolean;
  value: string;
  onValueChange: (value: string) => void;
  onCancel: () => void;
  onOk: () => void;
}

/** 重命名键弹窗 */
export function RenameDialog({
  open,
  value,
  onValueChange,
  onCancel,
  onOk,
}: RenameDialogProps) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <Modal
      open={open}
      title={t("redis.renameTitle")}
      onCancel={onCancel}
      onOk={onOk}
      okText={t("common.confirm")}
      okButtonProps={{ disabled: !value.trim() }}
      cancelText={t("common.cancel")}
      width={420}
      destroyOnHidden
    >
      <Input
        value={value}
        placeholder={t("redis.renamePlaceholder")}
        onChange={(event) => onValueChange(event.target.value)}
        onPressEnter={(event) => {
          if (isImeEnter(event)) return;
          onOk();
        }}
      />
    </Modal>
  );
}

interface TtlDialogProps {
  open: boolean;
  value: number | null;
  onValueChange: (value: number | null) => void;
  onCancel: () => void;
  onOk: () => void;
}

/** 设置 TTL 弹窗（-1 表示永不过期） */
export function TtlDialog({ open, value, onValueChange, onCancel, onOk }: TtlDialogProps) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <Modal
      open={open}
      title={t("redis.ttlTitle")}
      onCancel={onCancel}
      onOk={onOk}
      okText={t("common.confirm")}
      cancelText={t("common.cancel")}
      width={420}
      destroyOnHidden
    >
      <div className="redis-form">
        <InputNumber
          min={-1}
          autoFocus
          value={value}
          placeholder={t("redis.ttlHint")}
          onChange={(next) => onValueChange(next === null ? null : Number(next))}
          style={{ width: "100%" }}
        />
        <span className="redis-hint">{t("redis.ttlHint")}</span>
      </div>
    </Modal>
  );
}
