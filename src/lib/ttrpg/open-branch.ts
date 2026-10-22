/** Prepare an open child from a verified cutpoint; no parent rows or gameplay owners are changed. */
import type { ProductRuntimeSession, ProductRuntimeState, ProductRuntimeEvent } from '../types'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { captureTtrpgOpenAncestorV1, createTtrpgOpenBranchRecoveryTasksV1,
  parseTtrpgOpenBranchLineageV1, verifyTtrpgOpenBranchLineageV1 } from './open-branch-contract'
import { ttrpgOpenScopedKeyV1 } from './open-coordination'
import { key } from './open-contract-parse'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { verifyTtrpgOpenAudioReceiptsV1 } from './open-audio-proof'
import { verifyTtrpgOpenIdentityKnowledgeV1 } from './open-identity-knowledge-proof'

const preparedBranches = new WeakMap<ProductRuntimeState, { hash: string; runtimeSourceHash: string }>()
export async function consumePreparedTtrpgOpenBranchStateV1(state: ProductRuntimeState, runtimeSourceHash: string): Promise<void> {
  const evidence = preparedBranches.get(state)
  if (!evidence || evidence.runtimeSourceHash !== runtimeSourceHash || await sha256Text(JSON.stringify(state)) !== evidence.hash
    || preparedBranches.get(state) !== evidence || !preparedBranches.delete(state)) throw new Error('[ttrpg-open-branch] 分支必须来自未改写且未重复消费的真实切点准备')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)!
  await verifyTtrpgOpenBranchLineageV1(runtime.branchLineage!, runtime.sessionKey)
  if (runtime.branchLineage!.ancestors.some(ancestor => ancestor.runtimeSourceHash !== runtimeSourceHash)) throw new Error('[ttrpg-open-branch] 祖先来源与子冻结来源不一致')
}

export async function prepareTtrpgOpenBranchStateV1(input: {
  parent: ProductRuntimeSession; state: ProductRuntimeState; events: readonly ProductRuntimeEvent[];
  throughSequence: number; childSessionKey: string;
}): Promise<ProductRuntimeState> {
  const parentRuntime = parseTtrpgRuntimeStateV2(input.state.ttrpg)
  if (!parentRuntime || input.parent.kind !== 'ttrpg' || !input.parent.runtimeSourceHash) throw new Error('[ttrpg-open-branch] 父实例没有冻结 open 来源')
  const childSessionKey = key(input.childSessionKey, 'child session key')
  if (childSessionKey === parentRuntime.sessionKey) throw new Error('[ttrpg-open-branch] 子分支必须拥有新稳定身份')
  const { verifyTtrpgOpenSessionSituationHashesV1 } = await import('./open-session-situation-proof')
  await verifyTtrpgOpenSessionSituationHashesV1(parentRuntime.openRun?.situationReceipts ?? [])
  const { verifyTtrpgOpenMemoryReceiptsV1 } = await import('./open-memory-proof')
  await verifyTtrpgOpenMemoryReceiptsV1({ runtime: parentRuntime, runtimeSourceHash: input.parent.runtimeSourceHash, events: input.events })
  await verifyTtrpgOpenAudioReceiptsV1({ runtime: parentRuntime, runtimeSourceHash: input.parent.runtimeSourceHash, events: input.events, projectId: input.parent.projectId })
  await verifyTtrpgOpenIdentityKnowledgeV1({ runtime: parentRuntime, runtimeSourceHash: input.parent.runtimeSourceHash, events: input.events })
  const ancestor = await captureTtrpgOpenAncestorV1({ sessionKey: parentRuntime.sessionKey, seed: input.parent.seed,
    runtimeSourceHash: input.parent.runtimeSourceHash, throughSequence: input.throughSequence, state: input.state,
    authorization: parentRuntime.authorization, openRun: parentRuntime.openRun, events: input.events })
  const inheritedPending = await Promise.all((parentRuntime.branchLineage?.recoveryTasks ?? [])
    .filter(task => task.status === 'awaiting-authorization' || task.status === 'ready')
    .map(async task => ({ ...structuredClone(task), taskKey: await ttrpgOpenScopedKeyV1(childSessionKey, 'branch-recovery', [task.taskKey]),
      inheritedRef: null, childOperationKey: null, status: 'awaiting-authorization' as const })))
  const recoveryTasks = [...inheritedPending, ...await createTtrpgOpenBranchRecoveryTasksV1(childSessionKey, ancestor)]
  const lineage = parseTtrpgOpenBranchLineageV1({ schema: 'storyforge.ttrpg-open-branch-lineage', version: 1,
    parentSessionKey: parentRuntime.sessionKey, ancestors: [...(parentRuntime.branchLineage?.ancestors ?? []), ancestor], recoveryTasks }, childSessionKey)
  await verifyTtrpgOpenBranchLineageV1(lineage, childSessionKey)
  const child = structuredClone(input.state)
  const runtime = parseTtrpgRuntimeStateV2(child.ttrpg)!
  runtime.sessionKey = childSessionKey; runtime.branchLineage = lineage
  // Historical grants stay frozen in ancestor evidence. Child consent and all paid windows require explicit renewal.
  runtime.authorization = null
  runtime.product.sessionZero.completed = false; runtime.product.sessionZero.completedAtSequence = null
  runtime.product.sessionZero.completedBy = null; runtime.product.sessionZero.selectedCharacterKeys = []
  if (runtime.openRun) {
    runtime.openRun.coordination = { activeEpochKey: null, epochs: [], calls: [] }
    runtime.openRun.operations = []; runtime.openRun.ruleReceipts = []
    if (runtime.openRun.entityOperations) runtime.openRun.entityOperations = runtime.openRun.entityOperations.filter(row => row.resolution?.kind === "materialized")
    // Keep the game turn; establish the new local event-order boundary. Parent time proof remains in the capsule.
    runtime.openRun.worldTime.lastAdvancedByEventSequence = -1
  }
  child.ttrpg = runtime; child.lastSequence = 0
  parseTtrpgRuntimeStateV2(child.ttrpg)
  preparedBranches.set(child, { hash: await sha256Text(JSON.stringify(child)), runtimeSourceHash: input.parent.runtimeSourceHash })
  return child
}
