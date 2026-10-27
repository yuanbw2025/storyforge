import { expect, test } from '@playwright/test'
test.setTimeout(180000)
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires isolated open preview'))
/** Native IndexedDB and normal controls. Initial three outputs are explicit
 * internal fixtures. No provider transport is permitted during author repair. */
for (const legacyNoDispatch of [false, true]) {
test(legacyNoDispatch ? 'explicitly books proven legacy unsent failures, stays paused, then repairs publishes and restores the full backup' : 'pauses a real downstream parser failure, revises the original situation, publishes and restores a colliding backup without inference', async ({ page }, info) => {
  const transport: string[] = []
  await page.route('**/local-codex/v1/**', async route => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'GET' && url.pathname.endsWith('/status')) return route.fulfill({ json: { state: 'ready' } })
    transport.push(route.request().method() + ' ' + url.pathname)
    await route.abort('blockedbyclient')
    throw Error('Unexpected inference transport during zero-model author repair')
  })
  await page.goto('./')
  const f = await page.evaluate(async legacyNoDispatch => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const f = await (await load('/storyforge/tests/helpers/open-ttrpg-content-revision.ts')).openContentRevisionFixtureV1({ pause: false, legacyNoDispatch })
    const p = await db.projects.get(f.scope.projectId)
    await (await load('/storyforge/src/lib/workspace/works.ts')).updateWorkspace(f.scope.projectId, { productPlatformOptIns: { ...p.productPlatformOptIns, productProductionV3: true } })
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'codex', model: 'fixture-zero-model-repair', apiKey: '', contextWindow: 131072, maxTokens: 24000 })
    const build = await db.productBuilds.get(f.buildId)
    return { scope: f.scope, productionId: f.productionId, buildId: f.buildId, internalFixtureCalls: f.calls,
      build, artifacts: await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray(),
      raw: await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray(), worlds: await db.worldReleases.toArray() }
  }, legacyNoDispatch)
  expect(f.internalFixtureCalls).toHaveLength(3)
  expect(JSON.parse(f.build.failureJson)).toMatchObject({ taskKey: 'ttrpg.open.media-plan', code: 'task-executor-failed' })
  expect(f.build.failureJson).toContain('表情基线')
  await page.goto(`./ttrpg/production?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`)
  await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled({ timeout: 30000 })
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  const panel = page.getByTestId('ttrpg-open-content-revision')
  await expect(panel).toBeVisible({ timeout: 30000 })
  await expect(panel.getByRole('button', { name: '载入已采用原稿', exact: true })).toBeEnabled()
  await panel.getByRole('button', { name: '载入已采用原稿', exact: true }).click()
  if (legacyNoDispatch) {
    await expect(panel.getByRole('button', { name: '新增表情基线', exact: true })).toBeDisabled()
    await panel.getByRole('button', { name: '核对旧失败记录', exact: true }).click()
    await expect(panel.getByRole('button', { name: '确认关闭未发送记录', exact: true })).toBeEnabled()
    await expect(panel).toContainText('发送前预检失败'); await expect(panel).toContainText('本地素材校验失败')
    expect(transport).toEqual([])
    await page.screenshot({ path: info.outputPath('ttrpg-legacy-no-dispatch-preview.png'), fullPage: true })
    await panel.getByRole('button', { name: '确认关闭未发送记录', exact: true }).click()
    await expect(page.getByText('已关闭证据确认未发送的旧记录，原始凭据与暂停状态保留。请重新载入原稿，再明确返修。', { exact: true })).toBeVisible()
    const paused = await page.evaluate(async f => {
      const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
      return { production: await db.productProductions.get(f.productionId), build: await db.productBuilds.get(f.buildId) }
    }, f)
    expect(paused.production.status).toBe('paused'); expect(paused.build.status).toBe('paused')
    expect(paused.production.controlEpoch).toBe(f.build.controlEpoch + 1)
    await expect(panel.getByRole('button', { name: '载入已采用原稿', exact: true })).toBeEnabled()
    await panel.getByRole('button', { name: '载入已采用原稿', exact: true }).click()
    await expect(panel.getByRole('button', { name: '核对旧失败记录', exact: true })).toHaveCount(0)
  }
  await expect(panel.getByRole('button', { name: '新增表情基线', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: '新增表情基线', exact: true }).click()
  const actor = JSON.parse(f.artifacts.filter((row: any) => row.artifactKey === 'ttrpg.open.situation-layer' && ['accepted', 'carried-forward'].includes(row.status))
    .sort((a: any, b: any) => b.version - a.version)[0].payloadJson).metadata.visualBible.characters[0].characterKey
  await panel.getByRole('textbox', { name: `${actor} 表情 1 描述`, exact: true }).fill('平静注视前方，保留原角色身份与装束')
  await panel.getByRole('textbox', { name: '返修说明', exact: true }).fill('作者补齐缺失表情基线，保持局势、私域策略与原权利记录')
  await panel.getByRole('button', { name: '核对返修与影响', exact: true }).click()
  await expect(panel.getByRole('button', { name: '提交返修并继续制作', exact: true })).toBeEnabled()
  await expect(panel).toContainText('后续 0 个模型岗位')
  await page.screenshot({ path: info.outputPath('ttrpg-content-revision-impact.png'), fullPage: true })
  expect(transport).toEqual([])
  await panel.getByRole('button', { name: '提交返修并继续制作', exact: true }).click()
  await expect(page.getByRole('button', { name: '复验并原子发布', exact: true })).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: '复验并原子发布', exact: true }).click()
  await expect(page).toHaveURL(/\/ttrpg\/play/, { timeout: 30000 })
  const result = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const build = await db.productBuilds.get(f.buildId), production = await db.productProductions.get(f.productionId)
    const artifacts = await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray()
    const raw = await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()
    const worldRows = await db.worldReleases.toArray(), { exportProjectJSON, importProjectJSON } = await load('/storyforge/src/lib/export/json-export.ts')
    const exported = await exportProjectJSON(f.scope.projectId), copiedProject = await importProjectJSON(exported)
    const copied = (await db.productProductions.where('projectId').equals(copiedProject).toArray()).find((row: any) => row.productionKey === production.productionKey)
    const copiedBuild = await db.productBuilds.where('[productionId+buildNumber]').equals([copied.id, build.buildNumber]).first()
    const recovery = await (await load('/storyforge/src/lib/product-production/service.ts')).recoverImportedProductProductionProofsV1({
      scope: { projectId: copiedProject, worldId: copied.worldId, workId: copied.workId }, productionId: copied.id })
    const accounting = (await db.productProductionCommands.where('productionId').equals(f.productionId).toArray()).filter((row: any) => row.type === 'book-local-no-dispatch')
    const revisions = (await db.productProductionCommands.where('productionId').equals(f.productionId).toArray()).filter((row: any) => row.type === 'resume' && JSON.parse(row.resultJson).revisionAuthorization?.ttrpgContentRevision)
    const copiedRevisions = (await db.productProductionCommands.where('productionId').equals(copied.id).toArray()).filter((row: any) => row.type === 'resume' && JSON.parse(row.resultJson).revisionAuthorization?.ttrpgContentRevision)
    const copiedAccounting = (await db.productProductionCommands.where('productionId').equals(copied.id).toArray()).filter((row: any) => row.type === 'book-local-no-dispatch')
    return { build, production, artifacts, raw, worlds: worldRows, copiedProject, copiedBuild, recovery, accounting, copiedAccounting, revisions, copiedRevisions,
      originalAfterImport: await db.productBuilds.get(f.buildId) }
  }, f)
  expect(result.build.status).toBe('released'); expect(result.originalAfterImport).toEqual(result.build)
  expect(result.copiedProject).not.toBe(f.scope.projectId); expect(result.copiedBuild.id).not.toBe(f.buildId); expect(result.recovery.terminal).toBe(true)
  const oldAttempts = JSON.parse(f.build.budgetLedgerJson).attempts, finalAttempts = JSON.parse(result.build.budgetLedgerJson).attempts
  for (let i = 0; i < oldAttempts.length; i++) {
    const old = oldAttempts[i]
    if (legacyNoDispatch && !old.usageKnown && old.usage === null) {
      expect(finalAttempts[i]).toMatchObject({ ...old, usageKnown: true, resolution: 'system-released-before-dispatch',
        usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0, costUsd: 0, storageBytes: 0 } })
    } else expect(finalAttempts[i]).toEqual(old)
  }
  expect(result.revisions).toHaveLength(1)
  expect(JSON.parse(result.revisions[0].resultJson).revisionAuthorization.ttrpgContentRevision.expectedImpactHash).toMatch(/^[0-9a-f]{64}$/)
  expect(result.copiedRevisions[0].resultJson).toBe(result.revisions[0].resultJson)
  expect(result.accounting).toHaveLength(legacyNoDispatch ? 1 : 0)
  if (legacyNoDispatch) {
    const receipt = JSON.parse(result.accounting[0].resultJson)
    expect(receipt.accounting.entries).toHaveLength(2)
    expect(receipt.accounting.entries.every((row: any) => row.original.usage === null && row.original.usageKnown === false)).toBe(true)
    expect(receipt.newModelCalls).toBe(0); expect(receipt.adopted).toBe(false)
    expect(result.copiedAccounting[0].resultJson).toBe(result.accounting[0].resultJson)
  }
  for (const old of f.artifacts.filter((row: any) => ['accepted', 'carried-forward'].includes(row.status))) {
    const retained = result.artifacts.find((row: any) => row.id === old.id)
    expect(retained).toEqual({ ...old, status: 'invalid', updatedAt: retained.updatedAt })
  }
  for (const old of f.raw) expect(result.raw.find((row: any) => row.id === old.id)).toEqual(old)
  expect(result.worlds).toEqual(f.worlds); expect(transport).toEqual([])
  await info.attach('native-ttrpg-content-revision-evidence', { contentType: 'application/json',
    body: JSON.stringify({ legacyNoDispatch, f, result, transport, realProvider: false, independentHumanAcceptance: false }) })
})
}
