import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

test('拆书模板在库中可见，用户副本激活和刷新后进入真实消息构建', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'reference-template-e2e'))
  await createLongform(page, '拆书提示词库验收')
  await openLongformLeaf(page, '提示词库')
  await page.getByRole('searchbox', {name: '搜索提示词'}).fill('拆书')
  for (const name of ['内置-拆书细读','内置-拆书已读范围综合','内置-拆书人物归并','内置-拆书方法原创运用']) {
    await expect(page.getByRole('button', {name: new RegExp(name)})).toBeVisible()
  }
  await page.getByRole('button', {name: /内置-拆书细读/}).click()
  await expect(page.locator('textarea').filter({hasText: '你是谨慎的作品细读编辑'})).toBeVisible()
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const {usePromptStore} = await load<typeof import('../../src/stores/prompt')>('/storyforge/src/stores/prompt.ts')
    const store = usePromptStore.getState()
    const tpl = store.getActive('reference.analyze')
    const id = await store.cloneTemplate(tpl.id!, '作者的拆书模板')
    const custom = usePromptStore.getState().templates.find(t => t.id === id)!
    await usePromptStore.getState().saveTemplate({...custom, systemPrompt: '浏览器验收：只研究相处质感', userPromptTemplate: '保留日常'})
    await usePromptStore.getState().setActive(id)
  })
  await page.reload()
  await openLongformLeaf(page, '提示词库')
  await page.getByRole('searchbox', {name: '搜索提示词'}).fill('作者的拆书模板')
  await page.getByRole('button', {name: /作者的拆书模板/}).click()
  await expect(page.locator('textarea').filter({hasText: '浏览器验收：只研究相处质感'})).toBeVisible()
  const text = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const {referenceChunkMessages} = await load<typeof import('../../src/lib/reference-analysis/chunk-prompt')>('/storyforge/src/lib/reference-analysis/chunk-prompt.ts')
    return referenceChunkMessages({runId: 1, ref: {title:'隔离材料',type:'story'} as any, depth:'deep',totalChunks:1,maxTokens:8192,
      chunk:{index:0,startChar:0,endChar:6,charCount:6,text:'不可丢失的原文'}}).map(m=>m.content).join('\n')
  })
  expect(text).toContain('浏览器验收：只研究相处质感')
  expect(text).toContain('不可丢失的原文')
  expect(text).toContain('固定交付协议')
})
