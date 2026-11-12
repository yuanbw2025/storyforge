import { useLayoutEffect, useRef, useState } from 'react'
import { readAdaptationSourceContent } from '../lib/adaptation/source-manifest'
import type { AdaptationProject, WorkspaceScope } from '../lib/types'

const empty = { selected: '', content: '', error: '', busy: false }

export function useAdaptationSourceContent(scope: WorkspaceScope, root: AdaptationProject) {
  const [state, setState] = useState(empty)
  const request = useRef<symbol | null>(null)
  const { projectId, worldId, workId } = scope
  const { id, activeSourceManifestVersion } = root

  useLayoutEffect(() => {
    setState(empty)
    return () => { request.current = null }
  }, [projectId, worldId, workId, id, activeSourceManifestVersion])

  async function read(key: string) {
    const current = Symbol()
    request.current = current
    setState({ ...empty, selected: key, busy: true })
    try {
      const result = await readAdaptationSourceContent({
        targetScope: scope, adaptationProjectId: id!,
        manifestVersion: activeSourceManifestVersion, sourceUnitKeys: [key],
      })
      if (request.current === current) {
        setState({ ...empty, selected: key, content: result.units.map(unit => unit.content).join('\n\n') })
      }
    } catch (error) {
      if (request.current === current) setState({ ...empty, selected: key, error: String(error) })
    }
  }

  return { ...state, read }
}
