import ScreenplayFields from './ScreenplayFields'
import { useDialog } from '../shared/Dialog'
import { readScreenplayAuthorDraft, saveScreenplayAuthorDraft } from '../../lib/screenplay/author-drafts'
import { queueCandidateDraftV1, flushCandidateDraftsV1 } from '../../lib/agent/candidate-draft-coordinator'
import { registerPendingDraftFlusherV1, flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { listScreenplayTasksV1, closeScreenplayTaskV1 } from '../../lib/screenplay/durable-production'
import { downloadJSON, exportProjectJSON } from '../../lib/export/json-export'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { screenplaySourceAnalysisUnitLabelV1, screenplaySourceAnalysisUnitsV1 } from '../../lib/screenplay/source-analysis-units'

interface Props {
  scope: WorkspaceScope
  adaptation: AdaptationProject
  sourceUnits: AdaptationSourceUnit[]
  scenes: ScreenplayScene[]
  onChanged: () => Promise<void>
  allowedStages?: ScreenplayProfessionalStageV1[]
  beforeAction?: () => void
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

export default function ScreenplayPipelinePanel({ scope, adaptation, sourceUnits, scenes, onChanged, allowedStages, beforeAction }: Props) {
  const dialog = useDialog()
  const [instruction,setInstruction] = useState('')
  const [instructionLoaded,setInstructionLoaded] = useState(false)
  const [excludedIssues,setExcludedIssues] = useState<Set<string>>(new Set())
  const [tasks,setTasks] = useState<Awaited<ReturnType<typeof listScreenplayTasksV1>>>([])
  const draftPrefix = `screenplay:${scope.workId}:candidate:`
  useEffect(()=>registerPendingDraftFlusherV1(()=>flushCandidateDraftsV1(draftPrefix)),[draftPrefix])
  useEffect(()=>{let cancelled=false;void readScreenplayAuthorDraft(scope,'instruction').then(text=>{if(!cancelled){setInstruction(text??'');setInstructionLoaded(true)}}).catch(c=>setError(String(c)));return()=>{cancelled=true}},[scope])
  useEffect(()=>{if(instructionLoaded)queueCandidateDraftV1({key:draftPrefix+'instruction',draft:instruction,debounceMs:250,persist:text=>saveScreenplayAuthorDraft(scope,'instruction',text),onError:c=>setError(c.message)})},[instruction,instructionLoaded,draftPrefix,scope])
  const [counts, setCounts] = useState({ facts: 0, edges: 0, decisions: 0, beats: 0, cards: 0, issues: 0 })
  const [coveredSourceKeys, setCoveredSourceKeys] = useState<string[]>([])
  const [cards, setCards] = useState<Array<{ stableKey: string; purpose: string }>>([])
  const [issues, setIssues] = useState<ScreenplayReviewIssueV1[]>([])
  const [sourceUnitKey, setSourceUnitKey] = useState('')
  const [targetSceneKey, setTargetSceneKey] = useState('')
  const [candidate, setCandidate] = useState<{ runId: number; stage: ScreenplayProfessionalStageV1; text: string; draftKey: string; recovering?: boolean } | null>(null)
  const [acceptedKeys, setAcceptedKeys] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const activeGeneration = useRef<AbortController | null>(null)
  const aiConfig = useAIConfigStore(state => state.config)
  const sourceAnalysisUnits = useMemo(() => screenplaySourceAnalysisUnitsV1(sourceUnits), [sourceUnits])
  const sourceAnalysisComplete = sourceAnalysisUnits.length > 0 && sourceAnalysisUnits.every(unit => coveredSourceKeys.includes(unit.sourceUnitKey))

  const reload = useCallback(async () => {
    setTasks(await listScreenplayTasksV1(scope))
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

  useEffect(() => { void reload().catch(cause => setError(cause instanceof Error ? cause.message : '读取专业流程失败')) }, [reload, adaptation.revision])
  useEffect(() => {
    setSourceUnitKey(current => {
      const currentIsUncovered = sourceAnalysisUnits.some(unit => unit.sourceUnitKey === current) && !coveredSourceKeys.includes(current)
      return currentIsUncovered ? current : sourceAnalysisUnits.find(unit => !coveredSourceKeys.includes(unit.sourceUnitKey))?.sourceUnitKey ?? sourceAnalysisUnits[0]?.sourceUnitKey ?? ''
    })
  }, [coveredSourceKeys, sourceAnalysisUnits])
  useEffect(() => {
    const available = [...new Set([...cards.map(card => card.stableKey), ...scenes.map(scene => scene.stableKey)])]
    setTargetSceneKey(current => current && available.includes(current) ? current : available[0] ?? '')
  }, [cards, scenes])
  useEffect(() => {
    let cancelled = false
    void readPendingScreenplayProfessionalCandidateV1(scope).then(async pending => {
      if (!pending || cancelled) return
      const draftKey=`candidate:${pending.candidate.stage}:${pending.candidate.modelOutputHash}:${pending.candidate.adaptationRevision}`
      const savedText = pending.recovering ? null : await readScreenplayAuthorDraft(scope, draftKey)
      if(cancelled)return
      const saved = savedText ? JSON.parse(savedText) : null
      const text = saved?.text ?? JSON.stringify(pending.authorPayload ?? pending.candidate.payload, null, 2)
      setCandidate({ runId: pending.snapshot.run.id, stage: pending.candidate.stage, text, draftKey, recovering: pending.recovering })
      setAcceptedKeys(new Set(saved?.keys ?? payloadKeys(pending.authorPayload ?? pending.candidate.payload)))
    }).catch(() => undefined)
    return () => { cancelled = true; activeGeneration.current?.abort() }
  }, [scope])

  useEffect(()=>{
    if(candidate && !candidate.recovering)queueCandidateDraftV1({key:draftPrefix+candidate.draftKey,draft:JSON.stringify({text:candidate.text,keys:[...acceptedKeys]}),debounceMs:250,persist:content=>saveScreenplayAuthorDraft(scope,candidate.draftKey,content),onError:c=>setError(c.message)})
  },[candidate,acceptedKeys,draftPrefix,scope])

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
    if (stage === 'targeted-rewrite' && !openIssuesForTarget.some(issue=>!excludedIssues.has(issue.stableKey))) { setError('当前场景没有可定点修订的开放问题。'); return }
    const controller = new AbortController()
    let timedOut = false
    const timeoutId = window.setTimeout(() => { timedOut = true; controller.abort() }, 90_000)
    activeGeneration.current = controller
    setBusy(true); setGenerating(true); setError('')
    try {
      beforeAction?.(); await flushPendingEditsV1()
      const generated = await generateScreenplayProfessionalCandidateV1({
        scope, adaptationProjectId: adaptation.id!, stage, aiConfig, authorInstruction: instruction,
        sourceUnitKeys: stage === 'source-analysis' ? [sourceUnitKey] : undefined,
        targetSceneKeys: ['scene-draft', 'grounding-review', 'dramaturgy-review', 'targeted-rewrite'].includes(stage) ? [targetSceneKey] : undefined,
        targetIssueKeys: stage === 'targeted-rewrite' ? openIssuesForTarget.filter(issue=>!excludedIssues.has(issue.stableKey)).map(issue => issue.stableKey) : undefined,
        signal: controller.signal,
      })
      setCandidate({ runId: generated.snapshot.run.id, stage, draftKey:`candidate:${stage}:${generated.candidate.modelOutputHash}:${generated.candidate.adaptationRevision}`, text: JSON.stringify(generated.candidate.payload, null, 2) })
      setAcceptedKeys(new Set(payloadKeys(generated.candidate.payload)))
    } catch (cause) {
      if (controller.signal.aborted) setError(timedOut ? '本次生成超过 90 秒，已安全停止；没有内容写入正式剧本。' : '本次生成已取消；没有内容写入正式剧本。')
      else setError(cause instanceof Error ? cause.message : '专业阶段生成失败')
    } finally {
      window.clearTimeout(timeoutId)
      if (activeGeneration.current === controller) activeGeneration.current = null
      setGenerating(false); setBusy(false); await reload()
    }
  }

  const accept = async () => {
    if (!candidate || busy) return
    setBusy(true); setError('')
    try {
      beforeAction?.(); await flushPendingEditsV1()
      const parsed = JSON.parse(candidate.text) as ScreenplayProfessionalPayloadV1
      const authorPayload = Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object' && acceptedKeys.has((item as { stableKey: string }).stableKey)) : parsed
      if(!candidate.recovering&&candidate.stage==='source-analysis'&&(counts.edges||counts.decisions)){
        if(!await dialog.confirm({title:'更新原作事实',message:'采纳事实会清除依赖它的因果关系与删改决定，需要重新确认改编规划。已有剧本场景保留。',confirmText:'备份并采纳'}))return
        await downloadJSON(await exportProjectJSON(scope.projectId),'原作事实修改前备份.json')
      }
      let allowReplaceDownstream = false
      if (!candidate.recovering && ['beat-sheet','scene-card'].includes(candidate.stage) && (counts.cards || scenes.length)) {
        if (!await dialog.confirm({title:'替换场次规划',message:'本次采纳会清除下游场次与审查，已发布版本保留。先下载作品备份，再继续替换。',confirmText:'备份并替换'}))return
        await downloadJSON(await exportProjectJSON(scope.projectId),'剧本重规划前备份.json');allowReplaceDownstream=true
      }
      await adoptScreenplayProfessionalCandidateV1({ scope, runId: candidate.runId, allowReplaceDownstream, authorPayload: candidate.recovering ? undefined : authorPayload as ScreenplayProfessionalPayloadV1 })
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
      beforeAction?.(); await flushPendingEditsV1()
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
    { stage: 'source-analysis', ready: sourceAnalysisUnits.length > 0, detail: `${sourceAnalysisUnits.filter(unit => coveredSourceKeys.includes(unit.sourceUnitKey)).length}/${sourceAnalysisUnits.length} 正文单元 · ${counts.facts} 事实` },
    { stage: 'causal-graph', ready: sourceAnalysisComplete && counts.facts > 0, detail: sourceAnalysisComplete ? `${counts.edges} 因果边` : '先完成全部正文事实' },
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
    <header><div><span>PROFESSIONAL ADAPTATION PIPELINE</span><h3>{allowedStages?'AI 辅助与作者确认':'十步小说转剧本'}</h3></div><strong>manifest v{adaptation.activeSourceManifestVersion}</strong></header>
    <p>根据本页的要求生成候选，逐项审阅后采纳。格式不合格时最多修正一次；网络或授权错误不会自动重复请求。</p>
    <label className="sp-instruction">本次创作要求<textarea disabled={!instructionLoaded} value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder="例如：保留结局，以动作代替内心独白。"/></label>
    {tasks.length>0&&<details className="sp-tasks"><summary>待处理任务（{tasks.length}）</summary>{tasks.map(task=><div key={task.id}><span>任务 {task.id} · {task.intent?'等待恢复采纳':task.status==='paused'?'结果未知，请核实后结束':task.status==='awaiting_confirmation'?'待作者确认':'处理中'}</span><button disabled={busy} onClick={()=>void(async()=>{setBusy(true);try{beforeAction?.();await flushPendingEditsV1();if(task.intent){await adoptScreenplayProfessionalCandidateV1({scope,runId:task.id});if(candidate?.runId===task.id){setCandidate(null);setAcceptedKeys(new Set())}}else {if(!await dialog.confirm({title:'结束此任务？',message:'保留运行证据，不会自动重新请求模型。',confirmText:'结束任务'}))return;await closeScreenplayTaskV1(scope,task.id);if(candidate?.runId===task.id)setCandidate(null)}await reload();await onChanged()}catch(c){setError(String(c))}finally{setBusy(false)}})()}>{task.intent?'恢复采纳':'结束任务'}</button></div>)}</details>}
    {generating && <div className="screenplay-generation-status"><span>正在生成专业候选，最长等待 90 秒</span><button onClick={() => activeGeneration.current?.abort()}><X className="h-4 w-4" />取消本次生成</button></div>}
    <div className="screenplay-pipeline-targets">
      <label>来源分析单元<select value={sourceUnitKey} onChange={event => setSourceUnitKey(event.target.value)}>{sourceAnalysisUnits.map(unit => <option key={unit.sourceUnitKey} value={unit.sourceUnitKey}>{coveredSourceKeys.includes(unit.sourceUnitKey) ? '✓ ' : ''}{screenplaySourceAnalysisUnitLabelV1(unit)}</option>)}</select></label>
      <label>目标 Scene Card / 场景<select value={targetSceneKey} onChange={event => setTargetSceneKey(event.target.value)}>{[...cards, ...scenes.filter(scene => !cards.some(card => card.stableKey === scene.stableKey)).map(scene => ({ stableKey: scene.stableKey, purpose: scene.summary }))].map(item => <option key={item.stableKey} value={item.stableKey}>{scenes.some(scene => scene.stableKey === item.stableKey) ? '✓ ' : ''}{item.purpose}</option>)}</select></label>
      {counts.cards > 0 && !['producing', 'review', 'complete'].includes(adaptation.status) && <button className="primary" onClick={() => void (async () => { setBusy(true); setError(''); try { await startScreenplayProductionV1({ scope, expectedAdaptationRevision: adaptation.revision }); await onChanged() } catch (cause) { setError(cause instanceof Error ? cause.message : '进入场景生产失败') } finally { setBusy(false) } })()} disabled={busy}><Play className="h-4 w-4" />进入场景生产</button>}
    </div>
    <div className="screenplay-pipeline-steps">{stageButtons.filter(item=>!allowedStages||allowedStages.includes(item.stage)).map(item => <button key={item.stage} onClick={() => void runStage(item.stage)} disabled={busy || !!candidate || !item.ready || adaptation.status === 'complete'}><Sparkles className="h-4 w-4" /><span><strong>{STAGE_LABELS[item.stage]}</strong><small>{item.detail}</small></span></button>)}</div>
    {(!allowedStages||allowedStages.some(stage=>stage.endsWith('-review'))) && targetSceneKey && scenes.some(scene => scene.stableKey === targetSceneKey) && adaptation.status !== 'complete' && <div className="screenplay-author-review-actions">
      <button hidden={!!allowedStages&&!allowedStages.includes('grounding-review')} onClick={() => void confirmNoIssues('grounding')} disabled={busy || !!candidate}><Check className="h-4 w-4" />作者确认来源无问题</button>
      <button hidden={!!allowedStages&&!allowedStages.includes('dramaturgy-review')} onClick={() => void confirmNoIssues('dramaturgy')} disabled={busy || !!candidate}><Check className="h-4 w-4" />作者确认戏剧无问题</button>
    </div>}
    {candidate && <div className="screenplay-professional-candidate"><header><strong>{STAGE_LABELS[candidate.stage]}{candidate.recovering ? ' · 原采纳待完成' : '候选 · 尚未写入'}</strong><span>{candidate.recovering ? '已冻结作者修改，继续完成原采纳' : '可编辑后确认'}</span></header>
      {candidateItems.length > 0 && <div className="screenplay-candidate-items">{candidateItems.map((item: any, index) => <label key={item.stableKey ?? index}><input type="checkbox" disabled={candidate.recovering || busy} checked={acceptedKeys.has(item.stableKey)} onChange={event => setAcceptedKeys(current => { const next = new Set(current); if (event.target.checked) next.add(item.stableKey); else next.delete(item.stableKey); return next })} /><span><strong>{item.stableKey}</strong><small>{item.statement ?? item.rationale ?? item.objective ?? item.purpose ?? item.problem ?? ''}</small></span></label>)}</div>}
      {['targeted-rewrite','scene-draft'].includes(candidate.stage)&&scenes.find(scene=>scene.stableKey===targetSceneKey)&&<details open><summary>对照当前已保存场景</summary><pre>{scenes.find(scene=>scene.stableKey===targetSceneKey)?.blocks.map(block=>block.type==='character'?block.name:block.text).join('\n\n')}</pre></details>}
      <fieldset disabled={candidate.recovering || busy}><ScreenplayFields value={JSON.parse(candidate.text)} onChange={value=>setCandidate({...candidate,text:JSON.stringify(value,null,2)})}/></fieldset>
      <details><summary>查看结构化数据</summary><pre>{candidate.text}</pre></details>
      <footer><button onClick={() => void reject()} disabled={busy || candidate.recovering}><X className="h-4 w-4" />放弃</button><button className="primary" onClick={() => void accept()} disabled={busy}><Check className="h-4 w-4" />{candidate.recovering ? '继续完成已确认的采纳' : '作者确认并采纳'}</button></footer>
    </div>}
    {issues.length > 0 && <details className="screenplay-review-list"><summary>审查问题（{issues.filter(issue => issue.status === 'open').length} 项开放）</summary>{issues.filter(issue=>!allowedStages||(allowedStages.includes('grounding-review')?['grounding','continuity','format'].includes(issue.category):issue.category==='dramaturgy')).map(issue => <article key={issue.id} className={issue.status}><div><strong>{issue.category} · {issue.severity} · {issue.sceneKey}</strong><small>{issue.blockId ? `block ${issue.blockId}` : '整场'}</small></div><p>{issue.problem}</p><blockquote>{issue.evidence}</blockquote>{issue.status === 'open' && <footer><label><input type="checkbox" aria-label={`修订问题 ${issue.stableKey}`} disabled={issue.sceneKey!==targetSceneKey} checked={issue.sceneKey===targetSceneKey&&!excludedIssues.has(issue.stableKey)} onChange={e=>setExcludedIssues(current=>{const next=new Set(current);if(e.target.checked)next.delete(issue.stableKey);else next.add(issue.stableKey);return next})}/>纳入本轮修订</label><button onClick={() => void (async () => { try { beforeAction?.(); const reason=await dialog.prompt({title:'记录驳回理由',message:'说明为什么保留当前场景，此说明会随作品保存。',confirmText:'记录并驳回'}); if(!reason?.trim())return; await saveScreenplayAuthorDraft(scope,`issue:${issue.stableKey}:dismissal`,reason); await updateScreenplayReviewIssueStatusV1({ scope, issueId: issue.id!, status: 'dismissed' }); await reload(); await onChanged() } catch(c) { setError(String(c)) } })()}>作者驳回</button></footer>}</article>)}</details>}
    {error && <p className="screenplay-pipeline-error" role="alert"><RefreshCw className="h-4 w-4" />{error}</p>}
  </section>
}
