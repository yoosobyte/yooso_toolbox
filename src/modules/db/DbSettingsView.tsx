import { useEffect, useState } from "react";
import { App as AntdApp, Button, Input, InputNumber, Select, Spin, Tooltip } from "antd";
import { ReloadOutlined, SaveOutlined, SettingOutlined } from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import { errText } from "../../utils";
import { dbExecDdl, dbTableOptions, type DbTableOptions } from "./api";
import { escapeSqlString, qualified } from "./ddl";

interface Props {
  connectionId: string;
  database: string;
  table: string;
  onRenamed: (table: string) => void;
}

const ENGINE_OPTIONS = [
  "InnoDB",
  "MyISAM",
  "MEMORY",
  "CSV",
  "ARCHIVE",
  "BLACKHOLE",
  "MRG_MyISAM",
];

export default function DbSettingsView({
  connectionId,
  database,
  table,
  onRenamed,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));
  const { message } = AntdApp.useApp();
  const [options, setOptions] = useState<DbTableOptions | null>(null);
  const [name, setName] = useState(table);
  const [comment, setComment] = useState("");
  const [engine, setEngine] = useState("InnoDB");
  const [autoIncrement, setAutoIncrement] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await dbTableOptions(connectionId, database, table);
      setOptions(next);
      setName(next.name || table);
      setComment(next.comment);
      setEngine(next.engine || "InnoDB");
      setAutoIncrement(next.autoIncrement);
    } catch (reason) {
      setError(errText(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, database, table]);

  const save = async () => {
    if (!options || saving) return;
    const nextName = name.trim();
    if (!nextName) {
      message.warning(t("db.tableNameRequired"));
      return;
    }
    const target = qualified(database, table);
    const statements: string[] = [];
    if (comment !== options.comment) {
      statements.push(
        `ALTER TABLE ${target} COMMENT = '${escapeSqlString(comment)}'`,
      );
    }
    if (engine !== options.engine) {
      if (!/^[A-Za-z0-9_]+$/.test(engine)) {
        message.error(t("db.engineInvalid"));
        return;
      }
      statements.push(`ALTER TABLE ${target} ENGINE = ${engine}`);
    }
    if (autoIncrement !== null && autoIncrement !== options.autoIncrement) {
      statements.push(`ALTER TABLE ${target} AUTO_INCREMENT = ${Math.max(1, autoIncrement)}`);
    }
    const renamed = nextName !== options.name && nextName !== table;
    if (renamed) {
      statements.push(
        `RENAME TABLE ${target} TO ${qualified(database, nextName)}`,
      );
    }
    if (statements.length === 0) return;

    setSaving(true);
    try {
      for (const statement of statements) {
        await dbExecDdl(connectionId, statement);
      }
      message.success(t("db.settingsSaved"));
      if (renamed) onRenamed(nextName);
      else await load();
    } catch (reason) {
      message.error(errText(reason));
    } finally {
      setSaving(false);
    }
  };

  const engines = Array.from(new Set([...ENGINE_OPTIONS, engine].filter(Boolean))).map(
    (value) => ({ value, label: value }),
  );

  return (
    <div className="db-settings-view">
      <div className="db-view-toolbar">
        <Button size="small" type="text" icon={<SettingOutlined />}>
          {t("db.settings")}
        </Button>
        <span style={{ flex: 1 }} />
        <Tooltip title={t("db.refreshData")}>
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void load()}
          />
        </Tooltip>
        <Button
          size="small"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={!options}
          onClick={() => void save()}
        >
          {t("db.saveSettings")}
        </Button>
      </div>

      {error && <div className="db-error">{error}</div>}
      {loading && !options ? (
        <div className="db-grid-loading">
          <Spin size="small" />
        </div>
      ) : (
        <div className="db-settings-form">
          <label className="db-field">
            <span className="db-label">{t("db.tableName")}</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={saving}
            />
          </label>
          <label className="db-field">
            <span className="db-label">{t("db.tableComment")}</span>
            <Input
              value={comment}
              placeholder={t("db.tableCommentPlaceholder")}
              onChange={(event) => setComment(event.target.value)}
              disabled={saving}
            />
          </label>
          <label className="db-field">
            <span className="db-label">{t("db.engine")}</span>
            <Select
              value={engine}
              options={engines}
              onChange={setEngine}
              disabled={saving}
            />
          </label>
          <label className="db-field">
            <span className="db-label">{t("db.autoIncrementValue")}</span>
            <InputNumber
              min={1}
              value={autoIncrement}
              onChange={(value) => setAutoIncrement(value)}
              disabled={saving}
              style={{ width: "100%" }}
            />
            <span className="db-hint">{t("db.autoIncrementHint")}</span>
          </label>
        </div>
      )}
    </div>
  );
}
