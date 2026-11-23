import { htmlToPlainText } from '../../lib/utils/html'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BookOpenText, Check, ChevronRight, Download, FileJson, FileText, Lock, RefreshCw, Sparkles, X } from 'lucide-react'
import type {
  CreationReleaseV1,
  Project,
  ShortNovelBriefV1,
  ShortNovelChapterPlanV1,
  ShortNovelProductionV1,
  ShortNovelReviewV1,
  ShortNovelStoryDesignV1,
  WorkspaceScope,
} from '../../lib/types'
import type { ShortNovelArtifactKindV1 } from '../../lib/short-novel/prompts'
import {
  adoptShortNovelChapterPlanV1,
  adoptShortNovelReviewV1,
  buildShortNovelManuscriptSnapshotV1,
  confirmShortNovelBriefV1,
  confirmShortNovelStoryDesignV1,
  ensureShortNovelProductionV1,
  inspectShortNovelCompletionV1,
  listShortNovelReleasesV1,
  publishShortNovelReleaseV1,
  readShortNovelReleaseManifestV1,
  renderShortNovelReleaseJsonV1,
  renderShortNovelReleaseMarkdownV1,
  renderShortNovelReleaseTextV1,
  reopenShortNovelProductionV1,
  resolveShortNovelReviewIssueV1,
  type ShortNovelCompletionReportV1,
  type ShortNovelManuscriptSnapshotV1,
} from '../../lib/short-novel/service'
import {
  adoptShortNovelCandidateV1,
  generateShortNovelCandidateV1,
  readPendingShortNovelCandidateV1,
  rejectShortNovelCandidateV1,
} from '../../lib/agent/run/short-novel-durable'
import { isAIConfigReady, getAIConfigRequiredMessage } from '../../lib/ai/config-readiness'
import { useAIConfigStore } from '../../stores/ai-config'
import ShortNovelFields from './ShortNovelFields'
import { readShortAuthorDraft, saveShortAuthorDraft } from '../../lib/short-novel/author-drafts'
import { queueCandidateDraftV1, flushCandidateDraftsV1 } from '../../lib/agent/candidate-draft-coordinator'
import { registerPendingDraftFlusherV1, flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { listShortNovelTasksV1, closeShortNovelTaskV1, resumeShortNovelAdoptionV1 } from '../../lib/agent/run/short-novel-durable'
import ShortNovelShowcase from './ShortNovelShowcase'
import './short-novel-studio.css'

const OutlinePanel = lazy(() => import('../outline/OutlinePanel'))
const ChaptersListPanel = lazy(() => import('../editor/ChaptersListPanel'))

interface Props { project: Project; scope: WorkspaceScope; activeStage?: Stage; onStageChange?: (stage:Stage)=>void; structured?: boolean }
export type Stage = 'brief' | 'design' | 'plan' | 'draft' | 'review' | 'release'

const STAGES: Array<{ id: Stage; label: string; note: string }> = [
  { id: 'brief', label: '创作意图', note: '核心变化与承诺' },
  { id: 'design', label: '故事设计', note: '压力、转折与余韵' },
  { id: 'plan', label: '章节卡', note: '目标、冲突与字数' },
  { id: 'draft', label: '正文', note: '逐章生成与编辑' },
  { id: 'review', label: '全篇审校', note: '证据化问题与修订' },
  { id: 'release', label: '发布', note: '冻结版本与导出' },
]

const PHASE_STAGE: Record<ShortNovelProductionV1['phase'], Stage> = {
  intent: 'brief', design: 'design', planning: 'plan', drafting: 'draft', review: 'review', 'release-ready': 'release', complete: 'release',
}

function download(filename: string, content: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeName(value: string): string { return value.replace(/[\\/:*?"<>|]/g, '_').trim() || '短篇小说' }

function briefDraft(snapshot: ShortNovelManuscriptSnapshotV1): ShortNovelBriefV1 {
  return {
    version: 1,
    premise: snapshot.work.description || '',
    coreChange: '',
    dominantEmotion: '',
    pointOfView: 'third-limited',
    tense: 'past',
    audience: '中文类型小说读者',
    storyPromise: '',
    mustKeep: [], forbidden: [],
    targetWordCount: snapshot.work.targetWordCount,
    chapterCount: snapshot.chapters.length,
  }
}

function designDraft(): ShortNovelStoryDesignV1 {
  return { version: 1, protagonist: '', desire: '', pressure: '', escalation: [], irreversibleTurn: '', climaxChoice: '', endingImage: '', aftertaste: '', thematicQuestion: '' }
}

function planDraft(snapshot: ShortNovelManuscriptSnapshotV1): ShortNovelChapterPlanV1[] {
  const base = Math.floor(snapshot.work.targetWordCount / Math.max(1, snapshot.chapters.length))
  const valueAfter = (summary: string, label: string) => summary.split('\n').find(line => line.startsWith(`${label}：`))?.slice(label.length + 1).trim() ?? ''
  return snapshot.chapters.map((chapter, index) => {
    const saved = {
      purpose: valueAfter(chapter.summary, '目标'),
      openingPressure: valueAfter(chapter.summary, '开场压力'),
      conflict: valueAfter(chapter.summary, '冲突'),
      turn: valueAfter(chapter.summary, '转折'),
      exitState: valueAfter(chapter.summary, '离场状态'),
      viewpoint: valueAfter(chapter.summary, '视角'),
      targetWordCount: Number(valueAfter(chapter.summary, '字数预算')),
    }
    if (saved.purpose && saved.openingPressure && saved.conflict && saved.turn && saved.exitState && saved.viewpoint && Number.isInteger(saved.targetWordCount) && saved.targetWordCount >= 500) {
      return { stableKey: chapter.stableKey, order: index, title: chapter.title, ...saved }
    }
    return { stableKey: chapter.stableKey, order: index, title: chapter.title, purpose: '', viewpoint: '', openingPressure: '', conflict: '', turn: '', exitState: '', targetWordCount: index === snapshot.chapters.length - 1 ? snapshot.work.targetWordCount - base * index : base }
  })
}

function reviewDraft(): ShortNovelReviewV1 { return { version: 1, summary: '', strengths: [], issues: [] } }

export default function ShortNovelStudio({ project, scope, activeStage, onStageChange, structured = false }: Props) {
  const [production, setProduction] = useState<(ShortNovelProductionV1 & { id: number }) | null>(null)
  const [snapshot, setSnapshot] = useState<ShortNovelManuscriptSnapshotV1 | null>(null)
  const [completion, setCompletion] = useState<ShortNovelCompletionReportV1 | null>(null)
  const [releases, setReleases] = useState<CreationReleaseV1[]>([])
  const [localStage, setLocalStage] = useState<Stage>('brief')
  const stage = activeStage ?? localStage
  const setStage = useCallback((next:Stage) => { setLocalStage(next); onStageChange?.(next) }, [onStageChange])
  const [editorText, setEditorText] = useState('')
  const [instruction, setInstruction] = useState('')
  const [selectedChapterKey, setSelectedChapterKey] = useState('chapter-1')
  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<{ runId: number; kind: ShortNovelArtifactKindV1; draftId: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const editRevision = useRef(0)
  const activeGeneration = useRef<AbortController | null>(null)
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof listShortNovelTasksV1>>>([])
  const draftPrefix = `short:${scope.projectId}:${scope.workId}:`
  useEffect(() => registerPendingDraftFlusherV1(() => flushCandidateDraftsV1(draftPrefix)), [draftPrefix])
  const aiConfig = useAIConfigStore(state => state.config)

  const reload = useCallback(async (followPhase = false) => {
    const root = await ensureShortNovelProductionV1(scope)
    const [manuscript, report, releaseRows] = await Promise.all([buildShortNovelManuscriptSnapshotV1(scope), inspectShortNovelCompletionV1(scope), listShortNovelReleasesV1(scope)])
    setTasks(await listShortNovelTasksV1(scope))
    setProduction(root); setSnapshot(manuscript); setCompletion(report); setReleases(releaseRows)
    setSelectedChapterKey(current => manuscript.chapters.some(chapter => chapter.stableKey === current) ? current : manuscript.chapters[0]?.stableKey ?? 'chapter-1')
    if (followPhase) setStage(PHASE_STAGE[root.phase])
    return { root, manuscript }
  }, [scope, setStage])

  useEffect(() => {
    let cancelled = false
    void reload(!activeStage).then(async () => {
      const pending = await readPendingShortNovelCandidateV1({ scope })
      if (!pending || cancelled) return
      const saved = await readShortAuthorDraft(scope, `candidate:${pending.candidate.modelOutputHash}:${pending.candidate.productionRevision}`)
      if (!cancelled) setCandidate({ runId: pending.snapshot.run.id, kind: pending.candidate.artifactKind, draftId: `${pending.candidate.modelOutputHash}:${pending.candidate.productionRevision}`, text: saved ?? JSON.stringify(pending.candidate.payload, null, 2) })
    }).catch(cause => setError(cause instanceof Error ? cause.message : '短篇工作台初始化失败'))
    return () => { cancelled = true; activeGeneration.current?.abort() }
  }, [reload, scope, activeStage])

  const draftKey = `${stage}:r${production?.revision ?? 0}`
  useEffect(() => {
    if (!production || !snapshot || candidate) return
    let cancelled = false
    const initialEdit = editRevision.current
    setInstruction('')
    const initial = stage === 'brief' ? production.brief ?? briefDraft(snapshot) : stage === 'design' ? production.storyDesign ?? designDraft() : stage === 'plan' ? planDraft(snapshot) : stage === 'review' ? reviewDraft() : {}
    setEditorText(JSON.stringify(initial, null, 2))
    void readShortAuthorDraft(scope, draftKey).then(saved => {
      if (!cancelled && initialEdit === editRevision.current && saved) { const draft = JSON.parse(saved); setEditorText(draft.text); setInstruction(draft.instruction ?? '') }
    }).catch(cause => setError(String(cause)))
    return () => { cancelled = true }
  }, [candidate, production, snapshot, stage, draftKey, scope])
  const persistDraft = (key:string, text:string) => queueCandidateDraftV1({key:draftPrefix+key,draft:text,debounceMs:400,persist:value=>saveShortAuthorDraft(scope,key,value),onError:cause=>setError(cause.message)})
  const editText = (text:string) => { editRevision.current++; setEditorText(text); persistDraft(draftKey, JSON.stringify({text,instruction})) }
  const editInstruction = (value:string) => { editRevision.current++; setInstruction(value); persistDraft(draftKey, JSON.stringify({text:editorText,instruction:value})) }
  const editCandidate = (text:string) => { if(candidate) { setCandidate({...candidate,text}); persistDraft(`candidate:${candidate.draftId}`,text) } }

  const act = async (operation: () => Promise<unknown>, followPhase = true) => {
    if (busy) return
    setBusy(true); setError('')
    try { await flushPendingEditsV1(); await operation(); await reload(followPhase) } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败') } finally { setBusy(false) }
  }

  const generate = async (kind: ShortNovelArtifactKindV1, options: { chapterKey?: string; issueKey?: string } = {}) => {
    if (busy || candidate) return
    if (!isAIConfigReady(aiConfig)) { setError(getAIConfigRequiredMessage(aiConfig)); return }
    const controller = new AbortController()
    let timedOut = false
    const timeoutId = window.setTimeout(() => { timedOut = true; controller.abort() }, 90_000)
    activeGeneration.current = controller
    setBusy(true); setGenerating(true); setError('')
    try {
      await flushPendingEditsV1()
      const generated = await generateShortNovelCandidateV1({ scope, artifactKind: kind, chapterKey: options.chapterKey, issueKey: options.issueKey, authorInstruction: [instruction, ['brief', 'story-design', 'scene-plan'].includes(kind) ? `作者正在编辑的未确认草稿（请保留已填需求，补全空缺）：\n${editorText}` : ''].filter(Boolean).join('\n\n'), aiConfig, signal: controller.signal })
      setCandidate({ runId: generated.snapshot.run.id, kind, draftId: `${generated.candidate.modelOutputHash}:${generated.candidate.productionRevision}`, text: JSON.stringify(generated.candidate.payload, null, 2) })
    } catch (cause) {
      if (controller.signal.aborted) setError(timedOut ? '本次生成超过 90 秒，已安全停止；没有内容写入正式作品。' : '本次生成已取消；没有内容写入正式作品。')
      else setError(cause instanceof Error ? cause.message : 'AI 候选生成失败')
    } finally {
      window.clearTimeout(timeoutId)
      if (activeGeneration.current === controller) activeGeneration.current = null
      setTasks(await listShortNovelTasksV1(scope)); setGenerating(false); setBusy(false)
    }
  }

  const acceptCandidate = () => {
    if (!candidate) return
    void act(async () => {
      await adoptShortNovelCandidateV1({ scope, runId: candidate.runId, authorPayload: JSON.parse(candidate.text) })
      setCandidate(null)
    })
  }

  const rejectCandidate = () => {
    if (!candidate) return
    void act(async () => { await rejectShortNovelCandidateV1({ scope, runId: candidate.runId }); setCandidate(null) }, false)
  }

  const selectStage = (nextStage: Stage) => {
    void flushPendingEditsV1().then(() => setStage(nextStage)).catch(cause=>setError(String(cause)))
    if (nextStage !== 'review' && nextStage !== 'release') return
    void reload(false).catch(cause => setError(cause instanceof Error ? cause.message : '短篇状态刷新失败'))
  }

  const saveManual = () => {
    if (!production || !snapshot) return
    void act(async () => {
      const value = JSON.parse(editorText)
      if (stage === 'brief') await confirmShortNovelBriefV1({ scope, expectedRevision: production.revision, brief: value })
      else if (stage === 'design') await confirmShortNovelStoryDesignV1({ scope, expectedRevision: production.revision, storyDesign: value })
      else if (stage === 'plan') await adoptShortNovelChapterPlanV1({ scope, expectedRevision: production.revision, plan: value })
      else if (stage === 'review') await adoptShortNovelReviewV1({ scope, expectedRevision: production.revision, expectedManuscriptHash: snapshot.manuscriptHash, review: value })
    })
  }

  const exportRelease = (release: CreationReleaseV1, format: 'md' | 'txt' | 'json') => {
    void act(async () => {
      const manifest = await readShortNovelReleaseManifestV1(scope, release.id!)
      const base = `${safeName(manifest.work.title)}-v${release.version}`
      if (format === 'md') download(`${base}.md`, renderShortNovelReleaseMarkdownV1(manifest), 'text/markdown')
      else if (format === 'txt') download(`${base}.txt`, renderShortNovelReleaseTextV1(manifest), 'text/plain')
      else download(`${base}.json`, renderShortNovelReleaseJsonV1(manifest), 'application/json')
    }, false)
  }

  const editingCompleted = production?.phase === 'complete' && stage !== 'release'
  const reviewStale = !!production?.latestReview && production.reviewedManuscriptHash !== snapshot?.manuscriptHash
  const currentIndex = STAGES.findIndex(item => item.id === stage)
  const availableStageIndex = production ? STAGES.findIndex(item => item.id === PHASE_STAGE[production.phase]) : 0
  const wordCount = snapshot?.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0) ?? 0
  const percentage = snapshot ? Math.min(100, Math.round(wordCount / snapshot.work.targetWordCount * 100)) : 0
  const candidateInspection = useMemo(() => {
    if (!candidate || !snapshot) return null
    try {
      const payload = JSON.parse(candidate.text) as { chapterKey?: unknown; content?: unknown }
      if (!['chapter-draft', 'targeted-rewrite'].includes(candidate.kind)) return { valid: true, chapter: null }
      if (typeof payload.chapterKey !== 'string' || typeof payload.content !== 'string') return { valid: false, chapter: null }
      const chapter = snapshot.chapters.find(item => item.stableKey === payload.chapterKey)
      const target = Number(chapter?.summary.split('\n').find(line => line.startsWith('字数预算：'))?.slice('字数预算：'.length))
      const characters = payload.content.replace(/\s+/g, '').length
      const projectedTotal = wordCount - (chapter?.wordCount ?? 0) + characters
      const minimum = Number.isFinite(target) ? Math.ceil(target * .9) : null
      const maximum = Number.isFinite(target) ? Math.floor(target * 1.1) : null
      return { valid: true, chapter: { characters, target: Number.isFinite(target) ? target : null, minimum, maximum, projectedTotal } }
    } catch {
      return { valid: false, chapter: null }
    }
  }, [candidate, snapshot, wordCount])
  const selectedOutlineNodeId = useMemo(() => {
    if (!snapshot) return undefined
    const ordinal = Number(selectedChapterKey.split('-')[1])
    return snapshot.outlineNodes
      .filter(node => node.type === 'chapter')
      .sort((left, right) => left.order - right.order)[ordinal - 1]?.id
  }, [selectedChapterKey, snapshot])

  if (!production || !snapshot || !completion) return <div className="short-studio-loading">{error || '正在打开短篇工作台…'}</div>

  return <div className="short-studio" data-testid="short-novel-studio">
    <header className="short-studio-top">
      <div>{!structured&&<><span>SHORT FICTION STUDIO</span><h2>{snapshot.work.title}</h2></>}<p>{structured ? `${snapshot.chapters.length} 章` : `独立短篇生产 · 5,000～25,000 字 · ${snapshot.chapters.length} 章`}</p></div>
      <div className="short-progress"><strong>{wordCount.toLocaleString()} / {snapshot.work.targetWordCount.toLocaleString()} 字</strong><div><i style={{ width: `${percentage}%` }} /></div><small>目标进度 {percentage}%</small></div>
    </header>
    <div className="short-studio-layout">
      <aside className="short-stage-nav">{STAGES.map((item, index) => <button key={item.id} className={stage === item.id ? 'active' : ''} onClick={() => selectStage(item.id)}><span>{index < availableStageIndex || production.phase === 'complete' ? <Check /> : index === currentIndex ? <ChevronRight /> : index + 1}</span><div><strong>{item.label}</strong><small>{item.note}</small></div></button>)}</aside>
      <main className="short-stage-main">
        {production.phase==='complete' && stage!=='release' && <section className="short-stage-heading"><p>当前草稿已完成。继续修改会重新打开草稿，已发布版本保持不变。</p><button onClick={()=>void act(()=>reopenShortNovelProductionV1({scope,expectedRevision:production.revision}),false)}>继续修改草稿</button></section>}
        <section className={`short-stage-heading ${structured ? 'short-stage-tools' : ''}`}>{!structured&&<div><span>STEP {currentIndex + 1}</span><h3>{STAGES[currentIndex].label}</h3><p>{STAGES[currentIndex].note}</p></div>}{stage !== 'release' && (structured ? <details className="short-instruction"><summary>本步附加要求{instruction ? ' · 已填写' : '（可选）'}</summary><label>本步附加要求<textarea value={instruction} onChange={event => editInstruction(event.target.value)} placeholder="可选：语气、人物、禁区或本次修订要求" /></label></details> : <label>本步附加要求<textarea value={instruction} onChange={event => editInstruction(event.target.value)} placeholder="可选：语气、人物、禁区或本次修订要求" /></label>)}{generating && <button className="short-cancel-generation" onClick={() => activeGeneration.current?.abort()}><X />取消本次生成</button>}</section>

        {candidate && <section className="short-candidate"><header><div><Sparkles /><strong>AI 创作候选</strong></div><span>尚未写入正式作品</span></header>{structured ? <ShortNovelFields kind={candidate.kind} text={candidate.text} onChange={editCandidate}/> : <textarea value={candidate.text} onChange={event => editCandidate(event.target.value)} spellCheck={false} />}{candidateInspection && <div className={`short-candidate-check ${candidateInspection.valid && (!candidateInspection.chapter || (candidateInspection.chapter.minimum != null && candidateInspection.chapter.maximum != null && candidateInspection.chapter.characters >= candidateInspection.chapter.minimum && candidateInspection.chapter.characters <= candidateInspection.chapter.maximum)) ? 'ready' : 'warning'}`}>{!candidateInspection.valid ? <><AlertTriangle /><span>候选内容尚未完整；修正后才能采纳。</span></> : candidateInspection.chapter ? <><AlertTriangle /><span>本章 {candidateInspection.chapter.characters.toLocaleString()} 字{candidateInspection.chapter.target ? ` · 章节预算 ${candidateInspection.chapter.target.toLocaleString()}（建议 ${candidateInspection.chapter.minimum?.toLocaleString()}～${candidateInspection.chapter.maximum?.toLocaleString()}）` : ''} · 采纳后全篇约 {candidateInspection.chapter.projectedTotal.toLocaleString()} / {snapshot.work.targetWordCount.toLocaleString()} 字</span></> : <><Check /><span>请检查候选内容，确认后才会写入正式作品。</span></>}</div>}<footer><button onClick={rejectCandidate} disabled={busy || editingCompleted}><X />放弃候选</button><button className="primary" onClick={acceptCandidate} disabled={busy || candidateInspection?.valid === false}><Check />作者确认并采纳</button></footer></section>}

        {!candidate && (stage === 'brief' || stage === 'design' || stage === 'plan') && <section className="short-json-editor"><header><div><FileJson /><strong>{stage === 'brief' ? '创作意图' : stage === 'design' ? '故事设计' : '章节卡计划'}</strong></div><button onClick={() => void generate(stage === 'brief' ? 'brief' : stage === 'design' ? 'story-design' : 'scene-plan')} disabled={busy || editingCompleted}><Sparkles />AI 生成候选</button></header>{!structured&&<p>填写这一阶段的内容，或先生成候选。确认后才会成为后续创作依据。</p>}{structured ? <ShortNovelFields kind={stage === 'brief' ? 'brief' : stage === 'design' ? 'story-design' : stage === 'plan' ? 'scene-plan' : 'continuity-review'} text={editorText} onChange={editText}/> : <textarea value={editorText} onChange={event => editText(event.target.value)} spellCheck={false} />}<footer><button className="primary" onClick={saveManual} disabled={busy || editingCompleted}><Check />校验并确认本步</button></footer></section>}

        {!structured && stage === 'plan' && <section className="short-embedded"><header><BookOpenText /><div><strong>可视大纲</strong><small>确认章节卡后仍可在这里精修标题与摘要；改动会使旧审校失效。</small></div></header><Suspense fallback={<div>加载大纲…</div>}><OutlinePanel project={project} /></Suspense></section>}

        {stage === 'draft' && <><section className="short-chapter-run"><header><div><Sparkles /><strong>逐章生成</strong></div><span>每章候选单独确认，不整书覆盖</span></header><div className={structured ? "short-chapter-picker" : undefined}>{structured ? <label>章节<select aria-label="生成候选的章节" value={selectedChapterKey} onChange={event=>setSelectedChapterKey(event.target.value)}>{snapshot.chapters.map(chapter=><option key={chapter.stableKey} value={chapter.stableKey}>{chapter.title} · {chapter.wordCount.toLocaleString()} 字</option>)}</select></label> : snapshot.chapters.map(chapter => <button key={chapter.stableKey} className={selectedChapterKey === chapter.stableKey ? 'active' : ''} onClick={() => setSelectedChapterKey(chapter.stableKey)}><strong>{chapter.title}</strong><small>{chapter.wordCount.toLocaleString()} 字</small></button>)}</div><footer><button className="primary" onClick={() => void generate('chapter-draft', { chapterKey: selectedChapterKey })} disabled={busy || !!candidate || production.phase==='complete'}><Sparkles />生成所选章节候选</button></footer></section><section className="short-embedded"><header><BookOpenText /><div><strong>正文编辑器</strong><small>作者可以直接写作或继续使用现有可靠正文工具。</small></div></header><Suspense fallback={<div>加载正文…</div>}>{production.phase==='complete'?<article className="short-frozen-prose">{snapshot.chapters.filter(chapter=>chapter.stableKey===selectedChapterKey).map(chapter=><div key={chapter.stableKey}><h4>{chapter.title}</h4><p style={{whiteSpace:'pre-wrap'}}>{htmlToPlainText(chapter.contentHtml)}</p></div>)}</article>:<ChaptersListPanel project={project} initialNodeId={selectedOutlineNodeId} />}</Suspense></section></>}

        {stage === 'review' && <section className="short-review"><header><div><AlertTriangle /><strong>全篇连续性审校</strong></div><button onClick={() => void generate('continuity-review')} disabled={busy || !!candidate || production.phase==='complete'}><Sparkles />AI 全篇审校</button></header>{reviewStale && <p className="short-warning"><RefreshCw />正文或结构已变化，现有审校已失效，请重新审校。</p>}{!production.latestReview ? <div className="short-empty">还没有已确认的审校结果。可以运行只读 critic，或在下方手工记录复核结论。</div> : <><p>{production.latestReview.summary}</p><div className="short-issues">{production.latestReview.issues.map(issue => <article key={issue.stableKey} className={issue.severity}><header><span>{issue.severity}</span><strong>{issue.category}</strong><small>{issue.status}</small></header><blockquote>{issue.evidence}</blockquote><p>{issue.problem}</p><small>{issue.suggestion}</small>{issue.status === 'open' && <footer><button onClick={() => void act(() => resolveShortNovelReviewIssueV1({ scope, expectedRevision: production.revision, issueKey: issue.stableKey, decision: 'dismissed' }))}>忽略此问题</button><button onClick={() => void act(() => resolveShortNovelReviewIssueV1({ scope, expectedRevision: production.revision, issueKey: issue.stableKey, decision: 'resolved' }))}>标记已修复</button>{issue.chapterKeys[0] && <button className="primary" onClick={() => { setSelectedIssueKey(issue.stableKey); setSelectedChapterKey(issue.chapterKeys[0]); void generate('targeted-rewrite', { issueKey: issue.stableKey, chapterKey: issue.chapterKeys[0] }) }}><Sparkles />定向重写</button>}</footer>}</article>)}</div></>}<div className="short-json-editor compact"><header><div><FileJson /><strong>人工审校记录</strong></div></header>{structured ? <ShortNovelFields kind="continuity-review" text={editorText} onChange={editText}/> : <textarea value={editorText} onChange={event => editText(event.target.value)} spellCheck={false} />}<footer><button onClick={saveManual} disabled={busy || editingCompleted}><Check />确认人工审校</button></footer></div></section>}

        {stage === 'release' && <section className="short-release"><header><div><Lock /><strong>不可变短篇版本</strong></div>{production.phase === 'complete' ? <button onClick={() => void act(() => reopenShortNovelProductionV1({ scope, expectedRevision: production.revision }))}><RefreshCw />重新打开草稿</button> : <button className="primary" onClick={() => void act(() => publishShortNovelReleaseV1({ scope, expectedRevision: production.revision }))} disabled={busy || !completion.ready}><Lock />确认并发布</button>}</header><div className={completion.ready ? 'short-gate ready' : 'short-gate'}><strong>{completion.ready ? '已达到发布条件' : '尚未达到发布条件'}</strong><span>{completion.wordCount.toLocaleString()} 字 · manuscript {completion.manuscriptHash.slice(0, 10)}</span>{completion.blockers.map(item => <p key={item}><X />{item}</p>)}{completion.warnings.map(item => <p key={item} className="warning"><AlertTriangle />{item}</p>)}</div><div className="short-release-list">{releases.length ? releases.map(release => <article key={release.id}><div><strong>v{release.version} · {release.label}</strong><small>{new Date(release.createdAt).toLocaleString()} · {release.contentHash.slice(0, 12)}</small></div><footer><button onClick={() => exportRelease(release, 'md')}><Download />Markdown</button><button onClick={() => exportRelease(release, 'txt')}><FileText />TXT</button><button onClick={() => exportRelease(release, 'json')}><FileJson />JSON</button></footer></article>) : <div className="short-empty">还没有发布版本。发布后导出只读取冻结 manifest，不会读取后来修改的草稿。</div>}</div></section>}
      </main>
    </div>
    {selectedIssueKey && <span className="sr-only">当前修订问题 {selectedIssueKey}</span>}
    {error && <div className="short-error" role="alert">{error}</div>}
    {structured && tasks.length > 0 && <section className="short-task-list"><h3>待处理创作任务</h3><p>恢复或结束已有任务不会重新调用模型；生成中离开页面会取消本次请求。</p>{tasks.map(task=><article key={task.id}><span>任务 #{task.id} · {task.status}</span><button disabled={busy || !task.canResumeAdoption} onClick={()=>void act(async()=>{await resumeShortNovelAdoptionV1(scope,task.id);setCandidate(null)})}>继续采纳</button><button disabled={busy || editingCompleted} onClick={()=>void act(async()=>{await closeShortNovelTaskV1(scope,task.id);if(candidate?.runId===task.id)setCandidate(null)},false)}>结束此任务</button></article>)}</section>}
    {!structured && <ShortNovelShowcase />}
  </div>
}
