import { test, expect } from '@playwright/test'

test('061 history candidate dialogs keep keyboard focus, ignore IME escape and return focus to the opener', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin
  let posts = 0
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'history061-keyboard'))
  await context.route('**/*', route => {
    const request = route.request()
    if (request.method() === 'POST') posts++
    return new URL(request.url()).origin === origin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort()
  })
  await page.goto('./')
  const scope = await page.evaluate(async () => {
    const { seedCurrentWorkspace } = await (new Function('return import("/storyforge/tests/helpers/current-workspace.ts")'))()
    return (await seedCurrentWorkspace('061 历史候选键盘')).scope
  })
  await page.goto(`./workspace/${scope.projectId}?module=history`)
  const check = async (opener: ReturnType<typeof page.getByRole>, label: string, generate: string) => {
    await opener.click()
    const dialog = page.getByRole('dialog', { name: label, exact: true })
    const close = dialog.getByRole('button', { name: /关闭/ })
    await expect(close).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: generate, exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
    const text = dialog.getByRole('textbox').first()
    await text.focus()
    await text.dispatchEvent('keydown', { key: 'Escape', isComposing: true })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(opener).toBeFocused()
  }
  await check(page.getByRole('button', { name: 'AI 生成事件', exact: true }), '历史事件候选', '生成事件候选')
  await page.getByRole('button', { name: '历史总述与纪年', exact: true }).click()
  await check(page.getByRole('button', { name: 'AI 历史总述', exact: true }), '历史 AI · 历史总述', '生成候选')
  expect(posts).toBe(0)
})
