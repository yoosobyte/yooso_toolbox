import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ExportOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { Button, Input, Tooltip } from "antd";
import type { TFunction } from "../../i18n";

interface Props {
  t: TFunction;
  address: string;
  canBack: boolean;
  canForward: boolean;
  hasActive: boolean;
  onAddressChange: (value: string) => void;
  onNavigate: () => void;
  onTravel: (delta: number) => void;
  onReload: () => void;
  onOpenExternal: () => void;
}

export function BrowserToolbar({
  t,
  address,
  canBack,
  canForward,
  hasActive,
  onAddressChange,
  onNavigate,
  onTravel,
  onReload,
  onOpenExternal,
}: Props) {
  return (
    <div className="browser-bar">
      <Tooltip title={t("browser.back")}>
        <Button
          size="small"
          type="text"
          icon={<ArrowLeftOutlined />}
          disabled={!canBack}
          onClick={() => onTravel(-1)}
        />
      </Tooltip>
      <Tooltip title={t("browser.forward")}>
        <Button
          size="small"
          type="text"
          icon={<ArrowRightOutlined />}
          disabled={!canForward}
          onClick={() => onTravel(1)}
        />
      </Tooltip>
      <Tooltip title={t("browser.reload")}>
        <Button
          size="small"
          type="text"
          icon={<ReloadOutlined />}
          disabled={!hasActive}
          onClick={onReload}
        />
      </Tooltip>
      <Input
        className="browser-address"
        value={address}
        placeholder={t("browser.addressPlaceholder")}
        onChange={(event) => onAddressChange(event.target.value)}
        onPressEnter={onNavigate}
        allowClear
      />
      <Button icon={<ArrowRightOutlined />} onClick={onNavigate}>
        {t("browser.go")}
      </Button>
      <Tooltip title={t("browser.openExternal")}>
        <Button
          icon={<ExportOutlined />}
          disabled={!hasActive}
          onClick={onOpenExternal}
        />
      </Tooltip>
    </div>
  );
}
