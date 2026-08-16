import { useState } from 'react'
import { X, Loader2, AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp, Check, RotateCw, Sparkles, Wand2, ArrowRight, Trash2, Plus, Edit3, RefreshCw, MessageSquare } from 'lucide-react'
import type { ChapterReviewIssue, ChapterReviewResult, RewriteResult, ChangeItem } from '../../lib/outline/chapter-reviewer'

interface Props {
  open: boolean
  onClose: () => void
  chapters: Array<{ index: number; title: string }>
  onApplyRewrite: (chapterIndex: number, newSummary: string) => void
  onReview: (userQuestion?: string) => Promise<ChapterReviewResult>
  onRewrite: (issue: ChapterReviewIssue, customSuggestion?: string) => Promise<RewriteResult>
}

const SEVERITY_CONFIG = {
  high: { icon: AlertTriangle, color: 'text-error', bg: 'bg-error/10', border: 'border-error/30', label: '严重' },
  medium: { icon: AlertCircle, color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30', label: '中等' },
  low: { icon: Info, color: 'text-accent', bg: 'bg-accent/10', border: 'border-accent/30', label: '轻微' },
}

const ISSUE_TYPE_LABELS: Record<string, string> = {
  logic: '逻辑问题',
  consistency: '前后不一致',
  plot: '情节问题',
  character: '角色行为',
  timeline: '时间线问题',
  other: '其他问题',
}

type RewriteMap = Record<string, RewriteResult>
type AcceptedChanges = Record<string, Set<string>> // issueId -> Set of changeIds
type EditMode = Record<string, boolean> // issueId -> 是否开启编辑建议模式
type CustomSuggestions = Record<string, string> // issueId -> 用户编辑的建议

export default function ChapterReviewDialog({
  open,
  onClose,
  chapters,
  onApplyRewrite,
  onReview,
  onRewrite,
}: Props) {
  const [diagnosing, setDiagnosing] = useState(false)
  const [rewriting, setRewriting] = useState<string | null>(null)
  const [diagnosis, setDiagnosis] = useState<ChapterReviewResult | null>(null)
  const [rewrites, setRewrites] = useState<RewriteMap>({})
  const [userQuestion, setUserQuestion] = useState('')
  const [expandedIssues, setExpandedIssues] = useState<Set<string>>(new Set())
  const [acceptedChanges, setAcceptedChanges] = useState<AcceptedChanges>({})
  const [ignoredIssues, setIgnoredIssues] = useState<Set<string>>(new Set())
  const [appliedChapters, setAppliedChapters] = useState<Set<number>>(new Set())
  const [editMode, setEditMode] = useState<EditMode>({})
  const [customSuggestions, setCustomSuggestions] = useState<CustomSuggestions>({})

  if (!open) return null

  const handleDiagnose = async () => {
    setDiagnosing(true)
    setDiagnosis(null)
    setRewrites({})
    setAcceptedChanges({})
    setIgnoredIssues(new Set())
    setAppliedChapters(new Set())
    setEditMode({})
    setCustomSuggestions({})
    try {
      const result = await onReview(userQuestion || undefined)
      setDiagnosis(result)
      // Auto expand high severity issues
      const highIssues = result.issues
        .filter(i => i.severity === 'high')
        .map(i => i.id)
      setExpandedIssues(new Set(highIssues))
    } catch (error) {
      console.error('[ChapterReview] 诊断失败:', error)
    } finally {
      setDiagnosing(false)
    }
  }

  const handleRewriteIssue = async (issue: ChapterReviewIssue) => {
    setRewriting(issue.id)
    try {
      // 使用自定义建议，如果没有则使用原始建议
      const customSuggestion = customSuggestions[issue.id] || issue.suggestion
      console.log('[ChapterReview] 开始重写:', { 
        issueId: issue.id, 
        originalSuggestion: issue.suggestion,
        customSuggestion 
      })
      const result = await onRewrite(issue, customSuggestion)
      console.log('[ChapterReview] 重写结果:', { 
        changesCount: result.changes.length,
        summary: result.summary 
      })
      setRewrites(prev => ({ ...prev, [issue.id]: result }))
      // 关闭编辑模式，显示结果
      setEditMode(prev => ({ ...prev, [issue.id]: false }))
      // Auto accept all changes initially (user can deselect)
      if (result.changes.length > 0) {
        setAcceptedChanges(prev => ({
          ...prev,
          [issue.id]: new Set(result.changes.map(c => c.id)),
        }))
      }
    } catch (error) {
      console.error('[ChapterReview] 改写失败:', error)
    } finally {
      setRewriting(null)
    }
  }

  const toggleExpand = (issueId: string) => {
    setExpandedIssues(prev => {
      const next = new Set(prev)
      next.has(issueId) ? next.delete(issueId) : next.add(issueId)
      return next
    })
  }

  const toggleChangeAccept = (issueId: string, changeId: string) => {
    setAcceptedChanges(prev => {
      const issueChanges = prev[issueId] || new Set()
      const next = new Set(issueChanges)
      next.has(changeId) ? next.delete(changeId) : next.add(changeId)
      return { ...prev, [issueId]: next }
    })
  }

  const toggleIssueIgnore = (issueId: string) => {
    setIgnoredIssues(prev => {
      const next = new Set(prev)
      next.has(issueId) ? next.delete(issueId) : next.add(issueId)
      return next
    })
  }

  const acceptAllChanges = (issueId: string) => {
    const rewrite = rewrites[issueId]
    if (!rewrite) return
    setAcceptedChanges(prev => ({
      ...prev,
      [issueId]: new Set(rewrite.changes.map(c => c.id)),
    }))
  }

  const rejectAllChanges = (issueId: string) => {
    setAcceptedChanges(prev => ({ ...prev, [issueId]: new Set() }))
  }

  const applyIssueChanges = (issue: ChapterReviewIssue) => {
    const rewrite = rewrites[issue.id]
    const accepted = acceptedChanges[issue.id] || new Set()
    if (!rewrite || accepted.size === 0) return

    // Build final summary by applying only accepted changes
    let finalSummary = rewrite.originalSummary
    const orderedChanges = rewrite.changes
      .filter(c => accepted.has(c.id))
      .reverse() // Apply changes from end to start to preserve positions
    
    for (const change of orderedChanges) {
      if (change.before && finalSummary.includes(change.before)) {
        finalSummary = finalSummary.replace(change.before, change.after)
      }
    }

    if (issue.affectedChapters.length > 0) {
      onApplyRewrite(issue.affectedChapters[0], finalSummary)
      setAppliedChapters(prev => new Set([...prev, issue.affectedChapters[0]]))
    }
  }

  // 编辑建议相关函数
  const toggleEditMode = (issue: ChapterReviewIssue) => {
    setEditMode(prev => {
      const newMode = !prev[issue.id]
      if (newMode && !customSuggestions[issue.id]) {
        // 初始化建议为 AI 给出的建议
        setCustomSuggestions(prevSuggestions => ({
          ...prevSuggestions,
          [issue.id]: issue.suggestion,
        }))
      }
      return { ...prev, [issue.id]: newMode }
    })
  }

  const updateCustomSuggestion = (issueId: string, text: string) => {
    setCustomSuggestions(prev => ({ ...prev, [issueId]: text }))
  }

  // 重新生成（重改）
  const regenerateRewrite = (issue: ChapterReviewIssue) => {
    // 清除之前的改写结果，重新生成
    setRewrites(prev => {
      const next = { ...prev }
      delete next[issue.id]
      return next
    })
    setAcceptedChanges(prev => {
      const next = { ...prev }
      delete next[issue.id]
      return next
    })
    // 重新调用改写（会使用当前的自定义建议）
    void handleRewriteIssue(issue)
  }

  const getChapterTitle = (index: number) => {
    return chapters.find(c => c.index === index)?.title || `第${index + 1}章`
  }

  const getAcceptedCount = (issueId: string) => acceptedChanges[issueId]?.size || 0
  const getTotalChanges = (issueId: string) => rewrites[issueId]?.changes.length || 0
  const isIssueApplied = (issue: ChapterReviewIssue) => 
    issue.affectedChapters.some(idx => appliedChapters.has(idx))

  const sortedIssues = diagnosis?.issues.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 }
    return severityOrder[a.severity] - severityOrder[b.severity]
  }) || []

  const totalIssues = diagnosis?.issues.length || 0
  const ignoredCount = ignoredIssues.size
  const appliedCount = appliedChapters.size
  const withRewrites = Object.keys(rewrites).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[92%] max-w-3xl max-h-[88vh] bg-bg-base border border-border rounded-lg shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-medium text-text-primary">AI 章纲智能诊断</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-bg-hover rounded">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        {/* Input area */}
        <div className="px-4 py-3 border-b border-border">
          <div className="text-xs text-text-muted mb-2">
            第 1 步：AI 诊断 — 检查 {chapters.length} 章的逻辑一致性与设定匹配
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={userQuestion}
              onChange={e => setUserQuestion(e.target.value)}
              placeholder="可选：特别关注的问题（如：为什么第2章突然出现一把神剑？）"
              className="flex-1 px-3 py-1.5 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
              onKeyDown={e => { if (e.key === 'Enter' && !diagnosing) void handleDiagnose() }}
            />
            <button
              onClick={() => { void handleDiagnose() }}
              disabled={diagnosing}
              className="flex items-center gap-1 px-3 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent-hover disabled:opacity-50"
            >
              {diagnosing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RotateCw className={`w-3 h-3 ${diagnosis ? '' : ''}`} />
              )}
              {diagnosing ? '诊断中...' : (diagnosis ? '重新诊断' : '开始诊断')}
            </button>
          </div>
          {diagnosis && (
            <div className="text-[10px] text-text-muted mt-1">
              诊断完成 ✓ 发现 {totalIssues} 个问题 · 点击问题展开 → 选择 AI 修复 / 手动修改 / 忽略
            </div>
          )}
        </div>

        {/* Results area */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {!diagnosis && !diagnosing && (
            <div className="text-center py-12 text-text-muted text-sm">
              <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-50" />
              点击"开始诊断"让 AI 检查章纲问题
            </div>
          )}

          {diagnosing && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <Loader2 className="w-8 h-8 text-accent animate-spin" />
              <div className="text-xs text-text-muted">AI 正在分析章节逻辑与设定匹配...</div>
            </div>
          )}

          {diagnosis && !diagnosing && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-bg-surface border border-border rounded-md px-3 py-2">
                <div className="text-[10px] text-text-muted mb-1">诊断总结</div>
                <div className="text-xs text-text-secondary">{diagnosis.summary}</div>
              </div>

              {/* Stats */}
              <div className="flex flex-wrap gap-2 text-[10px]">
                <div className="px-2 py-1 bg-error/10 text-error rounded">
                  严重 {diagnosis.issues.filter(i => i.severity === 'high').length}
                </div>
                <div className="px-2 py-1 bg-warning/10 text-warning rounded">
                  中等 {diagnosis.issues.filter(i => i.severity === 'medium').length}
                </div>
                <div className="px-2 py-1 bg-accent/10 text-accent rounded">
                  轻微 {diagnosis.issues.filter(i => i.severity === 'low').length}
                </div>
                {withRewrites > 0 && (
                  <div className="px-2 py-1 bg-accent/10 text-accent rounded flex items-center gap-1">
                    <Wand2 className="w-3 h-3" />
                    已生成 {withRewrites} 个智能修复
                  </div>
                )}
                {appliedCount > 0 && (
                  <div className="px-2 py-1 bg-success/10 text-success rounded flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    已应用 {appliedCount}
                  </div>
                )}
              </div>

              {/* Issue list */}
              {sortedIssues.length === 0 ? (
                <div className="text-center py-8 text-success text-sm">
                  <Check className="w-6 h-6 mx-auto mb-2" />
                  未发现问题，章纲逻辑与设定匹配良好
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedIssues.map((issue) => {
                    const config = SEVERITY_CONFIG[issue.severity]
                    const Icon = config.icon
                    const isExpanded = expandedIssues.has(issue.id)
                    const isIgnored = ignoredIssues.has(issue.id)
                    const rewrite = rewrites[issue.id]
                    const isRewriting = rewriting === issue.id
                    const accepted = acceptedChanges[issue.id] || new Set()
                    const applied = isIssueApplied(issue)

                    return (
                      <div
                        key={issue.id}
                        className={`border rounded-md overflow-hidden transition-all ${config.border} ${
                          applied ? 'bg-success/5' : isIgnored ? 'bg-bg-base opacity-60' : 'bg-bg-surface'
                        }`}
                      >
                        {/* Issue header - always visible */}
                        <button
                          onClick={() => toggleExpand(issue.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-hover transition-colors text-left"
                        >
                          <Icon className={`w-3.5 h-3.5 ${config.color} flex-shrink-0`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${config.bg} ${config.color}`}>
                                {config.label}
                              </span>
                              <span className="text-[10px] text-text-muted">
                                {ISSUE_TYPE_LABELS[issue.issueType] || issue.issueType}
                              </span>
                              {isIgnored && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-text-muted/20 text-text-muted">
                                  已忽略
                                </span>
                              )}
                              {applied && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-success/20 text-success flex items-center gap-0.5">
                                  <Check className="w-3 h-3" />已应用
                                </span>
                              )}
                            </div>
                            {isExpanded ? (
                              <div className="text-xs text-text-primary whitespace-pre-wrap break-words">
                                {issue.description}
                              </div>
                            ) : (
                              <div className="text-xs text-text-primary line-clamp-2">
                                {issue.description}
                              </div>
                            )}
                            <div className="text-[10px] text-text-muted mt-0.5">
                              影响：{issue.affectedChapters.map(c => getChapterTitle(c)).join('、')}
                            </div>
                          </div>
                          {applied ? (
                            <Check className="w-4 h-4 text-success flex-shrink-0" />
                          ) : (
                            isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-text-muted flex-shrink-0" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-text-muted flex-shrink-0" />
                            )
                          )}
                        </button>

                        {/* Expanded content */}
                        {isExpanded && !applied && (
                          <div className="px-3 py-3 border-t border-border space-y-3 bg-bg-elevated/30">
                            {/* Suggestion */}
                            <div>
                              <div className="text-[10px] text-text-muted mb-1">修改方向</div>
                              <div className="text-xs text-text-secondary bg-bg-surface p-2 rounded border border-border">
                                {issue.suggestion}
                              </div>
                            </div>

                            {/* Action buttons */}
                            {!rewrite && (
                              <div className="flex gap-2 flex-wrap">
                                <button
                                  onClick={() => { void handleRewriteIssue(issue) }}
                                  disabled={isRewriting}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
                                >
                                  {isRewriting ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Wand2 className="w-3 h-3" />
                                  )}
                                  {isRewriting ? 'AI 生成中...' : 'AI 智能修复'}
                                </button>
                                <button
                                  onClick={() => toggleEditMode(issue)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg-elevated text-text-secondary border border-border rounded hover:text-text-primary"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                  编辑建议
                                </button>
                                <button
                                  onClick={() => toggleIssueIgnore(issue.id)}
                                  className="px-3 py-1.5 text-xs text-text-muted border border-border rounded hover:text-text-primary"
                                >
                                  {isIgnored ? '取消忽略' : '忽略'}
                                </button>
                              </div>
                            )}

                            {/* Edit suggestion mode */}
                            {editMode[issue.id] && (
                              <div className="space-y-2 bg-bg-elevated p-2 rounded border border-border">
                                <div className="text-[10px] text-accent flex items-center gap-1">
                                  <MessageSquare className="w-3 h-3" />
                                  编辑修改建议（AI 将根据此建议重新生成）
                                </div>
                                <div className="text-[10px] text-text-muted">
                                  AI 原始建议：<span className="text-text-secondary">{issue.suggestion}</span>
                                </div>
                                <textarea
                                  value={customSuggestions[issue.id] || ''}
                                  onChange={e => updateCustomSuggestion(issue.id, e.target.value)}
                                  rows={3}
                                  className="w-full px-2 py-1 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent resize-none"
                                  placeholder="输入你希望的修改方向..."
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => { void handleRewriteIssue(issue) }}
                                    disabled={!customSuggestions[issue.id] || isRewriting}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
                                  >
                                    <Wand2 className="w-3 h-3" />
                                    根据此建议生成
                                  </button>
                                  <button
                                    onClick={() => toggleEditMode(issue)}
                                    className="px-3 py-1.5 text-xs text-text-muted border border-border rounded hover:text-text-primary"
                                  >
                                    取消
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Rewrite result with diff */}
                            {rewrite && !editMode[issue.id] && (
                              <div className="space-y-3">
                                {/* Rewrite summary */}
                                <div className="text-[10px] text-accent bg-accent/10 px-2 py-1 rounded">
                                  {rewrite.summary}
                                </div>

                                {/* Changes list */}
                                {rewrite.changes.length > 0 ? (
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                      <div className="text-[10px] text-text-muted">
                                        {getAcceptedCount(issue.id)}/{getTotalChanges(issue.id)} 处修改已选中
                                      </div>
                                      <div className="flex gap-1">
                                        <button
                                          onClick={() => acceptAllChanges(issue.id)}
                                          className="text-[10px] text-accent hover:underline"
                                        >
                                          全选
                                        </button>
                                        <span className="text-[10px] text-text-muted">|</span>
                                        <button
                                          onClick={() => rejectAllChanges(issue.id)}
                                          className="text-[10px] text-text-muted hover:underline"
                                        >
                                          全不选
                                        </button>
                                      </div>
                                    </div>
                                    
                                    {rewrite.changes.map((change, idx) => {
                                      const isAccepted = accepted.has(change.id)
                                      return (
                                        <ChangeDiffItem
                                          key={change.id}
                                          change={change}
                                          index={idx + 1}
                                          accepted={isAccepted}
                                          onToggle={() => toggleChangeAccept(issue.id, change.id)}
                                        />
                                      )
                                    })}
                                  </div>
                                ) : (
                                  <div className="text-[10px] text-text-muted bg-bg-surface p-2 rounded border border-border text-center">
                                    AI 认为此问题无需修改，或建议通过情节解释解决
                                  </div>
                                )}

                                {/* Final preview */}
                                {getAcceptedCount(issue.id) > 0 && (
                                  <div className="bg-bg-surface border border-border rounded p-2">
                                    <div className="text-[10px] text-text-muted mb-1">应用后预览</div>
                                    <div className="text-xs text-text-secondary">
                                      {rewrite.originalSummary.split('\n').map((line, idx) => {
                                        const acceptedChangesList = rewrite.changes.filter(c => accepted.has(c.id))
                                        let processedLine = line
                                        for (const change of acceptedChangesList) {
                                          if (change.before && processedLine.includes(change.before)) {
                                            processedLine = processedLine.replace(
                                              change.before,
                                              `【${change.after}】`
                                            )
                                          }
                                        }
                                        return <div key={idx}>{processedLine}</div>
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Action buttons */}
                                <div className="flex gap-2 pt-1 flex-wrap">
                                  <button
                                    onClick={() => applyIssueChanges(issue)}
                                    disabled={getAcceptedCount(issue.id) === 0}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-success text-white rounded hover:bg-success/80 disabled:opacity-50"
                                  >
                                    <Check className="w-3 h-3" />
                                    应用选中修改
                                  </button>
                                  <button
                                    onClick={() => regenerateRewrite(issue)}
                                    disabled={rewriting === issue.id}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-bg-elevated text-accent border border-accent/30 rounded hover:bg-accent/10 disabled:opacity-50"
                                  >
                                    <RefreshCw className={`w-3 h-3 ${rewriting === issue.id ? 'animate-spin' : ''}`} />
                                    重改
                                  </button>
                                  <button
                                    onClick={() => toggleEditMode(issue)}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-bg-elevated text-text-secondary border border-border rounded hover:text-text-primary"
                                  >
                                    <MessageSquare className="w-3 h-3" />
                                    编辑建议
                                  </button>
                                  <button
                                    onClick={() => toggleIssueIgnore(issue.id)}
                                    className="px-3 py-1.5 text-xs text-text-muted border border-border rounded hover:text-text-primary"
                                  >
                                    {isIgnored ? '取消忽略' : '忽略'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Applied indicator */}
                        {applied && (
                          <div className="px-3 py-2 border-t border-border bg-success/5">
                            <div className="text-[10px] text-success flex items-center gap-1">
                              <Check className="w-3 h-3" />
                              已应用到：{issue.affectedChapters.map(c => getChapterTitle(c)).join('、')}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Ignored issues summary */}
              {ignoredCount > 0 && (
                <div className="border border-border bg-bg-base rounded-md px-3 py-2">
                  <div className="text-[10px] text-text-muted font-medium">已忽略 {ignoredCount} 个问题</div>
                  <div className="text-[10px] text-text-muted mt-0.5">
                    展开问题后可点击"取消忽略"恢复
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border flex justify-between items-center">
          <div className="text-[10px] text-text-muted">
            {diagnosis ? `共 ${totalIssues} 个问题 · 已应用 ${appliedCount} · 已忽略 ${ignoredCount}` : '点击上方按钮开始诊断'}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-accent border border-accent rounded hover:bg-accent/10"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Diff item subcomponent
function ChangeDiffItem({
  change,
  index,
  accepted,
  onToggle,
}: {
  change: ChangeItem
  index: number
  accepted: boolean
  onToggle: () => void
}) {
  return (
    <div
      className={`border rounded p-2 transition-all cursor-pointer ${
        accepted ? 'border-accent/30 bg-accent/5' : 'border-border bg-bg-base opacity-60'
      }`}
      onClick={onToggle}
    >
      <div className="flex items-start gap-2">
        <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
          accepted ? 'bg-accent text-white' : 'bg-text-muted/20 text-text-muted'
        }`}>
          {accepted ? <Check className="w-3 h-3" /> : index}
        </div>
        
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Before */}
          {change.before && (
            <div>
              <div className="text-[9px] text-error mb-0.5 flex items-center gap-0.5">
                <Trash2 className="w-2.5 h-2.5" /> 删除
              </div>
              <div className="text-xs text-text-secondary bg-error/10 px-2 py-1 rounded border border-error/20 line-through">
                {change.before}
              </div>
            </div>
          )}
          
          {/* Arrow */}
          <div className="flex justify-center py-0.5">
            <ArrowRight className="w-3 h-3 text-text-muted" />
          </div>
          
          {/* After */}
          {change.after && (
            <div>
              <div className="text-[9px] text-success mb-0.5 flex items-center gap-0.5">
                <Plus className="w-2.5 h-2.5" /> 新增
              </div>
              <div className="text-xs text-text-secondary bg-success/10 px-2 py-1 rounded border border-success/20">
                {change.after}
              </div>
            </div>
          )}
          
          {/* Reason */}
          {change.reason && (
            <div className="text-[10px] text-text-muted mt-1 pt-1 border-t border-border/50">
              💡 {change.reason}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
