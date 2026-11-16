import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedSFQA086Continuity } from '../helpers/sfqa086-continuity'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { buildLongTermConsistencyDossierV1 } from '../../src/lib/memory/consistency-dossier'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { useAIConfigStore } from '../../src/stores/ai-config'
import type { TemporalFact } from '../../src/lib/types/temporal-fact'

const value = '无界替代事实不应进入正史'
type Fixture = Awaited<ReturnType<typeof seedSFQA086Continuity>>

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

async function addFact(f: Fixture, status: TemporalFact['status'], validToChapterId: number | null) {
  return db.temporalFacts.add(stampNewRecord<TemporalFact>(f.created.scope, 'temporalFacts', {
    projectId: f.created.scope.projectId,
    subjectName: '蓝门', predicate: 'state', value, factKind: 'state', worldGroupId: null,
    sourceType: 'chapter', sourceChapterId: f.priorId, validFromChapterId: f.priorId,
    validToChapterId, status, locked: false, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' }))
}

async function dossier(f: Fixture, boundaryChapterId = f.priorId) {
  return buildLongTermConsistencyDossierV1({ scope: f.created.scope, boundaryChapterId, perspectiveCharacterId: null })
}

describe('SFQA-124 · the required dossier applies shared Canon eligibility before temporal projection', () => {
  it('does not promote an unbounded superseded fact, while retaining the original row for review', async () => {
    const f = await seedSFQA086Continuity()
    const id = await addFact(f, 'superseded', null)
    const result = await dossier(f)
    expect(result.structuredFacts.join('\n')).not.toContain(value)
    expect(result.sourceRefs.some(ref => ref.table === 'temporalFacts' && ref.recordId === id)).toBe(false)
    expect((await db.temporalFacts.get(id))?.status).toBe('superseded')
  })

  it('rejects an unknown cutoff rather than treating the helper eligibility as a real chapter boundary', async () => {
    const f = await seedSFQA086Continuity()
    await addFact(f, 'superseded', 999999)
    expect((await dossier(f)).structuredFacts.join('\n')).not.toContain(value)
  })

  it('preserves bounded historical projection before the cutoff and removes it at the actual cutoff', async () => {
    const f = await seedSFQA086Continuity()
    const id = await addFact(f, 'superseded', f.targetId)
    expect((await dossier(f)).structuredFacts.join('\n')).toContain(value)
    expect((await dossier(f, f.targetId)).structuredFacts.join('\n')).not.toContain(value)
    expect((await db.temporalFacts.get(id))?.status).toBe('superseded')
  })

  it('retains current confirmed facts and structural findings for stale evidence without promoting that evidence', async () => {
    const f = await seedSFQA086Continuity()
    const confirmedId = await addFact(f, 'confirmed', null)
    for (const status of ['stale', 'source-missing', 'invalid-range'] as const) await addFact(f, status, null)
    const result = await dossier(f)
    expect(result.structuredFacts).toHaveLength(1)
    expect(result.structuredFacts[0]).toContain(value)
    expect(result.sourceRefs.some(ref => ref.recordId === confirmedId && ref.status === 'current')).toBe(true)
    expect(result.findings.filter(item => item.code === 'source-stale')).toHaveLength(3)
    expect(result.tokenBudget.modelCalls).toBe(0)
  })

  it('the actual formal prose packet cannot regain an unbounded superseded value through its mandatory dossier', async () => {
    const f = await seedSFQA086Continuity()
    await addFact(f, 'superseded', null)
    const result = await prepareProseGatewayAssemblyV1({ projectId: f.created.scope.projectId, scope: f.created.scope, worldGroupId: null, chapterId: f.targetId, outlineNodeId: f.outlineId, operation: 'generate', authorRequest: '打开蓝门', config: useAIConfigStore.getState().config })
    expect(result.text).not.toContain(value)
    expect(await db.agentRuns.count()).toBe(0)
  })
})
