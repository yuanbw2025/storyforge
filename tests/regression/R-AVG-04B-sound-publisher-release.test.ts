import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/sound-production-brief'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import { avgPublisherSoundStageFixtureV2 } from '../helpers/avg-sound-publisher-runtime-fixture'
import { finishAvgSoundRuntimeFixtureV1 } from '../helpers/avg-sound-runtime-fixture'
import { acceptedAvgSoundArtifactV1 } from '../helpers/avg-sound-harness-fixture'
import { startProductProductionPreviewV1 } from '../../src/lib/product-production/service'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-commands'
import { commitNarrativeChoice, readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { recordProductBuildMainRoutePlaythroughV1 } from '../../src/lib/product-production/quality-receipts'
import { scanAvgPrototypeMediaV1 } from '../../src/lib/avg/prototype-media-scan'
import { prepareProductProductionAdoption, publishProductProductionBuild } from '../../src/lib/product-production/adoption'
import { verifyProductReleaseManifest } from '../../src/lib/product-production/runtime-package'
import { readProductReleaseMediaBytes } from '../../src/lib/product-production/release-media'
import { avgRuntimeStage } from '../../src/lib/avg/executable-module'
import { hashAvgSoundBytesV1 } from '../../src/lib/avg/sound-provider-contract'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

const environment = { browserName: 'isolated-publisher-contract', browserVersion: '1', platform: 'controlled HTTP/DOM signals and ENGINEERING declarations; not real hearing', viewport: { width: 1280, height: 720 } }
const actualVerifier = verifier.verifyProductMediaRuntimeUrlsV1

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1',
    apiKey: 'intercepted-engineering-key-no-external-account', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.spyOn(readiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  const urls = new Map<string,string>()
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { const url = `blob:publisher-${crypto.randomUUID()}`; urls.set(url,(blob as Blob).type); return url })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => { urls.delete(url) })
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(input => actualVerifier({ ...input, decoder: {
    image: async () => { throw new Error('unexpected image') },
    audio: async url => {
      if (urls.get(url) !== 'audio/ogg') throw new Error('unexpected generated or converted audio')
      return { durationMs: 3991, channelCount: 2, sampleRateHz: 48000, integratedLufs: -18, truePeakDbtp: -12, loopSeamDbfs: -40 }
    },
  } }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

async function preview() {
  const s = await avgPublisherSoundStageFixtureV2(), details = await finishAvgSoundRuntimeFixtureV1(s), build = details.build!
  useAIConfigStore.getState().setConfig({ apiKey: '' })
  const started = await startProductProductionPreviewV1({ scope: s.scope, productionId: s.productionId })
  return { ...s, build, sessionId: started.sessionId }
}
type Source = Awaited<ReturnType<typeof preview>>
async function command(sessionId: number) {
  const state = await readProductRuntimeStateVersion(sessionId)
  return { sessionId, baseSequence: state.sequence, baseStateHash: state.stateHash, commandId: crypto.randomUUID() }
}
async function ready() {
  const s = await preview()
  await reachAvgPresentationBeat({ ...await command(s.sessionId), beatKey: 'line.desk' })
  await commitNarrativeChoice({ ...await command(s.sessionId), choiceKey: 'wait' })
  await reachAvgPresentationBeat({ ...await command(s.sessionId), beatKey: 'line.wait' })
  expect((await readProductRuntimeState(s.sessionId)).narrative!.completed).toBe(true)
  await recordProductBuildMainRoutePlaythroughV1({ scope: s.scope, productBuildId: s.buildId,
    productRuntimeSessionId: s.sessionId, authorConfirmation: 'author-confirmed-main-route', environment })
  const media = await scanAvgPrototypeMediaV1({ scope: s.scope, buildId: s.buildId, expectedPreviewHash: s.build.previewHash, environment, signal: new AbortController().signal })
  expect(media!.evidence.passed).toBe(true); expect(media!.evidence.assets).toHaveLength(1)
  return s
}
const prepare = (s: Source) => prepareProductProductionAdoption({ scope: s.scope, productionId: s.productionId })
function publishCommand(p: Awaited<ReturnType<typeof prepare>>) {
  return { type: 'publish' as const, commandId: `publisher.release.${crypto.randomUUID()}`, expectedStateRevision: p.intent.expectedStateRevision,
    buildNumber: p.intent.buildNumber, expectedManifestHash: p.intent.manifestHash, adoptionIntentHash: p.adoptionIntentHash }
}
function noNewProducer(s: Source) { expect(s.calls).toHaveLength(1); expect(s.audioFetcher).toHaveBeenCalledOnce(); expect(s.audioFetcher.mock.calls[0][1]?.method).toBe('GET') }

describe('publisher source V2 through independent author Stage, original prototype publication and frozen consumers', () => {
  it('retains exact external grant/raw and the same Blob in ambience, then publishes and restores the immutable original with no Key or open factory', async () => {
    const s = await ready(), raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.ambience'))!, final = (await acceptedAvgSoundArtifactV1(s, 'avg.media.0'))!
    expect(final.blobObjectId).toBe(raw.blobObjectId); expect(final.contentHash).toBe(s.actual.source.memberHash)
    const rights = JSON.parse(final.rightsJson)
    expect(rights.origin).toBe('author-selected-original-library'); expect(rights.originalRights.source).toEqual(s.actual.source)
    expect(JSON.parse(raw.payloadJson).providerResult).toEqual(s.actual.result)
    const prepared = await prepare(s), command = publishCommand(prepared)
    const result = await publishProductProductionBuild({ scope: s.scope, productionId: s.productionId, command })
    const record = (await db.productReleases.get(result.productReleaseId))!, manifest = await verifyProductReleaseManifest(record.manifestJson)
    const assets = avgRuntimeStage(manifest.runtimePackage)!.assets
    expect(assets).toHaveLength(1); const asset = assets[0]!
    expect(asset).toMatchObject({ assetKey: 'publisher.desk.ambience', kind: 'ambience', license: 'CC0-1.0', source: s.actual.source.publisherPage })
    expect(await hashAvgSoundBytesV1(await readProductReleaseMediaBytes({ scope: s.scope, productReleaseId: record.id!, asset }))).toBe(s.actual.source.memberHash)
    expect(useAIConfigStore.getState().config.apiKey).toBe('')
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    expect((await publishProductProductionBuild({ scope: s.scope, productionId: s.productionId, command })).replayed).toBe(true)
    const session = await createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: 'ENGINEERING original publisher release', productSource: { kind: 'release', productReleaseId: record.id! } })
    expect(session.productBuildId).toBeNull(); expect(session.productReleaseId).toBe(record.id)
    const backup = await exportProjectJSON(s.scope.projectId), copyId = await importProjectJSON(backup)
    const copy = (await db.productReleases.where('projectId').equals(copyId).first())!, scope = { projectId: copyId, worldId: copy.worldId!, workId: copy.workId! }
    expect(copy.manifestJson).toBe(record.manifestJson)
    expect(await hashAvgSoundBytesV1(await readProductReleaseMediaBytes({ scope, productReleaseId: copy.id!, asset }))).toBe(s.actual.source.memberHash)
    await expect(readProductReleaseMediaBytes({ scope, productReleaseId: record.id!, asset })).rejects.toThrow(/跨 Work/)
    await deleteWork(scope.workId)
    expect({ ...await exportProjectJSON(s.scope.projectId), exportedAt: 0 }).toEqual({ ...backup, exportedAt: 0 })
    expect(await hashAvgSoundBytesV1(await readProductReleaseMediaBytes({ scope: s.scope, productReleaseId: record.id!, asset }))).toBe(s.actual.source.memberHash)
    noNewProducer(s)
  },90_000)

  it('refuses missing original response, substituted grant or relabelled raw result before publication, without another library read', async () => {
    const s = await ready(), raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.ambience'))!, body = JSON.parse(raw.payloadJson)
    const response = (await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.scope.projectId, 'raw-response', body.responseEvidenceHash]).first())!
    for (const mode of ['response', 'rights', 'version'] as const) {
      if (mode === 'response') await db.agentRunArtifacts.delete(response.id!)
      if (mode === 'rights') await db.productBuildArtifacts.update(raw.id!, { rightsJson: JSON.stringify({ ...JSON.parse(raw.rightsJson), source: { ...s.actual.source, publisherPageHash: 'f'.repeat(64) } }) })
      if (mode === 'version') await db.productBuildArtifacts.update(raw.id!, { payloadJson: JSON.stringify({ ...body, providerResult: { ...body.providerResult, version: 1 } }) })
      await expect(prepare(s)).rejects.toThrow(); expect(await db.productReleases.count()).toBe(0)
      await db.agentRunArtifacts.put(response); await db.productBuildArtifacts.put(raw)
    }
    expect((await prepare(s)).intent.previewHash).toBe(s.build.previewHash); noNewProducer(s)
  },90_000)

  it('keeps the real Sound write fence for this new source variant and does not claim a release from a prepared intent after closing it', async () => {
    const s = await ready(), prepared = await prepare(s), beforeGates = await db.productQualityGateReceipts.count(), beforeCommands = await db.productProductionCommands.count()
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    await expect(publishProductProductionBuild({ scope: s.scope, productionId: s.productionId, command: publishCommand(prepared) })).rejects.toThrow(/尚未启用/)
    expect(await db.productReleases.count()).toBe(0); expect(await db.productQualityGateReceipts.count()).toBe(beforeGates)
    expect(await db.productProductionCommands.count()).toBe(beforeCommands)
    noNewProducer(s)
  },90_000)
})
