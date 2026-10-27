import { useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import * as design from '../../lib/ttrpg/open-authoring-design'
import { readAgentRunV1 } from '../../lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../lib/memory/artifact-store'
import { useAIConfigStore } from '../../stores/ai-config'
import { resolveRequestConfig } from '../../lib/ai/client'
import { isAIConfigReady, getAIConfigRequiredMessage } from '../../lib/ai/config-readiness'
import { registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import { downloadTextFile } from '../../lib/export/text-export'
import Comparison, { OPEN_DESIGN_SECTION_LABELS as labels } from './TtrpgOpenDesignComparison'

type Section = design.TtrpgOpenAuthoringDesignSectionV1
type Review = Awaited<ReturnType<typeof design.readTtrpgOpenAuthoringDesignReviewV1>>
type Adoption = NonNullable<Awaited<ReturnType<typeof design.readTtrpgOpenAuthoringDesignAdoptionV1>>>
const terminal = new Set(['completed', 'cancelled', 'failed'])
const statusLabels: Record<string, string> = { planned: '已准备', running: '执行中', paused: '等待核对原结果', recovering: '恢复中',
  awaiting_confirmation: '等待本人确认', verifying: '等待补回执', completed: '已完成', cancelled: '已结束', failed: '失败' }
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const defaultSections = (facts: boolean): Section[] => ['situationTemplates', 'openingSituationKeys', 'effectPlanTemplates', 'pressure', ...(facts ? ['factProposals' as const] : [])]

/** S2 only. All model and canonical writes enter the existing product facade.
 * Local choices grant no permission; only the explicit adoption action writes. */
export default function TtrpgOpenDesignAssistant({ scope, revision, hasUnsavedEdits, needsInitialFacts, beforeGenerate, beforeAdopt, onAdopted }: {
  scope: WorkspaceScope; revision: number; hasUnsavedEdits: boolean
  needsInitialFacts: boolean
  beforeGenerate: () => Promise<number>; beforeAdopt: () => Promise<void>; onAdopted: () => Promise<void>
}) {
  const config = useAIConfigStore(state => state.config)
  const [instruction, setInstruction] = useState(''), [sections, setSections] = useState<Section[]>(() => defaultSections(needsInitialFacts))
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof design.listTtrpgOpenAuthoringDesignRunsV1>>>([])
  const [runId, setRunId] = useState<number | null>(null), [review, setReview] = useState<Review | null>(null)
  const [adoption, setAdoption] = useState<Adoption | null>(null), [raw, setRaw] = useState<string | null>(null)
  const [selection, setSelection] = useState<Record<string, string>>({}), [confirmed, setConfirmed] = useState<string[]>([])
  const [pending, setPending] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const [requestDirty, setRequestDirty] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [refresh, setRefresh] = useState(0)
  const [unknownAck, setUnknownAck] = useState(false), [factPage, setFactPage] = useState(0)
  const [frozenOutputBudget, setFrozenOutputBudget] = useState<number | null>(null)
  const requestEdited = useRef(false)
  useEffect(() => { if (!requestEdited.current) setSections(defaultSections(needsInitialFacts)) }, [needsInitialFacts])
  const live = useRef(true), epoch = useRef(0), activeOperation = useRef(false), ownFlush = useRef(false)
  const blocked = useRef(false), pendingRef = useRef(false), controller = useRef<AbortController | null>(null), loadedCandidate = useRef('')
  pendingRef.current = pending; blocked.current = pending || busy
  useEffect(() => {
    const generation = epoch, transport = controller
    live.current = true
    return () => { live.current = false; generation.current++; transport.current?.abort() }
  }, [])
  useEffect(() => registerPendingDraftFlusherV1(() => {
    if (!ownFlush.current && (blocked.current || activeOperation.current)) throw new Error('请先处理设计请求或明确放弃本页未保存的选择，再切换页面')
  }), [])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (blocked.current || activeOperation.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])
  useEffect(() => {
    const generation = epoch, token = ++generation.current
    const current = () => live.current && token === generation.current
    setLoading(true)
    setFrozenOutputBudget(null)
    void (async () => {
      const history = await design.listTtrpgOpenAuthoringDesignRunsV1(scope)
      if (!current()) return
      setRuns(history)
      const id = runId ?? history[0]?.id
      if (id == null) { setReview(null); setAdoption(null); setRaw(null); return }
      if (runId == null) setRunId(id)
      const snapshot = await readAgentRunV1(scope, id)
      const saved = await design.readTtrpgOpenAuthoringDesignAdoptionV1({ scope, runId: id })
      const event = snapshot.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.stepId === design.TTRPG_OPEN_DESIGN_STEP_V1 && event.payload.artifactKind === 'raw-response')
      const original = event?.type === 'evidence.artifact.recorded' ? await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'raw-response', contentHash: event.payload.contentHash }) : null
      // Unknown/interrupted requests recover only after the author's explicit action.
      const result = snapshot.events.some(event => event.type === 'candidate.persisted') || saved
        ? await design.readTtrpgOpenAuthoringDesignReviewV1({ scope, runId: id }) : null
      if (!current()) return
      setAdoption(saved); setReview(result); setRaw(original); setFrozenOutputBudget(snapshot.contract.budget.maxOutputTokens)
      if (result && result.candidate.candidateHash !== loadedCandidate.current) {
        loadedCandidate.current = result.candidate.candidateHash
        setSelection(Object.fromEntries(result.request.sections.map(key => [key, result.candidate.proposals?.proposals[0]?.proposalKey ?? ''])))
        setConfirmed([]); setFactPage(0)
      }
    })().catch(error => { if (current()) { setReview(null); setError(message(error)) } })
      .finally(() => { if (current()) setLoading(false) })
    return () => { generation.current++ }
  }, [scope, revision, runId, refresh])
  const selectedId = runId ?? runs[0]?.id, selectedRun = runs.find(item => item.id === selectedId)
  const composition = useMemo(() => {
    if (!review?.candidate.proposals) return { value: null, error: '' }
    try { return { value: design.composeTtrpgOpenAuthoringDesignV1(review.candidate.proposals, selection, {
      request: review.request, base: review.source.settings.openAuthoring, readWorldResourceKeys: review.readWorldResourceKeys, ruleRefs: review.ruleRefs }), error: '' } }
    catch (error) { return { value: null, error: message(error) } }
  }, [review, selection])
  const oldFactKeys = new Set(review?.source.settings.openAuthoring.factPolicy.map(item => item.fact.factKey) ?? [])
  const facts = composition.value?.factPolicy.filter(item => !oldFactKeys.has(item.fact.factKey)) ?? []
  const mark = () => { requestEdited.current = true; pendingRef.current = true; blocked.current = true; setPending(true); setError('') }
  const choose = (next: Record<string, string>) => { mark(); setSelection(next); setConfirmed([]); setFactPage(0) }
  // The parent's preflight invokes the synchronous flusher once. Exemption ends
  // before awaiting it, so another navigation cannot borrow our authorization.
  const preflight = <T,>(fn: () => Promise<T>) => {
    ownFlush.current = true
    try { return fn() } finally { ownFlush.current = false }
  }
  const act = async (action: () => Promise<void>) => {
    if (activeOperation.current) return
    activeOperation.current = true; blocked.current = true; setBusy(true); setError(''); setNotice('')
    try { await action() } catch (error) { if (live.current) setError(message(error)) }
    finally { activeOperation.current = false; if (live.current) { setBusy(false); blocked.current = pendingRef.current; setRefresh(value => value + 1) } }
  }
  const clearPending = () => { pendingRef.current = false; blocked.current = activeOperation.current; setPending(false); setRequestDirty(false) }
  const generate = () => void act(async () => {
    const resolved = resolveRequestConfig(config, { category: 'authoring.ttrpg-open-design', projectId: scope.projectId })
    if (!isAIConfigReady(resolved.config)) throw new Error(getAIConfigRequiredMessage(resolved.config))
    const request = design.parseTtrpgOpenAuthoringDesignRequestV1({ schema: 'storyforge.ttrpg-open-authoring-design-request', version: 1, instruction, sections })
    const latestRevision = await preflight(beforeGenerate)
    if (!live.current) return
    const abort = new AbortController(); controller.current = abort
    try {
      await design.generateTtrpgOpenAuthoringDesignCandidateV1({ scope, revision: latestRevision, request, aiConfig: config, signal: abort.signal,
        onPrepared: id => { if (live.current) { setRunId(id); clearPending() } } })
      if (live.current) setNotice('三个方向已保存为候选。请比较内容并明确选择。')
    } finally { if (controller.current === abort) controller.current = null }
  })
  const adopt = () => void act(async () => {
    if (!review || selectedId == null || !composition.value || hasUnsavedEdits || requestDirty) throw new Error('请先处理当前未保存修改或未发送要求，并重新检查原候选')
    await preflight(beforeAdopt)
    if (!live.current) return
    const result = await design.adoptTtrpgOpenAuthoringDesignV1({ scope, runId: selectedId, candidateHash: review.candidate.candidateHash,
      selection, confirmedFactKeys: confirmed, confirmation: 'confirm-design-selection-v1' })
    if (!live.current) return
    setAdoption(result.adoption); clearPending()
    setNotice(result.receiptPending ? '设计已保存，终态回执待补齐。请使用补回执，避免重复保存。' : '所选设计已保存到本作品的开放草稿。')
    await onAdopted()
  })
  const canAdopt = !!review?.adoptionAllowed && review.current && review.runStatus === 'awaiting_confirmation' && !!composition.value && !adoption && !hasUnsavedEdits && !requestDirty
  const missingInitialFacts = needsInitialFacts && sections.includes('situationTemplates') && !sections.includes('factProposals')
  return <section className="md:col-span-2 ttrpg-open-design-assistant" data-testid="ttrpg-open-design-assistant">
    <h4>与 AI 起草开放设计</h4>
    <p>使用本作品已保存的世界出口、规则与本桌边界，一次请求三个方向。只在确认选择后保存草稿；正式开始制作仍在后续页面。</p>
    <fieldset disabled={busy || loading}>
      <label>本次设计要求<textarea aria-label="本次设计要求" maxLength={5000} rows={3} value={instruction} onChange={event => { mark(); setRequestDirty(true); setInstruction(event.target.value) }}/></label>
      <fieldset><legend>本次要起草的分区</legend>{design.TTRPG_OPEN_AUTHORING_DESIGN_SECTIONS_V1.map(key => <label className="ttrpg-check" key={key}>
        <input type="checkbox" checked={sections.includes(key)} onChange={event => { mark(); setRequestDirty(true); setSections(previous => event.target.checked ? [...previous, key] : previous.filter(item => item !== key)) }}/>{labels[key]}</label>)}</fieldset>
      {missingInitialFacts && <p>空白作品的局势需要事实来源，请勾选“新增世界事实”。生成后仍需本人逐条核对。</p>}
      <p>本次最多调用 1 次模型；输出验收上限 {design.ttrpgOpenDesignOutputBudgetV1(sections).toLocaleString('zh-CN')} tokens。超出时保留原回答，不能采用。</p>
      <button className="lf-action lf-action-primary" type="button" disabled={!instruction.trim() || !sections.length || missingInitialFacts || runs.some(item => !terminal.has(item.status))} onClick={generate}>生成三个开放设计方向</button>
      {runs.some(item => !terminal.has(item.status)) && <p>先查看并处理原请求，之后才能发起新的请求。</p>}
      {pending && <button className="lf-action" type="button" onClick={() => {
        setInstruction(''); setConfirmed([]); setFactPage(0)
        setSelection(Object.fromEntries(review?.request.sections.map(key => [key, review.candidate.proposals?.proposals[0]?.proposalKey ?? '']) ?? [])); clearPending()
      }}>放弃本页未保存的要求与选择</button>}
      {!!runs.length && <label>本作品的设计请求<select aria-label="本作品的设计请求" disabled={pending} value={selectedId ?? ''} onChange={event => {
        epoch.current++; loadedCandidate.current = ''; setReview(null); setAdoption(null); setRaw(null); setFrozenOutputBudget(null); setUnknownAck(false); setError(''); setRunId(Number(event.target.value))
      }}>{runs.map(item => <option key={item.id} value={item.id}>请求 {item.id} · {statusLabels[item.status] ?? item.status} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>}
      <button className="lf-action" type="button" onClick={() => setRefresh(value => value + 1)}>刷新原请求状态</button>
    </fieldset>
    {busy && <p role="status">正在处理本次操作。{controller.current && <button className="lf-action" type="button" onClick={() => controller.current?.abort()}>停止本机等待</button>}</p>}
    {loading && <p role="status">正在读取原记录…</p>}
    {selectedRun && <p>原请求状态：{statusLabels[selectedRun.status] ?? selectedRun.status}</p>}
    {selectedRun && frozenOutputBudget != null && <p>原请求冻结的输出验收上限：{frozenOutputBudget.toLocaleString('zh-CN')} tokens。</p>}
    {raw != null && <details><summary>查看与下载模型原始回答</summary><pre className="ttrpg-design-json">{raw}</pre>
      <button className="lf-action" type="button" onClick={() => downloadTextFile(raw, `跑团设计请求-${selectedId}-原始回答.txt`, 'text/plain')}>下载原始回答</button></details>}
    {review && !adoption && <>
      <p>这份候选的原要求：{review.request.instruction}</p>
      {requestDirty && <p role="status">上方还有未发送的新要求。请先放弃本页未保存的要求与选择，再确认这份原候选。</p>}
      {terminal.has(review.runStatus) && <p role="status">原请求已结束，内容保留参考。</p>}
      {!review.adoptionAllowed && <p role="status">这份历史请求只允许参考。请明确结束原请求后，以当前权限重新起草。</p>}
      {!review.current && <p role="alert">原草稿、规则或来源已变化，这份设计只可参考。{review.staleReason}</p>}
      {review.handoffPending && <p role="status">原回答已保存在本作品，本机副本的交接回执仍待核对；可点击“读取原回答并恢复候选”再次交接，不会重新生成。</p>}
      {hasUnsavedEdits && <p role="status">本窗口还有人工修改，请先保存；原候选不会覆盖这些修改。</p>}
      <p>原草稿版本 {review.source.revision}；实际读取 {review.readWorldResourceKeys.length} 项世界资源。分区混合后仍会核对局部引用和来源。</p>
      <div className="ttrpg-design-proposals">{review.candidate.proposals?.proposals.map(proposal => <article key={proposal.proposalKey} className="ttrpg-design-proposal">
        <h5>{proposal.title}</h5><p>{proposal.pitch}</p><Comparison patch={proposal.patch}/>
        <button className="lf-action" type="button" disabled={busy || loading || !!adoption} onClick={() => choose(Object.fromEntries(review.request.sections.map(key => [key, proposal.proposalKey])))}>选择整套：{proposal.title}</button>
      </article>)}</div>
      {!review.candidate.proposals && <p role="alert">原回答未通过候选检查：{review.candidate.artifact.issues.map(issue => issue.message).join('；')}。原草稿保持原样。</p>}
      {review.candidate.proposals && <fieldset disabled={busy || loading || !!adoption}><legend>比较后选择分区</legend>
        {review.request.sections.map(key => <label key={key}>{labels[key]}<select aria-label={`选择${labels[key]}来源`} value={selection[key] ?? ''} onChange={event => choose({ ...selection, [key]: event.target.value })}>
          {review.candidate.proposals!.proposals.map(item => <option key={item.proposalKey} value={item.proposalKey}>{item.title}</option>)}</select></label>)}
        {composition.error && <p role="alert">组合未通过检查：{composition.error}</p>}
        {!!facts.length && <section><h5>逐条核对选中的新增事实</h5><p>只有勾选的新增事实会记录为本人确认。未勾选的保留为待确认草稿。</p>
          {facts.slice(factPage * 25, factPage * 25 + 25).map(item => <div key={item.fact.factKey}><label><input type="checkbox" checked={confirmed.includes(item.fact.factKey)} onChange={event => {
            mark(); setConfirmed(previous => event.target.checked ? [...previous, item.fact.factKey] : previous.filter(key => key !== item.fact.factKey))
          }}/>我确认新增事实 {item.fact.factKey}：{item.fact.subjectRef} · {item.fact.predicateKey} · {JSON.stringify(item.fact.canonicalValue)}</label>
            <details><summary>核对事实范围与字段来源</summary><pre className="ttrpg-design-json">{JSON.stringify(item.fact, null, 2)}</pre></details></div>)}
          {facts.length > 25 && <div><button type="button" className="lf-action" disabled={factPage === 0} onClick={() => setFactPage(value => value - 1)}>上一页新增事实</button>
            <span>{factPage + 1}/{Math.ceil(facts.length / 25)}</span><button type="button" className="lf-action" disabled={(factPage + 1) * 25 >= facts.length} onClick={() => setFactPage(value => value + 1)}>下一页新增事实</button></div>}
        </section>}
        <button className="lf-action lf-action-primary" type="button" disabled={!canAdopt} onClick={adopt}>确认选择并保存到开放草稿</button>
      </fieldset>}
    </>}
    {adoption && <section role="status"><p>这份设计已保存到草稿版本 {adoption.targetRevision}。当前页面读取作者最新草稿。</p>
      {selectedRun?.status !== 'completed' && <button className="lf-action" type="button" disabled={busy || loading} onClick={() => void act(async () => {
        const result = await design.reconcileTtrpgOpenAuthoringDesignAdoptionV1({ scope, runId: adoption.runId })
        if (live.current) setNotice(result.receiptPending ? `草稿已保存，回执仍待补齐：${result.terminalError}` : '原采纳回执已补齐；保留作者之后的修改。')
      })}>补齐原采纳回执</button>}</section>}
    {selectedRun && !terminal.has(selectedRun.status) && !adoption && <fieldset disabled={busy || loading}>
      {(['paused', 'recovering', 'running'].includes(selectedRun.status) || review?.handoffPending) && <><p>刷新或停止等待不会重新发送。已绑定的本机请求只读取原服务回执；其他历史请求只读取已保存回答。</p>
        <button className="lf-action" type="button" onClick={() => void act(async () => {
          const result = await design.recoverTtrpgOpenDesignOriginalReceiptV1({ scope, runId: selectedRun.id })
          if (live.current) setNotice(result.candidate ? `已从原回答恢复候选，没有重新请求模型。${result.handoffPending ? '本机副本交接待核对，原回答已保存。' : ''}`
            : result.status === 'accepted' || result.status === 'running' ? '原本机请求仍在执行，请稍后明确刷新；没有重发。'
              : '原本机请求未完整成功，原回执及部分回答已保留；没有生成候选或重发。')
        })}>读取原回答并恢复候选</button></>}
      {['paused', 'running', 'recovering'].includes(selectedRun.status) && <label><input type="checkbox" checked={unknownAck} onChange={event => setUnknownAck(event.target.checked)}/>我已核对原请求，仍需结束这份结果未知的等待；服务端可能已经处理</label>}
      <button className="lf-action" type="button" disabled={['paused', 'running', 'recovering'].includes(selectedRun.status) && !unknownAck} onClick={() => void act(async () => {
        await design.dismissTtrpgOpenAuthoringDesignRequestV1({ scope, runId: selectedRun.id, confirmation: 'discard-design-request-v1', acknowledgeUnknown: unknownAck })
        if (live.current) { clearPending(); setNotice('这份请求已明确结束，原回答与记录保留。') }
      })}>结束这份请求，不采用候选</button>
    </fieldset>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>
}
