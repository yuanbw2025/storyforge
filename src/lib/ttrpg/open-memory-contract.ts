/** Portable human-confirmed memory receipts; summaries never acquire mechanical or knowledge authority. */
import { PRODUCT_RUNTIME_EVENT_TYPES } from '../types'
import type { ProductRuntimeEventType } from '../types'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import type { TtrpgNarrativeMemoryV1 } from './narrative-memory'
import { assertTtrpgOpenHumanHostV1, type TtrpgOpenAuthorizationV1 } from './open-authorization'
import * as p from './open-contract-parse'

export interface TtrpgOpenMemoryDraftV1 {
  revisionKey: string
  observerKey: string | null
  reliability: TtrpgNarrativeMemoryV1['reliability']
  audience: TtrpgNarrativeMemoryV1['audience']
  knownBy: string[]
  summary: string
  fromEventSequence: number
  toEventSequence: number
}
export interface TtrpgOpenMemorySourceEventV1 {
  sourceRef: TtrpgOpenSourceRefV1
  type: ProductRuntimeEventType
  payloadHash: string
  portablePayloadHash: string
}
export interface TtrpgOpenMemoryReceiptV1 {
  schema: 'storyforge.ttrpg-open-memory-receipt'
  version: 1
  commandId: string
  draft: TtrpgOpenMemoryDraftV1
  viewerKey: string
  authorActorKey: string | null
  authorizationRef: TtrpgOpenSourceRefV1
  sourceRef: TtrpgOpenSourceRefV1
  runtimeSourceHash: string
  sourceLineageHash: string
  sourceEvents: TtrpgOpenMemorySourceEventV1[]
  recipientActorKeys: string[]
  derivedFromHash: string
  recordedAt: number
  recordedAtWorldTurn: number
  origin: 'human-authored'
  noMechanicalAuthority: true
  noKnowledgeGrant: true
  receiptHash: string
}
export function parseTtrpgOpenMemoryDraftV1(value: unknown): TtrpgOpenMemoryDraftV1 {
  const r = p.record(value, ['revisionKey', 'observerKey', 'reliability', 'audience', 'knownBy', 'summary', 'fromEventSequence', 'toEventSequence'], 'memory draft')
  const observerKey = p.nullable(r.observerKey, p.key, 'memory observer')
  const reliability = p.oneOf(r.reliability, ['observed', 'hearsay', 'belief'], 'memory reliability')
  const audience = p.oneOf(r.audience, ['public', 'party', 'private', 'gm-only'], 'memory audience')
  const knownBy = p.keys(r.knownBy, 'memory knownBy', 256, 0).sort()
  const fromEventSequence = p.integer(r.fromEventSequence, 'memory from', 1, Number.MAX_SAFE_INTEGER)
  const toEventSequence = p.integer(r.toEventSequence, 'memory to', fromEventSequence, Number.MAX_SAFE_INTEGER)
  if (toEventSequence - fromEventSequence >= 1000) p.fail('单次记忆最多覆盖1000个完整事件，请明确拆分区间')
  if (reliability !== 'observed' && observerKey === null) p.fail('传闻或猜测必须有实际观察者')
  if (audience === 'private' ? !knownBy.length || observerKey !== null && !knownBy.includes(observerKey) : knownBy.length > 0) p.fail('记忆密级与已知者不一致')
  return { revisionKey: p.key(r.revisionKey, 'memory revision'), observerKey, reliability, audience, knownBy,
    summary: p.text(r.summary, 'memory summary', 20000), fromEventSequence, toEventSequence }
}
export function parseTtrpgOpenMemorySourceEventV1(value: unknown): TtrpgOpenMemorySourceEventV1 {
  const e = p.record(value, ['sourceRef', 'type', 'payloadHash', 'portablePayloadHash'], 'memory source event')
  return { sourceRef: parseTtrpgOpenSourceRefV1(e.sourceRef), type: p.oneOf(e.type, PRODUCT_RUNTIME_EVENT_TYPES, 'memory event type'),
    payloadHash: p.hash(e.payloadHash, 'memory payload hash'), portablePayloadHash: p.hash(e.portablePayloadHash, 'memory portable payload hash') }
}
export function parseTtrpgOpenMemoryReceiptV1(value: unknown): TtrpgOpenMemoryReceiptV1 {
  const r = p.record(value, ['schema', 'version', 'commandId', 'draft', 'viewerKey', 'authorActorKey', 'authorizationRef', 'sourceRef',
    'runtimeSourceHash', 'sourceLineageHash', 'sourceEvents', 'recipientActorKeys', 'derivedFromHash', 'recordedAt', 'recordedAtWorldTurn', 'origin',
    'noMechanicalAuthority', 'noKnowledgeGrant', 'receiptHash'], 'memory receipt')
  const draft = parseTtrpgOpenMemoryDraftV1(r.draft), sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef)
  const sourceEvents = p.list(r.sourceEvents, 'memory source events', parseTtrpgOpenMemorySourceEventV1, 1000, 1)
  const authorizationRef = parseTtrpgOpenSourceRefV1(r.authorizationRef)
  const recipientActorKeys = p.keys(r.recipientActorKeys, 'memory recipients', 256, 0).sort()
  if (draft.toEventSequence >= sourceRef.sequence || authorizationRef.sessionKey !== sourceRef.sessionKey
    || authorizationRef.sequence >= sourceRef.sequence || sourceEvents.length !== draft.toEventSequence - draft.fromEventSequence + 1
    || sourceEvents.some((event, i) => event.sourceRef.sessionKey !== sourceRef.sessionKey || event.sourceRef.sequence !== draft.fromEventSequence + i)) p.fail('记忆来源必须是确认事件之前的完整实际区间')
  if (draft.audience === 'public' && recipientActorKeys.length || draft.audience === 'private' && recipientActorKeys.join() !== draft.knownBy.join()
    || draft.audience === 'gm-only' && recipientActorKeys.join() !== 'gm' || draft.audience === 'party' && !recipientActorKeys.length) p.fail('记忆接收者必须冻结在明确密级内')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-memory-receipt', 'memory schema'), version: p.literal(r.version, 1, 'memory version'),
    commandId: p.key(r.commandId, 'memory command'),
    draft, viewerKey: p.key(r.viewerKey, 'memory viewer'), authorActorKey: p.nullable(r.authorActorKey, p.key, 'memory author actor'),
    authorizationRef, sourceRef, runtimeSourceHash: p.hash(r.runtimeSourceHash, 'memory runtime source'), sourceLineageHash: p.hash(r.sourceLineageHash, 'memory lineage'), sourceEvents, recipientActorKeys,
    derivedFromHash: p.hash(r.derivedFromHash, 'memory derived hash'), recordedAt: p.integer(r.recordedAt, 'memory timestamp', 0, Number.MAX_SAFE_INTEGER),
    recordedAtWorldTurn: p.integer(r.recordedAtWorldTurn, 'memory world turn', 0, Number.MAX_SAFE_INTEGER),
    origin: p.literal(r.origin, 'human-authored', 'memory origin'), noMechanicalAuthority: p.literal(r.noMechanicalAuthority, true, 'memory authority'),
    noKnowledgeGrant: p.literal(r.noKnowledgeGrant, true, 'memory knowledge'), receiptHash: p.hash(r.receiptHash, 'memory receipt hash') }
}
export function ttrpgOpenMemoryIntentV1(receipt: TtrpgOpenMemoryReceiptV1) {
  return { viewerKey: receipt.viewerKey, origin: receipt.origin, draft: receipt.draft }
}
export function assertTtrpgOpenManualMemoryInputV1(value: unknown): void {
  p.record(value, ['sessionId', 'commandId', 'baseSequence', 'baseStateHash', 'viewerKey', 'draft'], 'manual memory command')
}
export function authorizeTtrpgOpenMemoryDraftV1(draft: TtrpgOpenMemoryDraftV1, authorization: TtrpgOpenAuthorizationV1, viewerKey: string) {
  const seat = authorization.seats.find(s => s.viewerKey === viewerKey)
  if (!seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || !seat.consent.sessionLoggingAllowed) p.fail('记忆确认需要实际真人席位与记录同意')
  if (draft.observerKey !== null && draft.observerKey !== 'gm') {
    if (draft.observerKey !== seat.actorKey || !authorization.selectedActorKeys.includes(draft.observerKey)) p.fail('只能确认本人视角的记忆，不能替其他角色确立信念')
  } else assertTtrpgOpenHumanHostV1(authorization, viewerKey)
  if (draft.audience === 'gm-only' || draft.observerKey === 'gm') {
    assertTtrpgOpenHumanHostV1(authorization, viewerKey)
    if (draft.observerKey !== null && draft.observerKey !== 'gm') p.fail('主持私域记忆不能替玩家定义内心')
  }
  if (draft.audience === 'private' && (draft.observerKey === null
    || draft.knownBy.some(key => key !== 'gm' && !authorization.selectedActorKeys.includes(key)))) p.fail('私密记忆需要本人确认及明确的本桌知悉角色')
  if (draft.audience !== 'private' && authorization.seats.some(s => (s.role === 'gm' || s.actorKey !== null && authorization.selectedActorKeys.includes(s.actorKey)) && !s.consent.sessionLoggingAllowed)) p.fail('本桌尚未共同同意记录共享记忆')
  const recipientActorKeys = draft.audience === 'public' ? [] : draft.audience === 'party' ? [...authorization.selectedActorKeys].sort()
    : draft.audience === 'private' ? [...draft.knownBy] : ['gm']
  return { seat, recipientActorKeys }
}
