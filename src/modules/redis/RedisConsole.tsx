import { useEffect, useRef, useState } from "react";
import { Button, Input } from "antd";
import { ClearOutlined, CodeOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText, isImeEnter } from "../../utils";
import { redisCommand } from "./api";

interface Props {
  connectionId: string;
}

interface ConsoleLine {
  id: number;
  type: "cmd" | "out" | "error";
  text: string;
}

export default function RedisConsole({ connectionId }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    const element = outputRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const append = (type: ConsoleLine["type"], text: string) => {
    setLines((prev) => [...prev, { id: nextId.current++, type, text }]);
  };

  const run = async () => {
    const command = input.trim();
    if (!command || running) return;
    append("cmd", `> ${command}`);
    setHistory((prev) => [command, ...prev.filter((item) => item !== command)].slice(0, 100));
    setHistoryIndex(-1);
    setInput("");
    setRunning(true);
    try {
      const reply = await redisCommand(connectionId, command);
      append("out", reply.output || "(empty)");
    } catch (error) {
      append("error", errText(error));
    } finally {
      setRunning(false);
    }
  };

  const recall = (direction: 1 | -1) => {
    if (history.length === 0) return;
    const next =
      historyIndex === -1
        ? 0
        : Math.min(history.length - 1, Math.max(0, historyIndex + direction));
    setHistoryIndex(next);
    setInput(history[next] ?? "");
  };

  return (
    <div className="redis-console">
      <div className="redis-console-head">
        <span className="redis-console-title">{t("redis.tabConsole")}</span>
        <span style={{ flex: 1 }} />
        <Button
          size="small"
          type="text"
          icon={<ClearOutlined />}
          onClick={() => setLines([])}
        >
          {t("redis.clear")}
        </Button>
      </div>

      <div className="redis-console-output" ref={outputRef}>
        {lines.length === 0 && (
          <div className="redis-console-empty">
            <span className="app-empty-glyph">
              <CodeOutlined />
            </span>
            <div className="app-empty-title">{t("redis.consoleEmpty")}</div>
            <div className="app-empty-hint">{t("redis.consoleEmptyHint")}</div>
          </div>
        )}
        {lines.map((line) => (
          <pre
            className={`redis-console-line ${
              line.type === "cmd"
                ? "redis-console-cmd"
                : line.type === "error"
                  ? "redis-console-error"
                  : "redis-console-out"
            }`}
            key={line.id}
          >
            {line.text}
          </pre>
        ))}
      </div>

      <div className="redis-console-input">
        <Input
          value={input}
          placeholder={t("redis.consolePlaceholder")}
          onChange={(event) => setInput(event.target.value)}
          onPressEnter={(event) => {
            if (isImeEnter(event)) return;
            void run();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              recall(1);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              recall(-1);
            }
          }}
          disabled={running}
        />
        <Button type="primary" onClick={() => void run()} loading={running}>
          {t("redis.run")}
        </Button>
      </div>
      <div className="redis-console-hint">{t("redis.consoleHint")}</div>
    </div>
  );
}
