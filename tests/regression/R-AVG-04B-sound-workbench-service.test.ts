import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as gate from '../../src/lib/avg/sound-production-brief'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import * as sourceReader from '../../src/lib/avg/sound-choice-validation'
import { readAvgSoundCandidateV1, readAvgSoundProposalV1, stageAvgSoundPlanV1, stageAvgSoundReviewV1, stageAvgSoundChoiceV1 } from '../../src/lib/avg/sound-workbench-service'
import { readProductProductionDetailsV1, stopProductProductionV1 } from '../../src/lib/product-production/service'
import { confirmAvgWorkspaceInputV1 } from '../../src/lib/avg/assembly-service'
import { avgSoundReviewHarnessFixtureV1, avgSoundReviewStartFixtureV1, avgSoundAuthorReviewFixtureV3 } from '../helpers/avg-sound-review-fixture'
import { acceptedAvgSoundArtifactV1, adoptAvgSoundSourcesV1, cycleAvgSoundUntilV1 } from '../helpers/avg-sound-harness-fixture'
import { hashAvgSoundBytesV1 } from '../../src/lib/avg/sound-provider-contract'

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1', apiKey: 'intercepted-engineering-key-no-external-account', model: 'agnes-2.5-flash' })
  vi.spyOn(gate, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ measuredAt: Date.now(), environment: input.environment,
    assets: input.assets.map(a => ({ assetKey: a.assetKey, contentHash: a.contentHash, mimeType: a.mimeType, mediaClass: 'audio', status: 'decoded',
      decodedWidth: null, decodedHeight: null, decodedDurationMs: a.mimeType === 'audio/wav' ? 12000 : 500, decodedHasAlpha: null,
      decodedChannelCount: a.mimeType === 'audio/wav' ? 2 : 1, decodedSampleRateHz: 48000, integratedLufs: -18, truePeakDbtp: -12,
      loopSeamDbfs: -40, policyFailures: [], failureCode: null })) }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
const ref = (r: { artifactKey: string; version: number; contentHash: string }) => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash })
const declaration = 'ENGINEERING explicit author declaration; no actual hearing or commercial acceptance'
const confirm = (s: { scope: Parameters<typeof confirmAvgWorkspaceInputV1>[0]['scope']; productionId: number }, row: { artifactKey: string; version: number; metadataJson: string }) =>
  confirmAvgWorkspaceInputV1({ ...s, artifactKey: row.artifactKey, candidateVersion: row.version, candidateHash: JSON.parse(row.metadataJson).candidateHash })

describe('original Sound production workbench services, with controlled HTTP/decoder only', () => {
  it('reads exact original proposal and physical sounds without credentials or an open factory, and creates no new media or authority', async () => {
    const s = await avgSoundReviewHarnessFixtureV1(), raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!
    const proposal = (await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan'))!, counts = [await db.mediaBlobObjects.count(), await db.avgDraftMedia.count(), await db.productBuildArtifacts.count()]
    useAIConfigStore.getState().setConfig({ apiKey: '' }); vi.mocked(gate.avgSoundProductionExecutionReadyV1).mockReturnValue(false)
    const read = await readAvgSoundCandidateV1({ ...s, raw: ref(raw) })
    expect(await hashAvgSoundBytesV1(read.data)).toBe(raw.contentHash); expect(read.blobObjectId).toBe(raw.blobObjectId)
    expect((await readAvgSoundProposalV1({ ...s, proposal: ref(proposal) })).payload).toEqual(s.author.plan)
    await expect(stageAvgSoundReviewV1({ ...s, raw: ref(raw), report: avgSoundAuthorReviewFixtureV3(read.payload, false), declaration })).rejects.toThrow(/尚未开放/)
    await expect(readAvgSoundCandidateV1({ ...s, raw: { ...ref(raw), version: 99 } })).rejects.toThrow()
    expect([await db.mediaBlobObjects.count(), await db.avgDraftMedia.count(), await db.productBuildArtifacts.count()]).toEqual(counts)
    expect(s.calls).toHaveLength(1); expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  }, 90_000)
  it('stages author edits against the exact real proposal and independently confirms them while preserving the original response', async () => {
    const s = await avgSoundReviewStartFixtureV1(); await adoptAvgSoundSourcesV1(s); await cycleAvgSoundUntilV1(s, 'avg.proposal.sound-plan')
    const original = (await acceptedAvgSoundArtifactV1(s, 'avg.proposal.sound-plan'))!, selected = await readAvgSoundProposalV1({ ...s, proposal: ref(original) })
    selected.payload.direction.goal += ' ENGINEERING author revision'
    const candidate = await stageAvgSoundPlanV1({ ...s, proposal: ref(original), payload: selected.payload, declaration })
    expect(candidate.status).toBe('pending'); expect(await acceptedAvgSoundArtifactV1(s, 'avg.media.sound-plan')).toBeUndefined()
    await confirm(s, candidate)
    expect(JSON.parse((await acceptedAvgSoundArtifactV1(s, 'avg.media.sound-plan'))!.payloadJson)).toEqual(selected.payload)
    expect(await db.productBuildArtifacts.get(original.id!)).toEqual(original); expect(s.calls).toHaveLength(1)
    await expect(stageAvgSoundPlanV1({ ...s, proposal: { ...ref(original), contentHash: 'f'.repeat(64) }, payload: selected.payload, declaration })).rejects.toThrow()
  }, 90_000)
  it('keeps observation, adoption, choice and Stage separate through actual original author commands', async () => {
    const s = await avgSoundReviewHarnessFixtureV1()
    const first = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!
    const unknown = await stageAvgSoundReviewV1({ ...s, raw: ref(first), report: avgSoundAuthorReviewFixtureV3(JSON.parse(first.payloadJson), false), declaration })
    expect(unknown.status).toBe('pending'); await confirm(s, unknown)
    await expect(stageAvgSoundChoiceV1({ ...s, raw: ref(first), declaration })).rejects.toThrow(/未观察/)
    for (const key of ['desk.bgm', 'desk.sfx']) {
      const raw = (await acceptedAvgSoundArtifactV1(s, `avg.sound.raw.${key}`))!
      const review = await stageAvgSoundReviewV1({ ...s, raw: ref(raw), report: avgSoundAuthorReviewFixtureV3(JSON.parse(raw.payloadJson)), declaration })
      await confirm(s, review)
      const choice = await stageAvgSoundChoiceV1({ ...s, raw: ref(raw), declaration })
      expect(choice.status).toBe('pending'); expect(await acceptedAvgSoundArtifactV1(s, `avg.sound.choice.${key}`)).toBeUndefined()
      await confirm(s, choice)
    }
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.author.stage')).toBeUndefined()
    expect(s.calls).toHaveLength(1); expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  }, 90_000)
  it('rejects a real concurrent stop during original source reading and retains the old request/result', async () => {
    const s = await avgSoundReviewHarnessFixtureV1(), raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!
    const read = sourceReader.readAvgRawSoundSourceV1
    vi.spyOn(sourceReader, 'readAvgRawSoundSourceV1').mockImplementationOnce(async input => {
      const value = await read(input), current = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
      await stopProductProductionV1({ scope: s.scope, production: current.production }); return value
    })
    await expect(readAvgSoundCandidateV1({ ...s, raw: ref(raw) })).rejects.toThrow(/变化/)
    expect(await db.productBuildArtifacts.get(raw.id!)).toEqual(raw); expect(s.calls).toHaveLength(1)
    expect(s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  }, 90_000)
})
