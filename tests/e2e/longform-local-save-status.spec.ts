import { expect, test, type Page } from '@playwright/test'
const fields = ['worldStructure', 'worldDimensions', 'continentLayout', 'mountainsRivers', 'climateByRegion'] as const
const labels = ['世界结构', '疆域尺寸', '地貌分布', '山川水系', '气候环境']
let modelAttempts = 0
test.beforeEach(async ({ context, page, baseURL }) => {
  modelAttempts = 0; const origin = new URL(baseURL!).origin
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '050-isolated'))
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (/\/chat\/completions|\/(?:responses|requests|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)/.test(url.pathname)) modelAttempts++
    return url.origin === origin && ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort()
  })
  await page.goto('./')
})
test.afterEach(() => expect(modelAttempts).toBe(0))
async function seed(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { seedCurrentWorkspace } = await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    return (await seedCurrentWorkspace('050 隔离保存验收')).scope
  })
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    return (await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')).db.worldviews.toArray()
  })
}
async function flush(page: Page) {
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    await (await load<typeof import('../../src/lib/authoring/pending-edit-coordinator')>('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')).flushPendingEditsV1()
  })
}
const pane = (page: Page) => page.locator('.lf-world-field:visible').first()
test('050 Reference note native original writer retains failed text and blocks tab loss until retry', async ({ page, context }) => {
  const scope = await seed(page)
  const id = await page.evaluate(async scope => {
    const { useReferenceStore } = await (new Function('return import("/storyforge/src/stores/reference.ts")'))()
    return useReferenceStore.getState().addReference({ projectId: scope.projectId, title: '原参考050', author: '原作者', type: 'style', note: '原参考要点', url: '' }, scope)
  }, scope)
  await page.goto(`./workspace/${scope.projectId}?module=references`)
  await page.getByRole('button').filter({ hasText: '原参考050' }).click()
  await page.getByRole('button', { name: '基本信息', exact: true }).click()
  const readView = (text: string) => page.locator('[data-markdown-read-view]').filter({ hasText: text })
  await expect(readView('原参考要点').locator('../..').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await readView('原参考要点').getByRole('button', { name: '编辑源码', exact: true }).click()
  const note = page.locator('textarea[placeholder="记录你希望借鉴这部作品的哪些方面…"]')
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const fault = () => { throw new DOMException('isolated reference quota failure', 'QuotaExceededError') }
    db.references.hook('updating', fault)
    Object.assign(window, { clearReference050Fault: () => db.references.hook('updating').unsubscribe(fault) })
  })
  await note.fill('# 参考要点新稿\n\n原文与尾空白完整。  '); const raw = await note.inputValue()
  await expect(flush(page)).rejects.toThrow('isolated reference quota failure')
  await page.getByRole('button', { name: '作品分析', exact: true }).click()
  await expect(note).toBeVisible(); await expect(note).toHaveValue(raw)
  await expect(note.locator('..').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'failed')
  await page.evaluate(() => (window as unknown as { clearReference050Fault: () => void }).clearReference050Fault())
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(readView('参考要点新稿').locator('../..').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  const url = page.url(); await page.close(); const reopened = await context.newPage(); await reopened.goto(url)
  await reopened.getByRole('button').filter({ hasText: '原参考050' }).click()
  await reopened.getByRole('button', { name: '基本信息', exact: true }).click()
  await expect(reopened.locator('[data-markdown-read-view]').filter({ hasText: '参考要点新稿' }).locator('../..').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  const saved = await reopened.evaluate(async id => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return db.references.get(id)
  }, id)
  expect(saved).toMatchObject({ note: raw, title: '原参考050', author: '原作者', workId: scope.workId })
})
test('050 Planning native stable scene and stage text survives failure, retry and reopened tab', async ({ page, context }) => {
  const scope = await seed(page)
  const ids = await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useOutlineStore } = await load<typeof import('../../src/stores/outline')>('/storyforge/src/stores/outline.ts')
    const { useDetailedOutlineStore } = await load<typeof import('../../src/stores/detailed-outline')>('/storyforge/src/stores/detailed-outline.ts')
    const { useStoryArcStore } = await load<typeof import('../../src/stores/story-arc')>('/storyforge/src/stores/story-arc.ts')
    const node = await useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: null, type: 'chapter', title: '规划验收章节', summary: '章纲不改', order: 0 }, scope)
    const detail = await useDetailedOutlineStore.getState().getOrCreate(scope, node)
    await useDetailedOutlineStore.getState().editScene(detail.id!, { kind: 'add', scene: { sceneId: 'native-scene', title: '原场景标题', summary: '原场景概要', characterIds: [], location: '', conflict: '', pace: 'medium', estimatedWords: 0, notes: '' } }, scope, '章纲不改')
    const arc = await useStoryArcStore.getState().addArc({ projectId: scope.projectId, name: '验收故事线', description: '原线概述', type: 'main', stages: JSON.stringify([{ id: 'native-stage', title: '起步阶段', description: '原阶段描述', keyEvents: ['原事件保留'] }]) }, scope)
    return { node, detail: detail.id!, arc }
  }, scope)
  const readView = (text: string) => page.locator('[data-markdown-read-view]').filter({ hasText: text })
  await page.goto(`./workspace/${scope.projectId}?module=detailed-outline&chapter=${ids.node}&work=${scope.workId}`)
  await expect(readView('原场景概要').locator('..').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await readView('原场景概要').getByRole('button', { name: '编辑源码', exact: true }).click()
  const summary = page.getByRole('textbox', { name: '场景1 · 概要', exact: true })
  await summary.fill('# 新场景概要\n\n保留原文尾空白。  '); const sceneRaw = await summary.inputValue(); await flush(page)
  await summary.press('Tab')
  await expect(readView('新场景概要').locator('..').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.locator('summary').filter({ hasText: '场景任务（可选，可留白）' }).press('Enter')
  const goal = page.getByRole('textbox', { name: '场景1 · 本场目标', exact: true })
  await expect(goal.locator('..').locator('[data-local-save-status]')).toBeVisible()
  await goal.fill('第一次填写场景任务。  '); await flush(page)
  await page.goto(`./workspace/${scope.projectId}?module=story-arc`)
  await expect(readView('原线概述').locator('..').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.getByRole('button').filter({ has: page.locator('p').filter({ hasText: /^起步阶段$/ }) }).click()
  await readView('原阶段描述').getByRole('button', { name: '编辑源码', exact: true }).click()
  const stage = page.getByRole('textbox', { name: '故事阶段描述', exact: true })
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const fault = () => { throw new DOMException('isolated planning quota failure', 'QuotaExceededError') }
    db.storyArcs.hook('updating', fault)
    Object.assign(window, { clearPlanning050Fault: () => db.storyArcs.hook('updating').unsubscribe(fault) })
  })
  await stage.fill('# 新阶段描述\n\n失败仍保留。  '); const stageRaw = await stage.inputValue()
  await expect(flush(page)).rejects.toThrow('isolated planning quota failure')
  await expect(stage).toHaveValue(stageRaw)
  await expect(stage.locator('..').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'failed')
  await page.evaluate(() => (window as unknown as { clearPlanning050Fault: () => void }).clearPlanning050Fault())
  await page.getByRole('button', { name: '重试保存故事阶段描述', exact: true }).click()
  await expect(readView('新阶段描述').locator('..').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  const turn = page.getByRole('textbox', { name: '故事阶段转折点', exact: true })
  await turn.fill('作者明确转折'); await flush(page)
  const reopenUrl = page.url(); await page.close(); const reopened = await context.newPage(); await reopened.goto(reopenUrl)
  await expect(reopened.locator('[data-markdown-read-view]').filter({ hasText: '原线概述' }).locator('..').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  const saved = await reopened.evaluate(async ids => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { detail: await db.detailedOutlines.get(ids.detail), arc: await db.storyArcs.get(ids.arc), node: await db.outlineNodes.get(ids.node) }
  }, ids)
  expect(saved.detail.scenes[0]).toMatchObject({ sceneId: 'native-scene', summary: sceneRaw, goal: '第一次填写场景任务。  ' })
  expect(JSON.parse(saved.arc.stages)[0]).toMatchObject({ id: 'native-stage', description: stageRaw, turningPoint: '作者明确转折', keyEvents: ['原事件保留'] })
  expect(saved.node.summary).toBe('章纲不改'); expect(saved.detail.workId).toBe(scope.workId); expect(saved.arc.workId).toBe(scope.workId)
})
test('050 CreativeRules native original writer confirms three text fields and quota retry after reload', async ({ page }) => {
  const scope = await seed(page); await page.goto(`./workspace/${scope.projectId}?module=rules`)
  const box = (label: string) => page.locator('.mb-6').filter({ has: page.locator('label').filter({ hasText: new RegExp(`^${label}$`) }) })
  const enter = async (label: string) => {
    const field = box(label)
    await expect(field.locator('[data-local-save-status]')).toBeVisible()
    await field.getByRole('button', { name: '编辑源码', exact: true }).or(field.locator('div.cursor-text')).first().click()
    return field.locator('textarea')
  }
  const style = await enter('写作风格'); await style.fill('# 作者风格\n\n原文与尾空白🌊。  ')
  const styleRaw = await style.inputValue(); await flush(page)
  await expect(box('写作风格').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const fault = () => { throw new DOMException('isolated rules quota failure', 'QuotaExceededError') }
    db.creativeRules.hook('updating', fault)
    Object.assign(window, { clearRules050Fault: () => db.creativeRules.hook('updating').unsubscribe(fault) })
  })
  const atmosphere = await enter('基调和氛围'); await atmosphere.fill('失败时仍保留的氛围原文。  ')
  await expect(flush(page)).rejects.toThrow('isolated rules quota failure')
  await expect(box('基调和氛围').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'failed')
  await expect(atmosphere).toHaveValue('失败时仍保留的氛围原文。  ')
  await page.evaluate(() => (window as unknown as { clearRules050Fault: () => void }).clearRules050Fault())
  await box('基调和氛围').getByRole('button', { name: '重试', exact: true }).click()
  await expect(box('基调和氛围').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  const special = await enter('特殊创作要求'); await special.fill('特殊要求完整保存。  '); await flush(page)
  await expect(box('特殊创作要求').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.reload(); await expect(box('写作风格').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  const rows = await page.evaluate(async scope => {
    const { readOwnedRows } = await (new Function('return import("/storyforge/src/lib/workspace/scope.ts")'))()
    return readOwnedRows(scope, 'creativeRules', { owner: 'work' })
  }, scope)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ workId: scope.workId, writingStyle: styleRaw, atmosphere: '失败时仍保留的氛围原文。  ',
    specialRequirements: '特殊要求完整保存。  ', narrativePOV: 'third-limited', prohibitions: '[]' })
})
test('050 StoryCore native first-create and failed retry confirm exact registered Work fields after reload', async ({ page }) => {
  const scope = await seed(page); await page.goto(`./workspace/${scope.projectId}?module=story-design`)
  const state = page.locator('[data-local-save-status]:visible')
  await expect(state).toHaveAttribute('data-local-save-status', 'unconfirmed')
  const enter = async () => {
    await page.getByRole('button', { name: '编辑源码', exact: true }).or(page.locator('div.cursor-text:visible')).first().click()
    return page.locator('textarea:visible').first()
  }
  const area = await enter(); await area.fill('# 作者原始故事\n\n完整中文与尾空白🌊。  ')
  const logline = await area.inputValue(); await flush(page)
  await expect(state).toHaveAttribute('data-local-save-status', 'saved')
  await page.getByLabel('故事字段').getByRole('button').filter({ has: page.getByText('故事主题', { exact: true }) }).click()
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const fault = () => { throw new DOMException('isolated story quota failure', 'QuotaExceededError') }
    db.storyCores.hook('updating', fault)
    Object.assign(window, { clearStory050Fault: () => db.storyCores.hook('updating').unsubscribe(fault) })
  })
  const themeArea = await enter(); await themeArea.fill('主题原文不改写，失败不丢。  ')
  await expect(flush(page)).rejects.toThrow('isolated story quota failure')
  await expect(state).toHaveAttribute('data-local-save-status', 'failed'); await expect(themeArea).toHaveValue('主题原文不改写，失败不丢。  ')
  await page.evaluate(() => (window as unknown as { clearStory050Fault: () => void }).clearStory050Fault())
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(state).toHaveAttribute('data-local-save-status', 'saved')
  await page.reload(); await expect(state).toHaveAttribute('data-local-save-status', 'saved')
  const rows = await page.evaluate(async scope => {
    const { readOwnedRows } = await (new Function('return import("/storyforge/src/lib/workspace/scope.ts")'))()
    return readOwnedRows(scope, 'storyCores', { owner: 'work' })
  }, scope)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ logline, theme: '主题原文不改写，失败不丢。  ', workId: scope.workId })
})
test('050 Work info native saved feedback follows IME, actual DB failure, retry, reload and reopened tab', async ({ page, context }) => {
  const scope = await seed(page), url = `./workspace/${scope.projectId}?module=info`
  await page.goto(url)
  const state = page.locator('[data-work-info-save-status]')
  await expect(state).toHaveAttribute('data-work-info-save-status', 'saved')
  const title = page.getByRole('textbox', { name: '作品名称', exact: true })
  await title.dispatchEvent('compositionstart'); await title.fill('原作完整中文尾字🌊')
  await expect(state).toHaveAttribute('data-work-info-save-status', 'dirty')
  await expect(flush(page)).rejects.toThrow('输入法仍在组合')
  await title.dispatchEvent('compositionend'); await flush(page)
  await expect(state).toHaveAttribute('data-work-info-save-status', 'saved')
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const fault = () => { throw new DOMException('isolated Work quota failure', 'QuotaExceededError') }
    db.works.hook('updating', fault)
    Object.assign(window, { clearWork050Fault: () => db.works.hook('updating').unsubscribe(fault) })
  })
  await page.getByRole('button', { name: '编辑源码', exact: true }).click()
  const description = page.getByRole('textbox', { name: '作品简介', exact: true })
  await description.fill('# 完整作者简介\n\n保留标点、段落和尾空白🌊。  ')
  const raw = await description.inputValue()
  await expect(flush(page)).rejects.toThrow('isolated Work quota failure')
  await expect(state).toHaveAttribute('data-work-info-save-status', 'failed')
  await expect(description).toHaveValue(raw)
  await page.evaluate(() => (window as unknown as { clearWork050Fault: () => void }).clearWork050Fault())
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(state).toHaveAttribute('data-work-info-save-status', 'saved')
  const read = (target: Page) => target.evaluate(async scope => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { work: await db.works.get(scope.workId), project: await db.projects.get(scope.projectId) }
  }, scope)
  const saved = await read(page)
  expect(saved.work.title).toBe('原作完整中文尾字🌊'); expect(saved.work.description).toBe(raw)
  expect(saved.project.description).toBeUndefined()
  await page.reload(); await expect(state).toHaveAttribute('data-work-info-save-status', 'saved')
  const reopenUrl = page.url(); await page.close()
  const reopened = await context.newPage(); await reopened.goto(reopenUrl)
  await expect(reopened.locator('[data-work-info-save-status]')).toHaveAttribute('data-work-info-save-status', 'saved')
  expect((await read(reopened)).work.description).toBe(raw)
  await expect(reopened.getByRole('textbox', { name: '作品名称', exact: true })).toHaveValue('原作完整中文尾字🌊')
})
async function enter(page: Page) {
  const field = pane(page)
  const entry = field.getByRole('button', { name: '编辑源码', exact: true }).or(field.locator('.cursor-text').first()).first()
  // Re-evaluate the live entry if DB loading swaps an empty placeholder for
  // the explicit Markdown source action; never choose via a premature probe.
  await expect(entry).toBeVisible(); await entry.click()
  return field.locator('textarea').first()
}
async function select(page: Page, index: number) { await page.locator('nav button').filter({ hasText: labels[index] }).first().click() }
test('N5 native input → dirty → committed saved → reload → closed tab and new tab retain exact submitted source', async ({ page, context }, info) => {
  const scope = await seed(page); const url = `./workspace/${scope.projectId}?module=worldview-natural`
  await page.goto(url); await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'unconfirmed')
  const originals: string[] = []
  for (let i = 0; i < fields.length; i++) {
    await select(page, i); const area = await enter(page)
    await area.fill(`  # ${labels[i]} 🌊\r\n\r\n| 港 | 山 |\r\n| -- | -- |\r\n\r\n\`\`\`text\r\n  |-- 河  \r\n\`\`\`\r\n  `)
    // Native textarea input normalizes CRLF to LF. Confirm exactly the actual
    // submitted value; a separate native writer test covers original CRLF.
    originals.push(await area.inputValue())
    await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'dirty')
    await flush(page)
    await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
    expect((await snapshot(page))[0][fields[i]]).toBe(originals[i])
  }
  await page.reload(); await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.screenshot({ path: info.outputPath('n5-local-saved.png'), fullPage: true })
  const reopenUrl = page.url(); await page.close(); const reopened = await context.newPage(); await reopened.goto(reopenUrl)
  for (let i = 0; i < fields.length; i++) {
    await select(reopened, i); await expect(pane(reopened).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
    expect((await snapshot(reopened))[0][fields[i]]).toBe(originals[i])
  }
})
test('native registered writer preserves first-create CRLF/edge whitespace, rolls back second-write and poststate faults, and never acknowledges empty absence', async ({ page }) => {
  const scope = await seed(page)
  const result = await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { useWorldviewStore } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    const store = useWorldviewStore; await store.getState().loadAll(scope)
    const expected = () => ({ kind: 'natural-field-local-save-v1' as const, session: 'native', generation: 1, expected: store.getState().localSaveWitnesses.worldStructure! })
    const raw = '  # CRLF🌊\r\n\r\n```text\r\n  |-- A  \r\n```\r\n  '
    const save = (value: string) => store.getState().saveWorldview({ projectId: scope.projectId, worldStructure: value }, scope, expected())
    const errors: string[] = []
    try { await save('') } catch (e) { errors.push(String(e)) }
    const countEmpty = await db.worldviews.count()
    const fault = () => { throw new DOMException('simulated quota', 'QuotaExceededError') }; db.worldviews.hook('updating', fault)
    try { await save(raw) } catch (e) { errors.push(String(e)) } finally { db.worldviews.hook('updating').unsubscribe(fault) }
    const countFault = await db.worldviews.count()
    const corrupt = () => ({ worldStructure: 'wrong poststate' }); db.worldviews.hook('updating', corrupt)
    try { await save(raw) } catch (e) { errors.push(String(e)) } finally { db.worldviews.hook('updating').unsubscribe(corrupt) }
    const countPoststate = await db.worldviews.count()
    const ack = await save(raw); db.close(); await db.open()
    return { errors, countEmpty, countFault, countPoststate, actual: (await db.worldviews.get(ack.witness.recordId!))?.worldStructure, raw, ack }
  }, scope)
  expect(result.errors.join(' ')).toContain('尚未填写'); expect(result.errors.join(' ')).toContain('simulated quota'); expect(result.errors.join(' ')).toContain('精确保存')
  expect([result.countEmpty, result.countFault, result.countPoststate]).toEqual([0, 0, 0]); expect(result.actual).toBe(result.raw); expect(result.ack.witness.value).toBe(result.raw)
  await page.goto(`./workspace/${scope.projectId}?module=worldview-natural`)
  await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.reload(); expect((await snapshot(page))[0].worldStructure).toBe(result.raw)
  const beforeNoInput = JSON.stringify(await snapshot(page))
  const untouchedArea = await enter(page)
  await untouchedArea.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(2, 8))
  await select(page, 1); await flush(page)
  // Merely mounting/selecting a textarea normalizes DOM.value, but never
  // authorizes writing that DOM projection back into the original CRLF field.
  expect(JSON.stringify(await snapshot(page))).toBe(beforeNoInput)
})
test('native same-field stale preserves draft, unrelated field update succeeds, and IME/resize/window-return retain source', async ({ page }) => {
  const scope = await seed(page); await page.goto(`./workspace/${scope.projectId}?module=worldview-natural`)
  let area = await enter(page); await area.fill('first'); await flush(page)
  area = await enter(page); await area.fill('author draft')
  await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { adopt } = await load<typeof import('../../src/lib/registry/adopt')>('/storyforge/src/lib/registry/adopt.ts')
    const row = (await db.worldviews.toArray())[0]
    await adopt({ projectId: scope.projectId, scope, target: 'worldviews', recordId: row.id!, mode: 'replace', preserveAuthorText: true, data: { worldStructure: 'other tab' } })
  }, scope)
  await expect(flush(page)).rejects.toThrow('已被修改'); await expect(area).toHaveValue('author draft')
  await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'failed')
  // A reload deliberately discards only this isolated test's failed draft.
  await page.reload(); await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  area = await enter(page); await area.fill('same field remains valid')
  await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { adopt } = await load<typeof import('../../src/lib/registry/adopt')>('/storyforge/src/lib/registry/adopt.ts')
    await adopt({ projectId: scope.projectId, scope, target: 'worldviews', recordId: (await db.worldviews.toArray())[0].id!, mode: 'replace', preserveAuthorText: true, data: { mountainsRivers: 'other field' } })
  }, scope)
  await area.dispatchEvent('compositionstart'); await area.fill('中文尾字🌊')
  await expect(flush(page)).rejects.toThrow('输入法')
  await area.dispatchEvent('compositionend'); const handle = pane(page).getByRole('button', { name: '调整输入区大小', exact: true })
  await handle.press('ArrowDown'); await expect(area).toHaveValue('中文尾字🌊')
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')) })
  await flush(page); await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  expect((await snapshot(page))[0]).toMatchObject({ worldStructure: '中文尾字🌊', mountainsRivers: 'other field' })
})
test('native old ack cannot finish a new draft or IME tail; latest flush drains and quota failure retries without losing input', async ({ page }) => {
  const scope = await seed(page); await page.goto(`./workspace/${scope.projectId}?module=worldview-natural`)
  await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'unconfirmed')
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useWorldviewStore } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    const original = useWorldviewStore.getState().saveWorldview
    const state = window as unknown as { release050?: () => void; attempts050: number; flush050?: string }
    state.attempts050 = 0
    // Hold only notification of the first real committed ack. Every write still
    // executes the actual registered writer exactly once.
    useWorldviewStore.setState({ saveWorldview: ((...args: Parameters<typeof original>) => {
      state.attempts050++
      const result = original(...args)
      return state.attempts050 === 1 ? result.then(ack => new Promise<typeof ack>(resolve => { state.release050 = () => resolve(ack) })) : result
    }) as typeof original })
  })
  const area = await enter(page); await area.fill('first committed')
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { flushPendingEditsV1 } = await load<typeof import('../../src/lib/authoring/pending-edit-coordinator')>('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')
    const state = window as unknown as { flush050?: string }; state.flush050 = 'pending'
    void flushPendingEditsV1().then(() => { state.flush050 = 'resolved' }, error => { state.flush050 = String(error) })
  })
  await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saving')
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { release050?: () => void }).release050)).toBe('function')
  await area.dispatchEvent('compositionstart'); await area.fill('new 中文尾🌊')
  await page.evaluate(() => (window as unknown as { release050: () => void }).release050())
  await expect.poll(() => page.evaluate(() => (window as unknown as { flush050: string }).flush050)).toContain('输入法')
  await expect(area).toHaveValue('new 中文尾🌊'); expect((await snapshot(page))[0].worldStructure).toBe('first committed')
  await area.dispatchEvent('compositionend'); await flush(page)
  await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  expect((await snapshot(page))[0].worldStructure).toBe('new 中文尾🌊')
  expect(await page.evaluate(() => (window as unknown as { attempts050: number }).attempts050)).toBe(2)
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const fault = () => { throw new DOMException('simulated browser quota', 'QuotaExceededError') }; db.worldviews.hook('updating', fault)
    ;(window as unknown as { cleanup050: () => void }).cleanup050 = () => db.worldviews.hook('updating').unsubscribe(fault)
  })
  const retryArea = await enter(page); await retryArea.fill('quota retry 原稿🌊')
  await expect(flush(page)).rejects.toThrow('simulated browser quota')
  await expect(retryArea).toHaveValue('quota retry 原稿🌊'); await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'failed')
  await page.evaluate(() => (window as unknown as { cleanup050: () => void }).cleanup050())
  await pane(page).getByRole('button', { name: '重试', exact: true }).click()
  await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  expect((await snapshot(page))[0].worldStructure).toBe('quota retry 原稿🌊')
})
test('native fact invalidation rolls back with a failed field write; committed Canon cache and exact original read reflect the final source', async ({ page }) => {
  const scope = await seed(page)
  const result = await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { useWorldviewStore: store } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    const { fingerprintSettingSource } = await load<typeof import('../../src/lib/fact-ledger/setting-assertions')>('/storyforge/src/lib/fact-ledger/setting-assertions.ts')
    const { CANON_RESOURCE_PROVIDER_V1: canon } = await load<typeof import('../../src/lib/context-gateway/canon-provider')>('/storyforge/src/lib/context-gateway/canon-provider.ts')
    await store.getState().saveWorldview({ projectId: scope.projectId, worldStructure: 'old native source' }, scope)
    await store.getState().loadAll(scope); const old = (await db.worldviews.toArray())[0]
    const factId = await db.temporalFacts.add({ projectId: scope.projectId, workId: scope.workId, subjectName: '港', predicate: 'technologyLevel', factKind: 'state', value: 'old native source', sourceType: 'setting', sourceRecordTable: 'worldviews', sourceWorldviewId: old.id!, sourceField: 'worldStructure', sourceFingerprint: fingerprintSettingSource('old native source'), status: 'confirmed', locked: false, createdAt: 1, updatedAt: 1 })
    const frozen = { ...scope, worldGroupId: null }
    const before = await canon.listMetadata({ scope: frozen, kinds: ['worldview-field'], limit: 100 })
    const oldDescriptor = before.items.find(item => item.resourceKey.endsWith(':field:worldStructure'))!
    const raw = '  # native final 🌊\r\n  |-- A  \r\n  '
    const save = () => store.getState().saveWorldview({ projectId: scope.projectId, worldStructure: raw }, scope, { kind: 'natural-field-local-save-v1', expected: store.getState().localSaveWitnesses.worldStructure!, session: 'native-facts', generation: 1 })
    const fault = () => { throw new Error('native fact fault') }; db.temporalFacts.hook('updating', fault)
    let rejected = ''; try { await save() } catch (error) { rejected = String(error) } finally { db.temporalFacts.hook('updating').unsubscribe(fault) }
    const rollback = { field: (await db.worldviews.get(old.id!))?.worldStructure, fact: (await db.temporalFacts.get(factId))?.status }
    const ack = await save()
    const after = await canon.listMetadata({ scope: frozen, kinds: ['worldview-field'], limit: 100 })
    const descriptor = after.items.find(item => item.resourceKey === oldDescriptor.resourceKey)!
    const original = await canon.readOriginal({ scope: frozen, resourceKey: descriptor.resourceKey, sourceRef: descriptor.sourceRefs[0], maxTokens: 1000 })
    return { rejected, rollback, fact: (await db.temporalFacts.get(factId))?.status, uidStable: (await db.worldviews.get(old.id!))?.ragDocumentId === old.ragDocumentId, changedHash: descriptor.contentHash !== oldDescriptor.contentHash, raw, actual: original.content, ack: ack.witness.value }
  }, scope)
  expect(result.rejected).toContain('native fact fault'); expect(result.rollback).toEqual({ field: 'old native source', fact: 'confirmed' })
  expect(result.fact).toBe('stale'); expect(result.uidStable).toBe(true); expect(result.changedHash).toBe(true); expect(result.actual).toBe(result.raw); expect(result.ack).toBe(result.raw)
})

test('origin and humanity native fields show committed status through ordinary Workspace routes and reopened tab', async ({ page, context }) => {
  const scope = await seed(page)
  const cases = [
    { route: 'module=worldview-origin', field: 'worldOrigin' },
    { route: 'module=worldview-origin&originField=power', field: 'powerHierarchy' },
    { route: 'module=worldview-humanity', field: 'races' },
    { route: 'module=worldview-humanity', field: 'economyOverview', tab: '经济制度' },
  ] as const
  const originals: string[] = []
  for (const [i, item] of cases.entries()) {
    await page.goto(`./workspace/${scope.projectId}?${item.route}`)
    if ('tab' in item) await page.locator('nav button').filter({ hasText: item.tab }).first().click()
    const status = page.locator('[data-local-save-status]:visible').first()
    await expect(status).toHaveAttribute('data-local-save-status', /unconfirmed|saved/)
    const edit = page.getByRole('button', { name: '编辑源码', exact: true }).or(page.locator('.cursor-text:visible').first()).first()
    await expect(edit).toBeVisible(); await edit.click()
    const area = page.locator('textarea:visible').first()
    await area.fill(`  # ${item.field} 🌊\r\n\r\n第17年，不可夜航。\r\n  `)
    originals.push(await area.inputValue())
    await expect(status).toHaveAttribute('data-local-save-status', 'dirty')
    await flush(page)
    await expect(status).toHaveAttribute('data-local-save-status', 'saved')
    expect((await snapshot(page))[0][item.field]).toBe(originals[i])
  }
  await page.reload()
  const reopenUrl = page.url(); await page.close()
  const reopened = await context.newPage(); await reopened.goto(reopenUrl)
  await reopened.locator('nav button').filter({ hasText: '经济制度' }).first().click()
  await expect(reopened.locator('[data-local-save-status]:visible').first()).toHaveAttribute('data-local-save-status', 'saved')
  const row = (await snapshot(reopened))[0]
  for (const [i, item] of cases.entries()) expect(row[item.field]).toBe(originals[i])
})

test('nested divine and resource fields confirm native leaf writes, retain siblings and recover an actual failed transaction', async ({ page, context }) => {
  const scope = await seed(page)
  await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useWorldviewStore } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    await useWorldviewStore.getState().loadAll(scope)
    await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId,
      divineDesign: { hasDivinity: true, divineRank: '原阶序', divineNames: '# 原名', divineRules: '不可夜航' },
      naturalResources: { rareCreatures: '原兽', herbs: '# 原药', minerals: '原矿', others: '原产' } }, scope)
  }, scope)
  await page.goto(`./workspace/${scope.projectId}?module=worldview-origin&originField=divine`)
  const names = page.getByText('名号与职司', { exact: true }).locator('..')
  await expect(names.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await names.getByRole('button', { name: '编辑源码', exact: true }).click()
  const nameArea = names.locator('textarea')
  await nameArea.fill('  # 作者神名\r\n\r\n潮汐守望者　 ')
  const expectedName = await nameArea.inputValue()
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const holder = window as typeof window & { __sf050LeafFault?: () => never }
    holder.__sf050LeafFault = () => { throw new DOMException('native leaf quota', 'QuotaExceededError') }
    db.worldviews.hook('updating', holder.__sf050LeafFault)
  })
  await expect(flush(page)).rejects.toThrow('native leaf quota')
  await expect(names.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'failed')
  await expect(nameArea).toHaveValue(expectedName)
  expect((await snapshot(page))[0].divineDesign).toEqual({ hasDivinity: true, divineRank: '原阶序', divineNames: '# 原名', divineRules: '不可夜航' })
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const holder = window as typeof window & { __sf050LeafFault?: () => never }
    db.worldviews.hook('updating').unsubscribe(holder.__sf050LeafFault!); delete holder.__sf050LeafFault
  })
  await names.getByRole('button', { name: '重试', exact: true }).click()
  await expect(names.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.goto(`./workspace/${scope.projectId}?module=worldview-natural`)
  await page.locator('nav button').filter({ hasText: '自然资源' }).first().click()
  await page.getByText('自然资源分类明细（原生结构）', { exact: true }).click()
  const herbs = page.getByText('🌿 灵药 / 粮食作物', { exact: true }).locator('..')
  await herbs.getByRole('button', { name: '编辑源码', exact: true }).click()
  const herbArea = herbs.locator('textarea'); await herbArea.fill('  # 潮汐药草\r\n\r\n每17年开花。  ')
  const expectedHerbs = await herbArea.inputValue()
  await flush(page)
  await expect(herbs.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  const url = page.url(); await page.close(); const reopened = await context.newPage(); await reopened.goto(url)
  await reopened.locator('nav button').filter({ hasText: '自然资源' }).first().click()
  await reopened.getByText('自然资源分类明细（原生结构）', { exact: true }).click()
  await expect(reopened.getByText('🌿 灵药 / 粮食作物', { exact: true }).locator('..').locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  const row = (await snapshot(reopened))[0]
  expect(row.divineDesign).toEqual({ hasDivinity: true, divineRank: '原阶序', divineNames: expectedName, divineRules: '不可夜航' })
  expect(row.naturalResources).toEqual({ rareCreatures: '原兽', herbs: expectedHerbs, minerals: '原矿', others: '原产' })
})

test('embedded Codex confirms real record saves, retains failed Markdown drafts and reopens the committed source', async ({ page, context }) => {
  const scope = await seed(page)
  const id = await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useCodexStore } = await load<typeof import('../../src/stores/codex')>('/storyforge/src/stores/codex.ts')
    await useCodexStore.getState().loadAll(scope)
    const category = useCodexStore.getState().categories.find(row => row.builtInKey === 'race')!
    return useCodexStore.getState().addEntry({ projectId: scope.projectId, categoryId: category.id!, name: '保存验收种族',
      summary: '原简介', description: '# 旧描述\r\n\r\n军税17枚。  ', fields: '{}', refs: '{}', tags: '[]', order: 0 })
  }, scope)
  await page.goto(`./workspace/${scope.projectId}?module=worldview-humanity`)
  await page.locator('div.group:visible').filter({ hasText: '保存验收种族' }).last().click()
  const status = page.locator('[data-codex-local-save-status]:visible')
  await expect(status).toHaveAttribute('data-codex-local-save-status', 'saved')
  const source = page.locator('[data-codex-source-field="description"]:visible')
  await source.getByRole('button', { name: '编辑源码', exact: true }).click()
  const area = source.locator('textarea'); await area.fill('  # 新描述\r\n\r\n军税仍为17枚，不可夜航。　 ')
  const expected = await area.inputValue()
  await expect(status).toHaveAttribute('data-codex-local-save-status', 'dirty')
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const holder = window as typeof window & { __sf050CodexFault?: () => never }
    holder.__sf050CodexFault = () => { throw new DOMException('native codex quota', 'QuotaExceededError') }
    db.codexEntries.hook('updating', holder.__sf050CodexFault)
  })
  await expect(flush(page)).rejects.toThrow('native codex quota')
  await expect(status).toHaveAttribute('data-codex-local-save-status', 'failed')
  await expect(area).toHaveValue(expected)
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const holder = window as typeof window & { __sf050CodexFault?: () => never }
    db.codexEntries.hook('updating').unsubscribe(holder.__sf050CodexFault!); delete holder.__sf050CodexFault
  })
  await page.getByRole('button', { name: '重试保存词条', exact: true }).click()
  await expect(status).toHaveAttribute('data-codex-local-save-status', 'saved')
  await expect(source.locator('textarea')).toHaveCount(0)
  const url = page.url(); await page.close(); const reopened = await context.newPage(); await reopened.goto(url)
  await reopened.locator('div.group:visible').filter({ hasText: '保存验收种族' }).last().click()
  await expect(reopened.locator('[data-codex-local-save-status]:visible')).toHaveAttribute('data-codex-local-save-status', 'saved')
  const actual = await reopened.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    return (await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')).db.codexEntries.get(id)
  }, id)
  expect(actual?.description).toBe(expected); expect(actual?.name).toBe('保存验收种族'); expect(actual?.summary).toBe('原简介')
})

test('050 History native six-field save evidence, quota retry and reopened-tab readback stay on the original World', async ({ page, context }) => {
  const scope = await seed(page)
  const ids = await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useHistoryStore } = await load<typeof import('../../src/stores/project-singletons')>('/storyforge/src/stores/project-singletons.ts')
    const { useHistoricalStore } = await load<typeof import('../../src/stores/historical')>('/storyforge/src/stores/historical.ts')
    await useHistoryStore.getState().saveForHistoryAuthorV1({ origin: { version: 1, kind: 'work', scope }, selection: { kind: 'partition', worldGroupId: null }, patch: { overview: '初始总述', eraSystem: '初始纪年' } })
    const eventId = await useHistoricalStore.getState().addEvent({ projectId: scope.projectId, era: 'custom', year: 1, date: '初年', title: '隔离历史事件', description: '初始事件', isHistorical: false }, scope)
    const keywordId = await useHistoricalStore.getState().addKeyword({ projectId: scope.projectId, keyword: '隔离历史关键词', era: 'custom', category: 'culture', description: '初始关键词' })
    return { eventId, keywordId }
  }, scope)
  const url = `./workspace/${scope.projectId}?module=history`
  await page.goto(url)
  await page.getByRole('button', { name: '历史总述与纪年', exact: true }).click()
  const overview = page.locator('div.p-5.space-y-2').filter({ has: page.locator('label').filter({ hasText: /^历史总述$/ }) })
  const era = page.locator('div.p-5.space-y-2').filter({ has: page.locator('label').filter({ hasText: /^纪年体系$/ }) })
  const enter = async (box: ReturnType<Page['locator']>, value: string) => {
    await expect(box.locator('[data-local-save-status]')).toBeVisible()
    await box.getByRole('button', { name: '编辑源码', exact: true }).or(box.locator('div.cursor-text')).first().click()
    const area = box.locator('textarea'); await area.fill(value); return area
  }
  await enter(overview, '# 历史总述\n\n作者原文🌊。  '); await flush(page)
  await expect(overview.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await enter(era, '纪年原文与末尾。  '); await flush(page)
  await expect(era.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.getByRole('button', { name: '历史时间轴', exact: true }).click()
  await page.getByRole('button').filter({ hasText: '隔离历史事件' }).click()
  const content = page.locator('div.px-4.pb-4.border-t')
  const description = content.locator(':scope > div').filter({ has: page.locator('label').filter({ hasText: /^📒 条目定稿/ }) })
  const concept = content.locator(':scope > div').filter({ has: page.locator('label').filter({ hasText: /^🧭 概念与创作思路/ }) })
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const fault = () => { throw new DOMException('isolated history quota failure', 'QuotaExceededError') }
    db.historicalTimelineEvents.hook('updating', fault)
    Object.assign(window, { clearHistory050Fault: () => db.historicalTimelineEvents.hook('updating').unsubscribe(fault) })
  })
  const failed = await enter(description, '事件定稿原文，失败不丢。  ')
  await expect(flush(page)).rejects.toThrow('isolated history quota failure')
  await expect(description.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'failed')
  await expect(failed).toHaveValue('事件定稿原文，失败不丢。  ')
  await page.evaluate(() => (window as unknown as { clearHistory050Fault: () => void }).clearHistory050Fault())
  await description.getByRole('button', { name: '重试', exact: true }).click()
  await expect(description.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await enter(concept, '事件概念原文。  '); await flush(page)
  await expect(concept.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.getByRole('button', { name: '历史细节风暴', exact: true }).click()
  await page.getByRole('button').filter({ hasText: '#隔离历史关键词' }).click()
  await enter(description, '关键词定稿原文。  '); await flush(page)
  await expect(description.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await enter(concept, '关键词概念原文。  '); await flush(page)
  await expect(concept.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.reload(); await page.getByRole('button').filter({ hasText: '隔离历史事件' }).click()
  await expect(description.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  const reopened = await context.newPage(); await page.close(); await reopened.goto(url)
  await reopened.getByRole('button').filter({ hasText: '隔离历史事件' }).click()
  await expect(reopened.locator('[data-local-save-status]')).toHaveCount(2)
  const saved = await reopened.evaluate(async ({ scope, ids }) => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { histories: await db.histories.where('projectId').equals(scope.projectId).toArray(),
      event: await db.historicalTimelineEvents.get(ids.eventId), keyword: await db.historicalKeywords.get(ids.keywordId) }
  }, { scope, ids })
  expect(saved.histories).toHaveLength(1)
  expect(saved.histories[0]).toMatchObject({ overview: '# 历史总述\n\n作者原文🌊。  ', eraSystem: '纪年原文与末尾。  ', worldId: scope.worldId })
  expect(saved.event).toMatchObject({ title: '隔离历史事件', description: '事件定稿原文，失败不丢。  ', conceptNote: '事件概念原文。  ', worldId: scope.worldId })
  expect(saved.keyword).toMatchObject({ keyword: '隔离历史关键词', description: '关键词定稿原文。  ', conceptNote: '关键词概念原文。  ', worldId: scope.worldId })
})

test('050 Character and outline native record feedback survives quota retry, linked title save and reopened tab', async ({ page, context }) => {
  const scope = await seed(page)
  const ids = await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useCharacterStore } = await load<typeof import('../../src/stores/character')>('/storyforge/src/stores/character.ts')
    const { useOutlineStore } = await load<typeof import('../../src/stores/outline')>('/storyforge/src/stores/outline.ts')
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { stampNewRecord } = await load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts')
    const charId = await useCharacterStore.getState().addCharacter({ projectId: scope.projectId, name: '原角色', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '', appearance: '', personality: '', background: '旧背景', profile: '', motivation: '', abilities: '', relationships: '旧关系', arc: '' })
    const volumeId = await useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: null, type: 'volume', title: '原卷名', summary: '旧卷摘要', order: 0 }, scope)
    const nodeId = await useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId: volumeId, type: 'chapter', title: '原章名', summary: '旧章摘要', order: 0 }, scope)
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', { projectId: scope.projectId, outlineNodeId: nodeId, title: '原章名', content: '正文不变', wordCount: 4, status: 'draft' as const, createdAt: Date.now(), updatedAt: Date.now() }, { owner: 'work' }))
    return { charId, volumeId, nodeId, chapterId }
  }, scope)
  await page.goto(`./workspace/${scope.projectId}?module=characters-main`)
  await page.getByRole('button').filter({ hasText: '原角色' }).click()
  const background = page.getByText('背景故事', { exact: true }).locator('..')
  await expect(background.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.evaluate(async () => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const original = db.characters.update.bind(db.characters)
    db.characters.update = async () => { throw new DOMException('native character proof quota', 'QuotaExceededError') }
    Object.assign(window, { clearRecord050Fault: () => { db.characters.update = original } })
  })
  await background.getByRole('button', { name: '编辑源码', exact: true }).click()
  const draft = background.getByRole('textbox', { name: '背景故事', exact: true })
  await draft.fill('# 角色原文\n\n失败后保留🌊。  ')
  await expect(flush(page)).rejects.toThrow('native character proof quota')
  await expect(background.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'failed')
  await expect(draft).toHaveValue('# 角色原文\n\n失败后保留🌊。  ')
  await page.evaluate(() => (window as unknown as { clearRecord050Fault: () => void }).clearRecord050Fault())
  await background.getByRole('button', { name: '重试保存背景故事', exact: true }).click()
  await expect(background.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  const relation = page.getByText('人物关系', { exact: true }).locator('..')
  await expect(relation.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await relation.getByRole('button', { name: '编辑源码', exact: true }).click()
  await relation.getByRole('textbox', { name: '人物关系', exact: true }).fill('人物关系原文。  '); await flush(page)
  await expect(relation.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  const url = `./workspace/${scope.projectId}?module=outline`
  await page.goto(url)
  await page.getByRole('button').filter({ hasText: '原卷名' }).first().click()
  const title = page.getByLabel('章节标题', { exact: true })
  await expect(title).toBeVisible()
  const chapter = title.locator('..').locator('..')
  await expect(chapter.locator('[data-local-save-status]')).toHaveCount(2)
  await title.fill('新章名'); await flush(page)
  await expect(chapter.locator('[data-local-save-status]').first()).toHaveAttribute('data-local-save-status', 'saved')
  await chapter.getByRole('button', { name: '编辑源码', exact: true }).click()
  await chapter.getByLabel('章节摘要', { exact: true }).fill('# 章节摘要\n\n完整章纲原文。  '); await flush(page)
  await expect(chapter.locator('[data-local-save-status]').nth(1)).toHaveAttribute('data-local-save-status', 'saved')
  const volume = page.getByText('卷情节摘要', { exact: true }).locator('..')
  await expect(volume.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await volume.getByRole('button', { name: '编辑源码', exact: true }).click()
  await volume.getByLabel('卷情节摘要', { exact: true }).fill('卷情节原文。  '); await flush(page)
  await expect(volume.locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.reload(); await expect(page.getByLabel('章节标题', { exact: true })).toHaveValue('新章名')
  const reopened = await context.newPage(); await page.close(); await reopened.goto(url)
  await expect(reopened.getByLabel('章节标题', { exact: true })).toHaveValue('新章名')
  const actual = await reopened.evaluate(async ids => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    return { char: await db.characters.get(ids.charId), volume: await db.outlineNodes.get(ids.volumeId), node: await db.outlineNodes.get(ids.nodeId), chapter: await db.chapters.get(ids.chapterId) }
  }, ids)
  expect(actual.char).toMatchObject({ name: '原角色', background: '# 角色原文\n\n失败后保留🌊。  ', relationships: '人物关系原文。  ', worldId: scope.worldId })
  expect(actual.volume).toMatchObject({ summary: '卷情节原文。  ', workId: scope.workId })
  expect(actual.node).toMatchObject({ title: '新章名', summary: '# 章节摘要\n\n完整章纲原文。  ', workId: scope.workId })
  expect(actual.chapter).toMatchObject({ title: '新章名', content: '正文不变', workId: scope.workId })
})
