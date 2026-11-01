import { useCallback, useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Input, Modal, Tooltip, Typography } from "antd";
import {
  CloseOutlined,
  CopyOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { sshKillProcess, sshProcesses } from "../../api";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { ProcessInfo } from "../../types";
import { copyText } from "../../clipboard";
import { errText, formatBytes } from "../../utils";

interface Props {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
}

type SortKey = "pid" | "name" | "cpu" | "rss" | "started" | "command";
type SortOrder = "asc" | "desc";

/** 文本列默认正序，数值列默认倒序（先看最大的） */
const defaultOrder = (key: SortKey): SortOrder =>
  key === "name" || key === "command" ? "asc" : "desc";

const COLUMNS: { key: SortKey; labelKey: string }[] = [
  { key: "pid", labelKey: "proc.pid" },
  { key: "name", labelKey: "proc.name" },
  { key: "cpu", labelKey: "proc.cpu" },
  { key: "rss", labelKey: "proc.mem" },
  { key: "started", labelKey: "proc.started" },
  { key: "command", labelKey: "proc.command" },
];

export default function ProcessModal({ open, sessionId, onClose }: Props) {
  const [rows, setRows] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; order: SortOrder }>({
    key: "rss",
    order: "desc",
  });
  const [keyword, setKeyword] = useState("");
  const { message, modal } = AntdApp.useApp();
  const lang = useUiStore((state) => state.lang);
  const t = useT(lang);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const list = await sshProcesses(sessionId);
      setRows(list);
      setError(null);
    } catch (err) {
      const text = errText(err);
      setError(text);
      message.error(t("proc.loadFailed", { error: text }));
    } finally {
      setLoading(false);
    }
  }, [sessionId, message]);

  useEffect(() => {
    if (open) {
      void load();
    } else {
      setRows([]);
      setError(null);
      setKeyword("");
      setSort({ key: "rss", order: "desc" });
    }
  }, [open, load]);

  /** 一次只按一列排序；点同一列切换正序 / 倒序 */
  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, order: prev.order === "asc" ? "desc" : "asc" }
        : { key, order: defaultOrder(key) },
    );
  };

  const sorted = useMemo(() => {
    const factor = sort.order === "asc" ? 1 : -1;
    const list = [...rows];
    list.sort((a, b) => {
      switch (sort.key) {
        case "name":
          return a.name.localeCompare(b.name) * factor;
        case "command":
          return a.command.localeCompare(b.command) * factor;
        case "cpu":
          return (a.cpu - b.cpu) * factor;
        case "rss":
          return (a.rss - b.rss) * factor;
        case "started":
          return (a.started - b.started) * factor;
        default:
          return (a.pid - b.pid) * factor;
      }
    });
    return list;
  }, [rows, sort]);

  /** 前端模糊搜索：PID + 进程名 + 启动时间 + 启动命令 拼成一个串做包含匹配 */
  const shown = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return sorted;
    return sorted.filter((item) => {
      const started =
        item.started > 0 ? dayjs.unix(item.started).format("MM-DD HH:mm:ss") : "";
      return `${item.pid} ${item.name} ${started} ${item.command}`
        .toLowerCase()
        .includes(kw);
    });
  }, [sorted, keyword]);

  const copyField = (text: string, label: string) => {
    if (!text) return;
    const preview = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    void copyText(text).then(
      () => message.success(t("common.copied", { label, text: preview })),
      () => message.error(t("common.copyFailed")),
    );
  };

  const killProcess = (item: ProcessInfo) => {
    if (!sessionId) return;
    modal.confirm({
      title: t("proc.killTitle"),
      content: t("proc.killConfirm", { name: item.name, pid: item.pid }),
      okText: t("proc.kill"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await sshKillProcess(sessionId, item.pid);
          message.success(t("proc.killOk", { name: item.name, pid: item.pid }));
          await load();
        } catch (err) {
          message.error(t("proc.killFailed", { error: errText(err) }));
        }
      },
    });
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1010}
      destroyOnClose
      closable={false}
      style={{ top: 32 }}
      title={
        <div className="proc-title">
          <span>{t("proc.title")}</span>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {keyword.trim()
              ? t("proc.match", { matched: shown.length, total: rows.length })
              : t("proc.count", { count: rows.length })}
            {error ? ` · ${error}` : ""}
          </Typography.Text>
          <span style={{ flex: 1 }} />
          <Input
            size="small"
            allowClear
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t("proc.search")}
            prefix={<SearchOutlined style={{ opacity: 0.5 }} />}
            style={{ width: 240 }}
          />
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void load()}
          >
            {t("common.refresh")}
          </Button>
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={onClose}>
            {t("common.close")}
          </Button>
        </div>
      }
    >
      <div className="proc-table">
        {/* 表头固定：只有下面的数据区滚动，竖向滚动条也只出现在数据区 */}
        <div className="proc-head">
          {COLUMNS.map((column) => (
            <div key={column.key} className="proc-cell">
              <button
                type="button"
                className={`th-sort${sort.key === column.key ? " active" : ""}`}
                onClick={() => toggleSort(column.key)}
              >
                {t(column.labelKey)}
                <span className="th-caret">
                  {sort.key === column.key ? (sort.order === "asc" ? "▲" : "▼") : "⇅"}
                </span>
              </button>
            </div>
          ))}
          <div className="proc-cell proc-cell-center">{t("proc.actions")}</div>
        </div>
        <div className="proc-body">
          {shown.map((item) => (
            <div className="proc-row" key={item.pid}>
              <div className="proc-cell proc-cell-pid">
                <span className="proc-num">{item.pid}</span>
                <button
                  type="button"
                  className="proc-icon"
                  title={t("proc.copyPid")}
                  onClick={() => copyField(String(item.pid), " PID")}
                >
                  <CopyOutlined />
                </button>
              </div>
              <div className="proc-cell proc-cell-name">
                <span className="proc-name" title={item.name}>
                  {item.name}
                </span>
                <button
                  type="button"
                  className="proc-icon"
                  title={t("proc.copyName")}
                  onClick={() => copyField(item.name, t("proc.name"))}
                >
                  <CopyOutlined />
                </button>
              </div>
              <div className="proc-cell">
                <span className="proc-num">{item.cpu.toFixed(1)}%</span>
              </div>
              <div className="proc-cell">
                <span className="proc-num">{formatBytes(item.rss)}</span>
              </div>
              <div className="proc-cell">
                <span className="proc-num">
                  {item.started > 0 ? dayjs.unix(item.started).format("MM-DD HH:mm:ss") : "-"}
                </span>
              </div>
              <div className="proc-cell proc-cell-cmd">
                <Tooltip title={item.command || "-"} placement="topLeft">
                  <span className="proc-cmd">{item.command || "-"}</span>
                </Tooltip>
                <button
                  type="button"
                  className="proc-icon"
                  title={t("proc.copyCommand")}
                  onClick={() => copyField(item.command, t("proc.command"))}
                >
                  <CopyOutlined />
                </button>
              </div>
              <div className="proc-cell proc-cell-center">
                <button
                  type="button"
                  className="proc-icon proc-kill"
                  title={t("proc.kill")}
                  onClick={() => killProcess(item)}
                >
                  <PoweroffOutlined />
                </button>
              </div>
            </div>
          ))}
          {!shown.length && (
            <div className="proc-empty">
              {loading ? t("proc.loading") : keyword.trim() ? t("proc.noneMatch") : t("proc.none")}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
