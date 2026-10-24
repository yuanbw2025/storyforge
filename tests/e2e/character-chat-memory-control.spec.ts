import {test, expect} from '@playwright/test'

test('memory correction commands survive real IndexedDB reload, branch rebasing and portable import without model calls', async ({page}) => {
  let modelCalls = 0
  await page.route(/\/chat\/completions|\/api\/local-codex\/generate/, async route => {modelCalls++; await route.abort()})
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./chat/library')
  const fixture = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const f = await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({maxMemoryEntries: 1})
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const command = async () => {const v = await api.readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
    const message = await api.commitInteractionPlayerMessage({...await command(), messageId: 'friday', text: '我约好周五再来。'})
    await api.proposeInteractionMemory({...await command(), memoryId: 'promise', participantKey: 'guard', kind: 'commitment', content: '误记为周二再来', importance: 95,
      sourceEventSequences: [message.sequence], evidenceExcerpt: '周五再来'})
    await api.resolveInteractionMemory({...await command(), memoryId: 'promise', resolution: 'accepted'})
    const correction = {...await command(), memoryId: 'promise', replacementMemoryId: 'corrected', content: '约定是周五再来', sourceEventSequences: [message.sequence], evidenceExcerpt: '周五再来', reason: '玩家修正错误摘要'}
    await api.correctChatMemory(correction)
    await api.correctChatMemory(correction)
    await api.changeChatMemoryUse({...await command(), memoryId: 'corrected', action: 'disable', reason: '玩家暂时停用'})
    return {...f, saved: (await api.readProductRuntimeState(f.sessionId)).interaction}
  })
  await page.reload()
  const result = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)')
    const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const {db} = await load('/storyforge/src/lib/db/schema.ts')
    const before = (await api.readProductRuntimeState(f.sessionId)).interaction
    const child = await api.branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: (await api.readProductRuntimeStateVersion(f.sessionId)).sequence, title: 'memory child'})
    const v = await api.readProductRuntimeStateVersion(child.id)
    await api.changeChatMemoryUse({sessionId: child.id, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash, memoryId: 'corrected', action: 'enable', reason: '玩家恢复使用'})
    const childState = (await api.readProductRuntimeState(child.id)).interaction
    const {exportProjectJSON, importProjectJSON} = await load('/storyforge/src/lib/export/json-export.ts')
    const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find((s: {title: string}) => s.title === 'memory child')
    const importedState = (await api.readProductRuntimeState(imported.id)).interaction
    const parent = (await api.readProductRuntimeState(f.sessionId)).interaction
    return {before, parent, childState, importedState}
  }, fixture)
  expect(result.before).toEqual(fixture.saved)
  expect(result.parent).toEqual(fixture.saved)
  expect(result.childState.memories.map((m: {status: string}) => m.status)).toEqual(['superseded', 'accepted'])
  expect(result.childState.memories[1].authorship).toBe('player-correction')
  expect(result.childState.memories[1].sourceEventSequences[0]).toBeLessThan(0)
  expect(result.importedState.memories).toEqual(result.childState.memories)
  expect(modelCalls).toBe(0)
})
