import { assertTtrpgOpenKnowledgeSourceCompatibleV1 } from './open-release-compatibility'
/** An explicit human review grants attributed clue text, never implicit identity or mechanical access. */
import { db } from '../db/schema'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { loadTtrpgOpenConsultationStateV1, ttrpgOpenConsultationAvailabilityV1, ttrpgOpenConsultationEnvelopeV1,
  type TtrpgOpenConsultationInputV1, type TtrpgOpenConsultationStateV1 } from './open-human-consultation'
import { assertTtrpgOpenKnowledgeShareActorV1, createTtrpgOpenSharedKnowledgeV1, hashTtrpgOpenKnowledgeShareConfirmationV1,
  parseTtrpgOpenKnowledgeShareRequestV1, ttrpgOpenKnowledgeDiscoveryOriginV1, type TtrpgOpenKnowledgeShareRequestV1 } from './open-knowledge-share'
import { ttrpgOpenEvidenceFieldsV1 } from './open-knowledge'
import { ttrpgOpenSituationCatalogV1 } from './open-session-situation-catalog'
import { shareTtrpgOpenKnowledgeV1 } from './runtime-commands'
import * as p from './open-contract-parse'

export async function projectTtrpgOpenClueSharingV1(loaded: TtrpgOpenConsultationStateV1, viewerKey: string) {
  const { runtime, authorization: auth, seat } = loaded, run = runtime.openRun!
  const players = auth.selectedActorKeys.map(actorKey => ({ actorKey, name: loaded.state.entities[actorKey]?.name ?? actorKey }))
  // Approval of an AI action does not grant its private knowledge to the approving player.
  const actors = players.filter(player => seat!.role === 'gm' || player.actorKey === seat!.actorKey).filter(player => {
    try { assertTtrpgOpenKnowledgeShareActorV1(auth, viewerKey, player.actorKey); return true } catch { return false }
  })
  const sources = []
  for (const actor of actors) for (const source of run.knowledge) {
    if (source.identityGrant || source.audience === 'gm-only' || source.audience !== 'public' && !source.recipientActorKeys.includes(actor.actorKey)) continue
    const origin = ttrpgOpenKnowledgeDiscoveryOriginV1(runtime, source)
    const fields = ttrpgOpenEvidenceFieldsV1(ttrpgOpenSituationCatalogV1(origin.frozenContent.campaign, run).validationView, source.evidenceRef)
    if (source.publicFieldsHash !== await hash(fields)) p.fail('原线索字段与实际发现记录不一致，请核对原进度')
    sources.push({ actorKey: actor.actorKey, actorName: actor.name, knowledgeKey: source.knowledgeKey, ...fields, reliability: source.reliability })
  }
  return { canShare: ttrpgOpenConsultationAvailabilityV1(loaded, viewerKey).canShare,
    privateAllowed: loaded.content.campaign.informationPolicy.interPlayerWhispers, players, sources }
}
export interface TtrpgOpenClueShareReviewV1 {
  schema: 'storyforge.ttrpg-open-clue-share-review'; version: 1; reviewKey: string
  actorName: string; title: string; description: string; audience: TtrpgOpenKnowledgeShareRequestV1['audience']
  recipients: string[]; reliability: 'hearsay' | 'belief'
}
type ReviewOwner = { input: TtrpgOpenConsultationInputV1; body: string; request: TtrpgOpenKnowledgeShareRequestV1;
  envelope: { sessionId: number; commandId: string; baseSequence: number; baseStateHash: string }; confirmationHash: string }
const reviews = new WeakMap<TtrpgOpenClueShareReviewV1, ReviewOwner>()
export async function prepareTtrpgOpenClueShareV1(input: TtrpgOpenConsultationInputV1 & {
  submissionKey: string; actorKey: string; sourceKnowledgeKey: string; audience: TtrpgOpenKnowledgeShareRequestV1['audience']; recipientActorKeys: string[]
}): Promise<TtrpgOpenClueShareReviewV1> {
  const loaded = await loadTtrpgOpenConsultationStateV1(input), page = await projectTtrpgOpenClueSharingV1(loaded, input.viewerKey)
  if (!page.canShare) p.fail('请先完成原结算并进入本人的普通咨询与交流窗口')
  const visible = page.sources.find(row => row.actorKey === input.actorKey && row.knowledgeKey === input.sourceKnowledgeKey)
  if (!visible) p.fail('请选择本人有权读取和分享的实际线索')
  const source = loaded.runtime.openRun!.knowledge.find(row => row.knowledgeKey === visible.knowledgeKey)!
  const request = parseTtrpgOpenKnowledgeShareRequestV1({ actorKey: input.actorKey, sourceKnowledgeKey: input.sourceKnowledgeKey,
    audience: input.audience, recipientActorKeys: [...input.recipientActorKeys].sort(), publicFieldsHash: source.publicFieldsHash })
  const origin = ttrpgOpenKnowledgeDiscoveryOriginV1(loaded.runtime, source)
  await assertTtrpgOpenKnowledgeSourceCompatibleV1(loaded.runtime, origin, loaded.content)
  const shared = createTtrpgOpenSharedKnowledgeV1({ request, source, authorization: loaded.authorization, knowledgeKey: 'preview.clue-share',
    acquisitionRef: { sessionKey: loaded.runtime.sessionKey, sequence: loaded.state.lastSequence + 1 }, privateChannelsAllowed: page.privateAllowed })
  const envelope = await ttrpgOpenConsultationEnvelopeV1(input, loaded, 'clue.share.review', input.submissionKey)
  const review: TtrpgOpenClueShareReviewV1 = { schema: 'storyforge.ttrpg-open-clue-share-review', version: 1, reviewKey: crypto.randomUUID(),
    actorName: visible.actorName, title: visible.title, description: visible.description, audience: request.audience,
    recipients: request.recipientActorKeys.map(key => page.players.find(row => row.actorKey === key)!.name), reliability: shared.reliability as 'hearsay' | 'belief' }
  reviews.set(review, { input: { scope: structuredClone(input.scope), sessionId: input.sessionId, viewerKey: input.viewerKey }, body: stable(review), request, envelope,
    confirmationHash: await hashTtrpgOpenKnowledgeShareConfirmationV1({ request, viewerKey: input.viewerKey, baseStateHash: loaded.stateHash, runtimeSourceHash: loaded.session.runtimeSourceHash }) })
  await loaded.assertCurrent(); return review
}
export async function confirmTtrpgOpenClueShareV1(input: TtrpgOpenConsultationInputV1 & {
  review: TtrpgOpenClueShareReviewV1; decision: 'share-this-exact-clue-with-these-recipients'
}) {
  p.literal(input.decision, 'share-this-exact-clue-with-these-recipients', 'clue sharing confirmation')
  const saved = reviews.get(input.review)
  if (!saved || saved.body !== stable(input.review) || stable(saved.input) !== stable({ scope: input.scope, sessionId: input.sessionId, viewerKey: input.viewerKey })) p.fail('请在本人页面重新审阅线索和接收者；复制或刷新不保留待确认权限')
  const loaded = await loadTtrpgOpenConsultationStateV1(input)
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, saved.envelope.commandId]).first()
  if (!prior && (loaded.state.lastSequence !== saved.envelope.baseSequence || loaded.stateHash !== saved.envelope.baseStateHash
    || !ttrpgOpenConsultationAvailabilityV1(loaded, input.viewerKey).canShare)) p.fail('原线索审阅基线已变化，请重新读取并审阅')
  await loaded.assertCurrent()
  return shareTtrpgOpenKnowledgeV1({ ...saved.envelope, viewerKey: input.viewerKey, request: saved.request, confirmationHash: saved.confirmationHash })
}
