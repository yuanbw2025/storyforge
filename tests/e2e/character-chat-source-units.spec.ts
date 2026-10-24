import {test, expect, type Page} from '@playwright/test'
import type {ChatSourceUnitsCandidateV1} from '../../src/lib/character-interaction/source-units'

async function openWorkbench(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://chat-source-units.invalid/v1', model: 'test', maxTokens: 6000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), helper = await load('/storyforge/tests/helpers/chat-source-units.ts')
    const f = await helper.seedChatSourceUnitsFixture()
    const {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {scope: f.scope, candidate: f.candidate as ChatSourceUnitsCandidateV1, text: helper.SOURCE_UNITS_FIXTURE_TEXT,
      before: {drafts: await db.chatAuthoringDrafts.toArray(), worlds: await db.worldReleases.toArray()}}
  })
  await page.goto(`./chat/cast?project=${f.scope.projectId}&work=${f.scope.workId}`)
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await page.getByRole('checkbox', {name: /规则条目 · seal · 历史依据 加入整理建议$/}).check()
  return f
}
function report(candidate: ChatSourceUnitsCandidateV1) {
  return {fragments: candidate.fragments.map(row => ({fragmentKey: row.fragmentKey, complete: true, reason: '工程模拟覆盖报告',
    facts: row.facts.map(item => ({key: item.key, faithful: true, atomic: true, standalone: true, established: true, reason: '工程模拟逐项报告'})),
    constraints: row.constraints.map(item => ({key: item.key, faithful: true, reason: '工程模拟限制报告'}))}))}
}

test('source units use two explicit calls, retain original evidence, invalidate edited verdicts and restore without adoption', async ({page}) => {
  const f = await openWorkbench(page), calls: string[] = []
  await page.route('https://chat-source-units.invalid/**', async route => {
    const request = route.request().postDataJSON(), text = request.messages[1].content as string
    calls.push(text); expect(text).toContain(f.text)
    const context = JSON.parse(text.slice(text.indexOf('{')))
    const result = context.candidate ? report(context.candidate) : f.candidate
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {content: JSON.stringify(result)}, finish_reason: 'stop'}]})})
  })
  const panel = page.getByRole('region', {name: '事实拆分与复核'})
  await panel.getByRole('button', {name: '整理所选原文的事实', exact: true}).click()
  await expect(panel.getByLabel('事实 1', {exact: true})).toHaveValue('铜印放在柜台下的木箱里。')
  await expect(panel.getByLabel('限制 1', {exact: true})).toContainText('守卫和玩家起初都不知道')
  await expect(panel.getByRole('status')).toHaveText('当前候选没有匹配的有效复核结果。')
  expect(calls).toHaveLength(1)
  await panel.getByRole('button', {name: '独立复核当前候选', exact: true}).click()
  await expect(panel.getByRole('status')).toHaveText('当前候选已获独立复核通过，尚未确认用于制作。')
  expect(calls).toHaveLength(2)
  await panel.getByLabel('事实 1', {exact: true}).fill('铜印当前位于柜台下面的木箱内。')
  await expect(panel.getByRole('status')).toHaveText('当前候选没有匹配的有效复核结果。')
  await expect(panel.getByText('历史候选的逐项复核', {exact: true})).toBeVisible()
  await panel.getByRole('button', {name: '独立复核当前候选', exact: true}).click()
  await expect(panel.getByRole('status')).toHaveText('当前候选已获独立复核通过，尚未确认用于制作。')
  expect(calls).toHaveLength(3)
  await page.reload()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(panel.getByLabel('事实 1', {exact: true})).toHaveValue('铜印当前位于柜台下面的木箱内。')
  await expect(panel.getByRole('status')).toHaveText('当前候选已获独立复核通过，尚未确认用于制作。')
  expect(calls).toHaveLength(3)
  expect(await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {drafts: await db.chatAuthoringDrafts.toArray(), worlds: await db.worldReleases.toArray()}
  })).toEqual(f.before)
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('a manual candidate survives an unknown review, cannot silently retry, and retains a negative verdict', async ({page}) => {
  await openWorkbench(page)
  const panel = page.getByRole('region', {name: '事实拆分与复核'}), reviewButton = panel.getByRole('button', {name: '独立复核当前候选', exact: true})
  let calls = 0, fail = true
  await page.route('https://chat-source-units.invalid/**', async route => {
    calls++
    if (fail) return route.abort('failed')
    const text = route.request().postDataJSON().messages[1].content as string
    const context = JSON.parse(text.slice(text.indexOf('{'))), result = report(context.candidate)
    result.fragments[0].complete = false; result.fragments[0].reason = '遗漏掌柜的用途和初始知情限制'
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {content: JSON.stringify(result)}, finish_reason: 'stop'}]})})
  })
  await panel.getByRole('button', {name: '手动整理所选原文', exact: true}).click()
  await panel.getByRole('button', {name: '添加事实', exact: true}).click()
  await panel.getByLabel('事实 1', {exact: true}).fill('铜印在柜台下的木箱里。')
  await panel.getByRole('textbox', {name: '原文引用 1'}).fill('放在柜台下的木箱里')
  await reviewButton.click()
  await expect(panel.getByText('独立复核尚未结束。结果未知时不会自动重发；已留存的回复可恢复。', {exact: true})).toBeVisible()
  expect(calls).toBe(1)
  await page.reload()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(panel.getByLabel('事实 1', {exact: true})).toHaveValue('铜印在柜台下的木箱里。')
  await expect(reviewButton).toBeDisabled(); expect(calls).toBe(1)
  await panel.getByRole('button', {name: '结束这次独立复核', exact: true}).click()
  await expect(reviewButton).toBeEnabled()
  fail = false
  await reviewButton.click()
  await expect(panel.getByRole('status')).toHaveText('当前候选未通过独立复核，请按原因修改。')
  await expect(panel.getByText(/整段覆盖：未通过 · 遗漏掌柜/)).toBeVisible()
  expect(calls).toBe(2)
})
