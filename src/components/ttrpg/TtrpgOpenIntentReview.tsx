import { useCallback, useEffect, useRef, useState } from 'react'
import type { TtrpgOpenIntentCandidateV1 } from '../../lib/ttrpg/open-intent-candidate'
import { readTtrpgOpenTableIntentReviewV2, clarifyTtrpgOpenTableCandidateV2, acceptTtrpgOpenTableCandidateV1,
  rejectTtrpgOpenTableIntentV1, type TtrpgOpenTableInputV1 } from '../../lib/ttrpg/open-table-service'
import { readTtrpgOpenSettledViewV1 } from '../../lib/ttrpg/open-read-conflict'

type Review = Awaited<ReturnType<typeof readTtrpgOpenTableIntentReviewV2>>
type Rule = Review['catalog']['rules'][number]
const key = (r: Rule) => JSON.stringify([r.route,r.ruleKey,r.interactionKey ?? null])
type Props = {
  input: TtrpgOpenTableInputV1; sequence: number; candidate: TtrpgOpenIntentCandidateV1; busy: boolean
  perform: (job: () => Promise<void>) => Promise<void>
}
export default function TtrpgOpenIntentReview(props: Props) {
  const { input,candidate } = props
  if (candidate.viewerKey !== input.viewerKey || candidate.productRuntimeSessionId !== input.sessionId) return <p>身份或团局已变化，请重新读取行动建议。</p>
  return <TtrpgOpenIntentReviewBody key={JSON.stringify([input.scope,input.sessionId,input.viewerKey,candidate.runId,candidate.requestKey,candidate.candidateHash])} {...props} />
}
function TtrpgOpenIntentReviewBody(props: Props) {
  const [review,setReview] = useState<Review | null>(null),[error,setError] = useState(''),[editing,setEditing] = useState(false)
  const [goal,setGoal] = useState(''),[outcome,setOutcome] = useState(''),[selected,setSelected] = useState(''),[target,setTarget] = useState(''),[discoveryKey,setDiscoveryKey] = useState('')
  const [bindings,setBindings] = useState<Record<string,string>>({}),[discoveryBindings,setDiscoveryBindings] = useState<Record<string,string>>({})
  const alive = useRef(true),generation = useRef(0),submitting = useRef(false)
  const { candidate,busy } = props,{ sessionId,viewerKey,scope } = props.input,{ projectId,worldId,workId } = scope
  const { runId,requestKey,candidateHash } = candidate
  const ready = !!candidate.intent && ['ready','usable-with-warnings'].includes(candidate.artifact.status)
  const load = useCallback(async () => {
    const token = ++generation.current;setReview(null);setError('');setEditing(false)
    if (!ready) return
    try {
      const value = await readTtrpgOpenSettledViewV1(() => readTtrpgOpenTableIntentReviewV2({ scope: { projectId,worldId,workId },sessionId,viewerKey,runId,requestKey,candidateHash }),
        () => alive.current && generation.current === token)
      if (!value || !alive.current || generation.current !== token) return
      setReview(value);setGoal(value.selection?.goal ?? candidate.intent!.goal);setOutcome(value.selection?.requestedOutcome ?? candidate.intent!.requestedOutcome ?? '')
      const rule = value.catalog.rules.find(r => (r.interactionKey ?? r.ruleKey) === (value.selection?.method ?? candidate.intent!.method))
      setSelected(rule ? key(rule) : '');setTarget(value.request ? JSON.stringify(value.request.targetKey) : (value.selection?.targetRefs ?? candidate.intent!.targetRefs)[0] ? JSON.stringify((value.selection?.targetRefs ?? candidate.intent!.targetRefs)[0]) : rule?.targets.length === 1 ? JSON.stringify(rule.targets[0].key) : '')
      const saved = value.request?.discovery,discovery = saved ? value.catalog.discoveries.find(d => d.situationKey === saved.situationKey && d.evidenceRef === saved.evidenceRef && d.interventionPointKey === saved.interventionPointKey) : null
      setDiscoveryKey(discovery?.key ?? '')
      setBindings(Object.fromEntries((rule?.parameters ?? []).map(p => [p.key,JSON.stringify(value.request?.effectBindings[p.templateKey]?.[p.parameterKey] ?? null)])))
      setDiscoveryBindings(Object.fromEntries((discovery?.parameters ?? []).map(p => [p.key,JSON.stringify(saved?.effectBindings[p.templateKey]?.[p.parameterKey] ?? null)])))
    } catch (cause) { if (alive.current && generation.current === token) setError(cause instanceof Error ? cause.message : String(cause)) }
  },[projectId,worldId,workId,sessionId,viewerKey,runId,requestKey,candidateHash,ready,candidate.intent])
  useEffect(() => { alive.current = true;void load();return () => { alive.current = false } },[load,props.sequence])
  const rule = review?.catalog.rules.find(r => key(r) === selected),paths = review?.catalog.discoveries.filter(d => d.route === rule?.route && d.ruleKey === rule.ruleKey) ?? []
  const discovery = paths.find(d => d.key === discoveryKey),form = !!review?.canClarify && (editing || !review.canConfirm)
  const savedRule = review?.catalog.rules.find(r => (r.interactionKey ?? r.ruleKey) === review.selection?.method)
  const savedTarget = review?.request ? savedRule?.targets.find(t => t.key === review.request!.targetKey)?.name : null
  const savedDiscovery = review?.request?.discovery ? review.catalog.discoveries.find(d => d.situationKey === review.request!.discovery!.situationKey
    && d.evidenceRef === review.request!.discovery!.evidenceRef && d.interventionPointKey === review.request!.discovery!.interventionPointKey) : null
  const fieldsReady = (!discoveryKey || Boolean(discovery?.available)) && (rule?.parameters ?? []).every(p => !p.required || bindings[p.key] && bindings[p.key] !== 'null')
    && (discovery?.parameters ?? []).every(p => !p.required || discoveryBindings[p.key] && discoveryBindings[p.key] !== 'null')
  const makeBindings = (templateKeys: string[],parameters: Rule['parameters'],values: Record<string,string>) => {
    const result: Record<string,Record<string,string | null>> = Object.fromEntries(templateKeys.map(template => [template,{}]))
    for (const p of parameters) { result[p.templateKey] ??= {};result[p.templateKey][p.parameterKey] = JSON.parse(values[p.key] ?? 'null') as string | null }
    return result
  }
  const action = (job: () => Promise<unknown>) => {
    if (submitting.current || busy) return
    submitting.current = true
    void props.perform(async () => { await job() }).catch(cause => {
      if (alive.current) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => { submitting.current = false })
  }
  const source = { ...props.input,runId,requestKey,candidateHash }
  return <div data-testid="ttrpg-open-intent-review">
    <p>{candidate.intent?.goal}</p><p>原建议的方法：{candidate.intent?.method ?? '待澄清'}</p>
    {error && <p role="alert">{error}<button disabled={busy} onClick={() => { void load() }}>重新核对这份意图</button></p>}
    {ready && !review && !error && <p>正在核对行动方式与确认范围…</p>}
    {review?.message && <p role="status">{review.message}</p>}
    {review?.selection && <div aria-label="已保存的人工澄清"><p>已保存人工补充 {review.attempts}/3：{review.selection.goal}</p>
      <p>补充的方法：{savedRule?.label ?? '尚未确定'}；行动对象：{savedTarget ?? '尚未确定'}。</p>
      {savedRule?.parameters.map((p,i) => <p key={p.key}>已保存的行动后果对象 {i + 1}：{p.options.find(o => o.key === review.request?.effectBindings[p.templateKey]?.[p.parameterKey])?.name ?? '不绑定'}</p>)}
      {savedDiscovery && <p>已保存的线索检查：{savedDiscovery.label}</p>}
      {savedDiscovery?.parameters.map((p,i) => <p key={p.key}>已保存的线索后果对象 {i + 1}：{p.options.find(o => o.key === review.request?.discovery?.effectBindings[p.templateKey]?.[p.parameterKey])?.name ?? '不绑定'}</p>)}
      {review.selection.requestedOutcome && <p>补充的期望结果：{review.selection.requestedOutcome}</p>}
      <p>下一步仍需核对并确认本次行动的风险。</p></div>}
    {form && <fieldset disabled={busy} className="grid gap-3" aria-label="补充行动意图">
      <p>补充这次要做什么，并从共同可见的规则和对象中选择。保存补充不会调用模型或执行行动。</p>
      <label>补充后的行动说明<textarea aria-label="补充后的行动说明" value={goal} maxLength={2000} onChange={e => setGoal(e.target.value)} /></label>
      <label>补充行动规则<select aria-label="补充行动规则" value={selected} onChange={e => {
        setSelected(e.target.value);setBindings({});setDiscoveryKey('');setDiscoveryBindings({})
        const next = review.catalog.rules.find(r => key(r) === e.target.value);setTarget(next?.targets.length === 1 ? JSON.stringify(next.targets[0].key) : '')
      }}><option value="">尚未确定</option>{review.catalog.rules.map(r => <option key={key(r)} value={key(r)} disabled={!r.available}>{r.label}{!r.available ? '（当前不可用）' : ''}</option>)}</select></label>
      {rule && <><p>耗时：{rule.timeCostWorldTurns} 个世界轮次。保存补充不会推进时间。</p>
        <label>补充行动对象<select aria-label="补充行动对象" value={target} onChange={e => setTarget(e.target.value)}><option value="">尚未确定</option>{rule.targets.map(t => <option key={JSON.stringify(t.key)} value={JSON.stringify(t.key)}>{t.name}</option>)}</select></label>
        {!rule.targets.length && <p>当前没有可识别的行动对象，可改选不需要其他对象的方式。</p>}
        {rule.parameters.map((p,i) => <label key={p.key}>补充行动后果对象 {i + 1}<select aria-label={`补充行动后果对象 ${i + 1}`} value={bindings[p.key] ?? (p.required ? '' : 'null')} onChange={e => setBindings(v => ({ ...v,[p.key]: e.target.value }))}><option value="">选择对象</option>{!p.required && <option value="null">不绑定</option>}{p.options.map(o => <option key={o.key} value={JSON.stringify(o.key)}>{o.name}</option>)}</select></label>)}
        {paths.length > 0 && <label>补充检查线索<select aria-label="补充检查线索" value={discoveryKey} onChange={e => { setDiscoveryKey(e.target.value);setDiscoveryBindings({}) }}><option value="">本次不进行线索发现</option>{paths.map(d => <option key={d.key} value={d.key} disabled={!d.available}>{d.label}{!d.available ? '（需作者修订）' : ''}</option>)}</select></label>}
        {discovery?.parameters.map((p,i) => <label key={p.key}>补充线索后果对象 {i + 1}<select aria-label={`补充线索后果对象 ${i + 1}`} value={discoveryBindings[p.key] ?? (p.required ? '' : 'null')} onChange={e => setDiscoveryBindings(v => ({ ...v,[p.key]: e.target.value }))}><option value="">选择对象</option>{!p.required && <option value="null">不绑定</option>}{p.options.map(o => <option key={o.key} value={JSON.stringify(o.key)}>{o.name}</option>)}</select></label>)}
      </>}
      <label>补充后的期望结果<textarea aria-label="补充后的期望结果" value={outcome} maxLength={2000} onChange={e => setOutcome(e.target.value)} /></label>
      <button disabled={!goal.trim() || !fieldsReady} onClick={() => action(async () => {
        if (discoveryKey && !discovery?.available) return
        const chosenTarget: unknown = target ? JSON.parse(target) : null
        await clarifyTtrpgOpenTableCandidateV2({ ...source,expectedCount: review.attempts,
          selection: { goal,method: rule ? rule.interactionKey ?? rule.ruleKey : null,targetRefs: typeof chosenTarget === 'string' ? [chosenTarget] : [],requestedOutcome: outcome.trim() ? outcome : null },
          effectBindings: makeBindings(rule?.templateKeys ?? [],rule?.parameters ?? [],bindings),
          ...(discovery ? { discovery: { situationKey: discovery.situationKey,evidenceRef: discovery.evidenceRef,interventionPointKey: discovery.interventionPointKey,effectBindings: makeBindings(discovery.templateKeys,discovery.parameters,discoveryBindings) } } : {}) })
      })}>保存补充并重新核对</button>
    </fieldset>}
    {review?.canConfirm && !editing && <button disabled={busy} onClick={() => action(() => acceptTtrpgOpenTableCandidateV1({ ...source,kind: 'intent',
      ...(review.clarificationHash ? { clarificationHash: review.clarificationHash } : {}) }))}>确认这份行动意图</button>}
    {review?.canConfirm && review.canClarify && !editing && <button disabled={busy} onClick={() => setEditing(true)}>继续补充或修改</button>}
    {editing && <button disabled={busy} onClick={() => setEditing(false)}>取消本次编辑，保留已保存的补充</button>}
    {review && review.attempts === 3 && !review.canClarify && <p>本线程已补充三次，记录会保留；不能重置次数继续追问。</p>}
    {!ready && <><p>这份结果需要修订，尚不能执行；原始响应已经保留。</p>{candidate.artifact.issues.filter(i => i.disposition === 'blocking').map(i => <p key={`${i.code}:${i.path}`} role="alert">{i.message}</p>)}</>}
    <button disabled={busy} onClick={() => action(() => rejectTtrpgOpenTableIntentV1(source))}>放弃这份行动建议</button>
  </div>
}
