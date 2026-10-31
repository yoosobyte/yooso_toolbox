import { Fragment, useMemo } from "react";
import { App as AntdApp, Button, Dropdown, Tooltip } from "antd";
import {
  CloseOutlined,
  CloudUploadOutlined,
  DisconnectOutlined,
  FolderAddOutlined,
  LinkOutlined,
  ReloadOutlined,
  UploadOutlined,
} from "@ant-design/icons";

import { copyText } from "../../../clipboard";
import { useT } from "../../../i18n";
import { useUiStore } from "../../../stores/uiStore";
import { buildCrumbs } from "./utils";

interface Props {
  sessionId: string | null;
  path: string;
  initError: string | null;
  follow: boolean;
  loading: boolean;
  onNavigate: (target: string) => void;
  onToggleFollow: () => void;
  onRefresh: () => void;
  onCreateDir: () => void;
  onUpload: (directory: boolean) => void;
  onClose: () => void;
}

/** SFTP 顶部工具栏：面包屑、复制路径、跟随开关、刷新、新建目录、上传、关闭。 */
export default function SftpToolbar({
  sessionId,
  path,
  initError,
  follow,
  loading,
  onNavigate,
  onToggleFollow,
  onRefresh,
  onCreateDir,
  onUpload,
  onClose,
}: Props) {
  const { message } = AntdApp.useApp();
  const lang = useUiStore((state) => state.lang);
  const t = useT(lang);

  /** 面包屑：路径每一段都可点击跳转 */
  const crumbs = useMemo(() => buildCrumbs(path), [path]);

  return (
    <div className="sftp-head">
      <div className="sftp-path-row">
        {crumbs.length > 0 ? (
          <nav className="sftp-crumbs" title={path}>
            {crumbs.map((crumb, index) => (
              <Fragment key={crumb.path}>
                {index > 1 && <span className="crumb-sep">/</span>}
                <button
                  type="button"
                  className={`crumb${index === crumbs.length - 1 ? " current" : ""}`}
                  onClick={() => onNavigate(crumb.path)}
                >
                  {crumb.label}
                </button>
              </Fragment>
            ))}
          </nav>
        ) : (
          <span className="sftp-path" title={initError || undefined}>
            {initError
              ? t("sftp.initFailed")
              : sessionId
                ? t("sftp.connecting")
                : t("sftp.disconnected")}
          </span>
        )}
        <button
          type="button"
          className="path-copy"
          disabled={!path}
          onClick={async () => {
            try {
              await copyText(path);
              message.success(t("sftp.pathCopied"));
            } catch {
              message.error(t("sftp.copyFailed"));
            }
          }}
        >
          {t("sftp.copyPath")}
        </button>
      </div>
      <Tooltip title={follow ? t("sftp.followOn") : t("sftp.followOff")}>
        <Button
          size="small"
          type="text"
          icon={follow ? <LinkOutlined /> : <DisconnectOutlined />}
          disabled={!sessionId}
          onClick={onToggleFollow}
        />
      </Tooltip>
      <Tooltip title={t("common.refresh")}>
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          disabled={!sessionId}
          loading={loading}
          onClick={onRefresh}
        />
      </Tooltip>
      <Tooltip title={t("sftp.mkdir")}>
        <Button
          size="small"
          type="text"
          icon={<FolderAddOutlined />}
          disabled={!sessionId}
          onClick={onCreateDir}
        />
      </Tooltip>
      <Dropdown
        trigger={["click"]}
        placement="topRight"
        disabled={!sessionId}
        menu={{
          items: [
            { key: "file", icon: <UploadOutlined />, label: t("sftp.uploadFile") },
            { key: "dir", icon: <FolderAddOutlined />, label: t("sftp.uploadDir") },
          ],
          onClick: ({ key }) => onUpload(key === "dir"),
        }}
      >
        <Button
          size="small"
          type="text"
          icon={<CloudUploadOutlined />}
          disabled={!sessionId}
        />
      </Dropdown>
      <Tooltip title={t("sftp.close")} placement="topRight">
        <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose} />
      </Tooltip>
    </div>
  );
}
