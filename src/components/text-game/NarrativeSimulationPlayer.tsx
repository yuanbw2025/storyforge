import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  Bot,
  Check,
  GitBranch,
  History,
  Loader2,
  Plus,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
import { resolveRequestConfig } from '../../lib/ai/client'
import type { Project, WorkspaceScope } from '../../lib/types'
import {
  selectNarrativeSimulationActions,
  useNarrativeSimulationPlayerStore,
} from '../../stores/narrative-simulation-player'
import { useAIConfigStore } from '../../stores/ai-config'

export default function NarrativeSimulationPlayer(props: {
  project: Project
  scope: WorkspaceScope
  worldGroupId: number | null
}) {
  const store = useNarrativeSimulationPlayerStore()
  const { config } = useAIConfigStore()
  const [queue, setQueue] = useState<string[]>([])
  const [checkpointName, setCheckpointName] = useState('')
  const [branchTitle, setBranchTitle] = useState('')
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    void store.load(props.scope, props.worldGroupId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scope.projectId, props.scope.worldId, props.scope.workId, props.worldGroupId])

  const selected = store.sessions.find(session => session.id === store.selectedSessionId) ?? null
  const simulation = store.runtimeState.narrativeSimulation
  const manifest = store.selectedManifest
  const actions = selectNarrativeSimulationActions(store)
  const visibleChoices = (store.runtimeState.narrative?.choices ?? [])
    .filter(choice => store.runtimeState.narrative?.visibleChoiceKeys?.includes(choice.choiceKey))
  const visibleReports = (simulation?.reports ?? []).filter(report => report.visibility === 'player'
    && (report.expiresAtTurn == null || report.expiresAtTurn >= simulation!.turn))
  const resolved = resolveRequestConfig(config, { category: 'runtime.prose.simulation-turn-briefing' })
  const aiReady = isAIConfigReady(resolved.config)
  const error = localError || store.error

  useEffect(() => { setQueue([]) }, [simulation?.turn, store.selectedSessionId])

  const run = async (operation: () => Promise<unknown>) => {
    setLocalError('')
    try { await operation() }
    catch (reason) { setLocalError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const toggle = (actionKey: string) => {
    if (!simulation || !manifest) return
    setLocalError('')
    setQueue(current => {
      if (current.includes(actionKey)) return current.filter(key => key !== actionKey)
      if (current.length >= simulation.actionBudget) {
        setLocalError(`每回合最多安排 ${simulation.actionBudget} 项行动。`)
        return current
      }
      const action = manifest.simulation.actions.find(item => item.key === actionKey)
      if (action?.conflictsWith.some(key => current.includes(key))) {
        setLocalError('所选行动与当前决策队列互斥。')
        return current
      }
      return [...current, actionKey]
    })
  }

  const labels = useMemo(() => ({
    resource: new Map(manifest?.simulation.resources.map(item => [item.key, item.title]) ?? []),
    metric: new Map(manifest?.simulation.metrics.map(item => [item.key, item.title]) ?? []),
    actor: new Map(manifest?.simulation.actors.map(item => [item.key, item.title]) ?? []),
    issue: new Map(manifest?.simulation.issues.map(item => [item.key, item.title]) ?? []),
  }), [manifest])

  return <div className="flex min-h-[44rem] flex-col bg-bg-base lg:flex-row" data-testid="narrative-simulation-player">
    <aside className="w-full shrink-0 border-b border-border bg-bg-surface p-4 lg:w-72 lg:border-b-0 lg:border-r">
      <div className="mb-3 flex items-center gap-2"><Activity className="h-4 w-4 text-accent" /><strong className="text-sm">叙事模拟发布</strong></div>
      <p className="mb-4 text-xs leading-relaxed text-text-muted">固定规则可完全离线通关；AI 只通过统一 Harness 生成带证据的只读表现。</p>
      <div className="space-y-2">{store.releases.map(item => <article key={item.release.id} className="rounded border border-border bg-bg-base p-3">
        <strong className="block text-sm">{item.manifest?.definition.title ?? item.release.label}</strong>
        <span className="mt-1 block text-[10px] text-text-muted">v{item.release.version} · {item.manifest?.simulation.turnLimit ?? 0} 回合 · {item.manifest?.simulation.endings.length ?? 0} 结局</span>
        {item.error && <p className="mt-2 text-[10px] text-danger">{item.error}</p>}
        <button disabled={!item.manifest || !!item.error || store.busy} onClick={() => void run(() => store.start(item.release.id!))} className="mt-3 flex w-full items-center justify-center gap-1 rounded bg-accent px-2 py-1.5 text-xs text-white disabled:opacity-40"><Plus className="h-3 w-3" />新建模拟</button>
      </article>)}</div>
      {!store.releases.length && !store.loading && <div className="rounded border border-dashed border-border p-4 text-center text-xs text-text-muted">尚无叙事模拟发布。请先在作者工作台创建并发布。</div>}
      <div className="mb-2 mt-6 text-xs font-semibold">模拟存档</div>
      <div className="space-y-1">{store.sessions.map(session => <div key={session.id} className={`flex rounded ${session.id === selected?.id ? 'bg-accent/10' : ''}`}><button className="min-w-0 flex-1 px-2 py-2 text-left text-xs" onClick={() => void store.select(session.id!)}><strong className="block truncate">{session.title}</strong><span className="text-[9px] text-text-muted">{session.id === selected?.id ? `事件 ${store.runtimeState.lastSequence}` : '可继续'}</span></button><button aria-label="删除模拟存档" className="px-2 text-text-muted hover:text-danger" onClick={() => void run(() => store.remove(session.id!))}><Trash2 className="h-3 w-3" /></button></div>)}</div>
    </aside>

    <main className="min-w-0 flex-1 p-4 sm:p-6"><div className="mx-auto max-w-7xl space-y-4">
      {error && <div role="alert" className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {!selected && <div className="storygame-empty"><Activity className="h-8 w-8" /><h2>选择正式发布开始模拟</h2><p>资源、主体、问题、延迟效果、Narrative 与事件回放保存在同一个正式实例中。</p></div>}
      {selected && simulation && manifest && <>
        <header className="flex flex-wrap items-start justify-between gap-3"><div><span className="text-[10px] text-accent">TEXTSIM-1 · CLOSED SYSTEM</span><h1 className="mt-1 text-xl font-semibold">{manifest.definition.title}</h1><p className="mt-1 text-xs text-text-muted">第 {simulation.turn} / {simulation.turnLimit} 回合 · {simulation.phase} · 决策预算 {simulation.actionBudget}</p></div><div className="flex flex-wrap items-center justify-end gap-2"><div className="rounded border border-border bg-bg-surface px-3 py-2 text-right text-[10px] text-text-muted"><strong className="block text-xs text-text-primary">{selected.title}</strong>事件 #{store.runtimeState.lastSequence} · 发布 {simulation.contentHash.slice(0, 12)}</div><button type="button" aria-label="退出游戏" onClick={() => { setQueue([]); void store.select(null) }} className="flex items-center gap-1 rounded border border-border bg-bg-surface px-3 py-2 text-xs"><ArrowLeft className="h-3.5 w-3.5" />退出游戏</button></div></header>

        <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">{Object.entries(simulation.resources).map(([key, value]) => <article key={`resource:${key}`} className="rounded border border-border bg-bg-surface p-3"><small className="text-[9px] text-text-muted">RESOURCE</small><strong className="mt-1 block text-lg">{value}</strong><span className="text-xs text-text-muted">{labels.resource.get(key) ?? key}</span></article>)}{Object.entries(simulation.metrics).map(([key, value]) => <article key={`metric:${key}`} className="rounded border border-accent/20 bg-accent/5 p-3"><small className="text-[9px] text-accent">METRIC</small><strong className="mt-1 block text-lg">{value}</strong><span className="text-xs text-text-muted">{labels.metric.get(key) ?? key}</span></article>)}</section>

        <section className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,1fr)]"><div className="space-y-3">
          <article className="rounded border border-border bg-bg-surface p-4"><div className="mb-3 flex items-center justify-between gap-2"><div><strong className="text-sm">本回合决策队列</strong><p className="text-[10px] text-text-muted">已选 {queue.length} / {simulation.actionBudget}；互斥与资源成本在提交前再次校验。</p></div><button disabled={store.busy || simulation.phase !== 'planning'} onClick={() => void run(() => store.settleTurn(queue))} className="flex items-center gap-1 rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">{store.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}结算回合</button></div><div className="grid gap-2 md:grid-cols-2">{actions.map(item => <button key={item.action.key} disabled={!item.available || store.busy} onClick={() => toggle(item.action.key)} className={`rounded border p-3 text-left text-xs disabled:opacity-40 ${queue.includes(item.action.key) ? 'border-accent bg-accent/10' : 'border-border bg-bg-base'}`}><span className="flex justify-between gap-2"><strong>{item.action.title}</strong><code className="text-[9px] text-text-muted">{item.action.category}</code></span><p className="mt-1 text-[10px] leading-relaxed text-text-muted">{item.available ? item.action.description : item.reason}</p></button>)}</div></article>
          <article className="rounded border border-border bg-bg-surface p-4"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-accent" />玩家可见报告</div>{aiReady && store.events.some(event => event.type.startsWith('simulation.')) && <button disabled={store.busy} onClick={() => void run(() => store.generatePresentation('prose.simulation-turn-briefing', '依据最近正式事件写一段简短局势简报', resolved.config))} className="rounded border border-border px-2 py-1 text-[10px]"><Sparkles className="mr-1 inline h-3 w-3" />Harness 简报</button>}</div>{store.generatedCandidate && <div className="mb-3 rounded border border-accent/20 bg-accent/5 p-3 text-xs"><strong className="flex items-center gap-1"><Bot className="h-3.5 w-3.5 text-accent" />只读表现候选</strong><p className="mt-2">{store.generatedCandidate.text}</p><small className="mt-1 block text-[9px] text-text-muted">证据 {store.generatedCandidate.evidenceEventSequences.map(sequence => `#${sequence}`).join('、')}</small></div>}<div className="max-h-80 space-y-2 overflow-y-auto">{[...visibleReports].reverse().map(report => <article key={report.reportId} className="rounded bg-bg-base p-3 text-xs"><div className="flex justify-between"><strong>{report.reportKey}</strong><span className="text-[9px] text-accent">回合 {report.turn} · {Math.round(report.confidence * 100)}%</span></div><p className="mt-1 text-text-muted">{report.text}</p><small className="mt-1 block text-[9px] text-text-muted">证据 {report.sourceEventSequences.map(sequence => `#${sequence}`).join('、') || '父分支快照'}</small></article>)}{!visibleReports.length && <p className="text-xs text-text-muted">尚无玩家可见报告。</p>}</div></article>
        </div><aside className="space-y-3">
          <article className="rounded border border-border bg-bg-surface p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="h-4 w-4 text-accent" />问题与危机</div><div className="space-y-2">{simulation.issues.map(issue => { const definition = manifest.simulation.issues.find(item => item.key === issue.issueKey); return <div key={issue.issueKey} className="rounded bg-bg-base p-2 text-xs"><span className="flex justify-between"><strong>{labels.issue.get(issue.issueKey) ?? issue.issueKey}</strong><code className="text-[9px] text-accent">{issue.stageKey}</code></span><div className="mt-2 h-1.5 overflow-hidden rounded bg-border"><div className="h-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, issue.pressure))}%` }} /></div><small className="mt-1 block text-[9px] text-text-muted">压力 {issue.pressure} · {definition?.crisis ? '危机' : '问题'} · {issue.resolved ? '已解决' : '演化中'}</small></div>})}</div></article>
          <article className="rounded border border-border bg-bg-surface p-4"><strong className="text-sm">主体立场</strong><div className="mt-3 space-y-1">{Object.entries(simulation.actorStances).map(([key, value]) => <div key={key} className="flex justify-between rounded bg-bg-base px-2 py-1.5 text-xs"><span>{labels.actor.get(key) ?? key}</span><strong>{value}</strong></div>)}</div></article>
          <article className="rounded border border-border bg-bg-surface p-4"><div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Save className="h-4 w-4 text-accent" />检查点与分支</div><div className="flex gap-2"><input value={checkpointName} onChange={event => setCheckpointName(event.target.value)} placeholder="检查点名称" className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1.5 text-xs" /><button disabled={!checkpointName.trim()} onClick={() => void run(async () => { await store.saveCheckpoint(checkpointName); setCheckpointName('') })} className="rounded border border-border px-2 text-xs">保存</button></div><div className="mt-2 max-h-32 space-y-1 overflow-y-auto">{store.checkpoints.map(checkpoint => <button key={checkpoint.id} onClick={() => void run(() => store.forkCheckpoint(checkpoint.id!))} className="block w-full rounded bg-bg-base px-2 py-1 text-left text-[9px] text-text-muted">{checkpoint.name} · #{checkpoint.throughSequence} → 分支</button>)}</div><div className="mt-2 flex gap-2"><input value={branchTitle} onChange={event => setBranchTitle(event.target.value)} placeholder="当前分支名称" className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1.5 text-xs" /><button disabled={!branchTitle.trim()} onClick={() => void run(async () => { await store.forkCurrent(branchTitle); setBranchTitle('') })} className="rounded border border-border px-2"><GitBranch className="h-3 w-3" /></button></div></article>
        </aside></section>

        {simulation.qualifiedEndingKey && !store.runtimeState.narrative?.completed && <section className="rounded border border-accent/30 bg-accent/5 p-5"><h2 className="text-lg font-semibold">模拟已确定结局：{manifest.simulation.endings.find(item => item.key === simulation.qualifiedEndingKey)?.title ?? simulation.qualifiedEndingKey}</h2><p className="mt-1 text-xs text-text-muted">结局由正式规则与事件证据达成。选择对应 Narrative 结局完成本局。</p><div className="mt-3 flex flex-wrap gap-2">{visibleChoices.map(choice => <button key={choice.choiceKey} disabled={!store.runtimeState.narrative?.availableChoiceKeys?.includes(choice.choiceKey) || store.busy} onClick={() => void run(() => store.choose(choice.choiceKey))} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">{choice.text}</button>)}</div></section>}
        {store.runtimeState.narrative?.completed && <section className="rounded border border-accent/30 bg-accent/5 p-5 text-center"><h2 className="text-xl font-semibold">本局已完成</h2><p className="mt-2 text-xs text-text-muted">结局 {store.runtimeState.narrative.endingKey}；可从任一检查点建立另一条确定性时间线。</p></section>}
      </>}
    </div></main>
  </div>
}
