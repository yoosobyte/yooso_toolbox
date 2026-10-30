import { invoke } from "@tauri-apps/api/core";

export interface RedisConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  savePassword: boolean;
  db: number;
  color?: string | null;
  lastUsedAt?: number | null;
  createdAt?: number | null;
}

export interface RedisConnectInfo {
  server: string;
  version: string;
  db: number;
}

export interface RedisKeyInfo {
  key: string;
  kind: string;
  ttl: number;
}

export interface RedisScanResult {
  cursor: string;
  keys: RedisKeyInfo[];
}

export interface RedisField {
  field: string;
  value: string;
}

export interface RedisZItem {
  member: string;
  score: number;
}

export interface RedisStreamEntry {
  id: string;
  fields: RedisField[];
}

export type RedisValue =
  | { kind: "none" }
  | { kind: "string"; value: string; truncated: boolean }
  | { kind: "hash"; entries: RedisField[]; truncated: boolean }
  | { kind: "list"; items: string[]; truncated: boolean }
  | { kind: "set"; items: string[]; truncated: boolean }
  | { kind: "zset"; items: RedisZItem[]; truncated: boolean }
  | { kind: "stream"; entries: RedisStreamEntry[]; truncated: boolean }
  | { kind: "other"; valueType: string };

export interface RedisKeyDetail {
  key: string;
  kind: string;
  ttl: number;
  size?: number | null;
  value: RedisValue;
}

export interface RedisCommandReply {
  output: string;
}

export const redisConfigList = () => invoke<RedisConfig[]>("redis_config_list");

export const redisConfigUpsert = (config: RedisConfig) =>
  invoke<RedisConfig[]>("redis_config_upsert", { config });

export const redisConfigDelete = (id: string) =>
  invoke<RedisConfig[]>("redis_config_delete", { id });

export const redisTest = (config: RedisConfig) =>
  invoke<RedisConnectInfo>("redis_test", { config });

export const redisConnect = (config: RedisConfig) =>
  invoke<RedisConnectInfo>("redis_connect", { config });

export const redisDisconnect = (id: string) =>
  invoke<void>("redis_disconnect", { id });

export const redisSelect = (id: string, db: number) =>
  invoke<void>("redis_select", { id, db });

export const redisScan = (id: string, cursor: string, pattern: string, count: number) =>
  invoke<RedisScanResult>("redis_scan", { id, cursor, pattern, count });

export const redisKeyDetail = (id: string, key: string) =>
  invoke<RedisKeyDetail>("redis_key_detail", { id, key });

export const redisSetString = (
  id: string,
  key: string,
  value: string,
  ttlSeconds: number | null,
  keepTtl: boolean,
  nx: boolean,
) => invoke<void>("redis_set_string", { id, key, value, ttlSeconds, keepTtl, nx });

export const redisDelete = (id: string, keys: string[]) =>
  invoke<number>("redis_delete", { id, keys });

export const redisExpire = (id: string, key: string, ttlSeconds: number) =>
  invoke<void>("redis_expire", { id, key, ttlSeconds });

export const redisRename = (id: string, key: string, newKey: string) =>
  invoke<void>("redis_rename", { id, key, newKey });

export const redisCommand = (id: string, command: string) =>
  invoke<RedisCommandReply>("redis_command", { id, command });
