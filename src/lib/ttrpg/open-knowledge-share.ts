import { ttrpgOpenSituationCatalogV1 } from './open-session-situation-catalog'
/** Sharing grants attributed hearsay; it never masquerades as the listener's own discovery. */
import type { TtrpgOpenAudience } from './open-contract'
import type { TtrpgOpenAuthorizationV1 } from './open-authorization'
import type { TtrpgOpenKnowledgeEntryV1 } from './open-knowledge'
import { parseTtrpgOpenKnowledgeEntryV1, ttrpgOpenEvidenceFieldsV1 } from './open-knowledge'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { hashProductProductionValueV2 } from '../product-production/hash'
import * as p from './open-contract-parse'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import type { TtrpgOpenDiscoveryPlanV1 } from './open-knowledge-discovery'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'

export interface TtrpgOpenKnowledgeShareRequestV1 {
  actorKey: string; sourceKnowledgeKey: string; audience: Exclude<TtrpgOpenAudience, 'gm-only'>;
  recipientActorKeys: string[]; publicFieldsHash: string;
}
export interface TtrpgOpenKnowledgeShareReceiptV1 {
  sourceKnowledgeKey: string; sourceAcquisitionRef: TtrpgOpenSourceRefV1; sharedByActorKey: string;
  viewerKey: string; authorizationEpochKey: string; confirmationHash: string; knowledge: TtrpgOpenKnowledgeEntryV1;
}
export function parseTtrpgOpenKnowledgeShareRequestV1(value: unknown): TtrpgOpenKnowledgeShareRequestV1 {
  const r = p.record(value, ['actorKey', 'sourceKnowledgeKey', 'audience', 'recipientActorKeys', 'publicFieldsHash'], 'knowledge share request')
  const audience = p.oneOf(r.audience, ['private', 'party', 'public'], 'share audience')
  const recipientActorKeys = p.keys(r.recipientActorKeys, 'share recipients', 1000, audience === 'public' ? 0 : 1)
  if (audience === 'public' && recipientActorKeys.length) p.fail('公开分享不伪装为私密接收者列表')
  return { actorKey: p.key(r.actorKey, 'share actor'), sourceKnowledgeKey: p.key(r.sourceKnowledgeKey, 'shared source knowledge'),
    audience, recipientActorKeys, publicFieldsHash: p.hash(r.publicFieldsHash, 'share public fields') }
}
export async function hashTtrpgOpenKnowledgeShareConfirmationV1(input: {
  request: TtrpgOpenKnowledgeShareRequestV1; viewerKey: string; baseStateHash: string; runtimeSourceHash: string;
}): Promise<string> {
  return hashProductProductionValueV2({ schema: 'storyforge.ttrpg-open-knowledge-share-confirmation', version: 1,
    request: parseTtrpgOpenKnowledgeShareRequestV1(input.request), viewerKey: p.key(input.viewerKey, 'share viewer'),
    baseStateHash: p.hash(input.baseStateHash, 'share state'), runtimeSourceHash: p.hash(input.runtimeSourceHash, 'share runtime source') })
}
export function assertTtrpgOpenKnowledgeShareActorV1(authorization: TtrpgOpenAuthorizationV1, viewerKey: string, actorKey: string): void {
  const viewer = authorization.seats.find(seat => seat.viewerKey === viewerKey)
  const actor = authorization.seats.find(seat => seat.role === 'player' && seat.actorKey === actorKey)
  if (!viewer || viewer.controller === 'ai' || viewer.assignmentState !== 'claimed' || !actor || !authorization.selectedActorKeys.includes(actorKey)) p.fail('分享需要实际活动角色及真人确认')
  if (viewer.actorKey === actorKey && actor.controller !== 'ai') return
  if (actor.controller !== 'human' && authorization.approvalBindings.some(binding => binding.companionActorKey === actorKey && binding.approverSeatKeys.includes(viewer.seatKey))) return
  p.fail('不能冒充其他角色分享其私密知识')
}
export function createTtrpgOpenSharedKnowledgeV1(input: {
  request: TtrpgOpenKnowledgeShareRequestV1; source: TtrpgOpenKnowledgeEntryV1; authorization: TtrpgOpenAuthorizationV1;
  knowledgeKey: string; acquisitionRef: TtrpgOpenSourceRefV1; privateChannelsAllowed: boolean;
}): TtrpgOpenKnowledgeEntryV1 {
  const r = input.request, source = input.source
  if (source.knowledgeKey !== r.sourceKnowledgeKey || source.audience === 'gm-only'
    || (source.audience !== 'public' && !source.recipientActorKeys.includes(r.actorKey))
    || source.publicFieldsHash !== r.publicFieldsHash || (r.audience === 'private' && !input.privateChannelsAllowed)
    || r.recipientActorKeys.some(actor => !input.authorization.selectedActorKeys.includes(actor))
    || (r.audience === 'party' && [...r.recipientActorKeys].sort().join(',') !== [...input.authorization.selectedActorKeys].sort().join(','))) p.fail('分享源、公开字段、私信约定或接收者未获授权')
  return parseTtrpgOpenKnowledgeEntryV1({ knowledgeKey: input.knowledgeKey, evidenceRef: source.evidenceRef,
    sourceFactRefs: source.sourceFactRefs, sourceResourceRefs: source.sourceResourceRefs, acquisitionRef: input.acquisitionRef,
    audience: r.audience, recipientActorKeys: r.recipientActorKeys, publicFieldsHash: source.publicFieldsHash,
    reliability: source.reliability === 'belief' ? 'belief' : 'hearsay' })
}
export function parseTtrpgOpenKnowledgeShareReceiptV1(value: unknown): TtrpgOpenKnowledgeShareReceiptV1 {
  const r = p.record(value, ['sourceKnowledgeKey', 'sourceAcquisitionRef', 'sharedByActorKey', 'viewerKey', 'authorizationEpochKey', 'confirmationHash', 'knowledge'], 'knowledge share receipt')
  const knowledge = parseTtrpgOpenKnowledgeEntryV1(r.knowledge)
  if (knowledge.reliability === 'observed' || knowledge.identityGrant && knowledge.identityGrant.mode !== 'share') p.fail('分享不能充当接收者本人发现')
  return { sourceKnowledgeKey: p.key(r.sourceKnowledgeKey, 'shared knowledge source'), sourceAcquisitionRef: parseTtrpgOpenSourceRefV1(r.sourceAcquisitionRef),
    sharedByActorKey: p.key(r.sharedByActorKey, 'share sender'), viewerKey: p.key(r.viewerKey, 'share viewer'),
    authorizationEpochKey: p.key(r.authorizationEpochKey, 'share epoch'), confirmationHash: p.hash(r.confirmationHash, 'share confirmation'), knowledge }
}

/** Follows genuine receipt lineage to the frozen discovery policy, including archived ancestors. */
export function ttrpgOpenKnowledgeDiscoveryOriginV1(runtime: TtrpgRuntimeStateV2, knowledge: TtrpgOpenKnowledgeEntryV1): TtrpgOpenDiscoveryPlanV1 | {
  kind: 'gate-recovery'; frozenContent: TtrpgOpenDiscoveryPlanV1['frozenContent']; contentHash: string; receipt: import('./open-gate-recovery').TtrpgOpenGateRecoveryV1
} {
  const visited = new Set<string>()
  let current = knowledge
  for (let depth = 0; depth < 100000; depth++) {
    if (visited.has(current.knowledgeKey)) p.fail('知识传播来源形成循环')
    visited.add(current.knowledgeKey)
    const run = current.acquisitionRef.sessionKey === runtime.sessionKey ? runtime.openRun
      : runtime.branchLineage?.ancestors.find(ancestor => ancestor.sessionKey === current.acquisitionRef.sessionKey)?.snapshot.openRun
    if (!run) p.fail('知识缺少实际团局或冻结祖先来源')
    if (current.identityGrant?.mode === 'observation') {
      const source = run.knowledge.find(source => source.knowledgeKey === current.identityGrant!.sourceKnowledgeKey)
      if (!source || stable(source.acquisitionRef) !== stable(current.identityGrant.sourceAcquisitionRef)) p.fail('识别没有原实际观察回执')
      current = source
      continue
    }
    const share = run.knowledgeShares?.find(receipt => receipt.knowledge.knowledgeKey === current.knowledgeKey)
    if (share) {
      const source = run.knowledge.find(source => source.knowledgeKey === share.sourceKnowledgeKey)
      if (!source || stable(source.acquisitionRef) !== stable(share.sourceAcquisitionRef)) p.fail('传播来源没有真实获得回执')
      current = source
      continue
    }
    const recovery = run.gateRecoveries?.find(r => r.action === 'evidence' && r.recoveryKey === current.knowledgeKey && stable(r.sourceRef) === stable(current.acquisitionRef))
    if (recovery) {
      const evaluation = run.gateReceipts?.find(r => stable(r.sourceRef) === stable(recovery.evaluationRef))
      const terminal = evaluation ? run.terminalReceipts?.find(t => stable(t.sourceRef) === stable(evaluation.terminalRef)) : undefined
      const evidence = terminal ? ttrpgOpenSituationCatalogV1(terminal.frozenContent.campaign, run).evidence.get(current.evidenceRef)?.evidence : undefined
      if (!terminal || !evidence || evidence.isRequired || !evidence.discoveryPolicy.failForwardEffectPlanRef || recovery.targetRef !== current.evidenceRef
        || recovery.publicFieldsHash !== current.publicFieldsHash || current.reliability !== 'observed' || current.audience !== 'private'
        || current.recipientActorKeys.length !== 1 || current.recipientActorKeys[0] !== recovery.actorKey
        || stable(ttrpgOpenEvidenceFieldsV1(ttrpgOpenSituationCatalogV1(terminal.frozenContent.campaign, run).validationView,current.evidenceRef)) !== recovery.publicFieldsJson) p.fail('补充线索没有真实恢复和冻结字段来源')
      return { kind: 'gate-recovery',frozenContent: terminal.frozenContent,contentHash: terminal.contentHash,receipt: recovery }
    }
    const operation = run.operations.find(operation => operation.businessRefs.some(ref => ref.stepKey === 'knowledge'
      && stable(ref.sourceRef) === stable(current.acquisitionRef)))
    const plan = operation?.plan.discoveryPlan
    if (!plan || current.reliability !== 'observed' || plan.request.evidenceRef !== current.evidenceRef
      || plan.publicFieldsHash !== current.publicFieldsHash) p.fail('知识不是实际冻结发现路径的结果')
    return plan
  }
  return p.fail('知识传播链超过有界上限')
}
