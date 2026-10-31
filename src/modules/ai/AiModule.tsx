import { useEffect, useRef, useState } from "react";
import { App as AntdApp, Button, Input, Modal, Select, Tooltip, Typography } from "antd";
import {
  RobotOutlined,
  ArrowUpOutlined,
  ClearOutlined,
  FolderOpenOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Channel, invoke } from "@tauri-apps/api/core";
import { secretDelete, secretGet, secretSet } from "../../api";
import { open } from "@tauri-apps/plugin-dialog";
import { useUiStore } from "../../stores/uiStore";
import { AgentNavIcon } from "../../components/NavIcons";
import { useT } from "../../i18n";
import { inTauri } from "../../save";
import { errText, isImeEnter } from "../../utils";
import { loadStored, saveStored } from "../../storage";
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

const AI_SECRET_KEY = "ai.apiKey";
const AI_PREFS_KEY = "ai.settings";

/** 读取本地旧的设置（apiKey 现已迁移到加密凭据库） */
function readLocalSettings(): Partial<AiSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as Partial<AiSettings>;
  } catch {
    /* ignore */
  }
  return {};
}

function loadSettings(): AiSettings {
  const local = readLocalSettings();
  return {
    // apiKey 启动后从加密凭据库异步读取
    apiKey: "",
    model: typeof local.model === "string" && local.model ? local.model : DEFAULT_MODEL,
    workspace: typeof local.workspace === "string" ? local.workspace : "",
  };
}

const SYSTEM_PROMPT = `你是「悦盒」里的 AI 编码助手，帮助用户阅读和修改项目代码。
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
  const { message } = AntdApp.useApp();
  const [settings, setSettings] = useState<AiSettings>(loadSettings);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<ApiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftKey, setDraftKey] = useState(settings.apiKey);
  const [draftModel, setDraftModel] = useState(settings.model);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const abortRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  /* 迁移完成前不要覆盖 localStorage，避免迁移失败时把旧 Key 抹掉 */
  const migratedRef = useRef(false);

  /* API Key 与 model/workspace 都存在加密凭据库 */
  useEffect(() => {
    if (!inTauri()) {
      migratedRef.current = true;
      return;
    }
    let alive = true;
    void (async () => {
      try {
        // API Key
        const storedKey = await secretGet(AI_SECRET_KEY);
        if (storedKey) {
          if (alive) setSettings((prev) => ({ ...prev, apiKey: storedKey }));
        }

        // model / workspace（旧版在 localStorage，迁移后删除）
        const raw = await loadStored(AI_PREFS_KEY);
        let prefs: { model?: string; workspace?: string } | null = null;
        if (raw) {
          try {
            prefs = JSON.parse(raw) as { model?: string; workspace?: string };
          } catch {
            prefs = null;
          }
        }
        const legacy = readLocalSettings();
        if (!prefs && (legacy.model || legacy.workspace)) {
          prefs = { model: legacy.model, workspace: legacy.workspace };
          await saveStored(AI_PREFS_KEY, JSON.stringify(prefs));
        }
        if (!storedKey && legacy.apiKey?.trim()) {
          await secretSet(AI_SECRET_KEY, legacy.apiKey.trim());
          if (alive) setSettings((prev) => ({ ...prev, apiKey: legacy.apiKey!.trim() }));
        }
        // 旧 key 里可能还残留明文 apiKey，迁移完直接删掉
        try {
          localStorage.removeItem(SETTINGS_KEY);
        } catch {
          /* ignore */
        }
        if (prefs && alive) {
          setSettings((prev) => ({
            ...prev,
            model: prefs?.model ?? prev.model,
            workspace: prefs?.workspace ?? prev.workspace,
          }));
        }
      } catch {
        /* 凭据库不可用时保持默认 */
      } finally {
        migratedRef.current = true;
      }
    })();
    return () => {
      alive = false;
    };
    // 只在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* model / workspace 存后端凭据库 */
  useEffect(() => {
    if (!migratedRef.current) return;
    void saveStored(
      AI_PREFS_KEY,
      JSON.stringify({ model: settings.model, workspace: settings.workspace }),
    );
  }, [settings.model, settings.workspace]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, status, streamingText]);

  const openSettings = () => {
    setDraftKey(settings.apiKey);
    setDraftModel(settings.model);
    setSettingsOpen(true);
  };

  /** 工作目录独立选择，直接保存，不经过 API Key 设置弹窗 */
  const pickWorkspace = async () => {
    if (!inTauri()) return;
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") {
      setSettings((prev) => ({ ...prev, workspace: picked }));
    }
  };

  const saveSettings = () => {
    const apiKey = draftKey.trim();
    setSettings((prev) => ({ ...prev, model: draftModel || DEFAULT_MODEL }));
    setSettingsOpen(false);
    if (!inTauri()) {
      setSettings((prev) => ({ ...prev, apiKey }));
      return;
    }
    void (async () => {
      try {
        if (apiKey) await secretSet(AI_SECRET_KEY, apiKey);
        else await secretDelete(AI_SECRET_KEY);
        setSettings((prev) => ({ ...prev, apiKey }));
      } catch (error) {
        message.error(errText(error));
      }
    })();
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
          <AgentNavIcon />
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
        <Tooltip title={t("ai.pickDir")}>
          <Button
            size="small"
            type="text"
            icon={<FolderOpenOutlined />}
            onClick={() => void pickWorkspace()}
          />
        </Tooltip>
        <span className="ai-workspace" title={settings.workspace || t("ai.noWorkspace")}>
          {settings.workspace || t("ai.noWorkspace")}
        </span>
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
        {messages.length === 0 && (
          <div className="ai-empty">
            <span className="app-empty-glyph">
              <RobotOutlined />
            </span>
            <div className="app-empty-title">{t("ai.emptyTitle")}</div>
            <div className="app-empty-hint">{t("ai.empty")}</div>
          </div>
        )}
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
            if (isImeEnter(event)) return;
            if (!event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="ai-composer-bar">
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
        </div>
      </Modal>
    </div>
  );
}
