import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextAdventureProductionWizard, {
  createDefaultTextAdventureProductionWizardValueV1,
} from '../../src/components/text-game/TextAdventureProductionWizard'
import {
  parseTextAdventureQuestBundleArtifactV2,
  parseTextAdventureQualityReviewArtifactV1,
  parseTextAdventureSystemsArtifactV1,
} from '../../src/lib/adventure/production-artifacts'
import {
  planTextAdventureNarrativeLocationsV1,
  validateTextAdventureNarrativeLocationPlanV1,
} from '../../src/lib/adventure/narrative-location-plan'
import { db } from '../../src/lib/db/schema'
import {
  getAgentSkillV1,
  TEXT_ADVENTURE_PRODUCTION_AGENT_IDS,
} from '../../src/lib/agent/skill-registry'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  createProductProductionPlanV3,
  textAdventureProductionBudgetFloorV1,
} from '../../src/lib/product-production/plan'
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

  it('把专业多 Agent 团队的来源、故事、角色、空间、系统、任务、场景、美术与装配编成有界 DAG', async () => {
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
    expect(getAgentSkillV1('text-adventure.cast-bible.v1')).toMatchObject({
      agentId: 'text-adventure-cast-director',
      promptVersion: 'text-adventure-cast-bible-v2',
      maxOutputTokens: 16_000,
    })
    expect(getAgentSkillV1('text-adventure.narrative-design.v1')).toMatchObject({
      agentId: 'text-adventure-narrative-designer',
      promptVersion: 'text-adventure-narrative-design-v2',
    })
    const briefHash = await hashProductProductionValueV2(brief)
    const plan = await createProductProductionPlanV3({ buildNumber: 1, briefHash, brief })
    const taskByKey = new Map(plan.tasks.map(task => [task.taskKey, task]))
    expect(brief.productionBudget.maximumModelCalls).toBeGreaterThanOrEqual(64)
    expect(brief.productionBudget.maximumModelCalls).toBeGreaterThanOrEqual(80)
    expect(brief.productionBudget.maximumInputTokens).toBeGreaterThanOrEqual(1_024_000)
    expect(brief.productionBudget.maximumOutputTokens).toBeGreaterThanOrEqual(512_000)
    expect(brief.productionBudget.maximumModelCalls).toBeGreaterThanOrEqual(
      textAdventureProductionBudgetFloorV1(brief).minimumModelCalls,
    )
    expect(taskByKey.get('production.supervision')?.budgetReservation.outputTokens)
      .toBe(Math.floor(200_000 * 0.02))
    expect(taskByKey.get('content.source-sufficiency')?.budgetReservation.outputTokens)
      .toBe(Math.floor(200_000 * 0.04))
    expect(taskByKey.get('content.source-sufficiency')?.timeoutMs).toBe(300_000)
    expect(taskByKey.get('content.cast-bible')?.budgetReservation.outputTokens)
      .toBe(Math.floor(200_000 * 0.045))
    expect(taskByKey.get('content.story-bible')?.budgetReservation.outputTokens)
      .toBe(Math.floor(200_000 * 0.025))
    expect(taskByKey.get('content.narrative-arc-scenes')?.budgetReservation.outputTokens)
      .toBe(Math.floor(200_000 * 0.035))
    expect(taskByKey.get('content.narrative-decision-plan')?.budgetReservation.outputTokens)
      .toBe(Math.floor(200_000 * 0.03))
    expect(taskByKey.get('content.narrative-arc-plan')?.budgetReservation.outputTokens).toBe(0)
    expect(taskByKey.get('content.quest-script.main.act-1.single')?.budgetReservation.outputTokens)
      .toBe(Math.floor(200_000 * 0.025))
    expect(taskByKey.get('content.quest-script.main.act-1.multi')?.budgetReservation.outputTokens)
      .toBe(Math.floor(200_000 * 0.03))
    expect(taskByKey.get('content.quest-script.supplemental')?.budgetReservation.outputTokens)
      .toBe(Math.floor(200_000 * 0.04))
    expect(taskByKey.get('content.adventure-ambient-events')?.budgetReservation.outputTokens)
      .toBe(Math.floor(200_000 * 0.03))
    expect(taskByKey.get('content.dialogue-pass.act-1')?.budgetReservation.outputTokens)
      .toBe(Math.floor(200_000 * 0.055))
    expect(taskByKey.get('content.dialogue-pass.act-1')?.budgetReservation.inputTokens)
      .toBe(Math.floor(528_000 * 0.035))
    expect(taskByKey.get('content.scene-script.act-1.part-1')?.budgetReservation.inputTokens)
      .toBe(Math.floor(528_000 * 0.035))
    expect(taskByKey.get('content.adventure-quality-review')?.budgetReservation.inputTokens)
      .toBe(Math.floor(528_000 * 0.075))
    expect(taskByKey.get('content.adventure-quality-review')?.budgetReservation.outputTokens)
      .toBe(Math.floor(200_000 * 0.075))
    expect([
      'content.scene-script.act-1.part-1', 'content.scene-script.act-1.part-2',
      'content.scene-script.act-2.part-1', 'content.scene-script.act-2.part-2',
      'content.scene-script.act-3.part-1', 'content.scene-script.act-3.part-2',
    ].reduce((sum, taskKey) => sum + taskByKey.get(taskKey)!.budgetReservation.outputTokens, 0))
      .toBe(Math.floor(200_000 * 0.12) * 6)
    expect(taskByKey.get('content.scene-script.act-1.part-1')?.budgetReservation.durationMs)
      .toBe(300_000)
    expect(plan.tasks.reduce((sum, task) => sum + task.budgetReservation.outputTokens, 0))
      .toBeLessThanOrEqual(Math.floor(brief.productionBudget.maximumOutputTokens * 1.3))
    expect(plan.tasks.reduce((sum, task) => sum + task.budgetReservation.inputTokens, 0))
      .toBeLessThanOrEqual(brief.productionBudget.maximumInputTokens)
    expect([...taskByKey.keys()]).toEqual(expect.arrayContaining([
      'production.supervision',
      'content.source-sufficiency', 'source.author-gate', 'content.design', 'content.story-bible', 'content.cast-bible',
      'content.adventure-architecture', 'content.product-module', 'content.narrative-arc-scenes',
      'content.narrative-decision-plan', 'content.narrative-arc-plan',
      'content.main-quest-plan', 'content.adventure-side-quests', 'content.adventure-ambient-events',
      'content.quest-script.main.act-1.single', 'content.quest-script.main.act-1.multi',
      'content.quest-script.main.act-2.single', 'content.quest-script.main.act-2.multi',
      'content.quest-script.main.act-3.single', 'content.quest-script.main.act-3.multi',
      'content.quest-script.supplemental',
      'content.quest-script',
      'content.scene-script.act-1.part-1', 'content.scene-script.act-1.part-2', 'content.scene-script.act-1',
      'content.scene-script.act-2.part-1', 'content.scene-script.act-2.part-2', 'content.scene-script.act-2',
      'content.scene-script.act-3.part-1', 'content.scene-script.act-3.part-2', 'content.scene-script.act-3',
      'content.dialogue-pass.act-1',
      'content.dialogue-pass.act-2', 'content.dialogue-pass.act-3', 'integration.narrative',
      'content.adventure-quality-review', 'media.requirements', 'media.visual-bible.compile',
      'media.anchor-author-gate', 'media.visual.001', 'media.visual.002',
      'media.audit', 'media.visual-quality-review',
      'integration.package', 'qa.autoplay', 'qa.release', 'qa.playtest-strategy',
    ]))
    expect(taskByKey.get('production.supervision')).toMatchObject({
      skillId: 'text-adventure.production-supervision.v1', dependsOn: [],
      inputArtifactKeys: [], outputArtifactKeys: ['production.supervision'],
      acceptanceGateIds: ['artifact.protocol', 'adventure.production-supervision'],
    })
    expect(taskByKey.get('content.source-sufficiency')).toMatchObject({
      skillId: 'text-adventure.source-sufficiency.v1', dependsOn: ['production.supervision'],
      inputArtifactKeys: ['production.supervision'],
      outputArtifactKeys: ['content.source-sufficiency'],
    })
    expect(taskByKey.get('source.author-gate')).toMatchObject({
      executionMode: 'deterministic', skillId: null,
      dependsOn: ['content.source-sufficiency'],
      inputArtifactKeys: ['content.source-sufficiency'],
      outputArtifactKeys: ['content.source-decision'],
    })
    expect(taskByKey.get('content.design')).toMatchObject({
      dependsOn: ['source.author-gate', 'production.supervision'],
      inputArtifactKeys: ['production.supervision', 'content.source-sufficiency', 'content.source-decision'],
    })
    expect(taskByKey.get('content.story-bible')?.dependsOn).toEqual([
      'source.author-gate', 'content.design',
    ])
    expect(taskByKey.get('content.cast-bible')?.dependsOn).toEqual([
      'content.source-sufficiency', 'content.story-bible',
    ])
    expect(taskByKey.get('content.narrative-arc-scenes')?.dependsOn).toEqual([
      'content.story-bible', 'content.cast-bible', 'content.adventure-architecture', 'content.product-module',
    ])
    expect(taskByKey.get('content.narrative-arc-scenes')?.skillId).toBe('text-adventure.narrative-design.v1')
    expect(taskByKey.get('content.narrative-decision-plan')?.dependsOn).toEqual([
      'content.story-bible', 'content.cast-bible', 'content.narrative-arc-scenes',
    ])
    expect(taskByKey.get('content.narrative-decision-plan')?.skillId)
      .toBe(taskByKey.get('content.narrative-arc-scenes')?.skillId)
    expect(taskByKey.get('content.narrative-arc-plan')).toMatchObject({
      executionMode: 'deterministic',
      dependsOn: [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.narrative-arc-scenes', 'content.narrative-decision-plan',
      ],
    })
    expect(taskByKey.get('content.main-quest-plan')?.dependsOn).toEqual([
      'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
      'content.product-module', 'content.narrative-arc-plan',
    ])
    expect(taskByKey.get('content.quest-script.main.act-1.single')).toMatchObject({
      executionMode: 'model', skillId: 'text-adventure.quest-script.v1',
      outputArtifactKeys: ['content.quest-script.main.act-1.single'],
    })
    expect(taskByKey.get('content.quest-script.supplemental')).toMatchObject({
      executionMode: 'model', skillId: 'text-adventure.quest-script.v1',
      dependsOn: [
        'content.product-module', 'content.adventure-side-quests', 'content.adventure-ambient-events',
      ],
    })
    expect(taskByKey.get('content.quest-script')).toMatchObject({
      executionMode: 'deterministic', skillId: null,
      dependsOn: [
        'content.quest-script.main.act-1.single', 'content.quest-script.main.act-1.multi',
        'content.quest-script.main.act-2.single', 'content.quest-script.main.act-2.multi',
        'content.quest-script.main.act-3.single', 'content.quest-script.main.act-3.multi',
        'content.quest-script.supplemental',
      ],
      outputArtifactKeys: ['content.quest-script'],
    })
    expect(taskByKey.get('content.scene-script.act-1.part-1')).toMatchObject({
      skillId: 'text-adventure.scene-script.v1',
      dependsOn: [
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.product-module', 'content.narrative-arc-plan',
        'content.main-quest-plan', 'content.adventure-side-quests', 'content.adventure-ambient-events',
        'content.quest-script',
      ],
      timeoutMs: 300_000,
    })
    expect(taskByKey.get('content.scene-script.act-1.part-1')!.budgetReservation.outputTokens)
      .toBeGreaterThan(0)
    expect(taskByKey.get('content.scene-script.act-1')).toMatchObject({
      executionMode: 'deterministic', skillId: null,
      dependsOn: ['content.scene-script.act-1.part-1', 'content.scene-script.act-1.part-2'],
      outputArtifactKeys: ['content.scene-script.act-1'],
    })
    expect(taskByKey.get('integration.narrative')).toMatchObject({
      executionMode: 'deterministic',
      dependsOn: expect.arrayContaining([
        'content.scene-script.act-1', 'content.scene-script.act-2', 'content.scene-script.act-3',
        'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2', 'content.dialogue-pass.act-3',
      ]),
      outputArtifactKeys: ['content.narrative'],
    })
    expect(taskByKey.get('content.dialogue-pass.act-1')).toMatchObject({
      skillId: 'text-adventure.dialogue-pass.v1',
      dependsOn: expect.arrayContaining([
        'content.cast-bible', 'content.scene-script.act-1',
      ]),
      outputArtifactKeys: ['content.dialogue-pass.act-1'],
    })
    expect(taskByKey.get('content.adventure-side-quests')?.dependsOn).toEqual([
      'content.adventure-architecture', 'content.product-module', 'content.main-quest-plan',
    ])
    expect(taskByKey.get('content.adventure-quality-review')).toMatchObject({
      skillId: 'text-adventure.production-quality-review.v1',
      dependsOn: [
        'production.supervision',
        'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
        'content.product-module', 'content.narrative-arc-plan', 'content.main-quest-plan',
        'content.adventure-side-quests', 'content.adventure-ambient-events', 'content.quest-script',
        'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2', 'content.dialogue-pass.act-3',
        'integration.narrative',
      ],
      outputArtifactKeys: ['quality.adventure-review'],
    })
    expect(taskByKey.get('media.requirements')?.dependsOn).toEqual(['content.adventure-quality-review'])
    expect(taskByKey.get('media.visual-bible.compile')).toMatchObject({
      executionMode: 'deterministic', skillId: null, dependsOn: ['media.requirements'],
      inputArtifactKeys: ['content.cast-bible', 'content.adventure-architecture', 'media.requirements'],
      outputArtifactKeys: ['media.visual-bible'],
    })
    expect(taskByKey.get('media.anchor-author-gate')).toMatchObject({
      executionMode: 'deterministic', skillId: null, dependsOn: ['media.visual-bible.compile'],
      inputArtifactKeys: ['content.cast-bible', 'media.visual-bible'],
      outputArtifactKeys: ['media.anchor-decision'], failurePolicy: 'pause',
    })
    expect(taskByKey.get('integration.package')?.failurePolicy).toBe('pause')
    expect(taskByKey.get('qa.autoplay')).toMatchObject({
      executionMode: 'deterministic', dependsOn: ['integration.package'],
      inputArtifactKeys: ['runtime.package'], outputArtifactKeys: ['quality.autoplay'],
    })
    expect(taskByKey.get('media.visual.001')).toMatchObject({
      executionMode: 'media-provider', dependsOn: ['media.anchor-author-gate'],
      inputArtifactKeys: ['media.requirements', 'content.cast-bible', 'media.visual-bible', 'media.anchor-decision'],
      outputArtifactKeys: ['media.visual.001'],
      budgetReservation: expect.objectContaining({ mediaCalls: 1 }),
    })
    expect(taskByKey.get('media.visual.002')).toMatchObject({
      executionMode: 'media-provider', dependsOn: ['media.anchor-author-gate'],
      outputArtifactKeys: ['media.visual.002'],
      budgetReservation: expect.objectContaining({ mediaCalls: 1 }),
    })
    expect(taskByKey.get('media.audit')).toMatchObject({
      executionMode: 'deterministic', skillId: null,
      dependsOn: ['media.visual.001', 'media.visual.002'],
      inputArtifactKeys: [
        'media.requirements', 'content.cast-bible', 'media.visual-bible',
        'media.visual.001', 'media.visual.002',
      ],
      outputArtifactKeys: ['media.audit'],
    })
    expect(taskByKey.get('media.visual-quality-review')).toMatchObject({
      executionMode: 'model', skillId: 'text-adventure.visual-quality-review.v1',
      dependsOn: ['media.audit'],
      inputArtifactKeys: [
        'content.cast-bible', 'media.requirements', 'media.visual-bible', 'media.audit',
        'media.visual.001', 'media.visual.002',
      ],
      outputArtifactKeys: ['quality.visual-review'],
    })
    expect(taskByKey.get('qa.release')?.failurePolicy).toBe('pause')
    expect(taskByKey.get('qa.release')?.dependsOn).toEqual(['integration.package', 'qa.autoplay'])
    expect(taskByKey.get('qa.playtest-strategy')).toMatchObject({
      skillId: 'text-adventure.playtest-strategy.v1',
      dependsOn: ['qa.autoplay', 'qa.release'],
      inputArtifactKeys: ['runtime.package', 'quality.autoplay', 'quality.report'],
      outputArtifactKeys: ['quality.playtest-plan'],
    })
    const activeAgentIds = new Set(plan.tasks.flatMap(task => {
      if (!task.skillId) return []
      const agentId = getAgentSkillV1(task.skillId).agentId
      return TEXT_ADVENTURE_PRODUCTION_AGENT_IDS.includes(agentId as never) ? [agentId] : []
    }))
    expect(activeAgentIds).toEqual(new Set(TEXT_ADVENTURE_PRODUCTION_AGENT_IDS))
    const skillIdsByAgent = new Map<string, Set<string>>()
    for (const task of plan.tasks) {
      if (!task.skillId) continue
      const agentId = getAgentSkillV1(task.skillId).agentId
      if (!TEXT_ADVENTURE_PRODUCTION_AGENT_IDS.includes(agentId as never)) continue
      const skillIds = skillIdsByAgent.get(agentId) ?? new Set<string>()
      skillIds.add(task.skillId)
      skillIdsByAgent.set(agentId, skillIds)
    }
    expect([...skillIdsByAgent.values()].every(skillIds => skillIds.size === 1)).toBe(true)
    expect(plan.terminalTaskKey).toBe('qa.playtest-strategy')
    expect(taskByKey.get('integration.package')?.inputArtifactKeys).toEqual(expect.arrayContaining([
      'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
      'content.narrative-arc-plan', 'content.main-quest-plan', 'content.adventure-side-quests',
      'content.adventure-ambient-events', 'content.dialogue-pass.act-1',
      'content.dialogue-pass.act-2', 'content.dialogue-pass.act-3', 'quality.adventure-review',
      'media.visual-bible', 'media.anchor-decision', 'media.audit',
      'quality.visual-review', 'media.visual.001', 'media.visual.002',
    ]))
  })

  it('商业文字冒险不会再把两张图伪装成社区推荐关键插图档', async () => {
    const owned = await seedCurrentProductWorld('TEXTADV-2 商业媒资规模')
    const consultation = await suggestProductStartingPoints({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
    })
    const keyIllustrations = await draftProductProductionBriefV3({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
      suggestionKey: consultation.suggestions[0].suggestionKey,
      productType: 'text-adventure',
      qualityProfile: 'commercial-candidate',
      scale: 'short-arc',
      visualLevel: 'key-scenes',
      audioLevel: 'none',
      playerRole: '守灯人',
      openingSituation: '在潮门关闭前完成主线。',
      textAdventure: { confirmAll: true },
    })
    expect(keyIllustrations.media).toMatchObject({
      visualLevel: 'key-scenes', imageCount: 12, requiredMediaKinds: ['background'],
    })
    expect(keyIllustrations.completionContract.requiredGateIds).toContain(
      'product.adventure.recommendation-media-composition',
    )
    expect((await createProductProductionPlanV3({
      buildNumber: 1,
      briefHash: await hashProductProductionValueV2(keyIllustrations),
      brief: keyIllustrations,
    })).tasks.filter(task => /^media\.visual\.\d{3}$/.test(task.taskKey))).toHaveLength(12)

    const richIllustrations = await draftProductProductionBriefV3({
      scope: owned.scope,
      worldReleaseId: owned.release.id!,
      suggestionKey: consultation.suggestions[0].suggestionKey,
      productType: 'text-adventure',
      qualityProfile: 'commercial-candidate',
      scale: 'short-arc',
      visualLevel: 'illustrated',
      audioLevel: 'none',
      playerRole: '守灯人',
      openingSituation: '在潮门关闭前完成主线。',
      textAdventure: { confirmAll: true },
    })
    expect(richIllustrations.media.imageCount).toBe(24)
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
    expect(() => parseTextAdventureSystemsArtifactV1({
      ...systems,
      resources: systems.resources.map(resource => resource.role === 'health'
        ? { ...resource, initial: 10 }
        : resource.role === 'clock' ? { ...resource, initial: 3600, maximum: 10_000 } : resource),
    }, brief.textAdventure!)).toThrow(/clock 必须以分钟记录.*initial\/minimum 必须为 0/)
    expect(parseTextAdventureQualityReviewArtifactV1({
      schema: 'storyforge.text-adventure-quality-review-artifact', version: 1,
      scores: {
        causality: 2, playerAgency: 4, routeDifferentiation: 4, pacing: 4,
        setupPayoff: 4, characterMotivation: 4, emotionalImpact: 4,
      },
      issues: [], passed: true,
    })).toMatchObject({ passed: false, scores: { causality: 2 } })
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
      schema: 'storyforge.text-adventure-quest-bundle-artifact', version: 2,
      bundleKind: 'side', entries: [{
        key: 'repair-lamp', title: '修好引航灯', description: '在旧仓街修好受潮的灯芯。',
        hook: '旧仓街的船工正在等待帮助。',
        stages: [{
          key: 'find-wick', title: '寻找灯芯', objective: '在旧仓街找到备用灯芯', locationOrdinal: 2,
          actionKind: 'inspect', abilityKey: 'ability.craft', difficulty: 10,
          successText: '你在旧仓街找到了灯芯。', costlySuccessText: '你在旧仓街找到灯芯，但耗掉了备用燃料。',
          failureText: '旧仓街没有灯芯，船工却指出了潮门广场的旧储藏箱。', timeCostMinutes: 6,
        }, {
          key: 'repair', title: '修复灯火', objective: '在潮门广场修好引航灯', locationOrdinal: 1,
          actionKind: 'use', abilityKey: 'ability.craft', difficulty: 12,
          successText: '潮门广场的灯重新亮起。', costlySuccessText: '潮门广场的灯亮了，但你烧伤了手。',
          failureText: '潮门广场的灯仍不稳定，却照出了备用航道。', timeCostMinutes: 8,
        }],
        rewardExperience: 5, rewardCurrency: 1,
      }],
    }
    expect(parseTextAdventureQuestBundleArtifactV2(
      bundle, 'side', 1, ['潮门广场', '旧仓街', '信号塔'],
    ).entries[0].stages.map(stage => stage.locationOrdinal)).toEqual([2, 1])
    expect(() => parseTextAdventureQuestBundleArtifactV2(
      { ...bundle, entries: [{
        ...bundle.entries[0],
        stages: [{ ...bundle.entries[0].stages[0], locationOrdinal: 3 }, bundle.entries[0].stages[1]],
      }] },
      'side', 1, ['潮门广场', '旧仓街', '信号塔'],
    )).toThrow(/地点锚点无效.*绑定「信号塔」却把行动写在「旧仓街」/)
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
