import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOpenEntityModelV1 } from '../helpers/open-entity-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { prepareTtrpgOpenEntityInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { executeTtrpgOpenEntityRequestV1, recoverTtrpgOpenRuntimeCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readTtrpgOpenEntityCandidateV1 } from '../../src/lib/ttrpg/open-entity-candidate'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { cancelTtrpgOpenPreparedRequestV1 } from '../../src/lib/ttrpg/open-request-cancellation'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { listTtrpgOpenHistoricalResponsesV1 } from '../../src/lib/ttrpg/open-imported-response'
import { finishTtrpgOpenEntityDraftV1, reconcileTtrpgOpenStoppedEntityV1 } from '../../src/lib/ttrpg/open-entity-stop'
import { repairTtrpgOpenEntityResponseReceiptV1, abandonTtrpgOpenEntityWaitV1 } from '../../src/lib/ttrpg/open-situation-request-recovery'

async function setup(modelIdentity = { provider: 'test-adapter', model: 'injected' }) {
  const s = await setupOpenEntityModelV1()
  const prepared = await prepareTtrpgOpenEntityInputV1({ ...await openEnvelopeV1(s.f.sessionId, 'entity.harness.prepare'), scope: s.f.scope,
    viewerKey: s.viewerKey, selection: s.selection, modelIdentity, maximumOutputTokens: 1000, maximumCostUsd: 0.2 })
  const read = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: s.viewerKey, runId: prepared.runId, requestKey: prepared.requestKey }
  return { ...s, prepared, read, output: JSON.stringify({ proposals: [s.proposal] }) }
}
describe('R-TTRPGOPEN12 model entity transport, candidate and no creation authority', { timeout: 90000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
  it('uses the actual formal entry/client with exact HTTP messages and no private prompt layer', async () => {
    const s = await setup({ provider: 'custom', model: 'entity-wire-test-model' })
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://entity-wire.example.invalid/v1/chat/completions')
      const body = JSON.parse(String(init?.body)); expect(body.messages).toEqual(s.prepared.messages)
      expect(body.max_tokens).toBe(1000); expect(body.stream).toBe(false); expect(body).not.toHaveProperty('tools')
      expect(JSON.stringify(body)).not.toContain('ENTITY-MODEL-'); expect(JSON.stringify(body)).not.toContain('明确咨询并审查可实例化对象')
      return new Response(JSON.stringify({ choices: [{ message: { content: s.output } }], usage: { prompt_tokens: 200, completion_tokens: 100 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetch)
    const result = await executeTtrpgOpenEntityRequestV1({ ...s.read, aiConfig: { provider: 'custom', model: 'entity-wire-test-model',
      apiKey: '', baseUrl: 'https://entity-wire.example.invalid/v1', maxTokens: 9999, temperature: 0.2, contextWindow: 64000 } })
    expect(result.status === 'candidate' && result.candidate.artifact.status).toBe('usable-with-warnings')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('persists raw bytes and a typed candidate, survives refresh, and never changes entity/mechanical/world owners', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId); let sends = 0
    const result = await executeTtrpgOpenEntityRequestV1({ ...s.read, runAI: async () => { sends++; return s.output } })
    if (result.status !== 'candidate') throw new Error('expected candidate')
    expect(result.candidate.proposals).toEqual([s.proposal]); expect(result.candidate.selection).toEqual(s.selection)
    expect(result.candidate.artifact.status).toBe('usable-with-warnings')
    expect(await readAgentRunArtifactExactV1({ projectId: s.f.scope.projectId, artifactKind: 'raw-response', contentHash: result.candidate.rawResponseHash })).toBe(s.output)
    db.close(); await db.open()
    expect(await readTtrpgOpenEntityCandidateV1(s.read)).toEqual(result.candidate)
    expect(await recoverTtrpgOpenRuntimeCandidateV1(s.read)).toEqual(result.candidate)
    expect(await executeTtrpgOpenEntityRequestV1({ ...s.read, runAI: async () => { sends++; return '{}' } })).toEqual({ status: 'not-sent' })
    expect(sends).toBe(1); expect(await db.agentRuns.count()).toBe(1)
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.inventory).toEqual(before.inventory)
    expect(after.ttrpg!.product).toEqual(before.ttrpg!.product); expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(after.ttrpg!.openRun!.entityOperations ?? []).toEqual([])
    const run = await readInstanceAgentRunV1(s.f.scope, s.prepared.runId)
    expect(run.events.filter(e => e.type === 'candidate.persisted')).toHaveLength(1)
    expect(run.projection.state).not.toBe('completed')
  })
  it('blocks fabricated IDs, parameters, unselected templates and placements while retaining each raw answer', async () => {
    const invalid = [
      { entityKey: 'invented.entity' }, { parameters: { mood: 'invented' } }, { templateKey: 'dynamic.location' }, { locationRef: 'hidden.location' },
    ]
    for (let index = 0; index < invalid.length; index++) {
      if (index) { await db.delete(); await db.open() }
      const s = await setup(), output = JSON.stringify({ proposals: [{ ...s.proposal, ...invalid[index] }] })
      const result = await executeTtrpgOpenEntityRequestV1({ ...s.read, runAI: async () => output })
      if (result.status !== 'candidate') throw new Error('expected candidate')
      expect(result.candidate.artifact.status).toBe('blocked'); expect(result.candidate.proposals).toBeNull()
      expect(result.candidate.artifact.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ttrpg-entity-protocol', disposition: 'blocking' })]))
      expect(await readAgentRunArtifactExactV1({ projectId: s.f.scope.projectId, artifactKind: 'raw-response', contentHash: result.candidate.rawResponseHash })).toBe(output)
      expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.entityOperations ?? []).toEqual([])
    }
  })
  it('recovers an interrupted candidate receipt locally without a second model attempt', async () => {
    const s = await setup(), add = db.agentRunEvents.add.bind(db.agentRunEvents); let sends = 0
    vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === 'candidate.persisted') throw new Error('entity candidate receipt interrupted')
      return add(...args)
    })
    await expect(executeTtrpgOpenEntityRequestV1({ ...s.read, runAI: async () => { sends++; return s.output } })).rejects.toThrow('entity candidate receipt interrupted')
    vi.restoreAllMocks()
    const a = await recoverTtrpgOpenRuntimeCandidateV1(s.read), b = await recoverTtrpgOpenRuntimeCandidateV1(s.read)
    expect(a?.artifact.status).toBe('usable-with-warnings'); expect(b).toEqual(a); expect(sends).toBe(1)
    expect((await readInstanceAgentRunV1(s.f.scope, s.prepared.runId)).events.filter(e => e.type === 'candidate.persisted')).toHaveLength(1)
  })
  it('rejects another viewer and retains explicit unsent cancellation without dispatch', async () => {
    const s = await setup(); let sends = 0
    await expect(executeTtrpgOpenEntityRequestV1({ ...s.read, viewerKey: 'viewer.other', runAI: async () => { sends++; return s.output } })).rejects.toThrow()
    await cancelTtrpgOpenPreparedRequestV1(s.read)
    expect(await executeTtrpgOpenEntityRequestV1({ ...s.read, runAI: async () => { sends++; return s.output } })).toEqual({ status: 'not-sent' })
    expect(sends).toBe(0); expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.calls[0].terminalReason).toBe('cancelled-before-dispatch')
  })
  it('records unknown external results and never silently resends or invents a candidate', async () => {
    const s = await setup(); let sends = 0
    await expect(executeTtrpgOpenEntityRequestV1({ ...s.read, runAI: async () => { sends++; throw new Error('external outcome unknown') } })).rejects.toThrow()
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.calls[0].status).toBe('unknown')
    expect(await recoverTtrpgOpenRuntimeCandidateV1(s.read)).toBeNull()
    expect(await executeTtrpgOpenEntityRequestV1({ ...s.read, runAI: async () => { sends++; return s.output } })).toEqual({ status: 'not-sent' })
    expect(sends).toBe(1)
  })
  it('keeps original evidence on full backup import without granting execution or an older raw-history bypass', async () => {
    const s = await setup()
    await executeTtrpgOpenEntityRequestV1({ ...s.read, runAI: async () => s.output })
    const backup = await exportProjectJSON(s.f.scope.projectId), projectId = await importProjectJSON(backup), scope = await resolveScope({ projectId })
    const session = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    const run = await db.agentRuns.where('productRuntimeSessionId').equals(session!.id!).first()
    const read = { ...s.read, scope, sessionId: session!.id!, runId: run!.id! }
    expect(run!.portableRuntimeOriginJson).toBeTruthy()
    await expect(executeTtrpgOpenEntityRequestV1({ ...read, runAI: async () => { throw new Error('must not send') } })).rejects.toThrow(/导入|历史|本地/)
    await expect(recoverTtrpgOpenRuntimeCandidateV1(read)).rejects.toThrow(/导入|历史/)
    expect(await listTtrpgOpenHistoricalResponsesV1(read)).toEqual([])
  })
  it('repairs the original response at raw/response/terminal cuts without requesting replacement bytes', async () => {
    for (const cut of ['model.responded', 'terminal', 'candidate.persisted']) {
      if (cut !== 'model.responded') { await db.delete(); await db.open() }
      const s = await setup(), add = db.agentRunEvents.add.bind(db.agentRunEvents), eventAdd = db.productRuntimeEvents.add.bind(db.productRuntimeEvents)
      let sends = 0
      if (cut === 'terminal') vi.spyOn(db.productRuntimeEvents, 'add').mockImplementation(async (...args) => {
        if (args[0].type === 'ttrpg.open.call.finished') throw new Error('entity original terminal interrupted')
        return eventAdd(...args)
      })
      else vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
        if (args[0].type === cut) throw new Error('entity original evidence interrupted')
        return add(...args)
      })
      await expect(executeTtrpgOpenEntityRequestV1({ ...s.read, runAI: async () => { sends++; return s.output } })).rejects.toThrow(/interrupted/)
      vi.restoreAllMocks()
      const a = await repairTtrpgOpenEntityResponseReceiptV1(s.read), b = await repairTtrpgOpenEntityResponseReceiptV1(s.read)
      expect(a?.artifact.status).toBe('usable-with-warnings'); expect(b).toEqual(a); expect(sends).toBe(1)
      const run = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!
      expect(run.coordination.calls).toHaveLength(1); expect(run.coordination.calls[0].status).toBe('succeeded')
      expect(run.entityOperations ?? []).toEqual([])
      expect(await readAgentRunArtifactExactV1({ projectId: s.f.scope.projectId, artifactKind: 'raw-response', contentHash: a!.rawResponseHash })).toBe(s.output)
    }
  })
  it('saves the explicit window close before Run cleanup and resumes only that local cleanup', async () => {
    const s = await setup()
    await executeTtrpgOpenEntityRequestV1({ ...s.read, runAI: async () => s.output })
    const add = db.agentRunEvents.add.bind(db.agentRunEvents)
    vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
      if (args[0].type === 'run.cancelled') throw new Error('entity cleanup interrupted')
      return add(...args)
    })
    await expect(finishTtrpgOpenEntityDraftV1({ ...s.read, decision: 'discard-this-entity-request-and-close-window' })).rejects.toThrow('entity cleanup interrupted')
    vi.restoreAllMocks()
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    await reconcileTtrpgOpenStoppedEntityV1(s.read)
    await finishTtrpgOpenEntityDraftV1({ ...s.read, decision: 'discard-this-entity-request-and-close-window' })
    expect((await readInstanceAgentRunV1(s.f.scope, s.prepared.runId)).projection.state).toBe('cancelled')
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.entityOperations ?? []).toEqual([])
  })
  it('preserves an explicitly unknown terminal and closed window when the original transport returns late', async () => {
    const s = await setup(); let release!: (value: string) => void
    const held = new Promise<string>(resolve => { release = resolve }), runAI = vi.fn(async () => held)
    const pending = executeTtrpgOpenEntityRequestV1({ ...s.read, runAI }).then(() => 'returned', () => 'stopped')
    await vi.waitFor(() => expect(runAI).toHaveBeenCalledTimes(1), { timeout: 30000 })
    await abandonTtrpgOpenEntityWaitV1({ ...s.read, decision: 'abandon-wait-as-unknown' })
    release(s.output); expect(await pending).toBe('stopped')
    const run = (await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!
    expect(run.coordination.calls).toHaveLength(1); expect(run.coordination.calls[0]).toMatchObject({ status: 'unknown', usage: { inputTokens: null, outputTokens: null, actualCostUsd: null } })
    expect(run.coordination.activeEpochKey).toBeNull(); expect(run.entityOperations ?? []).toEqual([])
    expect(runAI).toHaveBeenCalledTimes(1)
  })
})
