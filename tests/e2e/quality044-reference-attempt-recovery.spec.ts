import { expect, test, type Browser } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'

for (const depth of ['quick', 'deep'] as const) {
  test(`044 confirmed ${depth} upload resumes an unknown reference attempt without another model request`, async ({ browser, baseURL }) => {
    await exerciseConfirmedUpload(browser, baseURL, depth)
  })
}

async function exerciseConfirmedUpload(browser: Browser, baseURL: string | undefined, depth: 'quick' | 'deep') {
  if (!baseURL) throw new Error('044 requires isolated loopback')
  const base = new URL(baseURL)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('044 refuses external origins')
  const baseUrl = new URL('sfqa044-reference/v1', base).href
  const endpoint = `${baseUrl}/chat/completions`
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const unexpected: string[] = []
  let posts = 0
  try {
    await context.addInitScript(origin => {
      if (location.origin === origin) localStorage.setItem('storyforge_guide_completed', 'sfqa044-reference-isolated')
    }, base.origin)
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (request.url() === endpoint && request.method() === 'POST') {
        posts++
        return route.abort('connectionreset')
      }
      if (url.origin === base.origin && ['GET', 'HEAD'].includes(request.method())) return route.continue()
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`)
      return route.abort('blockedbyclient')
    })
    const page = await context.newPage()
    await page.goto('./')
    const projectId = await page.evaluate(async syntheticBaseUrl => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
      const { stampNewRecord } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
      const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
      if (await db.projects.count()) throw new Error('044 requires empty isolated browser storage')
      const { scope } = await createWorkspace({ name: '044 原稿隔离', genres: [], description: '',
        targetWordCount: 10_000, status: 'drafting' }, { kind: 'novel', novelProfile: 'long' })
      useAIConfigStore.getState().setConfig({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sfqa044-synthetic-only',
        baseUrl: syntheticBaseUrl, temperature: 0, maxTokens: 8_192, contextWindow: 128_000 })
      await db.references.add(stampNewRecord(scope, 'references', { projectId: scope.projectId, workId: scope.workId,
        title: '044 隔离参考条目', author: '作者', type: 'story', note: '', url: '', analysisDepth: 'deep',
        analysisStatus: 'pending', analysisProgress: 0, createdAt: 1, updatedAt: 1,
      }, { owner: 'work' }))
      return scope.projectId
    }, baseUrl)
    await page.goto(`./workspace/${projectId}?module=references`)
    const open = async () => {
      await openLongformLeaf(page, '项目参考')
      await page.getByText('044 隔离参考条目', { exact: true }).click()
      await page.getByRole('button', { name: '作品分析', exact: true }).click()
    }
    await open()
    const depthMenu = page.getByRole('combobox').filter({ has: page.locator('option[value="deep"]') })
    const sourceMenu = page.getByRole('combobox').filter({ has: page.locator('option[value="own-work"]') })
    await depthMenu.selectOption(depth)
    await sourceMenu.selectOption('own-work')
    const upload = async () => {
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: '上传并建立新版本' }).click()
      await (await chooser).setFiles({ name: 'sfqa044.txt', mimeType: 'text/plain',
        buffer: Buffer.from('原稿证据：此段仅用于隔离参考分析。', 'utf8') })
    }
    await upload()
    await expect(page.getByText('请先确认来源声明', { exact: true })).toBeVisible()
    expect(posts).toBe(0)
    await page.getByRole('checkbox', { name: /我确认以上来源声明准确/ }).check()
    await upload()
    await expect(page.getByText('原请求结果未知，未自动重发。', { exact: true })).toBeVisible()
    expect(posts).toBe(1)
    await page.getByRole('button', { name: '断点续跑', exact: true }).click()
    await expect(page.getByText('原请求结果未知，未自动重发。', { exact: true })).toBeVisible()
    expect(posts).toBe(1)
    await page.reload()
    await open()
    await page.getByRole('button', { name: '断点续跑', exact: true }).click()
    await expect(page.getByText('原请求结果未知，未自动重发。', { exact: true })).toBeVisible()
    expect(posts).toBe(1)
    expect(unexpected).toEqual([])
  } finally { await context.close() }
}
