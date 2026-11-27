import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test.use({ serviceWorkers: 'block' })
for (const damage of ['missing', 'moved'] as const) {
  test(`stale pack target ${damage} is visible and recoverable without unhandled errors or wrong-module activation`, async ({ page, context }, info) => {
    const base = info.project.use.baseURL
    if (!base || new URL(base).hostname !== '127.0.0.1') throw new Error('Requires isolated loopback fixture')
    const origin = new URL(base).origin, external: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'issue710-isolated'))
    await context.route('**/*', async route => {
      const r = route.request(), url = new URL(r.url())
      if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) {
        external.push(`${r.method()} ${url.origin}`); await route.abort('blockedbyclient')
      } else await route.continue()
    })
    await context.routeWebSocket('**/*', socket => {
      const url = new URL(socket.url())
      if (`${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}` !== origin) {
        external.push('external websocket'); socket.close()
      } else socket.connectToServer()
    })
    await createLongform(page, '710 isolated longform')
    const f = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
      const { usePromptStore } = await load('/storyforge/src/stores/prompt.ts') as typeof import('../../src/stores/prompt')
      // Fresh browser/loopback only: replace synthetic seed rows to isolate the
      // same stale target, without unrelated genre templates activating first.
      await db.promptTemplates.clear()
      const row: import('../../src/lib/types/prompt').PromptTemplate = { scope: 'user', moduleKey: 'chapter.content',
        promptType: 'generate', name: '710 prior', description: 'SYNTHETIC_ONLY', systemPrompt: 'ORIGINAL_SYSTEM',
        userPromptTemplate: 'ORIGINAL_INPUT', variables: [], isActive: true, createdAt: 1, updatedAt: 1 }
      await usePromptStore.getState().saveTemplate(row)
      const target = await usePromptStore.getState().saveTemplate({ ...row, scope: 'system', name: '710 target', genres: ['xianxia'], isActive: false })
      await usePromptStore.getState().saveTemplate({ ...row, name: '710 other module', moduleKey: 'chapter.continue' })
      localStorage.setItem('sf-genre-pack', 'general')
      return { target, row }
    })
    await openLongformLeaf(page, '提示词库')
    const picker = page.getByRole('combobox').filter({ has: page.locator('option[value="xianxia"]') })
    await expect(picker).toHaveValue('general')
    const before = await page.evaluate(async ({ damage, id }) => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
      // Model a native writer in another window after this page loaded its list.
      if (damage === 'missing') await db.promptTemplates.delete(id)
      else await db.promptTemplates.update(id, { moduleKey: 'chapter.continue' })
      return db.promptTemplates.orderBy('id').toArray()
    }, { damage, id: f.target })
    await picker.selectOption('xianxia')
    await expect(page.getByText(/^题材包切换未完成/)).toBeVisible()
    const after = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
      return db.promptTemplates.orderBy('id').toArray()
    })
    expect(after).toEqual(before)
    // Explicit native repair is fixture setup, not a claimed UI editing step.
    const repaired = await page.evaluate(async ({ id, row, damage }) => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const { usePromptStore } = await load('/storyforge/src/stores/prompt.ts') as typeof import('../../src/stores/prompt')
      return usePromptStore.getState().saveTemplate({ ...row, ...(damage === 'moved' ? { id } : {}),
        scope: 'system', name: '710 repaired', genres: ['xianxia'], isActive: false },
      damage === 'moved' ? { expectedModuleKey: 'chapter.continue' } : undefined)
    }, { id: f.target, row: f.row, damage })
    await picker.selectOption('general')
    await picker.selectOption('xianxia')
    await expect.poll(async () => page.evaluate(async id => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
      return (await db.promptTemplates.get(id))?.isActive
    }, repaired)).toBe(true)
    expect(errors).toEqual([]); expect(external).toEqual([])
    await info.attach('710-safe-regression-evidence', { contentType: 'application/json', body: JSON.stringify({ damage, before, after, pageErrors: errors, blockedExternal: external, realModelCalls: 0 }) })
  })
}
