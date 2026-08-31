import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileJson2, Globe2, Loader2, Rocket, Save, ShieldCheck, Trash2 } from 'lucide-react'
import type { WorkspaceScope } from '../../lib/types'
import {
  deleteTextOpenWorldGameDraft,
  loadTextOpenWorldAuthoringSnapshot,
  saveTextOpenWorldBundle,
  seedTextOpenWorldAcceptanceGame,
  validateTextOpenWorldGame,
  type TextOpenWorldAuthoringSnapshot,
  type TextOpenWorldDraftReport,
} from '../../lib/open-world/authoring'
import { useDialog } from '../shared/Dialog'

const EMPTY: TextOpenWorldAuthoringSnapshot = { definitions: [], narrativeModules: [], narrativeNodes: [], openWorldModules: [], adventureModules: [], simulationModules: [], profiles: [], scenes: [], releases: [] }

export default function TextOpenWorldWorkbench({ scope, onOpenProduction }: { scope: WorkspaceScope; onOpenProduction?: () => void }) {
  const dialog = useDialog()
  const [snapshot, setSnapshot] = useState(EMPTY)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [openWorldJson, setOpenWorldJson] = useState('')
  const [adventureJson, setAdventureJson] = useState('')
  const [simulationJson, setSimulationJson] = useState('')
  const [report, setReport] = useState<TextOpenWorldDraftReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const select = (next: TextOpenWorldAuthoringSnapshot, id: number | null) => {
    const desired = id != null && next.definitions.some(item => item.id === id) ? id : next.definitions[0]?.id ?? null
    setSelectedId(desired)
    setOpenWorldJson(next.openWorldModules.find(item => item.gameDefinitionId === desired)?.contentJson ?? '')
    setAdventureJson(next.adventureModules.find(item => item.gameDefinitionId === desired)?.contentJson ?? '')
    setSimulationJson(next.simulationModules.find(item => item.gameDefinitionId === desired)?.contentJson ?? '')
    setReport(null)
  }
  const refresh = async (id: number | null = selectedId) => {
    const next = await loadTextOpenWorldAuthoringSnapshot(scope)
    setSnapshot(next)
    select(next, id)
  }
  useEffect(() => { void refresh(null) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.projectId, scope.worldId, scope.workId])
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await operation() } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const counts = useMemo(() => {
    try {
      const content = JSON.parse(openWorldJson) as { regions?: unknown[]; fixedTaskCards?: unknown[]; taskTemplates?: unknown[]; actorSchedules?: Array<{ actorKind?: string }> }
      return { regions: content.regions?.length ?? 0, fixed: content.fixedTaskCards?.length ?? 0, templates: content.taskTemplates?.length ?? 0, participants: content.actorSchedules?.filter(item => item.actorKind === 'participant').length ?? 0, organizations: content.actorSchedules?.filter(item => item.actorKind === 'organization').length ?? 0 }
    } catch { return { regions: 0, fixed: 0, templates: 0, participants: 0, organizations: 0 } }
  }, [openWorldJson])
  const releases = snapshot.releases.filter(item => item.gameDefinitionId === selectedId)

  return <div className="grid min-h-[44rem] grid-cols-1 bg-bg-base lg:grid-cols-[17rem_minmax(0,1fr)]" data-testid="text-open-world-workbench">
    <aside className="border-b border-border bg-bg-surface p-4 lg:border-b-0 lg:border-r"><div className="mb-3 flex items-center gap-2"><Globe2 className="h-4 w-4 text-accent" /><strong className="text-sm">开放世界草稿</strong></div><p className="mb-4 text-xs leading-relaxed text-text-muted">一个 Work-owned 区域模块组合共享 Narrative、互动、冒险和模拟；运行事实仍只进入 SIM。</p>{!onOpenProduction && <button disabled={busy} className="mb-4 flex w-full items-center justify-center gap-1 rounded bg-accent px-3 py-2 text-xs text-white" onClick={() => void run(async () => { const created = await seedTextOpenWorldAcceptanceGame({ scope }); await refresh(created.id!); setMessage('已创建 5 区域、20 NPC、5 组织、30 固定任务和 10 模板的验收世界。') })}>{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe2 className="h-3 w-3" />}创建验收世界</button>}<div className="space-y-1">{snapshot.definitions.map(definition => <button key={definition.id} onClick={() => select(snapshot, definition.id!)} className={`block w-full rounded px-3 py-2 text-left text-xs ${definition.id === selectedId ? 'bg-accent/10 text-accent' : 'hover:bg-bg-base'}`}><strong className="block truncate">{definition.title}</strong><small>{definition.gameKey}</small></button>)}</div></aside>
    <main className="min-w-0 p-4 sm:p-6"><div className="mx-auto max-w-7xl space-y-4">{message && <div role="status" className="rounded border border-border bg-bg-surface px-3 py-2 text-xs">{message}</div>}{!selectedId && <div className="storygame-empty"><Globe2 className="h-8 w-8" /><h2>{onOpenProduction ? '没有需要维护的旧草稿' : '创建开放世界草稿'}</h2><p>{onOpenProduction ? '新游戏统一从制作中心开始。' : '验收模板可直接离线运行，也可以修改三个声明式 JSON 模块。'}</p>{onOpenProduction && <button className="storygame-author-create" onClick={onOpenProduction}><Rocket className="h-4 w-4" />进入制作中心</button>}</div>}{selectedId && <>
      <header className="flex flex-wrap items-start justify-between gap-3"><div><small className="text-accent">TEXTWORLD-1 · AUTHOR</small><h1 className="mt-1 text-xl font-semibold">{snapshot.definitions.find(item => item.id === selectedId)?.title}</h1><p className="mt-1 text-xs text-text-muted">区域目录、任务导演、运行状态和 Narrative 均由当前产品拥有；世界引擎只作为冻结语义来源。</p></div><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void run(async () => { const next = await validateTextOpenWorldGame(scope, selectedId); setReport(next); setMessage(next.valid ? '全部发布校验通过。' : next.errors.join('；')) })} className="rounded border border-border px-3 py-2 text-xs"><ShieldCheck className="mr-1 inline h-3 w-3" />检查</button><button disabled={busy} onClick={() => onOpenProduction ? onOpenProduction() : setMessage('正式发布必须进入制作中心，由来源计划、用户确认、Build 校验和原子发布共同完成。')} className="rounded bg-accent px-3 py-2 text-xs text-white"><Rocket className="mr-1 inline h-3 w-3" />交由制作中心发布</button><button disabled={busy} onClick={() => void run(async () => { const confirmed = await dialog.confirm({ title: '删除开放世界草稿？', message: '草稿内容模块会按 PROJECT_TABLES 级联删除；不可变发布和玩家存档保留。', confirmText: '删除草稿', tone: 'danger' }); if (!confirmed) return; await deleteTextOpenWorldGameDraft({ scope, gameDefinitionId: selectedId }); await refresh(null) })} className="rounded border border-danger/30 px-3 py-2 text-xs text-danger"><Trash2 className="mr-1 inline h-3 w-3" />删除</button></div></header>
      <section className="grid gap-2 sm:grid-cols-5">{Object.entries(counts).map(([key, value]) => <article key={key} className="rounded border border-border bg-bg-surface p-3"><small className="text-[9px] uppercase text-text-muted">{key}</small><strong className="mt-1 block text-xl">{value}</strong></article>)}</section>
      {report && <section className={`rounded border p-3 text-xs ${report.valid ? 'border-accent/30 bg-accent/5' : 'border-danger/30 bg-danger/5'}`}><strong>{report.valid ? '发布就绪' : '存在阻断问题'}</strong><p className="mt-1 text-text-muted">{[...report.errors, ...report.warnings].join('；') || '内容图、区域引用、关键主线、洪水控制、传播边界与三个共享能力全部有效。'}</p></section>}
      <section className="grid gap-3 xl:grid-cols-3">{[
        ['OpenWorldContentV1', openWorldJson, setOpenWorldJson],
        ['AdventureContentV1', adventureJson, setAdventureJson],
        ['NarrativeSimulationContentV1', simulationJson, setSimulationJson],
      ].map(([label, value, setter]) => <label key={label as string} className="rounded border border-border bg-bg-surface p-3 text-xs"><span className="mb-2 flex items-center gap-1 font-semibold"><FileJson2 className="h-3.5 w-3.5 text-accent" />{label as string}</span><textarea aria-label={`${label as string} JSON`} rows={32} spellCheck={false} className="w-full rounded border border-border bg-bg-base p-2 font-mono text-[10px]" value={value as string} onChange={event => (setter as (value: string) => void)(event.target.value)} /></label>)}</section>
      <button disabled={busy} onClick={() => void run(async () => { await saveTextOpenWorldBundle({ scope, gameDefinitionId: selectedId, adventure: adventureJson, simulation: simulationJson, openWorld: openWorldJson }); await refresh(selectedId); setMessage('三个声明式内容模块已原子保存。') })} className="flex items-center gap-1 rounded bg-accent px-4 py-2 text-xs text-white"><Save className="h-3.5 w-3.5" />解析并保存全部模块</button>
      <section className="rounded border border-border bg-bg-surface p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-accent" />不可变发布</div><div className="space-y-2">{releases.map(item => <article key={item.id} className="flex justify-between rounded bg-bg-base p-2 text-xs"><span>v{item.version} · {item.label}</span><code>{item.contentHash.slice(0, 12)}</code></article>)}{!releases.length && <p className="text-xs text-text-muted">尚无发布。</p>}</div></section>
    </>}</div></main>
  </div>
}
