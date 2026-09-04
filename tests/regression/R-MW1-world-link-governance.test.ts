import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { executeContextGatewayV1 } from '../../src/lib/context-gateway/execution'
import { executeWorldLinkContextV1 } from '../../src/lib/agent/world-link-context'
import { CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { useWorldGroupStore } from '../../src/stores/world-group'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { ContextResourceDescriptorV1, WorkspaceScope } from '../../src/lib/types'
import {
  addCurrentWorldFixtureV1,
  addCurrentWorkFixtureV1,
  seedCurrentWorkspace,
} from '../helpers/current-workspace'

const now = 1_787_600_000_000

async function seed() {
  const root = await seedCurrentWorkspace('诸界同名审计', { enableMultiWorld: true })
  const projectId = root.scope.projectId
  const worldA = root.scope.worldId
  const workA = root.scope.workId
  await db.worlds.update(worldA, { name: '世界根 A', updatedAt: now })
  const secondWorkA = await addCurrentWorkFixtureV1({
    projectId,
    worldId: worldA,
    create: { title: '作品 A2', targetWordCount: 500_000 },
    now,
  })
  const worldBRoot = await addCurrentWorldFixtureV1({ projectId, name: '世界根 B', now: now + 1 })
  const workBRoot = await addCurrentWorkFixtureV1({
    projectId,
    worldId: worldBRoot.id!,
    create: { title: '作品 B', targetWordCount: 500_000 },
    now,
  })
  const workA2 = secondWorkA.id!
  const worldB = worldBRoot.id!
  const workB = workBRoot.id!
  const scopeA = { projectId, worldId: worldA, workId: workA } satisfies WorkspaceScope
  const scopeA2 = { projectId, worldId: worldA, workId: workA2 } satisfies WorkspaceScope
  const scopeB = { projectId, worldId: worldB, workId: workB } satisfies WorkspaceScope
  await db.projects.update(projectId, { activeWorldId: worldA, activeWorkId: workA })
  const addGroup = (scope: WorkspaceScope, row: Record<string, unknown>) => db.worldGroups.add(stampNewRecord(scope, 'worldGroups', {
    projectId, description: '', icon: '🌐', order: 0, createdAt: now, updatedAt: now, ...row,
  }, { owner: 'world' })) as Promise<number>
  const groupA = await addGroup(scopeA, {
    name: '镜海', type: 'primary', exitCondition: '敲响潮钟', powerRestriction: '潮力不得超过三阶',
    takeawayRules: '只能带走刻有潮纹的物品',
  })
  const groupA2 = await addGroup(scopeA, {
    name: '盐庭', type: 'parallel', order: 1, entryCondition: '交出一段真名记忆',
    exitCondition: '在无月夜潜入海底', powerRestriction: '火焰能力失效',
    takeawayRules: '记忆可带出，实体物品不可带出',
  })
  const groupA3 = await addGroup(scopeA, {
    name: '灰钟界', type: 'instance', order: 2, entryCondition: '持有盐庭通行证',
  })
  const groupB = await addGroup(scopeB, { name: '镜海', type: 'primary' })
  const linkA = await db.worldGroupLinks.add(stampNewRecord(scopeA, 'worldGroupLinks', {
    projectId, fromGroupId: groupA, toGroupId: groupA2, linkType: 'portal', name: '退潮镜门',
    description: '第三次退潮时显形', bidirectional: true, createdAt: now, updatedAt: now,
  }, { owner: 'world' })) as number
  await db.worldGroupLinks.add(stampNewRecord(scopeA, 'worldGroupLinks', {
    projectId, fromGroupId: groupA2, toGroupId: groupA3, linkType: 'ascension', name: '灰钟梯',
    description: '第二跳秘密，不得在镜海任务展开', bidirectional: false, createdAt: now, updatedAt: now,
  }, { owner: 'world' }))

  await db.characters.add(stampNewRecord(scopeA, 'characters', {
    projectId, homeWorldGroupId: groupA, isCrossWorld: false, name: '守门人',
    roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
    shortDescription: 'A 世界角色', createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as any)
  await db.characters.add(stampNewRecord(scopeB, 'characters', {
    projectId, homeWorldGroupId: groupB, isCrossWorld: false, name: '守门人',
    roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
    shortDescription: 'B 世界角色', createdAt: now, updatedAt: now,
  }, { owner: 'world' }) as any)
  await db.storyArcs.add(stampNewRecord(scopeA2, 'storyArcs', {
    projectId, name: '另一作品秘密线', type: 'main', description: '不应泄漏到作品 A', stages: '[]',
    createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as any)

  return { projectId, scopeA, scopeA2, scopeB, groupA, groupA2, groupB, linkA }
}

async function all(scope: WorkspaceScope, worldGroupId: number): Promise<ContextResourceDescriptorV1[]> {
  const items: ContextResourceDescriptorV1[] = []
  let cursor: string | undefined
  do {
    const page = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: { ...scope, worldGroupId }, cursor, limit: 50 })
    items.push(...page.items)
    cursor = page.nextCursor
  } while (cursor)
  return items
}

describe.sequential('R-MW1 · 多世界通道、身份和作用域治理', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useWorldGroupStore.setState({ groups: [], links: [], activeGroupId: null, loading: false })
  })
  afterEach(() => db.close())

  it('完整资源化进出/力量/带出规则，普通任务看不见通道，通道任务只展开目标的一跳', async () => {
    const fixture = await seed()
    expect(FIELD_BY_TARGET.get('worldGroups')?.map(field => field.field)).toEqual(expect.arrayContaining([
      'entryCondition', 'exitCondition', 'powerRestriction', 'takeawayRules',
    ]))
    const normal = await executeContextGatewayV1({
      skill: getAgentSkillV1('world-origin.worldview-field', 'world-origin'),
      scope: fixture.scopeA,
      worldGroupId: fixture.groupA,
      query: '生成当前世界的种族设定',
      additionalReadsEnabled: false,
    })
    expect(normal.session.policy.allowedResourceKinds).not.toContain('world-link')
    expect(normal.contextPacket.content).not.toContain('退潮镜门')

    const channel = await executeWorldLinkContextV1({
      scope: fixture.scopeA,
      targetWorldGroupId: fixture.groupA,
      worldGroupLinkId: fixture.linkA,
      query: '规划主角经退潮镜门进入盐庭的过程',
    })
    expect(channel.contextPacket.content).toContain('方向：镜海 → 盐庭')
    expect(channel.contextPacket.content).toContain('双向：是')
    expect(channel.contextPacket.content).toContain('源世界离开条件：敲响潮钟')
    expect(channel.contextPacket.content).toContain('目标世界进入条件：交出一段真名记忆')
    expect(channel.contextPacket.content).toContain('目标世界力量限制：火焰能力失效')
    expect(channel.contextPacket.content).toContain('目标世界带出规则：记忆可带出，实体物品不可带出')
    expect(channel.contextPacket.content).not.toContain('灰钟梯')
    expect(channel.contextPacket.content).not.toContain('第二跳秘密')
  })

  it('跨 World/Work 目录零泄漏，同名实体带世界身份且跨世界只由显式布尔字段决定', async () => {
    const fixture = await seed()
    const descriptors = await all(fixture.scopeA, fixture.groupA)
    const localCharacter = descriptors.find(item => item.kind === 'character' && !item.resourceKey.includes(':field:'))
    expect(localCharacter?.title).toContain('守门人 · 世界：镜海')
    expect(descriptors.find(item => item.resourceKey.endsWith(':field:shortDescription'))?.shortSummary)
      .toContain('A 世界角色')
    expect(descriptors.some(item => item.shortSummary.includes('B 世界角色'))).toBe(false)
    expect(descriptors.some(item => item.title.includes('另一作品秘密线'))).toBe(false)
  })

  it('通道可创建后完整修改，端点越过 World 时写入 fail-closed', async () => {
    const fixture = await seed()
    await useWorldGroupStore.getState().loadAll(fixture.scopeA)
    const created = await useWorldGroupStore.getState().createLink({
      projectId: fixture.projectId,
      fromGroupId: fixture.groupA2,
      toGroupId: fixture.groupA,
      linkType: 'return',
      name: '返潮门',
      description: '只在黎明开启',
      bidirectional: false,
    })
    await useWorldGroupStore.getState().updateLink(created, {
      name: '返潮双门', description: '黎明与黄昏各开启一次', bidirectional: true,
    })
    expect(await db.worldGroupLinks.get(created)).toMatchObject({
      name: '返潮双门', description: '黎明与黄昏各开启一次', bidirectional: true,
    })
    await expect(useWorldGroupStore.getState().updateLink(created, {
      toGroupId: fixture.groupB,
    })).rejects.toThrow('端点不属于当前 World')
    expect((await db.worldGroupLinks.get(created))?.toGroupId).toBe(fixture.groupA)
  })
})
