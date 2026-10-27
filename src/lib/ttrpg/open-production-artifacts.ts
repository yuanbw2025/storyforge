/** Closed author-owned artifact contracts. Identity, hashes and source rights are supplied by the production system. */
import type { TtrpgCampaignContentV2, TtrpgOpenAuthoringV1, RulePackV2 } from './open-contract'
import { character } from './open-content-common'
import { entityBinding } from './open-content-templates'
import { frozenFact } from './open-content-predicates'
import { projectTtrpgRulePackMechanicalCoreV1 } from './rule-pack-v2'
import { parseTtrpgOpenAuthoringV1 } from './open-content-authoring'
import * as p from './open-contract-parse'
import type { TtrpgAuthoringSettingsV2 } from './authoring-contract-v2'
import { assertTtrpgOpenAuthoringSeatPlanSystemV1 } from './open-authoring-seat-plan'

export interface TtrpgOpenSourceFactsArtifactV1 {
  schema: 'storyforge.ttrpg-open-source-facts'; version: 1
  factPolicy: TtrpgOpenAuthoringV1['factPolicy']
}
export interface TtrpgOpenRuleSystemArtifactV1 {
  schema: 'storyforge.ttrpg-open-rule-system'; version: 1
  characterTemplates: TtrpgCampaignContentV2['characterTemplates']
  entityBindings: TtrpgCampaignContentV2['entityBindings']
  sessionZero: TtrpgCampaignContentV2['sessionZero']
  gmMode: TtrpgCampaignContentV2['gmMode']
  informationPolicy: TtrpgCampaignContentV2['informationPolicy']
}
export const TTRPG_OPEN_LAYER_METADATA_KEYS_V1 = ['title', 'pitch', 'estimatedMinutes', 'tags', 'difficulty',
  'contentWarnings', 'bible', 'handouts', 'advancementMilestones', 'secrets', 'tabletop', 'visualBible', 'mediaManifest'] as const
export interface TtrpgOpenSituationLayerArtifactV1 {
  schema: 'storyforge.ttrpg-open-situation-layer'; version: 1
  authoring: Omit<TtrpgOpenAuthoringV1, 'factPolicy'>
  metadata: Pick<TtrpgCampaignContentV2, typeof TTRPG_OPEN_LAYER_METADATA_KEYS_V1[number]>
}

export function parseTtrpgOpenSourceFactsArtifactV1(value: unknown): TtrpgOpenSourceFactsArtifactV1 {
  const r = p.record(p.json(value), ['schema', 'version', 'factPolicy'], 'open source facts artifact')
  p.literal(r.schema, 'storyforge.ttrpg-open-source-facts', 'source facts schema'); p.literal(r.version, 1, 'source facts version')
  const factPolicy = p.list(r.factPolicy, 'factPolicy', (value, label) => {
    const fact = p.record(value, ['fact', 'authorConfirmed'], label)
    return { fact: frozenFact(fact.fact, label), authorConfirmed: p.bool(fact.authorConfirmed, label) }
  }, 20_000)
  p.unique(factPolicy.map(item => item.fact.factKey), 'factPolicy')
  return { schema: 'storyforge.ttrpg-open-source-facts', version: 1, factPolicy }
}

export function parseTtrpgOpenRuleSystemArtifactV1(value: unknown, rule: RulePackV2, settings?: TtrpgAuthoringSettingsV2): TtrpgOpenRuleSystemArtifactV1 {
  const r = p.record(p.json(value), ['schema', 'version', 'characterTemplates', 'entityBindings', 'sessionZero', 'gmMode',
    'informationPolicy'], 'open rule system artifact')
  p.literal(r.schema, 'storyforge.ttrpg-open-rule-system', 'rule system schema'); p.literal(r.version, 1, 'rule system version')
  const characterTemplates = p.list(r.characterTemplates, 'characters', (value, label) => character(value, label,
    projectTtrpgRulePackMechanicalCoreV1(rule)), 1000, 1)
  const entityBindings = p.list(r.entityBindings, 'bindings', entityBinding, 3000, 1)
  p.unique(characterTemplates.map(template => template.characterKey), 'characters')
  p.unique(entityBindings.map(binding => binding.bindingKey), 'bindings')
  if (settings) assertTtrpgOpenAuthoringSeatPlanSystemV1({ settings, characters: characterTemplates })
  const s = p.record(r.sessionZero, ['premise', 'consentChecklist', 'lines', 'veils', 'pauseSignal', 'openDoor'], 'sessionZero')
  const i = p.record(r.informationPolicy, ['characterPrivateChannels', 'gmSecrets', 'hiddenNpcState', 'hiddenDice',
    'interPlayerWhispers', 'revealAuditTrail'], 'informationPolicy')
  return { schema: 'storyforge.ttrpg-open-rule-system', version: 1, characterTemplates, entityBindings,
    sessionZero: { premise: p.text(s.premise, 'premise'), consentChecklist: p.texts(s.consentChecklist, 'consentChecklist', 100, 1),
      lines: p.texts(s.lines, 'lines', 100), veils: p.texts(s.veils, 'veils', 100), pauseSignal: p.text(s.pauseSignal, 'pauseSignal', 200),
      openDoor: p.bool(s.openDoor, 'openDoor') }, gmMode: p.oneOf(r.gmMode, ['human', 'ai', 'hybrid'], 'gmMode'),
    informationPolicy: { characterPrivateChannels: p.bool(i.characterPrivateChannels, 'private channels'), gmSecrets: p.bool(i.gmSecrets, 'gm secrets'),
      hiddenNpcState: p.bool(i.hiddenNpcState, 'hidden NPC state'), hiddenDice: p.oneOf(i.hiddenDice, ['never', 'gm-only', 'allowed'], 'hidden dice'),
      interPlayerWhispers: p.bool(i.interPlayerWhispers, 'whispers'), revealAuditTrail: p.bool(i.revealAuditTrail, 'reveal audit') } }
}

export function parseTtrpgOpenSituationLayerArtifactV1(value: unknown,
  facts: TtrpgOpenSourceFactsArtifactV1): TtrpgOpenSituationLayerArtifactV1 {
  const r = p.record(p.json(value), ['schema', 'version', 'authoring', 'metadata'], 'open situation layer artifact')
  p.literal(r.schema, 'storyforge.ttrpg-open-situation-layer', 'layer schema'); p.literal(r.version, 1, 'layer version')
  const authoringRow = p.object(r.authoring, 'situation authoring')
  const a = p.record(authoringRow, ['situationTemplates', 'openingSituationKeys', 'effectPlanTemplates', 'pressure',
    'companionPolicy', 'stageClosurePolicy', 'dynamicEntityTemplates', 'runtimePolicy', ...(Object.prototype.hasOwnProperty.call(authoringRow, 'contextPolicy') ? ['contextPolicy'] : [])], 'situation authoring')
  const { factPolicy: _facts, ...authoring } = parseTtrpgOpenAuthoringV1({ ...a, factPolicy: facts.factPolicy })
  const metadata = p.record(r.metadata, TTRPG_OPEN_LAYER_METADATA_KEYS_V1, 'situation metadata')
  // Whole metadata and cross-artifact references are checked by the Campaign V2 parser at integration.
  return { schema: 'storyforge.ttrpg-open-situation-layer', version: 1, authoring,
    metadata: structuredClone(metadata) as unknown as TtrpgOpenSituationLayerArtifactV1['metadata'] }
}
