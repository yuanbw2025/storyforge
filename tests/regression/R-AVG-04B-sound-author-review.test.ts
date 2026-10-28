import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as readiness from '../../src/lib/avg/sound-production-brief'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'
import * as configuration from '../../src/lib/avg/sound-configuration'
import { readAvgConfirmedSoundChoicesV1, readAvgSystemPlanForCompilationV1 } from '../../src/lib/avg/author-artifacts'
import { configureAvgChosenSoundDraftV1, stageAvgWorkspaceInputV1 } from '../../src/lib/avg/assembly-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { readAvgRawSoundSourceV1 } from '../../src/lib/avg/sound-choice-validation'
import { parseAvgAuthorSoundReviewV3 } from '../../src/lib/avg/sound-review-contract'
import { assertAvgSoundReviewRevisionV3 } from '../../src/lib/avg/sound-review'
import { parseAvgProfessionalArtifactV1 } from '../../src/lib/avg/artifact-contract'
import { AVG_VOICE_REVIEW_CRITERIA_V1 } from '../../src/lib/avg/voice-review-contract'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { acceptedAvgSoundArtifactV1, adoptAvgSoundArtifactV1, stageAvgSoundArtifactV1, confirmAvgSoundCandidateV1 } from '../helpers/avg-sound-harness-fixture'
import { avgSoundReviewHarnessFixtureV1, avgSoundAuthorReviewFixtureV3, avgSoundAuthorChoiceFixtureV1,
  adoptAvgSoundReviewFixtureV3, avgSoundChoiceReadInputV1 } from '../helpers/avg-sound-review-fixture'

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.getState().setConfig({ provider: 'agnes', baseUrl: 'https://sound-proposal.fixture.invalid/v1', apiKey: 'intercepted-engineering-key-no-external-account',
    model: 'agnes-2.5-flash', temperature: .7, maxTokens: 0 })
  vi.spyOn(readiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(true)
  vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => {
    return { measuredAt: Date.now(), environment: input.environment,
    assets: input.assets.map(a => ({ assetKey: a.assetKey, contentHash: a.contentHash, mimeType: a.mimeType, mediaClass: 'audio', status: 'decoded',
      decodedWidth: null, decodedHeight: null, decodedDurationMs: a.mimeType === 'audio/wav' ? 12000 : 500, decodedHasAlpha: null,
      decodedChannelCount: a.mimeType === 'audio/wav' ? 2 : 1, decodedSampleRateHz: 48000, integratedLufs: -18, truePeakDbtp: -12,
      loopSeamDbfs: -40, policyFailures: [], failureCode: null })) } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
const ref = (r: { artifactKey: string; version: number; contentHash: string }) => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash })
const posts = (s: Awaited<ReturnType<typeof avgSoundReviewHarnessFixtureV1>>) => s.wire.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').length

describe('AVG actual sound author observation and selection with controlled audio transport', () => {
  it('retains unknown hearing, refuses selection, independently adopts exact observed revisions and preserves portable ownership', async () => {
    const s = await avgSoundReviewHarnessFixtureV1()
    const unknown = await adoptAvgSoundReviewFixtureV3(s, 'desk.bgm', false)
    await expect(stageAvgSoundArtifactV1(s, 'avg.sound.choice.desk.bgm', avgSoundAuthorChoiceFixtureV1(unknown.raw, unknown.review))).rejects.toThrow(/未观察/)
    db.close(); await db.open()
    expect(JSON.parse((await acceptedAvgSoundArtifactV1(s, unknown.review.artifactKey))!.payloadJson).soundEvidence.audition).toBeNull()
    const selections = []
    for (const key of ['desk.bgm', 'desk.sfx']) {
      const { raw, review } = await adoptAvgSoundReviewFixtureV3(s, key)
      const candidate = await adoptAvgSoundArtifactV1(s, `avg.sound.choice.${key}`, avgSoundAuthorChoiceFixtureV1(raw, review))
      expect(JSON.parse(candidate.metadataJson)).toMatchObject({ version: 9, soundChoiceValidation: { contentHash: raw.contentHash,
        rawReceiptHash: raw.producerReceiptHash, reviewReceiptHash: JSON.parse(review.metadataJson).receiptHash } })
      selections.push({ raw, review })
    }
    const read = await readAvgConfirmedSoundChoicesV1(await avgSoundChoiceReadInputV1(s))
    expect(read).toHaveLength(2)
    expect(read.map(r => r.raw.contentHash)).toEqual(selections.map(r => r.raw.contentHash))
    expect(read.map(r => r.blobObjectId)).toEqual(selections.map(r => r.raw.blobObjectId))
    expect(posts(s)).toBe(1); expect(s.calls).toHaveLength(1)
    const backup = await exportProjectJSON(s.scope.projectId), copyId = await importProjectJSON(backup)
    const copy = (await db.productBuilds.where('projectId').equals(copyId).first())!
    await expect(readAvgConfirmedSoundChoicesV1({ scope: { projectId: copyId, workId: copy.workId!, worldId: copy.worldId! },
      buildId: copy.id!, expectedBuildRevision: copy.stateRevision, controlEpoch: copy.controlEpoch })).rejects.toThrow()
    const copied = (await db.productBuildArtifacts.where('buildId').equals(copy.id!).toArray()).filter(r => r.artifactKey.startsWith('avg.sound.choice.'))
    for (const row of copied) expect(row.payloadJson).toBe((await acceptedAvgSoundArtifactV1(s, row.artifactKey))!.payloadJson)
    await deleteWork(copy.workId!)
    expect({ ...await exportProjectJSON(s.scope.projectId), exportedAt: 0 }).toEqual({ ...backup, exportedAt: 0 })
    expect(posts(s)).toBe(1)
  }, 60_000)
  it('refuses muted, partial, seeked, accelerated, wrong-source and incomplete-loop pass reports without author writes or another dispatch', async () => {
    const s = await avgSoundReviewHarnessFixtureV1(), raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!
    const report = avgSoundAuthorReviewFixtureV3(JSON.parse(raw.payloadJson))
    const mutate = [
      (r: typeof report) => { r.soundEvidence.audition!.muted = true },
      (r: typeof report) => { r.soundEvidence.audition!.playedMs = 1 },
      (r: typeof report) => { r.soundEvidence.audition!.seeked = true },
      (r: typeof report) => { r.soundEvidence.audition!.playbackRate = 2 },
      (r: typeof report) => { r.soundEvidence.audioHash = 'f'.repeat(64) },
      (r: typeof report) => { r.soundEvidence.requestIdentityHash = 'e'.repeat(64) },
      (r: typeof report) => { r.soundEvidence.checks = r.soundEvidence.checks.filter(c => c.criterion !== 'instrumental-only') },
      (r: typeof report) => { Object.assign(r.soundEvidence.audition!, { completedCycles: 1, continuousLoops: 0, playedMs: 12000 }) },
    ]
    const count = await db.productBuildArtifacts.count()
    for (const change of mutate) {
      const bad = structuredClone(report); change(bad)
      await expect(stageAvgSoundArtifactV1(s, 'avg.review.audio.desk.bgm', bad)).rejects.toThrow()
    }
    expect(await db.productBuildArtifacts.count()).toBe(count)
    const a = report.soundEvidence.audition!
    const voice = { schema: report.schema, version: 1, targetKey: report.targetKey, observations: ['audio'], unobserved: [], issues: [],
      audioEvidence: { audioHash: report.soundEvidence.audioHash, requestIdentityHash: report.soundEvidence.requestIdentityHash,
        audition: { generation: a.generation, outcome: 'ended', durationMs: a.durationMs, playedMs: a.durationMs,
          muted: false, volume: 1, playbackRate: 1, seeked: false }, checks: AVG_VOICE_REVIEW_CRITERIA_V1.map(criterion => ({
            criterion, result: 'pass', note: 'ENGINEERING valid legacy voice declaration' })), note: 'ENGINEERING voice review cannot approve music' } }
    expect(parseAvgProfessionalArtifactV1(voice)).toMatchObject({ version: 1, audioEvidence: { checks: expect.any(Array) } })
    expect(() => parseAvgAuthorSoundReviewV3(voice)).toThrow()
    await expect(stageAvgSoundArtifactV1(s, 'avg.review.audio.desk.bgm', voice)).rejects.toThrow()
    expect(posts(s)).toBe(1)
  }, 60_000)
  it('retains blocking repair evidence and requires a new observation and playback before clearing it', async () => {
    const s = await avgSoundReviewHarnessFixtureV1(), raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!
    const report = avgSoundAuthorReviewFixtureV3(JSON.parse(raw.payloadJson))
    report.soundEvidence.checks.find(c => c.criterion === 'noise-distortion')!.result = 'fail'
    await expect(stageAvgSoundArtifactV1(s, 'avg.review.audio.desk.bgm', report)).rejects.toThrow(/blocking/)
    report.issues = [{ issueKey: 'sound.noise-distortion', locationKey: 'desk.bgm', severity: 'blocking', owner: 'media',
      evidence: 'ENGINEERING audible noise declaration', allowedChange: 'Replace sound in a new production', impact: 'Intended quiet purpose', recheck: 'Play exact revised bytes again' }]
    await adoptAvgSoundArtifactV1(s, 'avg.review.audio.desk.bgm', report)
    const review = (await acceptedAvgSoundArtifactV1(s, 'avg.review.audio.desk.bgm'))!
    await expect(stageAvgSoundArtifactV1(s, 'avg.sound.choice.desk.bgm', avgSoundAuthorChoiceFixtureV1(raw, review))).rejects.toThrow(/blocking/)
    const passing = avgSoundAuthorReviewFixtureV3(JSON.parse(raw.payloadJson))
    passing.soundEvidence.note = report.soundEvidence.note
    await expect(stageAvgSoundArtifactV1(s, 'avg.review.audio.desk.bgm', passing)).rejects.toThrow(/新的观察/)
    passing.soundEvidence.note = 'ENGINEERING repeated playback and new assessment for the repair'
    passing.soundEvidence.audition!.generation = report.soundEvidence.audition!.generation
    expect(() => assertAvgSoundReviewRevisionV3(report, passing)).toThrow(/重新播放/)
    passing.soundEvidence.audition!.generation = `audition.${crypto.randomUUID()}`
    await adoptAvgSoundArtifactV1(s, 'avg.review.audio.desk.bgm', passing)
    expect(posts(s)).toBe(1)
  }, 60_000)
  it('records a heard loop-boundary failure after interruption while retaining unknown observations and refusing selection', async () => {
    const s = await avgSoundReviewHarnessFixtureV1(), raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!
    const report = avgSoundAuthorReviewFixtureV3(JSON.parse(raw.payloadJson))
    Object.assign(report.soundEvidence.audition!, { outcome: 'interrupted', completedCycles: 1, continuousLoops: 1, playedMs: 12020 })
    report.unobserved = ['ENGINEERING stopped after the seam; remaining listening incomplete']
    for (const check of report.soundEvidence.checks) check.result = check.criterion === 'loop-seam' ? 'fail' : 'unknown'
    report.issues = [{ issueKey: 'sound.loop-seam', locationKey: 'desk.bgm', severity: 'blocking', owner: 'media',
      evidence: 'ENGINEERING heard transition declaration', allowedChange: 'Repair loop in a new production', impact: 'Loop discontinuity', recheck: 'Observe two exact continuous cycles' }]
    await adoptAvgSoundArtifactV1(s, 'avg.review.audio.desk.bgm', report)
    const review = (await acceptedAvgSoundArtifactV1(s, 'avg.review.audio.desk.bgm'))!
    expect(JSON.parse(review.payloadJson).soundEvidence.audition.outcome).toBe('interrupted')
    await expect(stageAvgSoundArtifactV1(s, 'avg.sound.choice.desk.bgm', avgSoundAuthorChoiceFixtureV1(raw, review))).rejects.toThrow(/未观察/)
    expect(posts(s)).toBe(1)
  }, 60_000)
  it('retains original sealed measurements across device DSP changes and keeps current decode observation separate from author choice', async () => {
    const s = await avgSoundReviewHarnessFixtureV1(), raw = (await acceptedAvgSoundArtifactV1(s, 'avg.sound.raw.desk.bgm'))!
    const before = raw.payloadJson, decode = vi.mocked(verifier.verifyProductMediaRuntimeUrlsV1).getMockImplementation()!
    vi.mocked(verifier.verifyProductMediaRuntimeUrlsV1).mockImplementation(async input => {
      const result = await decode(input)
      return { ...result, assets: result.assets.map(a => ({ ...a, decodedSampleRateHz: 44100,
        integratedLufs: a.integratedLufs! + .2, loopSeamDbfs: a.loopSeamDbfs! - 1 })) }
    })
    const source = await readAvgRawSoundSourceV1({ scope: s.scope, buildId: s.buildId, raw: ref(raw) })
    expect(source.originalMeasurement.decodedSampleRateHz).toBe(48000)
    expect(source.currentMeasurement.decodedSampleRateHz).toBe(44100)
    expect(source.currentMeasurement.integratedLufs).not.toBe(source.originalMeasurement.integratedLufs)
    const { review } = await adoptAvgSoundReviewFixtureV3(s, 'desk.bgm')
    await adoptAvgSoundArtifactV1(s, 'avg.sound.choice.desk.bgm', avgSoundAuthorChoiceFixtureV1(raw, review))
    expect((await acceptedAvgSoundArtifactV1(s, raw.artifactKey))!.payloadJson).toBe(before)
    expect(posts(s)).toBe(1)
  }, 60_000)
  it('invalidates a pending choice when its adopted review revision changes and refuses an old review reference', async () => {
    const s = await avgSoundReviewHarnessFixtureV1(), { raw, review } = await adoptAvgSoundReviewFixtureV3(s, 'desk.bgm')
    const choice = avgSoundAuthorChoiceFixtureV1(raw, review), candidate = await stageAvgSoundArtifactV1(s, 'avg.sound.choice.desk.bgm', choice)
    const revised = avgSoundAuthorReviewFixtureV3(JSON.parse(raw.payloadJson)); revised.soundEvidence.note = 'ENGINEERING new exact observation revision'
    await adoptAvgSoundArtifactV1(s, review.artifactKey, revised)
    expect((await confirmAvgSoundCandidateV1(s, candidate)).ok).toBe(false)
    expect((await db.productBuildArtifacts.get(candidate.id!))!.status).not.toBe('accepted')
    await expect(stageAvgSoundArtifactV1(s, candidate.artifactKey, choice)).rejects.toThrow(/版本/)
    const current = (await acceptedAvgSoundArtifactV1(s, review.artifactKey))!
    await adoptAvgSoundArtifactV1(s, candidate.artifactKey, avgSoundAuthorChoiceFixtureV1(raw, current))
    expect(posts(s)).toBe(1)
  }, 60_000)
  it('rejects forged asset licence and foreign Work access and preserves a missing original response without recreating or regenerating it', async () => {
    const s = await avgSoundReviewHarnessFixtureV1(), { raw, review } = await adoptAvgSoundReviewFixtureV3(s, 'desk.sfx')
    const choice = avgSoundAuthorChoiceFixtureV1(raw, review); choice.asset.license = 'invented commercial licence'
    await expect(stageAvgSoundArtifactV1(s, 'avg.sound.choice.desk.sfx', choice)).rejects.toThrow(/许可/)
    await expect(readAvgRawSoundSourceV1({ scope: { ...s.scope, workId: s.scope.workId + 1000 }, buildId: s.buildId, raw: ref(raw) })).rejects.toThrow()
    const candidate = await stageAvgSoundArtifactV1(s, 'avg.sound.choice.desk.sfx', avgSoundAuthorChoiceFixtureV1(raw, review))
    const payload = JSON.parse(raw.payloadJson), evidence = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]')
      .equals([s.scope.projectId, 'raw-response', payload.responseEvidenceHash]).first()
    await db.agentRunArtifacts.delete(evidence!.id!)
    expect((await confirmAvgSoundCandidateV1(s, candidate)).ok).toBe(false)
    db.close(); await db.open()
    await expect(readAvgRawSoundSourceV1({ scope: s.scope, buildId: s.buildId, raw: ref(raw) })).rejects.toThrow()
    expect(await acceptedAvgSoundArtifactV1(s, 'avg.sound.choice.desk.sfx')).toBeUndefined()
    expect(await db.agentRunArtifacts.get(evidence!.id!)).toBeUndefined(); expect(posts(s)).toBe(1)
  }, 60_000)
  it('configures only complete adopted sounds with draft CAS, proves exact Stage cues and reads actual adopted sound consumers', async () => {
    const s = await avgSoundReviewHarnessFixtureV1(), initial = await readAvgDraftV1(s.scope)
    const configure = (revision: number) => configureAvgChosenSoundDraftV1({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: revision })
    await expect(configure(initial.revision)).rejects.toThrow()
    expect((await readAvgDraftV1(s.scope)).editorJson).toBe(initial.editorJson)
    for (const key of ['desk.bgm', 'desk.sfx']) {
      const { raw, review } = await adoptAvgSoundReviewFixtureV3(s, key)
      await adoptAvgSoundArtifactV1(s, `avg.sound.choice.${key}`, avgSoundAuthorChoiceFixtureV1(raw, review))
    }
    await expect(configure(initial.revision + 1)).rejects.toThrow(/草稿/)
    const blobCount = await db.mediaBlobObjects.count(), draftMediaCount = await db.avgDraftMedia.count()
    const configured = await configure(initial.revision), workspace = JSON.parse(configured.editorJson!), old = JSON.parse(initial.editorJson!)
    expect(configured.revision).toBe(initial.revision + 1)
    expect(workspace.systemPlan).toEqual(old.systemPlan); expect(workspace.scripts).toEqual(old.scripts)
    expect(workspace.presentation.reading).toEqual(old.presentation.reading)
    expect(workspace.presentation.stage.assets.map((a: { kind: string }) => a.kind)).toEqual(['bgm', 'sfx'])
    expect(workspace.presentation.stage.cues).toEqual(expect.arrayContaining([expect.objectContaining({ assetKey: 'sound.desk.bgm', loop: true, volume: .2 }),
      expect.objectContaining({ assetKey: 'sound.desk.sfx', loop: false, volume: .6 })]))
    expect(await db.mediaBlobObjects.count()).toBe(blobCount); expect(await db.avgDraftMedia.count()).toBe(draftMediaCount)
    const stage = (revision: number) => stageAvgWorkspaceInputV1({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: revision,
      artifactKey: 'avg.author.stage', declaration: 'ENGINEERING confirms exact preview-only original sound consumers, no commercial acceptance' })
    const bad = structuredClone(workspace); bad.presentation.stage.cues[0].volume = .9
    const edited = await saveAvgAuthorWorkspaceV1(s.scope, configured.revision, bad)
    await expect(stage(edited.revision)).rejects.toThrow(/音量/)
    const restored = await saveAvgAuthorWorkspaceV1(s.scope, edited.revision, workspace), candidate = await stage(restored.revision)
    expect((await confirmAvgSoundCandidateV1(s, candidate)).ok).toBe(true)
    const source = await readAvgSystemPlanForCompilationV1({ ...await avgSoundChoiceReadInputV1(s), includeAuthorStage: true })
    expect(source.soundChoices).toHaveLength(2); expect(source.authorStage!.payload.stage).toEqual(workspace.presentation.stage)
    expect(posts(s)).toBe(1)
  }, 60_000)
  it('retains a newer saved author draft when it changes during configuration instead of overwriting it with the derived sound draft', async () => {
    const s = await avgSoundReviewHarnessFixtureV1()
    for (const key of ['desk.bgm', 'desk.sfx']) {
      const { raw, review } = await adoptAvgSoundReviewFixtureV3(s, key)
      await adoptAvgSoundArtifactV1(s, `avg.sound.choice.${key}`, avgSoundAuthorChoiceFixtureV1(raw, review))
    }
    const initial = await readAvgDraftV1(s.scope), edited = JSON.parse(initial.editorJson!)
    edited.presentation.reading.autoDelayMs += 1
    const apply = configuration.applyAvgSoundChoicesToDraftV1
    // Run the actual pure projection, then schedule a real author edit after
    // all proof read transactions finish. No authority/result is substituted.
    vi.spyOn(configuration, 'applyAvgSoundChoicesToDraftV1').mockImplementationOnce(async input => {
      const result = await apply(input)
      await saveAvgAuthorWorkspaceV1(s.scope, initial.revision, edited)
      return result
    })
    await expect(configureAvgChosenSoundDraftV1({ scope: s.scope, productionId: s.productionId, expectedDraftRevision: initial.revision })).rejects.toThrow(/草稿/)
    const current = await readAvgDraftV1(s.scope)
    expect(current.revision).toBe(initial.revision + 1); expect(JSON.parse(current.editorJson!)).toEqual(edited)
    expect(posts(s)).toBe(1)
  }, 60_000)
})
