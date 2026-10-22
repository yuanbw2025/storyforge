/** Deterministic assembly of adopted open artifacts; no inferred attributes, characters, scenes, choices or endings. */
import type { ProductProductionBriefV3, ProductSourcePlanV1 } from '../types'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { validateTtrpgProductionBriefContentV3 } from './production-brief-v3'
import { verifyTtrpgOpenAuthoringSourceProvenanceV1, verifyTtrpgOpenSourceClaimsV1 } from './open-source-provenance'
import { compileTtrpgFrozenWorldPredicateIndexV1 } from './frozen-facts'
import { parseTtrpgCampaignContentV2 } from './campaign-v2'
import { parseTtrpgOpenSourceFactsArtifactV1, parseTtrpgOpenRuleSystemArtifactV1, parseTtrpgOpenSituationLayerArtifactV1 } from './open-production-artifacts'
import type { TtrpgPredicateV1 } from './open-contract'
import { validateProductSourcePlanV1 } from '../product/source-contracts'

export async function compileProductionTtrpgOpenCampaignV2(input: {
  brief: ProductProductionBriefV3; briefHash: string; campaignKey: string
  /** Actual registry-remapped persisted locator; never changes frozen Brief bytes. */
  verifiedSourcePlan?: ProductSourcePlanV1
  sourceFacts: { payload: unknown; contentHash: string }
  ruleSystem: { payload: unknown; contentHash: string }
  situationLayer: { payload: unknown; contentHash: string }
}) {
  const brief = parseProductProductionBriefV3(input.brief)
  if (!brief.ttrpgOpen || brief.ttrpg || await hashProductProductionValueV2(brief) !== input.briefHash) {
    throw new Error('[ttrpg-open-compiler] 制作合同或冻结 Brief hash 不一致')
  }
  const open = await validateTtrpgProductionBriefContentV3(brief.ttrpgOpen)
  const sourcePlan = await validateProductSourcePlanV1(input.verifiedSourcePlan ?? open.sourcePlan)
  if (sourcePlan.planHash !== open.sourcePlan.planHash
    || sourcePlan.worldReference.referenceHash !== open.worldReference.referenceHash) {
    throw new Error('[ttrpg-open-compiler] 实际来源合同与冻结 Brief 不一致')
  }
  for (const artifact of [input.sourceFacts, input.ruleSystem, input.situationLayer]) {
    if (await hashProductProductionValueV2(artifact.payload) !== artifact.contentHash) throw new Error('[ttrpg-open-compiler] 采纳产物原文/hash 不一致')
  }
  const facts = parseTtrpgOpenSourceFactsArtifactV1(input.sourceFacts.payload)
  if (facts.factPolicy.some(item => !item.authorConfirmed)) throw new Error('[ttrpg-open-compiler] 来源事实仍未经过作者确认')
  for (const locked of open.settings.openAuthoring.factPolicy) {
    if (!facts.factPolicy.some(item => stable(item) === stable(locked))) throw new Error('[ttrpg-open-compiler] 制作不能丢弃或改写 Brief 已确认事实')
  }
  const factFields = await verifyTtrpgOpenAuthoringSourceProvenanceV1({ sourcePlan, facts: facts.factPolicy.map(item => item.fact) })
  const system = parseTtrpgOpenRuleSystemArtifactV1(input.ruleSystem.payload, open.rulePack, open.settings)
  const layer = parseTtrpgOpenSituationLayerArtifactV1(input.situationLayer.payload, facts)
  // Entity bindings carry independent source claims, including entities without a fact.
  // Validate those fields through the same frozen-source verifier, without declaring a new semantic fact.
  const bindingFields = await verifyTtrpgOpenSourceClaimsV1({ sourcePlan, claims: system.entityBindings
    .filter(binding => binding.sourceResourceRef !== null).map(binding => ({
      label: binding.bindingKey, sourceResourceRefs: [binding.sourceResourceRef!], sourceFieldRefs: binding.sourceFieldRefs,
    })) })
  for (const policy of ['companionPolicy', 'stageClosurePolicy', 'runtimePolicy', 'contextPolicy'] as const) {
    if (stable(layer.authoring[policy]) !== stable(open.settings.openAuthoring[policy])) {
      throw new Error('[ttrpg-open-compiler] 模型不能改变已确认的队友/阶段/运行预算/上下文策略')
    }
  }
  const players = system.characterTemplates.filter(template => template.role === 'player')
  const seats = open.settings.wizard.seats.filter(seat => seat.role === 'player')
  if (players.length !== seats.length || seats.some(seat => !players.some(player => player.seatKey === seat.seatKey
    && player.controller === seat.controller)) || system.gmMode !== open.settings.wizard.gmMode) {
    throw new Error('[ttrpg-open-compiler] 角色/控制权与作者确认席位不一致')
  }
  if (system.characterTemplates.some(template => Object.values(template.attributeMappings).some(mapping => !mapping.authorConfirmed))) {
    throw new Error('[ttrpg-open-compiler] 角色数值映射仍需作者确认')
  }
  for (const key of ['characterPrivateChannels', 'gmSecrets', 'hiddenNpcState', 'hiddenDice', 'interPlayerWhispers', 'revealAuditTrail'] as const) {
    if (system.informationPolicy[key] !== open.settings.wizard[key]) throw new Error('[ttrpg-open-compiler] 模型不能改变已确认的信息可见策略')
  }
  const index = await compileTtrpgFrozenWorldPredicateIndexV1(open.worldReference.releaseHash, facts.factPolicy.map(item => item.fact))
  const canonInvariantPredicates: TtrpgPredicateV1[] = index.entries.filter(fact => fact.authority === 'invariant').map(fact => ({
    op: 'world-fact', subjectRef: fact.subjectRef, predicateKey: fact.predicateKey, objectRef: fact.objectRef, value: fact.canonicalValue }))
  const { pressure, ...authoring } = layer.authoring
  const fieldRefs = [...new Map([...factFields, ...bindingFields].map(field => [stable(field), field])).values()]
    .sort((left, right) => stable(left) < stable(right) ? -1 : stable(left) > stable(right) ? 1 : 0)
  const { localReleaseRecordId: _localLocator, ...portableReference } = open.worldReference
  // Protocol 2 uses an actual, portable source-evidence bundle, not an invented full-world bundle hash.
  const sourceBundleHash = await hashProductProductionValueV2({ schema: 'storyforge.ttrpg-open-source-evidence', version: 1,
    worldReference: portableReference, sourcePlanHash: sourcePlan.planHash, fieldRefs })
  return parseTtrpgCampaignContentV2({ schema: 'storyforge.ttrpg-campaign', version: 2, runFormat: 'open',
    campaignKey: input.campaignKey, ...layer.metadata, playerCount: { minimum: 1, maximum: players.length },
    sessionZero: system.sessionZero, characterTemplates: system.characterTemplates, entityBindings: system.entityBindings,
    gmMode: system.gmMode, informationPolicy: system.informationPolicy,
    sourceWorld: { contentHash: open.worldReference.releaseHash, bundleHash: sourceBundleHash },
    designProvenance: { schema: 'storyforge.ttrpg-open-design-provenance', version: 1, briefHash: input.briefHash,
      sourcePlanHash: open.sourcePlan.planHash, sourceFactsArtifactHash: input.sourceFacts.contentHash,
      ruleSystemArtifactHash: input.ruleSystem.contentHash, situationLayerArtifactHash: input.situationLayer.contentHash },
    openingSceneKey: null, scenes: [], clues: [], quests: [], endings: [], frozenWorldPredicateIndex: index, canonInvariantPredicates,
    ...authoring, clocks: pressure.clocks, fronts: pressure.fronts,
  }, open.rulePack)
}
