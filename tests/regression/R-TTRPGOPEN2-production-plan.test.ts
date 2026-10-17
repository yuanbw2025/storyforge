import { openProductionFixtureV1 } from '../helpers/open-ttrpg-production'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createTtrpgOpenProductionBriefV3 } from '../../src/lib/ttrpg/open-production-brief'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { createProductProductionPlanV3, parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { TTRPG_OPEN_PRODUCTION_TASK_KEYS_V1 } from '../../src/lib/ttrpg/open-production-plan'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

describe('R-TTRPGOPEN2 budgeted production envelope and distinct authoring DAG', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('freezes source/rules and an explicit production budget, with six open tasks and real terminal dependencies', async () => {
    const { brief } = await openProductionFixtureV1(), briefHash = await hashProductProductionValueV2(brief)
    const plan = await createProductProductionPlanV3({ brief, briefHash, buildNumber: 1 })
    expect(plan.tasks.map(task => task.taskKey)).toEqual(TTRPG_OPEN_PRODUCTION_TASK_KEYS_V1)
    expect(plan.terminalTaskKey).toBe('ttrpg.open.quality')
    expect(plan.tasks.find(task => task.taskKey === 'ttrpg.open.integration')!.dependsOn).toEqual([
      'ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer', 'ttrpg.open.media-plan'])
    expect(plan.tasks.some(task => ['content.narrative', 'content.product-module'].includes(task.taskKey))).toBe(false)
    expect(parseProductProductionPlanV3(JSON.stringify(plan), brief, briefHash)).toEqual(plan)
  })
  it('rejects a mixed format and a divergent world/direction', async () => {
    const { brief, scripted } = await openProductionFixtureV1()
    expect(() => parseProductProductionBriefV3({ ...brief, ttrpg: scripted.ttrpg })).toThrow(/只能/)
    expect(() => parseProductProductionBriefV3({ ...brief, source: { ...brief.source, worldContentHash: 'f'.repeat(64) } })).toThrow(/来源/)
    expect(() => parseProductProductionBriefV3({ ...brief, intent: { ...brief.intent, openingSituation: '别的开场' } })).toThrow(/方向/)
  })
  it('rejects damaged frozen rules and an insufficient author-approved budget before planning', async () => {
    const { brief, common, content } = await openProductionFixtureV1()
    await expect(createTtrpgOpenProductionBriefV3({ common, content: { ...content, rulePackHash: 'f'.repeat(64) } })).rejects.toThrow(/hash/)
    const limited = { ...brief, productionBudget: { ...brief.productionBudget, maximumModelCalls: 3 } }
    await expect(createProductProductionPlanV3({ brief: limited, briefHash: await hashProductProductionValueV2(limited), buildNumber: 1 })).rejects.toThrow(/预算/)
  })
  it('rejects an altered task budget or topology while leaving scripted construction unchanged', async () => {
    const { brief, scripted } = await openProductionFixtureV1(), briefHash = await hashProductProductionValueV2(brief)
    const plan = await createProductProductionPlanV3({ brief, briefHash, buildNumber: 1 })
    const changed = structuredClone(plan); changed.tasks[0].budgetReservation.inputTokens++
    expect(() => parseProductProductionPlanV3(changed, brief, briefHash)).toThrow(/预算/)
    const old = await createProductProductionPlanV3({ brief: scripted, briefHash: await hashProductProductionValueV2(scripted), buildNumber: 1 })
    expect(old.tasks.some(task => task.taskKey === 'content.narrative')).toBe(true)
    expect(old.tasks.some(task => task.taskKey === 'content.product-module')).toBe(true)
    expect(old.tasks.some(task => task.taskKey.startsWith('ttrpg.open.'))).toBe(false)
  })
  it('saves the budgeted envelope and authorizes a real Build through the existing production commands', async () => {
    const { brief, productionId, scope } = await openProductionFixtureV1()
    const production = (await db.productProductions.get(productionId))!
    const saved = await executeProductProductionCommand({ scope, productionId, command: { type: 'save-brief-revision',
      commandId: 'open.budgeted.save', expectedStateRevision: production.stateRevision,
      parentRevision: production.currentBriefRevision, brief } })
    expect(saved.ok).toBe(true)
    const next = (await db.productProductions.get(productionId))!
    const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([productionId, next.currentBriefRevision]).first())!
    expect(JSON.parse(row.briefJson)).toEqual(brief)
    expect(row.sourcePlanHash).toBe(brief.ttrpgOpen!.sourcePlan.planHash)
    const started = await executeProductProductionCommand({ scope, productionId, command: { type: 'authorize-start',
      commandId: 'open.budgeted.start', expectedStateRevision: next.stateRevision, briefRevision: row.revision,
      briefHash: row.briefHash, authorizationNonce: 'author.open.budgeted.start' } })
    expect(started.ok).toBe(true)
    expect((await db.productBuilds.where('productionId').equals(productionId).first())!.status).toBe('authorized')
    const replay = await executeProductProductionCommand({ scope, productionId, command: { type: 'authorize-start',
      commandId: 'open.budgeted.start', expectedStateRevision: next.stateRevision, briefRevision: row.revision,
      briefHash: row.briefHash, authorizationNonce: 'author.open.budgeted.start' } })
    expect(replay).toEqual({ ...started, replayed: true })
    expect(await db.productBuilds.where('productionId').equals(productionId).count()).toBe(1)
  })
  it('authorizes after a real project roundtrip using registry-remapped source locators and unchanged Brief bytes', async () => {
    const { brief, productionId, scope } = await openProductionFixtureV1()
    const production = (await db.productProductions.get(productionId))!
    await executeProductProductionCommand({ scope, productionId, command: { type: 'save-brief-revision',
      commandId: 'open.portable.save', expectedStateRevision: production.stateRevision,
      parentRevision: production.currentBriefRevision, brief } })
    const old = (await db.productProductionBriefs.where('[productionId+revision]').equals([productionId, 2]).first())!
    const restoredProject = await importProjectJSON(await exportProjectJSON(scope.projectId))
    const restored = (await db.productProductions.where('projectId').equals(restoredProject).first())!
    const restoredScope = { projectId: restoredProject, worldId: restored.worldId!, workId: restored.workId! }
    const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([restored.id!, 2]).first())!
    expect(row.briefJson).toBe(old.briefJson)
    expect(row.briefHash).toBe(old.briefHash)
    expect(row.sourceWorldReleaseId).not.toBe(old.sourceWorldReleaseId)
    const receipt = await executeProductProductionCommand({ scope: restoredScope, productionId: restored.id!, command: {
      type: 'authorize-start', commandId: 'open.portable.start', expectedStateRevision: restored.stateRevision,
      briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'author.open.portable.start' } })
    expect(receipt.ok).toBe(true)
    expect(await db.productBuilds.where('productionId').equals(productionId).count()).toBe(0)
    expect(await db.productBuilds.where('productionId').equals(restored.id!).count()).toBe(1)
  })
  it('includes actual shared media tasks and receipts within the confirmed budget instead of counting planning as generation', async () => {
    const { brief, scripted } = await openProductionFixtureV1()
    brief.media = { ...brief.media, visualLevel: 'key-scenes', imageCount: 2, requiredMediaKinds: ['background', 'character-pose'] }
    brief.capabilityRequirements.push(structuredClone(scripted.capabilityRequirements.find(requirement => requirement.mediaClass === 'image')!))
    const briefHash = await hashProductProductionValueV2(brief), plan = await createProductProductionPlanV3({ brief, briefHash, buildNumber: 1 })
    const media = plan.tasks.find(task => task.taskKey === 'media.visual')!
    expect(media).toMatchObject({ executionMode: 'media-provider', skillId: 'product-production.media-request.v1', failurePolicy: 'pause' })
    expect(media.outputArtifactKeys).toEqual(['media.visual.001', 'media.visual.002'])
    expect(media.budgetReservation.mediaCalls).toBe(2)
    const integration = plan.tasks.find(task => task.taskKey === 'ttrpg.open.integration')!
    expect(integration.requiredReceipts).toContainEqual({ taskKey: 'media.visual', receiptHash: null })
    expect(integration.inputArtifactKeys).toContain('media.visual.002')
    expect(plan.tasks.reduce((sum, task) => sum + task.budgetReservation.storageBytes, 0)).toBeLessThanOrEqual(brief.productionBudget.maximumStorageBytes)
    expect(() => parseProductProductionPlanV3(plan, brief, briefHash)).not.toThrow()
  })
})
