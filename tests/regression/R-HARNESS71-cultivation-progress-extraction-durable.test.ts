import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { stringifyCultivationStages } from '../../src/lib/types'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { ADOPTION_EXTENSIONS } from '../../src/lib/registry/adoption-schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  parseCultivationProgressExtractionStrictV1,
  readCultivationProgressExtractionBaselineV1,
} from '../../src/lib/cultivation/progress'
import {
  abandonCultivationProgressExtractionRunV1,
  adoptCultivationProgressExtractionCandidateV1,
  generateCultivationProgressExtractionCandidateV1,
  readPendingCultivationProgressExtractionCandidateV1,
  readRecoverableCultivationProgressExtractionRunV1,
  rejectCultivationProgressExtractionCandidateV1,
  type CultivationProgressExtractionAdoptionBoundaryV1,
  type CultivationProgressExtractionBoundaryV1,
} from '../../src/lib/agent/run/cultivation-progress-extraction-durable'

async function seed(suffix = '') {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: `修炼进度${suffix}`, genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 100_000, enableMultiWorld: true,
createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `cultivation-${now}-${suffix}`, name: `剑界${suffix}`, description: '',
    currentVersion: 1, createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: `雷劫篇${suffix}`, description: '', genres: ['fantasy'],
    status: 'drafting', targetWordCount: 100_000, createdAt: now, updatedAt: now,
  } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: `剑界${suffix}`, description: '', type: 'primary', icon: '⚔️', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  const volumeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'volume', title: '卷一', summary: '',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const firstNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '初入炼体', summary: '',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const targetNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '雷雨破境', summary: '',
    order: 1, createdAt: now, updatedAt: now,
  } as any) as number
  const laterNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: volumeId, type: 'chapter', title: '剑胎已成', summary: '',
    order: 2, createdAt: now, updatedAt: now,
  } as any) as number
  const firstChapterId = await db.chapters.add({
    projectId, workId, outlineNodeId: firstNodeId, title: '初入炼体',
    content: '<p>林舟初次踏入炼体境，根基尚浅。</p>', wordCount: 20, status: 'draft', order: 0, notes: '',
    createdAt: now, updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId, workId, outlineNodeId: targetNodeId, title: '雷雨破境',
    content: '<p>雷声滚过山谷，林舟承受九次雷击，终于正式凝成剑胎。</p>',
    wordCount: 30, status: 'draft', order: 1, notes: '', createdAt: now, updatedAt: now,
  } as any) as number
  const laterChapterId = await db.chapters.add({
    projectId, workId, outlineNodeId: laterNodeId, title: '剑胎已成',
    content: '<p>林舟剑胎稳固，行走山门。</p>', wordCount: 20, status: 'draft', order: 2, notes: '',
    createdAt: now, updatedAt: now,
  } as any) as number
  const systemId = await db.cultivationSystems.add({
    projectId, worldId, worldGroupId, name: '剑修', description: '',
    stages: stringifyCultivationStages([
      { id: 'body', name: '炼体', parentStageIds: [] },
      { id: 'sword', name: '剑胎', parentStageIds: ['body'] },
      { id: 'core', name: '剑丹', parentStageIds: ['sword'] },
    ]),
    createdAt: now, updatedAt: now,
  }) as number
  const characterId = await db.characters.add({
    projectId, worldId, name: '林舟', role: 'protagonist', roleWeight: 'main',
    moralAxis: 'good', orderAxis: 'lawful', cultivationSystemId: systemId,
    homeWorldGroupId: worldGroupId, isCrossWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  const firstProgressId = await db.cultivationProgress.add({
    projectId, workId, worldGroupId, characterId, characterName: '林舟', cultivationSystemId: systemId,
    cultivationSystemName: '剑修', stageId: 'body', stageName: '炼体', transition: 'enter',
    sourceChapterId: firstChapterId, sourceChapterTitle: '初入炼体', sourceQuote: '初次踏入炼体境',
    sourceOffset: 2, trigger: '', status: 'confirmed', createdAt: now, updatedAt: now,
  } as any) as number
  const laterProgressId = await db.cultivationProgress.add({
    projectId, workId, worldGroupId, characterId, characterName: '林舟', cultivationSystemId: systemId,
    cultivationSystemName: '剑修', stageId: 'core', stageName: '剑丹', transition: 'advance',
    sourceChapterId: laterChapterId, sourceChapterTitle: '剑胎已成', sourceQuote: '剑胎稳固',
    sourceOffset: 2, trigger: '', status: 'confirmed', createdAt: now, updatedAt: now,
  } as any) as number
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, worldGroupId, chapterId, systemId, characterId,
    firstProgressId, laterProgressId,
  }
}

function response(fixture: Awaited<ReturnType<typeof seed>>) {
  return JSON.stringify({
    events: [{
      characterId: fixture.characterId,
      cultivationSystemId: fixture.systemId,
      stageId: 'sword',
      trigger: '承受九次雷击',
      quote: '正式凝成剑胎',
    }],
  })
}

async function generate(fixture: Awaited<ReturnType<typeof seed>>, options: {
  output?: string
  boundary?: CultivationProgressExtractionBoundaryV1
  inspect?: (prompt: string) => void
} = {}) {
  return generateCultivationProgressExtractionCandidateV1({
    scope: fixture.scope,
    chapterId: fixture.chapterId,
    worldGroupId: fixture.worldGroupId,
    runAI: async messages => {
      options.inspect?.(messages.map(message => message.content).join('\n'))
      return options.output ?? response(fixture)
    },
    onDurableBoundary: options.boundary ? boundary => {
      if (boundary === options.boundary) throw new Error(`interrupt:${boundary}`)
    } : undefined,
  })
}

async function progress(fixture: Awaited<ReturnType<typeof seed>>) {
  return (await db.cultivationProgress.where('projectId').equals(fixture.projectId).toArray())
    .filter(row => row.workId === fixture.workId)
    .sort((left, right) => left.id! - right.id!)
}

describe.sequential('R-HARNESS71 · 修炼进度 durable 提取', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('三注册表/Skill 闭合，登记正文、角色、DAG 与既有进度进入模型，候选前零写入', async () => {
    expect(CONTEXT_SOURCE_BY_KEY.get('cultivationProgressExtractionBaseline')).toMatchObject({
      scope: 'chapter', ownerFrom: 'work', requiresChapterId: true, requiresWorldGroupId: true,
    })
    expect(ADOPTION_EXTENSIONS.find(item => item.id === 'cultivation-progress-lifecycle')).toMatchObject({ target: 'cultivationProgress' })
    expect(PROJECT_TABLES.find(item => item.name === 'cultivationProgress')).toMatchObject({ exportable: true, worldScoped: true })
    expect(getAgentSkillV1('prose.cultivation-progress-extraction')).toMatchObject({
      agentId: 'prose', executionMode: 'cultivation-progress-extraction',
      contextSourceKeys: ['chapterContent', 'cultivationProgressExtractionBaseline'],
      writeTargets: [expect.objectContaining({ table: 'cultivationProgress', adoptionExtension: 'cultivation-progress-lifecycle' })],
    })
    const fixture = await seed()
    const before = await progress(fixture)
    const generated = await generate(fixture, { inspect: prompt => {
      expect(prompt).toContain('正式凝成剑胎')
      expect(prompt).toContain(String(fixture.characterId))
      expect(prompt).toContain(String(fixture.systemId))
      expect(prompt).toContain('parentStageIds')
      expect(prompt).toContain('confirmedProgress')
      expect(prompt).not.toContain('"transition":"enter|advance|regress|switch"')
    } })
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(generated.candidate.events).toHaveLength(1)
    expect(await progress(fixture)).toEqual(before)
  })

  it('刷新恢复同一候选；选择确认后原子写入并按规范章序重算后续 transition', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    const pending = await readPendingCultivationProgressExtractionCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId,
    })
    expect(pending?.candidate).toEqual(generated.candidate)
    const adopted = await adoptCultivationProgressExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.written).toBe(1)
    expect(await progress(fixture)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: fixture.firstProgressId, stageId: 'body', transition: 'enter' }),
      expect.objectContaining({ sourceChapterId: fixture.chapterId, stageId: 'sword', transition: 'advance' }),
      expect.objectContaining({ id: fixture.laterProgressId, stageId: 'core', transition: 'advance' }),
    ]))
  })

  it('严格协议拒绝围栏、额外字段、字符串 ID、未知闭集、非唯一证据、重复和乱序', async () => {
    const fixture = await seed()
    const baseline = await readCultivationProgressExtractionBaselineV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
    })
    const valid = JSON.parse(response(fixture))
    expect(() => parseCultivationProgressExtractionStrictV1({ raw: `\`\`\`json\n${response(fixture)}\n\`\`\``, baseline })).toThrow('严格 JSON')
    expect(() => parseCultivationProgressExtractionStrictV1({ raw: JSON.stringify({ ...valid, extra: true }), baseline })).toThrow('字段')
    expect(() => parseCultivationProgressExtractionStrictV1({ raw: JSON.stringify({ events: [{ ...valid.events[0], transition: 'advance' }] }), baseline })).toThrow('字段')
    expect(() => parseCultivationProgressExtractionStrictV1({ raw: JSON.stringify({ events: [{ ...valid.events[0], characterId: String(fixture.characterId) }] }), baseline })).toThrow('类型')
    expect(() => parseCultivationProgressExtractionStrictV1({ raw: JSON.stringify({ events: [{ ...valid.events[0], stageId: 'unknown' }] }), baseline })).toThrow('闭集')
    expect(() => parseCultivationProgressExtractionStrictV1({ raw: JSON.stringify({ events: [{ ...valid.events[0], quote: '不存在的引文' }] }), baseline })).toThrow('证据')
    expect(() => parseCultivationProgressExtractionStrictV1({ raw: JSON.stringify({ events: [valid.events[0], valid.events[0]] }), baseline })).toThrow('重复')
  })

  it('空结果可确认成终验报告且不改变正式进度', async () => {
    const fixture = await seed()
    const before = await progress(fixture)
    const generated = await generate(fixture, { output: '{"events":[]}' })
    const adopted = await adoptCultivationProgressExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [],
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.written).toBe(0)
    expect(await progress(fixture)).toEqual(before)
  })

  it('model.requested 未知结果与 model.responded 未 checkpoint 均不可自动重试', async () => {
    const unknown = await seed('unknown')
    let calls = 0
    await expect(generateCultivationProgressExtractionCandidateV1({
      scope: unknown.scope, chapterId: unknown.chapterId, worldGroupId: unknown.worldGroupId,
      runAI: async () => { calls += 1; throw new Error('provider-lost') },
    })).rejects.toThrow('provider-lost')
    expect(calls).toBe(1)
    expect((await readRecoverableCultivationProgressExtractionRunV1({ scope: unknown.scope }))?.safeToResume).toBe(false)

    const responded = await seed('responded')
    await expect(generate(responded, { boundary: 'model.responded' })).rejects.toThrow('interrupt:model.responded')
    const recovery = await readRecoverableCultivationProgressExtractionRunV1({ scope: responded.scope })
    expect(recovery?.safeToResume).toBe(false)
    await abandonCultivationProgressExtractionRunV1({ scope: responded.scope, runId: recovery!.snapshot.run.id })
  })

  it('candidate checkpoint 后中断可重建事件，且不重复调用模型', async () => {
    const fixture = await seed()
    let calls = 0
    await expect(generateCultivationProgressExtractionCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
      runAI: async () => { calls += 1; return response(fixture) },
      onDurableBoundary: boundary => { if (boundary === 'candidate.checkpoint') throw new Error('interrupt:candidate.checkpoint') },
    })).rejects.toThrow('interrupt:candidate.checkpoint')
    const pending = await readPendingCultivationProgressExtractionCandidateV1({ scope: fixture.scope })
    expect(calls).toBe(1)
    expect(pending?.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(pending?.candidate.events).toHaveLength(1)
  })

  it.each([
    ['正文', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.chapters.update(fixture.chapterId, { content: '<p>作者重写了目标章节，但字数仍然足够用于分析。</p>', updatedAt: Date.now() + 1 })
    }],
    ['角色', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.characters.update(fixture.characterId, { name: '林舟改名', updatedAt: Date.now() + 1 })
    }],
    ['体系 DAG', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.cultivationSystems.update(fixture.systemId, {
        stages: stringifyCultivationStages([
          { id: 'body', name: '炼体', parentStageIds: [] },
          { id: 'sword', name: '剑胎改', parentStageIds: ['body'] },
          { id: 'core', name: '剑丹', parentStageIds: ['sword'] },
        ]),
        updatedAt: Date.now() + 1,
      })
    }],
    ['既有进度', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.cultivationProgress.update(fixture.firstProgressId, { trigger: '作者补充', updatedAt: Date.now() + 1 })
    }],
  ] as const)('%s 漂移令候选 stale 且零写入', async (_label, mutate) => {
    const fixture = await seed(String(_label))
    const generated = await generate(fixture)
    const before = await progress(fixture)
    await mutate(fixture)
    await expect(adoptCultivationProgressExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow('已变化')
    expect((await progress(fixture)).filter(row => row.sourceChapterId === fixture.chapterId)).toHaveLength(0)
    expect(before).toHaveLength(2)
  })

  it.each([
    'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
    'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
  ] satisfies CultivationProgressExtractionAdoptionBoundaryV1[])('%s 中断后同一选择幂等收敛且不重复正式事件', async boundary => {
    const fixture = await seed(boundary)
    const generated = await generate(fixture)
    await expect(adoptCultivationProgressExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
      onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${current}`) },
    })).rejects.toThrow(`interrupt:${boundary}`)
    const recovered = await readRecoverableCultivationProgressExtractionRunV1({ scope: fixture.scope })
    if (boundary === 'verification.accepted') expect(recovered).toBeNull()
    else expect(recovered?.candidate).toBeDefined()
    const result = await adoptCultivationProgressExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })
    expect(result.snapshot.projection.state).toBe('completed')
    expect((await progress(fixture)).filter(row => row.sourceChapterId === fixture.chapterId)).toHaveLength(1)
  })

  it('拒绝候选保持零写；选择冻结后不可换项或放弃', async () => {
    const rejectedFixture = await seed('reject')
    const rejected = await generate(rejectedFixture)
    await rejectCultivationProgressExtractionCandidateV1({ scope: rejectedFixture.scope, runId: rejected.snapshot.run.id })
    expect((await progress(rejectedFixture)).filter(row => row.sourceChapterId === rejectedFixture.chapterId)).toHaveLength(0)

    const frozenFixture = await seed('frozen')
    const frozen = await generate(frozenFixture)
    await expect(adoptCultivationProgressExtractionCandidateV1({
      scope: frozenFixture.scope, runId: frozen.snapshot.run.id, selectedIndexes: [0],
      onDurableBoundary: boundary => { if (boundary === 'intent.checkpoint') throw new Error('interrupt:intent') },
    })).rejects.toThrow('interrupt:intent')
    await expect(adoptCultivationProgressExtractionCandidateV1({
      scope: frozenFixture.scope, runId: frozen.snapshot.run.id, selectedIndexes: [],
    })).rejects.toThrow('冻结意图')
    await expect(abandonCultivationProgressExtractionRunV1({
      scope: frozenFixture.scope, runId: frozen.snapshot.run.id,
    })).rejects.toThrow('已冻结')
  })

  it('终验后正式事件漂移会撤销 receipt', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    const adopted = await adoptCultivationProgressExtractionCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })
    const inserted = (await progress(fixture)).find(row => row.sourceChapterId === fixture.chapterId)!
    await db.cultivationProgress.update(inserted.id!, { trigger: '作者改写', updatedAt: Date.now() + 1 })
    await expect(adoptCultivationProgressExtractionCandidateV1({
      scope: fixture.scope, runId: adopted.snapshot.run.id,
    })).rejects.toThrow('回执已过期')
  })

  it('未完成本地候选导入后取消，不在导入 Work 复活', async () => {
    const fixture = await seed()
    await generate(fixture)
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
    const imported = (await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(run => run.contractJson.includes('prose.cultivation-progress-extraction'))!
    expect(imported.status).toBe('cancelled')
    expect(imported.terminalReceiptHash).toBeNull()
  })

  it('World/Work 严格隔离，旧组件直调与逐条写入旁路下线', async () => {
    const fixture = await seed('isolation')
    const generated = await generate(fixture)
    const now = Date.now()
    const otherWorkId = await db.works.add({
      projectId: fixture.projectId, worldId: fixture.worldId, title: '另一作品', description: '',
      genres: ['fantasy'], status: 'drafting', targetWordCount: 10_000, createdAt: now, updatedAt: now,
    } as any) as number
    const otherWork = { ...fixture.scope, workId: otherWorkId }
    await expect(readPendingCultivationProgressExtractionCandidateV1({ scope: otherWork })).resolves.toBeNull()
    await expect(adoptCultivationProgressExtractionCandidateV1({
      scope: otherWork, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow()

    const otherWorldId = await db.worlds.add({
      projectId: fixture.projectId, code: `other-${now}`, name: '另一世界', description: '',
      currentVersion: 1, createdAt: now, updatedAt: now,
    }) as number
    const otherWorldWorkId = await db.works.add({
      projectId: fixture.projectId, worldId: otherWorldId, title: '另一世界作品', description: '',
      genres: ['fantasy'], status: 'drafting', targetWordCount: 10_000, createdAt: now, updatedAt: now,
    } as any) as number
    const otherWorld = { projectId: fixture.projectId, worldId: otherWorldId, workId: otherWorldWorkId }
    await expect(readPendingCultivationProgressExtractionCandidateV1({ scope: otherWorld })).resolves.toBeNull()
    await expect(adoptCultivationProgressExtractionCandidateV1({
      scope: otherWorld, runId: generated.snapshot.run.id, selectedIndexes: [0],
    })).rejects.toThrow()

    const panel = readFileSync('src/components/cultivation/CultivationProgressPanel.tsx', 'utf8')
    expect(panel).not.toContain('chat(')
    expect(panel).not.toContain('buildCultivationProgressPrompt')
    expect(panel).not.toContain('parseCultivationProgressResult')
    expect(panel).not.toContain('acceptCultivationProgressCandidate')
    expect(panel).toContain('generateCultivationProgressExtractionCandidateV1')
    expect(panel).toContain('adoptCultivationProgressExtractionCandidateV1')
  })
})
