import Dexie from 'dexie'
import {
  appendAgentRunEventWithSettlementInTransactionV1,
  readInstanceAgentRunV1,
  withAgentRunMutationLockV1,
  type AgentRunSnapshotV1,
} from '../agent/run/event-store'
import { parseAgentRunEventV1 } from '../agent/run/event-schema'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { db } from '../db/schema'
import { assertFormalRuntimeSourceUnchangedV1, type VerifiedFormalRuntimeSourceV1 } from '../product/runtime-core'
import type { ProductRuntimeEvent, ProductRuntimeSession, WorkspaceScope } from '../types'
import { scopeTransactionTables } from '../workspace/scope'

interface ReadOnlyCandidate {
  runId: number
  productRuntimeSessionId: number
  candidateHash: string
  contextManifestHash: string
  baseSequence: number
  stateHash: string
}

const BOUNDARIES = {
  'open-world:runtime-candidate': { source: 'openWorldRuntime', verifier: 'open-world-runtime-terminal-v1' },
  'text-open-world:evolution-runtime-candidate': { source: 'textOpenWorldEvolutionRuntime', verifier: 'text-open-world-evolution-runtime-terminal-v1' },
} as const

function fail(message: string): never { throw new Error(`[text-open-world-readonly-recovery] ${message}`) }

/** Completes only an adoption that is already persisted by the reserved
 * runtime API. It cannot create a candidate, adoption, command or Session.
 * New-candidate admission remains in the two product-owned Harness callers. */
export async function finishOpenWorldReadOnlyAdoptionV1(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: ReadOnlyCandidate
  stepId: keyof typeof BOUNDARIES
  session: ProductRuntimeSession
  events: readonly ProductRuntimeEvent[]
  frozen: VerifiedFormalRuntimeSourceV1
  version: { sequence: number; stateHash: string }
}): Promise<{ snapshot: AgentRunSnapshotV1; receiptHash: string }> {
  const { candidate, snapshot, version, stepId } = input
  const boundary = BOUNDARIES[stepId]
  const adoptionHash = await hashCanonicalValue({ candidateHash: candidate.candidateHash,
    resultingSequence: version.sequence, resultingStateHash: version.stateHash, writeTargets: [] })
  const validate = (current: AgentRunSnapshotV1) => {
    const runtime = current.contract.scope.runtime
    if (current.run.id !== candidate.runId || current.run.productRuntimeSessionId !== candidate.productRuntimeSessionId
      || input.session.id !== candidate.productRuntimeSessionId || input.session.kind !== 'text-open-world'
      || current.contract.permissions.writeTargets.length !== 0
      || current.contract.permissions.contextSourceKeys.join('\u0000') !== boundary.source
      || runtime?.productRuntimeSessionId !== candidate.productRuntimeSessionId
      || runtime.baseSequence !== candidate.baseSequence || runtime.stateHash !== candidate.stateHash
      || version.sequence !== candidate.baseSequence || version.stateHash !== candidate.stateHash
      || current.contract.verificationPlan.find(plan => plan.id === 'runtime.terminal')?.verifier !== boundary.verifier) {
      fail('只读采用的 owner、合同或实际 post-state 不匹配')
    }
    const events = current.events.filter(event => event.generation === current.projection.generation)
    const adoptions = events.filter(event => event.type === 'runtime.candidate.adopted')
    if (!adoptions.length || adoptions.some(event => event.type !== 'runtime.candidate.adopted'
      || event.runId !== current.run.id || event.payload.stepId !== stepId
      || event.payload.candidateHash !== candidate.candidateHash || event.payload.adoptionHash !== adoptionHash
      || event.payload.baseSequence !== candidate.baseSequence || event.payload.resultingSequence !== version.sequence
      || event.payload.commandIds.length !== 0)) fail('已有只读采用证据矛盾，不能补签终验')
    const manifests = events.filter(event => event.type === 'context.assembled')
    if (manifests.length !== 1 || manifests.some(event => event.type !== 'context.assembled'
      || event.payload.stepId !== stepId || event.payload.manifestHash !== candidate.contextManifestHash)) {
      fail('已有采用的 Context Manifest 不匹配')
    }
    const succeeded = events.filter(event => event.type === 'step.succeeded')
    if (succeeded.some(event => event.type !== 'step.succeeded' || event.payload.stepId !== stepId
      || event.payload.attempt !== 1 || event.payload.outputHash !== adoptionHash)) fail('已有采用的步骤终态证据矛盾')
    const verifying = events.filter(event => event.type === 'verification.started')
    if (verifying.some(event => event.type !== 'verification.started' || event.payload.verifierSetVersion !== boundary.verifier)) {
      fail('已有采用的验证器证据矛盾')
    }
    if (!['running', 'verifying', 'completed'].includes(current.projection.state)) fail('采用运行不处于可补证状态')
    return { stepSucceeded: succeeded.length > 0, verificationStarted: verifying.length > 0 }
  }
  validate(snapshot)
  const acceptedAt = Date.now()
  const receipt = await createVerificationReceiptV1({ version: 1, runId: snapshot.run.id,
    generation: snapshot.projection.generation, contractHash: snapshot.run.contractHash,
    contextManifestHashes: [candidate.contextManifestHash], candidateHashes: [candidate.candidateHash], adoptionEventIds: [],
    postStateHash: version.stateHash, verifierSetVersion: boundary.verifier, criteria: [
      { id: 'runtime.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'runtime.freshness', status: 'passed', evidenceRefs: [`base:${candidate.baseSequence}:${candidate.stateHash}`] },
      { id: 'runtime.read-only', status: 'passed', evidenceRefs: [`post-state:${version.stateHash}`] },
    ], acceptedAt })
  return withAgentRunMutationLockV1(snapshot.run.id, () => db.transaction('rw', scopeTransactionTables(
    db.agentRuns, db.agentRunEvents, db.productRuntimeSessions, db.productRuntimeEvents,
    db.productReleases, db.productBuilds, db.productProductions, db.productProductionBriefs,
  ), async () => {
    const session = await db.productRuntimeSessions.get(candidate.productRuntimeSessionId)
    const events = await db.productRuntimeEvents.where('sessionId').equals(candidate.productRuntimeSessionId).sortBy('sequence')
    if (!session || canonicalStringify(session) !== canonicalStringify(input.session)
      || canonicalStringify(events) !== canonicalStringify(input.events)) fail('只读采用的 post-state 在补证提交前已变化')
    await assertFormalRuntimeSourceUnchangedV1({ previewSession: input.session, session, frozen: input.frozen })
    let current = await readInstanceAgentRunV1(input.scope, snapshot.run.id)
    const stages = validate(current)
    if (current.projection.state === 'completed') {
      return { snapshot: current, receiptHash: current.projection.terminalReceiptHash ?? fail('已有终验回执缺失') }
    }
    if (canonicalStringify(current.run) !== canonicalStringify(snapshot.run)
      || canonicalStringify(current.events) !== canonicalStringify(snapshot.events)) fail('已有采用运行已并发变化，请重新读取')
    const append = async (event: ReturnType<typeof parseAgentRunEventV1>) => {
      current = await Dexie.Promise.resolve(appendAgentRunEventWithSettlementInTransactionV1({
        snapshot: current, event, scope: input.scope, workspaceDirty: true,
      }))
    }
    const event = (type: 'step.succeeded' | 'verification.started' | 'verification.accepted', payload: object) => parseAgentRunEventV1({
      version: 1, runId: current.run.id, sequence: current.projection.lastSequence + 1,
      generation: current.projection.generation, projectId: current.run.projectId,
      worldGroupId: current.run.worldGroupId ?? null, contractHash: current.run.contractHash,
      type, createdAt: acceptedAt, payload,
    })
    if (!stages.stepSucceeded) await append(event('step.succeeded', { stepId, attempt: 1, outputHash: adoptionHash }))
    if (!stages.verificationStarted) await append(event('verification.started', { verifierSetVersion: boundary.verifier }))
    await append(event('verification.accepted', { receiptHash: receipt.receiptHash }))
    return { snapshot: current, receiptHash: receipt.receiptHash }
  }))
}
