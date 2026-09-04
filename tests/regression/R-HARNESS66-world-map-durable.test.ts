import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { ADOPTION_BY_TARGET } from '../../src/lib/registry/adoption-schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { adopt, hashAdoptFieldValueV1 } from '../../src/lib/registry/adopt'
import { parseVoronoiMapConfig } from '../../src/lib/ai/adapters/voronoi-map-adapter'
import * as mapAdapter from '../../src/lib/ai/adapters/voronoi-map-adapter'
import {
  abandonWorldMapConfigRunV1,
  adoptWorldMapConfigCandidateV1,
  type WorldMapConfigBoundaryV1,
  generateWorldMapConfigCandidateV1,
  readPendingWorldMapConfigCandidateV1,
  readRecoverableWorldMapConfigRunV1,
  rejectWorldMapConfigCandidateV1,
} from '../../src/lib/agent/run/world-map-config-durable'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'

async function seed(suffix = '') {
  const now = Date.now()
  const created = await seedCurrentWorkspace(`地图治理${suffix}`)
  const { projectId, worldId, workId } = created.scope
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now,
  }) as number
  await db.worldviews.add({
    projectId, worldId, worldGroupId,
    summary: '',
    worldStructure: '东西双陆', worldDimensions: '疆域东西横跨三千公里',
    continentLayout: '西陆与东海隔潮河相望', mountainsRivers: '东港在西京以东，相距六百公里',
    climateByRegion: '西暖东湿', naturalResourceOverview: '潮河盛产蓝盐',
    factionLayout: '西陆帝国与东海王国', regionDimensions: '西京、东港',
    races: '', politicsOverview: '', economyOverview: '', cultureOverview: '', createdAt: now, updatedAt: now,
  } as any)
  await db.geographies.add({
    projectId, worldId, worldGroupId, overview: '潮河是两国的天然边界',
    locations: JSON.stringify([{ id: 'current-port', name: '旧潮港', type: 'city', description: '潮河西岸港口', significance: '', parentId: null, order: 0 }]),
    worldMapData: '', createdAt: now, updatedAt: now,
  } as any)
  await db.importantLocations.add({
    projectId, worldId, name: '潮门要塞', tags: JSON.stringify(['要塞']), description: '守住潮河航道。',
    significance: '两国边界', parentId: null, sortOrder: 0, createdAt: now, updatedAt: now,
  } as any)
  const categoryId = await db.codexCategories.add({
    projectId, worldId, worldGroupId: null, domain: 'humanity', parentId: null, name: '势力',
    icon: '🏳️', builtInKey: 'faction', fieldSchema: '[]', hidden: false, order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  await db.codexEntries.add({
    projectId, worldId, worldGroupId, categoryId, name: '蓝盐商会', summary: '控制潮河盐运',
    description: '', fields: '{}', refs: '{}', tags: '[]', order: 0, createdAt: now, updatedAt: now,
  } as any)
  const worldNodeId = await db.worldNodes.add({
    projectId, worldId, worldGroupId, parentId: null, name: '潮钟界', description: '',
    sortOrder: 0, icon: '🌍', createdAt: now, updatedAt: now,
  } as any) as number
  const siblingNodeId = await db.worldNodes.add({
    projectId, worldId, worldGroupId, parentId: worldNodeId, name: '雾海层', description: '',
    sortOrder: 1, icon: '☁️', createdAt: now, updatedAt: now,
  } as any) as number
  await stampCurrentFixtureResourceUidsV1(projectId)
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, worldGroupId, worldNodeId, siblingNodeId,
  }
}

function response(nodeName = '潮钟界', extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    seed: 'h66-map-seed', mapName: nodeName, pointCount: 5000, landRatio: 0.68,
    continentCount: 1, stateCount: 2, burgDensity: 0.2, temperatureShift: 0,
    precipitationFactor: 1, heightmapTemplate: 'pangea', namingStyle: 'chinese',
    stateNames: ['西陆帝国', '东海王国'], burgNames: ['西京', '东港'], riverNames: ['潮河'],
    mapWidthKm: 3000, mapWidthEvidenceQuote: '疆域东西横跨三千公里',
    spatialEntities: [
      { name: '西陆帝国', kind: 'state', scaleTier: 'empire', capitalName: '西京', source: 'inferred' },
      { name: '东海王国', kind: 'state', scaleTier: 'kingdom', capitalName: '东港', source: 'inferred' },
      { name: '西京', kind: 'settlement', scaleTier: 'metropolis', source: 'explicit', evidenceQuote: '西京' },
      { name: '东港', kind: 'settlement', scaleTier: 'city', source: 'explicit', evidenceQuote: '东港' },
    ],
    spatialRelations: [{
      from: '东港', to: '西京', direction: 'east', distanceTier: 'far', distanceValue: 600,
      distanceUnit: 'km', source: 'explicit', evidenceQuote: '东港在西京以东，相距六百公里',
    }],
    ...extra,
  })
}

async function generate(fixture: Awaited<ReturnType<typeof seed>>, options: {
  boundary?: WorldMapConfigBoundaryV1
  output?: string
} = {}) {
  return generateWorldMapConfigCandidateV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    worldNodeId: fixture.worldNodeId,
    runAI: async messages => {
      const prompt = messages.map(message => message.content).join('\n')
      expect(prompt).toContain('疆域东西横跨三千公里')
      expect(prompt).toContain('潮河是两国的天然边界')
      expect(prompt).toContain('蓝盐商会')
      expect(prompt).toContain('潮门要塞')
      expect(prompt).toContain('潮钟界')
      return options.output ?? response()
    },
    onDurableBoundary: options.boundary ? boundary => {
      if (boundary === options.boundary) throw new Error(`interrupt:${boundary}`)
    } : undefined,
  })
}

describe.sequential('R-HARNESS66 · 世界地图 durable 配置候选与定点采纳', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('三注册表与 Skill 闭合，四个登记来源进入模型而候选确认前零正式写入', async () => {
    expect(CONTEXT_SOURCE_BY_KEY.get('geography')).toMatchObject({ scope: 'world', ownerFrom: 'world' })
    expect(FIELD_BY_TARGET.get('worldNodes')?.map(field => field.field)).toContain('mapConfigJSON')
    expect(ADOPTION_BY_TARGET.get('worldNodes')).toMatchObject({ recordOnly: true, ownerFrom: 'world' })
    expect(getAgentSkillV1('world-origin.map-config')).toMatchObject({
      agentId: 'world-origin', executionMode: 'map-config',
      contextSourceKeys: ['worldview', 'geography', 'codex', 'locations'],
      writeTargets: [{ table: 'worldNodes', fields: ['mapConfigJSON'] }],
    })
    const fixture = await seed()
    const assembled = await assembleContext({
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      sourceKeys: ['worldview', 'geography', 'codex', 'locations'],
    })
    expect(assembled.text).toContain('疆域东西横跨三千公里')
    expect(assembled.text).toContain('旧潮港')
    expect(assembled.text).toContain('蓝盐商会')
    expect(assembled.text).toContain('潮门要塞')
    const generated = await generate(fixture)
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(generated.candidate.mapConfig.mapName).toBe('潮钟界')
    expect((await db.worldNodes.get(fixture.worldNodeId))?.mapConfigJSON).toBeUndefined()
    expect(generated.snapshot.events.some(event => event.type === 'adoption.started')).toBe(false)
  })

  it('刷新恢复同一候选，作者确认后 exact-field CAS 写回并签发 terminal receipt', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    const recovered = await readPendingWorldMapConfigCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, worldNodeId: fixture.worldNodeId,
    })
    expect(recovered?.snapshot.run.id).toBe(generated.snapshot.run.id)
    expect(recovered?.candidate).toEqual(generated.candidate)
    const adopted = await adoptWorldMapConfigCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.receiptHash).toHaveLength(64)
    expect((await db.worldNodes.get(fixture.worldNodeId))?.mapConfigJSON).toBe(generated.candidate.mapConfigJSON)
    expect((await db.worldNodes.get(fixture.siblingNodeId))?.mapConfigJSON).toBeUndefined()
    await expect(readPendingWorldMapConfigCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, worldNodeId: fixture.worldNodeId,
    })).resolves.toBeNull()
  })

  it('最终 CAS 写边界拒绝未知字段、错误 baseline 和跨 scope 节点', async () => {
    const fixture = await seed()
    const baseline = await hashAdoptFieldValueV1(undefined)
    expect(baseline).not.toBe(await hashAdoptFieldValueV1(null))
    const unknown = await adopt({
      projectId: fixture.projectId, scope: fixture.scope, target: 'worldNodes',
      recordId: fixture.worldNodeId, mode: 'replace',
      data: { mapConfigJSON: JSON.stringify({ seed: 'candidate' }), injected: true },
      compareAndSet: { kind: 'record-field-value-hash', field: 'mapConfigJSON', expectedHash: baseline },
    })
    expect(unknown.written).toEqual([])
    expect(unknown.unknown).toEqual(['injected'])

    const wrongBaseline = await adopt({
      projectId: fixture.projectId, scope: fixture.scope, target: 'worldNodes',
      recordId: fixture.worldNodeId, mode: 'replace', data: { mapConfigJSON: JSON.stringify({ seed: 'candidate' }) },
      compareAndSet: { kind: 'record-field-value-hash', field: 'mapConfigJSON', expectedHash: '0'.repeat(64) },
    })
    expect(wrongBaseline.written).toEqual([])
    expect(wrongBaseline.skipped[0]?.reason).toContain('CAS 失败')

    await db.worldNodes.update(fixture.worldNodeId, { mapConfigJSON: null as unknown as string })
    const nullIsNotMissing = await adopt({
      projectId: fixture.projectId, scope: fixture.scope, target: 'worldNodes',
      recordId: fixture.worldNodeId, mode: 'replace', data: { mapConfigJSON: JSON.stringify({ seed: 'candidate' }) },
      compareAndSet: { kind: 'record-field-value-hash', field: 'mapConfigJSON', expectedHash: baseline },
    })
    expect(nullIsNotMissing.written).toEqual([])
    expect(nullIsNotMissing.skipped[0]?.reason).toContain('CAS 失败')
    await db.worldNodes.update(fixture.worldNodeId, { mapConfigJSON: undefined })

    const other = await seed('other-scope')
    const crossScope = await adopt({
      projectId: other.projectId, scope: other.scope, target: 'worldNodes',
      recordId: fixture.worldNodeId, mode: 'replace', data: { mapConfigJSON: JSON.stringify({ seed: 'candidate' }) },
      compareAndSet: { kind: 'record-field-value-hash', field: 'mapConfigJSON', expectedHash: baseline },
    })
    expect(crossScope.written).toEqual([])
    expect((await db.worldNodes.get(fixture.worldNodeId))?.mapConfigJSON).toBeUndefined()
  })

  it('严格协议拒绝额外字段、范围裁剪、伪造证据和缺失确定种子', async () => {
    const fixture = await seed()
    const context = (await assembleContext({
      projectId: fixture.projectId, scope: fixture.scope, worldGroupId: fixture.worldGroupId,
      sourceKeys: ['worldview', 'geography', 'codex', 'locations'],
    })).text
    expect(() => parseVoronoiMapConfig(response('潮钟界', { extra: true }), context)).toThrow('未允许字段')
    expect(() => parseVoronoiMapConfig(`\`\`\`json\n${response()}\n\`\`\``, context)).toThrow('代码围栏')
    expect(() => parseVoronoiMapConfig(response('潮钟界', { pointCount: 3000 }), context)).toThrow('pointCount')
    expect(() => parseVoronoiMapConfig(response('潮钟界', {
      mapWidthEvidenceQuote: '用户从未写过的三千公里',
    }), context)).toThrow('逐字引文')
    const missingSeed = JSON.parse(response())
    delete missingSeed.seed
    expect(() => parseVoronoiMapConfig(JSON.stringify(missingSeed), context)).toThrow('缺少字段 seed')
    await expect(generate(fixture, { output: JSON.stringify(missingSeed) })).rejects.toThrow('缺少字段 seed')
    expect((await db.worldNodes.get(fixture.worldNodeId))?.mapConfigJSON).toBeUndefined()
  })

  it('model.requested 后结果未知以及 model.responded 后未 checkpoint 都不自动重试', async () => {
    const first = await seed('requested')
    let calls = 0
    await expect(generateWorldMapConfigCandidateV1({
      scope: first.scope, worldGroupId: first.worldGroupId, worldNodeId: first.worldNodeId,
      runAI: async () => { calls++; throw new Error('provider-lost') },
    })).rejects.toThrow('provider-lost')
    const firstRecovery = await readRecoverableWorldMapConfigRunV1({
      scope: first.scope, worldGroupId: first.worldGroupId, worldNodeId: first.worldNodeId,
    })
    expect(calls).toBe(1)
    expect(firstRecovery?.safeToResume).toBe(false)
    expect((await db.agentRuns.get(firstRecovery!.snapshot.run.id))?.status).toBe('paused')
    await expect(readRecoverableWorldMapConfigRunV1({
      scope: first.scope, worldGroupId: first.worldGroupId, worldNodeId: first.siblingNodeId,
    })).resolves.toBeNull()

    const second = await seed('responded')
    await expect(generate(second, { boundary: 'model.responded' })).rejects.toThrow('interrupt:model.responded')
    const secondRecovery = await readRecoverableWorldMapConfigRunV1({
      scope: second.scope, worldGroupId: second.worldGroupId, worldNodeId: second.worldNodeId,
    })
    expect(secondRecovery?.safeToResume).toBe(false)
    await abandonWorldMapConfigRunV1({ scope: second.scope, runId: secondRecovery!.snapshot.run.id })
    expect((await db.agentRuns.get(secondRecovery!.snapshot.run.id))?.status).toBe('cancelled')
  })

  it('候选 checkpoint 后、candidate event 前中断可恢复同一输出且不重复模型调用', async () => {
    const fixture = await seed()
    let calls = 0
    await expect(generateWorldMapConfigCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, worldNodeId: fixture.worldNodeId,
      runAI: async () => { calls++; return response() },
      onDurableBoundary: boundary => { if (boundary === 'candidate.checkpoint') throw new Error('interrupt:candidate.checkpoint') },
    })).rejects.toThrow('interrupt:candidate.checkpoint')
    const recovered = await readPendingWorldMapConfigCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, worldNodeId: fixture.worldNodeId,
    })
    expect(calls).toBe(1)
    expect(recovered?.candidate.mapConfig.seed).toBe('h66-map-seed')
    expect(recovered?.snapshot.projection.state).toBe('awaiting_confirmation')
  })

  it.each([
    ['Context', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      const row = (await db.worldviews.where('projectId').equals(fixture.projectId).first())!
      await db.worldviews.update(row.id!, { worldDimensions: '作者改为东西五千公里', updatedAt: Date.now() + 1 })
    }],
    ['节点名', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.worldNodes.update(fixture.worldNodeId, { name: '潮钟界·改', updatedAt: Date.now() + 1 })
    }],
    ['原配置', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.worldNodes.update(fixture.worldNodeId, { mapConfigJSON: JSON.stringify({ seed: 'manual' }), updatedAt: Date.now() + 1 })
    }],
  ] as const)('%s 漂移使候选 stale，不覆盖作者当前正式地图', async (_label, mutate) => {
    const fixture = await seed(String(_label))
    const generated = await generate(fixture)
    await mutate(fixture)
    await expect(adoptWorldMapConfigCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })).rejects.toThrow('已变化')
    expect((await db.worldNodes.get(fixture.worldNodeId))?.mapConfigJSON).not.toBe(generated.candidate.mapConfigJSON)
  })

  it('Prompt 模板版本变化使候选 stale，不写正式地图', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    vi.spyOn(mapAdapter, 'readVoronoiMapPromptTemplateSnapshotV1').mockReturnValue([
      { role: 'system', content: '部署后的地图协议版本' },
      { role: 'user', content: '{{REGISTERED_CONTEXT}}' },
    ])
    await expect(adoptWorldMapConfigCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })).rejects.toThrow('已变化')
    expect((await db.worldNodes.get(fixture.worldNodeId))?.mapConfigJSON).toBeUndefined()
  })

  it('作者拒绝后候选不再恢复，正式地图保持不变', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    const rejected = await rejectWorldMapConfigCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })
    expect(rejected.projection.state).toBe('cancelled')
    expect((await db.worldNodes.get(fixture.worldNodeId))?.mapConfigJSON).toBeUndefined()
  })

  it.each<WorldMapConfigBoundaryV1>([
    'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
    'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
  ])('采纳在 %s 中断后沿冻结意图幂等收敛', async boundary => {
    const fixture = await seed(boundary)
    const generated = await generate(fixture)
    await expect(adoptWorldMapConfigCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
      onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
    })).rejects.toThrow(`interrupt:${boundary}`)
    const completed = await adoptWorldMapConfigCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect((await db.worldNodes.get(fixture.worldNodeId))?.mapConfigJSON).toBe(generated.candidate.mapConfigJSON)
    expect(completed.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
  })

  it('终验后正式配置改变会撤销旧 receipt，不冒充当前完成', async () => {
    const fixture = await seed()
    const generated = await generate(fixture)
    await adoptWorldMapConfigCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })
    await db.worldNodes.update(fixture.worldNodeId, { mapConfigJSON: JSON.stringify({ seed: 'author-after' }), updatedAt: Date.now() + 1 })
    await expect(adoptWorldMapConfigCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, runId: generated.snapshot.run.id,
    })).rejects.toThrow('完成回执已过期')
    const run = await db.agentRuns.get(generated.snapshot.run.id)
    expect(run?.status).toBe('paused')
    expect(run?.terminalReceiptHash).toBeNull()
  })

  it('未完成本地节点候选导入后取消，不在新 Work 复活', async () => {
    const fixture = await seed()
    await generate(fixture)
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
    const imported = (await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(run => run.contractJson.includes('world-origin.map-config'))!
    expect(imported.status).toBe('cancelled')
    expect(imported.terminalReceiptHash).toBeNull()
  })

  it('World、世界组和节点严格隔离，WorldMapPanel 直调模型与 AI updateNode 旁路已下线', async () => {
    const first = await seed('one')
    const generated = await generate(first)
    const second = await seed('two')
    await expect(readPendingWorldMapConfigCandidateV1({
      scope: second.scope, worldGroupId: second.worldGroupId, worldNodeId: second.worldNodeId,
    })).resolves.toBeNull()
    await expect(adoptWorldMapConfigCandidateV1({
      scope: second.scope, worldGroupId: second.worldGroupId, runId: generated.snapshot.run.id,
    })).rejects.toThrow()
    await expect(readPendingWorldMapConfigCandidateV1({
      scope: first.scope, worldGroupId: first.worldGroupId, worldNodeId: first.siblingNodeId,
    })).resolves.toBeNull()

    const panel = readFileSync('src/components/geography/WorldMapPanel.tsx', 'utf8')
    expect(panel).not.toContain('useAIStream')
    expect(panel).not.toMatch(/\bchat\s*\(/)
    expect(panel).not.toContain("db.worldviews")
    expect(panel).not.toContain("mapConfigJSON: JSON.stringify(config)")
    expect(panel).toContain('generateWorldMapConfigCandidateV1')
    expect(panel).toContain('adoptWorldMapConfigCandidateV1')
    const registry = JSON.parse(readFileSync('src/lib/agent/ai-entry-registry.json', 'utf8'))
    expect(registry.entries.some((entry: any) => entry.allowedCallers
      ?.some((file: string) => file.endsWith('WorldMapPanel.tsx')))).toBe(false)
  })
})
