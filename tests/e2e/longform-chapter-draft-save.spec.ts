import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

async function openSecondBlankChapter(page: Page) {
  await createLongform(page, '章节手稿保存隔离验收')
  await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await page.getByRole('button', { name: /^2 仅大纲 第2章/ }).click()
  await expect(page.getByRole('heading', { name: '第2章', exact: true, level: 2 })).toBeVisible()
  await expect(page.locator('.tiptap-editor')).toHaveText('')
}

test('a late chapter refresh cannot replace unsaved prose before a rapid chapter switch', async ({ page }) => {
  await openSecondBlankChapter(page)
  await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { useChapterStore } = await importer('/storyforge/src/stores/chapter.ts')
    const row = useChapterStore.getState().currentChapter
    ;(window as any).__lateChapterRefresh = () => useChapterStore.setState({ currentChapter: { ...row } })
  })
  const draft = '第二章的新手稿，旧读取回执和快速切章都不能丢掉。'
  await page.locator('.tiptap-editor').fill(draft)
  await page.evaluate(() => (window as any).__lateChapterRefresh())
  await expect(page.locator('.tiptap-editor')).toHaveText(draft)
  await page.getByRole('button', { name: /^1 仅大纲 第1章/ }).click()
  await expect(page.getByRole('heading', { name: '第1章', exact: true, level: 2 })).toBeVisible()
  await page.getByRole('button', { name: /^2 仅大纲 第2章/ }).click()
  await expect(page.locator('.tiptap-editor')).toHaveText(draft)
  await page.evaluate(() => (window as any).__lateChapterRefresh())
  await expect(page.locator('.tiptap-editor')).toHaveText(draft)
  await page.reload()
  await page.getByRole('button', { name: /^2 仅大纲 第2章/ }).click()
  await expect(page.locator('.tiptap-editor')).toHaveText(draft)
})

test('a failed draft save keeps the chapter and text open; retry saves before switching', async ({ page }) => {
  await openSecondBlankChapter(page)
  await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, { useChapterStore }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/stores/chapter.ts')])
    const id = useChapterStore.getState().currentChapter.id, original = db.chapters.update.bind(db.chapters)
    db.chapters.update = async (key: unknown, patch: any) => {
      if (key === id && Object.prototype.hasOwnProperty.call(patch, 'content')) {
        db.chapters.update = original
        throw new Error('隔离测试：本次正文保存失败')
      }
      return original(key, patch)
    }
  })
  const draft = '保存失败时仍留在原章节，重试后才能切换。'
  await page.locator('.tiptap-editor').fill(draft)
  await page.getByRole('button', { name: /^1 仅大纲 第1章/ }).click()
  await expect(page.getByText(/切换前保存失败/)).toBeVisible()
  await expect(page.getByRole('heading', { name: '第2章', exact: true, level: 2 })).toBeVisible()
  await expect(page.locator('.tiptap-editor')).toHaveText(draft)
  await page.getByRole('button', { name: /^1 仅大纲 第1章/ }).click()
  await expect(page.getByRole('heading', { name: '第1章', exact: true, level: 2 })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /^2 仅大纲 第2章/ }).click()
  await expect(page.locator('.tiptap-editor')).toHaveText(draft)
})

test('text typed during a delayed save survives its older receipt and is saved to the original chapter', async ({ page }) => {
  await openSecondBlankChapter(page)
  await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [{ db }, { useChapterStore }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/stores/chapter.ts')])
    const id = useChapterStore.getState().currentChapter.id, original = db.chapters.update.bind(db.chapters)
    const gate = new Promise<void>(resolve => { (window as any).__releaseDraftSave = resolve })
    db.chapters.update = async (key: unknown, patch: any) => {
      if (key === id && Object.prototype.hasOwnProperty.call(patch, 'content')) {
        db.chapters.update = original
        ;(window as any).__draftSaveStarted = true
        await gate
      }
      return original(key, patch)
    }
  })
  await page.locator('.tiptap-editor').fill('先输入的稿件。')
  await page.getByRole('button', { name: /^1 仅大纲 第1章/ }).click()
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__draftSaveStarted))).toBe(true)
  await expect(page.getByRole('heading', { name: '第2章', exact: true, level: 2 })).toBeVisible()
  const latest = '保存等待期间继续输入的新稿，不能被旧回执清除。'
  await page.locator('.tiptap-editor').fill(latest)
  // Selecting the still-open chapter cancels the earlier pending navigation.
  await page.getByRole('button', { name: /^2 仅大纲 第2章/ }).click()
  await page.evaluate(() => (window as any).__releaseDraftSave())
  await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    await (await imp('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')).flushPendingEditsV1()
  })
  await expect(page.getByRole('heading', { name: '第2章', exact: true, level: 2 })).toBeVisible()
  await page.getByRole('button', { name: /^1 仅大纲 第1章/ }).click()
  await expect(page.getByRole('heading', { name: '第1章', exact: true, level: 2 })).toBeVisible()
  await expect(page.locator('.tiptap-editor')).toHaveText('')
  await page.reload()
  await page.getByRole('button', { name: /^2 仅大纲 第2章/ }).click()
  await expect(page.locator('.tiptap-editor')).toHaveText(latest)
  await page.locator('.tiptap-editor').press('ControlOrMeta+A')
  await page.locator('.tiptap-editor').press('Backspace')
  await expect(page.locator('.tiptap-editor')).toHaveText('')
  await page.getByRole('button', { name: /^1 仅大纲 第1章/ }).click()
  await expect(page.getByRole('heading', { name: '第1章', exact: true, level: 2 })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /^2 仅大纲 第2章/ }).click()
  await expect(page.locator('.tiptap-editor')).toHaveText('')
})
