import { useCallback, useEffect, useRef, useState } from 'react'
import TtrpgOpenProductionReview from './TtrpgOpenProductionReview'
import type { TtrpgOpenContentRevisionViewV1, inspectTtrpgOpenContentRevisionV1,
  readTtrpgOpenContentRevisionDraftV1, prepareTtrpgOpenContentRevisionProposalV1,
  submitTtrpgOpenContentRevisionV1, prepareTtrpgOpenLocalNoDispatchProposalV1, submitTtrpgOpenLocalNoDispatchV1 } from '../../lib/ttrpg/open-production-content-revision-service'
type Inspection = Awaited<ReturnType<typeof inspectTtrpgOpenContentRevisionV1>>
type Source = Awaited<ReturnType<typeof readTtrpgOpenContentRevisionDraftV1>>
type LocalProposal = Awaited<ReturnType<typeof prepareTtrpgOpenLocalNoDispatchProposalV1>>
type Key = Source['artifactKey']
type Proposal = Awaited<ReturnType<typeof prepareTtrpgOpenContentRevisionProposalV1>> & {
  inputSnapshot: { selected: Key; draft: string; note: string }
}
const LABELS: Record<string, string> = { 'ttrpg.open.source-facts': '来源事实', 'ttrpg.open.rule-system': '规则与角色',
  'ttrpg.open.situation-layer': '局势与压力', 'ttrpg.open.media-plan': '素材规划', 'ttrpg.open.integration': '作品集成', 'ttrpg.open.quality': '质量核对' }
const viewKey = (v: TtrpgOpenContentRevisionViewV1) => JSON.stringify([v.scope.projectId, v.scope.worldId, v.scope.workId,
  v.productionId, v.buildId, v.controlEpoch, v.expectedStateRevision, v.planHash])

export default function TtrpgOpenContentRevision(props: {
  view: TtrpgOpenContentRevisionViewV1; disabled: boolean; onBusy: (value: boolean) => void
  onAccounted: (result: Awaited<ReturnType<typeof submitTtrpgOpenLocalNoDispatchV1>>) => void
  onSubmitted: (result: Awaited<ReturnType<typeof submitTtrpgOpenContentRevisionV1>>) => void
}) {
  const [inspection, setInspection] = useState<Inspection | null>(null), [source, setSource] = useState<Source | null>(null)
  const [selected, setSelected] = useState<Key>('ttrpg.open.situation-layer'), [draft, setDraft] = useState(''), [note, setNote] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState('')
  const [localProposal, setLocalProposal] = useState<LocalProposal | null>(null)
  const current = useRef(props), active = useRef(true), serial = useRef(0), inFlight = useRef(false)
  const fields = useRef({ selected, draft, note }); fields.current = { selected, draft, note }; current.current = props
  const key = viewKey(props.view)
  const valid = useCallback((before: typeof props, token: number) => active.current && serial.current === token
    && viewKey(current.current.view) === viewKey(before.view), [])
  useEffect(() => {
    const before = current.current, counter = serial, token = ++counter.current
    active.current = true; setInspection(null); setSource(null); setProposal(null); setLocalProposal(null); setDraft(''); setNote(''); setError(''); setBusy(true)
    void import('../../lib/ttrpg/open-production-content-revision-service').then(async service => {
      const value = await service.inspectTtrpgOpenContentRevisionV1(before.view)
      if (!valid(before, token)) return
      if (viewKey(value.owner) !== viewKey(before.view)) throw Error('制作状态已变化，请刷新后读取。')
      setInspection(value); setSelected(value.choices.find(choice => choice.artifactKey === 'ttrpg.open.situation-layer')?.artifactKey
        ?? value.choices[value.choices.length - 1]?.artifactKey ?? 'ttrpg.open.source-facts')
    }).catch(cause => { if (valid(before, token)) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (valid(before, token)) setBusy(false) })
    return () => { active.current = false; counter.current++ }
  }, [key, valid])
  const perform = async (action: (before: typeof props, token: number) => Promise<void>) => {
    if (inFlight.current || current.current.disabled || !inspection) return
    inFlight.current = true
    const before = current.current, token = ++serial.current
    setBusy(true); setError(''); before.onBusy(true)
    try { await action(before, token) }
    catch (cause) { if (valid(before, token)) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { inFlight.current = false; before.onBusy(false); if (valid(before, token)) setBusy(false) }
  }
  const changed = (next: string) => { fields.current.draft = next; setDraft(next); setProposal(null) }
  const load = () => perform(async (before, token) => {
    const selection = fields.current.selected
    setSource(null); setProposal(null); setLocalProposal(null); setDraft(''); setNote('')
    const value = await (await import('../../lib/ttrpg/open-production-content-revision-service'))
      .readTtrpgOpenContentRevisionDraftV1({ owner: inspection!.owner, artifactKey: selection })
    if (!valid(before, token) || fields.current.selected !== selection) return
    setSource(value); setDraft(value.authorDraftJson)
  })
  const preview = () => perform(async (before, token) => {
    if (!source) return
    const snapshot = { ...fields.current }; setProposal(null)
    const value = await (await import('../../lib/ttrpg/open-production-content-revision-service')).prepareTtrpgOpenContentRevisionProposalV1({
      source, authorDraftJson: snapshot.draft, note: snapshot.note, commandId: `ttrpg.content.${crypto.randomUUID()}` })
    if (!valid(before, token)) return
    if (JSON.stringify(fields.current) !== JSON.stringify(snapshot)) throw Error('核对期间稿件已变化，请重新核对。')
    setProposal({ ...value, inputSnapshot: snapshot })
  })
  const submit = () => perform(async (before, token) => {
    // Command parsing normalizes text; freshness belongs to the raw reviewed inputs.
    if (!proposal || proposal.blockedReason || proposal.inputSnapshot.selected !== fields.current.selected
      || proposal.inputSnapshot.draft !== fields.current.draft || proposal.inputSnapshot.note !== fields.current.note) return
    const result = await (await import('../../lib/ttrpg/open-production-content-revision-service')).submitTtrpgOpenContentRevisionV1(proposal)
    if (valid(before, token)) before.onSubmitted(result)
  })
  const inspectLocal = () => perform(async (before, token) => {
    if (!source) return
    setLocalProposal(null)
    const value = await (await import('../../lib/ttrpg/open-production-content-revision-service'))
      .prepareTtrpgOpenLocalNoDispatchProposalV1({ source, commandId: `ttrpg.local-accounting.${crypto.randomUUID()}` })
    if (valid(before, token)) setLocalProposal(value)
  })
  const submitLocal = () => perform(async (before, token) => {
    if (!localProposal) return
    const result = await (await import('../../lib/ttrpg/open-production-content-revision-service')).submitTtrpgOpenLocalNoDispatchV1(localProposal)
    if (valid(before, token)) before.onAccounted(result)
  })
  const locked = props.disabled || busy
  const localPending = (inspection?.unreportedFailedCount ?? 0) > 0
  const editingLocked = locked || localPending || !!inspection?.needsAccounting
  return <section data-testid="ttrpg-open-content-revision" className="my-3 rounded border border-accent/30 bg-bg-base p-4 text-xs text-text-main">
    <h3 className="font-semibold">返修已采用原稿</h3>
    <p className="my-2 leading-6 text-text-muted">载入和核对不调用模型。提交返修后保留旧稿和历史用量，使用原预算重做受影响步骤。</p>
    {error && <p role="alert" className="my-2 text-error">{error}</p>}
    {inspection?.needsAccounting && <p role="alert">暂停时仍有在途请求。请先通过原费用核对入口明确处理，再暂停返修。</p>}
    <fieldset disabled={locked}>
      <label>选择返修原稿<select aria-label="选择返修原稿" className="mx-2 rounded border border-border bg-bg-elevated p-2" value={selected}
        onChange={event => { fields.current.selected = event.target.value as Key; setSelected(event.target.value as Key); setSource(null); setProposal(null); setLocalProposal(null); setDraft(''); setNote('') }}>
        {inspection?.choices.map(choice => <option key={choice.artifactKey} value={choice.artifactKey}>{LABELS[choice.artifactKey]} · 版本 {choice.version}</option>)}
      </select></label>
      <button type="button" disabled={!inspection?.choices.length || locked} onClick={() => { void load() }} className="rounded border border-border px-3 py-2">载入已采用原稿</button>
    </fieldset>
    {source && inspection && <>
      <p className="my-3 break-all text-text-muted">原稿版本 {source.version} · {source.contentHash}</p>
      <details className="my-2"><summary>查看保留的原稿</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(JSON.parse(source.authorDraftJson), null, 2)}</pre></details>
      {localPending && !inspection.needsAccounting && <section className="my-3 rounded border border-border p-3" data-testid="ttrpg-local-no-dispatch-booking">
        <p>发现 {inspection.unreportedFailedCount} 条旧失败尚未报告用量。请先核对原始证据，再返修原稿。</p>
        <p className="my-2 text-text-muted">只有完整证据能证明未发送时，才可关闭对应未知记录；其他请求仍需通过原费用核对入口处理。</p>
        <button type="button" disabled={locked} onClick={() => { void inspectLocal() }} className="rounded border border-border px-3 py-2">核对旧失败记录</button>
        {localProposal && <div role="status" className="my-3">
          <p>已证明以下记录没有发送供应商请求。确认后保留原未知记录与核对凭据，按零供应商用量关闭；制作仍保持暂停。</p>
          <ul className="my-2 list-inside list-disc">{localProposal.attempts.map(row => <li key={`${row.controlEpoch}:${row.taskKey}:${row.attempt}`}>
            {LABELS[row.taskKey] ?? row.taskKey}：{row.classification === 'preflight-before-dispatch' ? '发送前预检失败' : '本地素材校验失败'}，本地耗时 {row.durationMs} 毫秒
          </li>)}</ul>
          <button type="button" disabled={locked} onClick={() => { void submitLocal() }} className="rounded border border-accent/40 px-3 py-2">确认关闭未发送记录</button>
        </div>}
      </section>}
      {selected !== 'ttrpg.open.situation-layer' && <TtrpgOpenProductionReview taskKey={selected} brief={inspection.brief}
        value={draft} onChange={changed} disabled={editingLocked} />}
      {selected === 'ttrpg.open.situation-layer' && <VisualBaselines value={draft} onChange={changed} disabled={editingLocked} />}
      <details className="my-3"><summary>编辑完整修订稿（高级 JSON）</summary>
        <textarea aria-label="返修原稿 JSON" value={draft} disabled={editingLocked} maxLength={120000} onChange={event => changed(event.target.value)}
          className="mt-2 min-h-72 w-full rounded border border-border bg-bg-elevated p-3 font-mono text-[11px]" />
      </details>
      <label className="block">返修说明<textarea aria-label="返修说明" disabled={editingLocked} maxLength={2000} value={note}
        onChange={event => { fields.current.note = event.target.value; setNote(event.target.value); setProposal(null) }}
        className="my-2 block min-h-20 w-full rounded border border-border bg-bg-elevated p-2" /></label>
      <button type="button" disabled={editingLocked || !draft.trim() || !note.trim() || inspection.needsAccounting} onClick={() => { void preview() }}
        className="rounded border border-accent/40 px-3 py-2">核对返修与影响</button>
      {proposal && <div role="status" className="my-3 rounded border border-border p-3">
        {proposal.blockedReason ? <p role="alert">检测到 {proposal.additionalTaskKeys.length} 个上游模型岗位需要按当前版本重新核验，当前局部返修不可提交。请先停止并保留旧轮次，核对下一轮制作方案后单独授权开始。</p>
          : <p>本次返修采用作者稿，不调用模型。后续 {proposal.tasks.filter(task => task.execution === 'model').length} 个模型岗位可能重新调用，仍使用原剩余额度。</p>}
        <ul className="my-2 list-inside list-disc">{proposal.tasks.map(task => <li key={task.taskKey}>{LABELS[task.taskKey] ?? task.taskKey}：{task.execution === 'author' ? proposal.blockedReason ? '原修订稿（未提交）' : '采用本次作者稿' : task.execution === 'model' ? '重新生成并审阅' : '重新校验'}</li>)}</ul>
        {!proposal.blockedReason && <button type="button" disabled={locked} onClick={() => { void submit() }} className="rounded bg-accent px-3 py-2 text-white">提交返修并继续制作</button>}
      </div>}
    </>}
  </section>
}

function VisualBaselines(props: { value: string; onChange: (text: string) => void; disabled: boolean }) {
  const [page, setPage] = useState(0)
  type Expression = { expressionKey: string; prompt: string }
  let root: { metadata: { visualBible: { characters: Array<{ characterKey: string; expressionBaselines: Expression[] }> } } }
  try { root = JSON.parse(props.value) } catch { return <p>完整 JSON 暂不能解析，请先在高级修订中补齐。</p> }
  const rows = root?.metadata?.visualBible?.characters
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.characterKey !== 'string' || !Array.isArray(row.expressionBaselines)
    || row.expressionBaselines.some(expression => !expression || typeof expression.expressionKey !== 'string' || typeof expression.prompt !== 'string'))) {
    return <p>当前视觉角色结构尚不完整，请在高级修订中补齐。</p>
  }
  const pages = Math.max(1, Math.ceil(rows.length / 10)), shown = Math.min(page, pages - 1)
  const change = (index: number, baseline: number | null, field?: 'expressionKey' | 'prompt', text?: string) => {
    const next = structuredClone(root), expressions = next.metadata.visualBible.characters[index].expressionBaselines
    if (baseline == null) {
      let count = 1, key = 'neutral'
      while (expressions.some(row => row.expressionKey === key)) key = `expression.${++count}`
      expressions.push({ expressionKey: key, prompt: '' })
    } else expressions[baseline][field!] = text ?? ''
    props.onChange(JSON.stringify(next))
  }
  return <fieldset disabled={props.disabled} className="my-3 grid gap-3"><legend>视觉角色表情基线</legend>
    {rows.slice(shown * 10, (shown + 1) * 10).map((row, offset) => <article key={`${shown * 10 + offset}:${row.characterKey}`} className="rounded border border-border p-3">
      <p>{row.characterKey}</p>{row.expressionBaselines.length === 0 && <p className="my-2 text-error">此角色还没有表情基线。</p>}
      {row.expressionBaselines.map((expression, index) => <div key={index} className="my-2 grid gap-2">
        <label>表情标识<input aria-label={`${row.characterKey} 表情 ${index + 1} 标识`} value={typeof expression?.expressionKey === 'string' ? expression.expressionKey : ''} maxLength={200}
          onChange={event => change(shown * 10 + offset, index, 'expressionKey', event.target.value)} className="mx-2 rounded border border-border bg-bg-elevated p-2" /></label>
        <label>表情描述<input aria-label={`${row.characterKey} 表情 ${index + 1} 描述`} value={typeof expression?.prompt === 'string' ? expression.prompt : ''} maxLength={2000}
          onChange={event => change(shown * 10 + offset, index, 'prompt', event.target.value)} className="mx-2 w-2/3 rounded border border-border bg-bg-elevated p-2" /></label>
      </div>)}
      <button type="button" disabled={row.expressionBaselines.length >= 32} onClick={() => change(shown * 10 + offset, null)} className="rounded border border-border px-2 py-1">新增表情基线</button>
    </article>)}
    {pages > 1 && <div><button type="button" disabled={shown === 0} onClick={() => setPage(shown - 1)}>上一组</button><span className="mx-3">{shown + 1}/{pages}</span><button type="button" disabled={shown + 1 >= pages} onClick={() => setPage(shown + 1)}>下一组</button></div>}
  </fieldset>
}
