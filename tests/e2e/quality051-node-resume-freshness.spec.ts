import { expect, test } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'

for (const lane of ['formal', 'experimental'] as const) {
  test(`051 ${lane}: the restored node UI refuses active ownership and changed Canon before AI`, async ({ browser, baseURL }, info) => {
    if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') throw new Error('Expected an isolated loopback server')
    const origin = new URL(baseURL).origin
    const context = await browser.newContext({ baseURL, serviceWorkers: 'block', storageState: { cookies: [], origins: [] } })
    let requests = 0
    try {
      await context.addInitScript(() => {
        localStorage.setItem('storyforge_guide_completed', 'sfqa051-isolated')
        localStorage.setItem('storyforge:experimental-products', 'enabled')
      })
      await context.route('**/*', route => {
        const req = route.request(), url = new URL(req.url())
        if (/\/chat\/completions|\/(?:responses|requests|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)/.test(url.pathname)) {
          requests += 1
          return route.abort()
        }
        return url.origin === origin && ['GET', 'HEAD'].includes(req.method()) ? route.continue() : route.abort()
      })
      await context.routeWebSocket('**/*', socket => {
        const url = new URL(socket.url())
        if (`${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}` === origin) socket.connectToServer()
        else socket.close({ code: 1008, reason: 'Only the isolated local workspace is allowed' })
      })
      const page = await context.newPage()
      await page.goto('./')
      const fixture = await page.evaluate(async mode => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const [{ db }, workspace, scopes, catalog, contracts, executor, store, ai] = await Promise.all([
          load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
          load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts'),
          load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts'),
          load<typeof import('../../src/lib/node-authoring/catalog')>('/storyforge/src/lib/node-authoring/catalog.ts'),
          load<typeof import('../../src/lib/node-authoring/contracts')>('/storyforge/src/lib/node-authoring/contracts.ts'),
          load<typeof import('../../src/lib/node-authoring/executor')>('/storyforge/src/lib/node-authoring/executor.ts'),
          load<typeof import('../../src/stores/node-flow')>('/storyforge/src/stores/node-flow.ts'),
          load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts'),
        ])
        if (await db.projects.count()) throw new Error('Expected empty native test storage')
        const { scope } = await workspace.seedCurrentWorkspace('051 隔离长篇作品')
        const title = '051隔离章节'
        const outlineNodeId = await db.outlineNodes.add(scopes.stampNewRecord(scope, 'outlineNodes', {
          projectId: scope.projectId, parentId: null, type: 'chapter', title, summary: '隔离章节', order: 0, createdAt: 1, updatedAt: 1,
        }, { owner: 'work' })) as number
        const chapterId = await db.chapters.add(scopes.stampNewRecord(scope, 'chapters', {
          projectId: scope.projectId, outlineNodeId, title, content: '<p>SFQA051_NATIVE_OLD</p>', status: 'draft', wordCount: 18,
          order: 0, notes: '', createdAt: 1, updatedAt: 1,
        }, { owner: 'work' })) as number
        const node = (templateId: string, id: string, config: Record<string, unknown>): import('../../src/lib/node-authoring/contracts').AuthoringNodeInstance => {
          const template = catalog.AUTHORING_NODE_BY_ID.get(templateId)!
          return { id, templateId, templateVersion: 1, title: template.label, x: id === 'source' ? 0 : 300, y: 0,
            config: { ...catalog.defaultConfigForTemplate(template), ...config }, inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }
        }
        const source = node('source.project-context', 'source', { sourceKeys: ['chapterContent'], chapterTitle: title })
        const consumer = mode === 'formal' ? node('world.origin', 'consumer', { request: '从当前正文提炼世界起源。' })
          : node('processor.free-generation', 'consumer', { instruction: '从当前正文形成实验草稿。' })
        const graph = { ...contracts.emptyAuthoringGraph(), nodes: [source, consumer], edges: [{ id: 'context',
          sourceNodeId: source.id, sourcePortId: 'context', targetNodeId: consumer.id, targetPortId: 'context' }] }
        ai.useAIConfigStore.setState({ config: { provider: 'custom', apiKey: 'synthetic-only', model: 'isolated-051',
          baseUrl: new URL('/storyforge/quality051-model/v1', location.origin).href, maxTokens: 6000, temperature: 0, contextWindow: 128_000 }, taskRoutes: {} })
        const flowId = await store.useNodeFlowStore.getState().createFlow(scope.projectId, null, { name: '051 已暂停来源图', graph })
        const flow = (await db.nodeFlows.get(flowId))!
        const stop = new AbortController()
        const result = await executor.runAuthoringGraph({ flow, signal: stop.signal, onUpdate: value => {
          if (value.candidates[source.id]) stop.abort('paused')
        } })
        if (result.run.status !== 'paused' || !result.candidates[source.id].output.includes('SFQA051_NATIVE_OLD')) throw new Error('Expected a real saved paused prefix')
        return { projectId: scope.projectId, chapterId, flowId, runId: result.run.id!, original: JSON.stringify(await db.nodeRuns.get(result.run.id!)) }
      }, lane)
      await page.goto(`./workspace/${fixture.projectId}`)
      await openLongformLeaf(page, '节点模式')
      await page.reload()
      await expect(page.getByLabel('节点图名称')).toHaveValue('051 已暂停来源图')
      const resume = page.getByRole('button', { name: '继续运行', exact: true })
      await expect(resume).toBeEnabled()

      const other = await context.newPage()
      await other.goto('./')
      await other.evaluate(async seed => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
        await db.chapters.update(seed.chapterId, { content: '<p>SFQA051_NATIVE_NEW</p>', updatedAt: 2 })
        await new Promise<void>((resolve, reject) => {
          void navigator.locks.request(`storyforge:authoring-flow:${seed.flowId}`, async lock => {
            if (!lock) throw new Error('Expected an exclusive native flow lock')
            resolve()
            await new Promise<void>(() => undefined)
          }).catch(reject)
        })
      }, fixture)
      await resume.click()
      await expect(page.getByText(/节点图正在其他页面运行或恢复/)).toBeVisible()
      await other.close()
      await resume.click()
      await expect(page.getByText(/旧断点已保留/)).toBeVisible()
      const proof = await page.evaluate(async seed => {
        const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
        const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
        return { runExact: JSON.stringify(await db.nodeRuns.get(seed.runId)) === seed.original,
          chapter: (await db.chapters.get(seed.chapterId))?.content, canonWrites: await db.worldviews.count() }
      }, fixture)
      expect(proof).toEqual({ runExact: true, chapter: '<p>SFQA051_NATIVE_NEW</p>', canonWrites: 0 })
      expect(requests).toBe(0)
      await info.attach('051-native-resume-proof', { body: Buffer.from(JSON.stringify({ lane, proof, requests }, null, 2)), contentType: 'application/json' })
    } finally { await context.close() }
  })
}
