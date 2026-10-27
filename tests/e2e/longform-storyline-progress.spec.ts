import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

async function setup(page: Page, confirmed = false) {
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'agnes', model: 'agnes-2.5-flash', baseUrl: 'https://storyline-progress.invalid/v1', contextWindow: 128000, maxTokens: 6000 })))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await createLongform(page, '动态进度全流程')
  await page.evaluate(async () => {
    const { useAIConfigStore } = await (new Function('return import("/storyforge/src/stores/ai-config.ts")'))()
    useAIConfigStore.setState({ config: { ...useAIConfigStore.getState().config, apiKey: 'isolated-test-token' } })
  })
  const data = await page.evaluate(async confirmed => {
    const imp = new Function('p', 'return import(p)')
    const [{ db }, { resolveScope, stampNewRecord }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts')])
    const project = await db.projects.toCollection().first(); const scope = await resolveScope({ projectId: project.id })
    const base = { projectId: project.id, createdAt: Date.now(), updatedAt: Date.now() }
    const nodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { ...base, parentId: null, type: 'chapter', title: '交钥匙', summary: '交付后取得路线', order: 0 }, { owner: 'work' }))
    const content = '<p>林飞把青铜钥匙交给许宁，换得运粮路线。</p>'
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', { ...base, outlineNodeId: nodeId, title: '交钥匙', content, wordCount: 21, order: 0, status: 'draft', notes: '' }, { owner: 'work' }))
    const arcIds = []
    for (const [name, type, id] of [['寻钥主线', 'main', 'hand-over'], ['路线支线', 'sub', 'get-route']]) {
      arcIds.push(await db.storyArcs.add(stampNewRecord(scope, 'storyArcs', { ...base, name, type, description: '交付线索后核验下一段路线', origin: 'manual', status: 'active', stages: JSON.stringify([{ id, title: '交接', description: '以实际交接推进', keyEvents: ['交接后核验'] }]) }, { owner: 'work' })))
    }
    if (confirmed) await db.storylineProgress.add(stampNewRecord(scope, 'storylineProgress', { ...base, arcId: arcIds[0], currentStageId: 'hand-over', status: 'active', progressNote: '原先确认的交接进度', lastActiveChapterId: chapterId, lastActiveChapterTitle: '交钥匙', involvedEntities: '[]', evidenceQuote: '交给许宁' }, { owner: 'work' }))
    return { projectId: project.id, chapterId, nodeId, arcIds, content }
  }, confirmed)
  await openLongformLeaf(page, '故事线')
  await expect(page.getByRole('region', { name: '动态故事线进度', exact: true }).getByRole('button', { name: '映射本章', exact: true })).toBeEnabled()
  return data
}
function panel(page: Page) { return page.getByRole('region', { name: '动态故事线进度', exact: true }) }
async function canon(page: Page, projectId: number) {
  return page.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { arcs: await db.storyArcs.where('projectId').equals(id).toArray(), progress: await db.storylineProgress.where('projectId').equals(id).toArray(), crossings: await db.storylineCrossings.where('projectId').equals(id).toArray(), chapters: await db.chapters.where('projectId').equals(id).toArray() }
  }, projectId)
}
async function draftSaved(page: Page, projectId: number, text: string) {
  await expect.poll(() => page.evaluate(async ({ projectId, text }) => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return (await db.agentEvents.where('projectId').equals(projectId).toArray()).some((event: any) => event.kind === 'candidate' && event.content === text)
  }, { projectId, text })).toBe(true)
}

test('progress read failure is visible, disables mapping and explicitly retries without model dispatch or stale data', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const f = await setup(page, true); let calls = 0
  await page.route('https://storyline-progress.invalid/**', route => { calls++; return route.abort() })
  const before = await canon(page, f.projectId)
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const fail = () => { throw new Error('隔离进度原生读取故障') }
    db.storylineProgress.hook('reading', fail)
    ;(window as any).restoreProgressReading = () => db.storylineProgress.hook('reading').unsubscribe(fail)
  })
  await page.getByLabel('故事线名称', { exact: true }).fill('寻钥主线·触发重读')
  await page.getByLabel('故事线名称', { exact: true }).blur()
  await expect(panel(page).getByRole('alert')).toContainText('隔离进度原生读取故障')
  await expect(panel(page)).not.toContainText('原先确认的交接进度')
  await expect(panel(page).getByRole('button', { name: '映射本章', exact: true })).toBeDisabled()
  await page.evaluate(() => (window as any).restoreProgressReading())
  await panel(page).getByRole('button', { name: '重新读取进度', exact: true }).click()
  await expect(panel(page).getByRole('alert')).toHaveCount(0)
  await expect(panel(page)).toContainText('原先确认的交接进度')
  await expect(panel(page).getByRole('button', { name: '映射本章', exact: true })).toBeEnabled()
  expect((await canon(page, f.projectId)).progress).toEqual(before.progress)
  expect(calls).toBe(0); expect(errors).toEqual([])
})

test('chapter mapping rejects one candidate, edits the next, refuses invalid adoption, then atomically adopts progress, crossing and new Arc', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const f = await setup(page); const before = await canon(page, f.projectId); let calls = 0
  await page.route('https://storyline-progress.invalid/**', route => {
    calls++
    const body = route.request().postDataJSON()
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toContain('progressNote')
    expect(body.messages[0].content).toContain('anchorId')
    expect(body.messages[1].content).toContain(`"id":${f.arcIds[0]}`)
    const output = { progress: [{ arcId: f.arcIds[0], currentStageId: 'hand-over', status: 'active', progressNote: '以交付推进寻钥主线', involvedEntities: ['林飞', '许宁'], anchorId: 'p1' }], crossings: [{ arcIdA: f.arcIds[0], arcIdB: f.arcIds[1], note: '钥匙交付换来运粮路线', anchorId: 'p1' }], newArcs: [{ name: '返程支线', type: 'sub', description: '取得路线后仍须核验返程', anchorId: 'p1' }] }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) })
  })
  const editor = panel(page).getByLabel('故事线进度候选 JSON', { exact: true })
  await panel(page).getByRole('button', { name: '映射本章', exact: true }).click()
  await expect(editor).toHaveValue(/以交付推进寻钥主线/)
  expect(await canon(page, f.projectId)).toEqual(before)
  await panel(page).getByRole('button', { name: '拒绝', exact: true }).click()
  await expect(editor).toHaveCount(0); expect(await canon(page, f.projectId)).toEqual(before)
  await panel(page).getByRole('button', { name: '映射本章', exact: true }).click()
  await expect(editor).toHaveValue(/以交付推进寻钥主线/)
  const draft = JSON.parse(await editor.inputValue())
  const invalid = structuredClone(draft); invalid.progress[0].arcId = 987654
  const invalidText = JSON.stringify(invalid, null, 2)
  await editor.fill(invalidText); await draftSaved(page, f.projectId, invalidText)
  await expect(panel(page).getByRole('alert')).toBeVisible()
  await expect(panel(page).getByRole('button', { name: '采纳本次映射', exact: true })).toBeDisabled()
  await expect(editor).toBeEnabled(); expect(await canon(page, f.projectId)).toEqual(before)
  draft.progress[0].progressNote = '作者确认：交付后已取得路线，尚待下一步核验。'
  const text = JSON.stringify(draft, null, 2)
  await editor.fill(text); await draftSaved(page, f.projectId, text)
  await page.reload(); await expect(editor).toHaveValue(text)
  expect(await canon(page, f.projectId)).toEqual(before)
  await panel(page).getByRole('button', { name: '采纳本次映射', exact: true }).click()
  await expect(editor).toHaveCount(0)
  const after = await canon(page, f.projectId)
  expect(after.progress).toHaveLength(1); expect(after.crossings).toHaveLength(1); expect(after.arcs).toHaveLength(3)
  expect(after.progress[0].progressNote).toBe(draft.progress[0].progressNote)
  expect(after.progress[0].lastActiveChapterId).toBe(f.chapterId)
  expect(after.chapters).toEqual(before.chapters)
  await page.reload(); expect(await canon(page, f.projectId)).toEqual(after)
  expect(calls).toBe(2); expect(errors).toEqual([])
})

test('mapping provider failure is one dispatch, retains prose and does not restart on reload', async ({ page }) => {
  const f = await setup(page); const before = await canon(page, f.projectId); let calls = 0
  await page.route('https://storyline-progress.invalid/**', route => { calls++; return route.fulfill({ status: 503, body: '隔离映射服务故障' }) })
  await panel(page).getByRole('button', { name: '映射本章', exact: true }).click()
  await expect(panel(page).getByRole('alert')).toBeVisible()
  await expect(panel(page).getByLabel('故事线进度候选 JSON', { exact: true })).toHaveCount(0)
  expect(await canon(page, f.projectId)).toEqual(before)
  await page.reload(); expect(await canon(page, f.projectId)).toEqual(before)
  expect(calls).toBe(1)
})

test('native IME changes in the mapping candidate participate in close and navigation guards before the parent draft changes', async ({ page, context }) => {
  const f = await setup(page); let calls = 0
  await page.route('https://storyline-progress.invalid/**', route => {
    calls++
    const data = { progress: [{ arcId: f.arcIds[0], currentStageId: 'hand-over', status: 'active', progressNote: '交付后取得路线', involvedEntities: [], anchorId: 'p1' }], crossings: [], newArcs: [] }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) })
  })
  await panel(page).getByRole('button', { name: '映射本章', exact: true }).click()
  const editor = panel(page).getByLabel('故事线进度候选 JSON', { exact: true })
  await expect(editor).toHaveValue(/交付后取得路线/)
  await expect(panel(page).getByRole('button', { name: '采纳本次映射', exact: true })).toBeEnabled()
  await editor.focus()
  await editor.evaluate((element: HTMLTextAreaElement) => { const at = element.value.indexOf('交付后取得路线'); element.setSelectionRange(at, at) })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: '作者确认', selectionStart: 4, selectionEnd: 4 })
  await expect(editor).toHaveValue(/作者确认交付后取得路线/)
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented })).toBe(true)
  const blocked = await page.evaluate(async () => {
    const { flushPendingEditsV1 } = await (new Function('return import("/storyforge/src/lib/authoring/pending-edit-coordinator.ts")'))()
    try { await flushPendingEditsV1(); return '' } catch (error) { return error instanceof Error ? error.message : String(error) }
  })
  expect(blocked).toContain('输入法输入')
  await expect(panel(page).getByRole('button', { name: '采纳本次映射', exact: true })).toBeDisabled()
  await cdp.send('Input.insertText', { text: '作者确认' })
  const text = await editor.inputValue(); await draftSaved(page, f.projectId, text)
  await page.reload(); await expect(editor).toHaveValue(text)
  expect(calls).toBe(1)
})
