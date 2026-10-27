import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, ProductProductionBriefV3, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAvgHistoricalRawVoiceArtifactV1 } from '../product-production/artifact-store'
import { assertAvgStoredAssemblyBriefV3, encodeAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import type { AvgAssemblyBriefV3 } from './voice-assembly-contract'
import { stringifyAvgExactJsonV1 } from './voice-exact-storage'
import { assertAvgRawVoiceArtifactV1, type AvgRawVoicePayloadV1 } from './voice-raw-contract'
import { assertAvgOriginalVoiceResponseV1 } from './voice-response-proof'
import { parseAvgRetainedVoiceProofV1, parseAvgVoiceRecoveryV1, type AvgRetainedVoiceProofV1 } from './voice-recovery-contract'
import { assertAvgNoUnresolvedVoiceRequestsV1 } from './voice-request-safety'
import type { AvgVoiceSpeechRequestV1 } from './voice-request-contract'
import { inspectAvgVoiceBytesV1 } from './voice-decoder'
import { avgVoiceProductionBudgetV3 } from './voice-production-policy'

const same = (a: unknown, b: unknown) => stringifyAvgExactJsonV1(a) === stringifyAvgExactJsonV1(b)
const MAXIMUM_VOICE_LINEAGE = 64
function pure<T>(read: () => Promise<T>): PromiseLike<T> {
  return Dexie.currentTransaction ? Dexie.waitFor(Dexie.ignoreTransaction(read), 20_000) : read()
}

/** Recovery authorization is separate from the immutable request definition. */
export function hashAvgVoiceDeclarationForRecoveryV1(voice: AvgAssemblyBriefV3['voice']) {
  const { recovery: _recovery, ...declaration } = voice
  return hashProductProductionValueV2(stringifyAvgExactJsonV1(declaration))
}

/** Only prospective paid requests enter the unknown-result deny guard.
 * Keeping an already proved result never retransmits its original request. */
export function avgPendingVoiceRequestsV1(assembly: AvgAssemblyBriefV3, requests: AvgVoiceSpeechRequestV1[]) {
  return requests.filter(request => !assembly.voice.recovery?.retained.some(r => r.requirementKey === request.requirementKey))
}

async function voiceRecoveryBase(input: {
  scope: WorkspaceScope; productionId: number; assembly: AvgAssemblyBriefV3
}) {
  const value = input.assembly.voice.recovery
  if (!value) throw new Error('[avg-voice] 缺少冻结的保留配音方案')
  const recovery = parseAvgVoiceRecoveryV1(value, input.assembly.voice.batch)
  const build = await db.productBuilds.where('[productionId+buildNumber]').equals([input.productionId, recovery.sourceBuildNumber]).first()
  if (!build?.id || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })
    || build.stateRevision !== recovery.sourceBuildRevision
    || !['cancelled', 'failed', 'recovery-required', 'paused', 'preview-ready', 'release-ready', 'released'].includes(build.status)) throw new Error('[avg-voice] 保留配音的来源版本已变化或仍在执行')
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([input.productionId, build.briefRevision]).first()
  if (!row || !await assertRecordInScope(input.scope, 'productProductionBriefs', row, { owner: 'work' })
    || row.briefHash !== recovery.sourceBriefHash || build.briefHash !== recovery.sourceBriefHash
    || build.planHash !== recovery.sourcePlanHash || !['authorized', 'superseded'].includes(row.status)
    || row.authorizedAt !== build.authorizedAt) throw new Error('[avg-voice] 保留配音缺少准确来源 Brief')
  const brief = parseProductProductionBriefV3(row.briefJson)
  if (brief.avgAssembly?.version !== 3) throw new Error('[avg-voice] 保留配音必须来自真实 AVG V3 版本')
  const source = await pure(() => assertAvgStoredAssemblyBriefV3(brief.avgAssembly))
  if (await hashAvgVoiceDeclarationForRecoveryV1(source.assembly.voice) !== recovery.sourceVoiceHash
    || await hashAvgVoiceDeclarationForRecoveryV1(input.assembly.voice) !== recovery.sourceVoiceHash
    || await hashProductProductionValueV2(brief) !== build.briefHash) {
    throw new Error('[avg-voice] 规范来源、台词、音色、演法或路由已改变，不能在同批恢复中复用旧音频')
  }
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  if (plan.controlEpoch !== recovery.sourceControlEpoch || await hashProductProductionValueV2(plan) !== recovery.sourcePlanHash) throw new Error('[avg-voice] 恢复来源的准确 Plan 已变化')
  return { recovery, build: build as ProductBuildRecordV1 & { id: number }, brief, source }
}

interface VoiceRecoveryReadInput {
  scope: WorkspaceScope; productionId: number; assembly: AvgAssemblyBriefV3; requirementKey: string
}

async function readVoiceRecoveryRaw(input: VoiceRecoveryReadInput, expectedProof: AvgRetainedVoiceProofV1 | undefined, visited: number[]) {
  const { recovery, build, brief, source } = await voiceRecoveryBase(input)
  if (visited.length >= MAXIMUM_VOICE_LINEAGE || visited.includes(recovery.sourceBuildNumber)) throw new Error('[avg-voice] 保留配音谱系缺失、成环或超限')
  const rows = expectedProof ? [] : await db.productBuildArtifacts.where('[buildId+artifactKey]')
    .equals([build.id, `avg.voice.raw.${input.requirementKey}`]).filter(r => r.status === 'accepted' && r.controlEpoch === recovery.sourceControlEpoch).toArray()
  if (!expectedProof && rows.length !== 1) throw new Error('[avg-voice] 原版本没有可核实的准确配音')
  const proved = await verifyAvgHistoricalRawVoiceArtifactV1({ scope: input.scope, buildId: build.id,
    expectedBuildRevision: recovery.sourceBuildRevision, expectedBriefHash: recovery.sourceBriefHash,
    expectedPlanHash: recovery.sourcePlanHash, sourceControlEpoch: recovery.sourceControlEpoch,
    artifactKey: expectedProof?.artifactKey ?? rows[0]!.artifactKey, version: expectedProof?.artifactVersion ?? rows[0]!.version,
    contentHash: expectedProof?.contentHash ?? rows[0]!.contentHash })
  const proof = parseAvgRetainedVoiceProofV1(proved.provenance)
  if (expectedProof && !same(proof, expectedProof)) throw new Error('[avg-voice] 保留配音证明已变化')
  const capability = brief.capabilityRequirements.find(c => c.requirementKey === 'avg.media.voice')!
  const raw = await pure(() => assertAvgRawVoiceArtifactV1({ assembly: source.assembly, capability, row: proved.artifact }))
  const origin = await assertAvgRawVoiceOriginV1({ scope: input.scope, build, assembly: source.assembly,
    row: proved.artifact, raw: raw.payload }, [...visited, build.buildNumber])
  const measured = (await pure(() => inspectAvgVoiceBytesV1({ data: origin.data, assetKey: raw.asset.assetKey,
    contentHash: raw.asset.contentHash, maximumDurationMs: raw.payload.requirement.maximumDurationMs }))).measurement
  if (measured.channelCount !== raw.payload.measurement.channelCount || measured.sampleCount !== raw.payload.measurement.sampleCount
    || measured.sourceSampleRateHz !== raw.payload.measurement.sourceSampleRateHz
    || Math.abs(measured.durationMs - raw.payload.measurement.durationMs) > 1) throw new Error('[avg-voice] 保留音频的当前解码与原始 PCM 不一致')
  return { artifact: proved.artifact, proof, ...raw, origin }
}

export function readAvgVoiceRecoverySourceV1(input: VoiceRecoveryReadInput, visited: number[] = []) {
  const retained = input.assembly.voice.recovery?.retained.find(r => r.requirementKey === input.requirementKey)
  if (!retained) throw new Error('[avg-voice] 该句没有冻结的原音频保留授权')
  return readVoiceRecoveryRaw(input, retained.proof, visited)
}

/** Read-only proof that a retake may replace this exact old draft asset.
 * The new clip must still have its own current author choice. */
export function readAvgVoiceRecoveryReplacementV1(input: VoiceRecoveryReadInput) {
  if (!input.assembly.voice.recovery?.rerunRequirementKeys.includes(input.requirementKey)) throw new Error('[avg-voice] 该句没有明确重做授权')
  return readVoiceRecoveryRaw(input, undefined, [])
}

/** Follow real zero-call producer receipts to the original saved HTTP body.
 * Never copy that body into a new Run as if another provider call occurred. */
export async function assertAvgRawVoiceOriginV1(input: {
  scope: WorkspaceScope; build: ProductBuildRecordV1; assembly: AvgAssemblyBriefV3
  row: ProductBuildArtifactRecordV1; raw: AvgRawVoicePayloadV1
}, visited: number[] = []): Promise<Awaited<ReturnType<typeof assertAvgOriginalVoiceResponseV1>>> {
  const recovery = input.assembly.voice.recovery
  const retained = recovery?.retained.some(r => r.requirementKey === input.raw.requirement.requirementKey)
  if (!retained) return assertAvgOriginalVoiceResponseV1(input)
  if (input.row.buildId !== input.build.id || input.build.parentBuildNumber !== recovery!.sourceBuildNumber
    || recovery!.sourceBuildNumber >= input.build.buildNumber) throw new Error('[avg-voice] 保留配音的父版本谱系不可验证')
  const prior = await readAvgVoiceRecoverySourceV1({ scope: input.scope, productionId: input.build.productionId,
    assembly: input.assembly, requirementKey: input.raw.requirement.requirementKey }, visited)
  const quality = JSON.parse(input.row.qualityJson) as Record<string, unknown>
  if (quality.schema !== 'storyforge.avg.raw-voice-revalidation' || quality.version !== 1 || quality.noProviderRequest !== true
    || !same(quality.retainedOrigin, prior.proof) || input.row.payloadJson !== prior.artifact.payloadJson
    || input.row.metadataJson !== prior.artifact.metadataJson || input.row.rightsJson !== prior.artifact.rightsJson
    || input.row.contentHash !== prior.artifact.contentHash) throw new Error('[avg-voice] 保留配音不能替换原音频、请求、权利或费用')
  return prior.origin
}

export async function validateAvgVoiceRecoveryV1(input: {
  scope: WorkspaceScope; productionId: number; brief: ProductProductionBriefV3; targetBuild?: ProductBuildRecordV1
  checkProspectiveRequests?: boolean
}) {
  if (input.brief.avgAssembly?.version !== 3) return
  const { assembly, requests } = await pure(() => assertAvgStoredAssemblyBriefV3(input.brief.avgAssembly))
  const recovery = assembly.voice.recovery
  if (!recovery) return
  const base = await voiceRecoveryBase({ ...input, assembly })
  const priorCapability = base.brief.capabilityRequirements.find(c => c.requirementKey === 'avg.media.voice')
  const currentCapability = input.brief.capabilityRequirements.find(c => c.requirementKey === 'avg.media.voice')
  if (!priorCapability || !currentCapability) throw new Error('[avg-voice] 恢复缺少准确配音能力')
  const { maximumRequestCost: _priorRequestCost, maximumTotalCost: _priorTotalCost, ...priorIdentity } = priorCapability
  const { maximumRequestCost: _currentRequestCost, maximumTotalCost: _currentTotalCost, ...currentIdentity } = currentCapability
  if (!same(priorIdentity, currentIdentity)) throw new Error('[avg-voice] 同批恢复的能力、外发或权利策略已变化')
  if (input.targetBuild && input.targetBuild.parentBuildNumber !== recovery.sourceBuildNumber) throw new Error('[avg-voice] 当前配音恢复的父版本不一致')
  const pending = avgPendingVoiceRequestsV1(assembly, requests)
  if (pending.length && input.checkProspectiveRequests !== false) await assertAvgNoUnresolvedVoiceRequestsV1({ scope: input.scope, requests: pending })
  for (const retained of recovery.retained) await readAvgVoiceRecoverySourceV1({ ...input, assembly, requirementKey: retained.requirementKey })
}

export async function prepareAvgVoiceRecoveryV1(input: {
  scope: WorkspaceScope; productionId: number; expectedBuildId: number; expectedBuildRevision: number
  retainedRequirementKeys: string[]; declaration: string
}) {
  const build = await db.productBuilds.get(input.expectedBuildId)
  if (!build?.id || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })
    || build.productionId !== input.productionId || build.stateRevision !== input.expectedBuildRevision || build.previewHash
    || !['cancelled', 'failed', 'recovery-required'].includes(build.status)) throw new Error('[avg-voice] 请先明确停止或处理失败，再准备未封存配音恢复方案')
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([input.productionId, build.briefRevision]).first()
  if (!row || !await assertRecordInScope(input.scope, 'productProductionBriefs', row, { owner: 'work' })) throw new Error('[avg-voice] 配音恢复来源缺失')
  const brief = parseProductProductionBriefV3(row.briefJson)
  if (brief.avgAssembly?.version !== 3) throw new Error('[avg-voice] 恢复需要真实配音版本')
  const { assembly } = await pure(() => assertAvgStoredAssemblyBriefV3(brief.avgAssembly))
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash), retained = []
  for (const requirementKey of input.retainedRequirementKeys) {
    const matches = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id, `avg.voice.raw.${requirementKey}`])
      .filter(r => r.status === 'accepted' && r.controlEpoch === plan.controlEpoch).toArray()
    if (matches.length !== 1) throw new Error('[avg-voice] 选定句子没有准确可保留的原始音频')
    const proof = await verifyAvgHistoricalRawVoiceArtifactV1({ scope: input.scope, buildId: build.id,
      expectedBuildRevision: build.stateRevision, expectedBriefHash: build.briefHash, expectedPlanHash: build.planHash,
      sourceControlEpoch: plan.controlEpoch, artifactKey: matches[0]!.artifactKey, version: matches[0]!.version, contentHash: matches[0]!.contentHash })
    retained.push({ requirementKey, proof: parseAvgRetainedVoiceProofV1(proof.provenance) })
  }
  const recovery = parseAvgVoiceRecoveryV1({ schema: 'storyforge.avg.voice-recovery', version: 1,
    sourceBuildNumber: build.buildNumber, sourceBuildRevision: build.stateRevision, sourceBriefHash: build.briefHash,
    sourcePlanHash: build.planHash, sourceControlEpoch: plan.controlEpoch, sourceVoiceHash: await hashAvgVoiceDeclarationForRecoveryV1(assembly.voice),
    retained, rerunRequirementKeys: assembly.voice.batch.requirements.filter(r => !input.retainedRequirementKeys.includes(r.requirementKey)).map(r => r.requirementKey),
    declaration: input.declaration }, assembly.voice.batch)
  const next = { ...assembly, voice: { ...assembly.voice, recovery } }
  await voiceRecoveryBase({ scope: input.scope, productionId: input.productionId, assembly: next })
  const pending = avgPendingVoiceRequestsV1(next, (await pure(() => assertAvgStoredAssemblyBriefV3(brief.avgAssembly))).requests)
  if (pending.length) await assertAvgNoUnresolvedVoiceRequestsV1({ scope: input.scope, requests: pending })
  for (const item of retained) await readAvgVoiceRecoverySourceV1({ scope: input.scope, productionId: input.productionId, assembly: next, requirementKey: item.requirementKey })
  return { recovery, sourceBrief: brief }
}

/** A reviewable evolution never inherits its parent's retention authority. */
export async function resetAvgVoiceRecoveryForEvolutionV1(brief: ProductProductionBriefV3) {
  if (brief.avgAssembly?.version !== 3) return {}
  const stored = brief.avgAssembly
  return pure(async () => {
    const { assembly } = await assertAvgStoredAssemblyBriefV3(stored)
    if (!assembly.voice.recovery && !assembly.image?.imageRecovery) return {}
    delete assembly.voice.recovery
    if (assembly.image) delete assembly.image.imageRecovery
    return { avgAssembly: await encodeAvgStoredAssemblyBriefV3(assembly),
      productionBudget: avgVoiceProductionBudgetV3(assembly, brief.productionBudget.maximumCostUsd) }
  })
}
