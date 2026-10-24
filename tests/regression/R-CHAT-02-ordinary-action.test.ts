import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {createHash} from 'node:crypto'
import {db} from '../../src/lib/db/schema'
import {adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {branchProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, startInteractionScene} from '../../src/lib/character-interaction/runtime-api'
import {chatNarrativeShellV1} from '../../src/lib/character-interaction/narrative-production'
import {interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {chatActionPromptRulesV1} from '../../src/lib/character-interaction/narrative-action-prompt'
import {buildChatActionChoiceMessagesV1} from '../../src/lib/character-interaction/action-choice-contract'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, chatNarrativeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {seedCurrentProductBuild} from '../helpers/current-product-build'
import {currentProductSelection, loadCurrentProductWorldSourceCatalogV1, seedCurrentProductWorld} from '../helpers/current-product-world'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'
import type {ProductRuntimePackageV1} from '../../src/lib/types'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function command(sessionId: number) {const v = await readProductRuntimeStateVersion(sessionId); return {sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}

async function prepared() {
  const {scope, release} = await seedCurrentProductWorld('CHAT ordinary self-action boundary')
  const catalog = await loadCurrentProductWorldSourceCatalogV1({scope, worldReleaseId: release.id!, productType: 'character-interaction'})
  const keys = catalog.characters.slice(0, 2).map(c => c.resourceKey), interaction = chatNarrativeFixture(release.contentHash, keys)
  interaction.sceneTemplates[0].participantKeys = ['guard']
  const story = interaction.chatNarrative!, initial = story.initialSituation
  story.permissions.allowActorSituationExpansion = true
  initial.facts.push({factKey: 'cup-and-table', text: '叶岑把自己的空茶杯拿在手里，面前是一张空置、稳固且可用的公用桌子。', audienceKeys: ['player', 'guard'], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  initial.goals = [{goalKey: 'set-down-cup', actorKey: 'guard', desire: '放好自己的茶杯，腾出双手', concern: '不碰旅人的物品', boundary: '只处理自己的杯子', evidenceFactKeys: ['cup-and-table'], status: 'active', updatedSequence: 0}]
  initial.threads = [{threadKey: 'free-hands', title: '放好茶杯', question: '如何腾出双手？', audienceKeys: ['player', 'guard'], participantKeys: ['guard'], evidenceFactKeys: ['cup-and-table'], closureSignals: ['自己的茶杯已放稳，双手空出'], status: 'open', updatedSequence: 0}]
  initial.beliefs = []; initial.possibilities = []
  const {schema: _schema, version: _version, ...narrative} = chatNarrativeShellV1(story)
  const runtimePackage: ProductRuntimePackageV1 = {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'character-interaction',
    definition: {productKey: 'chat.ordinary-action.contract', title: '普通自身行动工程核验', description: '工程夹具，不是模型体验证据', enabledCapabilities: ['narrative', 'interaction'], rulesetVersion: 1, initialVariables: {}},
    sourceWorld: {contentHash: release.contentHash, selection: currentProductSelection('character-interaction', {participants: keys}, catalog.worldReference.referenceHash)}, narrative, interaction,
  }
  const {session} = await seedCurrentProductBuild({scope, worldRelease: release as typeof release & {id: number}, runtimePackage, title: '整理桌面'})
  const scene = await startInteractionScene({...await command(session.id!), sceneId: 'ordinary.current', sceneKey: 'inn'})
  await requestChatNarrativeTrigger({...await command(session.id!), kind: 'scene-start', sourceEventSequence: scene.sequence})
  return {scope, sessionId: session.id!}
}
const text = '叶岑把自己手中的空茶杯放稳在面前的公用桌面上，松开手，空出双手。'
function action(): ChatNarrativeActionV1 {
  return {kind: 'complete', text, goalKey: 'set-down-cup', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['cup-and-table'], waitingForPlayer: false,
    newFacts: [{factKey: 'cup-set-down', kind: 'observation', text, evidenceFactKeys: ['cup-and-table'], evidenceExcerpt: text}], disclosures: [],
    goalStatus: 'fulfilled', nextPossibilities: [], threadUpdates: [{threadKey: 'free-hands', status: 'resolved', evidenceExcerpt: text}], situationRequest: null}
}

it('can complete an authorized ordinary self-action in the existing three-call chain and restore it without a situation run', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray()
  const generate = vi.fn(withChatActionChoiceFixture(async () => JSON.stringify(action())))
  const review = vi.fn(async () => JSON.stringify(chatActionReviewOutputFixture()))
  const result = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '按自己的目标继续', runAI: generate, runReviewAI: review})
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
  const after = await readProductRuntimeState(f.sessionId), story = after.interaction!.chatNarrative!
  expect(generate).toHaveBeenCalledTimes(2); expect(review).toHaveBeenCalledTimes(1)
  expect(story.situation.goals[0].status).toBe('fulfilled')
  expect(story.situation.threads[0].status).toBe('resolved')
  expect(story.pendingSituation).toBeUndefined()
  expect(story.situation.facts.find(fact => fact.factKey === 'secret')).toEqual(before.interaction!.chatNarrative!.situation.facts.find(fact => fact.factKey === 'secret'))
  expect(await db.agentRuns.where('productRuntimeSessionId').equals(f.sessionId).count()).toBe(1)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: '已放下的杯子'})
  const branched = (await readProductRuntimeState(branch.id!)).interaction!
  const importedProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productRuntimeSessions.where('projectId').equals(importedProject).toArray()).find(session => session.title === branch.title)!
  db.close(); await db.open()
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched)
  expect(await db.worldReleases.where('projectId').equals(f.scope.projectId).toArray()).toEqual(worlds)
  expect(generate).toHaveBeenCalledTimes(2); expect(review).toHaveBeenCalledTimes(1)
})

it.each(['permissions', 'visibility', 'player-agency'])('retains independent refusal and performs no automatic repair when %s fails', async check => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId)
  const generate = vi.fn(withChatActionChoiceFixture(async () => JSON.stringify(action())))
  const review = vi.fn(async () => JSON.stringify({checks: chatActionReviewOutputFixture().checks.map(row => ({...row, passed: row.check !== check}))}))
  let runId = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '保留独立否决', runAI: generate, runReviewAI: review, onRunCreated: id => {runId = id}})).rejects.toThrow('语义审查未通过')
  await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
  db.close(); await db.open()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  expect((await db.agentRuns.get(runId))?.status).toBe('failed')
  expect(generate).toHaveBeenCalledTimes(2); expect(review).toHaveBeenCalledTimes(1)
})

it('preserves the pre-change V62 selection and action guidance byte for byte', async () => {
  const f = await prepared(), state = await readProductRuntimeState(f.sessionId), view = interactionVisibilityView(state.interaction!, 'guard')
  const selection = buildChatActionChoiceMessagesV1([{role: 'system', content: '历史表达规则'}, {role: 'user', content: '固定的角色可见输入'}], 'chat-narrative-action-v62')
  const rules = chatActionPromptRulesV1(view, {producerVersion: 'chat-narrative-action-v62', actionKind: true, replanning: true, playerDecision: true})
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  expect(hash(selection)).toBe('cb99e4a68a0a462dc105e9001a6cab0ca474c625c6374d5ebbc5531da3453581')
  expect(hash(rules)).toBe('67e64ddacd5e0d8fb0ad164e6364f4193e88d4fc5f519ec066b5ba2cf3f08afc')
  expect(selection[1].content).toBe('固定的角色可见输入')
  expect(rules.join('\n')).not.toContain('未写定失败不等于保证成功')
})


it('limits the clarification to new generators, using the same actor input and no preserved-author rewrite', async () => {
  const f = await prepared(), state = await readProductRuntimeState(f.sessionId), view = interactionVisibilityView(state.interaction!, 'guard')
  const input = [{role: 'system' as const, content: '表达规则'}, {role: 'user' as const, content: '只有角色可见资料'}]
  const choice = buildChatActionChoiceMessagesV1(input, 'chat-narrative-action-v63')
  expect(choice[1]).toEqual(input[1])
  expect(choice[0].content).toContain('unconfirmedConditions 只列确实影响本步')
  expect(choice[0].content).toContain('独立审查决定能否采用')
  for (const producerVersion of ['chat-narrative-action-v63', 'chat-narrative-options-v39', 'chat-narrative-action-v64', 'chat-narrative-action-v65', 'chat-narrative-action-v66', 'chat-narrative-action-v67', 'chat-narrative-options-v40']) {
    expect(chatActionPromptRulesV1(view, {producerVersion}).join('\n')).toContain('不要求先有一条“已经做完”的历史记录')
    expect(chatActionPromptRulesV1(view, {producerVersion, preserveExpression: true}).join('\n')).not.toContain('不要求先有一条“已经做完”的历史记录')
  }
  for (const producerVersion of ['chat-narrative-action-v62', 'chat-narrative-options-v38', 'chat-action-revision-v23', 'chat-narrative-action-v73']) {
    expect(chatActionPromptRulesV1(view, {producerVersion}).join('\n')).not.toContain('不要求先有一条“已经做完”的历史记录')
  }
})

it('still rejects a hidden fact reference before review or adoption', async () => {
  const f = await prepared(), before = await readProductRuntimeState(f.sessionId), invalid = action()
  invalid.evidenceFactKeys = ['secret']; invalid.newFacts[0].evidenceFactKeys = ['secret']
  const generate = vi.fn(withChatActionChoiceFixture(async () => JSON.stringify(invalid)))
  const review = vi.fn(async () => JSON.stringify(chatActionReviewOutputFixture()))
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '不得借普通动作推定隐情', runAI: generate, runReviewAI: review})).rejects.toThrow()
  expect(review).not.toHaveBeenCalled()
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
})
