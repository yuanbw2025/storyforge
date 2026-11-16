import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { adopt } from '../../src/lib/registry/adopt'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { inspectProjectBackup } from '../../src/lib/export/backup-trust'
import { readLocationRecordTagsV1, readLocationTagsV1 } from '../../src/lib/types/location'

// Exact synthetic backups from the pre-fix public adopt → export reproduction at
// 8cb0aee348fe69cc0ecc6cb412544beda29de135; no direct-DB-created domain rows.
// Location wire SHA256 a8010c1025cef4fb0df8cd6826aaa1cb66f4d01a04500eef036a672ca7ea8c4b
const CAPTURED_LOCATION_WIRE = "{\"version\":18,\"exportedAt\":1793716302401,\"project\":{\"workspaceUid\":\"WS-5939e13f-6d2b-4f1b-8be0-b3f4a35c5ce0\",\"workspacePurpose\":\"independent-work\",\"name\":\"129 name-only adoption synthetic probe\",\"createdAt\":1793716302386,\"updatedAt\":1793716302386,\"_activeWorldExportId\":0,\"_activeWorkExportId\":0},\"extensionProfiles\":[],\"extensionRecords\":[],\"extensionContracts\":[],\"extensionOperations\":[],\"worlds\":[{\"identityKind\":\"workspace-scope\",\"code\":\"S-0SDGS2-HB8XTV\",\"name\":\"129 name-only adoption synthetic probe\",\"description\":\"\",\"currentVersion\":0,\"createdAt\":1793716302386,\"updatedAt\":1793716302386,\"_exportId\":0}],\"works\":[{\"code\":\"WORK-6f21a385-3207-42f9-b030-847ada3863f6\",\"kind\":\"novel\",\"novelProfile\":\"long\",\"title\":\"129 name-only adoption synthetic probe\",\"description\":\"\",\"genres\":[\"fantasy\"],\"status\":\"drafting\",\"targetWordCount\":100000,\"currentWordCount\":0,\"includeCultivationProgressInAI\":false,\"postAdoptionPolicy\":\"suggest\",\"postAdoptionTaskTypes\":[\"organization\",\"memory\",\"retrieval\",\"consistency\"],\"postAdoptionBudget\":{\"maxModelCalls\":2,\"maxInputTokens\":48000,\"maxOutputTokens\":16000,\"maxCostUsd\":0.25,\"allowUnknownCost\":false},\"createdAt\":1793716302386,\"updatedAt\":1793716302386,\"_worldExportId\":0,\"_activeCharacterDrivenPlanExportId\":null,\"_activeNarrativeModuleExportId\":null,\"_exportId\":0}],\"shortNovelProductions\":[],\"creationReleases\":[],\"creationReleaseAssets\":[],\"adaptationProjects\":[],\"adaptationSourceUnits\":[],\"adaptationSourceFacts\":[],\"adaptationCausalEdges\":[],\"adaptationDecisions\":[],\"screenplayBeats\":[],\"screenplaySceneCards\":[],\"screenplayReviewIssues\":[],\"screenplayScenes\":[],\"comicScriptBeats\":[],\"comicPagePlans\":[],\"comicReviewIssues\":[],\"comicPages\":[],\"comicPanels\":[],\"comicVisualSubjects\":[],\"comicMediaAssets\":[],\"avgDraftMedia\":[],\"aiTownAuthoringDrafts\":[],\"ttrpgAuthoringDrafts\":[],\"avgAuthoringDrafts\":[],\"chatAuthoringDrafts\":[],\"motionDramaProductions\":[],\"motionDramaSeriesBibles\":[],\"motionDramaEpisodes\":[],\"motionDramaScriptScenes\":[],\"motionDramaAssetSubjects\":[],\"motionDramaAssetVersions\":[],\"motionDramaAssetBindings\":[],\"motionDramaShots\":[],\"motionDramaShotReferences\":[],\"motionDramaPromptOverrides\":[],\"motionDramaPromptPacks\":[],\"motionDramaReviewIssues\":[],\"mediaBlobObjects\":[],\"workCharacterBindings\":[],\"worldRevisions\":[],\"worldReleases\":[],\"worldSourceReceipts\":[],\"worldDerivations\":[],\"worldviews\":[],\"storyCores\":[],\"powerSystems\":[],\"cultivationSystems\":[],\"cultivationProgress\":[],\"geographies\":[],\"histories\":[],\"worldNodes\":[],\"historicalTimelineEvents\":[],\"historicalKeywords\":[],\"importantLocations\":[{\"name\":\"仅有名称的地点\",\"createdAt\":1793716302393,\"updatedAt\":1793716302393,\"ragDocumentId\":\"res:v1:location:890df54c-e772-420d-a7c5-935827a0435e\",\"_parentExportId\":null,\"_exportId\":0,\"_worldOwnerExportId\":0}],\"worldRulesProfiles\":[],\"characters\":[],\"characterRelations\":[],\"outlineNodes\":[],\"chapters\":[],\"detailedOutlines\":[],\"emotionBeatCards\":[],\"foreshadows\":[],\"storyArcs\":[],\"narrativeModules\":[],\"narrativeNodes\":[],\"narrativeBeats\":[],\"narrativeChoices\":[],\"productMediaAssets\":[],\"productMediaBlobs\":[],\"productReleases\":[],\"characterDrivenPlans\":[],\"storylineProgress\":[],\"storylineCrossings\":[],\"stateCards\":[],\"itemLedger\":[],\"storyTimelineEvents\":[],\"notes\":[],\"creativeRules\":[],\"codexCategories\":[],\"codexEntries\":[],\"userStyleProfiles\":[],\"inspirationWorkspaces\":[],\"agentConversations\":[],\"agentEvents\":[],\"agentRuns\":[],\"agentRunEvents\":[],\"agentRunCheckpoints\":[],\"agentRunArtifacts\":[],\"nodeFlows\":[],\"nodeRuns\":[],\"productRuntimeSessions\":[],\"productRuntimeEvents\":[],\"productRuntimeCheckpoints\":[],\"temporalFacts\":[],\"knowledgeLedger\":[],\"worldGroups\":[],\"worldGroupLinks\":[],\"references\":[],\"referenceAnalysisRuns\":[],\"referenceChunkAnalysis\":[],\"productProductions\":[],\"productProductionBriefs\":[],\"productProductionCommands\":[],\"productBuilds\":[],\"productQualityGateReceipts\":[],\"productBuildArtifacts\":[],\"ttrpgRulePacks\":[],\"ttrpgNarrativeMemories\":[],\"ttrpgSessionParticipants\":[],\"ttrpgRuntimeAssetRequests\":[],\"ownership\":{\"contractVersion\":1,\"worldExportId\":0,\"workExportId\":0}}"
// Chapter wire SHA256 73a4ca842244d2f14be6096f5ac5e66efd2c47ba95c88e6a60e4ae1536499e43
const CAPTURED_CHAPTER_WIRE = "{\"version\":18,\"exportedAt\":1793716302492,\"project\":{\"workspaceUid\":\"WS-3e69e680-0875-46f9-adf9-b8c0b46b68c5\",\"workspacePurpose\":\"independent-work\",\"name\":\"129 missing chapter content public adoption synthetic probe\",\"createdAt\":1793716302486,\"updatedAt\":1793716302486,\"_activeWorldExportId\":0,\"_activeWorkExportId\":0},\"extensionProfiles\":[],\"extensionRecords\":[],\"extensionContracts\":[],\"extensionOperations\":[],\"worlds\":[{\"identityKind\":\"workspace-scope\",\"code\":\"S-0SDGUU-XUHY81\",\"name\":\"129 missing chapter content public adoption synthetic probe\",\"description\":\"\",\"currentVersion\":0,\"createdAt\":1793716302486,\"updatedAt\":1793716302486,\"_exportId\":0}],\"works\":[{\"code\":\"WORK-aea18e64-7cff-4f83-8da4-fa40205f276e\",\"kind\":\"novel\",\"novelProfile\":\"long\",\"title\":\"129 missing chapter content public adoption synthetic probe\",\"description\":\"\",\"genres\":[\"fantasy\"],\"status\":\"drafting\",\"targetWordCount\":100000,\"currentWordCount\":0,\"includeCultivationProgressInAI\":false,\"postAdoptionPolicy\":\"suggest\",\"postAdoptionTaskTypes\":[\"organization\",\"memory\",\"retrieval\",\"consistency\"],\"postAdoptionBudget\":{\"maxModelCalls\":2,\"maxInputTokens\":48000,\"maxOutputTokens\":16000,\"maxCostUsd\":0.25,\"allowUnknownCost\":false},\"createdAt\":1793716302486,\"updatedAt\":1793716302486,\"_worldExportId\":0,\"_activeCharacterDrivenPlanExportId\":null,\"_activeNarrativeModuleExportId\":null,\"_exportId\":0}],\"shortNovelProductions\":[],\"creationReleases\":[],\"creationReleaseAssets\":[],\"adaptationProjects\":[],\"adaptationSourceUnits\":[],\"adaptationSourceFacts\":[],\"adaptationCausalEdges\":[],\"adaptationDecisions\":[],\"screenplayBeats\":[],\"screenplaySceneCards\":[],\"screenplayReviewIssues\":[],\"screenplayScenes\":[],\"comicScriptBeats\":[],\"comicPagePlans\":[],\"comicReviewIssues\":[],\"comicPages\":[],\"comicPanels\":[],\"comicVisualSubjects\":[],\"comicMediaAssets\":[],\"avgDraftMedia\":[],\"aiTownAuthoringDrafts\":[],\"ttrpgAuthoringDrafts\":[],\"avgAuthoringDrafts\":[],\"chatAuthoringDrafts\":[],\"motionDramaProductions\":[],\"motionDramaSeriesBibles\":[],\"motionDramaEpisodes\":[],\"motionDramaScriptScenes\":[],\"motionDramaAssetSubjects\":[],\"motionDramaAssetVersions\":[],\"motionDramaAssetBindings\":[],\"motionDramaShots\":[],\"motionDramaShotReferences\":[],\"motionDramaPromptOverrides\":[],\"motionDramaPromptPacks\":[],\"motionDramaReviewIssues\":[],\"mediaBlobObjects\":[],\"workCharacterBindings\":[],\"worldRevisions\":[],\"worldReleases\":[],\"worldSourceReceipts\":[],\"worldDerivations\":[],\"worldviews\":[],\"storyCores\":[],\"powerSystems\":[],\"cultivationSystems\":[],\"cultivationProgress\":[],\"geographies\":[],\"histories\":[],\"worldNodes\":[],\"historicalTimelineEvents\":[],\"historicalKeywords\":[],\"importantLocations\":[],\"worldRulesProfiles\":[],\"characters\":[],\"characterRelations\":[],\"outlineNodes\":[{\"summary\":\"\",\"type\":\"chapter\",\"title\":\"真实章纲\",\"createdAt\":1793716302486,\"updatedAt\":1793716302486,\"ragDocumentId\":\"res:v1:outline-node:9730419a-f722-48a3-a390-3c70983ef10f\",\"_parentExportId\":null,\"_worldGroupExportId\":null,\"_exportId\":0,\"_workOwnerExportId\":0}],\"chapters\":[{\"title\":\"缺省正文\",\"createdAt\":1793716302487,\"updatedAt\":1793716302487,\"ragDocumentId\":\"res:v1:chapter:34768679-af13-45b5-9219-c97f449a5c2d\",\"_outlineExportId\":0,\"_perspectiveCharacterExportId\":null,\"_workOwnerExportId\":0},{\"title\":\"明确空正文\",\"createdAt\":1793716302488,\"updatedAt\":1793716302488,\"ragDocumentId\":\"res:v1:chapter:8cab08cd-69f3-4213-899e-763a90f533fb\",\"_outlineExportId\":0,\"_perspectiveCharacterExportId\":null,\"_workOwnerExportId\":0}],\"detailedOutlines\":[],\"emotionBeatCards\":[],\"foreshadows\":[],\"storyArcs\":[],\"narrativeModules\":[],\"narrativeNodes\":[],\"narrativeBeats\":[],\"narrativeChoices\":[],\"productMediaAssets\":[],\"productMediaBlobs\":[],\"productReleases\":[],\"characterDrivenPlans\":[],\"storylineProgress\":[],\"storylineCrossings\":[],\"stateCards\":[],\"itemLedger\":[],\"storyTimelineEvents\":[],\"notes\":[],\"creativeRules\":[],\"codexCategories\":[],\"codexEntries\":[],\"userStyleProfiles\":[],\"inspirationWorkspaces\":[],\"agentConversations\":[],\"agentEvents\":[],\"agentRuns\":[],\"agentRunEvents\":[],\"agentRunCheckpoints\":[],\"agentRunArtifacts\":[],\"nodeFlows\":[],\"nodeRuns\":[],\"productRuntimeSessions\":[],\"productRuntimeEvents\":[],\"productRuntimeCheckpoints\":[],\"temporalFacts\":[],\"knowledgeLedger\":[],\"worldGroups\":[],\"worldGroupLinks\":[],\"references\":[],\"referenceAnalysisRuns\":[],\"referenceChunkAnalysis\":[],\"productProductions\":[],\"productProductionBriefs\":[],\"productProductionCommands\":[],\"productBuilds\":[],\"productQualityGateReceipts\":[],\"productBuildArtifacts\":[],\"ttrpgRulePacks\":[],\"ttrpgNarrativeMemories\":[],\"ttrpgSessionParticipants\":[],\"ttrpgRuntimeAssetRequests\":[],\"ownership\":{\"contractVersion\":1,\"worldExportId\":0,\"workExportId\":0}}"

beforeEach(async () => {
  expect(globalThis.indexedDB).toBe(fakeIndexedDB)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('129 isolated regression forbids network') }))
  await db.delete(); await db.open()
})
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); db.close() })

const create = (name: string) => createWorkspace({
  name, description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000,
}, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
const counts = () => Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))

function capturedBackup(raw: string, version: number) {
  const wire: unknown = JSON.parse(raw)
  if (!wire || typeof wire !== 'object' || Array.isArray(wire)) throw new Error('invalid captured synthetic backup')
  Reflect.set(wire, 'version', version)
  for (const spec of PROJECT_TABLES) if (spec.exportable && (
    (spec.introducedBackupVersion ?? 1) > version || spec.optionalInBackupVersions?.includes(version)
  )) Reflect.deleteProperty(wire, spec.name)
  return wire
}

it('public name-only location adoption must produce a backup accepted by its actual restore boundary', async () => {
  const owned = await create('129 actual new-row defaults')
  const location = await adopt({ projectId: owned.scope.projectId, scope: owned.scope,
    target: 'importantLocations', mode: 'add', data: { name: '仅有名称的地点' } })
  expect(location.written).toHaveLength(1)
  const stored = await db.importantLocations.get(location.written[0].id)
  expect(stored?.tags).toBe('[]')
  const outline = await adopt({ projectId: owned.scope.projectId, scope: owned.scope,
    target: 'outlineNodes', mode: 'add', data: { type: 'chapter', title: '真实章纲', parentId: null } })
  expect(outline.written).toHaveLength(1)
  for (const data of [
    { outlineNodeId: outline.written[0].id, title: '缺省正文' },
    { outlineNodeId: outline.written[0].id, title: '明确空正文', content: '' },
  ]) {
    const chapter = await adopt({ projectId: owned.scope.projectId, scope: owned.scope,
      target: 'chapters', mode: 'add', data })
    expect(chapter.written).toHaveLength(1)
    expect((await db.chapters.get(chapter.written[0].id))?.content).toBe('')
  }
  const backup = await exportProjectJSON(owned.scope.projectId)
  expect(inspectProjectBackup(backup).valid).toBe(true)
  for (const operation of [importProjectJSON, deriveImportProjectJSON]) {
    const id = await operation(backup)
    expect((await db.importantLocations.where('projectId').equals(id).first())?.tags).toBe('[]')
    expect((await db.chapters.where('projectId').equals(id).toArray()).map(row => row.content)).toEqual(['', ''])
  }
})

it('creation defaults never overwrite an existing location merge or chapter partial update', async () => {
  const owned = await create('129 preserve actual existing author content')
  const location = await adopt({ projectId: owned.scope.projectId, scope: owned.scope,
    target: 'importantLocations', mode: 'add', data: { name: '已有地点', tags: ['港口', '城市'], description: '原地点正文' } })
  expect(location.written).toHaveLength(1)
  await adopt({ projectId: owned.scope.projectId, scope: owned.scope,
    target: 'importantLocations', mode: 'add', data: { name: '已有地点' } })
  const merged = await db.importantLocations.get(location.written[0].id)
  expect(merged?.tags).toBe('["港口","城市"]')
  expect(merged?.description).toBe('原地点正文')
  const outline = await adopt({ projectId: owned.scope.projectId, scope: owned.scope,
    target: 'outlineNodes', mode: 'add', data: { type: 'chapter', title: '原章纲', parentId: null } })
  expect(outline.written).toHaveLength(1)
  const identity = { outlineNodeId: outline.written[0].id, title: '已有章节' }
  const content = '  <p>作者原正文 &amp; 标点。</p>  '
  const chapter = await adopt({ projectId: owned.scope.projectId, scope: owned.scope,
    target: 'chapters', mode: 'add', data: { ...identity, content } })
  expect(chapter.written).toHaveLength(1)
  const storedBefore = await db.chapters.get(chapter.written[0].id)
  if (!storedBefore) throw new Error('publicly adopted chapter missing')
  expect(storedBefore.content).toBe(content.trim())
  for (const data of [identity, { ...identity, content: '' }]) await adopt({
    projectId: owned.scope.projectId, scope: owned.scope, target: 'chapters', mode: 'add', data,
  })
  expect((await db.chapters.get(chapter.written[0].id))?.content).toBe(storedBefore.content)
  expect(await db.chapters.where('projectId').equals(owned.scope.projectId).count()).toBe(1)
})

it('present invalid tags and chapter bodies are rejected rather than hidden by new-row defaults', async () => {
  const owned = await create('129 explicit bad values remain rejected')
  const outline = await adopt({ projectId: owned.scope.projectId, scope: owned.scope,
    target: 'outlineNodes', mode: 'add', data: { type: 'chapter', title: '真实章纲', parentId: null } })
  expect(outline.written).toHaveLength(1)
  for (const tags of [undefined, null, {}, 7, [7], 'null', '{broken', '["未登记"]', '["港口","港口"]']) {
    const before = await counts()
    const result = await adopt({ projectId: owned.scope.projectId, scope: owned.scope,
      target: 'importantLocations', mode: 'add', data: { name: '不得默认修好', tags } })
    expect(result.written).toEqual([])
    expect(result.typeErrors.some(error => error.field === 'tags')).toBe(true)
    expect(await counts()).toEqual(before)
  }
  for (const content of [undefined, null, {}, 7, []]) {
    const before = await counts()
    const result = await adopt({ projectId: owned.scope.projectId, scope: owned.scope,
      target: 'chapters', mode: 'add', data: { outlineNodeId: outline.written[0].id, title: '不得默认修好', content } })
    expect(result.written).toEqual([])
    expect(result.typeErrors.some(error => error.field === 'content')).toBe(true)
    expect(await counts()).toEqual(before)
  }
})

for (const [label, raw] of [['location', CAPTURED_LOCATION_WIRE], ['chapter', CAPTURED_CHAPTER_WIRE]] as const) {
  it.each([14, 15, 16, 17, 18])(`actual captured legacy missing ${label} fields survive v%i restore/derive/reopen without backfill`, async version => {
    const wire = capturedBackup(raw, version)
    const original = JSON.stringify(wire)
    expect(inspectProjectBackup(wire).valid).toBe(true)
    for (const operation of [importProjectJSON, deriveImportProjectJSON]) {
      const id = await operation(wire)
      db.close(); await db.open()
      const rows = label === 'location'
        ? await db.importantLocations.where('projectId').equals(id).toArray()
        : await db.chapters.where('projectId').equals(id).toArray()
      expect(rows).toHaveLength(label === 'location' ? 1 : 2)
      for (const row of rows) expect(Object.prototype.hasOwnProperty.call(row, label === 'location' ? 'tags' : 'content')).toBe(false)
      const exported = await exportProjectJSON(id)
      expect(exported.importantLocations).toEqual(Reflect.get(wire, 'importantLocations'))
      expect(exported.chapters).toEqual(Reflect.get(wire, 'chapters'))
      expect(inspectProjectBackup(exported).valid).toBe(true)
      expect(JSON.stringify(wire)).toBe(original)
    }
  })
}

it('record-level legacy reads leave absence untouched while the value codec remains strict', () => {
  const legacy = { name: '历史地点' }
  const before = JSON.stringify(legacy)
  expect(readLocationRecordTagsV1(legacy)).toEqual([])
  expect(JSON.stringify(legacy)).toBe(before)
  expect(Object.prototype.hasOwnProperty.call(legacy, 'tags')).toBe(false)
  for (const tags of [undefined, null, [], 'null', '{}', '{broken']) {
    expect(() => readLocationRecordTagsV1({ tags })).toThrow('tags')
    expect(() => readLocationTagsV1(tags)).toThrow('tags')
  }
})
