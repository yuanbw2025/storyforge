import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/sound-production-brief'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import { avgSoundPublisherFixtureV2 } from '../helpers/avg-sound-publisher-fixture'
import { avgSoundHarnessFixtureV1, adoptAvgSoundSourcesV1, adoptAvgSoundArtifactV1, cycleAvgSoundUntilV1, acceptedAvgSoundArtifactV1 } from '../helpers/avg-sound-harness-fixture'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { readAvgSoundOriginalMediaResponseV1 } from '../../src/lib/avg/sound-production-admission'
import { verifyAcceptedProductBuildArtifactV1 } from '../../src/lib/product-production/artifact-store'
import { readVerifiedMediaBlobObjectData } from '../../src/lib/product-production/media-blob-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1',
    apiKey: 'intercepted-engineering-key-no-external-account', model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.spyOn(readiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  // Happy DOM has no native audio decoder. These explicit controlled signal
  // observations test the real producer/author/lifecycle path, never actual
  // rain loudness, loop seam, hearing or commercial-quality acceptance.
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ measuredAt: Date.now(), environment: input.environment,
    assets: input.assets.map(a => ({ assetKey: a.assetKey, contentHash: a.contentHash, mimeType: a.mimeType, mediaClass: 'audio', status: 'decoded',
      decodedWidth: null, decodedHeight: null, decodedDurationMs: 3991, decodedHasAlpha: null, decodedChannelCount: 2, decodedSampleRateHz: 48000,
      integratedLufs: -18, truePeakDbtp: -12, loopSeamDbfs: -40, policyFailures: [], failureCode: null })) }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

async function setup(corrupt = false) {
  const actual = avgSoundPublisherFixtureV2()
  const audioFetcher = vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
    expect(String(target)).toBe(`http://127.0.0.1:5298/v1/library/audio/${actual.source.archiveHash}/${actual.source.memberHash}`)
    expect(init?.method).toBe('GET')
    const result = corrupt ? { ...actual.result, licenseEvidence: { ...actual.result.licenseEvidence, publisherPageHash: '0'.repeat(64) } } : actual.result
    return new Response(actual.data.slice(0), { headers: { 'content-type': 'audio/ogg', 'x-storyforge-library-result': JSON.stringify(result) } })
  })
  const s = await avgSoundHarnessFixtureV1({ libraryOnly: true, audioFetcher, configureSource: async source => {
    const sound = source.brief.avgSoundPlanning!
    sound.scope.librarySources = [actual.source]
    sound.scope.templates[0].source = { kind: 'licensed-library', allowedSourceKeys: [actual.source.sourceKey] }
    source.plan.entries = source.plan.entries.filter(e => e.librarySourceKey !== null).map(e => ({ ...e, librarySourceKey: actual.source.sourceKey }))
  } })
  await adoptAvgSoundSourcesV1(s); await cycleAvgSoundUntilV1(s, 'avg.proposal.sound-plan')
  await adoptAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan)
  await cycleAvgSoundUntilV1(s, 'avg.media.compiled-sound-requirements')
  return { ...s, actual, audioFetcher }
}

describe('publisher-page V2 original audio in the same actual governed sound producer and lifecycle', () => {
  it('starts/adopts/receives one original member, retains exact response and Work Blob through backup/remap/delete, without hearing/selection', async () => {
    const s = await setup()
    await cycleAvgSoundUntilV1(s, 'avg.sound.raw.desk.sfx')
    const row = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.sfx'))!, raw = JSON.parse(row.payloadJson)
    expect(raw.providerResult).toEqual(s.actual.result)
    expect(raw.requirement.dispatch.source).toEqual(s.actual.source)
    expect(row.contentHash).toBe(s.actual.source.memberHash)
    const data = await readVerifiedMediaBlobObjectData((await db.mediaBlobObjects.get(row.blobObjectId!))!)
    expect(new Uint8Array(data)).toEqual(new Uint8Array(s.actual.data))
    await expect(verifyAcceptedProductBuildArtifactV1({ scope: s.scope, buildId: s.buildId, artifactKey: row.artifactKey,
      version: row.version, contentHash: row.contentHash })).resolves.toMatchObject({ id: row.id })
    const taskKey = 'avg.sound.generate.desk.sfx', ledger = JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson).tasks[taskKey]
    expect(ledger.usage).toMatchObject({ modelCalls: 0, mediaCalls: 0, costUsd: 0 })
    const original = await readAvgSoundOriginalMediaResponseV1({ scope: s.scope, producerRunId: row.producerRunId!, taskKey,
      requirement: raw.requirement, responseEvidenceHash: raw.responseEvidenceHash, idempotencyKey: ledger.idempotencyKey, musicBinding: null })
    expect(new Uint8Array(original.data)).toEqual(new Uint8Array(s.actual.data))
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.review.audio.desk.sfx')).toBeUndefined()
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.choice.desk.sfx')).toBeUndefined()
    expect(JSON.parse(row.qualityJson)).toMatchObject({ hearing: 'unobserved', authorAdopted: false })
    const backup = await exportProjectJSON(s.scope.projectId), copyId = await importProjectJSON(backup)
    const copy = (await db.productBuilds.where('projectId').equals(copyId).first())!, scope = { projectId: copyId, worldId: copy.worldId!, workId: copy.workId! }
    const copied = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([copy.id!, row.artifactKey]).first())!
    expect(copied.payloadJson).toBe(row.payloadJson)
    await expect(readAvgSoundOriginalMediaResponseV1({ scope, producerRunId: copied.producerRunId!, taskKey, requirement: raw.requirement,
      responseEvidenceHash: raw.responseEvidenceHash, idempotencyKey: ledger.idempotencyKey, musicBinding: null })).resolves.toMatchObject({ contentHash: row.contentHash })
    await deleteWork(scope.workId)
    expect({ ...await exportProjectJSON(s.scope.projectId), exportedAt: 0 }).toEqual({ ...backup, exportedAt: 0 })
    const calls = s.audioFetcher.mock.calls.length; db.close(); await db.open(); await runProductProductionSchedulerCycleV1(s)
    expect(s.audioFetcher).toHaveBeenCalledTimes(calls); expect(calls).toBe(1)
    expect(await db.productReleases.count()).toBe(0)
  },90_000)

  it('preserves a corrupt publisher witness as a failed original response, without a raw candidate, retry or selection', async () => {
    const s = await setup(true), beforeBlobs = await db.mediaBlobObjects.count()
    await runProductProductionSchedulerCycleV1(s)
    expect(s.audioFetcher).toHaveBeenCalledOnce()
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.sfx')).toBeUndefined()
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.choice.desk.sfx')).toBeUndefined()
    expect((await db.productBuilds.get(s.buildId))!.status).toBe('recovery-required')
    const calls = s.audioFetcher.mock.calls.length; await runProductProductionSchedulerCycleV1(s)
    expect(s.audioFetcher).toHaveBeenCalledTimes(calls)
    expect(await db.mediaBlobObjects.count()).toBe(beforeBlobs); expect(await db.productReleases.count()).toBe(0)
  },90_000)
})
