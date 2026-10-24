import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as artifacts from '../../src/lib/memory/artifact-store'
import * as context from '../../src/lib/registry/assemble-context'
import * as manifests from '../../src/lib/agent/run/context-manifest'
import {CONTEXT_SOURCES} from '../../src/lib/registry/context-sources'
import {buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {listChatContextInspectionsV1, readChatContextInspectionV1} from '../../src/lib/character-interaction/context-inspector'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, commitInteractionPlayerMessage, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, setChatMessageRetrieval} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {freezeLegacyChatActionContractFixture} from '../helpers/chat-historical-reader'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const record = artifacts.recordAgentRunArtifactV1
const assemble = context.assembleContext
const createManifest = manifests.createContextManifestFromAssemblyV1
async function command(sessionId: number) {
  const v = await readProductRuntimeStateVersion(sessionId)
  return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}
}
async function start() {
  const f = await seedChatNarrativeRuntimeFixture()
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return f
}
async function generate(f: Awaited<ReturnType<typeof start>>) {
  return generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '检查可见上下文',
    runAI: withChatActionChoiceFixture(async messages => {expect(JSON.stringify(messages)).toContain('无辜旅人'); return JSON.stringify({kind: 'speak', text: '我先查看门边。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})}),
    runReviewAI: async () => JSON.stringify(chatActionReviewOutputFixture())})
}

it('shows only player-known parts of the exact historical input without new calls or current-state substitutions', async () => {
  const f = await start(), result = await generate(f)
  const inspected = await readChatContextInspectionV1(f.scope, f.sessionId, result.snapshot.run.id)
  expect(inspected.available).toBe(true)
  if (!inspected.available) throw new Error('missing inspection')
  expect(inspected.actorName).toBe('叶岑')
  expect(inspected.persona.name).toBe('沈禾')
  expect(inspected.facts).toEqual(['铜印失踪。', '山路被倒树挡住，驿站里暂时安全。'])
  expect(inspected.threads[0].title).toBe('失踪的铜印')
  expect(inspected.manifestHash).toBe(result.candidate.contextManifestHash)
  expect(inspected.knowledge.join('\n')).toContain('铜印失踪。')
  for (const secret of ['柜台下', '无辜旅人', '担心再次错怪人', '借用', '可以建议查看后门']) expect(JSON.stringify(inspected)).not.toContain(secret)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: 'future', text: '这是之后才发生的消息。'})
  const state = await readProductRuntimeState(f.sessionId), runs = await db.agentRuns.count(), events = await db.productRuntimeEvents.count()
  expect((await listChatContextInspectionsV1(f.scope, f.sessionId)).map(r => r.runId)).toEqual([result.snapshot.run.id])
  db.close(); await db.open()
  expect(await readChatContextInspectionV1(f.scope, f.sessionId, result.snapshot.run.id)).toEqual(inspected)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(state)
  expect(await db.agentRuns.count()).toBe(runs); expect(await db.productRuntimeEvents.count()).toBe(events)
})

it('explains explicit exclusions separately from the historical message budget', async () => {
  const f = await start()
  for (let n = 1; n <= 35; n++) await commitInteractionPlayerMessage({...await command(f.sessionId), messageId: `input-${n}`, text: `公开消息 ${n}。`})
  await setChatMessageRetrieval({...await command(f.sessionId), messageId: 'input-1', excluded: true})
  await requestChatNarrativeTrigger({...await command(f.sessionId), kind: 'continue', sourceEventSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence})
  const result = await generate(f), inspection = await readChatContextInspectionV1(f.scope, f.sessionId, result.snapshot.run.id)
  expect(inspection.available).toBe(true)
  if (!inspection.available) throw new Error('missing inspection')
  expect(inspection.omissions).toEqual({excludedMessages: 1, budgetMessages: 0})
  expect(inspection.messages.map(m => m.messageId)).toEqual(Array.from({length: 34}, (_, i) => `input-${i + 2}`))
})

it('retains completed exact evidence after export/import while keeping branch histories distinct', async () => {
  const f = await start(), result = await generate(f)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const child = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence, title: 'context child'})
  expect(await listChatContextInspectionsV1(f.scope, child.id!)).toEqual([])
  await expect(readChatContextInspectionV1(f.scope, child.id!, result.snapshot.run.id)).rejects.toThrow('上下文证据')
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title !== 'context child')!
  const scope = {projectId, worldId: imported.worldId, workId: imported.workId}
  const rows = await listChatContextInspectionsV1(scope, imported.id!)
  expect(rows).toHaveLength(1)
  const inspection = await readChatContextInspectionV1(scope, imported.id!, rows[0].runId)
  expect(inspection.available).toBe(true)
  if (inspection.available) expect(inspection.facts).toContain('铜印失踪。')
  const other = await seedChatNarrativeRuntimeFixture()
  await expect(readChatContextInspectionV1(other.scope, f.sessionId, result.snapshot.run.id)).rejects.toThrow()
})

it('labels older calls without packets instead of reconstructing them as delivered evidence', async () => {
  vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => input.artifactKind === 'context-packet'
    ? {snapshot: await readInstanceAgentRunV1(input.scope, input.runId), artifact: {} as never, bodyCreated: false, eventCreated: false} : record(input))
  const f = await start(), result = await generate(f)
  expect(await readChatContextInspectionV1(f.scope, f.sessionId, result.snapshot.run.id)).toEqual({available: false, reason: '这次历史调用没有保存可核验的完整上下文；不会用当前局面代替。'})
})

it('verifies a preserved v3 historical input using its original selection policy', async () => {
  freezeLegacyChatActionContractFixture()
  const source = CONTEXT_SOURCES.find(s => s.key === 'interactionRuntime')!
  vi.spyOn(source, 'read').mockImplementation(async input => {
    const state = (await readProductRuntimeState(input.productRuntimeSessionId!)).interaction!
    const key = input.interactionParticipantKey!
    return formatInteractionRuntimeContextV1(state.profiles.find(p => p.participantKey === key)!, buildInteractionContextWindow(state, key, {retrievalVersion: 'legacy'}))
  })
  vi.spyOn(manifests, 'createContextManifestFromAssemblyV1').mockImplementation(input => createManifest({...input, readerVersion: 'chat-narrative-runtime-view-v3'}))
  const f = await start(), result = await generate(f)
  const inspected = await readChatContextInspectionV1(f.scope, f.sessionId, result.snapshot.run.id)
  expect(inspected.available).toBe(true)
  if (inspected.available) expect(inspected).not.toHaveProperty('selection')
})

it('distinguishes saved preparation from an actually sent request', async () => {
  vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
    if (input.artifactKind === 'rendered-request') throw new Error('stop before request')
    return record(input)
  })
  const f = await start()
  await expect(generate(f)).rejects.toThrow('stop before request')
  const [row] = await listChatContextInspectionsV1(f.scope, f.sessionId)
  expect(await readChatContextInspectionV1(f.scope, f.sessionId, row.runId)).toEqual({available: false, reason: '这次运行尚未记录实际发送模型请求。'})
})

it('stops before sending when the protected role input cannot fit its atomic budget', async () => {
  vi.spyOn(context, 'assembleContext').mockImplementation(input => assemble(input.sourceKeys?.includes('interactionRuntime') ? {...input, sourceBudgetScale: 0.1} : input))
  const f = await start()
  await expect(generate(f)).rejects.toThrow('原子来源 interactionRuntime 超出预算')
  const [row] = await listChatContextInspectionsV1(f.scope, f.sessionId)
  const saved = await readInstanceAgentRunV1(f.scope, row.runId)
  expect(saved.events.some(e => e.type === 'model.requested')).toBe(false)
  const inspection = await readChatContextInspectionV1(f.scope, f.sessionId, row.runId)
  expect(inspection.available).toBe(false)
  if (!inspection.available) expect(inspection.reason).toContain('没有保存')
})

it.each(['corrupt', 'missing', 'evidence-pruned'])('rejects %s stored evidence without changing the story', async mode => {
  const f = await start(), result = await generate(f), state = await readProductRuntimeState(f.sessionId)
  const body = (await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()).find(a => a.artifactKind === 'context-packet')!
  if (mode === 'missing') await db.agentRunArtifacts.delete(body.id!)
  else await db.agentRunArtifacts.update(body.id!, mode === 'corrupt' ? {content: '{}'} : {content: null, retentionState: 'evidence-pruned'})
  await expect(readChatContextInspectionV1(f.scope, f.sessionId, result.snapshot.run.id)).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(state)
})

it.each(['actor', 'manifest', 'text', 'selection'])('rejects a consistently stored but mismatched %s packet', async mode => {
  vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
    if (input.artifactKind !== 'context-packet' || input.stepId !== 'interaction:runtime-candidate') return record(input)
    const packet = JSON.parse(input.content)
    if (mode === 'actor') packet.participantKey = 'artisan'
    if (mode === 'manifest') packet.manifest.manifestHash = '0'.repeat(64)
    if (mode === 'text') packet.text = '伪造的已读内容。'
    if (mode === 'selection') packet.selection.knowledge[0].included = !packet.selection.knowledge[0].included
    return record({...input, content: JSON.stringify(packet)})
  })
  const f = await start()
  if (mode === 'actor' || mode === 'manifest') await expect(generate(f)).rejects.toThrow('行动来源读取版本无法核验')
  else if (mode === 'text') await expect(generate(f)).rejects.toThrow('行动来源正文与读取版本不一致')
  else await generate(f)
  const run = (await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).toArray())[0]
  await expect(readChatContextInspectionV1(f.scope, f.sessionId, run.id!)).rejects.toThrow('上下文证据')
})

it('verifies a preserved v5 input and its original selection after the memory retrieval upgrade', async () => {
  freezeLegacyChatActionContractFixture()
  let selection: unknown
  vi.spyOn(CONTEXT_SOURCES.find(s => s.key === 'interactionRuntime')!, 'read').mockImplementation(async input => {
    const state = (await readProductRuntimeState(input.productRuntimeSessionId!)).interaction!, key = input.interactionParticipantKey!
    const view = buildInteractionContextWindow(state, key, {retrievalVersion: 'chat-relevance-v1'})
    selection = view.selection
    return formatInteractionRuntimeContextV1(state.profiles.find(p => p.participantKey === key)!, view)
  })
  vi.spyOn(manifests, 'createContextManifestFromAssemblyV1').mockImplementation(input => createManifest(input.stepId === 'interaction:runtime-candidate' ? {...input, readerVersion: 'chat-narrative-runtime-view-v5'} : input))
  vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(input => input.artifactKind === 'context-packet'
    ? record({...input, content: JSON.stringify({...JSON.parse(input.content), selection})}) : record(input))
  const f = await start(), result = await generate(f)
  expect((await readChatContextInspectionV1(f.scope, f.sessionId, result.snapshot.run.id)).available).toBe(true)
})
