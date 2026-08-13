/**
 * 故事进程年表 — Phase 25.5.2-a
 *
 * 下游提取产物：AI 从已写正文中提取剧情大事，按故事进程排列。
 * 与「历史年表（世界背景）」「故事线（结构）」严格区分。
 */
import { useState, useEffect, useMemo } from 'react'
import { CalendarClock, Sparkles, Loader2, Trash2, Plus, BookOpen, Flag, AlertTriangle, RotateCcw } from 'lucide-react'
import { useStoryTimelineStore } from '../../stores/story-timeline'
import { useChapterStore } from '../../stores/chapter'
import { useAIConfigStore } from '../../stores/ai-config'
import { resolveRequestConfig } from '../../lib/ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import { htmlToPlainText } from '../../lib/utils/html'
import { STORY_IMPORTANCE_LABELS } from '../../lib/types/story-timeline'
import type { Project } from '../../lib/types'
import { resolveScopeLike } from '../../lib/world-engine/scope'
import ExtractionReviewPanel from '../shared/ExtractionReviewPanel'
import {
  abandonStoryTimelineExtractionV1,
  adoptStoryTimelineExtractionCandidateV1,
  generateStoryTimelineExtractionCandidateV1,
  readPendingStoryTimelineExtractionCandidateV1,
  readRecoverableStoryTimelineExtractionV1,
  resumeStoryTimelineExtractionCandidateV1,
  type StoryTimelineExtractionCandidateItemV1,
} from '../../lib/agent/run/story-timeline-extraction-durable'
import {
  INITIAL_RECORD_TARGET_CLASS,
  initialRecordTargetAttributes,
  useInitialRecordTarget,
} from '../shared/initial-record-target'

interface Props {
  project: Project
  onOpenChapter?: (chapterId: number) => void
  initialEventId?: number | null
}

const IMPORTANCE_STYLE: Record<number, string> = {
  1: 'bg-bg-elevated text-text-muted',
  2: 'bg-blue-500/10 text-blue-400',
  3: 'bg-amber-500/15 text-amber-400',
}

export default function StoryTimelinePanel({ project, onOpenChapter, initialEventId }: Props) {
  const { events, loading, loadAll, addEvent, updateEvent, deleteEvent } = useStoryTimelineStore()
  const { chapters, loadAll: loadChapters } = useChapterStore()
  const aiConfig = useAIConfigStore(s => s.config)

  const [extracting, setExtracting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extractRunId, setExtractRunId] = useState<number | null>(null)
  const [candidateAction, setCandidateAction] = useState<'adopt' | 'abandon' | null>(null)
  const [recoverable, setRecoverable] = useState<{
    runId: number
    nextCallIndex: number
    totalCalls: number
    safeToResume: boolean
  } | null>(null)
  const [candidates, setCandidates] = useState<StoryTimelineExtractionCandidateItemV1[]>([])
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set())
  const [selectionFrozen, setSelectionFrozen] = useState(false)
  const [adoptionStarted, setAdoptionStarted] = useState(false)

  useEffect(() => {
    loadAll(project.id!)
    loadChapters(project.id!)
  }, [project.id, loadAll, loadChapters])

  useEffect(() => {
    let active = true
    setExtractRunId(null)
    setRecoverable(null)
    setCandidates([])
    setSelectedCandidates(new Set())
    setSelectionFrozen(false)
    setAdoptionStarted(false)
    void resolveScopeLike(project.id!).then(async scope => {
      const pending = await readPendingStoryTimelineExtractionCandidateV1({ scope })
      if (pending) return { pending, recoverable: null }
      return { pending: null, recoverable: await readRecoverableStoryTimelineExtractionV1({ scope }) }
    }).then(result => {
      if (!active) return
      if (result.pending) {
        setExtractRunId(result.pending.snapshot.run.id)
        setCandidates(result.pending.candidate.events)
        setSelectedCandidates(new Set(
          result.pending.selectedIndexes ?? result.pending.candidate.events.map((_, index) => index),
        ))
        setSelectionFrozen(result.pending.selectedIndexes != null)
        setAdoptionStarted(result.pending.adoptionStarted)
      } else if (result.recoverable) {
        setRecoverable({
          runId: result.recoverable.snapshot.run.id,
          nextCallIndex: result.recoverable.nextCallIndex,
          totalCalls: result.recoverable.totalCalls,
          safeToResume: result.recoverable.safeToResume,
        })
      }
    }).catch(recoveryError => {
      if (active) setError(recoveryError instanceof Error ? recoveryError.message : '故事年表提取运行恢复失败')
    })
    return () => { active = false }
  }, [project.id])

  // 按章节进程排序（章节顺序 = 故事进程），同章按 order
  const sorted = useMemo(() => {
    const chapterOrder = new Map<number, number>()
    chapters.forEach((c, i) => { if (c.id != null) chapterOrder.set(c.id, i) })
    return [...events].sort((a, b) => {
      const ca = a.chapterId != null ? (chapterOrder.get(a.chapterId) ?? 9999) : 9999
      const cb = b.chapterId != null ? (chapterOrder.get(b.chapterId) ?? 9999) : 9999
      if (ca !== cb) return ca - cb
      return a.order - b.order
    })
  }, [events, chapters])

  const writtenChapters = useMemo(
    () => chapters.filter(c => c.content && htmlToPlainText(c.content).trim().length > 50),
    [chapters],
  )
  useInitialRecordTarget(initialEventId, sorted.some(event => event.id === initialEventId))

  const handleExtract = async () => {
    const effectiveConfig = resolveRequestConfig(aiConfig, { category: 'story.timeline' }).config
    if (!isAIConfigReady(effectiveConfig)) { setError(getAIConfigRequiredMessage(effectiveConfig)); return }
    if (writtenChapters.length === 0) { setError('还没有已写正文的章节，先去写作再提取'); return }
    setExtracting(true)
    setError(null)
    setExtractRunId(null)
    setCandidates([])
    setSelectedCandidates(new Set())
    setSelectionFrozen(false)
    try {
      const generated = await generateStoryTimelineExtractionCandidateV1({
        scope: await resolveScopeLike(project.id!), aiConfig,
      })
      setExtractRunId(generated.snapshot.run.id)
      setRecoverable(null)
      setCandidates(generated.candidate.events)
      setSelectedCandidates(new Set(generated.candidate.events.map((_, index) => index)))
      setSelectionFrozen(false)
      setAdoptionStarted(false)
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : '故事年表提取失败')
      try {
        const recovery = await readRecoverableStoryTimelineExtractionV1({ scope: await resolveScopeLike(project.id!) })
        setRecoverable(recovery ? {
          runId: recovery.snapshot.run.id,
          nextCallIndex: recovery.nextCallIndex,
          totalCalls: recovery.totalCalls,
          safeToResume: recovery.safeToResume,
        } : null)
      } catch { /* Preserve the original extraction failure. */ }
    } finally {
      setExtracting(false)
    }
  }

  const handleResumeExtraction = async () => {
    if (!recoverable?.safeToResume) return
    const effectiveConfig = resolveRequestConfig(aiConfig, { category: 'story.timeline' }).config
    if (!isAIConfigReady(effectiveConfig)) { setError(getAIConfigRequiredMessage(effectiveConfig)); return }
    setExtracting(true)
    setError(null)
    try {
      const generated = await resumeStoryTimelineExtractionCandidateV1({
        scope: await resolveScopeLike(project.id!), runId: recoverable.runId, aiConfig,
      })
      setExtractRunId(generated.snapshot.run.id)
      setRecoverable(null)
      setCandidates(generated.candidate.events)
      setSelectedCandidates(new Set(generated.candidate.events.map((_, index) => index)))
      setSelectionFrozen(false)
      setAdoptionStarted(false)
    } catch (resumeError) {
      setError(resumeError instanceof Error ? resumeError.message : '继续故事年表提取失败')
      try {
        const recovery = await readRecoverableStoryTimelineExtractionV1({ scope: await resolveScopeLike(project.id!) })
        setRecoverable(recovery ? {
          runId: recovery.snapshot.run.id,
          nextCallIndex: recovery.nextCallIndex,
          totalCalls: recovery.totalCalls,
          safeToResume: recovery.safeToResume,
        } : null)
      } catch { /* Preserve the original resume failure. */ }
    } finally {
      setExtracting(false)
    }
  }

  const handleAdoptCandidates = async () => {
    if (extractRunId == null || candidateAction) return
    setCandidateAction('adopt')
    setError(null)
    try {
      const scope = await resolveScopeLike(project.id!)
      await adoptStoryTimelineExtractionCandidateV1({
        scope, runId: extractRunId, selectedIndexes: [...selectedCandidates],
        onDurableBoundary: boundary => {
          if (boundary === 'intent.checkpoint') setSelectionFrozen(true)
          if (boundary === 'confirmation.recorded') setAdoptionStarted(true)
        },
      })
      await loadAll(scope)
      setCandidates([])
      setSelectedCandidates(new Set())
      setSelectionFrozen(false)
      setExtractRunId(null)
      setAdoptionStarted(false)
    } catch (adoptError) {
      setError(adoptError instanceof Error ? adoptError.message : '故事年表采纳与终验失败')
    } finally {
      setCandidateAction(null)
    }
  }

  const handleAbandonExtraction = async () => {
    const runId = extractRunId ?? recoverable?.runId
    if (candidateAction || adoptionStarted) return
    if (runId == null) {
      setCandidates([])
      setSelectedCandidates(new Set())
      setSelectionFrozen(false)
      setError(null)
      return
    }
    setCandidateAction('abandon')
    setError(null)
    try {
      await abandonStoryTimelineExtractionV1({ scope: await resolveScopeLike(project.id!), runId })
      setCandidates([])
      setSelectedCandidates(new Set())
      setSelectionFrozen(false)
      setExtractRunId(null)
      setRecoverable(null)
      setAdoptionStarted(false)
    } catch (abandonError) {
      setError(abandonError instanceof Error ? abandonError.message : '放弃故事年表提取运行失败')
    } finally {
      setCandidateAction(null)
    }
  }

  const handleManualAdd = async () => {
    await addEvent({
      projectId: project.id!,
      title: '新事件',
      importance: 2,
      order: events.length,
    })
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="pb-4 border-b border-border/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
              <CalendarClock className="w-5 h-5" /> 故事进程年表
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              AI 从已写正文中提取剧情大事，按故事进程排列。区别于「历史年表」（世界背景）和「故事线」（结构）。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={handleManualAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-bg-elevated text-text-secondary border border-border hover:text-text-primary transition-colors">
              <Plus className="w-3.5 h-3.5" /> 手动添加
            </button>
            <button onClick={handleExtract}
              disabled={extracting || candidateAction != null || extractRunId != null || recoverable != null}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 transition-colors">
              {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {extracting ? '正在分析正文…' : '从正文提取年表'}
            </button>
          </div>
        </div>
      </div>

      {error && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">{error}</div>}

      {recoverable && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <div className="flex items-start gap-2 text-sm text-text-primary">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div>
              <div className="font-medium">
                {recoverable.safeToResume ? '发现未完成的故事年表提取' : '上次调用的模型结果无法判定'}
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                {recoverable.safeToResume
                  ? `已完成 ${recoverable.nextCallIndex}/${recoverable.totalCalls} 个分块；继续时不会重复调用已完成分块。`
                  : '为防止重复计费或重复候选，不会自动重试；请放弃这次运行后重新提取。'}
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={handleAbandonExtraction} disabled={extracting || candidateAction != null}
              className="px-3 py-1.5 text-xs text-text-muted hover:text-text-primary disabled:opacity-40">
              {candidateAction === 'abandon' ? '正在放弃…' : '放弃这次运行'}
            </button>
            {recoverable.safeToResume && (
              <button onClick={handleResumeExtraction} disabled={extracting || candidateAction != null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-40">
                {extracting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                继续提取
              </button>
            )}
          </div>
        </div>
      )}

      {(extracting || extractRunId != null || candidates.length > 0) && (
        <ExtractionReviewPanel
          title="故事年表候选"
          items={candidates}
          selected={selectedCandidates}
          loading={extracting}
          busy={candidateAction != null}
          selectionLocked={selectionFrozen}
          closeDisabled={adoptionStarted}
          allowEmptyConfirm={extractRunId != null}
          confirmLabel={adoptionStarted ? '继续完成冻结采纳' : `确认替换已写章节（${selectedCandidates.size} 条）`}
          error={error}
          onToggle={index => {
            if (selectionFrozen) return
            setSelectedCandidates(previous => {
              const next = new Set(previous)
              if (next.has(index)) next.delete(index)
              else next.add(index)
              return next
            })
          }}
          onConfirm={handleAdoptCandidates}
          onClose={handleAbandonExtraction}
          renderItem={item => (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium text-text-primary">{item.title}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${IMPORTANCE_STYLE[item.importance]}`}>
                  {STORY_IMPORTANCE_LABELS[item.importance]}
                </span>
              </div>
              <div className="text-[11px] text-text-muted">
                {item.chapterTitle}{item.storyTime ? ` · ${item.storyTime}` : ''}
              </div>
              {item.description && <p className="text-xs text-text-secondary">{item.description}</p>}
            </div>
          )}
        />
      )}

      {loading ? (
        <div className="text-text-muted text-sm py-8 text-center">加载中...</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <CalendarClock className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">还没有故事年表</p>
          <p className="text-xs mt-1">写完一些章节后，点「从正文提取年表」让 AI 自动梳理剧情大事</p>
        </div>
      ) : (
        <div className="relative pl-6 border-l border-border/80 space-y-3 ml-2">
          {sorted.map(e => (
            <div
              key={e.id}
              {...initialRecordTargetAttributes(e.id === initialEventId, e.id)}
              className={`relative group rounded-lg ${e.id === initialEventId ? INITIAL_RECORD_TARGET_CLASS : ''}`}
            >
              <span className={`absolute -left-[31px] top-2 w-2.5 h-2.5 rounded-full border-2 bg-bg-base ${
                e.importance === 3 ? 'border-amber-500 ring-4 ring-amber-500/10'
                  : e.importance === 2 ? 'border-blue-500 ring-4 ring-blue-500/10'
                  : 'border-text-muted'
              }`} />
              <div className="bg-bg-surface border border-border rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  {e.storyTime && <span className="text-xs font-mono text-text-secondary">{e.storyTime}</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${IMPORTANCE_STYLE[e.importance]}`}>
                    {STORY_IMPORTANCE_LABELS[e.importance]}
                  </span>
                  {e.chapterTitle && (
                    <button
                      onClick={() => e.chapterId != null && onOpenChapter?.(e.chapterId)}
                      disabled={e.chapterId == null || !onOpenChapter}
                      className="inline-flex items-center gap-1 text-[10px] text-accent hover:underline disabled:text-text-muted disabled:no-underline"
                      title="跳转到关联章节"
                    >
                      <BookOpen className="w-3 h-3" /> {e.chapterTitle}
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <select
                      value={e.importance}
                      onChange={ev => updateEvent(e.id!, { importance: Number(ev.target.value) })}
                      className="bg-bg-base border border-border rounded text-[10px] px-1 py-0.5 text-text-secondary"
                    >
                      <option value={1}>次要</option>
                      <option value={2}>重要</option>
                      <option value={3}>关键</option>
                    </select>
                    <button onClick={() => deleteEvent(e.id!)} className="p-0.5 text-text-muted hover:text-red-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  {e.importance === 3 && <Flag className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />}
                <input
                  value={e.title}
                  onChange={ev => updateEvent(e.id!, { title: ev.target.value })}
                  className="w-full bg-transparent text-sm font-medium text-text-primary outline-none"
                />
                </div>
                {e.description && <p className="text-xs text-text-muted mt-0.5">{e.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
