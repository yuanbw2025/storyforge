import { expect, test } from '@playwright/test'

test('native memory command rolls back, retries once, and retains private origin after branch, ancestor deletion and full imports', async ({ page }) => {
  test.setTimeout(90000)
  const modelRequests: string[] = []
  page.on('request', request => { if (/\/v1\/(?:chat\/completions|responses)/.test(request.url())) modelRequests.push(request.url()) })
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const h = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const f = await h.readyOpenTtrpgSessionV1('真实浏览器记忆保存', (pkg: any) => { pkg.ttrpg.campaign.characterTemplates[1].controller = 'hybrid' })
    const before = await api.readProductRuntimeState(f.sessionId), runCount = await db.agentRuns.count()
    const draft = { revisionKey: 'memory.native.hero', observerKey: 'hero', reliability: 'belief', audience: 'private',
      knownBy: ['hero'], summary: '这是我对河港危险的个人推测。', fromEventSequence: 1, toEventSequence: before.lastSequence }
    const input = { ...await h.openEnvelopeV1(f.sessionId, 'memory.native.confirm'), viewerKey: h.OPEN_HUMAN_VIEWER, draft }
    const add = db.ttrpgNarrativeMemories.add.bind(db.ttrpgNarrativeMemories)
    let rejected = false
    db.ttrpgNarrativeMemories.add = async () => { throw new DOMException('Fixture memory quota failure', 'QuotaExceededError') }
    try { await api.recordTtrpgOpenNarrativeMemoryV1(input) } catch { rejected = true } finally { db.ttrpgNarrativeMemories.add = add }
    if (!rejected || JSON.stringify(await api.readProductRuntimeState(f.sessionId)) !== JSON.stringify(before)
      || await db.ttrpgNarrativeMemories.count() !== 0) throw new Error('Actual transaction did not roll back')
    const event = await api.recordTtrpgOpenNarrativeMemoryV1(input)
    if ((await api.recordTtrpgOpenNarrativeMemoryV1(input)).id !== event.id) throw new Error('Duplicate confirmation')
    const other = (await db.ttrpgSessionParticipants.where('sessionId').equals(f.sessionId).toArray()).find((s: any) => s.actorKey === 'companion.1')
    if ((await api.readTtrpgOpenNarrativeMemoriesV1({ scope: f.scope, sessionId: f.sessionId, viewerKey: other.viewerKey })).entries.length) throw new Error('Private memory leaked')
    const excluded = await api.branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: event.sequence - 1, title: '确认之前的分支' })
    if (await db.ttrpgNarrativeMemories.where('sessionId').equals(excluded.id).count()) throw new Error('Cloned future confirmation')
    const child = await api.branchProductRuntimeSession({ parentSessionId: f.sessionId, throughSequence: event.sequence, title: '有记忆的原生分支' })
    const state = await api.readProductRuntimeState(child.id)
    await api.completeTtrpgOpenSessionZeroV1({ ...await h.openEnvelopeV1(child.id, 'memory.native.child.zero'), viewerKey: h.OPEN_HUMAN_VIEWER,
      acceptedItemKeys: state.ttrpg.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    await api.deleteProductRuntimeSession(f.sessionId)
    const row = (await db.ttrpgNarrativeMemories.where('sessionId').equals(child.id).toArray())[0]
    if (row.sourceSessionId !== null || await db.agentRuns.count() !== runCount) throw new Error('Origin locator or model count changed')
    return { scope: f.scope, sessionId: child.id, viewerKey: h.OPEN_HUMAN_VIEWER, summary: draft.summary, childTitle: child.title }
  })
  await page.reload()
  const result = await page.evaluate(async fixture => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const backup = await importer('/storyforge/src/lib/export/json-export.ts')
    const { resolveScope } = await importer('/storyforge/src/lib/workspace/scope.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const original = await api.readTtrpgOpenNarrativeMemoriesV1(fixture)
    const importedEntries = []
    let afterFirstWrite = []
    let projectId = fixture.scope.projectId
    for (let generation = 0; generation < 2; generation++) {
      projectId = await backup.importProjectJSON(await backup.exportProjectJSON(projectId))
      const child = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find((s: any) => s.title === fixture.childTitle)
      const scope = await resolveScope({ scope: { projectId, worldId: child.worldId, workId: child.workId } })
      importedEntries.push((await api.readTtrpgOpenNarrativeMemoriesV1({ scope, sessionId: child.id, viewerKey: fixture.viewerKey })).entries)
      if (generation === 0) {
        const version = await api.readProductRuntimeStateVersion(child.id)
        await api.recordTtrpgOpenNarrativeMemoryV1({ sessionId: child.id, commandId: 'memory.native.restored.confirm',
          baseSequence: version.sequence, baseStateHash: version.stateHash, viewerKey: fixture.viewerKey,
          draft: { revisionKey: 'memory.native.restored', observerKey: 'hero', reliability: 'belief', audience: 'private', knownBy: ['hero'],
            summary: '我在恢复后补写的记忆。', fromEventSequence: 1, toEventSequence: version.sequence } })
        afterFirstWrite = (await api.readTtrpgOpenNarrativeMemoriesV1({ scope, sessionId: child.id, viewerKey: fixture.viewerKey })).entries
      }
    }
    return { original: original.entries, originalAgain: (await api.readTtrpgOpenNarrativeMemoriesV1(fixture)).entries, importedEntries, afterFirstWrite }
  }, fixture)
  expect(result.original).toHaveLength(1)
  expect(result.original[0]).toMatchObject({ summary: fixture.summary, reliability: 'belief', historical: true, noMechanicalAuthority: true, noKnowledgeGrant: true })
  expect(result.importedEntries[0]).toEqual(result.original)
  expect(result.afterFirstWrite).toHaveLength(2)
  expect(result.importedEntries[1]).toEqual(result.afterFirstWrite)
  expect(result.originalAgain).toEqual(result.original)
  expect(modelRequests).toEqual([])
})
