import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/visual-planning-brief-v5'
import * as policy from '../../src/lib/avg/prototype-contract'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import { avgV5FrozenPrototypeFixtureV1 } from '../helpers/avg-v5-prototype-fixture'
import { scanAvgPrototypeMediaV1 } from '../../src/lib/avg/prototype-media-scan'
import { prepareProductProductionAdoption, publishProductProductionBuild } from '../../src/lib/product-production/adoption'
import { recordProductBuildMainRoutePlaythroughV1, recordProductMediaRuntimeMeasurementV1 } from '../../src/lib/product-production/quality-receipts'
import { startProductProductionPreviewV1 } from '../../src/lib/product-production/service'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-commands'
import { commitNarrativeChoice, readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { verifyProductReleaseManifest } from '../../src/lib/product-production/runtime-package'
import { readProductReleaseMediaBytes } from '../../src/lib/product-production/release-media'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { avgRuntimeStage } from '../../src/lib/avg/executable-module'
import { createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { verifyFrozenAvgAuthorInputsV1 } from '../../src/lib/avg/author-artifacts'
import { readAvgAssemblyWorkspaceV1 } from '../../src/lib/avg/assembly-service'

const environment = { browserName: 'isolated-unit-contract', browserVersion: '1', platform: 'controlled decoder, not native pixels/art', viewport: { width: 1280, height: 720 } }
const actualVerifier = verifier.verifyProductMediaRuntimeUrlsV1
beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://v5-proposal.fixture.invalid/v1', apiKey: 'test-only-intercepted-no-external-network', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1'); vi.stubEnv('VITE_STORYFORGE_AVG_VISUAL_PLANNING', '1')
  // Only the unavailable DOM decoder is controlled. The actual shared
  // verifier, raw/author/physical source and receipt gates remain in use.
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(input => actualVerifier({ ...input, decoder: {
    image: async url => {
      const asset = input.assets.find(a => input.urls[a.assetKey] === url)
      if (!asset || asset.width === null || asset.height === null) throw new Error('unknown-controlled-image')
      return { width: asset.width, height: asset.height, hasAlpha: asset.assetKey.includes('.keeper.') }
    }, audio: async () => { throw new Error('unexpected-audio') },
  } }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); db.close() })
type Source = Awaited<ReturnType<typeof avgV5FrozenPrototypeFixtureV1>> & { sessionId: number }
async function preview(): Promise<Source> {
  const s = await avgV5FrozenPrototypeFixtureV1()
  useAIConfigStore.getState().setConfig({ apiKey: '' })
  return { ...s, sessionId: (await startProductProductionPreviewV1(s)).sessionId }
}
async function command(sessionId: number) { const base = await readProductRuntimeStateVersion(sessionId); return { sessionId, baseSequence: base.sequence, baseStateHash: base.stateHash, commandId: crypto.randomUUID() } }
async function complete(s: Source) {
  await reachAvgPresentationBeat({ ...await command(s.sessionId), beatKey: 'line.desk' })
  await commitNarrativeChoice({ ...await command(s.sessionId), choiceKey: 'wait' })
  await reachAvgPresentationBeat({ ...await command(s.sessionId), beatKey: 'line.wait' })
  expect((await readProductRuntimeState(s.sessionId)).narrative!.completed).toBe(true)
}
const route = (s: Source) => recordProductBuildMainRoutePlaythroughV1({ scope: s.scope, productBuildId: s.buildId,
  productRuntimeSessionId: s.sessionId, authorConfirmation: 'author-confirmed-main-route', environment })
const scan = (s: Source, signal = new AbortController().signal) => scanAvgPrototypeMediaV1({ scope: s.scope, buildId: s.buildId, expectedPreviewHash: s.build.previewHash, signal, environment })
const prepare = (s: Source) => prepareProductProductionAdoption(s)
const publishCommand = (p: Awaited<ReturnType<typeof prepare>>) => ({ type: 'publish' as const, commandId: `visual.prototype.${crypto.randomUUID()}`,
  expectedStateRevision: p.intent.expectedStateRevision, buildNumber: p.intent.buildNumber, expectedManifestHash: p.intent.manifestHash, adoptionIntentHash: p.adoptionIntentHash })
function noNewCalls(s: Source) { expect(s.calls).toHaveLength(4); expect(s.imageCalls).toHaveLength(5); expect(useAIConfigStore.getState().config.apiKey).toBe('') }

describe('V5 original five-image Preview to independently accepted native prototype', () => {
  it('requires actual route/catalog gates, publishes original images/rights, and retains frozen playback/remap/delete without a Key or another model/image request', async () => {
    const s = await preview(), originalBrief = (await db.productProductionBriefs.where('[productionId+revision]').equals([s.productionId, s.build.briefRevision]).first())!
    expect(JSON.parse(originalBrief.briefJson).avgAssembly).toBeUndefined()
    expect(policy.isAvgAuthorPrototypeBriefV1(s.brief)).toBe(false)
    await expect(prepare(s)).rejects.toThrow(); await expect(route(s)).rejects.toThrow()
    await complete(s); await route(s); await expect(prepare(s)).rejects.toThrow()
    const media = (await scan(s))!; expect(media.evidence.passed).toBe(true); expect(media.evidence.assets).toHaveLength(5)
    const prepared = await prepare(s), command = publishCommand(prepared)
    expect(await db.productReleases.count()).toBe(0)
    const published = await publishProductProductionBuild({ ...s, command }), record = (await db.productReleases.get(published.productReleaseId))!
    const manifest = await verifyProductReleaseManifest(record.manifestJson), assets = avgRuntimeStage(manifest.runtimePackage)!.assets
    expect(assets).toHaveLength(5); expect(manifest.version).toBe(2)
    expect((await db.productBuilds.get(s.buildId))!.previewManifestJson).toBe(s.build.previewManifestJson)
    expect((await db.productProductionBriefs.get(originalBrief.id!))!.briefJson).toBe(originalBrief.briefJson)
    expect(JSON.parse(s.build.qualityReportJson).releaseReady).toBe(false)
    for (const asset of assets) expect(await sha256MediaData(await readProductReleaseMediaBytes({ scope: s.scope, productReleaseId: record.id!, asset }))).toBe(asset.blobContentHash)
    vi.mocked(readiness.avgVisualPlanningExecutionReadyV5).mockReturnValue(false)
    expect((await publishProductProductionBuild({ ...s, command })).replayed).toBe(true)
    const current = (await db.productBuilds.get(s.buildId))!
    expect((await verifyFrozenAvgAuthorInputsV1({ scope: s.scope, buildId: s.buildId, controlEpoch: current.controlEpoch, expectedBuildRevision: current.stateRevision })).mediaChoices).toHaveLength(5)
    const session = await createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: 'V5 original images', productSource: { kind: 'release', productReleaseId: record.id! } })
    expect(session.productBuildId).toBeNull(); expect(session.productReleaseId).toBe(record.id)
    const copyId = await importProjectJSON(await exportProjectJSON(s.scope.projectId)), copy = (await db.productReleases.where('projectId').equals(copyId).first())!
    const copyScope = { projectId: copyId, workId: copy.workId!, worldId: copy.worldId! }
    const runs = await db.agentRuns.where('workId').equals(copy.workId!).toArray(), events = await db.agentRunEvents.count()
    const gates = await db.productQualityGateReceipts.count(), commands = await db.productProductionCommands.count()
    const view = await readAvgAssemblyWorkspaceV1(copyScope)
    expect(view.visualProofRecoveryRequired).toBe(true); expect(view.imageDefinition).toBeNull()
    expect(await db.agentRuns.where('workId').equals(copy.workId!).toArray()).toEqual(runs)
    expect(await db.agentRunEvents.count()).toBe(events); expect(await db.productQualityGateReceipts.count()).toBe(gates)
    expect(await db.productProductionCommands.count()).toBe(commands)
    for (const asset of assets) expect(await sha256MediaData(await readProductReleaseMediaBytes({ scope: copyScope, productReleaseId: copy.id!, asset }))).toBe(asset.blobContentHash)
    await deleteWork(copy.workId!)
    for (const asset of assets) expect(await sha256MediaData(await readProductReleaseMediaBytes({ scope: s.scope, productReleaseId: record.id!, asset }))).toBe(asset.blobContentHash)
    noNewCalls(s)
  }, 180_000)

  it('refuses stale original rights/review/Blob and interrupted/partial decode, and rechecks the visual fence in actual receipt/publication write transactions', async () => {
    const s = await preview(), controller = new AbortController(), gateCount = await db.productQualityGateReceipts.count()
    await expect(scanAvgPrototypeMediaV1({ scope: s.scope, buildId: s.buildId, expectedPreviewHash: s.build.previewHash,
      environment, signal: controller.signal, onProgress: () => controller.abort() })).rejects.toThrow()
    expect(await db.productQualityGateReceipts.count()).toBe(gateCount)
    await complete(s)
    const actualGate = policy.assertAvgVisualPrototypeWriteEnabledV5
    const closeOnSecondCheck = () => {
      let checks = 0
      return vi.spyOn(policy, 'assertAvgVisualPrototypeWriteEnabledV5').mockImplementation(() => {
        if (++checks === 2) vi.mocked(readiness.avgVisualPlanningExecutionReadyV5).mockReturnValue(false)
        actualGate()
      })
    }
    let fence = closeOnSecondCheck()
    await expect(route(s)).rejects.toThrow('尚未启用'); expect(await db.productQualityGateReceipts.count()).toBe(gateCount)
    fence.mockRestore(); vi.mocked(readiness.avgVisualPlanningExecutionReadyV5).mockReturnValue(true)
    await route(s); const media = (await scan(s))!, beforeMedia = await db.productQualityGateReceipts.count()
    await expect(recordProductMediaRuntimeMeasurementV1({ scope: s.scope, productBuildId: s.buildId, measurement: { ...media.evidence, measuredAt: Date.now(), assets: media.evidence.assets.slice(0, 1) } })).rejects.toThrow()
    fence = closeOnSecondCheck()
    await expect(recordProductMediaRuntimeMeasurementV1({ scope: s.scope, productBuildId: s.buildId, measurement: { ...media.evidence, measuredAt: Date.now() + 1 } })).rejects.toThrow('尚未启用')
    expect(await db.productQualityGateReceipts.count()).toBe(beforeMedia)
    fence.mockRestore(); vi.mocked(readiness.avgVisualPlanningExecutionReadyV5).mockReturnValue(true)
    const prepared = await prepare(s), command = publishCommand(prepared)
    fence = closeOnSecondCheck()
    await expect(publishProductProductionBuild({ ...s, command })).rejects.toThrow('尚未启用')
    expect(await db.productReleases.count()).toBe(0)
    expect(await db.productProductionCommands.where('[productionId+commandId]').equals([s.productionId, command.commandId]).count()).toBe(0)
    fence.mockRestore(); vi.mocked(readiness.avgVisualPlanningExecutionReadyV5).mockReturnValue(true)
    const raw = s.rows[0]!, originalRights = raw.rightsJson
    await db.productBuildArtifacts.update(raw.id!, { rightsJson: JSON.stringify({ origin: 'substituted' }) })
    await expect(prepare(s)).rejects.toThrow(); await db.productBuildArtifacts.update(raw.id!, { rightsJson: originalRights })
    const review = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, `avg.review.visual.${JSON.parse(raw.payloadJson).requirement.requirementKey}`]).filter(r => r.status === 'accepted').first())!
    const metadata = review.metadataJson
    await db.productBuildArtifacts.update(review.id!, { metadataJson: JSON.stringify({ ...JSON.parse(metadata), receiptHash: '0'.repeat(64) }) })
    await expect(prepare(s)).rejects.toThrow(); await db.productBuildArtifacts.update(review.id!, { metadataJson: metadata })
    const blob = (await db.mediaBlobObjects.get(raw.blobObjectId!))!
    if (!blob.data) throw new Error('Expected actual fixture original bytes')
    const bytes = new Uint8Array(blob.data.slice(0)); bytes[bytes.length - 1] ^= 1
    await db.mediaBlobObjects.update(blob.id!, { data: bytes.buffer })
    await expect(prepare(s)).rejects.toThrow(); await db.mediaBlobObjects.put(blob)
    const response = (await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]')
      .equals([s.scope.projectId, 'raw-response', JSON.parse(raw.qualityJson).responseEvidenceHash]).first())!
    expect(response).toBeDefined(); await db.agentRunArtifacts.delete(response.id!)
    await expect(prepare(s)).rejects.toThrow(); await db.agentRunArtifacts.put(response)
    expect((await prepare(s)).intent.previewHash).toBe(s.build.previewHash)
    noNewCalls(s)
  }, 180_000)
})
