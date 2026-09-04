/**
 * Workspace/World/Work 生命周期边界。
 *
 * World owns canon; Work owns authored projections. Deleting a Work must never
 * touch World-owned rows, while deleting a World requires explicit confirmation
 * before removing its Works and all dependent content.
 */
import { db } from '../db/schema'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from '../registry/project-tables'
import { transactionTablesFor, cascadeDeleteProject } from '../registry/lifecycle'
import { resolveWorkspaceOwnership } from './ownership'
import { markAndSweepAgentRunArtifactsV1 } from '../memory/artifact-retention-store'

function ownerField(spec: typeof PROJECT_TABLES[number]): { owner: 'world' | 'work'; field: string } | null {
  const locator = spec.domainOwner?.locator
  if (locator?.kind === 'field' && (locator.owner === 'world' || locator.owner === 'work')) {
    return { owner: locator.owner, field: locator.field }
  }
  return null
}

function parseSimpleTarget(target: string): { tableName: string; field: string } | null {
  const match = target.match(/^([^[]+)\[([^\]]+)\]$/)
  return match ? { tableName: match[1], field: match[2] } : null
}

export async function cascadeRegisteredReferences(
  sourceTableName: string,
  sourceId: number,
  visited = new Set<string>(),
): Promise<void> {
  const visitKey = `${sourceTableName}:${sourceId}`
  if (visited.has(visitKey)) return
  visited.add(visitKey)
  const source = REGISTRY_BY_NAME.get(sourceTableName)
  if (!source) throw new Error(`[workspace-lifecycle] 未登记表 ${sourceTableName}`)
  for (const ref of source.refs ?? []) {
    if (ref.kind !== 'simple' || ref.onDelete === 'keep') continue
    const target = parseSimpleTarget(ref.target)
    if (!target) throw new Error(`[workspace-lifecycle] 无效引用 ${sourceTableName} -> ${ref.target}`)
    const targetSpec = REGISTRY_BY_NAME.get(target.tableName)
    if (!targetSpec) throw new Error(`[workspace-lifecycle] 引用目标未登记 ${target.tableName}`)
    const rows = await (targetSpec.table as any).where(target.field).equals(sourceId).toArray()
    for (const row of rows) {
      if (row.id == null) continue
      if (ref.onDelete === 'setNull') {
        await targetSpec.table.update(row.id, { [target.field]: null })
      } else {
        await cascadeRegisteredReferences(target.tableName, row.id, visited)
        await targetSpec.table.delete(row.id)
      }
    }
  }
}

async function deleteOwnerRows(owner: 'world' | 'work', ownerId: number): Promise<void> {
  for (const spec of PROJECT_TABLES) {
    if (!spec.table || spec.name === 'projects' || spec.name === 'worlds' || spec.name === 'works') continue
    const locator = spec.domainOwner?.locator
    if (locator?.kind === 'field' && locator.owner === owner) {
      const rows = (await spec.table.toArray()).filter(row => (row as any)[locator.field] === ownerId)
      for (const row of rows) {
        if (row.id == null) continue
        await cascadeRegisteredReferences(spec.name, row.id)
        await spec.table.delete(row.id)
      }
    } else if (locator?.kind === 'exclusive-fields') {
      const field = owner === 'world' ? locator.worldField : locator.workField
      const rows = (await spec.table.toArray()).filter(row => (row as any)[field] === ownerId)
      for (const row of rows) {
        if (row.id == null) continue
        await cascadeRegisteredReferences(spec.name, row.id)
        await spec.table.delete(row.id)
      }
    } else if (locator?.kind === 'exclusive-work-instance' && owner === 'work') {
      const rows = (await spec.table.toArray()).filter(row => (row as any)[locator.workField] === ownerId)
      for (const row of rows) {
        if (row.id == null) continue
        await cascadeRegisteredReferences(spec.name, row.id)
        await spec.table.delete(row.id)
      }
    }
  }
}

export async function deleteWork(workId: number): Promise<void> {
  const work = await db.works.get(workId)
  if (!work) return
  await resolveWorkspaceOwnership(work.projectId)
  await db.transaction('rw', transactionTablesFor('deleteProject'), async () => {
    await cascadeRegisteredReferences('works', workId)
    await deleteOwnerRows('work', workId)
    await db.works.delete(workId)
    const project = await db.projects.get(work.projectId)
    if (project?.activeWorkId === workId) {
      const replacement = await db.works.where('worldId').equals(work.worldId).sortBy('updatedAt')
      const nextWork = replacement[replacement.length - 1]
      const world = await db.worlds.get(work.worldId)
      if (!world) throw new Error('[workspace-lifecycle] Work 的语义作用域根在删除过程中丢失')
      await db.projects.update(work.projectId, {
        activeWorldId: world.id!,
        activeWorkId: nextWork?.id ?? null,
        updatedAt: Date.now(),
      })
    }
  })
  await markAndSweepAgentRunArtifactsV1(work.projectId)
}

export async function deleteWorld(worldId: number, options: { confirm: boolean } = { confirm: false }): Promise<void> {
  const world = await db.worlds.get(worldId)
  if (!world) return
  const works = await db.works.where('worldId').equals(worldId).toArray()
  if (works.length && !options.confirm) {
    throw new Error('[workspace-lifecycle] 删除 World 前必须显式确认其 Works 将一并删除')
  }
  await resolveWorkspaceOwnership(world.projectId)
  await db.transaction('rw', transactionTablesFor('deleteProject'), async () => {
    for (const work of works) {
      await cascadeRegisteredReferences('works', work.id!)
      await deleteOwnerRows('work', work.id!)
    }
    await db.works.bulkDelete(works.map(work => work.id!).filter(Boolean))
    await cascadeRegisteredReferences('worlds', worldId)
    await deleteOwnerRows('world', worldId)
    await db.worlds.delete(worldId)
    const project = await db.projects.get(world.projectId)
    if (project?.activeWorldId === worldId) {
      const replacement = await db.worlds.where('projectId').equals(world.projectId).sortBy('updatedAt')
      const nextWorld = replacement[replacement.length - 1]
      let nextWork
      if (nextWorld?.id != null) {
        const candidates = await db.works.where('worldId').equals(nextWorld.id).sortBy('updatedAt')
        nextWork = candidates[candidates.length - 1]
      }
      await db.projects.update(world.projectId, {
        activeWorldId: nextWorld?.id ?? null,
        activeWorkId: nextWork?.id ?? null,
        updatedAt: Date.now(),
      })
    }
  })
  await markAndSweepAgentRunArtifactsV1(world.projectId)
}

export async function deleteWorkspace(projectId: number): Promise<void> {
  await cascadeDeleteProject(projectId)
}

export function registeredOwnerField(tableName: string): { owner: 'world' | 'work'; field: string } | null {
  const spec = PROJECT_TABLES.find(candidate => candidate.name === tableName)
  return spec ? ownerField(spec) : null
}
