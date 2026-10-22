import { expect, test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })

test('native original public Run saves exact shared input and resumes the same prepared request after reload with no model sends', async ({ page }) => {
  test.setTimeout(120000)
  const requests: string[] = []
  page.on('request', request => { if (/\/v1\/(?:chat\/completions|responses)/.test(request.url())) requests.push(request.url()) })
  await page.goto('./')
  const original = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const f = await helper.readyOpenTtrpgSessionV1('Native public request', (p: any) => {
      const c = p.ttrpg.campaign; c.runtimePolicy.enabled = true; c.runtimePolicy.maximumEpochTokens = 50000; c.runtimePolicy.maximumOutputTokens = 8000
      c.characterTemplates.find((actor: any) => actor.role === 'npc').gmProfile.secret = 'NATIVE-PRIVATE-REQUEST-PACKET'
    })
    const rawInput = '  依据共同资料拟定新局势 e\u0301。\n'
    const granted = await api.createTtrpgOpenPublicSituationAuthorizationV1({ ...await helper.openEnvelopeV1(f.sessionId, 'native.public.authorize'),
      scope: f.scope, viewerKey: helper.OPEN_HUMAN_VIEWER, rawInput, sharingDecision: 'share-this-request-with-current-party',
      delegationDecision: 'draft-only', modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 4000, maximumCostUsd: 0.1 })
    const read = { scope: f.scope, sessionId: f.sessionId, viewerKey: helper.OPEN_HUMAN_VIEWER, runId: granted.runId, requestKey: granted.requestKey }
    const prepared = await api.prepareTtrpgOpenPublicSituationInputV1(read)
    const { readAgentRunArtifactExactV1 } = await importer('/storyforge/src/lib/memory/artifact-store.ts')
    const ref = prepared.evidence.preflight.artifacts.find((ref: any) => ref.resourceKey?.endsWith(':public-situation-shared-input'))
    const wrapped = JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'source-snapshot', contentHash: ref.contentHash }))
    return { read, rawInput, sharedText: JSON.parse(wrapped.content).text, messages: prepared.messages,
      manifestHash: prepared.evidence.manifest.manifestHash, runs: await db.agentRuns.count(), events: await db.agentRunEvents.count() }
  })
  expect(original.sharedText).toBe(original.rawInput); expect(original.runs).toBe(1)
  expect(JSON.stringify(original.messages)).not.toContain('NATIVE-PRIVATE-REQUEST-PACKET')
  await page.reload()
  const restored = await page.evaluate(async read => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const prepared = await api.prepareTtrpgOpenPublicSituationInputV1(read)
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts')
    return { messages: prepared.messages, manifestHash: prepared.evidence.manifest.manifestHash, runs: await db.agentRuns.count(),
      events: await db.agentRunEvents.count(), calls: (await readProductRuntimeState(read.sessionId)).ttrpg.openRun.coordination.calls }
  }, original.read)
  expect(restored.messages).toEqual(original.messages); expect(restored.manifestHash).toBe(original.manifestHash)
  expect(restored.events).toBe(original.events); expect(restored.runs).toBe(1)
  expect(restored.calls).toHaveLength(1); expect(restored.calls[0]).toMatchObject({ status: 'prepared', dispatchRef: null })
  expect(requests).toEqual([])
})

for (const preparedBeforeExport of [false, true]) test(`native full import with coincident ids keeps ${preparedBeforeExport ? 'prepared' : 'unprepared'} original Run historical and permits only explicit close`, async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('./')
  const result = await page.evaluate(async preparedBeforeExport => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const io = await importer('/storyforge/src/lib/export/json-export.ts')
    const { resolveScope } = await importer('/storyforge/src/lib/workspace/scope.ts')
    const f = await helper.readyOpenTtrpgSessionV1('Native unprepared history', (p: any) => {
      p.ttrpg.campaign.runtimePolicy.enabled = true; p.ttrpg.campaign.runtimePolicy.maximumEpochTokens = 50000; p.ttrpg.campaign.runtimePolicy.maximumOutputTokens = 8000
    })
    const input = { ...await helper.openEnvelopeV1(f.sessionId, 'native.public.history'), scope: f.scope, viewerKey: helper.OPEN_HUMAN_VIEWER,
      rawInput: '共享本次拟定要求', sharingDecision: 'share-this-request-with-current-party', delegationDecision: 'adopt-this-one-candidate',
      modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 4000, maximumCostUsd: 0.1 }
    const granted = await api.createTtrpgOpenPublicSituationAuthorizationV1(input)
    if (preparedBeforeExport) await api.prepareTtrpgOpenPublicSituationInputV1({ ...input, runId: granted.runId, requestKey: granted.requestKey })
    const backup = await io.exportProjectJSON(f.scope.projectId)
    await db.delete(); await db.open()
    const projectId = await io.importProjectJSON(backup), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId, workId: session.workId } })
    const run = (await db.agentRuns.where('productRuntimeSessionId').equals(session.id).toArray())[0]
    let denied = false
    try { await api.createTtrpgOpenPublicSituationAuthorizationV1({ ...input, scope, sessionId: session.id }) } catch { denied = true }
    let prepareDenied = false
    try { await api.prepareTtrpgOpenPublicSituationInputV1({ ...input, scope, sessionId: session.id, runId: run.id, requestKey: granted.requestKey }) } catch { prepareDenied = true }
    await api.finishTtrpgOpenPublicSituationDraftV1({ ...input, scope, sessionId: session.id, epochKey: granted.epochKey })
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const coordination = (await readProductRuntimeState(session.id)).ttrpg.openRun.coordination
    return { originalIds: [input.sessionId, granted.runId], importedIds: [session.id, run.id],
      origin: JSON.parse(run.portableRuntimeOriginJson), denied, prepareDenied, closed: coordination.activeEpochKey === null,
      calls: coordination.calls.map((row: any) => ({ status: row.status, dispatchRef: row.dispatchRef })), runs: await db.agentRuns.count() }
  }, preparedBeforeExport)
  expect(result.importedIds).toEqual(result.originalIds)
  expect(result.origin).toMatchObject(preparedBeforeExport ? { version: 1 } : { version: 2, phase: 'public-request-preparation' })
  expect(result.denied).toBe(true); expect(result.prepareDenied).toBe(true); expect(result.closed).toBe(true); expect(result.runs).toBe(1)
  expect(result.calls).toEqual(preparedBeforeExport ? [{ status: 'failed', dispatchRef: null }] : [])
})

test('native actual formal HTTP transport sends only common bodies once and resumes the retained candidate after reload', async ({ page }) => {
  test.setTimeout(120000)
  let sends = 0
  const wire: { response: string; messages: unknown } = { response: '', messages: [] }
  await page.route('**/public-wire-native/v1/chat/completions', async route => {
    sends++
    const body = route.request().postDataJSON()
    expect(body.messages).toEqual(wire.messages); expect(body.max_tokens).toBe(4000)
    expect(JSON.stringify(body)).not.toContain('NATIVE-PRIVATE-WIRE-')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: wire.response } }],
      usage: { prompt_tokens: 200, completion_tokens: 1000, total_tokens: 1200 } }) })
  })
  await page.goto('./')
  const prepared = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts'), api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const f = await helper.readyOpenTtrpgSessionV1('Native public formal wire', (pkg: any) => {
      const c = pkg.ttrpg.campaign; c.runtimePolicy.enabled = true; c.runtimePolicy.maximumEpochTokens = 50000; c.runtimePolicy.maximumOutputTokens = 8000
      c.fronts[0].goal = 'NATIVE-PRIVATE-WIRE-FRONT'; c.characterTemplates.find((row: any) => row.role === 'npc').gmProfile.secret = 'NATIVE-PRIVATE-WIRE-GM'
      c.characterTemplates.find((row: any) => row.characterKey === 'hero').playerProfile.secret = 'NATIVE-PRIVATE-WIRE-PLAYER'
      c.situationTemplates[0].evidence[0].description = 'NATIVE-PRIVATE-WIRE-UNDISCOVERED'
    })
    const granted = await api.createTtrpgOpenPublicSituationAuthorizationV1({ ...await helper.openEnvelopeV1(f.sessionId, 'native.public.wire'), scope: f.scope,
      viewerKey: helper.OPEN_HUMAN_VIEWER, rawInput: '  根据共同资料拟定本次新局势 e\u0301。\n', sharingDecision: 'share-this-request-with-current-party',
      delegationDecision: 'draft-only', modelIdentity: { provider: 'custom', model: 'public-wire-engineering-model' }, maximumOutputTokens: 4000, maximumCostUsd: 0.1 })
    const read = { scope: f.scope, sessionId: f.sessionId, viewerKey: helper.OPEN_HUMAN_VIEWER, runId: granted.runId, requestKey: granted.requestKey }
    const prepared = await api.prepareTtrpgOpenPublicSituationInputV1(read)
    const { readAgentRunArtifactExactV1 } = await importer('/storyforge/src/lib/memory/artifact-store.ts')
    const kernel = JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'source-snapshot', contentHash: prepared.evidence.publicKernelHash }))
    const { publicSituationOutputV1 } = await importer('/storyforge/tests/helpers/open-public-situation-generation.ts')
    return { read, messages: prepared.messages, response: JSON.stringify(publicSituationOutputV1(kernel)) }
  })
  wire.messages = prepared.messages; wire.response = prepared.response
  const summary = await page.evaluate(async read => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const result = await api.executeTtrpgOpenPublicSituationRequestV1({ ...read, aiConfig: { provider: 'custom', model: 'public-wire-engineering-model',
      apiKey: '', baseUrl: location.origin + '/public-wire-native/v1', maxTokens: 9999, temperature: 0.2, contextWindow: 64000 } })
    return result.summary
  }, prepared.read)
  expect(summary.status).toBe('usable-with-warnings'); expect(sends).toBe(1)
  expect(JSON.stringify(summary)).not.toMatch(/NATIVE-PRIVATE-|originalText|references|共同调查/)
  await page.reload()
  const restored = await page.evaluate(async read => {
    const importer = new Function('p', 'return import(p)') as (path: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts'), { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const summary = await api.recoverTtrpgOpenPublicSituationCandidateV1(read)
    const result = await api.executeTtrpgOpenPublicSituationRequestV1(read)
    let denied = false
    try { await api.readTtrpgOpenPublicSituationCandidateV1(read) } catch { denied = true }
    return { summary, result, denied, runs: await db.agentRuns.count() }
  }, prepared.read)
  expect(restored).toEqual({ summary, result: { status: 'not-sent' }, denied: true, runs: 1 }); expect(sends).toBe(1)
})
