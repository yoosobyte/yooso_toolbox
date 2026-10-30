import type { RedisKeyInfo } from "./api";

export interface KeyTreeNode {
  /** 展示名（最后一段；文件夹为中间段） */
  name: string;
  /** 唯一 id：文件夹用 f:path，叶子用 k:完整 key */
  id: string;
  /** 展开状态用的路径 */
  path: string;
  depth: number;
  /** 该节点下包含多少个叶子键 */
  count: number;
  children: KeyTreeNode[];
  key?: RedisKeyInfo;
}

/** 把 user:1:name 这种键按冒号拆成文件夹树 */
export function buildKeyTree(keys: RedisKeyInfo[]): KeyTreeNode[] {
  const root: KeyTreeNode = {
    name: "",
    id: "root",
    path: "",
    depth: 0,
    count: 0,
    children: [],
  };
  const folders = new Map<string, KeyTreeNode>();

  for (const info of keys) {
    const parts = info.key.split(":");
    let parent = root;
    let path = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      const rawName = parts[index];
      const name = rawName === "" ? "(空)" : rawName;
      path = path ? `${path}:${rawName}` : rawName;
      let node = folders.get(path);
      if (!node) {
        node = {
          name,
          id: `f:${path}`,
          path,
          depth: index,
          count: 0,
          children: [],
        };
        folders.set(path, node);
        parent.children.push(node);
      }
      parent = node;
    }

    const leafName = parts[parts.length - 1] || "(空)";
    parent.children.push({
      name: leafName,
      id: `k:${info.key}`,
      path: info.key,
      depth: parts.length - 1,
      count: 1,
      children: [],
      key: info,
    });
  }

  const countLeaves = (node: KeyTreeNode): number => {
    if (node.key) return 1;
    node.count = node.children.reduce((total, child) => total + countLeaves(child), 0);
    return node.count;
  };

  const sort = (nodes: KeyTreeNode[]) => {
    nodes.sort((a, b) => {
      const aFolder = !a.key;
      const bFolder = !b.key;
      if (aFolder !== bFolder) return aFolder ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    for (const node of nodes) if (node.children.length > 0) sort(node.children);
  };

  for (const child of root.children) countLeaves(child);
  sort(root.children);
  return root.children;
}
