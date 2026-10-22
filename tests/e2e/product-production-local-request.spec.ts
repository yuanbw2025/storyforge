import { expect, test } from '@playwright/test'

test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'requires isolated open preview') })

/** Real Chrome/IndexedDB/UI; all native endpoints are simulated and intercepted.
 * No local subscription model or existing author profile is used. */
test('explicit original native receipt lookup survives reload without another inference, ACK or accounting change', async ({ page }, info) => {
  let posts = 0, gets = 0, acknowledgements = 0
  let wire: { id: string; model: string; messages: unknown[] } | null = null
  let wireHash = ''
  await page.route('**/local-codex/v1/**', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.pathname.endsWith('/status')) return route.fulfill({ json: { state: 'ready' } })
    if (url.pathname.endsWith('/requests') && request.method() === 'POST') {
      posts++; expect(posts).toBe(1)
      wire = request.postDataJSON()
      const prepared = await page.evaluate(async requestId => {
        const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
        const row = (await db.agentRunArtifacts.toArray()).find((a: any) => a.content?.includes('storyforge.product-production-local-request') && a.content.includes(requestId))
        if (!row) throw Error('Owner evidence absent before inference POST')
        return JSON.parse(row.content)
      }, wire!.id)
      wireHash = prepared.request.requestHash
      expect(prepared.request.requestId).toBe(wire!.id)
      expect(prepared.messages).toEqual(wire!.messages)
      return route.fulfill({ json: { id: wire!.id, status: 'accepted' } })
    }
    if (wire && url.pathname.endsWith(`/requests/${wire.id}`) && request.method() === 'GET') {
      gets++
      return route.fulfill({ json: { id: wire.id, model: wire.model, createdAt: Date.now(), status: 'unknown',
        text: '模拟的部分回答：仅供核对，不能作为成功候选。', dispatched: true, requestHash: wireHash,
        requestHashAlgorithm: 'sha256-json-request-v1', receiptRetention: 'until-owner-ack-v1' } })
    }
    if (url.pathname.endsWith('/acknowledge')) acknowledgements++
    await route.abort('blockedbyclient')
    throw Error('Unexpected simulated native endpoint: ' + url.pathname)
  })
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const { openProductionFixtureV1 } = await load('/storyforge/tests/helpers/open-ttrpg-production.ts')
    const { executeProductProductionCommand: command } = await load('/storyforge/src/lib/product-production/commands.ts')
    const { useAIConfigStore } = await load('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.getState().setConfig({ provider: 'codex', model: 'fixture-native-only', apiKey: '', maxTokens: 16000, contextWindow: 131072 })
    const { scope, productionId, brief } = await openProductionFixtureV1()
    const previous = await db.productProductions.get(productionId)
    const saved = await command({ scope, productionId, command: { type: 'save-brief-revision',
      commandId: 'native-original.save', expectedStateRevision: previous.stateRevision, parentRevision: previous.currentBriefRevision, brief } })
    if (!saved.ok) throw Error('Brief not saved')
    const current = await db.productProductions.get(productionId)
    const row = await db.productProductionBriefs.where('[productionId+revision]').equals([productionId, current.currentBriefRevision]).first()
    const start = await command({ scope, productionId, command: { type: 'authorize-start', commandId: 'native-original.start',
      expectedStateRevision: current.stateRevision, briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'explicit-engineering-fixture' } })
    if (!start.ok) throw Error('Production not authorized')
    const { resolveConfiguredTextCapabilityV1 } = await load('/storyforge/src/lib/product-production/capabilities.ts')
    const requirementKey = brief.capabilityRequirements.find((r: any) => r.mediaClass === 'text').requirementKey
    const resolved = await resolveConfiguredTextCapabilityV1({ projectId: scope.projectId, category: 'product-production', requirementKey })
    const { createConfiguredProductProductionExecutorV1 } = await load('/storyforge/src/lib/product-production/production-executor.ts')
    const { runProductProductionUntilBlockedV1 } = await load('/storyforge/src/lib/product-production/scheduler.ts')
    const executor = createConfiguredProductProductionExecutorV1({ production: await db.productProductions.get(productionId), brief })
    const result = await runProductProductionUntilBlockedV1({ scope, productionId, executor,
      capabilityBindings: [{ requirementKey, adapterId: 'configured-text.v1', bindingHash: resolved.receipt.capabilityHash,
        provider: resolved.receipt.provider, model: resolved.receipt.model }] })
    if (result.buildStatus !== 'recovery-required') throw Error('Unknown native receipt did not pause')
    const { updateWorkspace } = await load('/storyforge/src/lib/workspace/works.ts')
    const project = await db.projects.get(scope.projectId)
    await updateWorkspace(scope.projectId, { productPlatformOptIns: { ...project.productPlatformOptIns, productProductionV3: true } })
    const build = await db.productBuilds.get(result.buildId)
    return { scope, productionId, buildId: build.id, beforeBuild: build, beforeEvents: await db.agentRunEvents.toArray() }
  })
  expect(posts).toBe(1); expect(gets).toBe(1); expect(acknowledgements).toBe(0)
  await page.goto(`./ttrpg/production?project=${fixture.scope.projectId}&work=${fixture.scope.workId}&production=${fixture.productionId}`)
  const lookup = page.getByRole('button', { name: '查询原本机请求', exact: true }).first()
  await expect(lookup).toBeVisible()
  await page.reload()
  await expect(lookup).toBeVisible()
  expect(gets).toBe(1); expect(posts).toBe(1)
  await lookup.click()
  const evidence = page.getByTestId('product-production-task-evidence')
  await expect(evidence).toContainText('原请求只读查询：unknown')
  await expect(evidence).toContainText('模拟的部分回答')
  await expect(evidence).toContainText('没有重新生成、结算或采用')
  expect(gets).toBe(2); expect(posts).toBe(1); expect(acknowledgements).toBe(0)
  const after = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { build: await db.productBuilds.get(f.buildId), events: await db.agentRunEvents.toArray() }
  }, fixture)
  expect(after.build).toEqual(fixture.beforeBuild); expect(after.events).toEqual(fixture.beforeEvents)
  await page.screenshot({ path: info.outputPath('original-native-request-read-only.png'), fullPage: true })
  await info.attach('read-only-original-receipt', { body: JSON.stringify({ posts, gets, acknowledgements, fixture, after,
    simulatedTransport: true, realModel: false, independentHumanAcceptance: false }), contentType: 'application/json' })
})
