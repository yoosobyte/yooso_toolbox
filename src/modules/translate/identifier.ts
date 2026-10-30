/**
 * 变量名工具：拆分标识符 → 生成常见命名风格。
 * 只处理 ASCII 标识符，中文输入交回翻译接口。
 */

export interface NameVariants {
  camel: string;
  pascal: string;
  snake: string;
  kebab: string;
  constant: string;
}

/** 按 camelCase / PascalCase / snake_case / kebab-case 拆词 */
export function splitIdentifier(input: string): string[] {
  const cleaned = input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-.\s]+/g, " ")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned.split(" ").filter(Boolean);
}

function lower(token: string): string {
  return token.toLowerCase();
}

function upperFirst(token: string): string {
  const value = token.toLowerCase();
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function toCamel(tokens: string[]): string {
  return tokens
    .map((token, index) => (index === 0 ? lower(token) : upperFirst(token)))
    .join("");
}

export function toPascal(tokens: string[]): string {
  return tokens.map(upperFirst).join("");
}

export function toSnake(tokens: string[]): string {
  return tokens.map(lower).join("_");
}

export function toKebab(tokens: string[]): string {
  return tokens.map(lower).join("-");
}

export function toConstant(tokens: string[]): string {
  return tokens.map((token) => token.toUpperCase()).join("_");
}

/** 输入看起来像英文/标识符时才生成命名建议 */
export function looksLikeEnglish(text: string): boolean {
  const value = text.trim();
  return value.length > 0 && /[A-Za-z]/.test(value) && /^[A-Za-z0-9 _\-.+/]+$/.test(value);
}

export function nameVariants(text: string): NameVariants {
  const tokens = splitIdentifier(text);
  return {
    camel: toCamel(tokens),
    pascal: toPascal(tokens),
    snake: toSnake(tokens),
    kebab: toKebab(tokens),
    constant: toConstant(tokens),
  };
}
