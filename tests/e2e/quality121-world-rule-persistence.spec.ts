import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'

test('世界规则精确保存和刷新；写入失败保稿重试，删除后导出并明确放弃，导航屏障不伪称成功', async ({ page }, testInfo) => {
  const saved = '已保存的规则 e\u0301 😀'
  const retryDraft = 'Quota失败后仍在的规则 e\u0301 😀'
  const deletedDraft = '目标删除后仍应完整导出的规则\n第二行 😀'
  const pageErrors: string[] = []
  let modelRequests = 0
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/chat/completions', async route => { modelRequests++; await route.abort() })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /天地为炉，\s*万象成故事。/ })).toBeVisible({ timeout: 15_000 })
  const target = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { createWorkspace } = await load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts')
    const { useWorldRulesStore } = await load<typeof import('../../src/stores/world-rules')>('/storyforge/src/stores/world-rules.ts')
    const made = await createWorkspace({ name: '规则保存隔离验收', description: '', genres: [], status: 'drafting', targetWordCount: 100_000 },
      { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    await useWorldRulesStore.getState().loadProfile(made.scope)
    const id = useWorldRulesStore.getState().profile?.id
    if (!id) throw new Error('真实规则目标未创建')
    return { scope: made.scope, id }
  })
  const read = () => page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return await db.worldRulesProfiles.get(id)
  }, target.id)
  await page.goto(`./workspace/${target.scope.projectId}?module=world-rules`)
  await openLongformLeaf(page, '真实与幻想')
  const note = page.getByPlaceholder('例如：本作以唐代为蓝本但加入仙侠元素，凡是涉及朝堂制度的一律遵循史实，力量体系完全虚构。', { exact: true })
  await note.fill(saved)
  await expect.poll(async () => (await read())?.globalNote).toBe(saved)
  await page.reload()
  await expect(note).toHaveValue(saved)

  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    Reflect.set(window, 'sfqa121QuotaHits', 0)
    const fault = () => {
      db.worldRulesProfiles.hook('updating').unsubscribe(fault)
      Reflect.set(window, 'sfqa121QuotaHits', 1)
      throw new DOMException('隔离Quota写入失败', 'QuotaExceededError')
    }
    db.worldRulesProfiles.hook('updating', fault)
  })
  await note.fill(retryDraft)
  await expect(page.getByRole('alert')).toContainText('隔离Quota写入失败')
  expect(await page.evaluate(() => Reflect.get(window, 'sfqa121QuotaHits'))).toBe(1)
  expect((await read())?.globalNote).toBe(saved)
  await expect(note).toHaveValue(retryDraft)
  await page.getByRole('button', { name: '重试保存规则', exact: true }).click()
  await expect.poll(async () => (await read())?.globalNote).toBe(retryDraft)

  const otherPage = await page.context().newPage()
  await otherPage.goto('./')
  await otherPage.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    await db.worldRulesProfiles.delete(id)
  }, target.id)
  await otherPage.close()
  await note.fill(deletedDraft)
  await expect(page.getByRole('alert')).toContainText('规则目标已删除')
  await expect(note).toHaveValue(deletedDraft)
  expect(await read()).toBeUndefined()
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: '导出未保存规则草稿', exact: true }).click(),
  ])
  const path = testInfo.outputPath('world-rules-author-draft.json')
  await download.saveAs(path)
  const recovered = JSON.parse(await readFile(path, 'utf8')) as { format: string; scope: typeof target.scope; profile: { id: number; globalNote: string } }
  expect(recovered.format).toBe('storyforge-world-rules-draft-v1')
  expect(recovered.scope).toEqual(target.scope)
  expect(recovered.profile.id).toBe(target.id)
  expect(recovered.profile.globalNote).toBe(deletedDraft)
  const settings = page.getByRole('navigation', { name: '长篇一级导航' }).getByRole('button', { name: '通用设置', exact: true })
  await settings.click()
  await expect(page.getByRole('heading', { name: '⚖️ 真实与幻想', exact: true })).toBeVisible()
  await expect(note).toHaveValue(deletedDraft)
  expect(await read()).toBeUndefined()
  await page.getByRole('button', { name: '放弃未保存规则输入', exact: true }).click()
  await settings.click()
  await expect(note).toHaveCount(0)
  expect(await read()).toBeUndefined()
  expect(pageErrors).toEqual([])
  expect(modelRequests).toBe(0)
})
