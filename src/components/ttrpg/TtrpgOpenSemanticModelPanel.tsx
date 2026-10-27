import { useCallback, useEffect, useRef, useState } from 'react'
import { useAIConfigStore } from '../../stores/ai-config'
import type { TtrpgOpenFactDeskInputV1 } from '../../lib/ttrpg/open-fact-desk'
import { readTtrpgOpenSettledViewV1 } from '../../lib/ttrpg/open-read-conflict'
import { readTtrpgOpenOracleModelDeskV1, requestTtrpgOpenOracleModelDeskV1, resumeTtrpgOpenOracleModelDeskV1,
  reviewTtrpgOpenOracleModelDeskV1, repairTtrpgOpenOracleModelDeskV1, finishTtrpgOpenOracleModelDeskV1,
  closeTtrpgOpenOracleModelWindowDeskV1 } from '../../lib/ttrpg/open-oracle-model-desk'
import { readTtrpgOpenNormalizationModelDeskV1, requestTtrpgOpenNormalizationModelDeskV1, resumeTtrpgOpenNormalizationModelDeskV1,
  reviewTtrpgOpenNormalizationModelDeskV1, repairTtrpgOpenNormalizationModelDeskV1, finishTtrpgOpenNormalizationModelDeskV1,
  closeTtrpgOpenNormalizationModelWindowDeskV1 } from '../../lib/ttrpg/open-normalization-model-desk'
import { TTRPG_FACT_AUDIENCE_LABELS_V1 as audiences } from '../../lib/ttrpg/open-fact-desk-contract'

type Desk = Awaited<ReturnType<typeof readTtrpgOpenOracleModelDeskV1>>
type Review = Parameters<typeof reviewTtrpgOpenOracleModelDeskV1>[0] | Parameters<typeof reviewTtrpgOpenNormalizationModelDeskV1>[0]
type Choice = { decision: '' | 'adopt' | 'discard'; reason: string }
const statuses = { prepared: '尚未发送', dispatched: '等待原回答', succeeded: '原回答已保存', failed: '原请求已结束', unknown: '结果及费用待确认' }
const kinds = { actor: 'NPC', location: '地点', item: '物品' }
export interface TtrpgOpenSemanticModelPanelProps { input: TtrpgOpenFactDeskInputV1; sequence: number; busy: boolean; purpose: 'oracle' | 'normalization';
  perform: (job: () => Promise<void>) => Promise<void> }
const reviewOriginal = (value: Review) => value.decision === 'reviewed-this-original-oracle-candidate' ? reviewTtrpgOpenOracleModelDeskV1(value) : reviewTtrpgOpenNormalizationModelDeskV1(value)
export default function TtrpgOpenSemanticModelPanel(props: TtrpgOpenSemanticModelPanelProps) {
  const normalization = props.purpose === 'normalization', text = (oracle: string, normalized: string) => normalization ? normalized : oracle
  const resumeDesk = normalization ? resumeTtrpgOpenNormalizationModelDeskV1 : resumeTtrpgOpenOracleModelDeskV1
  const repairDesk = normalization ? repairTtrpgOpenNormalizationModelDeskV1 : repairTtrpgOpenOracleModelDeskV1
  const config = useAIConfigStore(state => state.config), { sessionId, viewerKey, scope: { projectId, worldId, workId } } = props.input
  const owner = `${props.purpose}:${projectId}:${worldId}:${workId}:${sessionId}:${viewerKey}`, currentOwner = useRef(owner), pageOwner = useRef(owner)
  currentOwner.current = owner
  const input = useCallback(() => ({ scope: { projectId, worldId, workId }, sessionId, viewerKey }), [projectId, worldId, workId, sessionId, viewerKey])
  const finishDesk = (requestKey: string) => normalization ? finishTtrpgOpenNormalizationModelDeskV1({ ...input(), requestKey, decision: 'discard-this-normalization-instance-request-and-close-window' })
    : finishTtrpgOpenOracleModelDeskV1({ ...input(), requestKey, decision: 'discard-this-oracle-instance-request-and-close-window' })
  const closeDesk = (epochKey: string) => normalization ? closeTtrpgOpenNormalizationModelWindowDeskV1({ ...input(), epochKey, decision: 'close-this-original-normalization-window' })
    : closeTtrpgOpenOracleModelWindowDeskV1({ ...input(), epochKey, decision: 'close-this-original-oracle-window' })
  const live = useRef(true), revision = useRef(0), locked = useRef(false), stopLock = useRef(false), stopCommitted = useRef(false)
  const controller = useRef<AbortController | null>(null), activeRequest = useRef<string | null>(null)
  const previousCandidate = useRef<string | null>(null)
  const [storedPage, setPage] = useState<Desk>(null), [requestKey, setRequestKey] = useState(''), [selectionKey, setSelectionKey] = useState('')
  const [cost, setCost] = useState('0.10'), [allowed, setAllowed] = useState(false), [reviewed, setReviewed] = useState(false)
  const [interpretation, setInterpretation] = useState<'' | 'accept' | 'reject'>(''), [interpretationReason, setInterpretationReason] = useState('')
  const [choices, setChoices] = useState<Record<number, Choice>>({}), [retry, setRetry] = useState<{ owner: string; value: Review } | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [sending, setSending] = useState(false), [stopping, setStopping] = useState(false)
  const [working, setWorking] = useState(false)
  const page = pageOwner.current === owner ? storedPage : null, request = page?.request, candidate = request?.candidate
  const displayError = pageOwner.current === owner ? error : '', displayNotice = pageOwner.current === owner ? notice : ''
  const originalReview = retry?.owner === owner ? retry.value : null
  const stillOwned = () => live.current && currentOwner.current === owner
  const load = useCallback(async () => {
    const token = ++revision.current
    try {
      const next = await readTtrpgOpenSettledViewV1(() => normalization
        ? readTtrpgOpenNormalizationModelDeskV1({ ...input(), ...(requestKey ? { requestKey } : {}) })
        : readTtrpgOpenOracleModelDeskV1({ ...input(), ...(requestKey ? { requestKey } : {}) }),
        () => live.current && currentOwner.current === owner && token === revision.current)
      if (next !== undefined && live.current && currentOwner.current === owner && token === revision.current) { pageOwner.current = owner; setPage(next) }
    } catch (cause) {
      if (live.current && currentOwner.current === owner && token === revision.current) { pageOwner.current = owner; setPage(null); setError(cause instanceof Error ? cause.message : '读取原模型事实进度失败，请保留记录。') }
    }
  }, [input, owner, requestKey, normalization])
  useEffect(() => {
    live.current = true; locked.current = false; stopLock.current = false; stopCommitted.current = false
    setPage(null); setRequestKey(''); setSelectionKey(''); setCost('0.10'); setError(''); setNotice(''); setRetry(null); setSending(false); setStopping(false); setWorking(false)
    return () => { live.current = false; revision.current += 1; controller.current?.abort(); activeRequest.current = null }
  }, [input, props.purpose])
  useEffect(() => { void load(); return () => { revision.current += 1 } }, [load, props.sequence])
  useEffect(() => { setAllowed(false); setReviewed(false) }, [input, config, cost, selectionKey, props.sequence, props.purpose])
  useEffect(() => { previousCandidate.current = null; setChoices({}); setInterpretation(''); setInterpretationReason(''); setReviewed(false); setRetry(null) }, [input, requestKey, props.purpose])
  useEffect(() => {
    if (!candidate?.candidateHash || previousCandidate.current === candidate.candidateHash) return
    previousCandidate.current = candidate.candidateHash
    setChoices({}); setInterpretation(''); setInterpretationReason(''); setReviewed(false); setRetry(null)
  }, [candidate?.candidateHash])
  const act = (job: () => Promise<unknown>, success: string) => props.perform(async () => {
    if (locked.current || !stillOwned()) return
    locked.current = true; stopCommitted.current = false; setWorking(true); setError(''); setNotice('')
    try { await job(); if (stillOwned() && !stopCommitted.current) { setNotice(success); setReviewed(false) } }
    catch (cause) { if (stillOwned() && !stopCommitted.current) setError(cause instanceof Error ? cause.message : '原操作尚未完成，请读取进度。') }
    finally { if (stillOwned()) { await load(); locked.current = false; setWorking(false) } }
  })
  const selectionId = (row: NonNullable<Desk>['catalog'][number]) => { const ref = normalization ? row.reviewSourceRef : row.oracleSourceRef; return ref ? `${ref.sessionKey}:${ref.sequence}` : '' }
  const selected = page?.catalog.find(row => selectionId(row) === selectionKey)
  const disabled = props.busy || working || stopping || Boolean(page && page.sequence !== props.sequence)
  const send = (resume = false) => act(async () => {
    const abort = new AbortController(); controller.current = abort; activeRequest.current = resume && request ? request.requestKey : null; setSending(true)
    try {
      if (resume && request) await resumeDesk({ ...input(), requestKey: request.requestKey, aiConfig: config, signal: abort.signal })
      else {
        if (!page || !selected || !allowed) throw new Error('请明确选择原咨询、资料范围与一次请求的预留上限。')
        const onPrepared = (key: string) => {
            if (!stillOwned()) throw new Error('当前身份已变化；保留原已准备请求，不继续发送。')
            activeRequest.current = key; setPage(null); setRequestKey(key); setReviewed(false)
          }
        const common = { ...input(), aiConfig: config, signal: abort.signal, expectedSequence: page.sequence, submissionKey: crypto.randomUUID(),
          snapshotHash: selected.snapshotHash, maximumCostUsd: Number(cost), onPrepared }
        if (normalization) {
          if (!selected.reviewSourceRef || !selected.reviewHash) throw new Error('请重新读取准确原已接受解释。')
          await requestTtrpgOpenNormalizationModelDeskV1({ ...common, reviewSourceRef: selected.reviewSourceRef, reviewHash: selected.reviewHash, decision: 'request-this-normalization-instance-candidate' })
        } else await requestTtrpgOpenOracleModelDeskV1({ ...common, oracleSourceRef: selected.oracleSourceRef, decision: 'request-this-oracle-instance-candidate' })
      }
    } finally {
      if (controller.current === abort) controller.current = null
      if (stillOwned()) { activeRequest.current = null; setSending(false); setAllowed(false) }
    }
  }, text('原回答已保存为候选；请审阅完整解释和每条事实。', '原解释保留，整理回答已保存为候选；请逐项决定本次事实。'))
  const stop = async () => {
    if (stopLock.current || !activeRequest.current || !stillOwned()) return
    const abort = controller.current; stopLock.current = true; setStopping(true); setError('')
    let saved = false
    try {
      await finishDesk(activeRequest.current)
      saved = true
      if (stillOwned()) { stopCommitted.current = true; setNotice('原请求已停止并结束窗口；回答和费用记录保留，没有确认事实。') }
    } catch (cause) { if (stillOwned()) setError(cause instanceof Error ? cause.message : '原停止决定尚未保存，请读取后重试。') }
    finally { if (saved) abort?.abort(); if (stillOwned()) { stopLock.current = false; setStopping(false); await load() } }
  }
  const facts = candidate?.facts
  const choicesReady = Boolean(candidate && facts && interpretation && (interpretation !== 'reject' || interpretationReason.trim())
    && facts.every(row => choices[row.index]?.decision && (choices[row.index].decision !== 'discard' || choices[row.index].reason.trim())
      && (interpretation !== 'reject' || choices[row.index].decision === 'discard')))
  const submitOriginalReview = () => {
    if (locked.current || !request || !candidate || !reviewed || !choicesReady || !interpretation) return
    const value: Review = { ...input(), requestKey: request.requestKey, candidateHash: candidate.candidateHash, interpretationDecision: interpretation,
      interpretationReason: interpretation === 'reject' ? interpretationReason.trim() : null, decision: normalization ? 'reviewed-this-original-normalization-candidate' : 'reviewed-this-original-oracle-candidate',
      choices: facts!.map(row => ({ proposalIndex: row.index, decision: choices[row.index].decision as 'adopt' | 'discard',
        reason: choices[row.index].decision === 'discard' ? choices[row.index].reason.trim() : null })) }
    setRetry({ owner, value })
    return act(async () => { await reviewOriginal(value); if (stillOwned()) setRetry(null) }, text('本版本解释与逐项决定已保存；只有明确采用的事实进入本局。', '原解释保持，本次逐项决定已保存；只有明确采用的事实进入本局。'))
  }
  if (!page && !displayError && !sending && !originalReview) return null
  return <details className="sf-open-table-card sf-open-fact-desk" data-testid={normalization ? 'ttrpg-open-normalization-model-desk' : 'ttrpg-open-oracle-model-desk'}><summary>{text('依据原咨询，让 AI 拟定本局事实', '整理已接受的原解释为事实')}</summary>
    <p>{text('仅用于本局已创建对象的身份、名称和原创建来源。原咨询结果不变；回答先成为候选，逐项审阅后才保存事实。', '明确选择已接受的原解释；原解释和原弃用决定保持。本次 AI 只整理事实，仍须逐项审阅后另行确认，不会自动发起请求。')}</p>
    {displayError && <p role="alert">{displayError}</p>}{displayNotice && <p role="status">{displayNotice}</p>}
    <button disabled={props.busy || working || sending} onClick={() => { setError(''); setReviewed(false); void load() }}>{text('读取原模型事实进度', '读取原事实整理进度')}</button>
    {page?.unavailableSources ? <p>有 {page.unavailableSources} 条历史解释不满足当前范围或原来源合同，未作为可选来源；原记录保留。</p> : null}
    {page?.canRequest && <fieldset disabled={disabled}><legend>{text('本次明确选择的模型资料', '本次明确选择的已接受解释')}</legend>
      <label>{text('用于模型事实的原咨询', '用于事实整理的原解释')}<select aria-label={text('用于模型事实的原咨询', '用于事实整理的原解释')} value={selectionKey} onChange={event => { setSelectionKey(event.target.value); setAllowed(false) }}>
        <option value="">{text('明确选择已保存的咨询', '明确选择已接受的原解释')}</option>{page.catalog.map(row => <option key={selectionId(row)} value={selectionId(row)}>{row.question}（{audiences[row.audience]}）</option>)}</select></label>
      {selected && <section aria-label={text('本次模型可读对象', '本次整理可读对象')}><p>本次范围：{audiences[selected.audience]}。{selected.audience === 'party' ? '本次全队角色' : '本次活动角色'}：{selected.recipients.join('、')}。</p>
        {selected.audience === 'gm-only' && <p>本次资料仅供主持处理，不向队员披露。</p>}
        {normalization && <section aria-label="本次沿用的原解释与决定"><h4>已接受的原解释</h4><p>{selected.interpretation}</p>
          {selected.discarded?.map((row, index) => <p key={index}>原弃用提案 {index + 1}：{row.detail}；原原因：{row.reason}。</p>)}
          <p>模型不能改写这段解释，也不能重新提出原来弃用的同一事实。</p></section>}
        {selected.entities.map((row, index) => <p key={index}>{kinds[row.kind]}：{row.name}；原创建范围：{audiences[row.audience]}{row.recipients.length ? `（${row.recipients.join('、')}）` : ''}</p>)}
        <p>对象身份不提供当前位置、库存、装备或其他机械属性；原权限保持。</p></section>}
      <label>{text('本次模型事实预留上限（美元）', '本次事实整理预留上限（美元）')}<input aria-label={text('模型事实预留上限', '事实整理预留上限')} type="number" min="0" max={page.maximumCostUsd} step="0.01" value={cost} onChange={event => setCost(event.target.value)} /></label>
      <label><input type="checkbox" checked={allowed} onChange={event => setAllowed(event.target.checked)} />{text('我同意 AI 按以上原咨询、可读对象和预留上限请求一次候选。', '我同意 AI 按以上原已接受解释、原决定、可读对象和预留上限请求一次事实整理候选。')}</label>
      <button disabled={!selected || !allowed || !cost.trim() || !Number.isFinite(Number(cost)) || Number(cost) < 0 || Number(cost) > page.maximumCostUsd} onClick={() => void send()}>{text('按本次选择请求事实候选', '按本次选择请求事实整理候选')}</button>
    </fieldset>}
    {page && !page.canRequest && <p>{page.unavailable}</p>}
    {sending && <p role="status">{activeRequest.current ? '原请求已准备，正在处理本次回答。' : '正在准备本次资料。'}</p>}
    {sending && activeRequest.current && <aside><p>停止保留原回答；结果或费用无法确认时保持未知，并结束原窗口。</p><button disabled={stopping} onClick={() => void stop()}>{text('停止本次事实候选请求', '停止本次事实整理请求')}</button></aside>}
    {Boolean(page?.requests.length) && <label>{text('原模型事实请求', '原事实整理请求')}<select aria-label={text('原模型事实请求', '原事实整理请求')} disabled={props.busy || working || sending || stopping} value={requestKey || request?.requestKey || ''}
      onChange={event => { revision.current++; setPage(null); setRequestKey(event.target.value); setReviewed(false); setRetry(null) }}>{page!.requests.map((row, index) => <option key={row.requestKey} value={row.requestKey}>第 {index + 1} 次：{audiences[row.audience]} · {statuses[row.status]}</option>)}</select></label>}
    {request && <section aria-label={text('原模型事实请求状态', '原事实整理请求状态')}><p>{statuses[request.status]} · {request.oracle}</p>
      {normalization && request.source && <section aria-label="原整理请求沿用的解释与决定"><p>{request.source.interpretation}</p>
        <p>原请求范围：{audiences[request.source.audience]}；{request.source.audience === 'party' ? '原请求全队角色' : '原请求活动角色'}：{request.source.recipients.join('、')}。</p>
        {request.source.audience === 'gm-only' && <p>原解释与本次候选仅供主持处理，不向队员披露。</p>}
        {request.source.discarded.map((row, index) => <p key={index}>原弃用提案 {index + 1}：{row.detail}；原原因：{row.reason}。</p>)}</section>}
      {request.modelIdentity && <p>原模型：{request.modelIdentity.provider} / {request.modelIdentity.model}；继续时保持原模型与预算。</p>}
      {!request.local && <p>历史请求仅供查阅，不恢复发送、修复或确认权限。</p>}
      {request.canResume && <button disabled={disabled} onClick={() => void send(true)}>{text('继续原模型事实请求', '继续原事实整理请求')}</button>}
      {(request.canRepairResponse || request.canRepairReview || request.canRepairStop) && <button disabled={disabled} onClick={() => void act(() => repairDesk({ ...input(), requestKey: request.requestKey }), '原回执已核对补齐；没有重新发送。')}>{text('补齐原模型事实回执', '补齐原事实整理回执')}</button>}
      {request.review && <p>{normalization ? '本次事实整理已' : '原解释已'}{request.review.interpretationDecision === 'accept' ? '接受' : '拒绝'}，明确采用 {request.review.adoptedCount} 条事实；{normalization ? '原已接受解释和原决定保持。' : '原逐项决定保留。'}{request.review.interpretationReason}</p>}
      {candidate && <section aria-label={text('本版本模型事实候选', '本版本事实整理候选')}><h4>{text('原模型解释', '沿用的原已接受解释')}</h4><p>{candidate.interpretation ?? '原回答未通过候选检查，请保留原记录。'}</p>
        {facts?.map(row => <article key={row.index}><h4>事实提案 {row.index + 1}</h4><p>{row.detail}</p><p>{row.subject} · {row.predicate}{row.object ? ` · ${row.object}` : ''}：{row.value}</p>
          <p>范围：{audiences[row.audience]}{row.recipients.length ? `（${row.recipients.join('、')}）` : ''}；依据：{row.sources.join('；') || '原咨询及已交付资料'}。</p>
          {row.supersedes && <p>拟取代：{row.supersedes}；原因：{row.supersedeReason}</p>}
          {request.canReview && <fieldset disabled={disabled || Boolean(originalReview)}><legend>事实提案 {row.index + 1} 的明确决定</legend>
            <select aria-label={`事实提案 ${row.index + 1} 决定`} value={choices[row.index]?.decision ?? ''} onChange={event => { setChoices(value => ({ ...value, [row.index]: { decision: event.target.value as Choice['decision'], reason: value[row.index]?.reason ?? '' } })); setReviewed(false) }}>
              <option value="">尚未决定</option><option value="adopt" disabled={interpretation === 'reject'}>采用本条</option><option value="discard">弃用本条</option></select>
            {choices[row.index]?.decision === 'discard' && <textarea aria-label={`事实提案 ${row.index + 1} 弃用原因`} maxLength={2000} value={choices[row.index].reason}
              onChange={event => { setChoices(value => ({ ...value, [row.index]: { ...value[row.index], reason: event.target.value } })); setReviewed(false) }} />}
          </fieldset>}
          {request.review?.choices.find(choice => choice.proposalIndex === row.index) && <p>已保存决定：{request.review.choices.find(choice => choice.proposalIndex === row.index)!.decision === 'adopt' ? '采用' : '弃用'}；{request.review.choices.find(choice => choice.proposalIndex === row.index)!.reason}</p>}
        </article>)}
        {facts?.length === 0 && <p>{text('本次没有事实提案；仍须明确决定是否接受原解释。', '本次没有事实提案；原已接受解释保留，仍须明确决定是否接受本次空整理。')}</p>}
        {request.canReview && <fieldset disabled={disabled || Boolean(originalReview)}><legend>本版本完整审阅</legend>
          <label>{text('原解释决定', '本次事实整理决定')}<select aria-label={text('原解释决定', '本次事实整理决定')} value={interpretation} onChange={event => { const value = event.target.value as typeof interpretation; setInterpretation(value); setReviewed(false)
            if (value === 'reject') setChoices(rows => Object.fromEntries(Object.entries(rows).map(([key, row]) => [key, row.decision === 'adopt' ? { ...row, decision: '' } : row]))) }}>
            <option value="">尚未决定</option><option value="accept">{text('接受原解释', '接受本次事实整理')}</option><option value="reject">{text('拒绝原解释', '拒绝本次事实整理')}</option></select></label>
          {interpretation === 'reject' && <label>{text('拒绝原解释的原因', '拒绝本次事实整理的原因')}<textarea aria-label={text('拒绝原解释的原因', '拒绝本次事实整理的原因')} maxLength={2000} value={interpretationReason} onChange={event => { setInterpretationReason(event.target.value); setReviewed(false) }} /></label>}
          <label><input type="checkbox" disabled={!choicesReady} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />我已核对本版本全文、原依据及每条提案的决定和范围。</label>
          <button disabled={!choicesReady || !reviewed} onClick={() => void submitOriginalReview()}>{text('确认本版本模型事实审阅', '确认本版本事实整理审阅')}</button>
        </fieldset>}
        {!request.committed && candidate.status === 'blocked' && <p>原回答未通过检查，不能确认；可保留并结束本次请求。</p>}
      </section>}
      {request.canFinish && !sending && <button disabled={disabled || Boolean(originalReview)} onClick={() => void act(() => finishDesk(request.requestKey), '原候选已明确放弃，本次窗口已结束；原回答和费用保留。')}>{text('放弃本次事实候选并结束窗口', '放弃本次事实整理并结束窗口')}</button>}
    </section>}
    {originalReview && <aside><p>保留上次确认的准确版本与选择；重试只核对原命令。</p><button disabled={disabled} onClick={() => void act(async () => { await reviewOriginal(originalReview); if (stillOwned()) setRetry(null) }, '原审阅确认已核对完成。')}>{text('核对并重试原候选审阅', '核对并重试原整理审阅')}</button>
      {request?.canReview && <button disabled={disabled} onClick={() => { setRetry(null); setReviewed(false); setNotice('尚未确认的候选可重新审阅；请重新核对全部决定。') }}>重新审阅尚未确认的候选</button>}
    </aside>}
    {page?.closeWindowEpochKey && !sending && <button disabled={disabled} onClick={() => void act(() => closeDesk(page.closeWindowEpochKey!), '本次事实窗口已结束，原记录和确认事实保留。')}>{text('结束本次模型事实窗口', '结束本次事实整理窗口')}</button>}
  </details>
}
