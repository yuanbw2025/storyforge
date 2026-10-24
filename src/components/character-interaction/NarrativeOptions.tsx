import type {ChatNarrativeOptionsPreviewV1} from '../../lib/character-interaction/narrative-options-preview'
import type {ChatNarrativeOptionKeyV1} from '../../lib/character-interaction/narrative-options'

export default function NarrativeOptions(props: {
  candidate: ChatNarrativeOptionsPreviewV1
  disabled: boolean
  onChoose: (key: ChatNarrativeOptionKeyV1) => void
  onCancel: () => void
}) {
  const {candidate} = props
  return <section data-testid="chat-narrative-options" className="space-y-3 rounded border border-accent/30 bg-bg-surface p-4">
    <h2 className="text-sm font-semibold">选择角色的下一步</h2>
    <p className="text-xs text-text-muted">两条行动都从当前局面出发。采用一条后，只有它的表达和后果进入故事；另一条不会发生。</p>
    {candidate.selectedOptionKey && <p className="text-xs text-text-muted">选择已保存。继续保存不会重复执行；取消也不会撤回已经发生的行动。</p>}
    {candidate.unavailableReason && <p role="status" className="text-xs text-warning">{candidate.unavailableReason}</p>}
    <div className="grid gap-3 md:grid-cols-2">{candidate.options.map((option, i) => <article key={option.key} className="space-y-3 rounded border border-border bg-bg-base p-3">
      <h3 className="text-xs font-semibold">行动 {i + 1}</h3><p className="whitespace-pre-wrap text-sm">{option.text}</p>
      <button disabled={props.disabled || !!candidate.unavailableReason || !!candidate.selectedOptionKey && candidate.selectedOptionKey !== option.key} onClick={() => props.onChoose(option.key)} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">{candidate.selectedOptionKey === option.key ? '继续保存已选行动' : `采用行动 ${i + 1}`}</button>
    </article>)}</div>
    <button disabled={props.disabled} onClick={props.onCancel} className="rounded border border-border px-3 py-2 text-xs">取消这组候选</button>
  </section>
}
