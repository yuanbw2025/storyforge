import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { WORLD_CAPABILITY_AREAS } from '../../src/lib/registry/types'
import type { Project, Work, World, WorkspaceScope } from '../../src/lib/types'
import { createWorkspace, type CreatedWorkspace } from '../../src/lib/workspace/create-workspace'
import { generateWorldCode } from '../../src/lib/workspace/identity'
import { generateWorkCode } from '../../src/lib/memory/identity'
import { loadWorldProjection, loadWorldProjections } from '../../src/lib/world-engine/domain'
import { createWorldRevision } from '../../src/lib/world-engine/releases'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { currentWorkFixtureRecordV1 } from '../helpers/current-workspace'

async function worldEngine(name: string): Promise<CreatedWorkspace> {
  return createWorkspace({
    name,
    genres: ['other'],
    status: 'drafting',
    description: '',
    targetWordCount: 500_000,
    enableMultiWorld: true,
  }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
}

async function addAlternateScope(
  project: Project & { id: number },
  suffix: string,
  now: number,
): Promise<{ scope: WorkspaceScope; project: Project }> {
  const world: World = {
    projectId: project.id,
    identityKind: 'world-draft',
    code: generateWorldCode(now, suffix === 'B' ? 0.42 : 0.24),
    name: `备用世界-${suffix}`,
    description: '',
    currentVersion: 0,
    createdAt: now,
    updatedAt: now,
  }
  const worldId = await db.worlds.add(world) as number
  const work: Work = currentWorkFixtureRecordV1({
    projectId: project.id,
    worldId,
    code: generateWorkCode(),
    kind: 'novel',
    novelProfile: 'long',
    title: `备用作品-${suffix}`,
    description: '',
    genres: ['other'],
    status: 'drafting',
    targetWordCount: 0,
    currentWordCount: 0,
    createdAt: now,
    updatedAt: now,
  })
  const workId = await db.works.add(work) as number
  return {
    scope: { projectId: project.id, worldId, workId },
    project: { ...project, activeWorldId: worldId, activeWorkId: workId },
  }
}

describe('WORLD-2 · 世界领域投影', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    db.close()
  })

  it('世界完整度只来自当前 World/Work 的语义内容，不来自正文目标或项目简介', async () => {
    const created = await worldEngine('空世界')
    await db.works.update(created.scope.workId, { currentWordCount: 500_000 })

    const projection = await loadWorldProjection(created.project)

    expect(projection.completeness).toBe(0)
    expect(projection.readiness).toBe('empty')
    expect(projection.work.currentWordCount).toBe(500_000)
  })

  it('能力画像只投影视界语义域，绝不把产品媒资或运行状态算作世界能力', async () => {
    const created = await worldEngine('语义世界')
    const { scope } = created
    const now = Date.now()
    await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
      projectId: scope.projectId,
      worldOrigin: '潮汐从月面升起',
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'world' }))
    await db.worldRulesProfiles.add(stampNewRecord(scope, 'worldRulesProfiles', {
      projectId: scope.projectId,
      entries: { gravity: '潮汐重力' },
      customNodes: [],
      globalNote: '',
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'world' }))
    await db.characters.add(stampNewRecord(scope, 'characters', {
      projectId: scope.projectId,
      name: '守门人',
      role: 'main',
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'world' }))
    await db.storyCores.add(stampNewRecord(scope, 'storyCores', {
      projectId: scope.projectId,
      theme: '回家',
      premise: '穿越潮汐',
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'work' }))
    await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      projectId: scope.projectId,
      type: 'volume',
      title: '第一卷',
      summary: '',
      parentId: null,
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'work' }))
    await db.productRuntimeSessions.add({
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      kind: 'sandbox',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    } as any)

    const projection = await loadWorldProjection(created.project)

    expect(Object.keys(projection.domains).sort()).toEqual([...WORLD_CAPABILITY_AREAS].sort())
    expect(projection.domains.foundation.rowCount).toBe(2)
    expect(projection.domains.story.rowCount).toBe(1)
    expect(projection.domains.characters.rowCount).toBe(1)
    expect(projection.domains.outline.rowCount).toBe(1)
    expect((projection.domains as Record<string, unknown>).assets).toBeUndefined()
    expect((projection.domains as Record<string, unknown>).runtime).toBeUndefined()
    expect((projection as unknown as Record<string, unknown>).runtime).toBeUndefined()
    expect(projection.completeness).toBeGreaterThan(0)
    expect(projection.readiness).toBe('usable')
  })

  it('同项目多 World/Work 与不同项目都严格隔离，同时每张语义表只扫描一次', async () => {
    const now = Date.now()
    const first = await worldEngine('甲世界')
    const second = await worldEngine('乙世界')
    await db.worldviews.add(stampNewRecord(first.scope, 'worldviews', {
      projectId: first.scope.projectId,
      worldOrigin: '甲世界事实',
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'world' }))
    await db.worldGroups.add(stampNewRecord(second.scope, 'worldGroups', {
      projectId: second.scope.projectId,
      name: '乙主世界',
      description: '',
      type: 'primary',
      order: 0,
      createdAt: now,
      updatedAt: now,
    } as any, { owner: 'world' }))
    const alternate = await addAlternateScope(first.project as Project & { id: number }, 'B', now + 2)
    await db.worldviews.add(stampNewRecord(alternate.scope, 'worldviews', {
      projectId: alternate.scope.projectId,
      worldOrigin: '备用世界事实',
      createdAt: now + 2,
      updatedAt: now + 2,
    } as any, { owner: 'world' }))
    await db.storyCores.add(stampNewRecord(alternate.scope, 'storyCores', {
      projectId: alternate.scope.projectId,
      theme: '备用故事',
      premise: '只属于备用 Work',
      createdAt: now + 2,
      updatedAt: now + 2,
    } as any, { owner: 'work' }))
    const worldviewsScan = vi.spyOn(db.worldviews, 'toArray')

    const [firstProjection, secondProjection, alternateProjection] = await loadWorldProjections([
      first.project,
      second.project,
      alternate.project,
    ])

    expect(firstProjection.domains.foundation.tables.find(table => table.name === 'worldviews')?.rowCount).toBe(1)
    expect(firstProjection.domains.story.rowCount).toBe(0)
    expect(secondProjection.domains.foundation.rowCount).toBe(0)
    expect(secondProjection.domains['multi-world'].rowCount).toBe(1)
    expect(alternateProjection.domains.foundation.tables.find(table => table.name === 'worldviews')?.rowCount).toBe(1)
    expect(alternateProjection.domains.story.rowCount).toBe(1)
    expect(worldviewsScan).toHaveBeenCalledTimes(1)
  })

  it('技术修订、运行会话与独立作品的内部作用域都不能冒充可发布世界', async () => {
    const created = await worldEngine('只有技术记录的世界')
    await createWorldRevision({ scope: created.scope, label: '空修订' })
    await db.productRuntimeSessions.add({
      projectId: created.scope.projectId,
      worldId: created.scope.worldId,
      workId: created.scope.workId,
      kind: 'sandbox',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any)

    const projection = await loadWorldProjection(created.project)
    expect(projection.completeness).toBe(0)
    expect(projection.readiness).toBe('empty')

    const independent = await createWorkspace({
      name: '独立长篇',
      genres: ['other'],
      status: 'drafting',
      description: '',
      targetWordCount: 100_000,
      enableMultiWorld: false,
    }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    await expect(loadWorldProjection(independent.project)).rejects.toThrow('没有经作者确认的世界身份')
  })
})
