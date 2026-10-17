import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { startTtrpgOpenEpochV1, recordTtrpgOpenNarrativeMemoryV1 } from '../../src/lib/ttrpg/runtime-commands'
import { prepareTtrpgOpenBriefInputV1 } from '../../src/lib/ttrpg/open-intent-input'
import { executeTtrpgOpenBriefRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readTtrpgOpenBriefCandidateV1, verifyTtrpgOpenBriefCandidateProofV1 } from '../../src/lib/ttrpg/open-brief-candidate'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { assertTtrpgOpenFrozenContextSourcesV1 } from '../../src/lib/ttrpg/open-model-purpose-contract'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

const rawInput = '回顾全队在旧港的经历，并明确标记尚属推测的部分。'
const output = JSON.stringify({ paragraphs: [{ text: '这是当前阶段的共同复盘，资料不足以确认额外事件。', sourceKeys: ['brief.frame'] }] })
async function setup() {
  return readyOpenTtrpgSessionV1('Formal stage recap', p => {
    p.ttrpg!.campaign.runtimePolicy.enabled = true
    p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
  })
}
async function note(sessionId: number, key: string, summary: string, party = true) {
  const envelope = await openEnvelopeV1(sessionId, `brief.note.${key}`)
  return recordTtrpgOpenNarrativeMemoryV1({ ...envelope, viewerKey: OPEN_HUMAN_VIEWER,
    draft: { revisionKey: key, observerKey: party ? 'hero' : 'gm', reliability: 'belief', audience: party ? 'party' : 'gm-only', knownBy: [],
      summary, fromEventSequence: 1, toEventSequence: envelope.baseSequence } })
}
async function prepare(f: Awaited<ReturnType<typeof setup>>) {
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'brief.epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'request-brief', rawInput })
  return prepareTtrpgOpenBriefInputV1({ ...await openEnvelopeV1(f.sessionId, 'brief.prepare'), scope: f.scope,
    viewerKey: OPEN_HUMAN_VIEWER, rawInput, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 800, maximumCostUsd: 0.1 })
}
function identity(f: Awaited<ReturnType<typeof setup>>, p: Awaited<ReturnType<typeof prepare>>) {
  return { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER, runId: p.runId, requestKey: p.requestKey }
}
describe('R-TTRPGOPEN8 formal passive recap Harness', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('uses the exact common Gateway grant, retains original belief/observer, saves a citation-bound candidate without changing gameplay or memory', async () => {
    const f = await setup(); await note(f.sessionId, 'shared', '旧港的船也许被人动过，这是英雄的怀疑。'); await note(f.sessionId, 'private', 'GM-ONLY-EXCLUDED', false)
    const p = await prepare(f), id = identity(f, p), text = p.messages.map(m => m.content).join('\n')
    expect(text).toContain('英雄的怀疑'); expect(text).not.toContain('GM-ONLY-EXCLUDED')
    expect(text).toContain('memory.shared'); expect(text).toContain('"observerKey":"hero"'); expect(text).toContain('"reliability":"belief"')
    expect(p.evidence.contextSelection).toMatchObject({ consumer: 'party-narrator', matchedTriggerKeys: [], deliveredTriggerKeys: [] })
    const before = await readProductRuntimeState(f.sessionId), memory = await db.ttrpgNarrativeMemories.toArray()
    const actualOutput = JSON.stringify({ paragraphs: [{ text: '英雄仍怀疑旧港的船被人动过。', sourceKeys: ['memory.shared'] }] })
    let sends = 0
    const result = await executeTtrpgOpenBriefRequestV1({ ...id, runAI: async () => { sends++; return actualOutput } })
    expect(result.status).toBe('candidate'); if (result.status !== 'candidate') throw new Error('missing candidate')
    expect(result.candidate.artifact.status).toBe('usable-with-warnings')
    expect(result.candidate.attributions.find(row => row.citationKey === 'memory.shared')).toMatchObject({ reliability: 'belief', observerKey: 'hero', origin: 'human-authored' })
    expect(await readTtrpgOpenBriefCandidateV1(id)).toEqual(result.candidate)
    expect((await verifyTtrpgOpenBriefCandidateProofV1({ ...id, candidateHash: result.candidate.candidateHash })).candidate).toEqual(result.candidate)
    expect(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: result.candidate.rawResponseHash })).toBe(actualOutput)
    const after = await readProductRuntimeState(f.sessionId)
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(after.ttrpg!.openRun!.knowledge).toEqual(before.ttrpg!.openRun!.knowledge)
    expect(await db.ttrpgNarrativeMemories.toArray()).toEqual(memory)
    const snapshot = await readInstanceAgentRunV1(f.scope, p.runId)
    expect(snapshot.contract.permissions).toEqual({ contextSourceKeys: ['ttrpgOpenBriefInput', 'ttrpgOpenPartyMemory', 'ttrpgOpenCommonIdentities'], writeTargets: [] })
    expect(snapshot.contract.executionBindings![0].formalEntry!.entryId).toBe('ttrpg.open.brief')
    expect(await executeTtrpgOpenBriefRequestV1({ ...id, runAI: async () => { sends++; return output } })).toEqual({ status: 'not-sent' })
    expect(sends).toBe(1)
  })
  it('rejects ordinary action authority before creating a Run, and refuses cross-purpose or historical source grants', async () => {
    const f = await setup()
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'action.epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput })
    await expect(prepareTtrpgOpenBriefInputV1({ ...await openEnvelopeV1(f.sessionId, 'wrong.epoch'), scope: f.scope, viewerKey: OPEN_HUMAN_VIEWER,
      rawInput, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 800, maximumCostUsd: 0.1 })).rejects.toThrow(/复盘窗口/)
    expect(await db.agentRuns.count()).toBe(0)
    expect(assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-brief', ['ttrpgOpenBriefInput', 'ttrpgOpenPartyMemory'])).toHaveLength(2)
    for (const sources of [['ttrpgOpenKpInput'], ['ttrpgOpenBriefInput'], ['ttrpgOpenBriefInput', 'ttrpgOpenMemory'], ['ttrpgOpenBriefInput', 'ttrpgOpenPartyMemory', 'ttrpgOpenGmOracleInput']]) {
      expect(() => assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-brief', sources)).toThrow()
    }
  })
  it('retains an invalid raw answer without resending or allowing an undelivered source to become adoptable', async () => {
    const f = await setup(), p = await prepare(f), id = identity(f, p)
    const bad = JSON.stringify({ paragraphs: [{ text: '捏造了隐藏的结论', sourceKeys: ['gm.private.truth'] }] })
    const result = await executeTtrpgOpenBriefRequestV1({ ...id, runAI: async () => bad })
    expect(result.status).toBe('candidate'); if (result.status !== 'candidate') throw new Error('missing retained candidate')
    expect(result.candidate.brief).toBeNull(); expect(result.candidate.artifact.status).toBe('manual-repair')
    expect(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: result.candidate.rawResponseHash })).toBe(bad)
    await expect(verifyTtrpgOpenBriefCandidateProofV1({ ...id, candidateHash: result.candidate.candidateHash })).rejects.toThrow(/受阻|修订/)
    expect(await executeTtrpgOpenBriefRequestV1({ ...id, runAI: async () => { throw new Error('must not send') } })).toEqual({ status: 'not-sent' })
    expect(await db.ttrpgNarrativeMemories.count()).toBe(0)
  })
  it('resumes a persisted prepared request, and keeps unknown transport visible without a second send', async () => {
    const f = await setup(), p = await prepare(f), id = identity(f, p)
    db.close(); await db.open()
    let sends = 0
    await expect(executeTtrpgOpenBriefRequestV1({ ...id, runAI: async () => { sends++; throw new Error('response lost after dispatch') } })).rejects.toThrow(/response lost/)
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.calls[0].status).toBe('unknown')
    expect(await executeTtrpgOpenBriefRequestV1({ ...id, runAI: async () => { sends++; return output } })).toEqual({ status: 'not-sent' })
    expect(sends).toBe(1); expect(await readTtrpgOpenBriefCandidateV1(id)).toBeNull()
  })
  it('refuses changed common memory at dispatch before transport', async () => {
    const f = await setup(), p = await prepare(f), id = identity(f, p)
    await note(f.sessionId, 'new-common', '准备请求后才记录的另一个共同推测。')
    let sends = 0
    await expect(executeTtrpgOpenBriefRequestV1({ ...id, runAI: async () => { sends++; return output } })).rejects.toThrow(/stale|读取|情境/)
    expect(sends).toBe(0)
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.calls[0].status).toBe('prepared')
  })
  it('keeps an imported prepared request historical and cannot obtain a fresh send permit', async () => {
    const f = await setup(), p = await prepare(f)
    const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const run = (await db.agentRuns.where('projectId').equals(projectId).toArray())[0]
    expect(run.portableRuntimeOriginJson).toBeTruthy()
    expect((await readProductRuntimeState(session.id!)).ttrpg!.openRun!.coordination.calls.some(call => call.requestKey === p.requestKey)).toBe(true)
    let sends = 0
    await expect(executeTtrpgOpenBriefRequestV1({ scope: { projectId, worldId: session.worldId!, workId: session.workId! },
      sessionId: session.id!, runId: run.id!, requestKey: p.requestKey, viewerKey: OPEN_HUMAN_VIEWER,
      runAI: async () => { sends++; return output } })).rejects.toThrow(/导入|原始|实例运行|historical|portable/)
    expect(sends).toBe(0)
  })
})
