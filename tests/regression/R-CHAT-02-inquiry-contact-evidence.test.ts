import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {createHash} from 'node:crypto'
import actual from '../fixtures/character-chat-inquiry-contact-v321.json'
import legacy from '../fixtures/character-chat-coordinator-audience-legacy.json'
import {db} from '../../src/lib/db/schema'
import {chatInquiryContactEvidenceContextV1, projectChatInquiryContactEvidenceV1} from '../../src/lib/character-interaction/inquiry-contact-evidence'
import {chatInquiryContextForVersionV1, chatInquiryEvidenceVersionForContractV1} from '../../src/lib/character-interaction/inquiry-evidence'
import {chatInquiryGenerationRulesV1, chatInquiryReviewRulesV1} from '../../src/lib/character-interaction/inquiry-prompt'
import {parseChatSituationDraftV1, previewChatSituationV1} from '../../src/lib/character-interaction/narrative-situations'
import {buildChatHistoryCoordinatorProjectionV1} from '../../src/lib/character-interaction/history-coordinator-context'
import {generateInteractionRuntimeCandidateV1, resumeChatSituationReviewV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {prepareChatInquiryFixture, chatInquiryDraftFixture, chatInquiryInputFixture, chatInquiryReviewFixture} from '../helpers/chat-inquiry-result'
import type {CharacterInteractionRuntimeState} from '../../src/lib/types'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const state = () => structuredClone(actual.state.interaction) as unknown as CharacterInteractionRuntimeState
const validCandidate = () => parseChatSituationDraftV1({...structuredClone(actual.response), inquiryResult: {...actual.response.inquiryResult,
  evidenceFactKeys: [...actual.response.inquiryResult.evidenceFactKeys, actual.response.inquiryResult.respondentFactKey]}})
const input = () => ({sequence: actual.state.lastSequence + 1, triggerSequence: actual.state.interaction.chatNarrative.triggers.slice(-1)[0].requestedSequence,
  draft: validCandidate(), inquiryEvidenceVersion: 4})
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex')

it('retains the exact V321 failure, and admits a separately valid contact reference only under v4', () => {
  expect(createHash('sha256').update(actual.rawText).digest('hex')).toBe(actual.rawSha256)
  expect(JSON.parse(actual.rawText)).toEqual(actual.response)
  expect(() => parseChatSituationDraftV1(actual.response)).toThrow('答复缺少听众、人物依据或明确结果')
  const s = state(), before = structuredClone(s), candidate = input()
  expect(chatInquiryContextForVersionV1(s, 3)).toEqual(actual.legacyEvidence)
  for (const version of [undefined, 1, 2, 3]) expect(() => previewChatSituationV1(s, {...candidate, inquiryEvidenceVersion: version})).toThrow()
  const after = previewChatSituationV1(s, candidate), answer = candidate.draft.inquiryResult!
  expect(after.chatNarrative!.inquiryHistory!.slice(-1)[0]).toMatchObject(answer)
  expect(after.chatNarrative!.situation.facts.slice(0, -1)).toEqual(before.chatNarrative!.situation.facts)
  expect(after.chatNarrative!.situation.facts.slice(-1)[0].text).toContain('只证明说过这些话')
  expect(after.profiles).toEqual(before.profiles)
  expect(s).toEqual(before)
})

it('does not widen the evidence allowlist to other known facts or repair a missing contact reference', () => {
  const s = state(), candidate = input(), context = chatInquiryContactEvidenceContextV1(s)!
  const answer = candidate.draft.inquiryResult!, basis = context.questions.find(q => q.questionSequence === answer.questionSequence)!
  expect(basis.respondentEvidenceFactKeys).toContain(answer.respondentFactKey)
  const unrelated = basis.respondentEvidenceFactKeys.find(key => key !== answer.respondentFactKey && !answer.evidenceFactKeys.includes(key))!
  expect(unrelated).toBeDefined()
  answer.evidenceFactKeys.push(unrelated)
  expect(() => previewChatSituationV1(s, candidate)).toThrow('询问依据须是提问者当时已知的事实')
  answer.evidenceFactKeys = answer.evidenceFactKeys.filter(key => key !== unrelated && key !== answer.respondentFactKey)
  expect(() => previewChatSituationV1(s, candidate)).toThrow('答复缺少听众、人物依据或明确结果')
})

it.each(['later-created', 'actor-unknown', 'wrong-audience', 'later-discovery', 'other-actor', 'excluded-withdrawal', 'already-answered'] as const)('rejects invalid temporal, audience or continuity evidence: %s', mutation => {
  const s = state(), candidate = input(), answer = candidate.draft.inquiryResult!, story = s.chatNarrative!
  const fact = story.situation.facts.find(f => f.factKey === answer.respondentFactKey)!
  if (mutation === 'later-created') fact.sourceEventSequence = answer.questionSequence + 1
  if (mutation === 'actor-unknown') fact.audienceKeys = [s.playerKey]
  if (mutation === 'wrong-audience') fact.audienceKeys = [answer.actorKey]
  if (mutation === 'later-discovery') story.discoveryHistory!.push({...story.discoveryHistory!.slice(-1)[0], discoverySequence: answer.questionSequence + 1})
  if (mutation === 'other-actor') s.messages.find(m => m.eventSequence === story.pendingSituation!.sourceEventSequence)!.speakerKey = 'other'
  if (mutation === 'excluded-withdrawal') {
    const later = s.messages.find(m => m.eventSequence === story.pendingSituation!.sourceEventSequence)!
    later.text = '别再问这个问题。'; story.excludedMessageIds = [later.messageId]
  }
  if (mutation === 'already-answered') story.inquiryHistory!.push({...answer, resultSequence: answer.questionSequence + 1, sceneKey: s.activeScene!.sceneKey})
  const before = structuredClone(s)
  expect(() => previewChatSituationV1(s, candidate)).toThrow()
  expect(s).toEqual(before)
})

it('shows only selected contact text references while retaining the full intervening dialogue and historical bytes', () => {
  const s = state(), contact = actual.response.inquiryResult.respondentFactKey
  const full = chatInquiryContactEvidenceContextV1(s)!
  const narrow = projectChatInquiryContactEvidenceV1(full, key => key === contact)!
  expect(narrow.questions.every(q => q.respondentEvidenceFactKeys.every(key => key === contact))).toBe(true)
  expect(narrow.questions.some(q => q.omittedRespondentEvidenceCount > 0)).toBe(true)
  expect(full).toEqual(chatInquiryContactEvidenceContextV1(s))
  const result = buildChatHistoryCoordinatorProjectionV1(s, {text: JSON.stringify(validCandidate()), retrievalVersion: 'chat-relevance-v9', inquiryEvidence: 4})
  const rendered = JSON.parse(result.text.slice(result.text.indexOf('{')))
  for (const q of rendered.inquiryEvidence.questions) {
    expect(q.respondentEvidenceFactKeys.every((key: string) => rendered.situation.facts.some((f: {factKey: string}) => f.factKey === key))).toBe(true)
  }
  expect(rendered.inquiryEvidence.questions.find((q: {questionSequence: number}) => q.questionSequence === actual.response.inquiryResult.questionSequence).respondentEvidenceFactKeys).toContain(contact)
  expect(rendered.messages.map((m: {messageId: string}) => m.messageId)).toEqual(expect.arrayContaining(full.dialogueMessageIds))
  expect(hash(chatInquiryGenerationRulesV1('chat-situation-construction-v17'))).toBe(legacy.inquiryGeneration)
  expect(hash(chatInquiryReviewRulesV1('chat-situation-review-v16'))).toBe(legacy.inquiryReview)
  expect(chatInquiryGenerationRulesV1('chat-situation-construction-v18').join('\n')).toContain('必须包含这个 respondentFactKey')
  expect(chatInquiryGenerationRulesV1('chat-situation-construction-v18').join('\n')).not.toContain('必须含 pendingSituation 中的现场人物依据')
})

it.each([false, true])('keeps current v5 evidence through durable review, adoption, branches and import (private answer=%s)', async privateAnswer => {
  // Deliberately omit the actual contact from the actor's request; the source
  // fact is still known. No source, authority or story text is patched later.
  const f = await prepareChatInquiryFixture({questionEvidenceFactKeys: ['lost', 'box'], playerInterjection: '嗯，我在听。'})
  const draft = await chatInquiryDraftFixture(f.sessionId, privateAnswer ? ['guard'] : ['guard', 'player'])
  const before = await readProductRuntimeState(f.sessionId), world = await db.worldReleases.toArray()
  expect(before.interaction!.chatNarrative!.pendingSituation!.evidenceFactKeys).not.toContain('clerk-present')
  let runId = 0, generated = 0, reviewed = 0
  await expect(generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), runAI: async messages => {
    generated++
    expect(messages[0].content).toContain('必须包含这个 respondentFactKey')
    expect(messages[1].content).toContain('respondentEvidenceFactKeys')
    return JSON.stringify(draft)
  }, onSituationDraftSaved: id => {runId = id; throw Error('before-review')}})).rejects.toThrow('before-review')
  db.close(); await db.open()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const result = await resumeChatSituationReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
    reviewed++; expect(messages[0].content).toContain('不能用候选清单中的其他事实扩张答复依据')
    return JSON.stringify(chatInquiryReviewFixture(draft))
  }})
  expect(chatInquiryEvidenceVersionForContractV1(result.snapshot.contract)).toBe(5)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const saved = await readProductRuntimeState(f.sessionId), version = await readProductRuntimeStateVersion(f.sessionId)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(version)
  expect(saved.interaction!.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual(draft.inquiryResult!.audienceKeys)
  expect(saved.interaction!.chatNarrative!.situation.facts.find(f => f.factKey === 'purpose')!.audienceKeys).toEqual([])
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: version.sequence, title: 'contact-evidence-portable'})
  const branched = (await readProductRuntimeState(branch.id!)).interaction
  const project = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  db.close(); await db.open()
  const imported = (await db.productRuntimeSessions.where('projectId').equals(project).toArray()).find(s => s.title === branch.title)!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched)
  expect((await db.worldReleases.toArray()).filter(w => w.projectId === f.scope.projectId)).toEqual(world)
  expect([generated, reviewed]).toEqual([1, 1])
})

it('retains independent rejection even for structurally eligible contact evidence', async () => {
  const f = await prepareChatInquiryFixture({questionEvidenceFactKeys: ['lost', 'box']})
  const draft = await chatInquiryDraftFixture(f.sessionId), before = await readProductRuntimeState(f.sessionId)
  const report = chatInquiryReviewFixture(draft)
  report.inquiryReview.checks.find(c => c.check === 'grounded-respondent')!.passed = false
  let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), onRunCreated: id => {runId = id},
    runAI: async () => {calls++; return JSON.stringify(draft)}, runReviewAI: async () => {calls++; return JSON.stringify(report)},
  })).rejects.toThrow('审查未通过')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(calls).toBe(2)
})
