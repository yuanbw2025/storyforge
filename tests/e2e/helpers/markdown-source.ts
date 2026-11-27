import { expect, type Locator } from '@playwright/test'

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
    await expect(source).toBeVisible()
    await expect.poll(() => source.textContent()).toBe(value)
  } else {
    await expect(editor).toHaveValue(value)
  }
}
