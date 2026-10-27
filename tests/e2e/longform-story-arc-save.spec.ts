import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLongform(page, '故事线保存与故障恢复')
  const projectId = Number(new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1])
  await openLongformLeaf(page, '故事线')
  await page.getByTitle('新增主线', { exact: true }).click()
  await page.getByLabel('故事线名称', { exact: true }).fill('探路主线')
  await page.getByLabel('故事线名称', { exact: true }).blur()
  await expect.poll(async () => (await rows(page, projectId))[0]?.name).toBe('探路主线')
  return projectId
}
async function rows(page: Page, projectId: number): Promise<any[]> {
  return page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.storyArcs.where('projectId').equals(id).toArray()
  }, projectId)
}
async function injectFailure(page: Page, zero = false) {
  await page.evaluate(async zero => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const update = db.storyArcs.update.bind(db.storyArcs)
    db.storyArcs.update = async () => { if (zero) return 0; throw new DOMException('隔离故事线配额故障', 'QuotaExceededError') }
    Object.assign(window, { restoreStoryArcWrite: () => { db.storyArcs.update = update } })
  }, zero)
}
async function restore(page: Page) {
  await page.evaluate(() => (window as unknown as { restoreStoryArcWrite: () => void }).restoreStoryArcWrite())
}
async function stage(page: Page, id: number) { return JSON.parse((await rows(page, id))[0].stages)[0] }
async function addStage(page: Page) {
  await page.getByRole('button', { name: '添加阶段', exact: true }).click()
  await page.getByRole('button', { name: /阶段\s*1/ }).click()
  await expect(page.getByLabel('故事阶段标题', { exact: true })).toBeVisible()
}

test('story-arc failure retains the author draft, blocks switching and creation, and retries before reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await setup(page)
  await page.getByTitle('新增支线', { exact: true }).click()
  await page.getByRole('button', { name: '探路主线', exact: true }).click()
  await injectFailure(page)
  const description = page.getByLabel('故事线整体描述', { exact: true })
  await description.fill('保存失败后仍须保留：没有实测数据就不放行粮车。'); await description.blur()
  await expect(page.getByRole('alert').filter({ hasText: '隔离故事线配额故障' })).toBeVisible()
  await page.getByRole('button', { name: '支线1', exact: true }).click()
  await expect(description).toHaveValue('保存失败后仍须保留：没有实测数据就不放行粮车。')
  await page.getByTitle('新增支线', { exact: true }).click()
  expect(await rows(page, id)).toHaveLength(2)
  expect((await rows(page, id))[0].description).toBe('')
  await restore(page)
  await page.getByRole('button', { name: '重试保存故事线整体描述', exact: true }).click()
  await expect.poll(async () => (await rows(page, id))[0].description).toBe('保存失败后仍须保留：没有实测数据就不放行粮车。')
  await page.reload()
  await expect(description).toHaveValue('保存失败后仍须保留：没有实测数据就不放行粮车。')
  expect(errors).toEqual([])
})

test('stage fields and manual events save, reorder, clear, recover, and reach the registered source', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await setup(page); await addStage(page)
  for (const [label, value] of [['故事阶段标题', '确认路标'], ['故事阶段描述', '先试绳，再决定是否让粮队过桥。'], ['故事阶段转折点', '系统提示与实测相反']]) {
    await page.getByLabel(label, { exact: true }).fill(value); await page.getByLabel(label, { exact: true }).blur()
  }
  const event = page.getByPlaceholder('手动添加关键事件...', { exact: true })
  await event.fill('首个路标核验'); await page.getByRole('button', { name: '添加', exact: true }).click()
  await expect.poll(async () => (await stage(page, id)).keyEvents).toEqual(['首个路标核验'])
  await event.fill('保留退路'); await event.press('Enter')
  await expect.poll(async () => (await stage(page, id)).keyEvents).toHaveLength(2)
  await page.getByTitle('上移', { exact: true }).nth(1).click({ force: true })
  await expect.poll(async () => (await stage(page, id)).keyEvents).toEqual(['保留退路', '首个路标核验'])
  await page.getByTitle('删除', { exact: true }).first().click({ force: true })
  await expect.poll(async () => (await stage(page, id)).keyEvents).toEqual(['首个路标核验'])
  await injectFailure(page)
  await event.fill('故障时的新事件'); await event.press('Enter')
  await expect(page.getByRole('button', { name: '重试操作', exact: true })).toBeVisible()
  await expect(event).toHaveValue('故障时的新事件')
  expect((await stage(page, id)).keyEvents).toEqual(['首个路标核验'])
  await restore(page); await page.getByRole('button', { name: '重试操作', exact: true }).click()
  await expect(event).toHaveValue('')
  await expect.poll(async () => (await stage(page, id)).keyEvents).toEqual(['首个路标核验', '故障时的新事件'])
  await injectFailure(page, true)
  const draft = page.getByLabel('故事阶段描述', { exact: true })
  await draft.fill('零行写入也不得冒充保存成功。'); await draft.blur()
  await expect(page.getByRole('button', { name: '重试保存故事阶段描述', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /确认路标/ }).click()
  await expect(draft).toHaveValue('零行写入也不得冒充保存成功。')
  expect((await stage(page, id)).description).toBe('先试绳，再决定是否让粮队过桥。')
  await restore(page); await page.getByRole('button', { name: '重试保存故事阶段描述', exact: true }).click()
  await expect.poll(async () => (await stage(page, id)).description).toBe('零行写入也不得冒充保存成功。')
  await page.getByLabel('故事阶段转折点', { exact: true }).fill(''); await page.getByLabel('故事阶段转折点', { exact: true }).blur()
  await expect.poll(async () => (await stage(page, id)).turningPoint).toBeUndefined()
  await page.reload(); await page.getByRole('button', { name: /确认路标/ }).click()
  await expect(draft).toHaveValue('零行写入也不得冒充保存成功。')
  await expect(page.getByText('故障时的新事件', { exact: true })).toBeVisible()
  const context = await page.evaluate(async projectId => {
    const { assembleContext } = await (new Function('return import("/storyforge/src/lib/registry/assemble-context.ts")'))()
    return assembleContext({ projectId, sourceKeys: ['storyArcs'], inputBudgetTokens: 12000 })
  }, id)
  for (const text of ['确认路标', '零行写入也不得冒充保存成功。', '故障时的新事件']) expect(context.text).toContain(text)
  expect(errors).toEqual([])
})

test('corrupt stage data stays intact, exposes a reload error and leaves backup navigation available', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await setup(page); const original = (await rows(page, id))[0]
  const corrupt = '[{"id":"保留原始数据","keyEvents":null}]'
  await page.evaluate(async ({ arcId, corrupt }) => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    await db.storyArcs.update(arcId, { stages: corrupt })
  }, { arcId: original.id, corrupt })
  await page.reload()
  await expect(page.getByRole('alert').filter({ hasText: '故事阶段' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'AI 生成', exact: true })).toBeDisabled()
  await openLongformLeaf(page, '导出'); await expect(page).toHaveURL(/module=export/)
  expect((await rows(page, id))[0].stages).toBe(corrupt)
  expect(errors).toEqual([])
})

test('typing the next event while a prior event is committing does not erase the new input', async ({ page }) => {
  const id = await setup(page); await addStage(page)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const Dexie = db.constructor
    const update = db.storyArcs.update.bind(db.storyArcs)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    Object.assign(window, { releaseStoryArcWrite: release, storyArcWriteStarted: false })
    db.storyArcs.update = async (...args: unknown[]) => {
      Object.assign(window, { storyArcWriteStarted: true })
      await Dexie.waitFor(gate)
      db.storyArcs.update = update
      return update(...args)
    }
  })
  const event = page.getByPlaceholder('手动添加关键事件...', { exact: true })
  await event.fill('本次提交的事件'); await event.press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).storyArcWriteStarted)).toBe(true)
  await event.fill('正在写的下一件事')
  await page.evaluate(() => (window as any).releaseStoryArcWrite())
  await expect.poll(async () => (await stage(page, id)).keyEvents).toEqual(['本次提交的事件'])
  await expect(event).toHaveValue('正在写的下一件事')
  await event.press('Enter')
  await expect.poll(async () => (await stage(page, id)).keyEvents).toEqual(['本次提交的事件', '正在写的下一件事'])
  await expect(event).toHaveValue('')
})

test('stage deletion rolls back failed progress and retries; stale arc deletion is cancelled before a fresh confirmed delete', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await setup(page); await addStage(page)
  const arc = (await rows(page, id))[0]; const first = await stage(page, id)
  const progressId = await page.evaluate(async ({ projectId, arcId, stageId }) => {
    const imp = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { resolveScope, stampNewRecord }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts')])
    const scope = await resolveScope({ projectId })
    const progressId = await db.storylineProgress.add(stampNewRecord(scope, 'storylineProgress', { projectId, arcId, currentStageId: stageId, currentStageLabel: '阶段快照', status: 'in_progress', progressPercent: 20, lastActiveChapterId: null, lastActiveChapterTitle: '', notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
    const update = db.storylineProgress.update.bind(db.storylineProgress)
    db.storylineProgress.update = async () => 0
    Object.assign(window, { restoreStoryProgressWrite: () => { db.storylineProgress.update = update } })
    return progressId
  }, { projectId: id, arcId: arc.id, stageId: first.id })
  const progress = () => page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.storylineProgress.get(id)
  }, progressId)
  await page.getByRole('button', { name: '删除此阶段', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '进度写入0行' })).toBeVisible()
  expect((await stage(page, id)).id).toBe(first.id); expect((await progress()).currentStageId).toBe(first.id)
  await expect(page.getByLabel('故事阶段描述', { exact: true })).toBeDisabled()
  await page.evaluate(() => (window as any).restoreStoryProgressWrite())
  await page.getByRole('button', { name: '重试本次操作', exact: true }).click()
  await expect.poll(async () => JSON.parse((await rows(page, id))[0].stages)).toEqual([])
  expect((await progress()).currentStageId).toBeNull()
  await page.getByTitle('删除故事线', { exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  expect(await rows(page, id)).toHaveLength(1)
  await page.evaluate(async arcId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    await db.storyArcs.update(arcId, { description: '另一页刚保存的正式稿', updatedAt: Date.now() + 100 })
  }, arc.id)
  await page.getByTitle('删除故事线', { exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '另一页面修改' })).toBeVisible()
  expect((await rows(page, id))[0].description).toBe('另一页刚保存的正式稿')
  await page.getByRole('button', { name: '取消本次操作', exact: true }).click()
  await page.reload()
  await expect(page.getByLabel('故事线整体描述', { exact: true })).toHaveValue('另一页刚保存的正式稿')
  await page.getByTitle('删除故事线', { exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect.poll(() => rows(page, id)).toHaveLength(0)
  expect(await progress()).toBeUndefined(); expect(errors).toEqual([])
})

test('abandoning a failed event releases only its failure; the unsubmitted text remains guarded until cleared', async ({ page }) => {
  const id = await setup(page); await addStage(page); await injectFailure(page)
  const event = page.getByPlaceholder('手动添加关键事件...', { exact: true })
  await event.fill('保留后再决定的事件'); await event.press('Enter')
  await expect(page.getByRole('button', { name: '放弃本次操作', exact: true })).toBeVisible()
  await restore(page); await page.getByRole('button', { name: '放弃本次操作', exact: true }).click()
  await expect(event).toHaveValue('保留后再决定的事件')
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event); return event.defaultPrevented
  })).toBe(true)
  await page.getByTitle('新增支线', { exact: true }).click()
  expect(await rows(page, id)).toHaveLength(1)
  await expect(event).toHaveValue('保留后再决定的事件')
  await event.fill(''); await page.getByTitle('新增支线', { exact: true }).click()
  await expect.poll(() => rows(page, id)).toHaveLength(2)
  expect((await stage(page, id)).keyEvents).toEqual([])
})

async function eventAISetup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', model: 'scoped-events', baseUrl: 'https://arc-events.invalid/v1', maxTokens: 10000, contextWindow: 128000 })))
  const id = await setup(page); await addStage(page)
  await page.getByLabel('故事阶段描述', { exact: true }).fill('依据实测数据逐步决定通行。')
  await page.getByLabel('故事阶段描述', { exact: true }).blur()
  for (const text of ['测绳', '记录', '校核', '报告', '等待批复']) {
    await page.getByPlaceholder('手动添加关键事件...', { exact: true }).fill(text)
    await page.getByRole('button', { name: '添加', exact: true }).click()
    await expect(page.getByPlaceholder('手动添加关键事件...', { exact: true })).toHaveValue('')
  }
  return id
}
function eventCandidate(page: Page) { return page.locator('textarea[aria-label$="候选内容"]').first() }
function eventAdopt(page: Page) { return eventCandidate(page).locator('xpath=ancestor::section[1]').getByRole('button', { name: /^(采纳|接受提示并采纳)$/ }) }
async function savedEventDraft(page: Page, projectId: number, text: string) {
  await expect.poll(() => page.evaluate(async ({ projectId, text }) => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.agentEvents.where('projectId').equals(projectId).toArray()).some((event: any) => event.kind === 'candidate' && event.content === text && ['ready', 'usable-with-warnings'].includes(JSON.parse(event.payload).creativeArtifact?.status))
  }, { projectId, text })).toBe(true)
}

test('same-titled stages and events can enter the Gateway independently without a false Canon conflict', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await eventAISetup(page)
  const before = await page.evaluate(async projectId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const arc = await db.storyArcs.where('projectId').equals(projectId).first()
    const original = JSON.parse(arc.stages)[0]
    const stages = [{ ...original, id: 'a-b' }, { ...original, id: 'ab', description: '后续再次返程核验', keyEvents: ['第二次核验'] }]
    await db.storyArcs.update(arc.id, { stages: JSON.stringify(stages) })
    return { arc: await db.storyArcs.get(arc.id), stages }
  }, id)
  await page.reload(); await page.getByRole('button', { name: /阶段\s*1\s+依据实测数据逐步决定通行/ }).click()
  const reply = [...before.stages[0].keyEvents, '完成本轮核验后保留退路']
  let calls = 0
  await page.route('https://arc-events.invalid/**', route => {
    calls++
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ keyEvents: reply }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) })
  })
  await page.getByRole('button', { name: 'AI生成', exact: true }).click()
  await expect(eventCandidate(page)).toHaveValue(JSON.stringify({ keyEvents: reply }, null, 2))
  expect((await rows(page, id))[0]).toEqual(before.arc)
  await eventAdopt(page).click(); await expect(eventCandidate(page)).toHaveCount(0)
  expect(JSON.parse((await rows(page, id))[0].stages)).toEqual([{ ...before.stages[0], keyEvents: reply }, before.stages[1]])
  await page.reload()
  expect(calls).toBe(1); expect(errors).toEqual([])
})

test('stage-scoped AI appends beyond five existing events and sorts through editable, reloadable candidates', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const id = await eventAISetup(page); const before = (await rows(page, id))[0]; const original = JSON.parse(before.stages)
  let calls = 0; let reply = [...original[0].keyEvents, '按核验结果封闭支路']
  await page.route('https://arc-events.invalid/**', route => {
    calls++
    expect(route.request().postDataJSON().messages[0].content).toContain('唯一字段keyEvents')
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ keyEvents: reply }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) })
  })
  await page.getByRole('button', { name: 'AI生成', exact: true }).click()
  await expect(eventCandidate(page)).toHaveValue(JSON.stringify({ keyEvents: reply }, null, 2))
  expect((await rows(page, id))[0]).toEqual(before)
  await eventCandidate(page).fill(JSON.stringify({ keyEvents: ['擅改已有事件'] }))
  await expect(eventAdopt(page)).toBeDisabled()
  expect((await rows(page, id))[0]).toEqual(before)
  const edited = [...original[0].keyEvents, '作者确认：按核验结果封闭支路']; const draft = JSON.stringify({ keyEvents: edited }, null, 2)
  await eventCandidate(page).fill(draft); await savedEventDraft(page, id, draft)
  await page.reload(); await expect(eventCandidate(page)).toHaveValue(draft)
  await eventAdopt(page).click(); await expect(eventCandidate(page)).toHaveCount(0)
  expect(JSON.parse((await rows(page, id))[0].stages)).toEqual([{ ...original[0], keyEvents: edited }])
  expect((await rows(page, id))[0].name).toBe(before.name); expect((await rows(page, id))[0].description).toBe(before.description)
  await page.getByRole('button', { name: /阶段\s*1/ }).click()
  reply = [...edited].reverse()
  await page.getByRole('button', { name: 'AI排序', exact: true }).click()
  const sorted = JSON.stringify({ keyEvents: reply }, null, 2)
  await expect(eventCandidate(page)).toHaveValue(sorted); await savedEventDraft(page, id, sorted)
  await page.reload(); await expect(eventCandidate(page)).toHaveValue(sorted)
  await eventAdopt(page).click(); await expect(eventCandidate(page)).toHaveCount(0)
  expect(JSON.parse((await rows(page, id))[0].stages)).toEqual([{ ...original[0], keyEvents: reply }])
  expect(calls).toBe(2); expect(errors).toEqual([])
})

test('AI sort cannot rewrite events, stops after bounded repair, and accepts an author-corrected permutation without another model', async ({ page }) => {
  const id = await eventAISetup(page); const before = (await rows(page, id))[0]; const original = JSON.parse(before.stages)[0]
  let calls = 0
  await page.route('https://arc-events.invalid/**', route => {
    calls++
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ keyEvents: [...original.keyEvents.slice(1), '模型擅自改写'] }) }, finish_reason: 'stop' }] }) })
  })
  await page.getByRole('button', { name: 'AI排序', exact: true }).click()
  await expect(page.getByText('需要手动修复', { exact: true })).toBeVisible()
  await expect(eventAdopt(page)).toBeDisabled(); expect(calls).toBe(2)
  expect((await rows(page, id))[0]).toEqual(before)
  const fixed = JSON.stringify({ keyEvents: [...original.keyEvents].reverse() }, null, 2)
  await eventCandidate(page).fill(fixed); await savedEventDraft(page, id, fixed)
  await page.reload(); await expect(eventCandidate(page)).toHaveValue(fixed)
  await eventAdopt(page).click(); await expect(eventCandidate(page)).toHaveCount(0)
  expect(JSON.parse((await rows(page, id))[0].stages)[0]).toEqual({ ...original, keyEvents: [...original.keyEvents].reverse() })
  expect(calls).toBe(2)
})
