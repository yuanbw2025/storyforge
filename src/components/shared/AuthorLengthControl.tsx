import {
  AUTOMATIC_AUTHOR_LENGTH_V1, authorLengthFromControlV1, describeTaskLengthPlanV1,
  type AuthorLengthControlValueV1,
} from '../../lib/ai/author-length-intent'
import type { LengthBasisV1, TaskLengthPlanV1 } from '../../lib/types/agent-run'

export default function AuthorLengthControl({ value, onChange, disabled = false, basis = 'final-text', allowBasisChoice = false, plan, notice }: {
  value: AuthorLengthControlValueV1
  onChange: (value: AuthorLengthControlValueV1) => void
  disabled?: boolean
  basis?: LengthBasisV1
  allowBasisChoice?: boolean
  plan?: TaskLengthPlanV1 | null
  notice?: string | null
}) {
  // Hidden basis controls cannot keep a stale counting mode from an earlier operation.
  const effective = allowBasisChoice ? value : { ...value, basis }
  const change = (next: AuthorLengthControlValueV1) => onChange({ ...next, basis: allowBasisChoice ? next.basis ?? basis : basis })
  let error = ''
  try { authorLengthFromControlV1(effective, basis) } catch (cause) { error = cause instanceof Error ? cause.message : '篇幅要求无效。' }
  const amount = (key: 'targetWords' | 'minWords' | 'maxWords', label: string) => <label className="flex items-center gap-1 text-xs">
    {label}<input type="number" min={1} step={1} value={value[key] ?? ''} disabled={disabled}
      aria-label={label} className="w-28 rounded border border-border bg-bg-base px-2 py-1"
      onChange={event => change({ ...effective, [key]: Number.isSafeInteger(event.target.valueAsNumber) ? event.target.valueAsNumber : null })} />
  </label>
  return <div className="space-y-1">
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs">篇幅<select aria-label="篇幅安排" disabled={disabled} value={value.mode}
        className="ml-1 rounded border border-border bg-bg-base px-2 py-1"
        onChange={event => change({ ...AUTOMATIC_AUTHOR_LENGTH_V1, basis: effective.basis ?? basis, mode: event.target.value as AuthorLengthControlValueV1['mode'] })}>
        <option value="automatic">自动，按任务安排</option><option value="approximate">约多少字</option>
        <option value="exact">恰好多少字</option><option value="range">字数范围</option>
        <option value="at-least">至少多少字</option><option value="at-most">最多多少字</option>
      </select></label>
      {(value.mode === 'approximate' || value.mode === 'exact') && amount('targetWords', '目标字数')}
      {(value.mode === 'range' || value.mode === 'at-least') && amount('minWords', '最少字数')}
      {(value.mode === 'range' || value.mode === 'at-most') && amount('maxWords', '最多字数')}
      {allowBasisChoice && <select aria-label="篇幅计数范围" disabled={disabled} value={effective.basis ?? basis}
        className="rounded border border-border bg-bg-base px-2 py-1 text-xs"
        onChange={event => change({ ...effective, basis: event.target.value as LengthBasisV1 })}>
        <option value="additional-text">只计净新增内容</option><option value="final-text">计最终全文</option>
      </select>}
    </div>
    {error ? <p role="alert" className="text-xs text-error">{error}</p>
      : plan ? <p role="status" className="text-xs text-text-secondary">{describeTaskLengthPlanV1(plan)}</p>
        : <p className="text-xs text-text-secondary">自动篇幅按任务安排；填写“约多少字”时，生成前显示实际范围。</p>}
    {notice && <p role="status" className="text-xs text-warning">{notice}</p>}
    <p className="text-xs text-text-muted">字数沿现有统计口径计为去空白后的字符数。</p>
  </div>
}
