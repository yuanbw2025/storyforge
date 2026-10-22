import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupOpenEntityModelV1 } from '../helpers/open-entity-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readTtrpgOpenEntityModelDeskV1, requestTtrpgOpenEntityModelDeskV1, resumeTtrpgOpenEntityModelDeskV1,
  acceptTtrpgOpenEntityModelDeskV1, repairTtrpgOpenEntityModelDeskV1, finishTtrpgOpenEntityModelDeskV1,
  closeTtrpgOpenEntityModelWindowDeskV1 } from '../../src/lib/ttrpg/open-entity-model-desk'
import { readTtrpgOpenEntityDeskV1, closeTtrpgOpenEntityDeskV1 } from '../../src/lib/ttrpg/open-entity-desk'
import { prepareTtrpgOpenEntityInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { deleteAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

async function setup(audience: 'party' | 'private' | 'gm-only' = 'party', configure?: Parameters<typeof setupOpenEntityModelV1>[1]) {
  const s = await setupOpenEntityModelV1(audience, configure)
  const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: s.viewerKey }
  const page = await readTtrpgOpenEntityModelDeskV1(input)
  if (!page) throw new Error('expected entity desk')
  const command = { ...input, expectedSequence: page.sequence, selection: s.selection, maximumCostUsd: 0.1,
    submissionKey: 'model.desk.request', decision: 'request-this-entity-draft' as const }
  const output = JSON.stringify({ proposals: [s.proposal] })
  return { ...s, input, page, command, output }
}
async function requested(audience: 'party' | 'private' | 'gm-only' = 'party') {
  const s = await setup(audience)
  const result = await requestTtrpgOpenEntityModelDeskV1({ ...s.command, runAI: async () => s.output })
  const read = { ...s.input, requestKey: result.requestKey }
  const page = await readTtrpgOpenEntityModelDeskV1(read)
  if (!page?.request?.candidate) throw new Error('expected exact desk candidate')
  return { ...s, read, candidate: page.request.candidate }
}
describe('R-TTRPGOPEN12 human entity model desk and exact original request lifecycle', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('reads authorized menus without creating a Run, consulting again or changing any state', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId), events = await db.productRuntimeEvents.count()
    expect(s.page.canRequest).toBe(true); expect(s.page.catalog.some(d => d.scope.audience === 'private')).toBe(true)
    expect(JSON.stringify(s.page)).not.toContain('ENTITY-MODEL-GM-TEMPLATE-CANARY')
    expect(JSON.stringify(s.page)).not.toContain('ENTITY-MODEL-NPC-SECRET-CANARY')
    expect(await readTtrpgOpenEntityModelDeskV1(s.input)).toEqual(s.page)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    expect(await db.productRuntimeEvents.count()).toBe(events); expect(await db.agentRuns.count()).toBe(0); expect(await db.agentRunArtifacts.count()).toBe(0)
  })
  it('requests once, projects only review text and saves a model plan only after separate explicit review', async () => {
    const s = await setup(), order: string[] = []
    const result = await requestTtrpgOpenEntityModelDeskV1({ ...s.command,
      onPrepared: async key => { order.push('prepared'); expect((await readTtrpgOpenEntityModelDeskV1({ ...s.input, requestKey: key }))?.request).toMatchObject({ local: true, status: 'prepared', canResume: true }) },
      runAI: async () => { order.push('sent'); return s.output } })
    expect(order).toEqual(['prepared', 'sent'])
    const read = { ...s.input, requestKey: result.requestKey }, page = await readTtrpgOpenEntityModelDeskV1(read), candidate = page!.request!.candidate!
    expect(page!.request).toMatchObject({ canAdopt: true, adopted: false, modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    expect(candidate.items[0]).toMatchObject({ kind: 'actor', name: s.proposal.name })
    for (const forbidden of ['frozenContentJson', 'runOriginJson', 'rawResponseHash', 'messages', 'ENTITY-MODEL-NPC-SECRET-CANARY']) expect(JSON.stringify(page)).not.toContain(forbidden)
    expect((await readTtrpgOpenEntityDeskV1(s.input))!.hasUnadoptedEntityModelRequest).toBe(true)
    await expect(closeTtrpgOpenEntityDeskV1({ ...s.input, submissionKey: 'do.not.leave.run.pending' })).rejects.toThrow(/原 AI 请求/)
    const before = await readProductRuntimeState(s.f.sessionId)
    await expect(acceptTtrpgOpenEntityModelDeskV1({ ...read, candidateHash: candidate.candidateHash, decision: 'not-reviewed' } as Parameters<typeof acceptTtrpgOpenEntityModelDeskV1>[0])).rejects.toThrow(/审阅/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    await acceptTtrpgOpenEntityModelDeskV1({ ...read, candidateHash: candidate.candidateHash, decision: 'reviewed-this-model-entity-candidate' })
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect((await readTtrpgOpenEntityDeskV1(s.input))!.pending).toMatchObject({ origin: 'model', approved: 0 })
    expect((await readTtrpgOpenEntityModelDeskV1(read))!.request).toMatchObject({ adopted: true, canAdopt: false, canRepairAdoption: false })
  })
  it('resumes an actual original unsent request, rejects another model, and never sends that request twice', async () => {
    const s = await setup(), prepared = await prepareTtrpgOpenEntityInputV1({ ...await openEnvelopeV1(s.f.sessionId, 'desk.original.prepare'), ...s.input,
      selection: s.selection, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 1000, maximumCostUsd: 0.1 })
    const read = { ...s.input, requestKey: prepared.requestKey }; let sends = 0
    await expect(resumeTtrpgOpenEntityModelDeskV1({ ...read, aiConfig: { provider: 'custom', model: 'changed-model', baseUrl: 'https://must-not-send.invalid', apiKey: '', maxTokens: 1000, contextWindow: 64000, temperature: 0.2 } })).rejects.toThrow(/模型配置/)
    expect((await readTtrpgOpenEntityModelDeskV1(read))!.request!.canResume).toBe(true)
    await resumeTtrpgOpenEntityModelDeskV1({ ...read, runAI: async () => { sends++; return s.output } })
    await expect(resumeTtrpgOpenEntityModelDeskV1({ ...read, runAI: async () => { sends++; return s.output } })).rejects.toThrow(/不能继续发送/)
    expect(sends).toBe(1); expect(await db.agentRuns.count()).toBe(1)
  })
  it('persists explicit stop before a late response, keeps unknown cost and closes only the original request window', async () => {
    const s = await setup(); let sent!: () => void, release!: () => void, key = '', sends = 0
    const started = new Promise<void>(r => { sent = r }), gate = new Promise<void>(r => { release = r })
    const work = requestTtrpgOpenEntityModelDeskV1({ ...s.command, onPrepared: requestKey => { key = requestKey }, runAI: async () => { sends++; sent(); await gate; return s.output } }).catch(error => error)
    await started; const read = { ...s.input, requestKey: key }
    await finishTtrpgOpenEntityModelDeskV1({ ...read, decision: 'discard-this-entity-request-and-close-window' })
    const stopped = await readProductRuntimeState(s.f.sessionId), call = stopped.ttrpg!.openRun!.coordination.calls[0]
    expect(call.status).toBe('unknown'); expect(call.usage).toMatchObject({ inputTokens: null, outputTokens: null, actualCostUsd: null })
    expect(stopped.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    release(); await work
    expect(sends).toBe(1); expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.coordination.calls[0]).toEqual(call)
    expect((await readTtrpgOpenEntityModelDeskV1(read))!.request).toMatchObject({ canResume: false, canAdopt: false, canFinish: false })
  })
  it('repairs original response, candidate, adoption and closed-window terminal cuts with no extra send', async () => {
    for (const cut of ['model.responded', 'candidate.persisted', 'confirmation.recorded', 'run.cancelled']) {
      if (cut !== 'model.responded') { await db.delete(); await db.open() }
      const s = await setup(), add = db.agentRunEvents.add.bind(db.agentRunEvents); let requestKey = '', sends = 0
      const spy = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(async (...args) => {
        if (args[0].type === cut) throw new Error('model desk cut ' + cut)
        return add(...args)
      })
      const work = requestTtrpgOpenEntityModelDeskV1({ ...s.command, onPrepared: key => { requestKey = key }, runAI: async () => { sends++; return s.output } })
      if (['model.responded', 'candidate.persisted'].includes(cut)) await expect(work).rejects.toThrow()
      else {
        await work; const read = { ...s.input, requestKey }, candidate = (await readTtrpgOpenEntityModelDeskV1(read))!.request!.candidate!
        if (cut === 'confirmation.recorded') await expect(acceptTtrpgOpenEntityModelDeskV1({ ...read, candidateHash: candidate.candidateHash, decision: 'reviewed-this-model-entity-candidate' })).rejects.toThrow(/待确认计划已保存/)
        else await expect(finishTtrpgOpenEntityModelDeskV1({ ...read, decision: 'discard-this-entity-request-and-close-window' })).rejects.toThrow('model desk cut ' + cut)
      }
      spy.mockRestore(); const read = { ...s.input, requestKey }
      await repairTtrpgOpenEntityModelDeskV1(read)
      const page = await readTtrpgOpenEntityModelDeskV1(read)
      expect(page!.request!.canRepairResponse || page!.request!.canRepairAdoption || page!.request!.canRepairStop).toBe(false)
      expect(sends).toBe(1); expect(await db.agentRuns.count()).toBe(1)
    }
  })
  it('keeps imported/deleted originals as metadata and never creates replacement permissions', async () => {
    const s = await requested('private'), projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId))
    const session = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    const input = { ...s.read, scope: { projectId, worldId: session!.worldId!, workId: session!.workId! }, sessionId: session!.id! }
    expect((await readTtrpgOpenEntityModelDeskV1(input))!.request).toMatchObject({ local: false, candidate: null, canResume: false, canAdopt: false })
    await expect(resumeTtrpgOpenEntityModelDeskV1({ ...input, runAI: async () => s.output })).rejects.toThrow(/历史查阅/)
    const run = await db.agentRuns.where('productRuntimeSessionId').equals(s.f.sessionId).first()
    await deleteAgentRunV1(s.f.scope, run!.id!)
    expect((await readTtrpgOpenEntityModelDeskV1(s.read))!.request).toMatchObject({ local: false, candidate: null })
    expect(await db.agentRuns.where('productRuntimeSessionId').equals(s.f.sessionId).count()).toBe(0)
  })
  it('closes the actual window and reconciles all unused drafts even when its last completed response lost its local Run', async () => {
    const s = await setup(), first = await requestTtrpgOpenEntityModelDeskV1({ ...s.command, runAI: async () => JSON.stringify({ proposals: [] }) })
    const next = await readTtrpgOpenEntityModelDeskV1(s.input)
    const second = await requestTtrpgOpenEntityModelDeskV1({ ...s.command, expectedSequence: next!.sequence,
      submissionKey: 'model.desk.second.empty', runAI: async () => JSON.stringify({ proposals: [] }) })
    const rows = await db.agentRuns.where('productRuntimeSessionId').equals(s.f.sessionId).toArray()
    await deleteAgentRunV1(s.f.scope, rows[1].id!)
    const page = await readTtrpgOpenEntityModelDeskV1({ ...s.input, requestKey: second.requestKey }), before = await readProductRuntimeState(s.f.sessionId)
    expect(page!.request).toMatchObject({ local: false, canFinish: false }); expect(page!.closeWindowEpochKey).toBeTruthy()
    const close = { ...s.input, epochKey: page!.closeWindowEpochKey!, decision: 'close-this-consultation-and-discard-unused-ai-drafts' as const }
    await expect(closeTtrpgOpenEntityModelWindowDeskV1({ ...close, decision: 'not-confirmed' } as typeof close)).rejects.toThrow(/明确/)
    await closeTtrpgOpenEntityModelWindowDeskV1(close)
    const after = await readProductRuntimeState(s.f.sessionId), { readInstanceAgentRunV1 } = await import('../../src/lib/agent/run/event-store')
    expect(after.ttrpg!.openRun!.coordination.activeEpochKey).toBeNull()
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.coordination.calls).toEqual(before.ttrpg!.openRun!.coordination.calls)
    expect((await readInstanceAgentRunV1(s.f.scope, rows[0].id!)).projection.state).toBe('cancelled')
    expect(await db.agentRuns.count()).toBe(1)
    expect((await readTtrpgOpenEntityModelDeskV1({ ...s.input, requestKey: first.requestKey }))!.request).toMatchObject({ canRepairStop: false, canAdopt: false })
  })
  it('rejects stale menus, missing explicit request decisions, excess cost and another actual human before preparing any Run', async () => {
    const s = await setup('private', pkg => { pkg.ttrpg!.campaign.characterTemplates.find(c => c.characterKey === 'companion.1')!.controller = 'hybrid' })
    const before = await readProductRuntimeState(s.f.sessionId), runAI = vi.fn(async () => s.output)
    for (const change of [{ expectedSequence: s.page.sequence - 1 }, { maximumCostUsd: 1000 }, { decision: 'not-confirmed' }, { viewerKey: 'viewer.seat.companion.1' }]) {
      await expect(requestTtrpgOpenEntityModelDeskV1({ ...s.command, ...change, runAI } as Parameters<typeof requestTtrpgOpenEntityModelDeskV1>[0])).rejects.toThrow()
    }
    expect(runAI).not.toHaveBeenCalled(); expect(await db.agentRuns.count()).toBe(0); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
  })
})
