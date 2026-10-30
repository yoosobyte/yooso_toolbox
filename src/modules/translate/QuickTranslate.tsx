import { useEffect, useMemo, useRef, useState } from "react";
import { App as AntdApp, Button, Input, Segmented, Select, Tooltip } from "antd";
import {
  ClearOutlined,
  CopyOutlined,
  LoadingOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  TranslationOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { copyText } from "../../clipboard";
import { errText } from "../../utils";
import { translateText, type TranslateLine, type TranslateResult } from "./api";
import {
  looksLikeEnglish,
  nameVariants,
  splitIdentifier,
  type NameVariants,
} from "./identifier";

interface Props {
  line: TranslateLine;
  onLineChange: (line: TranslateLine) => void;
  onOpenWeb: () => void;
}

const DIR_KEY = "yooso.translate.direction";
const MAX_CHARS = 1000;

const LANGUAGE_VALUES = [
  "auto",
  "zh-Hans",
  "zh-Hant",
  "en",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "ru",
] as const;

function readDirection(): { from: string; to: string } {
  try {
    const raw = localStorage.getItem(DIR_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { from?: string; to?: string };
      if (
        parsed.from &&
        parsed.to &&
        LANGUAGE_VALUES.includes(parsed.from as (typeof LANGUAGE_VALUES)[number]) &&
        LANGUAGE_VALUES.includes(parsed.to as (typeof LANGUAGE_VALUES)[number]) &&
        parsed.to !== "auto"
      ) {
        return { from: parsed.from, to: parsed.to };
      }
    }
  } catch {
    /* 忽略损坏的本地配置 */
  }
  return { from: "zh-Hans", to: "en" };
}

export default function QuickTranslate({ line, onLineChange, onOpenWeb }: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();

  const [from, setFrom] = useState(() => readDirection().from);
  const [to, setTo] = useState(() => readDirection().to);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<TranslateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Map<string, TranslateResult>>(new Map());

  useEffect(() => {
    try {
      localStorage.setItem(DIR_KEY, JSON.stringify({ from, to }));
    } catch {
      /* 忽略存储失败 */
    }
  }, [from, to]);

  const langLabels: Record<string, string> = useMemo(
    () => ({
      auto: t("translate.auto"),
      "zh-Hans": t("translate.langZh"),
      "zh-Hant": t("translate.langZhHant"),
      en: t("translate.langEn"),
      ja: t("translate.langJa"),
      ko: t("translate.langKo"),
      fr: t("translate.langFr"),
      de: t("translate.langDe"),
      es: t("translate.langEs"),
      ru: t("translate.langRu"),
    }),
    [t],
  );

  const fromOptions = LANGUAGE_VALUES.map((value) => ({
    value,
    label: langLabels[value],
  }));
  const toOptions = LANGUAGE_VALUES.filter((value) => value !== "auto").map((value) => ({
    value,
    label: langLabels[value],
  }));

  const changeFrom = (value: string) => {
    setFrom(value);
    setResult(null);
    setError(null);
  };

  const changeTo = (value: string) => {
    setTo(value);
    setResult(null);
    setError(null);
  };

  const swap = () => {
    if (from === "auto") {
      const detected = result?.detected;
      setFrom(to);
      setTo(detected && detected !== "auto" ? detected : to === "zh-Hans" ? "en" : "zh-Hans");
    } else {
      setFrom(to);
      setTo(from);
    }
    setResult(null);
    setError(null);
  };

  const doTranslate = async () => {
    const text = input.trim();
    if (!text || loading) return;

    if (from !== "auto" && from === to) {
      setError(null);
      setResult({ text, detected: from, target: to, line });
      return;
    }

    const cacheKey = `${line}|${from}|${to}|${text}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setError(null);
      setResult(cached);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await translateText(text, from, to, line);
      if (cacheRef.current.size >= 200) {
        const oldest = cacheRef.current.keys().next().value;
        if (oldest) cacheRef.current.delete(oldest);
      }
      cacheRef.current.set(cacheKey, data);
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  const copyValue = (value: string) => {
    if (!value.trim()) return;
    void copyText(value).then(
      () => message.success(t("translate.resultCopied")),
      () => message.error(t("common.copyFailed")),
    );
  };

  const clear = () => {
    setInput("");
    setResult(null);
    setError(null);
  };

  /** 中译英时用译文生成命名；英译中时用原标识符规整 */
  const englishText = useMemo(() => {
    if (to === "en" && result?.text && looksLikeEnglish(result.text)) {
      return result.text;
    }
    const trimmed = input.trim();
    return looksLikeEnglish(trimmed) ? trimmed : "";
  }, [to, result, input]);

  const variants: NameVariants | null = englishText ? nameVariants(englishText) : null;
  const tokens = englishText ? splitIdentifier(englishText) : [];

  const variantRows = useMemo(
    () =>
      variants
        ? [
            { key: "camel", label: t("translate.camel"), value: variants.camel },
            { key: "pascal", label: t("translate.pascal"), value: variants.pascal },
            { key: "snake", label: t("translate.snake"), value: variants.snake },
            { key: "kebab", label: t("translate.kebab"), value: variants.kebab },
            { key: "constant", label: t("translate.constant"), value: variants.constant },
          ]
        : [],
    [variants, t],
  );

  return (
    <div className="tr-quick-body">
      <section className="tr-quick-panel">
        <div className="tr-panel-head">
          <span className="tr-panel-title">
            <ThunderboltOutlined /> {t("translate.tabQuick")}
          </span>
          <span style={{ flex: 1 }} />
          <Tooltip title={t("translate.clear")}>
            <Button size="small" type="text" icon={<ClearOutlined />} onClick={clear} />
          </Tooltip>
        </div>

        <div className="tr-quick-scroll">
          <div className="tr-lang-row">
            <Select
              value={from}
              onChange={changeFrom}
              options={fromOptions}
              className="tr-lang-select"
              aria-label={t("translate.from")}
            />
            <Tooltip title={t("translate.swap")}>
              <Button className="tr-swap" icon={<SwapOutlined />} onClick={swap} />
            </Tooltip>
            <Select
              value={to}
              onChange={changeTo}
              options={toOptions}
              className="tr-lang-select"
              aria-label={t("translate.to")}
            />
          </div>

          <div className="tr-line-row">
            <span className="tr-hint">{t("translate.line")}</span>
            <Segmented
              size="small"
              value={line}
              onChange={(value) => onLineChange(value as TranslateLine)}
              options={[
                { value: "cn", label: t("translate.cn") },
                { value: "intl", label: t("translate.intl") },
              ]}
            />
            <span style={{ flex: 1 }} />
            <span className="tr-hint tr-count">
              {input.length} / {MAX_CHARS}
            </span>
          </div>

          <Input.TextArea
            className="tr-input"
            value={input}
            maxLength={MAX_CHARS}
            onChange={(event) => {
              setInput(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void doTranslate();
              }
            }}
            placeholder={t("translate.placeholder")}
            autoSize={{ minRows: 4, maxRows: 8 }}
            allowClear
          />

          <Button
            type="primary"
            block
            icon={loading ? <LoadingOutlined /> : <TranslationOutlined />}
            loading={loading}
            disabled={!input.trim()}
            onClick={() => void doTranslate()}
          >
            {loading ? t("translate.translating") : t("translate.translate")}
          </Button>

          <div className="tr-hint">{t("translate.quickHint")}</div>
        </div>
      </section>

      <section className="tr-quick-result">
        <div className="tr-panel-head">
          <span className="tr-panel-title">
            <TranslationOutlined /> {t("translate.result")}
          </span>
          {result && (
            <span className="tr-line-badge">
              {t("translate.via", {
                line: result.line === "cn" ? t("translate.lineCn") : t("translate.lineIntl"),
              })}
            </span>
          )}
          <span style={{ flex: 1 }} />
          {result && (
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => copyValue(result.text)}
            >
              {t("common.copy")}
            </Button>
          )}
        </div>

        <div className="tr-quick-scroll tr-result-scroll">
          {loading && (
            <div className="tr-empty-state">
              <LoadingOutlined spin className="tr-empty-icon" />
              <div>{t("translate.translating")}</div>
            </div>
          )}

          {!loading && error && (
            <div className="tr-error-box">
              <div className="tr-error-title">
                <WarningOutlined /> {t("translate.failedTitle")}
              </div>
              <div className="tr-error-text">{error}</div>
              <div className="tr-error-actions">
                <Button size="small" onClick={() => void doTranslate()}>
                  {t("translate.retry")}
                </Button>
                <Button size="small" type="link" onClick={onOpenWeb}>
                  {t("translate.useWeb")}
                </Button>
              </div>
            </div>
          )}

          {!loading && !error && !result && (
            <div className="tr-empty-state">
              <span className="tr-empty-icon">
                <TranslationOutlined />
              </span>
              <div>{t("translate.resultEmpty")}</div>
            </div>
          )}

          {!loading && !error && result && (
            <>
              <div className="tr-result-text">{result.text}</div>
              <div className="tr-result-meta">
                {result.detected && (
                  <span>{t("translate.detected", { lang: langLabels[result.detected] ?? result.detected })}</span>
                )}
                <span>
                  {t("translate.targetLabel")}: {langLabels[result.target] ?? result.target}
                </span>
              </div>

              {variants && (
                <div className="tr-names">
                  <div className="tr-section-title">
                    {t("translate.variants")}
                    <span className="tr-hint">{t("translate.variantsHint")}</span>
                  </div>
                  <div className="tr-name-list">
                    {variantRows.map((row) => (
                      <button
                        type="button"
                        className="tr-name-row"
                        key={row.key}
                        title={row.value}
                        onClick={() => copyValue(row.value)}
                      >
                        <span className="tr-name-label">{row.label}</span>
                        <code className="tr-name-code">{row.value}</code>
                        <CopyOutlined className="tr-name-copy" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {tokens.length > 0 && (
                <div className="tr-names">
                  <div className="tr-section-title">{t("translate.tokens")}</div>
                  <div className="tr-token-row">
                    {tokens.map((token, index) => (
                      <span className="tr-token" key={`${token}-${index}`}>
                        {token}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
