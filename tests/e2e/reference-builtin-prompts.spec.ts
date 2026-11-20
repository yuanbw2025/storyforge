import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test('拆书历史模板不再出现在配置入口，灵感反推模板继续可配置', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'reference-builtin-e2e'))
  await createLongform(page, '拆书内置指令验收')
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { RETIRED_PROMPT_MODULE_KEYS } = await load<typeof import('../../src/lib/types/prompt')>('/storyforge/src/lib/types/prompt.ts')
    await db.promptTemplates.bulkAdd(RETIRED_PROMPT_MODULE_KEYS.map(moduleKey => ({
      moduleKey, scope: 'user', promptType: 'analyze', name: `历史拆书-${moduleKey}`,
      description: '', systemPrompt: '历史模板应保留', userPromptTemplate: '', variables: [],
      isActive: true, createdAt: 1, updatedAt: 1,
    })))
  })
  await page.reload()
  await openLongformLeaf(page, '提示词库')
  const search = page.getByRole('searchbox', { name: '搜索提示词' })
  await search.fill('拆书')
  await expect(page.getByText('当前筛选下没有模板')).toBeVisible()
  await search.fill('灵感')
  await expect(page.getByRole('button', { name: /内置-灵感反推/ }).first()).toBeVisible()
  await page.getByRole('button', { name: /内置-灵感反推/ }).first().click()
  await expect(page.getByRole('button', { name: /克隆/ })).toBeVisible()
  const kept = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return (await db.promptTemplates.toArray()).filter(t => t.name.startsWith('历史拆书-'))
  })
  expect(kept).toHaveLength(4)
  expect(kept.every(t => t.systemPrompt === '历史模板应保留' && t.isActive)).toBe(true)
})
