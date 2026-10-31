import { Input, Modal } from "antd";
import type { TFunction } from "../../i18n";
import { isImeEnter } from "../../utils";

interface Props {
  open: boolean;
  /** 当前是否在编辑已有站点（false 表示新增） */
  editing: boolean;
  draftName: string;
  draftUrl: string;
  t: TFunction;
  onNameChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  afterClose: () => void;
}

export function SiteEditorModal({
  open,
  editing,
  draftName,
  draftUrl,
  t,
  onNameChange,
  onUrlChange,
  onSave,
  onCancel,
  afterClose,
}: Props) {
  return (
    <Modal
      open={open}
      title={editing ? t("browser.editSite") : t("browser.addSite")}
      okText={t("common.save")}
      cancelText={t("common.cancel")}
      onOk={onSave}
      onCancel={onCancel}
      afterClose={afterClose}
      width={480}
    >
      <div className="browser-site-form">
        <label className="browser-site-field">
          <span>{t("browser.siteName")}</span>
          <Input
            autoFocus
            value={draftName}
            placeholder={t("browser.siteNamePlaceholder")}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </label>
        <label className="browser-site-field">
          <span>{t("browser.siteUrl")}</span>
          <Input
            value={draftUrl}
            placeholder={t("browser.siteUrlPlaceholder")}
            onChange={(event) => onUrlChange(event.target.value)}
            onPressEnter={(event) => {
              if (isImeEnter(event)) return;
              onSave();
            }}
          />
        </label>
      </div>
    </Modal>
  );
}
