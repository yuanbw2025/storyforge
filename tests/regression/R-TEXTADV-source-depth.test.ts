import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { db } from '../../src/lib/db/schema'
import { textAdventureMandatoryFullWorldResourcesV1 } from '../../src/lib/adventure/world-source-requirements'
import { createProductProductionSourcePlanV1, executeProductProductionWorldGatewayV1 } from '../../src/lib/product-production/source-contracts'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { loadProductProductionConsultationSourceV2 } from '../../src/lib/product-production/world-source'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { seedCurrentProductWorld, currentProductSelection } from '../helpers/current-product-world'

describe('R-TEXTADV-source-depth · specialist full-source obligations', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('角色与空间岗位覆盖全部入选对象，不按前三项截取且不越过选择', () => {
    const selection = currentProductSelection('text-adventure', {
      characters: ['c1', 'c2', 'c3', 'c4', 'c5'],
      locations: ['l1', 'l2', 'l3', 'l4'],
    })
    selection.roleBindings.characters.push('unselected')
    const input = { productType: 'text-adventure' as const, selection,
      task: { taskKey: 'content.cast-bible', skillId: 'text-adventure.cast-bible.v1', executionMode: 'model' as const } }
    expect(textAdventureMandatoryFullWorldResourcesV1(input)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    expect(textAdventureMandatoryFullWorldResourcesV1({ ...input, task: {
      ...input.task, taskKey: 'content.adventure-architecture', skillId: 'text-adventure.production-architecture.v1',
    } })).toEqual(['l1', 'l2', 'l3', 'l4'])
    expect(textAdventureMandatoryFullWorldResourcesV1({ ...input, productType: 'avg' })).toEqual([])
    expect(textAdventureMandatoryFullWorldResourcesV1({ ...input, task: { ...input.task, skillId: 'product-production.content.v1' } })).toEqual([])
    expect(textAdventureMandatoryFullWorldResourcesV1({ ...input, task: { ...input.task, executionMode: 'deterministic' } })).toEqual([])
  })

  it('真实 Gateway 完整读取五名入选角色及全部审计资料，留下深度证据且排除第六名', async () => {
    const owned = await seedCurrentProductWorld('完整来源回归', { minimumCharacters: 6 })
    for (const [index, id] of owned.characterIds.entries()) {
      await db.characters.update(id, { appearance: `完整外貌锚点：第${index + 1}位角色戴蓝铜耳扣`, speechStyle: '完整语言锚点：先问潮位再说日期' })
    }
    owned.release = await publishWorldRevision((await createWorldRevision({ scope: owned.scope, label: '完整角色外貌与语言' })).id!)
    const source = await loadProductProductionConsultationSourceV2({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const characters = source.selectionCatalog.characterResourceKeys.slice(0, 5)
    const outside = source.selectionCatalog.characterResourceKeys[5]!
    const brief = await draftProductProductionBriefV3({
      scope: owned.scope, worldReleaseId: owned.release.id!, suggestionKey: suggestions.suggestions[0].suggestionKey,
      productType: 'text-adventure', qualityProfile: 'prototype', scale: 'short-arc',
      visualLevel: 'none', audioLevel: 'none', textAdventure: { confirmAll: true },
      sourceSelection: { ...source.selectionCatalog, characterResourceKeys: characters },
    })
    const sourcePlan = await createProductProductionSourcePlanV1({ scope: owned.scope, productionKey: 'source-depth-test', brief })
    // Reproduce the existing frozen plan: only the first three role anchors
    // are initial resources. The task must close the remaining read obligation.
    expect(characters.filter(key => sourcePlan.initialResourceKeys.includes(key)).length).toBeLessThan(5)
    const plan = await createProductProductionPlanV3({ buildNumber: 1, briefHash: await hashProductProductionValueV2(brief), brief })
    for (const taskKey of ['content.source-sufficiency', 'content.story-bible', 'content.cast-bible']) {
      const task = plan.tasks.find(row => row.taskKey === taskKey)!
      const execution = await executeProductProductionWorldGatewayV1({ scope: owned.scope, sourcePlan, brief, task, budgetTokens: 50_000 })
      const required = taskKey === 'content.cast-bible' ? characters : brief.source.selection.resourceKeys
      for (const key of required) {
        expect(execution.selector.selected.find(row => row.resourceKey === key)).toMatchObject({ depth: 'full', hardRequirement: true })
        expect(execution.sourceSnapshots.find(row => row.resourceKey === key)?.content.length).toBeGreaterThan(0)
      }
      for (const key of characters) {
        const content = execution.sourceSnapshots.find(row => row.resourceKey === key)!.content
        expect(content).toContain('完整外貌锚点')
        expect(content).toContain('完整语言锚点')
      }
      expect(execution.sourceSnapshots.some(row => row.resourceKey === outside)).toBe(false)
      expect(execution.metrics.additionalPlanningModelCalls).toBe(0)
    }
    await expect(executeProductProductionWorldGatewayV1({ scope: owned.scope, sourcePlan, brief,
      task: plan.tasks.find(row => row.taskKey === 'content.source-sufficiency')!, budgetTokens: 1,
    })).rejects.toThrow(/hard-sufficiency/)
  }, 30_000)
})
