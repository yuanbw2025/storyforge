import { useEffect, useMemo, useState } from 'react'
import { Dices, ShieldCheck, Trash2 } from 'lucide-react'
import type { OnlineRoomJoinHandoffV1 } from '../../lib/online/http-transport'
import type { Project, WorkspaceScope } from '../../lib/types'
import { useTtrpgRuntimePlayerStore } from '../../stores/ttrpg-runtime-player'
import { useDialog } from '../shared/Dialog'
import TtrpgCampaignGuide from './TtrpgCampaignGuide'

/**
 * Product-owned TTRPG runtime surface.
 *
 * This component never creates a session from a mutable world draft and never
 * offers generic sandbox/NPC modes.  Sessions arrive only through the product
 * runtime factory after a verified ProductRelease or governed Build Preview.
 */
export default function TtrpgRuntimePanel(props: {
  project: Project
  worldGroupId: number | null
  workspaceScope: WorkspaceScope
  initialSessionId?: number | null
  initialOnlineHandoff?: OnlineRoomJoinHandoffV1 | null
  onOnlineHandoffConsumed?: () => void
}) {
  const store = useTtrpgRuntimePlayerStore()
  const dialog = useDialog()
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    let cancelled = false
    void store.load(props.project.id!, props.worldGroupId).then(async () => {
      if (!cancelled && props.initialSessionId != null) await store.select(props.initialSessionId)
    })
    return () => { cancelled = true }
  // Zustand action identity is stable; workspace identity is the reload boundary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.project.id, props.worldGroupId, props.initialSessionId])

  const sessions = useMemo(() => store.sessions.filter(session => (
    session.projectId === props.workspaceScope.projectId
    && session.worldId === props.workspaceScope.worldId
    && session.workId === props.workspaceScope.workId
    && (session.worldGroupId ?? null) === props.worldGroupId
    && session.kind === 'ttrpg'
    && Boolean(session.runtimeSourceHash)
    && Number(session.productReleaseId != null) + Number(session.productBuildId != null) === 1
  )), [props.workspaceScope, props.worldGroupId, store.sessions])
  const selected = sessions.find(session => session.id === store.selectedSessionId) ?? null

  useEffect(() => {
    if (store.loading || sessions.some(session => session.id === store.selectedSessionId)) return
    void store.select(sessions[0]?.id ?? null)
  }, [sessions, store])

  const remove = async () => {
    if (!selected?.id) return
    const confirmed = await dialog.confirm({
      title: `删除跑团存档“${selected.title}”？`,
      message: '该产品实例的事件、检查点与私域演化记录将一并删除；世界引擎和产品发布不会被修改。',
      confirmText: '删除存档',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      setActionError('')
      await store.remove(selected.id)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return <div className="flex h-full min-h-[36rem] flex-col bg-bg-base lg:flex-row" data-testid="ttrpg-runtime-panel">
    <aside className="max-h-[28rem] w-full shrink-0 overflow-y-auto border-b border-border bg-bg-surface p-4 lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r">
      <div className="mb-4">
        <div className="mb-1 flex items-center gap-2"><Dices className="h-4 w-4 text-accent" /><h2 className="font-semibold text-text-primary">跑团存档</h2></div>
        <p className="text-xs leading-relaxed text-text-muted">这里只显示从 ProductRelease 或 Build Preview 创建的跑团实例。世界草稿不能在这里直接运行。</p>
      </div>
      <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs leading-5 text-text-secondary" data-testid="formal-runtime-release-only">
        <div className="flex items-center gap-2 font-medium text-text-primary"><ShieldCheck className="h-3.5 w-3.5 text-accent" />产品来源已锁定</div>
        <p className="mt-1">运行只读冻结产品包；会话、媒资状态和后续演化归跑团产品实例，不回写世界引擎。</p>
      </div>
      <div className="space-y-1">
        {sessions.map(session => <button key={session.id} onClick={() => void store.select(session.id!)} className={`w-full rounded px-3 py-2 text-left ${session.id === store.selectedSessionId ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-bg-hover'}`}>
          <div className="truncate text-sm font-medium">{session.title}</div>
          <div className="mt-0.5 text-[11px] text-text-muted">跑团 · {session.status}</div>
        </button>)}
        {!store.loading && sessions.length === 0 && <p className="py-6 text-center text-xs text-text-muted">还没有跑团产品存档，请先完成制作或启动可玩预览。</p>}
      </div>
    </aside>
    <main className="min-w-0 flex-1 overflow-y-auto p-6">
      {!selected ? <div className="flex h-full items-center justify-center text-sm text-text-muted">请先完成跑团制作，并从已验证的发布或预览进入。</div> : store.runtimeState.ttrpg?.product ? <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex items-start justify-between gap-4">
          <div><div className="mb-1 text-xs text-text-muted">PLAY / TTRPG</div><h1 className="text-xl font-semibold text-text-primary">{selected.title}</h1><p className="mt-1 text-xs text-text-muted">冻结来源 · 事件 {store.runtimeState.lastSequence} · 检查点 {store.checkpoints.length}</p></div>
          <button onClick={() => void remove()} className="rounded p-2 text-danger hover:bg-danger/10" title="删除跑团存档" aria-label={`删除跑团存档 ${selected.title}`}><Trash2 className="h-4 w-4" /></button>
        </header>
        {(store.error || actionError) && <div className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{actionError || store.error}</div>}
        <TtrpgCampaignGuide
          session={selected}
          state={store.runtimeState}
          workspaceScope={props.workspaceScope}
          checkpoints={store.checkpoints}
          onCheckpoint={name => store.checkpoint(name)}
          onBranch={title => store.branch(title)}
          onRestoreCheckpoint={checkpointId => store.restoreCheckpoint(checkpointId)}
          onChanged={() => store.select(selected.id!)}
          initialOnlineHandoff={props.initialOnlineHandoff}
          onOnlineHandoffConsumed={props.onOnlineHandoffConsumed}
        />
      </div> : <div className="rounded border border-danger/30 bg-danger/10 p-4 text-sm text-danger">该存档缺少正式跑团产品状态，已被拒绝进入运行界面。请从 ProductRelease 重新创建实例。</div>}
    </main>
  </div>
}
