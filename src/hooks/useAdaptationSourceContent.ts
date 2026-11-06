import { useState } from 'react'
import { readAdaptationSourceContent } from '../lib/adaptation/source-manifest'
import type { AdaptationProject, WorkspaceScope } from '../lib/types'

export function useAdaptationSourceContent(scope: WorkspaceScope, root: AdaptationProject) {
  const [selected, setSelected] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function read(key: string) {
    setSelected(key)
    setBusy(true)
    setError('')
    setContent('')
    try {
      const result = await readAdaptationSourceContent({
        targetScope: scope, adaptationProjectId: root.id!,
        manifestVersion: root.activeSourceManifestVersion, sourceUnitKeys: [key],
      })
      setContent(result.units.map(unit => unit.content).join('\n\n'))
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }
  return { selected, content, error, busy, read }
}
