import { Trash2 } from 'lucide-react'
import {
  CONFLICT_PRIORITY_LABELS,
  isEntryEmpty,
} from '../../lib/types/world-rules'
import type { ConflictPriority, WorldRuleEntry } from '../../lib/types/world-rules'

interface Props {
  selectedNode: string | null
  currentLabel: string
  currentHints: string[]
  currentEntry: WorldRuleEntry
  isCustomNode: boolean
  onFieldChange: (field: keyof WorldRuleEntry, value: string | ConflictPriority) => void
  onDeleteNode: () => void
  onClearEntry: () => void
}

export default function WorldRuleEntryEditor({
  selectedNode,
  currentLabel,
  currentHints,
  currentEntry,
  isCustomNode,
  onFieldChange,
  onDeleteNode,
  onClearEntry,
}: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-5">
      {selectedNode ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-text-primary">{currentLabel}</h3>
            <div className="flex items-center gap-2">
              {isCustomNode && (
                <button onClick={onDeleteNode} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> 删除节点
                </button>
              )}
              {!isEntryEmpty(currentEntry) && (
                <button onClick={onClearEntry} className="text-xs text-text-muted hover:text-red-400 flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> 清空
                </button>
              )}
            </div>
          </div>

          {currentHints.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {currentHints.map(hint => (
                <span key={hint} className="text-xs px-2 py-0.5 rounded-full bg-bg-elevated text-text-muted border border-border">
                  {hint}
                </span>
              ))}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              📜 取自真实（历史考据 / 现实原型）
            </label>
            <textarea
              value={currentEntry.historicalAnchors}
              onChange={event => onFieldChange('historicalAnchors', event.target.value)}
              placeholder="这个维度中有哪些内容是取自真实历史或现实的？例如：使用唐朝开元年间真实官制三省六部"
              rows={5}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-bg-base text-text-primary placeholder:text-text-muted/50 focus:ring-1 focus:ring-accent focus:border-accent resize-y"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              ✨ 架空改造（虚构 / 改编 / 原创设定）
            </label>
            <textarea
              value={currentEntry.fictionalAdaptations}
              onChange={event => onFieldChange('fictionalAdaptations', event.target.value)}
              placeholder="这个维度中有哪些内容是虚构或改编的？例如：在真实官制基础上增设灵修院，专管修士事务"
              rows={5}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-bg-base text-text-primary placeholder:text-text-muted/50 focus:ring-1 focus:ring-accent focus:border-accent resize-y"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">⚖️ 当真实与架空冲突时</label>
            <div className="flex gap-2">
              {(Object.entries(CONFLICT_PRIORITY_LABELS) as [ConflictPriority, string][]).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => onFieldChange('priority', value)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    currentEntry.priority === value
                      ? value === 'historical'
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                        : value === 'fictional'
                          ? 'bg-purple-500/20 border-purple-500/40 text-purple-400'
                          : 'bg-accent/20 border-accent/40 text-accent'
                      : 'border-border text-text-muted hover:border-text-muted'
                  }`}
                >
                  {value === 'historical' ? '📜 ' : value === 'fictional' ? '✨ ' : '⚖️ '}
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-text-muted">
          <span className="text-4xl mb-3">⚖️</span>
          <p className="text-sm">选择左侧的子类开始设定</p>
          <p className="text-xs mt-1">或点击「总览」设定大类级别的规则</p>
        </div>
      )}
    </div>
  )
}
