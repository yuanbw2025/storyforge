/** Isolated fresh Work fixture using only normal authoring/rule/world services. */
import { createTtrpgDraft, saveTtrpgDraft, selectTtrpgWorld } from '../../src/lib/ttrpg/authoring-service'
import { defaultTtrpgSettingsV2 } from '../../src/lib/ttrpg/authoring-contract-v2'
import { saveTtrpgRulePackV1, saveTtrpgRulePackV2 } from '../../src/lib/ttrpg/rule-pack-library'
import { createMistHarborWorld } from '../../src/lib/world-engine/mist-harbor-preset'
import { createStoryForgeRulePackV1 } from '../../src/lib/ttrpg/storyforge-rule-pack'
import { openCampaignFixture, openRuleFixture, openPublicationCampaignFixture } from './ttrpg-open-content'

export async function createFreshOpenDraftFixtureV1(ruleVersion: 1 | 2 = 2, publishable = false, options: { humanGm?: boolean; runtimeAIEnabled?: boolean; cooperative?: boolean; maximumEpochTokens?: number } = {}) {
    const settings = defaultTtrpgSettingsV2('open')
    if (settings.runFormat !== 'open') throw new Error('fixture format')
    settings.openingSituation = '潮水上涨时寻找灯塔钥匙'; settings.playerRole = '港口调查队'
    settings.wizard.confirmAll = true; settings.wizard.targetEndingCount = 0; settings.wizard.targetSceneCount = 0
    settings.wizard.maximumGeneratedAssets = 0
    const campaign = publishable ? openPublicationCampaignFixture() : openCampaignFixture()
    if (options.cooperative) {
      campaign.runtimePolicy.enabled = true; campaign.runtimePolicy.maximumEpochTokens = 50000
      for (const clock of campaign.clocks) clock.maximum = Math.max(12, clock.maximum)
      for (const front of campaign.fronts) for (const stage of front.escalationStages) stage.atClockValue = 10
      for (const situation of campaign.situationTemplates) {
        situation.consequences = []
        situation.obstacles = situation.obstacles.map(o => ({ ...o, predicate: { op: 'world-turn-at-least', value: 10 } }))
        situation.noInterventionOutcome.afterWorldTurns = 20
      }
    }
    if (options.maximumEpochTokens !== undefined) campaign.runtimePolicy.maximumEpochTokens = options.maximumEpochTokens
    settings.wizard.gmMode = campaign.gmMode
    Object.assign(settings.wizard, campaign.informationPolicy)
    settings.wizard.seats = campaign.characterTemplates.filter(template => template.role === 'player').map(template => ({
      seatKey: template.seatKey!, label: template.name, controller: template.controller === 'ai' ? 'ai' : 'human', role: 'player',
      characterMode: 'manual', sourceCharacterResourceKey: null, characterName: template.name, rankTier: null,
      privateGoal: template.playerProfile!.privateGoal }))
    settings.openAuthoring = { factPolicy: [], situationTemplates: campaign.situationTemplates,
      openingSituationKeys: campaign.openingSituationKeys, effectPlanTemplates: campaign.effectPlanTemplates,
      pressure: { clocks: campaign.clocks, fronts: campaign.fronts }, companionPolicy: campaign.companionPolicy,
      stageClosurePolicy: campaign.stageClosurePolicy, dynamicEntityTemplates: [], runtimePolicy: campaign.runtimePolicy }
    if (options.humanGm) settings.wizard.gmMode = 'human'
    if (options.runtimeAIEnabled !== undefined) settings.openAuthoring.runtimePolicy.enabled = options.runtimeAIEnabled
    const made = await createTtrpgDraft('新建开放跑团', settings), world = await createMistHarborWorld()
    const selected = await selectTtrpgWorld(made.scope, 0, world.worldReleaseId)
    const openRule = openRuleFixture()
    if (options.cooperative) openRule.actions.find(a => a.key === 'investigate')!.effects = []
    const rule = ruleVersion === 2 ? await saveTtrpgRulePackV2({ scope: made.scope, rulePack: openRule })
      : await saveTtrpgRulePackV1({ scope: made.scope, rulePack: createStoryForgeRulePackV1() })
    settings.wizard.ruleOrigin = 'saved-rule-pack'; settings.wizard.savedRulePackId = rule.id!
    const draft = await saveTtrpgDraft(made.scope, selected.revision, settings, '新建开放跑团')
    return { ...made, draft, settings }
  }
