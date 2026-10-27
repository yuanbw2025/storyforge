import { useCallback, useEffect, useRef, useState } from 'react'
import { readTtrpgOpenFactDeskV1, prepareTtrpgOpenFactDeskAssertionV1, prepareTtrpgOpenFactDeskRetirementV1, confirmTtrpgOpenFactDeskV1,
  startTtrpgOpenFactDeskConsultationV1, consultTtrpgOpenFactDeskV1, closeTtrpgOpenFactDeskV1, type TtrpgOpenFactDeskInputV1 } from '../../lib/ttrpg/open-fact-desk'
import { ttrpgOpenFactScalarLabelV1, TTRPG_FACT_AUDIENCE_LABELS_V1 as audiences, TTRPG_FACT_KIND_LABELS_V1 as kinds, TTRPG_FACT_PREDICATE_LABELS_V1 as predicates,
  type TtrpgOpenFactDeskReviewV1 } from '../../lib/ttrpg/open-fact-desk-contract'
import type { TtrpgOpenAudience, TtrpgOpenFactKind } from '../../lib/ttrpg/open-contract'

type Desk = Awaited<ReturnType<typeof readTtrpgOpenFactDeskV1>>
const empty = () => ({ oracle: '', subject: '', predicate: '', object: '', kind: '' as TtrpgOpenFactKind | '', value: 'true', detail: '',
  audience: 'gm-only' as TtrpgOpenAudience, recipients: [] as string[], sources: [] as string[], runtime: false, supersedes: '', supersedeReason: '' })
export default function TtrpgOpenFactPanel(props: { input: TtrpgOpenFactDeskInputV1; sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void> }) {
  const { sessionId, viewerKey, scope: { projectId, worldId, workId } } = props.input, owner = `${projectId}:${worldId}:${workId}:${sessionId}:${viewerKey}`
  const input = useCallback(() => ({ scope: { projectId, worldId, workId }, sessionId, viewerKey }), [projectId, worldId, workId, sessionId, viewerKey])
  const identity = useRef(owner); identity.current = owner
  const live = useRef(true), revision = useRef(0)
  const [loaded, setLoaded] = useState<{ owner: string; page: Desk }>({ owner, page: null })
  const [message, setMessage] = useState({ owner, error: '', notice: '' }), [form, setForm] = useState(empty)
  const [reviewed, setReviewed] = useState<{ owner: string; value: TtrpgOpenFactDeskReviewV1 } | null>(null), [accepted, setAccepted] = useState(false), [retry, setRetry] = useState(false)
  const [question, setQuestion] = useState(''), [tableKey, setTableKey] = useState(''), [tier, setTier] = useState('')
  const [retireKey, setRetireKey] = useState(''), [retireReason, setRetireReason] = useState('')
  const page = loaded.owner === owner ? loaded.page : null, review = reviewed?.owner === owner ? reviewed.value : null
  const current = message.owner === owner ? message : { error: '', notice: '' }
  const load = useCallback(async () => {
    const token = ++revision.current, own = owner
    try {
      const next = await readTtrpgOpenFactDeskV1(input())
      if (live.current && identity.current === own && token === revision.current) { setLoaded({ owner: own, page: next }); if (!next) { setReviewed(null); setAccepted(false) } }
    } catch (cause) {
      if (live.current && identity.current === own && token === revision.current) {
        setLoaded({ owner: own, page: null }); setMessage({ owner: own, error: cause instanceof Error ? cause.message : '事实进度暂时不可读取，请保留原记录。', notice: '' })
      }
    }
  }, [input, owner])
  useEffect(() => {
    live.current = true; setForm(empty()); setReviewed(null); setAccepted(false); setRetry(false); setQuestion(''); setTableKey(''); setTier(''); setRetireKey(''); setRetireReason('')
    setMessage({ owner, error: '', notice: '' })
    return () => { live.current = false; revision.current += 1 }
  }, [owner])
  useEffect(() => { void load(); return () => { revision.current += 1 } }, [load, props.sequence])
  const edit = (patch: Partial<ReturnType<typeof empty>>) => { setForm(value => ({ ...value, ...patch })); setReviewed(null); setAccepted(false); setRetry(false) }
  const act = (job: () => Promise<string | void>) => props.perform(async () => {
    const own = owner
    setMessage({ owner: own, error: '', notice: '' })
    try { const notice = await job(); if (live.current && identity.current === own) setMessage({ owner: own, error: '', notice: notice ?? '' }) }
    catch (cause) { if (live.current && identity.current === own) setMessage({ owner: own, error: cause instanceof Error ? cause.message : '本次操作尚未完成，请保留原版本。', notice: '' }) }
    finally { if (live.current && identity.current === own) await load() }
  })
  const remember = (value: TtrpgOpenFactDeskReviewV1, own: string) => {
    if (live.current && identity.current === own) { setReviewed({ owner: own, value }); setAccepted(false); setRetry(false) }
  }
  if (!page && !current.error) return null
  const refs = page?.entities.filter(row => form.runtime || !row.dynamic) ?? [], predicate = page?.predicates.find(row => row.predicateKey === form.predicate) ?? page?.predicates[0]
  const oracle = page?.oracles.find(row => `${row.sourceRef.sessionKey}:${row.sourceRef.sequence}` === form.oracle) ?? page?.oracles[0]
  const kind = predicate?.allowedKinds.includes(form.kind as TtrpgOpenFactKind) ? form.kind as TtrpgOpenFactKind : predicate?.allowedKinds[0]
  const table = page?.tables.find(row => row.key === tableKey) ?? page?.tables[0]
  const sourceKeys = [...new Set([...form.sources, ...(form.supersedes ? [form.supersedes] : [])])]
  const prepare = () => act(async () => {
    if (!oracle || !predicate || !kind) throw new Error('请先保存原咨询结果，并选择完整事实内容。')
    const canonicalValue = predicate.valueType === 'boolean' ? form.value === 'true' : predicate.valueType === 'number' ? Number(form.value) : form.value
    const own = owner, value = await prepareTtrpgOpenFactDeskAssertionV1({ ...input(), submissionKey: crypto.randomUUID(), oracleSourceRef: oracle.sourceRef,
      includeRuntimeEntities: form.runtime, proposal: { kind, subjectRef: form.subject, predicateKey: predicate.predicateKey,
        objectRef: predicate.cardinality === 'many' ? form.object || null : null, canonicalValue, detail: form.detail, sourceFactRefs: sourceKeys,
        audience: form.audience, knownByActorKeys: form.audience === 'party' ? page!.recipients.map(row => row.key) : form.audience === 'private' ? form.recipients : [],
        supersedes: form.supersedes || null, supersedeReason: form.supersedes ? form.supersedeReason : null } })
    remember(value, own); return '本版本已通过原事实预检，请完整审阅后再明确确认。'
  })
  return <details className="sf-open-table-card sf-open-fact-desk" data-testid="ttrpg-open-fact-desk">
    <summary>本局事实：咨询、审阅与确认</summary>
    <p>真人 GM 根据原咨询结果确认本局语义事实。不会替玩家决定，也不修改角色资源、物品、位置或世界版本。</p>
    {current.error && <p role="alert">{current.error}</p>}{current.notice && <p role="status">{current.notice}</p>}
    <button disabled={props.busy} onClick={() => void load()}>读取事实进度</button>
    {page && <>
      {page.canStart && <button disabled={props.busy} onClick={() => void act(async () => {
        await startTtrpgOpenFactDeskConsultationV1({ ...input(), submissionKey: crypto.randomUUID(), decision: 'start-this-fact-consultation' }); return '本次咨询已开始。'
      })}>明确开始本次事实咨询</button>}
      {!page.canPrepare && <p>{page.unavailable}</p>}
      {page.canConsult && table && <fieldset disabled={props.busy}><legend>保存一次原咨询结果</legend>
        <label>事实咨询表<select aria-label="事实咨询表" value={table.key} onChange={e => { setTableKey(e.target.value); setTier('') }}>{page.tables.map(row => <option key={row.key} value={row.key}>{row.title}</option>)}</select></label>
        {table.tiers.length > 0 && <label>事实咨询可能性<select aria-label="事实咨询可能性" value={tier} onChange={e => setTier(e.target.value)}><option value="">请选择</option>{table.tiers.map(row => <option key={row.key} value={row.key}>{row.label}</option>)}</select></label>}
        <label>事实咨询问题<textarea aria-label="事实咨询问题" value={question} maxLength={2000} onChange={e => setQuestion(e.target.value)} /></label>
        <button disabled={!question.trim() || table.tiers.length > 0 && !tier} onClick={() => void act(async () => {
          await consultTtrpgOpenFactDeskV1({ ...input(), submissionKey: crypto.randomUUID(), decision: 'consult-this-once', oracleKey: table.key, question, likelihoodTierKey: tier || null }); return '原咨询结果已保存，尚未确认任何新事实。'
        })}>明确进行本次事实咨询</button>
      </fieldset>}
      {page.canPrepare && oracle && predicate && <fieldset disabled={props.busy}><legend>准备一条手写事实</legend>
        <label>事实依据<select aria-label="事实依据" value={`${oracle.sourceRef.sessionKey}:${oracle.sourceRef.sequence}`} onChange={e => edit({ oracle: e.target.value })}>{page.oracles.map(row => <option key={`${row.sourceRef.sessionKey}:${row.sourceRef.sequence}`} value={`${row.sourceRef.sessionKey}:${row.sourceRef.sequence}`}>世界轮次 {row.worldTurn} · {row.question} · {row.result}</option>)}</select></label>
        <label><input type="checkbox" checked={form.runtime} onChange={e => edit({ runtime: e.target.checked, subject: '', object: '' })} />本次事实允许引用本局已实际创建的对象。</label>
        <label>事实主体<select aria-label="事实主体" value={form.subject} onChange={e => edit({ subject: e.target.value })}><option value="">请选择</option>{refs.map(row => <option key={row.key} value={row.key}>{row.name}{row.dynamic ? '（本局创建）' : ''}</option>)}</select></label>
        <label>事实含义<select aria-label="事实含义" value={predicate.predicateKey} onChange={e => { const next = page.predicates.find(row => row.predicateKey === e.target.value)!; edit({ predicate: next.predicateKey, value: next.valueType === 'boolean' ? 'true' : '', kind: '', object: '' }) }}>{page.predicates.map(row => <option key={row.predicateKey} value={row.predicateKey}>{row.label}</option>)}</select></label>
        <label>事实类别<select aria-label="事实类别" value={kind} onChange={e => edit({ kind: e.target.value as TtrpgOpenFactKind })}>{predicate.allowedKinds.map(key => <option key={key} value={key}>{kinds[key]}</option>)}</select></label>
        {predicate.cardinality === 'many' && <label>事实关联对象<select aria-label="事实关联对象" value={form.object} onChange={e => edit({ object: e.target.value })}><option value="">请选择</option>{refs.map(row => <option key={row.key} value={row.key}>{row.name}</option>)}</select></label>}
        <label>事实取值{predicate.valueType === 'boolean' ? <select aria-label="事实取值" value={form.value} onChange={e => edit({ value: e.target.value })}><option value="true">成立</option><option value="false">不成立</option></select>
          : predicate.valueType === 'entity-ref' ? <select aria-label="事实取值" value={form.value} onChange={e => edit({ value: e.target.value })}><option value="">请选择</option>{refs.map(row => <option key={row.key} value={row.key}>{row.name}</option>)}</select>
            : <input aria-label="事实取值" type={predicate.valueType === 'number' ? 'number' : 'text'} value={form.value} maxLength={20000} onChange={e => edit({ value: e.target.value })} />}</label>
        <label>事实正文<textarea aria-label="事实正文" value={form.detail} maxLength={20000} onChange={e => edit({ detail: e.target.value })} /></label>
        <fieldset><legend>事实来源（最多 100 条）</legend>{page.sources.map(row => <label key={row.key}><input type="checkbox" checked={sourceKeys.includes(row.key)} disabled={row.key === form.supersedes || sourceKeys.length >= 100 && !sourceKeys.includes(row.key)} onChange={() => edit({ sources: form.sources.includes(row.key) ? form.sources.filter(key => key !== row.key) : [...form.sources, row.key] })} />{row.label}</label>)}</fieldset>
        <label>事实知情范围<select aria-label="事实知情范围" value={form.audience} onChange={e => edit({ audience: e.target.value as TtrpgOpenAudience, recipients: [] })}>{Object.entries(audiences).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {form.audience === 'private' && <fieldset><legend>本次事实接收者</legend>{page.recipients.map(row => <label key={row.key}><input type="checkbox" checked={form.recipients.includes(row.key)} onChange={() => edit({ recipients: form.recipients.includes(row.key) ? form.recipients.filter(key => key !== row.key) : [...form.recipients, row.key] })} />{row.name}</label>)}</fieldset>}
        <label>替代旧事实<select aria-label="替代旧事实" value={form.supersedes} onChange={e => edit({ supersedes: e.target.value })}><option value="">不替代</option>{page.facts.filter(row => !row.fact.retired).map(row => <option key={row.fact.factKey} value={row.fact.factKey}>{row.fact.detail}</option>)}</select></label>
        {form.supersedes && <label>事实替代理由<input aria-label="事实替代理由" value={form.supersedeReason} maxLength={1000} onChange={e => edit({ supersedeReason: e.target.value })} /></label>}
        <button disabled={!form.subject || !form.detail.trim() || !form.value.trim() || predicate.cardinality === 'many' && !form.object || Boolean(form.supersedes && !form.supersedeReason.trim())} onClick={() => void prepare()}>准备并审阅本条事实</button>
      </fieldset>}
      {review && <section aria-label="本版本事实审阅"><h3>本版本事实审阅</h3><dl>{review.rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.value}</dd></div>)}</dl>
        {!retry && review.envelope.baseSequence !== page.sequence && <p>进度已变化，请重新准备并审阅；原事实记录保留。</p>}
        {retry && <p>原确认未得到回执。重试仍使用同一条原命令，已保存时只核对原记录。</p>}
        <label><input type="checkbox" checked={accepted} disabled={props.busy} onChange={e => setAccepted(e.target.checked)} />我已核对本版本全文、依据和准确知情范围，明确确认本次变更。</label>
        <button disabled={props.busy || !accepted || !retry && review.envelope.baseSequence !== page.sequence} onClick={() => void act(async () => {
          const own = owner
          try { await confirmTtrpgOpenFactDeskV1({ ...input(), review, decision: 'confirm-this-exact-fact-change' }) }
          catch (cause) { if (live.current && identity.current === own) setRetry(true); throw cause }
          if (live.current && identity.current === own) { setReviewed(null); setAccepted(false); setRetry(false); setForm(empty()); setRetireKey(''); setRetireReason('') }
          return '本条事实变更已确认保存，原历史与来源保留。'
        })}>{retry ? '核对并重试原事实确认' : '确认本版本事实变更'}</button>
        <button disabled={props.busy} onClick={() => { setReviewed(null); setAccepted(false); setRetry(false) }}>放弃本次未确认审阅</button>
      </section>}
      <section aria-label="本局事实记录"><h3>本局事实记录</h3>{page.facts.map(row => <article key={row.fact.factKey}><p>{row.fact.detail}</p>
        <p>{row.subjectName} · {predicates[row.fact.predicateKey]}{row.objectName ? ' · ' + row.objectName : ''}：{ttrpgOpenFactScalarLabelV1(row.fact.canonicalValue)}；{row.fact.retired ? '已退休' : '活动'}；{audiences[row.fact.audience]}；{row.origin === 'human' ? '真人手写确认' : '原模型候选确认'}。</p>
        <details><summary>原事实依据</summary><p>{row.question}</p>{row.retirementReason && <p>退休或替代理由：{row.retirementReason}</p>}</details>
        {!row.fact.retired && <button disabled={props.busy || !page.canPrepare} onClick={() => { setRetireKey(row.fact.factKey); setRetireReason(''); setReviewed(null); setAccepted(false); setRetry(false) }}>准备退休这条事实</button>}
      </article>)}{!page.facts.length && <p>尚无已确认的会话事实。</p>}</section>
      {retireKey && page.canPrepare && <fieldset disabled={props.busy}><legend>准备事实退休</legend><p>{page.facts.find(row => row.fact.factKey === retireKey)?.fact.detail}</p>
        <label>事实退休理由<input aria-label="事实退休理由" value={retireReason} maxLength={1000} onChange={e => { setRetireReason(e.target.value); setReviewed(null); setAccepted(false); setRetry(false) }} /></label>
        <button disabled={!retireReason.trim()} onClick={() => void act(async () => { const own = owner, value = await prepareTtrpgOpenFactDeskRetirementV1({ ...input(), factKey: retireKey, reason: retireReason, submissionKey: crypto.randomUUID() }); remember(value, own); return '退休版本已准备，请审阅并另行确认。' })}>准备退休审阅</button>
      </fieldset>}
      {page.canClose && <button disabled={props.busy} onClick={() => void act(async () => { await closeTtrpgOpenFactDeskV1({ ...input(), submissionKey: crypto.randomUUID(), decision: 'close-this-fact-consultation' }); return '本次咨询已结束，已确认的事实和原结果保留。' })}>结束本次事实咨询</button>}
    </>}
  </details>
}
