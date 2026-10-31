import { Tooltip } from "antd";
import { useT } from "../../i18n";
import { useUiStore } from "../../stores/uiStore";
import type { MetricsSample } from "../../types";
import { fillWidth, formatRate, formatSize, levelClass, percent } from "./terminalFormatters";

interface Props {
  metrics: MetricsSample;
  net: { rx: number; tx: number };
}

/** 终端工具栏中的远端资源监控：CPU / 内存 / 磁盘 / 网络速率 */
export default function TerminalMetrics({ metrics, net }: Props) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <div className="metrics">
      <Tooltip
        placement="topRight"
        title={
          metrics.cpuCores.length > 0 ? (
            <div className="core-list">
              {metrics.cpuCores.map((value, index) => (
                <div key={index} className="core-row">
                  <span className="core-name">C{index}</span>
                  <span className="meter lg">
                    <span
                      className={`meter-fill ${levelClass(value)}`}
                      style={{ width: fillWidth(value) }}
                    />
                  </span>
                  <span className="core-val">{Math.round(value)}%</span>
                </div>
              ))}
            </div>
          ) : (
            t("term.noCoreData")
          )
        }
      >
        <span className="metric">
          CPU
          <span className="meter sm">
            <span
              className={`meter-fill ${levelClass(metrics.cpuTotal)}`}
              style={{ width: fillWidth(metrics.cpuTotal) }}
            />
          </span>
          <b className={levelClass(metrics.cpuTotal)}>{Math.round(metrics.cpuTotal)}%</b>
        </span>
      </Tooltip>
      <Tooltip
        placement="topRight"
        title={
          <div className="meter-detail">
            <span className="meter lg">
              <span
                className={`meter-fill ${levelClass(percent(metrics.memUsed, metrics.memTotal))}`}
                style={{
                  width: fillWidth(percent(metrics.memUsed, metrics.memTotal)),
                }}
              />
            </span>
            <span className="meter-text">
              {formatSize(metrics.memUsed)} / {formatSize(metrics.memTotal)} ·{" "}
              {Math.round(percent(metrics.memUsed, metrics.memTotal))}%
            </span>
          </div>
        }
      >
        <span className="metric">
          {t("metrics.mem")}
          <span className="meter sm">
            <span
              className={`meter-fill ${levelClass(percent(metrics.memUsed, metrics.memTotal))}`}
              style={{
                width: fillWidth(percent(metrics.memUsed, metrics.memTotal)),
              }}
            />
          </span>
          <b className={levelClass(percent(metrics.memUsed, metrics.memTotal))}>
            {Math.round(percent(metrics.memUsed, metrics.memTotal))}%
          </b>
        </span>
      </Tooltip>
      <Tooltip
        placement="topRight"
        title={
          <div className="meter-detail">
            <span className="meter lg">
              <span
                className={`meter-fill ${levelClass(percent(metrics.diskUsed, metrics.diskTotal))}`}
                style={{
                  width: fillWidth(percent(metrics.diskUsed, metrics.diskTotal)),
                }}
              />
            </span>
            <span className="meter-text">
              {formatSize(metrics.diskUsed)} / {formatSize(metrics.diskTotal)} ·{" "}
              {Math.round(percent(metrics.diskUsed, metrics.diskTotal))}%
            </span>
          </div>
        }
      >
        <span className="metric">
          {t("metrics.disk")}
          <span className="meter sm">
            <span
              className={`meter-fill ${levelClass(percent(metrics.diskUsed, metrics.diskTotal))}`}
              style={{
                width: `${Math.max(1.5, percent(metrics.diskUsed, metrics.diskTotal))}%`,
              }}
            />
          </span>
          <b className={levelClass(percent(metrics.diskUsed, metrics.diskTotal))}>
            {Math.round(percent(metrics.diskUsed, metrics.diskTotal))}%
          </b>
        </span>
      </Tooltip>
      <Tooltip placement="topRight" title={t("metrics.netTip")}>
        <span className="metric net">
          <span className="rate">↓{formatRate(net.rx)}</span>
          <span className="rate">↑{formatRate(net.tx)}</span>
        </span>
      </Tooltip>
    </div>
  );
}
