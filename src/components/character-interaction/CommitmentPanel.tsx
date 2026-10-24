import type {CharacterInteractionRuntimeState} from '../../lib/types'
import {chatVisibleCommitmentsV1} from '../../lib/character-interaction/narrative-commitments'

export default function CommitmentPanel({interaction}: {interaction: CharacterInteractionRuntimeState}) {
  const commitments = chatVisibleCommitmentsV1(interaction, interaction.playerKey)
  const open = commitments.filter(c => c.resolution === null), closed = commitments.filter(c => c.resolution !== null)
  const card = (item: typeof commitments[number]) => {
    const speaker = interaction.profiles.find(p => p.participantKey === item.actorKey)?.name ?? '角色'
    const source = interaction.messages.find(m => m.messageId === item.declared.messageId)!
    const request = item.requested && interaction.messages.find(m => m.messageId === item.requested!.messageId)!
    const result = item.resolution && interaction.messages.find(m => m.messageId === item.resolution!.messageId)!
    return <article key={item.commitmentKey} data-testid="chat-commitment-entry" className="min-w-0 space-y-2 rounded border border-border bg-bg-base p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><strong>{speaker}</strong><span className="text-text-muted">{item.resolution === null ? '待履行' : item.resolution.kind === 'fulfilled' ? '已履行' : '已撤回'}</span></div>
      <p className="whitespace-pre-wrap break-words text-sm">{item.terms}</p>
      {item.resolution && <p className="whitespace-pre-wrap break-words text-xs text-text-muted">{item.resolution.kind === 'fulfilled' ? '履行时的表达' : '撤回时的表达'}：{item.resolution.excerpt}</p>}
      <details className="text-xs"><summary className="cursor-pointer py-1">查看原话</summary>
        <div className="mt-2 space-y-3">
          {request && <div><p className="mb-1 font-medium">你的原请求</p><blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3">{request.text}</blockquote></div>}
          <div><p className="mb-1 font-medium">作出约定时</p><blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3">{source.text}</blockquote></div>
          {result && <div><p className="mb-1 font-medium">{item.resolution!.kind === 'fulfilled' ? '履行时' : '撤回时'}</p><blockquote className="whitespace-pre-wrap break-words border-l-2 border-border pl-3">{result.text}</blockquote></div>}
        </div>
      </details>
    </article>
  }
  return <div data-testid="chat-commitment-panel" className="min-w-0 rounded border border-border bg-bg-surface p-4 lg:col-span-2">
    <h2 className="text-sm font-semibold">角色约定</h2>
    <p className="mb-3 mt-1 text-xs text-text-muted">保留角色向你明确作出的约定和后续处理。改约会保留原记录；角色的约定不代表你已经同意参与。</p>
    <div className="space-y-3">{open.map(card)}</div>
    {!open.length && <p className="text-sm text-text-muted">暂无待履行的角色约定。</p>}
    {!!closed.length && <details className="mt-3"><summary className="cursor-pointer py-2 text-sm">已处理的约定（{closed.length}）</summary><div className="mt-2 space-y-3">{closed.map(card)}</div></details>}
  </div>
}
