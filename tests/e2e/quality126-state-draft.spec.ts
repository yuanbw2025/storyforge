import { expect, test } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'

test('状态卡外部更新保留作者输入，明确处理冲突后保存，导航前落盘并刷新回读', async ({ page }) => {
  const draft = '作者未保存的状态 e\u0301 😀'
  const pending = '离开前仍在编辑的状态 \u{1F680}'
  const external = '其他页面刚刚确认的状态'
  let modelRequests = 0
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/chat/completions', async route => { modelRequests++; await route.abort() })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /天地为炉，\s*万象成故事。/ })).toBeVisible({ timeout: 15_000 })
  const target = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
    const { useCharacterStore } = await load<typeof import('../../src/stores/character')>('/storyforge/src/stores/character.ts')
    const { useStateCardStore } = await load<typeof import('../../src/stores/state-card')>('/storyforge/src/stores/state-card.ts')
    const created = await createWorkspace({ name: '状态作者输入隔离验收', description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000 },
      { purpose: 'independent-work', kind: 'novel', novelProfile: 'long', importedNovelText: '这一章是作者原稿，不受状态编辑影响。' })
    await useCharacterStore.getState().addCharacter({ projectId: created.scope.projectId, name: '林照', roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral',
      shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '[]', arc: '' })
    const cardId = await useStateCardStore.getState().addCard({ projectId: created.scope.projectId, category: 'character', entityName: '林照', fields: JSON.stringify([{ key: '状态', value: '原状态' }]) })
    return { scope: created.scope, cardId }
  })
  const read = () => page.evaluate(async ({ cardId }) => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return (await db.stateCards.get(cardId))?.fields
  }, target)
  await page.goto(`./workspace/${target.scope.projectId}?module=state-table`)
  await openLongformLeaf(page, '状态表')
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: '林照', exact: true }) })
  await card.getByRole('button', { name: '编辑状态', exact: true }).click()
  const value = card.getByPlaceholder('当前值', { exact: true })
  await expect(value).toHaveValue('原状态')
  await value.fill(draft)
  await page.evaluate(async ({ target, external }) => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useStateCardStore } = await load<typeof import('../../src/stores/state-card')>('/storyforge/src/stores/state-card.ts')
    await useStateCardStore.getState().updateCard(target.cardId, { fields: JSON.stringify([{ key: '状态', value: external }]) }, { scope: target.scope })
  }, { target, external })
  await expect(value).toHaveValue(draft)
  await expect(card.getByRole('alert')).toContainText(external)
  await card.getByRole('button', { name: '保存', exact: true }).click()
  await expect(value).toHaveValue(draft)
  expect(await read()).toBe(JSON.stringify([{ key: '状态', value: external }]))
  await card.getByRole('button', { name: '用本地输入替换已查看版本', exact: true }).click()
  await expect(value).toHaveCount(0)
  expect(await read()).toBe(JSON.stringify([{ key: '状态', value: draft }]))
  await card.getByRole('button', { name: '编辑状态', exact: true }).click()
  await value.fill(pending)
  await openLongformLeaf(page, '主要角色')
  expect(await read()).toBe(JSON.stringify([{ key: '状态', value: pending }]))
  await page.reload()
  expect(await read()).toBe(JSON.stringify([{ key: '状态', value: pending }]))
  expect(pageErrors).toEqual([])
  expect(modelRequests).toBe(0)
})
