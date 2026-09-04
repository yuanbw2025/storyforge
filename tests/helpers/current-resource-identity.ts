import { db } from '../../src/lib/db/schema'
import { createPortableResourceUidV1 } from '../../src/lib/context-gateway/resource-uid'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { resolveWorkspaceScope } from '../../src/lib/workspace/ownership'

/**
 * Test-fixture helper only. Production writes receive resource identities from
 * stampNewRecord(); tests that seed Dexie rows directly must make the same
 * current-schema invariant explicit before exercising the Context Gateway.
 */
export async function stampCurrentFixtureResourceUidsV1(projectId: number): Promise<void> {
  const specs = PROJECT_TABLES.filter(spec => spec.resourceIdentity != null)
  await db.transaction('rw', specs.map(spec => spec.table), async () => {
    const seen = new Set<string>()
    for (const spec of specs) {
      const identity = spec.resourceIdentity!
      const rows = await spec.table.where('projectId').equals(projectId).toArray() as Array<Record<string, unknown>>
      for (const row of rows) {
        if (!Number.isInteger(row.id)) throw new Error(`${spec.name} 测试记录缺少 numeric id`)
        let uid = row[identity.field]
        if (typeof uid !== 'string' || !uid.trim()) {
          do uid = createPortableResourceUidV1(identity.resourceKind)
          while (seen.has(uid))
          await spec.table.update(row.id as number, { [identity.field]: uid })
        }
        if (seen.has(uid)) throw new Error(`测试项目内 resource UID 重复: ${uid}`)
        seen.add(uid)
      }
    }
  })
}

/**
 * Close a directly seeded test fixture against the current ownership registry.
 * This helper exists only because focused tests intentionally construct domain
 * rows without invoking every production service. It does not translate or
 * accept removed fields and must run before the fixture crosses a governed
 * read/export boundary.
 */
export async function finalizeCurrentFixtureV1(projectId: number): Promise<void> {
  const scope = await resolveWorkspaceScope(projectId)
  for (const spec of PROJECT_TABLES) {
    const locator = spec.domainOwner?.locator
    if (!locator || locator.kind === 'workspace' || ['projects', 'worlds', 'works'].includes(spec.name)) continue
    let rows: Array<Record<string, unknown>> = []
    if (spec.owner === 'project' || spec.owner === 'transient') {
      rows = await spec.table.where('projectId').equals(projectId).toArray()
    } else if (spec.projectResolver) {
      const parentIds = await spec.projectResolver(projectId)
      const projectLink = (spec.exportRemap ?? []).find(remap => (
        PROJECT_TABLES.find(candidate => candidate.name === remap.remapVia)?.owner === 'project'
      ))
      if (parentIds.length && projectLink) {
        rows = await spec.table.where(projectLink.field).anyOf(parentIds).toArray()
      }
    }

    for (const row of rows) {
      if (!Number.isInteger(row.id)) throw new Error(`${spec.name} 当前测试夹具缺少 numeric id`)
      const patch: Record<string, unknown> = {}
      if (locator.kind === 'field') {
        if (row[locator.field] == null) {
          patch[locator.field] = locator.owner === 'world' ? scope.worldId : scope.workId
        }
      } else if (locator.kind === 'exclusive-fields') {
        if (row[locator.worldField] == null && row[locator.workField] == null) {
          if (spec.domainOwner?.defaultOwner === 'world') {
            patch[locator.worldField] = scope.worldId
            patch[locator.workField] = null
          } else {
            patch[locator.workField] = scope.workId
            patch[locator.worldField] = null
          }
        }
      } else if (locator.kind === 'exclusive-work-instance') {
        if (row[locator.workField] == null && row[locator.instanceField] == null) {
          patch[locator.workField] = scope.workId
          patch[locator.instanceField] = null
        }
      }
      if (Object.keys(patch).length) await spec.table.update(row.id as number, patch)
    }
  }
  await stampCurrentFixtureResourceUidsV1(projectId)
}
