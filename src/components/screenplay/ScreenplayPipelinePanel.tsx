import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Play, RefreshCw, Sparkles, X } from 'lucide-react'
import type { AdaptationProject, AdaptationSourceUnit, ScreenplayReviewIssueV1, ScreenplayScene, WorkspaceScope } from '../../lib/types'
import { listAdaptationAnalysisV1 } from '../../lib/adaptation/analysis'
import {
  adoptScreenplayProfessionalCandidateV1,
  generateScreenplayProfessionalCandidateV1,
  readPendingScreenplayProfessionalCandidateV1,
  rejectScreenplayProfessionalCandidateV1,
  type ScreenplayProfessionalPayloadV1,
  type ScreenplayProfessionalStageV1,
} from '../../lib/screenplay/durable-production'
import { adoptScreenplayReviewIssuesV1, listScreenplayProductionV1, startScreenplayProductionV1, updateScreenplayReviewIssueStatusV1 } from '../../lib/screenplay/production'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import { useAIConfigStore } from '../../stores/ai-config'

interface Props {
  scope: WorkspaceScope
  adaptation: AdaptationProject
  sourceUnits: AdaptationSourceUnit[]
  scenes: ScreenplayScene[]
  onChanged: () => Promise<void>
}

const STAGE_LABELS: Record<ScreenplayProfessionalStageV1, string> = {
  'source-analysis': '1 来源事实', 'causal-graph': '2 因果图', 'adaptation-brief': '3 改编 Brief',
  'decision-pass': '4 删改决定', 'beat-sheet': '5 Beat Sheet', 'scene-card': '6 Scene Cards',
  'scene-draft': '7 逐场写作', 'grounding-review': '8 来源审查', 'dramaturgy-review': '9 戏剧审查',
  'targeted-rewrite': '10 定点修订',
}

function payloadKeys(payload: unknown): string[] {
  return Array.isArray(payload) ? payload.flatMap(item => item && typeof item === 'object' && typeof item.stableKey === 'string' ? [item.stableKey] : []) : []
}

export default function ScreenplayPipelinePanel({ scope, adaptation, sourceUnits, scenes, onChanged }: Props) {
  const [counts, setCounts] = useState({ facts: 0, edges: 0, decisions: 0, beats: 0, cards: 0, issues: 0 })
  const [coveredSourceKeys, setCoveredSourceKeys] = useState<string[]>([])
  const [cards, setCards] = useState<Array<{ stableKey: string; purpose: string }>>([])
  const [issues, setIssues] = useState<ScreenplayReviewIssueV1[]>([])
  const [sourceUnitKey, setSourceUnitKey] = useState('')
  const [targetSceneKey, setTargetSceneKey] = useState('')
  const [candidate, setCandidate] = useState<{ runId: number; stage: ScreenplayProfessionalStageV1; text: string } | null>(null)
  const [acceptedKeys, setAcceptedKeys] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const aiConfig = useAIConfigStore(state => state.config)

  const reload = useCallback(async () => {
    const [analysis, production] = await Promise.all([
      listAdaptationAnalysisV1({ scope, adaptationProjectId: adaptation.id!, manifestVersion: adaptation.activeSourceManifestVersion }),
      listScreenplayProductionV1(scope),
    ])
    const confirmedFacts = analysis.facts.filter(row => row.authorStatus === 'confirmed')
    setCounts({ facts: confirmedFacts.length, edges: analysis.edges.filter(row => row.authorStatus === 'confirmed').length, decisions: analysis.decisions.filter(row => row.authorStatus === 'confirmed').length, beats: production.beats.length, cards: production.sceneCards.length, issues: production.reviewIssues.filter(row => row.status === 'open').length })
    setCoveredSourceKeys([...new Set(confirmedFacts.flatMap(row => row.sourceUnitKeys))])
    setCards(production.sceneCards.map(card => ({ stableKey: card.stableKey, purpose: card.purpose })))
    setIssues(production.reviewIssues)
  }, [adaptation.activeSourceManifestVersion, adaptation.id, scope])

  useEffect(() => { void reload().catch(cause => setError(cause instanceof Error ? cause.message : '读取专业流程失败')) }, [reload])
  useEffect(() => {
    const usableUnits = sourceUnits.filter(unit => unit.sourceKind !== 'work')
    setSourceUnitKey(current => current && usableUnits.some(unit => unit.sourceUnitKey === current) ? current : usableUnits.find(unit => !coveredSourceKeys.includes(unit.sourceUnitKey))?.sourceUnitKey ?? usableUnits[0]?.sourceUnitKey ?? '')
  }, [coveredSourceKeys, sourceUnits])
  useEffect(() => {
    const available = [...new Set([...cards.map(card => card.stableKey), ...scenes.map(scene => scene.stableKey)])]
    setTargetSceneKey(current => current && available.includes(current) ? current : available[0] ?? '')
  }, [cards, scenes])
  useEffect(() => {
    let cancelled = false
    void readPendingScreenplayProfessionalCandidateV1(scope).then(pending => {
      if (!pending || cancelled) return
      const text = JSON.stringify(pending.candidate.payload, null, 2)
      setCandidate({ runId: pending.snapshot.run.id, stage: pending.candidate.stage, text })
      setAcceptedKeys(new Set(payloadKeys(pending.candidate.payload)))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [scope])

  const openIssuesForTarget = useMemo(() => issues.filter(issue => issue.status === 'open' && issue.sceneKey === targetSceneKey), [issues, targetSceneKey])
  const candidateItems = useMemo(() => {
    if (!candidate) return []
    try { const value = JSON.parse(candidate.text); return Array.isArray(value) ? value : [] } catch { return [] }
  }, [candidate])

  const runStage = async (stage: ScreenplayProfessionalStageV1) => {
    if (busy || candidate) return
    if (!isAIConfigReady(aiConfig)) { setError(getAIConfigRequiredMessage(aiConfig)); return }
    if (stage === 'source-analysis' && !sourceUnitKey) { setError('请选择一个来源单元。'); return }
    if (['scene-draft', 'grounding-review', 'dramaturgy-review', 'targeted-rewrite'].includes(stage) && !targetSceneKey) { setError('请选择目标 Scene Card 或场景。'); return }
    if (stage === 'targeted-rewrite' && !openIssuesForTarget.length) { setError('当前场景没有可定点修订的开放问题。'); return }
    setBusy(true); setError('')
    try {
      const generated = await generateScreenplayProfessionalCandidateV1({
        scope, adaptationProjectId: adaptation.id!, stage, aiConfig,
        sourceUnitKeys: stage === 'source-analysis' ? [sourceUnitKey] : undefined,
        targetSceneKeys: ['scene-draft', 'grounding-review', 'dramaturgy-review', 'targeted-rewrite'].includes(stage) ? [targetSceneKey] : undefined,
        targetIssueKeys: stage === 'targeted-rewrite' ? openIssuesForTarget.map(issue => issue.stableKey) : undefined,
      })
      setCandidate({ runId: generated.snapshot.run.id, stage, text: JSON.stringify(generated.candidate.payload, null, 2) })
      setAcceptedKeys(new Set(payloadKeys(generated.candidate.payload)))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '专业阶段生成失败') } finally { setBusy(false) }
  }

  const accept = async () => {
    if (!candidate || busy) return
    setBusy(true); setError('')
    try {
      const parsed = JSON.parse(candidate.text) as ScreenplayProfessionalPayloadV1
      const authorPayload = Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object' && acceptedKeys.has((item as { stableKey: string }).stableKey)) : parsed
      await adoptScreenplayProfessionalCandidateV1({ scope, runId: candidate.runId, authorPayload: authorPayload as ScreenplayProfessionalPayloadV1 })
      setCandidate(null); setAcceptedKeys(new Set()); await reload(); await onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '采纳候选失败') } finally { setBusy(false) }
  }

  const reject = async () => {
    if (!candidate || busy) return
    setBusy(true); setError('')
    try { await rejectScreenplayProfessionalCandidateV1(scope, candidate.runId); setCandidate(null); setAcceptedKeys(new Set()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '放弃候选失败') } finally { setBusy(false) }
  }

  const confirmNoIssues = async (category: 'grounding' | 'dramaturgy') => {
    if (busy || candidate) return
    const scene = scenes.find(item => item.stableKey === targetSceneKey)
    if (!scene) { setError('请选择一个已经成稿的目标场景。'); return }
    setBusy(true); setError('')
    try {
      await adoptScreenplayReviewIssuesV1({
        scope,
        expectedAdaptationRevision: adaptation.revision,
        sourceManifestVersion: adaptation.activeSourceManifestVersion,
        category,
        targetSceneKeys: [scene.stableKey],
        expectedSceneRevisions: { [scene.stableKey]: scene.revision },
        candidates: [],
      })
      await reload(); await onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '作者审查确认失败') } finally { setBusy(false) }
  }

  const stageButtons: Array<{ stage: ScreenplayProfessionalStageV1; ready: boolean; detail: string }> = [
    { stage: 'source-analysis', ready: true, detail: `${coveredSourceKeys.length}/${sourceUnits.filter(unit => unit.sourceKind !== 'work').length} 来源单元 · ${counts.facts} 事实` },
    { stage: 'causal-graph', ready: counts.facts > 0, detail: `${counts.edges} 因果边` },
    { stage: 'adaptation-brief', ready: counts.edges > 0, detail: adaptation.briefSourceManifestVersion === adaptation.activeSourceManifestVersion ? '已确认' : '待确认' },
    { stage: 'decision-pass', ready: adaptation.briefSourceManifestVersion === adaptation.activeSourceManifestVersion, detail: `${counts.decisions} 决定` },
    { stage: 'beat-sheet', ready: counts.decisions > 0, detail: `${counts.beats} Beats` },
    { stage: 'scene-card', ready: counts.beats > 0, detail: `${counts.cards} Cards` },
    { stage: 'scene-draft', ready: counts.cards > 0 && ['producing', 'review'].includes(adaptation.status), detail: `${scenes.length}/${counts.cards} 场` },
    { stage: 'grounding-review', ready: scenes.length > 0, detail: '来源/连续性' },
    { stage: 'dramaturgy-review', ready: scenes.length > 0, detail: '冲突/动作/对白' },
    { stage: 'targeted-rewrite', ready: openIssuesForTarget.length > 0, detail: `${counts.issues} 开放问题` },
  ]

  return <section className="screenplay-pipeline">
    <header><div><span>PROFESSIONAL ADAPTATION PIPELINE</span><h3>十步小说转剧本</h3></div><strong>manifest v{adaptation.activeSourceManifestVersion}</strong></header>
    <p>每一步由独立职业 Skill 生成候选；只有这里的作者确认会写入正式数据。格式 lint 与导出由确定性代码完成。</p>
    <div className="screenplay-pipeline-targets">
      <label>来源分析单元<select value={sourceUnitKey} onChange={event => setSourceUnitKey(event.target.value)}>{sourceUnits.filter(unit => unit.sourceKind !== 'work').map(unit => <option key={unit.sourceUnitKey} value={unit.sourceUnitKey}>{coveredSourceKeys.includes(unit.sourceUnitKey) ? '✓ ' : ''}{unit.label} · {unit.wordCount} 字</option>)}</select></label>
      <label>目标 Scene Card / 场景<select value={targetSceneKey} onChange={event => setTargetSceneKey(event.target.value)}>{[...cards, ...scenes.filter(scene => !cards.some(card => card.stableKey === scene.stableKey)).map(scene => ({ stableKey: scene.stableKey, purpose: scene.summary }))].map(item => <option key={item.stableKey} value={item.stableKey}>{scenes.some(scene => scene.stableKey === item.stableKey) ? '✓ ' : ''}{item.stableKey} · {item.purpose}</option>)}</select></label>
      {counts.cards > 0 && !['producing', 'review', 'complete'].includes(adaptation.status) && <button className="primary" onClick={() => void (async () => { setBusy(true); setError(''); try { await startScreenplayProductionV1({ scope, expectedAdaptationRevision: adaptation.revision }); await onChanged() } catch (cause) { setError(cause instanceof Error ? cause.message : '进入场景生产失败') } finally { setBusy(false) } })()} disabled={busy}><Play className="h-4 w-4" />进入场景生产</button>}
    </div>
    <div className="screenplay-pipeline-steps">{stageButtons.map(item => <button key={item.stage} onClick={() => void runStage(item.stage)} disabled={busy || !!candidate || !item.ready || adaptation.status === 'complete'}><Sparkles className="h-4 w-4" /><span><strong>{STAGE_LABELS[item.stage]}</strong><small>{item.detail}</small></span></button>)}</div>
    {targetSceneKey && scenes.some(scene => scene.stableKey === targetSceneKey) && adaptation.status !== 'complete' && <div className="screenplay-author-review-actions">
      <button onClick={() => void confirmNoIssues('grounding')} disabled={busy || !!candidate}><Check className="h-4 w-4" />作者确认来源无问题</button>
      <button onClick={() => void confirmNoIssues('dramaturgy')} disabled={busy || !!candidate}><Check className="h-4 w-4" />作者确认戏剧无问题</button>
    </div>}
    {candidate && <div className="screenplay-professional-candidate"><header><strong>{STAGE_LABELS[candidate.stage]}候选 · 尚未写入</strong><span>可编辑后确认</span></header>
      {candidateItems.length > 0 && <div className="screenplay-candidate-items">{candidateItems.map((item: any, index) => <label key={item.stableKey ?? index}><input type="checkbox" checked={acceptedKeys.has(item.stableKey)} onChange={event => setAcceptedKeys(current => { const next = new Set(current); if (event.target.checked) next.add(item.stableKey); else next.delete(item.stableKey); return next })} /><span><strong>{item.stableKey}</strong><small>{item.statement ?? item.rationale ?? item.objective ?? item.purpose ?? item.problem ?? ''}</small></span></label>)}</div>}
      <textarea value={candidate.text} onChange={event => { setCandidate({ ...candidate, text: event.target.value }); try { setAcceptedKeys(new Set(payloadKeys(JSON.parse(event.target.value)))) } catch { /* keep editor usable while JSON is incomplete */ } }} spellCheck={false} />
      <footer><button onClick={() => void reject()} disabled={busy}><X className="h-4 w-4" />放弃</button><button className="primary" onClick={() => void accept()} disabled={busy}><Check className="h-4 w-4" />作者确认并采纳</button></footer>
    </div>}
    {issues.length > 0 && <details className="screenplay-review-list"><summary>审查问题（{issues.filter(issue => issue.status === 'open').length} 项开放）</summary>{issues.map(issue => <article key={issue.id} className={issue.status}><div><strong>{issue.category} · {issue.severity} · {issue.sceneKey}</strong><small>{issue.blockId ? `block ${issue.blockId}` : '整场'}</small></div><p>{issue.problem}</p><blockquote>{issue.evidence}</blockquote>{issue.status === 'open' && <footer><button onClick={() => void (async () => { await updateScreenplayReviewIssueStatusV1({ scope, issueId: issue.id!, status: 'dismissed' }); await reload() })()}>作者驳回</button></footer>}</article>)}</details>}
    {error && <p className="screenplay-pipeline-error" role="alert"><RefreshCw className="h-4 w-4" />{error}</p>}
  </section>
}
