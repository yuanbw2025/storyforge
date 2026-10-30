import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { textOpenWorldUnsupportedRuntimeIssueV1 } from '../../lib/open-world/player-resilience'
import type { Project, WorkspaceScope } from '../../lib/types'
import { useTextOpenWorldPlayerStore, type TextOpenWorldPlayerState } from '../../stores/text-open-world-player'
import TextOpenWorldLauncher from './TextOpenWorldLauncher'
import TextOpenWorldPlayerErrorBoundary from './TextOpenWorldPlayerErrorBoundary'
import TextOpenWorldPlayerStateNotice from './TextOpenWorldPlayerStateNotice'
import TextOpenWorldVNextPlayer from './TextOpenWorldVNextPlayer'

const TextOpenWorldLegacyCompatibilityPlayer = lazy(() => import('./TextOpenWorldLegacyCompatibilityPlayer'))

function ownsSelection(state: TextOpenWorldPlayerState, scope: WorkspaceScope, worldGroupId: number | null): boolean {
  if (state.scope?.projectId !== scope.projectId || state.scope.worldId !== scope.worldId
    || state.scope.workId !== scope.workId || state.worldGroupId !== worldGroupId) return false
  if (state.selectedSessionId == null) return state.selectedSession == null
  const session = state.selectedSession
  return session?.id === state.selectedSessionId && session.projectId === scope.projectId
    && session.worldId === scope.worldId && session.workId === scope.workId
    && (session.worldGroupId ?? null) === worldGroupId && state.selectedManifest != null
}

export default function TextOpenWorldPlayer(props: {
  project: Project
  scope: WorkspaceScope
  worldGroupId: number | null
  initialSessionId?: number | null
  onSessionSelected?(sessionId: number | null): void
}) {
  const store = useTextOpenWorldPlayerStore()
  const onSessionSelected = props.onSessionSelected
  const requestKey = `${props.scope.projectId}:${props.scope.worldId}:${props.scope.workId}:${props.worldGroupId}:${props.initialSessionId ?? null}`
  const [loadedRequest, setLoadedRequest] = useState<string | null>(null)
  const reportedSelection = useRef<string | null>(null)

  useEffect(() => {
    let active = true
    const current = useTextOpenWorldPlayerStore.getState()
    // A settled in-player selection updates the URL without loading it again.
    if (reportedSelection.current === requestKey && !current.loading && !current.error
      && ownsSelection(current, props.scope, props.worldGroupId)
      && current.selectedSessionId === (props.initialSessionId ?? null)) {
      setLoadedRequest(requestKey)
    } else {
      setLoadedRequest(null)
      void current.load(props.scope, props.worldGroupId, props.initialSessionId).then(() => {
        if (active) setLoadedRequest(requestKey)
      })
    }
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.scope.projectId,
    props.scope.worldId,
    props.scope.workId,
    props.worldGroupId,
    props.initialSessionId,
    requestKey,
  ])

  useEffect(() => {
    if (loadedRequest !== requestKey || store.loading || store.busy || store.error
      || !ownsSelection(store, props.scope, props.worldGroupId)
      || store.selectedSessionId === (props.initialSessionId ?? null)
      || !onSessionSelected) return
    reportedSelection.current = `${props.scope.projectId}:${props.scope.worldId}:${props.scope.workId}:${props.worldGroupId}:${store.selectedSessionId}`
    onSessionSelected(store.selectedSessionId)
  }, [loadedRequest, requestKey, store, props.scope, props.worldGroupId, props.initialSessionId, onSessionSelected])

  if ((store.selectedSession != null || props.initialSessionId != null)
    && (store.loading || loadedRequest !== requestKey || !ownsSelection(store, props.scope, props.worldGroupId))) {
    return <div
      className="avg-title-screen open-world-launcher open-world-player-boundary"
      data-testid="text-open-world-runtime-loading"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <main className="avg-title-content open-world-launcher-content">
        <Loader2 className="animate-spin" aria-hidden="true" />
        <h2>正在核对当前旅程</h2>
        <p>播放器正在读取冻结运行包、事件时间线与存档证据；完成前不会开放任何写入操作。</p>
      </main>
    </div>
  }
  if (!store.selectedSession) {
    return <TextOpenWorldLauncher scope={props.scope} worldGroupId={props.worldGroupId} />
  }
  if (store.runtimeState.textOpenWorld && store.selectedManifest?.textOpenWorldVNext) {
    if (store.selectedManifest.textOpenWorldVNext.sourceManifest.kind === 'novel-source-pin') {
      return <div className="open-world-launcher p-5" data-testid="text-open-world-legacy-novel-readonly">
        <main className="mx-auto max-w-5xl space-y-4 rounded-xl border border-border bg-bg-elevated p-5">
          <h2 className="text-lg font-semibold">历史小说来源 · 只读存档</h2>
          <p className="text-sm leading-6">此旅程保留原 SourcePin、不可变发布、存档和事件前缀，可核验与回放。当前不再推进互动、调用模型或创建分支。继续制作须先显式派生世界草稿，检查并封存 WorldRelease，再重新完成产品定向。</p>
          <p className="text-xs text-text-muted">存档：{store.selectedSession.title} · 已核验事件 {store.runtimeState.lastSequence} 条 · 检查点 {store.checkpoints.length} 个</p>
          <div className="flex gap-3"><button type="button" onClick={() => void store.select(store.selectedSessionId)} className="rounded border border-border px-3 py-2 text-xs">重新核对原存档</button><button type="button" onClick={() => void store.select(null)} className="rounded border border-border px-3 py-2 text-xs">返回游戏库</button></div>
          <details open><summary className="cursor-pointer text-sm">已核验的事件前缀</summary><pre className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(store.events, null, 2)}</pre></details>
          <details><summary className="cursor-pointer text-sm">原存档检查点</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(store.checkpoints, null, 2)}</pre></details>
          {store.error && <p role="alert" className="text-xs text-danger">{store.error}</p>}
        </main>
      </div>
    }
    return <TextOpenWorldPlayerErrorBoundary
      resetKey={`${store.selectedSession.id}:vnext:${store.runtimeState.lastSequence}`}
      onRecover={() => void store.select(store.selectedSessionId)}
      onExit={() => void store.select(null)}
    ><TextOpenWorldVNextPlayer /></TextOpenWorldPlayerErrorBoundary>
  }
  if (store.selectedSessionSource === 'release'
    && store.runtimeState.openWorld
    && store.selectedManifest?.openWorld) {
    return <TextOpenWorldPlayerErrorBoundary
      resetKey={`${store.selectedSession.id}:legacy:${store.runtimeState.lastSequence}`}
      onRecover={() => void store.select(store.selectedSessionId)}
      onExit={() => void store.select(null)}
    ><Suspense fallback={<p role="status">正在读取旧版旅程…</p>}>
      <TextOpenWorldLegacyCompatibilityPlayer />
    </Suspense></TextOpenWorldPlayerErrorBoundary>
  }
  return <div
    className="avg-title-screen open-world-launcher open-world-player-boundary"
    data-testid="text-open-world-runtime-blocking"
  >
    <main className="avg-title-content open-world-launcher-content">
      <TextOpenWorldPlayerStateNotice
        issue={textOpenWorldUnsupportedRuntimeIssueV1()}
        primaryLabel="重新核对存档"
        onPrimary={() => void store.select(store.selectedSessionId)}
        secondaryLabel="返回游戏库"
        onSecondary={() => void store.select(null)}
      />
    </main>
  </div>
}
