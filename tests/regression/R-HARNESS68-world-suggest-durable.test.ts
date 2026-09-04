import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { ADOPTION_BY_TARGET } from '../../src/lib/registry/adoption-schema'
import { parseWorldSuggestOutputStrictV1 } from '../../src/lib/ai/world-group-ai'
import * as worldGroupAI from '../../src/lib/ai/world-group-ai'
import {
  abandonWorldSuggestRunV1,
  adoptWorldSuggestCandidateV1,
  generateWorldSuggestCandidateV1,
  readPendingWorldSuggestCandidateV1,
  readRecoverableWorldSuggestRunV1,
  rejectWorldSuggestCandidateV1,
  type WorldSuggestBoundaryV1,
} from '../../src/lib/agent/run/world-suggest-durable'
import { currentWorkFixtureRecordV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'

async function seed(suffix = '') {
  const now = Date.now()
  const created = await seedCurrentWorkspace(`诸界航路${suffix}`, { enableMultiWorld: true })
  const { projectId, worldId, workId } = created.scope
  const primaryGroupId = await db.worldGroups.add({
    projectId, worldId, name: '归潮港', description: '所有潮汐门的起点。', type: 'primary',
    icon: '⚓', order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const existingGroupId = await db.worldGroups.add({
    projectId, worldId, name: '盐镜界', description: '以记忆换取通行权的镜海世界。', type: 'traversal',
    icon: '🪞', order: 1, entryCondition: '交出一段真名记忆', createdAt: now, updatedAt: now,
  } as any) as number
  const linkId = await db.worldGroupLinks.add({
    projectId, worldId, fromGroupId: primaryGroupId, toGroupId: existingGroupId,
    linkType: 'portal', name: '盐镜门', bidirectional: false, createdAt: now,
  } as any) as number
  const storyCoreId = await db.storyCores.add({
    projectId, workId, theme: '力量是否值得失去身份', centralConflict: '潮路公会垄断世界门',
    plotPattern: '逐界升级', mainPlot: '主角寻找不需要牺牲记忆的归途。', createdAt: now, updatedAt: now,
  } as any) as number
  await stampCurrentFixtureResourceUidsV1(projectId)
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, primaryGroupId, existingGroupId, linkId, storyCoreId,
  }
}

function response(overrides: Record<string, unknown> = {}) {
  return JSON.stringify([
    {
      name: '灰烬钟庭', type: 'traversal', description: '燃尽未来换取当下力量的钟塔世界。',
      entryCondition: '在退潮时敲响无主铜钟', powerRestriction: '每次使用高阶能力都会提前遗忘一段未来计划',
      plannedChapterCount: 18,
    },
    {
      name: '兽潮棋盘', type: 'instance', description: '城邦按季节重排，居民必须在兽潮前完成迁城。',
      entryCondition: '持有上一世界获得的潮纹棋子', powerRestriction: '外来能力只能通过本地棋阵节点释放',
      plannedChapterCount: 12,
    },
    {
      name: '星梯上界', type: 'ascension', description: '漂浮阶梯连接不同重力层级，越高处时间越慢。',
      entryCondition: '集齐三枚世界门坐标', powerRestriction: '只能携带一个已被本地法则承认的核心能力',
      plannedChapterCount: 24,
      ...overrides,
    },
  ])
}

async function generate(fixture: Awaited<ReturnType<typeof seed>>, options: {
  boundary?: WorldSuggestBoundaryV1
  output?: string
} = {}) {
  return generateWorldSuggestCandidateV1({
    scope: fixture.scope,
    authorConcept: '希望下一批世界逐步挑战主角对记忆和身份的选择。',
    runAI: async messages => {
      const prompt = messages.map(message => message.content).join('\n')
      expect(prompt).toContain('下一批世界逐步挑战')
      expect(prompt).toContain('盐镜界')
      expect(prompt).toContain('力量是否值得失去身份')
      return options.output ?? response()
    },
    onDurableBoundary: options.boundary ? boundary => {
      if (boundary === options.boundary) throw new Error(`interrupt:${boundary}`)
    } : undefined,
  })
}

async function groupNames(fixture: Awaited<ReturnType<typeof seed>>) {
  return (await db.worldGroups.where('projectId').equals(fixture.projectId).toArray())
    .filter(row => (row as any).worldId === fixture.worldId)
    .sort((left, right) => left.order - right.order)
    .map(row => row.name)
}

describe.sequential('R-HARNESS68 · 多世界建议 durable 候选与选择式原子采纳', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('Context/Field/Adoption/Skill 四注册边界闭合，三个登记来源进入模型且候选前零写入', async () => {
    expect(['manualText', 'worldGroups', 'storyCore'].map(key => CONTEXT_SOURCE_BY_KEY.has(key))).toEqual([true, true, true])
    expect(FIELD_BY_TARGET.get('worldGroups')?.map(field => field.field)).toEqual(expect.arrayContaining([
      'name', 'type', 'description', 'icon', 'order', 'entryCondition', 'powerRestriction', 'plannedChapterCount',
    ]))
    expect(ADOPTION_BY_TARGET.get('worldGroups')).toMatchObject({
      identity: 'name', duplicatePolicy: 'error', ownerFrom: 'world',
    })
    expect(getAgentSkillV1('world-origin.world-suggest')).toMatchObject({
      agentId: 'world-origin', executionMode: 'world-suggest',
      contextSourceKeys: ['manualText', 'worldGroups', 'storyCore'],
      writeTargets: [{
        table: 'worldGroups',
        fields: ['name', 'type', 'description', 'icon', 'order', 'entryCondition', 'powerRestriction', 'plannedChapterCount'],
      }],
    })
    const fixture = await seed()
    const generated = await generate(fixture)
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(await groupNames(fixture)).toEqual(['归潮港', '盐镜界'])
    expect(generated.snapshot.events.some(event => event.type === 'adoption.started')).toBe(false)
  })

  it('刷新恢复同一批建议，作者只选择两项后按冻结顺序一次写入', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    const recovered = await readPendingWorldSuggestCandidateV1({ scope: fixture.scope })
    expect(recovered?.snapshot.run.id).toBe(generated.snapshot.run.id)
    expect(recovered?.candidate).toEqual(generated.candidate)
    const adopted = await adoptWorldSuggestCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0, 2],
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.receiptHash).toHaveLength(64)
    expect(await groupNames(fixture)).toEqual(['归潮港', '盐镜界', '灰烬钟庭', '星梯上界'])
    expect((await db.worldGroups.where('projectId').equals(fixture.projectId).toArray())
      .some(row => row.name === '兽潮棋盘')).toBe(false)
  })

  it('严格协议拒绝 Markdown、项数、额外字段、主世界、重复名和越界章节数', async () => {
    expect(() => parseWorldSuggestOutputStrictV1(`\`\`\`json\n${response()}\n\`\`\``)).toThrow('代码围栏')
    expect(() => parseWorldSuggestOutputStrictV1(JSON.stringify([JSON.parse(response())[0]]))).toThrow('2-4')
    expect(() => parseWorldSuggestOutputStrictV1(response({ extra: true }))).toThrow('只能包含')
    expect(() => parseWorldSuggestOutputStrictV1(response({ type: 'primary' }))).toThrow('type')
    const duplicate = JSON.parse(response()); duplicate[0].name = 'Ash World'; duplicate[2].name = 'ash world'
    expect(() => parseWorldSuggestOutputStrictV1(JSON.stringify(duplicate))).toThrow('重复名称')
    expect(() => parseWorldSuggestOutputStrictV1(response({ plannedChapterCount: 0 }))).toThrow('预计章节数')
    const fixture = await seed('strict')
    await expect(generate(fixture, { output: response({ type: 'primary' }) })).rejects.toThrow('type')
    await expect(generate(fixture, { output: response({ name: '盐镜界' }) })).rejects.toThrow('与已有世界重名')
    expect(await groupNames(fixture)).toEqual(['归潮港', '盐镜界'])
  })

  it('model.requested 后未知结果以及 model.responded 后未 checkpoint 都不自动重试', async () => {
    const first = await seed('requested')
    let calls = 0
    await expect(generateWorldSuggestCandidateV1({
      scope: first.scope, authorConcept: '继续挑战身份',
      runAI: async () => { calls++; throw new Error('provider-lost') },
    })).rejects.toThrow('provider-lost')
    const firstRecovery = await readRecoverableWorldSuggestRunV1({ scope: first.scope })
    expect(calls).toBe(1)
    expect(firstRecovery?.safeToResume).toBe(false)

    const second = await seed('responded')
    await expect(generate(second, { boundary: 'model.responded' })).rejects.toThrow('interrupt:model.responded')
    const secondRecovery = await readRecoverableWorldSuggestRunV1({ scope: second.scope })
    expect(secondRecovery?.safeToResume).toBe(false)
    await abandonWorldSuggestRunV1({ scope: second.scope, runId: secondRecovery!.snapshot.run.id })
  })

  it('候选 checkpoint 后、candidate event 前中断可恢复同一输出且不重复模型调用', async () => {
    const fixture = await seed()
    let calls = 0
    await expect(generateWorldSuggestCandidateV1({
      scope: fixture.scope, authorConcept: '继续挑战身份',
      runAI: async () => { calls++; return response() },
      onDurableBoundary: boundary => { if (boundary === 'candidate.checkpoint') throw new Error('interrupt:candidate.checkpoint') },
    })).rejects.toThrow('interrupt:candidate.checkpoint')
    const recovered = await readPendingWorldSuggestCandidateV1({ scope: fixture.scope })
    expect(calls).toBe(1)
    expect(recovered?.candidate.worlds[0].name).toBe('灰烬钟庭')
    expect(recovered?.snapshot.projection.state).toBe('awaiting_confirmation')
  })

  it.each([
    ['作品提示', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.works.update(fixture.workId, { description: '作者改写了作品简介', updatedAt: Date.now() + 1 })
    }],
    ['世界目录', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.worldGroups.update(fixture.existingGroupId, { description: '作者改写已有世界', updatedAt: Date.now() + 1 })
    }],
    ['世界关系', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.worldGroupLinks.update(fixture.linkId, { name: '作者重命名世界门' })
    }],
    ['故事核心', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.storyCores.update(fixture.storyCoreId, { theme: '作者改写主题', updatedAt: Date.now() + 1 })
    }],
  ] as const)('%s 漂移使候选 stale，正式世界组保持不变', async (_label, mutate) => {
    const fixture = await seed(String(_label))
    const generated = await generate(fixture)
    await mutate(fixture)
    await expect(adoptWorldSuggestCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow('已变化')
    expect(await groupNames(fixture)).not.toContain('灰烬钟庭')
  })

  it('Prompt 模板变化使候选 stale，不写正式世界组', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    vi.spyOn(worldGroupAI, 'readWorldSuggestPromptTemplateSnapshotV1').mockReturnValue([
      { role: 'system', content: '部署后的世界建议协议' },
      { role: 'user', content: '{{REGISTERED_CONTEXT}}' },
    ])
    await expect(adoptWorldSuggestCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow('已变化')
    expect(await groupNames(fixture)).not.toContain('灰烬钟庭')
  })

  it('作者拒绝后候选不再恢复，空选择也不能伪装确认', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    await expect(adoptWorldSuggestCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [],
    })).rejects.toThrow('至少选择一个')
    const rejected = await rejectWorldSuggestCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(rejected.projection.state).toBe('cancelled')
    expect(await groupNames(fixture)).toEqual(['归潮港', '盐镜界'])
    await expect(readPendingWorldSuggestCandidateV1({ scope: fixture.scope })).resolves.toBeNull()
  })

  it.each<WorldSuggestBoundaryV1>([
    'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
    'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
  ])('采纳在 %s 中断后沿冻结选择幂等收敛', async boundary => {
    const fixture = await seed(boundary)
    const generated = await generate(fixture)
    await expect(adoptWorldSuggestCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0, 2],
      onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
    })).rejects.toThrow(`interrupt:${boundary}`)
    if (boundary !== 'verification.accepted') {
      const recovery = await readRecoverableWorldSuggestRunV1({ scope: fixture.scope })
      expect(recovery?.safeToResume).toBe(true)
      expect(recovery?.candidate).toEqual(generated.candidate)
      expect(recovery?.adoptionPending).toBe(true)
      await expect(readPendingWorldSuggestCandidateV1({ scope: fixture.scope })).resolves.toBeNull()
    }
    const completed = await adoptWorldSuggestCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect(await groupNames(fixture)).toEqual(['归潮港', '盐镜界', '灰烬钟庭', '星梯上界'])
    expect(completed.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
  })

  it('终验后任一新世界或旧世界变化会撤销旧 receipt，不冒充当前完成', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    await adoptWorldSuggestCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0] })
    const created = (await db.worldGroups.where('projectId').equals(fixture.projectId).toArray())
      .find(row => row.name === '灰烬钟庭')!
    await db.worldGroups.update(created.id!, { icon: '🕰️', updatedAt: Date.now() + 1 })
    await expect(adoptWorldSuggestCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })).rejects.toThrow('完成回执已过期')
    const run = await db.agentRuns.get(generated.snapshot.run.id)
    expect(run?.status).toBe('paused')
    expect(run?.terminalReceiptHash).toBeNull()
  })

  it('未完成本地候选导入后取消，不在导入 Work 复活', async () => {
    const fixture = await seed()
    await generate(fixture)
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
    const imported = (await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(run => run.contractJson.includes('world-origin.world-suggest'))!
    expect(imported.status).toBe('cancelled')
    expect(imported.terminalReceiptHash).toBeNull()
  })

  it('World 与 Work 严格隔离，旧组件内存候选/直接创建旁路下线', async () => {
    const first = await seed('one')
    const generated = await generate(first)
    const now = Date.now()
    const otherWorkId = await db.works.add(currentWorkFixtureRecordV1({
      projectId: first.projectId, worldId: first.worldId, title: '同世界另一作品', description: '',
      genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now,
    })) as number
    const otherWorkScope = { ...first.scope, workId: otherWorkId }
    await expect(readPendingWorldSuggestCandidateV1({ scope: otherWorkScope })).resolves.toBeNull()
    await expect(adoptWorldSuggestCandidateV1({
      scope: otherWorkScope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow()

    const otherWorldId = await db.worlds.add({
      projectId: first.projectId, code: `other-${now}`, name: '同项目另一世界', description: '',
      currentVersion: 1, createdAt: now, updatedAt: now,
    }) as number
    const otherWorldWorkId = await db.works.add(currentWorkFixtureRecordV1({
      projectId: first.projectId, worldId: otherWorldId, title: '另一世界作品', description: '',
      genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now,
    })) as number
    const otherWorldScope = { projectId: first.projectId, worldId: otherWorldId, workId: otherWorldWorkId }
    await expect(readPendingWorldSuggestCandidateV1({ scope: otherWorldScope })).resolves.toBeNull()
    await expect(adoptWorldSuggestCandidateV1({
      scope: otherWorldScope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow()

    const panel = readFileSync('src/components/world-group/WorldGroupOverview.tsx', 'utf8')
    expect(panel).not.toContain('useAIStream')
    expect(panel).not.toContain('createAISessionKey')
    expect(panel).not.toContain('buildAllWorldsOverview')
    expect(panel).not.toContain('parseWorldSuggestOutput')
    expect(panel).not.toMatch(/await createGroup\(\{\s*projectId: project\.id![\s\S]*?name: w\.name/)
    expect(panel).toContain('generateWorldSuggestCandidateV1')
    expect(panel).toContain('adoptWorldSuggestCandidateV1')
  })
})
