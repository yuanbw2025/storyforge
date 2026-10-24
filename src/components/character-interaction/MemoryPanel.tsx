import {useRef, useState} from 'react'
import type {CharacterInteractionRuntimeState, WorkspaceScope} from '../../lib/types'
import {CHAT_MEMORY_KIND_LABELS, CHAT_MEMORY_STATUS_LABELS, chatMemoryPlayerViewV1, readChatMemoryManagementPlanV1,
  type ChatMemoryManagementPlanV1, type ChatMemoryManagementActionV1, type ChatMemoryPlayerViewV1} from '../../lib/character-interaction/memory-management'

const button = 'rounded border border-border px-3 py-2 text-xs hover:bg-bg-hover disabled:opacity-40'
const field = 'mt-1 w-full rounded border border-border bg-bg-base px-3 py-2 text-sm'
const legacyNotice = '这条旧记忆尚未完成正文检查，摘要暂不展示；原记录与既有使用状态保留。'

type Props = {scope: WorkspaceScope; sessionId: number; interaction: CharacterInteractionRuntimeState; sequence: number; disabled: boolean;
  onApply: (plan: ChatMemoryManagementPlanV1, action: ChatMemoryManagementActionV1) => Promise<void>}

export default function MemoryPanel(props: Props) {
  const [plan, setPlan] = useState<ChatMemoryManagementPlanV1 | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const cards = useRef(new Map<string, HTMLElement>())
  const entries = props.interaction.memories.map(m => chatMemoryPlayerViewV1(props.interaction, m)).filter((m): m is ChatMemoryPlayerViewV1 => m !== null)
  const current = entries.filter(m => ['accepted', 'disabled', 'proposed'].includes(m.status))
  const history = entries.filter(m => !['accepted', 'disabled', 'proposed'].includes(m.status))
  const disabled = props.disabled || pending
  async function perform(action: () => Promise<void>) {
    if (disabled) return
    setPending(true); setError('')
    try {await action()} catch (reason) {setError(reason instanceof Error ? reason.message : String(reason))}
    finally {setPending(false)}
  }
  const read = (memoryId: string) => readChatMemoryManagementPlanV1(props.scope, props.sessionId, memoryId)
  const apply = (item: ChatMemoryPlayerViewV1, action: ChatMemoryManagementActionV1) => perform(async () => {await props.onApply(await read(item.memoryId), action)})
  function followCorrection(memoryId: string) {
    const target = cards.current.get(memoryId)
    if (!target) return
    const historyGroup = target.closest('details')
    if (historyGroup) historyGroup.open = true
    target.scrollIntoView({block: 'center'})
    target.focus({preventScroll: true})
  }
  function card(item: ChatMemoryPlayerViewV1, historical = false) {
    const replacement = entries.find(entry => entry.memoryId === item.replacedBy)
    return <article key={item.memoryId} data-testid="chat-memory-entry" data-memory-id={item.memoryId} tabIndex={-1}
      ref={element => {if (element) cards.current.set(item.memoryId, element); else cards.current.delete(item.memoryId)}}
      className="space-y-2 rounded border border-border bg-bg-base p-3 text-sm focus:outline focus:outline-2 focus:outline-accent">
      <div className="flex flex-wrap items-center justify-between gap-2"><strong>{item.participantName} · {CHAT_MEMORY_KIND_LABELS[item.kind]}</strong><span className="text-xs text-text-muted">{CHAT_MEMORY_STATUS_LABELS[item.status]}</span></div>
      <p className="whitespace-pre-wrap break-words text-text-secondary">{item.content ?? legacyNotice}</p>
      {item.authoredByPlayer && <p className="text-xs text-text-muted">由你修正 · 作为记忆摘要使用，不改写已发生的故事</p>}
      {item.playerPinned && <p className="text-xs text-accent">已固定 · 使用期间每轮保留，停用期间不读取</p>}
      <details className="text-xs"><summary className="cursor-pointer py-1 text-accent">查看原消息依据（{item.sources.length}）</summary><div className="mt-2 space-y-2">{item.sources.map(source => <blockquote key={source.messageId} className="border-l-2 border-border pl-3">
        <p className="mb-1 text-text-muted">{source.speaker}{source.replaced ? ' · 已被后续回复替换' : ''}</p><p className="whitespace-pre-wrap break-words">{source.text}</p>
      </blockquote>)}</div></details>
      {historical ? <p className="text-xs text-text-muted">{item.status === 'superseded' ? '后续对话只使用修正后的有效条目。' : '保留操作历史，不用于后续对话。'}</p> : <div className="flex flex-wrap gap-2">
        {item.status === 'proposed' && <><button className={button} disabled={disabled || !item.reviewed} onClick={() => void apply(item, {kind: 'accept'})}>采用</button><button className={button} disabled={disabled} onClick={() => void apply(item, {kind: 'reject'})}>拒绝</button></>}
        <button className={button} disabled={disabled || plan !== null} onClick={() => void perform(async () => {setPlan(await read(item.memoryId))})}>{item.status === 'proposed' ? '依据原消息修正并采用' : '修正记忆'}</button>
        {item.status === 'accepted' && <button className={button} disabled={disabled} onClick={() => void apply(item, {kind: 'disable'})}>停用</button>}
        {item.status === 'disabled' && <button className={button} disabled={disabled || item.sources.some(s => s.replaced)} onClick={() => void apply(item, {kind: 'enable'})}>恢复使用</button>}
        {props.interaction.chatNarrative && ['accepted', 'disabled'].includes(item.status) && <button className={button}
          disabled={disabled || !item.playerPinned && (item.content === null || item.sources.some(s => s.replaced))}
          onClick={() => void apply(item, {kind: item.playerPinned ? 'unpin' : 'pin'})}>{item.playerPinned ? '取消固定' : '固定为必读记忆'}</button>}
        {['accepted', 'disabled'].includes(item.status) && <button className={button} disabled={disabled} onClick={() => void apply(item, {kind: 'revoke'})}>撤回并保留历史</button>}
      </div>}
      {replacement && <button type="button" className={button} onClick={() => followCorrection(replacement.memoryId)}>查看修正后的条目 · {CHAT_MEMORY_STATUS_LABELS[replacement.status]}</button>}
      {item.sources.some(s => s.replaced) && <p className="text-xs text-text-muted">原依据已有替换；可以停用或撤回，修正时请选用有效消息。</p>}
    </article>
  }
  return <div data-testid="chat-memory-panel" className="min-w-0 rounded border border-border bg-bg-surface p-4">
    <h2 className="text-sm font-semibold">角色关键记忆</h2>
    <p className="mb-3 mt-1 text-xs text-text-muted">使用中的摘要会影响后续对话。停用可恢复；撤回保留历史。修正不改变原消息或已经发生的剧情。</p>
    {props.interaction.chatNarrative && <p className="mb-3 text-xs text-text-muted">普通记忆按本轮话题、角色目标和未完成事项选取。固定记忆每轮保留；固定内容超出预算时会暂停，请减少固定范围。旧摘要须先修正再固定。</p>}
    {error && <p role="alert" className="mb-3 break-words text-sm text-danger">{error}</p>}
    {plan && <MemoryEditor key={plan.memory.memoryId} plan={plan} stale={props.sequence !== plan.baseSequence} disabled={disabled}
      onRefresh={() => perform(async () => {setPlan(await read(plan.memory.memoryId))})}
      onCancel={() => {setPlan(null); setError('')}}
      onSave={action => perform(async () => {await props.onApply(plan, action); setPlan(null)})} />}
    <div className="space-y-3">{current.map(item => card(item))}</div>
    {!current.length && <p className="text-sm text-text-muted">暂无使用中或待确认的记忆。结束场景时可整理提议，采用后才用于后续对话。</p>}
    {!!history.length && <details className="mt-4"><summary className="cursor-pointer py-2 text-sm">历史记录（{history.length}）</summary><div className="mt-2 space-y-3">{history.map(item => card(item, true))}</div></details>}
  </div>
}

function MemoryEditor(props: {plan: ChatMemoryManagementPlanV1; stale: boolean; disabled: boolean; onCancel: () => void;
  onRefresh: () => Promise<void>; onSave: (action: Extract<ChatMemoryManagementActionV1, {kind: 'correct'}>) => Promise<void>}) {
  const {plan} = props
  const [content, setContent] = useState(plan.memory.content ?? '')
  const [selected, setSelected] = useState(plan.memory.sources.filter(s => !s.replaced).map(s => s.sequence))
  const [excerpt, setExcerpt] = useState(plan.memory.excerpt)
  const [reason, setReason] = useState('修正摘要，使其符合原消息')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(20)
  const candidates = plan.availableSources.filter(s => `${s.speaker}\n${s.text}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const missingSource = selected.some(sequence => !plan.availableSources.some(s => s.sequence === sequence))
  const excerptValid = excerpt.trim().length > 0 && plan.availableSources.some(s => selected.includes(s.sequence) && s.text.includes(excerpt.trim()))
  const retired = !['accepted', 'disabled', 'proposed'].includes(plan.memory.status)
  const valid = content.trim().length > 0 && selected.length > 0 && reason.trim().length > 0 && excerptValid && !missingSource && !retired
  const toggle = (sequence: number) => setSelected(current => current.includes(sequence) ? current.filter(s => s !== sequence) : [...current, sequence])
  return <form data-testid="chat-memory-editor" className="mb-4 space-y-3 rounded border border-accent/40 bg-bg-base p-3" onSubmit={event => {event.preventDefault(); if (valid && !props.disabled && !props.stale) void props.onSave({kind: 'correct', content, sourceEventSequences: selected, evidenceExcerpt: excerpt, reason})}}>
    <h3 className="font-semibold">修正 {plan.memory.participantName} 的记忆</h3>
    {!plan.memory.content && <p className="text-xs text-text-muted">旧摘要未展示，请依据下方原消息写下你确认的内容。</p>}
    <label className="block text-sm">修正后的记忆<textarea disabled={props.disabled} aria-label="修正后的记忆" className={field} rows={4} maxLength={8000} value={content} onChange={event => setContent(event.target.value)} /></label>
    <fieldset className="space-y-2"><legend className="text-sm">选择真实依据（已选 {selected.length} 条）</legend>
      <input disabled={props.disabled} className={field} aria-label="查找记忆依据" placeholder="查找消息内容或说话者" value={query} onChange={event => {setQuery(event.target.value); setShown(20)}} />
      <div className="max-h-64 space-y-2 overflow-y-auto">{candidates.slice(0, shown).map((source, index) => <label key={source.messageId} className="flex items-start gap-2 rounded border border-border p-2 text-xs">
        <input disabled={props.disabled} type="checkbox" aria-label={`选用来源 ${index + 1}：${source.speaker}`} className="mt-0.5 shrink-0" checked={selected.includes(source.sequence)} onChange={() => toggle(source.sequence)} />
        <span className="min-w-0"><strong>{source.speaker}</strong><span className="mt-1 block whitespace-pre-wrap break-words">{source.text}</span></span>
      </label>)}</div>
      {candidates.length > shown && <button type="button" className={button} onClick={() => setShown(n => n + 20)}>显示更多依据（还有 {candidates.length - shown} 条）</button>}
      {!candidates.length && <p className="text-xs text-text-muted">没有匹配的共同可见消息。</p>}
      {missingSource && <p className="text-xs text-danger">先前选中的部分依据已不可用，请重新选择。</p>}
      {missingSource && <button type="button" className={button} onClick={() => setSelected(current => current.filter(s => plan.availableSources.some(m => m.sequence === s)))}>移除已失效的依据</button>}
    </fieldset>
    <label className="block text-sm">原消息摘录<textarea disabled={props.disabled} aria-label="原消息摘录" className={field} rows={2} maxLength={1000} value={excerpt} onChange={event => setExcerpt(event.target.value)} /></label>
    {!excerptValid && <p className="text-xs text-text-muted">摘录须逐字来自已勾选的原消息。</p>}
    <label className="block text-sm">修正原因<input disabled={props.disabled} aria-label="修正原因" className={field} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <p className="text-xs text-text-muted">{plan.memory.status === 'disabled' ? '保存后仍保持停用，不会自动恢复使用。' : '保存后使用你修正的摘要，旧条目进入历史。'}不会自动改写已经发生的事实、目标或关系。</p>
    {(props.stale || retired) && <p role="status" className="text-xs text-warning">{retired ? '原条目已由其他操作处理。你的文字尚未保存，请保留后重新选择当前条目。' : '聊天已变化。你的修正仍在本页，请重新核对来源后再保存。'}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="submit" className={`${button} text-accent`} disabled={props.disabled || props.stale || !valid}>{plan.memory.status === 'proposed' ? '保存修正并采用' : '保存修正'}</button>
      <button type="button" className={button} disabled={props.disabled} onClick={() => void props.onRefresh()}>重新核对来源</button>
      <button type="button" className={button} disabled={props.disabled} onClick={props.onCancel}>取消修正</button>
    </div>
  </form>
}
