/** Shared live F13 preflight. Formal commands supply verified frozen content and actual participant rows. */
import type { ProductRuntimeState, TtrpgSessionParticipantRecordV2 } from '../types'
import type { TtrpgRuntimeContentV2 } from './content-version'
import { assertTtrpgOpenAuthorizationCurrentV1, assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { isTtrpgOpenPassiveEpochV1 } from './open-coordination'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { verifyTtrpgOpenEntityPlanHashesV1 } from './open-entity-proof'
import { createTtrpgOpenEntityPlanV1, createTtrpgOpenEntityPlanV2 } from './open-entity-plan'
import { ttrpgOpenEntityOperationBasisV1 } from './open-entity-operation-basis'
import * as p from './open-contract-parse'

export async function assertTtrpgOpenEntityLiveV1(input: { state: ProductRuntimeState; operationKey: string; planHash: string; viewerKey: string;
  participants: TtrpgSessionParticipantRecordV2[]; allowPausedDisposal?: boolean }) {
  const basis = ttrpgOpenEntityOperationBasisV1(input.state, input.operationKey, input.planHash), { runtime, run, auth, operation, plan } = basis
  const seat = assertTtrpgOpenAuthorizationCurrentV1({ authorization: auth, participants: input.participants, viewerKey: input.viewerKey })
  const epoch = run.coordination.epochs.find(row => row.epochKey === plan.authorizationEpochKey)
  if (operation.resolution || plan.proposedRef.sessionKey !== runtime.sessionKey || plan.authorizationHash !== await hash(auth)
    || !epoch || epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey || isTtrpgOpenPassiveEpochV1(epoch)
    || run.stage.status !== 'open' || !input.allowPausedDisposal && runtime.product.safety.status !== 'active') p.fail('实体原计划已结束、暂停或失去本次实际授权')
  await verifyTtrpgOpenEntityPlanHashesV1([operation])
  return { ...basis, seat }
}
export async function recheckTtrpgOpenEntityMaterializationV1(input: { state: ProductRuntimeState; content: TtrpgRuntimeContentV2; runtimeSourceHash: string;
  operationKey: string; planHash: string; viewerKey: string; participants: TtrpgSessionParticipantRecordV2[] }) {
  const basis = await assertTtrpgOpenEntityLiveV1(input), { plan, operation, auth, run } = basis
  assertTtrpgOpenHumanHostV1(auth, input.viewerKey)
  if (input.viewerKey !== plan.viewerKey || operation.approvals.length !== plan.requiredApprovals.length || operation.approvals.some(row => row.decision !== 'approve')) p.fail('实体创建须原主持与全部受影响者明确确认原版本')
  const planning = { state: input.state, content: input.content, runtimeSourceHash: input.runtimeSourceHash,
    viewerKey: input.viewerKey, commandId: plan.rootCommandId, sequence: plan.proposedRef.sequence, oracleSourceRef: plan.oracleSourceRef,
    proposals: plan.items.map(row => row.proposal), previousOperations: (run.entityOperations ?? []).filter(row => row !== operation) }
  const original = plan.version === 2 ? await createTtrpgOpenEntityPlanV2(planning, plan.modelOrigin) : await createTtrpgOpenEntityPlanV1(planning)
  if (stable(original) !== stable(plan)) p.fail('实体原计划的来源、模板、配额、机械状态或披露范围已经变化')
  return basis
}
