import type { ProductProductionBriefV3, ProductRuntimePackageV1 } from '../types'
import { validateTtrpgCampaignForPublicationV1 } from '../ttrpg/campaign'

export interface ProductQualityGateV1 {
  gateId: string
  passed: boolean
  evidence: string[]
}

export interface ProductQualityReportV1 {
  productType: ProductRuntimePackageV1['productType']
  passed: boolean
  gates: ProductQualityGateV1[]
  warnings: string[]
}

function gate(gateId: string, passed: boolean, evidence: string[]): ProductQualityGateV1 {
  return { gateId, passed, evidence }
}

function estimatedTextUnits(values: string[]): number {
  const unique = [...new Set(values.map(value => value.trim()).filter(Boolean))]
  return unique.reduce((total, value) => {
    const cjk = value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
    const latin = value.match(/[\p{L}\p{N}]+/gu)?.filter(token => !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(token)).length ?? 0
    return total + cjk + latin
  }, 0)
}

/**
 * Product-specific structural quality gates. Parsers prove that a package is
 * valid; these gates prove that each product contains its own minimum playable
 * loop instead of merely sharing a narrative graph.
 */
export function evaluateProductRuntimeProductQualityV1(input: {
  runtimePackage: ProductRuntimePackageV1
  brief: ProductProductionBriefV3
}): ProductQualityReportV1 {
  const { runtimePackage, brief } = input
  const narrative = runtimePackage.narrative
  const endingCount = narrative.nodes.filter(node => node.kind === 'ending').length
  const nonEndingCount = narrative.nodes.length - endingCount
  const gates: ProductQualityGateV1[] = [
    gate('product.narrative.play-loop', nonEndingCount >= (brief.scale.targetPlayMinutes >= 45 ? 2 : 1)
      && narrative.choices.length >= 2,
    [`nonEndingNodes=${nonEndingCount}`, `choices=${narrative.choices.length}`, `minutes=${brief.scale.targetPlayMinutes}`]),
    gate('product.narrative.endings', endingCount >= (runtimePackage.productType === 'ttrpg'
      ? 2 : Math.max(1, Math.min(8, brief.scale.targetEndingCount))),
      [`endings=${endingCount}`, `target=${brief.scale.targetEndingCount}`]),
  ]

  if (runtimePackage.productType === 'ttrpg') {
    const ttrpg = runtimePackage.ttrpg
    const campaign = ttrpg?.campaign
    const targetScenes = brief.ttrpg?.story.targetSceneCount ?? 4
    const targetEndings = brief.ttrpg?.story.targetEndingCount ?? 2
    const targetQuests = brief.ttrpg?.story.targetQuestCount ?? 1
    const playerTemplates = campaign?.characterTemplates.filter(character => character.role === 'player') ?? []
    const requiredClues = campaign?.clues.filter(clue => clue.required) ?? []
    const campaignValidation = campaign && ttrpg
      ? validateTtrpgCampaignForPublicationV1(campaign, ttrpg.rulePack.content)
      : null
    gates.push(
      gate('product.ttrpg.rules', !!ttrpg && ttrpg.rulePack.content.tests.length >= 1
        && ttrpg.rulePack.content.license.commercialUse,
      [`fixtures=${ttrpg?.rulePack.content.tests.length ?? 0}`, `ruleVersion=${ttrpg?.rulePack.content.ruleSystemVersion ?? 'missing'}`]),
      gate('product.ttrpg.campaign-loop', !!campaign && campaign.scenes.length >= targetScenes
        && campaign.endings.length >= targetEndings && campaign.quests.length >= targetQuests
        && playerTemplates.length >= campaign.playerCount.minimum,
      [
        `scenes=${campaign?.scenes.length ?? 0}/${targetScenes}`,
        `endings=${campaign?.endings.length ?? 0}/${targetEndings}`,
        `quests=${campaign?.quests.length ?? 0}/${targetQuests}`,
        `players=${playerTemplates.length}`,
      ]),
      gate('product.ttrpg.clue-redundancy', requiredClues.length >= 1
        && requiredClues.every(clue => clue.discoveryPaths.length >= 2),
      [`requiredClues=${requiredClues.length}`, `redundant=${requiredClues.filter(clue => clue.discoveryPaths.length >= 2).length}`]),
      gate('product.ttrpg.safety-and-tabletop', !!campaign && campaign.sessionZero.consentChecklist.length >= 3
        && !!campaign.sessionZero.pauseSignal.trim() && !!campaign.tabletop
        && campaign.scenes.every(scene => campaign.tabletop?.maps.some(map => map.mapKey === scene.tabletopMapKey)),
      [`consent=${campaign?.sessionZero.consentChecklist.length ?? 0}`, `maps=${campaign?.tabletop?.maps.length ?? 0}`]),
      gate('product.ttrpg.campaign-bible-and-pressure', !!campaign?.bible
        && (campaign.clocks?.length ?? 0) > 0 && (campaign.fronts?.length ?? 0) > 0
        && (campaign.secrets?.length ?? 0) > 0,
      [
        `bible=${!!campaign?.bible}`,
        `clocks=${campaign?.clocks?.length ?? 0}`,
        `fronts=${campaign?.fronts?.length ?? 0}`,
        `secrets=${campaign?.secrets?.length ?? 0}`,
      ]),
      gate('product.ttrpg.counterexample-replay', campaignValidation?.valid === true
        && campaignValidation.structural.counterexamples.every(item => item.passed),
      campaignValidation
        ? [
            ...campaignValidation.structural.counterexamples.map(item => `${item.caseKey}=${item.passed}`),
            `unreachableScenes=${campaignValidation.structural.unreachableSceneKeys.length}`,
            `unreachableEndings=${campaignValidation.structural.unreachableEndingKeys.length}`,
          ]
        : ['campaignValidation=missing']),
    )
  } else if (runtimePackage.productType === 'character-interaction') {
    const interaction = runtimePackage.interaction
    gates.push(
      gate('product.interaction.cast', !!interaction && interaction.profiles.length >= 1,
        [`profiles=${interaction?.profiles.length ?? 0}`]),
      gate('product.interaction.scenes', !!interaction && interaction.sceneTemplates.length >= 2
        && interaction.sceneTemplates.every(scene => scene.maxTurns >= 8 && scene.safetyBoundaries.length > 0
          && scene.relationshipRules.length >= 2),
      [`scenes=${interaction?.sceneTemplates.length ?? 0}`, 'requires=maxTurns+safety']),
      gate('product.interaction.memory-relationship', !!interaction && interaction.profiles.every(profile => (
        profile.initialKnowledge.length > 0 && profile.relationshipDimensions.length >= 2 && profile.maxMemoryEntries >= 40
      )), ['requires=knowledge+2-relationship-dimensions+bounded-memory']),
    )
  } else if (runtimePackage.productType === 'text-adventure') {
    const adventure = runtimePackage.adventure
    const kinds = new Set(adventure?.actions.map(action => action.kind) ?? [])
    gates.push(
      gate('product.adventure.world-actions', !!adventure && adventure.locations.length >= 2
        && adventure.objects.length >= 1 && adventure.items.length >= 1
        && kinds.has('look') && kinds.has('move') && kinds.has('take') && kinds.has('talk'),
      [`locations=${adventure?.locations.length ?? 0}`, `objects=${adventure?.objects.length ?? 0}`, `items=${adventure?.items.length ?? 0}`, `actionKinds=${[...kinds].sort().join(',')}`]),
      gate('product.adventure.progression', !!adventure && adventure.quests.length >= 1
        && adventure.abilities.length >= 1 && adventure.resources.length >= 1,
      [`quests=${adventure?.quests.length ?? 0}`, `abilities=${adventure?.abilities.length ?? 0}`, `resources=${adventure?.resources.length ?? 0}`]),
    )
    if (adventure?.version === 2) {
      const enabledCapabilities = new Set(adventure.capabilities.filter(item => item.enabled).map(item => item.key))
      const requiredCapabilities = ['space', 'character', 'inventory', 'equipment', 'quests', 'time', 'storylets', 'endings']
      const productionContract = brief.textAdventure
      const sideQuestCount = adventure.quests.filter(item => item.category === 'side').length
      const mappedNarrativeActions = adventure.actions.filter(action => action.narrativeChoiceKey != null)
      const narrativeChoices = new Map(narrative.choices.map(choice => [choice.choiceKey, choice]))
      const bridgedNarrativeActions = mappedNarrativeActions.filter(action => (
        narrativeChoices.get(action.narrativeChoiceKey!)?.tags.includes(`adventure-action:${action.key}`)
      ))
      const failForwardActions = adventure.actions.filter(action => action.rule.kind !== 'automatic'
        && action.failureEffects.length > 0 && action.failureText.trim().length > 0)
      const presentationKeys = new Set(runtimePackage.presentation?.assets.map(asset => asset.assetKey) ?? [])
      const narrativeNonEnding = narrative.nodes.filter(node => node.kind !== 'ending')
      const narrativeNonEndingKeys = new Set(narrativeNonEnding.map(node => node.key))
      const narrativeNonEndingBeatCount = narrative.beats.filter(beat => narrativeNonEndingKeys.has(beat.nodeKey)).length
      const textUnits = estimatedTextUnits([
        ...narrative.nodes.flatMap(item => [item.title, item.summary]),
        ...narrative.beats.map(item => item.text),
        ...adventure.regions.flatMap(item => [item.title, item.description]),
        ...adventure.areas.flatMap(item => [item.title, item.description]),
        ...adventure.locations.flatMap(item => [item.title, item.description]),
        ...adventure.scenes.flatMap(item => [item.title, item.description]),
        ...adventure.objects.flatMap(item => [item.title, item.description]),
        ...adventure.items.flatMap(item => [item.title, item.description]),
        ...adventure.quests.flatMap(item => [
          item.title, item.description,
          ...item.stages.map(stage => stage.title),
          ...item.objectives.map(objective => objective.title),
        ]),
        ...adventure.actions.flatMap(item => [
          item.label, item.description, item.successText, item.costlySuccessText,
          item.failureText, item.unavailableText,
        ]),
      ])
      gates.push(
        gate('product.adventure.v2-capabilities', requiredCapabilities.every(key => enabledCapabilities.has(key)),
          [`enabled=${[...enabledCapabilities].sort().join(',')}`]),
        gate('product.adventure.v2-space', adventure.regions.length >= 1 && adventure.areas.length >= 1
          && adventure.scenes.length >= adventure.locations.length
          && adventure.locations.every(location => location.sceneKeys.length >= 1),
        [`regions=${adventure.regions.length}`, `areas=${adventure.areas.length}`, `locations=${adventure.locations.length}`, `scenes=${adventure.scenes.length}`]),
        gate('product.adventure.v2-character-system', adventure.abilities.some(item => item.role === 'stat')
          && adventure.abilities.some(item => item.role === 'skill')
          && ['health', 'mana', 'stamina', 'experience', 'skill-points'].every(role => adventure.resources.some(item => item.role === role)),
        [`abilityRoles=${[...new Set(adventure.abilities.map(item => item.role))].join(',')}`, `resourceRoles=${[...new Set(adventure.resources.map(item => item.role))].join(',')}`]),
        gate('product.adventure.v2-equipment', adventure.equipmentSlots.length >= 1
          && adventure.items.some(item => item.category === 'equipment' && item.equipmentSlotKey && item.modifiers.length >= 1),
        [`slots=${adventure.equipmentSlots.length}`, `equipment=${adventure.items.filter(item => item.category === 'equipment').length}`]),
        gate('product.adventure.v2-quest-time-storylets-endings', adventure.quests.every(quest => quest.stages.length >= 1)
          && adventure.resources.some(item => item.key === adventure.clock.resourceKey && item.role === 'clock')
          && adventure.storylets.length >= 1 && adventure.endings.length >= 2,
        [`questStages=${adventure.quests.map(item => item.stages.length).join(',')}`, `storylets=${adventure.storylets.length}`, `endings=${adventure.endings.length}`]),
        gate('product.adventure.v2-offline-fallback', adventure.media.fallback === 'text-only',
          [`media=${adventure.media.mode}`, `fallback=${adventure.media.fallback}`]),
        gate('product.adventure.v2-production-targets', !productionContract || (
          adventure.regions.length >= productionContract.narrative.targetRegionCount
          && adventure.areas.length >= productionContract.narrative.targetAreaCount
          && adventure.locations.length >= productionContract.narrative.targetLocationCount
          && adventure.scenes.length >= productionContract.narrative.targetSceneCount
          && sideQuestCount >= productionContract.narrative.targetSideQuestCount
          && adventure.storylets.length >= productionContract.narrative.targetAmbientEventCount
          && adventure.endings.length >= productionContract.narrative.targetEndingCount
        ), [
          `regions=${adventure.regions.length}/${productionContract?.narrative.targetRegionCount ?? 'legacy'}`,
          `areas=${adventure.areas.length}/${productionContract?.narrative.targetAreaCount ?? 'legacy'}`,
          `locations=${adventure.locations.length}/${productionContract?.narrative.targetLocationCount ?? 'legacy'}`,
          `scenes=${adventure.scenes.length}/${productionContract?.narrative.targetSceneCount ?? 'legacy'}`,
          `side=${sideQuestCount}/${productionContract?.narrative.targetSideQuestCount ?? 'legacy'}`,
          `storylets=${adventure.storylets.length}/${productionContract?.narrative.targetAmbientEventCount ?? 'legacy'}`,
          `endings=${adventure.endings.length}/${productionContract?.narrative.targetEndingCount ?? 'legacy'}`,
        ]),
        gate('product.adventure.v2-choice-bridge', mappedNarrativeActions.length >= 1
          && bridgedNarrativeActions.length === mappedNarrativeActions.length,
        [`mapped=${mappedNarrativeActions.length}`, `bridged=${bridgedNarrativeActions.length}`]),
        gate('product.adventure.v2-fail-forward', failForwardActions.length >= 1,
          [`actions=${failForwardActions.map(item => item.key).join(',') || 'none'}`]),
        gate('product.adventure.v2-media-binding', adventure.media.assetKeys.every(key => presentationKeys.has(key))
          && (adventure.media.assetKeys.length === 0 || runtimePackage.presentation != null),
        [`adventureAssets=${adventure.media.assetKeys.length}`, `presentationAssets=${presentationKeys.size}`]),
        gate('product.adventure.narrative-depth', !productionContract || (
          narrativeNonEnding.length >= Math.min(4, productionContract.narrative.targetSceneCount)
          && narrativeNonEndingBeatCount >= narrativeNonEnding.length
        ), [
          `nonEndingNodes=${narrativeNonEnding.length}`,
          `nonEndingBeats=${narrativeNonEndingBeatCount}`,
          `minimumNodes=${Math.min(4, productionContract?.narrative.targetSceneCount ?? 1)}`,
        ]),
        gate('product.adventure.content-volume', textUnits >= Math.floor(brief.scale.targetWordCount * 0.6),
          [`estimatedUnits=${textUnits}`, `minimum=${Math.floor(brief.scale.targetWordCount * 0.6)}`, `target=${brief.scale.targetWordCount}`]),
      )
    }
  } else if (runtimePackage.productType === 'avg') {
    const presentation = runtimePackage.presentation
    const assetKeys = new Set(presentation?.assets.map(asset => asset.assetKey) ?? [])
    gates.push(
      gate('product.avg.stage', !!presentation && presentation.cues.every(cue => (
        cue.assetKey == null || assetKeys.has(cue.assetKey)
      )), [`assets=${presentation?.assets.length ?? 0}`, `cues=${presentation?.cues.length ?? 0}`]),
      gate('product.avg.media-plan', brief.media.requiredMediaKinds.length === 0
        || (!!presentation && brief.media.requiredMediaKinds.every(kind => presentation.assets.some(asset => asset.kind === kind))),
      [`required=${brief.media.requiredMediaKinds.join(',') || 'none'}`]),
    )
  } else if (runtimePackage.productType === 'text-open-world') {
    const openWorld = runtimePackage.openWorld
    const openWorldEvolution = runtimePackage.openWorldEvolution
    gates.push(
      gate('product.open-world.evolution-system', !!openWorldEvolution && openWorldEvolution.resources.length >= 1
        && openWorldEvolution.metrics.length >= 2 && openWorldEvolution.issues.length >= 1
        && openWorldEvolution.actors.length >= 1 && openWorldEvolution.actions.length >= 2,
      [`resources=${openWorldEvolution?.resources.length ?? 0}`, `metrics=${openWorldEvolution?.metrics.length ?? 0}`, `issues=${openWorldEvolution?.issues.length ?? 0}`, `actors=${openWorldEvolution?.actors.length ?? 0}`, `actions=${openWorldEvolution?.actions.length ?? 0}`]),
      gate('product.open-world.space', !!openWorld && openWorld.regions.length >= 3
        && openWorld.travelEdges.length >= 2 && openWorld.discoveryChannels.length >= openWorld.regions.length,
      [`regions=${openWorld?.regions.length ?? 0}`, `edges=${openWorld?.travelEdges.length ?? 0}`, `channels=${openWorld?.discoveryChannels.length ?? 0}`]),
      gate('product.open-world.director', !!openWorld && openWorld.fixedTaskCards.length >= 1
        && openWorld.decks.length === openWorld.regions.length && openWorld.regionalIssueRules.length >= 1
        && openWorld.mainline.questKeys.length >= 1 && openWorld.taskTemplates.length >= 1
        && openWorld.actorSchedules.length >= 1,
      [`cards=${openWorld?.fixedTaskCards.length ?? 0}`, `templates=${openWorld?.taskTemplates.length ?? 0}`, `schedules=${openWorld?.actorSchedules.length ?? 0}`, `decks=${openWorld?.decks.length ?? 0}`, `issueRules=${openWorld?.regionalIssueRules.length ?? 0}`]),
    )
  }

  const failed = gates.filter(item => !item.passed)
  return {
    productType: runtimePackage.productType,
    passed: failed.length === 0,
    gates,
    warnings: failed.map(item => `${item.gateId} 未通过：${item.evidence.join('；')}`),
  }
}
