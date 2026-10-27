import { useCallback, useEffect, useRef, useState } from 'react'
import { useAIConfigStore } from '../../stores/ai-config'
import type { TtrpgOpenFactDeskInputV1 } from '../../lib/ttrpg/open-fact-desk'
import { readTtrpgOpenSettledViewV1 } from '../../lib/ttrpg/open-read-conflict'
import { readTtrpgOpenCommonOracleDeskV1 as read, requestTtrpgOpenCommonOracleDeskV1 as requestCandidate,
  resumeTtrpgOpenCommonOracleDeskV1 as resume, reviewTtrpgOpenCommonOracleDeskV1 as review, repairTtrpgOpenCommonOracleDeskV1 as repair,
  finishTtrpgOpenCommonOracleDeskV1 as finish, closeTtrpgOpenCommonOracleDeskV1 as close, archiveTtrpgOpenCommonOracleDeskV1 as archive } from '../../lib/ttrpg/open-common-oracle-desk'
import { TTRPG_FACT_AUDIENCE_LABELS_V1 as audiences } from '../../lib/ttrpg/open-fact-desk-contract'

type Page = Awaited<ReturnType<typeof read>>
type Review = Parameters<typeof review>[0]
type Choice = { decision: '' | 'adopt' | 'discard'; reason: string }
const statuses = { authorized: '已授权，尚未准备', prepared: '尚未发送', dispatched: '等待原回答', succeeded: '原回答已保存', failed: '原请求已结束', unknown: '结果及费用未知' }
export default function TtrpgOpenCommonOraclePanel(props: { input: TtrpgOpenFactDeskInputV1; sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void> }) {
  const { sessionId, viewerKey, scope: { projectId, worldId, workId } } = props.input
  const config = useAIConfigStore(state => state.config), owner = `${projectId}:${worldId}:${workId}:${sessionId}:${viewerKey}`
  const input = useCallback(() => ({ scope: { projectId, worldId, workId }, sessionId, viewerKey }), [projectId, worldId, workId, sessionId, viewerKey])
  const currentOwner = useRef(owner), pageOwner = useRef(owner), live = useRef(true), revision = useRef(0), lock = useRef(false), stopLock = useRef(false), stopped = useRef(false)
  const controller = useRef<AbortController | null>(null), activeRequest = useRef<string | null>(null), previousCandidate = useRef<string | null>(null)
  currentOwner.current = owner
  const [stored, setPage] = useState<Page>(null), [requestKey, setRequestKey] = useState(''), [selectedKey, setSelected] = useState(''), [cost, setCost] = useState('0.10')
  const [allowed, setAllowed] = useState(false), [reviewed, setReviewed] = useState(false), [interpretation, setInterpretation] = useState<'' | 'accept' | 'reject'>('')
  const [reason, setReason] = useState(''), [choices, setChoices] = useState<Record<number, Choice>>({}), [retry, setRetry] = useState<{ owner: string; value: Review } | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [working, setWorking] = useState(false), [sending, setSending] = useState(false), [stopping, setStopping] = useState(false)
  const page = pageOwner.current === owner ? stored : null, request = page?.request, candidate = request?.candidate
  const originalReview = retry?.owner === owner ? retry.value : null, owns = () => live.current && currentOwner.current === owner
  const load = useCallback(async () => {
    const token = ++revision.current
    try {
      const next = await readTtrpgOpenSettledViewV1(() => read({ ...input(), ...(requestKey ? { requestKey } : {}) }), () => live.current && currentOwner.current === owner && token === revision.current)
      if (next !== undefined && live.current && currentOwner.current === owner && token === revision.current) { pageOwner.current = owner; setPage(next) }
    } catch (cause) {
      if (live.current && currentOwner.current === owner && token === revision.current) { pageOwner.current = owner; setPage(null); setError(cause instanceof Error ? cause.message : '读取共同事实进度失败，请保留原记录。') }
    }
  }, [input, owner, requestKey])
  useEffect(() => {
    live.current = true; lock.current = false; stopLock.current = false; stopped.current = false
    setPage(null); setRequestKey(''); setSelected(''); setCost('0.10'); setAllowed(false); setReviewed(false); setRetry(null); setError(''); setNotice(''); setSending(false); setStopping(false); setWorking(false)
    return () => { live.current = false; revision.current += 1; controller.current?.abort(); activeRequest.current = null }
  }, [input])
  useEffect(() => { void load(); return () => { revision.current += 1 } }, [load, props.sequence])
  useEffect(() => { setAllowed(false); setReviewed(false) }, [input, config, cost, selectedKey, props.sequence])
  useEffect(() => { previousCandidate.current = null; setChoices({}); setInterpretation(''); setReason(''); setReviewed(false); setRetry(null) }, [input, requestKey])
  useEffect(() => {
    if (!candidate?.candidateHash || previousCandidate.current === candidate.candidateHash) return
    previousCandidate.current = candidate.candidateHash; setChoices({}); setInterpretation(''); setReason(''); setReviewed(false); setRetry(null)
  }, [candidate?.candidateHash])
  const act = (job: () => Promise<unknown>, success: string) => props.perform(async () => {
    if (lock.current || !owns()) return
    lock.current = true; stopped.current = false; setWorking(true); setError(''); setNotice('')
    try { await job(); if (owns() && !stopped.current) { setNotice(success); setReviewed(false) } }
    catch (cause) { if (owns() && !stopped.current) setError(cause instanceof Error ? cause.message : '原操作尚未完成，请读取进度。') }
    finally { if (owns()) { await load(); lock.current = false; setWorking(false) } }
  })
  const selected = page?.catalog.find(row => `${row.oracleSourceRef.sessionKey}:${row.oracleSourceRef.sequence}` === selectedKey)
  const disabled = props.busy || working || stopping || Boolean(page && page.sequence !== props.sequence)
  const send = (continueOriginal = false) => act(async () => {
    const abort = new AbortController(); controller.current = abort; activeRequest.current = continueOriginal && request ? request.requestKey : null; setSending(true)
    try {
      if (continueOriginal && request) await resume({ ...input(), requestKey: request.requestKey, aiConfig: config, signal: abort.signal })
      else {
        if (!page || !selected || !allowed) throw new Error('请明确核对本次共同资料、原咨询与一次预留上限。')
        await requestCandidate({ ...input(), ...selected, expectedSequence: page.sequence, submissionKey: crypto.randomUUID(), maximumCostUsd: Number(cost),
          decision: 'request-this-one-common-oracle-candidate', aiConfig: config, signal: abort.signal, onAuthorized: key => {
            if (!owns()) throw new Error('身份已变化，原授权已保留；不会继续发送。')
            activeRequest.current = key; setPage(null); setRequestKey(key); setReviewed(false)
          } })
      }
    } finally {
      if (controller.current === abort) controller.current = null
      if (owns()) { activeRequest.current = null; setSending(false); setAllowed(false) }
    }
  }, '原共同回答已保存为候选；请逐项审阅，事实尚未自动确认。')
  const stop = async () => {
    if (stopLock.current || !activeRequest.current || !owns()) return
    const abort = controller.current; stopLock.current = true; setStopping(true); setError('')
    let saved = false
    try {
      await finish({ ...input(), requestKey: activeRequest.current, decision: 'discard-this-common-oracle-request-and-close-window' }); saved = true
      if (owns()) { stopped.current = true; setNotice('原共同请求已明确停止，窗口已结束；回答及可能费用保留。') }
    } catch (cause) { if (owns()) setError(cause instanceof Error ? cause.message : '停止决定尚未保存，请读取后重试。') }
    finally { if (saved) abort?.abort(); if (owns()) { stopLock.current = false; setStopping(false); await load() } }
  }
  const facts = candidate?.facts, choicesReady = Boolean(facts && interpretation && (interpretation !== 'reject' || reason.trim())
    && facts.every(row => choices[row.index]?.decision && (choices[row.index].decision !== 'discard' || choices[row.index].reason.trim())
      && (interpretation !== 'reject' || choices[row.index].decision === 'discard')))
  const submit = () => {
    if (!candidate || !request || !choicesReady || !reviewed || !interpretation || lock.current) return
    const value: Review = { ...input(), requestKey: request.requestKey, candidateHash: candidate.candidateHash, interpretationDecision: interpretation,
      interpretationReason: interpretation === 'reject' ? reason.trim() : null, decision: 'reviewed-this-original-common-oracle-candidate',
      choices: facts!.map(row => ({ proposalIndex: row.index, decision: choices[row.index].decision as 'adopt' | 'discard', reason: choices[row.index].decision === 'discard' ? choices[row.index].reason.trim() : null })) }
    setRetry({ owner, value })
    return act(async () => { await review(value); if (owns()) setRetry(null) }, '共同解释及逐项决定已保存；只有明确采用的事实进入本局。')
  }
  if (!page && !(pageOwner.current === owner && error) && !sending && !originalReview) return null
  const displayedFacts = candidate?.facts ?? request?.review?.facts
  return <details className="sf-open-table-card sf-open-fact-desk" data-testid="ttrpg-open-common-oracle-desk"><summary>共同咨询：让 AI 拟定本局事实</summary>
    <p>只使用全体当前角色共同可读的原咨询及本次范围内的资料。模型回答先成为候选，每条事实由你另行决定。</p>
    {pageOwner.current === owner && error && <p role="alert">{error}</p>}{pageOwner.current === owner && notice && <p role="status">{notice}</p>}
    <button disabled={props.busy || working || sending} onClick={() => { setError(''); setReviewed(false); void load() }}>读取共同事实进度</button>
    {page?.canRequest && <fieldset disabled={disabled}><legend>本次共同资料与一次请求</legend>
      <label>共同事实的原咨询<select aria-label="共同事实的原咨询" value={selectedKey} onChange={event => { setSelected(event.target.value); setAllowed(false) }}>
        <option value="">明确选择已保存的共同咨询</option>{page.catalog.map(row => <option key={`${row.oracleSourceRef.sessionKey}:${row.oracleSourceRef.sequence}`} value={`${row.oracleSourceRef.sessionKey}:${row.oracleSourceRef.sequence}`}>{row.question}（{audiences[row.audience]}）</option>)}</select></label>
      {selected && <section aria-label="本次共同事实资料"><p>原结果：{selected.result}。</p><p>本次范围：{audiences[selected.audience]}；共同接收者：{selected.recipients.join('、')}。</p>
        {selected.entities.map((row, index) => <p key={index}>可读对象：{row.name}</p>)}
        {selected.facts.map((text, index) => <p key={index}>已有共同事实：{text}</p>)}
        <p>对象身份与名称不提供未披露的档案、当前位置、库存或装备。</p></section>}
      <label>共同事实预留上限（美元）<input aria-label="共同事实预留上限" type="number" min="0" max={page.maximumCostUsd} step="0.01" value={cost} onChange={event => setCost(event.target.value)} /></label>
      <label><input type="checkbox" checked={allowed} onChange={event => setAllowed(event.target.checked)} />我同意 AI 按以上原咨询、共同资料、接收者和预留上限请求一次候选。</label>
      <button disabled={!selected || !allowed || !cost.trim() || !Number.isFinite(Number(cost)) || Number(cost) < 0 || Number(cost) > page.maximumCostUsd} onClick={() => void send()}>请求本次共同事实候选</button>
    </fieldset>}
    {page && !page.canRequest && <p>{page.unavailable}</p>}
    {sending && <p role="status">{activeRequest.current ? '原共同请求已授权，正在处理本次回答。' : '正在准备本次共同资料。'}</p>}
    {sending && activeRequest.current && <aside><p>停止先保留原回答或未知结果和费用，再结束本机等待。</p><button disabled={stopping} onClick={() => void stop()}>停止本次共同事实请求</button></aside>}
    {Boolean(page?.requests.length) && <label>原共同事实请求<select aria-label="原共同事实请求" disabled={props.busy || working || sending || stopping} value={requestKey || request?.requestKey || ''}
      onChange={event => { revision.current += 1; setPage(null); setRequestKey(event.target.value); setReviewed(false); setRetry(null) }}>{page!.requests.map((row, index) => <option key={row.requestKey} value={row.requestKey}>第 {index + 1} 次：{audiences[row.audience]} · {statuses[row.status]}{row.closed ? ' · 窗口已结束' : ''}</option>)}</select></label>}
    {request && <section aria-label="原共同事实请求状态"><p>{statuses[request.status]} · {request.oracle}</p><p>原模型：{request.modelIdentity.provider} / {request.modelIdentity.model}。</p>
      <p>原范围：{audiences[request.audience]}；原共同接收者：{request.recipients.join('、')}。</p>
      {request.failure && <p>{request.failure}</p>}
      {request.source && <section aria-label="原请求实际交付的共同资料"><h4>原共同依据</h4>
        {request.source.entities.map((row, index) => <p key={index}>原可读对象：{row.name}</p>)}
        {request.source.facts.map((text, index) => <p key={index}>原共同事实：{text}</p>)}
      </section>}
      {!request.source && request.status !== 'authorized' && <p>原共同资料未完整回读，不能据此新增审阅；原记录保留。</p>}
      {request.usage && <p>已记录费用：{request.usage.actualCostUsd === null ? '实际费用未知，原预留记录保留' : `${request.usage.actualCostUsd} 美元`}。</p>}
      {!request.local && <p>历史请求不恢复发送或确认权限。可核对原记录后明确归档本桌窗口。</p>}
      {request.historicalResponse && <details aria-label="原共同回答只读记录"><summary>查看原共同回答（只读）</summary><pre>{request.historicalResponse.text}</pre><p>这是原请求实际保留的回答，不能据此恢复发送或确认权限。</p></details>}
      {request.archived && <p>原请求已明确归档，回答、费用和既有决定保留。</p>}
      {request.canResume && <button disabled={disabled} onClick={() => void send(true)}>继续原共同事实请求</button>}
      {(request.canRepairResponse || request.canRepairReview || request.canRepairStop) && <button disabled={disabled} onClick={() => void act(() => repair({ ...input(), requestKey: request.requestKey }), '原共同回执已核对补齐，没有重新发送。')}>补齐原共同事实回执</button>}
      {(candidate || request.review) && <section aria-label="本版本共同事实候选"><h4>原共同解释</h4><p>{candidate?.interpretation ?? request.review?.interpretation ?? '原回答未通过检查，请保留原记录。'}</p>
        {displayedFacts?.map(row => <article key={row.index}><h4>共同事实提案 {row.index + 1}</h4><p>{row.detail}</p><p>{row.subject} · {row.predicate}{row.object ? ` · ${row.object}` : ''}：{row.value}</p>
          <p>范围：{audiences[row.audience]}{row.recipients.length ? `（${row.recipients.join('、')}）` : ''}；依据：{row.sources.join('；') || '原共同咨询与实际交付资料'}。</p>
          {row.supersedes && <p>拟取代：{row.supersedes}；原因：{row.supersedeReason}</p>}
          {request.canReview && <fieldset disabled={disabled || Boolean(originalReview)}><legend>共同事实提案 {row.index + 1} 的决定</legend>
            <select aria-label={`共同事实提案 ${row.index + 1} 决定`} value={choices[row.index]?.decision ?? ''} onChange={event => { setChoices(value => ({ ...value, [row.index]: { decision: event.target.value as Choice['decision'], reason: value[row.index]?.reason ?? '' } })); setReviewed(false) }}>
              <option value="">尚未决定</option><option value="adopt" disabled={interpretation === 'reject'}>采用本条</option><option value="discard">弃用本条</option></select>
            {choices[row.index]?.decision === 'discard' && <textarea aria-label={`共同事实提案 ${row.index + 1} 弃用原因`} maxLength={2000} value={choices[row.index].reason} onChange={event => { setChoices(value => ({ ...value, [row.index]: { ...value[row.index], reason: event.target.value } })); setReviewed(false) }} />}
          </fieldset>}
          {request.review?.choices.find(choice => choice.proposalIndex === row.index) && <p>已保存决定：{request.review.choices.find(choice => choice.proposalIndex === row.index)!.decision === 'adopt' ? '采用' : '弃用'}；{request.review.choices.find(choice => choice.proposalIndex === row.index)!.reason}</p>}
        </article>)}
        {displayedFacts?.length === 0 && <p>本次没有事实提案，仍须明确决定是否接受原共同解释。</p>}
        {request.canReview && <fieldset disabled={disabled || Boolean(originalReview)}><legend>共同解释与全部提案的完整审阅</legend>
          <label>原共同解释决定<select aria-label="原共同解释决定" value={interpretation} onChange={event => { const value = event.target.value as typeof interpretation; setInterpretation(value); setReviewed(false)
            if (value === 'reject') setChoices(rows => Object.fromEntries(Object.entries(rows).map(([key, row]) => [key, row.decision === 'adopt' ? { ...row, decision: '' } : row]))) }}>
            <option value="">尚未决定</option><option value="accept">接受原共同解释</option><option value="reject">拒绝原共同解释</option></select></label>
          {interpretation === 'reject' && <label>拒绝原共同解释的原因<textarea aria-label="拒绝原共同解释的原因" maxLength={2000} value={reason} onChange={event => { setReason(event.target.value); setReviewed(false) }} /></label>}
          <label><input type="checkbox" disabled={!choicesReady} checked={reviewed} onChange={event => setReviewed(event.target.checked)} />我已核对本版本共同解释、原依据及每条提案的决定和范围。</label>
          <button disabled={!choicesReady || !reviewed} onClick={() => void submit()}>确认本版本共同事实审阅</button>
        </fieldset>}
        {!request.committed && candidate?.status === 'blocked' && <p>原回答未通过检查，不能确认；可保留记录并明确结束请求。</p>}
      </section>}
      {request.review && <p>原共同解释已{request.review.interpretationDecision === 'accept' ? '接受' : '拒绝'}，明确采用 {request.review.adoptedCount} 条事实；原逐项决定保留。{request.review.interpretationReason}</p>}
      {!request.review && request.confirmedFactDetails.map((detail, index) => <p key={index}>已确认共同事实：{detail}</p>)}
      {request.canFinish && !sending && <button disabled={disabled || Boolean(originalReview)} onClick={() => void act(() => finish({ ...input(), requestKey: request.requestKey, decision: 'discard-this-common-oracle-request-and-close-window' }), '原共同候选已明确放弃，窗口已结束；回答和费用保留。')}>放弃本次共同候选并结束窗口</button>}
      {request.canCloseReviewed && !sending && <button disabled={disabled} onClick={() => void act(() => close({ ...input(), requestKey: request.requestKey, decision: 'close-this-reviewed-common-oracle-window' }), '原共同事实窗口已结束，已确认事实保持。')}>结束本次已审阅共同事实窗口</button>}
      {request.canArchive && !sending && <button disabled={disabled} onClick={() => void act(() => archive({ ...input(), requestKey: request.requestKey, decision: 'archive-this-unresumable-common-oracle-window' }), '原共同请求已明确归档，窗口已结束；历史与费用保持。')}>归档原共同请求并结束本桌窗口</button>}
    </section>}
    {originalReview && <aside><p>上次确认的准确版本与选择已保留；重试只核对原命令。</p><button disabled={disabled} onClick={() => void act(async () => { await review(originalReview); if (owns()) setRetry(null) }, '原共同审阅已核对完成。')}>核对并重试原共同审阅</button>
      {request?.canReview && <button disabled={disabled} onClick={() => { setRetry(null); setReviewed(false); setNotice('原候选尚未确认，请重新核对全部决定。') }}>重新审阅尚未确认的共同候选</button>}
    </aside>}
  </details>
}
