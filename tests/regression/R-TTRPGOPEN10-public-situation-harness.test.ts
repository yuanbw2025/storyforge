import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { createTtrpgOpenPublicSituationAuthorizationV1 } from '../../src/lib/ttrpg/open-public-situation-authorization'
import { prepareTtrpgOpenPublicSituationInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { generateTtrpgOpenPublicSituationCandidateV1, executeTtrpgOpenPublicSituationRequestV1, recoverTtrpgOpenPublicSituationCandidateV1,
  executeTtrpgOpenSituationRequestV1, recoverTtrpgOpenRuntimeCandidateV1, TtrpgOpenSituationRequestError } from '../../src/lib/ttrpg/open-intent-harness'
import { readTtrpgOpenPublicSituationCandidateV1 } from '../../src/lib/ttrpg/open-public-situation-candidate'
import { readTtrpgOpenRuntimeCandidateForKernelV1 } from '../../src/lib/ttrpg/open-runtime-candidate'
import { readProductRuntimeState, branchProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1, deleteAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { publicSituationOutputV1 } from '../helpers/open-public-situation-generation'
import type { TtrpgOpenPublicSituationKernelV1 } from '../../src/lib/ttrpg/open-public-situation-kernel'
import { changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { finishTtrpgOpenPublicSituationDraftV1, reconcileTtrpgOpenStoppedPublicSituationV1, readTtrpgOpenPublicSituationStopRepairsV1 } from '../../src/lib/ttrpg/open-public-situation-stop'
import { repairTtrpgOpenPublicSituationResponseReceiptV1, abandonTtrpgOpenPublicSituationWaitV1 } from '../../src/lib/ttrpg/open-situation-request-recovery'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { readTtrpgOpenRunOriginV1 } from '../../src/lib/ttrpg/open-run-portability'
import { listTtrpgOpenHistoricalResponsesV1 } from '../../src/lib/ttrpg/open-imported-response'

async function setup(modelIdentity = { provider: 'test-adapter', model: 'injected' }) {
  const f = await readyOpenTtrpgSessionV1('Public original Harness', pkg => {
    const c = pkg.ttrpg!.campaign; c.runtimePolicy.enabled = true; c.runtimePolicy.maximumEpochTokens = 50000; c.runtimePolicy.maximumOutputTokens = 8000
    c.fronts[0].goal = 'PRIVATE-HARNESS-FRONT'; c.characterTemplates.find(row => row.role === 'npc')!.gmProfile!.secret = 'PRIVATE-HARNESS-GM'
    c.characterTemplates.find(row => row.characterKey === 'hero')!.playerProfile!.secret = 'PRIVATE-HARNESS-PLAYER'
    c.situationTemplates[0].evidence[0].description = 'PRIVATE-HARNESS-UNDISCOVERED'
  })
  const auth = await createTtrpgOpenPublicSituationAuthorizationV1({ ...await openEnvelopeV1(f.sessionId, 'public.harness.authorize'),
    scope: f.scope, viewerKey: OPEN_HUMAN_VIEWER, rawInput: '  根据共同资料拟定一次新局势 e\u0301。\n', sharingDecision: 'share-this-request-with-current-party',
    delegationDecision: 'draft-only', modelIdentity, maximumOutputTokens: 4000, maximumCostUsd: 0.1 })
  const read = { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER, runId: auth.runId, requestKey: auth.requestKey }
  const prepared = await prepareTtrpgOpenPublicSituationInputV1(read)
  const kernel = JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'source-snapshot',
    contentHash: prepared.evidence.publicKernelHash! })) as TtrpgOpenPublicSituationKernelV1
  return { f, read, prepared, kernel, output: JSON.stringify(publicSituationOutputV1(kernel)) }
}
describe('R-TTRPGOPEN10 original public request transport and recoverable candidate', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
  it('uses the actual formal entry and chat client, proving the complete HTTP message body has no private prompt layer', async () => {
    const { read, prepared, output } = await setup({ provider: 'custom', model: 'public-wire-engineering-model' })
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://public-wire.example.invalid/v1/chat/completions')
      const body = JSON.parse(String(init?.body))
      expect(body.messages).toEqual(prepared.messages); expect(body.max_tokens).toBe(4000); expect(body.stream).toBe(false)
      expect(JSON.stringify(body)).not.toContain('PRIVATE-HARNESS-'); expect(body).not.toHaveProperty('tools')
      return new Response(JSON.stringify({ choices: [{ message: { content: output } }], usage: { prompt_tokens: 200, completion_tokens: 1000, total_tokens: 1200 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetch)
    const result = await executeTtrpgOpenPublicSituationRequestV1({ ...read, aiConfig: { provider: 'custom', model: 'public-wire-engineering-model',
      apiKey: '', baseUrl: 'https://public-wire.example.invalid/v1', maxTokens: 9999, temperature: 0.2, contextWindow: 64000 } })
    expect(result.status === 'candidate' && result.summary.status).toBe('usable-with-warnings'); expect(fetch).toHaveBeenCalledTimes(1)
    const run = await readInstanceAgentRunV1(read.scope, read.runId)
    expect(run.contract.executionBindings?.[0].formalEntry?.entryId).toBe('ttrpg.open.public-situation-propose')
  })
  it('sends the exact common packet once, preserves raw bytes and refreshes the same candidate without granting a player GM read', async () => {
    const { f, read, prepared, output } = await setup(), before = await readProductRuntimeState(f.sessionId)
    let sends = 0
    const result = await generateTtrpgOpenPublicSituationCandidateV1({ ...read, runAI: async messages => {
      sends++; expect(messages).toEqual(prepared.messages); expect(JSON.stringify(messages)).not.toContain('PRIVATE-HARNESS-'); return output } })
    if (result.status !== 'candidate') throw new Error('expected candidate')
    expect(result.summary.status).toBe('usable-with-warnings'); expect(JSON.stringify(result)).not.toMatch(/PRIVATE-|共同调查|originalText|prepared|references/)
    const candidate = await readTtrpgOpenRuntimeCandidateForKernelV1(read, 'public-situation-proposal')
    expect(candidate?.schema).toBe('storyforge.ttrpg-open-public-situation-candidate')
    expect(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: candidate!.rawResponseHash })).toBe(output)
    await expect(readTtrpgOpenPublicSituationCandidateV1(read)).rejects.toThrow(/真人 GM/)
    await expect(recoverTtrpgOpenRuntimeCandidateV1(read)).rejects.toThrow(/真人 GM/)
    db.close(); await db.open()
    expect(await recoverTtrpgOpenPublicSituationCandidateV1(read)).toEqual(result.summary)
    expect(await executeTtrpgOpenPublicSituationRequestV1({ ...read, runAI: async () => { sends++; return output } })).toEqual({ status: 'not-sent' })
    expect(sends).toBe(1); expect(await db.agentRuns.count()).toBe(1)
    const after = await readProductRuntimeState(f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.product).toEqual(before.ttrpg!.product)
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(after.ttrpg!.openRun!.situationReceipts ?? []).toEqual([]); expect(after.ttrpg!.openRun!.situations).toEqual(before.ttrpg!.openRun!.situations)
  })
  it('recovers a cut after the exact candidate artifact without creating another body or transport attempt', async () => {
    const { read, output } = await setup(), add = db.agentRunEvents.add.bind(db.agentRunEvents)
    vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === 'candidate.persisted') throw new Error('candidate receipt interrupted')
      return add(...args)
    })
    let sends = 0
    await expect(executeTtrpgOpenPublicSituationRequestV1({ ...read, runAI: async () => { sends++; return output } })).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    vi.restoreAllMocks()
    const first = await recoverTtrpgOpenPublicSituationCandidateV1(read), second = await recoverTtrpgOpenPublicSituationCandidateV1(read)
    expect(first?.status).toBe('usable-with-warnings'); expect(second).toEqual(first); expect(sends).toBe(1)
    const snapshot = await readInstanceAgentRunV1(read.scope, read.runId)
    expect(snapshot.events.filter(row => row.type === 'candidate.persisted')).toHaveLength(1)
  })
  it('rejects the private executor, another viewer, and a safety change before dispatch without any transport', async () => {
    const { f, read, output } = await setup(); let sends = 0
    const runAI = async () => { sends++; return output }
    await expect(executeTtrpgOpenSituationRequestV1({ ...read, runAI })).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    await expect(executeTtrpgOpenPublicSituationRequestV1({ ...read, viewerKey: 'viewer.other', runAI })).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(f.sessionId, 'public.harness.pause'), viewerKey: OPEN_HUMAN_VIEWER, changedBy: 'hero', status: 'paused', reason: '暂停' })
    await expect(executeTtrpgOpenPublicSituationRequestV1({ ...read, runAI })).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    expect(sends).toBe(0)
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.calls[0].status).toBe('prepared')
  })
  it('retains a malformed raw answer as blocked and cannot hide a second paid request behind repair', async () => {
    const { read } = await setup(); let sends = 0
    const result = await executeTtrpgOpenPublicSituationRequestV1({ ...read, runAI: async () => { sends++; return '{"PRIVATE-MALFORMED' } })
    expect(result.status === 'candidate' && result.summary.status).toBe('blocked')
    const candidate = await readTtrpgOpenRuntimeCandidateForKernelV1(read, 'public-situation-proposal')
    expect(candidate?.artifact.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ttrpg-public-situation-protocol' })]))
    await recoverTtrpgOpenPublicSituationCandidateV1(read)
    expect((await executeTtrpgOpenPublicSituationRequestV1({ ...read, runAI: async () => { sends++; return '{}' } })).status).toBe('not-sent')
    expect(sends).toBe(1)
  })
  it.each(['raw-before-model-event', 'model-event-before-domain-receipt'] as const)('repairs the original %s without sending again or replacing its Run', async cut => {
    const { read, output } = await setup(); let sends = 0
    if (cut === 'raw-before-model-event') {
      const add = db.agentRunEvents.add.bind(db.agentRunEvents)
      vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
        if (args[0].type === 'model.responded') throw new Error('original model receipt interrupted')
        return add(...args)
      })
    } else {
      const add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
      vi.spyOn(db.productRuntimeEvents, 'add').mockImplementation(async (...args) => {
        if (args[0].type === 'ttrpg.open.call.finished') throw new Error('original domain receipt interrupted')
        return add(...args)
      })
    }
    await expect(executeTtrpgOpenPublicSituationRequestV1({ ...read, runAI: async () => { sends++; return output } })).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    vi.restoreAllMocks()
    expect((await repairTtrpgOpenPublicSituationResponseReceiptV1(read))?.status).toBe('usable-with-warnings')
    expect((await repairTtrpgOpenPublicSituationResponseReceiptV1(read))?.status).toBe('usable-with-warnings')
    expect(sends).toBe(1); expect(await db.agentRuns.count()).toBe(1)
    const call = (await readProductRuntimeState(read.sessionId)).ttrpg!.openRun!.coordination.calls[0]
    expect(call.status).toBe('succeeded'); expect(call.usage?.actualCostUsd).toBeNull()
  })
  it('persists explicit close before terminal cleanup and repairs the same stop after an interruption', async () => {
    const { read, output } = await setup()
    await executeTtrpgOpenPublicSituationRequestV1({ ...read, runAI: async () => output })
    const epochKey = (await readProductRuntimeState(read.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey!
    const add = db.agentRunEvents.add.bind(db.agentRunEvents)
    vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === 'run.cancelled') throw new Error('public terminal cleanup interrupted')
      return add(...args)
    })
    await expect(finishTtrpgOpenPublicSituationDraftV1({ ...read, epochKey })).rejects.toThrow(/cleanup interrupted/)
    vi.restoreAllMocks()
    expect((await readProductRuntimeState(read.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    expect(await readTtrpgOpenPublicSituationStopRepairsV1(read)).toEqual([epochKey])
    await reconcileTtrpgOpenStoppedPublicSituationV1({ ...read, epochKey })
    expect(await readTtrpgOpenPublicSituationStopRepairsV1(read)).toEqual([])
    expect((await recoverTtrpgOpenPublicSituationCandidateV1(read))?.requiresExplicitAcceptance).toBe(false)
    expect((await readInstanceAgentRunV1(read.scope, read.runId)).projection.state).toBe('cancelled')
    await finishTtrpgOpenPublicSituationDraftV1({ ...read, epochKey })
  })
  it('ends waiting with unknown usage and keeps that terminal when the original executor returns late', async () => {
    const { read, output } = await setup(); let release!: (value: string) => void
    const held = new Promise<string>(resolve => { release = resolve }), runAI = vi.fn(async () => held)
    const pending = executeTtrpgOpenPublicSituationRequestV1({ ...read, runAI }).then(() => 'returned', () => 'stopped')
    await vi.waitFor(() => expect(runAI).toHaveBeenCalledTimes(1), { timeout: 30000 })
    await abandonTtrpgOpenPublicSituationWaitV1({ ...read, decision: 'abandon-wait-as-unknown' })
    release(output); expect(await pending).toBe('stopped')
    const run = (await readProductRuntimeState(read.sessionId)).ttrpg!.openRun!
    expect(run.coordination.calls).toHaveLength(1)
    expect(run.coordination.calls[0]).toMatchObject({ status: 'unknown', usage: { inputTokens: null, outputTokens: null, actualCostUsd: null } })
    expect(run.coordination.activeEpochKey).toBeNull(); expect(run.situationReceipts ?? []).toEqual([])
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('cancels an unsent original reservation without refunding its counted slot or creating a replacement', async () => {
    const { read } = await setup()
    const epochKey = (await readProductRuntimeState(read.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey!
    await finishTtrpgOpenPublicSituationDraftV1({ ...read, epochKey })
    const run = (await readProductRuntimeState(read.sessionId)).ttrpg!.openRun!
    expect(run.coordination.calls).toHaveLength(1)
    expect(run.coordination.calls[0]).toMatchObject({ status: 'failed', terminalReason: 'cancelled-before-dispatch', dispatchRef: null,
      usage: { inputTokens: 0, outputTokens: 0, actualCostUsd: 0 } })
    expect((await readInstanceAgentRunV1(read.scope, read.runId)).projection.state).toBe('cancelled')
    expect(await db.agentRuns.count()).toBe(1)
  })
  it('archives a generated answer through complete import without restoring candidate authority or exposing fallback raw output', async () => {
    const { read, output } = await setup()
    await executeTtrpgOpenPublicSituationRequestV1({ ...read, runAI: async () => output })
    const projectId = await importProjectJSON(await exportProjectJSON(read.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId, workId: session.workId } })
    const run = (await db.agentRuns.where('productRuntimeSessionId').equals(session.id!).toArray())[0]
    const imported = { ...read, scope, sessionId: session.id!, runId: run.id! }
    const origin = await readTtrpgOpenRunOriginV1(run.id!, 'archive')
    // A verified actual call keeps the established V1 forensic proof. V2 is only for
    // preparations without such a call; neither format confers new execution authority.
    expect(origin?.version).toBe(1); expect(origin?.events.filter(row => row.type === 'model.requested')).toHaveLength(1)
    expect(await listTtrpgOpenHistoricalResponsesV1(imported)).toEqual([])
    await expect(recoverTtrpgOpenPublicSituationCandidateV1(imported)).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    let sends = 0
    const disposition = await executeTtrpgOpenPublicSituationRequestV1({ ...imported, runAI: async () => { sends++; return output } }).then(value => value.status, () => 'rejected')
    expect(['not-sent', 'rejected']).toContain(disposition); expect(sends).toBe(0)
  })
  it('does not carry an unadopted candidate or an active request into a child branch', async () => {
    const { read, output } = await setup()
    await executeTtrpgOpenPublicSituationRequestV1({ ...read, runAI: async () => output })
    const current = await readProductRuntimeState(read.sessionId)
    const child = await branchProductRuntimeSession({ parentSessionId: read.sessionId, throughSequence: current.lastSequence, title: 'No inherited public candidate' })
    const childState = await readProductRuntimeState(child.id!)
    expect(childState.ttrpg!.openRun!.coordination.calls).toEqual([]); expect(childState.ttrpg!.openRun!.coordination.epochs).toEqual([])
    expect(childState.ttrpg!.openRun!.situationReceipts ?? []).toEqual([])
    await expect(recoverTtrpgOpenPublicSituationCandidateV1({ ...read, sessionId: child.id! })).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    expect(await db.agentRuns.where('productRuntimeSessionId').equals(child.id!).count()).toBe(0)
  })
  it('closes an imported proven-unsent reservation through forensic cancellation without restoring dispatch', async () => {
    const { read } = await setup(), projectId = await importProjectJSON(await exportProjectJSON(read.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId, workId: session.workId } })
    const run = (await db.agentRuns.where('productRuntimeSessionId').equals(session.id!).toArray())[0]
    const imported = { ...read, scope, sessionId: session.id!, runId: run.id! }
    await expect(prepareTtrpgOpenPublicSituationInputV1(imported)).rejects.toThrow()
    let sends = 0
    await expect(executeTtrpgOpenPublicSituationRequestV1({ ...imported, runAI: async () => { sends++; return '{}' } })).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    const epochKey = (await readProductRuntimeState(imported.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey!
    await finishTtrpgOpenPublicSituationDraftV1({ ...imported, epochKey })
    const state = await readProductRuntimeState(imported.sessionId)
    expect(state.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    expect(state.ttrpg!.openRun!.coordination.calls[0]).toMatchObject({ status: 'failed', dispatchRef: null, terminalReason: 'cancelled-before-dispatch',
      usage: { inputTokens: 0, outputTokens: 0, actualCostUsd: 0 } })
    expect(sends).toBe(0); expect(await db.agentRuns.where('productRuntimeSessionId').equals(imported.sessionId).count()).toBe(1)
  })
  it('does not recreate a deleted original Run from its epoch grant and still permits explicit window close', async () => {
    const { read, output } = await setup()
    await executeTtrpgOpenPublicSituationRequestV1({ ...read, runAI: async () => output })
    const epochKey = (await readProductRuntimeState(read.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey!
    await deleteAgentRunV1(read.scope, read.runId)
    await expect(prepareTtrpgOpenPublicSituationInputV1(read)).rejects.toThrow()
    await expect(recoverTtrpgOpenPublicSituationCandidateV1(read)).rejects.toBeInstanceOf(TtrpgOpenSituationRequestError)
    await finishTtrpgOpenPublicSituationDraftV1({ ...read, epochKey })
    expect((await readProductRuntimeState(read.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    expect(await db.agentRuns.count()).toBe(0)
  })
})
