import { App as AntdApp } from "antd";
import {
  ClearOutlined,
  CopyOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  SelectOutlined,
  SnippetsOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { Terminal } from "@xterm/xterm";
import ContextMenu from "../../components/ContextMenu";
import type { ContextMenuItem } from "../../components/ContextMenu";
import { copyText, pasteText } from "../../clipboard";
import { useT } from "../../i18n";
import { useUiStore } from "../../stores/uiStore";
import type { TermTab } from "../../types";

interface Props {
  x: number;
  y: number;
  tab: TermTab;
  /** 每次操作时读取当前 xterm 实例，避免重连后仍引用已销毁的实例 */
  getTerminal: () => Terminal | null;
  onClose: () => void;
  onReconnect: () => void;
  onToggleSftp: () => void;
}

/** 终端右键菜单：复制 / 粘贴 / 全选 / 清屏 / 重连 / SFTP */
export default function TerminalContextMenu({
  x,
  y,
  tab,
  getTerminal,
  onClose,
  onReconnect,
  onToggleSftp,
}: Props) {
  const { message } = AntdApp.useApp();
  const t = useT(useUiStore((state) => state.lang));

  /** 菜单/按钮操作后把焦点还给终端，这样粘贴完直接按回车就能执行 */
  const focusTerminal = () => {
    window.setTimeout(() => getTerminal()?.focus(), 0);
  };

  const copySelection = () => {
    const selection = getTerminal()?.getSelection();
    if (!selection) {
      message.info(t("term.selectFirst"));
      return;
    }
    void copyText(selection).then(
      () => message.success(t("term.copied")),
      () => message.error(t("common.copyFailed")),
    );
    focusTerminal();
  };

  const pasteClipboard = async () => {
    try {
      const text = await pasteText();
      if (text) getTerminal()?.paste(text);
    } catch {
      message.error(t("term.clipboardFailed"));
    } finally {
      focusTerminal();
    }
  };

  const menuItems: ContextMenuItem[] = [
    {
      key: "copy",
      icon: <CopyOutlined />,
      label: t("common.copy"),
      disabled: !getTerminal()?.hasSelection(),
      onClick: copySelection,
    },
    {
      key: "paste",
      icon: <SnippetsOutlined />,
      label: t("common.paste"),
      onClick: () => void pasteClipboard(),
    },
    {
      key: "select-all",
      icon: <SelectOutlined />,
      label: t("term.selectAll"),
      onClick: () => {
        getTerminal()?.selectAll();
        focusTerminal();
      },
    },
    { type: "divider" },
    {
      key: "clear",
      icon: <ClearOutlined />,
      label: t("term.clear"),
      onClick: () => {
        getTerminal()?.clear();
        focusTerminal();
      },
    },
    {
      key: "reconnect",
      icon: <ThunderboltOutlined />,
      label: t("term.reconnect"),
      onClick: onReconnect,
    },
    {
      key: "sftp",
      icon: tab.sftpOpen ? <FolderOpenOutlined /> : <FolderOutlined />,
      label: tab.sftpOpen ? t("term.closeSftp") : t("term.openSftp"),
      disabled: tab.status !== "connected",
      onClick: onToggleSftp,
    },
  ];

  return <ContextMenu x={x} y={y} items={menuItems} onClose={onClose} />;
}
