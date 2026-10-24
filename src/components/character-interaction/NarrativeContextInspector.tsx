import {useEffect, useState} from 'react'
import type {WorkspaceScope} from '../../lib/types'
import {listChatContextInspectionsV1, readChatContextInspectionV1, type ChatContextInspectionV1} from '../../lib/character-interaction/context-inspector'
import type {ChatContextSelectionReasonV1} from '../../lib/character-interaction/context-selection'

const selectionReason = (reason: ChatContextSelectionReasonV1) => reason === 'current-fact' ? '当前事实的来源'
  : reason === 'player-pin' ? '由你固定，每轮保留'
  : reason === 'pending-correction' ? '这条修正尚待行动核对，本次完整保留'
  : reason === 'open-commitment' ? '尚未处理的约定，每轮保留'
  : reason === 'latest-resolution' ? '这件事最近一次履行或撤回'
  : reason === 'protected-memory' ? '已确认承诺或关键记忆'
    : reason === 'dialogue' ? '与本轮对话相关' : reason === 'importance' ? '作为补充背景' : '与当前演绎相关'

function SelectionDetails(props: {title: string; items: Array<{content: string; included: boolean; reason: ChatContextSelectionReasonV1}>}) {
  const [open, setOpen] = useState(false), [limit, setLimit] = useState(12)
  const selected = props.items.filter(item => item.included).length
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="rounded border border-border p-3">
    <summary className="cursor-pointer">{props.title}：已选入 {selected} 条，本轮省略 {props.items.length - selected} 条</summary>
    {open && <div className="mt-2 space-y-2">
      {props.items.slice(0, limit).map((item, index) => <div key={index} className="border-t border-border pt-2">
        <p className="text-text-muted">{item.included ? `已选入 · ${selectionReason(item.reason)}` : '本轮省略 · 按相关性排序和长度预算选择'}</p>
        {item.content.length > 180 ? <details><summary className="cursor-pointer break-words">{item.content.slice(0, 180)}…（展开原文）</summary><p className="whitespace-pre-wrap break-words">{item.content}</p></details>
          : <p className="whitespace-pre-wrap break-words">{item.content}</p>}
      </div>)}
      {props.items.length > limit && <button onClick={() => setLimit(value => value + 12)} className="rounded border border-border px-3 py-2">再显示 12 条资料</button>}
      {!props.items.length && <p className="text-text-muted">没有双方共同已知的条目。</p>}
    </div>}
  </details>
}

export default function NarrativeContextInspector(props: {scope: WorkspaceScope; sessionId: number; disabled: boolean; sequence: number}) {
  const [open, setOpen] = useState(false), [revision, setRevision] = useState(0)
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listChatContextInspectionsV1>>>([])
  const [runId, setRunId] = useState<number | null>(null), [inspection, setInspection] = useState<ChatContextInspectionV1 | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const {projectId, worldId, workId} = props.scope
  useEffect(() => {
    if (!open || props.disabled) return
    let current = true
    setLoading(true); setError(''); setInspection(null); setRunId(null)
    void listChatContextInspectionsV1({projectId, worldId, workId}, props.sessionId).then(list => {
      if (current) {setRows(list); setRunId(list[0]?.runId ?? null); setLoading(false)}
    }).catch(() => {if (current) {setRows([]); setError('暂时无法读取调用记录，请稍后重新读取。'); setLoading(false)}})
    return () => {current = false}
  }, [open, props.disabled, props.sessionId, props.sequence, projectId, worldId, workId, revision])
  useEffect(() => {
    if (!open || runId == null || props.disabled) return
    let current = true
    setLoading(true); setError(''); setInspection(null)
    void readChatContextInspectionV1({projectId, worldId, workId}, props.sessionId, runId).then(value => {
      if (current) {setInspection(value); setLoading(false)}
    }).catch(() => {if (current) {setError('这次调用的上下文记录不完整或无法核验。现有故事不受影响。'); setLoading(false)}})
    return () => {current = false}
  }, [open, runId, props.disabled, props.sessionId, projectId, worldId, workId, revision])
  const list = (items: string[]) => items.length ? <ul className="list-disc space-y-1 pl-4">{items.map((text, i) => <li key={i} className="whitespace-pre-wrap">{text}</li>)}</ul> : <p className="text-text-muted">没有可展示的条目。</p>
  return <section className="rounded border border-border bg-bg-surface p-4">
    <button disabled={props.disabled && !open} aria-expanded={open} onClick={() => setOpen(value => !value)} className="text-xs text-text-muted disabled:opacity-40">{open ? '收起本次上下文' : '查看本次上下文'}</button>
    {open && <div data-testid="chat-context-inspector" className="mt-3 space-y-3 text-xs">
      <p className="text-text-muted">核对角色这次实际读到的内容，仅展示你在当时也已知的部分。角色私有目标、猜测、打算、记忆与关系不会在这里展开；查看不会调用模型。</p>
      {!!rows.length && <label className="block">选择调用<select aria-label="上下文调用记录" value={runId ?? ''} disabled={props.disabled} onChange={event => setRunId(Number(event.target.value))} className="ml-2 max-w-full rounded border border-border bg-bg-base p-2">{rows.map((row, index) => <option key={row.runId} value={row.runId}>{index === 0 ? '最近一次' : `较早第 ${index} 次`} · {new Date(row.createdAt).toLocaleString()}</option>)}</select></label>}
      {loading && <p role="status">正在核对实际输入…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && !rows.length && <p>当前分支还没有角色行动调用记录；原分支的记录保留在原会话。</p>}
      {inspection && !inspection.available && <p role="status">{inspection.reason}</p>}
      {inspection?.available && <div className="space-y-3">
        <p>行动角色：{inspection.actorName} · 你扮演：{inspection.persona.name}</p>
        <p className="whitespace-pre-wrap">{inspection.persona.description}</p>
        <div><h3 className="mb-1 font-semibold">当时共同已知的事实</h3>{list(inspection.facts)}</div>
        <div><h3 className="mb-1 font-semibold">已读的来源知识</h3>{list(inspection.knowledge)}</div>
        <div><h3 className="mb-1 font-semibold">共同已知的剧情线</h3>{list(inspection.threads.map(t => `${t.title}：${t.question}`))}</div>
        <div><h3 className="mb-1 font-semibold">双方已有的已确认记忆</h3>{list(inspection.memories)}</div>
        {!!inspection.memoryCorrections.length && <div data-testid="chat-context-corrections" className="space-y-2">
          <h3 className="font-semibold">本次必须核对的记忆修正</h3>
          <p className="text-text-muted">以下修正和原话已进入这次输入。读到它们不等于行动已通过核对，也不会改写已经发生的事实。</p>
          {inspection.memoryCorrections.map((correction, i) => <details key={i} className="rounded border border-border p-2">
            <summary className="cursor-pointer whitespace-pre-wrap break-words">{correction.content}</summary>
            <div className="mt-2">{list(correction.sources.map(source => `${source.speaker}：${source.text}`))}</div>
          </details>)}
        </div>}
        {!!inspection.commitments.length && <div data-testid="chat-context-commitments"><h3 className="mb-1 font-semibold">本次实际读取的约定</h3>{list(inspection.commitments.map(c => `${c.actorName}：${c.terms}（${c.resolution === null ? '当时待履行' : c.resolution.kind === 'fulfilled' ? '当时已履行' : '当时已撤回'}）`))}</div>}
        {inspection.selection && <div className="space-y-2" data-testid="chat-context-selection">
          <p className="text-text-muted">以下只列双方当时共同已知的资料。省略仅表示本轮没有选入，不代表遗忘或删除；私有目标的选择依据不在这里展开。</p>
          <SelectionDetails key={`${inspection.runId}:knowledge`} title="来源知识的选入与省略" items={inspection.selection.knowledge} />
          {inspection.selection.commitments && <SelectionDetails key={`${inspection.runId}:commitments`} title="约定历史的选入与省略" items={inspection.selection.commitments} />}
          {inspection.selection.facts && <SelectionDetails title="已知事实的选入与省略" items={inspection.selection.facts} />}
          {inspection.selection.threads && <SelectionDetails title="共同事项的选入与省略" items={inspection.selection.threads} />}
          {inspection.selection.relationships && <SelectionDetails title="关系变化原因的选入与省略" items={inspection.selection.relationships} />}
          <SelectionDetails key={`${inspection.runId}:memories`} title="已确认记忆的选入与省略" items={inspection.selection.memories} />
        </div>}
        <div><h3 className="mb-1 font-semibold">实际选入的共同对话</h3>{list(inspection.messages.map(m => `${m.speaker}：${m.text}`))}</div>
        <p className="text-text-muted">共同可见的历史对话中，用户排除 {inspection.omissions.excludedMessages} 条，长度预算省略 {inspection.omissions.budgetMessages} 条。排除原文不撤销已确认的事实或记忆。</p>
        <details className="break-all text-text-muted"><summary className="cursor-pointer">核验依据</summary><p>来源：角色互动单一视角 · 当时会话进度 {inspection.baseSequence} · 输入约 {inspection.inputTokens} token</p><p>版本：{inspection.sourceReleaseHash}</p><p>输入记录：{inspection.manifestHash}</p></details>
      </div>}
      <button disabled={props.disabled || loading} onClick={() => setRevision(value => value + 1)} className="rounded border border-border px-3 py-2 disabled:opacity-40">重新读取上下文记录</button>
    </div>}
  </section>
}
