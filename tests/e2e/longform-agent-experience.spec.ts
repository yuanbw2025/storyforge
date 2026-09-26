import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

const endpoint = 'https://agent-experience.invalid/v1/chat/completions'
const draft =
  '雨停以后，邮差发现信箱里有一封来自自己的信。他推开值班室的门，将信放在灯下。' +
  '信上的日期还没有到来，他决定追查邮戳，却发现登记簿已经被人撕去一页。'.repeat(6)

async function setup(page: Page, name: string) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem(
      'storyforge-ai-config',
      JSON.stringify({
        provider: 'ollama',
        baseUrl: 'https://agent-experience.invalid/v1',
        model: 'isolated-agent-test',
        temperature: 0,
        maxTokens: 4000,
      }),
    )
  })
  await createLongform(page, name)
}
async function agent(page: Page) {
  await page
    .getByRole('navigation', { name: '工作台创作方式' })
    .getByRole('button', { name: 'Agent', exact: true })
    .click()
  await expect(page.getByRole('textbox', { name: '告诉主 Agent 你的目标' })).toBeEnabled()
}
async function storedCounts(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return {
      chapters: await db.chapters.toArray(),
      characters: await db.characters.count(),
      outlines: await db.outlineNodes.toArray(),
    }
  })
}

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`Agent keeps the conversation and composer usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await setup(page, '布局隔离验收')
    await agent(page)
    await page
      .getByRole('textbox', { name: '告诉主 Agent 你的目标' })
      .fill('只写第一个场景，不要补全世界设定和角色卡。')
    const bounds = await page.locator('.agent-messages').boundingBox()
    expect(bounds!.height).toBeGreaterThan(260)
    const composer = await page.getByRole('button', { name: '讨论与规划', exact: true }).boundingBox()
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(viewport.height)
    await expect(page.locator('.lf-agent-progress')).not.toHaveAttribute('open', '')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    )
    if (viewport.width < 1000) {
      await page.getByRole('button', { name: '创作区', exact: true }).click()
      await expect(page.getByText('从你最想写的地方开始', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '对话与计划', exact: true }).click()
      await expect(page.getByRole('textbox', { name: '告诉主 Agent 你的目标' })).toHaveValue(
        '只写第一个场景，不要补全世界设定和角色卡。',
      )
    }
    await page.screenshot({ path: test.info().outputPath(`agent-${viewport.width}.png`) })
  })
}

test('sparse chapter can be written, discussed, restored, edited and adopted without extra world or character writes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await setup(page, '自由选写隔离验收')
  await page
    .getByRole('navigation', { name: '长篇工作台二级导航' })
    .getByRole('button', { name: '大纲与章纲', exact: true })
    .click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  let generationCalls = 0
  let discussionCalls = 0
  await page.route(endpoint, async (route) => {
    const combined = route
      .request()
      .postDataJSON()
      .messages.map((message: { content: string }) => message.content)
      .join('\n')
    const discussingDraft = combined.includes('当前有未处理候选')
    const planning = combined.includes('你只把用户目标拆成幕后领域任务')
    if (discussingDraft) {
      discussionCalls++
      expect(combined).toContain('作者补充：信封封蜡已经碎裂')
    }
    if (!planning) generationCalls++
    const content = discussingDraft
      ? JSON.stringify({
          summary: '他需要查验日期，候选尚未写入作品。',
          tasks: [{ id: 'forbidden', agentId: 'character', instruction: '创建角色', dependsOn: [] }],
        })
      : planning
        ? JSON.stringify({
            summary: '只写第一章的雨夜场景，其他资料可以留白。',
            tasks: [
              {
                id: 'scene',
                agentId: 'prose',
                instruction: '写第一章正文：雨停以后，邮差发现信箱里有一封来自自己的信。不要补全世界和角色。',
                dependsOn: [],
              },
            ],
          })
        : draft
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 300, total_tokens: 400 },
      }),
    })
  })
  await agent(page)
  await page
    .getByRole('textbox', { name: '告诉主 Agent 你的目标' })
    .fill('只写第一章正文：邮差收到来自自己的信，不要补全世界设定和角色卡。')
  await page.getByRole('button', { name: '讨论与规划', exact: true }).click()
  await page.getByRole('button', { name: '确认计划并开始', exact: true }).click()
  const candidate = page.getByRole('textbox', { name: '《第1章》正文候选内容', exact: true })
  await expect(candidate).toHaveValue(draft)
  expect((await storedCounts(page)).chapters).toHaveLength(0)
  const discussionDraft = `${draft}\n作者补充：信封封蜡已经碎裂。`
  await candidate.fill(discussionDraft)
  await page.getByRole('textbox', { name: '告诉主 Agent 你的目标' }).fill('为什么邮差要查验日期？')
  await page.getByRole('button', { name: '讨论候选', exact: true }).click()
  await expect(page.getByText('他需要查验日期，候选尚未写入作品。', { exact: true })).toBeVisible()
  expect(discussionCalls).toBe(1)
  expect(generationCalls).toBe(1)
  expect((await storedCounts(page)).characters).toBe(0)
  await page.reload()
  await expect(candidate).toHaveValue(discussionDraft)
  expect(generationCalls).toBe(1)
  const edited = discussionDraft.replace('雨停以后', '作者修订：天刚破晓')
  await candidate.fill(edited)
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(candidate).toHaveCount(0)
  const saved = await storedCounts(page)
  expect(saved.characters).toBe(0)
  expect(saved.chapters).toHaveLength(1)
  expect(saved.chapters[0].content).toContain('作者修订：天刚破晓')
  await page.getByRole('button', { name: '打开作品正文', exact: true }).click()
  await page.getByText('第1章', { exact: true }).first().click()
  await expect(page.locator('.tiptap-editor')).toContainText('作者修订：天刚破晓')
})

test('stopping a waiting planner restores input and does not resend or publish its late response', async ({
  page,
}) => {
  await setup(page, '停止会谈隔离验收')
  let calls = 0
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(endpoint, async (route) => {
    calls++
    await gate
    await route
      .fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ summary: '不应出现的晚到计划', tasks: [] }) } }],
        }),
      })
      .catch(() => undefined)
  })
  await agent(page)
  await page.getByRole('textbox', { name: '告诉主 Agent 你的目标' }).fill('讨论一个雨夜场景')
  await page.getByRole('button', { name: '讨论与规划', exact: true }).click()
  await expect.poll(() => calls).toBe(1)
  await expect(page.getByRole('status').filter({ hasText: '正在理解你的要求' })).toBeVisible()
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '告诉主 Agent 你的目标' })).toBeEnabled()
  release()
  await expect(page.getByText('本轮已停止。', { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByText('本轮已停止。', { exact: false })).toBeVisible()
  await expect(page.getByText('不应出现的晚到计划', { exact: true })).toHaveCount(0)
  expect(calls).toBe(1)
})

test('a blank work starts with one visible chapter plan and reaches saved prose through author approvals', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.setViewportSize({ width: 1366, height: 768 })
  await setup(page, '最小起步隔离验收')
  const calls: string[] = []
  await page.route(endpoint, async (route) => {
    const text = route
      .request()
      .postDataJSON()
      .messages.map((message: { content: string }) => message.content)
      .join('\n')
    let content: string
    if (text.includes('你只把用户目标拆成幕后领域任务')) {
      calls.push('plan')
      content = JSON.stringify({
        summary: '写第一章场景',
        tasks: [
          {
            id: 'start',
            agentId: 'prose',
            instruction: '写第一章正文，一个邮差收到来自自己的信',
            dependsOn: [],
          },
        ],
      })
    } else if (text.includes('只拟定 1 个卷的简短标题')) {
      expect(text).toContain('夜班邮差')
      expect(text).toContain('三天后')
      calls.push('volume')
      content = JSON.stringify([{ title: '来信', summary: '一个邮差收到来自未来的信。' }])
    } else if (text.includes('只拟定 1 个章节标题')) {
      expect(text).toContain('夜班邮差')
      expect(text).toContain('三天后')
      calls.push('chapter')
      content = JSON.stringify([
        { title: '雨夜来信', summary: '邮差发现一封来自自己的信，决定核对日期并追查来源。' },
      ])
    } else {
      calls.push('prose')
      content = draft
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      }),
    })
  })
  await agent(page)
  await page
    .getByRole('textbox', { name: '告诉主 Agent 你的目标' })
    .fill('写第一章正文，夜班邮差收到自己三天后寄来的信')
  await page.getByRole('button', { name: '讨论与规划', exact: true }).click()
  await expect(page.getByRole('region', { name: '待确认创作计划' })).toContainText('只准备一个章节')
  expect((await storedCounts(page)).outlines).toHaveLength(0)
  await page.getByRole('button', { name: '确认计划并开始', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '标题 · 候选 1', exact: true })).toHaveValue('来信')
  await expect(page.getByText(/本轮团队约使用 [1-9][\d,]* \/ 160,000 tokens，1 次调用/)).toBeVisible()
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '标题 · 候选 1', exact: true })).toHaveValue('雨夜来信')
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('textbox', { name: '标题 · 候选 1', exact: true }).fill('作者改名：未来来信')
  await page.getByRole('button', { name: '查看原始结构', exact: true }).click()
  const rawOutline = page.locator('.agent-candidate-editor')
  await expect(rawOutline).toHaveValue(/作者改名：未来来信/)
  await expect(rawOutline).toHaveValue(/决定核对日期并追查来源/)
  await page.getByRole('button', { name: '返回内容编辑', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '标题 · 候选 1', exact: true })).toHaveValue('作者改名：未来来信')
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '《作者改名：未来来信》正文候选内容', exact: true })).toHaveValue(
    draft,
  )
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toBeEnabled()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('agent-candidate.png') })
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect.poll(async () => (await storedCounts(page)).chapters.length).toBe(1)
  expect(calls).toEqual(['plan', 'volume', 'chapter', 'prose'])
  const state = await storedCounts(page)
  expect(state.characters).toBe(0)
  expect(state.outlines).toHaveLength(2)
  expect(state.outlines.find((node: { type: string }) => node.type === 'chapter')?.title).toBe('作者改名：未来来信')
  await expect(page.getByText(/本轮所有步骤均已通过终态校验/)).toBeVisible()
  await page.getByRole('button', { name: '打开作品正文', exact: true }).click()
  await page.getByRole('button', { name: '本次不运行', exact: true }).click()
  await expect(page.getByText(/作者已跳过本轮章后任务/)).toBeVisible()
  await expect(page.getByRole('button', { name: '继续章后处理', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText(/作者已跳过本轮章后任务/)).toBeVisible()
  await expect(page.getByRole('button', { name: '继续章后处理', exact: true })).toHaveCount(0)
  expect(calls).toEqual(['plan', 'volume', 'chapter', 'prose'])
})

test('authorization failure explains the next step and never retries behind the author', async ({ page }) => {
  await setup(page, '失败提示隔离验收')
  let calls = 0
  await page.route(endpoint, async (route) => {
    calls++
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Invalid API key' } }),
    })
  })
  await agent(page)
  await page.getByRole('textbox', { name: '告诉主 Agent 你的目标' }).fill('帮我讨论一位邮差主角')
  await page.getByRole('button', { name: '讨论与规划', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: '检查模型设置', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '告诉主 Agent 你的目标' })).toBeEnabled()
  expect(calls).toBe(1)
  await page.reload()
  await expect(page.getByText('本轮没有完成：', { exact: false })).toBeVisible()
  expect(calls).toBe(1)
})

test('a silent planner times out visibly without retrying or losing the author request', async ({ page }) => {
  await setup(page, '会谈超时隔离验收')
  await agent(page)
  await page.clock.install()
  let calls = 0
  let release: () => void = () => undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(endpoint, async route => {
    calls++
    await gate
    await route.abort().catch(() => undefined)
  })
  await page.getByRole('textbox', { name: '告诉主 Agent 你的目标' }).fill('讨论雨夜场景的悬念')
  await page.getByRole('button', { name: '讨论与规划', exact: true }).click()
  await expect.poll(() => calls).toBe(1)
  await page.clock.fastForward(91_000)
  await expect(page.getByRole('alert')).toContainText('90 秒')
  await expect(page.getByRole('textbox', { name: '告诉主 Agent 你的目标' })).toBeEnabled()
  release()
  await page.reload()
  await expect(page.getByText('讨论雨夜场景的悬念', { exact: true })).toBeVisible()
  await expect(page.getByText('模型在 90 秒内没有完成回复', { exact: false })).toBeVisible()
  expect(calls).toBe(1)
})
