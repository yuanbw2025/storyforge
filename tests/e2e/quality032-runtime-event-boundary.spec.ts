import { expect, test } from '@playwright/test'

test('SFQA032 native generic append cannot bypass Town commands and preserves admitted input across reload', async ({ page, baseURL }, info) => {
  if (!baseURL || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(baseURL).hostname)) {
    throw Error('Expected isolated loopback browser origin')
  }
  const origin = new URL(baseURL).origin, unexpectedRequests: string[] = []
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'sfqa032-native'))
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (['http:', 'https:'].includes(url.protocol) && (url.origin !== origin || request.method() !== 'GET')) {
      unexpectedRequests.push(request.method() + ' ' + url.origin + url.pathname)
      await route.abort(); return
    }
    await route.continue()
  })
  await page.goto('./')
  const observed = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [schema, fixtures, core, town] = await Promise.all([
      load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      load<typeof import('../helpers/ai-town-runtime')>('/storyforge/tests/helpers/ai-town-runtime.ts'),
      load<typeof import('../../src/lib/product/runtime-core')>('/storyforge/src/lib/product/runtime-core.ts'),
      load<typeof import('../../src/lib/ai-town/runtime-api')>('/storyforge/src/lib/ai-town/runtime-api.ts'),
    ])
    if (await schema.db.projects.count()) throw Error('Expected a fresh isolated browser database')
    const fixture = await fixtures.seedAiTownRuntimeFixture(), session = fixture.session, sessionId = session.id!
    const releaseId = fixture.release.id!, worldBefore = JSON.stringify(await schema.db.worldReleases.get(releaseId))
    const start = await core.readProductRuntimeStateVersion(sessionId)
    const rowBefore = JSON.stringify(await schema.db.productRuntimeSessions.get(sessionId))
    const eventsBefore = JSON.stringify(await core.readSessionEvents(session))
    const denied = await core.appendProductRuntimeEvent({ sessionId, type: 'town.player.moved',
      payload: { locationKey: 'town.location.2', summary: '未经专用命令的移动。' },
    }).then(() => null, (error: unknown) => error instanceof Error ? error.message : String(error))
    const deniedRowUnchanged = JSON.stringify(await schema.db.productRuntimeSessions.get(sessionId)) === rowBefore
    const deniedEventsUnchanged = JSON.stringify(await core.readSessionEvents(session)) === eventsBefore
    const command = { sessionId, baseSequence: start.sequence, baseStateHash: start.stateHash,
      commandId: 'sfqa032.native.move', locationKey: 'town.location.2' }
    const moved = await town.moveAiTownPlayerV1(command), duplicate = await town.moveAiTownPlayerV1(command)
    const request: Parameters<typeof core.appendProductRuntimeEvent>[0] = {
      sessionId, type: 'narrative.recorded', payload: { text: '调用时的中立记录。' },
    }
    const pending = core.appendProductRuntimeEvent(request)
    request.type = 'town.player.moved'
    request.payload = { locationKey: 'town.location.1', summary: '等待期间更换的产品事件。' }
    const neutral = await pending
    const state = await core.readProductRuntimeState(sessionId), version = await core.readProductRuntimeStateVersion(sessionId)
    return { sessionId, releaseId, denied, deniedRowUnchanged, deniedEventsUnchanged,
      movedId: moved.id, duplicateId: duplicate.id, movedSequence: moved.sequence, startSequence: start.sequence,
      neutralType: neutral.type, neutralPayload: JSON.parse(neutral.payloadJson) as unknown,
      location: state.town?.player.locationKey, finalSequence: version.sequence,
      sessionWire: JSON.stringify(await schema.db.productRuntimeSessions.get(sessionId)),
      eventWire: JSON.stringify(await core.readSessionEvents(session)), stateWire: JSON.stringify(state), worldBefore,
      worldUnchanged: JSON.stringify(await schema.db.worldReleases.get(releaseId)) === worldBefore }
  })
  expect(observed.denied).toContain('专用')
  expect(observed.deniedRowUnchanged).toBe(true); expect(observed.deniedEventsUnchanged).toBe(true)
  expect(typeof observed.movedId).toBe('number'); expect(observed.duplicateId).toBe(observed.movedId)
  expect(observed.movedSequence).toBe(observed.startSequence + 1)
  expect(observed.neutralType).toBe('narrative.recorded')
  expect(observed.neutralPayload).toEqual({ text: '调用时的中立记录。' })
  expect(observed.location).toBe('town.location.2'); expect(observed.finalSequence).toBe(observed.startSequence + 2)
  expect(observed.worldUnchanged).toBe(true)
  await page.reload()
  const restored = await page.evaluate(async input => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [schema, core] = await Promise.all([
      load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      load<typeof import('../../src/lib/product/runtime-core')>('/storyforge/src/lib/product/runtime-core.ts'),
    ])
    const session = await schema.db.productRuntimeSessions.get(input.sessionId)
    if (!session) throw Error('Missing actual persisted Town session')
    return { sessionWire: JSON.stringify(session), eventWire: JSON.stringify(await core.readSessionEvents(session)),
      stateWire: JSON.stringify(await core.readProductRuntimeState(input.sessionId)),
      worldWire: JSON.stringify(await schema.db.worldReleases.get(input.releaseId)) }
  }, { sessionId: observed.sessionId, releaseId: observed.releaseId })
  expect(restored.sessionWire).toBe(observed.sessionWire); expect(restored.eventWire).toBe(observed.eventWire)
  expect(restored.stateWire).toBe(observed.stateWire); expect(restored.worldWire).toBe(observed.worldBefore)
  expect(unexpectedRequests).toEqual([])
  await info.attach('native-runtime-event-boundary', { contentType: 'application/json', body: JSON.stringify({
    sessionId: observed.sessionId, denied: observed.denied, deniedRowUnchanged: observed.deniedRowUnchanged,
    deniedEventsUnchanged: observed.deniedEventsUnchanged, movedId: observed.movedId, duplicateId: observed.duplicateId,
    neutralType: observed.neutralType, neutralPayload: observed.neutralPayload, location: observed.location,
    startSequence: observed.startSequence, finalSequence: observed.finalSequence, reloadPreservedExactRowsAndState: true,
    worldUnchanged: observed.worldUnchanged, unexpectedRequests,
  }) })
})
