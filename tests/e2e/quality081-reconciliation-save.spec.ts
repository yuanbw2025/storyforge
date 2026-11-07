import { expect, test } from '@playwright/test'
import type { ChapterPlanReconciliation, WorkspaceScope } from '../../src/lib/types'

const originalSummary = '作者原有章纲。'
const syncedItem = '主角仍需要核对守卫的证词。'
const dismissedItem = '作者不采纳的偏差。'
const manuscript = '<p>作者保留的章节正文。</p><p>第二段原样保留。🌙e\u0301</p>'
const afterSync = `${originalSummary}\n\n[基于对账更新]\n[待完成] ${syncedItem}`

test('081 saves another reconciliation choice without appending the first item again, including after editor reload', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('SFQA081 requires its isolated loopback workspace')
  const origin = new URL(baseURL)
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)) {
    throw new Error('SFQA081 refuses non-loopback workspace origins')
  }
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  try {
    const modelRequests: string[] = []
    await context.route('**/*', route => {
      const request = route.request()
      const url = new URL(request.url())
      if (/\/chat\/completions|\/(?:responses|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)|\/local-codex\/v1\/requests(?:\/|$)/.test(url.pathname)) {
        modelRequests.push(`${request.method()} ${url.origin}${url.pathname}`)
        return route.abort('blockedbyclient')
      }
      return url.origin === origin.origin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort()
    })
    await context.addInitScript(allowedOrigin => {
      if (location.origin === allowedOrigin) localStorage.setItem('storyforge_guide_completed', 'sfqa081-isolated')
    }, origin.origin)
    const page = await context.newPage()
    await page.goto('./')
    const target = await page.evaluate(async ({ originalSummary, syncedItem, dismissedItem, manuscript }) => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const [{ db }, { seedCurrentWorkspace, addCurrentWorkFixtureV1 }, { stampNewRecord }, { hashChapterText }, { loadChapterPlanSnapshot }] = await Promise.all([
        load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
        load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts'),
        load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts'),
        load<typeof import('../../src/lib/ai/chapter-memory/text-normalization')>('/storyforge/src/lib/ai/chapter-memory/text-normalization.ts'),
        load<typeof import('../../src/lib/ai/chapter-memory/plan-reconciliation')>('/storyforge/src/lib/ai/chapter-memory/plan-reconciliation.ts'),
      ])
      if (await db.projects.count()) throw new Error('Expected fresh isolated IndexedDB')
      const { scope } = await seedCurrentWorkspace('081 作者当前长篇')
      const otherWork = await addCurrentWorkFixtureV1({ projectId: scope.projectId, worldId: scope.worldId,
        create: { title: '081 同一项目的另一长篇', kind: 'novel', novelProfile: 'long' } })
      if (!otherWork.id || otherWork.id === scope.workId) throw new Error('Expected a separate Work in the same Project/World')
      async function seedChapter(owner: WorkspaceScope, summary: string, content: string) {
        const outlineNodeId = await db.outlineNodes.add(stampNewRecord(owner, 'outlineNodes', {
          projectId: owner.projectId, parentId: null, type: 'chapter', title: '第一章', summary,
          order: 0, createdAt: 1, updatedAt: 1,
        }, { owner: 'work' }))
        const chapterId = await db.chapters.add(stampNewRecord(owner, 'chapters', {
          projectId: owner.projectId, outlineNodeId, title: '第一章', content, wordCount: 12,
          status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1,
        }, { owner: 'work' }))
        return { outlineNodeId, chapterId }
      }
      const active = await seedChapter(scope, originalSummary, manuscript)
      const other = await seedChapter({ ...scope, workId: otherWork.id }, '另一作品章纲不能修改。', '<p>另一作品正文不能修改。</p>')
      const report: ChapterPlanReconciliation = {
        chapterId: active.chapterId, sourceTextHash: await hashChapterText(manuscript),
        planSourceHash: (await loadChapterPlanSnapshot(scope.projectId, active.chapterId, scope)).planSourceHash,
        schemaVersion: 1, extractorVersion: '081-browser-fixture', textNormalizationVersion: 'v1',
        completedGoals: [], unfinishedGoals: [{ text: syncedItem, evidenceQuotes: [] }],
        deviations: [{ text: dismissedItem, evidenceQuotes: [] }], newConstraints: [], nextChapterImpacts: [],
        reviewStatus: 'pending', generatedAt: 1,
      }
      if (await db.chapters.update(active.chapterId, { planReconciliation: report }) !== 1) {
        throw new Error('Expected current chapter to own the seeded review')
      }
      const foreign = { chapter: await db.chapters.get(other.chapterId), outline: await db.outlineNodes.get(other.outlineNodeId) }
      if (!foreign.chapter || !foreign.outline) throw new Error('Expected both foreign Work rows')
      return { projectId: scope.projectId, active, other, foreign }
    }, { originalSummary, syncedItem, dismissedItem, manuscript })

    const read = () => page.evaluate(async ({ active, other }) => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const chapter = await db.chapters.get(active.chapterId)
      return { summary: (await db.outlineNodes.get(active.outlineNodeId))?.summary, content: chapter?.content,
        actions: chapter?.planReconciliation?.actions, sync: chapter?.planReconciliation?.outlineSync,
        foreign: { chapter: await db.chapters.get(other.chapterId), outline: await db.outlineNodes.get(other.outlineNodeId) } }
    }, { active: target.active, other: target.other })

    await page.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.active.outlineNodeId}`)
    const editor = page.locator('.tiptap-editor')
    await expect(editor).toContainText('第二段原样保留。')
    await expect(page.getByText('📊 计划—正文对账', { exact: true })).toBeVisible()
    // The paragraph and its icon buttons are sibling groups within the same row.
    const first = page.getByText(syncedItem, { exact: true }).locator('../..')
    const second = page.getByText(dismissedItem, { exact: true }).locator('../..')
    const save = page.getByRole('button', { name: /^保存更改/ })
    const firstActions = { 'unfinishedGoals:apply': { action: 'apply', indices: [0] } }
    const bothActions = { ...firstActions, 'deviations:dismiss': { action: 'dismiss', indices: [0] } }

    await first.getByTitle('同步到章纲，AI 后续会重点参考（高权重）', { exact: true }).click()
    await save.click()
    await expect.poll(read).toMatchObject({ summary: afterSync, content: manuscript, actions: firstActions,
      sync: { appliedItemKeys: ['unfinishedGoals:0'] } })
    const firstCommit = await read()
    expect(firstCommit.actions).toEqual(firstActions)
    await expect(page.getByText('有未保存更改', { exact: true })).toHaveCount(0)
    await expect(first.getByText('已同步', { exact: true })).toBeVisible()

    await second.getByTitle('排除此条目，AI 可能不会重点参考', { exact: true }).click()
    await save.click()
    await expect.poll(read).toEqual({ summary: afterSync, content: manuscript, actions: bothActions,
      sync: firstCommit.sync, foreign: target.foreign })

    await page.reload()
    await expect(editor).toContainText('第二段原样保留。')
    await expect(first.getByText('已同步', { exact: true })).toBeVisible()
    await expect(second.getByText('已排除', { exact: true })).toBeVisible()
    expect(await read()).toEqual({ summary: afterSync, content: manuscript, actions: bothActions,
      sync: firstCommit.sync, foreign: target.foreign })
    expect(modelRequests).toEqual([])
  } finally {
    await context.close()
  }
})
