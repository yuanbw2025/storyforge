import {useLayoutEffect, useReducer, useRef} from 'react'
import type {WorkspaceScope} from '../../lib/types'
import {useCharacterInteractionPlayerStore} from '../../stores/character-interaction-player'

type NavigationState = Pick<ReturnType<typeof useCharacterInteractionPlayerStore.getState>,
  'scope' | 'worldGroupId' | 'selectedSessionId' | 'loading' | 'load'>
type NavigationProps = {
  workspaceScope?: WorkspaceScope
  worldGroupId: number | null
  initialSessionId?: number | null
  onSessionSelected?: (id: number | null) => void
}

/** Keep the address bound to the persisted session before displaying its branch. */
export function useChatSessionNavigation(props: NavigationProps, store: NavigationState) {
  const {workspaceScope, worldGroupId, initialSessionId, onSessionSelected} = props
  const initialized = useRef(false)
  const [loadRevision, loaded] = useReducer((value: number) => value + 1, 0)
  useLayoutEffect(() => {
    const current = useCharacterInteractionPlayerStore.getState()
    // A navigation echo must not load the already-selected branch again. Real
    // address/history changes still invalidate outgoing notifications first.
    if (initialized.current && !current.loading && current.selectedSessionId === initialSessionId
      && current.scope?.projectId === workspaceScope?.projectId && current.scope?.worldId === workspaceScope?.worldId
      && current.scope?.workId === workspaceScope?.workId && current.worldGroupId === worldGroupId) return
    let active = true
    initialized.current = false
    if (workspaceScope) {
      void store.load(workspaceScope, worldGroupId, initialSessionId).then(() => {
        if (active) { initialized.current = true; loaded() }
      })
    }
    return () => { active = false }
  // Scope identity and the requested session govern loading; the store action is stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceScope?.projectId, workspaceScope?.worldId, workspaceScope?.workId, worldGroupId, initialSessionId])

  useLayoutEffect(() => {
    // Branch creation has already persisted the new session when its ID changes.
    // Its final background refresh may still be busy: waiting for that refresh
    // leaves the visible branch attached to the parent's URL across a reload.
    if (initialized.current && !store.loading && workspaceScope
      && store.scope?.projectId === workspaceScope.projectId && store.scope?.worldId === workspaceScope.worldId
      && store.scope?.workId === workspaceScope.workId && store.worldGroupId === worldGroupId) {
      onSessionSelected?.(store.selectedSessionId)
    }
  }, [store.selectedSessionId, store.loading, store.scope?.projectId, store.scope?.worldId, store.scope?.workId,
    store.worldGroupId, workspaceScope, worldGroupId, onSessionSelected, loadRevision])
}
