import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { openContextPolicyFixtureV1 } from '../helpers/open-ttrpg-context'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { compileProductionTtrpgOpenCampaignV2 } from '../../src/lib/ttrpg/open-production-compiler'
import { parseTtrpgCampaignContentV2 } from '../../src/lib/ttrpg/campaign-v2'

import { openProductionCompilerFixtureV1 as fixture } from '../helpers/open-ttrpg-production-artifacts'

describe('R-TTRPGOPEN2 deterministic compiler from actual adopted artifact hashes', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('assembles a no-ending open campaign with unchanged mechanics and real provenance, without invented proposals', async () => {
    const { input, ruleSystem } = await fixture()
    const compiled = await compileProductionTtrpgOpenCampaignV2(input)
    expect(compiled.characterTemplates).toEqual(ruleSystem.characterTemplates)
    expect(compiled.entityBindings).toEqual(ruleSystem.entityBindings)
    expect(compiled.scenes).toEqual([]); expect(compiled.endings).toEqual([]); expect(compiled.openingSceneKey).toBeNull()
    expect(compiled.sourceWorld.bundleHash).not.toBe(compiled.sourceWorld.contentHash)
    expect(compiled.designProvenance).toEqual({ schema: 'storyforge.ttrpg-open-design-provenance', version: 1,
      briefHash: input.briefHash, sourcePlanHash: input.brief.ttrpgOpen!.sourcePlan.planHash,
      sourceFactsArtifactHash: input.sourceFacts.contentHash, ruleSystemArtifactHash: input.ruleSystem.contentHash,
      situationLayerArtifactHash: input.situationLayer.contentHash })
    expect(parseTtrpgCampaignContentV2(compiled, input.brief.ttrpgOpen!.rulePack)).toEqual(compiled)
  })
  it('rejects raw artifact drift and unconfirmed source facts', async () => {
    const { input, sourceFacts, wrap } = await fixture()
    await expect(compileProductionTtrpgOpenCampaignV2({ ...input, sourceFacts: { ...input.sourceFacts, contentHash: 'f'.repeat(64) } })).rejects.toThrow(/hash/)
    sourceFacts.factPolicy[0].authorConfirmed = false
    await expect(compileProductionTtrpgOpenCampaignV2({ ...input, sourceFacts: await wrap(sourceFacts) })).rejects.toThrow(/作者确认/)
  })
  it('rejects unconfirmed mappings or a changed seat controller instead of adding defaults', async () => {
    const { input, ruleSystem, wrap } = await fixture()
    Object.values(ruleSystem.characterTemplates[0].attributeMappings)[0].authorConfirmed = false
    await expect(compileProductionTtrpgOpenCampaignV2({ ...input, ruleSystem: await wrap(ruleSystem) })).rejects.toThrow(/数值映射/)
    Object.values(ruleSystem.characterTemplates[0].attributeMappings)[0].authorConfirmed = true
    ruleSystem.characterTemplates[0].controller = 'ai'
    await expect(compileProductionTtrpgOpenCampaignV2({ ...input, ruleSystem: await wrap(ruleSystem) })).rejects.toThrow(/控制权/)
  })
  it('rejects changed runtime authorization and source provenance', async () => {
    const { input, sourceFacts, situationLayer, wrap } = await fixture()
    situationLayer.authoring.runtimePolicy!.maximumCallsPerEpoch++
    await expect(compileProductionTtrpgOpenCampaignV2({ ...input, situationLayer: await wrap(situationLayer) })).rejects.toThrow(/运行预算/)
    situationLayer.authoring.runtimePolicy!.maximumCallsPerEpoch--
    sourceFacts.factPolicy[0].fact.sourceFieldRefs[0].fieldPath = 'unknown.fake.field'
    await expect(compileProductionTtrpgOpenCampaignV2({ ...input, sourceFacts: await wrap(sourceFacts) })).rejects.toThrow(/来源/)
  })
  it('checks independent entity provenance even when all fact claims are valid', async () => {
    const { input, ruleSystem, wrap } = await fixture()
    ruleSystem.entityBindings[0].sourceFieldRefs[0].fieldPath = 'nonexistent.entity.field'
    await expect(compileProductionTtrpgOpenCampaignV2({ ...input, ruleSystem: await wrap(ruleSystem) })).rejects.toThrow(/来源/)
  })
  it('freezes an explicit authored context policy and rejects a model replacing or dropping it', async () => {
    const { input, situationLayer, wrap } = await fixture(), contextPolicy = openContextPolicyFixtureV1()
    input.brief.ttrpgOpen!.settings.openAuthoring.contextPolicy = contextPolicy
    input.briefHash = await hashProductProductionValueV2(input.brief)
    const layer = { ...situationLayer, authoring: { ...situationLayer.authoring, contextPolicy } }
    const compiled = await compileProductionTtrpgOpenCampaignV2({ ...input, situationLayer: await wrap(layer) })
    expect(compiled.contextPolicy).toEqual(contextPolicy)
    const drifted = structuredClone(layer); drifted.authoring.contextPolicy.triggers[0].trigger.injectText = 'Model changed an authored instruction.'
    await expect(compileProductionTtrpgOpenCampaignV2({ ...input, situationLayer: await wrap(drifted) })).rejects.toThrow(/策略/)
    await expect(compileProductionTtrpgOpenCampaignV2(input)).rejects.toThrow(/策略/)
  })
  it('does not let a model add an unrequested context policy to an old frozen Brief', async () => {
    const { input, situationLayer, wrap } = await fixture()
    const layer = { ...situationLayer, authoring: { ...situationLayer.authoring, contextPolicy: openContextPolicyFixtureV1() } }
    await expect(compileProductionTtrpgOpenCampaignV2({ ...input, situationLayer: await wrap(layer) })).rejects.toThrow(/策略/)
  })

})
