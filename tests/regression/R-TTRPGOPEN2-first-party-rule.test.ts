import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { STORYFORGE_RULE_PACK_V1 } from '../../src/lib/ttrpg/storyforge-rule-pack'
import { createStoryForgeOpenRulePackV2 } from '../../src/lib/ttrpg/storyforge-open-rule-pack'
import { projectTtrpgRulePackMechanicalCoreV1 } from '../../src/lib/ttrpg/rule-pack-v2'
import { resolveRulePackCheckV1, runRulePackFixturesV1 } from '../../src/lib/ttrpg/rule-pack'
import { resolveTtrpgOracleV1, verifyTtrpgOracleOutcomeV1, assertTtrpgOracleInterpretationScopeV1 } from '../../src/lib/ttrpg/oracle'
import { listValidatedTtrpgRulePacksV1, listValidatedTtrpgRulePacksV2, saveTtrpgRulePackV1, saveTtrpgRulePackV2, readTtrpgRulePackVersionedV1 } from '../../src/lib/ttrpg/rule-pack-library'

describe('R-TTRPGOPEN2 first-party open rules', () => {
  it('leaves the original first-party content untouched and supplies a distinct clone with real mechanical checks', async () => {
    const original = JSON.stringify(STORYFORGE_RULE_PACK_V1), rule = createStoryForgeOpenRulePackV2()
    expect(rule.ruleSystemVersion).toBe('3.0.0'); expect(rule.license).toEqual(STORYFORGE_RULE_PACK_V1.license)
    expect(rule.actions).toEqual(STORYFORGE_RULE_PACK_V1.actions)
    const core = projectTtrpgRulePackMechanicalCoreV1(rule)
    expect(() => runRulePackFixturesV1(core)).not.toThrow()
    for (const check of rule.genericChecks) {
      const result = await resolveRulePackCheckV1({ rulePack: core, checkKey: check.checkKey, attributeKey: check.actorAttributeKey,
        attributes: { body: 1, mind: 1, presence: 1 }, seed: 'first-party.check', nonce: check.checkKey, difficulty: check.difficulty })
      expect(result.checkKey).toBe(check.checkKey)
      expect(Object.values(check.effectPlanByDegree).every(value => value === null)).toBe(true)
      expect(check.riskFactRefs).toEqual([])
    }
    await expect(resolveRulePackCheckV1({ rulePack: core, checkKey: 'open.body', attributeKey: 'mind', attributes: { body: 1, mind: 1 }, seed: 'x', nonce: 'x' })).rejects.toThrow('不允许属性')
    rule.actions[0].name = 'local change'; rule.factPolicy[0].authority.invariant = null
    expect(createStoryForgeOpenRulePackV2().actions).toEqual(STORYFORGE_RULE_PACK_V1.actions)
    expect(JSON.stringify(STORYFORGE_RULE_PACK_V1)).toBe(original)
  })

  it('replays the frozen Oracle examples through the original deterministic resolver', async () => {
    const rulePack = createStoryForgeOpenRulePackV2(), oracle = rulePack.oracles[0]
    // Fixed independent observations retained in open-rule-first-kernel-observation-v1.log.
    // Do not calculate expected outcomes with the resolver being tested.
    const expectedDice: Record<string, number> = { 'fixture.1': 3, 'fixture.2': 6, 'fixture.3': 1, 'fixture.7': 4 }
    for (const fixture of oracle.tests) {
      const commandId = fixture.nonce.slice(`oracle:${oracle.oracleKey}:`.length)
      const result = await resolveTtrpgOracleV1({ rulePack, oracleKey: oracle.oracleKey, question: '情况是否如此？', askedBy: 'gm',
        seed: fixture.seed, commandId, eventSequence: 1, likelihoodTierKey: fixture.likelihoodTierKey })
      expect(result.rollReceipt.nonce).toBe(fixture.nonce)
      expect(result.rollReceipt.diceResolution.total).toBe(expectedDice[commandId])
      expect(result.outcome.rawResult).toBe(fixture.expectedRawResult)
      await expect(verifyTtrpgOracleOutcomeV1({ rulePack, seed: fixture.seed, ...result })).resolves.toBe(true)
    }
  })

  it('keeps mechanical owners distinct and forbids Oracle world/retcon/player/rule writes and new entities', () => {
    const rule = createStoryForgeOpenRulePackV2()
    expect(rule.factPolicy).toHaveLength(12)
    expect(rule.factPolicy.find(policy => policy.predicateKey === 'owns')?.authority).toEqual({ invariant: null, initialState: 'inventory', session: 'inventory' })
    expect(rule.factPolicy.find(policy => policy.predicateKey === 'located-at')?.authority).toEqual({ invariant: null, initialState: 'entity', session: 'entity' })
    expect(rule.factPolicy.find(policy => policy.predicateKey === 'allied-with')?.authority.session).toBe('social-ledger')
    for (const scope of ['world-fact', 'retcon', 'player-decision', 'rule-change'] as const) {
      expect(() => assertTtrpgOracleInterpretationScopeV1({ oracle: rule.oracles[0], attemptedScopes: [scope], newEntityCount: 0 })).toThrow('oracle-scope')
    }
    expect(() => assertTtrpgOracleInterpretationScopeV1({ oracle: rule.oracles[0], attemptedScopes: [], newEntityCount: 1 })).toThrow('max-new-entities')
    expect(rule.timePolicy).toMatchObject({ existingAction: 1, genericCheck: 1, outOfCharacter: 0, view: 0, preflight: 0, rulesQuestion: 0, oracleConsultation: 0 })
  })
})

describe('first-party rules retain the original Work library lifecycle', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('saves once, preserves exact historical V1 and V2 rows, rejects changed same-version content and never leaks across Works', async () => {
    const { scope } = await createWorkspace({ name: '开放规则', description: '', genres: [], status: 'drafting', targetWordCount: 10000 }, { kind: 'ttrpg' })
    const other = await createWorkspace({ name: '另一作品', description: '', genres: [], status: 'drafting', targetWordCount: 10000 }, { kind: 'ttrpg' })
    const legacy = await saveTtrpgRulePackV1({ scope, rulePack: STORYFORGE_RULE_PACK_V1 })
    const rule = createStoryForgeOpenRulePackV2(), saved = await saveTtrpgRulePackV2({ scope, rulePack: rule, immutable: true })
    expect(await saveTtrpgRulePackV2({ scope, rulePack: rule, immutable: true })).toEqual(saved)
    expect(await listValidatedTtrpgRulePacksV1(scope)).toEqual([legacy]); expect(await listValidatedTtrpgRulePacksV2(scope)).toEqual([saved])
    expect(await listValidatedTtrpgRulePacksV2(other.scope)).toEqual([])
    await expect(readTtrpgRulePackVersionedV1({ scope: other.scope, rulePackId: saved.id! })).rejects.toThrow()
    await expect(saveTtrpgRulePackV2({ scope, rulePack: { ...rule, description: 'clashing content' }, immutable: true })).rejects.toThrow('不可修改')
    expect(await db.ttrpgRulePacks.get(saved.id!)).toEqual(saved); expect(await db.ttrpgRulePacks.get(legacy.id!)).toEqual(legacy)
    expect(await db.agentRuns.count()).toBe(0)
  })
})
