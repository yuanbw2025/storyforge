import { useCallback, useEffect, useRef, useState } from 'react'
import type { TtrpgOpenProductionBudgetOwnerV1, TtrpgOpenProductionBudgetValuesV1,
  inspectTtrpgOpenProductionBudgetRevisionV1, prepareTtrpgOpenProductionBudgetRevisionV1,
  saveTtrpgOpenProductionBudgetRevisionV1 } from '../../lib/ttrpg/open-production-budget-revision'

type View = Omit<TtrpgOpenProductionBudgetOwnerV1, 'ledgerHash' | 'failureHash'>
type Inspection = Awaited<ReturnType<typeof inspectTtrpgOpenProductionBudgetRevisionV1>>
type Proposal = Awaited<ReturnType<typeof prepareTtrpgOpenProductionBudgetRevisionV1>>
type Fields = Record<keyof TtrpgOpenProductionBudgetValuesV1, string>
const FIELDS = [['maximumModelCalls', '文本调用次数上限'], ['maximumInputTokens', '输入用量上限（tokens）'],
  ['maximumOutputTokens', '输出用量上限（tokens）']] as const
const TASKS: Record<string, string> = { 'ttrpg.open.source-facts': '世界事实',
  'ttrpg.open.rule-system': '规则与角色', 'ttrpg.open.situation-layer': '局势与压力', 'ttrpg.open.media-plan': '素材规划' }
const viewKey = (view: View) => JSON.stringify([view.scope.projectId, view.scope.worldId, view.scope.workId,
  view.productionId, view.buildId, view.buildNumber, view.controlEpoch, view.expectedStateRevision, view.briefRevision, view.briefHash])
const fieldKey = (value: Fields) => JSON.stringify(FIELDS.map(([key]) => value[key]))

export default function TtrpgOpenProductionBudgetRevision(props: {
  view: View; disabled: boolean; onBusy: (busy: boolean) => void
  onSaved: (result: Awaited<ReturnType<typeof saveTtrpgOpenProductionBudgetRevisionV1>>) => void
}) {
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [fields, setFields] = useState<Fields>({ maximumModelCalls: '', maximumInputTokens: '', maximumOutputTokens: '' })
  const [proposal, setProposal] = useState<{ value: Proposal; fieldsKey: string } | null>(null)
  const [busy, setBusy] = useState(true), [error, setError] = useState('')
  const current = useRef(props), currentFields = useRef(fields), active = useRef(true), generation = useRef(0)
  const inFlight = useRef(false), saveId = useRef<string | null>(null)
  current.current = props
  const key = viewKey(props.view)
  const valid = useCallback((before: typeof props, token: number) => active.current && generation.current === token
    && viewKey(current.current.view) === viewKey(before.view), [])
  useEffect(() => {
    const before = current.current, counter = generation, token = ++counter.current
    active.current = true; setInspection(null); setProposal(null); setBusy(true); setError(''); saveId.current = null
    void import('../../lib/ttrpg/open-production-budget-revision').then(async service => {
      const result = await service.inspectTtrpgOpenProductionBudgetRevisionV1(before.view)
      if (!valid(before, token)) return
      if (viewKey(result.owner) !== viewKey(before.view)) throw new Error('制作状态已变化，请刷新制作页后核对。')
      const next: Fields = { maximumModelCalls: String(result.budget.maximumModelCalls),
        maximumInputTokens: String(result.budget.maximumInputTokens), maximumOutputTokens: String(result.budget.maximumOutputTokens) }
      currentFields.current = next; setFields(next); setInspection(result)
    }).catch(cause => { if (valid(before, token)) setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { if (valid(before, token)) setBusy(false) })
    return () => { active.current = false; counter.current++ }
  }, [key, valid])
  const perform = async (action: (before: typeof props, token: number) => Promise<void>) => {
    if (inFlight.current || current.current.disabled || !inspection) return
    inFlight.current = true
    const before = current.current, token = ++generation.current
    setBusy(true); setError(''); before.onBusy(true)
    try { await action(before, token) }
    catch (cause) { if (valid(before, token)) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { inFlight.current = false; before.onBusy(false); if (valid(before, token)) setBusy(false) }
  }
  const numbers = Object.fromEntries(FIELDS.map(([name]) => [name, Number(fields[name])])) as unknown as TtrpgOpenProductionBudgetValuesV1
  const numbersValid = FIELDS.every(([name]) => fields[name].trim() !== '' && Number.isSafeInteger(numbers[name]) && numbers[name] > 0)
  const preview = () => perform(async (before, token) => {
    setProposal(null); saveId.current = null
    const preparedKey = fieldKey(currentFields.current)
    const result = await (await import('../../lib/ttrpg/open-production-budget-revision'))
      .prepareTtrpgOpenProductionBudgetRevisionV1({ owner: inspection!.owner, values: numbers })
    if (!valid(before, token)) return
    if (fieldKey(currentFields.current) !== preparedKey) throw new Error('读取期间你修改了预算，请重新核对。')
    saveId.current = `ttrpg.budget.${crypto.randomUUID()}`
    setProposal({ value: result, fieldsKey: preparedKey })
  })
  const save = () => perform(async (before, token) => {
    if (!proposal || proposal.fieldsKey !== fieldKey(currentFields.current) || !saveId.current) throw new Error('请先核对当前新预算。')
    const result = await (await import('../../lib/ttrpg/open-production-budget-revision'))
      .saveTtrpgOpenProductionBudgetRevisionV1({ owner: proposal.value.owner, values: proposal.value.values, commandId: saveId.current })
    if (valid(before, token)) before.onSaved(result)
  })
  return <section className="mt-3 rounded border border-accent/40 bg-accent/5 p-4 text-xs" data-testid="ttrpg-open-budget-revision">
    <h3 className="font-semibold">修订下一轮制作预算</h3>
    <p className="my-2 leading-5 text-text-muted">旧轮次已经停止。旧回答、费用和未确认用量继续保留；新上限只用于新方案。核对并保存后，仍需单独确认开始制作。</p>
    {!inspection && !error && <p role="status">正在读取原制作上限…</p>}
    {inspection && <>
      <div className="grid gap-3 sm:grid-cols-3">{FIELDS.map(([name, label]) => <label key={name} className="grid gap-1">
        {label}<input aria-label={label} type="number" min="1" step="1" disabled={props.disabled || busy} value={fields[name]}
          onChange={event => { const next = { ...currentFields.current, [name]: event.target.value }; currentFields.current = next; setFields(next); setProposal(null); saveId.current = null }}
          className="rounded border border-border bg-bg-base p-2" />
        <span className="text-text-muted">原上限 {inspection.budget[name].toLocaleString()}</span>
      </label>)}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={props.disabled || busy || !numbersValid} onClick={() => { void preview() }} className="rounded border border-accent/40 px-3 py-2">核对新预算</button>
        <button type="button" disabled={props.disabled || busy || !proposal || proposal.fieldsKey !== fieldKey(fields)} onClick={() => { void save() }} className="rounded border border-accent/40 px-3 py-2">保存为新制作方案</button>
      </div>
      {proposal && <div className="mt-3 rounded border border-border bg-bg-base p-3" role="status">
        <p>下一轮最多 {proposal.value.values.maximumModelCalls} 次文本调用，输入 {proposal.value.values.maximumInputTokens.toLocaleString()}、输出 {proposal.value.values.maximumOutputTokens.toLocaleString()} tokens。</p>
        <ul className="my-2 space-y-1">{proposal.value.previewPlan.tasks.filter(task => task.executionMode === 'model').map(task => <li key={task.taskKey}>
          {TASKS[task.taskKey] ?? '素材制作'}：输入最多 {task.budgetReservation.inputTokens.toLocaleString()}，输出最多 {task.budgetReservation.outputTokens.toLocaleString()} tokens
        </li>)}</ul>
        <p>这是计划预览。原世界、角色设置、媒资要求及费用策略沿用原方案；正式请求仍须通过完整输入与剩余额度检查。</p>
      </div>}
    </>}
    {error && <p role="alert" className="mt-3 text-error">{error.replace(/^\[[^\]]+\]\s*/, '')}</p>}
  </section>
}
