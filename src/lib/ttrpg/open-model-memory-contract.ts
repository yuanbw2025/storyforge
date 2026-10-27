/** Explicit model-reviewed memory. This version never accepts the manual author's provenance. */
import type { TtrpgOpenMemoryReceiptV1, TtrpgOpenMemoryDraftV1 } from './open-memory-contract'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenBriefAttributionV1, parseTtrpgOpenBriefV1, type TtrpgOpenBriefV1, type TtrpgOpenBriefAttributionV1 } from './open-brief-contract'
import * as p from './open-contract-parse'

export interface TtrpgOpenModelMemoryReceiptV2 extends Omit<TtrpgOpenMemoryReceiptV1, 'version' | 'origin' | 'sourceEvents'> {
  version: 2
  origin: 'model-reviewed'
  sourceWindow: { eventCount: number; portableChainHash: string }
  model: {
    requestKey: string; epochKey: string; candidateHash: string; rawResponseHash: string
    runContractHash: string; inputManifestHash: string; contextHash: string
    brief: TtrpgOpenBriefV1; attributions: TtrpgOpenBriefAttributionV1[]
  }
}
export function parseTtrpgOpenModelMemoryReceiptV2(value: unknown): TtrpgOpenModelMemoryReceiptV2 {
  const r = p.record(value, ['schema', 'version', 'commandId', 'draft', 'viewerKey', 'authorActorKey', 'authorizationRef', 'sourceRef',
    'runtimeSourceHash', 'sourceLineageHash', 'sourceWindow', 'recipientActorKeys', 'derivedFromHash', 'recordedAt', 'recordedAtWorldTurn',
    'origin', 'noMechanicalAuthority', 'noKnowledgeGrant', 'receiptHash', 'model'], 'model-reviewed memory receipt')
  const d = p.record(r.draft, ['revisionKey', 'observerKey', 'reliability', 'audience', 'knownBy', 'summary', 'fromEventSequence', 'toEventSequence'], 'model memory draft')
  const draft: TtrpgOpenMemoryDraftV1 = { revisionKey: p.key(d.revisionKey, 'model memory revision'), observerKey: p.literal(d.observerKey, 'gm', 'recap reporter'),
    reliability: p.literal(d.reliability, 'hearsay', 'derived recap reliability'), audience: p.literal(d.audience, 'party', 'recap audience'),
    knownBy: p.list(d.knownBy, 'recap knownBy', p.key, 0, 0), summary: p.text(d.summary, 'model memory summary', 20000),
    fromEventSequence: p.literal(d.fromEventSequence, 1, 'full source prefix start'), toEventSequence: p.integer(d.toEventSequence, 'source prefix end', 1, Number.MAX_SAFE_INTEGER) }
  const sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef), authorizationRef = parseTtrpgOpenSourceRefV1(r.authorizationRef)
  const window = p.record(r.sourceWindow, ['eventCount', 'portableChainHash'], 'model memory source prefix')
  const sourceWindow = { eventCount: p.integer(window.eventCount, 'source prefix count', 1, Number.MAX_SAFE_INTEGER), portableChainHash: p.hash(window.portableChainHash, 'source prefix root') }
  const recipientActorKeys = p.keys(r.recipientActorKeys, 'model memory recipients', 256, 1).sort()
  const m = p.record(r.model, ['requestKey', 'epochKey', 'candidateHash', 'rawResponseHash', 'runContractHash', 'inputManifestHash', 'contextHash', 'brief', 'attributions'], 'actual recap model proof')
  const attributions = p.list(m.attributions, 'actual recap sources', parseTtrpgOpenBriefAttributionV1, 256, 1)
  p.unique(attributions.map(a => a.citationKey), 'actual recap citations')
  const brief = parseTtrpgOpenBriefV1(m.brief, attributions)
  if (draft.summary !== brief.paragraphs.map(p => p.text).join('\n') || draft.toEventSequence >= sourceRef.sequence
    || sourceWindow.eventCount !== draft.toEventSequence || authorizationRef.sessionKey !== sourceRef.sessionKey
    || authorizationRef.sequence > draft.toEventSequence) p.fail('复盘正文或来源区间与模型/原始授权不一致')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-memory-receipt', 'memory schema'), version: p.literal(r.version, 2, 'model memory version'),
    origin: p.literal(r.origin, 'model-reviewed', 'model memory origin'), commandId: p.key(r.commandId, 'model memory command'),
    draft, sourceRef, authorizationRef, sourceWindow, recipientActorKeys,
    viewerKey: p.key(r.viewerKey, 'model memory confirmer'), authorActorKey: p.nullable(r.authorActorKey, p.key, 'human confirming actor'),
    runtimeSourceHash: p.hash(r.runtimeSourceHash, 'model memory runtime source'), sourceLineageHash: p.hash(r.sourceLineageHash, 'model memory lineage'),
    derivedFromHash: p.hash(r.derivedFromHash, 'model memory source digest'), recordedAt: p.integer(r.recordedAt, 'model memory time', 0, Number.MAX_SAFE_INTEGER),
    recordedAtWorldTurn: p.integer(r.recordedAtWorldTurn, 'model memory turn', 0, Number.MAX_SAFE_INTEGER),
    noMechanicalAuthority: p.literal(r.noMechanicalAuthority, true, 'memory authority'), noKnowledgeGrant: p.literal(r.noKnowledgeGrant, true, 'memory knowledge'),
    receiptHash: p.hash(r.receiptHash, 'model memory hash'), model: {
      requestKey: p.key(m.requestKey, 'recap request'), epochKey: p.key(m.epochKey, 'recap epoch'), candidateHash: p.hash(m.candidateHash, 'recap candidate'),
      rawResponseHash: p.hash(m.rawResponseHash, 'recap original answer'), runContractHash: p.hash(m.runContractHash, 'recap original run'),
      inputManifestHash: p.hash(m.inputManifestHash, 'recap actual manifest'), contextHash: p.hash(m.contextHash, 'recap context'), brief, attributions } }
}
