import type { RulePackV1, TtrpgCampaignContentV1, TtrpgTabletopPresentationV1 } from '../types'
import type { TtrpgCharacterTemplateV2, TtrpgOpenDesignProvenanceV1 } from './open-contract'
import { parseTtrpgCharacterSheetV2 } from './character-sheet'
import { evaluateRuleNumberExpressionV1 } from './rule-pack'
import * as p from './open-contract-parse'

export function character(value: unknown, label: string, rule: RulePackV1): TtrpgCharacterTemplateV2 {
  const r = p.record(value, ['characterKey', 'seatKey', 'name', 'description', 'sourceRefs', 'role', 'controller', 'attributes', 'attributeMappings', 'skills', 'resources', 'itemKeys', 'actionKeys', 'portraitAssetKey', 'playerProfile', 'gmProfile', 'characterSheet'], label)
  const role = p.oneOf(r.role, ['player', 'npc'], label), controller = p.oneOf(r.controller, ['human', 'ai', 'hybrid', 'open', 'gm'], `${label}.controller`)
  const seatKey = p.nullable(r.seatKey, p.key, label)
  if ((role === 'player') !== (seatKey !== null) || (role === 'npc') !== (controller === 'gm')) p.fail(`${label}: role/controller/seat 不匹配`)
  const attributes = p.numericRecord(r.attributes, label)
  p.exact(p.object(attributes, label), rule.attributes.map(a => a.key), label)
  for (const a of rule.attributes) p.number(attributes[a.key], `${label}.${a.key}`, a.minimum, a.maximum)
  const rawMappings = p.record(r.attributeMappings, Object.keys(attributes), `${label}.attributeMappings`)
  const attributeMappings = Object.fromEntries(Object.entries(rawMappings).map(([k, v]) => {
    const m = p.record(v, ['value', 'derivationRule', 'sourceRefs', 'authorConfirmed'], `${label}.${k}`)
    const value = p.number(m.value, label)
    if (attributes[k] !== value) p.fail(`${label}: 属性映射不一致`)
    return [k, { value, derivationRule: p.text(m.derivationRule, label, 2000), sourceRefs: p.keys(m.sourceRefs, label, 100), authorConfirmed: p.bool(m.authorConfirmed, label) }]
  }))
  const resources = p.numericRecord(r.resources, label)
  for (const [k, v] of Object.entries(resources)) {
    const resource = rule.resources.find(a => a.key === k)
    if (!resource) p.fail(`${label}: 未知资源 ${k}`)
    else p.number(v, label, resource.minimum, evaluateRuleNumberExpressionV1(resource.maximumFormula, attributes))
  }
  const itemKeys = p.keys(r.itemKeys, label, 100), actionKeys = p.keys(r.actionKeys, label, 100)
  itemKeys.forEach(k => p.known(k, rule.items.map(i => i.key), label))
  actionKeys.forEach(k => p.known(k, rule.actions.map(a => a.key), label))
  const playerProfile = p.nullable(r.playerProfile, (v, l) => {
    const a = p.record(v, ['privateGoal', 'secret', 'portrayal'], l)
    return { privateGoal: p.text(a.privateGoal, l), secret: p.text(a.secret, l), portrayal: p.text(a.portrayal, l) }
  }, label)
  const gmProfile = p.nullable(r.gmProfile, (v, l) => {
    const a = p.record(v, ['objective', 'leverage', 'secret', 'portrayal', 'escalation'], l)
    return { objective: p.text(a.objective, l), leverage: p.text(a.leverage, l), secret: p.text(a.secret, l), portrayal: p.text(a.portrayal, l), escalation: p.text(a.escalation, l) }
  }, label)
  if ((role === 'player') !== (playerProfile !== null) || (role === 'npc') !== (gmProfile !== null)) p.fail(`${label}: profile 不匹配`)
  const template: Omit<TtrpgCharacterTemplateV2, 'characterSheet'> = {
    characterKey: p.key(r.characterKey, label), seatKey, name: p.text(r.name, label, 300), description: p.text(r.description, label),
    sourceRefs: p.keys(r.sourceRefs, label, 100), role, controller, attributes, attributeMappings, skills: p.numericRecord(r.skills, label),
    resources, itemKeys, actionKeys, portraitAssetKey: p.nullable(r.portraitAssetKey, p.key, label), playerProfile, gmProfile,
  }
  // The shared sheet parser reads identity/mechanical fields, never controller.
  // Supply its legacy parameter shape locally; retain the real controller in content and approvals.
  const characterSheet = parseTtrpgCharacterSheetV2(r.characterSheet, {
    ...template, controller: controller === 'hybrid' ? 'ai' : controller,
  }, rule)
  return { ...template, characterSheet }
}
type LegacyCampaignMetadata = Pick<TtrpgCampaignContentV1,
  'campaignKey' | 'title' | 'pitch' | 'playerCount' | 'estimatedMinutes' | 'tags' | 'difficulty' | 'contentWarnings' | 'sessionZero' | 'sourceWorld' | 'gmMode' | 'informationPolicy' | 'bible' | 'designProvenance'>
export function commonMetadata(r: Record<string, unknown>): LegacyCampaignMetadata
export function commonMetadata(r: Record<string, unknown>, provenance: TtrpgOpenDesignProvenanceV1):
  Omit<LegacyCampaignMetadata, 'designProvenance'> & { designProvenance: TtrpgOpenDesignProvenanceV1 }
export function commonMetadata(r: Record<string, unknown>, provenance?: TtrpgOpenDesignProvenanceV1):
  Omit<LegacyCampaignMetadata, 'designProvenance'> & { designProvenance: LegacyCampaignMetadata['designProvenance'] | TtrpgOpenDesignProvenanceV1 } {
  const pc = p.record(r.playerCount, ['minimum', 'maximum'], 'playerCount')
  const minimum = p.integer(pc.minimum, 'playerCount.minimum', 1, 20)
  const s = p.record(r.sessionZero, ['premise', 'consentChecklist', 'lines', 'veils', 'pauseSignal', 'openDoor'], 'sessionZero')
  const b = p.record(r.bible, ['premise', 'background', 'coreConflict', 'themes', 'canonInvariants', 'sourceRefs'], 'bible')
  const i = p.record(r.informationPolicy, ['characterPrivateChannels', 'gmSecrets', 'hiddenNpcState', 'hiddenDice', 'interPlayerWhispers', 'revealAuditTrail'], 'informationPolicy')
  const w = p.record(r.sourceWorld, ['contentHash', 'bundleHash'], 'sourceWorld')
  const designProvenance = provenance ?? (() => {
  const d = p.record(r.designProvenance, ['origin', 'proposalKeys', 'baseProposalKey', 'sectionSources', 'lockedSections', 'candidateHash'], 'designProvenance')
  const sections = ['background', 'coreConflict', 'opening', 'fronts', 'secrets', 'endings'] as const
  const proposalKeys = p.keys(d.proposalKeys, 'proposalKeys', 3, 2), baseProposalKey = p.key(d.baseProposalKey, 'baseProposalKey')
  p.known(baseProposalKey, proposalKeys, 'baseProposalKey')
  const sources = p.record(d.sectionSources, sections, 'sectionSources')
  const section = (k: string) => { const ref = p.key(sources[k], k); p.known(ref, proposalKeys, k); return ref }
  const origin = p.oneOf(d.origin, ['author-guided', 'ai-candidate'], 'origin'), candidateHash = p.nullable(d.candidateHash, p.hash, 'candidateHash')
  if ((origin === 'ai-candidate') !== (candidateHash !== null)) p.fail('designProvenance: candidateHash 不匹配')
    return { origin, proposalKeys, baseProposalKey, candidateHash,
      sectionSources: { background: section('background'), coreConflict: section('coreConflict'), opening: section('opening'), fronts: section('fronts'), secrets: section('secrets'), endings: section('endings') },
      lockedSections: p.unique(p.list(d.lockedSections, 'lockedSections', (v, l) => p.oneOf(v, sections, l), 6), 'lockedSections') }
  })()
  return {
    campaignKey: p.key(r.campaignKey, 'campaignKey'), title: p.text(r.title, 'title', 300), pitch: p.text(r.pitch, 'pitch', 10_000),
    playerCount: { minimum, maximum: p.integer(pc.maximum, 'playerCount.maximum', minimum, 20) },
    estimatedMinutes: p.integer(r.estimatedMinutes, 'estimatedMinutes', 15, 100_000), tags: p.texts(r.tags, 'tags', 100),
    difficulty: p.oneOf(r.difficulty, ['introductory', 'standard', 'challenging'], 'difficulty'), contentWarnings: p.texts(r.contentWarnings, 'contentWarnings', 100),
    sessionZero: { premise: p.text(s.premise, 'sessionZero.premise'), consentChecklist: p.texts(s.consentChecklist, 'consentChecklist', 100, 1),
      lines: p.texts(s.lines, 'lines', 100), veils: p.texts(s.veils, 'veils', 100), pauseSignal: p.text(s.pauseSignal, 'pauseSignal', 200), openDoor: p.bool(s.openDoor, 'openDoor') },
    sourceWorld: { contentHash: p.hash(w.contentHash, 'contentHash'), bundleHash: p.hash(w.bundleHash, 'bundleHash') },
    gmMode: p.oneOf(r.gmMode, ['human', 'ai', 'hybrid'], 'gmMode'),
    informationPolicy: { characterPrivateChannels: p.bool(i.characterPrivateChannels, 'characterPrivateChannels'),
      gmSecrets: p.bool(i.gmSecrets, 'gmSecrets'), hiddenNpcState: p.bool(i.hiddenNpcState, 'hiddenNpcState'),
      hiddenDice: p.oneOf(i.hiddenDice, ['never', 'gm-only', 'allowed'], 'hiddenDice'), interPlayerWhispers: p.bool(i.interPlayerWhispers, 'interPlayerWhispers'),
      revealAuditTrail: p.bool(i.revealAuditTrail, 'revealAuditTrail') },
    bible: { premise: p.text(b.premise, 'bible.premise'), background: p.text(b.background, 'bible.background'), coreConflict: p.text(b.coreConflict, 'bible.coreConflict'),
      themes: p.texts(b.themes, 'themes', 100), canonInvariants: p.texts(b.canonInvariants, 'canonInvariants', 200, 1), sourceRefs: p.keys(b.sourceRefs, 'bible.sourceRefs', 200, 1) },
    designProvenance,
  }
}
export function tabletop(value: unknown, label: string): TtrpgTabletopPresentationV1 {
  const r = p.record(value, ['maps'], label)
  const maps = p.list(r.maps, label, (v, l) => {
    const m = p.record(v, ['mapKey', 'title', 'width', 'height', 'backgroundAssetKey', 'fallbackDescription', 'grid', 'layers', 'areas', 'tokens', 'fog'], l)
    const width = p.integer(m.width, l, 4, 100), height = p.integer(m.height, l, 4, 100)
    const g = p.record(m.grid, ['kind', 'cellSize', 'distancePerCell', 'unit'], l)
    const distancePerCell = p.number(g.distancePerCell, l, Number.MIN_VALUE, 10_000)
    const rectangle = (a: Record<string, unknown>, l: string) => {
      const x = p.integer(a.x, l, 0, width - 1), y = p.integer(a.y, l, 0, height - 1)
      return { x, y, width: p.integer(a.width, l, 1, width - x), height: p.integer(a.height, l, 1, height - y) }
    }
    return { mapKey: p.key(m.mapKey, l), title: p.text(m.title, l, 300), width, height,
      backgroundAssetKey: p.nullable(m.backgroundAssetKey, p.key, l), fallbackDescription: p.text(m.fallbackDescription, l),
      grid: { kind: p.oneOf(g.kind, ['square', 'zone'], l), cellSize: p.integer(g.cellSize, l, 1, 20), distancePerCell, unit: p.text(g.unit, l, 40) },
      layers: p.list(m.layers, l, (v, l) => {
        const a = p.record(v, ['layerKey', 'title', 'kind', 'zIndex', 'opacity', 'gmOnly'], l)
        return { layerKey: p.key(a.layerKey, l), title: p.text(a.title, l, 300), kind: p.oneOf(a.kind, ['terrain', 'objects', 'annotation'], l),
          zIndex: p.integer(a.zIndex, l, -100, 100), opacity: p.number(a.opacity, l, 0, 1), gmOnly: p.bool(a.gmOnly, l) }
      }, 64),
      areas: p.list(m.areas, l, (v, l) => {
        const a = p.record(v, ['areaKey', 'title', 'x', 'y', 'width', 'height', 'gmOnly'], l)
        return { areaKey: p.key(a.areaKey, l), title: p.text(a.title, l, 300), ...rectangle(a, l), gmOnly: p.bool(a.gmOnly, l) }
      }, 256),
      tokens: p.list(m.tokens, l, (v, l) => {
        const a = p.record(v, ['tokenKey', 'entityKey', 'x', 'y', 'size', 'controllerKey', 'hidden'], l)
        return { tokenKey: p.key(a.tokenKey, l), entityKey: p.key(a.entityKey, l), x: p.integer(a.x, l, 0, width),
          y: p.integer(a.y, l, 0, height), size: p.integer(a.size, l, 1, 20), controllerKey: p.nullable(a.controllerKey, p.key, l), hidden: p.bool(a.hidden, l) }
      }, 256),
      fog: p.list(m.fog, l, (v, l) => {
        const a = p.record(v, ['fogKey', 'title', 'x', 'y', 'width', 'height'], l)
        return { fogKey: p.key(a.fogKey, l), title: p.text(a.title, l, 300), ...rectangle(a, l) }
      }, 256) }
  }, 256, 1)
  p.unique(maps.map(m => m.mapKey), label)
  p.unique(maps.flatMap(m => m.layers.map(a => a.layerKey)), label)
  p.unique(maps.flatMap(m => m.areas.map(a => a.areaKey)), label)
  p.unique(maps.flatMap(m => m.tokens.map(a => a.tokenKey)), label)
  p.unique(maps.flatMap(m => m.fog.map(a => a.fogKey)), label)
  return { maps }
}
