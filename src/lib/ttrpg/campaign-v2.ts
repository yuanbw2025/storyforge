import { parseTtrpgOpenContextPolicyV1 } from './open-context-policy'
import type { RulePackV2, TtrpgCampaignContentV2 } from './open-contract'
import { parseRulePackV2, projectTtrpgRulePackMechanicalCoreV1 } from './rule-pack-v2'
import { character, commonMetadata, tabletop } from './open-content-common'
import { clock, front, situation } from './open-content-situations'
import { effectTemplate, dynamicTemplate, entityBinding, companionPolicy, closurePolicy, runtimePolicy } from './open-content-templates'
import { frozenFact, parsePredicate } from './open-content-predicates'
import { validateOpenContentReferences } from './open-content-references'
import { parseTtrpgMediaManifestV1, parseTtrpgVisualBibleV1 } from './media-contract'
import * as p from './open-contract-parse'
export { parseTtrpgOpenAuthoringV1 } from './open-content-authoring'
export type { TtrpgCampaignContentV2, TtrpgOpenAuthoringV1 } from './open-contract'

export function parseTtrpgCampaignContentV2(input: unknown, rule: RulePackV2): TtrpgCampaignContentV2 {
  const validatedRule = parseRulePackV2(rule)
  const core = projectTtrpgRulePackMechanicalCoreV1(validatedRule)
  const raw = p.object(p.json(input), 'campaignV2')
  const hasContextPolicy = Object.prototype.hasOwnProperty.call(raw, 'contextPolicy')
  const r = p.record(raw, [
    'schema', 'version', 'runFormat', 'campaignKey', 'title', 'pitch', 'playerCount', 'estimatedMinutes', 'tags', 'difficulty', 'contentWarnings',
    'sessionZero', 'openingSceneKey', 'characterTemplates', 'scenes', 'clues', 'quests', 'endings', 'handouts', 'advancementMilestones', 'sourceWorld',
    'gmMode', 'informationPolicy', 'bible', 'clocks', 'fronts', 'secrets', 'designProvenance', 'tabletop', 'visualBible', 'mediaManifest',
    'frozenWorldPredicateIndex', 'canonInvariantPredicates', 'situationTemplates', 'openingSituationKeys', 'effectPlanTemplates',
    'companionPolicy', 'stageClosurePolicy', 'dynamicEntityTemplates', 'entityBindings', 'runtimePolicy', ...(hasContextPolicy ? ['contextPolicy'] : []),
  ], 'campaignV2')
  p.literal(r.schema, 'storyforge.ttrpg-campaign', 'schema'); p.literal(r.version, 2, 'version'); p.literal(r.runFormat, 'open', 'runFormat')
  const provenance = p.object(r.designProvenance, 'designProvenance')
  const metadata = provenance.schema === 'storyforge.ttrpg-open-design-provenance' ? (() => {
    const d = p.record(provenance, ['schema', 'version', 'briefHash', 'sourcePlanHash', 'sourceFactsArtifactHash',
      'ruleSystemArtifactHash', 'situationLayerArtifactHash'], 'open design provenance')
    p.literal(d.version, 1, 'open design provenance version')
    return commonMetadata(r, { schema: 'storyforge.ttrpg-open-design-provenance', version: 1,
      briefHash: p.hash(d.briefHash, 'brief hash'), sourcePlanHash: p.hash(d.sourcePlanHash, 'source plan hash'),
      sourceFactsArtifactHash: p.hash(d.sourceFactsArtifactHash, 'facts artifact hash'),
      ruleSystemArtifactHash: p.hash(d.ruleSystemArtifactHash, 'rules artifact hash'),
      situationLayerArtifactHash: p.hash(d.situationLayerArtifactHash, 'situations artifact hash') })
  })() : commonMetadata(r)
  const characterTemplates = p.list(r.characterTemplates, 'characterTemplates', (v, l) => character(v, l, core), 1000, 1)
  const characterKeys = p.unique(characterTemplates.map(c => c.characterKey), 'characterTemplates')
  p.unique(characterTemplates.flatMap(c => c.seatKey === null ? [] : [c.seatKey]), 'seatKeys')
  if (!characterTemplates.some(c => c.role === 'player')) p.fail('characterTemplates: 缺玩家角色')
  const entityBindings = p.list(r.entityBindings, 'entityBindings', entityBinding, 3000, 1)
  const locationKeys = new Set(entityBindings.filter(e => e.kind === 'location').map(e => e.bindingKey))
  const scenes = p.list(r.scenes, 'scenes', (v, l) => {
    const a = p.record(v, ['sceneKey', 'title', 'description', 'locationKey', 'participantKeys', 'clueKeys', 'actionKeys', 'nextSceneKeys', 'failureForward', 'gmSecret', 'sourceRefs', 'tabletopMapKey'], l)
    return { sceneKey: p.key(a.sceneKey, l), title: p.text(a.title, l, 300), description: p.text(a.description, l),
      locationKey: p.nullable(a.locationKey, p.key, l), participantKeys: p.keys(a.participantKeys, l), clueKeys: p.keys(a.clueKeys, l),
      actionKeys: p.keys(a.actionKeys, l), nextSceneKeys: p.keys(a.nextSceneKeys, l), failureForward: p.text(a.failureForward, l),
      gmSecret: p.text(a.gmSecret, l), sourceRefs: p.keys(a.sourceRefs, l, 100), tabletopMapKey: p.nullable(a.tabletopMapKey, p.key, l) }
  })
  // Open knowledge exclusively uses situation evidence.
  const clues = p.list(r.clues, 'clues', () => p.fail('open clues 必须为空'), 0)
  const quests = p.list(r.quests, 'quests', (v, l) => {
    const a = p.record(v, ['questKey', 'title', 'objective', 'requiredConclusionKeys', 'failureForward'], l)
    return { questKey: p.key(a.questKey, l), title: p.text(a.title, l, 300), objective: p.text(a.objective, l),
      requiredConclusionKeys: p.keys(a.requiredConclusionKeys, l), failureForward: p.text(a.failureForward, l) }
  }, 256)
  const endings = p.list(r.endings, 'endings', (v, l) => {
    const a = p.record(v, ['endingKey', 'title', 'requirements', 'epilogue', 'trigger'], l)
    const t = p.record(a.trigger, ['sceneKey', 'requiredConclusionKeys', 'forbiddenConclusionKeys'], l)
    const requiredConclusionKeys = p.keys(t.requiredConclusionKeys, l), forbiddenConclusionKeys = p.keys(t.forbiddenConclusionKeys, l)
    if (requiredConclusionKeys.some(k => forbiddenConclusionKeys.includes(k))) p.fail(`${l}: ending trigger 冲突`)
    return { endingKey: p.key(a.endingKey, l), title: p.text(a.title, l, 300), requirements: p.texts(a.requirements, l, 100),
      epilogue: p.text(a.epilogue, l), trigger: { sceneKey: p.key(t.sceneKey, l), requiredConclusionKeys, forbiddenConclusionKeys } }
  }, 100)
  const handouts = p.list(r.handouts, 'handouts', (v, l) => {
    const a = p.record(v, ['handoutKey', 'title', 'body', 'revealClueKey', 'assetKey', 'fallbackText'], l)
    return { handoutKey: p.key(a.handoutKey, l), title: p.text(a.title, l, 300), body: p.text(a.body, l),
      revealClueKey: p.nullable(a.revealClueKey, p.key, l), assetKey: p.nullable(a.assetKey, p.key, l), fallbackText: p.text(a.fallbackText, l) }
  }, 512)
  const advancementMilestones = p.list(r.advancementMilestones, 'advancementMilestones', (v, l) => {
    const a = p.record(v, ['milestoneKey', 'title', 'award'], l)
    return { milestoneKey: p.key(a.milestoneKey, l), title: p.text(a.title, l, 300), award: p.integer(a.award, l, 0, 1000) }
  }, 256)
  const secrets = p.list(r.secrets, 'secrets', (v, l) => {
    const a = p.record(v, ['secretKey', 'title', 'truth', 'holderKeys', 'relatedClueKeys', 'revealRule', 'visibility', 'sourceRefs'], l)
    const holderKeys = p.keys(a.holderKeys, l), visibility = p.oneOf(a.visibility, ['gm-only', 'character-private'], l)
    if (visibility === 'character-private' && !holderKeys.length) p.fail(`${l}: private secret 缺接收者`)
    return { secretKey: p.key(a.secretKey, l), title: p.text(a.title, l, 300), truth: p.text(a.truth, l), holderKeys,
      relatedClueKeys: p.keys(a.relatedClueKeys, l, 100, 1), revealRule: p.text(a.revealRule, l), visibility, sourceRefs: p.keys(a.sourceRefs, l, 100, 1) }
  }, 512)
  const table = p.nullable(r.tabletop, tabletop, 'tabletop')
  const index = p.record(r.frozenWorldPredicateIndex, ['worldReleaseHash', 'indexHash', 'entries'], 'frozenWorldPredicateIndex')
  const result: TtrpgCampaignContentV2 = {
    schema: 'storyforge.ttrpg-campaign', version: 2, runFormat: 'open', ...metadata,
    ...(hasContextPolicy ? { contextPolicy: parseTtrpgOpenContextPolicyV1(r.contextPolicy) } : {}), characterTemplates, entityBindings,
    openingSceneKey: p.nullable(r.openingSceneKey, p.key, 'openingSceneKey'), scenes, clues, quests, endings, handouts, advancementMilestones, secrets,
    clocks: p.list(r.clocks, 'clocks', clock, 256, 1), fronts: p.list(r.fronts, 'fronts', front, 128, 1), tabletop: table,
    visualBible: parseTtrpgVisualBibleV1(r.visualBible, { characterKeys: new Set(characterKeys), locationKeys }),
    mediaManifest: parseTtrpgMediaManifestV1(r.mediaManifest, { targetRefs: new Set([
      ...characterKeys, ...locationKeys, ...entityBindings.map(e => e.bindingKey), ...scenes.map(s => s.sceneKey),
      ...handouts.map(h => h.handoutKey), ...core.items.map(i => i.key), ...(table?.maps.map(m => m.mapKey) ?? []),
    ]) }),
    frozenWorldPredicateIndex: { worldReleaseHash: p.hash(index.worldReleaseHash, 'worldReleaseHash'), indexHash: p.hash(index.indexHash, 'indexHash'),
      entries: p.list(index.entries, 'entries', frozenFact, 20_000, 1) },
    canonInvariantPredicates: p.list(r.canonInvariantPredicates, 'canonInvariantPredicates', parsePredicate, 1000, 1),
    situationTemplates: p.list(r.situationTemplates, 'situationTemplates', situation, 1000, 1),
    openingSituationKeys: p.keys(r.openingSituationKeys, 'openingSituationKeys', 5, 1),
    effectPlanTemplates: p.list(r.effectPlanTemplates, 'effectPlanTemplates', effectTemplate, 1000, 1),
    companionPolicy: companionPolicy(r.companionPolicy, 'companionPolicy'), stageClosurePolicy: closurePolicy(r.stageClosurePolicy, 'stageClosurePolicy'),
    dynamicEntityTemplates: p.list(r.dynamicEntityTemplates, 'dynamicEntityTemplates', dynamicTemplate, 100),
    runtimePolicy: runtimePolicy(r.runtimePolicy, 'runtimePolicy'),
  }
  if (result.frozenWorldPredicateIndex.worldReleaseHash !== result.sourceWorld.contentHash) {
    p.fail('frozenWorldPredicateIndex.worldReleaseHash 与战役来源世界不一致')
  }
  validateOpenContentReferences(result, validatedRule)
  return result
}
