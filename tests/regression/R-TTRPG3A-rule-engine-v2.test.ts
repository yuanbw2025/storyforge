import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  assertDegreeEffectPlansDifferV2,
  parseTtrpgEffectPlanV2,
} from '../../src/lib/ttrpg/effect-plan'
import { resolveTtrpgResolutionV2 } from '../../src/lib/ttrpg/resolution'
import {
  createDormantTtrpgActionEconomyV2,
  spendTtrpgActionEconomyV2,
  startTtrpgActionEconomySceneV2,
} from '../../src/lib/ttrpg/action-economy'
import { createStoryForgeRulePackV1 } from '../../src/lib/ttrpg/storyforge-rule-pack'
import { createD20FantasyRulePackV1 } from '../../src/lib/ttrpg/d20-fantasy-rule-pack'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  applyTtrpgHouseRuleOverlayV2,
  parseTtrpgHouseRuleOverlayV2,
  previewTtrpgCheckProbabilityV2,
} from '../../src/lib/ttrpg/house-rule'

describe('TTRPG-3A · RulePack V2 generic resolver and EffectPlan DSL', () => {
  it('d100 共享合同覆盖规则导入、运行时、联机与正式 UI，没有各自维护上限', () => {
    const source = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), 'utf8')
    expect(source('src/lib/ttrpg/rule-pack.ts')).toContain("assertTtrpgDieSidesV2(row.sides")
    expect(source('src/lib/product/runtime-dice.ts')).toContain('parseTtrpgDiceExpressionV2(expression)')
    expect(source('src/lib/online/verifiable-dice.ts')).toContain('parseTtrpgDiceExpressionV2(expression)')
    const ui = source('src/components/ttrpg/TtrpgOnlineRoomPanel.tsx')
    expect(ui).toContain('parseTtrpgDiceExpressionV2(diceExpression)')
    expect(ui).toContain('可验证骰子（d2～d100）')
  })

  it('total-vs-target 在大成功、成功、部分成功、失败和大失败边界给出可解释轨迹', () => {
    const base = {
      mode: 'total-vs-target' as const,
      target: 10,
      criticalSuccessMargin: 5,
      criticalFailureMargin: 5,
      partialSuccessWindow: 2,
    }
    expect(resolveTtrpgResolutionV2({ ...base, total: 15 }).degree).toBe('critical-success')
    expect(resolveTtrpgResolutionV2({ ...base, total: 10 }).degree).toBe('success')
    expect(resolveTtrpgResolutionV2({ ...base, total: 8 }).degree).toBe('partial-success')
    expect(resolveTtrpgResolutionV2({ ...base, total: 7 }).degree).toBe('failure')
    const fumble = resolveTtrpgResolutionV2({ ...base, total: 5 })
    expect(fumble).toMatchObject({ degree: 'critical-failure', margin: -5, rolled: true })
    expect(fumble.calculationTrace).toContain('degree=critical-failure')
  })

  it('roll-under 使用 d100 多级阈值且精确覆盖临界成功和大失败', () => {
    const base = {
      mode: 'roll-under' as const,
      successMaximum: 60,
      hardSuccessMaximum: 30,
      extremeSuccessMaximum: 12,
      criticalSuccessMaximum: 1,
      criticalFailureMinimum: 96,
    }
    expect(resolveTtrpgResolutionV2({ ...base, roll: 1 }).degree).toBe('critical-success')
    expect(resolveTtrpgResolutionV2({ ...base, roll: 12 }).degree).toBe('extreme-success')
    expect(resolveTtrpgResolutionV2({ ...base, roll: 30 }).degree).toBe('hard-success')
    expect(resolveTtrpgResolutionV2({ ...base, roll: 60 }).degree).toBe('success')
    expect(resolveTtrpgResolutionV2({ ...base, roll: 61 }).degree).toBe('failure')
    expect(resolveTtrpgResolutionV2({ ...base, roll: 100 }).degree).toBe('critical-failure')
    expect(() => resolveTtrpgResolutionV2({ ...base, roll: 101 })).toThrow('roll')
  })

  it('success-pool 统计成功、额外成功与抵消，并记录净成功数', () => {
    const outcome = resolveTtrpgResolutionV2({
      mode: 'success-pool', dice: [10, 8, 1, 2], sides: 10,
      successAtOrAbove: 8, criticalAtOrAbove: 10, criticalBonusSuccesses: 1,
      botchAtOrBelow: 1, botchesCancel: true,
      requiredSuccesses: 2, criticalSuccesses: 4, criticalFailureBotches: 2,
    })
    expect(outcome).toMatchObject({ degree: 'success', successes: 2, margin: 0 })
    expect(resolveTtrpgResolutionV2({
      mode: 'success-pool', dice: [1, 1, 2], sides: 10,
      successAtOrAbove: 8, criticalAtOrAbove: 10, criticalBonusSuccesses: 1,
      botchAtOrBelow: 1, botchesCancel: true,
      requiredSuccesses: 1, criticalSuccesses: 3, criticalFailureBotches: 2,
    }).degree).toBe('critical-failure')
  })

  it('opposed 先比较成功等级再执行声明式破平手，不偷偷代入随机规则', () => {
    const winner = resolveTtrpgResolutionV2({
      mode: 'opposed', tieBreak: 'higher-margin', contestants: [
        { contestantRef: 'actor.alpha', degree: 'hard-success', total: 12, margin: 2 },
        { contestantRef: 'actor.beta', degree: 'success', total: 18, margin: 8 },
      ],
    })
    expect(winner).toMatchObject({ winnerRef: 'actor.alpha', degree: 'hard-success' })
    const tie = resolveTtrpgResolutionV2({
      mode: 'opposed', tieBreak: 'reroll', contestants: [
        { contestantRef: 'actor.alpha', degree: 'success', total: 12, margin: 2 },
        { contestantRef: 'actor.beta', degree: 'success', total: 12, margin: 2 },
      ],
    })
    expect(tie).toMatchObject({ winnerRef: null, degree: 'failure', tiedRefs: ['actor.alpha', 'actor.beta'] })
  })

  it('fixed/no-roll 仍生成终态裁决，不会让普通行动无反馈消失', () => {
    expect(resolveTtrpgResolutionV2({
      mode: 'fixed/no-roll', degree: 'success', reason: '门未上锁且角色已经取得钥匙。',
    })).toMatchObject({ rolled: false, succeeded: true, total: null, degree: 'success' })
    expect(() => resolveTtrpgResolutionV2({
      mode: 'fixed/no-roll', degree: 'success', reason: '',
    })).toThrow('reason')
  })

  it('行动、自由行动与反应各自记账，反应可在他人回合发生并在新轮重置', () => {
    let economy = startTtrpgActionEconomySceneV2({
      economy: createDormantTtrpgActionEconomyV2({ actionsPerTurn: 1, reactionsPerRound: 1 }),
      sceneKey: 'scene.test', turnOrder: ['actor.alpha', 'actor.beta'],
    })
    const reaction = spendTtrpgActionEconomyV2({ economy, turnOrder: ['actor.alpha', 'actor.beta'], actorKey: 'actor.beta', phase: 'reaction' })
    economy = reaction.economy
    expect(reaction).toMatchObject({ nextActorKey: null, nextRound: 1 })
    expect(economy.budgets['actor.beta'].reactionsRemaining).toBe(0)
    expect(() => spendTtrpgActionEconomyV2({ economy, turnOrder: ['actor.alpha', 'actor.beta'], actorKey: 'actor.beta', phase: 'reaction' })).toThrow('反应次数')
    economy = spendTtrpgActionEconomyV2({ economy, turnOrder: ['actor.alpha', 'actor.beta'], actorKey: 'actor.alpha', phase: 'free' }).economy
    expect(() => spendTtrpgActionEconomyV2({ economy, turnOrder: ['actor.alpha', 'actor.beta'], actorKey: 'actor.alpha', phase: 'free' })).toThrow('自由行动')
    const alphaAction = spendTtrpgActionEconomyV2({ economy, turnOrder: ['actor.alpha', 'actor.beta'], actorKey: 'actor.alpha', phase: 'action' })
    economy = alphaAction.economy
    expect(alphaAction).toMatchObject({ nextActorKey: 'actor.beta', nextRound: 1 })
    const betaAction = spendTtrpgActionEconomyV2({ economy, turnOrder: ['actor.alpha', 'actor.beta'], actorKey: 'actor.beta', phase: 'action' })
    expect(betaAction).toMatchObject({ nextActorKey: 'actor.alpha', nextRound: 2 })
    expect(betaAction.economy.budgets['actor.beta'].reactionsRemaining).toBe(1)
  })

  it('EffectPlan 是闭集、幂等、带来源的机械计划，不同成功等级不能只是换文案', () => {
    const plan = (degree: 'critical-success' | 'success', amount: number) => parseTtrpgEffectPlanV2({
      schema: 'storyforge.ttrpg-effect-plan', version: 2,
      planKey: `plan.${degree}`, degree, sourceEventId: 'event.action.7', ruleRef: 'rule.investigate',
      reason: '调查裁决产生确定性线索与进度。', audience: 'party',
      idempotencyKey: `effect.action.7.${degree}`, status: 'immediate',
      effects: [{
        effectKey: `effect.clock.${degree}`, family: 'story', operation: 'clock.advance',
        targetRef: 'campaign.main', storyKey: 'clock.investigation', value: amount,
      }],
    })
    const critical = plan('critical-success', 2)
    const success = plan('success', 1)
    expect(parseTtrpgEffectPlanV2(JSON.stringify(critical))).toEqual(critical)
    expect(() => assertDegreeEffectPlansDifferV2([critical, success])).not.toThrow()
    const narrativeOnly = { ...success, degree: 'critical-success' as const, planKey: 'plan.fake-critical', idempotencyKey: 'effect.fake-critical' }
    expect(() => assertDegreeEffectPlansDifferV2([narrativeOnly, success])).toThrow('不同成功等级')
    expect(() => parseTtrpgEffectPlanV2({ ...success, eval: 'globalThis' })).toThrow('字段不精确')
  })

  it('HouseRule Overlay 只允许白名单差异、绑定基线 hash，并在应用后重新执行 d100 与 fixture 守卫', async () => {
    const base = createStoryForgeRulePackV1()
    const baseContentHash = await hashProductProductionValueV2(base)
    const overlay = {
      schema: 'storyforge.ttrpg-house-rule-overlay' as const, version: 2 as const,
      overlayKey: 'overlay.high-variance', title: '高波动村规', author: '测试主持人',
      baseRuleSystemId: base.ruleSystemId, baseRuleSystemVersion: base.ruleSystemVersion, baseContentHash,
      patches: [
        { patchKey: 'die.d100', operation: 'replace' as const, path: 'diceModels.impact-d6.sides', value: 100, reason: '将影响骰改为百分骰。' },
        { patchKey: 'reaction.two', operation: 'replace' as const, path: 'turnStructure.reactionsPerRound', value: 2, reason: '鼓励更多护援。' },
      ],
    }
    const applied = await applyTtrpgHouseRuleOverlayV2({ baseRulePack: base, overlay })
    expect(applied.rulePack.diceModels.find(item => item.key === 'impact-d6')?.sides).toBe(100)
    expect(applied.rulePack.turnStructure.reactionsPerRound).toBe(2)
    expect(applied.diff).toHaveLength(2)
    await expect(applyTtrpgHouseRuleOverlayV2({
      baseRulePack: base,
      overlay: { ...overlay, patches: [{ ...overlay.patches[0], value: 101 }] },
    })).rejects.toThrow('d2～d100')
    await expect(applyTtrpgHouseRuleOverlayV2({
      baseRulePack: base, overlay: { ...overlay, baseContentHash: '0'.repeat(64) },
    })).rejects.toThrow('基线')
    expect(() => parseTtrpgHouseRuleOverlayV2({
      ...overlay,
      patches: [overlay.patches[1], { ...overlay.patches[1], patchKey: 'reaction.conflict', value: 3 }],
    })).toThrow('冲突')
  })

  it('d20 濒死恢复是受前置条件约束的正式行动，村规可把它冻结为一次英雄骰资源检定', async () => {
    const base = createD20FantasyRulePackV1()
    const recovery = base.actions.find(action => action.key === 'death-recovery')
    expect(recovery).toMatchObject({
      phase: 'action', target: 'self', costResourceKey: 'heroic-dice', costAmount: 0,
      requirements: [{ kind: 'resource', resourceKey: 'vigor', operator: 'at-most', value: 0 }],
    })
    const baseContentHash = await hashProductProductionValueV2(base)
    const applied = await applyTtrpgHouseRuleOverlayV2({
      baseRulePack: base,
      overlay: {
        schema: 'storyforge.ttrpg-house-rule-overlay', version: 2,
        overlayKey: 'overlay.death-resource-check', title: '濒死英雄骰', author: '测试主持人',
        baseRuleSystemId: base.ruleSystemId, baseRuleSystemVersion: base.ruleSystemVersion, baseContentHash,
        patches: [{
          patchKey: 'death-recovery.heroic-die', operation: 'replace',
          path: 'actions.death-recovery.costAmount', value: 1,
          reason: '濒死恢复必须消耗一次英雄骰资源后再进行体质检定。',
        }],
      },
    })
    expect(applied.rulePack.actions.find(action => action.key === 'death-recovery')).toMatchObject({
      costResourceKey: 'heroic-dice', costAmount: 1,
      requirements: [{ kind: 'resource', resourceKey: 'vigor', operator: 'at-most', value: 0 }],
    })
    expect(applied.diff).toEqual([expect.objectContaining({
      path: 'actions.death-recovery.costAmount', before: 0, after: 1,
    })])
  })

  it('村规概率预览给出改动前后的可量化成功率，不把数值影响藏在说明文字中', async () => {
    const base = createStoryForgeRulePackV1()
    const before = previewTtrpgCheckProbabilityV2({ rulePack: base, checkKey: 'standard', attributeValue: 1, difficulty: 8 })
    const baseContentHash = await hashProductProductionValueV2(base)
    const applied = await applyTtrpgHouseRuleOverlayV2({
      baseRulePack: base,
      overlay: {
        schema: 'storyforge.ttrpg-house-rule-overlay', version: 2, overlayKey: 'overlay.easy', title: '较易检定', author: '测试主持人',
        baseRuleSystemId: base.ruleSystemId, baseRuleSystemVersion: base.ruleSystemVersion, baseContentHash,
        patches: [{ patchKey: 'check.easy', operation: 'replace', path: 'checks.standard.defaultDifficulty', value: 6, reason: '新手局降低标准难度。' }],
      },
    })
    const after = previewTtrpgCheckProbabilityV2({ rulePack: applied.rulePack, checkKey: 'standard', attributeValue: 1 })
    expect(before.method).toBe('exact')
    expect(after.successProbability).toBeGreaterThan(before.successProbability)
    expect(before.successProbability + before.failureProbability).toBeCloseTo(1, 8)
  })
})
