import { expect, test } from '@playwright/test'

test('061 native single-partition history stays in its source while Work-free World keyword creation and rollback preserve owner', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let posts = 0
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '061-world-partition'))
  await context.route('**/*', route => {
    if (route.request().method() === 'POST') posts++
    return new URL(route.request().url()).origin === origin && ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort()
  })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { seedCurrentWorkspace } = await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { stampNewRecord } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    const { useHistoryStore } = await load<typeof import('../../src/stores/project-singletons')>('/storyforge/src/stores/project-singletons.ts')
    const f = await seedCurrentWorkspace('061 单分区历史隔离工程')
    const group = await db.worldGroups.add(stampNewRecord(f.scope, 'worldGroups', { projectId: f.scope.projectId, name: '唯一世界分区', type: 'primary', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as never) as number
    await db.projects.update(f.scope.projectId, { enableMultiWorld: true })
    const origin = { version: 1 as const, kind: 'work' as const, scope: f.scope }
    await useHistoryStore.getState().saveForHistoryAuthorV1({ origin, selection: { kind: 'partition', worldGroupId: group }, patch: { overview: '唯一分区的真实历史原文' } })
    await useHistoryStore.getState().saveForHistoryAuthorV1({ origin, selection: { kind: 'partition', worldGroupId: null }, patch: { overview: '默认空分区不应被选中' } })
    return { scope: f.scope, group }
  })
  await page.goto(`./workspace/${f.scope.projectId}?module=history`)
  await page.getByRole('button', { name: '历史总述与纪年', exact: true }).click()
  await expect(page.getByText('唯一分区的真实历史原文', { exact: true })).toBeVisible()
  await expect(page.getByText('默认空分区不应被选中', { exact: true })).toHaveCount(0)
  const result = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { seedCurrentWorkspace } = await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { scopeTransactionTables } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    const { useHistoricalStore } = await load<typeof import('../../src/stores/historical')>('/storyforge/src/stores/historical.ts')
    const w = await seedCurrentWorkspace('061 无Work世界工程', { purpose: 'world-engine' })
    await db.projects.update(w.scope.projectId, { activeWorkId: null });await db.works.delete(w.scope.workId)
    const owner = { projectId: w.scope.projectId, worldId: w.scope.worldId }, data = { projectId: owner.projectId, keyword: '无Work作者词条', category: 'technology' as const, era: 'custom' as const, description: '作者原文' }
    const store = useHistoricalStore.getState()
    const id = await store.addKeyword(data, owner)
    await store.updateKeyword(id, { description: '作者修订后原文' }, owner)
    const row = await db.historicalKeywords.get(id)
    let failure = ''
    try { await db.transaction('rw', scopeTransactionTables(db.historicalKeywords, db.worldGroups), async () => {
      await store.addKeyword({ ...data, keyword: '外层失败不能留下' }, owner)
      throw Error('synthetic native outer abort')
    }) } catch (cause) { failure = (cause as Error).message }
    const rows = await db.historicalKeywords.where('projectId').equals(owner.projectId).toArray()
    await store.deleteKeyword(id)
    return { owner, row, rows, failure, remaining: await db.historicalKeywords.where('projectId').equals(owner.projectId).count(), works: await db.works.where('projectId').equals(owner.projectId).count() }
  })
  expect(result.row).toMatchObject({ projectId: result.owner.projectId, worldId: result.owner.worldId, description: '作者修订后原文' })
  expect(Reflect.get(result.row!, 'workId')).toBeUndefined()
  expect(result.failure).toContain('synthetic native outer abort');expect(result.rows).toHaveLength(1);expect(result.remaining).toBe(0);expect(result.works).toBe(0)
  await expect(page.getByText('唯一分区的真实历史原文', { exact: true })).toBeVisible()
  expect(posts).toBe(0)
})
