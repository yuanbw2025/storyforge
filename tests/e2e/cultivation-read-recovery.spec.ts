import { expect, test } from '@playwright/test'

test('775 native affiliation read failure is visible and author retry preserves exact existing links', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin, errors: string[] = [], blocked: string[] = []
  page.on('pageerror', cause => errors.push(cause.message))
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '775-isolated'))
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { blocked.push(`${request.method()} ${url.origin}${url.pathname}`); return route.abort() }
    return route.continue()
  })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)')
    const { seedCurrentWorkspace } = await load('/storyforge/tests/helpers/current-workspace.ts')
    const { scope } = await seedCurrentWorkspace('775 隔离关联读取')
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const { stampNewRecord } = await load('/storyforge/src/lib/workspace/scope.ts')
    const systemId = await db.cultivationSystems.add(stampNewRecord(scope, 'cultivationSystems', { projectId: scope.projectId, name: '原体系', description: '原文', stages: JSON.stringify([{ id: 'old-stage', name: '原境界', parentStageIds: [] }]), createdAt: 1, updatedAt: 1 }, { owner: 'world' }))
    const id = await db.characters.add(stampNewRecord(scope, 'characters', { projectId: scope.projectId, name: '隔离角色', roleWeight: 'main', moralAxis: 'good', orderAxis: 'lawful', shortDescription: '原文', appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '', arc: '', cultivationSystemId: systemId, cultivationStageId: 'old-stage', createdAt: 1, updatedAt: 1 }, { owner: 'world' }))
    return { projectId: scope.projectId, id, systemId, before: await db.characters.get(id) }
  })
  await page.goto(`./workspace/${f.projectId}?module=characters`)
  await page.getByRole('button', { name: /隔离角色/ }).last().click()
  await expect(page.getByLabel('主修体系')).toHaveValue(String(f.systemId))
  await page.evaluate(async projectId => {
    const load = new Function('path', 'return import(path)')
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const { useCultivationStore } = await load('/storyforge/src/stores/cultivation.ts')
    const failure = () => { throw new Error('隔离测试：原生关联读取失败') }
    db.cultivationSystems.hook('reading', failure)
    Reflect.set(window, '__775_restore', () => db.cultivationSystems.hook('reading').unsubscribe(failure))
    // The native store contract must still reject. The mounted UI observes the
    // changed scope and offers its own explicit, read-only recovery.
    useCultivationStore.setState({ loadedScope: null })
    try { await useCultivationStore.getState().loadAll(projectId) } catch { /* explicit diagnostic call */ }
  }, f.projectId)
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('隔离测试：原生关联读取失败')
  await expect(page.getByLabel('主修体系')).toBeDisabled()
  await page.evaluate(() => { (Reflect.get(window, '__775_restore') as () => void)(); Reflect.deleteProperty(window, '__775_restore') })
  await page.getByRole('button', { name: '重新读取', exact: true }).click()
  await expect(page.getByLabel('主修体系')).toBeEnabled()
  await expect(page.getByLabel('主修体系')).toHaveValue(String(f.systemId))
  await expect(page.getByLabel('当前设定境界')).toHaveValue('old-stage')
  const after = await page.evaluate(async id => {
    const load = new Function('path', 'return import(path)')
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { row: await db.characters.get(id), runs: await db.agentRuns.count() }
  }, f.id)
  expect(after.row).toEqual(f.before); expect(after.runs).toBe(0)
  expect(errors).toEqual([]); expect(blocked).toEqual([])
})
