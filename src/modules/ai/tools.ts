import { invoke } from "@tauri-apps/api/core";

export interface FileChange {
  path: string;
  before: string | null;
  after: string;
}

export interface ToolResult {
  text: string;
  change?: FileChange;
}

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "列出工作目录内某个目录下的文件和子目录",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "相对工作目录的路径，根目录用 .",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取工作目录内某个文本文件的内容",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作目录的文件路径" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "把内容写入工作目录内的文件（覆盖已有内容）。用于创建或修改代码文件。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对工作目录的文件路径" },
          content: { type: "string", description: "完整的文件内容" },
        },
        required: ["path", "content"],
      },
    },
  },
];

export async function runTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case "list_dir": {
      const result = await invoke<{
        path: string;
        entries: { name: string; isDir: boolean }[];
      }>("ai_list_dir", { root, path: String(args.path ?? ".") });
      const lines = result.entries.map(
        (entry) => `${entry.isDir ? "[dir] " : "[file]"} ${entry.name}`,
      );
      return { text: `目录 ${result.path}：\n${lines.join("\n") || "(空目录)"}` };
    }
    case "read_file": {
      const text = await invoke<string>("ai_read_file", {
        root,
        path: String(args.path ?? ""),
      });
      return { text };
    }
    case "write_file": {
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      let before: string | null = null;
      try {
        before = await invoke<string>("ai_read_file", { root, path });
      } catch {
        before = null;
      }
      await invoke("ai_write_file", { root, path, content });
      return {
        text: `已写入 ${path}`,
        change: { path, before, after: content },
      };
    }
    default:
      return { text: `未知工具：${name}` };
  }
}

/** 撤销一次文件改动：新建的文件删除，已存在的恢复原内容 */
export async function undoChange(root: string, change: FileChange): Promise<void> {
  if (change.before === null) {
    await invoke("ai_delete_file", { root, path: change.path });
    return;
  }
  await invoke("ai_write_file", {
    root,
    path: change.path,
    content: change.before,
  });
}

/** 粗略统计改动行数（用于展示 +x/-y） */
export function diffStat(before: string | null, after: string): { add: number; del: number } {
  const beforeLines = before === null ? [] : before.split("\n");
  const afterLines = after.split("\n");
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  const add = afterLines.filter((line) => !beforeSet.has(line)).length;
  const del = beforeLines.filter((line) => !afterSet.has(line)).length;
  return { add, del };
}
