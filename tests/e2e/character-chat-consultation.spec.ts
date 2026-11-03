import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {test, expect, type Page} from '@playwright/test'

async function open(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-plan.invalid/v1', model: 'test', maxTokens: 6000, apiKey: 'isolated-test-key' })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const f = await (await load('/storyforge/tests/helpers/chat-consultation.ts')).seedChatConsultationFixtureV2()
    return {scope: f.scope, settings: f.settings, candidate: f.candidate}
  })
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/agent?project=${f.scope.projectId}&work=${f.scope.workId}`)
  return f
}
test('author selects evidence, resumes a conversation and adopts only chosen plan fields across refresh', async ({page}) => {
  const f = await open(page), prompts: string[] = []
  await page.route('https://chat-plan.invalid/**', async route => {
    prompts.push(JSON.stringify(route.request().postDataJSON().messages))
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: JSON.stringify(f.candidate)}, finish_reason: 'stop'}]})})
  })
  await page.getByText('本轮带入的原文资料（已选 0 项）', {exact: true}).click()
  await page.getByRole('button', {name: '选择会谈资料', exact: true}).click()
  await page.getByTestId('chat-consult-source').filter({hasText: '希望修好旧钟，愿意自己检查工具。'}).getByRole('checkbox').check()
  await page.getByRole('textbox', {name: '角色聊天 会谈输入', exact: true}).fill('让人物有可以自己尝试的方向。')
  await page.getByRole('button', {name: '发送', exact: true}).click()
  await expect(page.getByTestId('chat-plan-change')).toHaveCount(2)
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('希望修好旧钟')
  expect(prompts[0]).not.toContain('仅作者掌握的私域结局')
  expect(prompts[0]).not.toContain('知道失踪船队真相')
  const read = () => page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {draft: await db.chatAuthoringDrafts.where('workId').equals(scope.workId).first(), productions: await db.productProductions.count()}
  }, f.scope)
  expect(JSON.parse((await read()).draft.settingsJson)).toEqual(f.settings)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByTestId('chat-plan-change')).toHaveCount(2)
  expect(prompts).toHaveLength(1)
  // A new explicitly sent question ends the old unadopted run and carries its saved discussion.
  await page.getByText('本轮带入的原文资料（已选 0 项）', {exact: true}).click()
  await page.getByRole('button', {name: '选择会谈资料', exact: true}).click()
  await page.getByTestId('chat-consult-source').filter({hasText: '希望修好旧钟，愿意自己检查工具。'}).getByRole('checkbox').check()
  await page.getByRole('textbox', {name: '角色聊天 会谈输入', exact: true}).fill('只考虑开场，先保留原来的玩家身份。')
  await page.getByRole('button', {name: '发送', exact: true}).click()
  await expect.poll(() => prompts.length).toBe(2)
  await expect(page.getByRole('button', {name: '采用勾选的修改', exact: true})).toBeEnabled()
  expect(prompts[1]).toContain('可提议雨天接到修理委托')
  await page.getByRole('checkbox', {name: '玩家身份', exact: true}).uncheck()
  await page.getByRole('button', {name: '采用勾选的修改', exact: true}).click()
  await expect(page.getByText('已采用所选修改；其他方案设置保持原样。', {exact: true})).toBeVisible()
  const saved = await read()
  expect(JSON.parse(saved.draft.settingsJson)).toEqual({...f.settings, openingSituation: f.candidate.changes[0].value})
  expect(saved.productions).toBe(0)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByText('已采用所选修改；其他方案设置保持原样。', {exact: true})).toBeVisible()
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  expect(prompts).toHaveLength(2)
})
test('unknown and rejected plan requests do not resend on refresh; explicit dismissal allows a new request', async ({page}) => {
  await open(page); let calls = 0
  await page.route('https://chat-plan.invalid/**', async route => {
    calls++
    if (calls === 1) await route.abort('failed')
    else await route.fulfill({status: 401, contentType: 'application/json', body: JSON.stringify({error: {message: 'engineering rejection'}})})
  })
  await page.getByRole('textbox', {name: '角色聊天 会谈输入', exact: true}).fill('讨论一个新开场。')
  await page.getByRole('button', {name: '发送', exact: true}).click()
  await expect(page.getByText(/这次请求的结果尚未留存/)).toBeVisible()
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByText(/这次请求的结果尚未留存/)).toBeVisible()
  await page.getByRole('textbox', {name: '角色聊天 会谈输入', exact: true}).fill('另开一次讨论。')
  await expect(page.getByRole('button', {name: '发送', exact: true})).toBeDisabled()
  expect(calls).toBe(1)
  await page.getByRole('button', {name: '结束本次讨论', exact: true}).click()
  await page.getByRole('button', {name: '发送', exact: true}).click()
  await expect(page.getByText(/模型服务拒绝了这次请求，没有生成方案/)).toBeVisible()
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByText(/模型服务拒绝了这次请求，没有生成方案/)).toBeVisible()
  expect(calls).toBe(2)
})

test('a later author edit disables the old candidate and the page lists missing setup without starting production', async ({page}) => {
  const f = await open(page); let calls = 0
  await page.route('https://chat-plan.invalid/**', async route => {
    calls++
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: JSON.stringify({answer: '可以先试一段日常。', changes: [{field: 'openingSituation', value: '一起决定今天要做的事。', reason: '创作提议', basis: 'proposal', evidence: []}]})}, finish_reason: 'stop'}]})})
  })
  await page.getByRole('textbox', {name: '角色聊天 会谈输入', exact: true}).fill('提一个开场。')
  await page.getByRole('button', {name: '发送', exact: true}).click()
  await expect(page.getByRole('button', {name: '采用勾选的修改', exact: true})).toBeEnabled()
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/vision?project=${f.scope.projectId}&work=${f.scope.workId}`)
  await page.getByLabel('开场与场景目标', {exact: true}).fill('')
  await page.getByRole('button', {name: '保存方案', exact: true}).click()
  await expect(page.getByText('方案已保存', {exact: true})).toBeVisible()
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/agent?project=${f.scope.projectId}&work=${f.scope.workId}`)
  await expect(page.getByText('方案或资料已变化，下面是历史候选，不能覆盖当前方案。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '采用勾选的修改', exact: true})).toBeDisabled()
  await expect(page.getByRole('region', {name: '制作前待补齐'})).toContainText('填写开场情景或矛盾')
  expect(calls).toBe(1)
  expect(await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/lib/db/schema.ts')).db.productProductions.count()})).toBe(0)
})

test('a saved response interrupted before parsing can be recovered from the page without sending a model request', async ({page}) => {
  const f = await open(page); let calls = 0
  await page.route('https://chat-plan.invalid/**', async route => {calls++; await route.abort('failed')})
  await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)')
    const {readChatDraftV1} = await load('/storyforge/src/lib/character-interaction/draft-service.ts')
    const {generateChatConsultationV2} = await load('/storyforge/src/lib/character-interaction/consultation-harness.ts')
    const draft = await readChatDraftV1(scope)
    try {
      await generateChatConsultationV2({scope, request: {draftRevision: draft.revision, question: '讨论一个日常开场', source: null, priorRunId: null},
        runAI: async () => JSON.stringify({answer: '可以先讨论一起修钟的理由。', changes: []}),
        onBoundary: (point: string) => {if (point === 'response.saved') throw new Error('isolated saved-response interruption')},
      })
    } catch (error) {if (!(error instanceof Error) || error.message !== 'isolated saved-response interruption') throw error}
  }, f.scope)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await page.getByRole('button', {name: '恢复已保存结果', exact: true}).click()
  await expect(page.getByText('可以先讨论一起修钟的理由。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '恢复已保存结果', exact: true})).toHaveCount(0)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByText('可以先讨论一起修钟的理由。', {exact: true})).toBeVisible()
  expect(calls).toBe(0)
})

test('an invalid response remains readable after refresh and cannot be adopted', async ({page}) => {
  await open(page); let calls = 0
  await page.route('https://chat-plan.invalid/**', async route => {
    calls++
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: '先保留这段未能整理成方案的回复。'}, finish_reason: 'stop'}]})})
  })
  await page.getByRole('textbox', {name: '角色聊天 会谈输入', exact: true}).fill('讨论开场')
  await page.getByRole('button', {name: '发送', exact: true}).click()
  await expect(page.getByText('查看保留的原始回复', {exact: true})).toBeVisible()
  await reloadWithBrowserFixtureAIConfigV1(page)
  await page.getByText('查看保留的原始回复', {exact: true}).click()
  await expect(page.getByText('先保留这段未能整理成方案的回复。', {exact: true})).toBeVisible()
  await expect(page.getByRole('button', {name: '采用勾选的修改', exact: true})).toHaveCount(0)
  expect(calls).toBe(1)
})

test('adopted consultation evidence reaches the saved production through the real UI and survives backup import', async ({page}, info) => {
  const f = await open(page); let calls = 0
  await page.route('https://chat-plan.invalid/**', async route => {
    calls++
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: JSON.stringify(f.candidate)}, finish_reason: 'stop'}]})})
  })
  await page.getByText('本轮带入的原文资料（已选 0 项）', {exact: true}).click()
  await page.getByRole('button', {name: '选择会谈资料', exact: true}).click()
  await page.getByTestId('chat-consult-source').filter({hasText: '希望修好旧钟，愿意自己检查工具。'}).getByRole('checkbox').check()
  await page.getByRole('textbox', {name: '角色聊天 会谈输入', exact: true}).fill('打磨开场，保留玩家选择。')
  await page.getByRole('button', {name: '发送', exact: true}).click()
  await expect(page.getByTestId('chat-plan-change')).toHaveCount(2)
  await page.getByRole('checkbox', {name: '玩家身份', exact: true}).uncheck()
  await page.getByRole('button', {name: '采用勾选的修改', exact: true}).click()
  await expect(page.getByText('已采用所选修改；其他方案设置保持原样。', {exact: true})).toBeVisible()
  await page.getByRole('button', {name: '检查制作准备', exact: true}).click()
  await page.getByRole('button', {name: '启用自动制作', exact: true}).click()
  await page.getByRole('button', {name: '分析可玩起点', exact: true}).click()
  await page.getByRole('button', {name: '生成严格 Brief', exact: true}).click()
  await page.getByRole('button', {name: '保存 Brief revision', exact: true}).click()
  await expect(page).toHaveURL(/production=\d+/)
  const evidence = page.getByRole('region', {name: '已保存方案的会谈依据'})
  await expect(evidence).toContainText('已冻结 1 次已采用会谈的读取记录。')
  await evidence.getByText('开场与当前矛盾', {exact: true}).first().click()
  await expect(evidence).toContainText('希望修好旧钟，愿意自己检查工具。')
  await expect(evidence).not.toContainText('来借书的旅人，还没有答应参与修理。')
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(evidence).toContainText('已冻结 1 次已采用会谈的读取记录。')
  const imported = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const backup = await load('/storyforge/src/lib/export/json-export.ts')
    const source = await db.productProductionBriefs.where('workId').equals(scope.workId).first()
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(scope.projectId))
    const target = await db.productProductionBriefs.where('projectId').equals(projectId).first()
    if (source.sourcePlanHash !== target.sourcePlanHash) throw new Error('SourcePlan identity changed on import')
    if (await db.productBuilds.count() || await db.productRuntimeSessions.count()) throw new Error('Saving a Brief unexpectedly started production')
    return {projectId, workId: target.workId, productionId: target.productionId}
  }, f.scope)
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/production?project=${imported.projectId}&work=${imported.workId}&production=${imported.productionId}`)
  await expect(evidence).toContainText('已冻结 1 次已采用会谈的读取记录。')
  await evidence.getByText('开场与当前矛盾', {exact: true}).first().click()
  await expect(evidence).toContainText('希望修好旧钟，愿意自己检查工具。')
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  await evidence.scrollIntoViewIfNeeded()
  await page.screenshot({path: info.outputPath('chat-consultation-evidence-mobile.png')})
  expect(calls).toBe(1)
})
