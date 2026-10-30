import type { JsonValue } from "../text/JsonTree";

/**
 * Redis 里常见的「JSON 化」字符串解析：
 * - 标准 JSON
 * - Fastjson 这类带数字后缀的输出，例如 148L / 1.5D / 2F
 *
 * 只会清理字符串字面量之外的数字后缀，避免把 "148L" 这种文本改掉。
 */
export function stripJavaNumberSuffixes(input: string): string {
  let output = "";
  let index = 0;
  let inString = false;

  while (index < input.length) {
    const ch = input[index];

    if (inString) {
      output += ch;
      if (ch === "\\" && index + 1 < input.length) {
        output += input[index + 1];
        index += 2;
        continue;
      }
      if (ch === '"') inString = false;
      index += 1;
      continue;
    }

    if (ch === '"') {
      inString = true;
      output += ch;
      index += 1;
      continue;
    }

    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const start = index;
      if (ch === "-") index += 1;
      while (index < input.length && input[index] >= "0" && input[index] <= "9") index += 1;
      if (input[index] === ".") {
        index += 1;
        while (index < input.length && input[index] >= "0" && input[index] <= "9") index += 1;
      }
      if (input[index] === "e" || input[index] === "E") {
        index += 1;
        if (input[index] === "+" || input[index] === "-") index += 1;
        while (index < input.length && input[index] >= "0" && input[index] <= "9") index += 1;
      }
      output += input.slice(start, index);
      const suffix = input[index];
      if (suffix && "LlDdFf".includes(suffix)) index += 1;
      continue;
    }

    output += ch;
    index += 1;
  }

  return output;
}

/** 解析成功返回 JSON 值；不是（或修不出来的）JSON 返回 null */
export function parseJsonLike(raw: string): JsonValue | null {
  const text = raw.trim();
  if (!text) return null;

  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    /* 继续尝试清理 Java 数字后缀 */
  }

  const cleaned = stripJavaNumberSuffixes(text);
  if (cleaned === text) return null;
  try {
    return JSON.parse(cleaned) as JsonValue;
  } catch {
    return null;
  }
}

/** 只把对象 / 数组当作需要树形展示的结构 */
export function isStructured(value: JsonValue | null): value is JsonValue {
  return value !== null && typeof value === "object";
}
