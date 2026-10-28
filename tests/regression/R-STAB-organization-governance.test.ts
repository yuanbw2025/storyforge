import { describe, expect, it } from 'vitest'
import { getAgentSkillV1, resolveAgentSkillContextSourceKeysV1 } from '../../src/lib/agent/skill-registry'
import { buildChapterOrganizationRunContractV1, CHAPTER_ORGANIZATION_SOURCE_KEYS_V1, CHAPTER_ORGANIZATION_DURABLE_VERIFIER_SET_V1, CHAPTER_ORGANIZATION_DURABLE_VERIFIER_SET_V2, hashChapterOrganizationPostStateForContractV2, hashChapterOrganizationPostStateV1 } from '../../src/lib/agent/run/chapter-organization-durable'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { db } from '../../src/lib/db/schema'

const skill = getAgentSkillV1('prose.organize', 'prose')
describe('manual and post-adoption organization share the registered seven-domain authority', () => {
  it('uses the complete registered source set, including storylines and their existing progress', () => {
    expect(CHAPTER_ORGANIZATION_SOURCE_KEYS_V1).toEqual(resolveAgentSkillContextSourceKeysV1(skill))
  })
  it('freezes every registered write target and extension in the manual Run contract', () => {
    const contract = buildChapterOrganizationRunContractV1({ projectId: 1, worldGroupId: null, chapterId: 1, runtimeBindingHash: '1'.repeat(64) })
    expect(contract.permissions.writeTargets).toEqual(skill.writeTargets.map(target => ({ ...target, fields: [...target.fields], mode: 'author-confirmed' })))
    expect(contract.verificationPlan.find(plan => plan.kind === 'terminal')?.verifier).toBe(CHAPTER_ORGANIZATION_DURABLE_VERIFIER_SET_V2)
    expect(CHAPTER_ORGANIZATION_DURABLE_VERIFIER_SET_V1).toBe('chapter-organization-terminal-v1')
  })
  it.each(['storyArcs', 'storylineProgress', 'storylineCrossings'] as const)('V2 captures %s while the historical V1 preimage stays unchanged', async table => {
    const created = await seedCurrentWorkspace(`整理核验 ${table}`)
    const scope = created.scope
    const contract = buildChapterOrganizationRunContractV1({ projectId: scope.projectId, worldGroupId: null, chapterId: 17, runtimeBindingHash: '1'.repeat(64) })
    const legacyBefore = await hashChapterOrganizationPostStateV1({ scope, chapterId: 17 })
    const before = await hashChapterOrganizationPostStateForContractV2({ scope, chapterId: 17, contract })
    const base = { projectId: scope.projectId, createdAt: 100, updatedAt: 100 }
    const row = table === 'storyArcs'
      ? { ...base, name: '确认交接', type: 'main', description: '正文确认后核验路线', stages: '[]' }
      : table === 'storylineProgress'
        ? { ...base, arcId: 1, currentStageId: null, status: 'active', progressNote: '完成交接', lastActiveChapterId: 17, lastActiveChapterTitle: '交接', involvedEntities: '[]', evidenceQuote: '把钥匙交给守门人' }
        : { ...base, arcIdA: 1, arcIdB: 2, chapterId: 17, chapterTitle: '交接', note: '两线在此交接', evidenceQuote: '把钥匙交给守门人' }
    await db.table(table).add(stampNewRecord(scope, table, row, { owner: 'work' }))
    expect(await hashChapterOrganizationPostStateForContractV2({ scope, chapterId: 17, contract })).not.toBe(before)
    expect(await hashChapterOrganizationPostStateV1({ scope, chapterId: 17 })).toBe(legacyBefore)
    await expect(hashChapterOrganizationPostStateForContractV2({ scope, chapterId: 18, contract })).rejects.toThrow('作用域')
  })
})
