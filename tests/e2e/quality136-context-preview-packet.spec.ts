import { expect, test, type Browser, type Page } from '@playwright/test'
import { gotoWithBrowserFixtureAIConfigV1, registerBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'

interface ChapterTarget { outlineNodeId: number; chapterId: number; target: string }
interface Fixture {
  scope: { projectId: number; worldId: number; workId: number }
  nextScope: { projectId: number; worldId: number; workId: number }
  first: ChapterTarget
  second: ChapterTarget
  next: ChapterTarget
  stateIds: number[]
}

async function isolated(browser: Browser, baseURL: string | undefined) {
  if (!baseURL) throw new Error('136 requires an isolated loopback origin')
  const base = new URL(baseURL)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('136 refuses author/external origins')
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const blocked: string[] = []
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url())
    if (url.origin === base.origin && ['GET', 'HEAD'].includes(request.method())) await route.continue()
    else { blocked.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort('blockedbyclient') }
  })
  registerBrowserFixtureAIConfigV1(context, { provider: 'agnes', model: 'agnes-2.5-flash',
    baseUrl: 'https://example.invalid/v1', apiKey: 'synthetic-only', temperature: 0, maxTokens: 1000 })
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'quality136-isolated'))
  const page = await context.newPage()
  await gotoWithBrowserFixtureAIConfigV1(page, './')
  return { context, page, blocked }
}

async function seed(page: Page): Promise<Fixture> {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    if (await db.projects.count()) throw new Error('136 requires empty isolated browser storage')
    const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
    const { stampNewRecord } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    const { createWorldWork, switchActiveWork } = await load<typeof import('../../src/lib/workspace/works')>('/storyforge/src/lib/workspace/works.ts')
    const { resolveLongformChapterNavigationV1 } = await load<typeof import('../../src/lib/authoring/longform-chapter-navigation')>('/storyforge/src/lib/authoring/longform-chapter-navigation.ts')
    const f = await createWorkspace({ name: '136原生预览', genres: ['realism'], description: '', status: 'drafting', targetWordCount: 100_000 },
      { kind: 'novel', novelProfile: 'long' })
    const addChapter = async (scope: typeof f.scope, title: string, summary: string, order: number) => {
      const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
        projectId: scope.projectId,
        parentId: null, type: 'chapter', title, summary, order, createdAt: 1, updatedAt: 1,
      }, { owner: 'work' })) as number
      const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
        projectId: scope.projectId,
        outlineNodeId, title, content: `<p>${summary}</p>`, wordCount: summary.length, status: 'draft', order, notes: '', createdAt: 1, updatedAt: 1,
      }, { owner: 'work' })) as number
      await db.detailedOutlines.add(stampNewRecord(scope, 'detailedOutlines', {
        projectId: scope.projectId,
        outlineNodeId, scenes: [{ sceneId: `scene-${order}`, title, summary, characterIds: [], conflict: '',
          location: '小店', pace: 'slow', estimatedWords: 500, notes: '' }], createdAt: 1, updatedAt: 1,
      }, { owner: 'work' }))
      const target = await resolveLongformChapterNavigationV1({ scope, module: 'chapters-list', outlineNodeId })
      return { outlineNodeId, chapterId, target }
    }
    const stateIds: number[] = []
    for (const entityName of ['阿明', '阿青']) stateIds.push(await db.stateCards.add(stampNewRecord(f.scope, 'stateCards', {
      projectId: f.scope.projectId,
      category: 'character', entityName, fields: JSON.stringify([{ key: '状态', value: `${entityName}的原作品状态` }]),
      createdAt: 1, updatedAt: 1,
    }, { owner: 'work' })) as number)
    const first = await addChapter(f.scope, '136首日收店', '阿明收好工具后关灯。', 0)
    const second = await addChapter(f.scope, '136次日收店', '阿明再次收好工具后关灯。', 1)
    const nextWork = await createWorldWork(f.scope.projectId, { title: '136另一作品', kind: 'novel', novelProfile: 'long' })
    const nextScope = await switchActiveWork(f.scope.projectId, nextWork.id!)
    await db.stateCards.add(stampNewRecord(nextScope, 'stateCards', {
      projectId: nextScope.projectId,
      category: 'character', entityName: '新人物', fields: '[{"key":"状态","value":"只属于新作品的状态"}]',
      createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    const next = await addChapter(nextScope, '136新作品章节', '新人物打开新店。', 0)
    await switchActiveWork(f.scope.projectId, f.scope.workId)
    return { scope: f.scope, nextScope, first, second, next, stateIds }
  })
}

async function actualPacket(page: Page, f: Fixture, target: ChapterTarget, operation: 'generate' | 'continue' | 'review') {
  return page.evaluate(async input => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { prepareProseGatewayAssemblyV1 } = await load<typeof import('../../src/lib/prose/gateway-context')>('/storyforge/src/lib/prose/gateway-context.ts')
    const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
    const { htmlToPlainText } = await load<typeof import('../../src/lib/utils/html')>('/storyforge/src/lib/utils/html.ts')
    const node = (await db.outlineNodes.get(input.target.outlineNodeId))!
    const chapter = (await db.chapters.get(input.target.chapterId))!
    const assembly = await prepareProseGatewayAssemblyV1({ projectId: input.scope.projectId, scope: input.scope,
      chapterId: chapter.id, outlineNodeId: node.id!, worldGroupId: null, operation: input.operation, perspectiveCharacterId: null,
      authorRequest: input.operation === 'review' ? '预览当前章节受控创作上下文'
        : [node.title, node.summary, htmlToPlainText(chapter.content).slice(-2000)].filter(Boolean).join('\n'),
      citedReferenceIds: input.operation === 'review' ? undefined : [], config: useAIConfigStore.getState().config,
    })
    return { packet: assembly.contextGatewayExecution.contextPacket,
      mandatory: assembly.contextGatewayExecution.retrievalTrace.mandatory.some(ref => ref.resourceKey.endsWith(':consistency-dossier')),
      models: assembly.contextGatewayExecution.metrics.additionalPlanningModelCalls }
  }, { scope: f.scope, target, operation })
}

test('136 actual preview shows mandatory packet sources for each operation, independently of organization focus', async ({ browser, baseURL }) => {
  const { context, page, blocked } = await isolated(browser, baseURL)
  try {
    const f = await seed(page)
    await gotoWithBrowserFixtureAIConfigV1(page, `./${f.first.target.replace(/^\//, '')}`)
    await page.getByRole('button', { name: '上下文', exact: true }).click()
    const preview = page.getByRole('region', { name: '章节上下文预览' })
    await expect(preview.getByTestId('context-preview-packet')).toContainText('已读取状态卡 2 张')
    for (const operation of ['generate', 'continue', 'review'] as const) {
      await preview.getByLabel('上下文预览用途', { exact: true }).selectOption(operation)
      const actual = await actualPacket(page, f, f.first, operation)
      expect([...new Set(actual.packet.sourceRefs.filter(ref => ref.table === 'stateCards').map(ref => ref.recordId))].sort()).toEqual([...f.stateIds].sort())
      expect(actual.mandatory).toBe(true); expect(actual.models).toBe(0)
      await expect(preview.locator('code')).toHaveText(actual.packet.packetHash)
      await preview.getByText('查看本次材料与来源', { exact: true }).click()
      await expect(preview.locator('pre')).toBeVisible()
      expect(await preview.locator('pre').textContent()).toBe(actual.packet.content)
      await expect(preview.getByTestId('context-preview-packet')).toContainText(`操作：${operation}`)
    }
    await expect(preview).toContainText('评审面板的本轮补充要求')
    await preview.getByRole('button', { name: '展开整理关注卡', exact: true }).click()
    const automatic = preview.getByRole('button', { name: '整理关注卡：阿明', exact: true })
    const extra = preview.getByRole('button', { name: '整理关注卡：阿青', exact: true })
    await expect(automatic).toBeDisabled(); await expect(extra).toHaveAttribute('aria-pressed', 'false')
    const hash = await preview.locator('code').textContent()
    await extra.click(); await expect(extra).toHaveAttribute('aria-pressed', 'true')
    await expect(preview.locator('code')).toHaveText(hash!)
    await expect(preview.getByTestId('context-preview-packet')).toContainText('已读取状态卡 2 张')
    await extra.click(); await expect(extra).toHaveAttribute('aria-pressed', 'false')
    expect(blocked).toEqual([])
  } finally { await context.close() }
})

test('136 actual chapter navigation and Work switch preserve scope and isolate organization focus', async ({ browser, baseURL }) => {
  const { context, page, blocked } = await isolated(browser, baseURL)
  try {
    const f = await seed(page)
    await gotoWithBrowserFixtureAIConfigV1(page, `./${f.first.target.replace(/^\//, '')}`)
    await page.getByRole('button', { name: '上下文', exact: true }).click()
    let preview = page.getByRole('region', { name: '章节上下文预览' })
    await expect(preview.getByTestId('context-preview-packet')).toContainText('已读取状态卡 2 张')
    await preview.getByRole('button', { name: '展开整理关注卡', exact: true }).click()
    await preview.getByRole('button', { name: '整理关注卡：阿青', exact: true }).click()
    await expect(preview.getByRole('button', { name: '整理关注卡：阿青', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const nextChapter = page.getByRole('button', { name: /136次日收店/ })
    await expect(nextChapter).toHaveCount(1); await nextChapter.click()
    await page.getByRole('button', { name: '上下文', exact: true }).click()
    preview = page.getByRole('region', { name: '章节上下文预览' })
    await expect(preview.getByTestId('context-preview-packet')).toContainText('已读取状态卡 2 张')
    await preview.getByRole('button', { name: '展开整理关注卡', exact: true }).click()
    await expect(preview.getByRole('button', { name: '整理关注卡：阿青', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await page.evaluate(async input => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { switchActiveWork } = await load<typeof import('../../src/lib/workspace/works')>('/storyforge/src/lib/workspace/works.ts')
      await switchActiveWork(input.projectId, input.workId)
    }, f.nextScope)
    await preview.getByRole('button', { name: '刷新预览', exact: true }).click()
    await expect(preview.getByRole('alert')).toContainText('当前章节与所选作品不一致')
    await expect(preview.getByTestId('context-preview-packet')).toHaveCount(0)
    await gotoWithBrowserFixtureAIConfigV1(page, `./${f.first.target.replace(/^\//, '')}`)
    await expect(page.getByRole('alert').filter({ hasText: '章节跳转属于其它作品' })).toBeVisible()
    await expect(page.getByRole('region', { name: '章节上下文预览' })).toHaveCount(0)
    await gotoWithBrowserFixtureAIConfigV1(page, `./${f.next.target.replace(/^\//, '')}`)
    await page.getByRole('button', { name: '上下文', exact: true }).click()
    preview = page.getByRole('region', { name: '章节上下文预览' })
    await expect(preview.getByTestId('context-preview-packet')).toContainText('已读取状态卡 1 张')
    await preview.getByText('查看本次材料与来源', { exact: true }).click()
    await expect(preview.locator('pre')).toContainText('只属于新作品的状态')
    await expect(preview.locator('pre')).not.toContainText('阿青的原作品状态')
    expect(blocked).toEqual([])
  } finally { await context.close() }
})
