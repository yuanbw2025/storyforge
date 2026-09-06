import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextAdventureProductionWizard, {
  createDefaultTextAdventureProductionWizardValueV1,
} from '../../src/components/text-game/TextAdventureProductionWizard'
import {
  parseTextAdventureQuestBundleArtifactV1,
  parseTextAdventureQualityReviewArtifactV1,
  parseTextAdventureSystemsArtifactV1,
} from '../../src/lib/adventure/production-artifacts'
import {
  planTextAdventureNarrativeLocationsV1,
  validateTextAdventureNarrativeLocationPlanV1,
} from '../../src/lib/adventure/narrative-location-plan'
import { db } from '../../src/lib/db/schema'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('R-TEXTADV2-production · 文字冒险正式生产契约与工作台', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    await db.delete()
    await db.open()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    db.close()
  })

  it('把文案主管、主线、系统、支线、区域事件、美术与装配编成有界 DAG', async () => {
    const owned = await seedCurrentProductWorld('TEXTADV-2 正式生产计划')
    const consultation = await suggestProductStartingPoints({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
    })
    const brief = await draftProductProductionBriefV3({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
      suggestionKey: consultation.suggestions[0].suggestionKey,
      productType: 'text-adventure',
      qualityProfile: 'prototype',
      scale: 'short-arc',
      visualLevel: 'key-scenes',
      audioLevel: 'none',
      playerRole: '守灯人',
      openingSituation: '在潮门关闭前决定信号记录的去向。',
      textAdventure: { confirmAll: true },
    })
    expect(brief.unresolvedDecisionKeys).not.toContain('text-adventure-boundary-confirmation')
    expect(brief.textAdventure).toMatchObject({
      narrative: {
        targetRegionCount: 2, targetAreaCount: 4, targetLocationCount: 8,
        targetSceneCount: 12, targetSideQuestCount: 3, targetAmbientEventCount: 4,
      },
      character: { preset: 'general-adventure-rpg', progressionEnabled: true },
      media: { mode: 'key-illustrations', runtimeGeneration: 'disabled' },
    })
    expect(brief.source.selection.roleBindings).toMatchObject({
      story: expect.any(Array), characters: expect.any(Array), locations: expect.any(Array),
      items: expect.any(Array), quests: expect.any(Array), lore: expect.any(Array),
    })
    expect(brief.completionContract.requiredGateIds).toEqual(expect.arrayContaining([
      'product.adventure.world-actions', 'product.adventure.progression',
    ]))
    const briefHash = await hashProductProductionValueV2(brief)
    const plan = await createProductProductionPlanV3({ buildNumber: 1, briefHash, brief })
    const taskByKey = new Map(plan.tasks.map(task => [task.taskKey, task]))
    expect([...taskByKey.keys()]).toEqual(expect.arrayContaining([
      'content.design', 'content.adventure-architecture', 'content.narrative',
      'content.product-module', 'content.adventure-side-quests', 'content.adventure-ambient-events',
      'content.adventure-quality-review', 'media.requirements', 'media.visual',
      'integration.package', 'qa.release',
    ]))
    expect(taskByKey.get('content.narrative')).toMatchObject({
      skillId: 'text-adventure.production-mainline.v1',
      dependsOn: ['content.adventure-architecture'],
    })
    expect(taskByKey.get('content.narrative')!.budgetReservation.outputTokens)
      .toBeGreaterThan(taskByKey.get('content.product-module')!.budgetReservation.outputTokens)
    expect(taskByKey.get('content.adventure-side-quests')?.dependsOn).toEqual([
      'content.adventure-architecture', 'content.product-module',
    ])
    expect(taskByKey.get('content.adventure-quality-review')).toMatchObject({
      skillId: 'text-adventure.production-quality-review.v1',
      dependsOn: [
        'content.adventure-architecture', 'content.narrative', 'content.product-module',
        'content.adventure-side-quests', 'content.adventure-ambient-events',
      ],
      outputArtifactKeys: ['quality.adventure-review'],
    })
    expect(taskByKey.get('media.requirements')?.dependsOn).toEqual(['content.adventure-quality-review'])
    expect(taskByKey.get('integration.package')?.failurePolicy).toBe('pause')
    expect(taskByKey.get('qa.release')?.failurePolicy).toBe('pause')
    expect(taskByKey.get('integration.package')?.inputArtifactKeys).toEqual(expect.arrayContaining([
      'content.adventure-architecture', 'content.adventure-side-quests',
      'content.adventure-ambient-events', 'quality.adventure-review',
      'media.visual.001', 'media.visual.002',
    ]))
  })

  it('未确认四项产品边界时保持阻塞，并拒绝会让失败代价越界的生命资源', async () => {
    const owned = await seedCurrentProductWorld('TEXTADV-2 边界反例')
    const consultation = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const brief = await draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: consultation.suggestions[0].suggestionKey,
      productType: 'text-adventure', scale: 'scene', visualLevel: 'none', audioLevel: 'none',
      playerRole: '守灯人', openingSituation: '从潮门开始。', textAdventure: { confirmAll: false },
    })
    expect(brief.unresolvedDecisionKeys).toContain('text-adventure-boundary-confirmation')
    const systems = {
      schema: 'storyforge.text-adventure-systems-artifact', version: 1,
      abilities: [
        { key: 'ability.attack', title: '攻击', description: '攻击。', role: 'stat', initial: 2, minimum: 0, maximum: 20 },
        { key: 'ability.explore', title: '探索', description: '探索。', role: 'skill', initial: 2, minimum: 0, maximum: 20 },
      ],
      resources: [
        { key: 'resource.health', title: '生命', description: '生命。', role: 'health', initial: 0, minimum: 0, maximum: 10 },
        { key: 'resource.mana', title: '法力', description: '法力。', role: 'mana', initial: 1, minimum: 0, maximum: 10 },
        { key: 'resource.stamina', title: '体力', description: '体力。', role: 'stamina', initial: 1, minimum: 0, maximum: 10 },
        { key: 'resource.experience', title: '经验', description: '经验。', role: 'experience', initial: 0, minimum: 0, maximum: 100 },
        { key: 'resource.skill', title: '技能点', description: '技能点。', role: 'skill-points', initial: 0, minimum: 0, maximum: 10 },
        { key: 'resource.currency', title: '货币', description: '货币。', role: 'currency', initial: 0, minimum: 0, maximum: 100 },
        { key: 'resource.clock', title: '时间', description: '时间。', role: 'clock', initial: 0, minimum: 0, maximum: 1000 },
      ],
      equipmentSlots: [
        { key: 'slot.weapon', title: '武器', acceptsTags: ['weapon'] },
        { key: 'slot.body', title: '身体', acceptsTags: ['armor'] },
      ],
      starterEquipment: [{
        key: 'item.lamp', title: '灯杖', description: '旧灯杖。', slotKey: 'slot.weapon', tags: ['weapon'],
        modifierAbilityKey: 'ability.explore', modifierDelta: 1,
      }],
    }
    expect(() => parseTextAdventureSystemsArtifactV1(systems, brief.textAdventure!))
      .toThrow(/health 初始值必须高于下限/)
    expect(() => parseTextAdventureQualityReviewArtifactV1({
      schema: 'storyforge.text-adventure-quality-review-artifact', version: 1,
      scores: {
        causality: 2, playerAgency: 4, routeDifferentiation: 4, pacing: 4,
        setupPayoff: 4, characterMotivation: 4, emotionalImpact: 4,
      },
      issues: [], passed: true,
    })).toThrow(/passed 与分数\/阻塞问题不一致/)
  })

  it('把主线场景单调分布到地点，并拒绝选项、正文与运行地点互相错位', () => {
    expect(planTextAdventureNarrativeLocationsV1(12, 8).map(item => item.locationIndex)).toEqual([
      0, 0, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7,
    ])
    const nodes = [
      { key: 'scene.001', kind: 'entry' as const, title: '北港开场', summary: '你仍在北港渔村。', conditionJson: '{}', effectsJson: '[]', successorKeys: ['scene.002'] },
      { key: 'scene.002', kind: 'scene' as const, title: '北港告别', summary: '北港渔村的灯火逐一亮起。', conditionJson: '{}', effectsJson: '[]', successorKeys: ['scene.003'] },
      { key: 'scene.003', kind: 'scene' as const, title: '工坊遗迹', summary: '你抵达坍塌工坊。', conditionJson: '{}', effectsJson: '[]', successorKeys: ['ending.001'] },
      { key: 'ending.001', kind: 'ending' as const, title: '结局', summary: '旅程结束。', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
    ]
    const beats = nodes.map((node, index) => ({
      beatKey: `beat.${index}`, nodeKey: node.key, kind: 'narration' as const,
      speakerKey: null, text: node.summary, order: 0,
    }))
    const choices = [
      { choiceKey: 'choice.001', sourceNodeKey: 'scene.001', text: '前往坍塌工坊确认记录', description: '', unavailableReason: '', targetNodeKey: 'scene.002', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0 },
      { choiceKey: 'choice.002', sourceNodeKey: 'scene.002', text: '进入坍塌工坊', description: '', unavailableReason: '', targetNodeKey: 'scene.003', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0 },
      { choiceKey: 'choice.003', sourceNodeKey: 'scene.003', text: '接受结局', description: '', unavailableReason: '', targetNodeKey: 'ending.001', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0 },
    ]
    expect(validateTextAdventureNarrativeLocationPlanV1({
      nodes, beats, choices, locationTitles: ['北港渔村', '坍塌工坊'],
    })).toEqual([
      'choice.001 提到「坍塌工坊」但目标节点位于「北港渔村」',
    ])
  })

  it('拒绝把一个地点的支线行动错误地显示在另一个地点', () => {
    const bundle = {
      schema: 'storyforge.text-adventure-quest-bundle-artifact', version: 1,
      bundleKind: 'side', entries: [{
        key: 'repair-lamp', title: '修好引航灯', description: '在旧仓街修好受潮的灯芯。',
        hook: '旧仓街的船工正在等待帮助。', objective: '修好引航灯', locationOrdinal: 2,
        abilityKey: 'ability.craft', difficulty: 10,
        successText: '灯重新亮起。', costlySuccessText: '灯亮了，但耗掉了备用燃料。',
        failureText: '灯仍未亮，但船工指出了另一条路。', rewardExperience: 5,
        rewardCurrency: 1, timeCostMinutes: 10,
      }],
    }
    expect(parseTextAdventureQuestBundleArtifactV1(
      bundle, 'side', 1, ['潮门广场', '旧仓街'],
    ).entries[0].locationOrdinal).toBe(2)
    expect(() => parseTextAdventureQuestBundleArtifactV1(
      { ...bundle, entries: [{ ...bundle.entries[0], locationOrdinal: 1 }] },
      'side', 1, ['潮门广场', '旧仓街'],
    )).toThrow(/地点锚点无效.*绑定「潮门广场」却把行动写在「旧仓街」/)
  })

  it('向非技术作者渐进展示空间、任务、系统和边界确认', async () => {
    const onChange = vi.fn()
    await act(async () => root.render(createElement(TextAdventureProductionWizard, {
      value: createDefaultTextAdventureProductionWizardValueV1('short-arc'),
      onChange,
    })))
    expect(host.textContent).toContain('文字冒险产品契约')
    expect(host.textContent).toContain('属性、技能、生命/法力/体力')
    expect(host.textContent).toContain('调查证据盘、法庭、生存、政治、恋爱阶段')
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => checkbox.click())
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ confirmAll: true }))
  })
})
