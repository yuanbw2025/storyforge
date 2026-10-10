import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

test('step metadata saves before navigation and retains all edits after reload', async ({ page }) => {
  await createLongform(page, '分步骤保存验收')
  await page.getByRole('textbox', { name: '作品名称', exact: true }).fill('修订后的雾港')
  await page.getByRole('textbox', { name: '作品简介', exact: true }).fill('雾港午夜的钟声与失踪案。')
  await page.getByRole('slider', { name: '目标字数' }).fill('400000')
  await page.getByRole('button', { name: '故事设计', exact: true }).click()
  await expect(page.getByRole('heading', { name: '📜 一句话故事', exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('textbox', { name: '补充提示（可选）' })).toBeVisible()
  expect(await page.locator('[aria-label="故事字段"]').evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.left >= 0 && bounds.right <= window.innerWidth
  })).toBe(true)
  expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.reload()
  await page.getByRole('button', { name: '作品概况', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '作品名称', exact: true })).toHaveValue('修订后的雾港')
  await expect(page.getByRole('textbox', { name: '作品简介', exact: true })).toHaveValue('雾港午夜的钟声与失踪案。')
  await expect(page.getByRole('slider', { name: '目标字数' })).toHaveValue('400000')
  await page.getByRole('textbox', { name: '作品简介', exact: true }).fill('自动保存后的简介。')
  await expect(page.getByRole('status')).toHaveText('修改后自动保存')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '作品简介', exact: true })).toHaveValue('自动保存后的简介。')
})

test('step generation shows waiting and stops without adopting a late response or retrying on reload', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://step-stop.invalid/v1', model: 'step-test', maxTokens: 4000, temperature: 0 }))
  })
  let calls = 0
  let respond!: () => void
  const release = new Promise<void>(resolve => { respond = resolve })
  await page.route('https://step-stop.invalid/**', async route => {
    calls++
    await release
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ field: 'logline', value: '迟到的模型内容不应进入作品。' }) }, finish_reason: 'stop' }] }) }).catch(() => undefined)
  })
  await createLongform(page, '分步骤停止验收')
  await page.getByRole('button', { name: '故事设计', exact: true }).click()
  await page.getByRole('textbox', { name: '补充提示（可选）' }).fill('只写一句话，其他设定不填。')
  await page.getByRole('button', { name: 'AI 生成', exact: true }).click()
  await expect.poll(() => calls).toBe(1)
  await expect(page.getByRole('status')).toContainText('正在准备或生成候选')
  await page.getByRole('button', { name: '停止本次生成', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('已停止，未自动重试。')
  respond()
  await expect(page.getByRole('button', { name: 'AI 生成', exact: true })).toBeEnabled()
  await expect(page.getByRole('textbox', { name: '补充提示（可选）' })).toHaveValue('只写一句话，其他设定不填。')
  await page.reload()
  await expect(page.getByText('点击填写一句话故事…', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '采纳', exact: true })).toHaveCount(0)
  expect(calls).toBe(1)
})

test('streamed scene details survive a burst of chunks and reload before adoption', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://step-scenes.invalid/v1', model: 'step-test', maxTokens: 4000, temperature: 0 }))
  })
  const output = JSON.stringify({ scenes: [{ title: '钟楼铜箔', summary: '沈砚寻找停钟原因，取出铜箔后发现明日潮汐记录，敲门声迫使他藏起证据。', location: '海关钟楼', conflict: '开闸前修好钟还是保护刚发现的证据', characterIds: [], pace: 'medium', estimatedWords: 600 }] })
  let calls = 0
  await page.route('https://step-scenes.invalid/**', async route => {
    calls++
    const chunks = Array.from(output).map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('')
    await route.fulfill({ contentType: 'text/event-stream', body: `${chunks}data: [DONE]\n\n` })
  })
  await createLongform(page, '细纲流式验收')
  await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const { resolveScope, stampNewRecord } = await importer('/storyforge/src/lib/workspace/scope.ts')
    const project = await db.projects.toCollection().first()
    const scope = await resolveScope({ projectId: project.id })
    const base = { projectId: project.id, createdAt: Date.now(), updatedAt: Date.now() }
    await db.storyArcs.add(stampNewRecord(scope, 'storyArcs', { ...base, name: '钟楼主线', type: 'main', description: '', stages: '[]' }, { owner: 'work' }))
    for (const [predicate, value] of [['location', '海关钟楼'], ['healthStatus', '健康'], ['knows', '钟停了'], ['knows', '铜箔上有潮汐记录']]) {
      await db.temporalFacts.add(stampNewRecord(scope, 'temporalFacts', {
        ...base, subjectName: '沈砚', predicate, value, factKind: predicate === 'knows' ? 'event' : 'state',
        sourceType: 'manual', status: 'confirmed', locked: false,
        validFromChapterId: null, validToChapterId: null, sourceChapterId: null,
      }, { owner: 'work' }))
    }
  })
  await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByRole('textbox', { name: '章节摘要（可编辑，失焦自动保存）' }).fill('沈砚在钟楼发现铜箔，敲门声使他藏起证据。')
  await page.getByRole('button', { name: '场景细纲', exact: true }).click()
  await page.getByRole('button', { name: '第1章', exact: true }).click()
  await page.getByRole('button', { name: 'AI 一键拆场景', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveValue(output)
  await expect(page.getByText('Maximum update depth exceeded.', { exact: false })).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '第1章', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveValue(output)
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: '场景标题...', exact: true })).toHaveValue('钟楼铜箔')
  expect(calls).toBe(1)
})


test('step prose honors the author request in the wire prompt and adopts edited text before refresh', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://step-prose.invalid/v1', model: 'step-test', maxTokens: 4000, temperature: 0 }))
  })
  const generated = '沈砚取出铜箔，核对上面的日期，藏好维修本。'.repeat(12)
  const revised = '沈砚将铜箔夹进维修本，门外响起三声叩击。他没有开门。'
  const authorRequest = '只写600字，结尾停在敲门声，不要开门。'
  const requests: Array<{ messages: Array<{ content: string }> }> = []
  await page.route('https://step-prose.invalid/**', async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: generated } }] })}\n\ndata: [DONE]\n\n` })
  })
  await createLongform(page, '正文修订验收')
  await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByRole('textbox', { name: '章节摘要（可编辑，失焦自动保存）' }).fill('沈砚在钟楼发现铜箔，敲门声使他藏起证据。')
  await page.getByRole('button', { name: '场景细纲', exact: true }).click()
  await page.getByRole('button', { name: '第1章', exact: true }).click()
  await page.getByRole('button', { name: '添加场景', exact: true }).click()
  await page.getByRole('textbox', { name: '场景标题...', exact: true }).fill('铜箔与敲门声')
  await page.getByRole('textbox', { name: '一句话场景概要...', exact: true }).fill('沈砚找到铜箔，听到敲门声后没有开门。')
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await page.getByRole('textbox', { name: '自定义指令...', exact: true }).fill(authorRequest)
  await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const { resolveScope, stampNewRecord } = await importer('/storyforge/src/lib/workspace/scope.ts')
    const project = await db.projects.toCollection().first()
    const scope = await resolveScope({ projectId: project.id })
    const base = { projectId: project.id, createdAt: Date.now(), updatedAt: Date.now() }
    const arcs = []
    for (const name of ['调查主线', '铜箔支线']) {
      arcs.push(await db.storyArcs.add(stampNewRecord(scope, 'storyArcs', { ...base, name, type: 'sub', description: '', stages: '[]' }, { owner: 'work' })))
    }
    for (const [index, arcId] of arcs.entries()) {
      await db.storylineProgress.add(stampNewRecord(scope, 'storylineProgress', {
        ...base, arcId, status: 'active', progressNote: `已确认进度 ${index}`, involvedEntities: '[]', evidenceQuote: `调查线索 ${index}`,
      }, { owner: 'work' }))
      await db.storylineCrossings.add(stampNewRecord(scope, 'storylineCrossings', {
        ...base, arcIdA: arcs[0], arcIdB: arcs[1], chapterId: null, chapterTitle: '', note: `已确认交汇 ${index}`, evidenceQuote: `两线相遇 ${index}`,
      }, { owner: 'work' }))
    }
  })
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })
  await expect(draft).toHaveValue(generated)
  expect(requests).toHaveLength(1)
  expect(requests[0].messages.map(message => message.content).join('\n')).toContain(authorRequest)
  for (const index of [0, 1]) {
    expect(requests[0].messages.map(message => message.content).join('\n')).toContain(`已确认进度 ${index}`)
    expect(requests[0].messages.map(message => message.content).join('\n')).toContain(`已确认交汇 ${index}`)
  }
  expect(requests[0].messages.map(message => message.content).join('\n')).toContain('本轮作者明确指定的篇幅、文风、章节收尾和禁止事项优先于模板默认值')
  await page.reload()
  await expect(draft).toHaveValue(generated)
  await draft.fill(revised)
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(draft).toHaveCount(0)
  await expect(page.locator('.tiptap-editor')).toHaveText(revised)
  await page.getByRole('button', { name: '本次不运行', exact: true }).click()
  await page.reload()
  await expect(page.locator('.tiptap-editor')).toHaveText(revised)
  expect(requests).toHaveLength(1)
  await page.setViewportSize({ width: 390, height: 844 })
  const header = page.getByRole('heading', { name: '第1章', exact: true, level: 2 })
  await expect(header).toBeVisible()
  const box = await header.boundingBox()
  expect(box!.width).toBeGreaterThan(200)
  expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByRole('button', { name: '正文', exact: true }).click()
  await page.getByRole('button', { name: '2 仅大纲 第2章', exact: true }).click()
  await expect(page.getByRole('heading', { name: '第2章', exact: true, level: 2 })).toBeVisible()
  await expect(page.locator('.tiptap-editor')).toHaveText('')
  await expect(page.getByText(/章节后处理 Run/)).toHaveCount(0)
  const secondText = '第二章手写草稿，快速切走也必须保留。'
  await page.locator('.tiptap-editor').fill(secondText)
  await page.getByRole('button', { name: /^1 仅大纲 第1章/ }).click()
  await expect(page.locator('.tiptap-editor')).toHaveText(revised)
  await page.reload()
  await page.getByRole('button', { name: /^2 仅大纲 第2章/ }).click()
  await expect(page.locator('.tiptap-editor')).toHaveText(secondText)
})
