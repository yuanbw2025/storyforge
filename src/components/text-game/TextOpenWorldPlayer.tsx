import { useEffect } from 'react'
import type { Project, WorkspaceScope } from '../../lib/types'
import { useTextOpenWorldPlayerStore } from '../../stores/text-open-world-player'
import TextOpenWorldLauncher from './TextOpenWorldLauncher'
import TextOpenWorldLegacyPlayer from './TextOpenWorldLegacyPlayer'
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
  if (store.runtimeState.textOpenWorld && store.selectedManifest?.textOpenWorldVNext) {
    return <TextOpenWorldVNextPlayer />
  }
  if (store.runtimeState.openWorld && store.selectedManifest?.openWorld) {
    return <TextOpenWorldLegacyPlayer />
  }
  return null
}
