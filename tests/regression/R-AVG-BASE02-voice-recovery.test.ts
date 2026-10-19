import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as gates from '../../src/lib/avg/assembly-contract'
import * as mediaVerifier from '../../src/lib/product-production/media-runtime-verifier'
import { avgVoiceAssemblyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { avgAuthorWorkspaceFixture } from '../helpers/avg-author-stage-fixture'
import { avgReadingAudioFixture } from '../helpers/avg-reading-fixture'
import { prepareNativeAvgAssembly, startNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { prepareAvgVoiceDraftV1 } from '../../src/lib/avg/voice-draft-contract'
import { configuredAvgVoiceEndpointHashV1 } from '../../src/lib/avg/voice-transport'
import { hashAvgSpeechProtocolV1 } from '../../src/lib/avg/voice-request-contract'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { beginProductProductionEvolutionV1, readProductProductionDetailsV1, stopProductProductionV1 } from '../../src/lib/product-production/service'
import { assertAvgStoredAssemblyBriefV3, encodeAvgStoredAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-storage'
import { parseAvgVoiceRecoveryV1 } from '../../src/lib/avg/voice-recovery-contract'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { prepareAvgVoiceRecoveryBriefV1, startAvgAssemblyV1, runAvgAssemblyV1, stageAvgWorkspaceInputV1,
  confirmAvgWorkspaceInputV1, readAvgRawVoiceCandidateV3, stageAvgAudioReviewV3, stageAvgVoiceChoiceV3,
  configureAvgChosenVoiceDraftV3, configureAvgChosenMediaDraftV2, stageAvgMediaChoiceV2, readAvgVoiceRecoveryOptionsV1,
  readAvgAssemblyWorkspaceV1 } from '../../src/lib/avg/assembly-service'
import type { AvgReviewIssuesV1 } from '../../src/lib/avg/artifact-contract'
import { freezeAvgVisualProductionBatchV1 } from '../../src/lib/avg/media-source'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { readAvgVoiceRecoverySourceV1 } from '../../src/lib/avg/voice-recovery'

const config = { provider: 'agnes' as const, baseUrl: 'https://speech.fixture.invalid/v1', apiKey: 'test-only-no-network',
  model: 'agnes-2.5-flash', temperature: 0.7, maxTokens: 0 }
beforeEach(async () => {
  await db.delete(); await db.open(); vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1')
  vi.spyOn(gates, 'avgVoiceProductionEnabledV3').mockReturnValue(true)
  useAIConfigStore.getState().setConfig(config)
  vi.spyOn(mediaVerifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ measuredAt: Date.now(), environment: input.environment,
    assets: input.assets.map(asset => ({ assetKey: asset.assetKey, contentHash: asset.contentHash, mimeType: asset.mimeType,
      mediaClass: asset.mimeType.startsWith('image/') ? 'image' : 'audio', status: 'decoded',
      decodedWidth: asset.mimeType.startsWith('image/') ? 576 : null, decodedHeight: asset.mimeType.startsWith('image/') ? 324 : null,
      decodedDurationMs: asset.mimeType.startsWith('image/') ? null : 500, decodedHasAlpha: asset.mimeType.startsWith('image/') ? false : null,
      decodedChannelCount: asset.mimeType.startsWith('image/') ? null : 1, decodedSampleRateHz: asset.mimeType.startsWith('image/') ? null : 48000, integratedLufs: -18,
      truePeakDbtp: -12, loopSeamDbfs: -40, policyFailures: [], failureCode: null })) }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); db.close() })

type Owner = Pick<Awaited<ReturnType<typeof startNativeAvgAssembly>>, 'scope' | 'productionId'>
async function confirm(s: Owner, candidate: { artifactKey: string; version: number; metadataJson: string }) {
  return confirmAvgWorkspaceInputV1({ ...s, artifactKey: candidate.artifactKey, candidateVersion: candidate.version,
    candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
}
async function adoptInputs(s: Owner, withStage = false) {
  const draft = await readAvgDraftV1(s.scope), workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  const keys = withStage ? ['avg.author.stage'] : ['avg.system.plan', ...workspace.scripts.map(script => `avg.content.scene-script.${script.sceneKey}`)]
  for (const artifactKey of keys) {
    const candidate = await stageAvgWorkspaceInputV1({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision,
      artifactKey, declaration: '原创工程输入；不签文学、配音或商用验收。' })
    await confirm(s, candidate)
  }
}
async function seed(count = 1, unknown = false, withImage = false) {
  const { assembly } = await avgVoiceAssemblyFixtureV3(withImage), workspace = avgAuthorWorkspaceFixture()
  workspace.presentation.reading = { schema: 'storyforge.avg.reading-plan', version: 1, manualVoice: 'wait', voiceFailure: 'pause',
    maximumVoiceWaitMs: 30000, autoDelayMs: 800, voices: [] }
  const script = workspace.scripts.find(script => script.sceneKey === 'desk')!
  if (count === 2) script.lines.push({ ...structuredClone(script.lines[0]!), lineKey: 'line.desk.second', beatKey: 'line.desk.second', text: '这是第二句工程校准。' })
  const protocol = assembly.voice.protocol, preset = assembly.voice.batch.presets[0]!
  protocol.provider = 'agnes'; protocol.endpointRouteHash = await configuredAvgVoiceEndpointHashV1({ baseUrl: config.baseUrl, model: protocol.model })
  Object.assign(preset, { provider: protocol.provider, endpointRouteHash: protocol.endpointRouteHash, capabilityHash: await hashAvgSpeechProtocolV1(protocol) })
  workspace.voiceProduction = await prepareAvgVoiceDraftV1({ workspace, protocol, presets: [preset], lines: script.lines.map((line, i) => ({
    requirementKey: `keeper.line.${i}`, assetKey: `voice.desk.${i}`, sceneKey: 'desk', lineKey: line.lineKey,
    presetKey: preset.presetKey, maximumDurationMs: 29999, performance: assembly.voice.batch.requirements[0]!.performance })) })
  if (assembly.image) workspace.mediaBatch = await freezeAvgVisualProductionBatchV1({ schema: assembly.image.mediaBatch.schema,
    version: 1, batchKey: assembly.image.mediaBatch.batchKey, revision: 1, requirements: assembly.image.mediaBatch.requirements }, workspace)
  const tone = await avgReadingAudioFixture(500)
  const image = withImage ? new Uint8Array(await deterministicRegionMapPngV1({ width: 576, height: 324, palette: ['#18213b', '#39506b', '#c8dce8'] })) : null
  const fetcher = vi.fn(async (target: RequestInfo | URL) => {
    if (image && String(target).endsWith('/images/generations')) {
      let body = ''; for (let i = 0; i < image.length; i += 16384) body += String.fromCharCode(...image.subarray(i, i + 16384))
      return new Response(JSON.stringify({ data: [{ b64_json: btoa(body) }] }), { headers: { 'Content-Type': 'application/json' } })
    }
    if (!String(target).endsWith('/audio/speech')) throw new Error('Unexpected controlled route')
    if (unknown) throw new TypeError('Controlled lost response after dispatch')
    const data = tone.data.slice(0); new Uint8Array(data)[100] ^= fetcher.mock.calls.length
    return new Response(data, { headers: { 'Content-Type': 'audio/wav', 'x-request-id': `voice.recovery.fixture.${fetcher.mock.calls.length}` } })
  })
  vi.stubGlobal('fetch', fetcher)
  const prepared = await prepareNativeAvgAssembly(workspace), s = await startNativeAvgAssembly(prepared)
  await adoptInputs(s); await runAvgAssemblyV1(s)
  const raws = (await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray()).filter(r => r.status === 'accepted' && r.artifactKey.startsWith('avg.voice.raw.'))
  if (!unknown) expect(raws).toHaveLength(count)
  return { ...s, fetcher, raws, workspace }
}
async function stop(s: Owner) {
  const details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
  await stopProductProductionV1({ scope: s.scope, production: details.production })
  return (await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])).build!
}
async function recover(s: Owner, retainedRequirementKeys: string[], retainedImageRequirementKeys?: string[]) {
  const before = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
  const prepared = await prepareAvgVoiceRecoveryBriefV1({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision,
    expectedBuildId: before.build!.id!, expectedBuildRevision: before.build!.stateRevision, retainedRequirementKeys,
    ...(retainedImageRequirementKeys ? { retainedImageRequirementKeys } : {}),
    declaration: '明确保留所选原音频，只重做其他句；旧账单与原始失败全部保留。' })
  const pendingView = await readAvgAssemblyWorkspaceV1(s.scope, s.productionId)
  expect(pendingView.details!.production.status).toBe('brief-ready')
  expect(pendingView.details!.build!.id).toBe(before.build!.id)
  const started = await startAvgAssemblyV1({ ...s, expectedBriefHash: prepared.brief!.briefHash })
  await adoptInputs(s); await runAvgAssemblyV1(s)
  const raws = (await db.productBuildArtifacts.where('buildId').equals(started.build!.id!).toArray()).filter(r => r.status === 'accepted' && r.artifactKey.startsWith('avg.voice.raw.'))
  if (!raws.length) throw new Error((await db.productBuilds.get(started.build!.id!))!.failureJson)
  return { buildId: started.build!.id!, raws }
}
async function chooseAll(s: Owner, raws: Awaited<ReturnType<typeof seed>>['raws']) {
  for (const raw of raws) {
    const requirementKey = raw.artifactKey.slice('avg.voice.raw.'.length)
    const selected = await readAvgRawVoiceCandidateV3({ ...s, requirementKey, version: raw.version, contentHash: raw.contentHash })
    const report: AvgReviewIssuesV1 = { schema: 'storyforge.avg.review-issues', version: 1, targetKey: requirementKey,
      observations: ['audio'], unobserved: [], issues: [], audioEvidence: { audioHash: raw.contentHash,
        requestIdentityHash: selected.payload.request.identityHash,
        audition: { generation: 'audition.recovery.synthetic', outcome: 'ended', durationMs: 500, playedMs: 500, muted: false, volume: 1, playbackRate: 1, seeked: false },
        checks: ['text-match', 'pronunciation', 'delivery', 'clip-boundaries', 'noise'].map(criterion => ({
          criterion: criterion as 'text-match' | 'pronunciation' | 'delivery' | 'clip-boundaries' | 'noise', result: 'pass', note: '合成受控观察，非真人/人声/艺术验收。' })), note: '工程控制记录；重新确认本版本音频。' } }
    await confirm(s, await stageAvgAudioReviewV3({ ...s, requirementKey, rawVersion: raw.version, rawContentHash: raw.contentHash, report, declaration: '合成观察，仅验证采用接缝。' }))
    await confirm(s, await stageAvgVoiceChoiceV3({ ...s, requirementKey, rawVersion: raw.version, rawContentHash: raw.contentHash, declaration: '明确选择当前版本工程音频。' }))
  }
  return configureAvgChosenVoiceDraftV3({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
}

describe('AVG explicit voice recovery through public author and durable producer paths', () => {
  it('keeps exact audio without credentials, produces a new zero-call receipt and requires fresh review/choice before Preview', async () => {
    const s = await seed(), prior = s.raws[0]!, old = await stop(s)
    const options = await readAvgVoiceRecoveryOptionsV1(s.scope, s.productionId)
    expect(options).toMatchObject({ buildId: old.id, buildRevision: old.stateRevision, images: null })
    expect(options.voices[0]).toMatchObject({ contentHash: prior.contentHash, costUsd: null, issue: '', retryBlocker: '' })
    expect(options.voices[0]!.asset).not.toBeNull(); expect(await db.productBuilds.get(old.id!)).toEqual(old)
    useAIConfigStore.getState().setConfig({ ...config, provider: 'deepseek', apiKey: '', baseUrl: 'https://unused.fixture.invalid/v1' })
    const current = await recover(s, ['keeper.line.0']), raw = current.raws[0]!
    expect(s.fetcher).toHaveBeenCalledOnce()
    expect(raw.blobObjectId).toBe(prior.blobObjectId); expect(raw.payloadJson).toBe(prior.payloadJson)
    expect(raw.rightsJson).toBe(prior.rightsJson); expect(raw.producerReceiptHash).not.toBe(prior.producerReceiptHash)
    expect(JSON.parse(raw.qualityJson)).toMatchObject({ noProviderRequest: true, schema: 'storyforge.avg.raw-voice-revalidation' })
    expect(await db.productBuilds.get(old.id!)).toEqual(old)
    const build = (await db.productBuilds.get(current.buildId))!, ledger = JSON.parse(build.budgetLedgerJson)
    expect(ledger.attempts.find((a: { taskKey: string }) => a.taskKey === 'avg.voice.generate.keeper.line.0').usage).toMatchObject({ mediaCalls: 0, costUsd: 0 })
    expect((await db.agentRunEvents.where('runId').equals(raw.producerRunId!).toArray()).some(e => e.type === 'evidence.artifact.recorded' && JSON.parse(e.payloadJson).artifactKind === 'raw-response')).toBe(false)
    await expect(stageAvgVoiceChoiceV3({ ...s, requirementKey: 'keeper.line.0', rawVersion: raw.version, rawContentHash: raw.contentHash, declaration: '没有新审听时必须拒绝。' })).rejects.toThrow(/审听/)
    const stoppedChild = await stop(s)
    const details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    await beginProductProductionEvolutionV1({ ...s, expectedStateRevision: details.production.stateRevision,
      userText: '再次明确准备下一版本，原复用授权不自动继承。', affectedLanes: ['content', 'product', 'visual', 'audio'] })
    const evolution = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    const draftBrief = parseProductProductionBriefV3(evolution.brief!.briefJson)
    if (draftBrief.avgAssembly?.version !== 3) throw new Error('Expected V3 evolution')
    expect((await assertAvgStoredAssemblyBriefV3(draftBrief.avgAssembly)).assembly.voice).not.toHaveProperty('recovery')
    expect(draftBrief.productionBudget.maximumMediaCalls).toBe(1)
    const again = await recover(s, ['keeper.line.0'])
    expect(again.raws[0]!.blobObjectId).toBe(prior.blobObjectId)
    expect(await db.productBuilds.get(stoppedChild.id!)).toEqual(stoppedChild)
    await chooseAll(s, again.raws); await adoptInputs(s, true)
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    expect(s.fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse((await db.productBuilds.get(old.id!))!.budgetLedgerJson).attempts.find((a: { taskKey: string }) => a.taskKey === 'avg.voice.generate.keeper.line.0').usage.costUsd).toBeNull()
    const finalBuild = (await db.productBuilds.get(again.buildId))!, preview = (await verifyStoredProductBuildPreview(finalBuild))!
    const original = await readAvgRawVoiceCandidateV3({ ...s, requirementKey: 'keeper.line.0', version: again.raws[0]!.version, contentHash: prior.contentHash })
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const importedBuild = (await db.productBuilds.where('projectId').equals(projectId).filter(b => b.buildNumber === finalBuild.buildNumber).first())!
    const scope = { projectId, worldId: importedBuild.worldId, workId: importedBuild.workId }
    const target = { scope, productionId: importedBuild.productionId, requirementKey: 'keeper.line.0', version: again.raws[0]!.version, contentHash: prior.contentHash }
    const imported = await readAvgRawVoiceCandidateV3(target)
    expect(imported.data).toEqual(original.data); expect(imported.blobObjectId).not.toBe(original.blobObjectId)
    expect((await verifyStoredProductBuildPreview(importedBuild))!.packageHash).toBe(preview.packageHash)
    const blob = (await db.mediaBlobObjects.get(imported.blobObjectId))!, bad = blob.data!.slice(0)
    new Uint8Array(bad)[bad.byteLength - 1] ^= 1
    await db.mediaBlobObjects.update(blob.id!, { data: bad })
    await expect(readAvgRawVoiceCandidateV3(target)).rejects.toThrow()
    await db.mediaBlobObjects.put(blob)
    await deleteWork(scope.workId)
    expect(await db.productBuildArtifacts.where('workId').equals(scope.workId).count()).toBe(0)
    expect((await readAvgRawVoiceCandidateV3({ ...s, requirementKey: 'keeper.line.0', version: again.raws[0]!.version, contentHash: prior.contentHash })).data).toEqual(original.data)
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)

  it('retakes only the explicitly selected second line and keeps original rows, price uncertainty and input bytes', async () => {
    const s = await seed(2)
    await chooseAll(s, s.raws)
    const old = await stop(s), original = s.raws.map(r => ({ ...r }))
    const current = await recover(s, ['keeper.line.0'])
    expect(s.fetcher).toHaveBeenCalledTimes(3)
    const kept = current.raws.find(r => r.artifactKey.endsWith('.0'))!, retake = current.raws.find(r => r.artifactKey.endsWith('.1'))!
    expect(kept.blobObjectId).toBe(original.find(r => r.artifactKey.endsWith('.0'))!.blobObjectId)
    expect(retake.contentHash).not.toBe(original.find(r => r.artifactKey.endsWith('.1'))!.contentHash)
    for (const row of original) expect(await db.productBuildArtifacts.get(row.id!)).toEqual(row)
    expect(await db.productBuilds.get(old.id!)).toEqual(old)
    await chooseAll(s, current.raws); await adoptInputs(s, true)
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    expect(s.fetcher).toHaveBeenCalledTimes(3)
  }, 30_000)

  it('explicitly retakes a one-line batch with no retained item and replaces only its proved old configured asset', async () => {
    const s = await seed()
    await chooseAll(s, s.raws)
    const old = await stop(s), original = s.raws[0]!, current = await recover(s, [])
    expect(s.fetcher).toHaveBeenCalledTimes(2)
    expect(current.raws[0]!.contentHash).not.toBe(original.contentHash)
    expect(JSON.parse(current.raws[0]!.qualityJson)).toMatchObject({ received: true, rawResponseRecorded: true })
    expect(JSON.parse(current.raws[0]!.qualityJson)).not.toHaveProperty('noProviderRequest')
    const configured = await chooseAll(s, current.raws)
    expect(parseAvgAuthorWorkspaceV1(configured.editorJson).presentation.stage.assets.find(a => a.assetKey === 'voice.desk.0')!.contentHash).toBe(current.raws[0]!.contentHash)
    await adoptInputs(s, true)
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    expect(await db.productBuilds.get(old.id!)).toEqual(old)
    expect(await db.productBuildArtifacts.get(original.id!)).toEqual(original)
    expect(await db.avgDraftMedia.where('workId').equals(s.scope.workId).count()).toBe(0)
  }, 30_000)

  it('refuses unknown-result retake and fabricated retention before evolving or writing a new Build', async () => {
    const s = await seed(1, true), old = await stop(s), before = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    const options = await readAvgVoiceRecoveryOptionsV1(s.scope, s.productionId)
    expect(options.voices[0]!.asset).toBeNull(); expect(options.voices[0]!.retryBlocker).toMatch(/未知结果/)
    const input = { ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision, expectedBuildId: old.id!, expectedBuildRevision: old.stateRevision,
      declaration: '未知结果不能变成新请求。' }
    await expect(prepareAvgVoiceRecoveryBriefV1({ ...input, retainedRequirementKeys: [] })).rejects.toThrow(/未知结果/)
    await expect(prepareAvgVoiceRecoveryBriefV1({ ...input, retainedRequirementKeys: ['keeper.line.0'] })).rejects.toThrow(/原始音频/)
    const after = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    expect(after.production).toEqual(before.production); expect(after.briefHistory).toEqual(before.briefHistory); expect(after.buildHistory).toEqual(before.buildHistory)
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)

  it('keeps a complete portable retention partition and rejects changed provenance or undeclared work-local locators', async () => {
    const s = await seed(), old = await stop(s)
    const prepared = await prepareAvgVoiceRecoveryBriefV1({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision,
      expectedBuildId: old.id!, expectedBuildRevision: old.stateRevision, retainedRequirementKeys: ['keeper.line.0'], declaration: '明确保留原结果。' })
    const brief = parseProductProductionBriefV3(prepared.brief!.briefJson)
    if (brief.avgAssembly?.version !== 3) throw new Error('Expected stored voice brief')
    const { assembly } = await assertAvgStoredAssemblyBriefV3(brief.avgAssembly), recovery = assembly.voice.recovery!
    expect(parseAvgVoiceRecoveryV1(recovery, assembly.voice.batch)).toEqual(recovery)
    for (const value of [{ ...recovery, retained: [] }, { ...recovery, rerunRequirementKeys: ['keeper.line.0'] },
      { ...recovery, sourceBuildNumber: recovery.sourceBuildNumber + 1 }, { ...recovery, localRunId: 1 }]) {
      expect(() => parseAvgVoiceRecoveryV1(value, assembly.voice.batch)).toThrow()
    }
    expect(JSON.stringify(recovery)).not.toMatch(/blobObjectId|producerRunId|localRunId/)
  }, 30_000)

  it('requires explicit image decisions and revalidates both mixed lanes offline before fresh choices and Preview', async () => {
    const s = await seed(1, false, true), old = await stop(s)
    const options = await readAvgVoiceRecoveryOptionsV1(s.scope, s.productionId)
    expect(options.images!.items).toHaveLength(1); expect(options.images!.items[0]!.asset).not.toBeNull()
    expect(options.voices[0]!.asset).not.toBeNull(); expect(await db.productBuilds.get(old.id!)).toEqual(old)
    const image = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([old.id!, 'avg.media.raw.desk.background']).filter(r => r.status === 'accepted').first())!
    const input = { ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision, expectedBuildId: old.id!, expectedBuildRevision: old.stateRevision,
      retainedRequirementKeys: ['keeper.line.0'], declaration: '只在明确的两个保留集合内复验原图与音频。' }
    await expect(prepareAvgVoiceRecoveryBriefV1(input)).rejects.toThrow(/图片/)
    expect(await db.productBuilds.get(old.id!)).toEqual(old)
    useAIConfigStore.getState().setConfig({ ...config, provider: 'deepseek', apiKey: '', baseUrl: 'https://unused.fixture.invalid/v1' })
    await expect(prepareAvgVoiceRecoveryBriefV1({ ...input, retainedImageRequirementKeys: [] })).rejects.toThrow(/Agnes/)
    expect(await db.productBuilds.get(old.id!)).toEqual(old)
    const current = await recover(s, ['keeper.line.0'], ['desk.background'])
    const keptImage = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([current.buildId, image.artifactKey]).filter(r => r.status === 'accepted').first())!
    expect(keptImage.blobObjectId).toBe(image.blobObjectId)
    expect(current.raws[0]!.blobObjectId).toBe(s.raws[0]!.blobObjectId)
    await confirm(s, await stageAvgMediaChoiceV2({ ...s, requirementKey: 'desk.background', rawVersion: keptImage.version,
      rawContentHash: keptImage.contentHash, referenceOnly: false, declaration: '明确采用当前版本复验过的工程图片。' }))
    await configureAvgChosenMediaDraftV2({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    await chooseAll(s, current.raws); await adoptInputs(s, true)
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    expect(s.fetcher).toHaveBeenCalledTimes(2)
    expect(await db.productBuilds.get(old.id!)).toEqual(old)
  }, 30_000)

  it('refuses forged/stale retention, changed rights, foreign scope and corrupt old bytes at real command/start boundaries', async () => {
    const s = await seed(), old = await stop(s)
    const prepared = await prepareAvgVoiceRecoveryBriefV1({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision,
      expectedBuildId: old.id!, expectedBuildRevision: old.stateRevision, retainedRequirementKeys: ['keeper.line.0'], declaration: '只保留这份实际原结果。' })
    const original = parseProductProductionBriefV3(prepared.brief!.briefJson)
    if (original.avgAssembly?.version !== 3) throw new Error('Expected V3')
    const resolved = await assertAvgStoredAssemblyBriefV3(original.avgAssembly)
    for (const field of ['candidate', 'revision', 'rights'] as const) {
      const assembly = structuredClone(resolved.assembly), brief = structuredClone(original)
      if (field === 'candidate') assembly.voice.recovery!.retained[0]!.proof.candidateHash = '0'.repeat(64)
      if (field === 'revision') assembly.voice.recovery!.sourceBuildRevision++
      if (field === 'rights') brief.capabilityRequirements.find(c => c.requirementKey === 'avg.media.voice')!.rightsPolicyVersion = 'changed.rights.v1'
      brief.avgAssembly = await encodeAvgStoredAssemblyBriefV3(assembly)
      const before = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
      const receipt = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId,
        command: { type: 'save-brief-revision', commandId: `voice.recovery.negative.${field}`, expectedStateRevision: before.production.stateRevision,
          parentRevision: before.brief!.revision, brief } })
      expect(receipt.ok).toBe(false); expect(receipt.errorCode).toBe('brief-not-authorized')
      const after = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
      expect(after.production).toEqual(before.production); expect(after.briefHistory).toEqual(before.briefHistory)
      expect(after.buildHistory).toEqual(before.buildHistory)
    }
    await expect(readAvgVoiceRecoverySourceV1({ ...s, scope: { ...s.scope, workId: s.scope.workId + 1 },
      assembly: resolved.assembly, requirementKey: 'keeper.line.0' })).rejects.toThrow(/跨作品|变化/)
    const blob = (await db.mediaBlobObjects.get(s.raws[0]!.blobObjectId!))!, bad = blob.data!.slice(0)
    new Uint8Array(bad)[bad.byteLength - 1] ^= 1
    await db.mediaBlobObjects.update(blob.id!, { data: bad })
    const beforeStart = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    await expect(startAvgAssemblyV1({ ...s, expectedBriefHash: prepared.brief!.briefHash })).rejects.toThrow()
    const afterStart = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    expect(afterStart.production).toEqual(beforeStart.production); expect(afterStart.buildHistory).toEqual(beforeStart.buildHistory)
    await db.mediaBlobObjects.put(blob)
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)
})
