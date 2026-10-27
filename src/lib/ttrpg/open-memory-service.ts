/** Human desk only. Model recall uses distinct registered consumers. */
import type { WorkspaceScope } from '../types'
import { assertInstanceBinding } from '../product/runtime-instances'
import { recordTtrpgOpenNarrativeMemoryV1 } from './runtime-commands'
import type { TtrpgOpenMemoryDraftV1 } from './open-memory-contract'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import * as p from './open-contract-parse'

export async function readTtrpgOpenNarrativeMemoriesV1(input: { scope: WorkspaceScope; sessionId: number; viewerKey: string }) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const { runtime, state, stateHash, content, authorization, seat, humanHost } = loaded
  if (!seat) throw new Error('[ttrpg-memory] 当前真人席位缺失')
  const entries = loaded.entries.filter(({ receipt }) => receipt.draft.audience === 'public'
    || receipt.draft.audience === 'party' && (humanHost || seat.actorKey !== null && receipt.recipientActorKeys.includes(seat.actorKey))
    || receipt.draft.audience === 'gm-only' && humanHost
    || receipt.draft.audience === 'private' && (seat.actorKey !== null && receipt.recipientActorKeys.includes(seat.actorKey) || humanHost && receipt.recipientActorKeys.includes('gm')))
    .map(({ row, receipt }) => ({ revisionKey: row.revisionKey, summary: row.summary, reliability: row.reliability, audience: row.audience,
      observerKey: row.observerKey, origin: receipt.origin, ...(receipt.version === 2 ? { sourceAttributions: receipt.model.attributions, paragraphs: receipt.model.brief.paragraphs } : {}), knownBy: receipt.recipientActorKeys, fromEventSequence: row.fromEventSequence, toEventSequence: row.toEventSequence,
      recordedAtWorldTurn: receipt.recordedAtWorldTurn, historical: receipt.sourceRef.sessionKey !== runtime.sessionKey,
      noMechanicalAuthority: true as const, noKnowledgeGrant: true as const }))
  await loaded.assertCurrent()
  return { sequence: state.lastSequence, stateHash, sessionKey: runtime.sessionKey, actorKey: seat.actorKey, humanHost,
    canRecord: runtime.product.safety.status === 'active' && seat.consent.sessionLoggingAllowed,
    actors: content.campaign.characterTemplates.filter(actor => authorization.selectedActorKeys.includes(actor.characterKey))
      .map(actor => ({ key: actor.characterKey, name: actor.name })), entries }
}

/** The desk carries its exact read baseline and submission identity through an interrupted retry. */
export async function recordTtrpgOpenDeskMemoryV1(input: {
  scope: WorkspaceScope; sessionId: number; viewerKey: string; submissionKey: string
  baseSequence: number; baseStateHash: string; draft: Omit<TtrpgOpenMemoryDraftV1, 'revisionKey'>
}) {
  p.record(input, ['scope', 'sessionId', 'viewerKey', 'submissionKey', 'baseSequence', 'baseStateHash', 'draft'], 'human memory desk submission')
  await assertInstanceBinding(input.sessionId, input.scope)
  if (!/^[a-zA-Z0-9._-]{1,96}$/.test(input.submissionKey)) throw new Error('[ttrpg-memory] 记录提交标识无效')
  return recordTtrpgOpenNarrativeMemoryV1({ sessionId: input.sessionId, viewerKey: input.viewerKey,
    commandId: `memory.desk.${input.submissionKey}`, baseSequence: input.baseSequence, baseStateHash: input.baseStateHash,
    draft: { ...input.draft, revisionKey: `memory.desk.${input.submissionKey}` } })
}
