import { expect, test } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'

test('044 reference UI resumes an unknown local attempt without another model request', async ({ browser, baseURL }) => {
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
      const { createReferenceAnalysisRun } = await load<typeof import('../../src/lib/reference-analysis/lifecycle')>('/storyforge/src/lib/reference-analysis/lifecycle.ts')
      const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
      if (await db.projects.count()) throw new Error('044 requires empty isolated browser storage')
      const { scope } = await createWorkspace({ name: '044 原稿隔离', genres: [], description: '',
        targetWordCount: 10_000, status: 'drafting' }, { kind: 'novel', novelProfile: 'long' })
      useAIConfigStore.getState().setConfig({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sfqa044-synthetic-only',
        baseUrl: syntheticBaseUrl, temperature: 0, maxTokens: 8_192, contextWindow: 128_000 })
      const text = '原稿证据：此段仅用于隔离参考分析。'
      const referenceId = await db.references.add(stampNewRecord(scope, 'references', { projectId: scope.projectId, workId: scope.workId,
        title: '044 隔离参考条目', author: '作者', type: 'story', note: '', url: '', analysisDepth: 'deep',
        analysisStatus: 'pending', analysisProgress: 0, fileHash: 'sfqa044', totalChars: text.length, createdAt: 1, updatedAt: 1,
      }, { owner: 'work' }))
      await createReferenceAnalysisRun({ referenceId, depth: 'deep', sourceFilename: 'sfqa044.txt', fileHash: 'sfqa044',
        totalChars: text.length, expectedChunks: 1, sourceKind: 'own-work', usageScope: 'analysis-only', rightsConfirmed: true, sourceText: text })
      return scope.projectId
    }, baseUrl)
    await page.goto(`./workspace/${projectId}?module=references`)
    const open = async () => {
      await openLongformLeaf(page, '项目参考')
      await page.getByText('044 隔离参考条目', { exact: true }).click()
      await page.getByRole('button', { name: '作品分析', exact: true }).click()
    }
    await open()
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
})
