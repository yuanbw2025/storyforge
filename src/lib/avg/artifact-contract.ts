import type { ProductBuildArtifactKindV1 } from '../types/product-production'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { avgEnum, avgHash, avgKey, avgKeys, avgList, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'

/** Reserved role contracts do not register an AI call or assert professional competence. */
export const AVG_PROFESSIONAL_OUTPUTS_V1 = [
  ['avg-production-director','avg.production-supervision.v1','avg.governance.production-plan','production-plan'],
  ['avg-source-editor','avg.source-adaptation.v1','avg.governance.source-audit','source-audit'],
  ['avg-story-architect','avg.story-design.v1','avg.content.story-bible','story-bible'],
  ['avg-cast-director','avg.cast-bible.v1','avg.content.cast-bible','cast-bible'],
  ['avg-route-designer','avg.route-reveal-plan.v1','avg.content.route-plan','route-plan'],
  ['avg-scene-designer','avg.scene-plan.v1','avg.content.scene-plan','scene-plan'],
  ['avg-scene-writer','avg.scene-script.v1','avg.content.scene-script.','scene-script'],
  ['avg-dialogue-editor','avg.dialogue-pass.v1','avg.content.dialogue-patch.','dialogue-patch'],
  ['avg-continuity-editor','avg.content-review.v1','avg.review.content.','review-issues'],
  ['avg-system-designer','avg.system-plan.v1','avg.system.plan','system-plan'],
  ['avg-performance-director','avg.scene-direction.v1','avg.system.direction.','scene-direction'],
  ['avg-art-director','avg.visual-bible.v1','avg.media.visual-bible','visual-bible'],
  ['avg-character-designer','avg.character-assets.v1','avg.media.character-brief.','media-brief'],
  ['avg-environment-designer','avg.environment-assets.v1','avg.media.environment-brief.','media-brief'],
  ['avg-prop-designer','avg.prop-assets.v1','avg.media.prop-brief.','media-brief'],
  ['avg-ui-art-designer','avg.ui-assets.v1','avg.media.ui-brief.','media-brief'],
  ['avg-key-art-designer','avg.key-art-plan.v1','avg.media.key-art-brief.','media-brief'],
  ['avg-sound-director','avg.sound-plan.v1','avg.media.sound-plan','sound-plan'],
  ['avg-voice-director','avg.voice-performance.v1','avg.media.voice-plan.','voice-plan'],
  ['avg-visual-reviewer','avg.visual-review.v1','avg.review.visual.','review-issues'],
  ['avg-audio-reviewer','avg.audio-review.v1','avg.review.audio.','review-issues'],
  ['avg-experience-reviewer','avg.experience-review.v1','avg.review.experience.','review-issues'],
] as const
type Schema<T extends string> = { schema: `storyforge.avg.${T}`; version: 1 }
export type AvgProductionPlanV1 = Schema<'production-plan'> & {
  goal: string; requiredOutputKeys: string[]; dependencySuggestions: Array<{ outputKey: string; inputKeys: string[] }>; stopReasons: string[]
}
export type AvgSourceAuditV1 = Schema<'source-audit'> & {
  facts: Array<{ factKey: string; resourceKeys: string[]; statement: string; disclosure: 'public' | 'player-acquired' | 'private' }>
  gaps: string[]; proposedSupplements: string[]
}
export type AvgStoryBibleV1 = Schema<'story-bible'> & {
  promise: string; theme: string; subjectKeys: string[]; causalChain: string[]; invariants: string[]; payoffIntent: string[]; sourceFactKeys: string[]
}
export type AvgCastBibleV1 = Schema<'cast-bible'> & {
  characters: Array<{ characterKey: string; displayName: string; sourceResourceKey: string | null; proposedOrigin: string | null; desire: string; cost: string; voice: string; knowledgeKeys: string[]; relationshipArc: string }>
}
export type AvgRoutePlanV1 = Schema<'route-plan'> & {
  storyMode: 'linear' | 'branching'; routes: Array<{ routeKey: string; sceneKeys: string[]; endingKeys: string[]; revealFactKeys: string[]; choiceIntents: string[] }>
}
export type AvgSceneScriptV1 = Schema<'scene-script'> & {
  sceneKey: string; lines: Array<{ lineKey: string; beatKey: string; speakerKey: string | null; text: string; informationKeys: string[]; actionKeys: string[] }>
  choices: Array<{ choiceKey: string; text: string; actionKey: string }>
}
export type AvgDialoguePatchV1 = Schema<'dialogue-patch'> & {
  sceneKey: string; baseScriptHash: string
  changes: Array<{ targetKey: string; field: 'text' | 'choiceText'; oldValueHash: string; newText: string; reason: string }>
}
export type AvgReviewIssuesV1 = Schema<'review-issues'> & {
  targetKey: string; observations: Array<'text' | 'visual' | 'audio' | 'interaction'>; unobserved: string[]
  issues: Array<{ issueKey: string; locationKey: string; evidence: string; severity: 'blocking' | 'major' | 'minor'; owner: 'content' | 'system' | 'media'; allowedChange: string; impact: string; recheck: string }>
}
export type AvgProfessionalArtifactV1 = AvgProductionPlanV1 | AvgSourceAuditV1 | AvgStoryBibleV1 | AvgCastBibleV1 | AvgRoutePlanV1 | AvgSceneScriptV1 | AvgDialoguePatchV1 | AvgReviewIssuesV1

function texts(value: unknown, label: string): string[] { return avgList(value, label, avgText, 1000) }
function nullableKey(value: unknown, label: string): string | null { return value === null ? null : avgKey(value, label) }
function payloadRow(value: unknown, schema: string, keys: string[]): Record<string, unknown> {
  return avgRecord(value, ['schema','version',...keys], schema)
}
export function parseAvgProfessionalArtifactV1(value: unknown): AvgProfessionalArtifactV1 {
  const raw = avgProtocolBody(value)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('[avg] artifact 必须为对象')
  const header = raw as Record<string, unknown>
  if (header.version !== 1 || typeof header.schema !== 'string') throw new Error('[avg] artifact schema/version 无效')
  switch (header.schema) {
    case 'storyforge.avg.production-plan': {
      const row = payloadRow(raw, header.schema, ['goal','requiredOutputKeys','dependencySuggestions','stopReasons'])
      const requiredOutputKeys = avgKeys(row.requiredOutputKeys, 'requiredOutputKeys')
      for (const key of requiredOutputKeys) avgProfessionalOutputForKeyV1(key)
      const dependencySuggestions = avgUnique(avgList(row.dependencySuggestions, 'dependencySuggestions', value => {
        const edge = avgRecord(value, ['outputKey','inputKeys'], 'dependency')
        return { outputKey: avgKey(edge.outputKey, 'outputKey'), inputKeys: avgKeys(edge.inputKeys, 'inputKeys') }
      }), edge => edge.outputKey, 'dependencies')
      const edges = new Map(dependencySuggestions.map(edge => [edge.outputKey, edge.inputKeys]))
      const visited = new Set<string>(); const active = new Set<string>()
      const visit = (key: string) => {
        if (active.has(key)) throw new Error('[avg] dependency cycle')
        if (visited.has(key)) return
        active.add(key)
        for (const input of edges.get(key) ?? []) {
          if (!requiredOutputKeys.includes(input)) throw new Error('[avg] dependency input 不在输出目录')
          visit(input)
        }
        active.delete(key); visited.add(key)
      }
      for (const edge of dependencySuggestions) {
        if (!requiredOutputKeys.includes(edge.outputKey)) throw new Error('[avg] dependency output 不在输出目录')
        visit(edge.outputKey)
      }
      return { schema: header.schema, version: 1, goal: avgText(row.goal, 'goal'), requiredOutputKeys, dependencySuggestions, stopReasons: texts(row.stopReasons, 'stopReasons') }
    }
    case 'storyforge.avg.source-audit': {
      const row = payloadRow(raw, header.schema, ['facts','gaps','proposedSupplements'])
      const facts = avgUnique(avgList(row.facts, 'facts', value => {
        const fact = avgRecord(value, ['factKey','resourceKeys','statement','disclosure'], 'fact')
        const resourceKeys = avgKeys(fact.resourceKeys, 'resourceKeys')
        if (!resourceKeys.length) throw new Error('[avg] 来源事实缺少资源引用')
        return { factKey: avgKey(fact.factKey, 'factKey'), resourceKeys, statement: avgText(fact.statement, 'statement'), disclosure: avgEnum(fact.disclosure, ['public','player-acquired','private'] as const, 'disclosure') }
      }), fact => fact.factKey, 'facts')
      return { schema: header.schema, version: 1, facts, gaps: texts(row.gaps, 'gaps'), proposedSupplements: texts(row.proposedSupplements, 'proposedSupplements') }
    }
    case 'storyforge.avg.story-bible': {
      const row = payloadRow(raw, header.schema, ['promise','theme','subjectKeys','causalChain','invariants','payoffIntent','sourceFactKeys'])
      return { schema: header.schema, version: 1, promise: avgText(row.promise, 'promise'), theme: avgText(row.theme, 'theme'),
        subjectKeys: avgKeys(row.subjectKeys, 'subjectKeys'), causalChain: texts(row.causalChain, 'causalChain'), invariants: texts(row.invariants, 'invariants'),
        payoffIntent: texts(row.payoffIntent, 'payoffIntent'), sourceFactKeys: avgKeys(row.sourceFactKeys, 'sourceFactKeys') }
    }
    case 'storyforge.avg.cast-bible': {
      const row = payloadRow(raw, header.schema, ['characters'])
      const characters = avgUnique(avgList(row.characters, 'characters', value => {
        const char = avgRecord(value, ['characterKey','displayName','sourceResourceKey','proposedOrigin','desire','cost','voice','knowledgeKeys','relationshipArc'], 'character')
        const sourceResourceKey = nullableKey(char.sourceResourceKey, 'sourceResourceKey')
        const proposedOrigin = char.proposedOrigin === null ? null : avgText(char.proposedOrigin, 'proposedOrigin')
        if ((sourceResourceKey === null) === (proposedOrigin === null)) throw new Error('[avg] 人物需要唯一的源引用或新增依据')
        return { characterKey: avgKey(char.characterKey, 'characterKey'), displayName: avgText(char.displayName, 'displayName', 200),
          sourceResourceKey, proposedOrigin, desire: avgText(char.desire, 'desire'), cost: avgText(char.cost, 'cost'), voice: avgText(char.voice, 'voice'),
          knowledgeKeys: avgKeys(char.knowledgeKeys, 'knowledgeKeys'), relationshipArc: avgText(char.relationshipArc, 'relationshipArc') }
      }), char => char.characterKey, 'characters')
      const mapped = characters.filter(char => char.sourceResourceKey !== null)
      avgUnique(mapped, char => char.sourceResourceKey!, 'source character mapping')
      return { schema: header.schema, version: 1, characters }
    }
    case 'storyforge.avg.route-plan': {
      const row = payloadRow(raw, header.schema, ['storyMode','routes'])
      const storyMode = avgEnum(row.storyMode, ['linear','branching'] as const, 'storyMode')
      const routes = avgUnique(avgList(row.routes, 'routes', value => {
        const route = avgRecord(value, ['routeKey','sceneKeys','endingKeys','revealFactKeys','choiceIntents'], 'route')
        const sceneKeys = avgKeys(route.sceneKeys, 'sceneKeys'); const endingKeys = avgKeys(route.endingKeys, 'endingKeys')
        if (!sceneKeys.length || !endingKeys.length) throw new Error('[avg] route 缺少 scene/ending')
        return { routeKey: avgKey(route.routeKey, 'routeKey'), sceneKeys, endingKeys, revealFactKeys: avgKeys(route.revealFactKeys, 'revealFactKeys'), choiceIntents: texts(route.choiceIntents, 'choiceIntents') }
      }, 8), route => route.routeKey, 'routes')
      if (!routes.length || (storyMode === 'linear' && routes.length !== 1)) throw new Error('[avg] route 与 storyMode 不符')
      return { schema: header.schema, version: 1, storyMode, routes }
    }
    case 'storyforge.avg.scene-script': {
      const row = payloadRow(raw, header.schema, ['sceneKey','lines','choices'])
      const lines = avgUnique(avgList(row.lines, 'lines', value => {
        const line = avgRecord(value, ['lineKey','beatKey','speakerKey','text','informationKeys','actionKeys'], 'line')
        const lineKey = avgKey(line.lineKey, 'lineKey'); const beatKey = avgKey(line.beatKey, 'beatKey')
        if (lineKey !== beatKey) throw new Error('[avg] 首批一 Beat 一句使用同一 key')
        return { lineKey, beatKey, speakerKey: nullableKey(line.speakerKey, 'speakerKey'), text: avgText(line.text, 'text', 10000),
          informationKeys: avgKeys(line.informationKeys, 'informationKeys'), actionKeys: avgKeys(line.actionKeys, 'actionKeys') }
      }), line => line.lineKey, 'lines')
      const choices = avgUnique(avgList(row.choices, 'choices', value => {
        const choice = avgRecord(value, ['choiceKey','text','actionKey'], 'choice')
        return { choiceKey: avgKey(choice.choiceKey, 'choiceKey'), text: avgText(choice.text, 'text', 1000), actionKey: avgKey(choice.actionKey, 'actionKey') }
      }, 20), choice => choice.choiceKey, 'choices')
      avgUnique([...lines.map(line => line.lineKey), ...choices.map(choice => choice.choiceKey)], key => key, 'script identities')
      return { schema: header.schema, version: 1, sceneKey: avgKey(row.sceneKey, 'sceneKey'), lines, choices }
    }
    case 'storyforge.avg.dialogue-patch': {
      const row = payloadRow(raw, header.schema, ['sceneKey','baseScriptHash','changes'])
      const changes = avgUnique(avgList(row.changes, 'changes', value => {
        const change = avgRecord(value, ['targetKey','field','oldValueHash','newText','reason'], 'change')
        return { targetKey: avgKey(change.targetKey, 'targetKey'), field: avgEnum(change.field, ['text','choiceText'] as const, 'field'),
          oldValueHash: avgHash(change.oldValueHash, 'oldValueHash'), newText: avgText(change.newText, 'newText', 10000), reason: avgText(change.reason, 'reason') }
      }), change => change.targetKey, 'changes')
      return { schema: header.schema, version: 1, sceneKey: avgKey(row.sceneKey, 'sceneKey'), baseScriptHash: avgHash(row.baseScriptHash, 'baseScriptHash'), changes }
    }
    case 'storyforge.avg.review-issues': {
      const row = payloadRow(raw, header.schema, ['targetKey','observations','unobserved','issues'])
      const observations = avgUnique(avgList(row.observations, 'observations', value => avgEnum(value, ['text','visual','audio','interaction'] as const, 'observation'), 4), value => value, 'observations')
      const issues = avgUnique(avgList(row.issues, 'issues', value => {
        const issue = avgRecord(value, ['issueKey','locationKey','evidence','severity','owner','allowedChange','impact','recheck'], 'issue')
        return { issueKey: avgKey(issue.issueKey, 'issueKey'), locationKey: avgKey(issue.locationKey, 'locationKey'), evidence: avgText(issue.evidence, 'evidence'),
          severity: avgEnum(issue.severity, ['blocking','major','minor'] as const, 'severity'), owner: avgEnum(issue.owner, ['content','system','media'] as const, 'owner'),
          allowedChange: avgText(issue.allowedChange, 'allowedChange'), impact: avgText(issue.impact, 'impact'), recheck: avgText(issue.recheck, 'recheck') }
      }), issue => issue.issueKey, 'issues')
      return { schema: header.schema, version: 1, targetKey: avgKey(row.targetKey, 'targetKey'), observations, unobserved: texts(row.unobserved, 'unobserved'), issues }
    }
    default: throw new Error('[avg] 未登记或尚未就绪的专业 artifact schema')
  }
}

export function avgProfessionalOutputForKeyV1(key: string) {
  avgKey(key, 'artifactKey')
  const matches = AVG_PROFESSIONAL_OUTPUTS_V1.filter(row => row[2].endsWith('.')
    ? key.startsWith(row[2]) && key.length > row[2].length : key === row[2])
  if (matches.length !== 1) throw new Error('[avg] 未登记的专业输出 key')
  return matches[0]
}

/** Pure prepare boundary. Actual context/author authorization and persistence remain in Harness/adoption. */
export function prepareAvgProfessionalArtifactV1(input: {
  artifactKey: string; kind: ProductBuildArtifactKindV1; payload: unknown; allowedOutputKeys: readonly string[]
}) {
  const role = avgProfessionalOutputForKeyV1(input.artifactKey)
  if (!input.allowedOutputKeys.includes(input.artifactKey)) throw new Error('[avg] 输出 key 超出冻结写域')
  const payload = parseAvgProfessionalArtifactV1(input.payload)
  if (payload.schema !== `storyforge.avg.${role[3]}`) throw new Error('[avg] schema 不属于输出 key/岗位')
  const expectedKind = role[3] === 'review-issues' ? 'quality-report' : 'narrative'
  if (input.kind !== expectedKind) throw new Error('[avg] artifact kind 与 schema 不符')
  if ('sceneKey' in payload && role[2].endsWith('.') && input.artifactKey !== role[2] + payload.sceneKey) throw new Error('[avg] 场景与输出 key 不一致')
  if ('targetKey' in payload && role[2].endsWith('.') && input.artifactKey !== role[2] + payload.targetKey) throw new Error('[avg] review target 与输出 key 不一致')
  return { payload, payloadJson: canonicalProductProductionJsonV2(payload), agentId: role[0], skillId: role[1] }
}

/** Expression-only patch; returns a new candidate, never modifies a DB row or source facts. */
export async function applyAvgDialoguePatchV1(scriptValue: unknown, patchValue: unknown) {
  const script = parseAvgProfessionalArtifactV1(scriptValue)
  const patch = parseAvgProfessionalArtifactV1(patchValue)
  if (script.schema !== 'storyforge.avg.scene-script' || patch.schema !== 'storyforge.avg.dialogue-patch'
    || script.sceneKey !== patch.sceneKey || await hashProductProductionValueV2(script) !== patch.baseScriptHash) throw new Error('[avg] dialogue patch base 已 stale 或跨场景')
  const next = structuredClone(script)
  for (const change of patch.changes) {
    const target = change.field === 'text' ? next.lines.find(line => line.lineKey === change.targetKey) : next.choices.find(choice => choice.choiceKey === change.targetKey)
    if (!target || await hashProductProductionValueV2(target.text) !== change.oldValueHash) throw new Error('[avg] dialogue patch target/old value 已 stale')
    if (change.field === 'choiceText' && change.newText.length > 1000) throw new Error('[avg] choiceText 超长')
    target.text = change.newText
  }
  return { script: next, scriptHash: await hashProductProductionValueV2(next), lineage: {
    baseScriptHash: patch.baseScriptHash, patchHash: await hashProductProductionValueV2(patch),
  } }
}
