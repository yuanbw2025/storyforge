import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Project } from '../lib/types'
import { useWorldviewStore } from '../stores/worldview'

/** Bind readback to the rendered author view, including late adoption callbacks. */
export function useScopedWorldviewReadback(project: Project, activeGroupId: number | null) {
  const { loadAll } = useWorldviewStore()
  const authorScope = useMemo(() => ({ projectId: project.id!, worldId: project.activeWorldId!, workId: project.activeWorkId! }), [project.id, project.activeWorldId, project.activeWorkId])
  const groupId = project.enableMultiWorld ? activeGroupId : null
  const latest = useRef({ scope: authorScope, groupId })
  latest.current = { scope: authorScope, groupId }
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const reloadCurrent = useCallback(async () => {
    if (!mounted.current || latest.current.scope !== authorScope || latest.current.groupId !== groupId) return
    await loadAll(authorScope, groupId)
  }, [authorScope, groupId, loadAll])
  useEffect(() => { void reloadCurrent().catch(() => undefined) }, [reloadCurrent])
  return { authorScope, reloadCurrent }
}
