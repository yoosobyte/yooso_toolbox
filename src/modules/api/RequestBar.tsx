import { Button, Dropdown, Input, Select, Tooltip } from "antd";
import {
  ClearOutlined,
  CopyOutlined,
  HistoryOutlined,
  LoadingOutlined,
  SaveOutlined,
  SendOutlined,
} from "@ant-design/icons";
import type { ApiRequest, HttpMethod } from "../../types";
import { isImeEnter } from "../../utils";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { useCopy } from "./useCopy";
import { BAR_BTN, METHODS, METHOD_COLOR } from "./constants";

interface Props {
  request: ApiRequest;
  sending: boolean;
  recentUrls: string[];
  finalUrl: string;
  onPatch: (next: Partial<ApiRequest>) => void;
  onSend: () => void;
  onReset: () => void;
  onOpenSave: () => void;
}

/** 请求栏：方法下拉 + 地址输入 + 最近使用 / 复制 / 重置 / 保存 */
export default function RequestBar({
  request,
  sending,
  recentUrls,
  finalUrl,
  onPatch,
  onSend,
  onReset,
  onOpenSave,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const copy = useCopy();

  return (
    <div className="api-bar">
      <Select
        className="api-method"
        value={request.method}
        onChange={(value) => onPatch({ method: value as HttpMethod })}
        options={METHODS.map((method) => ({
          value: method,
          label: <span style={{ color: METHOD_COLOR[method], fontWeight: 600 }}>{method}</span>,
        }))}
      />
      <Input
        value={request.url}
        placeholder={t("api.urlPlaceholder")}
        onChange={(event) => onPatch({ url: event.target.value })}
        onPressEnter={(event) => {
          if (isImeEnter(event)) return;
          void onSend();
        }}
        suffix={
          sending ? (
            <LoadingOutlined />
          ) : (
            <SendOutlined style={{ cursor: "pointer" }} onClick={() => void onSend()} />
          )
        }
      />
      <Dropdown
        trigger={["click"]}
        placement="bottomRight"
        menu={{
          items: recentUrls.length
            ? recentUrls.map((url) => ({ key: url, label: url }))
            : [{ key: "__empty", label: t("api.emptyUrlHistory"), disabled: true }],
          onClick: ({ key }) => {
            if (key !== "__empty") onPatch({ url: key });
          },
        }}
      >
        <Tooltip title={t("api.urlHistory")} placement="topRight">
          <Button style={BAR_BTN} icon={<HistoryOutlined />} />
        </Tooltip>
      </Dropdown>
      <Tooltip title={t("api.copyUrl")}>
        <Button style={BAR_BTN} icon={<CopyOutlined />} onClick={() => copy(finalUrl, "URL")} />
      </Tooltip>
      <Tooltip title={t("api.clear")}>
        <Button style={BAR_BTN} icon={<ClearOutlined />} onClick={onReset} />
      </Tooltip>
      <Tooltip title={t("api.saveAs")}>
        <Button style={BAR_BTN} icon={<SaveOutlined />} onClick={onOpenSave} />
      </Tooltip>
    </div>
  );
}
