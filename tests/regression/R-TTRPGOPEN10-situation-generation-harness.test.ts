import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupSituationGenerationV1 } from '../helpers/open-situation-generation'
import { generateTtrpgOpenSituationCandidateV1, recoverTtrpgOpenSituationCandidateV1, recoverTtrpgOpenRuntimeCandidateV1, executeTtrpgOpenSituationRequestV1, TtrpgOpenSituationRequestError } from '../../src/lib/ttrpg/open-intent-harness'
import { prepareTtrpgOpenSituationInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { readTtrpgOpenSituationCandidateV1, readTtrpgOpenSituationCandidateSummaryV1, verifyTtrpgOpenSituationCandidateProofV1 } from '../../src/lib/ttrpg/open-generated-situation-candidate'
import { readTtrpgOpenRuntimeCandidateForKernelV1 } from '../../src/lib/ttrpg/open-runtime-candidate'
import { loadTtrpgOpenSituationContextV1 } from '../../src/lib/ttrpg/open-generated-situation-context'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { readTtrpgOpenTableContextTraceV1 } from '../../src/lib/ttrpg/open-table-service'
import { changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { cancelTtrpgOpenPreparedRequestV1 } from '../../src/lib/ttrpg/open-request-cancellation'
import { reviewTtrpgOpenDeliveredSituationV1 } from '../../src/lib/ttrpg/open-generated-situation-delivery'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { listTtrpgOpenHistoricalResponsesV1, readTtrpgOpenHistoricalResponseV1 } from '../../src/lib/ttrpg/open-imported-response'
import { finishTtrpgOpenSituationDraftV1, reconcileTtrpgOpenStoppedSituationV1, readTtrpgOpenSituationStopRepairsV1 } from '../../src/lib/ttrpg/open-generated-situation-stop'

describe('R-TTRPGOPEN10 formal situation generation and private candidate', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('uses one real authorized request, preserves exact raw/source evidence and returns only opaque fallback progress', async () => {
    const f = await setupSituationGenerationV1(), before = await readProductRuntimeState(f.f.sessionId), output = JSON.stringify(f.value)
    let sends = 0
    const result = await generateTtrpgOpenSituationCandidateV1({ ...f.request, runAI: async messages => {
      sends++; expect(messages.map(m => m.content).join('\n')).toContain('PRIVATE-GM-SITUATION-SOURCE'); return output } })
    expect(result.status).toBe('candidate')
    if (result.status !== 'candidate') throw new Error('candidate required')
    const read = { ...f.input, runId: result.summary.runId, requestKey: result.summary.requestKey }
    const internal = await readTtrpgOpenRuntimeCandidateForKernelV1(read, 'situation-proposal')
    expect(internal?.artifact.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ttrpg-open-intent-cost-unknown' })]))
    expect(result.summary.status, JSON.stringify(internal?.artifact.issues)).toBe('usable-with-warnings')
    expect(JSON.stringify(result)).not.toContain('PRIVATE-'); expect(result).not.toHaveProperty('prepared')
    expect(await readTtrpgOpenSituationCandidateSummaryV1(read)).toEqual(result.summary)
    await expect(readTtrpgOpenSituationCandidateV1(read)).rejects.toThrow(/真人 GM/)
    await expect(recoverTtrpgOpenRuntimeCandidateV1(read)).rejects.toThrow(/真人 GM/)
    const traceHead = await readProductRuntimeState(f.f.sessionId)
    const traceError = await readTtrpgOpenTableContextTraceV1(f.input).then(() => '', cause => cause instanceof Error ? cause.message : String(cause))
    expect(traceError).toMatch(/局势候选与上下文.*尚未公开/)
    expect(traceError).not.toContain('PRIVATE-')
    expect(await readProductRuntimeState(f.f.sessionId)).toEqual(traceHead)
    const raw = await readAgentRunArtifactExactV1({ projectId: f.f.scope.projectId, artifactKind: 'raw-response', contentHash: internal!.rawResponseHash })
    expect(raw).toBe(output)
    db.close(); await db.open()
    expect(await recoverTtrpgOpenSituationCandidateV1(read)).toEqual(result.summary)
    expect((await executeTtrpgOpenSituationRequestV1({ ...read, runAI: async () => { sends++; return output } })).status).toBe('not-sent')
    expect(sends).toBe(1)
    const after = await readProductRuntimeState(f.f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product)
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime); expect(after.ttrpg!.openRun!.situations).toEqual(before.ttrpg!.openRun!.situations)
    const run = await readInstanceAgentRunV1(f.f.scope, read.runId)
    expect(run.contract.permissions.contextSourceKeys).toEqual(['ttrpgOpenSituationInput']); expect(run.contract.permissions.writeTargets).toEqual([])
  })
  it('keeps semantic bytes stable through actual prepare/reserve/dispatch/finish and lets only the real human GM verify the retained original candidate', async () => {
    const f = await setupSituationGenerationV1(true), before = await loadTtrpgOpenSituationContextV1({ ...f.input, actorKey: 'gm' })
    const prepared = await prepareTtrpgOpenSituationInputV1({ ...f.request, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const reserved = await loadTtrpgOpenSituationContextV1({ ...f.input, actorKey: 'gm' })
    expect(reserved.resources).toEqual(before.resources); expect(reserved.admissionStateHash).toBe(before.admissionStateHash)
    expect(reserved.readEvidence.sequence).toBeGreaterThan(before.readEvidence.sequence)
    const result = await executeTtrpgOpenSituationRequestV1({ ...f.input, runId: prepared.runId, requestKey: prepared.requestKey, runAI: async () => JSON.stringify(f.value) })
    if (result.status !== 'candidate') throw new Error('candidate required')
    const read = { ...f.input, runId: prepared.runId, requestKey: prepared.requestKey }
    const proof = await verifyTtrpgOpenSituationCandidateProofV1({ ...read, candidateHash: result.summary.candidateHash })
    expect(proof.candidate.review!.evaluation.accepted).toBe(true); expect(proof.candidate.references.length).toBeGreaterThan(5)
    expect(proof.candidate.review!.grantsAcceptance).toBe(false)
    expect((await loadTtrpgOpenSituationContextV1({ ...f.input, actorKey: 'gm' })).resources).toEqual(before.resources)
  })
  it('rejects a directory-only claim, changed full body and extra source permission while retaining actual source proof', async () => {
    const f = await setupSituationGenerationV1(), prepared = await prepareTtrpgOpenSituationInputV1({ ...f.request, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const reads = await Promise.all(prepared.evidence.preflight.artifacts.filter(r => r.role === 'source-snapshot').map(async r => ({
      sourceKey: r.sourceKey, resourceKey: r.resourceKey, content: JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.f.scope.projectId, artifactKind: r.artifactKind, contentHash: r.contentHash })).content as string })))
    const snapshot = { schema: 'storyforge.ttrpg-open-situation-kernel-snapshot' as const, version: 1 as const, basis: f.kernel.basis, resources: f.kernel.context.resources }
    expect((await reviewTtrpgOpenDeliveredSituationV1({ value: f.value, snapshot, reads })).review.evaluation.accepted).toBe(true)
    expect(reads.some(r => r.resourceKey?.endsWith(':situation-directory'))).toBe(true)
    await expect(reviewTtrpgOpenDeliveredSituationV1({ value: f.value, snapshot, reads: reads.filter(r => !r.resourceKey?.endsWith(':world-fact.fact.harbor')) })).rejects.toThrow(/完整交付/)
    await expect(reviewTtrpgOpenDeliveredSituationV1({ value: f.value, snapshot, reads: [{ ...reads[0], content: '{}' }, ...reads.slice(1)] })).rejects.toThrow(/正文/)
    await expect(reviewTtrpgOpenDeliveredSituationV1({ value: f.value, snapshot, reads: [...reads, { ...reads[0], sourceKey: 'ttrpgOpenGmOracleInput' }] })).rejects.toThrow(/其他来源/)
  })
  it('retains malformed original output as a repairable private candidate and never expands a one-call window to retry it', async () => {
    const f = await setupSituationGenerationV1(), output = '{"PRIVATE-MALFORMED'
    let sends = 0
    const result = await generateTtrpgOpenSituationCandidateV1({ ...f.request, runAI: async () => { sends++; return output } })
    if (result.status !== 'candidate') throw new Error('candidate required')
    expect(result.summary.status).toBe('manual-repair'); expect(JSON.stringify(result)).not.toContain('PRIVATE-')
    const input = { ...f.input, runId: result.summary.runId, requestKey: result.summary.requestKey }
    const internal = await readTtrpgOpenRuntimeCandidateForKernelV1(input, 'situation-proposal')
    expect(await readAgentRunArtifactExactV1({ projectId: f.f.scope.projectId, artifactKind: 'raw-response', contentHash: internal!.rawResponseHash })).toBe(output)
    await expect(generateTtrpgOpenSituationCandidateV1({ ...f.request, runAI: async () => { sends++; return output } })).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    expect(await recoverTtrpgOpenSituationCandidateV1(input)).toEqual(result.summary); expect(sends).toBe(1)
  })
  it('blocks an otherwise valid retained response after a real safety pause without changing its original bytes', async () => {
    const f = await setupSituationGenerationV1(), output = JSON.stringify(f.value)
    const result = await generateTtrpgOpenSituationCandidateV1({ ...f.request, runAI: async () => {
      await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(f.f.sessionId, 'pause.during.generation'), viewerKey: f.input.viewerKey, changedBy: 'hero', status: 'paused', reason: '玩家明确暂停' })
      return output
    } })
    if (result.status !== 'candidate') throw new Error('candidate required')
    expect(result.summary.status).toBe('blocked')
    const candidate = await readTtrpgOpenRuntimeCandidateForKernelV1({ ...f.input, runId: result.summary.runId, requestKey: result.summary.requestKey }, 'situation-proposal')
    expect(candidate?.artifact.issues.some(i => i.code === 'ttrpg-open-intent-stale')).toBe(true)
    expect(await readAgentRunArtifactExactV1({ projectId: f.f.scope.projectId, artifactKind: 'raw-response', contentHash: candidate!.rawResponseHash })).toBe(output)
  })
  it('preserves a dispatched unknown request and a safe recovery locator without exposing transport error text or sending again', async () => {
    const f = await setupSituationGenerationV1(); let sends = 0
    let error: unknown
    try { await generateTtrpgOpenSituationCandidateV1({ ...f.request, runAI: async () => { sends++; throw new Error('PRIVATE-PROVIDER-ERROR') } }) } catch (cause) { error = cause }
    expect(error).toBeInstanceOf(TtrpgOpenSituationRequestError); expect(String(error)).not.toContain('PRIVATE-')
    const locator = error as TtrpgOpenSituationRequestError
    expect(locator.runId).toBeTypeOf('number'); expect(locator.requestKey).toBeTypeOf('string')
    const call = (await readProductRuntimeState(f.f.sessionId)).ttrpg!.openRun!.coordination.calls[0]
    expect(call.status).toBe('unknown'); expect(call.responseArtifactHash).toBeNull()
    const read = { ...f.input, runId: locator.runId!, requestKey: locator.requestKey! }
    expect(await recoverTtrpgOpenSituationCandidateV1(read)).toBeNull()
    expect((await executeTtrpgOpenSituationRequestV1({ ...read, runAI: async () => { sends++; return JSON.stringify(f.value) } })).status).toBe('not-sent')
    expect(sends).toBe(1)
  })
  it('cancels an actual prepared request with zero sends and retains the cancellation instead of renewing authority', async () => {
    const f = await setupSituationGenerationV1(), prepared = await prepareTtrpgOpenSituationInputV1({ ...f.request, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const read = { ...f.input, runId: prepared.runId, requestKey: prepared.requestKey }
    await cancelTtrpgOpenPreparedRequestV1(read)
    let sends = 0
    expect((await executeTtrpgOpenSituationRequestV1({ ...read, runAI: async () => { sends++; return JSON.stringify(f.value) } })).status).toBe('not-sent')
    const call = (await readProductRuntimeState(f.f.sessionId)).ttrpg!.openRun!.coordination.calls[0]
    expect(call.status).toBe('failed'); expect(call.terminalReason).toBe('cancelled-before-dispatch'); expect(sends).toBe(0)
  })
  it('repairs an interrupted candidate checkpoint from original evidence without another send or another candidate identity', async () => {
    const f = await setupSituationGenerationV1(), add = db.agentRunCheckpoints.add.bind(db.agentRunCheckpoints)
    let sends = 0
    db.agentRunCheckpoints.add = async () => { db.agentRunCheckpoints.add = add; throw new Error('fixture checkpoint interruption') }
    let error: unknown
    try { await generateTtrpgOpenSituationCandidateV1({ ...f.request, runAI: async () => { sends++; return JSON.stringify(f.value) } }) } catch (cause) { error = cause }
    expect(error).toBeInstanceOf(TtrpgOpenSituationRequestError)
    const locator = error as TtrpgOpenSituationRequestError, read = { ...f.input, runId: locator.runId!, requestKey: locator.requestKey! }
    const retained = await readTtrpgOpenRuntimeCandidateForKernelV1(read, 'situation-proposal')
    expect(retained?.candidateHash).toBeTruthy()
    expect((await recoverTtrpgOpenSituationCandidateV1(read))?.candidateHash).toBe(retained!.candidateHash)
    expect((await recoverTtrpgOpenSituationCandidateV1(read))?.candidateHash).toBe(retained!.candidateHash); expect(sends).toBe(1)
  })
  it('keeps imported private output out of fallback historical listings and never restores a live imported candidate', async () => {
    const f = await setupSituationGenerationV1(), result = await generateTtrpgOpenSituationCandidateV1({ ...f.request, runAI: async () => JSON.stringify(f.value) })
    if (result.status !== 'candidate') throw new Error('candidate required')
    const projectId = await importProjectJSON(await exportProjectJSON(f.f.scope.projectId)), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId, workId: session.workId } })
    const run = (await db.agentRuns.where('productRuntimeSessionId').equals(session.id!).toArray()).find(r => r.portableRuntimeOriginJson)!
    const read = { scope, sessionId: session.id!, viewerKey: f.input.viewerKey, runId: run.id!, requestKey: result.summary.requestKey }
    expect(await listTtrpgOpenHistoricalResponsesV1(read)).toEqual([])
    await expect(readTtrpgOpenHistoricalResponseV1(read)).rejects.toThrow(/真人 GM/)
    await expect(recoverTtrpgOpenSituationCandidateV1(read)).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    await expect(readTtrpgOpenSituationCandidateSummaryV1(read)).rejects.toThrow(/状态/)
  })
  it('provides the whole closed grammar and a valid candidate without delivering any authored-template example', async () => {
    const f = await setupSituationGenerationV1(false, pkg => {
      for (const template of pkg.ttrpg!.campaign.situationTemplates) template.driverGoal = '未交付样例'.repeat(3900)
    })
    const contract = f.kernel.context.resources.find(r => r.suffix === 'situation-contract')!.value as any
    expect(contract.outputJsonSchema.additionalProperties).toBe(false)
    expect(contract.outputJsonSchema.properties.template.additionalProperties).toBe(false)
    expect(contract.outputJsonSchema.properties.template.properties).not.toHaveProperty('templateKey')
    for (const field of ['driverBinding', 'obstacles', 'interventionPoints', 'evidence', 'whyNowRefs', 'noInterventionOutcome', 'consequences']) {
      expect(contract.outputJsonSchema.properties.template.required).toContain(field)
    }
    expect(contract.outputJsonSchema.$defs.predicate.oneOf.length).toBeGreaterThan(15)
    const prepared = await prepareTtrpgOpenSituationInputV1({ ...f.request, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    expect(prepared.evidence.selector.selected.some(r => r.resourceKey.includes(':situation-definition.'))).toBe(false)
    expect(prepared.messages.map(m => m.content).join('\n')).not.toContain('未交付样例')
    const result = await executeTtrpgOpenSituationRequestV1({ ...f.input, runId: prepared.runId, requestKey: prepared.requestKey, runAI: async () => JSON.stringify(f.value) })
    expect(result.status === 'candidate' && result.summary.status).toBe('usable-with-warnings')
  })
  it('refuses a foreign project and a changed original validation artifact before granting any transport permit', async () => {
    const f = await setupSituationGenerationV1(), prepared = await prepareTtrpgOpenSituationInputV1({ ...f.request, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const other = await setupSituationGenerationV1(), input = { ...f.input, runId: prepared.runId, requestKey: prepared.requestKey }
    let sends = 0
    await expect(executeTtrpgOpenSituationRequestV1({ ...input, scope: other.f.scope, runAI: async () => { sends++; return JSON.stringify(f.value) } })).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    const snapshot = (await db.agentRunArtifacts.where('projectId').equals(f.f.scope.projectId).toArray()).find(r => r.content?.includes('"storyforge.ttrpg-open-situation-kernel-snapshot"'))!
    await db.agentRunArtifacts.update(snapshot.id!, { content: snapshot.content!.replace('PRIVATE-GM-SITUATION-SOURCE', 'TAMPERED-PRIVATE-SOURCE') })
    await expect(executeTtrpgOpenSituationRequestV1({ ...input, runAI: async () => { sends++; return JSON.stringify(f.value) } })).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    expect(sends).toBe(0)
    expect((await readProductRuntimeState(f.f.sessionId)).ttrpg!.openRun!.coordination.calls[0].status).toBe('prepared')
  })
  it('finishes an unadopted private candidate with a durable close and an idempotent terminal cancellation', async () => {
    const f = await setupSituationGenerationV1(), result = await generateTtrpgOpenSituationCandidateV1({ ...f.request, runAI: async () => JSON.stringify(f.value) })
    if (result.status !== 'candidate') throw new Error('candidate required')
    const read = { ...f.input, runId: result.summary.runId, requestKey: result.summary.requestKey }
    const epochKey = (await readProductRuntimeState(f.f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey!
    await finishTtrpgOpenSituationDraftV1({ ...f.input, epochKey })
    expect((await readInstanceAgentRunV1(f.f.scope, read.runId)).projection.state).toBe('cancelled')
    const summary = await readTtrpgOpenSituationCandidateSummaryV1(read)
    expect(summary?.stopped).toBe(true); expect(summary?.requiresExplicitAcceptance).toBe(false)
    expect(await recoverTtrpgOpenSituationCandidateV1(read)).toEqual(summary)
    await finishTtrpgOpenSituationDraftV1({ ...f.input, epochKey })
    expect(await readTtrpgOpenSituationStopRepairsV1(f.input)).toEqual([])
  })
  it('keeps the stop decision recoverable when terminal cancellation fails, and cleans a failed local preparation with no reservation', async () => {
    const f = await setupSituationGenerationV1(), result = await generateTtrpgOpenSituationCandidateV1({ ...f.request, runAI: async () => JSON.stringify(f.value) })
    if (result.status !== 'candidate') throw new Error('candidate required')
    const epochKey = (await readProductRuntimeState(f.f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey!
    const add = db.agentRunEvents.add.bind(db.agentRunEvents)
    db.agentRunEvents.add = async row => { if (row.type === 'run.cancelled') { db.agentRunEvents.add = add; throw new Error('fixture terminal stop interruption') }; return add(row) }
    await expect(finishTtrpgOpenSituationDraftV1({ ...f.input, epochKey })).rejects.toThrow(/interruption/)
    expect((await readProductRuntimeState(f.f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    expect(await readTtrpgOpenSituationStopRepairsV1(f.input)).toEqual([epochKey])
    await reconcileTtrpgOpenStoppedSituationV1({ ...f.input, epochKey })
    expect((await readInstanceAgentRunV1(f.f.scope, result.summary.runId)).projection.state).toBe('cancelled')
    const next = await setupSituationGenerationV1(), artifactAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
    db.agentRunArtifacts.add = async row => {
      if (row.content?.includes('"schema":"storyforge.ttrpg-open-situation-kernel-snapshot"')) { db.agentRunArtifacts.add = artifactAdd; throw new Error('fixture local snapshot interruption') }
      return artifactAdd(row)
    }
    let sends = 0
    await expect(generateTtrpgOpenSituationCandidateV1({ ...next.request, runAI: async () => { sends++; return JSON.stringify(next.value) } })).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    expect((await readProductRuntimeState(next.f.sessionId)).ttrpg!.openRun!.coordination.calls).toEqual([])
    const runs = await db.agentRuns.where('productRuntimeSessionId').equals(next.f.sessionId).toArray()
    expect(runs).toHaveLength(1); expect(runs[0].status).toBe('failed'); expect(sends).toBe(0)
  })
})
