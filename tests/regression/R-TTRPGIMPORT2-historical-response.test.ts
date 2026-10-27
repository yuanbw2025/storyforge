import { seedCurrentWorkspace } from '../helpers/current-workspace'
import type { ChatMessage } from '../../src/lib/types'
import type { ChatResult } from '../../src/lib/ai/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { preparePortableOpenRequestV1 } from '../helpers/open-ttrpg-portability'
import { firstManualRequestV1 } from '../helpers/open-ttrpg-manual'
import { executeTtrpgOpenIntentRequestV1, recoverTtrpgOpenRuntimeCandidateV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { readTtrpgOpenIntentCandidateV1 } from '../../src/lib/ttrpg/open-intent-candidate'
import { readTtrpgOpenHistoricalResponseV1, listTtrpgOpenHistoricalResponsesV1 } from '../../src/lib/ttrpg/open-imported-response'
import { readTtrpgOpenTableV1, finishTtrpgOpenTableWindowV1, readTtrpgOpenManualActionCatalogV1, proposeTtrpgOpenManualActionV1,
  readTtrpgOpenTableHistoricalResponseV1, rejectTtrpgOpenTableIntentV1 } from '../../src/lib/ttrpg/open-table-service'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import * as artifactStore from '../../src/lib/memory/artifact-store'
import { OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
const output = JSON.stringify({ goal: '检查河港 <img src=x onerror=alert(1)>', method: '复核现场', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null })
async function setup(interrupted = false, rejected = false) {
  const f = await preparePortableOpenRequestV1('historical successful response')
  const record = artifactStore.recordAgentRunArtifactV1
  if (interrupted) vi.spyOn(artifactStore, 'recordAgentRunArtifactV1').mockImplementation(async input => {
    if (input.artifactKind === 'source-snapshot' && input.content.includes('storyforge.ttrpg-open-intent-candidate')) throw new Error('closed after saved response')
    return record(input)
  })
  const transport = { calls: 0 }
  const send = vi.fn(async (_messages: ChatMessage[], _signal: AbortSignal, result: ChatResult) => {
    transport.calls++;result.usage = { inputTokens: 2200, outputTokens: 70, totalTokens: 2270 };return output
  })
  const execution = executeTtrpgOpenIntentRequestV1({ ...f.input, ...f.prepared, sessionId: f.sessionId, runAI: send })
  if (interrupted) await expect(execution).rejects.toThrow('closed after saved response')
  else await execution
  vi.restoreAllMocks()
  if (rejected) {
    const read = { scope: f.scope, sessionId: f.sessionId, viewerKey: f.input.viewerKey, ...f.prepared }
    const candidate = (await readTtrpgOpenIntentCandidateV1(read))!
    await rejectTtrpgOpenTableIntentV1({ ...read, candidateHash: candidate.candidateHash })
  }
  const original = await readProductRuntimeState(f.sessionId), backup = await exportProjectJSON(f.scope.projectId), projectId = await importProjectJSON(backup)
  const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
  const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } })
  const input = { scope, sessionId: session.id!, viewerKey: OPEN_HUMAN_VIEWER }
  const descriptor = (await listTtrpgOpenHistoricalResponsesV1(input))[0]
  return { f, original, backup, send, transport, input, descriptor, read: { ...input, runId: descriptor.runId, requestKey: descriptor.requestKey } }
}
describe('R-TTRPGIMPORT2 imported successful output remains historical until real human action', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => { vi.restoreAllMocks(); db.close() })
  it.each([false, true])('reads original exact output with interrupted materialization=%s and never revives a candidate', async interrupted => {
    const x = await setup(interrupted), before = await readProductRuntimeState(x.input.sessionId)
    const runs = await db.agentRuns.toArray(), events = await db.agentRunEvents.toArray(), artifacts = await db.agentRunArtifacts.toArray()
    const result = await readTtrpgOpenTableHistoricalResponseV1(x.read)
    expect(result).toMatchObject({ text: output, executable: false, usage: { source: 'provider', inputTokens: 2200, outputTokens: 70, actualCostUsd: null } })
    expect(await readTtrpgOpenHistoricalResponseV1(x.read)).toEqual(result)
    await expect(readTtrpgOpenIntentCandidateV1(x.read)).rejects.toThrow(/导入前候选/)
    await expect(recoverTtrpgOpenRuntimeCandidateV1(x.read)).rejects.toThrow(/导入前候选/)
    const view = await readTtrpgOpenTableV1(x.input)
    expect(view.player!.candidates).toEqual([]);expect(view.player!.candidateRecoveries).toEqual([])
    expect(view.player!.historicalResponses).toEqual([x.descriptor])
    expect(await readProductRuntimeState(x.input.sessionId)).toEqual(before)
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(x.original)
    expect(await db.agentRuns.toArray()).toEqual(runs);expect(await db.agentRunEvents.toArray()).toEqual(events);expect(await db.agentRunArtifacts.toArray()).toEqual(artifacts)
    expect(x.transport.calls).toBe(1)
  })
  it('ends the old window and starts a fresh human proposal through the existing rule/risk path', async () => {
    const x = await setup(), before = await readProductRuntimeState(x.input.sessionId)
    await readTtrpgOpenTableHistoricalResponseV1(x.read)
    await finishTtrpgOpenTableWindowV1(x.input)
    const catalog = await readTtrpgOpenManualActionCatalogV1(x.input), { request } = firstManualRequestV1(catalog)
    expect(catalog.canPropose).toBe(true)
    await proposeTtrpgOpenManualActionV1({ ...x.input, request, rawInput: '我复核原回答后，按当前规则人工调查现场', basisHash: catalog.basisHash, submissionKey: 'human.after-import' })
    const view = await readTtrpgOpenTableV1(x.input)
    expect(view.player!.operation!.status).toBe('awaiting-approval')
    const after = await readProductRuntimeState(x.input.sessionId)
    expect(after.entities).toEqual(before.entities)
    expect(parseTtrpgRuntimeStateV2(after.ttrpg)!.openRun!.coordination.calls).toEqual(parseTtrpgRuntimeStateV2(before.ttrpg)!.openRun!.coordination.calls)
    expect(await readTtrpgOpenHistoricalResponseV1(x.read)).toMatchObject({ text: output, executable: false })
    expect(x.transport.calls).toBe(1)
  })
  it('rejects another viewer, another current Run, or a request without this original successful receipt', async () => {
    const x = await setup()
    await expect(readTtrpgOpenHistoricalResponseV1({ ...x.read, viewerKey: 'viewer.other' })).rejects.toThrow()
    await expect(readTtrpgOpenHistoricalResponseV1({ ...x.read, runId: x.f.prepared.runId })).rejects.toThrow()
    await expect(readTtrpgOpenHistoricalResponseV1({ ...x.read, requestKey: 'other.request' })).rejects.toThrow()
    expect(x.transport.calls).toBe(1)
  })
  it('keeps historical output non-executable when numeric IDs coincide but workspace UID changes', async () => {
    await seedCurrentWorkspace('unrelated numeric collision holder')
    const x = await setup(), project = (await db.projects.get(x.f.scope.projectId))!
    await db.delete();await db.open()
    const { id: _id, ...holder } = project
    await db.projects.add({ ...holder, activeWorldId: null, activeWorkId: null })
    const projectId = await importProjectJSON(x.backup), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } })
    const input = { scope, sessionId: session.id!, viewerKey: x.input.viewerKey }, descriptor = (await listTtrpgOpenHistoricalResponsesV1(input))[0]
    expect(projectId).toBe(x.f.scope.projectId);expect(session.id).toBe(x.f.sessionId);expect(descriptor.runId).toBe(x.f.prepared.runId)
    expect((await db.projects.get(projectId))!.workspaceUid).not.toBe(project.workspaceUid)
    const read = { ...input, ...descriptor }
    expect(await readTtrpgOpenHistoricalResponseV1(read)).toMatchObject({ text: output, executable: false })
    await expect(readTtrpgOpenIntentCandidateV1(read)).rejects.toThrow(/导入前候选/)
    expect((await readTtrpgOpenTableV1(input)).player!.candidates).toEqual([])
  })
  it('retains the original successful response after an explicit source-side candidate rejection', async () => {
    const x = await setup(false, true)
    expect(await readTtrpgOpenHistoricalResponseV1(x.read)).toMatchObject({ text: output, executable: false })
    expect(x.transport.calls).toBe(1)
  })
  it('rechecks current participant ownership after asynchronous artifact reads', async () => {
    const x = await setup(), readExact = artifactStore.readAgentRunArtifactExactV1
    let changed = false
    vi.spyOn(artifactStore, 'readAgentRunArtifactExactV1').mockImplementation(async input => {
      const body = await readExact(input)
      if (!changed && input.projectId === x.input.scope.projectId && input.artifactKind === 'raw-response') {
        changed = true
        const seat = (await db.ttrpgSessionParticipants.where('sessionId').equals(x.input.sessionId).toArray()).find(s => s.actorKey === 'hero')!
        await db.ttrpgSessionParticipants.update(seat.id!, { revision: seat.revision + 1 })
      }
      return body
    })
    await expect(readTtrpgOpenHistoricalResponseV1(x.read)).rejects.toThrow()
    expect(changed).toBe(true);expect(x.transport.calls).toBe(1)
  })
  it.each(['raw-corrupt', 'raw-missing', 'terminal-corrupt'])('fails closed when %s is detected and retains source data', async mutation => {
    const x = await setup(), result = await readTtrpgOpenHistoricalResponseV1(x.read)
    if (mutation === 'terminal-corrupt') {
      const row = (await db.productRuntimeEvents.where('sessionId').equals(x.input.sessionId).toArray()).find(e => e.type === 'ttrpg.open.call.finished')!
      const body = JSON.parse(row.payloadJson);body.call.usage.outputTokens++
      await db.productRuntimeEvents.update(row.id!, { payloadJson: JSON.stringify(body) })
    } else {
      const raw = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([x.input.scope.projectId,'raw-response',result.rawResponseHash]).first()
      if (mutation === 'raw-corrupt') await db.agentRunArtifacts.update(raw!.id!, { content: 'changed' })
      else await db.agentRunArtifacts.delete(raw!.id!)
    }
    await expect(readTtrpgOpenHistoricalResponseV1(x.read)).rejects.toThrow()
    expect(await readProductRuntimeState(x.f.sessionId)).toEqual(x.original)
    expect(x.transport.calls).toBe(1)
  })
})
