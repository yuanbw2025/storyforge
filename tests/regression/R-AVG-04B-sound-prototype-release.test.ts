import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/sound-production-brief'
import * as policy from '../../src/lib/avg/prototype-contract'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import { scanAvgPrototypeMediaV1 } from '../../src/lib/avg/prototype-media-scan'
import { prepareProductProductionAdoption, publishProductProductionBuild } from '../../src/lib/product-production/adoption'
import { recordProductBuildMainRoutePlaythroughV1, recordProductMediaRuntimeMeasurementV1, reconcileCommercialProductBuildReadinessV1 } from '../../src/lib/product-production/quality-receipts'
import { avgSoundRuntimeStageFixtureV1, finishAvgSoundRuntimeFixtureV1 } from '../helpers/avg-sound-runtime-fixture'
import { acceptedAvgSoundArtifactV1 } from '../helpers/avg-sound-harness-fixture'
import { startProductProductionPreviewV1 } from '../../src/lib/product-production/service'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-commands'
import { commitNarrativeChoice, readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { verifyProductReleaseManifest } from '../../src/lib/product-production/runtime-package'
import { readProductReleaseMediaBytes } from '../../src/lib/product-production/release-media'
import { avgRuntimeStage } from '../../src/lib/avg/executable-module'
import { hashAvgSoundBytesV1 } from '../../src/lib/avg/sound-provider-contract'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

const environment = { browserName: 'isolated-unit-contract', browserVersion: '1', platform: 'controlled decoder, not actual listening', viewport: { width: 1280, height: 720 } }
const actualVerifier = verifier.verifyProductMediaRuntimeUrlsV1
let failDecode = false

beforeEach(async () => {
  await db.delete(); await db.open(); failDecode = false
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1', apiKey: 'isolated-fixture-no-external-account', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.spyOn(readiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  const urls = new Map<string, string>()
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { const url = `blob:isolated-sound-${crypto.randomUUID()}`; urls.set(url, (blob as Blob).type); return url })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => { urls.delete(url) })
  // Real reporting/physical resolver/Run/author commands. Only HTTP (inside
  // the existing fixture), the feature fence and unavailable DOM decoder are
  // controlled. These are not native decoding or actual hearing approvals.
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(input => actualVerifier({ ...input, decoder: {
    image: async () => { throw new Error('unexpected-image') },
    audio: async url => {
      const mime = urls.get(url); if (!mime || failDecode && mime === 'audio/ogg') throw new Error('audio-decode-failed')
      return { durationMs: mime === 'audio/wav' ? 12000 : 500, channelCount: mime === 'audio/wav' ? 2 : 1,
        sampleRateHz: 48000, integratedLufs: -18, truePeakDbtp: -12, loopSeamDbfs: -40 }
    },
  } }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

async function preview() {
  const s = await avgSoundRuntimeStageFixtureV1(), details = await finishAvgSoundRuntimeFixtureV1(s), build = details.build!
  useAIConfigStore.getState().setConfig({ provider: 'deepseek', apiKey: '', baseUrl: 'https://unused.fixture.invalid/v1' })
  const started = await startProductProductionPreviewV1({ scope: s.scope, productionId: s.productionId })
  return { ...s, build, sessionId: started.sessionId }
}
type Source = Awaited<ReturnType<typeof preview>>
async function command(sessionId: number) { const base = await readProductRuntimeStateVersion(sessionId); return { sessionId, baseSequence: base.sequence, baseStateHash: base.stateHash, commandId: crypto.randomUUID() } }
async function complete(s: Source, sessionId = s.sessionId) {
  await reachAvgPresentationBeat({ ...await command(sessionId), beatKey: 'line.desk' })
  await commitNarrativeChoice({ ...await command(sessionId), choiceKey: 'wait' })
  await reachAvgPresentationBeat({ ...await command(sessionId), beatKey: 'line.wait' })
  expect((await readProductRuntimeState(sessionId)).narrative!.completed).toBe(true)
}
const route = (s: Source, sessionId = s.sessionId) => recordProductBuildMainRoutePlaythroughV1({ scope: s.scope, productBuildId: s.buildId, productRuntimeSessionId: sessionId, authorConfirmation: 'author-confirmed-main-route', environment })
const scan = (s: Source) => scanAvgPrototypeMediaV1({ scope: s.scope, buildId: s.buildId, expectedPreviewHash: s.build.previewHash, environment, signal: new AbortController().signal })
const prepare = (s: Source) => prepareProductProductionAdoption({ scope: s.scope, productionId: s.productionId })
const publishCommand = (prepared: Awaited<ReturnType<typeof prepare>>) => ({ type: 'publish' as const, commandId: `sound.prototype.${crypto.randomUUID()}`, expectedStateRevision: prepared.intent.expectedStateRevision, buildNumber: prepared.intent.buildNumber, expectedManifestHash: prepared.intent.manifestHash, adoptionIntentHash: prepared.adoptionIntentHash })
async function ready() { const s = await preview(); await complete(s); await route(s); const media = await scan(s); expect(media!.evidence.passed).toBe(true); return { ...s, media: media! } }
function noNewRequest(s: Source) { expect(s.calls).toHaveLength(1); expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1) }

describe('original Sound prototype publication retains full source and author boundaries', () => {
  it('requires exact route and full catalog before explicit publication; preserves original bytes through release, replay, backup/remap and copy deletion with no Key', async () => {
    const s = await preview(), brief = (await db.productProductionBriefs.where('[productionId+revision]').equals([s.productionId, s.build.briefRevision]).first())!
    expect(JSON.parse(brief.briefJson).avgAssembly).toBeUndefined()
    await expect(prepare(s)).rejects.toThrow()
    await expect(route(s)).rejects.toThrow(/尚未到达/)
    expect(await db.productQualityGateReceipts.count()).toBe(0)
    await complete(s); await route(s)
    await expect(prepare(s)).rejects.toThrow()
    const measured = (await scan(s))!; expect(measured.evidence.assets).toHaveLength(2)
    const prepared = await prepare(s); expect(await db.productReleases.count()).toBe(0)
    const command = publishCommand(prepared), published = await publishProductProductionBuild({ scope: s.scope, productionId: s.productionId, command })
    const record = (await db.productReleases.get(published.productReleaseId))!, manifest = await verifyProductReleaseManifest(record.manifestJson)
    expect(manifest.version).toBe(2); expect(manifest.productionProvenance!.rootTerminalReceiptHash).toBe(s.build.rootTerminalReceiptHash)
    expect((await db.productBuilds.get(s.buildId))!.previewManifestJson).toBe(s.build.previewManifestJson)
    expect((await db.productProductionBriefs.get(brief.id!))!.briefJson).toBe(brief.briefJson)
    expect(JSON.parse(s.build.qualityReportJson).releaseReady).toBe(false)
    const assets = avgRuntimeStage(manifest.runtimePackage)!.assets
    for (const asset of assets) expect(await hashAvgSoundBytesV1(await readProductReleaseMediaBytes({ scope: s.scope, productReleaseId: record.id!, asset }))).toBe(asset.blobContentHash)
    expect(await db.avgDraftMedia.count()).toBe(0)
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    expect((await publishProductProductionBuild({ scope: s.scope, productionId: s.productionId, command })).replayed).toBe(true)
    expect(await db.productReleases.count()).toBe(1)
    const session = await createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: 'original Sound release', productSource: { kind: 'release', productReleaseId: record.id! } })
    expect(session.productBuildId).toBeNull(); expect((await readProductRuntimeState(session.id!)).narrative!.currentNodeKey).toBe('desk')
    const copyId = await importProjectJSON(await exportProjectJSON(s.scope.projectId)), copy = (await db.productReleases.where('projectId').equals(copyId).first())!
    const copyManifest = await verifyProductReleaseManifest(copy.manifestJson), scope = { projectId: copyId, workId: copy.workId!, worldId: copy.worldId! }
    expect(copy.id).not.toBe(record.id)
    for (const asset of avgRuntimeStage(copyManifest.runtimePackage)!.assets) expect(await hashAvgSoundBytesV1(await readProductReleaseMediaBytes({ scope, productReleaseId: copy.id!, asset }))).toBe(asset.blobContentHash)
    await expect(readProductReleaseMediaBytes({ scope, productReleaseId: record.id!, asset: assets[0]! })).rejects.toThrow(/跨 Work/)
    await deleteWork(copy.workId!); expect(await db.productReleases.get(copy.id!)).toBeUndefined()
    for (const asset of assets) expect(await hashAvgSoundBytesV1(await readProductReleaseMediaBytes({ scope: s.scope, productReleaseId: record.id!, asset }))).toBe(asset.blobContentHash)
    expect((await db.productRuntimeSessions.get(session.id!))!.productReleaseId).toBe(record.id)
    noNewRequest(s)
  }, 90_000)

  it('retains a complete decoder failure and rejects partial or wrong hash measurements without granting publication', async () => {
    const s = await ready(), before = await db.productQualityGateReceipts.count()
    await expect(recordProductMediaRuntimeMeasurementV1({ scope: s.scope, productBuildId: s.buildId, measurement: { ...s.media.evidence, measuredAt: Date.now(), assets: s.media.evidence.assets.slice(0, 1) } })).rejects.toThrow(/完整覆盖/)
    const wrong = structuredClone(s.media.evidence); wrong.measuredAt = Date.now(); wrong.assets[0]!.contentHash = 'f'.repeat(64)
    await expect(recordProductMediaRuntimeMeasurementV1({ scope: s.scope, productBuildId: s.buildId, measurement: wrong })).rejects.toThrow(/不一致/)
    expect(await db.productQualityGateReceipts.count()).toBe(before)
    failDecode = true; const failed = (await scan(s))!
    expect(failed.evidence.passed).toBe(false); expect(failed.evidence.assets).toHaveLength(2)
    expect(failed.evidence.assets.find(a => a.mimeType === 'audio/ogg')!.failureCode).toBe('audio-decode-failed')
    expect((await db.productBuilds.get(s.buildId))!.status).toBe('preview-ready')
    await expect(prepare(s)).rejects.toThrow(); expect(await db.productReleases.count()).toBe(0); noNewRequest(s)
  }, 90_000)

  it('refuses changed original response, rights, review, physical bytes or frozen Preview before publication without regenerating', async () => {
    const s = await ready(), raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!, body = JSON.parse(raw.payloadJson)
    const response = (await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.scope.projectId, 'raw-response', body.responseEvidenceHash]).first())!
    const review = (await acceptedAvgSoundArtifactV1(s, 'avg.review.audio.desk.bgm'))!, blob = (await db.mediaBlobObjects.get(raw.blobObjectId!))!, build = (await db.productBuilds.get(s.buildId))!
    for (const mode of ['response', 'rights', 'review', 'bytes', 'preview'] as const) {
      if (mode === 'response') await db.agentRunArtifacts.delete(response.id!)
      if (mode === 'rights') await db.productBuildArtifacts.update(raw.id!, { rightsJson: '{}' })
      if (mode === 'review') await db.productBuildArtifacts.update(review.id!, { payloadJson: '{}' })
      if (mode === 'bytes') { const bytes = new Uint8Array(blob.data!.slice(0)); bytes[bytes.length - 1] ^= 1; await db.mediaBlobObjects.update(blob.id!, { data: bytes.buffer }) }
      if (mode === 'preview') await db.productBuilds.update(s.buildId, { previewManifestJson: '{}' })
      let refused = false; try { await prepare(s) } catch { refused = true }
      expect(refused, `publication must refuse changed original ${mode}`).toBe(true)
      expect(await db.productReleases.count()).toBe(0)
      await db.agentRunArtifacts.put(response); await db.productBuildArtifacts.put(raw); await db.productBuildArtifacts.put(review); await db.mediaBlobObjects.put(blob); await db.productBuilds.put(build)
    }
    expect((await prepare(s)).intent.previewHash).toBe(s.build.previewHash); noNewRequest(s)
  }, 90_000)

  it('rejects a reviewed intent after a newer exact route receipt', async () => {
    const s = await ready(), prepared = await prepare(s), next = await startProductProductionPreviewV1({ scope: s.scope, productionId: s.productionId })
    await complete(s, next.sessionId); await route(s, next.sessionId)
    await expect(publishProductProductionBuild({ scope: s.scope, productionId: s.productionId, command: publishCommand(prepared) })).rejects.toThrow(/已过期/)
    expect(await db.productReleases.count()).toBe(0); noNewRequest(s)
  }, 90_000)

  it('blocks new receipt/preparation/publication writes while the factory is closed but retains frozen Preview reads and bytes', async () => {
    const s = await ready(), prepared = await prepare(s), gates = await db.productQualityGateReceipts.count(), build = (await db.productBuilds.get(s.buildId))!
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    for (const task of [() => scan(s), () => route(s), () => prepare(s),
      () => reconcileCommercialProductBuildReadinessV1({ scope: s.scope, productBuildId: s.buildId }),
      () => recordProductMediaRuntimeMeasurementV1({ scope: s.scope, productBuildId: s.buildId, measurement: { ...s.media.evidence, measuredAt: Date.now() } }),
      () => publishProductProductionBuild({ scope: s.scope, productionId: s.productionId, command: publishCommand(prepared) })]) await expect(task()).rejects.toThrow(/尚未启用/)
    const next = await startProductProductionPreviewV1({ scope: s.scope, productionId: s.productionId })
    expect(next.sessionId).toBeGreaterThan(0)
    expect((await db.productBuilds.get(s.buildId))!.previewManifestJson).toBe(build.previewManifestJson)
    expect(await db.productQualityGateReceipts.count()).toBe(gates); expect(await db.productReleases.count()).toBe(0); noNewRequest(s)
  }, 90_000)

  it('rechecks the real feature fence at receipt and publication write transactions, retaining zero partial authority on late closure', async () => {
    const s = await preview(); await complete(s)
    const actualBoundary = policy.assertAvgSoundPrototypeWriteEnabledV1
    const closeOn = (at: number) => {
      const gate = vi.spyOn(policy, 'assertAvgSoundPrototypeWriteEnabledV1').mockImplementation(() => {
        if (gate.mock.calls.length === at) vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
        actualBoundary()
      })
      return gate
    }
    let gate = closeOn(3) // scan, measurement start, measurement transaction
    await expect(scan(s)).rejects.toThrow(/尚未启用/); expect(gate).toHaveBeenCalledTimes(3); gate.mockRestore()
    expect(await db.productQualityGateReceipts.count()).toBe(0)
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(true); gate = closeOn(2)
    await expect(route(s)).rejects.toThrow(/尚未启用/); expect(gate).toHaveBeenCalledTimes(2); gate.mockRestore()
    expect(await db.productQualityGateReceipts.count()).toBe(0)
    vi.mocked(readiness.avgSoundProductionExecutionReadyV1).mockReturnValue(true); await route(s); await scan(s)
    const prepared = await prepare(s), before = await db.productProductionCommands.count(); gate = closeOn(2)
    await expect(publishProductProductionBuild({ scope: s.scope, productionId: s.productionId, command: publishCommand(prepared) })).rejects.toThrow(/尚未启用/)
    expect(gate).toHaveBeenCalledTimes(2)
    expect(await db.productProductionCommands.count()).toBe(before); expect(await db.productReleases.count()).toBe(0)
    expect(await db.productMediaAssets.count()).toBe(0); expect((await db.productBuilds.get(s.buildId))!.status).toBe('release-ready'); noNewRequest(s)
  }, 90_000)
})
