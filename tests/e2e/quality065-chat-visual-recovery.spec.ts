import { expect, test } from '@playwright/test'

test('065 restores a saved chat image and accepts its original receipt without a second image request', async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000)
  if (!baseURL) throw Error('065 requires an isolated loopback base URL')
  const origin = new URL(baseURL)
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)) {
    throw Error('065 refuses external or author storage')
  }
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  const fixtureOrigin = 'https://sfqa065-visual.invalid'
  const endpoint = `${fixtureOrigin}/v1/images/generations`
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
  const prompts: string[] = [], forbidden: string[] = [], errors: string[] = []
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type' }
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.href === endpoint && request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors })
    } else if (url.href === endpoint && request.method() === 'POST') {
      const input = request.postDataJSON() as { model?: string; prompt?: string }
      if (input.model !== 'agnes-image-2.1-flash' || !input.prompt || prompts.length >= 3) {
        forbidden.push('unexpected synthetic image request')
        await route.abort()
        return
      }
      prompts.push(input.prompt)
      await route.fulfill({ status: 200, contentType: 'application/json',
        headers: { ...cors, 'x-request-id': `sfqa065-image-${prompts.length}` },
        body: JSON.stringify({ data: [{ b64_json: png }] }) })
    } else if (url.origin === origin.origin && ['GET', 'HEAD'].includes(request.method())) {
      await route.continue()
    } else {
      forbidden.push(`${request.method()} ${url.origin}`)
      await route.abort()
    }
  })
  await context.addInitScript(appOrigin => {
    if (location.origin === appOrigin) localStorage.setItem('storyforge_guide_completed', 'sfqa065-isolated')
  }, origin.origin)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto('./')
    await expect(page.getByRole('heading', { name: /天地为炉，\s*万象成故事。/ })).toBeVisible()
    await page.goto('./chat/library')
    const fixture = await page.evaluate(async imageOrigin => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      if (await db.projects.count()) throw Error('065 requires empty isolated storage')
      const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
      useAIConfigStore.getState().setRememberApiKey(true)
      useAIConfigStore.getState().setConfig({
        provider: 'agnes', model: 'agnes-2.5-flash', apiKey: 'synthetic-sfqa065-image-key',
        baseUrl: imageOrigin + '/v1', contextWindow: 128_000, maxTokens: 1_000, temperature: 0.2,
      })
      const { seedChatMediaPlayerFixture } = await load<typeof import('../helpers/chat-media-fixture')>('/storyforge/tests/helpers/chat-media-fixture.ts')
      const { chatActionReviewFixture } = await load<typeof import('../helpers/chat-narrative-fixture')>('/storyforge/tests/helpers/chat-narrative-fixture.ts')
      const { createCharacterInteractionInstance } = await load<typeof import('../../src/lib/product/runtime-instances')>('/storyforge/src/lib/product/runtime-instances.ts')
      const runtime = await load<typeof import('../../src/lib/character-interaction/runtime-api')>('/storyforge/src/lib/character-interaction/runtime-api.ts')
      const f = await seedChatMediaPlayerFixture({ dynamic: true })
      const session = await createCharacterInteractionInstance({
        scope: f.scope, productReleaseId: f.releaseId, title: '065 隔离聊天配图',
      })
      if (session.id == null) throw Error('fixture lacks real session')
      const sessionId = session.id
      const envelope = async (commandId: string) => {
        const v = await runtime.readProductRuntimeStateVersion(sessionId)
        return { sessionId, commandId, baseSequence: v.sequence, baseStateHash: v.stateHash }
      }
      const scene = await runtime.startInteractionScene({
        ...await envelope('sfqa065.scene'), sceneId: 'inn.current', sceneKey: 'inn',
      })
      const trigger = await runtime.requestChatNarrativeTrigger({
        ...await envelope('sfqa065.trigger'), kind: 'scene-start', sourceEventSequence: scene.sequence,
      })
      const action: import('../../src/lib/types/chat-narrative').ChatNarrativeActionV1 = {
        kind: 'complete', text: '叶岑检查了后门。后门闩完好，没有撬动痕迹。他把看到的情况告诉了两人。',
        goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['player', 'guard', 'artisan'], waitingForPlayer: false,
        newFacts: [{ factKey: 'door-checked', kind: 'observation', text: '后门闩完好，没有撬动痕迹。',
          evidenceFactKeys: ['lost'], evidenceExcerpt: '后门闩完好，没有撬动痕迹。' }],
        disclosures: [], threadUpdates: [], goalStatus: null,
      }
      await runtime.commitChatNarrativeAction({
        ...await envelope('sfqa065.action'), actorKey: 'guard', triggerSequence: trigger.sequence,
        messageId: 'sfqa065.inspection', factEvidenceVersion: 1, action, review: chatActionReviewFixture(action),
      })
      return { scope: f.scope, sessionId, state: await runtime.readProductRuntimeStateVersion(sessionId) }
    }, fixtureOrigin)
    await page.goto(`./chat/play?project=${fixture.scope.projectId}&work=${fixture.scope.workId}&session=${fixture.sessionId}`)

    await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const failure = { count: 0, receiptHash: null as string | null }
      Reflect.set(window, '__sfqa065Failure', failure)
      db.agentRunEvents.hook('creating', (_id, row) => {
        if (row.type !== 'verification.accepted' || failure.count) return
        failure.count += 1
        failure.receiptHash = (JSON.parse(row.payloadJson) as { receiptHash: string }).receiptHash
        throw Error('SFQA-065 one-shot native verification.accepted failure')
      })
    })

    const openGallery = async () => {
      const toggle = page.getByTestId('chat-media-details')
      await expect(toggle).toBeVisible()
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    }
    const gallery = page.getByLabel('当前人物与场景', { exact: true })
    const fill = () => gallery.getByRole('button', { name: '补齐当前画面', exact: true })
    const readEvidence = () => page.evaluate(async input => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const { readInstanceAgentRunV1 } = await load<typeof import('../../src/lib/agent/run/event-store')>('/storyforge/src/lib/agent/run/event-store.ts')
      const { readProductRuntimeStateVersion } = await load<typeof import('../../src/lib/character-interaction/runtime-api')>('/storyforge/src/lib/character-interaction/runtime-api.ts')
      const rows = await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).sortBy('id')
      const first = rows.find(row => row.contractJson.includes('character.chat-runtime-visuals'))
      const run = first?.id == null ? null : await readInstanceAgentRunV1(input.scope, first.id)
      const media = await db.productMediaAssets.where('productRuntimeSessionId').equals(input.sessionId).sortBy('id')
      const original = media[0]
      return {
        failure: Reflect.get(window, '__sfqa065Failure') as { count: number; receiptHash: string | null } | undefined,
        runId: first?.id, sequence: run?.projection.lastSequence, state: run?.projection.state,
        receiptHash: run?.projection.terminalReceiptHash ?? null,
        accepted: run?.events.filter(event => event.type === 'verification.accepted').length ?? 0,
        requested: run?.events.filter(event => event.type === 'model.requested').length ?? 0,
        original: original ? { id: original.id, alt: original.altText, contentHash: original.contentHash,
          owner: original.productRuntimeSessionId, ownerKind: original.ownerKind } : null,
        assets: media.length, gameplay: await readProductRuntimeStateVersion(input.sessionId),
      }
    }, fixture)

    await openGallery()
    await fill().click()
    await expect(gallery.getByRole('status')).toContainText('原图片已保存')
    const before = await readEvidence()
    expect(before).toMatchObject({
      failure: { count: 1 }, state: 'verifying', accepted: 0, requested: 1, assets: 1, gameplay: fixture.state,
      original: { owner: fixture.sessionId, ownerKind: 'runtime' },
    })
    expect(before.failure?.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(prompts).toHaveLength(1)

    await page.reload()
    await openGallery()
    const image = gallery.getByRole('img', { name: before.original!.alt, exact: true })
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1)
    await expect(gallery.getByRole('button', { name: '重做失败画面', exact: true })).toHaveCount(0)
    expect(await readEvidence()).toMatchObject({ runId: before.runId, sequence: before.sequence, accepted: 0, original: before.original })
    expect(prompts).toHaveLength(1)

    await fill().click()
    await expect.poll(async () => (await readEvidence()).assets).toBe(3)
    await expect(fill()).toBeEnabled()
    const after = await readEvidence()
    expect(after).toMatchObject({
      runId: before.runId, state: 'completed', accepted: 1, requested: 1, receiptHash: before.failure!.receiptHash,
      original: before.original, gameplay: fixture.state,
    })
    expect(prompts).toHaveLength(3)
    expect(prompts.filter(prompt => prompt === prompts[0])).toHaveLength(1)
    expect(forbidden).toEqual([])
    expect(errors).toEqual([])
    await testInfo.attach('sfqa065-native-original-image-proof', {
      body: Buffer.from(JSON.stringify({ before, after, syntheticCalls: prompts.length }, null, 2)),
      contentType: 'application/json',
    })
  } finally {
    await context.close()
  }
})
