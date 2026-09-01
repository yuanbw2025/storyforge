import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { publishCurrentWorldRelease } from './helpers/world-release'

type BrowserMeasurement = {
  browserName: string
  browserVersion: string
  platform: string
  viewport: { width: number; height: number }
  packageHash: string
  previewHash: string
  firstInteractiveBytes: number
  cachedSceneLatenciesMs: number[]
  choiceInputLatenciesMs: number[]
  memorySamples: Array<{ elapsedMs: number; usedHeapBytes: number }>
  measuredAt: number
}

const mode = process.env.GAMEPROD_PERF_MODE === 'commercial' ? 'commercial' : 'smoke'
const commercialQuality = mode === 'commercial' || process.env.GAMEPROD_PERF_QUALITY === 'commercial'
const commercialDurationMs = 30 * 60 * 1000
const smokeDurationMs = 5_000
const configuredWarmupTransitions = Number(process.env.GAMEPROD_PERF_WARMUP_TRANSITIONS ?? 20)
const warmupTransitions = Number.isInteger(configuredWarmupTransitions)
  && configuredWarmupTransitions >= 20 && configuredWarmupTransitions <= 2_000
  ? configuredWarmupTransitions : 20

function productionOutputs(system: string) {
  const worldHash = system.match(/world:[a-f0-9]{64}/)?.[0] ?? `world:${'a'.repeat(64)}`
  if (system.includes('任务=content.design。')) return {
    schema: 'storyforge.game-design-artifact', version: 1, title: '性能验收循环',
    logline: '玩家在同一缓存场景中持续调查，并可随时作出结局选择。',
    playerGoal: '调查潮门信号并观察选择响应。', coreLoop: ['阅读场景', '作出选择', '观察后果'],
    sourceAnchors: [worldHash], invariants: ['不改写冻结世界事实'], tone: ['清晰', '克制'],
    targetPlayMinutes: 20, targetEndingCount: 2,
  }
  if (system.includes('任务=content.narrative。')) return {
    schema: 'storyforge.game-narrative-artifact', version: 1, moduleKind: 'main', moduleTitle: '潮门性能路线',
    entryNodeKey: 'opening',
    nodes: [
      { key: 'opening', kind: 'entry', title: '潮门之前', summary: '首次进入调查路线。', condition: {}, effects: [] },
      { key: 'cached-loop', kind: 'scene', title: '信号回廊', summary: '可重复进入的缓存场景。', condition: {}, effects: [] },
      { key: 'truth-ending', kind: 'ending', title: '公开记录', summary: '记录被公开。', condition: {}, effects: [] },
      { key: 'shelter-ending', kind: 'ending', title: '封存记录', summary: '记录被封存。', condition: {}, effects: [] },
    ],
    beats: [
      { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '潮门信号第一次亮起。', order: 0 },
      { beatKey: 'beat.loop', nodeKey: 'cached-loop', kind: 'narration', speakerKey: null, text: '同一段回廊再次响应你的选择。', order: 0 },
      { beatKey: 'beat.truth', nodeKey: 'truth-ending', kind: 'narration', speakerKey: null, text: '全部记录被投向海面。', order: 0 },
      { beatKey: 'beat.shelter', nodeKey: 'shelter-ending', kind: 'narration', speakerKey: null, text: '记录留在潮门之后。', order: 0 },
    ],
    choices: [
      { choiceKey: 'choice.enter-loop', sourceNodeKey: 'opening', text: '进入信号回廊', description: '开始缓存场景测量', unavailableReason: '', targetNodeKey: 'cached-loop', displayCondition: {}, availableCondition: {}, effects: [], tags: ['performance'], order: 0 },
      { choiceKey: 'choice.repeat-loop', sourceNodeKey: 'cached-loop', text: '继续检查信号', description: '重复进入同一缓存场景', unavailableReason: '', targetNodeKey: 'cached-loop', displayCondition: {}, availableCondition: {}, effects: [], tags: ['performance'], order: 0 },
      { choiceKey: 'choice.truth', sourceNodeKey: 'cached-loop', text: '公开记录', description: '结束路线', unavailableReason: '', targetNodeKey: 'truth-ending', displayCondition: {}, availableCondition: {}, effects: [], tags: ['ending'], order: 1 },
      { choiceKey: 'choice.shelter', sourceNodeKey: 'cached-loop', text: '封存记录', description: '结束路线', unavailableReason: '', targetNodeKey: 'shelter-ending', displayCondition: {}, availableCondition: {}, effects: [], tags: ['ending'], order: 2 },
    ],
  }
  if (system.includes('任务=content.product-module。')) return {
    schema: 'storyforge.game-product-module-artifact', version: 1, productType: 'storygame',
    interfaceStyle: '高对比文字舞台。', interactionNotes: ['选择后立即显示新场景。'],
    presentationPolicy: { pacing: 'fast', transitionMs: 0, backgroundStrategy: 'none' },
  }
  if (system.includes('任务=media.requirements。')) return {
    schema: 'storyforge.game-media-requirements-artifact', version: 2, visual: [], audio: [],
  }
  throw new Error(`未识别的生产任务:${system.slice(0, 120)}`)
}

async function createPerformanceBuild(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'performance-e2e')
    localStorage.setItem('storyforge-ai-api-key-remember', 'true')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'agnes', apiKey: 'e2e-existing-global-key', model: 'agnes-2.0-flash',
      baseUrl: 'https://apihub.agnes-ai.com/v1', temperature: 0.7, maxTokens: 0,
    }))
  })
  await page.route('**/chat/completions', async route => {
    const request = route.request()
    const body = request.postDataJSON() as { messages?: Array<{ role?: string; content?: string }> }
    const system = body.messages?.find(message => message.role === 'system')?.content ?? ''
    const output = productionOutputs(system)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: `perf-${Date.now()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000),
        model: 'agnes-2.0-flash', choices: [{ index: 0, finish_reason: 'stop', message: {
          role: 'assistant', content: JSON.stringify(output),
        } }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
      }),
    })
  })

  await page.goto('./')
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /世界引擎.*从零创建/ }).click()
  await page.getByPlaceholder('例如：潮汐之后').fill('浏览器性能隔离世界')
  await page.getByRole('button', { name: '创建世界引擎', exact: true }).click()
  await page.getByRole('button', { name: '主线与支线', exact: true }).click()
  await page.getByTitle('新增主线').click()
  await page.getByRole('button', { name: '添加阶段', exact: true }).click()
  await page.getByRole('button', { name: '添加阶段', exact: true }).click()
  await page.goto('./')
  await page.getByTestId('product-tab-worlds').click()
  const pipeline = await publishCurrentWorldRelease(page, '性能验收来源')
  await pipeline.getByRole('button', { name: '交给文字游戏', exact: true }).click()

  const enableProduction = page.getByRole('button', { name: '为当前项目显式启用', exact: true })
  if (await enableProduction.isVisible().catch(() => false)) await enableProduction.click()

  await expect(page.getByRole('textbox', { name: '游戏标题', exact: true })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('textbox', { name: '游戏标题', exact: true }).fill('浏览器性能验收 Build')
  await page.getByRole('textbox', { name: '玩家身份 / 主角', exact: true }).fill('扮演潮门信号员')
  await page.getByRole('combobox', { name: '游戏规模', exact: true }).selectOption('scene')
  if (commercialQuality) {
    await page.getByRole('combobox', { name: /制作质量/ }).selectOption('commercial-candidate')
  }
  await page.getByRole('textbox', { name: /你想玩的第一幕与核心目标/ }).fill('持续检查潮门信号，测量选择输入和缓存场景切换。')
  await page.getByRole('button', { name: '分析可玩起点', exact: true }).click()
  await page.getByRole('button', { name: '生成严格 Brief', exact: true }).click()
  await page.getByRole('button', { name: '保存 Brief revision', exact: true }).click()
  await expect(page.getByText(/Production 待授权/)).toBeVisible()
  await page.getByRole('button', { name: '作者授权并开始自动制作', exact: true }).click()
  await expect(page.getByRole('button', { name: '试玩未发布 Build', exact: true }))
    .toBeVisible({ timeout: 30_000 })
  if (commercialQuality) {
    await expect(page.getByTestId('game-production-performance-blocker')).toContainText('尚无浏览器性能回执')
    await expect(page.getByTestId('game-production-playthrough-blocker')).toContainText('试玩未发布 Build')
    await expect(page.getByRole('button', { name: '复验并原子发布', exact: true })).toHaveCount(0)
  }
  await page.getByRole('button', { name: '试玩未发布 Build', exact: true }).click()
  await expect(page.getByTestId('storygame-player')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: '潮门之前', exact: true })).toBeVisible()
}

async function revealChoices(page: Page) {
  const choices = page.locator('.storygame-choices')
  for (let attempt = 0; attempt < 4 && !await choices.isVisible().catch(() => false); attempt += 1) {
    const control = page.locator('.storygame-reading-controls button')
    // Fail near the actual fault instead of allowing one detached UI control
    // to consume the entire 35-minute commercial test timeout.
    await expect(control).toBeVisible({ timeout: 5_000 })
    await control.click({ timeout: 5_000 })
  }
  await expect(choices).toBeVisible({ timeout: 5_000 })
}

async function readBuildProbe(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const build = await db.gameBuilds.orderBy('id').last()
    if (!build) throw new Error('性能验收 Build 不存在')
    const artifacts = await db.gameBuildArtifacts.where('buildId').equals(build.id).toArray()
    const blockingMediaBytes = artifacts
      .filter((artifact: { blobObjectId?: number | null; byteSize?: number }) => artifact.blobObjectId != null)
      .reduce((sum: number, artifact: { byteSize?: number }) => sum + Number(artifact.byteSize || 0), 0)
    const packageBytes = new TextEncoder().encode(build.previewManifestJson).byteLength
    return {
      buildId: build.id as number,
      scope: { projectId: build.projectId, worldId: build.worldId, workId: build.workId },
      packageHash: build.packageHash as string,
      previewHash: build.previewHash as string,
      // V3's 12 MiB gate is explicitly the first-interactive game package and
      // blocking media, not the development server's unbundled application
      // modules. Application JS/CSS has its separate bundle-size release gate.
      firstInteractiveBytes: packageBytes + blockingMediaBytes,
    }
  })
}

async function sampleHeap(page: Page): Promise<number> {
  const session = await page.context().newCDPSession(page)
  try {
    // Measure retained page memory, not arbitrary garbage that V8 has not yet
    // collected. A real leak remains reachable and therefore remains visible.
    await session.send('HeapProfiler.collectGarbage')
    await session.send('Performance.enable')
    const result = await session.send('Performance.getMetrics') as { metrics: Array<{ name: string; value: number }> }
    const used = result.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value
    if (!Number.isFinite(used) || Number(used) < 0) throw new Error('Chromium 未返回 JSHeapUsedSize')
    return Number(used)
  } finally {
    await session.detach()
  }
}

async function measureChoiceTransition(page: Page) {
  await revealChoices(page)
  const meta = page.locator('.storygame-scene-meta')
  const before = await meta.textContent()
  const choice = page.locator('.storygame-choices button:not(:disabled)').first()
  const sceneStartedAt = await page.evaluate(() => performance.now())
  const inputLatencyMs = await choice.evaluate(async element => {
    const startedAt = performance.now()
    ;(element as HTMLButtonElement).click()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    return performance.now() - startedAt
  })
  await expect(meta).not.toHaveText(before ?? '', { timeout: 10_000 })
  const sceneLatencyMs = await page.evaluate(startedAt => performance.now() - startedAt, sceneStartedAt)
  return { inputLatencyMs, sceneLatencyMs }
}

async function recordReceipt(page: Page, measurement: BrowserMeasurement) {
  return page.evaluate(async input => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { recordGameBrowserPerformanceMeasurementV1 } = await importer('/storyforge/src/lib/game-production/quality-receipts.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const build = await db.gameBuilds.orderBy('id').last()
    if (!build) throw new Error('性能验收 Build 不存在')
    const verified = await recordGameBrowserPerformanceMeasurementV1({
      scope: { projectId: build.projectId, worldId: build.worldId, workId: build.workId },
      gameBuildId: build.id,
      measurement: input,
    })
    return {
      rowId: verified.row.id,
      status: verified.gateReceipt.status,
      gateReceiptHash: verified.gateReceipt.receiptHash,
      browserReceipt: verified.evidence.receipt,
    }
  }, measurement)
}

async function attachReceipt(testInfo: TestInfo, receipt: unknown) {
  await testInfo.attach('game-browser-performance-receipt.json', {
    body: Buffer.from(JSON.stringify(receipt, null, 2)), contentType: 'application/json',
  })
}

test('真实浏览器采样写入 Build 回执；smoke 不冒充商业通过', async ({ page, browserName }, testInfo) => {
  const durationMs = mode === 'commercial' ? commercialDurationMs : smokeDurationMs
  // The default smoke still has a two-minute ceiling. Explicit stress runs
  // execute hundreds or thousands of real reader transitions, so their test
  // budget must scale with the requested sample count instead of cutting off a
  // healthy run before it can persist the immutable performance receipt.
  const smokeTimeoutMs = Math.max(120_000, 60_000 + warmupTransitions * 500)
  test.setTimeout(mode === 'commercial' ? commercialDurationMs + 5 * 60 * 1000 : smokeTimeoutMs)
  await createPerformanceBuild(page)
  await revealChoices(page)
  const probe = await readBuildProbe(page)
  const browserVersion = await page.evaluate(() => navigator.userAgent)
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
  const measurement: BrowserMeasurement = {
    browserName, browserVersion, platform: await page.evaluate(() => navigator.platform || 'desktop'),
    viewport, packageHash: probe.packageHash, previewHash: probe.previewHash,
    firstInteractiveBytes: probe.firstInteractiveBytes,
    cachedSceneLatenciesMs: [], choiceInputLatenciesMs: [], memorySamples: [], measuredAt: Date.now(),
  }

  for (let index = 0; index < warmupTransitions; index += 1) {
    const sample = await measureChoiceTransition(page)
    measurement.choiceInputLatenciesMs.push(sample.inputLatencyMs)
    measurement.cachedSceneLatenciesMs.push(sample.sceneLatencyMs)
  }

  const longRunStartedAt = Date.now()
  const memoryIntervalMs = mode === 'commercial' ? 30_000 : 1_000
  let nextMemoryAt = 0
  while (Date.now() - longRunStartedAt < durationMs) {
    const elapsedMs = Date.now() - longRunStartedAt
    if (elapsedMs >= nextMemoryAt) {
      measurement.memorySamples.push({ elapsedMs, usedHeapBytes: await sampleHeap(page) })
      nextMemoryAt += memoryIntervalMs
    }
    const sample = await measureChoiceTransition(page)
    measurement.choiceInputLatenciesMs.push(sample.inputLatencyMs)
    measurement.cachedSceneLatenciesMs.push(sample.sceneLatencyMs)
    await page.waitForTimeout(mode === 'commercial' ? 5_000 : 100)
  }
  measurement.memorySamples.push({
    elapsedMs: Date.now() - longRunStartedAt,
    usedHeapBytes: await sampleHeap(page),
  })
  measurement.measuredAt = Date.now()

  if (commercialQuality) {
    await revealChoices(page)
    await page.locator('.storygame-choices button').filter({ hasText: '公开记录' }).click()
    await expect(page.getByRole('heading', { name: '公开记录', exact: true })).toBeVisible()
  }

  const recorded = await recordReceipt(page, measurement)
  await attachReceipt(testInfo, recorded)
  console.log(`[GAMEPROD-PERF] ${JSON.stringify({
    mode, status: recorded.status, receiptHash: recorded.gateReceiptHash,
    metrics: recorded.browserReceipt.metrics, failures: recorded.browserReceipt.failures,
  })}`)
  expect(recorded.gateReceiptHash).toMatch(/^[a-f0-9]{64}$/)
  expect(recorded.browserReceipt.metrics.sceneSamples).toBeGreaterThanOrEqual(20)
  expect(recorded.browserReceipt.metrics.inputSamples).toBeGreaterThanOrEqual(20)
  expect(recorded.browserReceipt.metrics.peakUsedHeapBytes).toBeGreaterThan(0)
  if (mode === 'commercial') {
    expect(recorded.status, JSON.stringify(recorded.browserReceipt, null, 2)).toBe('passed')
    expect(recorded.browserReceipt.failures).toEqual([])
  } else {
    expect(recorded.status).toBe('failed')
    expect(recorded.browserReceipt.failures).toContain('long-run-incomplete')
  }

  // Return through the actual Product Hub navigation. The author must be able
  // to inspect the exact immutable receipt that was just recorded, rather than
  // relying on test attachments or a hidden database row.
  if (!await page.getByRole('button', { name: '制作', exact: true }).isVisible().catch(() => false)) {
    await page.getByRole('navigation', { name: '产品页签' })
      .getByRole('button', { name: '文字游戏', exact: true }).click()
  }
  await page.getByRole('button', { name: '制作', exact: true }).click()
  const receiptPanel = page.getByTestId('game-production-performance-receipt')
  await expect(receiptPanel).toBeVisible()
  await expect(receiptPanel).toContainText(
    mode === 'commercial' ? '真实浏览器性能已通过' : '最新浏览器测量未通过',
  )
  await expect(receiptPanel).toContainText(recorded.gateReceiptHash.slice(0, 8))
  if (mode === 'smoke') {
    await expect(receiptPanel).toContainText('long-run-incomplete')
  }
  if (commercialQuality) {
    const playthroughBlocker = page.getByTestId('game-production-playthrough-blocker')
    await expect(playthroughBlocker).toContainText('已到达结局 truth-ending')
    await playthroughBlocker.getByRole('button', { name: '确认本次主路线试玩并冻结回执', exact: true }).click()
    const playthroughReceipt = page.getByTestId('game-production-playthrough-receipt')
    await expect(playthroughReceipt).toContainText('结局 truth-ending')
    await expect(playthroughReceipt).toContainText(/· \d+ 次选择/)
    await expect(page.getByTestId('game-production-playthrough-blocker')).toHaveCount(0)
  }
  if (mode === 'commercial') {
    await expect(page.getByText('#1 · 可发布', { exact: true })).toBeVisible()
    await expect(page.getByTestId('game-production-performance-blocker')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '复验并原子发布', exact: true })).toBeEnabled()
  } else if (commercialQuality) {
    await expect(page.getByText('#1 · 可预览', { exact: true })).toBeVisible()
    await expect(page.getByTestId('game-production-performance-blocker')).toContainText('long-run-incomplete')
    await expect(page.getByRole('button', { name: '复验并原子发布', exact: true })).toHaveCount(0)
  }
})
