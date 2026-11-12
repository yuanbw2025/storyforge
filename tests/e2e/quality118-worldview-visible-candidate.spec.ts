import { expect, test } from '@playwright/test'

const repairedObject = { hasDivinity: true, divineRank: '盐约议会', divineNames: '执潮者', divineRules: '不得取走未许可的记忆。' }
const repairedText = '作者确认的世界来源：守潮人只在盐约生效后开放城门。'

for (const field of ['worldOrigin', 'divineDesign'] as const) {
  test(`118 ${field}: the real field editor adopts only the acknowledged visible edit after reload`, async ({ browser, baseURL }, info) => {
    if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') throw new Error('Use the isolated loopback workspace only')
    const origin = new URL(baseURL).origin
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, serviceWorkers: 'block' })
    let modelRequests = 0
    try {
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url())
        if (/\/chat\/completions|\/(?:responses|requests|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)/.test(url.pathname)) {
          modelRequests += 1
          return route.abort()
        }
        return url.origin === origin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort()
      })
      await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'sfqa118-isolated'))
      const page = await context.newPage()
      await page.goto('./')
      await expect(page.getByRole('heading', { name: /天地为炉，\s*万象成故事。/ })).toBeVisible()
      const seed = await page.evaluate(async candidateField => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const [{ db }, textFixture, objectFixture] = await Promise.all([
          load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
          load<typeof import('../helpers/current-master-candidate')>('/storyforge/tests/helpers/current-master-candidate.ts'),
          load<typeof import('../helpers/sfqa118-worldview-candidate')>('/storyforge/tests/helpers/sfqa118-worldview-candidate.ts'),
        ])
        if (await db.projects.count() !== 0) throw new Error('Expected empty native test storage')
        const fixture = candidateField === 'worldOrigin'
          ? await textFixture.seedCurrentMasterCandidate('118 native text workspace', '旧的完整世界来源仅用于原文对照。')
          : await objectFixture.seedSfqa118ObjectCandidate()
        const events = await db.agentRunEvents.where('runId').equals(fixture.result.runId).toArray()
        return { scope: fixture.scope, eventId: fixture.candidate.event.id!, runId: fixture.result.runId,
          initialContent: fixture.candidate.event.content, originalEvents: JSON.stringify(events) }
      }, field)
      const view = field === 'worldOrigin' ? 'origin' : 'divine'
      await page.goto(`./workspace/${seed.scope.projectId}?module=worldview-origin&originField=${view}`)
      const review = page.locator('section').filter({ has: page.getByRole('heading', { name: /^待确认 · / }) })
      const editor = review.getByRole('textbox', { name: /候选内容$/ })
      const adopt = review.getByRole('button', { name: '采纳', exact: true })
      const broken = field === 'worldOrigin' ? '字' : '{"hasDivinity":'
      await editor.fill(broken)
      await expect(editor).toHaveValue(broken)
      await expect(adopt).toBeDisabled()
      await expect(review.getByRole('alert')).toContainText(field === 'worldOrigin' ? '至少需要 2 个字符' : '对象 JSON 无效')
      const blocked = await page.evaluate(async current => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
        const leaving = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(leaving)
        return { closeProtected: leaving.defaultPrevented, candidate: (await db.agentEvents.get(current.eventId))?.content,
          worldCount: await db.worldviews.where('projectId').equals(current.scope.projectId).count() }
      }, seed)
      expect(blocked).toEqual({ closeProtected: true, candidate: seed.initialContent, worldCount: 0 })

      const value = field === 'worldOrigin' ? repairedText : repairedObject
      await editor.fill(typeof value === 'string' ? value : JSON.stringify(value))
      await expect(adopt).toBeEnabled()
      await page.reload()
      await expect(adopt).toBeEnabled()
      if (typeof value === 'string') await expect(editor).toHaveValue(value)
      else expect(JSON.parse(await editor.inputValue())).toEqual(value)
      await adopt.click()
      await expect(review).toHaveCount(0)
      const proof = await page.evaluate(async input => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const [{ db }, verifier] = await Promise.all([
          load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
          load<typeof import('../../src/lib/agent/run/master-verification')>('/storyforge/src/lib/agent/run/master-verification.ts'),
        ])
        const rows = await db.worldviews.where('projectId').equals(input.seed.scope.projectId).toArray()
        const events = await db.agentRunEvents.where('runId').equals(input.seed.runId).toArray()
        const oldEvents = JSON.parse(input.seed.originalEvents) as unknown[]
        const verified = await verifier.verifyMasterAgentRunV1({ scope: input.seed.scope, runId: input.seed.runId })
        return { value: rows[0]?.[input.field], worldId: rows[0] ? Reflect.get(rows[0], 'worldId') : undefined, worldCount: rows.length,
          originalLineageExact: JSON.stringify(events.slice(0, oldEvents.length)) === input.seed.originalEvents,
          revisions: events.filter(event => event.type === 'candidate.revised').length,
          terminalVerified: verified.accepted, receipt: verified.snapshot.projection.terminalReceiptHash }
      }, { seed, field })
      expect(proof).toMatchObject({ value, worldId: seed.scope.worldId, worldCount: 1, originalLineageExact: true, revisions: 1, terminalVerified: true })
      expect(proof.receipt).toMatch(/^[a-f0-9]{64}$/)
      expect(modelRequests).toBe(0)
      await info.attach('visible-candidate-proof', { body: Buffer.from(JSON.stringify({ field, blocked, proof, modelRequests }, null, 2)), contentType: 'application/json' })
    } catch (error) {
      const page = context.pages()[0]
      const state = page ? await page.evaluate(async () => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
        const events = await db.agentRunEvents.toArray()
        return {
          failures: events.filter(event => /fail|stale|repair|replan/.test(event.type)),
          worldviews: (await db.worldviews.toArray()).map(row => ({ id: row.id, worldId: Reflect.get(row, 'worldId'), worldOrigin: row.worldOrigin })),
          projects: (await db.projects.toArray()).map(row => ({ id: row.id, activeWorldId: row.activeWorldId, activeWorkId: row.activeWorkId, updatedAt: row.updatedAt })),
        }
      }).catch(cause => ({ diagnosticError: String(cause) })) : null
      await info.attach('visible-candidate-failure-state', { body: Buffer.from(JSON.stringify({ field, modelRequests, state })), contentType: 'application/json' })
      throw error
    } finally { await context.close() }
  })
}
