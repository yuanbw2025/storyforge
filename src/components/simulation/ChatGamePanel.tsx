import { useEffect, useMemo, useState } from 'react'
import {
  Bot,
  Check,
  GitBranch,
  Loader2,
  MapPin,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Square,
  Trash2,
  UserRound,
} from 'lucide-react'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
import { resolveRequestConfig } from '../../lib/ai/client'
import type { Project, WorkspaceScope } from '../../lib/types'
import { useAIConfigStore } from '../../stores/ai-config'
import { useInteractionGamePlayerStore } from '../../stores/interaction-game-player'

export default function ChatGamePanel(props: {
  project: Project
  worldGroupId: number | null
  workspaceScope?: WorkspaceScope
}) {
  const store = useInteractionGamePlayerStore()
  const { config } = useAIConfigStore()
  const [message, setMessage] = useState('')
  const [checkpointName, setCheckpointName] = useState('')
  const [branchTitle, setBranchTitle] = useState('')
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    if (props.workspaceScope) void store.load(props.workspaceScope, props.worldGroupId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.workspaceScope?.projectId, props.workspaceScope?.worldId, props.workspaceScope?.workId, props.worldGroupId])

  const selected = store.sessions.find(item => item.id === store.selectedSessionId) ?? null
  const interaction = store.runtimeState.interaction
  const legacyChat = !interaction ? store.runtimeState.chat : null
  const scene = interaction?.activeScene ?? null
  const visibleMessages = useMemo(() => interaction?.messages
    .filter(item => item.supersededBySequence == null) ?? [], [interaction?.messages])
  const resolved = resolveRequestConfig(config, { category: 'runtime.character.interaction-reply' })
  const aiReady = isAIConfigReady(resolved.config)
  const generationActive = store.generatingRunId != null
  const error = localError || store.error

  const run = async (action: () => Promise<void>) => {
    setLocalError('')
    try { await action() } catch (reason) { setLocalError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const send = async () => {
    const text = message.trim()
    if (!text || !scene) return
    const sequence = await store.sendPlayerMessage(text)
    setMessage('')
    if (!aiReady) return
    await store.generateReplies({ aiConfig: resolved.config, replyToSequence: sequence })
  }

  if (!props.workspaceScope) {
    return <div className="storygame-empty"><ShieldCheck className="h-8 w-8" /><h2>工作区归属未就绪</h2><p>先在世界引擎建立 World/Work，再从正式 GameRelease 启动角色互动。</p></div>
  }

  return <div className="flex min-h-[42rem] flex-col bg-bg-base lg:flex-row">
    <aside className="w-full shrink-0 border-b border-border bg-bg-surface p-4 lg:w-72 lg:border-b-0 lg:border-r">
      <div className="mb-3 flex items-center gap-2"><MessageCircle className="h-4 w-4 text-accent" /><strong className="text-sm">角色互动发布</strong></div>
      <p className="mb-4 text-xs leading-relaxed text-text-muted">新会话只从不可变 GameRelease 启动。CHATGAME-1 旧存档会在下方只读显示，但不再追加旧式 AI 消息。
      </p>
      <div className="space-y-2">{store.releases.map(item => <article key={item.release.id} className="rounded border border-border bg-bg-base p-3">
        <strong className="block text-sm">{item.manifest?.definition.title ?? item.release.label}</strong>
        <span className="mt-1 block text-[10px] text-text-muted">v{item.release.version} · {item.manifest?.interaction.profiles.length ?? 0} 角色 · {item.manifest?.interaction.sceneTemplates.length ?? 0} 场景</span>
        {item.error && <p className="mt-2 text-[10px] text-danger">{item.error}</p>}
        <button disabled={!item.manifest || !!item.error || store.busy} onClick={() => void run(async () => { await store.start(item.release.id!) })} className="mt-3 flex w-full items-center justify-center gap-1 rounded bg-accent px-2 py-1.5 text-xs text-white disabled:opacity-40"><Plus className="h-3 w-3" />新建会话</button>
      </article>)}</div>
      {!store.releases.length && !store.loading && <div className="rounded border border-dashed border-border p-4 text-center text-xs text-text-muted">尚无角色互动发布。切换到作者工作台创建并发布。</div>}
      <div className="mb-2 mt-6 text-xs font-semibold">互动存档</div>
      <div className="space-y-1">{store.sessions.map(session => { const legacy = session.gameReleaseId == null; return <div key={session.id} className={`flex rounded ${session.id === selected?.id ? 'bg-accent/10' : ''}`}><button className="min-w-0 flex-1 px-2 py-2 text-left text-xs" onClick={() => void store.select(session.id!)}><strong className="block truncate">{session.title}</strong><span className="text-[9px] text-text-muted">{legacy ? 'CHATGAME-1 · 只读' : session.id === selected?.id ? `事件 ${store.runtimeState.lastSequence}` : '可继续'}</span></button><button aria-label="删除存档" className="px-2 text-text-muted hover:text-danger" onClick={() => void run(async () => { await store.remove(session.id!) })}><Trash2 className="h-3 w-3" /></button></div> })}</div>
    </aside>

    <main className="min-w-0 flex-1 p-4 sm:p-6"><div className="mx-auto max-w-5xl space-y-4">
      {error && <div className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {!selected && <div className="storygame-empty"><MessageCircle className="h-8 w-8" /><h2>选择正式发布开始</h2><p>消息、知识、记忆、关系变化与 Harness 回执都属于同一 SIM 实例，可刷新、检查点、分支和重放。</p></div>}
      {selected && legacyChat && <>
        <header><span className="text-[10px] text-text-muted">CHATGAME-1 · LEGACY READ ONLY</span><h1 className="mt-1 text-xl font-semibold">{selected.title}</h1><p className="mt-1 text-xs text-text-muted">{legacyChat.scene.title} · 事件 {store.runtimeState.lastSequence}</p></header>
        <section className="rounded-lg border border-border bg-bg-surface"><div className="border-b border-border px-4 py-3"><strong className="text-sm">与 {legacyChat.identity.name} 的历史对话</strong><p className="mt-1 text-xs text-text-muted">{legacyChat.scene.description}</p></div><div className="max-h-[34rem] space-y-3 overflow-y-auto p-4">{legacyChat.messages.filter(item => item.supersededBySequence == null).map(item => <div key={item.eventSequence} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}><article className={`max-w-[84%] rounded-lg px-3 py-2 text-sm ${item.role === 'user' ? 'bg-accent/15' : 'bg-bg-base'}`}><div className="mb-1 text-[10px] text-text-muted">{item.role === 'user' ? '玩家' : legacyChat.identity.name} · #{item.eventSequence}</div><p className="whitespace-pre-wrap">{item.text}</p></article></div>)}</div></section>
        <div className="rounded border border-warning/30 bg-warning/5 px-4 py-3 text-xs text-text-muted">该存档按原事件流回放。为防止继续产生两套聊天权威，新消息、重试、检查点和分支均已关闭；项目导出、导入和删除生命周期仍然保留。</div>
      </>}
      {selected && interaction && <>
        <header className="flex flex-wrap items-start justify-between gap-3"><div><span className="text-[10px] text-accent">CHATGAME-2 · GAME RELEASE</span><h1 className="mt-1 text-xl font-semibold">{selected.title}</h1><p className="mt-1 text-xs text-text-muted">{scene ? `${scene.title} · ${scene.location} · ${scene.timeLabel}` : '当前场景已结束'} · 事件 {store.runtimeState.lastSequence}</p></div>{scene && <button disabled={store.busy} onClick={() => void run(async () => { await store.finishScene(undefined, aiReady ? resolved.config : undefined) })} className="rounded border border-border px-3 py-1.5 text-xs hover:bg-bg-hover">结束场景</button>}</header>

        {!scene && <section className="rounded border border-border bg-bg-surface p-4"><h2 className="mb-3 text-sm font-semibold">选择下一场景</h2><div className="flex flex-wrap gap-2">{interaction.sceneTemplates.map(template => <button key={template.sceneKey} onClick={() => void run(async () => { await store.startScene(template.sceneKey) })} className="rounded border border-border px-3 py-2 text-xs hover:border-accent">{template.title}</button>)}</div></section>}

        {scene && <section className="rounded-lg border border-border bg-bg-surface"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><div className="flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4 text-accent" />{scene.title}<span className="text-xs font-normal text-text-muted">· {scene.activeParticipantKeys.map(key => interaction.profiles.find(item => item.participantKey === key)?.name ?? key).join('、')}</span></div><span className="text-[10px] text-text-muted">导演预算 {interaction.remainingDirectorBudget} · 玩家回合 {scene.playerTurns}/{scene.maxTurns}</span></div>
          <div className="max-h-[31rem] space-y-3 overflow-y-auto p-4">{visibleMessages.map(item => <div key={item.eventSequence} className={`flex ${item.role === 'player' ? 'justify-end' : 'justify-start'}`}><article className={`max-w-[84%] rounded-lg px-3 py-2 text-sm ${item.role === 'player' ? 'bg-accent/15' : 'bg-bg-base'}`}><div className="mb-1 flex items-center gap-1 text-[10px] text-text-muted">{item.role === 'player' ? <UserRound className="h-3 w-3" /> : <Bot className="h-3 w-3" />}{item.role === 'player' ? '玩家' : interaction.profiles.find(profile => profile.participantKey === item.speakerKey)?.name ?? item.speakerKey}<code>#{item.eventSequence}</code></div><p className="whitespace-pre-wrap">{item.text}</p>{item.role === 'character' && <button disabled={!aiReady || store.busy || generationActive} onClick={() => void run(async () => { await store.retryReply({ aiConfig: resolved.config, replySequence: item.eventSequence }) })} className="mt-2 flex items-center gap-1 text-[10px] text-text-muted hover:text-accent disabled:opacity-40"><RefreshCw className="h-3 w-3" />重试该回复</button>}</article></div>)}{generationActive && <div className="flex items-center gap-2 text-xs text-text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" />Harness 正在生成可采用候选…</div>}{!visibleMessages.length && <p className="py-8 text-center text-xs text-text-muted">使用固定行动可离线推进；自由输入的角色回复经统一 Harness。</p>}</div>
          {!!scene.relationshipRules.length && <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">{scene.relationshipRules.map(rule => <button key={rule.ruleKey} disabled={store.busy} title={rule.reason} onClick={() => void run(async () => { await store.applyFixedAction(rule.ruleKey) })} className="rounded border border-accent/30 bg-accent/5 px-3 py-1.5 text-xs text-accent disabled:opacity-40">{rule.playerText}</button>)}</div>}
          <div className="border-t border-border p-3"><textarea value={message} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void run(send) } }} disabled={store.busy || generationActive} placeholder="对当前场景中的角色说话…" rows={3} className="w-full resize-y rounded border border-border bg-bg-base px-3 py-2 text-sm disabled:opacity-50" /><div className="mt-2 flex items-center justify-between gap-2"><span className="text-[10px] text-text-muted">{aiReady ? '自由输入会调用统一 Instance Harness' : '未配置 AI：玩家消息可保存，固定行动可继续，自由回复明确暂停'}</span><div className="flex gap-2">{generationActive && <button onClick={() => void store.cancelGeneration()} className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs"><Square className="h-3 w-3" />取消</button>}<button disabled={!message.trim() || store.busy || generationActive} onClick={() => void run(send)} className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-40"><Send className="h-3 w-3" />{aiReady ? '发送并生成' : '仅保存消息'}</button></div></div></div>
        </section>}

        <section className="grid gap-3 lg:grid-cols-2"><div className="rounded border border-border bg-bg-surface p-4"><h2 className="mb-3 text-sm font-semibold">关系摘要与原因</h2><div className="space-y-2">{interaction.relationships.map(item => { const last = [...interaction.relationshipHistory].reverse().find(change => change.fromParticipantKey === item.fromParticipantKey && change.toParticipantKey === item.toParticipantKey && change.dimensionKey === item.dimensionKey); return <article key={`${item.fromParticipantKey}:${item.dimensionKey}`} className="rounded bg-bg-base p-2 text-xs"><div className="flex justify-between"><strong>{interaction.profiles.find(profile => profile.participantKey === item.fromParticipantKey)?.name} · {item.label}</strong><span>{item.value}</span></div>{last && <p className="mt-1 text-[10px] text-text-muted">{last.before} → {last.after}：{last.reason} · 证据 #{last.sourceEventSequence}</p>}</article>})}</div></div>
          <div className="rounded border border-border bg-bg-surface p-4"><h2 className="mb-3 text-sm font-semibold">角色关键记忆</h2><div className="space-y-2">{interaction.memories.filter(item => item.status === 'accepted' || item.status === 'proposed').map(item => <article key={item.memoryId} className="rounded bg-bg-base p-2 text-xs"><strong>{interaction.profiles.find(profile => profile.participantKey === item.participantKey)?.name} · {item.kind}</strong><p className="mt-1 text-text-secondary">{item.content}</p><span className="text-[9px] text-text-muted">来源 {item.sourceEventSequences.map(value => `#${value}`).join('、')}</span>{item.status === 'proposed' && <div className="mt-2 flex gap-2"><button onClick={() => void run(async () => { await store.resolveMemory(item.memoryId, 'accepted') })} className="flex items-center gap-1 text-accent"><Check className="h-3 w-3" />采用</button><button onClick={() => void run(async () => { await store.resolveMemory(item.memoryId, 'rejected') })} className="text-text-muted">拒绝</button></div>}</article>)}{!interaction.memories.length && <p className="text-xs text-text-muted">记忆候选只能在真实消息证据上提议，采用后才持久化。</p>}</div></div></section>

        {store.runtimeState.narrative?.version === 2 && !store.runtimeState.narrative.completed && <section className="rounded border border-border bg-bg-surface p-4"><h2 className="mb-3 text-sm font-semibold">Narrative Choice 连接</h2><div className="flex flex-wrap gap-2">{(store.runtimeState.narrative.choices ?? []).filter(choice => store.runtimeState.narrative?.visibleChoiceKeys?.includes(choice.choiceKey)).map(choice => <button key={choice.choiceKey} disabled={!store.runtimeState.narrative?.availableChoiceKeys?.includes(choice.choiceKey) || store.busy} onClick={() => void run(async () => { await store.chooseNarrative(choice.choiceKey) })} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">{choice.text}</button>)}</div></section>}

        <section className="grid gap-3 md:grid-cols-2"><div className="rounded border border-border bg-bg-surface p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Save className="h-4 w-4 text-accent" />检查点</div><div className="flex gap-2"><input value={checkpointName} onChange={event => setCheckpointName(event.target.value)} placeholder="检查点名称" className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1.5 text-xs" /><button disabled={!checkpointName.trim()} onClick={() => void run(async () => { await store.saveCheckpoint(checkpointName); setCheckpointName('') })} className="rounded border border-border px-3 text-xs">保存</button></div><div className="mt-2 space-y-1">{store.checkpoints.map(item => <button key={item.id} onClick={() => void run(async () => { await store.forkCheckpoint(item.id!) })} className="block w-full rounded bg-bg-base px-2 py-1 text-left text-[10px] text-text-muted">{item.name} · #{item.throughSequence} → 分支</button>)}</div></div><div className="rounded border border-border bg-bg-surface p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><GitBranch className="h-4 w-4 text-accent" />当前时间线分支</div><div className="flex gap-2"><input value={branchTitle} onChange={event => setBranchTitle(event.target.value)} placeholder="分支名称" className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1.5 text-xs" /><button disabled={!branchTitle.trim()} onClick={() => void run(async () => { await store.forkCurrent(branchTitle); setBranchTitle('') })} className="rounded border border-border px-3 text-xs">建立分支</button></div></div></section>
        {!!store.recoverableRunIds.length && <section className="rounded border border-warning/30 bg-warning/5 p-4"><h2 className="text-sm font-semibold">Harness 可恢复候选</h2><p className="my-2 text-xs text-text-muted">上次运行已持久化候选但未完成采用，可从同一检查点继续，不重复调用模型。</p><div className="flex flex-wrap gap-2">{store.recoverableRunIds.map(runId => <button key={runId} disabled={store.busy} onClick={() => void run(async () => { await store.resumeRun(runId) })} className="rounded border border-border px-3 py-1.5 text-xs"> 恢复 Run #{runId}</button>)}</div></section>}
      </>}
    </div></main>
  </div>
}
