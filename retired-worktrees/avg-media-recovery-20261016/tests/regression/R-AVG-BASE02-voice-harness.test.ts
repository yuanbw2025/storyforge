import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import * as gates from '../../src/lib/avg/assembly-contract'
import * as mediaVerifier from '../../src/lib/product-production/media-runtime-verifier'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'
import { avgAuthorWorkspaceFixture } from '../helpers/avg-author-stage-fixture'
import { avgReadingAudioFixture } from '../helpers/avg-reading-fixture'
import { avgVoicePolicyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { readProductProductionDetailsV1, stopProductProductionV1 } from '../../src/lib/product-production/service'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { hashAvgVoiceSourceInputV1 } from '../../src/lib/avg/voice-production-source'
import { hashAvgVoiceTextV1 } from '../../src/lib/avg/voice-production-contract'
import { hashAvgSpeechProtocolV1 } from '../../src/lib/avg/voice-request-contract'
import { configuredAvgVoiceEndpointHashV1 } from '../../src/lib/avg/voice-transport'
import { avgVoiceRouteBindingHashV1 } from '../../src/lib/avg/voice-assembly-contract'
import { encodeAvgStoredAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-storage'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { stageAvgWorkspaceInputV1, confirmAvgWorkspaceInputV1, runAvgAssemblyV1, readAvgRawVoiceCandidateV3,
  stageAvgAudioReviewV3, stageAvgVoiceChoiceV3, configureAvgChosenVoiceDraftV3 } from '../../src/lib/avg/assembly-service'
import { configureAvgChosenMediaDraftV2, stageAvgMediaChoiceV2 } from '../../src/lib/avg/assembly-service'
import { freezeAvgVisualProductionBatchV1 } from '../../src/lib/avg/media-source'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import type { AvgReviewIssuesV1 } from '../../src/lib/avg/artifact-contract'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { verifyStoredProductBuildPreview } from '../../src/lib/product-production/preview-manifest'
import { assertAvgNoUnresolvedVoiceRequestsV1 } from '../../src/lib/avg/voice-request-safety'
import { compileAvgVoiceSpeechRequestV1 } from '../../src/lib/avg/voice-request-contract'
import { saveAvgVoiceProductionDraftV1 } from '../../src/lib/avg/voice-draft-service'
import { prepareAvgAssemblyBriefV1 } from '../../src/lib/avg/assembly-service'
import { assertAvgVoiceDraftV1 } from '../../src/lib/avg/voice-draft-contract'
import { stageAvgAuthorArtifactV1 } from '../../src/lib/avg/author-artifacts'
import { resolveProductProductionUnknownResultReservationLedgerV2 } from '../../src/lib/product-production/scheduler'
import * as contextAssembly from '../../src/lib/registry/assemble-context'
import { readAvgTaskExecutionContextV1, AVG_TASK_CONTEXT_SOURCE_V1 } from '../../src/lib/avg/task-context'
import { preserveProductProductionContextV1 } from '../../src/lib/product-production/context'
import { avgVoiceProductionBudgetV3 } from '../../src/lib/avg/voice-production-policy'
import { avgVoiceAssemblyGateIdsV3 } from '../../src/lib/avg/voice-assembly-contract'

const config = { provider: 'agnes' as const, baseUrl: 'https://speech.fixture.invalid/v1',
  apiKey: 'test-only-agnes-no-network', model: 'agnes-2.5-flash', temperature: 0.7, maxTokens: 0 }

beforeEach(async () => {
  await db.delete(); await db.open(); vi.stubEnv('VITE_STORYFORGE_AVG_MEDIA_PRODUCTION', '1')
  // Only the intentionally closed release gate, external HTTP and absent
  // jsdom decoder are replaced. Real start/source/Run/checkpoint/ledger,
  // producer admission, author commands, Blob and Preview paths stay intact.
  vi.spyOn(gates, 'avgVoiceProductionEnabledV3').mockReturnValue(true)
  useAIConfigStore.getState().setConfig(config)
  vi.spyOn(mediaVerifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(async input => ({ measuredAt: Date.now(), environment: input.environment,
    assets: input.assets.map(asset => ({ assetKey: asset.assetKey, contentHash: asset.contentHash, mimeType: asset.mimeType,
      mediaClass: asset.mimeType.startsWith('image/') ? 'image' : 'audio', status: 'decoded',
      decodedWidth: asset.mimeType.startsWith('image/') ? 576 : null, decodedHeight: asset.mimeType.startsWith('image/') ? 324 : null,
      decodedDurationMs: asset.mimeType.startsWith('image/') ? null : 500, decodedHasAlpha: asset.mimeType.startsWith('image/') ? false : null,
      decodedChannelCount: asset.mimeType.startsWith('image/') ? null : 1, decodedSampleRateHz: asset.mimeType.startsWith('image/') ? null : 48000,
      integratedLufs: asset.mimeType.startsWith('image/') ? null : -18, truePeakDbtp: asset.mimeType.startsWith('image/') ? null : -12,
      loopSeamDbfs: asset.mimeType.startsWith('image/') ? null : -40, policyFailures: [], failureCode: null })) }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); db.close() })

async function setupVoice(withImage = false, options: { unknownResponse?: boolean; deferProvider?: boolean; longVoiceBatch?: boolean } = {}) {
  const workspace = avgAuthorWorkspaceFixture()
  workspace.presentation.reading = { schema: 'storyforge.avg.reading-plan', version: 1, manualVoice: 'wait', voiceFailure: 'pause',
    maximumVoiceWaitMs: 30000, autoDelayMs: 800, voices: [] }
  const policy = await avgVoicePolicyFixtureV3(withImage), a = policy.avgAssembly, p = a.voice.protocol, preset = a.voice.batch.presets[0]!
  if (options.longVoiceBatch) {
    const script = workspace.scripts.find(s => s.sceneKey === 'desk')!, line = script.lines[0]!
    script.lines = Array.from({ length: 8 }, (_, i) => ({ ...structuredClone(line), lineKey: `long.line.${i}`, beatKey: `long.line.${i}`,
      text: `第${i}句：` + '长'.repeat(4089) + '🧪。' }))
    const requirement = a.voice.batch.requirements[0]!
    a.voice.batch.requirements = script.lines.map((line, i) => ({ ...structuredClone(requirement),
      requirementKey: `keeper.long.${i}`, assetKey: `voice.long.${i}`, lineKey: line.lineKey }))
    a.mediaAssetKeys = a.voice.batch.requirements.map(r => r.assetKey)
  }
  if (a.image) {
    const batch = a.image.mediaBatch
    workspace.mediaBatch = await freezeAvgVisualProductionBatchV1({ schema: batch.schema, version: 1,
      batchKey: batch.batchKey, revision: batch.revision, requirements: batch.requirements }, workspace)
  }
  const owner = await prepareNativeAvgAssembly(workspace), base = parseProductProductionBriefV3(owner.details.brief!.briefJson)
  if (a.image) {
    if (base.avgAssembly?.version !== 2) throw new Error('Actual image preparation did not produce its V2 definition')
    a.image = { mediaBatch: base.avgAssembly.mediaBatch, imageBinding: base.avgAssembly.imageBinding }
    const imageCapability = base.capabilityRequirements.find(c => c.requirementKey === 'avg.media.image')!
    policy.capabilityRequirements = [policy.capabilityRequirements[0]!, imageCapability]
  }
  p.provider = 'agnes'; p.endpointRouteHash = await configuredAvgVoiceEndpointHashV1({ baseUrl: config.baseUrl, model: p.model })
  const capabilityHash = await hashAvgSpeechProtocolV1(p)
  Object.assign(preset, { provider: 'agnes', endpointRouteHash: p.endpointRouteHash, capabilityHash })
  policy.capabilityRequirements[0]!.capabilityHash = capabilityHash
  a.voice.binding.endpointRouteHash = p.endpointRouteHash
  a.voice.binding.bindingHash = await avgVoiceRouteBindingHashV1({ requirementKey: 'avg.media.voice', adapterId: p.adapterId,
    capabilityHash, endpointRouteHash: p.endpointRouteHash })
  a.sceneKeys = workspace.systemPlan.scenes.map(scene => scene.key)
  a.voice.batch.sourceInputHash = await hashAvgVoiceSourceInputV1(workspace)
  for (const r of a.voice.batch.requirements) {
    const script = workspace.scripts.find(s => s.sceneKey === r.sceneKey)!, line = script.lines.find(l => l.lineKey === r.lineKey)!
    Object.assign(r, { text: line.text, textHash: await hashAvgVoiceTextV1(line.text), speakerKey: line.speakerKey, textRevision: 1,
      script: { artifactKey: `avg.content.scene-script.${script.sceneKey}`, version: 1, contentHash: await hashProductProductionValueV2(script) } })
  }
  policy.productionBudget = avgVoiceProductionBudgetV3(a)
  policy.media.voiceLineCount = a.voice.batch.requirements.length
  policy.completionContract.requiredGateIds = avgVoiceAssemblyGateIdsV3(a)
  const brief = parseProductProductionBriefV3({ ...base, ...policy, intent: { ...base.intent, ...policy.intent }, avgAssembly: await encodeAvgStoredAssemblyBriefV3(a) })
  const saved = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId,
    command: { type: 'save-brief-revision', commandId: 'voice.harness.brief', expectedStateRevision: owner.details.production.stateRevision,
      parentRevision: owner.details.brief!.revision, brief } })
  if (!saved.ok) throw new Error(JSON.stringify(saved))
  const prepared = await readProductProductionDetailsV1(owner.scope, owner.productionId, ['avg'])
  const started = await executeProductProductionCommand({ scope: owner.scope, productionId: owner.productionId,
    command: { type: 'authorize-start', commandId: 'voice.harness.start', expectedStateRevision: prepared.production.stateRevision,
      briefRevision: prepared.brief!.revision, briefHash: prepared.brief!.briefHash, authorizationNonce: 'voice.harness.explicit-author-start' } })
  if (!started.ok) throw new Error(JSON.stringify(started))
  const details = await readProductProductionDetailsV1(owner.scope, owner.productionId, ['avg'])
  const s = { ...owner, details, buildId: details.build!.id!, workspace }
  const audio = await avgReadingAudioFixture(500)
  const image = withImage ? new Uint8Array(await deterministicRegionMapPngV1({ width: 576, height: 324, palette: ['#18213b', '#39506b', '#c8dce8'] })) : null
  const fetcher = vi.fn(async (target: RequestInfo | URL, _init?: RequestInit) => {
    if (String(target).endsWith('/audio/speech')) {
      if (options.unknownResponse) throw new TypeError('Controlled response lost after the exact request was dispatched')
      return new Response(audio.data, { headers: { 'Content-Type': 'audio/wav', 'x-request-id': 'voice.harness.response.1' } })
    }
    if (!image || !String(target).endsWith('/images/generations')) throw new Error('Unexpected controlled HTTP route')
    let binary = ''; for (let i = 0; i < image.length; i += 16384) binary += String.fromCharCode(...image.subarray(i, i + 16384))
    return new Response(JSON.stringify({ data: [{ b64_json: btoa(binary) }] }), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetcher)
  await runAvgAssemblyV1(s)
  expect(fetcher).not.toHaveBeenCalled()
  for (const key of ['avg.system.plan', ...a.sceneKeys.map(key => `avg.content.scene-script.${key}`)]) await confirmInput(s, key)
  if (!options.deferProvider) await runAvgAssemblyV1(s)
  const raw = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.voice.raw.keeper.line']).filter(row => row.status === 'accepted').first()
  return { ...s, raw, audio, fetcher, assembly: a }
}

async function start(withImage = false) {
  const s = await setupVoice(withImage)
  if (!s.raw) throw new Error((await db.productBuilds.get(s.buildId))!.failureJson)
  return { ...s, raw: s.raw }
}

async function confirmInput(s: { scope: Awaited<ReturnType<typeof prepareNativeAvgAssembly>>['scope']; productionId: number }, artifactKey: string) {
  const draft = await readAvgDraftV1(s.scope), candidate = await stageAvgWorkspaceInputV1({ ...s, expectedDraftRevision: draft.revision,
    artifactKey, declaration: '明确确认原创工程输入；不是文学、配音或商业验收' })
  return confirmCandidate(s, candidate)
}

async function confirmCandidate(s: { scope: Awaited<ReturnType<typeof prepareNativeAvgAssembly>>['scope']; productionId: number },
  candidate: { artifactKey: string; version: number; metadataJson: string }) {
  return confirmAvgWorkspaceInputV1({ ...s, artifactKey: candidate.artifactKey, candidateVersion: candidate.version,
    candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
}

function report(s: Awaited<ReturnType<typeof start>>, requestIdentityHash: string, unknown = false): AvgReviewIssuesV1 {
  return { schema: 'storyforge.avg.review-issues', version: 1, targetKey: 'keeper.line', observations: unknown ? [] : ['audio'],
    unobserved: unknown ? ['工程合成记录：未执行审听'] : [], issues: [], audioEvidence: {
      audioHash: unknown ? null : s.raw.contentHash,
      requestIdentityHash,
      audition: unknown ? null : { generation: 'audition.harness.synthetic', outcome: 'ended', durationMs: 500, playedMs: 500, muted: false, volume: 1, playbackRate: 1, seeked: false },
      checks: ['text-match', 'pronunciation', 'delivery', 'clip-boundaries', 'noise'].map(criterion => ({
        criterion: criterion as 'text-match' | 'pronunciation' | 'delivery' | 'clip-boundaries' | 'noise', result: unknown ? 'unknown' : 'pass', note: '合成控制记录；不是人类或真实人声审听' })),
      note: unknown ? '保留未知观察的合成控制记录' : '新一轮完整观察的合成控制记录；不签艺术或真人验收' } }
}

async function review(s: Awaited<ReturnType<typeof start>>, unknown = false) {
  const selected = await readAvgRawVoiceCandidateV3({ ...s, requirementKey: 'keeper.line', version: s.raw.version, contentHash: s.raw.contentHash })
  const value = report(s, selected.payload.request.identityHash, unknown)
  const candidate = await stageAvgAudioReviewV3({ ...s, requirementKey: 'keeper.line', rawVersion: s.raw.version, rawContentHash: s.raw.contentHash,
    report: value, declaration: '明确保存工程合成审听记录；不是实际人声审听或商业验收' })
  await confirmCandidate(s, candidate)
  return candidate
}

async function choose(s: Awaited<ReturnType<typeof start>>) {
  const candidate = await stageAvgVoiceChoiceV3({ ...s, requirementKey: 'keeper.line', rawVersion: s.raw.version,
    rawContentHash: s.raw.contentHash, declaration: '明确选择准确音频版本；仍不签商用或真实人声验收' })
  await confirmCandidate(s, candidate)
  return candidate
}

describe('AVG voice actual command/Harness/producer/author/Preview path with controlled HTTP and decoder', () => {
  it('delivers eight maximum-size lines through registered exact context and real durable child Runs with eight controlled requests', async () => {
    const s = await setupVoice(false, { deferProvider: true, longVoiceBatch: true })
    const assembled = vi.spyOn(contextAssembly, 'assembleContext')
    await runAvgAssemblyV1(s)
    const raws = (await db.productBuildArtifacts.where('buildId').equals(s.buildId).toArray())
      .filter(r => r.artifactKey.startsWith('avg.voice.raw.') && r.status === 'accepted')
    expect(raws).toHaveLength(8)
    expect(s.fetcher).toHaveBeenCalledTimes(8)
    const sent = s.fetcher.mock.calls.map(call => JSON.parse(call[1]!.body as string).input)
    expect(sent.sort()).toEqual(s.assembly.voice.batch.requirements.map(r => r.text).sort())
    expect(sent.every(text => text.length === 4096)).toBe(true)
    const packets = await Promise.all(assembled.mock.results.map(r => r.value))
    expect(packets).toHaveLength(8)
    for (const packet of packets) {
      expect(packet.included).toEqual([AVG_TASK_CONTEXT_SOURCE_V1])
      expect(packet.sourceEvidence).toMatchObject([{ key: AVG_TASK_CONTEXT_SOURCE_V1, status: 'included', delivery: 'full' }])
      expect(packet.totalInputTokens).toBeLessThanOrEqual(20_000)
      const body = JSON.parse(packet.text)
      const requirement = s.assembly.voice.batch.requirements.find(r => r.requirementKey === body.requirement.requirement.requirementKey)!
      expect(body.requirement.requirement).toEqual(requirement)
      expect(body.artifacts.every((a: object) => !('payload' in a))).toBe(true)
      expect(body.artifacts.map((a: { artifactKey: string }) => a.artifactKey)).toEqual(['avg.system.plan', ...s.assembly.sceneKeys.map(k => `avg.content.scene-script.${k}`)])
      expect(body.briefHash).toBe(s.details.build!.briefHash)
      expect(body.planHash).toBe((await db.productBuilds.get(s.buildId))!.planHash)
    }
    for (const raw of raws) {
      const run = (await db.agentRuns.get(raw.producerRunId!))!, contract = JSON.parse(run.contractJson)
      expect(contract.permissions.contextSourceKeys).toEqual([AVG_TASK_CONTEXT_SOURCE_V1])
      expect(contract.executionBindings[0].skillId).toBe('avg.media-request.v1')
      expect((await db.agentRunEvents.where('runId').equals(run.id!).toArray()).filter(e => e.type === 'context.assembled')).toHaveLength(1)
    }
  }, 30_000)

  it('refuses foreign scope, dependency omission, stale Plan, corrupt author source and under-budget context without a request', async () => {
    const s = await setupVoice(false, { deferProvider: true }), build = (await db.productBuilds.get(s.buildId))!
    const task = JSON.parse(build.planJson).tasks.find((t: { kind: string }) => t.kind === 'avg-media-voice-generate')
    const input = { projectId: s.scope.projectId, scope: s.scope, productProductionId: s.productionId,
      productBuildId: s.buildId, productProductionTaskKey: task.taskKey, productArtifactKeys: task.inputArtifactKeys }
    const body = JSON.parse(await readAvgTaskExecutionContextV1(input))
    expect(body.requirement.requirement.text).toBe(s.assembly.voice.batch.requirements[0]!.text)
    await expect(readAvgTaskExecutionContextV1({ ...input, scope: { ...s.scope, workId: s.scope.workId + 1 } })).rejects.toThrow()
    await expect(readAvgTaskExecutionContextV1({ ...input, productArtifactKeys: [] })).rejects.toThrow(/依赖选择/)
    await db.productBuilds.update(s.buildId, { planHash: '0'.repeat(64) })
    await expect(readAvgTaskExecutionContextV1(input)).rejects.toThrow(/Plan/)
    await db.productBuilds.update(s.buildId, { planHash: build.planHash })
    const script = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.content.scene-script.desk']).filter(r => r.status === 'accepted').first())!
    const corrupt = JSON.parse(script.payloadJson); corrupt.lines[0].text += '篡改'
    await db.productBuildArtifacts.update(script.id!, { payloadJson: JSON.stringify(corrupt) })
    await expect(readAvgTaskExecutionContextV1(input)).rejects.toThrow()
    await db.productBuildArtifacts.update(script.id!, { payloadJson: script.payloadJson })
    await expect(contextAssembly.assembleContext({ ...input, sourceKeys: [AVG_TASK_CONTEXT_SOURCE_V1],
      inputBudgetTokens: 128, sourceTransformer: preserveProductProductionContextV1 })).rejects.toThrow(/预算/)
    expect(s.fetcher).not.toHaveBeenCalled()
    expect(await db.productBuilds.get(s.buildId)).toEqual(build)
  })

  it('blocks the same unknown wire request despite renamed requirements and performance revisions before preparation or direct command writes', async () => {
    const s = await setupVoice(false, { unknownResponse: true })
    expect(s.fetcher).toHaveBeenCalledOnce(); expect(s.raw).toBeUndefined()
    const build = (await db.productBuilds.get(s.buildId))!
    const ledger = JSON.parse(build.budgetLedgerJson)
    expect(ledger.attempts).toContainEqual(expect.objectContaining({ taskKey: 'avg.voice.generate.keeper.line', usageKnown: false }))
    const original = await compileAvgVoiceSpeechRequestV1(s.assembly.voice.batch, 'keeper.line', s.assembly.voice.protocol)
    const batch = structuredClone(s.assembly.voice.batch), r = batch.requirements[0]!
    r.requirementKey = 'renamed.line'; r.performance.revision += 1
    const renamed = await compileAvgVoiceSpeechRequestV1(batch, r.requirementKey, s.assembly.voice.protocol)
    expect(renamed.identityHash).not.toBe(original.identityHash)
    expect(renamed.requestBodyHash).toBe(original.requestBodyHash)
    await expect(assertAvgNoUnresolvedVoiceRequestsV1({ scope: s.scope, requests: [renamed] })).rejects.toThrow(/未知结果/)
    const draft = await readAvgDraftV1(s.scope)
    const saved = await saveAvgVoiceProductionDraftV1({ scope: s.scope, expectedDraftRevision: draft.revision,
      protocol: s.assembly.voice.protocol, presets: batch.presets, lines: [{ requirementKey: r.requirementKey, assetKey: r.assetKey,
        sceneKey: r.sceneKey, lineKey: r.lineKey, presetKey: r.presetKey, maximumDurationMs: r.maximumDurationMs - 1, performance: r.performance }] })
    const before = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    await expect(prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })).rejects.toThrow(/未知结果/)
    const receipt = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId,
      command: { type: 'save-brief-revision', commandId: 'voice.unknown.direct-save', expectedStateRevision: before.production.stateRevision,
        parentRevision: before.brief!.revision, brief: parseProductProductionBriefV3(before.brief!.briefJson) } })
    expect(receipt.ok).toBe(false); expect(receipt.errorCode).toBe('brief-not-authorized')
    expect(receipt.result.message).toMatch(/未知结果/)
    const after = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    expect(after.production).toEqual(before.production); expect(after.briefHistory).toEqual(before.briefHistory)
    expect(after.buildHistory).toEqual(before.buildHistory); expect(after.artifactCount).toBe(before.artifactCount)
    expect(await db.productBuilds.get(s.buildId)).toEqual(build)
    const workspace = parseAvgAuthorWorkspaceV1(saved.editorJson)
    workspace.scripts.find(script => script.sceneKey === r.sceneKey)!.lines.find(line => line.lineKey === r.lineKey)!.text += ' 新的台词。'
    const edited = await saveAvgAuthorWorkspaceV1(s.scope, saved.revision, workspace)
    const changed = await saveAvgVoiceProductionDraftV1({ scope: s.scope, expectedDraftRevision: edited.revision,
      protocol: s.assembly.voice.protocol, presets: batch.presets, lines: [{ requirementKey: r.requirementKey, assetKey: r.assetKey,
        sceneKey: r.sceneKey, lineKey: r.lineKey, presetKey: r.presetKey, maximumDurationMs: r.maximumDurationMs - 1, performance: r.performance }] })
    const prospective = await assertAvgVoiceDraftV1(parseAvgAuthorWorkspaceV1(changed.editorJson).voiceProduction)
    expect(prospective.requests[0]!.requestBodyHash).not.toBe(original.requestBodyHash)
    await expect(assertAvgNoUnresolvedVoiceRequestsV1({ scope: s.scope, requests: prospective.requests })).resolves.toBeUndefined()
    await db.productBuilds.update(s.buildId, { productionId: 999_999 })
    try {
      await expect(assertAvgNoUnresolvedVoiceRequestsV1({ scope: s.scope, requests: prospective.requests })).rejects.toThrow(/缺少所属制作根/)
    } finally { await db.productBuilds.put(build) }
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)

  it('does not confuse a known received clip with its unknown price or create another request', async () => {
    const s = await start()
    const request = await compileAvgVoiceSpeechRequestV1(s.assembly.voice.batch, 'keeper.line', s.assembly.voice.protocol)
    await expect(assertAvgNoUnresolvedVoiceRequestsV1({ scope: s.scope, requests: [request] })).resolves.toBeUndefined()
    const raw = JSON.parse(s.raw.qualityJson)
    expect(raw.received).toBe(true)
    expect((await readAvgRawVoiceCandidateV3({ ...s, requirementKey: 'keeper.line', version: s.raw.version, contentHash: s.raw.contentHash })).payload.provider.costUsd).toBeNull()
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)

  it('rechecks the same Work history at author start after another production loses its response', async () => {
    const s = await setupVoice(false, { unknownResponse: true, deferProvider: true })
    const brief = parseProductProductionBriefV3(s.details.brief!.briefJson)
    const created = await executeProductProductionCommand({ scope: s.scope, command: { type: 'create-intent',
      commandId: 'voice.unknown.second-intent', productionKey: 'voice.unknown.second-root', productType: 'avg',
      worldReleaseId: brief.source.worldReleaseId, userText: '单独核对同作品的第二项明确制作方案' } })
    expect(created.ok).toBe(true)
    const productionId = created.productionId
    expect(productionId).not.toBe(s.productionId)
    const second = await readProductProductionDetailsV1(s.scope, productionId, ['avg'])
    const saved = await executeProductProductionCommand({ scope: s.scope, productionId, command: {
      type: 'save-brief-revision', commandId: 'voice.unknown.second-brief', expectedStateRevision: second.production.stateRevision,
      parentRevision: null, brief } })
    expect(saved.ok).toBe(true); expect(s.fetcher).not.toHaveBeenCalled()
    await runAvgAssemblyV1(s)
    expect(s.fetcher).toHaveBeenCalledOnce()
    const staged = await readProductProductionDetailsV1(s.scope, productionId, ['avg']), count = await db.productBuilds.count()
    const started = await executeProductProductionCommand({ scope: s.scope, productionId, command: {
      type: 'authorize-start', commandId: 'voice.unknown.second-start', expectedStateRevision: staged.production.stateRevision,
      briefRevision: staged.brief!.revision, briefHash: staged.brief!.briefHash, authorizationNonce: 'voice.unknown.explicit-start' } })
    expect(started.ok).toBe(false); expect(started.result.message).toMatch(/未知结果/)
    expect(await db.productBuilds.count()).toBe(count)
    expect((await readProductProductionDetailsV1(s.scope, productionId, ['avg'])).production).toEqual(staged.production)
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)

  it('fences an already authorized sibling immediately before transport when a later unknown result appears', async () => {
    const s = await setupVoice(false, { unknownResponse: true, deferProvider: true })
    const brief = parseProductProductionBriefV3(s.details.brief!.briefJson)
    const created = await executeProductProductionCommand({ scope: s.scope, command: { type: 'create-intent',
      commandId: 'voice.late.second-intent', productionKey: 'voice.late.second-root', productType: 'avg',
      worldReleaseId: brief.source.worldReleaseId, userText: '明确的第二项同作品工程制作' } })
    expect(created.ok).toBe(true)
    const productionId = created.productionId, second = await readProductProductionDetailsV1(s.scope, productionId, ['avg'])
    const saved = await executeProductProductionCommand({ scope: s.scope, productionId, command: {
      type: 'save-brief-revision', commandId: 'voice.late.second-brief', expectedStateRevision: second.production.stateRevision, parentRevision: null, brief } })
    expect(saved.ok).toBe(true)
    const staged = await readProductProductionDetailsV1(s.scope, productionId, ['avg'])
    const started = await executeProductProductionCommand({ scope: s.scope, productionId, command: {
      type: 'authorize-start', commandId: 'voice.late.second-start', expectedStateRevision: staged.production.stateRevision,
      briefRevision: staged.brief!.revision, briefHash: staged.brief!.briefHash, authorizationNonce: 'voice.late.explicit-start' } })
    expect(started.ok).toBe(true)
    await runAvgAssemblyV1({ scope: s.scope, productionId })
    // Both roots use actual author inputs and commands; no accepted row or
    // Run is fabricated. This lower-level author API also checks its Plan.
    for (const payload of [s.workspace.systemPlan, ...s.workspace.scripts]) {
      const details = await readProductProductionDetailsV1(s.scope, productionId, ['avg']), build = details.build!
      const artifactKey = payload.schema === 'storyforge.avg.system-plan' ? 'avg.system.plan' : `avg.content.scene-script.${payload.sceneKey}`
      const task = JSON.parse(build.planJson).tasks.find((t: { outputArtifactKeys: string[] }) => t.outputArtifactKeys.includes(artifactKey))
      const candidate = await stageAvgAuthorArtifactV1({ scope: s.scope, buildId: build.id!, expectedBuildRevision: build.stateRevision,
        controlEpoch: build.controlEpoch, taskKey: task.taskKey, artifactKey,
        kind: payload.schema === 'storyforge.avg.system-plan' ? 'product-module' : 'narrative', payload, declaration: '明确确认同作品原创工程输入' })
      await confirmCandidate({ scope: s.scope, productionId }, candidate)
    }
    expect(s.fetcher).not.toHaveBeenCalled()
    await runAvgAssemblyV1(s)
    expect(s.fetcher).toHaveBeenCalledOnce()
    await runAvgAssemblyV1({ scope: s.scope, productionId })
    const blocked = await readProductProductionDetailsV1(s.scope, productionId, ['avg'])
    expect(blocked.build!.failureJson).toMatch(/未知结果/)
    const ledger = JSON.parse(blocked.build!.budgetLedgerJson)
    expect(ledger.attempts).toContainEqual(expect.objectContaining({ taskKey: 'avg.voice.generate.keeper.line', usageKnown: true,
      usage: expect.objectContaining({ mediaCalls: 0 }) }))
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)

  it('keeps unknown requests blocked after portable import and after a cost-only ledger projection', async () => {
    const s = await setupVoice(false, { unknownResponse: true })
    const requests = [await compileAvgVoiceSpeechRequestV1(s.assembly.voice.batch, 'keeper.line', s.assembly.voice.protocol)]
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const imported = (await db.productBuilds.where('projectId').equals(projectId).first())!
    await expect(assertAvgNoUnresolvedVoiceRequestsV1({ scope: { projectId, worldId: imported.worldId, workId: imported.workId }, requests })).rejects.toThrow(/未知结果/)
    const build = (await db.productBuilds.get(s.buildId))!, ledger = JSON.parse(build.budgetLedgerJson)
    const attempt = ledger.attempts.find((a: { taskKey: string }) => a.taskKey === 'avg.voice.generate.keeper.line')
    // Negative fixture: applying the existing pure accounting projection is
    // not an author reconciliation receipt or evidence of a known result.
    const accounting = resolveProductProductionUnknownResultReservationLedgerV2({ budgetLedgerJson: build.budgetLedgerJson,
      taskKey: attempt.taskKey, runId: attempt.runId, attempt: attempt.attempt, controlEpoch: attempt.controlEpoch,
      disposition: 'confirmed-not-charged' })
    expect(JSON.parse(accounting.budgetLedgerJson).attempts).toContainEqual(expect.objectContaining({
      taskKey: attempt.taskKey, usageKnown: true, resolution: 'author-confirmed-not-charged' }))
    await db.productBuilds.update(s.buildId, { budgetLedgerJson: accounting.budgetLedgerJson })
    await expect(assertAvgNoUnresolvedVoiceRequestsV1({ scope: s.scope, requests })).rejects.toThrow(/未知结果/)
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)

  it('blocks another claimant while a real durable voice request is in flight and preserves the hold after cancellation', async () => {
    const s = await setupVoice(false, { deferProvider: true })
    let entered!: () => void, release!: (response: Response) => void
    const dispatched = new Promise<void>(resolve => { entered = resolve })
    const response = new Promise<Response>(resolve => { release = resolve })
    s.fetcher.mockImplementationOnce(async () => { entered(); return response })
    const controller = new AbortController()
    const running = runAvgAssemblyV1({ ...s, signal: controller.signal }).catch(error => error)
    try {
      await dispatched
      const build = (await db.productBuilds.get(s.buildId))!, ledger = JSON.parse(build.budgetLedgerJson)
      const claim = ledger.tasks['avg.voice.generate.keeper.line']
      expect(claim.status).toBe('claimed')
      const requests = [await compileAvgVoiceSpeechRequestV1(s.assembly.voice.batch, 'keeper.line', s.assembly.voice.protocol)]
      await expect(assertAvgNoUnresolvedVoiceRequestsV1({ scope: s.scope, requests })).rejects.toThrow(/未完成领取/)
      await expect(assertAvgNoUnresolvedVoiceRequestsV1({ scope: s.scope, requests, ownClaim: {
        buildId: s.buildId, controlEpoch: build.controlEpoch, taskKey: 'avg.voice.generate.keeper.line',
        runId: claim.runId, attempt: claim.attempt, idempotencyKey: claim.idempotencyKey,
      } })).resolves.toBeUndefined()
    } finally {
      controller.abort()
      release(new Response(s.audio.data, { headers: { 'Content-Type': 'audio/wav' } }))
      await running
    }
    const stopped = (await db.productBuilds.get(s.buildId))!
    expect(JSON.parse(stopped.budgetLedgerJson).attempts).toContainEqual(expect.objectContaining({
      taskKey: 'avg.voice.generate.keeper.line', usageKnown: false }))
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)

  it('rechecks current source authority after the asynchronous safety scan before sending any HTTP', async () => {
    const s = await setupVoice(false, { deferProvider: true })
    const safety = await import('../../src/lib/avg/voice-request-safety')
    const verify = safety.assertAvgNoUnresolvedVoiceRequestsV1
    const scan = vi.spyOn(safety, 'assertAvgNoUnresolvedVoiceRequestsV1').mockImplementationOnce(async input => {
      await verify(input)
      const details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
      await stopProductProductionV1({ scope: s.scope, production: details.production })
    })
    await runAvgAssemblyV1(s).catch(error => error)
    const build = (await db.productBuilds.get(s.buildId))!
    expect(scan).toHaveBeenCalledOnce()
    expect(build.controlEpoch).toBeGreaterThan(s.details.build!.controlEpoch)
    expect(build.status).toBe('cancelled')
    expect(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.voice.raw.keeper.line']).count()).toBe(0)
    expect(s.fetcher).not.toHaveBeenCalled()
  }, 30_000)

  it('keeps independent image/voice producers and choices under the actual complete Brief, then compiles both offline', async () => {
    const s = await start(true)
    expect(s.fetcher).toHaveBeenCalledTimes(2)
    const image = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.media.raw.desk.background'])
      .filter(row => row.status === 'accepted').first()
    expect(image?.producerRunId).toBeGreaterThan(0); expect(image!.producerRunId).not.toBe(s.raw.producerRunId)
    const choice = await stageAvgMediaChoiceV2({ ...s, requirementKey: 'desk.background', rawVersion: image!.version,
      rawContentHash: image!.contentHash, declaration: '明确选择原创工程色块；不是艺术或商用验收' })
    await confirmCandidate(s, choice); await review(s); await choose(s)
    vi.mocked(gates.avgVoiceProductionEnabledV3).mockReturnValue(false)
    useAIConfigStore.getState().setConfig({ ...config, provider: 'deepseek', apiKey: '', baseUrl: 'https://unused.fixture.invalid/v1' })
    await configureAvgChosenMediaDraftV2({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    const configured = await configureAvgChosenVoiceDraftV3({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    const stage = parseAvgAuthorWorkspaceV1(configured.editorJson).presentation
    expect(stage.stage.assets.map(a => a.assetKey).sort()).toEqual(['desk.background', 'voice.desk'])
    expect(stage.stage.cues).toContainEqual(expect.objectContaining({ type: 'set-background', assetKey: 'desk.background', beatKey: 'line.desk' }))
    expect(stage.reading!.voices).toContainEqual(expect.objectContaining({ lineKey: 'line.desk', assetKey: 'voice.desk' }))
    await confirmInput(s, 'avg.author.stage')
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    expect(s.fetcher).toHaveBeenCalledTimes(2)
    const finals = await db.productBuildArtifacts.where('buildId').equals(s.buildId)
      .filter(row => /^avg\.media\.\d+$/.test(row.artifactKey) && row.status === 'accepted').toArray()
    expect(finals.map(row => row.contentHash).sort()).toEqual([image!.contentHash, s.raw.contentHash].sort())
    const details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    expect(details.build!.briefHash).toBe(s.details.build!.briefHash)
    expect(details.build!.rootTerminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
  }, 30_000)

  it('makes one exact request, separately adopts review/choice, configures a line and reaches actual Preview offline without another call', async () => {
    const s = await start()
    expect(s.fetcher).toHaveBeenCalledOnce()
    expect(JSON.parse(s.fetcher.mock.calls[0]![1]!.body as string).input).toBe('封口仍在。')
    expect(s.raw.producerRunId).toBeGreaterThan(0); expect(s.raw.producerReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([s.buildId, 'avg.voice.choice.keeper.line']).count()).toBe(0)
    await review(s); await choose(s)
    vi.mocked(gates.avgVoiceProductionEnabledV3).mockReturnValue(false)
    useAIConfigStore.getState().setConfig({ ...config, provider: 'deepseek', apiKey: '', baseUrl: 'https://unused.fixture.invalid/v1' })
    const configured = await configureAvgChosenVoiceDraftV3({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    const stage = parseAvgAuthorWorkspaceV1(configured.editorJson).presentation
    expect(stage.reading!.voices).toHaveLength(1); expect(stage.stage.cues.some(cue => cue.assetKey === 'voice.desk')).toBe(false)
    await confirmInput(s, 'avg.author.stage')
    const result = await runAvgAssemblyV1(s)
    expect(result.buildStatus).toBe('preview-ready'); expect(s.fetcher).toHaveBeenCalledOnce()
    const details = await readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
    expect(details.build!.rootTerminalReceiptHash).toMatch(/^[a-f0-9]{64}$/); expect(details.build!.previewHash).toMatch(/^[a-f0-9]{64}$/)
    const final = await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(row => row.artifactKey.startsWith('avg.media.') && row.mediaKind === 'voice').first()
    expect(final!.blobObjectId).toBe(s.raw.blobObjectId); expect(final!.contentHash).toBe(s.raw.contentHash)
  }, 30_000)

  it('persists unknown observation, refuses selection, then permits an explicitly revised review before it is consumed', async () => {
    const s = await start(); await review(s, true)
    await expect(stageAvgVoiceChoiceV3({ ...s, requirementKey: 'keeper.line', rawVersion: s.raw.version, rawContentHash: s.raw.contentHash,
      declaration: '不能以未知观察选用' })).rejects.toThrow(/未知|审听/)
    await review(s); await choose(s)
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)

  it('rejects a changed producer row at author confirmation and never accepts the pending choice', async () => {
    const s = await start(); await review(s)
    const candidate = await stageAvgVoiceChoiceV3({ ...s, requirementKey: 'keeper.line', rawVersion: s.raw.version,
      rawContentHash: s.raw.contentHash, declaration: '准确版本候选' })
    await db.productBuildArtifacts.update(s.raw.id!, { qualityJson: '{}' })
    await expect(confirmCandidate(s, candidate)).rejects.toThrow()
    expect((await db.productBuildArtifacts.get(candidate.id!))!.status).toBe('pending'); expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)

  it('refuses a duplicate generic voice Cue even after exact audio and review choices are adopted', async () => {
    const s = await start(); await review(s); await choose(s)
    const draft = await configureAvgChosenVoiceDraftV3({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
    workspace.presentation.stage.cues.push({ cueKey: 'duplicate.voice', beatKey: 'line.desk', type: 'play-audio', assetKey: 'voice.desk',
      phase: 'before', durationMs: 0, order: 0, easing: 'linear' })
    await saveAvgAuthorWorkspaceV1(s.scope, draft.revision, workspace)
    await expect(confirmInput(s, 'avg.author.stage')).rejects.toThrow(/重复声音 Cue/)
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)

  it('preserves actual voice provenance and exact bytes through Preview backup/remap, rejects corrupt bytes and deletes only the imported Work', async () => {
    const s = await start(); await review(s); await choose(s)
    await configureAvgChosenVoiceDraftV3({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
    await confirmInput(s, 'avg.author.stage')
    expect((await runAvgAssemblyV1(s)).buildStatus).toBe('preview-ready')
    const originalBuild = (await db.productBuilds.get(s.buildId))!
    const originalPreview = await verifyStoredProductBuildPreview(originalBuild)
    useAIConfigStore.getState().setConfig({ ...config, apiKey: '' })
    const projectId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const build = (await db.productBuilds.where('projectId').equals(projectId).first())!
    const scope = { projectId, worldId: build.worldId, workId: build.workId }
    const raw = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!, s.raw.artifactKey])
      .filter(row => row.status === 'accepted').first())!
    const target = { scope, productionId: build.productionId, requirementKey: 'keeper.line', version: raw.version, contentHash: raw.contentHash }
    const imported = await readAvgRawVoiceCandidateV3(target)
    expect(raw.producerRunId).not.toBe(s.raw.producerRunId)
    expect(raw.blobObjectId).not.toBe(s.raw.blobObjectId)
    expect(imported.data).toEqual(s.audio.data)
    expect(imported.raw.producerReceiptHash).toBe(s.raw.producerReceiptHash)
    expect((await verifyStoredProductBuildPreview(build))!.packageHash).toBe(originalPreview!.packageHash)
    const artifactCount = await db.productBuildArtifacts.count()
    await expect(stageAvgVoiceChoiceV3({ scope, productionId: build.productionId, requirementKey: 'keeper.line',
      rawVersion: raw.version, rawContentHash: raw.contentHash, declaration: '历史只读证明不能授权新的作者采用' })).rejects.toThrow()
    expect(await db.productBuildArtifacts.count()).toBe(artifactCount)
    const blob = (await db.mediaBlobObjects.get(raw.blobObjectId!))!, corrupt = new Uint8Array(blob.data!.slice(0))
    corrupt[corrupt.length - 1] ^= 1
    await db.mediaBlobObjects.update(blob.id!, { data: corrupt.buffer })
    await expect(readAvgRawVoiceCandidateV3(target)).rejects.toThrow()
    await db.mediaBlobObjects.put(blob)
    await deleteWork(scope.workId)
    expect(await db.productBuildArtifacts.where('workId').equals(scope.workId).count()).toBe(0)
    expect(await db.mediaBlobObjects.where('workId').equals(scope.workId).count()).toBe(0)
    expect((await readAvgRawVoiceCandidateV3({ ...s, requirementKey: 'keeper.line', version: s.raw.version, contentHash: s.raw.contentHash })).data).toEqual(s.audio.data)
    expect(await db.productBuilds.get(s.buildId)).toEqual(originalBuild)
    expect(s.fetcher).toHaveBeenCalledOnce()
  }, 30_000)
})
