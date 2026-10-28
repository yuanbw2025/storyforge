import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/sound-production-brief'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import { avgSoundPlanningFixtureV1 } from '../helpers/avg-sound-planning-fixture'
import { avgSoundWireFixtureV1, avgSoundLibraryFixtureV1 } from '../helpers/avg-sound-provider-fixture'
import { avgSoundHarnessFixtureV1, adoptAvgSoundSourcesV1, adoptAvgSoundArtifactV1, cycleAvgSoundUntilV1, acceptedAvgSoundArtifactV1 } from '../helpers/avg-sound-harness-fixture'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { readAvgSoundOriginalMediaResponseV1 } from '../../src/lib/avg/sound-production-admission'
import { verifyAcceptedProductBuildArtifactV1 } from '../../src/lib/product-production/artifact-store'
import { readVerifiedMediaBlobObjectData } from '../../src/lib/product-production/media-blob-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1', apiKey: 'intercepted-engineering-key-no-external-account',
    model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.spyOn(readiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  // Only HTTP, the intentionally closed feature fence and jsdom's unavailable
  // audio decoder are controlled. Start/author/Run/proof/Blob are real paths.
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ measuredAt: Date.now(), environment: input.environment,
    assets: input.assets.map(a => ({ assetKey: a.assetKey, contentHash: a.contentHash, mimeType: a.mimeType, mediaClass: 'audio', status: 'decoded',
      decodedWidth: null, decodedHeight: null, decodedDurationMs: a.mimeType === 'audio/wav' ? 12000 : 500, decodedHasAlpha: null,
      decodedChannelCount: a.mimeType === 'audio/wav' ? 2 : 1, decodedSampleRateHz: 48000, integratedLufs: -18, truePeakDbtp: -12,
      loopSeamDbfs: -40, policyFailures: [], failureCode: null })) }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
async function setup(options: Parameters<typeof avgSoundWireFixtureV1>[1] = {}) {
  const semantic = await avgSoundPlanningFixtureV1(), req = semantic.compiled.requirements.find(r => r.dispatch.operation === 'generate-music')!
  const wire = await avgSoundWireFixtureV1(req, options)
  const s = await avgSoundHarnessFixtureV1({ audioFetcher: wire.fetcher,
    additionalBindings: [{ requirementKey: 'avg.media.music', adapterId: 'storyforge.avg.local-music.v1', bindingHash: wire.route.bindingHash,
      provider: 'storyforge-local-music', model: wire.capability.model }],
    configureSource: async source => {
      source.brief.avgSoundPlanning!.scope.librarySources = [avgSoundLibraryFixtureV1().source]
      Object.assign(source.brief.avgSoundPlanning!.musicBinding!, wire.route)
      source.brief.capabilityRequirements.find(c => c.requirementKey === 'avg.media.music')!.capabilityHash = wire.route.bindingHash
    } })
  await adoptAvgSoundSourcesV1(s); await cycleAvgSoundUntilV1(s, 'avg.proposal.sound-plan')
  await adoptAvgSoundArtifactV1(s, 'avg.media.sound-plan', s.author.plan)
  await cycleAvgSoundUntilV1(s, 'avg.media.compiled-sound-requirements')
  return { ...s, wire }
}
async function original(s: Awaited<ReturnType<typeof setup>>, key: string) {
  const row = (await acceptedAvgSoundArtifactV1(s, key))!, raw = JSON.parse(row.payloadJson), taskKey = `avg.sound.generate.${raw.requirement.template.requirementKey}`
  const ledger = JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson).tasks[taskKey]
  return readAvgSoundOriginalMediaResponseV1({ scope: s.scope, producerRunId: row.producerRunId!, taskKey, requirement: raw.requirement,
    responseEvidenceHash: raw.responseEvidenceHash, idempotencyKey: ledger.idempotencyKey, musicBinding: s.brief.avgSoundPlanning!.musicBinding })
}
describe('AVG actual sound raw producer chain with controlled HTTP and decoder', () => {
  it('does not mistake an independent ledger entry update for producer mutation, but still rejects changes to the original input settlement', async () => {
    const s = await setup(), row = (await acceptedAvgSoundArtifactV1(s, 'avg.media.compiled-sound-requirements'))!
    const ref = { scope: s.scope, buildId: s.buildId, artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash }
    const get = db.productBuilds.get.bind(db.productBuilds)
    let write: Promise<unknown> | undefined
    const spy = vi.spyOn(db.productBuilds, 'get').mockImplementationOnce((...args) => get(...args).then(build => {
      if (build) {
        const ledger = JSON.parse(build.budgetLedgerJson)
        ledger.tasks['avg.author.sound-plan'].errorCode = 'ENGINEERING sibling ledger update'
        // A separate native transaction is queued without awaiting it inside
        // the reader. No producer/adoption evidence is manufactured.
        write = Dexie.ignoreTransaction(() => db.transaction('rw', db.productBuilds,
          () => db.productBuilds.update(build.id!, { budgetLedgerJson: JSON.stringify(ledger) })))
      }
      return build
    }))
    const result = await Promise.allSettled([verifyAcceptedProductBuildArtifactV1(ref)])
    spy.mockRestore(); await write
    if (result[0].status === 'rejected') throw result[0].reason
    expect(result[0].status).toBe('fulfilled')
    const changed = vi.spyOn(db.productBuilds, 'get').mockImplementationOnce(async (...args) => {
      const build = await get(...args), ledger = JSON.parse(build!.budgetLedgerJson)
      ledger.tasks['avg.sound.compile.requirements'].usage.durationMs += 1
      await db.productBuilds.update(s.buildId, { budgetLedgerJson: JSON.stringify(ledger) })
      return build
    })
    await expect(verifyAcceptedProductBuildArtifactV1(ref)).rejects.toThrow(/已采用输入在读取期间已变化/)
    changed.mockRestore()
    const build = (await db.productBuilds.get(s.buildId))!, ledger = JSON.parse(build.budgetLedgerJson)
    ledger.tasks['avg.sound.compile.requirements'].status = 'failed'
    await db.productBuilds.update(s.buildId, { budgetLedgerJson: JSON.stringify(ledger) })
    await expect(verifyAcceptedProductBuildArtifactV1(ref)).rejects.toThrow()
  }, 60_000)

  it('independently receives music and original CC0 OGG via real claims, seals exact Blob evidence, preserves backup/remap and awaits review', async () => {
    const s = await setup(); await cycleAvgSoundUntilV1(s, 'avg.sound.raw.desk.bgm'); await cycleAvgSoundUntilV1(s, 'avg.sound.raw.desk.sfx')
    const bgm = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!, sfx = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.sfx'))!
    expect(s.calls).toHaveLength(1); expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    for (const row of [bgm, sfx]) {
      await expect(verifyAcceptedProductBuildArtifactV1({ scope: s.scope, buildId: s.buildId, artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash })).resolves.toMatchObject({ id: row.id })
      const response = await original(s, row.artifactKey), data = await readVerifiedMediaBlobObjectData((await db.mediaBlobObjects.get(row.blobObjectId!))!)
      expect(data.byteLength).toBe(response.data.byteLength); expect(row.contentHash).toBe(response.contentHash)
      expect(JSON.parse(row.qualityJson)).toMatchObject({ decoderVerified: true, hearing: 'unobserved', authorAdopted: false })
    }
    expect(sfx.mimeType).toBe('audio/ogg'); expect(sfx.contentHash).toBe(s.wire.library.member.memberHash)
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.review.audio.desk.bgm')).toBeUndefined(); expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.choice.desk.bgm')).toBeUndefined()
    const ledger = JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson).tasks
    expect(ledger['avg.sound.generate.desk.bgm'].usage).toMatchObject({ modelCalls: 0, mediaCalls: 1, costUsd: 0 })
    expect(ledger['avg.sound.generate.desk.sfx'].usage).toMatchObject({ modelCalls: 0, mediaCalls: 0, costUsd: 0 })
    const backup = await exportProjectJSON(s.scope.projectId), copyId = await importProjectJSON(backup)
    const copy = (await db.productBuilds.where('projectId').equals(copyId).first())!
    const copyScope = { projectId: copyId, workId: copy.workId!, worldId: copy.worldId! }
    for (const row of [bgm, sfx]) {
      const copied = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([copy.id!, row.artifactKey]).first())!
      expect(copied.payloadJson).toBe(row.payloadJson); expect(copied.contentHash).toBe(row.contentHash)
      const raw = JSON.parse(copied.payloadJson), taskKey = `avg.sound.generate.${raw.requirement.template.requirementKey}`
      await expect(readAvgSoundOriginalMediaResponseV1({ scope: copyScope, producerRunId: copied.producerRunId!, taskKey, requirement: raw.requirement,
        responseEvidenceHash: raw.responseEvidenceHash, idempotencyKey: ledger[taskKey].idempotencyKey, musicBinding: s.brief.avgSoundPlanning!.musicBinding })).resolves.toMatchObject({ contentHash: row.contentHash })
    }
    await deleteWork(copyScope.workId)
    expect({ ...await exportProjectJSON(s.scope.projectId), exportedAt: 0 }).toEqual({ ...backup, exportedAt: 0 })
    const count = s.wire.fetcher.mock.calls.length; db.close(); await db.open(); await runProductProductionSchedulerCycleV1(s)
    expect(s.wire.fetcher.mock.calls).toHaveLength(count)
  }, 60_000)
  it('keeps one corrupt complete original response and known usage without a raw candidate or automatic replay', async () => {
    const s = await setup({ wrongHash: true })
    for (let i = 0; i < 4; i++) await runProductProductionSchedulerCycleV1(s)
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm')).toBeUndefined()
    const ledger = JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson).tasks['avg.sound.generate.desk.bgm']
    expect(ledger.usage).toMatchObject({ mediaCalls: 1, modelCalls: 0, costUsd: 0 })
    expect((await db.agentRunArtifacts.where('projectId').equals(s.scope.projectId).toArray()).some(r => r.artifactKind === 'raw-response')).toBe(true)
  }, 60_000)
  it('preserves an unknown dispatched music request across reopen with no automatic second POST', async () => {
    const s = await setup({ networkFailure: true })
    for (let i = 0; i < 3; i++) await runProductProductionSchedulerCycleV1(s)
    db.close(); await db.open(); await runProductProductionSchedulerCycleV1(s)
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm')).toBeUndefined()
    const ledger = JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson)
    expect(ledger.attempts.find((a: { taskKey: string }) => a.taskKey === 'avg.sound.generate.desk.bgm')).toMatchObject({ usageKnown: false, errorCode: 'task-result-unknown' })
    const source = (await db.agentRunArtifacts.where('projectId').equals(s.scope.projectId).toArray())
      .filter(r => r.artifactKind === 'source-snapshot').map(r => JSON.parse(r.content!))
      .find(r => r.schema === 'storyforge.avg.sound-media-input' && r.taskKey === 'avg.sound.generate.desk.bgm')
    expect(source).toMatchObject({ version: 2, capability: { version: 2, journalId: s.wire.capability.journalId } })
  }, 60_000)
  it('detects missing original response bytes after sealing without loading a model or replacing evidence', async () => {
    const s = await setup(); await cycleAvgSoundUntilV1(s, 'avg.sound.raw.desk.bgm')
    const row = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!, payload = JSON.parse(row.payloadJson)
    const raw = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([s.scope.projectId, 'raw-response', payload.responseEvidenceHash]).first()
    await db.agentRunArtifacts.delete(raw!.id!); const count = s.wire.fetcher.mock.calls.length
    await expect(original(s, row.artifactKey)).rejects.toThrow(); expect(s.wire.fetcher.mock.calls).toHaveLength(count)
  }, 60_000)
  it('rejects a forged signal measurement at sealed admission despite an otherwise real claim and original response', async () => {
    const s = await setup(), execute = s.executor
    s.executor = async input => {
      const result = await execute(input)
      if (input.task.kind === 'avg-sound-music-generate') {
        const payload = result.artifacts[0].payload as { measurement: { integratedLufs: number } }
        payload.measurement.integratedLufs = -1
      }
      return result
    }
    const refusals: unknown[] = []
    for (let i = 0; i < 3; i++) {
      try { await runProductProductionSchedulerCycleV1(s) } catch (error) { refusals.push(error) }
    }
    expect(refusals.length).toBeGreaterThan(0)
    expect(refusals.every(e => e instanceof Error && /实际音频解码\/信号指标/.test(e.message))).toBe(true)
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm')).toBeUndefined()
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect((await db.agentRunArtifacts.where('projectId').equals(s.scope.projectId).toArray()).some(r => r.artifactKind === 'raw-response')).toBe(true)
  }, 60_000)
  it('records the received original response and its single dispatch but rejects a source changed during HTTP', async () => {
    let corrupt = async () => {}
    const s = await setup({ onPost: () => corrupt() })
    corrupt = async () => {
      const row = (await acceptedAvgSoundArtifactV1(s, 'avg.system.plan'))!, payload = JSON.parse(row.payloadJson)
      payload.unknownBrokenSource = 'changed during the original sound request'
      await db.productBuildArtifacts.update(row.id!, { payloadJson: JSON.stringify(payload) })
    }
    for (let i = 0; i < 3; i++) await runProductProductionSchedulerCycleV1(s)
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm')).toBeUndefined()
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(JSON.parse((await db.productBuilds.get(s.buildId))!.budgetLedgerJson).tasks['avg.sound.generate.desk.bgm'].usage).toMatchObject({ modelCalls: 0, mediaCalls: 1, costUsd: 0 })
  }, 60_000)
})
