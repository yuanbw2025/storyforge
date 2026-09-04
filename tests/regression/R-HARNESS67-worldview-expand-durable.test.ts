import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { parseWorldExpandOutputStrictV1 } from '../../src/lib/ai/world-group-ai'
import * as worldGroupAI from '../../src/lib/ai/world-group-ai'
import {
  abandonWorldviewExpandRunV1,
  adoptWorldviewExpandCandidateV1,
  generateWorldviewExpandCandidateV1,
  readPendingWorldviewExpandCandidateV1,
  readRecoverableWorldviewExpandRunV1,
  rejectWorldviewExpandCandidateV1,
  type WorldviewExpandBoundaryV1,
} from '../../src/lib/agent/run/worldview-expand-durable'
import { currentWorkFixtureRecordV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'

async function seed(suffix = '') {
  const now = Date.now()
  const created = await seedCurrentWorkspace(`六字段扩写${suffix}`, { enableMultiWorld: true })
  const { projectId, worldId, workId } = created.scope
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '潮钟界', description: '盐雾吞食记忆，三座堤城争夺退潮航道。',
    type: 'traversal', icon: '🌊', color: '#336699', order: 0,
    entryCondition: '听见第十三声潮钟', plannedChapterCount: 24,
    createdAt: now, updatedAt: now,
  } as any) as number
  const siblingGroupId = await db.worldGroups.add({
    projectId, worldId, name: '炎昼界', description: '永昼沙海与玻璃商路。', type: 'parallel',
    icon: '☀️', order: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const worldviewId = await db.worldviews.add({
    projectId, worldId, worldGroupId,
    worldOrigin: '旧起源', powerHierarchy: '旧力量', continentLayout: '旧地貌', climateByRegion: '旧气候',
    races: '旧种族', factionLayout: '旧势力', worldStructure: '潮汐夹层世界',
    createdAt: now, updatedAt: now,
  } as any) as number
  const siblingWorldviewId = await db.worldviews.add({
    projectId, worldId, worldGroupId: siblingGroupId,
    worldOrigin: '炎昼旧起源', createdAt: now, updatedAt: now,
  } as any) as number
  await db.storyCores.add({
    projectId, workId, theme: '记忆能否成为货币', centralConflict: '堤城争夺潮窗', plotPattern: '递进',
    mainPlot: '主角追查盐雾吞忆的源头。', createdAt: now, updatedAt: now,
  } as any)
  await stampCurrentFixtureResourceUidsV1(projectId)
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, worldGroupId, siblingGroupId, worldviewId, siblingWorldviewId,
  }
}

function response(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    worldOrigin: '潮钟界由七次退潮后凝成，盐雾会交换进入者的记忆。',
    powerHierarchy: '听潮者依次掌握辨潮、借潮、定潮和改潮，每次晋升都要抵押一段真实记忆。',
    continentLayout: '三座堤城沿环形内海分布，退潮时显露连接诸城的盐晶航道。',
    climateByRegion: '内海常年湿冷，外环盐漠昼夜温差极大，退潮季会出现吞忆盐雾。',
    races: '堤城人以记忆契约维持身份，盐漠游民用骨铃保存不能被盐雾夺走的名字。',
    factionLayout: '三座堤城分别控制钟塔、盐库与航闸，游民商队掌握唯一不受潮窗限制的陆路。',
    ...extra,
  })
}

async function generate(fixture: Awaited<ReturnType<typeof seed>>, options: {
  boundary?: WorldviewExpandBoundaryV1
  output?: string
  expectExistingWorldview?: boolean
} = {}) {
  return generateWorldviewExpandCandidateV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    runAI: async messages => {
      const prompt = messages.map(message => message.content).join('\n')
      expect(prompt).toContain('盐雾吞食记忆')
      expect(prompt).toContain('炎昼界')
      expect(prompt).toContain('记忆能否成为货币')
      if (options.expectExistingWorldview !== false) expect(prompt).toContain('旧起源')
      return options.output ?? response()
    },
    onDurableBoundary: options.boundary ? boundary => {
      if (boundary === options.boundary) throw new Error(`interrupt:${boundary}`)
    } : undefined,
  })
}

async function targetRow(fixture: Awaited<ReturnType<typeof seed>>) {
  return db.worldviews.get(fixture.worldviewId)
}

describe.sequential('R-HARNESS67 · 世界组六字段扩写 durable 候选与原子采纳', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('Skill/Context/Field 三注册表闭合，四个登记来源进入模型且候选确认前零正式写入', async () => {
    expect(['manualText', 'worldGroups', 'storyCore', 'worldview'].map(key => CONTEXT_SOURCE_BY_KEY.has(key))).toEqual([true, true, true, true])
    expect(FIELD_BY_TARGET.get('worldviews')?.map(field => field.field)).toEqual(expect.arrayContaining([
      'worldOrigin', 'powerHierarchy', 'continentLayout', 'climateByRegion', 'races', 'factionLayout',
    ]))
    expect(getAgentSkillV1('world-origin.worldview-expand')).toMatchObject({
      agentId: 'world-origin', executionMode: 'worldview-expand',
      contextSourceKeys: ['manualText', 'worldGroups', 'storyCore', 'worldview'],
      writeTargets: [{
        table: 'worldviews',
        fields: ['worldOrigin', 'powerHierarchy', 'continentLayout', 'climateByRegion', 'races', 'factionLayout'],
      }],
    })
    const fixture = await seed()
    const assembled = await assembleContext({
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      sourceKeys: ['manualText', 'worldGroups', 'storyCore', 'worldview'],
      manualSourceText: '【目标世界草稿】\n盐雾吞食记忆',
    })
    expect(assembled.text).toContain('盐雾吞食记忆')
    expect(assembled.text).toContain('炎昼界')
    expect(assembled.text).toContain('记忆能否成为货币')
    expect(assembled.text).toContain('旧起源')
    const generated = await generate(fixture)
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect((await targetRow(fixture))?.worldOrigin).toBe('旧起源')
    expect(generated.snapshot.events.some(event => event.type === 'adoption.started')).toBe(false)
  })

  it('刷新恢复同一六字段候选，确认后一次采纳并保留非目标字段/其它世界', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    const recovered = await readPendingWorldviewExpandCandidateV1({ scope: fixture.scope, worldGroupId: fixture.worldGroupId })
    expect(recovered?.snapshot.run.id).toBe(generated.snapshot.run.id)
    expect(recovered?.candidate).toEqual(generated.candidate)
    const adopted = await adoptWorldviewExpandCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.receiptHash).toHaveLength(64)
    const target = await targetRow(fixture)
    expect(target).toMatchObject(generated.candidate.values)
    expect(target?.worldStructure).toBe('潮汐夹层世界')
    expect((await db.worldviews.get(fixture.siblingWorldviewId))?.worldOrigin).toBe('炎昼旧起源')
  })

  it('严格协议拒绝 Markdown、额外/缺失字段、空值和过长内容', async () => {
    expect(() => parseWorldExpandOutputStrictV1(`\`\`\`json\n${response()}\n\`\`\``)).toThrow('代码围栏')
    expect(() => parseWorldExpandOutputStrictV1(response({ extra: true }))).toThrow('只能包含')
    const missing = JSON.parse(response()); delete missing.races
    expect(() => parseWorldExpandOutputStrictV1(JSON.stringify(missing))).toThrow('只能包含')
    expect(() => parseWorldExpandOutputStrictV1(response({ races: '' }))).toThrow('races')
    expect(() => parseWorldExpandOutputStrictV1(response({ races: '长'.repeat(30_001) }))).toThrow('races')
    const fixture = await seed('strict')
    await expect(generate(fixture, { output: JSON.stringify(missing) })).rejects.toThrow('只能包含')
    expect((await targetRow(fixture))?.worldOrigin).toBe('旧起源')
  })

  it('model.requested 后未知结果以及 model.responded 后未 checkpoint 都不自动重试', async () => {
    const first = await seed('requested')
    let calls = 0
    await expect(generateWorldviewExpandCandidateV1({
      scope: first.scope, worldGroupId: first.worldGroupId,
      runAI: async () => { calls++; throw new Error('provider-lost') },
    })).rejects.toThrow('provider-lost')
    const firstRecovery = await readRecoverableWorldviewExpandRunV1({ scope: first.scope, worldGroupId: first.worldGroupId })
    expect(calls).toBe(1)
    expect(firstRecovery?.safeToResume).toBe(false)

    const second = await seed('responded')
    await expect(generate(second, { boundary: 'model.responded' })).rejects.toThrow('interrupt:model.responded')
    const secondRecovery = await readRecoverableWorldviewExpandRunV1({ scope: second.scope, worldGroupId: second.worldGroupId })
    expect(secondRecovery?.safeToResume).toBe(false)
    await abandonWorldviewExpandRunV1({ scope: second.scope, runId: secondRecovery!.snapshot.run.id })
  })

  it('候选 checkpoint 后、candidate event 前中断可恢复同一输出且不重复模型调用', async () => {
    const fixture = await seed()
    let calls = 0
    await expect(generateWorldviewExpandCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      runAI: async () => { calls++; return response() },
      onDurableBoundary: boundary => { if (boundary === 'candidate.checkpoint') throw new Error('interrupt:candidate.checkpoint') },
    })).rejects.toThrow('interrupt:candidate.checkpoint')
    const recovered = await readPendingWorldviewExpandCandidateV1({ scope: fixture.scope, worldGroupId: fixture.worldGroupId })
    expect(calls).toBe(1)
    expect(recovered?.candidate.values.worldOrigin).toContain('七次退潮')
    expect(recovered?.snapshot.projection.state).toBe('awaiting_confirmation')
  })

  it.each([
    ['世界组草稿', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.worldGroups.update(fixture.worldGroupId, { description: '作者改写了世界草稿', updatedAt: Date.now() + 1 })
    }],
    ['故事核心', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      const row = (await db.storyCores.where('projectId').equals(fixture.projectId).first())!
      await db.storyCores.update(row.id!, { theme: '作者改写主题', updatedAt: Date.now() + 1 })
    }],
    ['正式世界观', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.worldviews.update(fixture.worldviewId, { worldOrigin: '作者另行改写', updatedAt: Date.now() + 1 })
    }],
  ] as const)('%s 漂移使候选 stale，不覆盖作者当前正式数据', async (_label, mutate) => {
    const fixture = await seed(String(_label))
    const generated = await generate(fixture)
    await mutate(fixture)
    await expect(adoptWorldviewExpandCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })).rejects.toThrow('已变化')
    expect((await targetRow(fixture))?.worldOrigin).not.toBe(generated.candidate.values.worldOrigin)
  })

  it('Prompt 模板版本变化使候选 stale，不写正式世界观', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    vi.spyOn(worldGroupAI, 'readWorldExpandPromptTemplateSnapshotV1').mockReturnValue([
      { role: 'system', content: '部署后的六字段协议' },
      { role: 'user', content: '{{REGISTERED_CONTEXT}}' },
    ])
    await expect(adoptWorldviewExpandCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })).rejects.toThrow('已变化')
    expect((await targetRow(fixture))?.worldOrigin).toBe('旧起源')
  })

  it('作者拒绝后候选不再恢复，正式六字段保持不变', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    const rejected = await rejectWorldviewExpandCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })
    expect(rejected.projection.state).toBe('cancelled')
    expect((await targetRow(fixture))?.worldOrigin).toBe('旧起源')
    await expect(readPendingWorldviewExpandCandidateV1({ scope: fixture.scope, worldGroupId: fixture.worldGroupId })).resolves.toBeNull()
  })

  it.each<WorldviewExpandBoundaryV1>([
    'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
    'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
  ])('采纳在 %s 中断后沿冻结意图幂等收敛', async boundary => {
    const fixture = await seed(boundary)
    const generated = await generate(fixture)
    await expect(adoptWorldviewExpandCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
      onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
    })).rejects.toThrow(`interrupt:${boundary}`)
    if (boundary !== 'verification.accepted') {
      const recovery = await readRecoverableWorldviewExpandRunV1({
        scope: fixture.scope,
        worldGroupId: fixture.worldGroupId,
      })
      expect(recovery?.safeToResume).toBe(true)
      expect(recovery?.candidate).toEqual(generated.candidate)
      expect(recovery?.adoptionPending).toBe(true)
      await expect(readPendingWorldviewExpandCandidateV1({
        scope: fixture.scope,
        worldGroupId: fixture.worldGroupId,
      })).resolves.toBeNull()
    }
    const completed = await adoptWorldviewExpandCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect((await targetRow(fixture))?.worldOrigin).toBe(generated.candidate.values.worldOrigin)
    expect(completed.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
  })

  it('终验后目标或非目标字段改变会撤销旧 receipt，不冒充当前完成', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    await adoptWorldviewExpandCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })
    await db.worldviews.update(fixture.worldviewId, { worldStructure: '作者修改非目标世界结构', updatedAt: Date.now() + 1 })
    await expect(adoptWorldviewExpandCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })).rejects.toThrow('完成回执已过期')
    const run = await db.agentRuns.get(generated.snapshot.run.id)
    expect(run?.status).toBe('paused')
    expect(run?.terminalReceiptHash).toBeNull()
  })

  it('不存在正式 Worldview 时确认后只创建目标世界组单例，写后恢复仍幂等', async () => {
    const fixture = await seed('create')
    await db.worldviews.delete(fixture.worldviewId)
    const generated = await generate(fixture, { expectExistingWorldview: false })
    await expect(adoptWorldviewExpandCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
      onDurableBoundary: boundary => { if (boundary === 'formal.written') throw new Error('interrupt:formal.written') },
    })).rejects.toThrow('interrupt:formal.written')
    const completed = await adoptWorldviewExpandCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })
    expect(completed.snapshot.projection.state).toBe('completed')
    const targets = (await db.worldviews.where('projectId').equals(fixture.projectId).toArray())
      .filter(row => row.worldGroupId === fixture.worldGroupId)
    expect(targets).toHaveLength(1)
    expect(targets[0]).toMatchObject(generated.candidate.values)
  })

  it('未完成本地世界组候选导入后取消，不在新 Work 复活', async () => {
    const fixture = await seed()
    await generate(fixture)
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
    const imported = (await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(run => run.contractJson.includes('world-origin.worldview-expand'))!
    expect(imported.status).toBe('cancelled')
    expect(imported.terminalReceiptHash).toBeNull()
  })

  it('World、Work 和世界组严格隔离，WorldGroupDetail 的旧直调/立即 adopt 旁路已下线', async () => {
    const first = await seed('one')
    const generated = await generate(first)
    const now = Date.now()
    const otherWorkId = await db.works.add(currentWorkFixtureRecordV1({
      projectId: first.projectId, worldId: first.worldId, title: '同世界另一作品', description: '',
      genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now,
    })) as number
    const otherWorkScope = { ...first.scope, workId: otherWorkId }
    await expect(readPendingWorldviewExpandCandidateV1({
      scope: otherWorkScope,
      worldGroupId: first.worldGroupId,
    })).resolves.toBeNull()
    await expect(adoptWorldviewExpandCandidateV1({
      scope: otherWorkScope,
      worldGroupId: first.worldGroupId,
      runId: generated.snapshot.run.id,
    })).rejects.toThrow()

    const otherWorldId = await db.worlds.add({
      projectId: first.projectId, code: `other-world-${now}`, name: '同项目另一世界', description: '',
      currentVersion: 1, createdAt: now, updatedAt: now,
    }) as number
    const otherWorldWorkId = await db.works.add(currentWorkFixtureRecordV1({
      projectId: first.projectId, worldId: otherWorldId, title: '另一世界作品', description: '',
      genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now,
    })) as number
    const otherWorldScope = { projectId: first.projectId, worldId: otherWorldId, workId: otherWorldWorkId }
    await expect(readPendingWorldviewExpandCandidateV1({
      scope: otherWorldScope,
      worldGroupId: first.worldGroupId,
    })).resolves.toBeNull()
    await expect(adoptWorldviewExpandCandidateV1({
      scope: otherWorldScope,
      worldGroupId: first.worldGroupId,
      runId: generated.snapshot.run.id,
    })).rejects.toThrow()

    const second = await seed('two')
    await expect(readPendingWorldviewExpandCandidateV1({ scope: second.scope, worldGroupId: second.worldGroupId })).resolves.toBeNull()
    await expect(adoptWorldviewExpandCandidateV1({
      scope: second.scope, worldGroupId: second.worldGroupId, runId: generated.snapshot.run.id,
    })).rejects.toThrow()
    await expect(readPendingWorldviewExpandCandidateV1({ scope: first.scope, worldGroupId: first.siblingGroupId })).resolves.toBeNull()

    const panel = readFileSync('src/components/world-group/WorldGroupDetail.tsx', 'utf8')
    expect(panel).not.toContain('useAIStream')
    expect(panel).not.toMatch(/\bchat\s*\(/)
    expect(panel).not.toContain('buildAllWorldsOverview')
    expect(panel).not.toContain('db.storyCores')
    expect(panel).not.toMatch(/\badopt\s*\(/)
    expect(panel).toContain('generateWorldviewExpandCandidateV1')
    expect(panel).toContain('adoptWorldviewExpandCandidateV1')
    const registry = JSON.parse(readFileSync('src/lib/agent/ai-entry-registry.json', 'utf8'))
    expect(registry.entries.some((entry: any) => entry.allowedCallers
      ?.some((file: string) => file.endsWith('WorldGroupDetail.tsx')))).toBe(false)
  })
})
