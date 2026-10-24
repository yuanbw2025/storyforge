import type {ChatHistoricalOptionsPlanV1} from '../../lib/character-interaction/narrative-options-history'
import type {ChatNarrativeOptionKeyV1} from '../../lib/character-interaction/narrative-options'

export default function NarrativeHistoryOptions(props: {
  plan: ChatHistoricalOptionsPlanV1
  names: Record<string, string>
  disabled: boolean
  onChoose: (key: ChatNarrativeOptionKeyV1) => void
  onCancel: () => void
}) {
  return <section data-testid="chat-historical-options" className="space-y-3 rounded border border-accent/30 bg-bg-surface p-4">
    <h2 className="text-sm font-semibold">改选这条回复的其他候选</h2>
    <p className="text-xs text-text-muted">原时间线保留。选择后，会在这条回复之前建立新分支，保存所选文字和听众范围；原回复及之后的 {Math.max(0, props.plan.edit.removedMessageCount - 1)} 条消息，以及它们产生的事实、关系、记忆和打算不会带入。还需重新审查后果，才会成为分支中的正式回复。</p>
    <div className="grid gap-3 md:grid-cols-2">{props.plan.options.map((option, index) => <article key={option.key} className="space-y-2 rounded border border-border bg-bg-base p-3">
      <h3 className="text-xs font-semibold">候选 {index + 1}{option.key === props.plan.selectedOptionKey ? ' · 原时间线已采用' : ''}</h3>
      <p className="whitespace-pre-wrap text-sm">{option.text}</p>
      <p className="text-xs text-text-muted">听众：{option.audienceKeys.map(key => props.names[key] ?? key).join('、')}</p>
      {option.key !== props.plan.selectedOptionKey && <button disabled={props.disabled} onClick={() => props.onChoose(option.key)} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">选择候选 {index + 1} 并分支</button>}
    </article>)}</div>
    <p className="text-xs text-text-muted">旧候选与原调用费用记录仍留在原会话。查看和建立草稿分支不会调用模型；随后审查需要新的模型调用。</p>
    <button disabled={props.disabled} onClick={props.onCancel} className="rounded border border-border px-3 py-2 text-xs">取消查看历史候选</button>
  </section>
}
