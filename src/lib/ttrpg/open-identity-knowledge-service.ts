/** Human read/review surface. Pending confirmations are process-local and cannot be imported or copied. */
import type { WorkspaceScope } from '../types'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { createTtrpgOpenIdentityKnowledgeV1, assertTtrpgOpenIdentityKnowledgeWindowV1, ttrpgOpenIdentityNamesFromJournalV1 } from './open-identity-knowledge'
import { parseTtrpgOpenIdentityKnowledgeRequestV1, type TtrpgOpenIdentityKnowledgeRequestV1 } from './open-identity-knowledge-contract'
import { hashTtrpgOpenIdentityKnowledgeConfirmationV1 } from './open-identity-knowledge-proof'
import { confirmTtrpgOpenIdentityKnowledgeV1 } from './runtime-commands'
import { ttrpgOpenScopedKeyV1 } from './open-coordination'
import { ttrpgOpenEvidenceFieldsV1 } from './open-knowledge'
import { ttrpgOpenKnowledgeDiscoveryOriginV1, assertTtrpgOpenKnowledgeShareActorV1 } from './open-knowledge-share'
import { ttrpgOpenSituationCatalogV1 } from './open-session-situation-catalog'
import { ttrpgOpenEntityReferenceVisibleV1 } from './open-entity-catalog'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import * as p from './open-contract-parse'

export interface TtrpgOpenIdentityKnowledgeDeskInputV1 { scope: WorkspaceScope; sessionId: number; viewerKey: string }
export interface TtrpgOpenIdentityKnowledgeReviewV1 {
  schema: 'storyforge.ttrpg-open-identity-knowledge-review'; version: 1; reviewKey: string
  mode: 'observation' | 'share'; evidence: { title: string; description: string }
  identities: { entityRef: string; kind: string; name: string }[]; recipients: string[]; audience: 'private' | 'party' | 'public'
}
type Owner = { input: TtrpgOpenIdentityKnowledgeDeskInputV1; body: string; request: TtrpgOpenIdentityKnowledgeRequestV1; submissionKey: string; confirmationHash: string; sequence: number; stateHash: string }
const reviews = new WeakMap<TtrpgOpenIdentityKnowledgeReviewV1, Owner>()
export async function prepareTtrpgOpenIdentityKnowledgeV1(input: TtrpgOpenIdentityKnowledgeDeskInputV1 & {
  request: TtrpgOpenIdentityKnowledgeRequestV1; submissionKey: string
}): Promise<TtrpgOpenIdentityKnowledgeReviewV1> {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const request = parseTtrpgOpenIdentityKnowledgeRequestV1(input.request), submissionKey = p.key(input.submissionKey, 'identity review submission')
  request.entityRefs.sort(); request.recipientActorKeys.sort()
  const source = loaded.runtime.openRun!.knowledge.find(row => row.knowledgeKey === request.sourceKnowledgeKey) ?? p.fail('请先选择本人可读取的实际观察')
  const knowledge = createTtrpgOpenIdentityKnowledgeV1({ runtime: loaded.runtime, runtimeSourceHash: loaded.session.runtimeSourceHash, viewerKey: input.viewerKey, request,
    acquisitionRef: { sessionKey: loaded.runtime.sessionKey, sequence: loaded.state.lastSequence + 1 },
    knowledgeKey: await ttrpgOpenScopedKeyV1(loaded.runtime.sessionKey, 'identity-grant', [input.viewerKey, submissionKey]), sourceKnowledgeHash: await hash(source),
    submissionKey, baseStateHash: loaded.stateHash, confirmationHash: '0'.repeat(64) })
  const confirmationHash = await hashTtrpgOpenIdentityKnowledgeConfirmationV1(knowledge)
  const origin = ttrpgOpenKnowledgeDiscoveryOriginV1(loaded.runtime, source)
  const review: TtrpgOpenIdentityKnowledgeReviewV1 = { schema: 'storyforge.ttrpg-open-identity-knowledge-review', version: 1, reviewKey: crypto.randomUUID(),
    mode: request.mode, evidence: ttrpgOpenEvidenceFieldsV1(ttrpgOpenSituationCatalogV1(origin.frozenContent.campaign, loaded.runtime.openRun).validationView, source.evidenceRef),
    identities: knowledge.identityGrant!.identities.map(({ entityRef, kind, name }) => ({ entityRef, kind, name })),
    recipients: request.recipientActorKeys.map(key => loaded.state.entities[key]?.name ?? key), audience: request.audience }
  reviews.set(review, { input: { scope: structuredClone(input.scope), sessionId: input.sessionId, viewerKey: input.viewerKey }, body: stable(review),
    request, submissionKey, confirmationHash, sequence: loaded.state.lastSequence, stateHash: loaded.stateHash })
  await loaded.assertCurrent(); return review
}
export async function confirmTtrpgOpenIdentityKnowledgeReviewV1(input: TtrpgOpenIdentityKnowledgeDeskInputV1 & {
  review: TtrpgOpenIdentityKnowledgeReviewV1; decision: 'confirm-these-identities-and-recipients'
}) {
  p.literal(input.decision, 'confirm-these-identities-and-recipients', 'identity explicit confirmation')
  const saved = reviews.get(input.review)
  if (!saved || saved.body !== stable(input.review) || stable(saved.input) !== stable({ scope: input.scope, sessionId: input.sessionId, viewerKey: input.viewerKey })) p.fail('请在本人页面重新核对身份与接收者；复制或刷新不恢复待确认权限')
  return confirmTtrpgOpenIdentityKnowledgeV1({ sessionId: input.sessionId, viewerKey: input.viewerKey, request: saved.request, submissionKey: saved.submissionKey,
    confirmationHash: saved.confirmationHash, baseSequence: saved.sequence, baseStateHash: saved.stateHash, commandId: 'identity.explicit.confirmation' })
}
/** Name-only human projection. It grants no mechanical access and is not injected into any V1 AI source. */
export async function readTtrpgOpenLearnedIdentitiesV1(input: TtrpgOpenIdentityKnowledgeDeskInputV1) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } }), seat = loaded.seat!
  const entries = loaded.runtime.openRun!.knowledge.filter(row => row.identityGrant && (seat.role === 'gm' || row.audience === 'public'
    || seat.role === 'player' && seat.actorKey !== null && row.recipientActorKeys.includes(seat.actorKey)))
  const result = entries.flatMap(row => row.identityGrant!.identities.map(identity => ({ entityRef: identity.entityRef, kind: identity.kind, name: identity.name,
    reliability: row.reliability, evidence: ttrpgOpenEvidenceFieldsV1(ttrpgOpenSituationCatalogV1(ttrpgOpenKnowledgeDiscoveryOriginV1(loaded.runtime, row).frozenContent.campaign, loaded.runtime.openRun).validationView, row.evidenceRef).title })))
  await loaded.assertCurrent(); return result
}

/** Selection labels use only current human authority; hidden instances never appear as disabled options or counts. */
export async function readTtrpgOpenIdentityKnowledgeDeskV1(input: TtrpgOpenIdentityKnowledgeDeskInputV1) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const { runtime, authorization: auth, seat } = loaded, run = runtime.openRun!, actorKey = seat!.role === 'player' ? seat!.actorKey : null
  const readable = (row: (typeof run.knowledge)[number], actor: string | null) => row.audience === 'public' || actor !== null && row.recipientActorKeys.includes(actor)
  const fields = (row: (typeof run.knowledge)[number]) => ttrpgOpenEvidenceFieldsV1(ttrpgOpenSituationCatalogV1(ttrpgOpenKnowledgeDiscoveryOriginV1(runtime, row).frozenContent.campaign, run).validationView, row.evidenceRef)
  const players = auth.selectedActorKeys.map(key => ({ actorKey: key, name: loaded.state.entities[key]?.name ?? key }))
  const visible = run.knowledge.filter(row => row.identityGrant && (seat!.role === 'gm' || readable(row, actorKey)))
  const learned = visible.flatMap(row => row.identityGrant!.identities.map(({ entityRef, kind, name }) => ({ entityRef, kind, name, reliability: row.reliability, evidence: fields(row).title })))
  const roots = run.knowledge.filter(row => !row.identityGrant && row.reliability === 'observed' && row.audience !== 'gm-only' && (seat!.role === 'gm' || readable(row, actorKey)))
    .map(row => ({ knowledgeKey: row.knowledgeKey, ...fields(row), observerActorKeys: seat!.role === 'gm'
      ? players.filter(player => readable(row, player.actorKey)).map(player => player.actorKey) : [actorKey!] }))
  const instances = ttrpgOpenIdentityNamesFromJournalV1(run.entityOperations ?? [], loaded.session.runtimeSourceHash)
    .filter(row => ttrpgOpenEntityReferenceVisibleV1(row.audience, row.recipientActorKeys, actorKey, seat!.role === 'gm', true) || learned.some(identity => identity.entityRef === row.entityRef))
    .map(({ entityRef, kind, name }) => ({ entityRef, kind, name }))
  const shareSources = players.flatMap(player => {
    try { assertTtrpgOpenKnowledgeShareActorV1(auth, input.viewerKey, player.actorKey) } catch { return [] }
    return run.knowledge.filter(row => row.identityGrant && readable(row, player.actorKey)).map(row => ({ knowledgeKey: row.knowledgeKey, actorKey: player.actorKey, actorName: player.name,
      ...fields(row), reliability: row.reliability, identities: row.identityGrant!.identities.map(({ entityRef, kind, name }) => ({ entityRef, kind, name })) }))
  })
  let canReview = false
  try { assertTtrpgOpenIdentityKnowledgeWindowV1(runtime, input.viewerKey, 'observation'); canReview = true } catch { /* Read-only history remains available. */ }
  await loaded.assertCurrent()
  return { sequence: loaded.state.lastSequence, actorKey, humanGm: seat!.role === 'gm', canReview, players, roots, instances, shareSources, learned }
}
export type TtrpgOpenIdentityKnowledgeDeskV1 = Awaited<ReturnType<typeof readTtrpgOpenIdentityKnowledgeDeskV1>>
