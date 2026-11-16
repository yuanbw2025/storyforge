import { expect, test } from '@playwright/test'

test('084 preserves the longest NPC reply through the next turn, explicit memory and reload', async ({ browser, baseURL }, testInfo) => {
  if (!baseURL) throw Error('084 requires an isolated loopback base URL')
  const origin = new URL(baseURL)
  if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(origin.hostname)) {
    throw Error('084 refuses external or author storage')
  }

  const longReply = `港${'潮'.repeat(3_998)}岸`
  const oversizedReply = `${longReply}溢`
  const nextReply = '我记得你先前的提问。'
  const openingInput = '询'.repeat(1_000)
  const nextInput = '问'.repeat(1_000 - nextReply.length)
  const summary = '岑阿婆记下了来客关于盐港潮水的询问。'
  expect([openingInput, longReply, nextInput, nextReply].join('')).toHaveLength(6_000)
  const intent = {
    kind: 'dialogue-only', confidence: 1, actionKeys: [], choiceKeys: [], extractedArguments: { targetKey: null },
    rationale: '让当前角色回应问题。', requiresConfirmation: false, boundaryExplanation: null, replyText: '',
  }
  const reply = (replyText: string) => ({
    kind: 'npc-dialogue', actorKey: 'actor.caretaker', replyText, tone: 'neutral',
    citedKnowledgeKeys: [], recommendedActionKeys: [], recommendedChoiceKeys: [], boundaryExplanation: null,
  })
  const memory = {
    kind: 'dialogue-window', subjectKey: 'actor.caretaker', summary,
    coveredEventSequences: [], playerKnowledgeKeys: [], actorKnowledgeKeys: [], openThreadKeys: [],
  }
  const plan = [intent, reply(longReply), intent, reply(nextReply), memory, intent, reply(oversizedReply)]
  const requests: string[] = []
  const forbidden: string[] = []
  const pageErrors: string[] = []
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.origin === 'https://sfqa084-native.invalid' && url.pathname === '/v1/chat/completions') {
      const output = plan[requests.length]
      const body = request.postDataJSON() as { messages: unknown }
      requests.push(JSON.stringify(body.messages))
      if (!output) {
        forbidden.push('unexpected synthetic model resend')
        await route.abort()
        return
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          id: `sfqa084-native-${requests.length}`,
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }],
          usage: { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 },
        }),
      })
    } else if (url.origin === origin.origin && ['GET', 'HEAD'].includes(request.method())) {
      await route.continue()
    } else {
      forbidden.push(`${request.method()} ${url.origin}`)
      await route.abort()
    }
  })
  await context.addInitScript(expectedOrigin => {
    if (location.origin === expectedOrigin) localStorage.setItem('storyforge_guide_completed', 'sfqa084-isolated')
  }, origin.origin)
  const page = await context.newPage()
  page.on('pageerror', error => pageErrors.push(error.message))

  try {
    await page.goto('./')
    const fixture = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      if (await db.projects.count()) throw Error('084 requires a clean isolated store')
      const { createGovernedTextOpenWorldSessionFixtureV1 } = await load<typeof import('../helpers/text-open-world-product-session')>('/storyforge/tests/helpers/text-open-world-product-session.ts')
      const { createTextOpenWorldVNextP9Fixture } = await load<typeof import('../helpers/text-open-world-vnext-fixture')>('/storyforge/tests/helpers/text-open-world-vnext-fixture.ts')
      const { useAIConfigStore } = await load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
      useAIConfigStore.getState().setRememberApiKey(true)
      useAIConfigStore.getState().setConfig({
        provider: 'openai', apiKey: 'synthetic-sfqa084-native-key', model: 'gpt-4o-mini',
        baseUrl: 'https://sfqa084-native.invalid/v1', maxTokens: 1_600, contextWindow: 128_000, temperature: 0.2,
      })
      const { scope, session, release } = await createGovernedTextOpenWorldSessionFixtureV1({
        name: '084隔离对白窗口', textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(),
        runtimeShape: 'vnext-only', title: '084隔离存档', seed: '084-native-window',
      })
      if (session.id == null || release.id == null) throw Error('084 requires a governed Release and session')
      return { scope, sessionId: session.id, title: session.title, releaseId: release.id }
    })
    await page.goto(`./openworld/runtime?project=${fixture.scope.projectId}&mode=play`)

    const actorScene = page.getByRole('button', { name: '岑阿婆 · 守渠人的话', exact: true })
    const openScene = async () => {
      await page.getByRole('region', { name: '正式存档' }).locator('.open-world-save-open').filter({ hasText: fixture.title }).click()
      await actorScene.click()
    }
    const ask = async (value: string) => {
      await page.getByLabel('你想怎么做？').fill(value)
      await page.getByTestId('text-open-world-natural-input').getByRole('button', { name: '提交', exact: true }).click()
    }
    const transcript = page.getByTestId('text-open-world-runtime-dialogue')
    const longTermMemory = page.getByTestId('text-open-world-runtime-memory')
    const readEvidence = () => page.evaluate(async input => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const { readInstanceAgentRunV1 } = await load<typeof import('../../src/lib/agent/run/event-store')>('/storyforge/src/lib/agent/run/event-store.ts')
      const { readLatestVerifiedAgentRunCheckpointV1 } = await load<typeof import('../../src/lib/agent/run/checkpoint')>('/storyforge/src/lib/agent/run/checkpoint.ts')
      const { useTextOpenWorldPlayerStore } = await load<typeof import('../../src/stores/text-open-world-player')>('/storyforge/src/stores/text-open-world-player.ts')
      const session = await db.productRuntimeSessions.get(input.sessionId)
      const memoryRows = (await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).toArray())
        .filter(row => row.type === 'text-open-world.memory.committed')
      const allRunEvents = await db.agentRunEvents.where('projectId').equals(input.scope.projectId).toArray()
      const requested = allRunEvents.filter(row => row.type === 'model.requested').sort((a, b) => a.runId - b.runId)
      const dialogue = requested.filter(row => JSON.parse(row.payloadJson).stepId === 'text-open-world-runtime-ai:dialogue')
      const memories = requested.filter(row => JSON.parse(row.payloadJson).stepId === 'text-open-world-runtime-ai:memory')
      const initialDialogue = dialogue[0]
      const checkpoint = initialDialogue && await readLatestVerifiedAgentRunCheckpointV1(input.scope, initialDialogue.runId, {
        owner: 'instance', maximumResumePayloadBytes: 64 * 1024,
      })
      const candidate = checkpoint ? checkpoint.resumePayload as { replyText?: string; candidateHash?: string } : null
      const memoryRun = memories[0] ? await readInstanceAgentRunV1(input.scope, memories[0].runId) : null
      const finalDialogue = dialogue.length === 3 ? await readInstanceAgentRunV1(input.scope, dialogue[2]!.runId) : null
      return {
        releaseId: session?.productReleaseId,
        memoryEvents: memoryRows.length,
        memorySequence: memoryRows[0]?.sequence ?? null,
        displaySequence: useTextOpenWorldPlayerStore.getState().runtimeState.lastSequence,
        memoryStoresFullText: memoryRows.some(row => row.payloadJson.includes(input.longReply)),
        dialogueRequests: dialogue.length,
        memoryRequests: memories.length,
        originalCandidateMatches: candidate?.replyText === input.longReply,
        originalCandidateHash: candidate?.candidateHash ?? null,
        memoryState: memoryRun?.projection.state ?? null,
        memoryReceipt: memoryRun?.projection.terminalReceiptHash ?? null,
        overlongState: finalDialogue?.projection.state ?? null,
        overlongAccepted: finalDialogue ? allRunEvents.some(row => row.runId === finalDialogue.run.id && row.type === 'candidate.persisted') : false,
      }
    }, { ...fixture, longReply })

    await openScene()
    await ask(openingInput)
    await expect(transcript).toContainText(longReply)
    expect(requests).toHaveLength(2)
    await ask(nextInput)
    await expect(transcript).toContainText(nextReply)
    await expect(transcript).toContainText('整理最近 2 轮完整对白')
    expect(requests).toHaveLength(4)
    expect(requests[3]).toContain(longReply)
    expect(requests[3]).toContain(nextInput)
    const before = await readEvidence()
    expect(before).toMatchObject({ memoryEvents: 0, memoryRequests: 0, originalCandidateMatches: true, releaseId: fixture.releaseId })
    expect(before.originalCandidateHash).toMatch(/^[a-f0-9]{64}$/)

    await page.getByRole('button', { name: '整理并保存长期记忆', exact: true }).click()
    await expect.poll(async () => {
      const result = await readEvidence()
      return result.memoryState === 'completed' && result.displaySequence === result.memorySequence
    }).toBe(true)
    // The event refresh may restore the default scene. Open the actor after
    // the actual player has loaded the new event sequence.
    await actorScene.click()
    await expect(longTermMemory).toContainText(summary)
    expect(requests).toHaveLength(5)
    expect(requests[4]).toContain(longReply)
    expect(requests[4]).toContain(before.originalCandidateHash!)
    const saved = await readEvidence()
    expect(saved).toMatchObject({
      releaseId: fixture.releaseId, memoryEvents: 1, memoryStoresFullText: false,
      dialogueRequests: 2, memoryRequests: 1, originalCandidateMatches: true, memoryState: 'completed',
    })
    expect(saved.memoryReceipt).toMatch(/^[a-f0-9]{64}$/)

    await page.reload()
    await expect(page.getByTestId('text-open-world-shell')).toBeVisible()
    expect(new URL(page.url()).searchParams.get('session')).toBe(String(fixture.sessionId))
    await actorScene.click()
    await expect(longTermMemory).toContainText(summary)
    await expect(transcript).toHaveCount(0)
    expect(requests).toHaveLength(5)
    expect(await readEvidence()).toEqual(saved)

    await ask('请继续讲一件没有说过的事。')
    await expect(transcript).toContainText('冻结安全回退')
    await expect(transcript).not.toContainText(oversizedReply)
    const final = await readEvidence()
    expect(final).toMatchObject({ releaseId: fixture.releaseId, memoryEvents: 1, dialogueRequests: 3,
      memoryRequests: 1, overlongState: 'failed', overlongAccepted: false })
    expect(final.memoryReceipt).toBe(saved.memoryReceipt)
    expect(requests).toHaveLength(7)
    expect(forbidden).toEqual([])
    expect(pageErrors).toEqual([])
    await testInfo.attach('sfqa084-dialogue-window-proof', {
      body: Buffer.from(JSON.stringify({ before, saved, final, syntheticCalls: requests.length }, null, 2)),
      contentType: 'application/json',
    })
  } finally {
    await context.close()
  }
})
