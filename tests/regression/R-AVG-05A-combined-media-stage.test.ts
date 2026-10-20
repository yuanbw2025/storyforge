import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as prototypePolicy from '../../src/lib/avg/prototype-contract'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import { avgCombinedVisualSourceFixtureV1, addCombinedSoundFixtureV1, addCombinedLocalVoiceFixtureV1, combinedDetails } from '../helpers/avg-combined-media-fixture'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import { avgRuntimeStage, avgExecutableModule } from '../../src/lib/avg/executable-module'
import { startProductProductionPreviewV1 } from '../../src/lib/product-production/service'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-commands'
import { commitAvgVoiceCommandV1 } from '../../src/lib/avg/reading-commands'
import { avgCurrentReadingLineV1 } from '../../src/lib/avg/reading-runtime'
import { commitNarrativeChoice, readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { recordProductBuildMainRoutePlaythroughV1 } from '../../src/lib/product-production/quality-receipts'
import { scanAvgPrototypeMediaV1 } from '../../src/lib/avg/prototype-media-scan'
import { prepareProductProductionAdoption, publishProductProductionBuild } from '../../src/lib/product-production/adoption'
import { verifyProductReleaseManifest } from '../../src/lib/product-production/runtime-package'
import { readProductReleaseMediaBytes } from '../../src/lib/product-production/release-media'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

const environment = { browserName: 'isolated-combined-contract', browserVersion: '1',
  platform: 'controlled unavailable DOM decode and ENGINEERING author declarations; no actual art or human hearing', viewport: { width: 1280, height: 720 } }
const actualVerifier = verifier.verifyProductMediaRuntimeUrlsV1
beforeEach(async () => {
  await db.delete(); await db.open()
  for (const name of ['VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', 'VITE_STORYFORGE_AVG_VISUAL_PLANNING', 'VITE_STORYFORGE_AVG_VOICE_PRODUCTION',
    'VITE_STORYFORGE_AVG_SOUND_PREPARATION', 'VITE_STORYFORGE_AVG_SOUND_PRODUCTION']) vi.stubEnv(name, '1')
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://v5-proposal.fixture.invalid/v1',
    apiKey: 'isolated-engineering-no-external-account', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(input => actualVerifier({ ...input, decoder: {
    image: async url => {
      const a = input.assets.find(asset => input.urls[asset.assetKey] === url)
      if (!a || a.width === null || a.height === null) throw new Error('Unexpected original image')
      return { width: a.width, height: a.height, hasAlpha: a.assetKey.includes('.keeper.') }
    },
    audio: async url => {
      const a = input.assets.find(asset => input.urls[asset.assetKey] === url)
      if (!a) throw new Error('Unexpected original audio')
      // Raw producers deliberately have no self-reported duration. Supply only
      // the absent DOM decode for these exact known fixture bytes; the real
      // verifier and PCM/container/source/hash checks remain active.
      const known = a.assetKey === 'sound.desk.bgm' ? { mimeType: 'audio/wav', durationMs: 12000, channelCount: 2, sampleRateHz: 48000 }
        : a.assetKey === 'sound.desk.sfx' ? { mimeType: 'audio/ogg', durationMs: 500, channelCount: 1, sampleRateHz: 48000 }
        : a.assetKey === 'sound.desk.ambience' ? { mimeType: 'audio/ogg', durationMs: 3991, channelCount: 2, sampleRateHz: 48000 }
        : a.assetKey === 'combined.voice.desk' ? { mimeType: 'audio/wav', durationMs: 500, channelCount: 1, sampleRateHz: 16000 } : null
      if (!known || a.mimeType !== known.mimeType) throw new Error('Unexpected original combined audio fixture')
      return { durationMs: known.durationMs, channelCount: known.channelCount, sampleRateHz: known.sampleRateHz,
        integratedLufs: -18, truePeakDbtp: -12, loopSeamDbfs: -40 }
    },
  } }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); db.close() })
type Owner = Pick<Awaited<ReturnType<typeof avgCombinedVisualSourceFixtureV1>>, 'scope' | 'productionId'>
async function command(sessionId: number) {
  const state = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, baseSequence: state.sequence, baseStateHash: state.stateHash, commandId: crypto.randomUUID() }
}
// This contract fixture supplies declared synthetic transport observations.
// Browser Audio ended and real listening require separate native evidence.
async function finishControlledVoice(sessionId: number) {
  const state = await readProductRuntimeState(sessionId), line = avgCurrentReadingLineV1(state)
  if (!line || !state.avgReading?.plan.voices.some(v => v.lineKey === line.beat.beatKey)) return
  const before = await readProductRuntimeStateVersion(sessionId)
  await expect(reachAvgPresentationBeat({ ...await command(sessionId), beatKey: line.beat.beatKey })).rejects.toThrow(/配音尚未结束/)
  expect(await readProductRuntimeStateVersion(sessionId)).toEqual(before)
  await commitAvgVoiceCommandV1({ ...await command(sessionId), type: 'start', lineKey: line.beat.beatKey, visit: line.visit })
  const started = (await readProductRuntimeState(sessionId)).avgReading!.current!
  expect(started.status).toBe('requested')
  await commitAvgVoiceCommandV1({ ...await command(sessionId), type: 'observe', lineKey: line.beat.beatKey,
    visit: line.visit, generation: started.generation, outcome: 'ended', playedMs: 500, reason: '' })
}
async function prepareCurrent(s: Owner) {
  const build = (await combinedDetails(s)).build!, { sessionId } = await startProductProductionPreviewV1(s)
  await finishControlledVoice(sessionId)
  await reachAvgPresentationBeat({ ...await command(sessionId), beatKey: 'line.desk' })
  await commitNarrativeChoice({ ...await command(sessionId), choiceKey: 'wait' })
  await finishControlledVoice(sessionId)
  await reachAvgPresentationBeat({ ...await command(sessionId), beatKey: 'line.wait' })
  const completed = await readProductRuntimeState(sessionId)
  expect(completed.narrative!.completed).toBe(true)
  if (completed.avgReading?.plan.voices.length) expect(completed.avgReading.history.find(h => h.kind === 'line' && h.lineKey === 'line.desk'))
    .toMatchObject({ voiceOutcome: 'ended', voicePlayedMs: 500 })
  await recordProductBuildMainRoutePlaythroughV1({ scope: s.scope, productBuildId: build.id!, productRuntimeSessionId: sessionId,
    authorConfirmation: 'author-confirmed-main-route', environment })
  const scan = await scanAvgPrototypeMediaV1({ scope: s.scope, buildId: build.id!, expectedPreviewHash: build.previewHash,
    environment, signal: new AbortController().signal })
  expect(scan!.evidence.passed).toBe(true)
  return prepareProductProductionAdoption(s)
}
function publishCommand(prepared: Awaited<ReturnType<typeof prepareCurrent>>) {
  return { type: 'publish' as const, commandId: `combined.original.${crypto.randomUUID()}`, expectedStateRevision: prepared.intent.expectedStateRevision,
    buildNumber: prepared.intent.buildNumber, expectedManifestHash: prepared.intent.manifestHash, adoptionIntentHash: prepared.adoptionIntentHash }
}
async function publishCurrent(s: Owner) {
  const prepared = await prepareCurrent(s), command = publishCommand(prepared)
  const result = await publishProductProductionBuild({ ...s, command })
  const record = (await db.productReleases.get(result.productReleaseId))!
  return { record, manifest: await verifyProductReleaseManifest(record.manifestJson), command }
}

describe('one-Work original visual, Sound and local fixed-preset voice through separate public production phases', () => {
  it('retains all five original image slots into a new Sound Preview after explicit zero-call visual continuation, with one new plan/music and two exact original library reads only', async () => {
    const source = await avgCombinedVisualSourceFixtureV1(), original = (await db.productBuilds.get(source.buildId))!
    const originalRows = await db.productBuildArtifacts.where('buildId').equals(source.buildId).toArray()
    const s = await addCombinedSoundFixtureV1(source), preview = await verifyStoredProductBuildPreview(s.soundBuild)
    const stage = avgRuntimeStage(preview.runtimePackage)!
    expect(stage.assets).toHaveLength(8)
    expect(stage.assets.filter(a => a.mimeType.startsWith('image/'))).toHaveLength(5)
    expect(stage.assets.filter(a => a.kind === 'bgm')).toHaveLength(1); expect(stage.assets.filter(a => a.kind === 'sfx')).toHaveLength(1)
    const ambience = stage.assets.filter(a => a.kind === 'ambience')
    expect(ambience).toHaveLength(1); expect(ambience[0]!.blobContentHash).toBe(s.publisher.source.memberHash)
    expect(ambience[0]!.source).toBe(s.publisher.source.publisherPage); expect(ambience[0]!.license).toBe('CC0-1.0')
    const originalAmbient = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.soundBuild.id!, 'avg.sound.raw.desk.ambience']).filter(r => r.status === 'accepted').first())!
    expect(JSON.parse(originalAmbient.payloadJson).providerResult).toEqual(s.publisher.result)
    expect(s.soundCounts).toMatchObject({ text: 1, music: 1, library: 2, publisherLibrary: 1, voice: 0, voiceCapability: 0 })
    expect(s.calls).toHaveLength(4); expect(s.imageCalls).toHaveLength(5)
    const retainedBrief = (await db.productProductionBriefs.where('[productionId+revision]').equals([s.productionId, s.retainedBuild.briefRevision]).first())!
    expect(JSON.parse(retainedBrief.briefJson).productionBudget).toMatchObject({ maximumModelCalls: 0, maximumMediaCalls: 0 })
    expect(await db.productBuilds.get(source.buildId)).toEqual(original)
    expect(await db.productBuildArtifacts.where('buildId').equals(source.buildId).toArray()).toEqual(originalRows)
    expect(new Set((await db.productBuilds.toArray()).map(b => b.workId))).toEqual(new Set([s.scope.workId]))
    expect(await db.productProductions.count()).toBe(1); expect(useAIConfigStore.getState().config.apiKey).toBe('')
    const oldStage = avgRuntimeStage((await verifyStoredProductBuildPreview(original)).runtimePackage)!
    for (const asset of oldStage.assets) expect(stage.assets.find(a => a.assetKey === asset.assetKey)).toEqual(asset)
  }, 180_000)

  it('adds one exact text-bound local voice to all nine consumers, retains both write fences and original Release bytes, then restores/remaps/deletes only the copy with factories closed', async () => {
    const source = await avgCombinedVisualSourceFixtureV1(), old = await publishCurrent(source)
    const originalBuild = (await db.productBuilds.get(source.buildId))!, originalRows = await db.productBuildArtifacts.where('buildId').equals(source.buildId).toArray()
    const sound = await addCombinedSoundFixtureV1(source), s = await addCombinedLocalVoiceFixtureV1(sound)
    const preview = await verifyStoredProductBuildPreview(s.voiceBuild), stage = avgRuntimeStage(preview.runtimePackage)!, module = avgExecutableModule(preview.runtimePackage)!
    expect(stage.assets).toHaveLength(9); expect(stage.assets.filter(a => a.mimeType.startsWith('image/'))).toHaveLength(5)
    expect(stage.assets.filter(a => a.kind === 'voice')).toHaveLength(1)
    const voice = module.reading!.voices.find(v => v.assetKey === 'combined.voice.desk')!
    expect(voice.text).toBe(module.lines.find(line => line.lineKey === voice.lineKey)!.text)
    expect(s.soundCounts).toMatchObject({ text: 1, music: 1, library: 2, publisherLibrary: 1, voice: 1 })
    expect(s.calls).toHaveLength(4); expect(s.imageCalls).toHaveLength(5); expect(useAIConfigStore.getState().config.apiKey).toBe('')
    const prepared = await prepareCurrent(s), command = publishCommand(prepared)
    const before = { gates: await db.productQualityGateReceipts.count(), commands: await db.productProductionCommands.count(), releases: await db.productReleases.count(), mediaAssets: await db.productMediaAssets.count(), mediaBlobs: await db.productMediaBlobs.count() }
    for (const flag of ['VITE_STORYFORGE_AVG_SOUND_PRODUCTION', 'VITE_STORYFORGE_AVG_VOICE_PRODUCTION', 'VITE_STORYFORGE_AVG_MEDIA_PRODUCTION']) {
      vi.stubEnv(flag, '0')
      await expect(publishProductProductionBuild({ ...s, command }), flag).rejects.toThrow(/尚未|未启用|未开放/)
      expect({ gates: await db.productQualityGateReceipts.count(), commands: await db.productProductionCommands.count(), releases: await db.productReleases.count(), mediaAssets: await db.productMediaAssets.count(), mediaBlobs: await db.productMediaBlobs.count() }).toEqual(before)
      vi.stubEnv(flag, '1')
    }
    const actualVoiceFence = prototypePolicy.assertAvgVoicePrototypeWriteEnabledV3
    let finalWriteChecks = 0
    const lateClosure = vi.spyOn(prototypePolicy, 'assertAvgVoicePrototypeWriteEnabledV3').mockImplementation(() => {
      if (Dexie.currentTransaction?.idbtrans.mode === 'readwrite') {
        finalWriteChecks++
        vi.stubEnv('VITE_STORYFORGE_AVG_VOICE_PRODUCTION', '0')
      }
      actualVoiceFence()
    })
    await expect(publishProductProductionBuild({ ...s, command })).rejects.toThrow(/配音.*尚未启用/)
    expect(finalWriteChecks).toBe(1)
    expect({ gates: await db.productQualityGateReceipts.count(), commands: await db.productProductionCommands.count(),
      releases: await db.productReleases.count(), mediaAssets: await db.productMediaAssets.count(), mediaBlobs: await db.productMediaBlobs.count() }).toEqual(before)
    lateClosure.mockRestore(); vi.stubEnv('VITE_STORYFORGE_AVG_VOICE_PRODUCTION', '1')
    const published = await publishProductProductionBuild({ ...s, command }), record = (await db.productReleases.get(published.productReleaseId))!
    const manifest = await verifyProductReleaseManifest(record.manifestJson), assets = avgRuntimeStage(manifest.runtimePackage)!.assets
    expect(record.id).not.toBe(old.record.id); expect(assets).toHaveLength(9)
    expect(assets.filter(a => a.kind === 'ambience')).toHaveLength(1)
    expect(assets.find(a => a.kind === 'ambience')!.blobContentHash).toBe(s.publisher.source.memberHash)
    expect(await db.productReleases.get(old.record.id!)).toEqual(old.record)
    expect(await db.productBuilds.get(source.buildId)).toEqual(originalBuild)
    expect(await db.productBuildArtifacts.where('buildId').equals(source.buildId).toArray()).toEqual(originalRows)
    const oldAssets = avgRuntimeStage(old.manifest.runtimePackage)!.assets
    for (const asset of oldAssets) {
      expect(assets.find(a => a.assetKey === asset.assetKey)).toEqual(asset)
      expect(await sha256MediaData(await readProductReleaseMediaBytes({ scope: s.scope, productReleaseId: old.record.id!, asset }))).toBe(asset.blobContentHash)
    }
    for (const asset of assets) expect(await sha256MediaData(await readProductReleaseMediaBytes({ scope: s.scope, productReleaseId: record.id!, asset }))).toBe(asset.blobContentHash)
    const expectedVoice = await sha256MediaData(s.originalVoice.data)
    expect(assets.find(a => a.kind === 'voice')!.blobContentHash).toBe(expectedVoice)
    const counts = { ...s.soundCounts }, backup = await exportProjectJSON(s.scope.projectId)
    for (const flag of ['VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', 'VITE_STORYFORGE_AVG_VISUAL_PLANNING', 'VITE_STORYFORGE_AVG_SOUND_PRODUCTION', 'VITE_STORYFORGE_AVG_VOICE_PRODUCTION']) vi.stubEnv(flag, '0')
    const forbidden = vi.fn(async () => { throw new Error('Frozen combined playback must never contact a provider') }); vi.stubGlobal('fetch', forbidden)
    expect((await publishProductProductionBuild({ ...s, command })).replayed).toBe(true)
    const copyId = await importProjectJSON(backup), copies = await db.productReleases.where('projectId').equals(copyId).toArray()
    const copy = copies.find(r => JSON.parse(r.manifestJson).lineage.releaseUid === manifest.lineage.releaseUid)!, scope = { projectId: copyId, worldId: copy.worldId!, workId: copy.workId! }
    expect(copy.manifestJson).toBe(record.manifestJson); expect(copy.workId).not.toBe(s.scope.workId)
    const copiedCounts = { runs: await db.agentRuns.count(), gates: await db.productQualityGateReceipts.count(), commands: await db.productProductionCommands.count(), releases: await db.productReleases.count(), mediaAssets: await db.productMediaAssets.count(), mediaBlobs: await db.productMediaBlobs.count() }
    const session = await createProductRuntimeInstance({ scope, kind: 'avg', title: 'ENGINEERING combined original Release', productSource: { kind: 'release', productReleaseId: copy.id! } })
    expect(session.productBuildId).toBeNull(); expect(session.productReleaseId).toBe(copy.id)
    for (const asset of assets) expect(await sha256MediaData(await readProductReleaseMediaBytes({ scope, productReleaseId: copy.id!, asset }))).toBe(asset.blobContentHash)
    expect({ runs: await db.agentRuns.count(), gates: await db.productQualityGateReceipts.count(), commands: await db.productProductionCommands.count(), releases: await db.productReleases.count(), mediaAssets: await db.productMediaAssets.count(), mediaBlobs: await db.productMediaBlobs.count() }).toEqual(copiedCounts)
    await deleteWork(copy.workId!)
    for (const asset of assets) expect(await sha256MediaData(await readProductReleaseMediaBytes({ scope: s.scope, productReleaseId: record.id!, asset }))).toBe(asset.blobContentHash)
    expect(await db.productReleases.get(old.record.id!)).toEqual(old.record)
    expect(s.soundCounts).toEqual(counts); expect(forbidden).not.toHaveBeenCalled()
  }, 180_000)
})
