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
