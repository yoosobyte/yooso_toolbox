import { Input, Modal, Typography } from "antd";

import { useT } from "../../../i18n";
import { useUiStore } from "../../../stores/uiStore";
import type { SftpDialogState } from "./types";

interface Props {
  dialog: SftpDialogState;
  submitting: boolean;
  path: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

/** 新建目录 / 重命名弹窗。 */
export default function SftpNameDialog({
  dialog,
  submitting,
  path,
  onChange,
  onCancel,
  onSubmit,
}: Props) {
  const lang = useUiStore((state) => state.lang);
  const t = useT(lang);

  return (
    <Modal
      open={dialog !== null}
      title={dialog?.kind === "mkdir" ? t("sftp.mkdir") : t("common.rename")}
      onCancel={onCancel}
      onOk={onSubmit}
      confirmLoading={submitting}
      okText={t("common.confirm")}
      cancelText={t("common.cancel")}
      width={380}
    >
      <Input
        autoFocus
        value={dialog?.value ?? ""}
        placeholder={dialog?.kind === "mkdir" ? t("sftp.enterName") : t("sftp.newName")}
        onChange={(event) => onChange(event.target.value)}
        onPressEnter={onSubmit}
      />
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {t("sftp.location", { path })}
      </Typography.Text>
    </Modal>
  );
}
