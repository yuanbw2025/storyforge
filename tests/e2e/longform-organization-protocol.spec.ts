import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

const chapterText = '林舟抵达云港。\n林舟拾起潮汐钥匙。\n林舟与苏砚结为盟友。\n塔门月纹亮起，预言首次应验。'
const pageErrors = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message)) })
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]) })
async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'agnes', model: 'agnes-2.5-flash', baseUrl: 'https://organization.invalid/v1', contextWindow: 128000, maxTokens: 8000 })))
  await createLongform(page, '七域协议隔离验证')
  const seed = await page.evaluate(async text => {
    const imp = new Function('p', 'return import(p)')
    const [{ db }, { resolveScope, stampNewRecord }, { useAIConfigStore }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts'), imp('/storyforge/src/stores/ai-config.ts')])
    useAIConfigStore.setState({ config: { ...useAIConfigStore.getState().config, apiKey: 'isolated-test-token' } })
    const project = await db.projects.toCollection().first(), scope = await resolveScope({ projectId: project.id })
    const base = { projectId: project.id, createdAt: Date.now(), updatedAt: Date.now() }
    const nodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', { ...base, parentId: null, type: 'chapter', title: '抵达云港', summary: '取得钥匙并结盟', order: 0 }, { owner: 'work' }))
    const content = text.split('\n').map(line => `<p>${line}</p>`).join('')
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', { ...base, outlineNodeId: nodeId, title: '抵达云港', content, wordCount: 50, order: 0, status: 'draft', notes: '' }, { owner: 'work' }))
    for (const name of ['林舟', '苏砚']) await db.characters.add(stampNewRecord(scope, 'characters', { ...base, name, roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '', arc: '', dimensions: '{}', homeWorldGroupId: null, isCrossWorld: false }, { owner: 'world' }))
    const foreshadowId = await db.foreshadows.add(stampNewRecord(scope, 'foreshadows', { ...base, name: '塔门月纹', description: '月纹亮起才算埋下预言', status: 'planned', importance: 'normal', notes: '', echoChapterIds: '[]' }, { owner: 'work' }))
    const arcId = await db.storyArcs.add(stampNewRecord(scope, 'storyArcs', { ...base, name: '寻门主线', type: 'main', description: '抵达后交接', stages: JSON.stringify([{ id: 'hand-over', title: '交接', description: '', keyEvents: [] }]) }, { owner: 'work' }))
    return { projectId: project.id, nodeId, chapterId, content, foreshadowId, arcId }
  }, chapterText)
  await page.goto(`/storyforge/workspace/${seed.projectId}?module=chapters-list&chapter=${seed.nodeId}`)
  await page.evaluate(async () => {
    const { useAIConfigStore } = await (new Function('return import("/storyforge/src/stores/ai-config.ts")'))()
    useAIConfigStore.setState({ config: { ...useAIConfigStore.getState().config, apiKey: 'isolated-test-token' } })
  })
  await expect(page.locator('.tiptap-editor')).toHaveText(chapterText.split('\n').join(''))
  await expect(page.getByRole('button', { name: '整理本章', exact: true })).toBeEnabled()
  return seed
}
function empty() { return { stateDiffs: [], facts: [], inventoryEvents: [], storyEvents: [], relations: [], foreshadowUpdates: [], storyline: { progress: [], crossings: [], newArcs: [] } } }
async function data(page: Page, projectId: number) {
  return page.evaluate(async projectId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const result: Record<string, any[]> = {}
    for (const table of ['chapters', 'stateCards', 'temporalFacts', 'itemLedger', 'storyTimelineEvents', 'characterRelations', 'foreshadows', 'storyArcs', 'storylineProgress', 'agentEvents', 'agentRuns', 'agentRunArtifacts']) result[table] = await db[table].where('projectId').equals(projectId).toArray()
    return result
  }, projectId)
}
test('all seven domains preserve anchored candidates through reload and explicit adoption', async ({ page }) => {
  const seed = await setup(page), requests: any[] = []
  const output = { ...empty(),
    stateDiffs: [{ entityName: '林舟', category: 'character', field: '位置', oldValue: null, newValue: '云港', anchorId: 'p1' }],
    facts: [{ subject: '林舟', predicate: 'location', value: '云港', anchorId: 'p1' }],
    inventoryEvents: [{ itemName: '潮汐钥匙', heldByName: '林舟', action: 'gain', quantity: 1, note: '拾起', anchorId: 'p2' }],
    storyEvents: [{ title: '抵达云港', storyTime: '', importance: 2, description: '林舟抵达云港', anchorId: 'p1' }],
    relations: [{ char1: '林舟', char2: '苏砚', type: 'ally', label: '盟友', description: '在云港结盟', bidirectional: true, anchorId: 'p3' }],
    foreshadowUpdates: [{ foreshadowId: seed.foreshadowId, toStatus: 'planted', note: '预言首次应验', anchorId: 'p4' }],
    storyline: { progress: [{ arcId: seed.arcId, currentStageId: 'hand-over', status: 'active', progressNote: '抵达交接地点', involvedEntities: ['林舟'], anchorId: 'p1' }], crossings: [], newArcs: [] },
  }
  const raw = JSON.stringify(output), before = await data(page, seed.projectId)
  await page.route('https://organization.invalid/**', async route => { requests.push(route.request().postDataJSON()); await route.fulfill({ json: { choices: [{ message: { content: raw }, finish_reason: 'stop' }] } }) })
  await page.getByRole('button', { name: '整理本章', exact: true }).click()
  await expect(page.getByRole('button', { name: '关闭整理本章', exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false } })
  const pending = await data(page, seed.projectId)
  for (const table of ['stateCards', 'temporalFacts', 'itemLedger', 'storyTimelineEvents', 'characterRelations', 'foreshadows', 'storyArcs', 'storylineProgress']) expect(pending[table]).toEqual(before[table])
  expect(pending.agentRunArtifacts.some(row => row.artifactKind === 'raw-response' && row.content === raw)).toBe(true)
  const candidate = pending.agentEvents.filter(row => row.kind === 'candidate').map(row => { try { return JSON.parse(row.payload) } catch { return null } }).find(row => row?.type === 'chapter-organization')
  for (const key of ['stateDiffs', 'facts', 'inventoryEvents', 'storyEvents', 'relations', 'foreshadowUpdates']) expect(candidate[key]).toHaveLength(1)
  expect(candidate.storyline.progress).toHaveLength(1)
  await page.getByRole('button', { name: '关闭整理本章', exact: true }).click(); await page.reload()
  await page.getByRole('button', { name: '查看整理结果', exact: true }).click()
  await page.getByRole('button', { name: '确认写入所选（7）', exact: true }).click()
  await expect.poll(async () => (await data(page, seed.projectId)).storylineProgress.length).toBe(1)
  await expect(page.getByText('已写入', { exact: true })).toHaveCount(9)
  const after = await data(page, seed.projectId)
  expect(after.chapters.find(row => row.id === seed.chapterId)?.content).toBe(seed.content)
  expect(after.temporalFacts).toHaveLength(1); expect(after.itemLedger).toHaveLength(1); expect(after.storyTimelineEvents).toHaveLength(1); expect(after.characterRelations).toHaveLength(1)
  expect(after.foreshadows[0].status).toBe('planted')
  await page.getByRole('button', { name: '关闭整理本章', exact: true }).click(); await page.reload()
  expect(requests).toHaveLength(1)
})
test('an invalid row is visible and its exact original response survives refresh', async ({ page }) => {
  const seed = await setup(page), raw = JSON.stringify({ ...empty(), storyEvents: [{ title: '抵达', storyTime: '', importance: 2, description: '抵达', sourceQuote: '林舟终于抵达云港。' }] })
  let calls = 0
  await page.route('https://organization.invalid/**', async route => { calls++; await route.fulfill({ json: { choices: [{ message: { content: raw }, finish_reason: 'stop' }] } }) })
  await page.getByRole('button', { name: '整理本章', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '整理本章失败', exact: true })).toContainText('年表候选没有全部通过')
  expect((await data(page, seed.projectId)).agentRunArtifacts.some(row => row.artifactKind === 'raw-response' && row.content === raw)).toBe(true)
  await page.getByRole('button', { name: '知道了', exact: true }).click(); await page.reload()
  expect((await data(page, seed.projectId)).storyTimelineEvents).toHaveLength(0)
  expect((await data(page, seed.projectId)).agentRunArtifacts.some(row => row.artifactKind === 'raw-response' && row.content === raw)).toBe(true)
  expect(calls).toBe(1)
})
test('provider rejection uses one dispatch and no canonical write', async ({ page }) => {
  const seed = await setup(page); let calls = 0
  await page.route('https://organization.invalid/**', async route => { calls++; await route.fulfill({ status: 503, json: { error: { message: 'temporarily unavailable' } } }) })
  await page.getByRole('button', { name: '整理本章', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '整理本章失败', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '知道了', exact: true }).click(); await page.reload()
  expect(calls).toBe(1); expect((await data(page, seed.projectId)).storyTimelineEvents).toHaveLength(0)
})
test('a request-evidence save failure prevents dispatch; explicit new run succeeds after storage recovers', async ({ page }) => {
  const seed = await setup(page); let calls = 0
  await page.route('https://organization.invalid/**', async route => { calls++; await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify(empty()) }, finish_reason: 'stop' }] } }) })
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const fail = (_key: unknown, record: { artifactKind: string }) => {
      if (record.artifactKind !== 'rendered-request') return
      db.agentRunArtifacts.hook('creating').unsubscribe(fail)
      throw new Error('模拟请求记录写入失败')
    }
    db.agentRunArtifacts.hook('creating', fail)
  })
  await page.getByRole('button', { name: '整理本章', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '整理本章失败', exact: true })).toContainText('模拟请求记录写入失败')
  expect(calls).toBe(0)
  await page.getByRole('button', { name: '知道了', exact: true }).click()
  await page.getByRole('button', { name: '整理本章', exact: true }).click()
  await expect(page.getByRole('button', { name: '关闭整理本章', exact: true })).toBeVisible()
  expect(calls).toBe(1); expect((await data(page, seed.projectId)).storyTimelineEvents).toHaveLength(0)
})
test('prose adoption keeps post-organization authorization and raw evidence through refresh', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'agnes', model: 'agnes-2.5-flash', baseUrl: 'https://organization.invalid/v1', maxTokens: 8000, contextWindow: 128000 })))
  await createLongform(page, '章后七域完整授权')
  const projectId = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)')
    const [{ db }, { resolveScope }, policy, { useAIConfigStore }] = await Promise.all([imp('/storyforge/src/lib/db/schema.ts'), imp('/storyforge/src/lib/workspace/scope.ts'), imp('/storyforge/src/lib/prose/post-adoption-policy.ts'), imp('/storyforge/src/stores/ai-config.ts')])
    const project = await db.projects.toCollection().first(), scope = await resolveScope({ projectId: project.id })
    useAIConfigStore.setState({ config: { ...useAIConfigStore.getState().config, apiKey: 'isolated-test-token' } })
    await policy.updateWorkPostAdoptionSettingsV1({ scope, settings: policy.resolveWorkPostAdoptionSettingsV1({ postAdoptionPolicy: 'suggest', postAdoptionTaskTypes: ['organization'] }) })
    return project.id
  })
  await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByLabel('章节摘要', { exact: true }).fill('林舟抵达云港，拿到钥匙后确认交接。')
  await page.getByTitle('编辑本章细纲', { exact: true }).click()
  await page.getByRole('button', { name: '添加场景', exact: true }).click()
  await page.getByPlaceholder('一句话场景概要...', { exact: true }).fill('抵达、取得钥匙、确认交接，停止在当晚。')
  await page.getByRole('button', { name: '写本章正文', exact: true }).click()
  const generated = chapterText.repeat(12), organizationRaw = JSON.stringify({ ...empty(), storyEvents: [{ title: '抵达云港', storyTime: '', importance: 2, description: '林舟抵达云港', anchorId: 'p1' }] })
  const requests: any[] = []
  await page.route('https://organization.invalid/**', async route => {
    const body = route.request().postDataJSON(); requests.push(body)
    if (body.stream) await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: generated }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` })
    else await route.fulfill({ json: { choices: [{ message: { content: organizationRaw }, finish_reason: 'stop' }] } })
  })
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示', exact: true }).getByRole('button', { name: '开始生成', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveValue(generated)
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认并开始章后任务', exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)
  await page.getByRole('button', { name: '确认并开始章后任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '关闭整理本章', exact: true })).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests[1]).toMatchObject({ response_format: { type: 'json_object' }, chat_template_kwargs: { enable_thinking: false } })
  expect((await data(page, projectId)).storyTimelineEvents).toHaveLength(0)
  await page.getByRole('button', { name: '关闭整理本章', exact: true }).click(); await page.reload()
  await page.getByRole('button', { name: '查看整理结果', exact: true }).click()
  await page.getByRole('button', { name: '确认写入所选（1）', exact: true }).click()
  await expect.poll(async () => (await data(page, projectId)).agentRuns.some(row => row.parentRelation === 'prose-post-adoption' && row.status === 'completed')).toBe(true)
  const after = await data(page, projectId)
  expect(after.storyTimelineEvents).toHaveLength(1)
  expect(after.agentRunArtifacts.some(row => row.artifactKind === 'raw-response' && row.content === organizationRaw)).toBe(true)
  expect(requests).toHaveLength(2)
})
