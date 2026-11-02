import { expect, test, type BrowserContext, type Page } from '@playwright/test'

test.use({ serviceWorkers: 'block' })
const blockedNetwork = new WeakMap<BrowserContext, Array<{ method: string; origin: string; pathname: string }>>()
test.beforeEach(async ({ context }, info) => {
  const baseURL = info.project.use.baseURL
  if (!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) {
    throw new Error('005 browser controls require an isolated loopback app')
  }
  const appOrigin = new URL(baseURL).origin
  const blocked: Array<{ method: string; origin: string; pathname: string }> = []
  blockedNetwork.set(context, blocked)
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    // No credentials, author profile or real provider: only this disposable
    // loopback app may be read. Every HTTP write is refused before transport.
    if (url.origin !== appOrigin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.push({ method: request.method(), origin: url.origin, pathname: url.pathname })
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
})
test.afterEach(async ({ context }, info) => {
  const blocked = blockedNetwork.get(context) ?? []
  await info.attach('quality005-network-boundary', { body: JSON.stringify({ blocked, realModelCalls: 0,
    actualExternalHTTPRequests: 0, profile: 'new ephemeral Playwright context' }), contentType: 'application/json' })
  expect(blocked.filter(request => !['GET', 'HEAD', 'OPTIONS'].includes(request.method)))
    .toEqual([])
})

interface ProtectedTableCounts {
  worldReleases: number
  productions: number
  briefs: number
  commands: number
  builds: number
  artifacts: number
  qualityReceipts: number
  releases: number
  runtimeSessions: number
  runtimeEvents: number
  runtimeCheckpoints: number
}

async function openProductHub(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-open-world-creator-source-e2e')
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: '首页', exact: true }))
    .toBeVisible({ timeout: 20_000 })
}

async function readProtectedTableCounts(page: Page): Promise<ProtectedTableCounts> {
  return page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const [
      worldReleases,
      productions,
      briefs,
      commands,
      builds,
      artifacts,
      qualityReceipts,
      releases,
      runtimeSessions,
      runtimeEvents,
      runtimeCheckpoints,
    ] = await Promise.all([
      db.worldReleases.count(),
      db.productProductions.count(),
      db.productProductionBriefs.count(),
      db.productProductionCommands.count(),
      db.productBuilds.count(),
      db.productBuildArtifacts.count(),
      db.productQualityGateReceipts.count(),
      db.productReleases.count(),
      db.productRuntimeSessions.count(),
      db.productRuntimeEvents.count(),
      db.productRuntimeCheckpoints.count(),
    ])
    return {
      worldReleases,
      productions,
      briefs,
      commands,
      builds,
      artifacts,
      qualityReceipts,
      releases,
      runtimeSessions,
      runtimeEvents,
      runtimeCheckpoints,
    }
  })
}

interface CreatorNovelFixtureV1 {
  projectId: number
  chapterId: number
  title: string
  sourceUnitCount: number
  totalWordCount: number
  sourceVersionHash: string
  scope: { projectId: number; worldId: number; workId: number }
  sourceBoundaryHash: string
}

async function seedCreatorNovelFixture(page: Page, input: {
  name: string
  chapterChars: number
  outlineCount: number
}): Promise<CreatorNovelFixtureV1> {
  return page.evaluate(async ({ name, chapterChars, outlineCount }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [
      { db },
      { createWorkspace },
      { stampNewRecord },
      { inspectTextOpenWorldCreatorNovelSourceV1 },
    ] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/src/lib/workspace/create-workspace.ts'),
      importer('/storyforge/src/lib/workspace/scope.ts'),
      importer('/storyforge/src/lib/open-world/creator-source.ts'),
    ])
    const created = await createWorkspace({
      name,
      genres: ['fantasy'],
      status: 'drafting',
      description: '巡井人沿盐脊追查断流，并把每条线索整理为可冻结的作者来源。',
      targetWordCount: 4_000_000,
      enableMultiWorld: false,
    }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    const now = Date.now()
    const outlineRows = Array.from({ length: outlineCount }, (_, index) => stampNewRecord(
      created.scope,
      'outlineNodes',
      {
        projectId: created.scope.projectId,
        parentId: null,
        type: 'chapter',
        title: `盐脊线索 ${String(index + 1).padStart(3, '0')}`,
        summary: `第 ${index + 1} 条断流线索。`,
        order: index,
        createdAt: now,
        updatedAt: now,
      },
      { owner: 'work' },
    ))
    await db.outlineNodes.bulkAdd(outlineRows)
    const firstOutline = await db.outlineNodes
      .where('projectId').equals(created.scope.projectId)
      .sortBy('order')
      .then((rows: any[]) => rows[0])
    if (!firstOutline?.id) throw new Error('Creator CAS E2E 缺少章节大纲')
    const body = '盐'.repeat(chapterChars)
    const chapterId = await db.chapters.add(stampNewRecord(created.scope, 'chapters', {
      projectId: created.scope.projectId,
      outlineNodeId: firstOutline.id,
      title: '第一章 断流长卷',
      content: `<p>${body}</p>`,
      wordCount: body.length,
      status: 'final',
      order: 0,
      notes: '',
      summary: '巡井人读取完整盐脊长卷。',
      createdAt: now,
      updatedAt: now,
    }, { owner: 'work' })) as number
    const preview = await inspectTextOpenWorldCreatorNovelSourceV1({
      sourceScope: created.scope,
      selection: { mode: 'entire-work' },
    })
    return {
      projectId: created.scope.projectId,
      scope: created.scope,
      chapterId,
      title: created.work.title,
      sourceUnitCount: preview.sourceUnitCount,
      totalWordCount: preview.totalWordCount,
      sourceVersionHash: preview.sourceVersionHash,
      sourceBoundaryHash: preview.sourceBoundaryHash,
    }
  }, input)
}

async function openNovelDraft(page: Page, fixture: CreatorNovelFixtureV1) {
  await page.goto(`./openworld/runtime?project=${fixture.projectId}&mode=production`)
  const studio = page.getByTestId('text-open-world-creator-studio')
  await expect(studio).toBeVisible({ timeout: 30_000 })
  await expect(studio.getByRole('tab', { name: '从小说派生世界', exact: true })).toHaveAttribute('aria-selected', 'true')
  const draft = studio.getByTestId('creator-novel-world-draft')
  await expect(draft).toContainText(fixture.title)
  await expect(draft).toContainText('全部已确认语义')
  await expect(draft.getByRole('button', { name: '派生独立世界草稿', exact: true })).toBeDisabled()
  await expect(studio.getByTestId('creator-source-continue')).toBeDisabled()
  await expect(studio.getByTestId('creator-source-continue')).toHaveAttribute('aria-disabled', 'true')
  return draft
}

test('小说只能显式派生独立世界草稿，取消不写入；作者检查封存后才交接到世界版本定向', async ({ page }) => {
  test.setTimeout(120_000)
  await openProductHub(page)
  const fixture = await seedCreatorNovelFixture(page, { name: '005 浏览器小说显式派生', chapterChars: 800, outlineCount: 2 })
  const before = await readProtectedTableCounts(page)
  const sourceBefore = await page.evaluate(async scope => {
    const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [{ db }, { readOwnedRows }] = await Promise.all([
      importer<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      importer<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts'),
    ])
    return { work: await db.works.get(scope.workId), chapters: await readOwnedRows(scope, 'chapters', { owner: 'work' }) }
  }, fixture.scope)
  const draft = await openNovelDraft(page, fixture)
  const acknowledgement = draft.getByRole('checkbox')
  await acknowledgement.check()
  await draft.getByRole('button', { name: '取消派生', exact: true }).click()
  await expect(acknowledgement).not.toBeChecked()
  expect(await readProtectedTableCounts(page)).toEqual(before)
  await acknowledgement.check()
  await draft.getByRole('button', { name: '派生独立世界草稿', exact: true }).click()
  await expect(draft).toContainText('独立世界草稿已创建，尚未封存', { timeout: 30_000 })
  expect(await readProtectedTableCounts(page)).toEqual(before)
  const sourceAfter = await page.evaluate(async scope => {
    const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [{ db }, { readOwnedRows }] = await Promise.all([
      importer<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      importer<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts'),
    ])
    return { work: await db.works.get(scope.workId), chapters: await readOwnedRows(scope, 'chapters', { owner: 'work' }) }
  }, fixture.scope)
  expect(sourceAfter).toEqual(sourceBefore)
  const href = await draft.getByRole('link', { name: '检查并封存这个世界草稿', exact: true }).getAttribute('href')
  const targetId = Number(new URL(href!, page.url()).searchParams.get('project'))
  expect(targetId).toBeGreaterThan(0)
  expect(targetId).not.toBe(fixture.projectId)
  // The author now moves to World ownership and explicitly freezes/seals it.
  await page.goto(`./world/versions?project=${targetId}`)
  const panel = page.getByRole('region', { name: '世界修订、发布与产品交接' })
  await expect(panel).toBeVisible({ timeout: 30_000 })
  await panel.getByRole('button', { name: '冻结修订', exact: true }).click()
  await expect(panel.getByLabel('待发布修订')).not.toHaveValue('')
  await panel.getByRole('button', { name: '发布版本', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '发布世界版本', exact: true }).click()
  await expect(panel.getByLabel('冻结世界版本')).not.toHaveValue('')
  expect(await readProtectedTableCounts(page)).toEqual({ ...before, worldReleases: before.worldReleases + 1 })
  await panel.getByRole('button', { name: '交给文字开放世界', exact: true }).click()
  const studio = page.getByTestId('text-open-world-creator-studio')
  await expect(studio.getByRole('tab', { name: '冻结世界版本', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(studio.getByTestId('creator-world-preview')).toBeVisible({ timeout: 30_000 })
  expect(await readProtectedTableCounts(page)).toEqual({ ...before, worldReleases: before.worldReleases + 1 })
})

test('小说草稿预览后作者改稿，派生拒绝并保留新正文；刷新后须重新确认', async ({ page }) => {
  await openProductHub(page)
  const fixture = await seedCreatorNovelFixture(page, { name: '005 浏览器源漂移', chapterChars: 1000, outlineCount: 1 })
  const draft = await openNovelDraft(page, fixture)
  const before = await readProtectedTableCounts(page)
  const changed = '<p>作者预览后保存的正文必须保留。</p>'
  await page.evaluate(async ({ chapterId, changed }) => {
    const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await importer<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const chapter = await db.chapters.get(chapterId)
    await db.chapters.update(chapterId, { content: changed, updatedAt: Math.max(Date.now(), chapter!.updatedAt + 1) })
  }, { chapterId: fixture.chapterId, changed })
  await draft.getByRole('checkbox').check()
  await draft.getByRole('button', { name: '派生独立世界草稿', exact: true }).click()
  await expect(draft.getByRole('alert')).toContainText('源作品已变化', { timeout: 30_000 })
  await expect(draft.getByRole('checkbox')).not.toBeChecked()
  await expect(draft.getByRole('link', { name: '检查并封存这个世界草稿', exact: true })).toHaveCount(0)
  expect(await readProtectedTableCounts(page)).toEqual(before)
  const currentBody = await page.evaluate(async id => {
    const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await importer<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return (await db.chapters.get(id))?.content
  }, fixture.chapterId)
  expect(currentBody).toBe(changed)
  await draft.getByRole('button', { name: '重新检查当前来源', exact: true }).click()
  await expect(draft.getByRole('button', { name: '派生独立世界草稿', exact: true })).toBeDisabled()
})

test('512 单元约390万字旧小说仍可严格检查，但新的正式会谈拒绝且不创建 Build 或 Run', async ({ page }) => {
  test.setTimeout(300_000)
  await openProductHub(page)
  const fixture = await seedCreatorNovelFixture(page, { name: '005 大来源保留检查边界', chapterChars: 3_900_000, outlineCount: 491 })
  expect(fixture.sourceUnitCount).toBe(512)
  expect(fixture.totalWordCount).toBeGreaterThanOrEqual(3_800_000)
  expect(fixture.totalWordCount).toBeLessThanOrEqual(4_000_000)
  const before = await readProtectedTableCounts(page)
  const result = await page.evaluate(async scope => {
    const importer = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [{ db }, { inspectTextOpenWorldCreatorNovelSourceV1 }, { startTextOpenWorldCreatorBriefSessionV1 }] = await Promise.all([
      importer<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      importer<typeof import('../../src/lib/open-world/creator-source')>('/storyforge/src/lib/open-world/creator-source.ts'),
      importer<typeof import('../../src/lib/open-world/creator-brief')>('/storyforge/src/lib/open-world/creator-brief.ts'),
    ])
    const runsBefore = await db.agentRuns.count(), conversationsBefore = await db.agentConversations.count()
    const preview = await inspectTextOpenWorldCreatorNovelSourceV1({ sourceScope: scope, selection: { mode: 'entire-work' } })
    let error = ''
    try { await startTextOpenWorldCreatorBriefSessionV1({ selection: { sourceKind: 'novel', sourceScope: scope,
      selection: { mode: 'entire-work' }, preview }, sessionKey: '005.large-source-must-not-start' }) }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
    return { error, runsBefore, runsAfter: await db.agentRuns.count(), conversationsBefore, conversationsAfter: await db.agentConversations.count() }
  }, fixture.scope)
  expect(result.error).toMatch(/WorldRelease|派生.*世界/)
  expect(result.runsAfter).toBe(result.runsBefore)
  expect(result.conversationsAfter).toBe(result.conversationsBefore)
  expect(await readProtectedTableCounts(page)).toEqual(before)
})

test('世界引擎 handoff 按用户选择的冻结 Release ID 与完整 Hash 打开同一候选，且保持只读', async ({ page }) => {
  test.setTimeout(120_000)
  await openProductHub(page)

  const seeded = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { seedCurrentProductWorld }, { createWorldRevision, publishWorldRevision }] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'),
      importer('/storyforge/tests/helpers/current-product-world.ts'),
      importer('/storyforge/src/lib/world-engine/releases.ts'),
    ])
    const world = await seedCurrentProductWorld('浏览器世界版本来源')
    const firstRelease = world.release
    const worldview = await db.worldviews.where('projectId').equals(world.scope.projectId).first()
    if (!worldview?.id) throw new Error('世界来源 fixture 缺少世界观记录')
    await db.worldviews.update(worldview.id, {
      worldOrigin: '第二版把潮汐源头改为海底旧城。',
      updatedAt: Date.now() + 1,
    })
    const secondRevision = await createWorldRevision({
      scope: world.scope,
      label: '浏览器世界来源 v2',
      parentRevisionId: world.revision.id,
    })
    const secondRelease = await publishWorldRevision(secondRevision.id)
    return {
      projectId: world.scope.projectId,
      worldName: world.world.name,
      first: {
        id: firstRelease.id,
        version: firstRelease.version,
        label: firstRelease.label,
        hash: firstRelease.contentHash,
      },
      second: {
        id: secondRelease.id,
        version: secondRelease.version,
        label: secondRelease.label,
        hash: secondRelease.contentHash,
      },
    }
  })
  expect(seeded.first.id).not.toBe(seeded.second.id)
  expect(seeded.first.hash).not.toBe(seeded.second.hash)
  const before = await readProtectedTableCounts(page)

  await page.goto(`./world/versions?project=${seeded.projectId}`)
  const releasePanel = page.getByRole('region', { name: '世界修订、发布与产品交接' })
  await expect(releasePanel).toBeVisible({ timeout: 30_000 })
  const releaseSelect = releasePanel.getByLabel('冻结世界版本')
  await expect(releaseSelect).toHaveValue(String(seeded.second.id))
  await releaseSelect.selectOption(String(seeded.first.id))
  await expect(releaseSelect).toHaveValue(String(seeded.first.id))
  await expect(releasePanel.locator('code'))
    .toContainText(seeded.first.hash.slice(0, 16))
  await releasePanel.getByRole('button', { name: '交给文字开放世界', exact: true }).click()

  await expect(page.getByRole('heading', { name: '制作与试玩', exact: true })).toBeVisible()
  const studio = page.getByTestId('text-open-world-creator-studio')
  await expect(studio.getByRole('tab', { name: '冻结世界版本', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  const selectedCandidate = studio.locator('[role="radio"][aria-checked="true"]')
  await expect(selectedCandidate).toHaveCount(1, { timeout: 30_000 })
  await expect(selectedCandidate).toContainText(`Release v${seeded.first.version}`)
  await expect(selectedCandidate).toContainText(seeded.first.label)
  await expect(selectedCandidate).toContainText(seeded.first.hash)

  const preview = studio.getByTestId('creator-world-preview')
  await expect(preview).toBeVisible({ timeout: 30_000 })
  await expect(preview.getByRole('heading', {
    name: `${seeded.worldName} · v${seeded.first.version}`,
    exact: true,
  })).toBeVisible()
  await expect(preview.getByText(seeded.first.hash, { exact: true })).toBeVisible()
  await expect(preview).not.toContainText(seeded.second.hash)
  await expect(preview).toContainText('文字开放世界需求核对')
  await expect(preview).toContainText('世界基础')

  const continueButton = studio.getByTestId('creator-source-continue')
  await expect(continueButton).toBeEnabled()
  await continueButton.click()
  const briefStudio = page.getByTestId('text-open-world-creator-brief-studio')
  await expect(briefStudio).toBeVisible({ timeout: 30_000 })
  await expect(briefStudio.getByText('会谈中', { exact: true })).toBeVisible()
  await expect(briefStudio).toContainText('主 Agent 只理解你的设定与来源摘要')
  expect(await readProtectedTableCounts(page)).toEqual({
    ...before,
    productions: before.productions + 1,
    commands: before.commands + 1,
  })
})
