import { Fragment } from "react";
import {
  DownOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  KeyOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { useUiStore } from "../../stores/uiStore";
import { useT } from "../../i18n";
import type { KeyTreeNode } from "./keyTree";
import { formatTtlLabel } from "./browserTypes";
import { formatTtlShort } from "./ttl";

interface Props {
  nodes: KeyTreeNode[];
  depth: number;
  collapsedFolders: Set<string>;
  selectedKey: string | null;
  onToggleFolder: (id: string) => void;
  onSelectKey: (key: string) => void;
}

/** 按冒号分层的键树；递归渲染文件夹与叶子键 */
export default function KeyTreeView({
  nodes,
  depth,
  collapsedFolders,
  selectedKey,
  onToggleFolder,
  onSelectKey,
}: Props) {
  const t = useT(useUiStore((state) => state.lang));

  return (
    <>
      {nodes.map((node) => {
        const info = node.key;
        if (!info) {
          const collapsed = collapsedFolders.has(node.id);
          return (
            <Fragment key={node.id}>
              <div
                className="redis-tree-folder"
                style={{ paddingLeft: 8 + depth * 12 }}
                onClick={() => onToggleFolder(node.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onToggleFolder(node.id);
                  }
                }}
              >
                <span className="redis-tree-caret">
                  {collapsed ? <RightOutlined /> : <DownOutlined />}
                </span>
                {collapsed ? <FolderOutlined /> : <FolderOpenOutlined />}
                <span className="redis-tree-folder-name" title={node.path}>
                  {node.name}
                </span>
                <span className="redis-tree-count">{node.count}</span>
              </div>
              {!collapsed && (
                <KeyTreeView
                  nodes={node.children}
                  depth={depth + 1}
                  collapsedFolders={collapsedFolders}
                  selectedKey={selectedKey}
                  onToggleFolder={onToggleFolder}
                  onSelectKey={onSelectKey}
                />
              )}
            </Fragment>
          );
        }

        return (
          <div
            key={node.id}
            className={`redis-key-row redis-tree-leaf${
              info.key === selectedKey ? " active" : ""
            }`}
            style={{ paddingLeft: 11 + depth * 12 }}
            onClick={() => onSelectKey(info.key)}
          >
            <span className="redis-tree-key-icon">
              <KeyOutlined />
            </span>
            <span className="redis-key-name" title={info.key}>
              {node.name}
            </span>
            <span className={`redis-type-badge redis-type-${info.kind}`}>{info.kind}</span>
            <span className="redis-key-ttl" title={formatTtlLabel(info.ttl, t)}>
              {formatTtlShort(info.ttl)}
            </span>
          </div>
        );
      })}
    </>
  );
}
