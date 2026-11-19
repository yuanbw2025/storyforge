import { expect, test } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'

for (const decision of ['reload', 'replace'] as const) test(`metadata repaint retains an unresolved field conflict until explicit ${decision}`, async ({ page, context }, info) => {
  const original = 'A正式状态', local = '作者未保存状态 e\u0301 😀', external = 'B另页正式状态'
  let forbidden = 0
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['GET', 'HEAD'].includes(request.method())) {
      forbidden++; return route.abort()
    }
    return route.continue()
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./')
  const target = await page.evaluate(async original => {
    const root = '/storyforge/src/', { createWorkspace } = await import(root + 'lib/workspace/create-workspace.ts')
    const { useCharacterStore } = await import(root + 'stores/character.ts')
    const { useStateCardStore } = await import(root + 'stores/state-card.ts')
    const { db } = await import(root + 'lib/db/schema.ts')
    const created = await createWorkspace({ name: '052 隔离状态冲突', description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000 },
      { purpose: 'independent-work', kind: 'novel', novelProfile: 'long', importedNovelText: '隔离测试正文，任何状态编辑都不能改动此原稿。' })
    await useCharacterStore.getState().addCharacter({ projectId: created.scope.projectId, name: '林照', roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral',
      shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '[]', arc: '' })
    const cardId = await useStateCardStore.getState().addCard({ projectId: created.scope.projectId, category: 'character', entityName: '林照',
      fields: JSON.stringify([{ key: '状态', value: original }]) })
    const chapter = await db.chapters.where('projectId').equals(created.scope.projectId).first()
    if (!chapter?.id) throw Error('Native metadata fixture requires an actual owned chapter')
    return { scope: created.scope, cardId, chapterId: chapter.id, chapterTitle: chapter.title, chapterBefore: chapter }
  }, original)
  const read = () => page.evaluate(async target => {
    const path = '/storyforge/src/lib/db/schema.ts', { db } = await import(path)
    return { card: await db.stateCards.get(target.cardId), chapter: await db.chapters.get(target.chapterId) }
  }, target)
  await page.goto(`./workspace/${target.scope.projectId}?module=state-table`)
  await openLongformLeaf(page, '状态表')
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: '林照', exact: true }) })
  await card.getByRole('button', { name: '编辑状态', exact: true }).click()
  const value = card.getByPlaceholder('当前值', { exact: true })
  await expect(value).toHaveValue(original)
  await value.fill(local)
  const peer = await context.newPage()
  await peer.goto(page.url())
  const update = (data: { fields?: string; lastChapterId?: number | null }) => peer.evaluate(async ({ target, data }) => {
    const path = '/storyforge/src/stores/state-card.ts', { useStateCardStore } = await import(path)
    await useStateCardStore.getState().updateCard(target.cardId, data, { scope: target.scope })
  }, { target, data })
  await update({ fields: JSON.stringify([{ key: '状态', value: external }]) })
  await expect(card.getByRole('alert').filter({ hasText: external })).toBeVisible()
  await value.fill(original)
  const refreshedChapter = await page.evaluate(async target => {
    const path = '/storyforge/src/stores/state-card.ts', { useStateCardStore } = await import(path)
    await useStateCardStore.getState().updateCard(target.cardId, { lastChapterId: target.chapterId }, { scope: target.scope })
    return useStateCardStore.getState().cards.find((row: { id: number }) => row.id === target.cardId)?.lastChapterId
  }, target)
  expect(refreshedChapter).toBe(target.chapterId)
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())))
  const beforeUnreviewedSave = await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented })
  expect(beforeUnreviewedSave).toBe(true)
  const beforeSave = await read()
  await card.getByRole('button', { name: '保存', exact: true }).click()
  await expect(value).toHaveValue(original)
  await expect(card.getByRole('alert').filter({ hasText: external })).toBeVisible()
  expect(await read()).toEqual(beforeSave)
  const blocked = await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented })
  expect(blocked).toBe(true)
  await page.getByRole('navigation', { name: '长篇工作台二级导航' })
    .getByRole('button', { name: '人物与关系', exact: true }).click()
  await expect(value).toHaveValue(original)
  expect(await read()).toEqual(beforeSave)
  await page.screenshot({ path: info.outputPath(`052-${decision}-conflict.png`), fullPage: true, animations: 'disabled' })
  if (decision === 'reload') {
    await card.getByRole('button', { name: '重载外部版本（舍弃本地输入）', exact: true }).click()
    await expect(value).toHaveValue(external)
    await expect(card.getByRole('alert')).toHaveCount(0)
    expect(await read()).toEqual(beforeSave)
    const latest = 'C明确重载后外部新值'
    await update({ lastChapterId: null, fields: JSON.stringify([{ key: '状态', value: latest }]) })
    await expect(value).toHaveValue(latest)
    await expect(card.getByRole('alert')).toHaveCount(0)
    await card.getByRole('button', { name: '保存', exact: true }).click()
  } else {
    await card.getByRole('button', { name: '用本地输入替换已查看版本', exact: true }).click()
  }
  await expect(value).toHaveCount(0)
  const saved = await read()
  expect(saved.card.fields).toBe(JSON.stringify([{ key: '状态', value: decision === 'reload' ? 'C明确重载后外部新值' : original }]))
  expect(saved.chapter).toEqual(target.chapterBefore)
  await peer.close()
  await page.reload()
  await openLongformLeaf(page, '状态表')
  expect(await read()).toEqual(saved)
  await card.getByRole('button', { name: '编辑状态', exact: true }).click()
  await expect(value).toHaveValue(decision === 'reload' ? 'C明确重载后外部新值' : original)
  await expect(card.getByRole('alert')).toHaveCount(0)
  expect(forbidden).toBe(0); expect(errors).toEqual([])
})
