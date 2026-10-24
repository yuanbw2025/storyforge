import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {chatStructuredWorldRulesFixture, seedChatBackgroundSourceFixture} from '../helpers/chat-background-source'
import {confirmChatSourceReviewV1, readChatDraftV1, saveChatDraftV1} from '../../src/lib/character-interaction/draft-service'
import {DEFAULT_CHAT_NARRATIVE_SETUP_V1} from '../../src/lib/character-interaction/narrative-setup'
import {readChatSourceReviewContextV1} from '../../src/lib/character-interaction/source-review-context'
import {generateChatSourceReviewSuggestionsV1, readLatestChatSourceReviewRunV1, recoverChatSourceReviewRunV1} from '../../src/lib/character-interaction/source-review-harness'
import {parseChatSourceSuggestionsV1} from '../../src/lib/character-interaction/source-review-suggestions'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {assembleContext} from '../../src/lib/registry/assemble-context'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

async function fixture() {
  const f = await seedChatBackgroundSourceFixture(chatStructuredWorldRulesFixture())
  const actor = f.projection.characters.find(row => row.label === '林舟')!
  const other = f.projection.characters.find(row => row.label === '守潮人')!
  const own = actor.fragments.find(row => row.pointer === '/personality')!
  const observed = other.fragments.find(row => row.pointer === '/personality')!
  const hidden = actor.fragments.find(row => row.pointer === '/background')!
  for (const decision of f.review.classifications) {
    decision.visibility = [own.fragmentKey, observed.fragmentKey].includes(decision.fragmentKey) ? 'participants' : 'author-only'
    decision.audienceKeys = decision.visibility === 'participants' ? [actor.resourceKey] : []
    decision.purpose = decision.fragmentKey === own.fragmentKey ? 'motivation' : 'knowledge'
  }
  const draft = await confirmChatSourceReviewV1(f.scope, f.draft.revision, f.review)
  const request = {draftRevision: draft.revision, projectionHash: f.projection.projectionHash, fragmentKeys: [own.fragmentKey, observed.fragmentKey], actorKey: actor.resourceKey}
  return {...f, draft, actor, other, own, observed, hidden, request}
}

it('reads only known selected passages and strips author labels and all permission metadata', async () => {
  const f = await fixture(), before = await db.chatAuthoringDrafts.toArray()
  const assembled = await assembleContext({projectId: f.scope.projectId, scope: f.scope, sourceKeys: ['chat.source-review'], chatSourceReviewRequest: f.request})
  const context = JSON.parse(assembled.segments[0].content)
  expect(context.perspective).toEqual({actorKey: f.actor.resourceKey})
  expect(context.fragments).toHaveLength(2)
  expect(context.fragments.every((row: {confirmedClassification: unknown}) => row.confirmedClassification === null)).toBe(true)
  expect(context.fragments.find((row: {fragmentKey: string}) => row.fragmentKey === f.own.fragmentKey).knownPurpose).toBe('motivation')
  for (const excluded of ['authorLabel', 'audienceKeys', 'discovery', '林舟', '守潮人', '熟悉潮汐钟结构', '失踪船队的名册']) expect(assembled.text).not.toContain(excluded)
  expect(await db.chatAuthoringDrafts.toArray()).toEqual(before)
  const single = await readChatSourceReviewContextV1(f.scope, {...f.request, fragmentKeys: [f.own.fragmentKey]})
  expect(single.cast).toEqual([{resourceKey: f.actor.resourceKey, role: 'actor'}])
})

it('refuses one unread passage atomically before creating a run or calling the model', async () => {
  const f = await fixture(), runAI = vi.fn(async () => '{}')
  const before = await db.agentRuns.count()
  await expect(generateChatSourceReviewSuggestionsV1({scope: f.scope, request: {...f.request, fragmentKeys: [...f.request.fragmentKeys, f.hidden.fragmentKey]}, runAI})).rejects.toThrow('尚未获准知道')
  expect(runAI).not.toHaveBeenCalled()
  expect(await db.agentRuns.count()).toBe(before)
  const authorRequest = {draftRevision: f.request.draftRevision, projectionHash: f.request.projectionHash, fragmentKeys: [f.hidden.fragmentKey]}
  expect((await readChatSourceReviewContextV1(f.scope, authorRequest)).fragments[0].valueJson).toContain('熟悉潮汐钟结构')
  for (const actorKey of ['', undefined, 'player', f.other.resourceKey, 'foreign']) {
    await expect(readChatSourceReviewContextV1(f.scope, {...f.request, actorKey})).rejects.toThrow()
  }
})

it('requires saved decisions and rechecks knowledge revocation before model dispatch', async () => {
  const f = await seedChatBackgroundSourceFixture()
  const actor = f.projection.characters[0], fragment = actor.fragments[0]
  const request = {draftRevision: f.draft.revision, projectionHash: f.projection.projectionHash, fragmentKeys: [fragment.fragmentKey], actorKey: actor.resourceKey}
  await expect(readChatSourceReviewContextV1(f.scope, request)).rejects.toThrow('先确认并保存')
  const ready = await fixture(), call = vi.fn(async () => '{}')
  await expect(generateChatSourceReviewSuggestionsV1({scope: ready.scope, request: ready.request, runAI: call, onBoundary: async step => {
    if (step === 'prepared') {
      const review = structuredClone(ready.review)
      const decision = review.classifications.find(row => row.fragmentKey === ready.own.fragmentKey)!
      decision.visibility = 'author-only'; decision.audienceKeys = []
      await confirmChatSourceReviewV1(ready.scope, ready.draft.revision, review)
    }
  }})).rejects.toThrow('方案已变化')
  expect(call).not.toHaveBeenCalled()
})

it('keeps another person as the subject instead of suggesting their traits as the viewing actor identity', async () => {
  const f = await fixture(), context = await readChatSourceReviewContextV1(f.scope, f.request)
  const output = {suggestions: [
    {fragmentKey: f.own.fragmentKey, purpose: 'motivation', interpretation: '本人的顾虑。', caution: 'ordinary', evidenceQuotes: ['谨慎而固执']},
    {fragmentKey: f.observed.fragmentKey, purpose: 'knowledge', interpretation: '对另一人物性格的了解，不是本人的性格。', caution: 'ordinary', evidenceQuotes: ['克制而多疑']},
  ]}
  expect(parseChatSourceSuggestionsV1(JSON.stringify(output), context).suggestions).toHaveLength(2)
  for (const purpose of ['identity', 'motivation', 'voice']) {
    const invalid = structuredClone(output); invalid.suggestions[1].purpose = purpose
    expect(() => parseChatSourceSuggestionsV1(JSON.stringify(invalid), context)).toThrow('其他人物资料')
  }
})

it('omits author discovery conditions even on known material and does not treat discovery permission as knowledge', async () => {
  const f = await fixture()
  const narrative = structuredClone(DEFAULT_CHAT_NARRATIVE_SETUP_V1)
  narrative.permissions.maxDiscoveriesPerSituation = 1
  const upgraded = await saveChatDraftV1(f.scope, f.draft.revision, {...f.settings, version: 3, narrative, sourceReview: f.review})
  const review = structuredClone(f.review)
  const prerequisite = review.classifications.find(row => row.fragmentKey === f.observed.fragmentKey)!
  prerequisite.visibility = 'public'; prerequisite.audienceKeys = []
  const secret = review.classifications.find(row => row.fragmentKey === f.hidden.fragmentKey)!
  secret.visibility = 'participants'; secret.audienceKeys = [f.actor.resourceKey]
  secret.discovery = {actorKeys: [f.other.resourceKey], condition: '作者暗号：蓝印会暴露师父身份', prerequisiteFragmentKeys: [f.observed.fragmentKey]}
  const saved = await confirmChatSourceReviewV1(f.scope, upgraded.revision, review)
  const request = {...f.request, draftRevision: saved.revision, fragmentKeys: [f.hidden.fragmentKey]}
  const context = await readChatSourceReviewContextV1(f.scope, request)
  expect(context.fragments[0].valueJson).toContain('熟悉潮汐钟结构')
  expect(JSON.stringify(context)).not.toContain('蓝印')
  expect(JSON.stringify(context)).not.toContain('discovery')
  await expect(readChatSourceReviewContextV1(f.scope, {...request, actorKey: f.other.resourceKey})).rejects.toThrow('尚未获准知道')
})

it('retains the actor-limited context through recovery and project import without granting knowledge', async () => {
  const f = await fixture()
  const output = {suggestions: [
    {fragmentKey: f.own.fragmentKey, purpose: 'motivation', interpretation: '本人的顾虑。', caution: 'ordinary', evidenceQuotes: ['谨慎而固执']},
    {fragmentKey: f.observed.fragmentKey, purpose: 'knowledge', interpretation: '另一人的性格。', caution: 'ordinary', evidenceQuotes: ['克制而多疑']},
  ]}
  const call = vi.fn(async () => JSON.stringify(output))
  const view = await generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, runAI: call})
  expect(view.status).toBe('ready')
  expect(await readChatDraftV1(f.scope)).toEqual(f.draft)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const draft = (await db.chatAuthoringDrafts.where('projectId').equals(projectId).first())!
  const scope = {projectId, worldId: draft.worldId, workId: draft.workId}
  const pending = (await readLatestChatSourceReviewRunV1(scope))!
  expect(pending.status).toBe('pending')
  const recovered = await recoverChatSourceReviewRunV1(scope, pending.runId)
  expect(recovered.status).toBe('ready'); expect(recovered.result).toEqual(view.result); expect(recovered.context).toEqual(view.context)
  expect(call).toHaveBeenCalledTimes(1)
})
