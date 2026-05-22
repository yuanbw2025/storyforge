/**
 * WorldTreeSidebar — 世界树导航面板
 * 可折叠树形列表，支持展开/折叠、新建/删除
 */

import { useState, useCallback } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Edit3,
  Link,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { useWorldNodeStore, type WorldTreeNode } from '../../stores/world-node'

interface Props {
  projectId: number
}

export default function WorldTreeSidebar({ projectId }: Props) {
  const {
    activeWorldId,
    setActiveWorld,
    createNode,
    updateNode,
    deleteNode,
    getTree,
    nodes,
  } = useWorldNodeStore()

  const tree = getTree()
  const [collapsed, setCollapsed] = useState(false)

  const handleAddChild = useCallback(
    async (parentId: number | null) => {
      const siblingCount = nodes.filter(n => n.parentId === parentId).length
      await createNode({
        projectId,
        parentId,
        name: parentId ? '子位面' : '新世界',
        description: '',
        sortOrder: siblingCount,
        icon: parentId ? '🌀' : '🌍',
      })
    },
    [projectId, nodes, createNode],
  )

  // 折叠态：只显示图标列
  if (collapsed) {
    return (
      <div className="w-10 shrink-0 border-r border-border bg-bg-elevated flex flex-col items-center py-2 gap-1">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
          title="展开世界树"
        >
          <PanelLeftOpen className="w-3.5 h-3.5" />
        </button>
        <div className="w-5 border-t border-border my-1" />
        {tree.map(node => (
          <button
            key={node.id}
            onClick={() => setActiveWorld(node.id!)}
            className={`text-sm p-1 rounded transition-colors ${
              activeWorldId === node.id ? 'bg-accent/15' : 'hover:bg-bg-hover'
            }`}
            title={node.name}
          >
            {node.icon || '🌍'}
          </button>
        ))}
        <button
          onClick={() => handleAddChild(null)}
          className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent mt-1"
          title="新建世界"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    )
  }

  return (
    <div className="w-40 shrink-0 border-r border-border bg-bg-elevated flex flex-col h-full">
      {/* 标题 */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
        <span className="text-[10px] font-medium text-text-secondary">世界树</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => handleAddChild(null)}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-accent transition-colors"
            title="新建根世界"
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            onClick={() => setCollapsed(true)}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
            title="折叠"
          >
            <PanelLeftClose className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 树列表 */}
      <div className="flex-1 overflow-y-auto py-0.5">
        {tree.length === 0 ? (
          <div className="px-2 py-4 text-center text-text-muted text-[10px]">暂无世界</div>
        ) : (
          tree.map(node => (
            <TreeItem
              key={node.id}
              node={node}
              depth={0}
              activeId={activeWorldId}
              onSelect={setActiveWorld}
              onAddChild={handleAddChild}
              onDelete={deleteNode}
              onRename={updateNode}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── 树节点 ──────────────────────────────────────────

interface TreeItemProps {
  node: WorldTreeNode
  depth: number
  activeId: number | null
  onSelect: (id: number) => void
  onAddChild: (parentId: number) => void
  onDelete: (id: number) => void
  onRename: (id: number, patch: { name: string }) => void
}

function TreeItem({
  node, depth, activeId, onSelect, onAddChild, onDelete, onRename,
}: TreeItemProps) {
  const [expanded, setExpanded] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(node.name)

  const isActive = activeId === node.id
  const hasChildren = node.children.length > 0
  const portals = node.portalsJSON ? JSON.parse(node.portalsJSON) : []

  const handleRename = () => {
    if (editName.trim() && editName !== node.name) {
      onRename(node.id!, { name: editName.trim() })
    }
    setEditing(false)
  }

  return (
    <div>
      <div
        className={`group flex items-center gap-0.5 px-1 py-1 cursor-pointer transition-colors ${
          isActive
            ? 'bg-accent/10 text-accent border-r-2 border-accent'
            : 'text-text-secondary hover:bg-bg-hover'
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => onSelect(node.id!)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
            className="p-0.5 rounded hover:bg-bg-base shrink-0"
          >
            {expanded
              ? <ChevronDown className="w-2.5 h-2.5" />
              : <ChevronRight className="w-2.5 h-2.5" />
            }
          </button>
        ) : (
          <span className="w-3.5" />
        )}

        <span className="text-xs shrink-0">{node.icon || '🌍'}</span>

        {editing ? (
          <input
            autoFocus
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={e => {
              if (e.key === 'Enter') handleRename()
              if (e.key === 'Escape') setEditing(false)
            }}
            onClick={e => e.stopPropagation()}
            className="flex-1 min-w-0 bg-bg-base text-text-primary text-[10px] px-1 py-0.5 rounded outline-none border border-accent/30"
          />
        ) : (
          <span className="flex-1 min-w-0 truncate text-[10px]">{node.name}</span>
        )}

        {portals.length > 0 && <Link className="w-2.5 h-2.5 text-accent/50 shrink-0" />}

        <div className="hidden group-hover:flex items-center shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setEditName(node.name); setEditing(true) }}
            className="p-0.5 rounded hover:bg-bg-base text-text-muted hover:text-text-primary"
            title="重命名"
          >
            <Edit3 className="w-2.5 h-2.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAddChild(node.id!) }}
            className="p-0.5 rounded hover:bg-bg-base text-text-muted hover:text-accent"
            title="新建子世界"
          >
            <Plus className="w-2.5 h-2.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (confirm(`确定删除「${node.name}」及其所有子世界吗？`)) onDelete(node.id!)
            }}
            className="p-0.5 rounded hover:bg-bg-base text-text-muted hover:text-red-400"
            title="删除"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {hasChildren && expanded && (
        <div>
          {node.children.map(child => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onDelete={onDelete}
              onRename={onRename}
            />
          ))}
        </div>
      )}
    </div>
  )
}
