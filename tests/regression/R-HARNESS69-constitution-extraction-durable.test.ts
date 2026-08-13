import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { TemporalFact, WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { ADOPTION_EXTENSIONS } from '../../src/lib/registry/adoption-schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import {
  listSettingAssertionSources,
  listSettingAssertionSubjects,
  parseSettingAssertionCandidatesStrictV1,
} from '../../src/lib/fact-ledger/setting-assertions'
import * as settingAssertions from '../../src/lib/fact-ledger/setting-assertions'
import {
  abandonConstitutionExtractionRunV1,
  adoptConstitutionExtractionCandidateV1,
  generateConstitutionExtractionCandidateV1,
  readPendingConstitutionExtractionCandidateV1,
  readRecoverableConstitutionExtractionRunV1,
  rejectConstitutionExtractionCandidateV1,
  type ConstitutionExtractionBoundaryV1,
} from '../../src/lib/agent/run/constitution-extraction-durable'

async function seed(suffix = '') {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: `宪法扫描${suffix}`, genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 100_000, worldCode: `constitution-${now}-${suffix}`,
    worldVersion: 1, enableMultiWorld: true, createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `constitution-${now}-${suffix}`, name: `曜月宇宙${suffix}`, description: '',
    currentVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: `潮汐遗民${suffix}`, description: '', genres: ['fantasy'],
    status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now,
  } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: `曜月界${suffix}`, description: '', type: 'primary', icon: '🌙', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  const worldviewId = await db.worldviews.add({
    projectId, worldId, worldGroupId, worldOrigin: '曜月界的魔法源于月亮潮汐。',
    geography: '', history: '', society: '', culture: '', economy: '', rules: '', summary: '',
    createdAt: now, updatedAt: now,
  } as any) as number
  const powerSystemId = await db.powerSystems.add({
    projectId, worldId, worldGroupId, name: '潮汐术', description: '术士借用月亮潮汐施法。',
    levels: '观潮、引潮、御潮', rules: '最高只能达到御潮。', createdAt: now, updatedAt: now,
  } as any) as number
  const storyCoreId = await db.storyCores.add({
    projectId, workId, theme: '力量与身份', mainPlot: '林飞寻找身世。', logline: '遗民追索潮汐真相。',
    concept: '', createdAt: now, updatedAt: now,
  } as any) as number
  const characterId = await db.characters.add({
    projectId, worldId, homeWorldGroupId: worldGroupId, name: `林飞${suffix}`,
    background: '林飞自幼父母双亡。', relationships: '', identity: '遗民',
    createdAt: now, updatedAt: now,
  } as any) as number
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, worldGroupId, worldviewId, powerSystemId, storyCoreId, characterId,
  }
}

async function response(fixture: Awaited<ReturnType<typeof seed>>) {
  const sources = await listSettingAssertionSources(fixture.projectId, undefined, fixture.scope)
  const worldview = sources.find(source => source.table === 'worldviews' && source.field === 'worldOrigin')!
  const character = sources.find(source => source.table === 'characters' && source.field === 'background')!
  return JSON.stringify({
    assertions: [
      {
        subjectType: 'worldGroup', subjectId: fixture.worldGroupId, predicate: 'magicSource',
        value: '月亮潮汐', sourceKey: worldview.sourceKey, quote: '魔法源于月亮潮汐',
      },
      {
        subjectType: 'character', subjectId: fixture.characterId, predicate: 'parentStatus',
        value: '父母双亡', sourceKey: character.sourceKey, quote: '父母双亡',
      },
    ],
  })
}

async function generate(fixture: Awaited<ReturnType<typeof seed>>, options: {
  boundary?: ConstitutionExtractionBoundaryV1
  output?: string
  inspect?: (prompt: string) => void
} = {}) {
  return generateConstitutionExtractionCandidateV1({
    scope: fixture.scope,
    runAI: async messages => {
      const prompt = messages.map(message => message.content).join('\n')
      options.inspect?.(prompt)
      return options.output ?? response(fixture)
    },
    onDurableBoundary: options.boundary ? boundary => {
      if (boundary === options.boundary) throw new Error(`interrupt:${boundary}`)
    } : undefined,
  })
}

async function facts(fixture: Awaited<ReturnType<typeof seed>>) {
  return (await db.temporalFacts.where('projectId').equals(fixture.projectId).toArray())
    .filter(row => row.workId === fixture.workId)
}

describe.sequential('R-HARNESS69 · 世界宪法扫描 durable 双层确认', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('Context/Skill/事实扩展/PROJECT_TABLES 闭合，登记来源主体和谓词进入模型且候选前零写入', async () => {
    expect(CONTEXT_SOURCE_BY_KEY.get('constitutionScanSources')).toMatchObject({ ownerFrom: 'work', scope: 'project' })
    expect(ADOPTION_EXTENSIONS.find(item => item.id === 'fact-ledger')).toMatchObject({ target: 'temporalFacts' })
    expect(PROJECT_TABLES.find(item => item.name === 'temporalFacts')).toMatchObject({ exportable: true, worldScoped: true })
    expect(getAgentSkillV1('world-origin.constitution-extract')).toMatchObject({
      agentId: 'world-origin', executionMode: 'constitution-extract',
      contextSourceKeys: ['constitutionScanSources'],
      writeTargets: [{ table: 'temporalFacts', fields: [], adoptionExtension: 'fact-ledger' }],
    })
    const fixture = await seed()
    const generated = await generate(fixture, { inspect: prompt => {
      expect(prompt).toContain('worldviews:')
      expect(prompt).toContain('magicSource')
      expect(prompt).toContain(String(fixture.worldGroupId))
      expect(prompt).toContain(String(fixture.characterId))
      expect(prompt).toContain('魔法源于月亮潮汐')
    } })
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(generated.candidate.assertions).toHaveLength(2)
    expect(await facts(fixture)).toHaveLength(0)
  })

  it('刷新恢复同一批候选，批次确认只原子写 candidate，绝不直接升级 Canon', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    const recovered = await readPendingConstitutionExtractionCandidateV1({ scope: fixture.scope })
    expect(recovered?.candidate).toEqual(generated.candidate)
    const adopted = await adoptConstitutionExtractionCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.written).toBe(2)
    expect(await facts(fixture)).toEqual(expect.arrayContaining([
      expect.objectContaining({ predicate: 'magicSource', status: 'candidate', locked: false }),
      expect.objectContaining({ predicate: 'parentStatus', status: 'candidate', locked: false }),
    ]))
    expect((await facts(fixture)).some(row => row.status === 'confirmed')).toBe(false)
  })

  it('严格协议拒绝围栏、顶层/项额外字段、未知来源/主题/主体、非逐字证据、重复与超量', async () => {
    const fixture = await seed()
    const sources = await listSettingAssertionSources(fixture.projectId, undefined, fixture.scope)
    const subjects = await listSettingAssertionSubjects(fixture.scope)
    const valid = JSON.parse(await response(fixture))
    expect(() => parseSettingAssertionCandidatesStrictV1(`\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``, sources, subjects)).toThrow('代码围栏')
    expect(() => parseSettingAssertionCandidatesStrictV1(JSON.stringify({ assertions: valid.assertions, extra: true }), sources, subjects)).toThrow('顶层')
    expect(() => parseSettingAssertionCandidatesStrictV1(JSON.stringify({ assertions: [{ ...valid.assertions[0], extra: true }] }), sources, subjects)).toThrow('字段')
    expect(() => parseSettingAssertionCandidatesStrictV1(JSON.stringify({ assertions: [{ ...valid.assertions[0], sourceKey: 'unknown:1:x' }] }), sources, subjects)).toThrow('闭集')
    expect(() => parseSettingAssertionCandidatesStrictV1(JSON.stringify({ assertions: [{ ...valid.assertions[0], predicate: 'unknownRule' }] }), sources, subjects)).toThrow('闭集')
    expect(() => parseSettingAssertionCandidatesStrictV1(JSON.stringify({ assertions: [{ ...valid.assertions[0], subjectId: 999_999 }] }), sources, subjects)).toThrow('闭集')
    expect(() => parseSettingAssertionCandidatesStrictV1(JSON.stringify({ assertions: [{ ...valid.assertions[0], quote: '模型伪造引文' }] }), sources, subjects)).toThrow('闭集')
    expect(() => parseSettingAssertionCandidatesStrictV1(JSON.stringify({ assertions: [valid.assertions[0], valid.assertions[0]] }), sources, subjects)).toThrow('重复')
    expect(() => parseSettingAssertionCandidatesStrictV1(JSON.stringify({ assertions: Array.from({ length: 81 }, () => valid.assertions[0]) }), sources, subjects)).toThrow('0-80')
  })

  it('空结果也是可确认 durable 扫描报告，但不写任何事实', async () => {
    const fixture = await seed()
    const generated = await generate(fixture, { output: '{"assertions":[]}' })
    const adopted = await adoptConstitutionExtractionCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.written).toBe(0)
    expect(await facts(fixture)).toHaveLength(0)
  })

  it('model.requested 未知结果和 model.responded 未 checkpoint 都不自动重试', async () => {
    const first = await seed('unknown')
    let calls = 0
    await expect(generateConstitutionExtractionCandidateV1({
      scope: first.scope,
      runAI: async () => { calls++; throw new Error('provider-lost') },
    })).rejects.toThrow('provider-lost')
    expect(calls).toBe(1)
    expect((await readRecoverableConstitutionExtractionRunV1({ scope: first.scope }))?.safeToResume).toBe(false)

    const second = await seed('responded')
    await expect(generate(second, { boundary: 'model.responded' })).rejects.toThrow('interrupt:model.responded')
    const recovery = await readRecoverableConstitutionExtractionRunV1({ scope: second.scope })
    expect(recovery?.safeToResume).toBe(false)
    await abandonConstitutionExtractionRunV1({ scope: second.scope, runId: recovery!.snapshot.run.id })
  })

  it('候选 checkpoint 后、candidate event 前中断可恢复且不重复调用模型', async () => {
    const fixture = await seed()
    let calls = 0
    await expect(generateConstitutionExtractionCandidateV1({
      scope: fixture.scope,
      runAI: async () => { calls++; return response(fixture) },
      onDurableBoundary: boundary => { if (boundary === 'candidate.checkpoint') throw new Error('interrupt:candidate.checkpoint') },
    })).rejects.toThrow('interrupt:candidate.checkpoint')
    const recovered = await readPendingConstitutionExtractionCandidateV1({ scope: fixture.scope })
    expect(calls).toBe(1)
    expect(recovered?.candidate.assertions).toHaveLength(2)
    expect(recovered?.snapshot.projection.state).toBe('awaiting_confirmation')
  })

  it.each([
    ['来源', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.worldviews.update(fixture.worldviewId, { worldOrigin: '曜月界的魔法改由血脉觉醒。', updatedAt: Date.now() + 1 })
    }],
    ['主体', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.characters.update(fixture.characterId, { name: '作者重命名林飞', updatedAt: Date.now() + 1 })
    }],
    ['事实 baseline', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.temporalFacts.add({
        projectId: fixture.projectId, workId: fixture.workId, worldGroupId: fixture.worldGroupId,
        subjectWorldGroupId: fixture.worldGroupId, subjectName: '曜月界', predicate: 'powerCeiling',
        factKind: 'state', value: '御潮', sourceType: 'manual', status: 'candidate', locked: false,
        createdAt: Date.now(), updatedAt: Date.now(),
      } as TemporalFact)
    }],
  ] as const)('%s 漂移使候选 stale，冻结批次零写入', async (_label, mutate) => {
    const fixture = await seed(String(_label))
    const generated = await generate(fixture)
    await mutate(fixture)
    const before = await facts(fixture)
    await expect(adoptConstitutionExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })).rejects.toThrow('已变化')
    expect(await facts(fixture)).toEqual(before)
  })

  it('Prompt 模板变化使候选 stale，不写事实候选', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    vi.spyOn(settingAssertions, 'readSettingAssertionExtractPromptTemplateSnapshotV1').mockReturnValue([
      { role: 'system', content: '部署后的世界宪法抽取协议' },
      { role: 'user', content: '{{REGISTERED_CONTEXT}}' },
    ])
    await expect(adoptConstitutionExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })).rejects.toThrow('已变化')
    expect(await facts(fixture)).toHaveLength(0)
  })

  it('已有同值同证据候选使模型结果协议失败，不默默跳过', async () => {
    const fixture = await seed()
    const first = await generate(fixture)
    await adoptConstitutionExtractionCandidateV1({ scope: fixture.scope, runId: first.snapshot.run.id })
    await expect(generate(fixture)).rejects.toThrow('已存在')
    expect(await facts(fixture)).toHaveLength(2)
  })

  it('作者拒绝后候选不再恢复且事实库零写入', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    const rejected = await rejectConstitutionExtractionCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(rejected.projection.state).toBe('cancelled')
    expect(await facts(fixture)).toHaveLength(0)
    await expect(readPendingConstitutionExtractionCandidateV1({ scope: fixture.scope })).resolves.toBeNull()
  })

  it.each<ConstitutionExtractionBoundaryV1>([
    'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
    'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
  ])('采纳在 %s 中断后沿冻结批次幂等收敛', async boundary => {
    const fixture = await seed(boundary)
    const generated = await generate(fixture)
    await expect(adoptConstitutionExtractionCandidateV1({
      scope: fixture.scope,
      runId: generated.snapshot.run.id,
      onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
    })).rejects.toThrow(`interrupt:${boundary}`)
    if (boundary !== 'verification.accepted') {
      const recovery = await readRecoverableConstitutionExtractionRunV1({ scope: fixture.scope })
      expect(recovery?.safeToResume).toBe(true)
      expect(recovery?.candidate).toEqual(generated.candidate)
      expect(recovery?.adoptionPending).toBe(true)
      await expect(readPendingConstitutionExtractionCandidateV1({ scope: fixture.scope })).resolves.toBeNull()
    }
    const completed = await adoptConstitutionExtractionCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect(await facts(fixture)).toHaveLength(2)
    expect(completed.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
  })

  it('终验后候选事实或来源变化会撤销旧 receipt', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    await adoptConstitutionExtractionCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    const written = (await facts(fixture))[0]
    await db.temporalFacts.update(written.id!, { value: '作者改写值', updatedAt: Date.now() + 1 })
    await expect(adoptConstitutionExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })).rejects.toThrow('完成回执已过期')
    expect(await db.agentRuns.get(generated.snapshot.run.id)).toMatchObject({ status: 'paused', terminalReceiptHash: null })
  })

  it('未完成本地候选导入后取消，不在导入 Work 复活', async () => {
    const fixture = await seed()
    await generate(fixture)
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
    const imported = (await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(run => run.contractJson.includes('world-origin.constitution-extract'))!
    expect(imported.status).toBe('cancelled')
    expect(imported.terminalReceiptHash).toBeNull()
  })

  it('World/Work 严格隔离，旧组件直调模型和立即写入旁路下线', async () => {
    const fixture = await seed('isolation')
    const generated = await generate(fixture)
    const now = Date.now()
    const otherWorkId = await db.works.add({
      projectId: fixture.projectId, worldId: fixture.worldId, title: '另一作品', description: '',
      genres: ['fantasy'], status: 'drafting', targetWordCount: 10_000, createdAt: now, updatedAt: now,
    } as any) as number
    const otherWorkScope = { ...fixture.scope, workId: otherWorkId }
    await expect(readPendingConstitutionExtractionCandidateV1({ scope: otherWorkScope })).resolves.toBeNull()
    await expect(adoptConstitutionExtractionCandidateV1({
      scope: otherWorkScope, runId: generated.snapshot.run.id,
    })).rejects.toThrow()

    const otherWorldId = await db.worlds.add({
      projectId: fixture.projectId, code: `other-${now}`, name: '另一世界', description: '',
      currentVersion: 1, createdAt: now, updatedAt: now,
    }) as number
    const otherWorldWorkId = await db.works.add({
      projectId: fixture.projectId, worldId: otherWorldId, title: '另一世界作品', description: '',
      genres: ['fantasy'], status: 'drafting', targetWordCount: 10_000, createdAt: now, updatedAt: now,
    } as any) as number
    const otherWorldScope = { projectId: fixture.projectId, worldId: otherWorldId, workId: otherWorldWorkId }
    await expect(readPendingConstitutionExtractionCandidateV1({ scope: otherWorldScope })).resolves.toBeNull()
    await expect(adoptConstitutionExtractionCandidateV1({
      scope: otherWorldScope, runId: generated.snapshot.run.id,
    })).rejects.toThrow()

    const panel = readFileSync('src/components/facts/WorldConstitutionPanel.tsx', 'utf8')
    expect(panel).not.toContain('useAIStream')
    expect(panel).not.toContain('createAISessionKey')
    expect(panel).not.toContain('buildSettingAssertionExtractPrompt')
    expect(panel).not.toContain('parseSettingAssertionCandidates')
    expect(panel).not.toContain('adoptSetting(')
    expect(panel).not.toContain('db.worldGroups')
    expect(panel).toContain('generateConstitutionExtractionCandidateV1')
    expect(panel).toContain('adoptConstitutionExtractionCandidateV1')
  })
})
