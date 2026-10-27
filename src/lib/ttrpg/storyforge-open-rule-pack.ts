import type { RulePackV2, TtrpgOpenFactPolicyV1, TtrpgOpenGenericCheckV1 } from './open-contract'
import { createStoryForgeRulePackV1 } from './storyforge-rule-pack'
import { parseRulePackV2 } from './rule-pack-v2'

/** First-party open rules are a new immutable identity, never an upgrade of a
 * saved 2.0.0 pack. Campaign facts/effect plans are deliberately not invented. */
export function createStoryForgeOpenRulePackV2(): RulePackV2 {
  const core = structuredClone(createStoryForgeRulePackV1())
  const sourceRefs = [core.ruleSystemId]
  const genericChecks: TtrpgOpenGenericCheckV1[] = core.attributes.map(attribute => {
    const checkKey = `open.${attribute.key}`
    core.checks.push({ ...structuredClone(core.checks[0]), key: checkKey, name: `${attribute.name}通用检定`, attributeKeys: [attribute.key] })
    return {
      checkKey, title: `${attribute.name}通用检定`, actorAttributeKey: attribute.key,
      diceModelKey: 'core-2d6', difficulty: 10, preconditions: [], targetKinds: ['self'],
      effectPlanByDegree: { 'critical-success': null, 'extreme-success': null, 'hard-success': null,
        success: null, 'partial-success': null, failure: null, 'critical-failure': null },
      riskFactRefs: [], resourceCosts: [], timeCostWorldTurns: 1, audience: 'party', sourceRefs,
    }
  })
  function fact(predicateKey: TtrpgOpenFactPolicyV1['predicateKey'], owner: NonNullable<TtrpgOpenFactPolicyV1['authority']['session']>,
    valueType: TtrpgOpenFactPolicyV1['valueType'], cardinality: TtrpgOpenFactPolicyV1['cardinality'] = 'one',
    mutuallyExclusiveWith: TtrpgOpenFactPolicyV1['predicateKey'][] = []): TtrpgOpenFactPolicyV1 {
    return { predicateKey, valueType, cardinality, allowedKinds: ['entity', 'relation', 'state', 'event-truth', 'location', 'item'],
      mutuallyExclusiveWith, authority: { invariant: owner === 'semantic-fact' ? owner : null, initialState: owner, session: owner }, allowNewSubjects: false }
  }
  return parseRulePackV2({
    ...core, version: 2, runFormat: 'open', ruleSystemVersion: '3.0.0', title: 'StoryForge 开放叙事 2d6',
    description: '复用 StoryForge 第一方 2d6 行动与资源规则。体魄、心智和风度通用检定耗时一轮，只裁定检定结果；战役作者需另外设计具体危险与后果。受限 d6 概率问答不修改世界、规则或玩家决定。',
    compendium: [...core.compendium,
      { key: 'rules.open-checks', title: '开放通用检定', category: 'check',
        body: '选择相关属性，掷 2d6 加属性，沿用标准检定的难度与成功等级；每次耗时一个世界回合。不自动制造伤害、物品、事实或线索。具体后果须由作者冻结的局势和合法效果计划承接，失败时仍可能推进战役压力。',
        relatedKeys: genericChecks.map(check => check.checkKey) },
      { key: 'rules.open-oracle', title: '概率问答与时间', category: 'core',
        body: '掷 1d6：均等可能时 5–6 为是、4 为是但有条件、3 为否但有转机、1–2 为否；较可能的阈值为 3，较不可能为 5，均保留阈值处的条件与前一格的转机。咨询不耗世界时间；实际行动默认耗时一轮。问答解释须尊重已知事实、信息范围及独立账本，不能创造新实体、回改世界或替玩家决定。',
        relatedKeys: ['impact-d6'] }],
    factPolicy: [fact('exists', 'semantic-fact', 'boolean'), fact('located-at', 'entity', 'entity-ref'),
      fact('owns', 'inventory', 'entity-ref'), fact('knows', 'semantic-fact', 'boolean', 'many'),
      fact('allied-with', 'social-ledger', 'boolean', 'many', ['hostile-to']), fact('hostile-to', 'social-ledger', 'boolean', 'many', ['allied-with']),
      fact('owes', 'social-ledger', 'number', 'many'), fact('promised', 'semantic-fact', 'string', 'many'),
      fact('damaged', 'entity', 'number'), fact('destroyed', 'entity', 'boolean'),
      fact('blocked', 'entity', 'boolean', 'one', ['open']), fact('open', 'entity', 'boolean', 'one', ['blocked'])],
    oracles: [{ oracleKey: 'oracle.storyforge.yes', title: '局势可能性', kind: 'yes-no', diceModelKey: 'impact-d6', audience: 'party', chaosCoupled: false,
      likelihood: { defaultTierKey: 'even', tiers: [
        { tierKey: 'unlikely', label: '较不可能', yesAtOrAbove: 5, yesButBand: 1, noButBand: 1 },
        { tierKey: 'even', label: '均等可能', yesAtOrAbove: 4, yesButBand: 1, noButBand: 1 },
        { tierKey: 'likely', label: '较有可能', yesAtOrAbove: 3, yesButBand: 1, noButBand: 1 }] }, entries: null,
      interpretation: { mustRespect: ['冻结的世界事实与作者局势', '本次咨询的披露范围', '实体、物品、关系与资源的唯一账本'],
        forbiddenScopes: ['world-fact', 'rule-change', 'player-decision', 'retcon'], maxNewEntities: 0 },
      tests: [
        { testKey: 'even.no-but', seed: 'storyforge.open.3.0.0', nonce: 'oracle:oracle.storyforge.yes:fixture.1', chaosValue: null, likelihoodTierKey: 'even', expectedRawResult: 'no-but', expectedEntryKey: null },
        { testKey: 'even.yes', seed: 'storyforge.open.3.0.0', nonce: 'oracle:oracle.storyforge.yes:fixture.2', chaosValue: null, likelihoodTierKey: 'even', expectedRawResult: 'yes', expectedEntryKey: null },
        { testKey: 'even.no', seed: 'storyforge.open.3.0.0', nonce: 'oracle:oracle.storyforge.yes:fixture.3', chaosValue: null, likelihoodTierKey: 'even', expectedRawResult: 'no', expectedEntryKey: null },
        { testKey: 'even.yes-but', seed: 'storyforge.open.3.0.0', nonce: 'oracle:oracle.storyforge.yes:fixture.7', chaosValue: null, likelihoodTierKey: 'even', expectedRawResult: 'yes-but', expectedEntryKey: null },
        { testKey: 'likely.yes-but', seed: 'storyforge.open.3.0.0', nonce: 'oracle:oracle.storyforge.yes:fixture.1', chaosValue: null, likelihoodTierKey: 'likely', expectedRawResult: 'yes-but', expectedEntryKey: null },
        { testKey: 'unlikely.no', seed: 'storyforge.open.3.0.0', nonce: 'oracle:oracle.storyforge.yes:fixture.1', chaosValue: null, likelihoodTierKey: 'unlikely', expectedRawResult: 'no', expectedEntryKey: null }], sourceRefs }],
    genericChecks, socialTierMappings: [],
    timePolicy: { existingAction: 1, genericCheck: 1, noRoll: 1, outOfCharacter: 0, view: 0,
      rulesQuestion: 0, preflight: 0, oracleConsultation: 0, actionOverrides: [] },
  })
}
