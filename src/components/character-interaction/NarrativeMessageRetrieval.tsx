import type {ChatMessageRetrievalPlanV1} from '../../lib/character-interaction/narrative-retrieval-service'

export default function NarrativeMessageRetrieval(props: {plan: ChatMessageRetrievalPlanV1; disabled: boolean; onConfirm(): void; onCancel(): void; onEdit(): void}) {
  const {plan} = props
  return <section data-testid="chat-message-retrieval-preview" className="rounded border border-accent/30 bg-bg-surface p-4">
    <h2 className="text-sm font-semibold">{plan.excluded ? '恢复消息上下文' : '排除消息的影响'}</h2>
    <blockquote className="my-3 whitespace-pre-wrap rounded bg-bg-base p-3 text-sm">{plan.text}</blockquote>
    <p className="text-xs text-text-secondary">{plan.excluded ? '恢复后，这条原文可再次按角色视角和上下文预算选取。' : '排除后，角色生成与情境审查不再选取这条对话原文。消息仍保存在聊天记录中。'}已经确认的事实、记忆、约定和关系仍可作为背景，其中可能保留相同信息。排除原话不会撤销承诺或履约记录。</p>
    <p className="mt-2 text-xs text-text-muted">直接关联且你可见的记录仍保留：事实 {plan.retained.facts} · 剧情线 {plan.retained.threads} · 记忆 {plan.retained.memories} · 关系变化 {plan.retained.relationships}。这里不列出隐藏信息，也不穷举后续间接影响。</p>
    <p className="mt-2 text-xs text-text-muted">操作不会调用模型。已有待采用候选会失效，请取消后重新发起；排除本轮玩家消息后，需恢复它、发送新消息或明确推进下一次行动。若要改变已经发生的故事，请从改写分支开始。</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button disabled={props.disabled} onClick={props.onConfirm} className="rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-40">{plan.excluded ? '确认恢复上下文' : '仅排除对话上下文'}</button>
      <button disabled={props.disabled} onClick={props.onEdit} className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-40">改为改写并分支</button>
      <button disabled={props.disabled} onClick={props.onCancel} className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-40">取消</button>
    </div>
  </section>
}
