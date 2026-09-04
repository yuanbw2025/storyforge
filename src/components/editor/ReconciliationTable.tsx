/**
 * 表格形式的计划-正文对账组件
 * 支持：本地状态管理、批量保存、撤销更改
 */
import { useState, useCallback, useEffect } from 'react'
import {
  Check, X, RefreshCw, HelpCircle, ChevronDown, ChevronUp,
  AlertTriangle, FileText, Calendar, GitBranch, EyeOff,
  Bookmark, Sparkles, Save, Undo2, Loader2
} from 'lucide-react'
import type { ChapterPlanReconciliation } from '../../lib/types/outline'

interface Props {
  reconciliation: ChapterPlanReconciliation
  chapterTitle: string
  nextChapterTitle?: string
  onSave: (actions: ReconciliationActionMap) => Promise<void>
  onForeshadow: (item: { section: string; index: number; text: string }) => Promise<void>
}

type ItemAction = 'pending' | 'confirmed' | 'applied' | 'dismissed' | 'foreshadowed'

interface ReconciliationItemWithStatus {
  text: string
  evidenceQuotes: Array<{ quote: string; source?: string }>
  status: ItemAction
}

interface ReconciliationSection {
  key: string
  title: string
  icon: typeof Check
  color: string
  items: ReconciliationItemWithStatus[]
  description: string
  defaultAction?: 'confirm' | 'apply' | 'dismissed'
}

// 用于追踪所有操作的映射
export interface ReconciliationActionMap {
  [key: string]: {
    action: 'confirm' | 'apply' | 'dismiss' | 'foreshadow'
    indices: number[]
  }
}

const SECTION_CONFIGS: Array<{
  key: string
  title: string
  icon: typeof Check
  color: string
  description: string
  defaultAction?: 'confirm' | 'apply' | 'dismissed'
}> = [
  {
    key: 'completedGoals',
    title: '✅ 已完成',
    icon: Check,
    color: 'green',
    description: '原计划要做，正文确实完成了',
    defaultAction: 'confirm',
  },
  {
    key: 'unfinishedGoals',
    title: '❌ 未完成',
    icon: X,
    color: 'red',
    description: '原计划要做，但正文没完成。可能推迟了或取消了',
    defaultAction: 'dismissed',
  },
  {
    key: 'deviations',
    title: '⚠️ 实际偏移',
    icon: AlertTriangle,
    color: 'yellow',
    description: '原计划没有，但正文确实发生了（意外事件）',
  },
  {
    key: 'newConstraints',
    title: '📌 新增约束',
    icon: FileText,
    color: 'blue',
    description: '正文造成的新限制、伏笔或状态变化',
    defaultAction: 'apply',
  },
  {
    key: 'nextChapterImpacts',
    title: '🔗 下一章影响',
    icon: Calendar,
    color: 'purple',
    description: '这一章的内容对下一章的连锁反应',
    defaultAction: 'apply',
  },
  {
    key: 'foreshadowingRevealed',
    title: '👁️ 伏笔提前暴露',
    icon: EyeOff,
    color: 'orange',
    description: '原计划在后面章节揭示的内容，现在提前暴露了',
    defaultAction: 'dismissed',
  },
  {
    key: 'delayedPlot',
    title: '⏰ 情节推迟',
    icon: GitBranch,
    color: 'cyan',
    description: '原计划在本章发生的情节，推迟到后面了',
    defaultAction: 'apply',
  },
]

const STATUS_COLORS: Record<ItemAction, string> = {
  pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  confirmed: 'bg-green-500/10 text-green-400 border-green-500/30',
  applied: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  dismissed: 'bg-gray-500/10 text-gray-400 border-gray-500/30',
  foreshadowed: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
}

const STATUS_LABELS: Record<ItemAction, string> = {
  pending: '待处理',
  confirmed: '已接受',
  applied: '已同步',
  dismissed: '已排除',
  foreshadowed: '已设为伏笔',
}

export function ReconciliationTable({
  reconciliation,
  chapterTitle,
  nextChapterTitle,
  onSave,
  onForeshadow,
}: Props) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['completedGoals', 'unfinishedGoals', 'deviations'])
  )
  const [showHelp, setShowHelp] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [foreshadowSuccess, setForeshadowSuccess] = useState<string | null>(null)

  // 用于追踪更改的状态
  const [sections, setSections] = useState<ReconciliationSection[]>([])
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // 初始化
  useEffect(() => {
    const initSections = (): ReconciliationSection[] => {
      const result: ReconciliationSection[] = []

      // 当前格式以 section:action 为键，支持同一分区内不同条目选择不同动作。
      const savedActions = reconciliation.actions || {}

      for (const config of SECTION_CONFIGS) {
        const items = (reconciliation[config.key as keyof ChapterPlanReconciliation] || []) as Array<{
          text: string
          evidenceQuotes?: Array<{ quote: string; source?: string }>
        }>

        if (items.length > 0) {
          const actionTypeToStatus: Record<string, ItemAction> = {
            confirm: 'confirmed',
            apply: 'applied',
            dismiss: 'dismissed',
            foreshadow: 'foreshadowed',
          }

          result.push({
            key: config.key,
            title: config.title,
            icon: config.icon,
            color: config.color,
            description: config.description,
            defaultAction: config.defaultAction,
            items: items.map((item, index) => {
              const savedAction = Object.entries(savedActions)
                .filter(([key]) => key.startsWith(`${config.key}:`))
                .map(([, action]) => action)
                .find(action => action.indices.includes(index))
              const status = savedAction
                ? actionTypeToStatus[savedAction.action] || 'pending'
                : 'pending'
              return {
                text: item.text,
                evidenceQuotes: item.evidenceQuotes || [],
                status,
              }
            }),
          })
        }
      }

      return result
    }

    setSections(initSections())
    setHasUnsavedChanges(false)
    setSaveSuccess(false)
  }, [reconciliation])

  const toggleSection = (key: string) => {
    const newExpanded = new Set(expandedSections)
    if (newExpanded.has(key)) {
      newExpanded.delete(key)
    } else {
      newExpanded.add(key)
    }
    setExpandedSections(newExpanded)
  }

  // 获取所有更改的操作映射
  const getActionMap = useCallback((): ReconciliationActionMap => {
    const actionMap: ReconciliationActionMap = {}

    sections.forEach(section => {
      section.items.forEach((item, index) => {
        if (item.status !== 'pending') {
          const action = item.status === 'confirmed' ? 'confirm' :
                        item.status === 'applied' ? 'apply' :
                        item.status === 'dismissed' ? 'dismiss' :
                        item.status === 'foreshadowed' ? 'foreshadow' : null

          if (action) {
            const actionKey = `${section.key}:${action}`
            if (!actionMap[actionKey]) {
              actionMap[actionKey] = { action, indices: [] }
            }
            actionMap[actionKey].indices.push(index)
          }
        }
      })
    })

    return actionMap
  }, [sections])

  const handleItemAction = async (sectionKey: string, itemIndex: number, action: ItemAction) => {
    const section = sections.find(s => s.key === sectionKey)
    const item = section?.items[itemIndex]

    // 如果是设为伏笔操作，先调用 API
    if (action === 'foreshadowed' && item) {
      try {
        await onForeshadow({
          section: sectionKey,
          index: itemIndex,
          text: item.text,
        })
        setForeshadowSuccess(`✓ 已设为伏笔`)
        setTimeout(() => setForeshadowSuccess(null), 2000)
      } catch (err) {
        console.error('Failed to save foreshadow:', err)
        return // 如果失败，不更新状态
      }
    }

    setSections(prev => prev.map(section => {
      if (section.key === sectionKey) {
        const newItems = section.items.map((item, idx) => {
          if (idx === itemIndex) {
            return { ...item, status: action }
          }
          return item
        })
        return { ...section, items: newItems }
      }
      return section
    }))

    setHasUnsavedChanges(true)
    setSaveSuccess(false)
  }

  const handleSave = async () => {
    const actionMap = getActionMap()

    if (Object.keys(actionMap).length === 0) {
      return
    }

    setIsSaving(true)
    try {
      await onSave(actionMap)
      setHasUnsavedChanges(false)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      console.error('Failed to save changes:', err)
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    // 重置所有更改
    setSections(prev => prev.map(section => ({
      ...section,
      items: section.items.map(item => ({ ...item, status: 'pending' as ItemAction })),
    })))
    setHasUnsavedChanges(false)
    setSaveSuccess(false)
  }

  const handleGlobalAction = (action: 'confirm-all' | 'apply-all' | 'dismiss-all') => {
    const statusMap = {
      'confirm-all': 'confirmed' as ItemAction,
      'apply-all': 'applied' as ItemAction,
      'dismiss-all': 'dismissed' as ItemAction,
    }

    setSections(prev => prev.map(section => ({
      ...section,
      items: section.items.map(item => ({ ...item, status: statusMap[action] })),
    })))

    setHasUnsavedChanges(true)
    setSaveSuccess(false)
  }

  const getPendingCount = () => {
    return sections.reduce((count, section) => {
      return count + section.items.filter(item => item.status === 'pending').length
    }, 0)
  }

  const getTotalChangedCount = () => {
    return sections.reduce((count, section) => {
      return count + section.items.filter(item => item.status !== 'pending').length
    }, 0)
  }

  const renderItemActions = (section: ReconciliationSection, itemIndex: number) => {
    const currentItem = section.items[itemIndex]
    const actions: Array<{ key: ItemAction; label: string; icon: typeof Check; tooltip: string }> = [
      { key: 'confirmed', label: '接受', icon: Check, tooltip: '接受此事实，AI 后续会参考（正常权重）' },
      { key: 'applied', label: '同步', icon: RefreshCw, tooltip: '同步到章纲，AI 后续会重点参考（高权重）' },
      { key: 'foreshadowed', label: '伏笔', icon: Bookmark, tooltip: '保存为伏笔，留待后续章节揭示' },
      { key: 'dismissed', label: '排除', icon: X, tooltip: '排除此条目，AI 可能不会重点参考' },
    ]

    return (
      <div className="flex gap-1">
        {actions.map(action => (
          <button
            key={action.key}
            onClick={() => handleItemAction(section.key, itemIndex, action.key)}
            className={`p-1.5 rounded transition-all duration-200 ${
              currentItem.status === action.key
                ? `${STATUS_COLORS[action.key]} scale-110 shadow-md`
                : 'hover:bg-bg-elevated text-text-muted hover:text-text-secondary hover:scale-105'
            }`}
            title={action.tooltip}
          >
            <action.icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>
    )
  }

  const renderSection = (section: ReconciliationSection) => {
    const isExpanded = expandedSections.has(section.key)
    const pendingCount = section.items.filter(item => item.status === 'pending').length
    const changedCount = section.items.filter(item => item.status !== 'pending').length

    return (
      <div
        key={section.key}
        className="border border-border rounded-lg overflow-hidden transition-all duration-200 hover:border-accent/30"
      >
        {/* Section Header */}
        <button
          onClick={() => toggleSection(section.key)}
          className="w-full px-3 py-2 bg-bg-card hover:bg-bg-elevated transition-colors flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <section.icon className={`w-4 h-4 text-${section.color}-400`} />
            <span className="text-sm font-medium">{section.title}</span>
            <span className="text-xs text-text-muted">({section.items.length})</span>
          </div>
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs rounded bg-yellow-500/20 text-yellow-400">
                {pendingCount} 待处理
              </span>
            )}
            {changedCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs rounded bg-green-500/20 text-green-400">
                {changedCount} 已处理
              </span>
            )}
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-muted" />
            )}
          </div>
        </button>

        {/* Section Content */}
        {isExpanded && (
          <div className="p-2 bg-bg-surface space-y-2">
            <p className="text-xs text-text-muted px-2">{section.description}</p>

            {section.items.map((item, index) => (
              <div
                key={index}
                className={`p-2 rounded border transition-all duration-200 ${
                  item.status !== 'pending'
                    ? 'bg-bg-elevated border-accent/20'
                    : 'bg-bg-card border-border hover:border-accent/30'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-1.5 py-0.5 text-xs rounded ${STATUS_COLORS[item.status]}`}>
                        {STATUS_LABELS[item.status]}
                      </span>
                      <span className="text-xs text-text-muted">#{index + 1}</span>
                    </div>
                    <p className="text-sm text-text-secondary">{item.text}</p>

                    {/* Evidence Quotes */}
                    {item.evidenceQuotes.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {item.evidenceQuotes.map((quote, qIndex) => (
                          <div
                            key={qIndex}
                            className="text-xs text-text-muted italic border-l-2 border-accent/30 pl-2"
                          >
                            "{quote.quote}"
                            {quote.source && (
                              <span className="text-text-dim"> — {quote.source}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  {renderItemActions(section, index)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-amber-300">📊 计划—正文对账</span>
              <span className="text-xs text-text-muted">第 {reconciliation.chapterId} 章: {chapterTitle}</span>
            </div>

            {nextChapterTitle && (
              <span className="text-xs text-text-muted">
                → 下一章: {nextChapterTitle}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* 状态指示 */}
            {hasUnsavedChanges && (
              <span className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-amber-500/20 text-amber-400 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                有未保存更改
              </span>
            )}
            {saveSuccess && (
              <span className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-green-500/20 text-green-400">
                <Check className="w-3 h-3" />
                已保存
              </span>
            )}
            {foreshadowSuccess && (
              <div className="flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-purple-500/20 text-purple-400 animate-pulse">
                <Bookmark className="w-3 h-3" />
                <span>{foreshadowSuccess}</span>
              </div>
            )}
            {getPendingCount() > 0 && (
              <span className="px-2 py-1 text-xs rounded-full bg-yellow-500/20 text-yellow-400">
                {getPendingCount()} 待处理
              </span>
            )}

            {/* Help Button */}
            <div className="relative">
              <button
                onClick={() => setShowHelp(!showHelp)}
                className="p-1 rounded hover:bg-bg-elevated text-text-muted hover:text-text-secondary transition-colors"
                title="查看说明"
              >
                <HelpCircle className="w-4 h-4" />
              </button>

              {showHelp && (
                <div className="absolute right-0 z-20 w-80 p-3 mt-2 text-xs rounded-lg bg-bg-card border border-border shadow-xl">
                  <h4 className="mb-2 font-medium text-text-primary">对账说明</h4>
                  <div className="space-y-2 text-text-secondary">
                    <p>
                      <strong className="text-green-400">✅ 已完成</strong>:
                      原计划要做的事，正文确实完成了。
                    </p>
                    <p>
                      <strong className="text-red-400">❌ 未完成</strong>:
                      原计划要做，但正文没完成。可能推迟了或取消了。
                    </p>
                    <p>
                      <strong className="text-yellow-400">⚠️ 实际偏移</strong>:
                      原计划没有，但正文确实发生了（意外事件）。
                    </p>
                    <p>
                      <strong className="text-blue-400">📌 新增约束</strong>:
                      正文造成的新限制、伏笔或状态变化。
                    </p>
                    <p>
                      <strong className="text-purple-400">🔗 下一章影响</strong>:
                      这一章的内容对下一章的连锁反应。
                    </p>
                    <p>
                      <strong className="text-orange-400">👁️ 伏笔提前暴露</strong>:
                      原计划在后面章节揭示的内容，现在提前暴露了。
                    </p>
                    <p>
                      <strong className="text-cyan-400">⏰ 情节推迟</strong>:
                      原计划在本章发生的情节，推迟到后面了。
                    </p>
                  </div>

                  <div className="mt-3 pt-2 border-t border-border">
                    <h5 className="mb-1 font-medium text-text-primary">操作说明</h5>
                    <div className="space-y-2 text-text-secondary">
                      <p>
                        <strong className="text-green-400">✓ 接受</strong>:
                        接受此事实，AI 后续会参考（正常权重）
                      </p>
                      <p>
                        <strong className="text-blue-400">↻ 同步</strong>:
                        同步到章纲，AI 后续会重点参考（高权重）
                      </p>
                      <p>
                        <strong className="text-purple-400">🔖 伏笔</strong>:
                        保存为伏笔，标记为"待揭示"，后续章节 AI 会主动寻找揭示机会
                      </p>
                      <p>
                        <strong className="text-gray-400">✗ 排除</strong>:
                        排除此条目，AI 可能不会重点参考
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-border bg-purple-500/10 p-2 rounded">
                    <p className="text-text-secondary">
                      <strong className="text-purple-400">💡 伏笔说明:</strong>
                      将当前事件设为伏笔后，它会被添加到全书的伏笔库中。AI 在生成后续章节时，会自动从伏笔库中选择合适的时机来揭示它，形成完整的叙事闭环。
                    </p>
                  </div>

                  <div className="mt-3 pt-2 border-t border-border bg-amber-500/10 p-2 rounded">
                    <p className="text-text-secondary">
                      <strong className="text-amber-400">💡 工作流:</strong>
                      先处理完所有条目，然后点击底部的<strong>"保存更改"</strong>按钮。这样可以避免不必要的刷新！
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-3">
        {/* Sections */}
        {sections.length > 0 ? (
          <div className="space-y-2">
            {sections.map(renderSection)}
          </div>
        ) : (
          <div className="py-4 text-center text-text-muted">
            <p className="text-sm">暂无对账内容</p>
            <p className="text-xs mt-1">生成章节记忆后会自动进行对账</p>
          </div>
        )}

        {/* Action Bar */}
        {sections.length > 0 && (
          <div className="mt-4 pt-3 border-t border-amber-500/20">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-text-muted">
                已处理 <strong className="text-text-primary">{getTotalChangedCount()}</strong> /
                {sections.reduce((sum, s) => sum + s.items.length, 0)} 项
              </div>

              {/* Quick Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleGlobalAction('confirm-all')}
                  className="px-2 py-1 text-xs rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                  title="全部设为接受"
                >
                  全部接受
                </button>
                <button
                  onClick={() => handleGlobalAction('apply-all')}
                  className="px-2 py-1 text-xs rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                  title="全部设为同步"
                >
                  全部同步
                </button>
                <button
                  onClick={() => handleGlobalAction('dismiss-all')}
                  className="px-2 py-1 text-xs rounded bg-gray-500/10 text-gray-400 hover:bg-gray-500/20 transition-colors"
                  title="全部设为排除"
                >
                  全部排除
                </button>
              </div>
            </div>

            {/* Save & Reset */}
            <div className="flex items-center justify-between">
              <button
                onClick={handleReset}
                disabled={!hasUnsavedChanges}
                className="flex items-center gap-1 px-3 py-1.5 text-xs rounded border border-border text-text-muted hover:text-text-secondary hover:border-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Undo2 className="w-3 h-3" />
                重置更改
              </button>

              <button
                onClick={handleSave}
                disabled={!hasUnsavedChanges || isSaving}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    保存更改
                    {getTotalChangedCount() > 0 && (
                      <span className="px-1.5 py-0.5 bg-white/20 rounded">
                        {getTotalChangedCount()}
                      </span>
                    )}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 bg-bg-surface border-t border-amber-500/20 text-xs text-text-muted">
        <div className="flex items-center justify-between">
          <span>生成时间: {new Date(reconciliation.generatedAt).toLocaleString()}</span>
          {reconciliation.proposedOutlineSummary && (
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-blue-400" />
              AI 已生成候选章纲
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default ReconciliationTable
