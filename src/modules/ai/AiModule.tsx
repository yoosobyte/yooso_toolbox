import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Select, Tooltip, Typography } from "antd";
import {
  ClearOutlined,
  FolderOpenOutlined,
  ArrowUpOutlined,
  RobotOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Channel, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { inTauri } from "../../save";
import { renderMarkdown } from "../note/markdown";
import {
  TOOL_SCHEMAS,
  diffStat,
  runTool,
  undoChange,
  type FileChange,
} from "./tools";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ApiMessage {
  role: string;
  content?: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

type StreamEvent =
  | { type: "content"; text: string }
  | { type: "done"; message: ApiMessage };

interface AiSettings {
  apiKey: string;
  model: string;
  workspace: string;
}

const SETTINGS_KEY = "yooso.ai.settings.v1";
const DEFAULT_MODEL = "deepseek-chat";

function loadSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiSettings>;
      return {
        apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
        model: typeof parsed.model === "string" && parsed.model ? parsed.model : DEFAULT_MODEL,
        workspace: typeof parsed.workspace === "string" ? parsed.workspace : "",
      };
    }
  } catch {
    /* ignore */
  }
  return { apiKey: "", model: DEFAULT_MODEL, workspace: "" };
}

const SYSTEM_PROMPT = `你是 Yooso Toolbox 里的 AI 编码助手，帮助用户阅读和修改项目代码。
工作目录：{workspace}

规则：
- 先用 list_dir / read_file 了解项目结构和相关文件，再动手修改。
- 修改或创建文件时用 write_file 写入完整文件内容（不是 diff）。
- 路径一律使用相对工作目录的路径，不要访问工作目录之外的文件。
- 回答用中文；代码放在 markdown 代码块里；改动文件后简要说明改了哪些文件。`;

function formatToolStatus(name: string, args: Record<string, unknown>): string {
  const path = typeof args.path === "string" ? args.path : "";
  if (name === "list_dir") return `查看目录 ${path || "."}`;
  if (name === "read_file") return `读取 ${path}`;
  if (name === "write_file") return `写入 ${path}`;
  return name;
}

export default function AiModule() {
  const t = useT(useUiStore((state) => state.lang));
  const [settings, setSettings] = useState<AiSettings>(loadSettings);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftKey, setDraftKey] = useState(settings.apiKey);
  const [draftModel, setDraftModel] = useState(settings.model);
  const [draftWorkspace, setDraftWorkspace] = useState(settings.workspace);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const abortRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, status, streamingText]);

  const openSettings = () => {
    setDraftKey(settings.apiKey);
    setDraftModel(settings.model);
    setDraftWorkspace(settings.workspace);
    setSettingsOpen(true);
  };

  const pickWorkspace = async () => {
    if (!inTauri()) return;
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") setDraftWorkspace(picked);
  };

  const saveSettings = () => {
    setSettings({
      apiKey: draftKey.trim(),
      model: draftModel || DEFAULT_MODEL,
      workspace: draftWorkspace.trim(),
    });
    setSettingsOpen(false);
  };

  const streamOnce = async (nextHistory: ApiMessage[]): Promise<ApiMessage> => {
    const channel = new Channel<StreamEvent>();
    let resolveDone: (message: ApiMessage) => void = () => undefined;
    const donePromise = new Promise<ApiMessage>((resolve) => {
      resolveDone = resolve;
    });
    channel.onmessage = (event) => {
      if (event.type === "content") {
        setStreamingText((prev) => prev + event.text);
      } else if (event.type === "done") {
        resolveDone(event.message);
      }
    };
    await invoke("ai_chat_stream", {
      apiKey: settings.apiKey,
      model: settings.model,
      messages: nextHistory,
      tools: TOOL_SCHEMAS,
      onEvent: channel,
    });
    return donePromise;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!settings.apiKey.trim() || !settings.workspace.trim()) {
      openSettings();
      return;
    }
    setInput("");
    setBusy(true);
    abortRef.current = false;
    setStreamingText("");
    setStatus("思考中…");
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    const nextHistory: ApiMessage[] = [
      { role: "system", content: SYSTEM_PROMPT.replace("{workspace}", settings.workspace) },
      ...history,
      { role: "user", content: text },
    ];

    try {
      let finished = false;
      for (let round = 0; round < 12 && !finished; round += 1) {
        if (abortRef.current) break;
        setStatus(round === 0 ? "思考中…" : "继续处理…");
        setStreamingText("");
        const message = await streamOnce(nextHistory);
        nextHistory.push(message);

        const toolCalls = (message.tool_calls ?? []) as {
          id: string;
          function: { name: string; arguments: string };
        }[];
        if (toolCalls.length > 0) {
          setStreamingText("");
          for (const call of toolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
            } catch {
              args = {};
            }
            setStatus(`工具：${formatToolStatus(call.function.name, args)}`);
            let result = "";
            try {
              const toolResult = await runTool(settings.workspace, call.function.name, args);
              result = toolResult.text;
              if (toolResult.change) {
                const change = toolResult.change;
                setChanges((prev) => [...prev, change]);
              }
            } catch (error) {
              result = `工具执行失败：${String(error)}`;
            }
            nextHistory.push({
              role: "tool",
              tool_call_id: call.id,
              content: result,
            });
          }
          continue;
        }

        const content = String(message.content ?? "");
        setMessages((prev) => [...prev, { role: "assistant", content }]);
        setHistory(nextHistory.filter((item) => item.role !== "system"));
        setStatus("");
        finished = true;
      }
      if (!finished && !abortRef.current) {
        setStatus("已达到工具调用轮数上限，请继续追问。");
      }
    } catch (error) {
      setStatus(`出错：${String(error)}`);
    } finally {
      setStreamingText("");
      setBusy(false);
    }
  };

  const undo = async (index: number) => {
    const change = changes[index];
    if (!change) return;
    try {
      await undoChange(settings.workspace, change);
      setChanges((prev) => prev.filter((_, i) => i !== index));
      setStatus(`已撤销 ${change.path}`);
    } catch (error) {
      setStatus(`撤销失败：${String(error)}`);
    }
  };

  return (
    <div className="module ai-module">
      <header className="module-head">
        <span className="module-icon">
          <RobotOutlined />
        </span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {t("module.ai")}
          </Typography.Text>
          <div className="module-desc">{t("module.aiDesc")}</div>
        </div>
        <span style={{ flex: 1 }} />
        <Tooltip title={t("ai.settings")}>
          <Button size="small" type="text" icon={<SettingOutlined />} onClick={openSettings} />
        </Tooltip>
      </header>

      <div className="ai-toolbar">
        <span className="ai-workspace" title={settings.workspace || t("ai.noWorkspace")}>
          {settings.workspace || t("ai.noWorkspace")}
        </span>
        <Tooltip title={t("ai.pickDir")}>
          <Button size="small" icon={<FolderOpenOutlined />} onClick={openSettings} />
        </Tooltip>
        <span style={{ flex: 1 }} />
        <Tooltip title={t("ai.clear")}>
          <Button
            size="small"
            type="text"
            icon={<ClearOutlined />}
            disabled={busy}
            onClick={() => {
              setMessages([]);
              setHistory([]);
              setChanges([]);
              setStreamingText("");
              setStatus("");
            }}
          />
        </Tooltip>
      </div>

      <div className="ai-messages" ref={listRef}>
        {messages.length === 0 && <div className="ai-empty">{t("ai.empty")}</div>}
        {messages.map((message, index) => (
          <div key={index} className={`ai-message ${message.role}`}>
            <div className="ai-role">{message.role === "user" ? t("ai.you") : "AI"}</div>
            <div className="ai-content">
              {message.role === "assistant"
                ? renderMarkdown(message.content)
                : message.content}
            </div>
          </div>
        ))}
        {streamingText && (
          <div className="ai-message assistant">
            <div className="ai-role">AI</div>
            <div className="ai-content">{renderMarkdown(streamingText)}</div>
          </div>
        )}
        {status && <div className="ai-status">{status}</div>}
      </div>

      {changes.length > 0 && (
        <div className="ai-changes">
          <div className="ai-changes-head">已修改 {changes.length} 个文件</div>
          {changes.map((change, index) => {
            const stat = diffStat(change.before, change.after);
            return (
              <div className="ai-change" key={`${change.path}-${index}`}>
                <span className="ai-change-path">{change.path}</span>
                <span className="ai-change-stat">
                  +{stat.add} -{stat.del}
                </span>
                <Button
                  size="small"
                  type="link"
                  disabled={busy}
                  onClick={() => void undo(index)}
                >
                  撤销
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className="ai-composer">
        <Input.TextArea
          className="ai-composer-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t("ai.placeholder")}
          autoSize={{ minRows: 2, maxRows: 6 }}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="ai-composer-bar">
          <Tooltip title={t("ai.pickDir")}>
            <Button
              size="small"
              type="text"
              icon={<FolderOpenOutlined />}
              onClick={openSettings}
            />
          </Tooltip>
          <Tooltip title={t("ai.clear")}>
            <Button
              size="small"
              type="text"
              icon={<ClearOutlined />}
              disabled={busy}
              onClick={() => {
                setMessages([]);
                setHistory([]);
                setChanges([]);
                setStreamingText("");
                setStatus("");
              }}
            />
          </Tooltip>
          <span style={{ flex: 1 }} />
          <Select
            size="small"
            variant="borderless"
            value={settings.model}
            popupMatchSelectWidth={false}
            onChange={(model) => setSettings((prev) => ({ ...prev, model }))}
            options={[
              { value: "deepseek-chat", label: "deepseek-chat" },
              { value: "deepseek-reasoner", label: "deepseek-reasoner" },
            ]}
            style={{ width: 150 }}
          />
          <Tooltip title={t("ai.send")}>
            <Button
              type="primary"
              shape="circle"
              icon={<ArrowUpOutlined />}
              loading={busy}
              disabled={!input.trim()}
              onClick={() => void send()}
            />
          </Tooltip>
        </div>
      </div>

      <Modal
        open={settingsOpen}
        title={t("ai.settings")}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        onOk={saveSettings}
        onCancel={() => setSettingsOpen(false)}
        width={520}
      >
        <div className="ai-settings">
          <label className="ai-field">
            <span>{t("ai.apiKey")}</span>
            <Input.Password
              value={draftKey}
              placeholder="sk-..."
              onChange={(event) => setDraftKey(event.target.value)}
            />
          </label>
          <label className="ai-field">
            <span>{t("ai.model")}</span>
            <Select
              value={draftModel}
              onChange={setDraftModel}
              options={[
                { value: "deepseek-chat", label: "deepseek-chat" },
                { value: "deepseek-reasoner", label: "deepseek-reasoner" },
              ]}
            />
          </label>
          <label className="ai-field">
            <span>{t("ai.workspace")}</span>
            <div className="ai-workspace-row">
              <Input
                value={draftWorkspace}
                placeholder="/path/to/project"
                onChange={(event) => setDraftWorkspace(event.target.value)}
              />
              <Button icon={<FolderOpenOutlined />} onClick={() => void pickWorkspace()}>
                {t("ai.pickDir")}
              </Button>
            </div>
          </label>
        </div>
      </Modal>
    </div>
  );
}
