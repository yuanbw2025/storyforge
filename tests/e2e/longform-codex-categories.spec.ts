import { expect, test, type Page } from '@playwright/test'
import { BUILTIN_CATEGORIES } from '../../src/lib/types/codex'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

const places: Record<string, [string, string]> = {
  mineral: ['自然环境', '自然资源'], herb: ['自然环境', '自然资源'], beast: ['自然环境', '自然资源'],
  natStructure: ['自然环境', '世界结构'], natDimension: ['自然环境', '疆域尺寸'], natTerrain: ['自然环境', '地貌分布'], natWater: ['自然环境', '山川水系'], natClimate: ['自然环境', '气候环境'],
  race: ['人文环境', '种族与民族'], faction: ['人文环境', '势力分布'], city: ['人文环境', '城池重镇'], artifact: ['人文环境', '道具与器物'],
  humPolitics: ['人文环境', '政治制度'], humEconomy: ['人文环境', '经济制度'], humCulture: ['人文环境', '文化制度'], humConflict: ['人文环境', '矛盾冲突'],
  originPower: ['世界起源', '力量体系'], originDeity: ['世界起源', '神明与信仰'],
}
async function openCategory(page: Page, key: string) {
  const [module, panel] = places[key]
  await openLongformLeaf(page, module)
  await expect(page).toHaveURL(new RegExp(`module=worldview-${module === '自然环境' ? 'natural' : module === '人文环境' ? 'humanity' : 'origin'}`))
  if (module === '世界起源') await page.locator('.worldview-origin-nav').getByRole('button', { name: panel, exact: true }).click()
  else await page.getByRole('button').filter({ hasText: new RegExp(`${panel}$`) }).last().click()
  if (['mineral', 'herb', 'beast'].includes(key)) await page.getByText(BUILTIN_CATEGORIES.find(category => category.builtInKey === key)!.name, { exact: true }).first().click()
}
async function rows(page: Page, projectId: number) {
  return page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.codexEntries.where('projectId').equals(id).toArray()
  }, projectId)
}
async function add(page: Page, projectId: number, key: string, name: string) {
  await openCategory(page, key)
  await page.getByRole('button', { name: '新建词条', exact: true }).click()
  await expect(page.getByPlaceholder('名称', { exact: true })).toHaveValue('新词条')
  await page.getByPlaceholder('名称', { exact: true }).fill(name)
  await expect.poll(async () => (await rows(page, projectId)).some((entry: { name: string }) => entry.name === name)).toBe(true)
  return (await rows(page, projectId)).find((entry: { name: string }) => entry.name === name)
}

for (const category of BUILTIN_CATEGORIES.filter(category => places[category.builtInKey])) {
  test(`codex ${category.builtInKey}: every manual field, reference, clear, reload and deletion`, async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
    await page.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
    await createLongform(page, `词条逐类验收-${category.builtInKey}`)
    const projectId = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
    const targets = new Map<string, { id: number; name: string }>()
    for (const field of category.fields.filter(field => field.type === 'ref')) {
      const targetKey = field.refCategory || category.builtInKey
      if (!targets.has(targetKey)) targets.set(targetKey, await add(page, projectId, targetKey, `引用目标-${targetKey}`))
    }
    const name = `可修改词条-${category.builtInKey}`
    const entry = await add(page, projectId, category.builtInKey, name)
    await page.getByPlaceholder('图标', { exact: true }).fill('♦')
    await page.getByPlaceholder('一句话简介', { exact: true }).fill('盐镇探路所需，能力有明确代价。')
    await page.getByPlaceholder('详细描述', { exact: true }).fill('只有先留下脚印才能辨认来路，不能直接获知未走过的路。')
    await page.getByPlaceholder('标签（用顿号或逗号分隔）', { exact: true }).fill('探路、代价')
    await page.getByRole('button', { name: '3 星', exact: true }).click()
    const values: Record<string, string> = {}, refs: Record<string, number[]> = {}
    for (const field of category.fields) {
      const row = page.getByText(field.label, { exact: true }).locator('..')
      if (field.type === 'ref') {
        const target = targets.get(field.refCategory || category.builtInKey)!
        await row.getByRole('button').click()
        if (field.refMulti === false) { await row.getByRole('checkbox', { name: new RegExp(target.name) }).click(); await expect(row).toContainText(target.name) }
        else await row.getByRole('checkbox', { name: new RegExp(target.name) }).check()
        refs[field.key] = [target.id]
      } else {
        const value = field.type === 'select' ? field.options![0] : field.type === 'number' ? '3' : `盐镇-${field.label}-原文`
        if (field.type === 'select') await row.locator('select').selectOption(value)
        else await row.locator(field.type === 'longtext' ? 'textarea' : 'input').fill(value)
        values[field.key] = value
      }
    }
    await openLongformLeaf(page, '故事设计'); await expect(page).toHaveURL(/module=story-design/)
    const saved = (await rows(page, projectId)).find((row: { id: number }) => row.id === entry.id)
    expect(saved).toMatchObject({ name, icon: '♦', importance: 3, summary: '盐镇探路所需，能力有明确代价。' })
    expect(JSON.parse(saved.fields)).toEqual(values); expect(JSON.parse(saved.refs)).toEqual(refs)
    expect(JSON.parse(saved.tags)).toEqual(['探路', '代价'])
    await page.reload(); await openCategory(page, category.builtInKey)
    await page.getByText(name, { exact: true }).first().click()
    for (const field of category.fields) {
      const row = page.getByText(field.label, { exact: true }).locator('..')
      if (field.type === 'ref') {
        const target = targets.get(field.refCategory || category.builtInKey)!
        await expect(row).toContainText(target.name)
        await row.getByRole('button').click()
        if (field.refMulti === false) { await row.getByRole('checkbox', { name: new RegExp(target.name) }).click(); await expect(row).not.toContainText(target.name) }
        else await row.getByRole('checkbox', { name: new RegExp(target.name) }).uncheck()
      } else {
        await expect(row.locator(field.type === 'select' ? 'select' : field.type === 'longtext' ? 'textarea' : 'input')).toHaveValue(values[field.key])
        if (field.type === 'select') await row.locator('select').selectOption('')
        else await row.locator(field.type === 'longtext' ? 'textarea' : 'input').fill('')
      }
    }
    await openLongformLeaf(page, '故事设计'); await expect(page).toHaveURL(/module=story-design/)
    const cleared = (await rows(page, projectId)).find((row: { id: number }) => row.id === entry.id)
    expect(Object.values(JSON.parse(cleared.fields))).toEqual(Object.values(values).map(() => ''))
    expect(Object.values(JSON.parse(cleared.refs))).toEqual(Object.values(refs).map(() => []))
    await page.reload(); await openCategory(page, category.builtInKey)
    await page.getByText(name, { exact: true }).first().locator('..').getByRole('button').click()
    await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
    await expect.poll(async () => (await rows(page, projectId)).some((row: { id: number }) => row.id === entry.id)).toBe(false)
    expect(errors).toEqual([])
    await info.attach('codex-manual-evidence', { contentType: 'application/json', body: JSON.stringify({ category: category.builtInKey, fieldCount: category.fields.length, values, refs, saved, cleared, deleted: true, errors }) })
  })
}
