import type { RuleNumberExpressionV1, RulePackV1 } from '../types'
import { parseRulePackV1, runRulePackFixturesV1 } from './rule-pack'

const constant = (value: number): RuleNumberExpressionV1 => ({ op: 'constant', value })
const attribute = (key: string): RuleNumberExpressionV1 => ({ op: 'attribute', key })
const add = (...values: RuleNumberExpressionV1[]): RuleNumberExpressionV1 => ({ op: 'add', values })
const multiply = (left: RuleNumberExpressionV1, right: RuleNumberExpressionV1): RuleNumberExpressionV1 => ({ op: 'multiply', left, right })
const unlimited = () => ({ mode: 'unlimited' as const, maximum: null, resourceKey: null, cost: null, sharedPoolKey: null, cooldownRounds: null, reset: [] })
const itemMechanics = (category: string) => ({ category, stackPolicy: 'unique' as const, maxStack: 1, weight: null, equipSlots: [], requiresAttunement: false, maximumCharges: null, maximumDurability: null })

export const TTRPG_RANK_LITE_TIERS_V2 = ['D', 'C', 'B', 'A'] as const
export type TtrpgRankLiteTierV2 = typeof TTRPG_RANK_LITE_TIERS_V2[number]

export function rankLiteTierForPowerV2(power: number): TtrpgRankLiteTierV2 {
  if (!Number.isInteger(power) || power < 1 || power > 4) throw new Error('[rank-lite] rankPower 必须是 1～4')
  return TTRPG_RANK_LITE_TIERS_V2[power - 1]
}

export interface TtrpgRankLiteQuickCardV2 {
  tier: TtrpgRankLiteTierV2
  name: string
  description: string
  attributes: Record<'rankPower' | 'body' | 'mind' | 'presence', number>
  skills: string[]
  itemKeys: string[]
  actionKeys: string[]
}

export const RANK_LITE_RULE_PACK_V1: RulePackV1 = {
  schema: 'storyforge.rule-pack', version: 1,
  ruleSystemId: 'storyforge.rank-lite', ruleSystemVersion: '1.0.0',
  title: 'Rank Lite',
  description: '以 D/C/B/A 四阶能力、d20 核心检定、明确行动/反应、次数与冷却构成的 StoryForge 第一方快速跑团规则。',
  license: {
    licenseId: 'storyforge-rank-lite-1.0', name: 'StoryForge Rank Lite 第一方许可',
    attribution: 'Rank Lite original rules; copyright StoryForge contributors.',
    commercialUse: true, derivativesAllowed: true, sourceUrl: null,
  },
  attributes: [
    { key: 'rankPower', name: '阶位', description: 'D=1、C=2、B=3、A=4；决定整体能力和招牌技次数。', minimum: 1, maximum: 4, defaultValue: 2 },
    { key: 'body', name: '体魄', description: '力量、耐力和危险行动。', minimum: 0, maximum: 4, defaultValue: 1 },
    { key: 'mind', name: '心智', description: '调查、知识和精密行动。', minimum: 0, maximum: 4, defaultValue: 1 },
    { key: 'presence', name: '风度', description: '交涉、意志和关系行动。', minimum: 0, maximum: 4, defaultValue: 1 },
  ],
  derivedStats: [
    { key: 'defense', name: '防御', description: '攻击行动的基础目标。', formula: add(constant(7), attribute('body'), attribute('rankPower')), minimum: 8, maximum: 15 },
    { key: 'load', name: '负重', description: '便利携带的物品格。', formula: add(constant(2), attribute('body'), attribute('rankPower')), minimum: 3, maximum: 10 },
  ],
  diceModels: [
    { key: 'rank-d20', name: '核心 d20', count: 1, sides: 20, keep: 'all' },
    { key: 'impact-d6', name: '影响 d6', count: 1, sides: 6, keep: 'all' },
  ],
  checks: [
    { key: 'standard', name: '标准检定', diceModelKey: 'rank-d20', attributeKeys: ['rankPower', 'body', 'mind', 'presence'], targetMode: 'meet-or-beat', defaultDifficulty: 12, criticalSuccessMargin: 8, criticalFailureMargin: 8 },
  ],
  resources: [
    { key: 'vigor', name: '耐久', description: '伤势、劳累和危险代价。', maximumFormula: add(constant(4), multiply(attribute('body'), constant(2)), attribute('rankPower')), initialMode: 'maximum', minimum: 0 },
    { key: 'momentum', name: '势能', description: '协助和特殊行动所消耗的可恢复资源。', maximumFormula: add(attribute('rankPower'), attribute('mind')), initialMode: 'maximum', minimum: 0 },
  ],
  conditions: [
    { key: 'hindered', name: '受阻', description: '检定 -2。', stacking: 'replace', maximumStacks: 1, defaultDurationRounds: 1, checkModifier: -2 },
    { key: 'guarded', name: '受护', description: '下一次相关检定 +2。', stacking: 'replace', maximumStacks: 1, defaultDurationRounds: 1, checkModifier: 2 },
    { key: 'wounded', name: '负伤', description: '持续伤势；由治疗或效果计划移除。', stacking: 'stack', maximumStacks: 3, defaultDurationRounds: null, checkModifier: -1 },
  ],
  actions: [
    { key: 'investigate', name: '调查', description: '观察、研究或重建事实。', phase: 'action', target: 'scene', costResourceKey: null, costAmount: 0, usage: unlimited(), effects: [{ kind: 'check', checkKey: 'standard', attributeKey: 'mind' }] },
    { key: 'influence', name: '交涉', description: '说服、欺骗、鼓舞或威慑。', phase: 'action', target: 'single-enemy', costResourceKey: null, costAmount: 0, usage: unlimited(), effects: [{ kind: 'check', checkKey: 'standard', attributeKey: 'presence' }] },
    { key: 'overcome', name: '突破', description: '以体魄解决障碍。', phase: 'action', target: 'scene', costResourceKey: null, costAmount: 0, usage: unlimited(), effects: [{ kind: 'check', checkKey: 'standard', attributeKey: 'body' }] },
    { key: 'strike', name: '攻击', description: '命中后造成 d6 影响。', phase: 'action', target: 'single-enemy', costResourceKey: null, costAmount: 0, usage: unlimited(), effects: [{ kind: 'check', checkKey: 'standard', attributeKey: 'body' }, { kind: 'damage', resourceKey: 'vigor', diceModelKey: 'impact-d6', modifierAttributeKey: 'rankPower' }] },
    { key: 'assist', name: '协助', description: '消耗 1 势能使同伴受护。', phase: 'action', target: 'single-ally', costResourceKey: null, costAmount: 0, usage: { mode: 'resource-cost', maximum: null, resourceKey: 'momentum', cost: 1, sharedPoolKey: null, cooldownRounds: null, reset: [] }, effects: [{ kind: 'condition', conditionKey: 'guarded', stacks: 1 }] },
    { key: 'protect', name: '护援反应', description: '在他人回合为同伴提供掩护。', phase: 'reaction', target: 'single-ally', costResourceKey: null, costAmount: 0, usage: unlimited(), effects: [{ kind: 'condition', conditionKey: 'guarded', stacks: 1 }] },
    { key: 'signature', name: '招牌技', description: '每场景两次的强力行动。', phase: 'action', target: 'single-enemy', costResourceKey: null, costAmount: 0, usage: { mode: 'charges', maximum: 2, resourceKey: null, cost: null, sharedPoolKey: null, cooldownRounds: null, reset: ['scene', 'long-rest'] }, effects: [{ kind: 'check', checkKey: 'standard', attributeKey: 'rankPower' }, { kind: 'damage', resourceKey: 'vigor', diceModelKey: 'impact-d6', modifierAttributeKey: 'rankPower' }] },
    { key: 'recover', name: '休整', description: '恢复耐久，冷却两轮。', phase: 'downtime', target: 'self', costResourceKey: null, costAmount: 0, usage: { mode: 'cooldown', maximum: null, resourceKey: null, cost: null, sharedPoolKey: null, cooldownRounds: 2, reset: ['scene', 'long-rest'] }, effects: [{ kind: 'resource', resourceKey: 'vigor', delta: 2 }] },
  ],
  turnStructure: { initiativeDiceModelKey: 'rank-d20', initiativeAttributeKey: 'mind', phases: ['start', 'action', 'end'], actionsPerTurn: 1, reactionsPerRound: 1 },
  items: [
    { key: 'field-kit', name: '专业工具', description: '与角色专长相符的工具包。', tags: ['tool'], grantedActionKeys: ['investigate'], mechanics: itemMechanics('tool') },
    { key: 'sidearm', name: '制式武器', description: '用于危险冲突的基础装备。', tags: ['weapon'], grantedActionKeys: ['strike'], mechanics: itemMechanics('weapon') },
    { key: 'protective-gear', name: '防护装具', description: '降低环境风险的基础装备。', tags: ['armor'], grantedActionKeys: ['protect'], mechanics: itemMechanics('armor') },
  ],
  advancement: {
    currencyKey: 'xp', currencyName: '成长点', awardPerMilestone: 1,
    attributeIncreaseCost: 3, maximumAttributeValue: 4,
    progressionModel: 'rank', skillIncreaseCost: 2, maximumSkillValue: 6,
    levelIncreaseCost: 5, maximumLevel: 20, rankOrder: ['D', 'C', 'B', 'A'], rankIncreaseCost: 4,
  },
  characterSheetUi: { sections: [
    { key: 'identity', title: '阶位与属性', fieldKeys: ['rankPower', 'body', 'mind', 'presence'] },
    { key: 'derived', title: '派生值', fieldKeys: ['defense', 'load'] },
    { key: 'resources', title: '资源', fieldKeys: ['vigor', 'momentum'] },
  ] },
  compendium: [
    { key: 'rank.tiers', title: 'D/C/B/A 阶位', category: 'core', body: 'D、C、B、A 对应阶位值 1～4。阶位参与核心检定、资源和招牌技效果，但不会覆盖具体属性专长。', relatedKeys: ['rankPower'] },
    { key: 'rank.check', title: '核心检定', category: 'check', body: '掷 d20，加对应属性与公开修正，达到难度即成功；超过或低于 8 形成关键结果。', relatedKeys: ['rank-d20', 'standard'] },
    { key: 'rank.usage', title: '次数与冷却', category: 'core', body: '招牌技每场景 2 次；休整使用后冷却 2 轮；反应每轮恢复。所有变化进入事件账本。', relatedKeys: ['signature', 'recover', 'protect'] },
    { key: 'rank.safety', title: '安全工具', category: 'safety', body: '任何参与者都可暂停、淡出或退出，无需解释私人边界。', relatedKeys: [] },
  ],
  migrations: [],
  tests: [
    { fixtureKey: 'rank-d', attributes: { rankPower: 1, body: 1, mind: 1, presence: 1 }, expectedDerivedStats: { defense: 9, load: 4 }, expectedResourceMaximums: { vigor: 7, momentum: 2 } },
    { fixtureKey: 'rank-a', attributes: { rankPower: 4, body: 4, mind: 3, presence: 2 }, expectedDerivedStats: { defense: 15, load: 10 }, expectedResourceMaximums: { vigor: 16, momentum: 7 } },
  ],
}

export function createRankLiteRulePackV1(): RulePackV1 {
  const pack = parseRulePackV1(RANK_LITE_RULE_PACK_V1)
  runRulePackFixturesV1(pack)
  return pack
}

export function createRankLiteQuickCardsV2(): TtrpgRankLiteQuickCardV2[] {
  const cards: TtrpgRankLiteQuickCardV2[] = [
    { tier: 'D', name: 'D级新人', description: '均衡、易学，适合第一次参与。', attributes: { rankPower: 1, body: 1, mind: 1, presence: 1 }, skills: ['观察', '求生'], itemKeys: ['field-kit'], actionKeys: ['investigate', 'overcome', 'assist', 'protect', 'signature', 'recover'] },
    { tier: 'C', name: 'C级专员', description: '擅长调查与现场判断。', attributes: { rankPower: 2, body: 1, mind: 2, presence: 1 }, skills: ['调查', '知识'], itemKeys: ['field-kit', 'protective-gear'], actionKeys: ['investigate', 'influence', 'assist', 'protect', 'signature', 'recover'] },
    { tier: 'B', name: 'B级行动者', description: '在冲突和护援中可靠。', attributes: { rankPower: 3, body: 3, mind: 1, presence: 1 }, skills: ['格斗', '运动'], itemKeys: ['sidearm', 'protective-gear'], actionKeys: ['overcome', 'strike', 'assist', 'protect', 'signature', 'recover'] },
    { tier: 'A', name: 'A级核心', description: '强大但仍受次数、资源和团队协作约束。', attributes: { rankPower: 4, body: 2, mind: 3, presence: 2 }, skills: ['统筹', '洞察'], itemKeys: ['field-kit', 'sidearm', 'protective-gear'], actionKeys: ['investigate', 'influence', 'overcome', 'strike', 'assist', 'protect', 'signature', 'recover'] },
  ]
  for (const card of cards) {
    if (rankLiteTierForPowerV2(card.attributes.rankPower) !== card.tier) throw new Error('[rank-lite] 快速卡阶位映射无效')
  }
  return structuredClone(cards)
}
