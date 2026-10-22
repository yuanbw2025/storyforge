import { openProductionFixtureV1 } from './open-ttrpg-production'
import { openCampaignFixture, openPublicationCampaignFixture } from './ttrpg-open-content'
import { TTRPG_OPEN_LAYER_METADATA_KEYS_V1 } from '../../src/lib/ttrpg/open-production-artifacts'
import { resolveProductSourceReadBoundaryV1 } from '../../src/lib/product/source-contracts'
import { listWorldSemanticResourceDescriptorsV1 } from '../../src/lib/context-gateway/world-release-client'
import type { ProductProductionBriefV3, WorkspaceScope } from '../../src/lib/types'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { projectTtrpgRulePackMechanicalCoreV1 } from '../../src/lib/ttrpg/rule-pack-v2'
import { createCompleteTtrpgCharacterSheetV2 } from '../../src/lib/ttrpg/character-sheet'


export async function openProductionCompilerFixtureV1(publishable = false, basis?: { brief: ProductProductionBriefV3; productionId: number; scope: WorkspaceScope; preferAuthorSituations?: boolean }) {
    const { brief, productionId, scope } = (basis ?? await openProductionFixtureV1()), campaign = publishable ? openPublicationCampaignFixture() : openCampaignFixture(), open = brief.ttrpgOpen!
    if (basis?.preferAuthorSituations) campaign.situationTemplates = structuredClone(open.settings.openAuthoring.situationTemplates)
    const mechanical = projectTtrpgRulePackMechanicalCoreV1(open.rulePack)
    for (const template of campaign.characterTemplates) template.characterSheet = createCompleteTtrpgCharacterSheetV2({ template,rulePack: mechanical })
    campaign.gmMode = open.settings.wizard.gmMode
    campaign.runtimePolicy = structuredClone(open.settings.openAuthoring.runtimePolicy)
    const boundary = await resolveProductSourceReadBoundaryV1(open.sourcePlan)
    const descriptor = (await listWorldSemanticResourceDescriptorsV1(boundary.sourceScope)).find(row =>
      boundary.allowedResourceKeys.includes(row.resourceKey) && row.worldSemantic?.resourceKind === 'location')!
    const remapFixtureRefs = (value: unknown): unknown => typeof value === 'string' ? (value === 'world.harbor' ? descriptor.resourceKey : value)
      : Array.isArray(value) ? value.map(remapFixtureRefs) : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapFixtureRefs(item)])) : value
    const fact = structuredClone(campaign.frozenWorldPredicateIndex.entries[0])
    fact.sourceResourceRefs = [descriptor.resourceKey]
    fact.sourceFieldRefs = [{ resourceKey: descriptor.resourceKey, fieldPath: 'name', contentHash: descriptor.contentHash }]
    open.settings.wizard.seats = campaign.characterTemplates.filter(template => template.role === 'player').map(template => ({
      seatKey: template.seatKey!, label: template.name, controller: template.controller === 'ai' ? 'ai' : 'human', role: 'player',
      characterMode: 'manual', sourceCharacterResourceKey: null, characterName: template.name, rankTier: null,
      privateGoal: template.playerProfile!.privateGoal }))
    Object.assign(open.settings.wizard, campaign.informationPolicy)
    const sourceFacts = { schema: 'storyforge.ttrpg-open-source-facts', version: 1, factPolicy: [{ fact, authorConfirmed: true }] }
    const ruleSystem = { schema: 'storyforge.ttrpg-open-rule-system', version: 1, characterTemplates: campaign.characterTemplates,
      entityBindings: campaign.entityBindings, sessionZero: campaign.sessionZero, gmMode: campaign.gmMode,
      informationPolicy: campaign.informationPolicy }
    ruleSystem.entityBindings[0].sourceResourceRef = descriptor.resourceKey
    ruleSystem.entityBindings[0].sourceFieldRefs = structuredClone(fact.sourceFieldRefs)
    const { factPolicy: _facts, ...authoring } = structuredClone(open.settings.openAuthoring)
    authoring.situationTemplates = structuredClone(campaign.situationTemplates)
    const situationLayer = { schema: 'storyforge.ttrpg-open-situation-layer', version: 1, authoring,
      metadata: Object.fromEntries(TTRPG_OPEN_LAYER_METADATA_KEYS_V1.map(key => [key, structuredClone(campaign[key])])) }
    Object.assign(situationLayer, remapFixtureRefs(situationLayer))
    const wrap = async (payload: unknown) => ({ payload, contentHash: await hashProductProductionValueV2(payload) })
    const input = { brief, briefHash: await hashProductProductionValueV2(brief), campaignKey: 'campaign.author-open',
      sourceFacts: await wrap(sourceFacts), ruleSystem: await wrap(ruleSystem), situationLayer: await wrap(situationLayer) }
    return { input, sourceFacts, ruleSystem, situationLayer, wrap, productionId, scope }
  }
