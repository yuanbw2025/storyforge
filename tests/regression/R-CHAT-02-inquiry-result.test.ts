import {withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {recordAgentRunArtifactV1} from '../../src/lib/memory/artifact-store'
import {appendAgentRunEventV1} from '../../src/lib/agent/run/event-store'
import {CHAT_SITUATION_REVIEW_STEP_V1} from '../../src/lib/character-interaction/situation-harness'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {canonicalStringify, hashCanonicalValue} from '../../src/lib/agent/run/hash'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1, resumeChatSituationReviewV1, cancelInteractionRuntimeRunV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, branchProductRuntimeSession, commitInteractionPlayerMessage} from '../../src/lib/character-interaction/runtime-api'
import {chatInquiryRepliesV1, assertChatInquirySourcesV1} from '../../src/lib/character-interaction/narrative-inquiry'
import {applyChatSituationV1, previewChatSituationV1} from '../../src/lib/character-interaction/narrative-situations'
import {parseChatNarrativeStateV1} from '../../src/lib/character-interaction/narrative-contract'
import {buildInteractionContextWindow} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {prepareChatInquiryFixture, chatInquiryDraftFixture, chatInquiryReviewFixture, chatInquiryInputFixture, inquiryAnswer, inquiryTruth, inquiryPurpose, inquiryQuestion} from '../helpers/chat-inquiry-result'
import {chatInquiryEvidenceContextV1} from '../../src/lib/character-interaction/inquiry-evidence'
import {validateImportedChatNarrativeEvidenceEventV1} from '../../src/lib/character-interaction/narrative-evidence-import'
import {commitChatSituation} from '../../src/lib/character-interaction/runtime-commands'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
const boundary = {participantKeys: ['guard', 'artisan'], characterKeys: ['character:guard', 'character:artisan'], sceneKeys: ['inn']}
const runtime = async (id: number) => (await readProductRuntimeState(id)).interaction!

it('requires explicit frozen prerequisites and excludes unknown, future and unrelated evidence', async () => {
  const f = await prepareChatInquiryFixture({questionEvidenceFactKeys: ['clerk-present', 'box']})
  const initial = await runtime(f.sessionId), draft = await chatInquiryDraftFixture(f.sessionId)
  const input = {sequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence + 1,
    triggerSequence: initial.chatNarrative!.triggers.at(-1)!.requestedSequence, draft, inquiryEvidenceVersion: 1}
  const basis = chatInquiryEvidenceContextV1(initial)!
  expect(basis.questionEvidenceFactKeys).not.toContain('lost')
  expect(basis.targets.find(t => t.factKey === 'secret')!.requiredEvidenceFactKeys).toContain('lost')
  expect(previewChatSituationV1(initial, input).chatNarrative!.inquiryHistory![0].evidenceFactKeys).toContain('lost')
  expect(() => previewChatSituationV1(initial, {...input, inquiryEvidenceVersion: undefined})).toThrow('提问者当时')
  const mutations: Array<(state: typeof initial, proposal: typeof draft) => void> = [
    (_s, d) => {d.inquiryResult!.evidenceFactKeys = ['clerk-present', 'box']},
    (_s, d) => {d.inquiryResult!.evidenceFactKeys.push('road')},
    (_s, d) => {d.inquiryResult!.evidenceFactKeys.push('purpose')},
    s => {s.chatNarrative!.situation.facts.find(f => f.factKey === 'lost')!.audienceKeys = ['artisan']},
    s => {s.chatNarrative!.situation.facts.find(f => f.factKey === 'lost')!.sourceEventSequence = basis.questionSequence + 1},
    s => {s.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.discovery!.actorKeys = ['artisan']},
    s => {s.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.discovery!.sceneKey = 'other-scene'},
    s => {s.chatNarrative!.triggers.at(-1)!.actionSequences.push(basis.questionSequence + 1)},
  ]
  for (const mutate of mutations) {
    const state = structuredClone(initial), proposal = structuredClone(draft)
    mutate(state, proposal)
    const before = structuredClone(state)
    expect(() => previewChatSituationV1(state, {...input, draft: proposal})).toThrow()
    expect(state).toEqual(before)
  }
  expect(() => previewChatSituationV1(initial, {...input, inquiryEvidenceVersion: 6})).toThrow('版本无效')
  expect(initial.chatNarrative!.inquiryHistory).toBeUndefined()
})

it('preserves the original inquiry evidence restriction for a frozen legacy run', async () => {
  const f = await prepareChatInquiryFixture({questionEvidenceFactKeys: ['clerk-present', 'box']}), draft = await chatInquiryDraftFixture(f.sessionId)
  const original = skills.getAgentSkillV1, before = await readProductRuntimeState(f.sessionId)
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-situation-construction'
    ? {...original(id), promptVersion: 'chat-situation-construction-v12'} : id === 'character.chat-situation-review'
      ? {...original(id), promptVersion: 'chat-situation-review-v11'} : original(id))
  let reviews = 0
  await expect(generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), runAI: async messages => {
    expect(messages[1].content).not.toContain('storyforge.chat-inquiry-evidence')
    expect(messages[0].content).toContain('全部来自 pendingSituation.evidenceFactKeys')
    return JSON.stringify(draft)
  }, runReviewAI: async () => {reviews++; return JSON.stringify(chatInquiryReviewFixture(draft))}})).rejects.toThrow('提问者当时')
  expect(reviews).toBe(0)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('rejects a caller-supplied inquiry version without the original reviewed run', async () => {
  const f = await prepareChatInquiryFixture({questionEvidenceFactKeys: ['clerk-present', 'box']}), draft = await chatInquiryDraftFixture(f.sessionId)
  const before = await readProductRuntimeState(f.sessionId), version = await readProductRuntimeStateVersion(f.sessionId)
  await expect(commitChatSituation({sessionId: f.sessionId, commandId: 'forged-inquiry-version', baseSequence: version.sequence, baseStateHash: version.stateHash,
    triggerSequence: before.interaction!.chatNarrative!.triggers.at(-1)!.requestedSequence, draft,
    review: {reviewedProposalJson: canonicalStringify(draft), ...chatInquiryReviewFixture(draft)}, inquiryEvidenceVersion: 1})).rejects.toThrow('必须绑定原已审查运行')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect(() => validateImportedChatNarrativeEvidenceEventV1(JSON.stringify({inquiryEvidenceVersion: 6}), 'character-interaction', 'interaction.narrative.situation.committed')).toThrow('版本无效')
  expect(() => validateImportedChatNarrativeEvidenceEventV1(JSON.stringify({inquiryEvidenceVersion: 1}), 'character-interaction', 'interaction.narrative.action-reviewed.committed')).toThrow('只能来自已审查情境')
})

it.each([12, 13, 14])('cannot attach the new inquiry version to a valid v%s reviewed run', async producerVersion => {
  const f = await prepareChatInquiryFixture(), draft = await chatInquiryDraftFixture(f.sessionId)
  const original = skills.getAgentSkillV1
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-situation-construction'
    ? {...original(id), promptVersion: `chat-situation-construction-v${producerVersion}`} : id === 'character.chat-situation-review'
      ? {...original(id), promptVersion: `chat-situation-review-v${producerVersion - 1}`} : original(id))
  const generated = await generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), runAI: async () => JSON.stringify(draft), runReviewAI: async () => JSON.stringify(chatInquiryReviewFixture(draft))})
  const before = await readProductRuntimeState(f.sessionId), version = await readProductRuntimeStateVersion(f.sessionId)
  await expect(commitChatSituation({sessionId: f.sessionId, commandId: 'legacy-run-forged-version', baseSequence: version.sequence, baseStateHash: version.stateHash,
    triggerSequence: before.interaction!.chatNarrative!.triggers.at(-1)!.requestedSequence, draft,
    review: {reviewedProposalJson: canonicalStringify(draft), ...chatInquiryReviewFixture(draft)}, inquiryEvidenceVersion: producerVersion - 11,
    harnessRun: {id: generated.snapshot.run.id, lastSequence: generated.snapshot.projection.lastSequence}})).rejects.toThrow('与原运行合同不一致')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it.each([false, true].flatMap(splitQuestion => [false, true].flatMap(privateAnswer => [false, true].map(supplement => ({splitQuestion, privateAnswer, supplement})))))('commits the reviewed answer, including omitted known prerequisites, with restore and branch (%j)', async ({privateAnswer, supplement, splitQuestion}) => {
  const f = await prepareChatInquiryFixture({splitQuestion, ...(supplement ? {questionEvidenceFactKeys: ['clerk-present', 'box']} : {})}), draft = await chatInquiryDraftFixture(f.sessionId, privateAnswer ? ['guard'] : ['guard', 'player'])
  const before = await readProductRuntimeState(f.sessionId), world = await db.worldReleases.toArray()
  let generated = 0, reviewed = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), runAI: withChatActionChoiceFixture(async messages => {
    generated++; expect(messages[0].content).toContain('questionSequence'); expect(messages[1].content).toContain(inquiryPurpose)
    expect(messages[1].content).toContain('"schema":"storyforge.chat-inquiry-evidence"')
    if (supplement) expect(before.interaction!.chatNarrative!.pendingSituation!.evidenceFactKeys).not.toContain('lost')
    if (splitQuestion) {
      expect(draft.inquiryResult!.questionSequence).toBeLessThan(before.interaction!.chatNarrative!.pendingSituation!.sourceEventSequence)
      expect(messages[0].content).toContain('inquiryEvidence.questions')
      expect(messages[0].content).not.toContain('questionSequence 必须等于 pendingSituation.sourceEventSequence')
      expect(messages[1].content).toContain(inquiryQuestion)
    }
    return JSON.stringify(draft)
  }), onSituationDraftSaved: id => {runId = id; throw new Error('host-before-review')}})).rejects.toThrow('host-before-review')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  const reviewedResult = await resumeChatSituationReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
    reviewed++; expect(messages[0].content).toContain('actual-question'); expect(messages[0].content).toContain('对每个 discovery 单独复核')
    return JSON.stringify(chatInquiryReviewFixture(draft))
  }})
  expect(reviewedResult.snapshot.contract.executionBindings?.find(b => b.skillId === 'character.chat-situation-review')?.promptVersion).toBe('chat-situation-review-v19')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId, onDurableBoundary: type => {if (type === 'runtime.candidate.adopted') throw new Error('host-after-commit')}})).rejects.toThrow('host-after-commit')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const version = await readProductRuntimeStateVersion(f.sessionId)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(version)
  const state = await runtime(f.sessionId), story = state.chatNarrative!
  expect([generated, reviewed]).toEqual([1, 1]); expect(story.inquiryHistory).toHaveLength(1)
  expect(story.situation.facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual(draft.inquiryResult!.audienceKeys)
  expect(story.situation.facts.find(f => f.factKey === 'purpose')!.audienceKeys).toEqual([])
  expect(state.messages).toEqual(before.interaction!.messages)
  expect(story.situation.goals).toEqual(before.interaction!.chatNarrative!.situation.goals)
  expect(story.situation.possibilities).toEqual(before.interaction!.chatNarrative!.situation.possibilities)
  const committed = (await db.productRuntimeEvents.where('sessionId').equals(f.sessionId).toArray()).find(e => e.type === 'interaction.narrative.situation.committed')!
  expect(JSON.parse(committed.payloadJson).inquiryEvidenceVersion).toBe(5)
  expect(story.inquiryHistory![0].evidenceFactKeys).toContain('lost')
  expect(chatInquiryRepliesV1(story, 'player')).toHaveLength(privateAnswer ? 0 : 1)
  expect(chatInquiryRepliesV1(story, 'artisan')).toEqual([])
  const actorContext = formatInteractionRuntimeContextV1(state.profiles[0], buildInteractionContextWindow(state, 'guard'))
  expect(actorContext).toContain(inquiryAnswer); expect(actorContext).toContain(inquiryTruth); expect(actorContext).not.toContain(inquiryPurpose)
  expect(actorContext).not.toContain('工程条件专门授权'); expect(actorContext).not.toContain('他是保管者')
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: version.sequence, title: '实际答复后的分支'})
  const branched = await runtime(branch.id!)
  expect(branched.chatNarrative!.inquiryHistory![0].questionSequence).toBeLessThan(0)
  expect(chatInquiryRepliesV1(branched.chatNarrative!, 'guard')[0].answerText).toBe(inquiryAnswer)
  expect(await runtime(f.sessionId)).toEqual(state)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.parentSessionId == null)!
  expect(await runtime(imported.id!)).toEqual(state)
  db.close(); await db.open(); expect(await runtime(imported.id!)).toEqual(state)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(world)
})

it.each(['statement', 'uncertain', 'declined'] as const)('records %s as attributed speech without certifying hidden truth', async answerKind => {
  const f = await prepareChatInquiryFixture(), draft = await chatInquiryDraftFixture(f.sessionId)
  Object.assign(draft.inquiryResult!, {answerKind, answerText: answerKind === 'declined' ? '我不想在大家面前谈这件事。' : '我只记得柜台昨夜有人整理过，不能据此确认铜印在哪里。', discoveries: []})
  const result = await generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify(draft)), runReviewAI: async () => JSON.stringify(chatInquiryReviewFixture(draft))})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const state = await runtime(f.sessionId)
  expect(state.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual([])
  expect(state.chatNarrative!.situation.facts.at(-1)!.text).toContain('只证明说过这些话')
})

it.each(['missing-discovery', 'failed-discovery', 'failed-answer', 'missing-inquiry'] as const)('rejects %s review without partial adoption or automatic resend', async defect => {
  const f = await prepareChatInquiryFixture(), draft = await chatInquiryDraftFixture(f.sessionId), before = await readProductRuntimeState(f.sessionId)
  const report = chatInquiryReviewFixture(draft)
  if (defect === 'missing-discovery') report.inquiryReview.discoveries = []
  if (defect === 'failed-discovery') report.inquiryReview.discoveries[0].passed = false
  if (defect === 'failed-answer') report.inquiryReview.checks[2].passed = false
  const raw = JSON.stringify(defect === 'missing-inquiry' ? {checks: report.checks} : report)
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), onRunCreated: id => {runId = id},
    runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(draft)}), runReviewAI: async () => {calls++; return raw}})).rejects.toThrow()
  expect(calls).toBe(2); await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'raw-response' && a.content === raw)).toBe(true)
})

it.each(['producer', 'reviewer'] as const)('rejects a new result under historical %s binding before review', async kind => {
  const f = await prepareChatInquiryFixture(), draft = await chatInquiryDraftFixture(f.sessionId), before = await readProductRuntimeState(f.sessionId)
  const original = skills.getAgentSkillV1, id = kind === 'producer' ? 'character.chat-situation-construction' : 'character.chat-situation-review'
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(key => key === id ? {...original(key), promptVersion: kind === 'producer' ? 'chat-situation-construction-v7' : 'chat-situation-review-v6'} : original(key))
  let reviews = 0
  await expect(generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify(draft)), runReviewAI: async () => {reviews++; return JSON.stringify(chatInquiryReviewFixture(draft))}})).rejects.toThrow('询问前提证据与原生成和审查合同不一致')
  expect(reviews).toBe(0); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('fails closed for structural authority, evidence, audience and history tampering', async () => {
  const f = await prepareChatInquiryFixture(), initial = await runtime(f.sessionId), draft = await chatInquiryDraftFixture(f.sessionId)
  const input = {sequence: (await readProductRuntimeStateVersion(f.sessionId)).sequence + 1, triggerSequence: initial.chatNarrative!.triggers.at(-1)!.requestedSequence, draft}
  const accepted = applyChatSituationV1(initial, {...input, review: {reviewedProposalJson: canonicalStringify(draft), ...chatInquiryReviewFixture(draft)}})
  const mutations: Array<(state: typeof initial, proposal: typeof draft) => void> = [
    s => {delete s.chatNarrative!.permissions.allowInquiryResults},
    s => {s.chatNarrative!.pendingSituation!.purpose = 'observation-result'},
    (_s, d) => {d.inquiryResult!.questionSequence++},
    (_s, d) => {d.inquiryResult!.questionExcerpt = '我准备明天再询问。'},
    (_s, d) => {d.inquiryResult!.respondentName = '叶岑'; d.inquiryResult!.respondentExcerpt = '叶岑'},
    (_s, d) => {d.inquiryResult!.audienceKeys.push('artisan')},
    (_s, d) => {d.inquiryResult!.evidenceFactKeys.push('purpose')},
    (_s, d) => {d.inquiryResult!.evidenceFactKeys.push('road')},
    (_s, d) => {d.inquiryResult!.evidenceFactKeys = ['clerk-present']},
    (_s, d) => {d.inquiryResult!.discoveries[0].factKey = 'purpose'},
    (_s, d) => {d.inquiryResult!.answerKind = 'declined'},
    (_s, d) => {d.timeLabel = '翌日'},
    (_s, d) => {d.possibilities.push({actorKey: 'guard', text: '现在打开箱子', evidenceFactKeys: ['box']})},
  ]
  for (const mutate of mutations) {const state = structuredClone(initial), proposal = structuredClone(draft); mutate(state, proposal); expect(() => previewChatSituationV1(state, {...input, draft: proposal})).toThrow()}
  expect(initial.chatNarrative!.inquiryHistory).toBeUndefined()
  for (const mutate of [
    (s: typeof accepted) => {s.chatNarrative!.inquiryHistory![0].questionSequence++},
    (s: typeof accepted) => {s.chatNarrative!.situation.facts.find(f => f.factKey === 'clerk-statement')!.text = '假的记录'},
    (s: typeof accepted) => {s.chatNarrative!.inquiryHistory![0].discoveries[0].factKey = 'purpose'},
    (s: typeof accepted) => {s.chatNarrative!.inquiryHistory![0].evidenceFactKeys.push('secret')},
  ]) {const state = structuredClone(accepted); mutate(state); expect(() => parseChatNarrativeStateV1(state.chatNarrative, boundary)).toThrow()}
  const noQuestion = structuredClone(accepted); noQuestion.messages = []
  expect(() => assertChatInquirySourcesV1(noQuestion)).toThrow('真实问题')
})

it.each(['cancel', 'stale'] as const)('does not release a fact when %s arrives during the independent answer review', async interruption => {
  const f = await prepareChatInquiryFixture(), draft = await chatInquiryDraftFixture(f.sessionId)
  let calls = 0, runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), onRunCreated: id => {runId = id}, runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(draft)}), runReviewAI: async () => {
    calls++
    if (interruption === 'cancel') await cancelInteractionRuntimeRunV1({scope: f.scope, runId})
    else {
      const v = await readProductRuntimeStateVersion(f.sessionId)
      await commitInteractionPlayerMessage({sessionId: f.sessionId, commandId: 'inquiry.interrupt', baseSequence: v.sequence, baseStateHash: v.stateHash,
        messageId: 'inquiry.interrupt', text: '先暂停这次调查。', audienceKeys: ['guard']})
    }
    return JSON.stringify(chatInquiryReviewFixture(draft))
  }})).rejects.toThrow()
  const state = await runtime(f.sessionId)
  expect(calls).toBe(2); expect(state.chatNarrative!.inquiryHistory).toBeUndefined()
  expect(state.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual([])
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
})

it('can answer an inherited pending question on a branch without changing its parent or initial-fact identity', async () => {
  const f = await prepareChatInquiryFixture({splitQuestion: true, questionEvidenceFactKeys: ['clerk-present', 'box']}), before = await runtime(f.sessionId), version = await readProductRuntimeStateVersion(f.sessionId)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: version.sequence, title: '回答之前分支'})
  const draft = await chatInquiryDraftFixture(branch.id!)
  expect(draft.inquiryResult!.questionSequence).toBeLessThan(0)
  const result = await generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture({...f, sessionId: branch.id!}), runAI: withChatActionChoiceFixture(async () => JSON.stringify(draft)), runReviewAI: async () => JSON.stringify(chatInquiryReviewFixture(draft))})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  expect((await runtime(branch.id!)).chatNarrative!.inquiryHistory).toHaveLength(1)
  expect(await runtime(f.sessionId)).toEqual(before)
})

it.each([false, true])('recovers retained inquiry review=%s without resending unknown requests or dropping per-fact verdicts', async retained => {
  const f = await prepareChatInquiryFixture(), draft = await chatInquiryDraftFixture(f.sessionId)
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({...chatInquiryInputFixture(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify(draft)),
    onSituationDraftSaved: id => {runId = id; throw new Error('host-crash')}})).rejects.toThrow('host-crash')
  const stepId = CHAT_SITUATION_REVIEW_STEP_V1
  const append = async (type: 'step.scheduled' | 'step.started' | 'model.requested' | 'model.responded', payload: unknown) =>
    appendAgentRunEventV1({scope: f.scope, runId, productRuntimeSessionId: f.sessionId, type, payload} as Parameters<typeof appendAgentRunEventV1>[0])
  await append('step.scheduled', {stepId}); await append('step.started', {stepId, attempt: 1})
  await append('model.requested', {stepId, attempt: 1, bindingHash: await hashCanonicalValue({test: 'inquiry-crash'})})
  if (retained) {
    const content = JSON.stringify(chatInquiryReviewFixture(draft))
    await append('model.responded', {stepId, attempt: 1, outputHash: await hashCanonicalValue(content)})
    await recordAgentRunArtifactV1({scope: f.scope, runId, productRuntimeSessionId: f.sessionId, artifactKind: 'raw-response', content, stepId, attempt: 1})
  }
  db.close(); await db.open(); let calls = 0
  const resume = () => resumeChatSituationReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return '{}'}})
  if (retained) {await resume(); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})}
  else {await expect(resume()).rejects.toThrow('结果未知'); await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()}
  expect(calls).toBe(0)
  const state = await runtime(f.sessionId)
  expect(state.chatNarrative!.inquiryHistory?.length ?? 0).toBe(retained ? 1 : 0)
  expect(state.chatNarrative!.situation.facts.find(f => f.factKey === 'secret')!.audienceKeys).toEqual(retained ? ['guard', 'player'] : [])
})
