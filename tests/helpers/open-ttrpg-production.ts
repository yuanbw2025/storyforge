/** Internal authoring contract fixture, not evidence of normal UI or real-model production. */
import { db } from '../../src/lib/db/schema'
import { defaultTtrpgSettingsV2 } from '../../src/lib/ttrpg/authoring-contract-v2'
import { createTtrpgDraft, selectTtrpgWorld, prepareTtrpgBrief, readTtrpgDraft } from '../../src/lib/ttrpg/authoring-service'
import { createMistHarborWorld } from '../../src/lib/world-engine/mist-harbor-preset'
import { createTtrpgProductionBriefContentV3 } from '../../src/lib/ttrpg/production-brief-v3'
import { createTtrpgOpenProductionBriefV3 } from '../../src/lib/ttrpg/open-production-brief'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { openCampaignFixture, openRuleFixture } from './ttrpg-open-content'
import type { ProductSourcePlanV1 } from '../../src/lib/types'
export async function openProductionFixtureV1() {
  const settings = defaultTtrpgSettingsV2('scripted')
  settings.wizard.confirmAll = true; settings.openingSituation = '调查港口'
  const made = await createTtrpgDraft('open production contracts', settings), world = await createMistHarborWorld()
  const selected = await selectTtrpgWorld(made.scope, 0, world.worldReleaseId)
  const productionId = await prepareTtrpgBrief(made.scope, selected.revision)
  const row = (await db.productProductionBriefs.where('productionId').equals(productionId).first())!
  const scripted = parseProductProductionBriefV3(row.briefJson), sourcePlan = JSON.parse(row.sourcePlanJson) as ProductSourcePlanV1
  const open = defaultTtrpgSettingsV2('open')
  if (open.runFormat !== 'open') throw new Error('fixture format')
  const campaign = openCampaignFixture()
  open.openingSituation = scripted.intent.openingSituation; open.playerRole = scripted.intent.playerRole
  open.wizard.confirmAll = true; open.wizard.targetEndingCount = 0; open.wizard.targetSceneCount = 0
  open.openAuthoring = { factPolicy: [], situationTemplates: campaign.situationTemplates,
    openingSituationKeys: campaign.openingSituationKeys, effectPlanTemplates: campaign.effectPlanTemplates,
    pressure: { clocks: campaign.clocks, fronts: campaign.fronts }, companionPolicy: campaign.companionPolicy,
    stageClosurePolicy: campaign.stageClosurePolicy, dynamicEntityTemplates: campaign.dynamicEntityTemplates,
    runtimePolicy: campaign.runtimePolicy }
  const content = await createTtrpgProductionBriefContentV3({ settingsRevision: (await readTtrpgDraft(made.scope)).revision,
    settings: open, rulePack: openRuleFixture(), sourcePlan, worldReference: sourcePlan.worldReference })
  const { ttrpg: _scriptedContent, ...common } = scripted
  common.scale.targetEndingCount = 0
  common.media = { visualLevel: 'none', audioLevel: 'none', imageCount: 0, musicTrackCount: 0, sfxCount: 0,
    voiceLineCount: 0, requiredMediaKinds: [] }
  common.capabilityRequirements = common.capabilityRequirements.filter(requirement => requirement.mediaClass === 'text')
  const brief = await createTtrpgOpenProductionBriefV3({ common, content })
  return { brief, scripted, content, common, productionId, scope: made.scope }
}
