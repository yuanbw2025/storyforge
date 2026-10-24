import {sha256Text} from '../../src/lib/ai/chapter-memory/text-normalization'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as api from '../../src/lib/character-interaction/runtime-api'
import {useHistoricalChatReaderFixture, freezeLegacyChatActionContractFixture, freezeLegacyChatSituationContractFixture} from '../helpers/chat-historical-reader'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1} from '../../src/lib/character-interaction/harness'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {readAgentRunArtifactExactV1} from '../../src/lib/memory/artifact-store'
import {readChatCandidateRetrievalVersion} from '../../src/lib/character-interaction/context-reader-version'
import {selectChatCoordinatorContextV1} from '../../src/lib/character-interaction/coordinator-selection'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatFactEvidenceAction as action} from '../helpers/chat-fact-evidence'
import {seedChatNarrativeRuntimeFixture, chatActionReviewOutputFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {CHAT_SITUATION_REVIEW_CHECKS_V1, type ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'
import {chatInquiryDraftFixture, chatInquiryInputFixture, chatInquiryReviewFixture, prepareChatInquiryFixture} from '../helpers/chat-inquiry-result'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const runtime = async (id: number) => (await api.readProductRuntimeState(id)).interaction!

it.each(['current', 'saved-v9'] as const)('freezes provenance policy across review recovery and a crash after command commit: %s', async reader => {
  const f = await seedChatNarrativeRuntimeFixture(), v = await api.readProductRuntimeStateVersion(f.sessionId)
  await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const before = await runtime(f.sessionId), worlds = await db.worldReleases.toArray()
  if (reader === 'saved-v9') {
    useHistoricalChatReaderFixture('chat-narrative-runtime-view-v9')
  }
  let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '事实依据持久化工程检查', runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(action)}),
    onNarrativeActionSaved: id => {runId = id; throw Error('before-review')}})).rejects.toThrow('before-review')
  expect(await runtime(f.sessionId)).toEqual(before); vi.restoreAllMocks(); db.close(); await db.open()
  if (reader === 'saved-v9') freezeLegacyChatActionContractFixture()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return JSON.stringify(chatActionReviewOutputFixture())}})
  // Crash between the SIM transaction and the separate durable run adoption.
  const commit = api.commitChatNarrativeAction
  vi.spyOn(api, 'commitChatNarrativeAction').mockImplementationOnce(async input => {await commit(input); throw Error('after-command')})
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow('after-command')
  const committed = await api.readProductRuntimeStateVersion(f.sessionId)
  vi.restoreAllMocks(); db.close(); await db.open()
  const adopted = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect(adopted.snapshot.projection.state).toBe('completed')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect(await api.readProductRuntimeStateVersion(f.sessionId)).toEqual(committed)
  const state = await runtime(f.sessionId), metadata = state.chatNarrative!.factEvidence
  expect(metadata?.records.length).toBe(reader === 'current' ? 2 : undefined)
  expect(JSON.parse(adopted.event!.payloadJson).factEvidenceVersion).toBe(reader === 'current' ? 1 : undefined)
  expect(state.chatNarrative!.situation.facts.slice(0, 4)).toEqual(before.chatNarrative!.situation.facts)
  expect(state.chatNarrative!.situation.facts.at(-1)!.factKey).toBe('card-corner')
  if (reader === 'current') {
    const badEvent = await exportProjectJSON(f.scope.projectId)
    const event = badEvent.productRuntimeEvents.find(e => e.type === 'interaction.narrative.action-reviewed.committed')!
    const portable = event as unknown as {_portablePayloadJson: string}
    const payload = JSON.parse(portable._portablePayloadJson); payload.factEvidenceVersion = 99; portable._portablePayloadJson = JSON.stringify(payload)
    const projects = await db.projects.count()
    await expect(importProjectJSON(badEvent)).rejects.toThrow('事实来源')
    expect(await db.projects.count()).toBe(projects)
  }
  let parent = f.sessionId
  for (const title of ['first', 'nested']) {
    const source = await api.readProductRuntimeState(parent)
    const child = await api.branchProductRuntimeSession({parentSessionId: parent, throughSequence: source.lastSequence, title})
    await api.deleteProductRuntimeSession(parent); parent = child.id!
  }
  const expected = await runtime(parent)
  expect(expected.chatNarrative!.factEvidence).toEqual(metadata)
  expect(expected.chatNarrative!.situation.facts.at(-1)!.sourceEventSequence).toBeLessThan(0)
  expect(await db.productRuntimeEvents.where('sessionId').equals(parent).count()).toBe(0)
  expect(await db.agentRuns.where('productRuntimeSessionId').equals(parent).count()).toBe(0)
  await api.createProductRuntimeCheckpoint({sessionId: parent, name: 'evidence-checkpoint'})
  const backup = await exportProjectJSON(f.scope.projectId)
  if (reader === 'current') for (const field of ['initialStateJson', 'runtimeHeadStateJson', 'stateJson'] as const) {
    const corrupt = structuredClone(backup)
    const row = field === 'stateJson' ? corrupt.productRuntimeCheckpoints[0] : corrupt.productRuntimeSessions.find(s => s.title === 'nested')!
    const container = row as unknown as Record<string, string>
    const initial = JSON.parse(container[field])
    initial.interaction.chatNarrative.factEvidence.records[0].evidenceFactKeys = ['card-corner']
    container[field] = JSON.stringify(initial)
    if (field === 'stateJson') container.stateHash = await sha256Text(container[field])
    const projects = await db.projects.count()
    await expect(importProjectJSON(corrupt)).rejects.toThrow('事实依据')
    expect(await db.projects.count()).toBe(projects)
    expect(await runtime(parent)).toEqual(expected)
  }
  const importedId = await importProjectJSON(backup)
  db.close(); await db.open()
  const imported = (await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()).find(s => s.title === 'nested')!
  expect(await runtime(imported.id!)).toEqual(expected)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
  expect(calls).toBe(2)
})

it.each(['current', 'saved-v11'] as const)('records player situation facts only under its frozen producer policy: %s', async reader => {
  const f = await seedChatNarrativeRuntimeFixture(), v = await api.readProductRuntimeStateVersion(f.sessionId)
  await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'seed', baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'player-seed', sourceEventSequence: v.sequence, seed: '门外传来敲门声。'})
  const draft: ChatSituationDraftV1 = {kind: 'chat-situation', title: '门外的声响', location: '驿站', timeLabel: '傍晚',
    newFacts: [{factKey: 'knocking', kind: 'observation', text: '门外传来敲门声。', audienceKeys: ['player', 'guard', 'artisan'], evidenceFactKeys: ['road'], seedExcerpt: '门外传来敲门声'}],
    newGoals: [], newThreads: [], possibilities: []}
  if (reader === 'saved-v11') {
    useHistoricalChatReaderFixture('chat-situation-runtime-view-v11', 'chat-relevance-v5')
  }
  const before = await runtime(f.sessionId)
  const legacyText = selectChatCoordinatorContextV1(before, {text: '', retrievalVersion: 'chat-relevance-v5', discoveryEvidence: true})
  let runId = 0, generated = 0, reviewed = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId: 'character.chat-situation-construction',
    objective: '情境事实来源工程检查', runAI: withChatActionChoiceFixture(async () => {generated++; return JSON.stringify(draft)}),
    onSituationDraftSaved: id => {runId = id; throw new Error('saved-before-situation-review')}})).rejects.toThrow('saved-before-situation-review')
  expect(await runtime(f.sessionId)).toEqual(before)
  const saved = await readInstanceAgentRunV1(f.scope, runId)
  expect(saved.contract.executionBindings?.find(b => b.skillId === 'character.chat-situation-construction')?.promptVersion)
    .toBe(reader === 'saved-v11' ? 'chat-situation-construction-v12' : 'chat-situation-construction-v21')
  expect(saved.contract.executionBindings?.find(b => b.skillId === 'character.chat-situation-review')?.promptVersion)
    .toBe(reader === 'saved-v11' ? 'chat-situation-review-v11' : 'chat-situation-review-v19')
  const recorded = saved.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'context-packet' && e.payload.stepId === 'interaction:runtime-candidate')!
  if (recorded.type !== 'evidence.artifact.recorded') throw new Error('missing situation source packet')
  const packetText = await readAgentRunArtifactExactV1({projectId: f.scope.projectId, artifactKind: 'context-packet', contentHash: recorded.payload.contentHash})
  const packet = JSON.parse(packetText)
  expect(packet.manifest.sources[0].readerVersion).toBe(reader === 'saved-v11' ? 'chat-situation-runtime-view-v11' : 'chat-situation-runtime-view-v18')
  expect(await readChatCandidateRetrievalVersion(saved, f.scope.projectId, 'chatSituationRuntime')).toBe(reader === 'saved-v11' ? 'chat-relevance-v5' : 'chat-relevance-v9')
  if (reader === 'saved-v11') {
    expect(packet.text).toBe(legacyText)
    expect(packet.coordinatorSelection).toBeUndefined()
  } else expect(packet.coordinatorSelection).toBeDefined()
  // Reopen without the projection/manifest mocks. Review must follow the actual
  // retained old bytes and contract, not the current defaults or a relabeled packet.
  vi.restoreAllMocks()
  db.close(); await db.open()
  if (reader === 'saved-v11') freezeLegacyChatSituationContractFixture()
  await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {
    reviewed++; return JSON.stringify({checks: CHAT_SITUATION_REVIEW_CHECKS_V1.map(check => ({check, passed: true, reason: '工程夹具'}))})
  }})
  expect(await readAgentRunArtifactExactV1({projectId: f.scope.projectId, artifactKind: 'context-packet', contentHash: recorded.payload.contentHash})).toBe(packetText)
  expect(await runtime(f.sessionId)).toEqual(before)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const metadata = (await runtime(f.sessionId)).chatNarrative!.factEvidence
  expect(metadata).toEqual(reader === 'current' ? {version: 1, records: [{factKey: 'knocking', kind: 'observation', evidenceFactKeys: ['road'], actorKey: null, goalKey: null, source: 'situation'}]} : undefined)
  const after = await runtime(f.sessionId)
  const originalSession = (await db.productRuntimeSessions.get(f.sessionId))!
  const importedProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  db.close(); await db.open()
  const imported = (await db.productRuntimeSessions.where('projectId').equals(importedProject).toArray()).find(s => s.title === originalSession.title)!
  expect(await runtime(imported.id!)).toEqual(after)
  expect([generated, reviewed]).toEqual([1, 1])
})

it('records attributed inquiry speech without replacing discovered fact identities or creating provenance for old truths', async () => {
  const f = await prepareChatInquiryFixture(), draft = await chatInquiryDraftFixture(f.sessionId)
  const original = (await runtime(f.sessionId)).chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!
  const result = await generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify(draft)), runReviewAI: async () => JSON.stringify(chatInquiryReviewFixture(draft))})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const story = (await runtime(f.sessionId)).chatNarrative!
  expect(story.factEvidence).toEqual({version: 1, records: [{factKey: 'clerk-statement', kind: 'observation', evidenceFactKeys: draft.inquiryResult!.evidenceFactKeys,
    actorKey: 'guard', goalKey: 'find-seal', source: 'inquiry'}]})
  expect(story.situation.facts.find(f => f.factKey === 'secret')).toEqual({...original, audienceKeys: ['guard', 'player']})
})
