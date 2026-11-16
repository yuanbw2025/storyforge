import { expect, test } from '@playwright/test'
import type { Chapter } from '../../src/lib/types'

interface ComicDraftGate {
  workId: number | null
  draftKey: string | null
  armed: boolean
  readComplete: boolean
  retained: string | null
  scope: { projectId: number; worldId: number; workId: number } | null
  release: (() => void) | null
}
declare global { interface Window { __storyforge046Draft: ComicDraftGate } }

test('comic spec restores real drafts, preserves input across a late read, saves and reopens without crossing Works', async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error('Expected the isolated local browser origin')
  const allowedOrigin = new URL(baseURL).origin, externalRequests: string[] = []
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== allowedOrigin) {
      externalRequests.push(url.origin); await route.abort(); return
    }
    await route.continue()
  })
  // Test-only ESM proxy: every export and read result comes from the original
  // public service. Hold just one already-completed real read, outside its DB
  // work; no service, storage, scope, result or formal writer is replaced.
  await page.route(/\/src\/lib\/comic\/authoring\.ts(?:\?.*)?$/, async route => {
    const url = new URL(route.request().url())
    if (url.searchParams.has('sfqa046-real')) { await route.fallback(); return }
    const original = JSON.stringify(`${url.pathname}?sfqa046-real=1`)
    await route.fulfill({ contentType: 'text/javascript', body: `
      export * from ${original};
      import * as actual from ${original};
      export async function readComicAuthorDraft(...args) {
        const gate = globalThis.__storyforge046Draft;
        const hold = gate && gate.armed && args[0].workId === gate.workId && args[1] === gate.draftKey;
        if (hold) gate.armed = false;
        const value = await actual.readComicAuthorDraft(...args);
        if (hold) {
          gate.scope = { ...args[0] }; gate.retained = value; gate.readComplete = true;
          await new Promise(resolve => { gate.release = resolve; });
        }
        return value;
      }
    ` })
  })
  await page.addInitScript(({ origin }) => {
    if (location.origin !== origin) return
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    window.__storyforge046Draft = { workId: null, draftKey: null, armed: false, readComplete: false, retained: null, scope: null, release: null }
  }, { origin: allowedOrigin })
  await page.goto('./comic/library')
  await page.locator('.comic-app').waitFor()
  const seed = await page.evaluate(async () => {
    let stage = 'load-public-modules'
    try {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const [{ createWorkspace }, { createAdaptation }, authoring, { readOwnedRows }] = await Promise.all([
        load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts'),
        load<typeof import('../../src/lib/adaptation/source-manifest')>('/storyforge/src/lib/adaptation/source-manifest.ts'),
        load<typeof import('../../src/lib/comic/authoring')>('/storyforge/src/lib/comic/authoring.ts'),
        load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts'),
      ])
      stage = 'create-source'
      const source = await createWorkspace({ name: '046隔离原作', description: '', genres: ['other'], status: 'drafting', targetWordCount: 10_000 },
        { purpose: 'independent-work', kind: 'novel', novelProfile: 'long', importedNovelText: '暴雨中，作者确认的人物主动走入旧车站。' })
      const make = async (title: string, audience: string, draft: string) => {
        stage = `create-adaptation:${title}`
        const made = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title,
          sourceSelection: { mode: 'entire-work' }, medium: 'comic', targetSpec: { ...authoring.defaultComicTargetSpec(), audience } })
        const root = made.adaptation
        if (!root.id || root.medium !== 'comic') throw new Error('Expected the actual comic adaptation')
        stage = `save-author-draft:${title}`
        await authoring.saveComicAuthorDraft(made.scope, `target:r${root.revision}`, JSON.stringify({ ...root.targetSpec, audience: draft }))
        return { scope: made.scope, rootId: root.id, revision: root.revision, title, audience, draft }
      }
      const a = await make('046漫画A', 'A正式旧值', 'A上次已存草稿'), b = await make('046漫画B', 'B正式旧值', 'B独立已存草稿')
      stage = 'read-source-proof'
      const sourceContents = (await readOwnedRows<Chapter>(source.scope, 'chapters', { owner: 'work' })).map(row => ({ id: row.id, content: row.content }))
      return { a, b, sourceScope: source.scope, sourceContents }
    } catch (cause) {
      const detail = (value: unknown) => {
        if (typeof value !== 'object' || value === null) return { message: String(value) }
        return { name: String(Reflect.get(value, 'name')), message: String(Reflect.get(value, 'message')),
          stack: String(Reflect.get(value, 'stack')) }
      }
      const inner = typeof cause === 'object' && cause !== null ? Reflect.get(cause, 'inner') : undefined
      throw new Error(`046 setup ${stage}: ${JSON.stringify({ error: detail(cause), inner: detail(inner) })}`)
    }
  })
  const choose = async (title: string) => {
    await page.locator('.comic-app .lf-current').click()
    await page.locator('.cp-choose').getByRole('button', { name: title, exact: true }).click()
    await expect(page.locator('.cp-choose')).toBeHidden()
  }
  await choose(seed.a.title)
  await expect(page.getByLabel('目标读者', { exact: true })).toHaveValue(seed.a.draft)
  await expect(page.getByRole('button', { name: '保存制作规格', exact: true })).toBeEnabled()

  // Real navigation unregisters the old editor and flushes the existing draft
  // coordinator. The next mount is held only after its actual read completed.
  await page.getByRole('navigation', { name: '漫画页面导航' }).getByRole('button', { name: '作品库', exact: true }).click()
  await page.evaluate(input => { Object.assign(window.__storyforge046Draft, { workId: input.workId, draftKey: input.draftKey, armed: true, readComplete: false, retained: null, release: null }) }, { workId: seed.a.scope.workId, draftKey: `target:r${seed.a.revision}` })
  await choose(seed.a.title)
  await expect.poll(() => page.evaluate(() => window.__storyforge046Draft.readComplete)).toBe(true)
  const originalRead = await page.evaluate(() => ({ scope: window.__storyforge046Draft.scope, value: window.__storyforge046Draft.retained }))
  expect(originalRead.scope).toEqual(seed.a.scope)
  expect(JSON.parse(originalRead.value ?? 'null')).toMatchObject({ audience: seed.a.draft })
  const audience = page.getByLabel('目标读者', { exact: true }), save = page.getByRole('button', { name: '保存制作规格', exact: true })
  await audience.fill('作者当前不能被覆盖的新输入')
  await expect(save).toBeDisabled()
  await page.evaluate(() => {
    const release = window.__storyforge046Draft.release
    if (!release) throw new Error('Expected the real retained draft read')
    release(); window.__storyforge046Draft.release = null
  })
  await expect(save).toBeEnabled()
  await expect(audience).toHaveValue('作者当前不能被覆盖的新输入')
  await save.click()
  await expect.poll(() => page.evaluate(async rootId => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const row = await db.adaptationProjects.get(rootId)
    if (!row || row.medium !== 'comic') throw new Error('Expected the actual formal comic row')
    return { revision: row.revision, audience: row.targetSpec.audience }
  }, seed.a.rootId)).toEqual({ revision: seed.a.revision + 1, audience: '作者当前不能被覆盖的新输入' })
  await page.reload()
  await expect(audience).toHaveValue('作者当前不能被覆盖的新输入')
  await expect(save).toBeEnabled()
  await choose(seed.b.title)
  await expect(audience).toHaveValue(seed.b.draft)
  await choose(seed.a.title)
  await expect(audience).toHaveValue('作者当前不能被覆盖的新输入')
  const final = await page.evaluate(async seed => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [{ db }, authoring, { readOwnedRows }] = await Promise.all([
      load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      load<typeof import('../../src/lib/comic/authoring')>('/storyforge/src/lib/comic/authoring.ts'),
      load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts'),
    ])
    const a = await db.adaptationProjects.get(seed.a.rootId), b = await db.adaptationProjects.get(seed.b.rootId)
    if (!a || a.medium !== 'comic' || !b || b.medium !== 'comic') throw new Error('Expected both original comic owners')
    return { a: { revision: a.revision, audience: a.targetSpec.audience }, b: { revision: b.revision, audience: b.targetSpec.audience },
      latestAuthorDraft: await authoring.readComicAuthorDraft(seed.a.scope, `target:r${seed.a.revision}`),
      sourceContents: (await readOwnedRows<Chapter>(seed.sourceScope, 'chapters', { owner: 'work' })).map(row => ({ id: row.id, content: row.content })) }
  }, seed)
  expect(final.a).toEqual({ revision: seed.a.revision + 1, audience: '作者当前不能被覆盖的新输入' })
  expect(final.b).toEqual({ revision: seed.b.revision, audience: seed.b.audience })
  expect(JSON.parse(final.latestAuthorDraft ?? 'null')).toMatchObject({ audience: '作者当前不能被覆盖的新输入' })
  expect(final.sourceContents).toEqual(seed.sourceContents)
  expect(externalRequests).toEqual([])
  await test.info().attach('046-real-read-and-formal-result', { body: JSON.stringify({ originalRead, final }, null, 2), contentType: 'application/json' })
})
