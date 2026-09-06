import { describe, expect, it } from 'vitest'
import {
  createTextOpenWorldCombatDefinitionCatalogV1,
  projectTextOpenWorldEncounterPreviewV1,
} from '../../src/lib/open-world/combat-definitions'
import { parseTextOpenWorldModulesV1 } from '../../src/lib/open-world/modules'
import {
  createTextOpenWorldVNextFixture,
  downgradeTextOpenWorldFixtureCombatV1,
} from '../helpers/text-open-world-vnext-fixture'

function combatOf(runtimePackage: ReturnType<typeof createTextOpenWorldVNextFixture>): any {
  return runtimePackage.modules.combat.payload
}

describe('Text Open World vNext · Enemy/Encounter definitions', () => {
  it('从Release定义目录投影完整的战前信息且不改写定义', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const catalog = createTextOpenWorldCombatDefinitionCatalogV1(runtimePackage)
    const enemy = catalog.getEnemy('enemy.salt-jackal')!
    enemy.title = '被调用方篡改'

    expect(catalog.getEnemy('enemy.salt-jackal')).toMatchObject({
      title: '盐鬣犬', strategyProfileKey: 'strategy.salt-jackal', dropTableKey: 'drop.salt-jackal',
    })
    expect(catalog.listDifficulties()).toEqual([{
      key: 'standard', label: '标准', enemyHealthMultiplier: 1, enemyDamageMultiplier: 1, rewardMultiplier: 1,
    }])
    expect(projectTextOpenWorldEncounterPreviewV1({
      runtimePackage, encounterKey: 'encounter.ridge-jackal', playerLevel: 1,
    })).toMatchObject({
      encounterKey: 'encounter.ridge-jackal', locationKey: 'location.ridge-channel', difficulty: 'standard',
      relativeChallenge: 'matched', totalEnemyCount: 1,
      enemyGroups: [{ groupKey: 'group.ridge-jackal.1', count: 1, enemy: { key: 'enemy.salt-jackal', level: 1 } }],
      escapePolicy: { allowed: true, failureConsumesTurn: true },
      defeatPolicy: { kind: 'retry-or-respawn', preservesWorldProgress: true },
      reward: { key: 'reward.ridge-jackal', sourceKind: 'combat' },
    })
  })

  it('用冻结等级区间确定性标记相对强度，不启动战斗', () => {
    const runtimePackage = createTextOpenWorldVNextFixture()
    const encounter = combatOf(runtimePackage).encounters[0]
    encounter.recommendedLevel = 3
    encounter.levelBand = { minimum: 3, maximum: 4 }

    const project = (playerLevel: number) => projectTextOpenWorldEncounterPreviewV1({
      runtimePackage, encounterKey: encounter.key, playerLevel,
    }).relativeChallenge
    expect([project(1), project(2), project(3), project(5), project(6)]).toEqual([
      'deadly', 'dangerous', 'matched', 'matched', 'easy',
    ])
  })

  it('拒绝非唯一standard难度或暗藏倍率', () => {
    const multiplied = createTextOpenWorldVNextFixture()
    combatOf(multiplied).difficultyProfiles[0].enemyHealthMultiplier = 1.1
    expect(() => parseTextOpenWorldModulesV1(multiplied)).toThrow('standard难度倍率必须固定为1')

    const duplicated = createTextOpenWorldVNextFixture()
    combatOf(duplicated).difficultyProfiles.push({ ...combatOf(duplicated).difficultyProfiles[0] })
    expect(() => parseTextOpenWorldModulesV1(duplicated)).toThrow('combat.difficultyProfiles.key 不能重复')
  })

  it('拒绝不可执行、悬空或没有敌人使用的策略', () => {
    const passive = createTextOpenWorldVNextFixture()
    ;(passive.modules.progression.payload as any).skills[0].activation = 'passive'
    ;(passive.modules.progression.payload as any).skills[0].target = 'self'
    expect(() => parseTextOpenWorldModulesV1(passive)).toThrow('敌人策略只能选择主动技能')

    const dangling = createTextOpenWorldVNextFixture()
    combatOf(dangling).enemies[0].strategyProfileKey = 'strategy.missing'
    expect(() => parseTextOpenWorldModulesV1(dangling)).toThrow('enemy strategy profile 引用不存在')

    const unused = createTextOpenWorldVNextFixture()
    combatOf(unused).strategyProfiles.push({
      key: 'strategy.unused', title: '未使用策略', selection: 'ordered-skill-priority',
      prioritySkillKeys: ['skill.basic-attack'], fallbackSkillKey: 'skill.basic-attack',
    })
    expect(() => parseTextOpenWorldModulesV1(unused)).toThrow('敌人策略没有使用者')
  })

  it('拒绝敌人组越界、顺序漂移和不存在的敌人', () => {
    const tooMany = createTextOpenWorldVNextFixture()
    combatOf(tooMany).encounters[0].enemyGroups[0].count = 9
    expect(() => parseTextOpenWorldModulesV1(tooMany)).toThrow('count 必须在1到8之间')

    const unordered = createTextOpenWorldVNextFixture()
    combatOf(unordered).encounters[0].enemyGroups[0].order = 2
    expect(() => parseTextOpenWorldModulesV1(unordered)).toThrow('order 必须在1到1之间')

    const missing = createTextOpenWorldVNextFixture()
    combatOf(missing).encounters[0].enemyGroups[0].enemyKey = 'enemy.missing'
    expect(() => parseTextOpenWorldModulesV1(missing)).toThrow('encounter enemy 引用不存在')
  })

  it('拒绝战斗奖励错配、跨遭遇共享和无主RewardContract', () => {
    const mismatched = createTextOpenWorldVNextFixture()
    ;(mismatched.modules.items.payload as any).rewardContracts.find((item: any) => item.key === 'reward.ridge-jackal').dropTableKeys = []
    expect(() => parseTextOpenWorldModulesV1(mismatched)).toThrow('encounter encounter.ridge-jackal drop tables 双向引用不一致')

    const unowned = createTextOpenWorldVNextFixture()
    ;(unowned.modules.items.payload as any).rewardContracts.push({
      key: 'reward.combat-unowned', title: '无主奖励', sourceKind: 'combat', claimPolicy: 'once-per-source',
      expectedMinutes: 5, budgetClass: 'minor', conditionKeys: [], effectKeys: ['effect.reward-experience'], dropTableKeys: [],
    })
    expect(() => parseTextOpenWorldModulesV1(unowned)).toThrow('combat来源RewardContract必须绑定一个遭遇')
  })

  it('拒绝逃跑、战败恢复和遭遇入口合同漂移', () => {
    const escape = createTextOpenWorldVNextFixture()
    combatOf(escape).encounters[0].escapePolicy.failureConsumesTurn = false
    expect(() => parseTextOpenWorldModulesV1(escape)).toThrow('escapePolicy不符合首版规则')

    const defeat = createTextOpenWorldVNextFixture()
    combatOf(defeat).encounters[0].defeatPolicy.kind = 'game-over'
    expect(() => parseTextOpenWorldModulesV1(defeat)).toThrow('defeatPolicy不符合首版失败恢复边界')

    const missingEntry = createTextOpenWorldVNextFixture()
    const actions = missingEntry.modules.actions.payload as any
    actions.actions = actions.actions.filter((item: any) => item.key !== 'action.start-ridge-jackal')
    expect(() => parseTextOpenWorldModulesV1(missingEntry)).toThrow('每个遭遇必须且只能由一个start-combat Action进入')
  })

  it('旧Combat v1确定性规范化为v2只读定义，不猜测奖励所有权', () => {
    const legacy = downgradeTextOpenWorldFixtureCombatV1(createTextOpenWorldVNextFixture())
    const parsed = parseTextOpenWorldModulesV1(legacy)

    expect(parsed.combat).toMatchObject({
      version: 2,
      difficultyProfiles: [{ key: 'standard' }],
      strategyProfiles: [{ key: 'strategy.legacy.enemy.salt-jackal' }],
      enemies: [{ key: 'enemy.salt-jackal', strategyProfileKey: 'strategy.legacy.enemy.salt-jackal' }],
      encounters: [{
        key: 'encounter.ridge-jackal', rewardContractKey: null,
        enemyGroups: [{ key: 'group.legacy.encounter.ridge-jackal.1', enemyKey: 'enemy.salt-jackal', count: 1, order: 1 }],
        defeatPolicy: { kind: 'retry-or-respawn', preservesWorldProgress: true },
      }],
    })
    expect(projectTextOpenWorldEncounterPreviewV1({
      runtimePackage: legacy, encounterKey: 'encounter.ridge-jackal', playerLevel: 1,
    }).reward).toBeNull()
  })
})
