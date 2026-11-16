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
    if (projectId == null || workId == null) {
      setProject(null)
      return
    }
    let active = true
    void switchActiveWork(projectId, workId)
      .then(() => db.projects.get(projectId))
      .then(value => { if (active) setProject(value ?? null) })
      .catch(error => { if (active) setError(String(error)) })
    return () => { active = false }
  }, [projectId, workId, setError])

  return project && project.id === projectId && project.activeWorkId === workId ? project : null
}

export function useAdaptationSourceChapters(sourceId: string, sources: Work[], setError: (message: string) => void) {
  const [chapters, setChapters] = useState<{ id: number; title: string; wordCount: number }[]>([])
  const [selection, setSelection] = useState<number[]>([])
  const source = sources.find(work => String(work.id) === sourceId)
  const projectId = source?.projectId
  const worldId = source?.worldId
  const workId = source?.id

  useEffect(() => {
    setChapters([])
    setSelection([])
    if (projectId == null || worldId == null || workId == null) return

    let active = true
    void listAdaptationSourceOptions({ projectId, worldId, workId })
      .then(value => { if (active) setChapters(value.chapters) })
      .catch(error => { if (active) setError(String(error)) })
    return () => { active = false }
  }, [projectId, worldId, workId, setError])

  return { chapters, selection, setSelection }
}
