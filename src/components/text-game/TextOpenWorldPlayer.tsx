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

  if (store.loading && (store.selectedSession != null || props.initialSessionId != null)) {
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
