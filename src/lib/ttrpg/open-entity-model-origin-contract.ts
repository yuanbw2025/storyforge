import type { TtrpgOpenEntityPlanV2 } from './open-entity-contract'
import type { TtrpgOpenRunStateV1 } from './open-runtime-contract'
import { canonicalStringify as stable } from '../agent/run/hash'
/** Frozen model provenance and disclosure ceiling. No live adoption or creation grant. */
import type { ExactRunArtifactIdentityV1 } from '../types'
import { extractExactArtifactOwnerRootsV1 } from '../memory/artifact-roots'
import { parseTtrpgOpenModelCallV1, type TtrpgOpenModelCallV1 } from './open-model-calls'
import type { TtrpgOpenDynamicEntityTemplateV1 } from './open-contract'
import { ttrpgOpenEntityReferenceVisibleV1 } from './open-entity-catalog'
import * as p from './open-contract-parse'

export interface TtrpgOpenEntityModelOriginV1 {
  schema: 'storyforge.ttrpg-open-entity-model-origin'; version: 1;
  call: TtrpgOpenModelCallV1; candidateHash: string; runOriginJson: string; artifactRefs: ExactRunArtifactIdentityV1[];
}
export function parseTtrpgOpenEntityArtifactRefsV1(value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 1000) p.fail('模型实体计划缺少有界的原始证据引用')
  return extractExactArtifactOwnerRootsV1({ refsJson: JSON.stringify(value) }, [{ field: 'refsJson', path: [] }])
}
export function parseTtrpgOpenEntityModelOriginV1(value: unknown): TtrpgOpenEntityModelOriginV1 {
  const r = p.record(value, ['schema', 'version', 'call', 'candidateHash', 'runOriginJson', 'artifactRefs'], 'entity model origin')
  const call = parseTtrpgOpenModelCallV1(r.call)
  if (call.skillId !== 'prose.ttrpg-open-entity-propose' || call.stepId !== 'ttrpg.open.entity-propose' || call.attempt !== 1
    || call.actorKey !== 'gm' || call.status !== 'succeeded' || !call.entityProposal) p.fail('模型实体计划只能引用本次成功的原实体请求')
  if (typeof r.runOriginJson !== 'string' || !r.runOriginJson.trim() || r.runOriginJson.length > 8_000_000) p.fail('模型实体计划缺少完整原 Run 证据')
  const artifactRefs = parseTtrpgOpenEntityArtifactRefsV1(r.artifactRefs)
  if (!artifactRefs.some(ref => ref.artifactKind === 'raw-response' && ref.contentHash === call.responseArtifactHash)
    || !artifactRefs.some(ref => ref.artifactKind === 'rendered-request' && ref.contentHash === call.requestHash)) p.fail('模型实体计划缺少原请求或回答引用')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-entity-model-origin', 'entity model origin schema'),
    version: p.literal(r.version, 1, 'entity model origin version'), call,
    candidateHash: p.hash(r.candidateHash, 'entity original candidate'), runOriginJson: r.runOriginJson, artifactRefs }
}
/** Full source delivery is checked separately. Every resulting item keeps exactly the original request ceiling. */
export function ttrpgOpenModelEntityDisclosureV1(origin: TtrpgOpenEntityModelOriginV1,
  template: Pick<TtrpgOpenDynamicEntityTemplateV1, 'audience' | 'knownByActorKeys'>,
  oracleAudience: 'gm-only' | 'party' | 'public', selectedActorKeys: string[], humanGm: boolean) {
  const scope = origin.call.entityProposal!.scope
  if (scope.audience === 'gm-only' ? !humanGm : oracleAudience === 'gm-only'
    || scope.audience === 'public' && (oracleAudience !== 'public' || template.audience !== 'public')
    || scope.recipientActorKeys.some(key => !selectedActorKeys.includes(key)
      || !ttrpgOpenEntityReferenceVisibleV1(template.audience, template.knownByActorKeys, key, false, false))) p.fail('模型实体不得扩大原咨询、模板或本次接收者范围')
  return { audience: scope.audience, recipientActorKeys: [...scope.recipientActorKeys] }
}

export function assertTtrpgOpenEntityModelPlanCallV1(plan: TtrpgOpenEntityPlanV2, run: TtrpgOpenRunStateV1) {
  const call = plan.modelOrigin.call, actual = run.coordination.calls.find(row => row.requestKey === call.requestKey)
  const epoch = run.coordination.epochs.find(row => row.epochKey === plan.authorizationEpochKey), selection = call.entityProposal!
  if (!actual || stable(actual) !== stable(call) || !epoch || epoch.inputRevision !== selection.epochInputRevision
    || call.authorizationEpochKey !== plan.authorizationEpochKey || call.createdRef.sessionKey !== plan.proposedRef.sessionKey
    || !call.terminalRef || call.terminalRef.sequence >= plan.proposedRef.sequence
    || call.runtimeSourceHash !== plan.runtimeSourceHash || call.admissionStateHash !== plan.mechanicalStateHash
    || stable(selection.oracleSourceRef) !== stable(plan.oracleSourceRef)
    || plan.items.some(item => !selection.templateKeys.includes(item.proposal.templateKey)
      || [item.proposal.locationRef, item.proposal.ownerRef].some(ref => ref !== null && !selection.placementRefs.includes(ref)))) p.fail('模型实体计划不是本次原成功请求、机械状态或完整选择')
}
