import { registerBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

const notes = '安静收店，先问搭档意愿；最后才签收，不增加敌人。'.repeat(220) + '【长备注尾部：签收后停笔】'
const style = '用具体动作与不同声线，少替人物解释情绪。'.repeat(30) + '【文风尾部：保留轻松语气】'
const generated = '街角最后一盏路灯亮起时，两人把余下的材料清点了一遍，约定明天的分工。店主翻开账本，逐项念出柜台里的存货，搭档则拿着铅笔，在纸上记下实际的数目。\n架子底层还放着一只没有拆封的木箱。店主蹲下来，摸清箱盖上的编号，把它搬到空着的台面上。他们一起核对封条，确认里面装的是下午收到的零件。\n搭档发现清单少记了一枚铜扣，便举起手里的小袋，让店主重新数过。两人数到末尾，对照送货单，把漏掉的那一项补在原来位置，没有另添含糊的说明。\n搭档问起明天的安排。店主没有马上替他作决定，而是先把需要完成的几件事情列出来，问他愿意负责哪一部分，是否还需要留出处理私事的时间。\n对方想了一会儿，选择清理后面的工具间，并说明午后才能回来。店主在约定旁边写下时间，把早上的整理工作留给自己，两个人分别看过，没有继续争抢。\n忙完这些，他们把散落的纸页按日期叠好。搭档找到原先夹在书里的收据，将它展平，压在账本下方，等店主核对完金额，才取出备用的签字笔。\n店主先检查柜门是否关紧，随后沿着屋子走了一圈，把需要留到明天的工作逐条圈出。他回到桌边，将那份安排递给搭档，让对方再确认一次。\n搭档把铅笔放回抽屉，指着自己选定的事项点了点头。两人已经讲清明日分工，眼下也没有未清点的材料，柜台上只剩等着签收的单子。\n店主合上存货清单，将签字笔移到单据旁。搭档把灯朝桌面拨近一点，照清末尾的金额和日期，确认每个数字都与刚才核对的账目相同。\n所有需要说明的事情都已有了明确安排。店主这才在收货单的末尾落笔，将签好的副本交给搭档，等他放妥，最后签收并关灯。'

async function prepare(page: Page, smallWindow = false) {
  registerBrowserFixtureAIConfigV1(page, { provider: 'ollama', baseUrl: 'https://prose-handoff.invalid/v1', model: 'handoff-test', maxTokens: smallWindow ? 500 : 3000, temperature: 0 }, { serviceContextWindow: smallWindow ? 1500 : 64000 })
  await createLongform(page, '正文完整资料交接')
  await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByLabel('章节摘要', { exact: true }).fill('两人收店，先清点、再约定明日分工，最后才签收，签收后停笔。')
  await page.getByTitle('编辑本章细纲', { exact: true }).click()
  await page.getByRole('button', { name: '添加场景', exact: true }).click()
  await page.getByPlaceholder('一句话场景概要...', { exact: true }).fill('关火、清点、约定分工；最后签收。')
  await page.getByText('场景任务（可选，可留白）', { exact: true }).click()
  await page.getByLabel('场景1 · 关键选择', { exact: true }).fill('先问搭档意愿')
  await page.getByLabel('场景1 · 退出状态', { exact: true }).fill('未来计划：明日试做点心，尚未发生')
  await page.getByPlaceholder('备注 / AI 建议...', { exact: true }).fill(notes)
  await page.getByRole('button', { name: '写本章正文', exact: true }).click()
  await page.getByRole('group', { name: '编辑模式', exact: true }).getByRole('button', { name: '富文本', exact: true }).click()
  await page.evaluate(async ({ style }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { resolveScope, stampNewRecord }, { createSystemFictionElementsV1 }, { usePromptStore }] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'), importer('/storyforge/src/lib/workspace/scope.ts'),
      importer('/storyforge/src/lib/prose/system-fiction-contract.ts'), importer('/storyforge/src/stores/prompt.ts'),
    ])
    const project = await db.projects.toCollection().first()
    const scope = await resolveScope({ projectId: project.id })
    await db.works.update(scope.workId, { writingStyleId: 'luxun', description: '【Work 写作意图】只写平静收店，不领取次日奖励。', updatedAt: Date.now() })
    await db.userStyleProfiles.add(stampNewRecord(scope, 'userStyleProfiles', { projectId: project.id, enabled: true, profile: '【作者画像完整尾部】保留两人的口语区别。', sourceChapterIds: '[]', sampleCount: 0, sampleWords: 0, createdAt: Date.now(), updatedAt: Date.now() }, { owner: 'work' }))
    const rules = await db.creativeRules.where('projectId').equals(project.id).first()
    const value = { writingStyle: style, narrativePOV: 'third-limited', atmosphere: '平静、轻松', specialRequirements: '最后才签收', prohibitions: '[]', consistencyRules: '[]', systemFictionElements: { ...createSystemFictionElementsV1(), enabled: true, systemMechanism: '每天第一次签到免费', rewardGrowth: '未来计划：明日试做点心，尚未发生' }, updatedAt: Date.now() }
    if (rules) await db.creativeRules.update(rules.id, value)
    else await db.creativeRules.add(stampNewRecord(scope, 'creativeRules', { ...value, projectId: project.id, createdAt: Date.now() }, { owner: 'work' }))
    await usePromptStore.getState().init()
    const template = usePromptStore.getState().getActive('chapter.content')
    const id = await usePromptStore.getState().saveTemplate({ ...template, id: undefined, scope: 'user', name: '交接验收的自定义模板', isActive: false, systemPrompt: '作者自定义：克制而轻松。', userPromptTemplate: '完成作者当前任务。', continuityMode: 'off', modelOverride: { temperature: 0.2, maxTokens: 1700 } })
    await usePromptStore.getState().setActive(id)
  }, { style })
  await page.getByPlaceholder('自定义指令...', { exact: true }).fill('只写600字，保持平静，签收后停笔。')
}

test('正文拒绝的终态写失败会保留候选，刷新后明确重试且不重发模型', async ({ page }) => {
  let requests = 0
  await page.route('https://prose-handoff.invalid/v1/chat/completions', async route => {
    requests += 1
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: generated }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` })
  })
  await prepare(page)
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示', exact: true }).getByRole('button', { name: '开始生成', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })
  await expect(draft).toHaveValue(generated)
  const before = await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const run = await db.agentRuns.orderBy('id').last()
    const chapters = await db.chapters.toArray()
    const events = await db.agentRunEvents.where('runId').equals(run.id).toArray()
    const add = db.agentRunEvents.add.bind(db.agentRunEvents)
    db.agentRunEvents.add = async (...args: any[]) => {
      if (args[0].type === 'run.failed') throw new DOMException('隔离测试：正文拒绝终态写入故障', 'QuotaExceededError')
      return add(...args)
    }
    return { runId: run.id, chapters, events }
  })
  await page.getByTitle('关闭，保留原文不采纳', { exact: true }).click()
  await expect(page.getByText(/未能保存拒绝决定，候选已保留/)).toBeVisible()
  await expect(draft).toHaveValue(generated)
  const failed = await page.evaluate(async runId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { status: (await db.agentRuns.get(runId)).status, chapters: await db.chapters.toArray(), events: await db.agentRunEvents.where('runId').equals(runId).toArray() }
  }, before.runId)
  expect(failed).toEqual({ status: 'awaiting_confirmation', chapters: before.chapters, events: before.events })
  await page.reload()
  await expect(draft).toHaveValue(generated)
  await page.getByTitle('关闭，保留原文不采纳', { exact: true }).click()
  await expect(draft).toHaveCount(0)
  const final = await page.evaluate(async runId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { status: (await db.agentRuns.get(runId)).status, chapters: await db.chapters.toArray(), events: await db.agentRunEvents.where('runId').equals(runId).toArray() }
  }, before.runId)
  expect(final.status).toBe('failed')
  expect(final.chapters).toEqual(before.chapters)
  for (const type of ['confirmation.recorded', 'run.failed', 'memory.settlement.recorded']) expect(final.events.filter((event: any) => event.type === type)).toHaveLength(1)
  await page.reload()
  await expect(page.locator('.tiptap-editor')).toBeVisible()
  await expect(draft).toHaveCount(0)
  expect(requests).toBe(1)
})

test('分步骤实际请求完整交付长备注、元素和作者文风；自定义模板保留，候选刷新采纳', async ({ page }) => {
  const requests: Array<{ messages: Array<{ content: string }>; temperature: number; max_tokens?: number }> = []
  await page.route('https://prose-handoff.invalid/v1/chat/completions', async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: generated }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` })
  })
  await prepare(page)
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  const prompt = page.getByRole('dialog', { name: '正文生成提示', exact: true })
  await expect(prompt.getByRole('textbox', { name: '本章生成提示' })).toHaveValue('只写600字，保持平静，签收后停笔。')
  expect(requests).toHaveLength(0)
  await prompt.getByRole('textbox', { name: '本章生成提示' }).fill('只写600字，签收后停笔。\n【本章临时约束】保留两人的不同声线。')
  await prompt.getByRole('button', { name: '取消', exact: true }).click()
  expect(requests).toHaveLength(0)
  await expect(page.getByPlaceholder('自定义指令...', { exact: true })).toHaveValue('只写600字，签收后停笔。【本章临时约束】保留两人的不同声线。')
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await prompt.getByRole('button', { name: '开始生成', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })
  await expect(draft).toHaveValue(generated)
  expect(requests).toHaveLength(1)
  const wire = requests[0].messages.map(message => message.content).join('\n')
  expect(wire).toContain('【本章临时约束】保留两人的不同声线。')
  for (const required of [notes, style, '先问搭档意愿', '未来计划：明日试做点心，尚未发生', '每天第一次签到免费', '作者自定义：克制而轻松。', '【Work 写作意图】', '鲁迅式犀利', '【作者画像完整尾部】']) expect(wire).toContain(required)
  expect(requests[0].temperature).toBe(0.2)
  expect(requests[0].max_tokens).toBeUndefined()
  expect(wire).not.toContain('前 40%')
  await expect(page.getByText(/实测计入.*篇幅检查已完成/)).toBeVisible()
  const requestEvidence = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const artifacts = await db.agentRunArtifacts.toArray()
    return artifacts.filter((row: any) => row.artifactKind === 'rendered-request').map((row: any) => JSON.parse(row.content)).find((row: any) => typeof row.wireBody === 'string')
  })
  expect(JSON.parse(requestEvidence.wireBody)).toMatchObject({ model: 'handoff-test', stream: true, temperature: 0.2 })
  expect(JSON.parse(requestEvidence.wireBody).max_tokens).toBeUndefined()
  expect(requestEvidence.messages).toEqual(requests[0].messages)
  expect(JSON.stringify(requestEvidence.options)).not.toContain('isolated-test-key')
  await page.reload()
  await expect(draft).toHaveValue(generated)
  await expect(page.getByText(/实测计入.*篇幅检查已完成/)).toBeVisible()
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(draft).toHaveCount(0)
  await expect(page.locator('.tiptap-editor')).toContainText('约定明天的分工')
  await page.reload()
  await expect(page.locator('.tiptap-editor')).toContainText('最后签收并关灯')
})

test('输出上限停笔按原任务接续，刷新保留完整候选且不重复请求', async ({ page }) => {
  let calls = 0
  const paragraphs = generated.split('\n')
  const fragments = [paragraphs.slice(0, 5).join('\n'), paragraphs.slice(5).join('\n')]
  await page.route('https://prose-handoff.invalid/v1/chat/completions', route => {
    const index = calls++
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: fragments[index] ?? '' }, finish_reason: index === 0 ? 'length' : 'stop' }] })}\n\ndata: [DONE]\n\n` })
  })
  await prepare(page)
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示', exact: true }).getByRole('button', { name: '开始生成', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })
  await expect(draft).toHaveValue(generated)
  expect(calls).toBe(2)
  await page.reload()
  await expect(draft).toHaveValue(generated)
  expect(calls).toBe(2)
  await expect(page.locator('.tiptap-editor')).toBeEmpty()
})

test('默认模板实际请求按本轮600～900字渲染，不再并存2500字，候选仍按原链刷新采纳', async ({ page }) => {
  const requests: Array<{ messages: Array<{ content: string }> }> = []
  const output = generated
  await page.route('https://prose-handoff.invalid/v1/chat/completions', route => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: output }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` })
  })
  await prepare(page)
  await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { usePromptStore } = await importer('/storyforge/src/stores/prompt.ts')
    const template = usePromptStore.getState().templates.find((item: any) => item.moduleKey === 'chapter.content' && item.scope === 'system')
    await usePromptStore.getState().setActive(template.id)
  })
  await page.getByPlaceholder('自定义指令...', { exact: true }).fill('写600至900字。签收后停笔。')
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示', exact: true }).getByRole('button', { name: '开始生成', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })
  await expect(draft).toHaveValue(output)
  const system = requests[0].messages[0].content.replace(/\s/g, '')
  expect(system).toContain('字数约600～900字/章')
  expect(system).not.toContain('字数约2500字/章')
  expect(requests).toHaveLength(1)
  await page.reload()
  await expect(draft).toHaveValue(output)
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(draft).toHaveCount(0)
  await expect(page.locator('.tiptap-editor')).toContainText('最后签收并关灯')
})

test('连接结束缺少完成确认时保留片段及证据，刷新恢复只读结果，不能采纳或自动重发', async ({ page }) => {
  let calls = 0
  const fragment = '他收好第一把工具，正要转身。'
  await page.route('https://prose-handoff.invalid/v1/chat/completions', route => {
    calls++
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: fragment } }] })}\n\n` })
  })
  await prepare(page)
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示', exact: true }).getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.getByText('正文结果未确认；原答已保留，不自动重发。', { exact: true })).toBeVisible()
  await expect(page.getByText(fragment, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('正文结果未确认；原答已保留，不自动重发。', { exact: true })).toBeVisible()
  await expect(page.getByText(fragment, { exact: true })).toBeVisible()
  expect(calls).toBe(1)
  await expect(page.locator('.tiptap-editor')).toBeEmpty()
})

test('作者在响应到达前停止，刷新保留停止状态，不出现可采纳候选或自动重发', async ({ page }) => {
  let calls = 0
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  await page.route('https://prose-handoff.invalid/v1/chat/completions', async route => {
    calls++
    await waiting
    await route.fulfill({ contentType: 'text/event-stream', body: 'data: [DONE]\n\n' }).catch(() => {})
  })
  await prepare(page)
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示', exact: true }).getByRole('button', { name: '开始生成', exact: true }).click()
  await expect.poll(() => calls).toBe(1)
  await page.getByRole('button', { name: '停止并保留原稿', exact: true }).click()
  release()
  await expect(page.getByText('作者已停止；原稿和最佳完整稿保留。', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('作者已停止；原稿和最佳完整稿保留。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toHaveCount(0)
  expect(calls).toBe(1)
  await expect(page.locator('.tiptap-editor')).toBeEmpty()
})

test('等待采纳期间改规则拒绝旧候选，保留原稿', async ({ page }) => {
  let calls = 0
  await page.route('https://prose-handoff.invalid/v1/chat/completions', async route => {
    calls++
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: generated }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` })
  })
  await prepare(page)
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示', exact: true }).getByRole('button', { name: '开始生成', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })
  await expect(draft).toHaveValue(generated)
  await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const rules = await db.creativeRules.toCollection().first()
    await db.creativeRules.update(rules.id, { specialRequirements: '改为询问后就停笔，不签收', updatedAt: Date.now() })
  })
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByText(/候选生成后项目内容已变化/)).toBeVisible()
  await expect(page.locator('.tiptap-editor')).toBeEmpty()
  expect(calls).toBe(1)
})

test('仅有估算时完整交付正文资料，由实际服务判定而不静默裁剪', async ({ page }) => {
  const calls: Array<{ messages: Array<{ content: string }>; max_tokens?: number }> = []
  await page.route('https://prose-handoff.invalid/v1/chat/completions', route => {
    calls.push(route.request().postDataJSON())
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: generated }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` })
  })
  await prepare(page, true)
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示', exact: true }).getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveValue(generated)
  expect(calls).toHaveLength(1)
  expect(calls[0].messages.map(message => message.content).join('\n')).toContain(notes)
  expect(calls[0].max_tokens).toBeUndefined()
  await expect(page.locator('.tiptap-editor')).toBeEmpty()
})
