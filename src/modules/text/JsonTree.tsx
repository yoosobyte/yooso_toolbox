/**
 * JSON 树：只渲染展开的节点，折叠状态由父组件用 Set<path> 管理，
 * 「展开全部 / 折叠全部」就是清空 / 填满这个集合。
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ContainerPath {
  path: string;
  depth: number;
}

const ROOT = "$";

export function collectContainerPaths(value: JsonValue): ContainerPath[] {
  const out: ContainerPath[] = [];
  const walk = (node: JsonValue, path: string, depth: number) => {
    if (node === null || typeof node !== "object") return;
    out.push({ path, depth });
    const children = Array.isArray(node) ? node : Object.values(node);
    children.forEach((child, index) => walk(child, `${path}/${index}`, depth + 1));
  };
  walk(value, ROOT, 0);
  return out;
}

/** 默认展开前两层，更深的先折叠，避免大 JSON 一上来就铺满 DOM */
export function defaultCollapsed(value: JsonValue): Set<string> {
  return new Set(
    collectContainerPaths(value)
      .filter((item) => item.depth >= 2)
      .map((item) => item.path),
  );
}

function primitiveClass(value: JsonValue): string {
  if (value === null) return "json-null";
  if (typeof value === "string") return "json-string";
  if (typeof value === "number") return "json-number";
  if (typeof value === "boolean") return "json-boolean";
  return "json-null";
}

function primitiveText(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

interface NodeProps {
  name: string | null;
  value: JsonValue;
  path: string;
  depth: number;
  last: boolean;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  itemsLabel: string;
  keysLabel: string;
}

function JsonNode({
  name,
  value,
  path,
  depth,
  last,
  collapsed,
  onToggle,
  itemsLabel,
  keysLabel,
}: NodeProps) {
  const isContainer = value !== null && typeof value === "object";
  const open = isContainer && !collapsed.has(path);
  const entries: [string, JsonValue][] = isContainer
    ? Array.isArray(value)
      ? value.map((child, index) => [String(index), child])
      : Object.entries(value as { [key: string]: JsonValue })
    : [];

  return (
    <div className="json-node">
      <div
        className={`json-line${isContainer ? " json-toggle" : ""}`}
        style={{ paddingLeft: depth * 16 }}
        onClick={isContainer ? () => onToggle(path) : undefined}
      >
        <span className="json-caret">{isContainer ? (open ? "▾" : "▸") : ""}</span>
        {name !== null && (
          <>
            <span className="json-key">{JSON.stringify(name)}</span>
            <span className="json-colon">: </span>
          </>
        )}
        {isContainer ? (
          <>
            <span className="json-bracket">{Array.isArray(value) ? "[" : "{"}</span>
            {!open && (
              <>
                <span className="json-summary">
                  {Array.isArray(value)
                    ? `… ${value.length} ${itemsLabel}`
                    : `… ${entries.length} ${keysLabel}`}
                </span>
                <span className="json-bracket">{Array.isArray(value) ? "]" : "}"}</span>
                {!last && <span className="json-comma">,</span>}
              </>
            )}
          </>
        ) : (
          <span className={`json-value ${primitiveClass(value)}`}>{primitiveText(value)}</span>
        )}
        {!isContainer && !last && <span className="json-comma">,</span>}
      </div>

      {open && (
        <>
          <div className="json-children">
            {entries.map(([childName, child], index) => (
              <JsonNode
                key={`${path}/${index}`}
                name={childName}
                value={child}
                path={`${path}/${index}`}
                depth={depth + 1}
                last={index === entries.length - 1}
                collapsed={collapsed}
                onToggle={onToggle}
                itemsLabel={itemsLabel}
                keysLabel={keysLabel}
              />
            ))}
          </div>
          <div className="json-line json-close" style={{ paddingLeft: depth * 16 }}>
            <span className="json-caret" />
            <span className="json-bracket">{Array.isArray(value) ? "]" : "}"}</span>
            {!last && <span className="json-comma">,</span>}
          </div>
        </>
      )}
    </div>
  );
}

interface Props {
  value: JsonValue;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  itemsLabel: string;
  keysLabel: string;
}

export default function JsonTree({
  value,
  collapsed,
  onToggle,
  itemsLabel,
  keysLabel,
}: Props) {
  return (
    <div className="json-tree">
      <JsonNode
        name={null}
        value={value}
        path={ROOT}
        depth={0}
        last
        collapsed={collapsed}
        onToggle={onToggle}
        itemsLabel={itemsLabel}
        keysLabel={keysLabel}
      />
    </div>
  );
}
