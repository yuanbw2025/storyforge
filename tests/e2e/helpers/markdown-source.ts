import { expect, type Locator, type Page } from '@playwright/test'

/** Follow the actual field's read/edit controls; never replace a persisted-value
 * assertion with rendered Markdown text or enable an invalid/read-only field. */
export async function enterMarkdownSourceEditorV1(scope: Locator, editor: Locator, emptyPlaceholder?: string) {
  if (await editor.count()) {
    await expect(editor).toHaveCount(1)
    await expect(editor).toBeVisible()
    await expect(editor).toBeEditable()
    return editor
  }
  await expect(scope).toHaveCount(1)
  await expect(scope).toBeVisible()
  const reading = scope.locator('[data-markdown-read-view]')
  if (await reading.count()) {
    await expect(reading).toHaveCount(1)
    await reading.getByRole('button', { name: '编辑源码', exact: true }).click()
  } else if (await editor.count() === 0 && emptyPlaceholder) {
    await scope.getByText(emptyPlaceholder, { exact: true }).click()
  }
  await expect(editor).toBeVisible()
  await expect(editor).toBeEditable()
  return editor
}

/** Inspect the complete literal source, not normalized rendered text. */
export async function expectMarkdownSourceValueV1(scope: Locator, editor: Locator, value: string) {
  if (await editor.count()) {
    await expect(editor).toHaveCount(1)
    await expect(editor).toHaveValue(value)
    return
  }
  await expect(scope).toHaveCount(1)
  await expect(scope).toBeVisible()
  const reading = scope.locator('[data-markdown-read-view]')
  if (await reading.count()) {
    await expect(reading).toHaveCount(1)
    const source = reading.locator('[data-markdown-source]')
    if (await source.count() === 0) await reading.getByRole('button', { name: '查看源码', exact: true }).click()
    await expect(reading.getByRole('button', { name: '返回阅读', exact: true })).toHaveAttribute('aria-expanded', 'true')
    await expect(source).toHaveCount(1)
    // A literal empty pre has zero height; require the opened, displayed source
    // and exact empty contents instead of inventing a visible placeholder.
    if (value.length) await expect(source).toBeVisible()
    else await expect(source).toHaveCSS('display', 'block')
    await expect.poll(() => source.textContent()).toBe(value)
  } else {
    await expect(editor).toHaveValue(value)
  }
}

/** Scope by the actual native chapter-title control, so summaries already in
 * reading mode cannot shift the index of later empty editors. */
export function chapterSummaryScopeV1(page: Page, index = 0) {
  return page.getByLabel('章节标题', { exact: true }).nth(index).locator('..').locator('..')
}
export async function enterChapterSummaryEditorV1(page: Page, index = 0) {
  const scope = chapterSummaryScopeV1(page, index)
  return enterMarkdownSourceEditorV1(scope, scope.getByLabel('章节摘要', { exact: true }))
}
export async function expectChapterSummarySourceV1(page: Page, value: string, index = 0) {
  const scope = chapterSummaryScopeV1(page, index)
  await expectMarkdownSourceValueV1(scope, scope.getByLabel('章节摘要', { exact: true }), value)
}

export function workDescriptionScopeV1(page: Page) {
  return page.getByText('简介', { exact: true }).locator('..')
}
export async function enterWorkDescriptionEditorV1(page: Page) {
  return enterMarkdownSourceEditorV1(workDescriptionScopeV1(page), page.getByLabel('作品简介', { exact: true }))
}
export async function expectWorkDescriptionSourceV1(page: Page, value: string) {
  await expectMarkdownSourceValueV1(workDescriptionScopeV1(page), page.getByLabel('作品简介', { exact: true }), value)
}

/** CreativeRules owns the direct field editor before its candidate section. */
export function ruleSourceScopeV1(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('..').locator('..').locator(':scope > div').nth(1)
}
export async function enterRuleSourceEditorV1(page: Page, label: string, editor: Locator) {
  const scope = ruleSourceScopeV1(page, label)
  if (await editor.count() === 0 && await scope.locator('[data-markdown-read-view]').count() === 0) {
    await expect(scope).toBeVisible()
    // Confirmed-save fields wrap their actual empty editor and status together.
    // Enter that editor, never the non-interactive min-w-0 wrapper.
    const emptyEditor = scope.locator('div.cursor-text')
    await expect(emptyEditor).toHaveCount(1)
    await expect(emptyEditor).toBeVisible()
    await emptyEditor.click()
  }
  return enterMarkdownSourceEditorV1(scope, editor)
}
export async function expectRuleSourceValueV1(page: Page, label: string, editor: Locator, value: string) {
  if (!value.length && await editor.count() === 0) await enterRuleSourceEditorV1(page, label, editor)
  if (value.length) {
    await expect(ruleSourceScopeV1(page, label).locator('[data-markdown-read-view]')).toHaveCount(1)
    await expect(editor).toHaveCount(0)
  }
  await expectMarkdownSourceValueV1(ruleSourceScopeV1(page, label), editor, value)
}
