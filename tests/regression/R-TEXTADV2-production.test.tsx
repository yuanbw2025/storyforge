import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextAdventureProductionWizard, {
  createDefaultTextAdventureProductionWizardValueV1,
} from '../../src/components/text-game/TextAdventureProductionWizard'
import {
  parseTextAdventureQualityReviewArtifactV1,
  parseTextAdventureSystemsArtifactV1,
} from '../../src/lib/adventure/production-artifacts'
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
