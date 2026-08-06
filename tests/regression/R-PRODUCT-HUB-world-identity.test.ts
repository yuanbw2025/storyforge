import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useProjectStore } from '../../src/stores/project'
import { useWorldGroupStore } from '../../src/stores/world-group'

describe('PRODUCT-HUB · 世界引擎身份兼容', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useProjectStore.setState({ projects: [], currentProjectId: null, loading: false })
  })

  afterEach(() => {
    db.close()
  })

  it('创建分步骤作品时同时分配持久化世界编号和首版本', async () => {
    const id = await useProjectStore.getState().createProject({
      name: '产品综合页作品',
      genre: 'other',
      genres: ['other'],
      status: 'drafting',
      description: '',
      targetWordCount: 100000,
      enableMultiWorld: false,
    })

    const project = await db.projects.get(id)
    expect(project?.worldCode).toMatch(/^W-[A-Z0-9]+-[A-Z0-9]+$/)
    expect(project?.worldVersion).toBe(1)
    expect(project?.ownershipSchemaVersion).toBe(1)
    expect(await db.worlds.where('projectId').equals(id).count()).toBe(1)
    expect(await db.works.where('projectId').equals(id).count()).toBe(1)
    expect(project?.activeWorkId).toBeDefined()
    const work = await db.works.get(project!.activeWorkId!)
    expect(work?.worldId).toBe(project?.activeWorldId)
  })

  it('读取旧项目时补齐世界身份但不改变旧的多世界开关', async () => {
    const now = Date.now()
    const id = await db.projects.add({
      name: '旧分步骤项目',
      genre: 'other',
      genres: ['other'],
      status: 'drafting',
      description: '',
      targetWordCount: 100000,
      enableMultiWorld: false,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const loaded = await useProjectStore.getState().loadProject(id)
    const persisted = await db.projects.get(id)
    expect(loaded?.worldCode).toMatch(/^W-[A-Z0-9]+-[A-Z0-9]+$/)
    expect(persisted?.worldCode).toBe(loaded?.worldCode)
    expect(persisted?.worldVersion).toBe(1)
    expect(persisted?.ownershipSchemaVersion).toBe(1)
    expect(persisted?.activeWorldId).toBeDefined()
    expect(persisted?.activeWorkId).toBeDefined()
    expect(loaded?.enableMultiWorld).toBe(false)
  })

  it('并发读取旧项目时复用同一个持久化世界编号', async () => {
    const now = Date.now()
    const id = await db.projects.add({
      name: '并发读取旧项目',
      genre: 'other',
      genres: ['other'],
      status: 'drafting',
      description: '',
      targetWordCount: 100000,
      enableMultiWorld: false,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const [first, second] = await Promise.all([
      useProjectStore.getState().loadProject(id),
      useProjectStore.getState().loadProject(id),
    ])
    expect(first?.worldCode).toBe(second?.worldCode)
    expect((await db.projects.get(id))?.worldCode).toBe(first?.worldCode)
  })

  it('把原型阶段仅在本机唯一的旧编号升级为可分享编号', async () => {
    const now = Date.now()
    const id = await db.projects.add({
      name: '旧编号项目',
      genre: 'other',
      genres: ['other'],
      status: 'drafting',
      description: '',
      targetWordCount: 100000,
      enableMultiWorld: false,
      worldCode: 'W-00001',
      worldVersion: 1,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const loaded = await useProjectStore.getState().loadProject(id)
    expect(loaded?.worldCode).toMatch(/^W-[A-Z0-9]+-[A-Z0-9]+$/)
    expect((await db.projects.get(id))?.worldCode).toBe(loaded?.worldCode)
  })

  it('并发打开世界引擎时只创建一个主世界', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '并发世界项目',
      genre: 'other',
      genres: ['other'],
      status: 'drafting',
      description: '',
      targetWordCount: 100000,
      enableMultiWorld: true,
      createdAt: now,
      updatedAt: now,
    } as any) as number

    const [firstId, secondId] = await Promise.all([
      useWorldGroupStore.getState().ensurePrimaryGroup(projectId),
      useWorldGroupStore.getState().ensurePrimaryGroup(projectId),
    ])
    const primaryGroups = await db.worldGroups
      .where('projectId').equals(projectId)
      .filter(group => group.type === 'primary')
      .toArray()

    expect(secondId).toBe(firstId)
    expect(primaryGroups).toHaveLength(1)
  })
})
