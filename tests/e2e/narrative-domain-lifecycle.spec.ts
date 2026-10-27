import { expect, test } from '@playwright/test'

// NW-1B exposes a headless author-confirmation boundary. This verifies native
// IndexedDB transactions and reload/portable recovery, not an unbuilt review UI.
test('narrative confirmation survives reload and isolated restore; deletion keeps evidence tombstones and old release', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await page.goto('./world/worlds')
  const prepared = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { createWorkspace } = await imp('/storyforge/src/lib/workspace/create-workspace.ts')
    const { stampNewRecord } = await imp('/storyforge/src/lib/workspace/scope.ts')
    const { createWorldRevision, publishWorldRevision } = await imp('/storyforge/src/lib/world-engine/releases.ts')
    const { captureNarrativeDomainV1, hashNarrativeDomainSourceV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-capture.ts')
    const { confirmNarrativeDomainAnnotationsV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-authoring.ts')
    const { projectNarrativeDomainsV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-projection.ts')
    const { hashNarrativeBytesV1 } = await imp('/storyforge/src/lib/world-engine/narrative-json.ts')
    const { deriveExportProjectJSON } = await imp('/storyforge/src/lib/export/registry-export.ts')
    const created = await createWorkspace({ name: 'NW-1B 浏览器隔离验证', genres: [], description: '', status: 'drafting',
      targetWordCount: 1000, enableMultiWorld: false }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
    const { scope } = created, now = Date.now()
    const input = { scope, owner: { kind: 'work', workCode: created.work.code }, branchKey: 'canon' }
    const characterId = await db.characters.add(stampNewRecord(scope, 'characters', {
      name: '递信人', shortDescription: '保留角色原始档案', roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral',
      background: '', personality: '', createdAt: now, updatedAt: now,
    }, { owner: 'world' }))
    const character = await db.characters.get(characterId)
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      parentId: null, type: 'chapter', title: '第一章', summary: '', order: 0, createdAt: now, updatedAt: now,
    }, { owner: 'work' }))
    const content = '递信人抵达驿站。\r\n她说：“信件已经送到。”'
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
      outlineNodeId, title: '第一章', content, summary: '', status: 'draft', order: 0, wordCount: 25,
      notes: '', createdAt: now, updatedAt: now,
    }, { owner: 'work' }))
    const chapter = await db.chapters.get(chapterId)
    const eventId = await db.storyTimelineEvents.add(stampNewRecord(scope, 'storyTimelineEvents', {
      title: '送达', description: '信件送达驿站', chapterId, importance: 1, order: 0, createdAt: now, updatedAt: now,
    }, { owner: 'work' }))
    const event = await db.storyTimelineEvents.get(eventId)
    const revision = await createWorldRevision({ scope, label: '注释前 v3' })
    const release = await publishWorldRevision(revision.id)
    const visibility = { class: 'public', audienceKeys: [], policyVersion: 'browser-author-v1' }
    const confirm = async (table: string, recordId: number, annotations: unknown) => {
      const snapshot = await captureNarrativeDomainV1(input)
      const row = snapshot.rows.get(table).find((item: { id: number }) => item.id === recordId)
      return confirmNarrativeDomainAnnotationsV1({ scope, table, recordId, annotations,
        expectedSourceHash: await hashNarrativeDomainSourceV1(snapshot, table, row) })
    }
    await confirm('characters', characterId, { narrativeVisibilityV1: visibility })
    const hash = await hashNarrativeBytesV1(content)
    const proof = { evidenceKey: 'chapter', source: { chapterId, sourceUid: chapter.ragDocumentId }, fieldPointer: '/content',
      sourceContentHash: hash, normalizationVersion: 'raw-utf8-v1', start: 0, end: new TextEncoder().encode(content).length,
      spanHash: hash, supportRole: 'supports' }
    await confirm('storyTimelineEvents', eventId, { narrativeVisibilityV1: visibility, narrativeEvidenceV1: [proof],
      narrativeEventV1: { eventType: 'action', participants: [{ entity: { characterId, sourceUid: character.ragDocumentId }, role: 'actor' }],
        locations: [], propositions: [], effects: [], communication: null, observer: null, before: [] },
      narrativeTimeV1: { occurred: null, valid: null, acquiredAt: null, disclosedAt: [],
        narratedAt: { chapter: { chapterId, sourceUid: chapter.ragDocumentId }, spanStart: 0 } },
    })
    await confirm('chapters', chapterId, { narrativeVisibilityV1: visibility, narrativeDisclosuresV1: [{
      semanticSubKey: 'sub:v1:00000000-0000-4000-8000-000000000001',
      subjects: [{ kind: 'event', source: { storyEventId: eventId, sourceUid: event.ragDocumentId }, subKey: 'root' }],
      audienceKeys: ['reader'], evidenceKey: 'chapter', narrativeEvidenceV1: [{ ...proof, source: { self: true } }],
    }] })
    const projection = await projectNarrativeDomainsV1(input)
    return { input, characterId, characterUid: character.ragDocumentId, eventId, releaseId: release.id,
      releaseBytes: release.manifestJson, root: projection.bundle.semanticRootHash,
      kinds: projection.bundle.records.map((record: { kind: string }) => record.kind).sort(),
      backup: await deriveExportProjectJSON(scope.projectId) }
  })
  expect(prepared.kinds).toEqual(['disclosure', 'entity', 'event'])
  await page.reload()
  const afterReload = await page.evaluate(async input => {
    const imp = new Function('p', 'return import(p)')
    const { projectNarrativeDomainsV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-projection.ts')
    return (await projectNarrativeDomainsV1(input)).bundle.semanticRootHash
  }, prepared.input)
  expect(afterReload).toBe(prepared.root)

  const isolated = await browser.newContext()
  try {
    const restoredPage = await isolated.newPage()
    await restoredPage.goto(page.url())
    const restored = await restoredPage.evaluate(async backup => {
      const imp = new Function('p', 'return import(p)')
      const { db } = await imp('/storyforge/src/lib/db/schema.ts')
      const { deriveImportProjectJSON } = await imp('/storyforge/src/lib/export/registry-import.ts')
      const { projectNarrativeDomainsV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-projection.ts')
      if (await db.projects.count()) throw new Error('Restore must start in an empty browser context')
      const projectId = await deriveImportProjectJSON(backup), project = await db.projects.get(projectId)
      const work = await db.works.get(project.activeWorkId)
      const input = { scope: { projectId, worldId: project.activeWorldId, workId: work.id },
        owner: { kind: 'work', workCode: work.code }, branchKey: 'canon' }
      return { root: (await projectNarrativeDomainsV1(input)).bundle.semanticRootHash,
        releaseBytes: (await db.worldReleases.where('projectId').equals(projectId).first()).manifestJson }
    }, prepared.backup)
    expect(restored.root).toBe(prepared.root)
    expect(restored.releaseBytes).toBe(prepared.releaseBytes)
  } finally { await isolated.close() }

  const deleted = await page.evaluate(async prepared => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { useCharacterStore } = await imp('/storyforge/src/stores/character.ts')
    const { projectNarrativeDomainsV1 } = await imp('/storyforge/src/lib/world-engine/narrative-domain-projection.ts')
    const { deriveExportProjectJSON } = await imp('/storyforge/src/lib/export/registry-export.ts')
    await useCharacterStore.getState().deleteCharacter(prepared.characterId)
    const event = await db.storyTimelineEvents.get(prepared.eventId)
    const result = await projectNarrativeDomainsV1(prepared.input)
    const backup = await deriveExportProjectJSON(prepared.input.scope.projectId)
    return { reference: event.narrativeEventV1.participants[0].entity,
      kinds: result.bundle.records.map((record: { kind: string }) => record.kind), backupVersion: backup.version,
      releaseBytes: (await db.worldReleases.get(prepared.releaseId)).manifestJson }
  }, prepared)
  expect(deleted.reference).toEqual({ characterId: null, sourceUid: prepared.characterUid })
  expect(deleted.kinds).toEqual([])
  expect(deleted.backupVersion).toBe(17)
  expect(deleted.releaseBytes).toBe(prepared.releaseBytes)
})
