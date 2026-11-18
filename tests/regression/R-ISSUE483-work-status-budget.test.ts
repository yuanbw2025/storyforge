import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { evidenceFromContextResult } from '../../src/lib/agent/context-policy'
import { getAgentSkillV1, validateAgentSkillContextEvidenceV1 } from '../../src/lib/agent/skill-registry'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

describe('Issue483: saved chapter status remains admissible under its source budget', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it.each(['world-origin.creative-rules', 'world-origin.worldview-field'])('%s accepts real budget evidence without modifying the work', async skillId => {
    const { scope } = await seedCurrentWorkspace('Budget regression')
    const rows = Array.from({ length: 90 }, (_, index) => stampNewRecord(scope, 'outlineNodes', {
      projectId: scope.projectId, parentId: null, worldGroupId: null,
      type: 'chapter' as const, title: `潮汐归来的第${index + 1}章`, summary: '保留已有作者规划',
      order: index, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    await db.outlineNodes.bulkAdd(rows)
    const before = await db.outlineNodes.toArray()
    const assembled = await assembleContext({ projectId: scope.projectId, scope,
      worldGroupId: null, sourceKeys: ['workStatus'], inputBudgetMaxTokens: 12_000 })
    const status = assembled.sourceEvidence?.find(source => source.key === 'workStatus')!
    expect(status).toMatchObject({ delivery: 'truncated', compression: {
      outcome: 'fallback', fallback: 'deterministic-truncation', attempts: 0,
    } })
    expect(status.originalTokens).toBeGreaterThan(status.inputTokens)
    const skill = getAgentSkillV1(skillId)
    const evidence = evidenceFromContextResult('balanced', assembled)
    expect(() => validateAgentSkillContextEvidenceV1(skill, evidence)).not.toThrow()
    const altered = { ...evidence, sourceEvidence: evidence.sourceEvidence!.map(source => ({
      ...source, compression: { ...source.compression!, sourceHash: 'invalid' },
    })) }
    expect(() => validateAgentSkillContextEvidenceV1(skill, altered)).toThrow('压缩证据无效')
    expect(() => validateAgentSkillContextEvidenceV1(skill, {
      ...evidence, included: [...evidence.included, 'private-unregistered-source'],
    })).toThrow('越权')
    expect(await db.outlineNodes.toArray()).toEqual(before)
    expect(await db.agentRuns.count()).toBe(0)
  })
})
