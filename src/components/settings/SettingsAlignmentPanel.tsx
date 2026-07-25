/**
 * 设定对齐面板 · Settings Alignment Panel
 *
 * 一键检测全部已有设定之间的矛盾，标红并给出修复建议。
 * 「起草修复稿」仅生成建议文本，不自动写回注册表（作者确认后自行改设定）。
 *
 * 数据流：
 *   assembleCrossSettingContext() → 全部设定 → AI → 矛盾列表 → UI
 */

import { useState, useCallback } from 'react'
import { Sparkles, AlertTriangle, AlertCircle, Info, Loader2, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { useWorldGroupStore } from '../../stores/world-group'
import { assembleCrossSettingContext } from '../../lib/ai/cross-setting-context'
import {
  buildSettingsAlignmentPrompt,
  buildAlignmentFixPrompt,
  parseAlignmentResult,
  type AlignmentConflict,
  type AlignmentSeverity,
} from '../../lib/ai/adapters/settings-alignment-adapter'
import type { Project } from '../../lib/types'

const SEVERITY_CONFIG: Record<AlignmentSeverity, { icon: typeof AlertTriangle; label: string; color: string; bg: string }> = {
  critical: { icon: AlertTriangle, label: '严重矛盾', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' },
  warning:  { icon: AlertCircle,   label: '需要注意', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30' },
  info:     { icon: Info,          label: '小瑕疵',   color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
}

interface Props {
  project: Project
}

export default function SettingsAlignmentPanel({ project }: Props) {
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  const ai = useAIStream(createAISessionKey(project.id!, 'settings.alignment'))
  const fixAi = useAIStream(createAISessionKey(project.id!, 'settings.alignment.fix'))
  const [conflicts, setConflicts] = useState<AlignmentConflict[]>([])
  const [overview, setOverview] = useState('')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)
  const [lastSettings, setLastSettings] = useState('')
  const [fixDraftIdx, setFixDraftIdx] = useState<number | null>(null)
  const [fixDrafts, setFixDrafts] = useState<Record<number, string>>({})

  const resolveWorldGroupId = useCallback((): number | null => {
    return project.enableMultiWorld ? activeGroupId : null
  }, [project.enableMultiWorld, activeGroupId])

  const handleCheck = useCallback(async () => {
    setChecked(false)
    setConflicts([])
    setOverview('')
    setFixDrafts({})
    setFixDraftIdx(null)
    try {
      const allSettings = await assembleCrossSettingContext({
        projectId: project.id!,
        worldGroupId: resolveWorldGroupId(),
      })
      setLastSettings(allSettings)
      if (!allSettings.trim()) {
        setOverview('当前没有已填写的设定，请先在各大面板中填写世界观、角色、力量体系等内容。')
        setChecked(true)
        return
      }
      const messages = buildSettingsAlignmentPrompt({
        projectName: project.name,
        allSettings,
      })
      const raw = await ai.start(messages, undefined, { category: 'settings.alignment', projectId: project.id! })
      if (!raw) {
        setOverview('AI 未返回结果，请重试。')
        setChecked(true)
        return
      }
      const result = parseAlignmentResult(raw)
      if (!result) {
        setOverview('AI 返回格式异常，请重试。')
        setChecked(true)
        return
      }
      setConflicts(result.conflicts)
      setOverview(result.overview)
      setChecked(true)
    } catch (err) {
      setOverview(`检测失败：${err instanceof Error ? err.message : '未知错误'}`)
      setChecked(true)
    }
  }, [project, ai, resolveWorldGroupId])

  const handleDraftFix = useCallback(async (idx: number, conflict: AlignmentConflict) => {
    if (!lastSettings.trim() || fixAi.isStreaming) return
    setFixDraftIdx(idx)
    try {
      const messages = buildAlignmentFixPrompt({ conflict, allSettings: lastSettings })
      const raw = await fixAi.start(messages, undefined, {
        category: 'settings.alignment.fix',
        projectId: project.id!,
      })
      if (raw) {
        setFixDrafts(prev => ({ ...prev, [idx]: raw }))
      }
    } catch (err) {
      setFixDrafts(prev => ({
        ...prev,
        [idx]: `起草失败：${err instanceof Error ? err.message : '未知错误'}`,
      }))
    }
  }, [lastSettings, fixAi, project.id])

  const countBySeverity = (sev: AlignmentSeverity) => conflicts.filter(c => c.severity === sev).length

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
          🔍 设定对齐检查
        </h2>
        <p className="text-sm text-text-muted mt-1">
          用 AI 扫描全部已有设定（世界观、力量体系、角色、故事核心等），找出互相矛盾的地方。
          {project.enableMultiWorld && (
            <span className="block mt-1 text-xs">多世界项目按当前激活世界装配设定上下文。</span>
          )}
        </p>
      </div>

      <button
        onClick={handleCheck}
        disabled={ai.isStreaming || fixAi.isStreaming}
        className="flex items-center gap-2 px-5 py-3 bg-accent text-white rounded-lg font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
      >
        {ai.isStreaming ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            AI 正在逐条对比设定...
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            开始检测
          </>
        )}
      </button>

      {ai.isStreaming && ai.output && (
        <div className="p-4 bg-bg-surface border border-border rounded-lg">
          <p className="text-xs text-text-muted mb-2">AI 正在分析...</p>
          <pre className="text-xs text-text-secondary whitespace-pre-wrap max-h-48 overflow-y-auto">{ai.output}</pre>
        </div>
      )}

      {ai.error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
          {ai.error}
        </div>
      )}

      {checked && !ai.isStreaming && (
        <>
          {overview && (
            <div className={`p-4 rounded-lg border ${
              conflicts.length === 0
                ? 'bg-green-500/10 border-green-500/30 text-green-400'
                : 'bg-accent/10 border-accent/30 text-text-primary'
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {conflicts.length === 0 ? (
                  <Check className="w-5 h-5 text-green-400" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                )}
                <span className="font-medium">
                  {conflicts.length === 0 ? '未发现矛盾' : `发现 ${conflicts.length} 处矛盾`}
                </span>
              </div>
              <p className="text-sm">{overview}</p>

              {conflicts.length > 0 && (
                <div className="flex items-center gap-4 mt-3 text-xs">
                  {(['critical', 'warning', 'info'] as AlignmentSeverity[]).map(sev => {
                    const count = countBySeverity(sev)
                    if (count === 0) return null
                    const cfg = SEVERITY_CONFIG[sev]
                    return (
                      <span key={sev} className={`flex items-center gap-1 ${cfg.color}`}>
                        <cfg.icon className="w-3.5 h-3.5" />
                        {cfg.label} ×{count}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="space-y-3">
              {conflicts.map((conflict, idx) => {
                const cfg = SEVERITY_CONFIG[conflict.severity]
                const expanded = expandedIdx === idx
                const drafting = fixAi.isStreaming && fixDraftIdx === idx
                const draft = fixDrafts[idx]
                return (
                  <div key={idx} className={`rounded-lg border ${cfg.bg} overflow-hidden`}>
                    <button
                      onClick={() => setExpandedIdx(expanded ? null : idx)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
                    >
                      <cfg.icon className={`w-4 h-4 shrink-0 ${cfg.color}`} />
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
                        <span className="text-sm text-text-secondary ml-2">
                          {conflict.domainA} ↔ {conflict.domainB}
                        </span>
                      </div>
                      {expanded ? <ChevronDown className="w-4 h-4 text-text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />}
                    </button>

                    {expanded && (
                      <div className="px-4 pb-4 space-y-3 border-t border-white/10 pt-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{conflict.domainA}</p>
                            <blockquote className="text-xs text-text-secondary bg-bg-base/50 rounded p-2 border border-border/50 italic">
                              &quot;{conflict.contentA}&quot;
                            </blockquote>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">{conflict.domainB}</p>
                            <blockquote className="text-xs text-text-secondary bg-bg-base/50 rounded p-2 border border-border/50 italic">
                              &quot;{conflict.contentB}&quot;
                            </blockquote>
                          </div>
                        </div>

                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">矛盾原因</p>
                          <p className="text-sm text-text-primary">{conflict.reason}</p>
                        </div>

                        {conflict.suggestion && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">修复建议</p>
                            <p className="text-sm text-accent">{conflict.suggestion}</p>
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDraftFix(idx, conflict)}
                            disabled={fixAi.isStreaming || !lastSettings.trim()}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-bg-surface text-text-secondary hover:text-accent hover:border-accent/50 disabled:opacity-50"
                          >
                            {drafting ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                正在起草修复稿...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3.5 h-3.5" />
                                起草修复稿
                              </>
                            )}
                          </button>
                          <span className="text-[10px] text-text-muted">仅生成建议文本，不会自动改写设定</span>
                        </div>

                        {drafting && fixAi.output && (
                          <pre className="text-xs text-text-secondary whitespace-pre-wrap max-h-40 overflow-y-auto bg-bg-base/50 rounded p-2 border border-border/50">
                            {fixAi.output}
                          </pre>
                        )}

                        {draft && !drafting && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">修复稿草稿</p>
                            <pre className="text-xs text-text-secondary whitespace-pre-wrap max-h-48 overflow-y-auto bg-bg-base/50 rounded p-2 border border-border/50">
                              {draft}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <button
            onClick={handleCheck}
            className="text-xs text-text-muted hover:text-accent transition-colors"
          >
            重新检测
          </button>
        </>
      )}
    </div>
  )
}
