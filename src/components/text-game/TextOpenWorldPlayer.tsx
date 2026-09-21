import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { textOpenWorldUnsupportedRuntimeIssueV1 } from '../../lib/open-world/player-resilience'
import type { Project, WorkspaceScope } from '../../lib/types'
import { useTextOpenWorldPlayerStore } from '../../stores/text-open-world-player'
import TextOpenWorldLauncher from './TextOpenWorldLauncher'
import TextOpenWorldLegacyCompatibilityPlayer from './TextOpenWorldLegacyCompatibilityPlayer'
import TextOpenWorldPlayerErrorBoundary from './TextOpenWorldPlayerErrorBoundary'
import TextOpenWorldPlayerStateNotice from './TextOpenWorldPlayerStateNotice'
import TextOpenWorldVNextPlayer from './TextOpenWorldVNextPlayer'

export default function TextOpenWorldPlayer(props: {
  project: Project
  scope: WorkspaceScope
  worldGroupId: number | null
  initialSessionId?: number | null
}) {
  const store = useTextOpenWorldPlayerStore()

  useEffect(() => {
    void store.load(props.scope, props.worldGroupId, props.initialSessionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.scope.projectId,
    props.scope.worldId,
    props.scope.workId,
    props.worldGroupId,
    props.initialSessionId,
  ])

  if (!store.selectedSession) {
    return <TextOpenWorldLauncher scope={props.scope} worldGroupId={props.worldGroupId} />
  }
  if (store.loading) {
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
    ><TextOpenWorldLegacyCompatibilityPlayer /></TextOpenWorldPlayerErrorBoundary>
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
