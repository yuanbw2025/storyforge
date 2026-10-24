import {useState} from 'react'
import type {ChatMessageEditPlanV1} from '../../lib/character-interaction/narrative-edit'
import type {ChatMessageEditDraftV1} from '../../lib/types/chat-narrative'

export function MessageEditPreview(props: {plan: ChatMessageEditPlanV1; disabled: boolean; maxCharacters: number; onConfirm: (text: string) => void; onCancel: () => void}) {
  const [text, setText] = useState(props.plan.text)
  const continuation = props.plan.mode === 'continue'
  return <section data-testid="chat-edit-preview" className="space-y-3 rounded border border-accent/30 bg-bg-surface p-4">
    <h2 className="text-sm font-semibold">{continuation ? '保留原文，续写当前回复' : '从这条消息前建立改写分支'}</h2>
    <p className="text-xs text-text-muted">原时间线保持原样。新分支将重新处理这条消息及之后的 {Math.max(0, props.plan.removedMessageCount - 1)} 条消息，不继承它们产生的事实、关系、记忆和打算。原模型调用及费用记录留在原会话。</p>
    <textarea aria-label={continuation ? '续写原文' : '改写历史消息'} readOnly={continuation} rows={4} value={text} maxLength={props.maxCharacters} disabled={props.disabled} onChange={event => setText(event.target.value)} className="w-full rounded border border-border bg-bg-base p-2 text-sm" />
    <p className="text-xs text-text-muted">{continuation ? '原文和原听众保持不变，只向后补充这一段回复。先保存续写起点，之后生成完整正文并重新审查整段后果。若要让角色开始下一次行动，请使用“让角色继续”。' : props.plan.role === 'character' ? '先保存改写草稿；之后需要模型核对原角色表达和后果，通过审查才进入故事。' : '先保存改写草稿；确认后作为新分支中的玩家消息，后续回复重新生成。'}</p>
    <div className="flex gap-2"><button disabled={props.disabled || !text.trim()} onClick={() => props.onConfirm(text.trim())} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">{continuation ? '建立续写分支' : '建立改写分支'}</button><button disabled={props.disabled} onClick={props.onCancel} className="rounded border border-border px-3 py-2 text-xs">{continuation ? '取消续写' : '取消改写'}</button></div>
  </section>
}

export function PendingMessageEdit(props: {draft: ChatMessageEditDraftV1; disabled: boolean; canApply: boolean; maxCharacters: number; onApply: (text: string) => void; onCancel: () => void}) {
  const [text, setText] = useState(props.draft.text)
  const continuation = props.draft.mode === 'continue'
  const historicalOption = props.draft.mode === 'option'
  return <section data-testid="chat-pending-edit" className="space-y-3 rounded border border-accent/30 bg-bg-surface p-4">
    <h2 className="text-sm font-semibold">{historicalOption ? '待采用的历史候选' : continuation ? '待续写的回复' : '待采用的改写'}</h2>
    <p className="text-xs text-text-muted">这里是修改点之前的新分支。草稿尚未成为对话或事实；取消草稿会保留这个分支。</p>
    <textarea aria-label={historicalOption ? '已选历史候选' : continuation ? '已保存的续写原文' : '待采用的改写'} readOnly={continuation || historicalOption} rows={4} value={text} maxLength={props.maxCharacters} disabled={props.disabled} onChange={event => setText(event.target.value)} className="w-full rounded border border-border bg-bg-base p-2 text-sm" />
    {historicalOption && <p className="text-xs text-text-muted">所选文字和听众保持原候选的范围。旧候选后果尚未进入此分支；通过重新审查后，文字与后果才一起保存。</p>}
    <div className="flex gap-2"><button disabled={props.disabled || !props.canApply || !text.trim()} onClick={() => props.onApply(text.trim())} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">{historicalOption ? '审查并采用所选候选' : continuation ? '生成并审查续写' : props.draft.role === 'player' ? '保存改写消息' : '审查并采用改写'}</button><button disabled={props.disabled} onClick={props.onCancel} className="rounded border border-border px-3 py-2 text-xs">{historicalOption ? '取消候选改选' : continuation ? '取消待处理续写' : '取消待处理改写'}</button></div>
    {props.draft.role === 'character' && <p className="text-xs text-text-muted">重新核对需要两次模型调用。失败后草稿保留；未结束的运行请先恢复或取消，重新点击才会发起新请求。</p>}
  </section>
}
