import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedTtrpgOpenBriefDeskV1 } from '../helpers/open-ttrpg-brief-desk'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { readTtrpgOpenBriefDeskV1, requestTtrpgOpenBriefDeskV1, resumeTtrpgOpenBriefDeskV1, confirmTtrpgOpenBriefDeskV1,
  rejectTtrpgOpenBriefDeskV1, finishTtrpgOpenBriefDeskV1, cancelTtrpgOpenBriefDeskPreparedV1 } from '../../src/lib/ttrpg/open-brief-service'
import { startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { prepareTtrpgOpenBriefInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { validateRegistry } from '../../src/lib/registry/validate'

const rawInput = '回顾旧港，保留原观察者与推测。'
const output = JSON.stringify({ paragraphs: [{ text: '英雄仍在怀疑旧港船只的问题。', sourceKeys: ['memory.brief-desk.shared'] }] })
const request = { submissionKey: 'desk-request', rawInput, maximumCostUsd: 0.1, runAI: async () => output }
describe('R-TTRPGOPEN8 explicit human recap desk', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('reads without creating Runs or granting another human a host panel; the human GM uses their own identity', async () => {
    expect(() => validateRegistry()).not.toThrow()
    const { host, other } = await seedTtrpgOpenBriefDeskV1(true), before = await db.agentRunEvents.count()
    expect((await readTtrpgOpenBriefDeskV1(host))?.canRequest).toBe(true)
    expect(await readTtrpgOpenBriefDeskV1(other)).toBeNull()
    expect(await db.agentRuns.count()).toBe(0); expect(await db.agentRunEvents.count()).toBe(before)
    await expect(requestTtrpgOpenBriefDeskV1({ ...other, ...request })).rejects.toThrow(/真人主持/)
  })
  it('requests once, reviews exact references, confirms the selected version and explicitly closes without gameplay changes', async () => {
    const { host, f } = await seedTtrpgOpenBriefDeskV1(), before = await readProductRuntimeState(f.sessionId)
    let sends = 0
    await requestTtrpgOpenBriefDeskV1({ ...host, ...request, runAI: async messages => { sends++; expect(JSON.stringify(messages)).not.toContain('GM-PRIVATE-BRIEF-DESK-EXCLUDED'); return output } })
    let page = (await readTtrpgOpenBriefDeskV1(host))!
    expect(page.canConfirm).toBe(true); expect(page.saved).toBe(false)
    await expect(confirmTtrpgOpenBriefDeskV1({ ...host, candidateHash: '0'.repeat(64) })).rejects.toThrow(/版本/)
    await confirmTtrpgOpenBriefDeskV1({ ...host, candidateHash: page.candidate!.candidateHash })
    page = (await readTtrpgOpenBriefDeskV1(host))!
    expect(page.saved).toBe(true); expect(page.receiptPending).toBe(false); expect(page.canConfirm).toBe(false)
    await finishTtrpgOpenBriefDeskV1(host)
    expect((await readTtrpgOpenBriefDeskV1(host))!.canRequest).toBe(true)
    const after = await readProductRuntimeState(f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(sends).toBe(1)
  })
  it('persists rejection and refuses a later confirm without rewriting the retained answer or memory', async () => {
    const { host } = await seedTtrpgOpenBriefDeskV1(); await requestTtrpgOpenBriefDeskV1({ ...host, ...request })
    const page = (await readTtrpgOpenBriefDeskV1(host))!, input = { ...host, candidateHash: page.candidate!.candidateHash }
    await rejectTtrpgOpenBriefDeskV1(input); await rejectTtrpgOpenBriefDeskV1(input)
    expect((await readTtrpgOpenBriefDeskV1(host))!.rejected).toBe(true)
    await expect(confirmTtrpgOpenBriefDeskV1(input)).rejects.toThrow(/不可确认|放弃/)
    expect(await db.ttrpgNarrativeMemories.count()).toBe(2)
    await finishTtrpgOpenBriefDeskV1(host)
  })
  it('shows unknown results but cannot resume or silently create another request until an explicit end', async () => {
    const { host, f } = await seedTtrpgOpenBriefDeskV1(); let sends = 0
    await expect(requestTtrpgOpenBriefDeskV1({ ...host, ...request, runAI: async () => { sends++; throw new Error('unknown test result') } })).rejects.toThrow('unknown test result')
    expect((await readTtrpgOpenBriefDeskV1(host))?.request?.status).toBe('unknown')
    await expect(resumeTtrpgOpenBriefDeskV1({ ...host, runAI: async () => { sends++; return output } })).rejects.toThrow(/尚未发送/)
    await expect(requestTtrpgOpenBriefDeskV1({ ...host, ...request, submissionKey: 'another' })).rejects.toThrow(/当前复盘/)
    await finishTtrpgOpenBriefDeskV1(host)
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.calls[0].status).toBe('unknown')
    expect(sends).toBe(1)
  })
  it('cancels only the actual persisted prepared request, never creates a replacement', async () => {
    const { host, f } = await seedTtrpgOpenBriefDeskV1()
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'prepared.epoch'), viewerKey: host.viewerKey, triggerKind: 'request-brief', rawInput })
    const prepared = await prepareTtrpgOpenBriefInputV1({ ...host, ...await openEnvelopeV1(f.sessionId, 'prepared.input'), rawInput,
      modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    db.close(); await db.open()
    expect((await readTtrpgOpenBriefDeskV1(host))?.request?.read?.requestKey).toBe(prepared.requestKey)
    await cancelTtrpgOpenBriefDeskPreparedV1(host)
    expect((await readTtrpgOpenBriefDeskV1(host))?.request?.status).toBe('failed')
    await expect(resumeTtrpgOpenBriefDeskV1({ ...host, runAI: async () => output })).rejects.toThrow(/尚未发送/)
    expect(await db.agentRuns.count()).toBe(1)
    await finishTtrpgOpenBriefDeskV1(host)
  })
  it('resumes an original prepared request after reopening with the same Run and one send', async () => {
    const { host, f } = await seedTtrpgOpenBriefDeskV1()
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'resume.epoch'), viewerKey: host.viewerKey, triggerKind: 'request-brief', rawInput })
    const prepared = await prepareTtrpgOpenBriefInputV1({ ...host, ...await openEnvelopeV1(f.sessionId, 'resume.input'), rawInput,
      modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
    db.close(); await db.open()
    let sends = 0
    const result = await resumeTtrpgOpenBriefDeskV1({ ...host, runAI: async () => { sends++; return output } })
    expect(result.status).toBe('candidate')
    expect((await readTtrpgOpenBriefDeskV1(host))?.request?.read?.runId).toBe(prepared.runId)
    await expect(resumeTtrpgOpenBriefDeskV1({ ...host, runAI: async () => { sends++; return output } })).rejects.toThrow(/尚未发送/)
    expect(sends).toBe(1); expect(await db.agentRuns.count()).toBe(1)
  })
})
