import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Input,
  InputNumber,
  Spin,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CopyOutlined,
  ReloadOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { inTauri } from "../../save";
import { copyText } from "../../clipboard";

interface NetworkInfo {
  publicIp: string | null;
  location: string | null;
  localIps: { name: string; ip: string }[];
}

const UUID_COUNT = 5;

function makeUuids(): string[] {
  return Array.from({ length: UUID_COUNT }, () => crypto.randomUUID());
}

function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64Decode(text: string): string {
  const binary = atob(text.trim());
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function decodeBase64UrlJson(part: string): unknown {
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(base64Decode(padded));
}

const PASSWORD_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+";

function randomPassword(length: number): string {
  const values = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(values, (value) => PASSWORD_CHARS[value % PASSWORD_CHARS.length]).join("");
}

async function sha256Hex(text: string): Promise<string> {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export default function ToolsModule() {
  const t = useT(useUiStore((state) => state.lang));

  const [info, setInfo] = useState<NetworkInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uuids, setUuids] = useState<string[]>(makeUuids);

  const [base64Input, setBase64Input] = useState("");
  const [base64Result, setBase64Result] = useState("");

  const [urlInput, setUrlInput] = useState("");
  const [urlResult, setUrlResult] = useState("");

  const [jwtInput, setJwtInput] = useState("");
  const [jwtResult, setJwtResult] = useState("");

  const [password, setPassword] = useState(() => randomPassword(16));
  const [passwordLength, setPasswordLength] = useState(16);

  const [md5Input, setMd5Input] = useState("");
  const [md5Result, setMd5Result] = useState("");

  const [shaInput, setShaInput] = useState("");
  const [shaResult, setShaResult] = useState("");

  const [tsInput, setTsInput] = useState(() =>
    String(Math.floor(Date.now() / 1000)),
  );
  const [dateInput, setDateInput] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const copy = async (value: string) => {
    if (!value) return;
    try {
      await copyText(value);
      message.success(t("ip.copied"));
    } catch {
      message.error(t("ip.copyFailed"));
    }
  };

  const loadNetwork = async () => {
    if (!inTauri()) {
      setError(t("ip.onlyDesktop"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      setInfo(await invoke<NetworkInfo>("network_info"));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadNetwork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const computeMd5 = async () => {
    if (!md5Input) return;
    try {
      setMd5Result(await invoke<string>("md5_hash", { text: md5Input }));
    } catch (reason) {
      setError(String(reason));
    }
  };

  const computeSha = async () => {
    if (!shaInput) return;
    try {
      setShaResult(await sha256Hex(shaInput));
    } catch (reason) {
      setError(String(reason));
    }
  };

  const parseJwt = () => {
    try {
      const parts = jwtInput.trim().split(".");
      if (parts.length < 2) throw new Error("Invalid JWT");
      const header = decodeBase64UrlJson(parts[0]);
      const payload = decodeBase64UrlJson(parts[1]);
      setJwtResult(
        `Header:\n${JSON.stringify(header, null, 2)}\n\nPayload:\n${JSON.stringify(
          payload,
          null,
          2,
        )}`,
      );
    } catch (reason) {
      setJwtResult(String(reason));
    }
  };

  const dateFromTs = useMemo(() => {
    const value = Number(tsInput);
    if (!tsInput || !Number.isFinite(value)) return "";
    const ms = tsInput.trim().length > 10 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
  }, [tsInput]);

  const tsFromDate = useMemo(() => {
    if (!dateInput) return "";
    const date = new Date(dateInput);
    return Number.isNaN(date.getTime())
      ? ""
      : String(Math.floor(date.getTime() / 1000));
  }, [dateInput]);

  return (
    <div className="module tools-module">
      <header className="module-head">
        <span className="module-icon">
          <ToolOutlined />
        </span>
        <div>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {t("module.tools")}
          </Typography.Text>
          <div className="module-desc">{t("module.toolsDesc")}</div>
        </div>
        <span style={{ flex: 1 }} />
        <Tooltip title={t("ip.refresh")}>
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void loadNetwork()}
          />
        </Tooltip>
      </header>

      <div className="tools-grid">

        <section className="tools-card">
          <div className="tools-card-head">
            <span className="tools-card-title">{t("tools.ip")}</span>
            <Tooltip title={t("ip.refresh")}>
              <Button
                size="small"
                type="text"
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => void loadNetwork()}
              />
            </Tooltip>
          </div>
          <div className="tools-ip-block">
            <div className="tools-ip-label">
              <span>{t("ip.public")}</span>
              <Tooltip title={t("ip.copy")}>
                <Button
                  size="small"
                  type="text"
                  icon={<CopyOutlined />}
                  disabled={!info?.publicIp}
                  onClick={() => void copy(info?.publicIp ?? "")}
                />
              </Tooltip>
            </div>
            {loading && !info ? (
              <div className="tools-loading">
                <Spin size="small" />
                <span>{t("ip.loading")}</span>
              </div>
            ) : info?.publicIp ? (
              <>
                <div className="ip-value">{info.publicIp}</div>
                {info.location && <div className="ip-location">{info.location}</div>}
              </>
            ) : (
              <div className="ip-empty">{t("ip.noPublic")}</div>
            )}
          </div>
          <div className="tools-ip-block">
            <div className="tools-ip-label">
              <span>{t("ip.local")}</span>
            </div>
            {info && info.localIps.length > 0 ? (
              <div className="ip-list">
                {info.localIps.map((item) => (
                  <div className="ip-row" key={`${item.name}-${item.ip}`}>
                    <span className="ip-row-name">{item.name}</span>
                    <span className="ip-row-ip">{item.ip}</span>
                    <Tooltip title={t("ip.copy")}>
                      <Button
                        size="small"
                        type="text"
                        icon={<CopyOutlined />}
                        onClick={() => void copy(item.ip)}
                      />
                    </Tooltip>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ip-empty">{t("ip.noLocal")}</div>
            )}
          </div>
        </section>
        <section className="tools-card">
          <div className="tools-card-head">
            <span className="tools-card-title">{t("tools.base64")}</span>
            <Tooltip title={t("ip.copy")}>
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                disabled={!base64Result}
                onClick={() => void copy(base64Result)}
              />
            </Tooltip>
          </div>
          <Input.TextArea
            className="tools-textarea"
            value={base64Input}
            placeholder={t("tools.base64Placeholder")}
            onChange={(event) => setBase64Input(event.target.value)}
            autoSize={{ minRows: 2, maxRows: 5 }}
          />
          <div className="tools-buttons">
            <Button
              size="small"
              onClick={() => setBase64Result(base64Encode(base64Input))}
            >
              {t("tools.encode")}
            </Button>
            <Button
              size="small"
              onClick={() => {
                try {
                  setBase64Result(base64Decode(base64Input));
                } catch {
                  setBase64Result(t("tools.invalidInput"));
                }
              }}
            >
              {t("tools.decode")}
            </Button>
          </div>
          <pre className="tools-result">{base64Result}</pre>
        </section>

        <section className="tools-card">
          <div className="tools-card-head">
            <span className="tools-card-title">{t("tools.timestamp")}</span>
            <Tooltip title={t("ip.copy")}>
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                onClick={() => void copy(String(Math.floor(now / 1000)))}
              />
            </Tooltip>
          </div>
          <div className="tools-now">
            {t("tools.now")}：{Math.floor(now / 1000)}
          </div>
          <Input
            value={tsInput}
            placeholder={t("tools.timestampPlaceholder")}
            onChange={(event) => setTsInput(event.target.value)}
          />
          <div className="tools-result-line">{dateFromTs || "—"}</div>
          <Input
            value={dateInput}
            placeholder={t("tools.datePlaceholder")}
            onChange={(event) => setDateInput(event.target.value)}
          />
          <div className="tools-result-line">{tsFromDate || "—"}</div>
        </section>

        <section className="tools-card">
          <div className="tools-card-head">
            <span className="tools-card-title">{t("tools.url")}</span>
            <Tooltip title={t("ip.copy")}>
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                disabled={!urlResult}
                onClick={() => void copy(urlResult)}
              />
            </Tooltip>
          </div>
          <Input.TextArea
            className="tools-textarea"
            value={urlInput}
            placeholder={t("tools.urlPlaceholder")}
            onChange={(event) => setUrlInput(event.target.value)}
            autoSize={{ minRows: 2, maxRows: 5 }}
          />
          <div className="tools-buttons">
            <Button
              size="small"
              onClick={() => setUrlResult(encodeURIComponent(urlInput))}
            >
              {t("tools.encode")}
            </Button>
            <Button
              size="small"
              onClick={() => {
                try {
                  setUrlResult(decodeURIComponent(urlInput));
                } catch {
                  setUrlResult(t("tools.invalidInput"));
                }
              }}
            >
              {t("tools.decode")}
            </Button>
          </div>
          <pre className="tools-result">{urlResult}</pre>
        </section>

        <section className="tools-card">
          <div className="tools-card-head">
            <span className="tools-card-title">{t("tools.md5")}</span>
            <Tooltip title={t("ip.copy")}>
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                disabled={!md5Result}
                onClick={() => void copy(md5Result)}
              />
            </Tooltip>
          </div>
          <Input
            value={md5Input}
            placeholder={t("tools.md5Placeholder")}
            onChange={(event) => setMd5Input(event.target.value)}
            onPressEnter={() => void computeMd5()}
            allowClear
          />
          <Button
            size="small"
            onClick={() => void computeMd5()}
            disabled={!md5Input}
          >
            {t("tools.calculate")}
          </Button>
          <div className="tools-md5">{md5Result || t("tools.md5Empty")}</div>
        </section>

        <section className="tools-card">
          <div className="tools-card-head">
            <span className="tools-card-title">{t("tools.sha256")}</span>
            <Tooltip title={t("ip.copy")}>
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                disabled={!shaResult}
                onClick={() => void copy(shaResult)}
              />
            </Tooltip>
          </div>
          <Input
            value={shaInput}
            placeholder={t("tools.shaPlaceholder")}
            onChange={(event) => setShaInput(event.target.value)}
            onPressEnter={() => void computeSha()}
            allowClear
          />
          <Button
            size="small"
            onClick={() => void computeSha()}
            disabled={!shaInput}
          >
            {t("tools.calculate")}
          </Button>
          <div className="tools-md5">{shaResult || t("tools.shaEmpty")}</div>
        </section>

        <section className="tools-card">
          <div className="tools-card-head">
            <span className="tools-card-title">{t("tools.jwt")}</span>
            <Tooltip title={t("ip.copy")}>
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                disabled={!jwtResult}
                onClick={() => void copy(jwtResult)}
              />
            </Tooltip>
          </div>
          <Input.TextArea
            className="tools-textarea"
            value={jwtInput}
            placeholder={t("tools.jwtPlaceholder")}
            onChange={(event) => setJwtInput(event.target.value)}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
          <div className="tools-buttons">
            <Button size="small" onClick={parseJwt}>
              {t("tools.parse")}
            </Button>
          </div>
          <pre className="tools-result">{jwtResult}</pre>
        </section>

        <section className="tools-card">
          <div className="tools-card-head">
            <span className="tools-card-title">{t("tools.uuid")}</span>
            <div className="tools-card-actions">
              <Tooltip title={t("tools.generate")}>
                <Button
                  size="small"
                  type="text"
                  icon={<ReloadOutlined />}
                  onClick={() => setUuids(makeUuids())}
                />
              </Tooltip>
              <Tooltip title={t("tools.copyAll")}>
                <Button
                  size="small"
                  type="text"
                  icon={<CopyOutlined />}
                  onClick={() => void copy(uuids.join("\n"))}
                />
              </Tooltip>
            </div>
          </div>
          <div className="tools-uuid-list">
            {uuids.map((value, index) => (
              <div className="tools-uuid-row" key={`${value}-${index}`}>
                <span className="tools-uuid">{value}</span>
                <Tooltip title={t("ip.copy")}>
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={() => void copy(value)}
                  />
                </Tooltip>
              </div>
            ))}
          </div>
        </section>

        <section className="tools-card">
          <div className="tools-card-head">
            <span className="tools-card-title">{t("tools.password")}</span>
            <Tooltip title={t("ip.copy")}>
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                onClick={() => void copy(password)}
              />
            </Tooltip>
          </div>
          <div className="tools-password">{password}</div>
          <div className="tools-buttons">
            <InputNumber
              min={4}
              max={64}
              value={passwordLength}
              onChange={(value) => setPasswordLength(Number(value) || 16)}
              style={{ width: 72 }}
            />
            <Button
              size="small"
              onClick={() => setPassword(randomPassword(passwordLength))}
            >
              {t("tools.generate")}
            </Button>
          </div>
        </section>
      </div>

      {error && <div className="tools-error">{error}</div>}
    </div>
  );
}
