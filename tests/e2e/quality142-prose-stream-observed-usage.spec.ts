// Isolated synthetic stream acceptance; no real provider or author storage.
import { expect, test, type Page } from '@playwright/test'
import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1,
  reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'

interface Seed { scope: { projectId: number; worldId: number; workId: number }; chapterId: number; target: string }

async function seed(page: Page): Promise<Seed> {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    if (await db.projects.count()) throw new Error('142 requires empty isolated storage')
    const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
    const { stampNewRecord } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    const { resolveLongformChapterNavigationV1 } = await load<typeof import('../../src/lib/authoring/longform-chapter-navigation')>('/storyforge/src/lib/authoring/longform-chapter-navigation.ts')
    const f = await createWorkspace({ name: 'QUALITY142正文用量', genres: ['realism'], description: '', status: 'drafting', targetWordCount: 10_000 },
      { kind: 'novel', novelProfile: 'long' })
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', {
      projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '收店', summary: '店主收好工具后关灯。',
      order: 0, createdAt: 1, updatedAt: 1,
    }, { owner: 'work' })) as number
    const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', {
      projectId: f.scope.projectId, outlineNodeId, title: '收店', content: '<p></p>', wordCount: 0, status: 'draft', order: 0,
      notes: '', createdAt: 1, updatedAt: 1,
    }, { owner: 'work' })) as number
    await db.detailedOutlines.add(stampNewRecord(f.scope, 'detailedOutlines', {
      projectId: f.scope.projectId, outlineNodeId, scenes: [{ sceneId: 'closing', title: '收店', summary: '店主收好工具后关灯。',
        characterIds: [], conflict: '', location: '小店', pace: 'slow', estimatedWords: 500, notes: '' }], createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    const target = await resolveLongformChapterNavigationV1({ scope: f.scope, module: 'chapters-list', outlineNodeId })
    return { scope: f.scope, chapterId, target }
  })
}

async function receipt(page: Page, item: Seed) {
  return page.evaluate(async input => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { readAgentRunV1 } = await load<typeof import('../../src/lib/agent/run/event-store')>('/storyforge/src/lib/agent/run/event-store.ts')
    const { readAgentRunArtifactExactV1 } = await load<typeof import('../../src/lib/memory/artifact-store')>('/storyforge/src/lib/memory/artifact-store.ts')
    const runs = await db.agentRuns.where('workId').equals(input.scope.workId).toArray()
    const row = runs.find(value => JSON.parse(value.contractJson).executionBindings?.some((binding: { stepId: string }) => binding.stepId === 'prose-generation'))
    if (!row?.id) return null
    const run = await readAgentRunV1(input.scope, row.id)
    const event = [...run.events].reverse().find(value => value.type === 'evidence.artifact.recorded'
      && value.payload.stepId === 'prose-generation' && value.payload.attempt === 1 && value.payload.artifactKind === 'raw-response')
    if (!event || event.type !== 'evidence.artifact.recorded') return null
    const raw = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId,
      artifactKind: 'raw-response', contentHash: event.payload.contentHash }))
    return { runId: row.id, step: run.projection.steps['prose-generation']?.status, attempt: event.payload.attempt,
      hash: event.payload.contentHash, raw, chapter: (await db.chapters.get(input.chapterId))?.content,
      settled: run.events.filter(value => value.type === 'budget.settled' && value.payload.stepId === 'prose-generation') }
  }, item)
}

for (const terminal of ['complete', 'interrupted'] as const) {
  test(`142 actual editor ${terminal} retains observed metering after reload without redispatch`, async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error('142 requires isolated loopback')
    const base = new URL(baseURL)
    if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('142 refuses author/external origins')
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
    let calls = 0
    const forbidden: string[] = []
    const output = '店主把工具逐件收进铁盒，检查门窗，最后熄灭了门边的灯。'
    registerBrowserFixtureAIConfigV1(context, { provider: 'agnes', model: 'agnes-2.5-flash', baseUrl: `${base.origin}/quality142-provider/v1`,
      apiKey: 'quality142-synthetic-only', temperature: 0, maxTokens: 1000 })
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url())
      if (url.origin === base.origin && url.pathname.startsWith('/quality142-provider/') && request.method() === 'POST') {
        calls++
        const body = request.postDataJSON() as { stream?: boolean }
        if (!body.stream || calls > 1) throw new Error('142 unexpected additional model dispatch')
        const events = [{ usage: { prompt_tokens: 31, completion_tokens: 2, total_tokens: 33 } },
          { choices: [{ delta: { content: output }, ...(terminal === 'complete' ? { finish_reason: 'stop' } : {}) }],
            usage: { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 } }]
        await route.fulfill({ contentType: 'text/event-stream', body: events.map(value => `data: ${JSON.stringify(value)}\n\n`).join('')
          + (terminal === 'complete' ? 'data: [DONE]\n\n' : '') })
      } else if (url.origin === base.origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
      else { forbidden.push(`${request.method()} ${url.origin}`); await route.abort() }
    })
    try {
      await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality142-isolated'))
      const page = await context.newPage()
      await gotoWithBrowserFixtureAIConfigV1(page, './')
      const item = await seed(page)
      await gotoWithBrowserFixtureAIConfigV1(page, `./${item.target.replace(/^\//, '')}`)
      await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
      await page.getByRole('dialog', { name: '正文生成提示' }).getByRole('button', { name: '开始生成', exact: true }).click()
      await expect.poll(async () => (await receipt(page, item))?.step).toBe(terminal === 'complete' ? 'awaiting_confirmation' : 'failed')
      const before = (await receipt(page, item))!
      expect(before.attempt).toBe(1)
      expect(before.raw.observedUsage).toEqual({ inputTokens: 31, outputTokens: 7, totalTokens: 38 })
      expect(before.chapter).toBe('<p></p>')
      expect(calls).toBe(1)
      await reloadWithBrowserFixtureAIConfigV1(page, { waitUntil: 'domcontentloaded' })
      await expect.poll(async () => (await receipt(page, item))?.hash).toBe(before.hash)
      expect((await receipt(page, item))?.raw.observedUsage).toEqual(before.raw.observedUsage)
      // Verify recovered author-visible metering as well as the exact receipt.
      await expect(page.getByTitle('输入 31 + 输出 7', { exact: true })).toBeVisible()
      expect(calls).toBe(1); expect(forbidden).toEqual([])
    } finally { await context.close() }
  })
}
