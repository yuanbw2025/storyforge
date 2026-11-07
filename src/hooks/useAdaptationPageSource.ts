import { useEffect, useState } from 'react'
import { db } from '../lib/db/schema'
import { listAdaptationSourceOptions } from '../lib/adaptation/source-manifest'
import { switchActiveWork } from '../lib/workspace/works'
import type { Project, Work } from '../lib/types'

export function useAdaptationActiveProject(work: Work | undefined, setError: (message: string) => void) {
  const [project, setProject] = useState<Project | null>(null)
  const projectId = work?.projectId
  const workId = work?.id
  useEffect(() => {
    let cancelled = false
    if (projectId !== undefined) {
      void switchActiveWork(projectId, workId!).then(() => db.projects.get(projectId)).then(value => {
        if (!cancelled) setProject(value ?? null)
      }).catch(cause => setError(String(cause)))
    } else setProject(null)
    return () => { cancelled = true }
  }, [projectId, workId, setError])
  return project
}

export function useAdaptationSourceChapters(sourceId: string, sources: Work[], setError: (message: string) => void) {
  const [chapters, setChapters] = useState<{ id: number; title: string; wordCount: number }[]>([])
  const [selection, setSelection] = useState<number[]>([])
  useEffect(() => {
    let cancelled = false
    const source = sources.find(work => String(work.id) === sourceId)
    setChapters([])
    setSelection([])
    if (source) {
      void listAdaptationSourceOptions({
        projectId: source.projectId, workId: source.id!, worldId: source.worldId,
      }).then(value => {
        if (!cancelled) setChapters(value.chapters)
      }).catch(cause => setError(String(cause)))
    }
    return () => { cancelled = true }
    // The author's source selection resets the chapter choices. A live Work
    // metadata refresh is not a new selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId])
  return { chapters, selection, setSelection }
}
