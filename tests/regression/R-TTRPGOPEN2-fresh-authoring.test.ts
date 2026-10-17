import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readTtrpgDraft, saveTtrpgDraft, prepareTtrpgBrief,
  prepareTtrpgOpenProductionBriefV3 } from '../../src/lib/ttrpg/authoring-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'

import { createFreshOpenDraftFixtureV1 as fixture } from '../helpers/open-ttrpg-fresh-authoring'

describe('R-TTRPGOPEN2 fresh open production preparation', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('prepares and authorizes open directly from a new Work with no earlier scripted production or Brief', async () => {
    const { scope, draft } = await fixture()
    expect(await db.productProductions.count()).toBe(0); expect(await db.productProductionBriefs.count()).toBe(0)
    const productionId = await prepareTtrpgBrief(scope, draft.revision)
    const row = (await db.productProductionBriefs.where('productionId').equals(productionId).first())!
    const brief = parseProductProductionBriefV3(row.briefJson), production = (await db.productProductions.get(productionId))!
    expect(brief.ttrpg).toBeUndefined(); expect(brief.ttrpgOpen!.runFormat).toBe('open')
    expect(brief.scale.targetEndingCount).toBe(0)
    expect(brief.capabilityRequirements.find(requirement => requirement.mediaClass === 'text')!.required).toBe(true)
    expect(brief.ttrpgOpen!.sourcePlan.productInstanceKey).toBe(production.productionKey)
    expect((await readTtrpgDraft(scope)).productionId).toBe(productionId)
    expect(await db.productBuilds.count()).toBe(0)
    const receipt = await executeProductProductionCommand({ scope, productionId, command: { type: 'authorize-start',
      commandId: 'fresh.open.author.start', expectedStateRevision: production.stateRevision, briefRevision: row.revision,
      briefHash: row.briefHash, authorizationNonce: 'author.checked.fresh.open' } })
    expect(receipt.ok).toBe(true)
    expect(await db.productBuilds.count()).toBe(1)
  })
  it('revises its own unstarted open production while preserving earlier confirmed Brief bytes', async () => {
    const { scope, draft, settings } = await fixture()
    const id = await prepareTtrpgOpenProductionBriefV3({ scope, revision: draft.revision, commandId: 'fresh.open.prepare' })
    const old = (await db.productProductionBriefs.where('productionId').equals(id).first())!
    const latest = await readTtrpgDraft(scope)
    settings.openingSituation = '暴风雨前确认谁掌握灯塔钥匙'
    const saved = await saveTtrpgDraft(scope, latest.revision, settings, '新建开放跑团')
    expect(await prepareTtrpgBrief(scope, saved.revision)).toBe(id)
    expect(await db.productProductions.count()).toBe(1)
    expect(await db.productProductionBriefs.where('productionId').equals(id).count()).toBe(2)
    expect((await db.productProductionBriefs.get(old.id!))!.briefJson).toBe(old.briefJson)
  })
  it('rejects a V1 rule, stale settings or incomplete open policy before creating production records', async () => {
    const first = await fixture(1)
    await expect(prepareTtrpgBrief(first.scope, first.draft.revision)).rejects.toThrow(/RulePack V1/)
    expect(await db.productProductions.count()).toBe(0)
    const second = await fixture()
    await expect(prepareTtrpgBrief(second.scope, second.draft.revision - 1)).rejects.toThrow(/已变化/)
    second.settings.openAuthoring.runtimePolicy = null
    const incomplete = await saveTtrpgDraft(second.scope, second.draft.revision, second.settings, '待补齐开放策略')
    await expect(prepareTtrpgBrief(second.scope, incomplete.revision)).rejects.toThrow(/尚未完成/)
    expect(await db.productProductions.count()).toBe(0); expect(await db.productProductionBriefs.count()).toBe(0)
  })
})
