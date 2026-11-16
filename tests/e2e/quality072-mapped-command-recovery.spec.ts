import { expect, test, type Page } from '@playwright/test'
import type { TextOpenWorldCommandEventPayloadV1 } from '../../src/lib/types'

async function state(page: Page, sessionId: number) {
  return page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { readProductRuntimeState } = await load('/storyforge/src/lib/product/runtime-core.ts') as typeof import('../../src/lib/product/runtime-core')
    const events = await db.productRuntimeEvents.where('sessionId').equals(id).sortBy('sequence')
    const command = events.find(event => event.type === 'text-open-world.command.committed'
      && (JSON.parse(event.payloadJson) as TextOpenWorldCommandEventPayloadV1).envelope.source === 'mapped-intent')
    if (!command) return null
    const payload = JSON.parse(command.payloadJson) as TextOpenWorldCommandEventPayloadV1
    const owned = events.filter(event => event.type === 'text-open-world.command.committed'
      ? event.commandId === payload.envelope.commandId
      : ['text-open-world.random.resolved', 'text-open-world.effects.applied'].includes(event.type)
        && (JSON.parse(event.payloadJson) as { commandId: string }).commandId === payload.envelope.commandId)
    const runtime = await readProductRuntimeState(id)
    return {
      command, envelope: payload.envelope,
      effects: owned.filter(event => event.type === 'text-open-world.effects.applied'),
      pendingCommandId: runtime.textOpenWorld?.protocol.pendingCommandId ?? null,
      modelEvents: (await db.agentRunEvents.toArray()).filter(event => event.type === 'model.responded'),
      events,
    }
  }, sessionId)
}

test('natural input commits its real authorization, then browser reload settles that same command once', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'sfqa072-isolated-native')
    localStorage.setItem('storyforge-ai-api-key-remember', 'true')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'agnes', apiKey: 'sfqa072-synthetic-key', model: 'sfqa072-controlled-model',
      baseUrl: 'https://sfqa072.invalid/v1', temperature: 0, maxTokens: 0,
    }))
  })
  let modelRequests = 0
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue()
    if (url.hostname !== 'sfqa072.invalid' || !url.pathname.endsWith('/chat/completions')) return route.abort()
    modelRequests += 1
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
          kind: 'mapped-choice', confidence: 0.98, actionKeys: [], choiceKeys: ['choice.accept-main'],
          extractedArguments: { targetKey: null }, rationale: '选择已发布场景的固定选项。',
          requiresConfirmation: false, boundaryExplanation: null, replyText: '',
        }) } }], usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 },
      }),
    })
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('./')
  const seeded = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { createGovernedTextOpenWorldSessionFixtureV1 } = await load('/storyforge/tests/helpers/text-open-world-product-session.ts') as typeof import('../helpers/text-open-world-product-session')
    const { createTextOpenWorldVNextP9Fixture } = await load('/storyforge/tests/helpers/text-open-world-vnext-fixture.ts') as typeof import('../helpers/text-open-world-vnext-fixture')
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: 'SFQA072浏览器中断恢复', textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(),
      runtimeShape: 'vnext-only', title: '072同一授权命令', seed: 'sfqa072-native',
    })
    return { projectId: created.scope.projectId, sessionId: created.session.id!, title: created.session.title }
  })
  await page.goto(`./openworld/runtime?project=${seeded.projectId}&mode=play`)
  const saves = page.getByRole('region', { name: '正式存档' })
  await expect(saves.getByText(seeded.title, { exact: true })).toBeVisible({ timeout: 20_000 })
  await saves.locator('.open-world-save-open').filter({ hasText: seeded.title }).click()
  await expect(page.getByTestId('text-open-world-fixed-choices')).toContainText('接下盐渠委托')
  await page.evaluate(async sessionId => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { interruptMappedOutcomeV1 } = await load('/storyforge/tests/helpers/sfqa072-mapped-command-recovery.ts') as typeof import('../helpers/sfqa072-mapped-command-recovery')
    const hook = interruptMappedOutcomeV1({ sessionId })
    Object.assign(window, { __sfqa072Interrupt: hook })
  }, seeded.sessionId)
  await page.getByLabel('你想怎么做？').fill('我接受这个任务，愿意帮忙调查盐渠。')
  await page.getByTestId('text-open-world-natural-input').getByRole('button', { name: '提交', exact: true }).click()
  await expect(page.getByTestId('text-open-world-player-state-notice')).toBeVisible()
  const interrupted = await state(page, seeded.sessionId)
  expect(interrupted).not.toBeNull()
  expect(interrupted!.effects).toHaveLength(0)
  expect(interrupted!.pendingCommandId).toBe(interrupted!.envelope.commandId)
  expect(interrupted!.envelope.payload.runtimeIntent).toMatchObject({
    schema: 'storyforge.text-open-world.runtime-intent-evidence', selectedKey: 'choice.accept-main',
    actionKey: 'action.accept-main',
  })
  expect(JSON.stringify(interrupted!.envelope.payload.runtimeIntent)).not.toContain('runId')
  expect(interrupted!.modelEvents).toHaveLength(1)
  expect(modelRequests).toBe(1)
  await page.reload()
  await expect.poll(async () => (await state(page, seeded.sessionId))?.effects.length, { timeout: 20_000 }).toBe(1)
  await expect(page.getByTestId('text-open-world-player-state-notice')).toHaveCount(0)
  const recovered = await state(page, seeded.sessionId)
  expect(recovered!.command).toEqual(interrupted!.command)
  expect(recovered!.pendingCommandId).toBeNull()
  expect(recovered!.modelEvents).toEqual(interrupted!.modelEvents)
  expect(modelRequests).toBe(1)
  await page.reload()
  await expect(page.getByTestId('text-open-world-natural-input')).toBeVisible()
  const again = await state(page, seeded.sessionId)
  expect(again!.events).toEqual(recovered!.events)
  expect(again!.modelEvents).toEqual(recovered!.modelEvents)
  expect(modelRequests).toBe(1)
})
