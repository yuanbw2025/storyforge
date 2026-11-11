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
import { remapNarrativeDomainReferencesV1 } from '../narrative-domain/lifecycle'
import { clearRegisteredArrayReferences, registeredArrayReferencesTo } from '../registry/array-references'

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

async function keysReferencingField(
  table: typeof PROJECT_TABLES[number]['table'],
  field: string,
  sourceId: number,
): Promise<number[]> {
  const indexed = table.schema.primKey.keyPath === field
    || table.schema.idxByName[field] != null
  if (indexed) return table.where(field).equals(sourceId).primaryKeys()
  // PROJECT_TABLES may govern semantically important but intentionally
  // unindexed optional references. Deletion is rare and correctness is more
  // important than forcing every nullable evidence pointer into the schema.
  return table.filter(row => row[field] === sourceId).primaryKeys()
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
  if (registeredArrayReferencesTo(sourceTableName).length) await clearRegisteredArrayReferences(sourceTableName, sourceId)
  await remapNarrativeDomainReferencesV1({ table: sourceTableName, fromId: sourceId })
  for (const ref of source.refs ?? []) {
    if (ref.kind !== 'simple' || ref.onDelete === 'keep') continue
    const target = parseSimpleTarget(ref.target)
    if (!target) throw new Error(`[workspace-lifecycle] 无效引用 ${sourceTableName} -> ${ref.target}`)
    const targetSpec = REGISTRY_BY_NAME.get(target.tableName)
    if (!targetSpec) throw new Error(`[workspace-lifecycle] 引用目标未登记 ${target.tableName}`)
    const keys = await keysReferencingField(targetSpec.table, target.field, sourceId)
    for (const key of keys) {
      if (ref.onDelete === 'setNull') {
        await targetSpec.table.update(key, { [target.field]: null })
      } else {
        await cascadeRegisteredReferences(target.tableName, key, visited)
        await targetSpec.table.delete(key)
      }
    }
  }
}

async function deleteOwnerRows(owner: 'world' | 'work', ownerId: number): Promise<void> {
  for (const spec of PROJECT_TABLES) {
    if (!spec.table || spec.name === 'projects' || spec.name === 'worlds' || spec.name === 'works') continue
    const locator = spec.domainOwner?.locator
    let field: string | undefined
    if (locator?.kind === 'field' && locator.owner === owner) {
      field = locator.field
    } else if (locator?.kind === 'exclusive-fields') {
      field = owner === 'world' ? locator.worldField : locator.workField
    } else if (locator?.kind === 'exclusive-work-instance' && owner === 'work') {
      field = locator.workField
    }
    if (field === undefined) continue
    // Read native keys from the matching collection: a table may use a key
    // such as analysisRunId, and an unrelated row.id is never authoritative.
    const keys = await spec.table.filter(row => row[field] === ownerId).primaryKeys()
    for (const key of keys) {
      await cascadeRegisteredReferences(spec.name, key)
      await spec.table.delete(key)
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
