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
  await page.getByRole('group', { name: '编辑模式', exact: true }).getByRole('button', { name: '富文本', exact: true }).click()
  await expect(page.locator('.tiptap-editor')).toHaveText('')
}

test('050 manual readback rejects a missing chapter and an old status receipt cannot overwrite newer prose', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '050-isolated'))
  let modelCalls = 0
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (/\/chat\/completions|\/(?:responses|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)/.test(url.pathname)) modelCalls++
    return ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort()
  })
  await openSecondBlankChapter(page)
  const flush = () => page.evaluate(async () => {
    const { flushPendingEditsV1 } = await (new Function('return import("/storyforge/src/lib/authoring/pending-edit-coordinator.ts")'))()
    await flushPendingEditsV1()
  })
  await page.locator('.tiptap-editor').fill('先确认原稿。'); await flush()
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const [{ db }, { useChapterStore }] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/stores/chapter.ts')])
    const id = useChapterStore.getState().currentChapter.id
    Object.assign(window, { originalChapter050: await db.chapters.get(id) })
    await db.chapters.delete(id)
  })
  await page.getByRole('button', { name: '已保存', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存失败', exact: true })).toBeVisible()
  await expect(page.locator('.tiptap-editor')).toHaveText('先确认原稿。')
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    await db.chapters.put((window as unknown as { originalChapter050: object }).originalChapter050)
  })
  await page.getByRole('button', { name: '保存失败', exact: true }).click()
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const original = db.chapters.update.bind(db.chapters)
    const state = window as unknown as { statusWrite050?: boolean; releaseStatus050?: () => void }
    const gate = new Promise<void>(resolve => { state.releaseStatus050 = resolve })
    db.chapters.update = async (key: number, patch: Record<string, unknown>) => {
      if (patch.status === 'final') { db.chapters.update = original; state.statusWrite050 = true; await gate }
      return original(key, patch)
    }
  })
  await page.getByRole('combobox', { name: '章节状态', exact: true }).selectOption('final')
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { statusWrite050?: boolean }).statusWrite050))).toBe(true)
  const latest = '保存等待期间继续输入的新稿，不能被旧状态回执清掉。'
  await page.locator('.tiptap-editor').fill(latest)
  await page.evaluate(() => (window as unknown as { releaseStatus050: () => void }).releaseStatus050())
  await flush(); await expect(page.locator('.tiptap-editor')).toHaveText(latest)
  await expect(page.getByRole('button', { name: '已保存', exact: true })).toBeVisible()
  const actual = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const [{ db }, { useChapterStore }] = await Promise.all([load('/storyforge/src/lib/db/schema.ts'), load('/storyforge/src/stores/chapter.ts')])
    return db.chapters.get(useChapterStore.getState().currentChapter.id)
  })
  expect(actual.content).toContain(latest); expect(actual.status).toBe('final'); expect(modelCalls).toBe(0)
})

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
  await page.getByRole('group', { name: '编辑模式', exact: true }).getByRole('button', { name: '富文本', exact: true }).click()
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
  await page.getByRole('group', { name: '编辑模式', exact: true }).getByRole('button', { name: '富文本', exact: true }).click()
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
  await page.getByRole('group', { name: '编辑模式', exact: true }).getByRole('button', { name: '富文本', exact: true }).click()
  await expect(page.locator('.tiptap-editor')).toHaveText('')
  await page.reload()
  await page.getByRole('button', { name: /^2 仅大纲 第2章/ }).click()
  await expect(page.locator('.tiptap-editor')).toHaveText(latest)
  await page.locator('.tiptap-editor').press('ControlOrMeta+A')
  await page.locator('.tiptap-editor').press('Backspace')
  await expect(page.locator('.tiptap-editor')).toHaveText('')
  await page.getByRole('button', { name: /^1 仅大纲 第1章/ }).click()
  await expect(page.getByRole('heading', { name: '第1章', exact: true, level: 2 })).toBeVisible()
  await page.getByRole('group', { name: '编辑模式', exact: true }).getByRole('button', { name: '富文本', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: /^2 仅大纲 第2章/ }).click()
  await expect(page.locator('.tiptap-editor')).toHaveText('')
})
