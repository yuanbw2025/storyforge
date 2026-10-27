import { expect, test } from '@playwright/test'

test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires isolated open preview') })
test.setTimeout(180_000)

/** Normal capture/book/review/publication controls, then actual imported visual-revision services.
 * Native IndexedDB; all model HTTP is intercepted, without an account or author profile. */
test('late original survives author review, publication, colliding import and zero-call visual continuation', async ({ page }, info) => {
  let completed = false
  const requests = new Map<string, { wire: any; hash: string; key: 'sourceFacts' | 'ruleSystem' | 'situationLayer'; output: string }>()
  const calls: Array<{ method: string; path: string; requestId?: string; key?: string }> = []
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (request.method() === 'POST' && !url.pathname.includes('/local-codex/v1/')) {
      await route.abort('blockedbyclient'); throw Error('Unexpected POST in isolated candidate verification: ' + url.pathname)
    }
    await route.fallback()
  })
  await page.route('**/local-codex/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    if (url.pathname.endsWith('/status')) return route.fulfill({ json: { state: 'ready' } })
    if (url.pathname.endsWith('/requests') && method === 'POST') {
      const wire = request.postDataJSON(), system = wire.messages.find((message: any) => message.role === 'system')?.content ?? ''
      const key = system.includes('storyforge.ttrpg-open-source-facts') ? 'sourceFacts'
        : system.includes('storyforge.ttrpg-open-rule-system') ? 'ruleSystem'
          : system.includes('storyforge.ttrpg-open-situation-layer') ? 'situationLayer' : null
      if (!key || requests.size >= 3 || [...requests.values()].some(row => row.key === key)) throw Error('Unexpected or duplicate simulated inference')
      const evidence = await page.evaluate(async requestId => {
        const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
        const artifact = (await db.agentRunArtifacts.toArray()).find((row: any) => row.content?.includes('storyforge.product-production-local-request') && row.content.includes(requestId))
        if (!artifact) throw Error('Original pre-dispatch ownership missing before POST')
        return JSON.parse(artifact.content)
      }, wire.id)
      expect(evidence.messages).toEqual(wire.messages); expect(evidence.request.requestId).toBe(wire.id)
      const record = { wire, hash: evidence.request.requestHash, key, output: JSON.stringify(data[key]) }
      requests.set(wire.id, record); calls.push({ method, path: url.pathname, requestId: wire.id, key })
      return route.fulfill({ json: { id: wire.id, status: 'accepted' } })
    }
    const id = [...requests.keys()].find(id => url.pathname.endsWith('/requests/' + id) || url.pathname.endsWith('/requests/' + id + '/acknowledge'))
    const record = id ? requests.get(id)! : null
    if (!record || !id) throw Error('Unexpected native operation: ' + url.pathname)
    calls.push({ method, path: url.pathname, requestId: id, key: record.key })
    if (method === 'GET') {
      const unknown = record.key === 'sourceFacts' && !completed
      return route.fulfill({ json: { id, model: record.wire.model, createdAt: Date.now(),
        status: unknown ? 'unknown' : 'completed', text: unknown ? '模拟观察中断，完整原回答尚未交接。' : record.output,
        ...(unknown ? {} : { usage: { inputTokens: record.key === 'sourceFacts' ? 101 : 100, outputTokens: record.key === 'sourceFacts' ? 11 : 200 } }),
        dispatched: true, requestHash: record.hash, requestHashAlgorithm: 'sha256-json-request-v1', receiptRetention: 'until-owner-ack-v1' } })
    }
    if (method === 'POST' && url.pathname.endsWith('/acknowledge')) {
      const saved = await page.evaluate(async output => {
        const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
        const { sha256Text } = await load('/storyforge/src/lib/ai/chapter-memory/text-normalization.ts'), hash = await sha256Text(output)
        const raw = (await db.agentRunArtifacts.toArray()).find((row: any) => row.artifactKind === 'raw-response' && row.contentHash === hash && row.content === output)
        const meta = (await db.agentRunArtifacts.toArray()).some((row: any) => row.artifactKind === 'source-snapshot'
          && (row.content?.includes('storyforge.product-production-captured-response') || row.content?.includes('storyforge.product-production-local-response')) && row.content.includes(hash))
        return { raw: !!raw, metadata: meta }
      }, record.output)
      expect(saved).toEqual({ raw: true, metadata: true })
      return route.fulfill({ json: { id, status: 'completed', acknowledged: true, acknowledgedAt: Date.now() } })
    }
    throw Error('Unexpected native operation: ' + method + ' ' + url.pathname)
  })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const { openProductionFixtureV1 } = await load('/storyforge/tests/helpers/open-ttrpg-production.ts')
    const { openProductionCompilerFixtureV1 } = await load('/storyforge/tests/helpers/open-ttrpg-production-artifacts.ts')
    const { executeProductProductionCommand: command } = await load('/storyforge/src/lib/product-production/commands.ts')
    const f = await openProductionFixtureV1(), data = await openProductionCompilerFixtureV1(true, f)
    const previous = await db.productProductions.get(f.productionId)
    const saved = await command({ scope: f.scope, productionId: f.productionId, command: { type: 'save-brief-revision',
      commandId: 'candidate-native.save', expectedStateRevision: previous.stateRevision, parentRevision: previous.currentBriefRevision, brief: f.brief } })
    if (!saved.ok) throw Error('Fixture Brief save failed')
    const production = await db.productProductions.get(f.productionId), row = await db.productProductionBriefs.where('[productionId+revision]').equals([f.productionId, production.currentBriefRevision]).first()
    const started = await command({ scope: f.scope, productionId: f.productionId, command: { type: 'authorize-start', commandId: 'candidate-native.start',
      expectedStateRevision: production.stateRevision, briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'explicit-isolated-native-fixture' } })
    if (!started.ok) throw Error('Fixture start authorization failed')
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'codex', model: 'fixture-native-only', apiKey: '', contextWindow: 131072, maxTokens: 24000 })
    const project = await db.projects.get(f.scope.projectId)
    await (await load('/storyforge/src/lib/workspace/works.ts')).updateWorkspace(f.scope.projectId,
      { productPlatformOptIns: { ...project.productPlatformOptIns, productProductionV3: true } })
    return { scope: f.scope, productionId: f.productionId, brief: f.brief, data, worlds: await db.worldReleases.toArray() }
  })
  const data = f.data
  const original = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const requirementKey = f.brief.capabilityRequirements.find((row: any) => row.mediaClass === 'text').requirementKey
    const resolved = await (await load('/storyforge/src/lib/product-production/capabilities.ts')).resolveConfiguredTextCapabilityV1({ projectId: f.scope.projectId, category: 'product-production', requirementKey })
    const executor = (await load('/storyforge/src/lib/product-production/production-executor.ts')).createConfiguredProductProductionExecutorV1({ production: await db.productProductions.get(f.productionId), brief: f.brief })
    const result = await (await load('/storyforge/src/lib/product-production/scheduler.ts')).runProductProductionUntilBlockedV1({ scope: f.scope, productionId: f.productionId, executor,
      capabilityBindings: [{ requirementKey, adapterId: 'configured-text.v1', bindingHash: resolved.receipt.capabilityHash, provider: resolved.receipt.provider, model: resolved.receipt.model }] })
    const build = await db.productBuilds.get(result.buildId), failure = JSON.parse(build.failureJson)
    const snapshot = await (await load('/storyforge/src/lib/agent/run/event-store.ts')).readAgentRunV1(f.scope, failure.failureProvenance.runId)
    return { buildId: build.id, runId: snapshot.run.id, snapshot, build }
  }, f)
  expect(requests.size).toBe(1); expect(calls.filter(row => row.method === 'GET')).toHaveLength(1)
  expect(original.build.status).toBe('recovery-required')
  await page.goto(`./ttrpg/production?project=${f.scope.projectId}&work=${f.scope.workId}&production=${f.productionId}`)
  const handoff = page.getByTestId('ttrpg-original-response-handoff'), review = page.getByTestId('ttrpg-open-production-review')
  await expect(handoff).toBeVisible({ timeout: 30000 }); await page.reload(); await expect(handoff).toBeVisible()
  expect(requests.size).toBe(1); expect(calls.filter(row => row.method === 'GET')).toHaveLength(1)
  completed = true
  await handoff.getByRole('button', { name: '读取并保留完整原回答', exact: true }).click()
  await expect(handoff.getByRole('button', { name: '核对并记入原用量', exact: true })).toBeEnabled()
  const captured = await page.evaluate(async input => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const copies = (await db.agentRuns.where('productBuildId').equals(input.buildId).toArray()).filter((row: any) => JSON.parse(row.contractJson).scope.productProduction?.taskKey === 'production.original-response-capture')
    return { copies: copies.length, build: await db.productBuilds.get(input.buildId), original: await (await load('/storyforge/src/lib/agent/run/event-store.ts')).readAgentRunV1(input.scope, input.runId) }
  }, { ...original, scope: f.scope })
  expect(captured.copies).toBe(1); expect(captured.build.budgetLedgerJson).toBe(original.build.budgetLedgerJson); expect(captured.original).toEqual(original.snapshot)
  expect(calls.filter(row => row.method === 'GET')).toHaveLength(2); expect(calls.filter(row => row.path.endsWith('/acknowledge'))).toHaveLength(1)
  await handoff.getByRole('button', { name: '核对并记入原用量', exact: true }).click()
  await expect(handoff).toContainText('原用量已核对，尚未提交内容修订。')
  await expect(page.getByTestId('product-production-unknown-result-disposition')).toHaveCount(0)
  expect(requests.size).toBe(1)
  const loadRetained = async () => {
    await handoff.getByRole('button', { name: '读取并保留完整原回答', exact: true }).click()
    await handoff.getByRole('button', { name: '将原回答载入修订稿', exact: true }).click()
    await expect(review.getByRole('checkbox').first()).toBeVisible()
  }
  await page.reload(); await expect(handoff).toBeVisible(); await loadRetained()
  expect(requests.size).toBe(1); expect(calls.filter(row => row.method === 'GET')).toHaveLength(2)
  for (const checkbox of await review.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked()
  await review.getByRole('checkbox').first().check()
  await page.reload(); await expect(handoff).toBeVisible(); await loadRetained()
  for (const checkbox of await review.getByRole('checkbox').all()) { await expect(checkbox).not.toBeChecked(); await checkbox.check() }
  await page.screenshot({ path: info.outputPath('retained-original-booked-author-fact-review.png'), fullPage: true })
  await page.getByRole('button', { name: '修正后继续制作', exact: true }).click()
  await expect(review.getByRole('heading', { name: '核对角色属性', exact: true })).toBeVisible({ timeout: 30000 })
  expect([...requests.values()].map(row => row.key)).toEqual(['sourceFacts', 'ruleSystem'])
  await expect(handoff).toHaveCount(0)
  await review.getByRole('button', { name: '读取本任务待审稿', exact: true }).click()
  await expect(review.getByRole('checkbox').first()).toBeVisible()
  for (const checkbox of await review.getByRole('checkbox').all()) { await expect(checkbox).not.toBeChecked(); await checkbox.check() }
  await page.getByRole('button', { name: '修正后继续制作', exact: true }).click()
  await expect(page.getByRole('button', { name: '复验并原子发布', exact: true })).toBeVisible({ timeout: 30000 })
  expect([...requests.values()].map(row => row.key)).toEqual(['sourceFacts', 'ruleSystem', 'situationLayer'])
  await page.getByRole('button', { name: '复验并原子发布', exact: true }).click()
  await expect(page).toHaveURL(/\/ttrpg\/play/, { timeout: 20000 })
  const published = await page.evaluate(async input => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const build = await db.productBuilds.get(input.buildId), production = await db.productProductions.get(input.productionId)
    const release = await db.productReleases.get(production.currentProductReleaseId)
    const artifacts = (await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()).filter((row: any) => row.controlEpoch === build.controlEpoch && ['accepted', 'carried-forward'].includes(row.status))
    const source = artifacts.find((row: any) => row.artifactKey === 'ttrpg.open.source-facts')
    const producer = await (await load('/storyforge/src/lib/agent/run/event-store.ts')).readAgentRunV1(input.scope, source.producerRunId)
    return { build, release, source, producer, original: await (await load('/storyforge/src/lib/agent/run/event-store.ts')).readAgentRunV1(input.scope, input.runId),
      worlds: await db.worldReleases.toArray(), commands: await db.productProductionCommands.where('productionId').equals(input.productionId).toArray() }
  }, { ...original, scope: f.scope, productionId: f.productionId })
  expect(published.build.status).toBe('released'); expect(published.worlds).toEqual(f.worlds); expect(published.original).toEqual(original.snapshot)
  expect(published.commands.filter((row: any) => row.type === 'book-original-response')).toHaveLength(1)
  expect(JSON.parse(published.source.rightsJson).originalResponseRawHash).toMatch(/^[a-f0-9]{64}$/)
  const ledger = JSON.parse(published.build.budgetLedgerJson), attempt = ledger.attempts.find((row: any) => row.runId === original.runId)
  expect(attempt).toMatchObject({ usageKnown: true, usage: { modelCalls: 1, inputTokens: 101, outputTokens: 11, costUsd: null } })
  expect(ledger.attempts.reduce((sum: number, row: any) => sum + (row.usage?.modelCalls ?? 0), 0)).toBe(3)
  const manifest = JSON.parse(published.release.manifestJson), sourceManifest = manifest.sourceContracts.sourceManifest
  expect(sourceManifest.sourcePlanHash).toBe(manifest.sourceContracts.sourcePlan.planHash)
  for (const step of ['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer']) expect(sourceManifest.runContextManifests.some((row: any) => row.stepId === step)).toBe(true)
  expect(sourceManifest.runContextManifests.some((row: any) => row.stepId === 'ttrpg.open.source-facts'
    && published.producer.events.some((event: any) => event.type === 'context.assembled' && event.payload.manifestHash === row.manifestHash))).toBe(true)
  const beforeImportCalls = calls.length
  const imported = await page.evaluate(async input => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const { exportProjectJSON, importProjectJSON } = await load('/storyforge/src/lib/export/json-export.ts')
    const original = await db.productProductions.get(input.productionId), backup = await exportProjectJSON(input.scope.projectId)
    const projectId = await importProjectJSON(backup), production = (await db.productProductions.where('projectId').equals(projectId).toArray()).find((row: any) => row.productionKey === original.productionKey)
    const scope = { projectId, worldId: production.worldId, workId: production.workId }
    const sealedBefore = (await db.productBuilds.where('productionId').equals(production.id).toArray()).find((row: any) => row.buildNumber === production.currentBuildNumber)
    const releaseBefore = await db.productReleases.get(sealedBefore.releasedProductReleaseId)
    // Exercise a real native-IDB transaction failure after the import verifier's
    // start is durable. Resumption must finish that same root without rewriting
    // the released Build or issuing another provider operation.
    const recovery = (await load('/storyforge/src/lib/product-production/service.ts')).recoverImportedProductProductionProofsV1
    const importedRootId = JSON.parse(sealedBefore.budgetLedgerJson).rootRunId
    let interrupted = false, interruptionError = ''
    const rejectRootAccepted = (_key: any, row: any) => {
      if (row.runId === importedRootId && row.type === 'verification.accepted') {
        interrupted = true
        throw new Error('fixture-native-root-accepted-storage-cut')
      }
    }
    db.agentRunEvents.hook('creating', rejectRootAccepted)
    try { await recovery({ scope, productionId: production.id }) }
    catch (error) { interruptionError = String(error) }
    finally { db.agentRunEvents.hook('creating').unsubscribe(rejectRootAccepted) }
    const eventStore = await load('/storyforge/src/lib/agent/run/event-store.ts')
    const interruptedRoot = await eventStore.readAgentRunV1(scope, importedRootId)
    if (!interrupted || !interruptionError.includes('fixture-native-root-accepted-storage-cut')
      || interruptedRoot.projection.state !== 'verifying') throw new Error('Native interruption did not leave the expected durable verifying root')
    const projection = await recovery({ scope, productionId: production.id })
    const resumedRoot = await eventStore.readAgentRunV1(scope, importedRootId)
    const recoveryStarts = resumedRoot.events.filter((event: any) => event.type === 'verification.started'
      && event.payload.verifierSetVersion === 'product-production-root-published-origin-rebind-v1')
    if (recoveryStarts.length !== 1 || resumedRoot.projection.state !== 'completed') throw new Error('Interrupted import must resume the same verifier start exactly once')
    const build = (await db.productBuilds.where('productionId').equals(production.id).toArray()).find((row: any) => row.buildNumber === projection.buildNumber)
    const source = (await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()).find((row: any) => row.controlEpoch === build.controlEpoch && row.artifactKey === 'ttrpg.open.source-facts' && ['accepted', 'carried-forward'].includes(row.status))
    const rights = JSON.parse(source.rightsJson), raw = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([projectId, 'raw-response', rights.originalResponseRawHash]).first()
    const root = await db.agentRuns.get(JSON.parse(build.budgetLedgerJson).rootRunId)
    return { scope, productionId: production.id, buildId: build.id, terminal: projection.terminal, status: build.status, rights: source.rightsJson, payload: source.payloadJson, raw: raw?.content,
      publishedRowsUnchanged: JSON.stringify(build) === JSON.stringify(sealedBefore)
        && JSON.stringify(await db.productProductions.get(production.id)) === JSON.stringify(production)
        && JSON.stringify(await db.productReleases.get(releaseBefore.id)) === JSON.stringify(releaseBefore),
      originalProductionUnchanged: JSON.stringify(await db.productProductions.get(original.id)) === JSON.stringify(original),
      originalRootIdentityPreserved: root.terminalReceiptHash === sealedBefore.rootTerminalReceiptHash && typeof root.portablePublishedRootOriginJson === 'string' }
  }, { scope: f.scope, productionId: f.productionId })
  expect(imported.terminal).toBe(true); expect(imported.status).toBe('released'); expect(imported.scope.projectId).not.toBe(f.scope.projectId)
  expect(imported.rights).toBe(published.source.rightsJson); expect(imported.payload).toBe(published.source.payloadJson)
  expect(imported.publishedRowsUnchanged).toBe(true); expect(imported.originalProductionUnchanged).toBe(true); expect(imported.originalRootIdentityPreserved).toBe(true)
  expect(imported.raw).toBe(JSON.stringify(data.sourceFacts)); expect(calls.length).toBe(beforeImportCalls)
  const evolution = await page.evaluate(async input => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const service = await load('/storyforge/src/lib/product-production/service.ts')
    const { executeProductProductionCommand } = await load('/storyforge/src/lib/product-production/commands.ts')
    const { exportProjectJSON, importProjectJSON } = await load('/storyforge/src/lib/export/json-export.ts')
    const originalBuild = await db.productBuilds.get(input.buildId), originalRelease = await db.productReleases.get(originalBuild.releasedProductReleaseId)
    await service.beginProductProductionEvolutionV1({ scope: input.scope, productionId: input.productionId,
      userText: '导入后仅修订视觉呈现，保留已审阅事实、规则、局势及完整原回答来源', affectedLanes: ['visual'] })
    const production = await db.productProductions.get(input.productionId)
    const brief = await db.productProductionBriefs.where('[productionId+revision]').equals([production.id, production.currentBriefRevision]).first()
    const started = await executeProductProductionCommand({ scope: input.scope, productionId: production.id, command: {
      type: 'authorize-start', commandId: 'native.captured-source.visual-revision', expectedStateRevision: production.stateRevision,
      briefRevision: brief.revision, briefHash: brief.briefHash, authorizationNonce: 'isolated.engineering.author.visual-review' } })
    if (!started.ok) throw new Error(JSON.stringify(started))
    // Actual normal production service. The empty-media visual revision must
    // reuse accepted content and never ask the simulated provider for new text.
    const result = await service.runAuthorizedProductProductionV1({ scope: input.scope, productionId: production.id })
    if (!result.terminal) throw new Error('Imported captured-source visual revision failed: ' + (await db.productBuilds.get(result.buildId)).failureJson)
    const published = await service.publishProductProductionV1({ scope: input.scope, productionId: production.id })
    const release = await db.productReleases.get(published.receipt.productReleaseId)
    const build = await db.productBuilds.get(result.buildId)
    const source = (await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()).find((row: any) => row.artifactKey === 'ttrpg.open.source-facts' && row.controlEpoch === build.controlEpoch && row.status === 'carried-forward')
    if (!source) throw new Error('Original captured-source content was not carried')
    const rights = JSON.parse(source.rightsJson)
    const raw = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([input.scope.projectId, 'raw-response', rights.originalResponseRawHash]).first()
    const beforeAgain = await db.productProductions.get(production.id)
    const copiedProject = await importProjectJSON(await exportProjectJSON(input.scope.projectId))
    const copiedProduction = (await db.productProductions.where('projectId').equals(copiedProject).toArray()).find((row: any) => row.productionKey === production.productionKey)
    const copiedScope = { projectId: copiedProject, worldId: copiedProduction.worldId, workId: copiedProduction.workId }
    const copiedBuildBefore = await db.productBuilds.where('[productionId+buildNumber]').equals([copiedProduction.id, build.buildNumber]).first()
    const rebound = await service.recoverImportedProductProductionProofsV1({ scope: copiedScope, productionId: copiedProduction.id })
    const copiedSource = (await db.productBuildArtifacts.where('buildId').equals(copiedBuildBefore.id).toArray()).find((row: any) => row.artifactKey === source.artifactKey && row.controlEpoch === copiedBuildBefore.controlEpoch && row.status === 'carried-forward')
    const copiedRaw = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([copiedProject, 'raw-response', rights.originalResponseRawHash]).first()
    const ledger = JSON.parse(build.budgetLedgerJson)
    return { terminal: result.terminal, version: release.version, status: build.status, rights: source.rightsJson, payload: source.payloadJson,
      sourceLineage: source.carriedFrom, raw: raw?.content, modelCalls: ledger.attempts.reduce((n: number, row: any) => n + (row.usage?.modelCalls ?? 0), 0),
      originalPublishedUnchanged: JSON.stringify(await db.productBuilds.get(originalBuild.id)) === JSON.stringify(originalBuild)
        && JSON.stringify(await db.productReleases.get(originalRelease.id)) === JSON.stringify(originalRelease),
      sourceManifest: JSON.parse(release.manifestJson).sourceContracts.sourceManifest,
      secondImport: { terminal: rebound.terminal, actualRunIdCollision: JSON.parse(copiedBuildBefore.budgetLedgerJson).rootRunId !== ledger.rootRunId,
        buildUnchanged: JSON.stringify(await db.productBuilds.get(copiedBuildBefore.id)) === JSON.stringify(copiedBuildBefore),
        productionUnchanged: JSON.stringify(await db.productProductions.get(copiedProduction.id)) === JSON.stringify(copiedProduction),
        sourceRights: copiedSource?.rightsJson, sourcePayload: copiedSource?.payloadJson, raw: copiedRaw?.content },
      secondMachineProductionUnchanged: JSON.stringify(await db.productProductions.get(production.id)) === JSON.stringify(beforeAgain) }
  }, imported)
  expect(evolution.terminal).toBe(true); expect(evolution.version).toBe(2); expect(evolution.status).toBe('released')
  expect(evolution.modelCalls).toBe(0); expect(calls.length).toBe(beforeImportCalls)
  expect(evolution.rights).toBe(published.source.rightsJson); expect(evolution.payload).toBe(published.source.payloadJson)
  expect(evolution.raw).toBe(JSON.stringify(data.sourceFacts)); expect(evolution.sourceLineage.buildNumber).toBe(1)
  expect(evolution.originalPublishedUnchanged).toBe(true); expect(evolution.secondMachineProductionUnchanged).toBe(true)
  expect(evolution.sourceManifest.runContextManifests.some((row: any) => row.stepId === 'ttrpg.open.source-facts')).toBe(true)
  expect(evolution.secondImport).toMatchObject({ terminal: true, actualRunIdCollision: true, buildUnchanged: true, productionUnchanged: true,
    sourceRights: published.source.rightsJson, sourcePayload: published.source.payloadJson, raw: JSON.stringify(data.sourceFacts) })
  await info.attach('normal-original-recovery-publication-import-evidence', { contentType: 'application/json',
    body: JSON.stringify({ calls, original, published, imported, evolution, transport: 'explicit fixture only', realModel: false, independentHumanAcceptance: false }) })
})
