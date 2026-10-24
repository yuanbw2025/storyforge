import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {createHash} from 'node:crypto'
import {db} from '../../src/lib/db/schema'
import * as ai from '../../src/lib/ai/client'
import * as artifacts from '../../src/lib/memory/artifact-store'
import * as skills from '../../src/lib/agent/skill-registry'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {chatActionOutputSchemaV1, chatActionRequestOptionsV1, boundedChatOutputTokensV1, chatActionOutputRulesV1} from '../../src/lib/character-interaction/action-output-contract'
import {bindChatOwnEvidenceV1} from '../../src/lib/character-interaction/action-evidence-binding'
import {compileChatActionWireV1, resolveChatActionWireAudienceV1} from '../../src/lib/character-interaction/action-wire'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readChatContextInspectionV1} from '../../src/lib/character-interaction/context-inspector'
import {createInitialInteractionState, interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {applyReviewedChatNarrativeActionV1, parseChatNarrativeActionV1, requestChatNarrativeTriggerV1} from '../../src/lib/character-interaction/narrative-actions'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, chatNarrativeFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const action: ChatNarrativeActionV1 = {kind: 'speak', text: '你愿意说说刚才的情况吗？', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['player', 'guard', 'artisan'], waitingForPlayer: true,
  newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
const ownEvidenceAction = {...action, kind: 'complete', text: '叶岑把油灯移到门边。门边亮了起来。', waitingForPlayer: false,
  newFacts: [{factKey: 'lamp', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: null}]}
const config = {provider: 'agnes' as const, model: 'agnes-2.5-flash', apiKey: 'test-only', baseUrl: 'https://invalid.example/v1', temperature: 0.2, maxTokens: 0}
const recordArtifact = artifacts.recordAgentRunArtifactV1
beforeEach(async () => {
  vi.spyOn(navigator, 'locks', 'get').mockReturnValue({
    request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({name: _name, mode: 'exclusive'}),
  } as unknown as LockManager)
  db.close(); await db.delete(); await db.open()
})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function start(privateTurn = false) {
  const f = await seedChatNarrativeRuntimeFixture(), state = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: state.sequence, baseStateHash: state.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence,
    ...(privateTurn ? {direction: {actorKey: 'guard', actionLimit: 1, audienceParticipantKeys: ['guard'], conversationMode: 'private' as const}} : {})})
  return f
}
const generate = (f: Awaited<ReturnType<typeof start>>) => generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '验证新候选结构与冻结预算', aiConfig: config})
function mockChat(output: unknown = action, review = chatActionReviewOutputFixture()) {
  return vi.spyOn(ai, 'chat').mockImplementation(async (messages, _config, meta) =>
    withChatActionChoiceFixture(async () => JSON.stringify(meta?.category === 'runtime.character.chat-narrative-action' ? output : review))(messages))
}
function wire(value: unknown, expressionMode = 'self-action-performed', audienceKeys: string[] | null = null) {
  const result = structuredClone(value) as Record<string, unknown>
  delete result.kind; delete result.waitingForPlayer
  return {...result, expressionMode, audienceKeys}
}

it('sends required candidate shape, saves the exact schema request and preserves inspection after import', async () => {
  const output = wire(ownEvidenceAction), chat = mockChat(output), f = await start(), before = await readProductRuntimeState(f.sessionId), result = await generate(f)
  expect(chat).toHaveBeenCalledTimes(3)
  const call = chat.mock.calls[1], options = call[5]!
  expect(options.jsonSchema?.strict).toBe(true)
  expect(options.jsonSchema?.name).toBe('chat_narrative_outcome_v4')
  expect(options.jsonSchema?.schema.required).toEqual(['outcome', 'action', 'handoff'])
  const properties = options.jsonSchema!.schema.properties as Record<string, {anyOf: Array<{required?: string[]}>}>
  const actionShapes = properties.action.anyOf[0] as {anyOf: Array<{required: string[]}>}
  for (const actionShape of actionShapes.anyOf) {
    expect(actionShape.required).toContain('goalKey')
    expect(actionShape.required).toContain('expressionMode')
    expect(actionShape.required).not.toContain('kind')
    expect(actionShape.required).not.toContain('waitingForPlayer')
  }
  expect(JSON.stringify(options.jsonSchema?.schema)).toContain('目标原本 active 且继续保持 active 时必须填 null')
  expect(call[0][0].content).toContain('个人暂停不自动暂停整线')
  expect(call[1].maxTokens).toBe(4000)
  expect(chat.mock.calls[0][1].maxTokens).toBe(2000)
  expect(chat.mock.calls[2][1].maxTokens).toBe(8000)
  expect(result.snapshot.contract.budget.maxOutputTokens).toBe(14000)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const candidate = result.candidate
  if (candidate.kind !== 'chat-narrative-action-candidate') throw Error('wrong candidate kind')
  expect(candidate.action).toMatchObject({kind: 'complete', waitingForPlayer: false, audienceKeys: ['player', 'guard', 'artisan']})
  expect(candidate.action).not.toHaveProperty('expressionMode')
  expect(candidate.action.newFacts[0].evidenceExcerpt).toBe(ownEvidenceAction.text)
  expect(candidate.review?.reviewedActionJson).toBe(canonicalStringify(candidate.action))
  expect(JSON.stringify(chat.mock.calls[2][0])).toContain(ownEvidenceAction.text)
  const raw = result.snapshot.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.stepId === 'interaction:runtime-candidate' && e.payload.artifactKind === 'raw-response')!
  if (raw.type !== 'evidence.artifact.recorded') throw Error('missing raw')
  const rawInput = {projectId: f.scope.projectId, artifactKind: 'raw-response' as const, contentHash: raw.payload.contentHash}
  const expectedRaw = JSON.stringify({outcome: 'action', action: output, handoff: null})
  expect(await artifacts.readAgentRunArtifactExactV1(rawInput)).toBe(expectedRaw)
  const event = result.snapshot.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.stepId === 'interaction:runtime-candidate' && e.payload.artifactKind === 'rendered-request')!
  if (event.type !== 'evidence.artifact.recorded') throw Error('missing request')
  const saved = JSON.parse(await artifacts.readAgentRunArtifactExactV1({projectId: f.scope.projectId, artifactKind: 'rendered-request', contentHash: event.payload.contentHash}))
  expect(saved).toEqual({version: 1, messages: call[0], requestOptions: options})
  expect((await readChatContextInspectionV1(f.scope, f.sessionId, result.snapshot.run.id)).available).toBe(true)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const id = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const session = await db.productRuntimeSessions.where('projectId').equals(id).first()
  const run = await db.agentRuns.where('productRuntimeSessionId').equals(session!.id!).first()
  expect((await readChatContextInspectionV1({projectId: id, worldId: session!.worldId, workId: session!.workId}, session!.id!, run!.id!)).available).toBe(true)
  expect(await artifacts.readAgentRunArtifactExactV1({...rawInput, projectId: id})).toBe(expectedRaw)
  expect((await readProductRuntimeState(session!.id!)).interaction).toEqual((await readProductRuntimeState(f.sessionId)).interaction)
  expect(chat).toHaveBeenCalledTimes(3)
})

it('keeps semantic rejection authoritative after binding and never adopts or retries it', async () => {
  const review = chatActionReviewOutputFixture(); review.checks.find(c => c.check === 'continuity')!.passed = false
  const chat = mockChat(wire(ownEvidenceAction), review), f = await start(), before = await readProductRuntimeState(f.sessionId)
  await expect(generate(f)).rejects.toThrow('行动语义审查未通过')
  expect(chat).toHaveBeenCalledTimes(3)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const run = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last()
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: run!.id!})).rejects.toThrow()
})

it.each([
  {name: 'paraphrased excerpt', fact: {...ownEvidenceAction.newFacts[0], evidenceExcerpt: '叶岑把油灯……门边亮了起来。'}, error: '后果证据未出现在实际表达中'},
  {name: 'fact absent from expression', fact: {...ownEvidenceAction.newFacts[0], text: '木箱属于沈禾。'}, error: '新增事实必须有实际表达的逐字证据'},
])('does not repair $name or skip factual preview', async ({fact, error}) => {
  const chat = mockChat({...ownEvidenceAction, newFacts: [fact]}), f = await start(), before = await readProductRuntimeState(f.sessionId)
  await expect(generate(f)).rejects.toThrow(error)
  expect(chat).toHaveBeenCalledTimes(2)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('uses the frozen old version even when the registry upgrades while the model is running', async () => {
  const get = skills.getAgentSkillV1; let upgraded = false
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action' && !upgraded ? {...get(id), promptVersion: 'chat-narrative-action-v39'} : get(id))
  const chat = vi.spyOn(ai, 'chat').mockImplementation(async () => {upgraded = true; return JSON.stringify(ownEvidenceAction)})
  const f = await start(), before = await readProductRuntimeState(f.sessionId)
  await expect(generate(f)).rejects.toThrow('行动文本无效')
  expect(chat).toHaveBeenCalledTimes(1)
  expect(chat.mock.calls[0][5]?.jsonSchema?.name).toBe('chat_action_shape_v2')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('never fills player or destination authority, adds missing fields or truncates an overlong binding', () => {
  const row = {...action, text: '甲'.repeat(1200) + '乙', situationRequest: {threadKey: 'investigate', direction: '核对木箱', evidenceFactKeys: ['lost'], evidenceExcerpt: null}}
  const bind = (v: unknown) => bindChatOwnEvidenceV1(v, 'chat-narrative-action-v40')
  expect(() => parseChatNarrativeActionV1(bind(row))).toThrow('行动文本无效')
  expect(parseChatNarrativeActionV1(bind({...row, situationRequest: {...row.situationRequest, evidenceExcerpt: '乙'}})).text).toBe(row.text)
  const missing = {...row.situationRequest} as Partial<typeof row.situationRequest>; delete missing.evidenceExcerpt
  expect(() => parseChatNarrativeActionV1(bind({...row, situationRequest: missing}))).toThrow('闭集')
  const foreign = {text: action.text, pauseGoal: {playerExcerpt: null, evidenceExcerpt: null}, sceneTransition: {destinationExcerpt: null, evidenceExcerpt: null}, unknown: {evidenceExcerpt: null}}
  expect(bind(foreign)).toEqual({...foreign, pauseGoal: {playerExcerpt: null, evidenceExcerpt: action.text}, sceneTransition: {destinationExcerpt: null, evidenceExcerpt: action.text}})
  expect(foreign.pauseGoal.evidenceExcerpt).toBeNull()
  expect(() => parseChatNarrativeActionV1(bind({...action, pauseGoal: {threadKey: 'investigate', playerEventSequence: 1, playerExcerpt: null, evidenceExcerpt: null}}))).toThrow()
})

it('binds each option to its own expression and commits only the reviewed selected alternative', async () => {
  const second = {...ownEvidenceAction, text: '叶岑把油灯移到柜台。柜台亮了起来。', newFacts: [{...ownEvidenceAction.newFacts[0], factKey: 'counter', text: '柜台亮了起来。'}]}
  const chat = vi.spyOn(ai, 'chat').mockImplementation(async (_m, _c, meta) => JSON.stringify(meta?.category === 'runtime.character.chat-narrative-options'
    ? {options: [wire(ownEvidenceAction), wire(second)]} : {options: ['option-1', 'option-2'].map(optionKey => ({optionKey, ...chatActionReviewOutputFixture()}))}))
  const f = await start(), before = await readProductRuntimeState(f.sessionId)
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-options', objective: '比较原文绑定', aiConfig: config})
  if (generated.candidate.kind !== 'chat-narrative-options-candidate') throw Error('wrong kind')
  expect(generated.candidate.options.map(a => a.newFacts[0].evidenceExcerpt)).toEqual([ownEvidenceAction.text, second.text])
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id, optionKey: 'option-2'})
  const facts = (await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation.facts
  expect(facts.find(f => f.factKey === 'lamp')).toBeUndefined()
  expect(facts.find(f => f.factKey === 'counter')?.text).toBe('柜台亮了起来。')
  expect(chat).toHaveBeenCalledTimes(2)
})

it('binds null only to the private turn, persists it, and never discloses the expression to a bystander', async () => {
  const chat = mockChat(wire(action, 'speech-awaiting-player')), f = await start(true), result = await generate(f)
  expect(chat.mock.calls[1][0][0].content).toContain('冻结听众 ["player","guard"]')
  expect(result.candidate).toMatchObject({action: {kind: 'speak', waitingForPlayer: true, audienceKeys: ['player', 'guard']}})
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(state.messages.at(-1)?.audienceKeys).toEqual(['player', 'guard'])
  expect(interactionVisibilityView(state, 'artisan').messages).toEqual([])
  expect(chat).toHaveBeenCalledTimes(3)
})

it.each([
  {label: 'empty audience', output: wire(action, 'speech-awaiting-player', []), error: '行动听众缺少'},
  {label: 'widened private audience', output: wire(action, 'speech-awaiting-player', ['player', 'guard', 'artisan']), error: '听众范围'},
  {label: 'mixed protocols', output: {...wire(action), kind: 'complete'}, error: '不能混用'},
  {label: 'contradictory canonical action', output: {...action, kind: 'attempt', waitingForPlayer: false, audienceKeys: ['player', 'guard']}, error: '行动尝试必须交还玩家决定'},
])('retains and rejects $label without rewriting it or dispatching review', async ({output, error}) => {
  const chat = mockChat(output), f = await start(true), before = await readProductRuntimeState(f.sessionId)
  await expect(generate(f)).rejects.toThrow(error)
  expect(chat).toHaveBeenCalledTimes(2)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('retains revision/edit audiences and refuses an unresolved binding instead of inventing listeners', async () => {
  const f = await start(), state = (await readProductRuntimeState(f.sessionId)).interaction!
  expect(resolveChatActionWireAudienceV1(state, 'guard', ['player', 'guard'])).toEqual(['player', 'guard'])
  state.chatNarrative!.pendingEdit = {role: 'character', actorKey: 'guard', text: action.text, audienceKeys: ['player', 'guard'], sourceMessageId: 'original', requestedSequence: 0}
  expect(resolveChatActionWireAudienceV1(state, 'guard')).toEqual(['player', 'guard'])
  expect(() => resolveChatActionWireAudienceV1(state, 'guard', ['player', 'absent'])).toThrow('实际对话范围')
  expect(() => compileChatActionWireV1(wire(action), 'chat-narrative-action-v41')).toThrow('缺少冻结听众')
  expect(() => parseChatNarrativeActionV1(compileChatActionWireV1(wire(action), 'chat-narrative-action-v40', ['player', 'guard']))).toThrow('闭集')
})

it('still rejects an incomplete provider response, retains its raw output and never retries or adopts', async () => {
  const malformed = {...action} as Partial<ChatNarrativeActionV1>; delete malformed.goalKey
  const chat = mockChat(malformed as ChatNarrativeActionV1), f = await start(), before = await readProductRuntimeState(f.sessionId)
  await expect(generate(f)).rejects.toThrow('行动字段不在允许闭集')
  expect(chat).toHaveBeenCalledTimes(2)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  const run = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last()
  expect(run!.status).toBe('failed')
  const snapshot = await readInstanceAgentRunV1(f.scope, run!.id!)
  const raw = snapshot.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.stepId === 'interaction:runtime-candidate' && e.payload.artifactKind === 'raw-response')!
  if (raw.type !== 'evidence.artifact.recorded') throw Error('missing raw response')
  expect(await artifacts.readAgentRunArtifactExactV1({projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: raw.payload.contentHash})).toBe(JSON.stringify({outcome: 'action', action: malformed, handoff: null}))
})

it('detects schema evidence substitution instead of presenting it as the actual request', async () => {
  const chat = mockChat(); vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(async input => {
    if (input.artifactKind === 'rendered-request' && input.stepId === 'interaction:runtime-candidate') {
      const saved = JSON.parse(input.content)
      if (!Array.isArray(saved)) {saved.requestOptions.jsonSchema.schema.required = []; return recordArtifact({...input, content: JSON.stringify(saved)})}
    }
    return recordArtifact(input)
  })
  const f = await start(), before = await readProductRuntimeState(f.sessionId)
  await expect(generate(f)).rejects.toThrow('已发送请求的预算证据与原调用不一致')
  expect(chat).toHaveBeenCalledTimes(2)
  const run = await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).last()
  await expect(readChatContextInspectionV1(f.scope, f.sessionId, run!.id!)).rejects.toThrow('证据不完整')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: run!.id!})).rejects.toThrow()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('leaves old prompt contracts and unverified providers on the original request format', async () => {
  expect(chatActionRequestOptionsV1('chat-narrative-action-v37', 'agnes')).toBeUndefined()
  expect(chatActionRequestOptionsV1('chat-narrative-action-v38', 'deepseek')).toBeUndefined()
  expect(chatActionRequestOptionsV1('chat-narrative-action-v38', 'codex')?.jsonSchema).toBeDefined()
  const get = skills.getAgentSkillV1
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action' ? {...get(id), promptVersion: 'chat-narrative-action-v37'} : get(id))
  const chat = mockChat(), f = await start(), result = await generate(f)
  expect(chat.mock.calls[0][5]).toBeUndefined()
  expect(chat.mock.calls[0][0][0].content).not.toContain('pauseGoal 只保存自己的目标暂停')
  expect((await readChatContextInspectionV1(f.scope, f.sessionId, result.snapshot.run.id)).available).toBe(true)
  expect((await readInstanceAgentRunV1(f.scope, result.snapshot.run.id)).contract.executionBindings![0].promptVersion).toBe('chat-narrative-action-v37')
})

it('treats a user zero as the frozen cap and rejects invalid caps', () => {
  expect([undefined, 0, 4000, 20000].map(n => boundedChatOutputTokensV1(n, 8000))).toEqual([8000, 8000, 4000, 8000])
  for (const n of [-1, 1.5, NaN, Infinity]) expect(() => boundedChatOutputTokensV1(n, 8000)).toThrow('预算无效')
  expect(() => boundedChatOutputTokensV1(0, 0)).toThrow('预算无效')
})

it.each([
  {name: 'goal', value: {...action, goalStatus: 'active'} as ChatNarrativeActionV1, error: '角色目标没有状态变化'},
  {name: 'thread', value: {...action, threadUpdates: [{threadKey: 'investigate', status: 'open', evidenceExcerpt: action.text}]} as ChatNarrativeActionV1, error: '剧情线无状态变化'},
])('rejects unchanged $name state without dropping the effect, retrying or adopting', async ({value, error}) => {
  const chat = mockChat(value), f = await start(), before = await readProductRuntimeState(f.sessionId)
  await expect(generate(f)).rejects.toThrow(error)
  expect(chat).toHaveBeenCalledTimes(2)
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})

it('preserves the exact v38 request schema recorded by the original real-model episode', () => {
  const old = chatActionRequestOptionsV1('chat-narrative-action-v38', 'agnes')
  expect(createHash('sha256').update(JSON.stringify(old)).digest('hex')).toBe('0186c37a9c501817f0236d1873ca620f25cf28f1edce1d3785f177658d63c5e4')
  expect(chatActionRequestOptionsV1('chat-narrative-action-v39', 'agnes')?.jsonSchema?.name).toBe('chat_action_shape_v2')
})

it.each([
  ['chat-narrative-action-v39', '6c1828e733bce42512583d43d5bf6691ddc4d6a390daf5e968aed3e95d49b5f5'],
  ['chat-narrative-options-v29', '00d5ed2762917288695b79e23d6c49228306d79709f3d49a7f01f148263ff9d1'],
  ['chat-action-revision-v18', '6c1828e733bce42512583d43d5bf6691ddc4d6a390daf5e968aed3e95d49b5f5'],
])('preserves the registered %s schema and output instruction bytes', (version, hash) => {
  expect(createHash('sha256').update(JSON.stringify(chatActionRequestOptionsV1(version, 'agnes'))).digest('hex')).toBe(hash)
  expect(createHash('sha256').update(JSON.stringify(chatActionOutputRulesV1(version))).digest('hex')).toBe('fb95a5c3b717dff304d9f92c76dddcecc426c378a4eaf7f77d623324b35f293b')
})

it.each([
  ['chat-narrative-action-v40', 'fc81aa9514ec66927cca19a0fe54f8506aa5e3e9baa5058f4ce4d6dc58b6ccc5'],
  ['chat-narrative-options-v30', 'ffd207a7e54acd3512d23246eae056116754d477cea66fa8d0b066cd8c349566'],
  ['chat-action-revision-v19', 'fc81aa9514ec66927cca19a0fe54f8506aa5e3e9baa5058f4ce4d6dc58b6ccc5'],
])('preserves the %s contract actually used by the original Flash and Pro probes', (version, hash) => {
  expect(createHash('sha256').update(JSON.stringify(chatActionRequestOptionsV1(version, 'agnes'))).digest('hex')).toBe(hash)
  expect(createHash('sha256').update(JSON.stringify(chatActionOutputRulesV1(version))).digest('hex')).toBe('852c148e07c807d1d5f70c74d583320c2433f00515342226af66ae05e8ca3957')
})

it('keeps the original review budget when registry defaults change after the run was frozen', async () => {
  const get = skills.getAgentSkillV1
  let upgraded = false
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action-review'
    ? {...get(id), maxOutputTokens: upgraded ? 8000 : 2400}
    : id === 'character.chat-narrative-action' ? {...get(id), promptVersion: 'chat-narrative-action-v37'} : get(id))
  const chat = vi.spyOn(ai, 'chat').mockImplementation(async (_messages, _config, meta) => {
    if (meta?.category === 'runtime.character.chat-narrative-action') {upgraded = true; return JSON.stringify(action)}
    return JSON.stringify(chatActionReviewOutputFixture())
  })
  const result = await generate(await start())
  expect(chat).toHaveBeenCalledTimes(2)
  expect(chat.mock.calls[1][1].maxTokens).toBe(2400)
  expect(result.snapshot.contract.executionBindings).toMatchObject([{maxOutputTokens: 4000}, {maxOutputTokens: 2400}])
  expect(result.snapshot.contract.budget.maxOutputTokens).toBe(6400)
})

it('honors a lower user output cap for choice, expression and review', async () => {
  const chat = mockChat(), f = await start()
  await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard',
    skillId: 'character.chat-narrative-action', objective: '验证用户更小的输出预算', aiConfig: {...config, maxTokens: 1000}})
  expect(chat.mock.calls.map(call => call[1].maxTokens)).toEqual([1000, 1000, 1000])
})

it('does not share mutable schemas between requests and keeps two options as plain action objects', () => {
  const schema = chatActionOutputSchemaV1()
  ;(schema.properties as Record<string, {type: string}>).text.type = 'number'
  expect((chatActionOutputSchemaV1().properties as Record<string, {type: string}>).text.type).toBe('string')
  const options = chatActionRequestOptionsV1('chat-narrative-options-v28', 'agnes')!
  const items = (options.jsonSchema!.schema.properties as Record<string, {items: unknown}>).options.items
  expect(items).toEqual(chatActionOutputSchemaV1())
})

it('applies an explicitly reviewed shared pause atomically without changing another actor goal or allowing a hidden participant', () => {
  const s = createInitialInteractionState(chatNarrativeFixture()), audienceKeys = ['player', 'guard', 'artisan'], text = '我们都先暂停调查，不检查或安排下一步。'
  s.activeScene = {...s.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 1}
  s.remainingDirectorBudget = 100
  s.messages.push({messageId: 'player-stop', eventSequence: 2, role: 'player', speakerKey: 'player', audienceKeys, text, replyToSequence: null, supersededBySequence: null})
  const before = requestChatNarrativeTriggerV1(s, {sequence: 3, kind: 'player-response', sourceEventSequence: 2, seed: null})
  const a: ChatNarrativeActionV1 = {...action, text, audienceKeys, evidenceFactKeys: [], goalStatus: 'paused', nextPossibilities: [],
    threadUpdates: [{threadKey: 'investigate', status: 'paused', evidenceExcerpt: text}], pauseGoal: {threadKey: 'investigate', playerEventSequence: 2, playerExcerpt: text, evidenceExcerpt: text}}
  const apply = (value: ChatNarrativeActionV1) => applyReviewedChatNarrativeActionV1(before, {sequence: 4, triggerSequence: 3, actorKey: 'guard', messageId: 'ack-stop', action: value,
    review: {...chatActionReviewOutputFixture(), reviewedActionJson: canonicalStringify(value)}})
  const held = apply(a)
  expect(held.chatNarrative!.situation.threads[0].status).toBe('paused')
  expect(held.chatNarrative!.situation.goals[0].playerPause?.requested.sequence).toBe(2)
  expect(held.chatNarrative!.situation.goals[1]).toEqual(before.chatNarrative!.situation.goals[1])
  expect(() => apply({...a, audienceKeys: ['player', 'guard']})).toThrow('知情范围')
  expect(before.chatNarrative!.situation.threads[0].status).toBe('open')
})
