import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {assembleContext} from '../../src/lib/registry/assemble-context'
import {CONTEXT_SOURCE_BY_KEY} from '../../src/lib/registry/context-sources'
import {AtomicContextSourceBudgetErrorV1} from '../../src/lib/registry/types'
import {readChatSourceReviewContextV1, type ChatSourceReviewContextV1, type ChatSourceReviewRequestV1} from '../../src/lib/character-interaction/source-review-context'
import * as drafts from '../../src/lib/character-interaction/draft-service'
import {chatProjectionResourcesV1} from '../../src/lib/character-interaction/source-projection'
import {chatStructuredWorldRulesFixture, seedChatBackgroundSourceFixture} from '../helpers/chat-background-source'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

async function fixture() {
  const f = await seedChatBackgroundSourceFixture(chatStructuredWorldRulesFixture())
  const rules = f.projection.background!.find(row => row.resourceKind === 'world-rules')!
  const selected = rules.fragments.find(row => row.pointer === '/entries/harbor~1public/fictionalAdaptations')!
  const hidden = rules.fragments.find(row => row.pointer === '/entries/harbor~1private')!
  const request: ChatSourceReviewRequestV1 = {draftRevision: f.draft.revision, projectionHash: f.projection.projectionHash, fragmentKeys: [selected.fragmentKey]}
  return {...f, rules, selected, hidden, request}
}

it('delivers only the selected frozen text with original provenance and exact registry evidence, without writes', async () => {
  const f = await fixture()
  const before = await Promise.all(db.tables.map(async table => [table.name, await table.toArray()]))
  const assembled = await assembleContext({projectId: f.scope.projectId, scope: f.scope, sourceKeys: ['chat.source-review'], chatSourceReviewRequest: f.request, inputBudgetTokens: 20_000})
  expect(assembled.included).toEqual(['chat.source-review'])
  expect(assembled.trimmed).toEqual([])
  expect(assembled.overBudgetAfterTrim).toBe(false)
  const context = JSON.parse(assembled.segments[0].content) as ChatSourceReviewContextV1
  expect(context).toMatchObject({audience: 'author-only', draftRevision: f.draft.revision, projectionHash: f.projection.projectionHash,
    worldReferenceHash: f.projection.worldReferenceHash, worldReleaseHash: f.projection.worldReleaseHash,
    fragments: [{...f.selected, sourceHash: f.rules.sourceHash, resourceKind: 'world-rules', confirmedClassification: null}]})
  expect(context.fragments).toHaveLength(1)
  expect(assembled.text).toContain('末段规则：蓝铃响起时先检查水尺')
  expect(assembled.text).not.toContain('失踪船队的名册')
  expect(assembled.text).not.toContain('蓝色柜')
  expect(assembled.sourceEvidence).toEqual([expect.objectContaining({key: 'chat.source-review', delivery: 'full', sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/), originalCharacters: assembled.segments[0].content.length, inputCharacters: assembled.segments[0].content.length})])
  expect(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()]))).toEqual(before)
})

it('requires an explicit selection and rejects malformed, duplicate, empty or foreign fragments', async () => {
  const f = await fixture()
  const assembled = await assembleContext({projectId: f.scope.projectId, scope: f.scope, sourceKeys: ['chat.source-review']})
  expect(assembled.included).toEqual([])
  expect(assembled.omitted).toEqual(['chat.source-review'])
  for (const change of [
    {fragmentKeys: []}, {fragmentKeys: [f.selected.fragmentKey, f.selected.fragmentKey]},
    {fragmentKeys: ['foreign#/secret']}, {fragmentKeys: Array(2001).fill('x')},
    {draftRevision: -1}, {draftRevision: 1.5}, {projectionHash: 'invalid'}, {extra: 'untrusted'},
  ]) await expect(readChatSourceReviewContextV1(f.scope, {...f.request, ...change})).rejects.toThrow()
})

it('refuses stale projections, changed settings and a draft outside the owning Work', async () => {
  const f = await fixture(), other = await drafts.createChatDraftV2('另一作品')
  await expect(readChatSourceReviewContextV1({...f.scope, workId: other.scope.workId}, f.request)).rejects.toThrow()
  await expect(readChatSourceReviewContextV1(f.scope, {...f.request, projectionHash: 'f'.repeat(64)})).rejects.toThrow('来源投影已变化')
  await drafts.saveChatDraftV1(f.scope, f.draft.revision, {...f.settings, playerRole: '修改后的作者角色'})
  await expect(readChatSourceReviewContextV1(f.scope, f.request)).rejects.toThrow('方案已变化')
})

it('rejects a settings change during the frozen world read instead of returning mixed versions', async () => {
  const f = await fixture(), original = drafts.loadChatSourceProjectionV1
  vi.spyOn(drafts, 'loadChatSourceProjectionV1').mockImplementationOnce(async (...args) => {
    const projection = await original(...args)
    await drafts.saveChatDraftV1(f.scope, f.draft.revision, {...f.settings, playerRole: '另一页刚修改的角色'})
    return projection
  })
  await expect(readChatSourceReviewContextV1(f.scope, f.request)).rejects.toThrow('读取期间方案已变化')
})

it('freezes the author selection before awaits and carries long-text offsets without sibling contents', async () => {
  const f = await fixture(), original = drafts.loadChatSourceProjectionV1
  const passage = f.rules.fragments.find(row => row.textRange)!
  f.request.fragmentKeys = [passage.fragmentKey]
  vi.spyOn(drafts, 'loadChatSourceProjectionV1').mockImplementationOnce(async (...args) => {
    f.request.fragmentKeys.push(f.hidden.fragmentKey)
    return original(...args)
  })
  const context = await readChatSourceReviewContextV1(f.scope, f.request)
  expect(context.fragments).toEqual([{...passage, sourceHash: f.rules.sourceHash, resourceKind: 'world-rules', confirmedClassification: null}])
  expect(JSON.stringify(context)).not.toContain('失踪船队的名册')
})

it('keeps source review atomic under a small budget and never calls a compressor to drop source evidence', async () => {
  const f = await fixture(), transformer = vi.fn()
  expect(CONTEXT_SOURCE_BY_KEY.get('chat.source-review')?.atomic).toBe(true)
  await expect(assembleContext({projectId: f.scope.projectId, scope: f.scope, sourceKeys: ['chat.source-review'], chatSourceReviewRequest: f.request,
    inputBudgetTokens: 64, sourceTransformer: transformer})).rejects.toBeInstanceOf(AtomicContextSourceBudgetErrorV1)
  expect(transformer).not.toHaveBeenCalled()
})

it('includes selected author-private material only for author review and preserves its prior decision across export/import', async () => {
  const f = await fixture()
  const decision = f.review.classifications.find(row => row.fragmentKey === f.hidden.fragmentKey)!
  decision.visibility = 'author-only'
  const saved = await drafts.confirmChatSourceReviewV1(f.scope, f.draft.revision, f.review)
  const request = {...f.request, draftRevision: saved.revision, fragmentKeys: [f.hidden.fragmentKey]}
  const original = await readChatSourceReviewContextV1(f.scope, request)
  expect(original.fragments[0].confirmedClassification).toEqual(decision)
  expect(original.fragments[0].valueJson).toContain('失踪船队的名册')
  expect(original.audience).toBe('author-only')
  const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.chatAuthoringDrafts.where('projectId').equals(importedId).first())!
  expect(await readChatSourceReviewContextV1({projectId: importedId, worldId: imported.worldId, workId: imported.workId}, request)).toEqual(original)
  const unchanged = await drafts.readChatDraftV1(f.scope)
  expect(unchanged).toEqual(saved)
})

it('uses canonical source ordering for a set of selected passages, independent of click order', async () => {
  const f = await fixture()
  const keys = chatProjectionResourcesV1(f.projection).flatMap(row => row.fragments).slice(0, 3).map(row => row.fragmentKey)
  const forward = await readChatSourceReviewContextV1(f.scope, {...f.request, fragmentKeys: keys})
  expect(await readChatSourceReviewContextV1(f.scope, {...f.request, fragmentKeys: [...keys].reverse()})).toEqual(forward)
})
