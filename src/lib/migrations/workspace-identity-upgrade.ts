import type { Transaction } from 'dexie'
import type { Project, Work } from '../types'
import {
  generateWorkspaceUid,
  generateWorkCode,
  isWorkspaceUid,
  isWorkCode,
} from '../memory/identity'

function allocateUnique(generate: () => string, used: Set<string>): string {
  let value = generate()
  while (used.has(value)) value = generate()
  used.add(value)
  return value
}

/** MEMORY-1: add portable identity without guessing from mutable titles or local numeric ids. */
export async function migrateWorkspacePortableIdentities(tx: Transaction): Promise<void> {
  const projectTable = tx.table<Project, number>('projects')
  const workTable = tx.table<Work, number>('works')
  const projects = await projectTable.toArray()
  const usedWorkspaceUids = new Set<string>()

  for (const project of projects.sort((left, right) => (left.id ?? 0) - (right.id ?? 0))) {
    let workspaceUid = project.workspaceUid
    if (!isWorkspaceUid(workspaceUid) || usedWorkspaceUids.has(workspaceUid)) {
      workspaceUid = allocateUnique(generateWorkspaceUid, usedWorkspaceUids)
      await projectTable.update(project.id!, { workspaceUid })
    } else {
      usedWorkspaceUids.add(workspaceUid)
    }

    const works = await workTable.where('projectId').equals(project.id!).toArray()
    const usedWorkCodes = new Set<string>()
    for (const work of works.sort((left, right) => (left.id ?? 0) - (right.id ?? 0))) {
      if (!isWorkCode(work.code) || usedWorkCodes.has(work.code)) {
        const code = allocateUnique(generateWorkCode, usedWorkCodes)
        await workTable.update(work.id!, { code })
      } else {
        usedWorkCodes.add(work.code)
      }
    }
  }
}
