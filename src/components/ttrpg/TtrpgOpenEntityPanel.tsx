import { useCallback, useEffect, useRef, useState } from 'react'
import type { TtrpgOpenEntityProposalV1 } from '../../lib/ttrpg/open-entity-contract'
import { readTtrpgOpenEntityDeskV1, startTtrpgOpenEntityDeskV1, consultTtrpgOpenEntityDeskV1, proposeTtrpgOpenEntityDeskV1,
  confirmTtrpgOpenEntityDeskV1, materializeTtrpgOpenEntityDeskV1, disposeTtrpgOpenEntityDeskV1, closeTtrpgOpenEntityDeskV1,
  type TtrpgOpenEntityDeskInputV1 } from '../../lib/ttrpg/open-entity-desk'
import TtrpgOpenEntityModelPanel from './TtrpgOpenEntityModelPanel'
type Desk = Awaited<ReturnType<typeof readTtrpgOpenEntityDeskV1>>
const kinds = { actor: 'NPC', location: '地点', item: '物品' }

export default function TtrpgOpenEntityPanel(props: { input: TtrpgOpenEntityDeskInputV1; sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void> }) {
  const [page, setPage] = useState<Desk>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [expanded, setExpanded] = useState(false)
  const [tableKey, setTableKey] = useState(''), [question, setQuestion] = useState(''), [tier, setTier] = useState(''), [oracleSequence, setOracleSequence] = useState('')
  const [templateKey, setTemplateKey] = useState(''), [name, setName] = useState(''), [description, setDescription] = useState('')
  const [parameters, setParameters] = useState<Record<string, string>>({}), [placement, setPlacement] = useState('')
  const [basket, setBasket] = useState<TtrpgOpenEntityProposalV1[]>([]), [reviewed, setReviewed] = useState(false), [reason, setReason] = useState('')
  const live = useRef(true), revision = useRef(0), locked = useRef(false), proposalSubmission = useRef(crypto.randomUUID())
  const { scope: { projectId, worldId, workId }, sessionId, viewerKey } = props.input
  const input = useCallback(() => ({ scope: { projectId, worldId, workId }, sessionId, viewerKey }), [projectId, worldId, workId, sessionId, viewerKey])
  const refresh = useCallback(async () => {
    const token = ++revision.current
    try { const next = await readTtrpgOpenEntityDeskV1(input()); if (live.current && token === revision.current) { setPage(next); setError('') } }
    catch (cause) { if (live.current && token === revision.current) { setPage(null); setError(cause instanceof Error ? cause.message : String(cause)) } }
  }, [input])
  useEffect(() => { live.current = true; setReviewed(false); void refresh(); return () => { live.current = false; revision.current += 1 } }, [refresh, props.sequence])
  const act = (job: () => Promise<unknown>, message: string) => props.perform(async () => {
    if (locked.current) return
    locked.current = true; setError(''); setNotice(''); let failure = ''
    try { await job(); if (live.current) { setNotice(message); setReviewed(false) } }
    catch (cause) { failure = cause instanceof Error ? cause.message : String(cause) }
    finally { locked.current = false; if (live.current) { await refresh(); if (failure) setError(failure) } }
  })
  const resetDraft = () => { setTemplateKey(''); setName(''); setDescription(''); setParameters({}); setPlacement('') }
  const changed = () => { proposalSubmission.current = crypto.randomUUID(); setReviewed(false) }
  const table = page?.tables.find(t => t.key === tableKey), template = page?.templates.find(t => t.key === templateKey)
  const oracle = page?.oracles.find(o => String(o.sourceRef.sequence) === oracleSequence), pending = page?.pending
  const cost = basket.reduce((n, p) => n + (page?.templates.find(t => t.key === p.templateKey)?.instanceCost ?? 0), 0)
  const ready = template && name.trim() && description.trim() && template.parameters.every(p => !p.required || parameters[p.key])
    && (template.kind === 'location' || placement) && basket.filter(p => p.templateKey === template.key).length < template.remaining
    && basket.length < 3 && oracle && cost + template.instanceCost <= oracle.remaining
  const disabled = props.busy || Boolean(page && page.sequence !== props.sequence)
  if (!page && !error && !notice) return null
  return <details className="sf-open-table-card" data-testid="ttrpg-open-entity-desk" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}><summary>本局新人物、地点与物品</summary>
    <p>先咨询并保存原结果，再提出冻结模板允许的对象。提案和确认都不会立即创建，全部相关角色确认后由原主持明确创建。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button disabled={props.busy} onClick={() => { setReviewed(false); void refresh() }}>读取实体创建进度</button>
    {page?.host && <>
      {page.canStart && <button disabled={disabled} onClick={() => void act(() => startTtrpgOpenEntityDeskV1({ ...input(), submissionKey: crypto.randomUUID(), decision: 'start-this-consultation' }), '本次咨询已开始，请选择咨询表和问题。')}>开始本次实体咨询</button>}
      {!page.canStart && !page.ownWindow && <p>请先处理并结束当前窗口，再开始新的实体咨询。</p>}
      {page.ownWindow && !pending && <fieldset disabled={disabled || !page.canConsult}><legend>咨询原结果</legend>
        <label>实体咨询表<select aria-label="实体咨询表" value={tableKey} onChange={e => { setTableKey(e.target.value); setTier('') }}><option value="">选择咨询表</option>{page.tables.map(t => <option key={t.key} value={t.key}>{t.title}</option>)}</select></label>
        {Boolean(table?.tiers.length) && <label>本次可能性<select aria-label="本次可能性" value={tier} onChange={e => setTier(e.target.value)}><option value="">明确选择可能性</option>{table!.tiers.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>}
        <label>实体咨询问题<textarea aria-label="实体咨询问题" maxLength={2000} value={question} onChange={e => setQuestion(e.target.value)} /></label>
        <button disabled={!table || !question.trim() || Boolean(table.tiers.length) && !tier} onClick={() => void act(() => consultTtrpgOpenEntityDeskV1({ ...input(), submissionKey: crypto.randomUUID(), oracleKey: tableKey, question, likelihoodTierKey: tier || null }), '原咨询结果已保存；刷新不会重新咨询。')}>明确咨询一次</button>
      </fieldset>}
      {page.oracles.map(o => <article key={o.sourceRef.sequence}><p>问题：{o.question}</p><p>原结果：{o.result}；本次还可创建 {o.remaining} 个对象（含初始装备）。</p>{o.constraints.map((s, i) => <p key={i}>{s}</p>)}</article>)}
      {!pending && page.ownWindow && <fieldset disabled={disabled || !page.canPropose}><legend>选择本次创建依据</legend>
        <label>本次创建依据<select aria-label="本次创建依据" value={oracleSequence} onChange={e => { setOracleSequence(e.target.value); setBasket([]); changed() }}><option value="">选择已保存的原结果</option>{page.oracles.filter(o => o.remaining > 0).map(o => <option key={o.sourceRef.sequence} value={o.sourceRef.sequence}>{o.question}（余 {o.remaining}）</option>)}</select></label>
      </fieldset>}
      <TtrpgOpenEntityModelPanel input={input()} oracleSourceRef={oracle?.sourceRef} sequence={props.sequence} busy={props.busy} perform={props.perform} />
      {!pending && page.ownWindow && <fieldset disabled={disabled || !page.canPropose}><legend>人工提出本局对象</legend>
        <label>新对象模板<select aria-label="新对象模板" value={templateKey} onChange={e => { resetDraft(); setTemplateKey(e.target.value); changed() }}><option value="">选择允许的模板</option>{page.templates.map(t => <option key={t.key} value={t.key} disabled={t.remaining <= basket.filter(p => p.templateKey === t.key).length}>{kinds[t.kind]}：{t.description}</option>)}</select></label>
        {template && <>
          <p>模板可用名额：{template.remaining}；本对象连同初始装备占用 {template.instanceCost} 个名额。</p>
          <label>新对象名称<input aria-label="新对象名称" maxLength={template.maximumNameLength} value={name} onChange={e => { setName(e.target.value); changed() }} /></label>
          <label>新对象说明<textarea aria-label="新对象说明" maxLength={4000} value={description} onChange={e => { setDescription(e.target.value); changed() }} /></label>
          {template.parameters.map((p, i) => <label key={p.key}>模板参数 {i + 1}{p.required ? '（必选）' : '（可选）'}<select aria-label={`模板参数 ${i + 1}`} value={parameters[p.key] ?? ''} onChange={e => { setParameters(v => ({ ...v, [p.key]: e.target.value })); changed() }}><option value="">选择允许值</option>{p.values.map(v => <option key={v} value={v}>{v}</option>)}</select></label>)}
          {template.kind !== 'location' && <label>初始位置或持有人<select aria-label="初始位置或持有人" value={placement} onChange={e => { setPlacement(e.target.value); changed() }}><option value="">选择实际地点或角色</option>{page.placements.filter(p => template.kind === 'item' || p.kind === 'location').map(p => <option key={p.key} value={p.key}>{p.kind === 'actor' ? '库存：' : '地点：'}{p.name}</option>)}</select></label>}
          <button disabled={!ready} onClick={() => {
            if (!template || !ready) return
            const place = page.placements.find(p => p.key === placement)
            setBasket(v => [...v, { templateKey: template.key, name, description,
              parameters: Object.fromEntries(Object.entries(parameters).filter(([, value]) => value)),
              locationRef: template.kind === 'location' || place?.kind !== 'location' ? null : placement,
              ownerRef: template.kind === 'item' && place?.kind === 'actor' ? placement : null }]); resetDraft(); changed()
          }}>加入待确认清单</button>
        </>}
        {basket.map((p, i) => <p key={i}>{p.name}<button onClick={() => { setBasket(v => v.filter((_, n) => n !== i)); changed() }}>移除「{p.name}」</button></p>)}
        <p>清单共占用 {cost} 个名额。</p>
        <button disabled={!basket.length || !oracle || cost > oracle.remaining} onClick={() => void act(async () => {
          if (!oracle) return
          await proposeTtrpgOpenEntityDeskV1({ ...input(), submissionKey: proposalSubmission.current, oracleSourceRef: oracle.sourceRef, proposals: basket })
          if (live.current) { setBasket([]); changed() }
        }, '提案已保存，请审阅本版本并分别确认。尚未创建对象。')}>保存待确认提案</button>
      </fieldset>}
      {page.canClose && !page.hasUnadoptedEntityModelRequest && <button disabled={disabled} onClick={() => void act(() => closeTtrpgOpenEntityDeskV1({ ...input(), submissionKey: crypto.randomUUID() }), '本次咨询窗口已结束，原结果与已创建对象保留。')}>结束本次实体咨询</button>}
      {page.canClose && page.hasUnadoptedEntityModelRequest && <p>请在 AI 起草中明确放弃未采用候选并结束本次咨询。</p>}
    </>}
    {pending && <section aria-label="待确认实体计划"><h3>{pending.originalHost ? '本次创建计划' : '与我有关的库存变化'}</h3>
      <p>{pending.origin === 'model' ? '本计划来自 AI 候选，已由原主持审阅；创建仍须相关角色分别确认。' : '本计划由真人提出；创建仍须相关角色分别确认。'}</p>
      {pending.items.map((item, i) => <article key={i}><h4>{kinds[item.kind]}：{item.name}</h4><p>{item.description}</p><p>{item.placement}；含初始装备共 {item.instanceCost} 个对象。</p>{item.parameters.map(p => <p key={p.name}>参数：{p.value}</p>)}{item.impact.map((s, n) => <p key={n}>{s}</p>)}</article>)}
      <p>已同意 {pending.approved} / {pending.required}。{pending.rejected ? '已有拒绝决定，请放弃本计划。' : '确认后仍须由原主持明确创建。'}</p>
      <label><input type="checkbox" checked={reviewed} disabled={disabled || !pending.canConfirm} onChange={e => setReviewed(e.target.checked)} />我已审阅本版本对相关角色的影响。</label>
      {pending.approvals.map(a => <div key={a.actorKey}><p>{a.name}：{a.decision === 'approve' ? '已同意' : a.decision === 'reject' ? '已拒绝' : '待本人确认'}</p>{!a.decision && <>
        <button disabled={disabled || !reviewed || !pending.canConfirm} onClick={() => void act(() => confirmTtrpgOpenEntityDeskV1({ ...input(), operationKey: pending.operationKey, planHash: pending.planHash, actorKey: a.actorKey, decision: 'approve', review: 'reviewed-this-plan' }), '本人的同意已保存。')}>同意为「{a.name}」创建本次对象</button>
        <button disabled={disabled || !reviewed || !pending.canConfirm} onClick={() => void act(() => confirmTtrpgOpenEntityDeskV1({ ...input(), operationKey: pending.operationKey, planHash: pending.planHash, actorKey: a.actorKey, decision: 'reject', review: 'reviewed-this-plan' }), '本人的拒绝已保存，不会创建该计划。')}>拒绝为「{a.name}」创建本次对象</button>
      </>}</div>)}
      {pending.originalHost && <button disabled={disabled || !pending.canMaterialize} onClick={() => void act(() => materializeTtrpgOpenEntityDeskV1({ ...input(), operationKey: pending.operationKey, planHash: pending.planHash, decision: 'create-this-confirmed-plan' }), '本次对象已创建并保存，可以在后续规则行动中使用。')}>明确创建已确认对象</button>}
      {pending.canDispose && <><label>放弃原因<input aria-label="放弃实体计划原因" maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label><button disabled={disabled || !reason.trim()} onClick={() => void act(() => disposeTtrpgOpenEntityDeskV1({ ...input(), operationKey: pending.operationKey, planHash: pending.planHash, reason }), '计划已放弃，没有创建对象。')}>放弃本次实体计划</button></>}
    </section>}
    {Boolean(page?.entities.length) && <section aria-label="已创建的本局对象"><h3>我可见的本局对象</h3>{page!.entities.map(e => <p key={e.key}>{kinds[e.kind]}：{e.name}{e.active ? '' : '（当前不可用）'}</p>)}</section>}
  </details>
}
