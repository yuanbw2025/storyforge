/** Human clarification is separate from immutable model output and never performs an action. */
import type { TtrpgOpenIntentV1 } from './open-intent'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { hashProductProductionValueV2 } from '../product-production/hash'
import * as p from './open-contract-parse'
import { parseTtrpgOpenRuleRequestV1, parseTtrpgOpenSceneScopeV1, type TtrpgOpenRuleRequestV1, type TtrpgOpenSceneScopeV1 } from './open-rule-request-contract'

export interface TtrpgOpenIntentSelectionV1 {
  goal: string; method: string | null; targetRefs: string[]; requestedOutcome: string | null
}
export interface TtrpgOpenIntentClarificationV1 {
  schema: 'storyforge.ttrpg-open-intent-clarification'; version: 1
  sourceRef: TtrpgOpenSourceRefV1; candidateHash: string; threadKey: string
  actorKey: string; viewerKey: string; attempt: number
  selection: TtrpgOpenIntentSelectionV1; request: TtrpgOpenRuleRequestV1 | null; clarificationHash: string
  sceneScope?: TtrpgOpenSceneScopeV1
}
export type TtrpgOpenIntentClarificationV2 = Omit<TtrpgOpenIntentClarificationV1, 'version'> & { version: 2 }
export type TtrpgOpenIntentClarification = TtrpgOpenIntentClarificationV1 | TtrpgOpenIntentClarificationV2
export function parseTtrpgOpenIntentSelectionV1(value: unknown): TtrpgOpenIntentSelectionV1 {
  const r = p.record(value, ['goal', 'method', 'targetRefs', 'requestedOutcome'], 'human intent selection')
  return { goal: p.text(r.goal, 'clarified goal', 2000), method: p.nullable(r.method, p.key, 'clarified method'),
    targetRefs: p.list(r.targetRefs, 'clarified targets', p.key, 1, 0),
    requestedOutcome: p.nullable(r.requestedOutcome, (v,l) => p.text(v,l,2000), 'clarified outcome') }
}
export function parseTtrpgOpenIntentClarification(value: unknown): TtrpgOpenIntentClarification {
  const hasSceneScope = Object.prototype.hasOwnProperty.call(p.object(value,'intent clarification'),'sceneScope')
  const r = p.record(value, ['schema','version','sourceRef','candidateHash','threadKey','actorKey','viewerKey','attempt','selection','request','clarificationHash',...(hasSceneScope ? ['sceneScope'] : [])], 'intent clarification')
  const request = r.request === null ? null : parseTtrpgOpenRuleRequestV1(r.request)
  const selection = parseTtrpgOpenIntentSelectionV1(r.selection)
  const sceneScope = hasSceneScope ? parseTtrpgOpenSceneScopeV1(r.sceneScope) : undefined
  if (sceneScope && (!request || request.route !== 'existing-action' || request.targetKey !== null
    || selection.targetRefs.length !== 1 || selection.targetRefs[0] !== sceneScope.locationRef)) p.fail('场景范围必须保留原澄清的准确地点与当前场景规则请求')
  if (request && (request.actorKey !== r.actorKey || (request.interactionKey ?? request.ruleKey) !== selection.method
    || !sceneScope && selection.targetRefs.length > 0 && request.targetKey !== selection.targetRefs[0])) p.fail('澄清的规则必须绑定同一角色、方法和目标')
  const version = r.version === 1 ? 1 : r.version === 2 ? 2 : p.fail('不支持的澄清版本')
  return { schema: p.literal(r.schema,'storyforge.ttrpg-open-intent-clarification','clarification schema'), version,
    sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef), candidateHash: p.hash(r.candidateHash,'clarified original candidate'),
    threadKey: p.key(r.threadKey,'clarification thread'), actorKey: p.key(r.actorKey,'clarified actor'), viewerKey: p.key(r.viewerKey,'clarifying human'),
    attempt: p.integer(r.attempt,'clarification attempt',1,3), selection, request,...(sceneScope ? { sceneScope } : {}),
    clarificationHash: p.hash(r.clarificationHash,'clarification hash') }
}
export function parseTtrpgOpenIntentClarificationV1(value: unknown): TtrpgOpenIntentClarificationV1 {
  const record = parseTtrpgOpenIntentClarification(value)
  if (record.version !== 1) p.fail('clarification version 必须是 1')
  return record
}
export async function hashTtrpgOpenIntentClarificationV1(record: Omit<TtrpgOpenIntentClarification,'clarificationHash'> | TtrpgOpenIntentClarification) {
  const { clarificationHash: _hash, ...body } = record as TtrpgOpenIntentClarification
  return hashProductProductionValueV2(body)
}
export function clarifiedTtrpgOpenIntentV1(original: TtrpgOpenIntentV1, record?: TtrpgOpenIntentClarification): TtrpgOpenIntentV1 {
  if (!record) return original
  if (record.actorKey !== original.actorKey || record.threadKey !== original.clarificationThreadKey) p.fail('人工澄清不能改变原角色或线程')
  return { ...original, ...record.selection, targetRefs: [...record.selection.targetRefs] }
}
