/**
 * 行级文本对比：先去掉公共前后缀，再对中间部分做 LCS。
 * 对特别大的文本设置上限，避免一次对比把内存打满。
 */

export type DiffKind = "same" | "add" | "del";

export interface DiffRow {
  kind: DiffKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffResult {
  rows: DiffRow[];
  added: number;
  removed: number;
  /** 文本过长、只按整块替换处理时为 true */
  truncated: boolean;
}

const MAX_CELLS = 2_000_000;

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\r\n?/g, "\n").split("\n");
}

export function diffLines(oldText: string, newText: string): DiffResult {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;

  // 公共前缀
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    rows.push({ kind: "same", text: a[start], oldLine: start + 1, newLine: start + 1 });
    start += 1;
  }

  // 公共后缀
  let endA = a.length - 1;
  let endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA -= 1;
    endB -= 1;
  }

  const midA = a.slice(start, endA + 1);
  const midB = b.slice(start, endB + 1);
  let truncated = false;

  if (midA.length * midB.length > MAX_CELLS) {
    truncated = true;
    for (let i = 0; i < midA.length; i += 1) {
      rows.push({
        kind: "del",
        text: midA[i],
        oldLine: start + i + 1,
        newLine: null,
      });
      removed += 1;
    }
    for (let j = 0; j < midB.length; j += 1) {
      rows.push({
        kind: "add",
        text: midB[j],
        oldLine: null,
        newLine: start + j + 1,
      });
      added += 1;
    }
  } else {
    const width = midB.length + 1;
    const dp = new Uint32Array((midA.length + 1) * width);
    for (let i = midA.length - 1; i >= 0; i -= 1) {
      for (let j = midB.length - 1; j >= 0; j -= 1) {
        dp[i * width + j] =
          midA[i] === midB[j]
            ? dp[(i + 1) * width + j + 1] + 1
            : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
      }
    }

    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) {
        rows.push({
          kind: "same",
          text: midA[i],
          oldLine: start + i + 1,
          newLine: start + j + 1,
        });
        i += 1;
        j += 1;
      } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
        rows.push({ kind: "del", text: midA[i], oldLine: start + i + 1, newLine: null });
        removed += 1;
        i += 1;
      } else {
        rows.push({ kind: "add", text: midB[j], oldLine: null, newLine: start + j + 1 });
        added += 1;
        j += 1;
      }
    }
    while (i < midA.length) {
      rows.push({ kind: "del", text: midA[i], oldLine: start + i + 1, newLine: null });
      removed += 1;
      i += 1;
    }
    while (j < midB.length) {
      rows.push({ kind: "add", text: midB[j], oldLine: null, newLine: start + j + 1 });
      added += 1;
      j += 1;
    }
  }

  // 把公共后缀补回去
  let suffixOld = endA + 1;
  let suffixNew = endB + 1;
  while (suffixOld < a.length) {
    rows.push({
      kind: "same",
      text: a[suffixOld],
      oldLine: suffixOld + 1,
      newLine: suffixNew + 1,
    });
    suffixOld += 1;
    suffixNew += 1;
  }

  return { rows, added, removed, truncated };
}

/** 生成可复制的统一 diff 文本 */
export function diffToText(result: DiffResult): string {
  return result.rows
    .map((row) => {
      const prefix = row.kind === "add" ? "+" : row.kind === "del" ? "-" : " ";
      return `${prefix}${row.text}`;
    })
    .join("\n");
}
