import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { db } from '../lib/db/schema'
import type { Project, Work } from '../lib/types'

/** Read the active Work from the current Project identity. */
export function useActiveWork(project?: Project | null): Work | null {
  const [work, setWork] = useState<Work | null>(null)
  useEffect(() => {
    if (project?.id == null || project.activeWorkId == null) {
      setWork(null)
      return
    }
    const subscription = liveQuery(() => db.works.get(project.activeWorkId!)).subscribe({
      next: row => setWork(row && row.projectId === project.id ? row : null),
      error: () => setWork(null),
    })
    return () => subscription.unsubscribe()
  }, [project?.id, project?.activeWorkId])
  return work
}
