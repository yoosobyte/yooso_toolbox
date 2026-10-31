import { App as AntdApp } from "antd";
import { copyText } from "../../clipboard";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";

/** 复制到剪贴板并给出统一提示（空内容提示、成功 / 失败提示） */
export function useCopy() {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();

  return (text: string, label: string) => {
    if (!text?.trim()) {
      message.warning(t("api.nothingToCopy"));
      return;
    }
    void copyText(text).then(
      () => message.success(t("api.copied", { label })),
      () => message.error(t("common.copyFailed")),
    );
  };
}
