import {createHash} from 'node:crypto'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {CHAT_SPOKEN_INQUIRY_REVIEW_RULES_V1, supportsChatSpokenInquiryReviewV1} from '../../src/lib/character-interaction/inquiry-prompt'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, branchProductRuntimeSession} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {prepareChatInquiryFixture, chatInquiryDraftFixture, chatInquiryReviewFixture, chatInquiryInputFixture, inquiryQuestion} from '../helpers/chat-inquiry-result'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
async function prepared() {
  const f = await seedChatNarrativeRuntimeFixture({actorSituationExpansion: true, factDiscovery: true}), v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'speech.start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  return f
}
function inquiry(): ChatNarrativeActionV1 {
  const text = '我朝屋里问：“有人见过失踪的铜印吗？”'
  return {kind: 'speak', text, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
    situationRequest: {threadKey: 'investigate', direction: '补足当前是否有人能提供最后见到铜印位置的线索，不预定他人回答。', evidenceFactKeys: ['lost'], evidenceExcerpt: text}}
}
function input(f: Awaited<ReturnType<typeof prepared>>) {
  return {scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const, objective: '工程询问：不预写答复或物理结果'}
}

it.each([false, true].flatMap(options => (['legacy', 'previous', 'saved-v38', 'saved-v39', 'saved-v40', 'saved-v41', 'current'] as const).map(reviewMode => ({options, reviewMode}))))('keeps producer and legacy reviewer bytes; pure questions persist as messages, not facts (options=$options, reviewer=$reviewMode)', async ({options, reviewMode}) => {
  const f = await prepared(), original = skills.getAgentSkillV1
  const legacy = reviewMode === 'legacy'
  const actionReviewVersion = `chat-narrative-action-review-v${legacy ? 29 : reviewMode === 'previous' ? 37 : reviewMode === 'saved-v38' ? 38 : reviewMode === 'saved-v39' ? 39 : reviewMode === 'saved-v40' ? 40 : reviewMode === 'saved-v41' ? 41 : 42}`
  const optionsReviewVersion = `chat-narrative-options-review-v${legacy ? 23 : reviewMode === 'previous' ? 27 : reviewMode === 'saved-v38' ? 28 : reviewMode === 'current' ? 30 : 29}`
  if (reviewMode === 'current') {
    expect(original('character.chat-narrative-action-review').promptVersion).toBe(actionReviewVersion)
    expect(original('character.chat-narrative-options-review').promptVersion).toBe(optionsReviewVersion)
  }
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action' ? {...original(id), promptVersion: 'chat-narrative-action-v36'}
    : id === 'character.chat-narrative-options' ? {...original(id), promptVersion: 'chat-narrative-options-v26'}
    : id === 'character.chat-narrative-action-review' ? {...original(id), promptVersion: actionReviewVersion}
    : id === 'character.chat-narrative-options-review' ? {...original(id), promptVersion: optionsReviewVersion} : original(id))
  const a = inquiry(), b = {...a, text: '我问道：“有人愿意说说见过的情况吗？”', situationRequest: null}
  const before = await readProductRuntimeState(f.sessionId), world = await db.worldReleases.toArray()
  let calls = 0
  const generated = await generateInteractionRuntimeCandidateV1({...input(f), skillId: options ? 'character.chat-narrative-options' : 'character.chat-narrative-action', onRunCreated: () => {vi.restoreAllMocks()}, runAI: withChatActionChoiceFixture(async messages => {
    calls++
    // Independently captured on eb5de640 before changing either review binding.
    expect(digest(messages[0].content)).toBe(options ? '024c2868a08ada2689b91c8495008f65ddec1d8c0aeb875a9f814c3bb1dad14b' : '6d15d60074209fd72bb84bc69baa86a8df9978e24d6109af508655da502eff60')
    expect(messages[1].content).not.toContain('铜印在柜台下')
    return JSON.stringify(options ? {options: [a, b]} : a)
  }), runReviewAI: async messages => {
    calls++
    if (legacy) expect(digest(messages[0].content)).toBe(options ? '2d8e376848fcd5db39ff94f1ab7182b3ef57c7968adfecf05be55f870a6227f0' : '08faa2a54700d60112c27098c5512ce234c5393ab93f77d84a6cee92f21b7622')
    for (const rule of CHAT_SPOKEN_INQUIRY_REVIEW_RULES_V1) expect(messages[0].content.includes(rule)).toBe(!legacy)
    expect(messages[0].content.includes('物理观察发现分两阶段')).toBe(!legacy)
    expect(messages[0].content.includes('旧邀请未答复本身不禁止有依据且不依赖该决定的局部方向')).toBe(!legacy)
    return JSON.stringify(options ? {options: ['option-1', 'option-2'].map(optionKey => ({optionKey, ...chatActionReviewOutputFixture()}))} : chatActionReviewOutputFixture())
  }})
  const binding = generated.snapshot.contract.executionBindings!.find(b => b.skillId === (options ? 'character.chat-narrative-options-review' : 'character.chat-narrative-action-review'))!
  expect(binding.promptVersion).toBe(options ? optionsReviewVersion : actionReviewVersion)
  expect(calls).toBe(2); expect(generated.snapshot.contract.budget.maxModelCalls).toBe(2)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id, ...(options ? {optionKey: 'option-1'} : {})})
  const state = await readProductRuntimeState(f.sessionId), story = state.interaction!.chatNarrative!, message = state.interaction!.messages.at(-1)!
  expect(message.text).toBe(a.text)
  expect(story.pendingSituation?.sourceEventSequence).toBe(message.eventSequence)
  expect(story.pendingSituation?.purpose).toBeUndefined()
  expect(story.situation.facts).toEqual(before.interaction!.chatNarrative!.situation.facts)
  expect(story.inquiryHistory ?? []).toEqual([])
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: state.lastSequence, title: '实际问话后的分支'})
  const branched = (await readProductRuntimeState(branch.id!)).interaction!
  expect(branched.chatNarrative!.pendingSituation?.sourceEventSequence).toBe(branched.messages.at(-1)!.eventSequence)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(world)
  expect(calls).toBe(2)
})

it('retains the actual message as the question evidence for an already grounded respondent and separately reviewed reply', async () => {
  const f = await prepareChatInquiryFixture(), before = (await readProductRuntimeState(f.sessionId)).interaction!, question = before.messages.at(-1)!
  expect(question.text).toBe(inquiryQuestion)
  expect(before.chatNarrative!.pendingSituation?.sourceEventSequence).toBe(question.eventSequence)
  expect(before.chatNarrative!.situation.facts.some(f => f.text === question.text)).toBe(false)
  const requests = (await db.agentRunArtifacts.toArray()).filter(a => a.artifactKind === 'rendered-request').map(a => {
    const request = JSON.parse(a.content)
    return (Array.isArray(request) ? request : request.messages)[0].content as string
  })
  expect(requests).toHaveLength(3)
  expect(requests.some(text => text.includes(CHAT_SPOKEN_INQUIRY_REVIEW_RULES_V1[0]))).toBe(true)
  const draft = await chatInquiryDraftFixture(f.sessionId), reviewed = await generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f),
    runAI: withChatActionChoiceFixture(async () => JSON.stringify(draft)), runReviewAI: async () => JSON.stringify(chatInquiryReviewFixture(draft))})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: reviewed.snapshot.run.id})
  const after = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(after.chatNarrative!.inquiryHistory![0].questionSequence).toBe(question.eventSequence)
  expect(after.chatNarrative!.situation.facts.find(f => f.factKey === 'purpose')!.audienceKeys).toEqual([])
})

it.each(['new-fact', 'observation-result'] as const)('does not repair a question into an invalid %s before review', async invalid => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), a = inquiry()
  if (invalid === 'new-fact') a.newFacts = [{factKey: 'asked', kind: 'observation', text: a.text, evidenceFactKeys: ['lost'], evidenceExcerpt: a.text}]
  else a.situationRequest!.purpose = 'observation-result'
  let reviews = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify(a)), runReviewAI: async () => {reviews++; return JSON.stringify(chatActionReviewOutputFixture())}})).rejects.toThrow()
  expect(reviews).toBe(0); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it.each(['physical-omission', 'invented-answer'] as const)('retains %s semantic rejection; new rules never erase negative checks', async invalid => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), a = inquiry(), review = chatActionReviewOutputFixture()
  a.situationRequest = null
  if (invalid === 'physical-omission') {a.kind = 'complete'; a.text = '叶岑打开了获准检查的木箱，查看内部。'}
  else a.text = '我朝屋里问完，一名刚出现的伙计立刻回答了铜印的去向。'
  review.checks.find(c => c.check === (invalid === 'physical-omission' ? 'consequences' : 'permissions'))!.passed = false
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...input(f), onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(a)}),
    runReviewAI: async messages => {calls++; expect(messages[0].content).toContain('物理后果、披露及其它真实变化仍须按各自合同核对'); return JSON.stringify(review)},
  })).rejects.toThrow('语义审查未通过')
  expect(calls).toBe(2); expect((await db.agentRuns.get(runId))?.status).toBe('failed')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  db.close(); await db.open(); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'raw-response' && a.content === JSON.stringify(review))).toBe(true)
})

it('enables the clarification only for exact new action and options review bindings', () => {
  for (const v of ['chat-narrative-action-review-v30', 'chat-narrative-options-review-v24']) expect(supportsChatSpokenInquiryReviewV1(v)).toBe(true)
  for (const v of [undefined, 'chat-narrative-action-review-v29', 'chat-narrative-options-review-v23', 'chat-narrative-action-review-v999', 'chat-narrative-action-v36']) expect(supportsChatSpokenInquiryReviewV1(v)).toBe(false)
})
