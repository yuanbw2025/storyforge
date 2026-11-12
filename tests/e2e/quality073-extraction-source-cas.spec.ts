import { expect, test } from '@playwright/test'

for (const kind of ['inventory', 'timeline'] as const) {
  test(`SFQA073 ${kind}: native partial recovery stops stale input and receipt-only recovery remains idempotent`, async ({ page, context }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', route => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
    await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'sfqa073'))
    await page.goto('./')
    await page.waitForFunction(() => Boolean(document.querySelector('#root')?.childElementCount))
    const interrupted = await page.evaluate(async product => {
      const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const helper = await importer<typeof import('../helpers/prose-extraction-source-cas')>('/storyforge/tests/helpers/prose-extraction-source-cas.ts')
      const fixture = await helper.seedProseExtractionSourceFixtureV1()
      const before = await helper.readProseExtractionRowsV1(product, fixture.scope)
      const generated = await helper.generateProseExtractionCandidateFixtureV1(product, fixture.scope)
      let error = ''
      try {
        await helper.adoptProseExtractionFixtureV1(product, {
          scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: generated.selectedIndexes,
          onDurableBoundary: (boundary, _snapshot, index) => {
            if (boundary === 'formal.chapter' && index === 0) throw new Error('crash-after-first')
          },
        })
      } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
      const written = await helper.readProseExtractionRowsV1(product, fixture.scope)
      return { scope: fixture.scope, chapterIds: fixture.chapterIds, runId: generated.snapshot.run.id,
        error, modelCalls: generated.modelCalls(), firstId: written.find(row => row.chapterId === fixture.chapterIds[0])?.id,
        secondId: before.find(row => row.chapterId === fixture.chapterIds[1])?.id }
    }, kind)
    expect(interrupted.error).toBe('crash-after-first')
    expect(interrupted.modelCalls).toBe(2)
    const edited = '<p>作者已经改写第二章：没有铜钥匙，也没有进入钟楼。这份新正文不得被回滚。</p>'
    await page.evaluate(async ({ id, body }) => {
      const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await importer<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      await db.chapters.update(id, { content: body })
    }, { id: interrupted.chapterIds[1], body: edited })

    const module = kind === 'inventory' ? 'inventory' : 'story-timeline'
    await page.goto(`./workspace/${interrupted.scope.projectId}?module=${module}&work=${interrupted.scope.workId}`)
    const continueAdoption = page.getByRole('button', { name: '继续完成冻结采纳', exact: true })
    await expect(continueAdoption).toBeVisible({ timeout: 20_000 })
    await continueAdoption.click()
    await expect(page.getByText(/已保留 1\/2 章.*采纳已停止/).first()).toBeVisible({ timeout: 20_000 })
    await page.reload()
    await expect(page.getByRole('button', { name: kind === 'inventory' ? '从正文提取物品栏' : '从正文提取年表', exact: true })).toBeEnabled({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: '继续完成冻结采纳', exact: true })).toHaveCount(0)
    if (kind === 'inventory') {
      await expect(page.getByText('新物品0', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('旧物品1', { exact: true }).first()).toBeVisible()
    } else {
      const visibleTitles = () => page.getByRole('textbox').evaluateAll(elements => elements.flatMap(
        element => element instanceof HTMLInputElement ? [element.value] : [],
      ))
      await expect.poll(visibleTitles).toContain('新事件0')
      await expect.poll(visibleTitles).toContain('旧事件1')
    }
    const stopped = await page.evaluate(async ({ product, data }) => {
      const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const [helper, store, { db }] = await Promise.all([
        importer<typeof import('../helpers/prose-extraction-source-cas')>('/storyforge/tests/helpers/prose-extraction-source-cas.ts'),
        importer<typeof import('../../src/lib/agent/run/event-store')>('/storyforge/src/lib/agent/run/event-store.ts'),
        importer<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      ])
      const run = await store.readAgentRunV1(data.scope, data.runId)
      const rows = await helper.readProseExtractionRowsV1(product, data.scope)
      return { state: run.projection.state, receipt: run.projection.terminalReceiptHash ?? null,
        accepted: run.events.some(event => event.type === 'verification.accepted'),
        modelResponses: run.events.filter(event => event.type === 'model.responded').length,
        firstId: rows.find(row => row.chapterId === data.chapterIds[0])?.id,
        secondId: rows.find(row => row.chapterId === data.chapterIds[1])?.id,
        body: (await db.chapters.get(data.chapterIds[1]))?.content,
        recoverable: await helper.recoverableProseExtractionV1(product, data.scope) != null }
    }, { product: kind, data: interrupted })
    expect(stopped).toEqual({ state: 'paused', receipt: null, accepted: false, modelResponses: 2,
      firstId: interrupted.firstId, secondId: interrupted.secondId, body: edited, recoverable: false })

    const receiptInterrupted = await page.evaluate(async product => {
      const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const helper = await importer<typeof import('../helpers/prose-extraction-source-cas')>('/storyforge/tests/helpers/prose-extraction-source-cas.ts')
      const fixture = await helper.seedProseExtractionSourceFixtureV1()
      const generated = await helper.generateProseExtractionCandidateFixtureV1(product, fixture.scope)
      let error = ''
      try {
        await helper.adoptProseExtractionFixtureV1(product, {
          scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: generated.selectedIndexes,
          onDurableBoundary: boundary => { if (boundary === 'verification.started') throw new Error('receipt-refresh') },
        })
      } catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
      return { scope: fixture.scope, runId: generated.snapshot.run.id, selectedIndexes: generated.selectedIndexes,
        error, rowsJson: JSON.stringify(await helper.readProseExtractionRowsV1(product, fixture.scope)) }
    }, kind)
    expect(receiptInterrupted.error).toBe('receipt-refresh')
    await page.reload()
    const resumed = await page.evaluate(async ({ product, data }) => {
      const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const helper = await importer<typeof import('../helpers/prose-extraction-source-cas')>('/storyforge/tests/helpers/prose-extraction-source-cas.ts')
      const accepted = await helper.adoptProseExtractionFixtureV1(product, data)
      const replay = await helper.adoptProseExtractionFixtureV1(product, data)
      return { state: accepted.snapshot.projection.state, sameReceipt: replay.receiptHash === accepted.receiptHash,
        modelResponses: replay.snapshot.events.filter(event => event.type === 'model.responded').length,
        rowsJson: JSON.stringify(await helper.readProseExtractionRowsV1(product, data.scope)) }
    }, { product: kind, data: receiptInterrupted })
    expect(resumed).toEqual({ state: 'completed', sameReceipt: true, modelResponses: 2, rowsJson: receiptInterrupted.rowsJson })
    expect(errors).toEqual([])
  })
}
