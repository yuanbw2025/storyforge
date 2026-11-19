import { expect, test, type Page } from '@playwright/test'
import type { WorkspaceScope } from '../../src/lib/types'
type SeedFixture = { scope: WorkspaceScope; result: { runId: number } }

// Native app/theme, isolated browser storage, durable fixture candidates, and
// zero model/network authority. The shared-shell synthetic tests are separate.
const modelAttempts = new WeakMap<Page, number>()
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  modelAttempts.set(page, 0)
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '047-isolated'))
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (/\/chat\/completions|\/(?:responses|requests|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)/.test(url.pathname)) {
      modelAttempts.set(page, modelAttempts.get(page)! + 1)
      return route.abort()
    }
    return url.origin === origin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort()
  })
  await page.goto('./')
})
test.afterEach(async ({ page }) => { expect(modelAttempts.get(page)).toBe(0) })
async function seed(page: Page, object = false) {
  return page.evaluate(async objectCandidate => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const fixture = objectCandidate
      ? await (await load<{ seedSfqa118ObjectCandidate: () => Promise<SeedFixture> }>('/storyforge/tests/helpers/sfqa118-worldview-candidate.ts')).seedSfqa118ObjectCandidate()
      : await (await load<{ seedCurrentMasterCandidate: (name: string, draft: string) => Promise<SeedFixture> }>('/storyforge/tests/helpers/current-master-candidate.ts')).seedCurrentMasterCandidate('047 独立测试长篇', '原始候选：盐约生效后才开放城门。')
    return { projectId: fixture.scope.projectId, workId: fixture.scope.workId, scope: fixture.scope, runId: fixture.result.runId }
  }, object)
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    // Exact content plus revisions, stale/adoption/run/checkpoint evidence.
    return JSON.stringify(await Promise.all([db.worldviews.toArray(), db.storyCores.toArray(), db.powerSystems.toArray(), db.cultivationSystems.toArray(), db.histories.toArray(), db.worldRulesProfiles.toArray(), db.historicalKeywords.toArray(), db.historicalTimelineEvents.toArray(), db.agentEvents.toArray(), db.agentRuns.toArray(), db.agentRunEvents.toArray()]))
  })
}
async function nudge(page: Page, key: string, direction = 'ArrowDown') {
  const frame = page.locator(`[data-input-area-layout="${key}"]`)
  await expect(frame).toBeVisible()
  await frame.getByRole('button', { name: '调整输入区大小', exact: true }).press(direction)
  return frame
}
async function noAreaOverflow(page: Page) {
  const overflows = await page.locator('[data-input-area-layout] textarea').evaluateAll(areas => areas.filter(area => {
    const rect = area.getBoundingClientRect(), parent = area.parentElement!.getBoundingClientRect()
    return rect.left < parent.left - 1 || rect.right > parent.right + 1
  }).length)
  expect(overflows).toBe(0)
}

for (const width of [2560, 1920, 1728, 1366, 390]) {
  test(`047 native theme ${width}: drag, keys, zoom, refresh and reset preserve candidate/domain bytes`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    const ids = await seed(page)
    await page.goto(`./workspace/${ids.projectId}?module=worldview-origin&originField=origin`)
    const frame = page.locator('[data-input-area-layout="world.origin/candidate"]')
    await expect(frame).toBeVisible()
    const editor = frame.locator('textarea'), initial = await editor.inputValue()
    const before = await snapshot(page)
    const handle = frame.getByRole('button', { name: '调整输入区大小', exact: true })
    await handle.press('ArrowDown')
    const start = await editor.boundingBox()
    await handle.scrollIntoViewIfNeeded()
    const knob = (await handle.boundingBox())!
    await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2)
    await page.mouse.down(); await page.mouse.move(knob.x + knob.width / 2 - 40, knob.y + knob.height / 2 + 48, { steps: 4 }); await page.mouse.up()
    await expect.poll(async () => (await editor.boundingBox())!.height).toBeGreaterThan(start!.height + 20)
    await expect(editor).toHaveValue(initial)
    await noAreaOverflow(page)
    const desired = await page.evaluate(() => JSON.parse(localStorage.getItem('storyforge-input-area-layout-v1')!).boxes['world.origin/candidate'])
    await page.setViewportSize({ width: Math.min(width, 700), height: 700 })
    await page.evaluate(() => { document.body.style.zoom = '1.25' })
    await noAreaOverflow(page)
    await page.evaluate(() => { document.body.style.zoom = '' })
    await page.setViewportSize({ width, height: 1000 })
    await page.reload()
    await expect(editor).toHaveValue(initial)
    await expect.poll(async () => (await editor.boundingBox())!.height).toBeCloseTo(desired.height, 0)
    expect(await snapshot(page)).toBe(before)
    await frame.getByRole('button', { name: '调整输入区大小', exact: true }).scrollIntoViewIfNeeded()
    await frame.screenshot({ path: info.outputPath(`input-${width}.png`) })
    await page.screenshot({ path: info.outputPath(`native-${width}.png`), fullPage: true })
    await frame.getByRole('button', { name: '恢复自适应', exact: true }).click()
    await expect.poll(() => page.evaluate(() => localStorage.getItem('storyforge-input-area-layout-v1'))).toBeNull()
    expect(await snapshot(page)).toBe(before)
  })
}

test('047 native object candidate keeps invalid-edit guard and existing adoption after layout/reset/reload', async ({ page }) => {
  const ids = await seed(page, true)
  await page.goto(`./workspace/${ids.projectId}?module=worldview-origin&originField=divine`)
  const frame = page.locator('[data-input-area-layout="world.divine/json"]')
  await expect(frame).toBeVisible()
  const before = await snapshot(page)
  const lineage = await page.evaluate(async runId => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return await db.agentRunEvents.where('runId').equals(runId).toArray()
  }, ids.runId)
  await nudge(page, 'world.divine/json')
  await frame.getByRole('button', { name: '恢复自适应', exact: true }).click()
  expect(await snapshot(page)).toBe(before)
  const review = page.locator('section').filter({ has: page.getByRole('heading', { name: /^待确认 · / }) })
  const editor = frame.locator('textarea'), adopt = review.getByRole('button', { name: '采纳', exact: true })
  await editor.fill('{')
  await expect(adopt).toBeDisabled()
  await expect(review.getByRole('alert')).toContainText('JSON')
  const value = { hasDivinity: true, divineRank: '盐约议会', divineNames: '执潮者', divineRules: '不得取走未许可的记忆。' }
  await editor.fill(JSON.stringify(value))
  await expect(adopt).toBeEnabled()
  await page.reload()
  expect(JSON.parse(await editor.inputValue())).toEqual(value)
  await expect(adopt).toBeEnabled(); await adopt.click()
  await expect(review).toHaveCount(0)
  const proof = await page.evaluate(async ({ ids, lineage }) => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { verifyMasterAgentRunV1 } = await load<typeof import('../../src/lib/agent/run/master-verification')>('/storyforge/src/lib/agent/run/master-verification.ts')
    const verified = await verifyMasterAgentRunV1({ scope: ids.scope, runId: ids.runId })
    const events = await db.agentRunEvents.where('runId').equals(ids.runId).toArray()
    return { value: (await db.worldviews.toArray())[0].divineDesign, accepted: verified.accepted,
      receipt: verified.snapshot.projection.terminalReceiptHash, originalLineageExact: JSON.stringify(events.slice(0, lineage.length)) === JSON.stringify(lineage),
      revisions: events.filter(event => event.type === 'candidate.revised').length }
  }, { ids, lineage })
  expect(proof).toMatchObject({ value, accepted: true, originalLineageExact: true, revisions: 1 })
  expect(proof.receipt).toMatch(/^[a-f0-9]{64}$/)
})

test('047 native story core, history blur, and rule native inputs preserve real save/reload paths', async ({ page }) => {
  const ids = await seed(page)
  await page.goto(`./workspace/${ids.projectId}?module=story-design`)
  // Story core is outside the five-module compact layout admission list.
  await page.getByText(/^点击填写.*…$/).first().click()
  const story = page.locator('[data-input-area-layout="story.logline/current"]')
  await expect(story).toBeVisible()
  await story.locator('textarea').fill('作者正文：盐约开启一座城。')
  await nudge(page, 'story.logline/current')
  await story.getByRole('button', { name: '恢复自适应', exact: true }).click()
  await page.locator('h2:visible').first().click()
  await page.reload()
  await expect(page.getByText('作者正文：盐约开启一座城。', { exact: true })).toBeVisible()
  await page.goto(`./workspace/${ids.projectId}?module=history`)
  await page.getByRole('button', { name: '历史总述与纪年', exact: true }).click()
  const history = page.locator('[data-input-area-layout="history.overview/current"]')
  await history.locator('textarea').fill('历史原稿：灯塔建立。')
  await nudge(page, 'history.overview/current')
  const historyBeforeLeave = await snapshot(page)
  await history.getByRole('button', { name: '恢复自适应', exact: true }).click()
  expect(await snapshot(page)).toBe(historyBeforeLeave)
  await page.getByRole('button', { name: '历史总述与纪年', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '历史总述与纪年', exact: true }).click()
  await expect(history.locator('textarea')).toHaveValue('历史原稿：灯塔建立。')
  await page.goto(`./workspace/${ids.projectId}?module=world-rules`)
  const note = page.locator('[data-input-area-layout="rules.note/current"]')
  await note.locator('textarea').fill('作者规则：遵循既有盐约。')
  await expect.poll(async () => (await snapshot(page)).includes('作者规则：遵循既有盐约。')).toBe(true)
  const rulesBefore = await snapshot(page)
  await nudge(page, 'rules.note/current')
  await note.getByRole('button', { name: '恢复自适应', exact: true }).click()
  expect(await snapshot(page)).toBe(rulesBefore)
  await page.reload()
  await expect(note.locator('textarea')).toHaveValue('作者规则：遵循既有盐约。')
})

test('047 admission rejects stale active Work, short, unknown profile and world workspaces', async ({ page }) => {
  const ids = await seed(page)
  await page.goto(`./workspace/${ids.projectId}?module=worldview-origin&originField=origin`)
  await expect(page.locator('[data-input-area-layout="world.origin/candidate"]')).toBeVisible()
  await page.evaluate(async ids => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { createWorldWork, switchActiveWork } = await load<typeof import('../../src/lib/workspace/works')>('/storyforge/src/lib/workspace/works.ts')
    const { useProjectStore } = await load<typeof import('../../src/stores/project')>('/storyforge/src/stores/project.ts')
    const short = await createWorldWork(ids.projectId, { title: '短篇', kind: 'novel', novelProfile: 'short', targetWordCount: 10_000 })
    await switchActiveWork(ids.projectId, short.id!)
    const get = db.works.get.bind(db.works)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    Object.assign(window, { inputAreaReadPending: false, releaseInputAreaRead: () => { db.works.get = get; release() } })
    db.works.get = (async (id: number) => { if (id === short.id) { Object.assign(window, { inputAreaReadPending: true }); await gate } return get(id) }) as typeof db.works.get
    await useProjectStore.getState().loadProjects()
  }, ids)
  await expect.poll(() => page.evaluate(() => (window as unknown as { inputAreaReadPending: boolean }).inputAreaReadPending)).toBe(true)
  await expect(page.locator('[data-input-area-layout]')).toHaveCount(0)
  await page.evaluate(() => (window as unknown as { releaseInputAreaRead: () => void }).releaseInputAreaRead())
  await expect(page.locator('.short-json-editor')).toBeVisible()
  await expect(page.locator('[data-input-area-layout]')).toHaveCount(0)
  const worldId = await page.evaluate(async ids => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { seedCurrentWorkspace } = await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    await db.works.update(ids.workId, { novelProfile: null })
    await db.projects.update(ids.projectId, { activeWorkId: ids.workId })
    return (await seedCurrentWorkspace('047 世界工作区', { purpose: 'world-engine' })).scope.projectId
  }, ids)
  await page.goto(`./workspace/${ids.projectId}?module=worldview-origin`)
  await expect(page.locator('[data-input-area-layout]')).toHaveCount(0)
  await page.goto(`./workspace/${worldId}?module=worldview-origin`)
  await expect(page.getByText('世界起源', { exact: true }).first()).toBeVisible()
  await expect(page.locator('[data-input-area-layout]')).toHaveCount(0)
})

test('047 native natural, humanity, power and cultivation editors receive only UI layout aliases', async ({ page }) => {
  const ids = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { seedCurrentWorkspace } = await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    const { scope } = await seedCurrentWorkspace('047 无候选字段测试')
    return { projectId: scope.projectId, workId: scope.workId }
  })
  await page.evaluate(async ids => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useWorldviewStore } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    const store = useWorldviewStore.getState()
    await store.loadAll(ids.projectId)
    await store.saveWorldview({ projectId: ids.projectId, worldStructure: '原生自然正文', races: '原生人文正文', powerHierarchy: '原生力量正文', naturalResources: { rareCreatures: '原生异兽正文' } })
    await store.savePowerSystem({ projectId: ids.projectId, description: '原生规则描述', levels: '原生规则等级', rules: '原生规则约束' })
    const { useCultivationStore } = await load<typeof import('../../src/stores/cultivation')>('/storyforge/src/stores/cultivation.ts')
    await useCultivationStore.getState().addSystem({ projectId: ids.projectId, name: '测试修炼', description: '原生修炼描述', stages: JSON.stringify([{ id: 'fixed-stage', name: '测试起境', features: '原生境界特征', breakthrough: '原生突破条件', parentStageIds: [] }]) })
  }, ids)
  for (const [module, text, key] of [
    ['worldview-natural', '原生自然正文', 'world.structure/current'],
    ['worldview-humanity', '原生人文正文', 'world.races/current'],
    ['worldview-origin&originField=power', '原生力量正文', 'world.power/current'],
    ['worldview-origin&originField=power', '原生规则描述', 'power.description/current'],
    ['worldview-origin&originField=power', '原生规则等级', 'power.levels/current'],
    ['worldview-origin&originField=power', '原生规则约束', 'power.rules/current'],
    ['worldview-origin&originField=power', '原生修炼描述', 'cultivation.description/current'],
  ]) {
    await page.goto(`./workspace/${ids.projectId}?module=${module}`)
    if (module === 'worldview-humanity') await page.getByRole('button', { name: /种族与民族/ }).click()
    await page.getByText(text, { exact: true }).click()
    const before = await snapshot(page), frame = await nudge(page, key)
    await frame.getByRole('button', { name: '恢复自适应', exact: true }).click()
    await noAreaOverflow(page)
    expect(await snapshot(page)).toBe(before)
    await expect(frame.locator('textarea')).toHaveValue(text)
  }
  await page.locator('h2:visible').first().click()
  await page.getByText('测试起境', { exact: true }).click()
  for (const [text, key] of [['原生境界特征', 'power.stageFeatures/current'], ['原生突破条件', 'power.breakthrough/current']]) {
    await page.getByText(text, { exact: true }).click()
    const before = await snapshot(page), frame = await nudge(page, key)
    await frame.getByRole('button', { name: '恢复自适应', exact: true }).click()
    expect(await snapshot(page)).toBe(before)
    await page.locator('h2:visible').first().click()
  }
})

for (const operation of ['rewrite', 'expand', 'polish'] as const) {
  test(`047 native ${operation} review retains original refs/scroll, selection and candidate through layout`, async ({ page }) => {
    const seed = await page.evaluate(async operation => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      return (await load<{ seedInputAreaCandidate: (operation: string) => Promise<{ scope: { projectId: number }; runId: number; eventId: number }> }>('/storyforge/tests/helpers/input-area-candidate.ts')).seedInputAreaCandidate(operation)
    }, operation)
    await page.goto(`./workspace/${seed.scope.projectId}?module=worldview-origin&originField=origin`)
    const right = page.locator('[data-input-area-layout="world.origin/candidate"]')
    await expect(right).toBeVisible()
    if (operation === 'rewrite') await page.getByText('查看重写前原文', { exact: true }).click()
    const left = page.locator('[data-input-area-layout="world.origin/original"]')
    if (operation !== 'rewrite') {
      await expect(left).toBeVisible()
      expect(await left.locator('textarea').getAttribute('readonly')).not.toBeNull()
    } else {
      await expect(left).toHaveCount(0) // The existing rewrite branch uses a pre, not a new input.
      await expect(page.locator('details[open] pre')).toContainText('盐约生效后才开放城门。')
    }
    const before = await snapshot(page), original = operation === 'rewrite' ? '' : await left.locator('textarea').inputValue(), candidate = await right.locator('textarea').inputValue()
    await right.locator('textarea').evaluate(area => { const input = area as HTMLTextAreaElement; input.focus(); input.setSelectionRange(2, 5); Object.assign(window, { inputAreaCandidateNode: input }) })
    await nudge(page, 'world.origin/candidate')
    expect(await right.locator('textarea').evaluate(area => { const input = area as HTMLTextAreaElement; return input === Reflect.get(window, 'inputAreaCandidateNode') && input.selectionStart === 2 && input.selectionEnd === 5 })).toBe(true)
    if (operation !== 'rewrite') {
      await nudge(page, 'world.origin/original', 'ArrowLeft')
      for (const frame of [left, right]) {
        const handle = frame.getByRole('button', { name: '调整输入区大小', exact: true })
        for (let step = 0; step < 12; step++) await handle.press('ArrowUp')
      }
      await left.locator('textarea').evaluate(area => { area.scrollTop = (area.scrollHeight - area.clientHeight) / 2; area.dispatchEvent(new Event('scroll')) })
      await expect.poll(() => right.locator('textarea').evaluate(area => area.scrollTop / Math.max(1, area.scrollHeight - area.clientHeight))).toBeGreaterThan(0.4)
    }
    if (operation !== 'rewrite') await expect(left.locator('textarea')).toHaveValue(original)
    await expect(right.locator('textarea')).toHaveValue(candidate)
    expect(await snapshot(page)).toBe(before)
    await right.getByRole('button', { name: '恢复自适应', exact: true }).click()
    if (operation !== 'rewrite') await left.getByRole('button', { name: '恢复自适应', exact: true }).click()
    await page.reload()
    await expect(right.locator('textarea')).toHaveValue(candidate)
    expect(await snapshot(page)).toBe(before)
  })
}

test('047 native window return keeps composition draft on the real external-blur save path', async ({ page }) => {
  const ids = await seed(page)
  await page.goto(`./workspace/${ids.projectId}?module=story-design`)
  await page.getByText(/^点击填写.*…$/).first().click()
  const frame = page.locator('[data-input-area-layout="story.logline/current"]')
  const area = frame.locator('textarea'), draft = '窗口返回后完成组合的作者草稿。'
  await area.dispatchEvent('compositionstart', { bubbles: true })
  await area.fill(draft)
  const before = await snapshot(page)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  expect(await snapshot(page)).toBe(before)
  await expect(area).toHaveValue(draft)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await area.dispatchEvent('compositionend', { bubbles: true })
  await page.locator('h2:visible').first().click()
  await expect.poll(() => page.evaluate(async projectId => {
    const load = new Function('path', 'return import(path)')
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    return (await db.storyCores.where('projectId').equals(projectId).first())?.logline
  }, ids.projectId)).toBe(draft)
  await page.reload()
  await expect(page.getByText(draft, { exact: true })).toBeVisible()
})

test('047 native corrupted candidate remains blocked by its hash guard without a layout bypass', async ({ page }) => {
  const ids = await seed(page)
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const event = (await db.agentEvents.toArray()).find(event => event.kind === 'candidate')
    if (!event?.id) throw new Error('Expected native candidate cache to fault-inject')
    await db.agentEvents.update(event.id, { content: '历史候选结构损坏，仅供恢复测试' })
  })
  await page.goto(`./workspace/${ids.projectId}?module=worldview-origin&originField=origin`)
  await expect(page.locator('p:visible').filter({ hasText: /candidateHash 校验失败/ }).first()).toBeVisible()
  const before = await snapshot(page)
  await expect(page.locator('[data-input-area-layout]')).toHaveCount(0)
  expect(await snapshot(page)).toBe(before)
})

test('047 native StoryCore raw toggle preserves the governed candidate and has a separate layout key', async ({ page }) => {
  const seed = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    return (await load<{ seedInputAreaStoryCandidate: () => Promise<{ scope: { projectId: number } }> }>('/storyforge/tests/helpers/input-area-candidate.ts')).seedInputAreaStoryCandidate()
  })
  await page.goto(`./workspace/${seed.scope.projectId}?module=story-design`)
  const candidate = page.locator('[data-input-area-layout="story.logline/candidate"]')
  await expect(candidate).toBeVisible()
  const before = await snapshot(page), text = await candidate.locator('textarea').inputValue()
  await nudge(page, 'story.logline/candidate')
  await page.getByRole('button', { name: '查看原始结构', exact: true }).click()
  const raw = page.locator('[data-input-area-layout="story.logline/raw"]')
  expect(JSON.parse(await raw.locator('textarea').inputValue())).toEqual({ field: 'logline', value: text })
  await nudge(page, 'story.logline/raw')
  await raw.getByRole('button', { name: '恢复自适应', exact: true }).click()
  expect(await snapshot(page)).toBe(before)
  await page.getByRole('button', { name: '返回内容编辑', exact: true }).click()
  await expect(candidate.locator('textarea')).toHaveValue(text)
  await page.reload()
  await expect(candidate.locator('textarea')).toHaveValue(text)
  expect(await snapshot(page)).toBe(before)
})

test('047 native failed StoryCore save retains draft through resize and navigation barrier until retry', async ({ page }) => {
  const ids = await seed(page)
  await page.goto(`./workspace/${ids.projectId}?module=story-design`)
  // Inject an explicit save failure on the mounted app, retaining its real retry path.
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useWorldviewStore } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    const save = useWorldviewStore.getState().saveStoryCore
    let fail = true
    useWorldviewStore.setState({ saveStoryCore: (...args: Parameters<typeof save>) => fail ? Promise.reject(new Error('047 隔离保存失败')) : save(...args) })
    Object.assign(window, { releaseStorySave: () => { fail = false } })
  })
  await page.getByText(/^点击填写.*…$/).first().click()
  const frame = page.locator('[data-input-area-layout="story.logline/current"]'), area = frame.locator('textarea')
  await area.fill('保存失败仍保留的作者正文。')
  await nudge(page, 'story.logline/current')
  await page.locator('h2:visible').first().click()
  await expect(page.getByRole('alert').filter({ hasText: '047 隔离保存失败' })).toBeVisible()
  await expect(area).toHaveValue('保存失败仍保留的作者正文。')
  const before = await snapshot(page)
  await nudge(page, 'story.logline/current')
  await frame.getByRole('button', { name: '恢复自适应', exact: true }).click()
  expect(await snapshot(page)).toBe(before)
  await page.getByRole('button', { name: '作品概况', exact: true }).click()
  await expect(page).toHaveURL(/module=story-design/)
  await expect(area).toHaveValue('保存失败仍保留的作者正文。')
  await page.evaluate(() => (window as unknown as { releaseStorySave: () => void }).releaseStorySave())
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await expect(area).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('保存失败仍保留的作者正文。', { exact: true })).toBeVisible()
})
