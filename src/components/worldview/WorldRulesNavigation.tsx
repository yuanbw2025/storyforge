import { useState } from 'react'
import { Check, Plus, Trash2, X } from 'lucide-react'
import { isEntryEmpty } from '../../lib/types/world-rules'
import type { WorldRuleEntry } from '../../lib/types/world-rules'

export interface WorldRuleNavigationNode {
  id: string
  label: string
  icon: string
  hints?: string[]
  isCustom: boolean
}

interface Props {
  l1Nodes: WorldRuleNavigationNode[]
  l2Nodes: WorldRuleNavigationNode[]
  entries: Record<string, WorldRuleEntry>
  selectedL1: string
  selectedNode: string | null
  countL1Filled: (l1Id: string) => number
  onSelectL1: (l1Id: string) => void
  onSelectNode: (nodeId: string) => void
  onAddL1: (label: string) => Promise<void>
  onAddL2: (label: string) => Promise<void>
  onDeleteCustomNode: (nodeId: string, label: string) => void
}

export default function WorldRulesNavigation({
  l1Nodes,
  l2Nodes,
  entries,
  selectedL1,
  selectedNode,
  countL1Filled,
  onSelectL1,
  onSelectNode,
  onAddL1,
  onAddL2,
  onDeleteCustomNode,
}: Props) {
  const [addingL1, setAddingL1] = useState(false)
  const [addingL2, setAddingL2] = useState(false)
  const [newNodeLabel, setNewNodeLabel] = useState('')

  const submit = async (level: 'l1' | 'l2') => {
    const label = newNodeLabel.trim()
    if (!label) return
    if (level === 'l1') await onAddL1(label)
    else await onAddL2(label)
    setNewNodeLabel('')
    if (level === 'l1') setAddingL1(false)
    else setAddingL2(false)
  }

  const cancel = (level: 'l1' | 'l2') => {
    setNewNodeLabel('')
    if (level === 'l1') setAddingL1(false)
    else setAddingL2(false)
  }

  const addRow = (level: 'l1' | 'l2', placeholder: string) => (
    <div className="px-2 py-1.5 flex gap-1">
      <input
        autoFocus
        value={newNodeLabel}
        onChange={event => setNewNodeLabel(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') void submit(level)
          if (event.key === 'Escape') cancel(level)
        }}
        placeholder={placeholder}
        className="flex-1 text-xs px-2 py-1 rounded border border-border bg-bg-base text-text-primary"
      />
      <button
        onClick={() => { void submit(level) }}
        className="text-green-500 hover:text-green-400"
        aria-label={`确认添加${level === 'l1' ? '大类' : '子类'}`}
      >
        <Check className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => cancel(level)}
        className="text-text-muted hover:text-text-primary"
        aria-label={`取消添加${level === 'l1' ? '大类' : '子类'}`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )

  return (
    <>
      <div className="w-48 shrink-0 bg-bg-elevated border-r border-border overflow-y-auto">
        <div className="p-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider px-3 pt-3">
          大类
        </div>
        {l1Nodes.map(node => {
          const count = countL1Filled(node.id)
          const active = node.id === selectedL1
          return (
            <button
              key={node.id}
              onClick={() => onSelectL1(node.id)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                active
                  ? 'bg-accent/10 text-accent font-medium border-r-2 border-accent'
                  : 'text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <span className="text-base">{node.icon}</span>
              <span className="flex-1 truncate">{node.label}</span>
              {count > 0 && (
                <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full">{count}</span>
              )}
            </button>
          )
        })}
        {addingL1 ? addRow('l1', '新大类名称') : (
          <button
            onClick={() => { setAddingL1(true); setNewNodeLabel('') }}
            className="w-full text-left px-3 py-2 text-xs text-text-muted hover:text-accent flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> 添加大类
          </button>
        )}
      </div>

      <div className="w-52 shrink-0 border-r border-border overflow-y-auto">
        <div className="p-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider px-3 pt-3">子类</div>
        <button
          onClick={() => onSelectNode(selectedL1)}
          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
            selectedNode === selectedL1
              ? 'bg-accent/10 text-accent font-medium'
              : 'text-text-secondary hover:bg-bg-hover'
          }`}
        >
          <span className="text-base">📋</span>
          <span className="flex-1 truncate">总览</span>
          {!isEntryEmpty(entries[selectedL1]) && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
        </button>
        {l2Nodes.map(node => (
          <div
            key={node.id}
            className={`w-full px-3 py-2 text-sm flex items-center gap-2 transition-colors group ${
              selectedNode === node.id
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-text-secondary hover:bg-bg-hover'
            }`}
          >
            <button onClick={() => onSelectNode(node.id)} className="min-w-0 flex-1 flex items-center gap-2 text-left">
              <span className="text-base">{node.icon}</span>
              <span className="flex-1 truncate">{node.label}</span>
              {!isEntryEmpty(entries[node.id]) && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
            </button>
            {node.isCustom && (
              <button
                onClick={() => onDeleteCustomNode(node.id, node.label)}
                className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity"
                aria-label={`删除子类${node.label}`}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        {addingL2 ? addRow('l2', '新子类名称') : (
          <button
            onClick={() => { setAddingL2(true); setNewNodeLabel('') }}
            className="w-full text-left px-3 py-2 text-xs text-text-muted hover:text-accent flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> 添加子类
          </button>
        )}
      </div>
    </>
  )
}
