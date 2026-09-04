import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Check, GitBranch, Loader2, Sparkles, Trash2, X } from 'lucide-react'
import type { Project } from '../../lib/types'
import { cultivationStageTiers, parseCultivationStages } from '../../lib/types'
import { resolveCanonicalChapterSequence } from '../../lib/ai/chapter-memory/canonical-chapter-sequence'
import {
  abandonCultivationProgressExtractionRunV1,
  adoptCultivationProgressExtractionCandidateV1,
  generateCultivationProgressExtractionCandidateV1,
  readPendingCultivationProgressExtractionCandidateV1,
  readRecoverableCultivationProgressExtractionRunV1,
  rejectCultivationProgressExtractionCandidateV1,
  type CultivationProgressExtractionCandidateV1,
} from '../../lib/agent/run/cultivation-progress-extraction-durable'
import { htmlToPlainText } from '../../lib/utils/html'
import { resolveRequestConfig } from '../../lib/ai/client'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import { resolveScopeLike } from '../../lib/workspace/scope'
import { useAIConfigStore } from '../../stores/ai-config'
import { useChapterStore } from '../../stores/chapter'
import { useCharacterStore } from '../../stores/character'
import { useCultivationStore } from '../../stores/cultivation'
import { useCultivationProgressStore } from '../../stores/cultivation-progress'
import { useOutlineStore } from '../../stores/outline'
import { useProjectStore } from '../../stores/project'
import { useDialog } from '../shared/Dialog'
import { useActiveWork } from '../../hooks/useActiveWork'

const TRANSITION_LABELS = {
  enter: '首次确认',
  advance: '突破',
  regress: '倒退',
  switch: '改道',
} as const

export default function CultivationProgressPanel({ project }: { project: Project }) {
  const dialog = useDialog()
  const aiConfig = useAIConfigStore(state => state.config)
  const chapters = useChapterStore(state => state.chapters)
  const loadChapters = useChapterStore(state => state.loadAll)
  const outlineNodes = useOutlineStore(state => state.nodes)
  const loadOutline = useOutlineStore(state => state.loadAll)
  const characters = useCharacterStore(state => state.characters)
  const loadCharacters = useCharacterStore(state => state.loadAll)
  const systems = useCultivationStore(state => state.systems)
  const loadSystems = useCultivationStore(state => state.loadAll)
  const { events, loadAll: loadEvents, deleteEvent } = useCultivationProgressStore()
  const updateActiveWork = useProjectStore(state => state.updateActiveWork)
  const activeWork = useActiveWork(project)

  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(null)
  const [selectedCharacterId, setSelectedCharacterId] = useState<number | null>(null)
  const [extractCandidate, setExtractCandidate] = useState<CultivationProgressExtractionCandidateV1 | null>(null)
  const [extractRunId, setExtractRunId] = useState<number | null>(null)
  const [selectedCandidates, setSelectedCandidates] = useState<Set<number>>(new Set())
  const [selectionFrozen, setSelectionFrozen] = useState(false)
  const [resumeAdoption, setResumeAdoption] = useState(false)
  const [unsafeRunId, setUnsafeRunId] = useState<number | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!project.id) return
    loadChapters(project.id)
    loadOutline(project.id)
    loadCharacters(project.id)
    loadSystems(project.id)
    loadEvents(project.id)
  }, [loadChapters, loadCharacters, loadEvents, loadOutline, loadSystems, project.id])

  useEffect(() => {
    if (!project.id) return
    let cancelled = false
    setExtractCandidate(null)
    setExtractRunId(null)
    setSelectedCandidates(new Set())
    setSelectionFrozen(false)
    setResumeAdoption(false)
    setUnsafeRunId(null)
    void (async () => {
      const scope = await resolveScopeLike(project.id!)
      const pending = await readPendingCultivationProgressExtractionCandidateV1({ scope })
      if (cancelled) return
      if (pending) {
        setExtractCandidate(pending.candidate)
        setExtractRunId(pending.snapshot.run.id)
        setSelectedChapterId(pending.candidate.chapterId)
        setSelectedCandidates(new Set(pending.candidate.events.map((_, index) => index)))
        setMessage(`已恢复 ${pending.candidate.events.length} 条待确认修炼候选；没有重复调用模型。`)
        return
      }
      const recoverable = await readRecoverableCultivationProgressExtractionRunV1({ scope })
      if (cancelled || !recoverable) return
      if (recoverable.safeToResume && recoverable.candidate && recoverable.adoptionPending) {
        setExtractCandidate(recoverable.candidate)
        setExtractRunId(recoverable.snapshot.run.id)
        setSelectedChapterId(recoverable.candidate.chapterId)
        setSelectedCandidates(new Set(recoverable.selectedIndexes ?? []))
        setSelectionFrozen(true)
        setResumeAdoption(true)
        setMessage('上次选择已冻结但尚未完成写入；继续确认会沿原运行幂等收敛，不会重复调用模型。')
      } else if (!recoverable.safeToResume) {
        setUnsafeRunId(recoverable.snapshot.run.id)
        setMessage('上次分析停在模型结果不可判定窗口，系统不会自动重试。请先放弃旧运行。')
      }
    })().catch(error => {
      if (!cancelled) setMessage(error instanceof Error ? error.message : String(error))
    })
    return () => { cancelled = true }
  }, [project.id, project.activeWorldId, project.activeWorkId])

  const sequence = useMemo(
    () => resolveCanonicalChapterSequence(outlineNodes, chapters).sequence,
    [chapters, outlineNodes],
  )
  const chapterOrder = useMemo(() => {
    const result = new Map<number, number>()
    sequence.forEach((entry, index) => {
      if (entry.chapter.id != null) result.set(entry.chapter.id, index)
    })
    return result
  }, [sequence])
  const writtenChapters = useMemo(() => sequence
    .map(entry => entry.chapter)
    .filter(chapter => chapter.id != null && htmlToPlainText(chapter.content || '').trim().length >= 20),
  [sequence])
  const trackableCharacters = useMemo(() => characters
    .filter(character => character.id != null && character.cultivationSystemId != null)
    .sort((left, right) => {
      if (left.roleWeight === 'main' && right.roleWeight !== 'main') return -1
      if (left.roleWeight !== 'main' && right.roleWeight === 'main') return 1
      return left.name.localeCompare(right.name, 'zh-CN')
    }),
  [characters])

  useEffect(() => {
    if (selectedChapterId == null && writtenChapters[0]?.id != null) {
      setSelectedChapterId(writtenChapters[0].id)
    }
  }, [selectedChapterId, writtenChapters])
  useEffect(() => {
    if (
      selectedCharacterId == null
      || !trackableCharacters.some(character => character.id === selectedCharacterId)
    ) {
      setSelectedCharacterId(trackableCharacters[0]?.id ?? null)
    }
  }, [selectedCharacterId, trackableCharacters])

  const selectedCharacter = trackableCharacters.find(character => character.id === selectedCharacterId)
  const selectedSystem = systems.find(system => system.id === selectedCharacter?.cultivationSystemId)
  const selectedStages = parseCultivationStages(selectedSystem?.stages)
  const tiers = cultivationStageTiers(selectedStages)
  const selectedEvents = events
    .filter(event => event.characterId === selectedCharacterId)
    .sort((left, right) => {
      const leftOrder = left.sourceChapterId == null
        ? Number.MAX_SAFE_INTEGER
        : chapterOrder.get(left.sourceChapterId) ?? Number.MAX_SAFE_INTEGER
      const rightOrder = right.sourceChapterId == null
        ? Number.MAX_SAFE_INTEGER
        : chapterOrder.get(right.sourceChapterId) ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || left.sourceOffset - right.sourceOffset
    })
  const confirmed = selectedEvents.filter(event => event.status === 'confirmed')
  const current = confirmed[confirmed.length - 1]
  const visited = new Set(confirmed.map(event => event.stageId).filter((id): id is string => Boolean(id)))

  const analyze = async () => {
    const chapter = chapters.find(row => row.id === selectedChapterId)
    if (!chapter || !project.id || extractCandidate || unsafeRunId != null) return
    const effective = resolveRequestConfig(aiConfig, { category: 'cultivation.progress' }).config
    if (!isAIConfigReady(effective)) {
      setMessage(getAIConfigRequiredMessage(effective))
      return
    }
    const outline = outlineNodes.find(node => node.id === chapter.outlineNodeId)
    const worldGroupId = outline?.worldGroupId ?? null
    setAnalyzing(true)
    setMessage('')
    try {
      const scope = await resolveScopeLike(project.id)
      const generated = await generateCultivationProgressExtractionCandidateV1({
        scope,
        chapterId: chapter.id!,
        worldGroupId,
        aiConfig,
      })
      setExtractCandidate(generated.candidate)
      setExtractRunId(generated.snapshot.run.id)
      setSelectedCandidates(new Set(generated.candidate.events.map((_, index) => index)))
      setSelectionFrozen(false)
      setResumeAdoption(false)
      setMessage(generated.candidate.events.length
        ? `发现 ${generated.candidate.events.length} 条严格证据候选；可取消不采纳项后批次确认。`
        : '没有发现可可靠确认的境界变化；确认空批次即可留下完整审计回执。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '分析失败')
      const scope = await resolveScopeLike(project.id)
      const pending = await readPendingCultivationProgressExtractionCandidateV1({ scope }).catch(() => null)
      if (pending) {
        setExtractCandidate(pending.candidate)
        setExtractRunId(pending.snapshot.run.id)
        setSelectedCandidates(new Set(pending.candidate.events.map((_, index) => index)))
        setMessage(`已恢复 ${pending.candidate.events.length} 条待确认修炼候选；没有重复调用模型。`)
      } else {
        const recoverable = await readRecoverableCultivationProgressExtractionRunV1({ scope }).catch(() => null)
        if (recoverable?.safeToResume && recoverable.candidate && recoverable.adoptionPending) {
          setExtractCandidate(recoverable.candidate)
          setExtractRunId(recoverable.snapshot.run.id)
          setSelectedCandidates(new Set(recoverable.selectedIndexes ?? []))
          setSelectionFrozen(true)
          setResumeAdoption(true)
        } else if (recoverable && !recoverable.safeToResume) {
          setUnsafeRunId(recoverable.snapshot.run.id)
        }
      }
    } finally {
      setAnalyzing(false)
    }
  }

  const accept = async () => {
    if (!project.id || extractRunId == null || !extractCandidate) return
    setAnalyzing(true)
    setMessage('')
    try {
      const scope = await resolveScopeLike(project.id)
      const result = await adoptCultivationProgressExtractionCandidateV1({
        scope,
        runId: extractRunId,
        ...(resumeAdoption ? {} : { selectedIndexes: [...selectedCandidates] }),
      })
      await loadEvents(project.id)
      const firstSelected = [...selectedCandidates][0]
      if (firstSelected != null) setSelectedCharacterId(extractCandidate.events[firstSelected]?.characterId ?? null)
      setExtractCandidate(null)
      setExtractRunId(null)
      setSelectedCandidates(new Set())
      setSelectionFrozen(false)
      setResumeAdoption(false)
      setMessage(`已原子写入 ${result.written} 条修炼历程并完成终验。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '确认失败')
      const scope = await resolveScopeLike(project.id)
      const recoverable = await readRecoverableCultivationProgressExtractionRunV1({ scope }).catch(() => null)
      if (recoverable?.safeToResume && recoverable.candidate && recoverable.adoptionPending) {
        setExtractCandidate(recoverable.candidate)
        setExtractRunId(recoverable.snapshot.run.id)
        setSelectedCandidates(new Set(recoverable.selectedIndexes ?? []))
        setSelectionFrozen(true)
        setResumeAdoption(true)
      }
    } finally {
      setAnalyzing(false)
    }
  }

  const reject = async () => {
    if (!project.id || extractRunId == null || !extractCandidate || selectionFrozen) return
    setAnalyzing(true)
    try {
      const scope = await resolveScopeLike(project.id)
      await rejectCultivationProgressExtractionCandidateV1({ scope, runId: extractRunId })
      setExtractCandidate(null)
      setExtractRunId(null)
      setSelectedCandidates(new Set())
      setMessage('已拒绝本批候选；正式修炼历程没有写入。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '拒绝失败')
    } finally {
      setAnalyzing(false)
    }
  }

  const abandonUnsafe = async () => {
    if (!project.id || unsafeRunId == null || analyzing) return
    setAnalyzing(true)
    try {
      const scope = await resolveScopeLike(project.id)
      await abandonCultivationProgressExtractionRunV1({ scope, runId: unsafeRunId })
      setUnsafeRunId(null)
      setMessage('已放弃结果不可判定的旧运行，可以重新分析。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '放弃失败')
    } finally {
      setAnalyzing(false)
    }
  }

  const removeEvent = async (id: number) => {
    if (!await dialog.confirm({
      title: '删除这条已确认修炼事件？',
      message: '删除后当前境界和实际路径会按剩余事件重新投影。',
      confirmText: '删除',
      tone: 'danger',
    })) return
    await deleteEvent(id)
    await loadEvents(project.id!)
  }

  return (
    <div className="max-w-5xl space-y-5">
      <header className="flex items-start justify-between gap-4 border-b border-border/40 pb-4">
        <div>
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <GitBranch className="w-5 h-5" /> 修炼进度
          </h2>
          <p className="text-xs text-text-muted mt-1">
            这里是正文确认后的下游历程；角色卡“当前设定境界”仍是上游预设，两者不会互相冒充。
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary border border-border rounded-lg px-3 py-2">
          <input
            type="checkbox"
            checked={Boolean(activeWork?.includeCultivationProgressInAI)}
            onChange={event => updateActiveWork(project.id!, {
              includeCultivationProgressInAI: event.target.checked,
            })}
          />
          反哺后续写作（默认关闭）
        </label>
      </header>

      <section className="rounded-xl border border-border bg-bg-surface p-4 space-y-3">
        <div className="flex items-end gap-3">
          <label className="flex-1">
            <span className="block text-xs text-text-muted mb-1">选择已写章节</span>
            <select
              aria-label="修炼进度来源章节"
              value={selectedChapterId ?? ''}
              onChange={event => {
                setSelectedChapterId(event.target.value ? Number(event.target.value) : null)
                setMessage('')
              }}
              disabled={extractCandidate != null || unsafeRunId != null}
              className="w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-sm text-text-primary"
            >
              {writtenChapters.length === 0 && <option value="">暂无已写章节</option>}
              {writtenChapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
            </select>
          </label>
          <button
            onClick={analyze}
            disabled={analyzing || selectedChapterId == null || extractCandidate != null || unsafeRunId != null}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-sm disabled:opacity-40"
          >
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {analyzing ? '分析中' : '分析本章'}
          </button>
        </div>
        {message && <p className="text-xs text-text-secondary">{message}</p>}
        {unsafeRunId != null && (
          <button
            onClick={abandonUnsafe}
            disabled={analyzing}
            className="text-xs px-3 py-1.5 rounded border border-error/40 text-error disabled:opacity-40"
          >
            放弃不可判定运行
          </button>
        )}
        {extractCandidate && (
          <div className="space-y-2 pt-2">
            {extractCandidate.events.map((candidate, index) => {
              const character = characters.find(row => row.id === candidate.characterId)
              const system = systems.find(row => row.id === candidate.cultivationSystemId)
              const stage = parseCultivationStages(system?.stages).find(row => row.id === candidate.stageId)
              const key = `${candidate.characterId}:${candidate.cultivationSystemId}:${candidate.stageId}:${candidate.sourceOffset}`
              return (
                <article
                  key={key}
                  className={`border rounded-lg p-3 ${selectedCandidates.has(index)
                    ? 'border-accent/25 bg-accent/5'
                    : 'border-border bg-bg-base/40 opacity-60'}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`选择修炼候选 ${index + 1}`}
                      checked={selectedCandidates.has(index)}
                      disabled={selectionFrozen || analyzing}
                      onChange={event => setSelectedCandidates(current => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(index)
                        else next.delete(index)
                        return next
                      })}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary">
                        {character?.name} · {system?.name} → {stage?.name}
                      </p>
                      {candidate.trigger && <p className="text-xs text-text-muted mt-1">{candidate.trigger}</p>}
                      <blockquote className="text-xs text-text-secondary mt-2 border-l-2 border-accent/40 pl-2">
                        {candidate.evidenceQuote}
                      </blockquote>
                    </div>
                  </div>
                </article>
              )
            })}
            <div className="flex justify-end gap-2 pt-1">
              {!selectionFrozen && (
                <button
                  aria-label="拒绝修炼候选批次"
                  onClick={reject}
                  disabled={analyzing}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded border border-border text-xs text-text-secondary disabled:opacity-40"
                >
                  <X className="w-3.5 h-3.5" /> 拒绝整批
                </button>
              )}
              <button
                aria-label="确认所选修炼候选"
                onClick={accept}
                disabled={analyzing || (extractCandidate.events.length > 0 && selectedCandidates.size === 0)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-accent text-white text-xs disabled:opacity-40"
              >
                {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {resumeAdoption ? '继续已冻结写入' : extractCandidate.events.length ? `确认所选 ${selectedCandidates.size} 条` : '确认空批次'}
              </button>
            </div>
          </div>
        )}
      </section>

      {trackableCharacters.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl py-12 text-center text-sm text-text-muted">
          还没有关联主修体系的角色。请先到“角色生成”设置主修体系。
        </div>
      ) : (
        <>
          <div className="flex gap-2 flex-wrap">
            {trackableCharacters.map(character => (
              <button
                key={character.id}
                onClick={() => setSelectedCharacterId(character.id!)}
                className={`px-3 py-1.5 rounded-full border text-xs ${
                  character.id === selectedCharacterId
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border text-text-secondary'
                }`}
              >
                {character.name}{character.roleWeight === 'main' ? ' · 主要' : ''}
              </button>
            ))}
          </div>

          <section className="rounded-xl border border-border bg-bg-surface p-4">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-xs text-text-muted">{selectedSystem?.name ?? '未关联体系'}</p>
                <h3 className="text-lg font-semibold text-text-primary">
                  {current ? `正文当前：${current.stageName}` : '正文尚无已确认境界'}
                </h3>
              </div>
              {selectedCharacter?.cultivationStageId && (
                <span className="text-[10px] text-text-muted">
                  角色卡设定：{selectedStages.find(stage => stage.id === selectedCharacter.cultivationStageId)?.name ?? '已失效'}
                </span>
              )}
            </div>

            {selectedStages.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-border bg-bg-base/40 p-3 mb-5">
                <div className="flex gap-4 min-w-max">
                  {Array.from({ length: Math.max(...tiers.values(), 0) + 1 }, (_, tier) => (
                    <div key={tier} className="w-36 space-y-2">
                      <p className="text-[10px] text-text-muted text-center">层级 {tier}</p>
                      {selectedStages.filter(stage => (tiers.get(stage.id) ?? 0) === tier).map(stage => (
                        <div
                          key={stage.id}
                          className={`rounded-lg border px-2 py-2 text-xs ${
                            current?.stageId === stage.id
                              ? 'border-accent bg-accent/15 text-accent'
                              : visited.has(stage.id)
                                ? 'border-green-500/40 bg-green-500/10 text-green-400'
                                : 'border-border text-text-muted'
                          }`}
                        >
                          {stage.name}
                          {stage.parentStageIds.length > 0 && (
                            <span className="block text-[9px] opacity-70 mt-1">
                              ← {stage.parentStageIds.map(id =>
                                selectedStages.find(row => row.id === id)?.name ?? id).join(' + ')}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedEvents.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-6">暂无作者确认的正文修炼事件</p>
            ) : (
              <div className="space-y-2 border-l border-border ml-2 pl-4">
                {selectedEvents.map(event => (
                  <article key={event.id} className="relative border border-border rounded-lg px-3 py-2">
                    <span className="absolute -left-[21px] top-3 w-2.5 h-2.5 rounded-full bg-accent border-2 border-bg-base" />
                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        <p className="text-sm text-text-primary">
                          {event.stageName}
                          <span className="ml-2 text-[10px] text-accent">{TRANSITION_LABELS[event.transition]}</span>
                          {event.status !== 'confirmed' && (
                            <span className="ml-2 text-[10px] text-error">{event.status}</span>
                          )}
                        </p>
                        <p className="text-[10px] text-text-muted flex items-center gap-1 mt-1">
                          <BookOpen className="w-3 h-3" /> {event.sourceChapterTitle}
                        </p>
                        <blockquote className="text-xs text-text-secondary mt-1">{event.sourceQuote}</blockquote>
                      </div>
                      {event.id != null && (
                        <button
                          aria-label="删除修炼事件"
                          onClick={() => removeEvent(event.id!)}
                          className="p-1 text-text-muted hover:text-error"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
