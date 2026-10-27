/** Portable approval evidence, never an inherited execution grant. */
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import * as p from './open-contract-parse'

export interface TtrpgOpenReleaseContinuationPlanV1 {
  schema: 'storyforge.ttrpg-open-release-continuation'; version: 1
  transitionKey: string; approvedBy: string; reason: string
  parentSessionKey: string; parentSequence: number; parentStateHash: string
  parentRuntimeSourceHash: string; targetRuntimeSourceHash: string
  parentContentHash: string; targetContentHash: string; childSessionKey: string
  seedCommitment: string; worldTurn: number; selectedActorKeys: string[]; openingTemplateKeys: string[]
  interrupted: Array<{ taskKey: string; ancestorSessionKey: string; operationKey: string; operationHash: string; remainingStepKeys: string[] }>
  unknownCalls: Array<{ sessionKey: string; requestKey: string; recordHash: string }>
  migratedStateHash: string; planHash: string
}
export interface TtrpgOpenReleaseContinuationV1 {
  plan: TtrpgOpenReleaseContinuationPlanV1
  confirmedRef: TtrpgOpenSourceRefV1 | null
}
export function parseTtrpgOpenReleaseContinuationPlanV1(value: unknown): TtrpgOpenReleaseContinuationPlanV1 {
  const r = p.record(value, ['schema', 'version', 'transitionKey', 'approvedBy', 'reason', 'parentSessionKey', 'parentSequence', 'parentStateHash',
    'parentRuntimeSourceHash', 'targetRuntimeSourceHash', 'parentContentHash', 'targetContentHash', 'childSessionKey', 'seedCommitment', 'worldTurn',
    'selectedActorKeys', 'openingTemplateKeys', 'interrupted', 'unknownCalls', 'migratedStateHash', 'planHash'], 'open release continuation plan')
  const interrupted = p.list(r.interrupted, 'interrupted suffixes', value => {
    const t = p.record(value, ['taskKey', 'ancestorSessionKey', 'operationKey', 'operationHash', 'remainingStepKeys'], 'interrupted suffix')
    const remainingStepKeys = p.keys(t.remainingStepKeys, 'interrupted remaining steps', 100, 1)
    if (remainingStepKeys.some(k => !['gates', 'narration', 'handoff'].includes(k))) p.fail('机械待办必须先按原恢复流程处理，不能在续团时放弃')
    return { taskKey: p.key(t.taskKey, 'interrupted task'), ancestorSessionKey: p.key(t.ancestorSessionKey, 'interrupted ancestor'),
      operationKey: p.key(t.operationKey, 'interrupted operation'), operationHash: p.hash(t.operationHash, 'interrupted original operation'), remainingStepKeys }
  }, 1000)
  const unknownCalls = p.list(r.unknownCalls, 'retained unknown calls', value => {
    const c = p.record(value, ['sessionKey', 'requestKey', 'recordHash'], 'retained unknown call')
    return { sessionKey: p.key(c.sessionKey, 'unknown call session'), requestKey: p.key(c.requestKey, 'unknown request'), recordHash: p.hash(c.recordHash, 'unknown record hash') }
  }, 100000)
  if (new Set(interrupted.map(t => t.taskKey)).size !== interrupted.length
    || new Set(unknownCalls.map(c => `${c.sessionKey}:${c.requestKey}`)).size !== unknownCalls.length) p.fail('续团保留事项不得重复')
  const plan = { schema: p.literal(r.schema, 'storyforge.ttrpg-open-release-continuation', 'continuation schema'), version: p.literal(r.version, 1, 'continuation version'),
    transitionKey: p.key(r.transitionKey, 'continuation transition'), approvedBy: p.key(r.approvedBy, 'continuation approver'), reason: p.text(r.reason, 'explicit continuation reason', 2000),
    parentSessionKey: p.key(r.parentSessionKey, 'continuation parent'), parentSequence: p.integer(r.parentSequence, 'parent cutpoint', 1, Number.MAX_SAFE_INTEGER),
    parentStateHash: p.hash(r.parentStateHash, 'parent cutpoint hash'), parentRuntimeSourceHash: p.hash(r.parentRuntimeSourceHash, 'parent release source'),
    targetRuntimeSourceHash: p.hash(r.targetRuntimeSourceHash, 'target release source'), parentContentHash: p.hash(r.parentContentHash, 'parent frozen content'),
    targetContentHash: p.hash(r.targetContentHash, 'target frozen content'), childSessionKey: p.key(r.childSessionKey, 'continuation child'),
    seedCommitment: p.hash(r.seedCommitment, 'continued random source'), worldTurn: p.integer(r.worldTurn, 'continued world turn'),
    selectedActorKeys: p.keys(r.selectedActorKeys, 'continued party', 1000, 1), openingTemplateKeys: p.keys(r.openingTemplateKeys, 'continued opening', 20, 1),
    interrupted, unknownCalls, migratedStateHash: p.hash(r.migratedStateHash, 'continued state'), planHash: p.hash(r.planHash, 'continuation plan hash') }
  if (plan.childSessionKey === plan.parentSessionKey || new Set(plan.selectedActorKeys).size !== plan.selectedActorKeys.length
    || new Set(plan.openingTemplateKeys).size !== plan.openingTemplateKeys.length) p.fail('续团必须有独立身份和不重复的队伍/开局选择')
  return plan
}
export function parseTtrpgOpenReleaseContinuationV1(value: unknown): TtrpgOpenReleaseContinuationV1 {
  const r = p.record(value, ['plan', 'confirmedRef'], 'open release continuation')
  return { plan: parseTtrpgOpenReleaseContinuationPlanV1(r.plan), confirmedRef: r.confirmedRef === null ? null : parseTtrpgOpenSourceRefV1(r.confirmedRef) }
}
export async function verifyTtrpgOpenReleaseContinuationPlanV1(value: TtrpgOpenReleaseContinuationPlanV1): Promise<void> {
  const { planHash, ...body } = parseTtrpgOpenReleaseContinuationPlanV1(value)
  if (await hash(body) !== planHash) p.fail('续团预览 hash 不匹配')
}
