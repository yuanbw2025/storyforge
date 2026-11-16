import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test('SFQA062 state adoption and the real character view stay with their Work across a cached sibling and refresh', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLongform(page, 'SFQA062 作者状态隔离')
  const projectId = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
  const fixture = await page.evaluate(async projectId => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { resolveScopeLike, stampNewRecord } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    const { createWorldWork } = await load<typeof import('../../src/lib/workspace/works')>('/storyforge/src/lib/workspace/works.ts')
    const { useStateCardStore } = await load<typeof import('../../src/stores/state-card')>('/storyforge/src/stores/state-card.ts')
    const a = await resolveScopeLike(projectId)
    const work = await createWorldWork(projectId, { title: 'B兄弟作品', kind: 'novel', novelProfile: 'long' })
    const b = { ...a, workId: work.id! }
    await db.characters.add(stampNewRecord(a, 'characters', {
      projectId, name: '林照', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '隔离验收角色',
      appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '[]', arc: '', createdAt: 1, updatedAt: 1,
    }, { owner: 'world' }))
    const ids: number[] = []
    for (const [scope, prefix] of [[a, 'A'], [b, 'B']] as const) ids.push(await db.stateCards.add(stampNewRecord(scope, 'stateCards', {
      projectId, category: 'character', entityName: '林照', fields: JSON.stringify([{ key: '位置', value: `${prefix}位置` }, { key: `${prefix}私域`, value: `${prefix}秘密` }]), createdAt: 1, updatedAt: 1,
    }, { owner: 'work' })))
    await useStateCardStore.getState().loadAll(b)
    return { a, b, aId: ids[0], bId: ids[1], beforeB: await db.stateCards.get(ids[1]) }
  }, projectId)
  await openLongformLeaf(page, '主要角色')
  await page.getByRole('button').filter({ hasText: '林照' }).first().click()
  await expect(page.getByText('A位置', { exact: true })).toBeVisible()
  await expect(page.getByText('B秘密', { exact: true })).toHaveCount(0)
  const adopted = await page.evaluate(async fixture => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { useStateCardStore } = await load<typeof import('../../src/stores/state-card')>('/storyforge/src/stores/state-card.ts')
    await useStateCardStore.getState().applyDiffs(fixture.a, [{ entityName: '林照', category: 'character', field: '位置', oldValue: 'A位置', newValue: 'A下一处' }])
    return { a: await db.stateCards.get(fixture.aId), b: await db.stateCards.get(fixture.bId) }
  }, fixture)
  expect(adopted.b).toEqual(fixture.beforeB)
  expect(adopted.a?.fields).toContain('A秘密')
  expect(adopted.a?.fields).not.toContain('B秘密')
  await expect(page.getByText('A下一处', { exact: true })).toBeVisible()
  await page.reload()
  await openLongformLeaf(page, '主要角色')
  await page.getByRole('button').filter({ hasText: '林照' }).first().click()
  await expect(page.getByText('A下一处', { exact: true })).toBeVisible()
  await page.evaluate(async fixture => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { switchActiveWork } = await load<typeof import('../../src/lib/workspace/works')>('/storyforge/src/lib/workspace/works.ts')
    await switchActiveWork(fixture.b.projectId, fixture.b.workId)
  }, fixture)
  await page.reload()
  await openLongformLeaf(page, '主要角色')
  await page.getByRole('button').filter({ hasText: '林照' }).first().click()
  await expect(page.getByText('B位置', { exact: true })).toBeVisible()
  await expect(page.getByText('A秘密', { exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})
