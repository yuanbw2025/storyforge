import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { promoteNovelWorkspaceToWorldEngine } from '../../src/lib/world-engine/promotion'
import { useProjectStore } from '../../src/stores/project'
import { useWorldGroupStore } from '../../src/stores/world-group'

function input(name: string) {
  return {
    name,
    genre: 'other',
    genres: ['other'],
    status: 'drafting' as const,
    description: '',
    targetWordCount: 100_000,
    enableMultiWorld: false,
  }
}

describe('ARCH-01 · 独立作品与世界身份分离', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useProjectStore.setState({ projects: [], currentProjectId: null, loading: false })
  })

  afterEach(() => {
    db.close()
  })

  it('创建分步骤作品只建立内部作用域，不生成公共世界身份', async () => {
    const id = await useProjectStore.getState().createProject(input('独立长篇'), {
      purpose: 'independent-work',
      kind: 'novel',
      novelProfile: 'long',
    })

    const project = await db.projects.get(id)
    const world = await db.worlds.get(project!.activeWorldId!)
    expect(project).toMatchObject({
      workspacePurpose: 'independent-work',
      ownershipSchemaVersion: 1,
    })
    expect(project).not.toHaveProperty('worldCode')
    expect(project).not.toHaveProperty('worldVersion')
    expect(world).toMatchObject({ identityKind: 'workspace-scope', currentVersion: 0 })
    expect(world?.code).toMatch(/^S-/)
    expect(await db.works.where('projectId').equals(id).count()).toBe(1)
  })

  it('只有显式创建世界引擎才分配公共编号并进入世界身份', async () => {
    const id = await useProjectStore.getState().createProject(input('显式世界'), {
      purpose: 'world-engine',
      kind: 'novel',
      novelProfile: 'long',
    })
    const project = await db.projects.get(id)
    const world = await db.worlds.get(project!.activeWorldId!)
    expect(project).toMatchObject({
      workspacePurpose: 'world-engine',
    })
    expect(project).not.toHaveProperty('worldCode')
    expect(project).not.toHaveProperty('worldVersion')
    expect(world).toMatchObject({
      identityKind: 'world-draft',
      currentVersion: 0,
    })
    expect(world?.code).toMatch(/^W-[A-Z0-9]+-[A-Z0-9]+$/)
  })

  it('缺少作用域根的工作区只补内部 owner 根并默认保留独立作品', async () => {
    const now = Date.now()
    const id = await db.projects.add({ ...input('旧分步骤项目'), createdAt: now, updatedAt: now } as any) as number

    const loaded = await useProjectStore.getState().loadProject(id)
    const persisted = await db.projects.get(id)
    const world = await db.worlds.get(persisted!.activeWorldId!)
    expect(loaded).toMatchObject({
      workspacePurpose: 'independent-work',
      enableMultiWorld: false,
    })
    expect(persisted).not.toHaveProperty('worldCode')
    expect(world?.identityKind).toBe('workspace-scope')
  })

  it('并发读取旧项目复用同一内部作用域且不会生成两个根', async () => {
    const now = Date.now()
    const id = await db.projects.add({ ...input('并发读取旧项目'), createdAt: now, updatedAt: now } as any) as number
    const [first, second] = await Promise.all([
      useProjectStore.getState().loadProject(id),
      useProjectStore.getState().loadProject(id),
    ])
    expect(first?.activeWorldId).toBe(second?.activeWorldId)
    expect(first).not.toHaveProperty('worldCode')
    expect(await db.worlds.where('projectId').equals(id).count()).toBe(1)
    expect(await db.works.where('projectId').equals(id).count()).toBe(1)
  })

  it('作者显式派生时只提升 World 身份，不在 Project 复制编号和版本', async () => {
    const id = await useProjectStore.getState().createProject(input('待派生小说'), {
      purpose: 'independent-work', kind: 'novel', novelProfile: 'long',
    })
    await promoteNovelWorkspaceToWorldEngine(id)
    const project = await db.projects.get(id)
    const world = await db.worlds.get(project!.activeWorldId!)
    expect(project).toMatchObject({ workspacePurpose: 'world-engine' })
    expect(project).not.toHaveProperty('worldCode')
    expect(project).not.toHaveProperty('worldVersion')
    expect(world).toMatchObject({ identityKind: 'world-draft', currentVersion: 0 })
    expect(world?.code).toMatch(/^W-/)
  })

  it('剧本和漫画不能直接提升成世界', async () => {
    const id = await useProjectStore.getState().createProject(input('独立剧本'), {
      purpose: 'independent-work',
      kind: 'screenplay',
    })
    await expect(promoteNovelWorkspaceToWorldEngine(id)).rejects.toThrow('只有长篇或短篇小说')
  })

  it('并发打开多世界结构时只创建一个主世界组', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({ ...input('并发世界项目'), enableMultiWorld: true, createdAt: now, updatedAt: now } as any) as number
    const [firstId, secondId] = await Promise.all([
      useWorldGroupStore.getState().ensurePrimaryGroup(projectId),
      useWorldGroupStore.getState().ensurePrimaryGroup(projectId),
    ])
    const primaryGroups = await db.worldGroups.where('projectId').equals(projectId)
      .filter(group => group.type === 'primary').toArray()
    expect(secondId).toBe(firstId)
    expect(primaryGroups).toHaveLength(1)
  })
})
