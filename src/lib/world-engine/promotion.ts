import { db } from '../db/schema'
import { generateWorldCode } from '../workspace/identity'
import { isPublicWorldCode } from './world-identity'
import { effectiveWorkKind } from '../workspace/work-kind'
import { resolveWorkspaceOwnership } from '../workspace/ownership'

async function allocatePublicWorldCode(projectId: number): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateWorldCode()
    const collision = await db.worlds.where('code').equals(candidate).first()
    if (!collision || collision.projectId === projectId) return candidate
  }
  throw new Error('[world-promotion] 无法分配唯一世界编号')
}

/**
 * Explicitly promotes a long/short novel workspace into a world-engine draft.
 * The public identity belongs only to World; Project records the workspace
 * purpose and active roots without mirroring world code or version.
 */
export async function promoteNovelWorkspaceToWorldEngine(projectId: number): Promise<void> {
  const ownership = await resolveWorkspaceOwnership(projectId)
  if (effectiveWorkKind(ownership.work) !== 'novel') {
    throw new Error('[world-promotion] 只有长篇或短篇小说可以派生为世界引擎')
  }
  if (ownership.project.workspacePurpose === 'world-engine'
    && ownership.world.identityKind === 'world-draft'
    && isPublicWorldCode(ownership.world.code)) return

  const publicCode = await allocatePublicWorldCode(projectId)
  const releases = await db.worldReleases.where('worldId').equals(ownership.world.id!).toArray()
  const currentVersion = Math.max(0, ...releases.map(release => release.version))
  const updatedAt = Date.now()

  await db.transaction('rw', db.projects, db.worlds, async () => {
    const [project, world] = await Promise.all([
      db.projects.get(projectId),
      db.worlds.get(ownership.world.id!),
    ])
    if (!project || !world || world.projectId !== projectId) {
      throw new Error('[world-promotion] 提升期间工作区作用域发生变化')
    }
    await db.worlds.update(world.id!, {
      identityKind: 'world-draft',
      code: publicCode,
      currentVersion,
      updatedAt,
    })
    await db.projects.update(projectId, {
      workspacePurpose: 'world-engine',
      updatedAt,
    })
  })
}
