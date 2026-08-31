import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  confirmWorkspacePurpose,
  inspectWorkspaceIdentity,
} from '../../src/lib/world-engine/identity-classification'
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
      workspacePurposeDecision: 'explicit',
      ownershipSchemaVersion: 1,
    })
    expect(project?.worldCode).toBeUndefined()
    expect(project?.worldVersion).toBeUndefined()
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
      workspacePurposeDecision: 'explicit',
      worldVersion: 0,
    })
    expect(project?.worldCode).toMatch(/^W-[A-Z0-9]+-[A-Z0-9]+$/)
    expect(world).toMatchObject({
      identityKind: 'world-draft',
      code: project?.worldCode,
      currentVersion: 0,
    })
  })

  it('读取旧项目只补 owner 根，默认保留独立作品并生成只读分类报告', async () => {
    const now = Date.now()
    const id = await db.projects.add({ ...input('旧分步骤项目'), createdAt: now, updatedAt: now } as any) as number

    const loaded = await useProjectStore.getState().loadProject(id)
    const persisted = await db.projects.get(id)
    const world = await db.worlds.get(persisted!.activeWorldId!)
    const report = await inspectWorkspaceIdentity(id)
    expect(loaded).toMatchObject({
      workspacePurpose: 'independent-work',
      workspacePurposeDecision: 'legacy-review-required',
      enableMultiWorld: false,
    })
    expect(persisted?.worldCode).toBeUndefined()
    expect(world?.identityKind).toBe('workspace-scope')
    expect(report).toMatchObject({
      readOnly: true,
      currentPurpose: 'independent-work',
      decision: 'legacy-review-required',
      allowedConfirmations: ['independent-work', 'world-engine'],
    })
  })

  it('并发读取旧项目复用同一内部作用域且不会生成两个根', async () => {
    const now = Date.now()
    const id = await db.projects.add({ ...input('并发读取旧项目'), createdAt: now, updatedAt: now } as any) as number
    const [first, second] = await Promise.all([
      useProjectStore.getState().loadProject(id),
      useProjectStore.getState().loadProject(id),
    ])
    expect(first?.activeWorldId).toBe(second?.activeWorldId)
    expect(first?.worldCode).toBeUndefined()
    expect(await db.worlds.where('projectId').equals(id).count()).toBe(1)
    expect(await db.works.where('projectId').equals(id).count()).toBe(1)
  })

  it('旧自动编号不会在读取时升级；作者可显式确认成世界', async () => {
    const now = Date.now()
    const id = await db.projects.add({
      ...input('旧编号项目'), worldCode: 'W-00001', worldVersion: 1, createdAt: now, updatedAt: now,
    } as any) as number
    await useProjectStore.getState().loadProject(id)
    expect((await db.projects.get(id))?.workspacePurposeDecision).toBe('legacy-review-required')

    await confirmWorkspacePurpose(id, 'world-engine')
    const project = await db.projects.get(id)
    const world = await db.worlds.get(project!.activeWorldId!)
    expect(project).toMatchObject({
      workspacePurpose: 'world-engine',
      workspacePurposeDecision: 'legacy-confirmed',
      worldVersion: 0,
    })
    expect(project?.worldCode).toMatch(/^W-[A-Z0-9]+-[A-Z0-9]+$/)
    expect(project?.worldCode).not.toBe('W-00001')
    expect(world).toMatchObject({ identityKind: 'world-draft', code: project?.worldCode })
  })

  it('剧本和漫画分类报告不允许直接确认成世界', async () => {
    const id = await useProjectStore.getState().createProject(input('独立剧本'), {
      purpose: 'independent-work',
      kind: 'screenplay',
    })
    expect((await inspectWorkspaceIdentity(id)).allowedConfirmations).toEqual(['independent-work'])
    await expect(confirmWorkspacePurpose(id, 'world-engine')).rejects.toThrow('剧本和漫画保持独立')
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
