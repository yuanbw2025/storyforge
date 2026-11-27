import { expect, test } from '@playwright/test'

test('an open feedback inbox reflects offline state and receives a due update after reconnecting', async ({ page, context }) => {
  const id = 'd2026112-7270-4000-8000-000000000690', token = '1'.repeat(64), now = Date.now()
  let revision = 1
  const calls: { revoke: boolean; acknowledgment: { readRevision: number } }[] = []
  const unexpected: string[] = []
  await page.route('https://storyforge-lab.com/v1/client-support/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.endsWith('/capabilities')) return route.fulfill({ json: { diagnosticContext: 1, feedbackForm: 2, feedbackImages: 1, feedbackFollowup: 1 } })
    if (pathname.endsWith('/feedback-followup')) {
      const body = route.request().postDataJSON()
      expect(body).toMatchObject({ id, token })
      calls.push(body)
      return route.fulfill({ json: body.revoke ? { revoked: true } : { progress: {
        revision, stage: revision === 1 ? 'investigating' : 'merged',
        message: revision === 1 ? '隔离验收：排查中。' : '隔离验收：已合并，待发行。',
        issueUrl: 'https://github.com/yuanbw2025/storyforge/issues/690', updatedAt: now, expiresAt: now + 86400_000,
      } } })
    }
    unexpected.push(pathname); return route.fulfill({ status: 503, json: {} })
  })
  await page.addInitScript(({ id, token, now }) => {
    localStorage.setItem('storyforge_guide_completed', 'feedback-inbox-isolated')
    localStorage.setItem('storyforge_feedback_followup_v1', JSON.stringify({ version: 1, entries: [{
      id, token, title: '隔离反馈联网恢复', createdAt: now, state: 'active', readRevision: 0,
      notifiedRevision: 0, failures: 0, nextCheckAt: 0,
    }] }))
  }, { id, token, now })
  await page.goto('home/settings')
  await page.getByRole('button', { name: '查看我的反馈', exact: true }).click()
  const inbox = page.getByRole('dialog', { name: '我的反馈', exact: true })
  await expect(inbox.getByText('排查中', { exact: true })).toBeVisible()
  await inbox.getByRole('button', { name: '标为已读', exact: true }).click()
  await expect.poll(() => calls.some(call => call.acknowledgment.readRevision === 1)).toBe(true)
  await expect(inbox.getByRole('button', { name: '检查进展', exact: true })).toBeEnabled()
  const persisted = await page.evaluate(() => localStorage.getItem('storyforge_feedback_followup_v1'))
  await context.setOffline(true)
  await page.clock.install()
  await expect(inbox.getByRole('button', { name: '检查进展', exact: true })).toBeDisabled()
  await expect(inbox.getByText('当前离线，下次联网打开应用后补收。', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('storyforge_feedback_followup_v1'))).toBe(persisted)
  const beforeReconnect = calls.length
  revision = 2
  await page.clock.fastForward(11 * 60_000)
  expect(calls).toHaveLength(beforeReconnect)
  await context.setOffline(false)
  await expect(inbox.getByRole('button', { name: '检查进展', exact: true })).toBeEnabled()
  await expect(inbox.getByText('当前离线，下次联网打开应用后补收。', { exact: true })).toHaveCount(0)
  await expect(inbox.getByText('已合并，待发行', { exact: true })).toBeVisible()
  await expect(inbox.getByText('修复已上线', { exact: true })).toHaveCount(0)
  await inbox.getByRole('button', { name: '停止跟进并移除', exact: true }).click()
  await expect(inbox.getByText('隔离反馈联网恢复', { exact: true })).toHaveCount(0)
  expect(calls.some(call => call.revoke)).toBe(true)
  expect(unexpected).toEqual([])
})
