import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import {
  ensureWorkspaceOwnership,
  preflightWorkspaceOwnership,
  rollbackWorkspaceOwnership,
  WORKSPACE_OWNERSHIP_CONTRACT_VERSION,
  WorkspaceOwnershipError,
} from '../../src/lib/world-engine/ownership'
import { seedFullProject } from '../helpers/seed-full-project'

async function createLegacyProject(name = '旧分步骤项目') {
  const now = Date.now()
  const projectId = await db.projects.add({
    name,
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '原项目说明',
    targetWordCount: 120000,
    currentWordCount: 321,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const worldviewId = await db.worldviews.add({
    projectId,
    worldOrigin: '旧世界原文',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const outlineId = await db.outlineNodes.add({
    projectId,
    parentId: null,
    type: 'chapter',
    title: '旧章纲',
    summary: '保留摘要',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId,
    outlineNodeId: outlineId,
    title: '旧正文',
    content: '<p>正文必须一字不改</p>',
    wordCount: 9,
    status: 'draft',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return { projectId, worldviewId, outlineId, chapterId }
}

async function stripC1Roots(projectId: number) {
  // 模拟真实的 pre-C1 项目：正式游戏发布及其 World/Work 内容不可能早于根存在。
  // 改编、剧本、漫画和产品媒资同样晚于 C1，必须连同其根一起移除；把它们只去掉
  // owner 字段会制造历史上不可能存在的悬空 sourceWorkId，反而掩盖必填引用守卫。
  await db.gameQualityGateReceipts.where('projectId').equals(projectId).delete()
  await db.gameBuildArtifacts.where('projectId').equals(projectId).delete()
  await db.gameBuilds.where('projectId').equals(projectId).delete()
  await db.gameProductionCommands.where('projectId').equals(projectId).delete()
  await db.gameProductionBriefs.where('projectId').equals(projectId).delete()
  await db.gameProductions.where('projectId').equals(projectId).delete()
  await db.productMediaBlobs.where('projectId').equals(projectId).delete()
  await db.productMediaAssets.where('projectId').equals(projectId).delete()
  await db.comicMediaAssets.where('projectId').equals(projectId).delete()
  await db.mediaBlobObjects.where('projectId').equals(projectId).delete()
  await db.comicPanels.where('projectId').equals(projectId).delete()
  await db.comicPages.where('projectId').equals(projectId).delete()
  await db.comicVisualSubjects.where('projectId').equals(projectId).delete()
  await db.screenplayScenes.where('projectId').equals(projectId).delete()
  await db.adaptationSourceUnits.where('projectId').equals(projectId).delete()
  await db.adaptationProjects.where('projectId').equals(projectId).delete()
  await db.gameReleases.where('projectId').equals(projectId).delete()
  await db.worldDerivations.where('projectId').equals(projectId).delete()
  await db.worldReleases.where('projectId').equals(projectId).delete()
  await db.worldRevisions.where('projectId').equals(projectId).delete()
  await db.ttrpgRuntimeAssetRequests.where('projectId').equals(projectId).delete()
  await db.ttrpgSessionParticipants.where('projectId').equals(projectId).delete()
  await db.gameRulePacks.where('projectId').equals(projectId).delete()
  for (const spec of PROJECT_TABLES) {
    const locator = spec.domainOwner?.locator
    const isLegacyStamped = locator?.kind !== 'parent'
      && (spec.domainOwner?.legacyDefault === 'world' || spec.domainOwner?.legacyDefault === 'work')
    if (!isLegacyStamped || ['worlds', 'works', 'workCharacterBindings'].includes(spec.name)) continue
    let rows: any[] = []
    if (spec.owner === 'project' || spec.owner === 'transient') {
      rows = await spec.table.where('projectId').equals(projectId).toArray()
    } else if (spec.projectResolver) {
      const parentIds = await spec.projectResolver(projectId)
      const link = (spec.exportRemap ?? []).find(remap => (
        PROJECT_TABLES.find(candidate => candidate.name === remap.remapVia)?.owner === 'project'
      ))
      if (parentIds.length && link) rows = await spec.table.where(link.field).anyOf(parentIds).toArray()
    }
    for (const row of rows) {
      delete row.worldId
      delete row.workId
      await spec.table.put(row)
    }
  }
  await db.simulationSessions.where('projectId').equals(projectId).modify(session => {
    delete session.worldId
    delete session.workId
    delete session.worldReleaseId
    delete session.gameReleaseId
    delete session.narrativeModuleId
    delete session.draftSnapshotHash
  })
  await db.workCharacterBindings.where('projectId').equals(projectId).delete()
  await db.works.where('projectId').equals(projectId).delete()
  await db.worlds.where('projectId').equals(projectId).delete()
  await db.projects.where(':id').equals(projectId).modify(project => {
    delete project.activeWorldId
    delete project.activeWorkId
    delete project.ownershipSchemaVersion
    delete project.worldCode
    delete project.worldVersion
    delete project.workspacePurpose
    delete project.workspacePurposeDecision
  })
}

describe('WORLD-2C C2 · lazy workspace ownership migration', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  it('只读预检统计注册表派生表并生成 SHA-256，不创建根或修改业务记录', async () => {
    const { projectId, worldviewId, chapterId } = await createLegacyProject()

    const preflight = await preflightWorkspaceOwnership(projectId)

    expect(preflight).toMatchObject({
      projectId,
      contractVersion: WORKSPACE_OWNERSHIP_CONTRACT_VERSION,
      status: 'migration-required',
      willCreateDefaultWorld: true,
      willCreateDefaultWork: true,
    })
    expect(preflight.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(preflight.sourceCounts.projects).toBe(1)
    expect(preflight.sourceCounts.worldviews).toBe(1)
    expect(preflight.sourceCounts.chapters).toBe(1)
    expect(Object.keys(preflight.sourceCounts)).toHaveLength(
      PROJECT_TABLES.filter(spec => spec.owner !== 'global' && spec.name !== 'ownershipMigrations').length,
    )
    expect(await db.worlds.where('projectId').equals(projectId).count()).toBe(0)
    expect(await db.works.where('projectId').equals(projectId).count()).toBe(0)
    expect(await db.ownershipMigrations.where('projectId').equals(projectId).count()).toBe(0)
    expect(await db.worldviews.get(worldviewId)).not.toHaveProperty('worldId')
    expect(await db.chapters.get(chapterId)).not.toHaveProperty('workId')
  })

  it('完整旧项目迁移为一个默认 World/Work，保留业务主键、正文和引用', async () => {
    const seeded = await seedFullProject()
    const chapterBefore = await db.chapters.get(seeded.chapter)
    await stripC1Roots(seeded.projectId)
    const exportableCountsBefore = Object.fromEntries(await Promise.all(
      PROJECT_TABLES.filter(spec => spec.exportable && !['projects', 'worlds', 'works', 'workCharacterBindings'].includes(spec.name))
        .map(async spec => [spec.name, await spec.table.count()] as const),
    ))

    const result = await ensureWorkspaceOwnership(seeded.projectId)
    const project = await db.projects.get(seeded.projectId)
    const receipt = await db.ownershipMigrations.where('projectId').equals(seeded.projectId).first()

    expect(result.migrated).toBe(true)
    expect(result.scope).toEqual({
      projectId: seeded.projectId,
      worldId: result.world.id,
      workId: result.work.id,
    })
    expect(result.world).toMatchObject({
      name: '全量作品',
      description: '全表往返',
      currentVersion: 0,
      identityKind: 'workspace-scope',
    })
    expect(result.work).toMatchObject({
      worldId: result.world.id,
      title: '全量作品',
      genres: ['fantasy'],
      targetWordCount: 100000,
      activeCharacterDrivenPlanId: seeded.characterDrivenPlan,
    })
    expect(project).toMatchObject({
      activeWorldId: result.world.id,
      activeWorkId: result.work.id,
      ownershipSchemaVersion: WORKSPACE_OWNERSHIP_CONTRACT_VERSION,
    })
    expect(project?.worldCode).toBeUndefined()
    expect(project?.worldVersion).toBeUndefined()
    expect(await db.worldviews.get(1)).toMatchObject({ worldId: result.world.id })
    expect(await db.characters.get(seeded.char1)).toMatchObject({ worldId: result.world.id })
    expect(await db.storyCores.get(1)).toMatchObject({ workId: result.work.id })
    expect(await db.storyCores.get(1)).not.toHaveProperty('worldId')
    expect(await db.chapters.get(seeded.chapter)).toMatchObject({
      id: seeded.chapter,
      workId: result.work.id,
      content: chapterBefore?.content,
      outlineNodeId: chapterBefore?.outlineNodeId,
    })
    expect(await db.simulationSessions.get(seeded.simulationParent)).not.toHaveProperty('workId')
    expect(receipt).toMatchObject({
      status: 'ready',
      defaultWorldId: result.world.id,
      defaultWorkId: result.work.id,
      createdDefaultWorld: true,
      createdDefaultWork: true,
    })
    expect(receipt?.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt?.readyFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(receipt?.ownerBeforeImages.chapters?.[0]).toMatchObject({
      id: seeded.chapter,
      hadWorldId: false,
      hadWorkId: false,
    })
    for (const [tableName, beforeCount] of Object.entries(exportableCountsBefore)) {
      expect(await PROJECT_TABLES.find(spec => spec.name === tableName)!.table.count(), tableName).toBe(beforeCount)
    }
  })

  it('并发首次进入只创建一组默认根，后续解析保持零写入', async () => {
    const { projectId } = await createLegacyProject('并发旧项目')

    const [first, second] = await Promise.all([
      ensureWorkspaceOwnership(projectId),
      ensureWorkspaceOwnership(projectId),
    ])
    const receiptBefore = await db.ownershipMigrations.where('projectId').equals(projectId).first()
    const third = await ensureWorkspaceOwnership(projectId)
    const receiptAfter = await db.ownershipMigrations.where('projectId').equals(projectId).first()

    expect(first.scope).toEqual(second.scope)
    expect(third.scope).toEqual(first.scope)
    expect(third.migrated).toBe(false)
    expect(await db.worlds.where('projectId').equals(projectId).count()).toBe(1)
    expect(await db.works.where('projectId').equals(projectId).count()).toBe(1)
    expect(await db.ownershipMigrations.where('projectId').equals(projectId).count()).toBe(1)
    expect(receiptAfter).toEqual(receiptBefore)
  })

  it('采纳 active 指针明确的 C1 根，以 World 身份为权威且回滚不删除既有根', async () => {
    const { projectId, worldviewId } = await createLegacyProject('已有 C1 根项目')
    const now = Date.now()
    const worldId = await db.worlds.add({
      projectId,
      code: 'world-c1-authoritative',
      name: '既有世界根',
      description: '保留世界根',
      currentVersion: 7,
      createdAt: now,
      updatedAt: now,
    }) as number
    const workId = await db.works.add({
      projectId,
      worldId,
      title: '既有作品根',
      description: '保留作品根',
      genres: ['fantasy'],
      status: 'drafting',
      targetWordCount: 120000,
      createdAt: now,
      updatedAt: now,
    }) as number
    await db.projects.update(projectId, {
      activeWorldId: worldId,
      activeWorkId: workId,
      worldCode: 'legacy-project-mirror',
      worldVersion: 1,
    })

    const migrated = await ensureWorkspaceOwnership(projectId)
    const receipt = await db.ownershipMigrations.where('projectId').equals(projectId).first()
    expect(migrated.scope).toEqual({ projectId, worldId, workId })
    expect(migrated.project).toMatchObject({ ownershipSchemaVersion: 1 })
    expect(migrated.project.worldCode).toBeUndefined()
    expect(migrated.project.worldVersion).toBeUndefined()
    expect(migrated.world).toMatchObject({
      code: 'world-c1-authoritative',
      currentVersion: 7,
      identityKind: 'workspace-scope',
    })
    expect(await db.worldviews.get(worldviewId)).toMatchObject({ worldId })
    expect(receipt).toMatchObject({
      status: 'ready',
      createdDefaultWorld: false,
      createdDefaultWork: false,
    })

    await rollbackWorkspaceOwnership(projectId)
    expect(await db.worlds.get(worldId)).toBeDefined()
    expect(await db.works.get(workId)).toBeDefined()
    expect(await db.projects.get(projectId)).toMatchObject({
      activeWorldId: worldId,
      activeWorkId: workId,
      worldCode: 'legacy-project-mirror',
      worldVersion: 1,
    })
    expect(await db.projects.get(projectId)).not.toHaveProperty('ownershipSchemaVersion')
    expect(await db.worldviews.get(worldviewId)).not.toHaveProperty('worldId')
  })

  it('任一 owner 写入失败时业务表、根和 Project 指针整体回滚，并可按同一指纹重试', async () => {
    const { projectId, worldviewId, chapterId } = await createLegacyProject('失败回滚项目')
    vi.spyOn(db.chapters, 'update').mockRejectedValueOnce(new Error('fixture owner write failed'))

    await expect(ensureWorkspaceOwnership(projectId)).rejects.toThrow('fixture owner write failed')

    expect(await db.worlds.where('projectId').equals(projectId).count()).toBe(0)
    expect(await db.works.where('projectId').equals(projectId).count()).toBe(0)
    expect(await db.worldviews.get(worldviewId)).not.toHaveProperty('worldId')
    expect(await db.chapters.get(chapterId)).not.toHaveProperty('workId')
    expect(await db.projects.get(projectId)).not.toHaveProperty('ownershipSchemaVersion')
    expect(await db.ownershipMigrations.where('projectId').equals(projectId).first()).toMatchObject({
      status: 'failed',
      errorCode: 'OWNERSHIP_MIGRATION_FAILED',
    })

    vi.restoreAllMocks()
    const retried = await ensureWorkspaceOwnership(projectId)
    expect(retried.migrated).toBe(true)
    expect(await db.ownershipMigrations.where('projectId').equals(projectId).first()).toMatchObject({ status: 'ready' })
  })

  it('未知根、悬空 active 指针和预存 owner 均 fail closed，且不写迁移凭证', async () => {
    const { projectId, worldviewId } = await createLegacyProject('冲突旧项目')
    await db.worldviews.update(worldviewId, { worldId: 999 } as any)

    await expect(ensureWorkspaceOwnership(projectId)).rejects.toMatchObject<WorkspaceOwnershipError>({
      code: 'OWNERSHIP_UNKNOWN_OWNER',
    })
    expect(await db.worlds.where('projectId').equals(projectId).count()).toBe(0)
    expect(await db.ownershipMigrations.where('projectId').equals(projectId).count()).toBe(0)

    await db.worldviews.update(worldviewId, { worldId: undefined } as any)
    await db.projects.update(projectId, { activeWorldId: 123, activeWorkId: 456 })
    await expect(ensureWorkspaceOwnership(projectId)).rejects.toMatchObject<WorkspaceOwnershipError>({
      code: 'OWNERSHIP_DANGLING_ACTIVE_SCOPE',
    })
    expect(await db.ownershipMigrations.where('projectId').equals(projectId).count()).toBe(0)
  })

  it('before-image 可原子回滚；迁移后新增 Work 时自动回滚必须拒绝', async () => {
    const { projectId, worldviewId, chapterId } = await createLegacyProject('可回滚项目')
    const migrated = await ensureWorkspaceOwnership(projectId)

    await rollbackWorkspaceOwnership(projectId)

    expect(await db.worlds.where('projectId').equals(projectId).count()).toBe(0)
    expect(await db.works.where('projectId').equals(projectId).count()).toBe(0)
    expect(await db.worldviews.get(worldviewId)).not.toHaveProperty('worldId')
    expect(await db.chapters.get(chapterId)).not.toHaveProperty('workId')
    expect(await db.projects.get(projectId)).not.toHaveProperty('ownershipSchemaVersion')
    expect(await db.projects.get(projectId)).not.toHaveProperty('worldCode')
    expect(await db.ownershipMigrations.where('projectId').equals(projectId).first()).toMatchObject({
      status: 'rolled-back',
    })

    const remigrated = await ensureWorkspaceOwnership(projectId)
    await db.works.add({
      projectId,
      worldId: remigrated.scope.worldId,
      title: '迁移后新增作品',
      description: '',
      genres: [],
      status: 'drafting',
      targetWordCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await expect(rollbackWorkspaceOwnership(projectId)).rejects.toMatchObject<WorkspaceOwnershipError>({
      code: 'OWNERSHIP_ROLLBACK_DIVERGED',
    })
    expect(await db.worlds.get(remigrated.scope.worldId)).toBeDefined()
    expect(await db.works.where('projectId').equals(projectId).count()).toBe(2)
    expect(migrated.scope.worldId).not.toBe(remigrated.scope.worldId)
  })
})
