import { useCallback, useEffect, useRef, useState } from 'react'
import { useAIConfigStore } from '../../stores/ai-config'
import type { TtrpgOpenEntityDeskInputV1 } from '../../lib/ttrpg/open-entity-desk'
import type { TtrpgOpenSourceRefV1 } from '../../lib/ttrpg/open-coordination'
import { readTtrpgOpenSettledViewV1 } from '../../lib/ttrpg/open-read-conflict'
import { readTtrpgOpenEntityModelDeskV1, requestTtrpgOpenEntityModelDeskV1, resumeTtrpgOpenEntityModelDeskV1,
  acceptTtrpgOpenEntityModelDeskV1, repairTtrpgOpenEntityModelDeskV1, finishTtrpgOpenEntityModelDeskV1,
  closeTtrpgOpenEntityModelWindowDeskV1 } from '../../lib/ttrpg/open-entity-model-desk'

type Desk = Awaited<ReturnType<typeof readTtrpgOpenEntityModelDeskV1>>
const audiences = { public: '公开', party: '本次队伍', private: '指定接收者', 'gm-only': '仅主持', restricted: '受限历史' }
const statuses = { prepared: '尚未发送', dispatched: '等待原回答', succeeded: '原回答已保存', failed: '原请求已结束', unknown: '结果及费用待确认' }
const kinds = { actor: 'NPC', location: '地点', item: '物品' }
export default function TtrpgOpenEntityModelPanel(props: { input: TtrpgOpenEntityDeskInputV1; oracleSourceRef?: TtrpgOpenSourceRefV1;
  sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void> }) {
  const config = useAIConfigStore(s => s.config), [storedPage, setPage] = useState<Desk>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [requestKey, setRequestKey] = useState('')
  const [scopeKey, setScopeKey] = useState(''), [templates, setTemplates] = useState<string[]>([]), [placements, setPlacements] = useState<string[]>([])
  const [cost, setCost] = useState('0.10'), [allowed, setAllowed] = useState(false), [reviewed, setReviewed] = useState(false)
  const [sending, setSending] = useState(false), [stopping, setStopping] = useState(false)
  const live = useRef(true), revision = useRef(0), locked = useRef(false), stopLock = useRef(false)
  const controller = useRef<AbortController | null>(null), activeRequest = useRef<string | null>(null), stopCommitted = useRef(false)
  const { scope: { projectId, worldId, workId }, sessionId, viewerKey } = props.input
  const ownerKey = [projectId, worldId, workId, sessionId, viewerKey].join(':'), currentOwner = useRef(ownerKey), pageOwner = useRef(ownerKey)
  currentOwner.current = ownerKey
  const page = pageOwner.current === ownerKey ? storedPage : null
  const displayError = pageOwner.current === ownerKey ? error : '', displayNotice = pageOwner.current === ownerKey ? notice : ''
  const stillOwned = () => live.current && currentOwner.current === ownerKey
  const oracleSession = props.oracleSourceRef?.sessionKey, oracleSequence = props.oracleSourceRef?.sequence
  const input = useCallback(() => ({ scope: { projectId, worldId, workId }, sessionId, viewerKey }), [projectId, worldId, workId, sessionId, viewerKey])
  const load = useCallback(async () => {
    const token = ++revision.current
    try {
      const next = await readTtrpgOpenSettledViewV1(() => readTtrpgOpenEntityModelDeskV1({ ...input(), ...(requestKey ? { requestKey } : {}) }), () => live.current && currentOwner.current === ownerKey && token === revision.current)
      if (next !== undefined && live.current && currentOwner.current === ownerKey && token === revision.current) { pageOwner.current = ownerKey; setPage(next) }
    } catch (cause) { if (live.current && currentOwner.current === ownerKey && token === revision.current) { pageOwner.current = ownerKey; setPage(null); setError(cause instanceof Error ? cause.message : '读取本次 AI 起草失败，请保留原记录。') } }
  }, [input, requestKey, ownerKey])
  useEffect(() => {
    live.current = true; locked.current = false; stopLock.current = false; stopCommitted.current = false
    setPage(null); setError(''); setNotice(''); setRequestKey(''); setSending(false); setStopping(false)
    return () => { live.current = false; revision.current += 1; controller.current?.abort(); activeRequest.current = null }
  }, [input])
  useEffect(() => { void load(); return () => { revision.current += 1 } }, [load, props.sequence])
  useEffect(() => { setScopeKey(''); setTemplates([]); setPlacements([]) }, [input, oracleSession, oracleSequence])
  useEffect(() => { setAllowed(false); setReviewed(false) }, [input, config, cost, scopeKey, templates, placements, oracleSession, oracleSequence, props.sequence])
  useEffect(() => { setReviewed(false) }, [requestKey, page?.request?.candidate?.candidateHash])
  const act = (job: () => Promise<unknown>, success: string) => props.perform(async () => {
    if (locked.current) return
    locked.current = true; stopCommitted.current = false; setError(''); setNotice('')
    try { await job(); if (stillOwned() && !stopCommitted.current) { setNotice(success); setReviewed(false) } }
    catch (cause) { if (stillOwned() && !stopCommitted.current) setError(cause instanceof Error ? cause.message : '本次操作尚未完成，请保留原记录。') }
    finally { if (stillOwned()) { locked.current = false; await load() } }
  })
  const catalog = page?.catalog.filter(d => d.oracleSourceRef.sessionKey === oracleSession && d.oracleSourceRef.sequence === oracleSequence) ?? []
  const selected = catalog.find(d => d.scope.scopeKey === scopeKey), request = page?.request, candidate = request?.candidate
  const disabled = props.busy || stopping || Boolean(page && page.sequence !== props.sequence)
  const toggle = (key: string, values: string[], update: (v: string[]) => void) => update(values.includes(key) ? values.filter(v => v !== key) : [...values, key].sort())
  const send = (resume = false) => act(async () => {
    const abort = new AbortController(); controller.current = abort; stopCommitted.current = false
    activeRequest.current = resume && request ? request.requestKey : null; setSending(true)
    try {
      if (resume && request) await resumeTtrpgOpenEntityModelDeskV1({ ...input(), requestKey: request.requestKey, aiConfig: config, signal: abort.signal })
      else {
        if (!page || !selected || !allowed || !templates.length) throw new Error('请先选择本次原咨询、披露范围及模板，并确认预算。')
        await requestTtrpgOpenEntityModelDeskV1({ ...input(), aiConfig: config, signal: abort.signal,
          expectedSequence: page.sequence, submissionKey: crypto.randomUUID(), maximumCostUsd: Number(cost), decision: 'request-this-entity-draft',
          selection: { schema: 'storyforge.ttrpg-open-entity-model-selection', version: 1,
            oracleSourceRef: selected.oracleSourceRef, scope: selected.scope, epochInputRevision: selected.epochInputRevision,
            templateKeys: templates, placementRefs: placements },
          onPrepared: key => { if (stillOwned()) { activeRequest.current = key; setPage(null); setRequestKey(key); setReviewed(false) } } })
      }
    } finally { if (controller.current === abort) controller.current = null; if (stillOwned()) { activeRequest.current = null; setSending(false); setAllowed(false) } }
  }, '原回答已处理，请审阅保存的候选；尚未采用计划或创建对象。')
  const stop = async () => {
    if (stopLock.current || !activeRequest.current) return
    const abort = controller.current
    stopLock.current = true; setStopping(true); setError('')
    try {
      await finishTtrpgOpenEntityModelDeskV1({ ...input(), requestKey: activeRequest.current, decision: 'discard-this-entity-request-and-close-window' })
      if (stillOwned()) { stopCommitted.current = true; setNotice('本次 AI 起草已放弃，原咨询已结束；原回答及费用记录保留，没有创建对象。') }
    } catch (cause) { if (stillOwned()) setError(cause instanceof Error ? cause.message : '原停止回执尚未保存，请读取进度。') }
    finally { abort?.abort(); if (stillOwned()) { stopLock.current = false; setStopping(false); await load() } }
  }
  if (!page && !displayError && !sending) return null
  return <section data-testid="ttrpg-open-entity-model-desk" aria-label="AI 实体起草与审阅"><h3>让 AI 起草本次对象</h3>
    <p>只读取本次选定范围、模板和已有地点或持有人。回答先保存为候选；审阅采用后，仍须相关角色分别确认再创建。</p>
    {displayError && <p role="alert">{displayError}</p>}{displayNotice && <p role="status">{displayNotice}</p>}
    <button disabled={props.busy} onClick={() => { setError(''); setReviewed(false); void load() }}>读取 AI 实体起草进度</button>
    {page?.budget && <p>原咨询剩余模型次数：{page.budget.remainingCalls}；剩余预留上限：${page.budget.remainingCostUsd.toFixed(2)}。</p>}
    {page?.canRequest && <fieldset disabled={disabled}><legend>本次 AI 可读资料</legend>
      {!props.oracleSourceRef && <p>请先在“本次创建依据”中选择已保存的咨询结果。</p>}
      <label>AI 实体提案范围<select aria-label="AI 实体提案范围" value={scopeKey} onChange={e => { setScopeKey(e.target.value); setTemplates([]); setPlacements([]) }}>
        <option value="">明确选择本次范围</option>{catalog.map(d => <option key={d.scope.scopeKey} value={d.scope.scopeKey}>{audiences[d.scope.audience]}{d.recipientNames.length ? `：${d.recipientNames.join('、')}` : ''}</option>)}</select></label>
      {selected && <>
        <p>候选的每个对象都受此范围限制，不会自动扩大给其他角色。</p>
        <fieldset><legend>允许使用的冻结模板（至少一个，最多 32 个）</legend>{selected.templates.map((t, index) => <label key={t.key}><input type="checkbox" data-testid={`entity-ai-template-${t.key}`} aria-label={`AI 模板 ${index + 1}（${kinds[t.kind]}）`} disabled={!templates.includes(t.key) && templates.length >= 32} checked={templates.includes(t.key)} onChange={() => toggle(t.key, templates, setTemplates)} />{kinds[t.kind]}：{t.description}；余 {t.remaining}，每个含初始装备占 {t.instanceCost} 个名额。</label>)}</fieldset>
        <fieldset><legend>允许引用的已有地点或持有人（最多 64 个）</legend>{selected.placements.map(t => <label key={t.key}><input type="checkbox" data-testid={`entity-ai-placement-${t.key}`} aria-label={`AI 可用${t.use === 'location' ? '地点' : '库存'}：${t.name}`} disabled={!placements.includes(t.key) && placements.length >= 64} checked={placements.includes(t.key)} onChange={() => toggle(t.key, placements, setPlacements)} />{t.use === 'location' ? '地点' : '库存持有人'}：{t.name}</label>)}</fieldset>
      </>}
      <label>本次实体起草预留上限（美元）<input aria-label="实体起草预留上限" type="number" min="0" max="1000" step="0.01" value={cost} onChange={e => setCost(e.target.value)} /></label>
      <label><input type="checkbox" checked={allowed} onChange={e => setAllowed(e.target.checked)} />我同意 AI 仅按以上本次资料和预留上限起草候选。</label>
      <button disabled={!allowed || !selected || !templates.length || !cost.trim() || !Number.isFinite(Number(cost)) || Number(cost) < 0} onClick={() => void send()}>按本次选择请求 AI 起草</button>
    </fieldset>}
    {page && !page.canRequest && <p>{page.unavailable}</p>}
    {sending && <p role="status">{activeRequest.current ? '本次请求已准备，正在处理原回答。' : '正在准备本次资料和请求。'}</p>}
    {sending && activeRequest.current && <aside><p>停止会保留原回答和实际费用；未确认的结果与费用保持未知，并结束本次咨询。</p><button disabled={stopping} onClick={() => void stop()}>停止并放弃本次 AI 起草</button></aside>}
    {Boolean(page?.requests.length) && <label>原实体 AI 请求<select aria-label="原实体 AI 请求" disabled={props.busy} value={requestKey || request?.requestKey || ''} onChange={e => { revision.current += 1; setPage(null); setReviewed(false); setRequestKey(e.target.value) }}>
      {page!.requests.map((r, index) => <option key={r.requestKey} value={r.requestKey}>第 {index + 1} 次：{audiences[r.audience]} · {statuses[r.status]}</option>)}</select></label>}
    {request && <section aria-label="本次实体 AI 请求状态"><p>{statuses[request.status]}</p>
      {request.modelIdentity && <p>原模型：{request.modelIdentity.provider} / {request.modelIdentity.model}。继续时保持原模型与预算。</p>}
      {!request.local && <p>这是历史请求，仅供查阅，不恢复发送或采用权限。</p>}
      {request.canResume && <button disabled={disabled} onClick={() => void send(true)}>继续原实体 AI 请求</button>}
      {(request.canRepairResponse || request.canRepairAdoption || request.canRepairStop) && <button disabled={disabled} onClick={() => void act(() => repairTtrpgOpenEntityModelDeskV1({ ...input(), requestKey: request.requestKey }), '原请求回执已补齐；没有重新发送或创建对象。')}>补齐原实体 AI 回执</button>}
      {request.adopted && <p>本候选已保存为计划。请在待确认计划中逐人确认或明确放弃。</p>}
      {candidate && <section aria-label="原模型实体候选"><h4>原模型候选</h4><p>原范围：{audiences[candidate.audience]}{candidate.recipients.length ? `（${candidate.recipients.join('、')}）` : ''}</p>
        {candidate.items.map((proposal, index) => <article key={index}><h4>{kinds[proposal.kind]}：{proposal.name}</h4><p>{proposal.description}</p>
          {proposal.parameterValues.map((value, parameter) => <p key={parameter}>模板参数 {parameter + 1}：{value}</p>)}<p>{proposal.placement}</p></article>)}
        {!candidate.items.length && <p>本次没有可采用的实体提案；原回答保留。</p>}
        {candidate.status === 'blocked' && <p>原回答未通过检查，不能采用；请保留原记录。</p>}
        {request.canAdopt && <><label><input type="checkbox" checked={reviewed} disabled={disabled} onChange={e => setReviewed(e.target.checked)} />我已审阅以上原模型候选及本次范围，采用为待确认计划。</label>
          <button disabled={disabled || !reviewed} onClick={() => void act(() => acceptTtrpgOpenEntityModelDeskV1({ ...input(), requestKey: request.requestKey, candidateHash: candidate.candidateHash, decision: 'reviewed-this-model-entity-candidate' }), '本候选已保存为待确认计划；尚未创建对象，请分别确认。')}>采用原模型候选为待确认计划</button></>}
      </section>}
      {request.canFinish && !sending && <button disabled={disabled} onClick={() => void act(() => finishTtrpgOpenEntityModelDeskV1({ ...input(), requestKey: request.requestKey, decision: 'discard-this-entity-request-and-close-window' }), '原候选已放弃，本次咨询已结束，原回答与费用记录保留。')}>放弃本次 AI 候选并结束咨询</button>}
    </section>}
    {page?.closeWindowEpochKey && !sending && <button disabled={disabled} onClick={() => void act(() => closeTtrpgOpenEntityModelWindowDeskV1({
      ...input(), epochKey: page.closeWindowEpochKey!, decision: 'close-this-consultation-and-discard-unused-ai-drafts',
    }), '本次咨询已结束，未采用的 AI 草稿已放弃，原回答与费用记录保留。')}>结束咨询并放弃未采用的 AI 草稿</button>}
  </section>
}
