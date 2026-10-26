import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

const original = '<p>原稿仍在，任何读取错误都不能覆盖它。</p>'
const badFields = '[{"key":"位置","value":"山门"},null]'
const repairedFields = '[{"key":"位置","value":"山门"},{"key":"身体状态","value":"右手受伤"}]'

async function prepare(page: Page) {
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({
    provider: 'ollama', baseUrl: 'https://state-recovery.invalid/v1', model: 'state-recovery-fixture',
    maxTokens: 1200, contextWindow: 64000, temperature: 0,
  })))
  // Isolated failures must never be submitted to the production support service.
  await page.route(/^https?:\/\//, route => {
    const host = new URL(route.request().url()).hostname
    return ['127.0.0.1', 'localhost', 'state-recovery.invalid'].includes(host) ? route.fallback() : route.abort()
  })
  await createLongform(page, '状态字段恢复隔离验收')
  return page.evaluate(async ({ original, badFields }) => {
    const imp = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { resolveScope, stampNewRecord }] = await Promise.all([
      imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts'),
    ])
    const project = await db.projects.toCollection().first()
    const scope = await resolveScope({ projectId: project.id })
    const base = { projectId: project.id, createdAt: 1, updatedAt: 1 }
    const characterId = await db.characters.add(stampNewRecord(scope, 'characters', {
      ...base, name: '林照', shortDescription: '探路人', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', background: '', personality: '',
    }, { owner: 'world' }))
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      ...base, type: 'chapter', parentId: null, title: '探路', summary: '沿溪探查道路，遇见断桥后停下。', order: 0,
    }, { owner: 'work' }))
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
      ...base, outlineNodeId, title: '探路', content: original, wordCount: 22, order: 0, status: 'draft', notes: '',
    }, { owner: 'work' }))
    await db.detailedOutlines.add(stampNewRecord(scope, 'detailedOutlines', {
      ...base, outlineNodeId, scenes: [{ sceneId: 's1', title: '探查断桥', summary: '林照沿溪探路，停在断桥前检查伤势。', characterIds: [characterId], location: '溪边', conflict: '', pace: 'slow', estimatedWords: 300, notes: '只推进到断桥处。' }],
    }, { owner: 'work' }))
    const cardId = await db.stateCards.add(stampNewRecord(scope, 'stateCards', {
      ...base, category: 'character', entityName: '林照', fields: badFields,
    }, { owner: 'work' }))
    return { projectId: project.id, outlineNodeId, chapterId, cardId, characterId }
  }, { original, badFields })
}

async function read(page: Page, target: Awaited<ReturnType<typeof prepare>>) {
  return page.evaluate(async ({ chapterId, cardId }) => {
    const imp = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return { chapter: await db.chapters.get(chapterId), card: await db.stateCards.get(cardId) }
  }, target)
}

test('坏字段不击穿正文页；原稿和原字段保留；作者修正后保存并刷新回读', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const target = await prepare(page)
  await page.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.outlineNodeId}`)
  try {
    await expect(page.locator('.tiptap-editor')).toHaveText('原稿仍在，任何读取错误都不能覆盖它。', { timeout: 8000 })
    await expect(page.getByTestId('state-card-data-warning')).toContainText('林照')
    expect((await read(page, target)).chapter.content).toBe(original)
    expect((await read(page, target)).card.fields).toBe(badFields)
    await page.reload()
    await expect(page.getByTestId('state-card-data-warning')).toBeVisible()
    expect((await read(page, target)).card.fields).toBe(badFields)
    await page.getByRole('button', { name: '状态与物品', exact: true }).click()
    const repair = page.getByTestId(`state-card-repair-${target.cardId}`)
    await expect(repair).toContainText('第2项')
    await repair.getByRole('button', { name: '修复状态字段', exact: true }).click()
    await expect(repair.getByRole('textbox', { name: '林照的字段1名称', exact: true })).toHaveValue('位置')
    await repair.getByRole('button', { name: '编辑原始内容', exact: true }).click()
    const editor = repair.getByRole('textbox', { name: '林照的状态字段原文' })
    await expect(editor).toHaveValue(badFields)
    await editor.fill('[{"key":"位置","value":null}]')
    await repair.getByRole('button', { name: '保存修复', exact: true }).click()
    await expect(repair.getByRole('alert')).toContainText('文本')
    expect((await read(page, target)).card.fields).toBe(badFields)
    await editor.fill(repairedFields)
    await repair.getByRole('button', { name: '保存修复', exact: true }).click()
    await expect(repair).toHaveCount(0)
    expect((await read(page, target)).card.fields).toBe(repairedFields)
    await page.reload()
    await expect(page.getByTestId(`state-card-repair-${target.cardId}`)).toHaveCount(0)
    await page.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.outlineNodeId}`)
    await expect(page.locator('.tiptap-editor')).toHaveText('原稿仍在，任何读取错误都不能覆盖它。')
    await expect(page.getByTestId('state-card-data-warning')).toHaveCount(0)
    expect((await read(page, target)).chapter.content).toBe(original)
    expect(errors).toEqual([])
  } finally {
    await testInfo.attach('state-card-page-errors.json', { body: JSON.stringify(errors), contentType: 'application/json' })
  }
})

async function openRepair(page: Page, target: Awaited<ReturnType<typeof prepare>>) {
  await page.goto(`./workspace/${target.projectId}?module=state-table`)
  const panel = page.getByTestId(`state-card-repair-${target.cardId}`)
  await panel.getByRole('button', { name: '修复状态字段', exact: true }).click()
  return panel
}

test('逐字段修复保存失败保留输入，重试成功，原字段直到成功前都不变', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const target = await prepare(page)
  const panel = await openRepair(page, target)
  await panel.getByRole('textbox', { name: '林照的字段2名称', exact: true }).fill('伤势')
  await panel.getByRole('textbox', { name: '林照的字段2值', exact: true }).fill('右手受伤')
  await page.evaluate(async id => {
    const imp = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const update = db.stateCards.update.bind(db.stateCards)
    db.stateCards.update = async (key: number, patch: any) => {
      if (key === id && Object.hasOwn(patch, 'fields')) {
        db.stateCards.update = update
        throw new Error('隔离测试：字段保存失败')
      }
      return update(key, patch)
    }
  }, target.cardId)
  await panel.getByRole('button', { name: '保存修复', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('字段保存失败')
  await expect(panel.getByRole('textbox', { name: '林照的字段2值', exact: true })).toHaveValue('右手受伤')
  expect((await read(page, target)).card.fields).toBe(badFields)
  await panel.getByRole('button', { name: '保存修复', exact: true }).click()
  await expect(panel).toHaveCount(0)
  expect(JSON.parse((await read(page, target)).card.fields)).toEqual([{ key: '位置', value: '山门' }, { key: '伤势', value: '右手受伤' }])
  expect((await read(page, target)).chapter.content).toBe(original)
  expect(errors).toEqual([])
})

test('另一窗口先修改字段时拒绝过期修复，保留作者输入和新版本', async ({ page }) => {
  const target = await prepare(page)
  const panel = await openRepair(page, target)
  await panel.getByRole('textbox', { name: '林照的字段2名称', exact: true }).fill('伤势')
  await panel.getByRole('textbox', { name: '林照的字段2值', exact: true }).fill('右手受伤')
  const other = await page.context().newPage()
  await other.goto(`./workspace/${target.projectId}?module=info`)
  await other.evaluate(async ({ id, fields }) => {
    const imp = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    await db.stateCards.update(id, { fields })
  }, { id: target.cardId, fields: '[{"key":"位置","value":"溪边"}]' })
  await panel.getByRole('button', { name: '保存修复', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('另一页面')
  await expect(panel.getByRole('textbox', { name: '林照的字段2值', exact: true })).toHaveValue('右手受伤')
  expect((await read(page, target)).card.fields).toBe('[{"key":"位置","value":"溪边"}]')
  await other.close()
})

for (const fields of ['[null]', '[{"key":"位置"}]', '[{"key":"位置","value":null}]', '[{"key":"位置","value":7}]', '{', '{}']) {
  test(`损坏字段 ${fields} 可定位、取消修复与刷新均保留原始数据`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    const target = await prepare(page)
    await page.evaluate(async ({ id, fields }) => {
      const imp = new Function('path', 'return import(path)') as (path: string) => Promise<any>
      const { db } = await imp('/storyforge/src/lib/db/schema.ts')
      await db.stateCards.update(id, { fields })
    }, { id: target.cardId, fields })
    await page.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.outlineNodeId}`)
    await expect(page.getByTestId('state-card-data-warning')).toContainText('林照')
    await expect(page.locator('.tiptap-editor')).toContainText('原稿仍在')
    const panel = await openRepair(page, target)
    await panel.getByRole('button', { name: '取消', exact: true }).click()
    expect((await read(page, target)).card.fields).toBe(fields)
    await page.reload()
    await expect(page.getByTestId(`state-card-repair-${target.cardId}`)).toBeVisible()
    expect((await read(page, target)).card.fields).toBe(fields)
    expect((await read(page, target)).chapter.content).toBe(original)
    expect(errors).toEqual([])
  })
}

test('坏状态阻止模型请求；修复后生成、编辑候选、刷新采纳、手改保存和下游状态回读', async ({ page }) => {
  const calls: any[] = []
  const generated = '林照站在山门外，右手缠着布条。他用左手拨开草丛，沿溪探查道路，听见断桥下的水声便停了脚步。'.repeat(8)
  await page.route('https://state-recovery.invalid/**', route => {
    calls.push(route.request().postDataJSON())
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: generated }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` })
  })
  const target = await prepare(page)
  await page.evaluate(async id => {
    const imp = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    await db.chapters.update(id, { content: '', wordCount: 0 })
  }, target.chapterId)
  await page.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.outlineNodeId}`)
  await expect(page.getByTestId('state-card-data-warning')).toBeVisible()
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  expect(calls).toHaveLength(0)
  const repair = await openRepair(page, target)
  await repair.getByRole('textbox', { name: '林照的字段2名称', exact: true }).fill('伤势')
  await repair.getByRole('textbox', { name: '林照的字段2值', exact: true }).fill('右手受伤')
  await repair.getByRole('button', { name: '保存修复', exact: true }).click()
  await expect(repair).toHaveCount(0)
  await page.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.outlineNodeId}`)
  await page.getByPlaceholder('自定义指令...', { exact: true }).fill('只写当前场景，保留右手受伤，停在断桥处。')
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  const candidate = page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })
  await expect(candidate).toHaveValue(generated)
  expect(calls).toHaveLength(1)
  expect(calls[0].messages.map((message: any) => message.content).join('\n')).toContain('右手受伤')
  await expect(page.locator('.tiptap-editor')).toBeEmpty()
  expect((await read(page, target)).chapter.content).not.toContain(generated)
  const edited = generated + '他把探路结果记在纸上，留待回去商议。'
  await candidate.fill(edited)
  await candidate.blur()
  await page.getByRole('button', { name: '保存候选修改', exact: true }).click()
  await expect(page.getByText('候选已保存，尚未采纳。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存候选修改', exact: true })).toBeDisabled()
  await expect(page.locator('.tiptap-editor')).toBeEmpty()
  expect((await read(page, target)).chapter.content).not.toContain(generated)
  await page.reload()
  await expect(candidate).toHaveValue(edited)
  expect(calls).toHaveLength(1)
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.locator('.tiptap-editor')).toContainText('把探路结果记在纸上')
  await page.locator('.tiptap-editor').fill('作者手改：林照用左手收好记录，右手仍旧受伤。')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.reload()
  await expect(page.locator('.tiptap-editor')).toHaveText('作者手改：林照用左手收好记录，右手仍旧受伤。')
  const downstream = await page.evaluate(async id => {
    const imp = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { useStateCardStore } = await imp('/storyforge/src/stores/state-card.ts')
    await useStateCardStore.getState().loadAll(id)
    return useStateCardStore.getState().buildSelectiveStateContext('右手受伤')
  }, target.projectId)
  expect(downstream.text).toContain('右手受伤')
  expect(downstream.matchedIds).toContain(target.cardId)
})
