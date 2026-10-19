import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import * as readiness from '../../src/lib/avg/sound-production-brief'
import { avgSoundRuntimeStageFixtureV1, finishAvgSoundRuntimeFixtureV1 } from '../helpers/avg-sound-runtime-fixture'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { parseAvgAuthorStageV1, parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { keepAvgGeneratedSoundStageDraftV1, prepareAvgAssemblyBriefV1, startAvgAssemblyV1, runAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { confirmNativeAvgInputs } from '../helpers/avg-production-assembly-fixture'
import { readAvgInheritedStageSoundsV1 } from '../../src/lib/avg/stage-sound-sources'
import { parseAvgGeneratedSoundSourceV1 } from '../../src/lib/avg/stage-sound-source-contract'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import { readProductProductionDetailsV1, recoverImportedProductProductionProofsV1 } from '../../src/lib/product-production/service'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { assertAvgSoundBuildWriteEnabledV1 } from '../../src/lib/avg/sound-write-guard'
import { reconcileCommercialProductBuildReadinessV1 } from '../../src/lib/product-production/quality-receipts'

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1', apiKey: 'isolated-fixture-no-external-account', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.spyOn(readiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  // Controlled DOM decoder only; actual native decoding is a separate E2E gate.
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ measuredAt: Date.now(), environment: input.environment,
    assets: input.assets.map(a => ({ assetKey: a.assetKey, contentHash: a.contentHash, mimeType: a.mimeType, mediaClass: 'audio', status: 'decoded',
      decodedWidth: null, decodedHeight: null, decodedDurationMs: a.mimeType === 'audio/wav' ? 12000 : 500, decodedHasAlpha: null,
      decodedChannelCount: a.mimeType === 'audio/wav' ? 2 : 1, decodedSampleRateHz: 48000, integratedLufs: -18, truePeakDbtp: -12,
      loopSeamDbfs: -40, policyFailures: [], failureCode: null })) }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

async function retained() {
  const s = await avgSoundRuntimeStageFixtureV1(), details = await finishAvgSoundRuntimeFixtureV1(s), build = details.build!
  const draft = await readAvgDraftV1(s.scope), workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  workspace.basePreviewHash = build.previewHash
  workspace.soundProduction = { schema: 'storyforge.avg.sound-production-draft', version: 1, scope: s.brief.avgSoundPlanning!.scope }
  const saved = await saveAvgAuthorWorkspaceV1(s.scope, draft.revision, workspace)
  const next = await keepAvgGeneratedSoundStageDraftV1({ scope: s.scope, productionId: s.productionId, expectedBuildId: build.id!, expectedDraftRevision: saved.revision })
  const payload = parseAvgAuthorWorkspaceV1(next.editorJson)
  const input = { scope: s.scope, productionKey: details.production.productionKey, targetBuildNumber: build.buildNumber + 1,
    worldContentHash: s.brief.source.worldContentHash, payload: payload.presentation, scripts: payload.scripts }
  return { ...s, old: build, next, workspace: payload, input }
}

describe('AVG original sound stage inheritance through real governed commands', () => {
  it('keeps exact sources, edits dialogue, compiles a fresh adopted Preview with zero further HTTP, retaining the original Build/Blob/receipts', async () => {
    const s = await retained(), original = canonicalProductProductionJsonV2(s.old), calls = s.fetcher.mock.calls.length
    expect(s.workspace).not.toHaveProperty('soundProduction'); expect(s.workspace.presentation.inheritedSounds).toHaveLength(2)
    s.workspace.scripts[0]!.lines[0]!.text += ' 新版对白不改变声音播放用途。'
    const saved = await saveAvgAuthorWorkspaceV1(s.scope, s.next.revision, s.workspace)
    const prepared = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })
    expect(prepared.brief!.briefJson).not.toContain('avgSoundPlanning')
    const started = await startAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, expectedBriefHash: prepared.brief!.briefHash })
    const id = started.build!.id!
    await confirmNativeAvgInputs({ ...s, details: started, buildId: id })
    await runAvgAssemblyV1({ scope: s.scope, productionId: s.productionId, signal: new AbortController().signal })
    const current = (await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])).build!
    expect(current.id).toBe(id); expect(current.previewHash).toBeTruthy(); expect(current.packageHash).not.toBe(s.old.packageHash)
    expect(s.fetcher.mock.calls).toHaveLength(calls)
    expect(canonicalProductProductionJsonV2(await db.productBuilds.get(s.old.id!))).toBe(original)
    const media = await db.productBuildArtifacts.where('buildId').equals(id).filter(r => r.artifactKey.startsWith('avg.media.') && r.kind === 'audio').toArray()
    expect(media).toHaveLength(2)
    for (const row of media) {
      const rights = JSON.parse(row.rightsJson)
      expect(rights.origin).toBe('author-inherited-original-sound')
      const source = rights.inheritedStageSoundSource.source
      const originalRaw = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.old.id!, source.raw.artifactKey]).first()
      expect(row.blobObjectId).toBe(originalRaw!.blobObjectId); expect(row.contentHash).toBe(originalRaw!.contentHash)
    }
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    await expect(assertAvgSoundBuildWriteEnabledV1(s.scope, id, JSON.parse(prepared.brief!.briefJson))).rejects.toThrow('尚未启用')
    await expect(reconcileCommercialProductBuildReadinessV1({ scope: s.scope, productBuildId: id })).rejects.toThrow('尚未启用')
    expect((await readAvgInheritedStageSoundsV1(s.input)).size).toBe(2)
  }, 90_000)

  it('preserves absent old stage bytes and rejects aliases, local IDs, duplicate sources and mismatched original assets', async () => {
    const s = await retained(), stage = structuredClone(s.workspace.presentation), entry = stage.inheritedSounds![0]!
    delete stage.inheritedSounds
    expect(canonicalProductProductionJsonV2(parseAvgAuthorStageV1(stage))).toBe(canonicalProductProductionJsonV2(stage))
    for (const value of [{ ...entry.source, buildId: 1 }, { ...entry.source, review: undefined },
      { ...entry.source, choice: { ...entry.source.choice, artifactKey: 'avg.sound.choice.other' } }]) expect(() => parseAvgGeneratedSoundSourceV1(value)).toThrow()
    expect(() => parseAvgAuthorStageV1({ ...stage, inheritedSounds: [entry, entry] })).toThrow()
    expect(() => parseAvgAuthorStageV1({ ...stage, stage: { ...stage.stage, assets: [] }, inheritedSounds: [entry] })).toThrow()
  }, 90_000)

  it('refuses changed cue/scene/channel or old proof, current/future Build, cross-World and cross-Work sources without a provider retry', async () => {
    const s = await retained(), calls = s.fetcher.mock.calls.length
    for (const mutate of [
      (input: typeof s.input) => { input.payload.stage.cues.find(c => c.assetKey === s.workspace.presentation.inheritedSounds![0]!.assetKey)!.volume += .1 },
      (input: typeof s.input) => { input.scripts.find(script => script.sceneKey === 'desk')!.sceneKey = 'other' },
      (input: typeof s.input) => { input.payload.inheritedSounds![0]!.source.raw.rightsHash = '0'.repeat(64) },
      (input: typeof s.input) => { input.worldContentHash = '0'.repeat(64) },
      (input: typeof s.input) => { input.targetBuildNumber = s.old.buildNumber },
      (input: typeof s.input) => { input.scope.workId += 1000 },
    ]) { const input = structuredClone(s.input); mutate(input); await expect(readAvgInheritedStageSoundsV1(input)).rejects.toThrow() }
    expect(s.fetcher.mock.calls).toHaveLength(calls)
    expect((await readAvgInheritedStageSoundsV1(s.input)).size).toBe(2)
  }, 90_000)

  it('retains portable sources and original bytes through full remap and deleting only the imported copy', async () => {
    const s = await retained(), backup = await exportProjectJSON(s.scope.projectId), copyId = await importProjectJSON(backup)
    const copy = (await db.productProductions.where('projectId').equals(copyId).first())!
    if (!copy.workId || !copy.worldId) throw new Error('missing imported owner')
    const scope = { projectId: copyId, workId: copy.workId, worldId: copy.worldId }
    await expect(readAvgInheritedStageSoundsV1({ ...s.input, scope })).rejects.toThrow()
    await recoverImportedProductProductionProofsV1({ scope, productionId: copy.id! })
    const copied = parseAvgAuthorWorkspaceV1((await readAvgDraftV1(scope)).editorJson)
    expect(copied.presentation.inheritedSounds).toEqual(s.workspace.presentation.inheritedSounds)
    expect((await readAvgInheritedStageSoundsV1({ ...s.input, scope, payload: copied.presentation })).size).toBe(2)
    await deleteWork(copy.workId)
    expect((await readAvgInheritedStageSoundsV1(s.input)).size).toBe(2)
  }, 90_000)
})
