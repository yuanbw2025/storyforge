import { db } from '../db/schema'
import type { AssembleContextInput } from '../registry/types'
import type { ProductProductionPlanTaskV3 } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { readAvgSystemPlanForCompilationV1 } from './author-artifacts'
import { assertAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { validateAvgVoiceProductionSourcesV1 } from './voice-production-source'
import { validateAvgVisualProductionBatchSourceV1 } from './media-source'
import type { AvgAssemblyBriefV3 } from './voice-assembly-contract'
import type { AvgVoiceSpeechRequestV1 } from './voice-request-contract'
import { stringifyAvgExactJsonV1 } from './voice-exact-storage'
import { validateAvgVoiceRecoveryV1 } from './voice-recovery'

export const AVG_TASK_CONTEXT_SOURCE_V1 = 'product-production.avg-task-inputs'
export const AVG_MEDIA_REQUEST_SKILL_V1 = 'avg.media-request.v1'

/** Pure projection of already verified inputs. This grants no read, start,
 * provider or adoption authority. The full frozen Brief remains authoritative. */
export function projectAvgTaskRequirementV1(input: {
  assembly: AvgAssemblyBriefV3; task: ProductProductionPlanTaskV3; requests: AvgVoiceSpeechRequestV1[]
}) {
  const { assembly, task } = input
  if (task.kind === 'avg-media-voice-generate' || task.kind === 'avg-media-voice-reuse') {
    const requirement = assembly.voice.batch.requirements.find(r => task.taskKey === `avg.voice.generate.${r.requirementKey}`)
    const request = input.requests.find(r => r.requirementKey === requirement?.requirementKey)
    const preset = assembly.voice.batch.presets.find(p => p.presetKey === requirement?.presetKey)
    if (!requirement || !request || !preset) throw new Error('[avg-context] 缺少准确单句请求')
    // Words and performance appear once. The request body is deterministically
    // recompiled by the executor and bound here by its exact hash/identity.
    const { requestBodyJson: _body, ...requestIdentity } = request
    return { kind: 'voice' as const, sourceInputHash: assembly.voice.batch.sourceInputHash,
      requirement, preset, protocol: assembly.voice.protocol, binding: assembly.voice.binding, request: requestIdentity,
      ...(assembly.voice.recovery ? { recovery: { sourceBuildNumber: assembly.voice.recovery.sourceBuildNumber,
        sourceVoiceHash: assembly.voice.recovery.sourceVoiceHash, declaration: assembly.voice.recovery.declaration,
        retained: assembly.voice.recovery.retained.find(r => r.requirementKey === requirement.requirementKey) ?? null } } : {}) }
  }
  if (task.kind === 'avg-media-image-generate' || task.kind === 'avg-media-image-reuse' || task.kind === 'avg-media-image-process') {
    const image = assembly.image
    const requirement = image?.mediaBatch.requirements.find(r => task.taskKey === `${task.kind === 'avg-media-image-process' ? 'avg.media.process' : 'avg.media.generate'}.${r.requirementKey}`)
    if (!image || !requirement) throw new Error('[avg-context] 缺少准确图片需求')
    return { kind: 'image' as const, sourceInputHash: image.mediaBatch.sourceInputHash,
      batchKey: image.mediaBatch.batchKey, batchRevision: image.mediaBatch.revision,
      aspectRatio: image.mediaBatch.aspectRatio, requirement, binding: image.imageBinding,
      processing: image.imageProcessing?.entries.find(e => e.requirementKey === requirement.requirementKey) ?? null,
      retained: image.imageRecovery?.retained.find(e => e.requirementKey === requirement.requirementKey) ?? null }
  }
  if (!['avg-assembly-integrate', 'avg-assembly-verify'].includes(task.kind)) throw new Error('[avg-context] 不支持该执行任务')
  return { kind: 'assembly' as const, title: assembly.title, basePackageHash: assembly.basePackageHash,
    sceneKeys: assembly.sceneKeys, mediaAssetKeys: assembly.mediaAssetKeys,
    voiceSourceInputHash: assembly.voice.batch.sourceInputHash,
    imageSourceInputHash: assembly.image?.mediaBatch.sourceInputHash ?? null }
}

/** Registered Work-owned reader. Payloads are consumed by deterministic
 * executors through verified inputArtifacts, not repeated in an AI context.
 * Every dependency remains present as an exact, receipt-bound witness. */
export async function readAvgTaskExecutionContextV1(input: AssembleContextInput): Promise<string> {
  const scope = input.scope
  if (!scope || !input.productBuildId || !input.productProductionId || !input.productProductionTaskKey) {
    throw new Error('[avg-context] 缺少准确 Work/Build/任务')
  }
  const build = await db.productBuilds.get(input.productBuildId)
  const production = await db.productProductions.get(input.productProductionId)
  if (!build || !production || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || build.productionId !== production.id || production.productType !== 'avg' || production.status !== 'producing'
    || production.currentBuildNumber !== build.buildNumber || production.controlEpoch !== build.controlEpoch
    || !['building', 'integrating'].includes(build.status) || production.currentBriefRevision !== build.briefRevision) {
    throw new Error('[avg-context] 制作来源已 stale 或跨作品')
  }
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([production.id!, build.briefRevision]).first()
  if (!row || !await assertRecordInScope(scope, 'productProductionBriefs', row, { owner: 'work' })
    || row.status !== 'authorized' || row.briefHash !== build.briefHash || row.authorizedAt !== build.authorizedAt) {
    throw new Error('[avg-context] 缺少准确已授权 Brief')
  }
  const brief = parseProductProductionBriefV3(row.briefJson)
  if (brief.avgAssembly?.version !== 3 || await hashProductProductionValueV2(brief) !== build.briefHash) {
    throw new Error('[avg-context] 只接受完整、准确的 AVG V3 Brief')
  }
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  const task = plan.tasks.find(t => t.taskKey === input.productProductionTaskKey)
  if (await hashProductProductionValueV2(plan) !== build.planHash || plan.controlEpoch !== build.controlEpoch
    || plan.buildNumber !== build.buildNumber || !task || task.executionMode === 'human-import'
    || (task.executionMode === 'media-provider' ? task.skillId !== AVG_MEDIA_REQUEST_SKILL_V1
      : task.skillId !== null || task.contextProfile !== 'avg-task-v1')
    || canonicalProductProductionJsonV2(input.productArtifactKeys ?? []) !== canonicalProductProductionJsonV2(task.inputArtifactKeys)) {
    throw new Error('[avg-context] Plan、登记 Skill 或准确依赖选择不一致')
  }
  const resolved = await assertAvgStoredAssemblyBriefV3(brief.avgAssembly)
  await validateAvgVoiceRecoveryV1({ scope, productionId: production.id!, brief, targetBuild: build, checkProspectiveRequests: false })
  // Reuse actual author command/SourcePlan verification and the full canonical
  // source hash. Narrow delivery must never become narrow source validation.
  const source = await readAvgSystemPlanForCompilationV1({ scope, buildId: build.id!,
    expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch, includeSceneScripts: true,
    includeAuthorStage: task.inputArtifactKeys.includes('avg.author.stage') })
  const required = new Set(resolved.assembly.voice.batch.requirements.map(r => r.script.artifactKey))
  await validateAvgVoiceProductionSourcesV1(resolved.assembly.voice.batch,
    { systemPlan: source.plan, scripts: source.scripts.map(s => s.payload) },
    source.scripts.filter(s => required.has(s.artifact.artifactKey)).map(s => ({ ...s.artifact, payload: s.payload })))
  if (resolved.assembly.image) await validateAvgVisualProductionBatchSourceV1(resolved.assembly.image.mediaBatch,
    { systemPlan: source.plan, scripts: source.scripts.map(s => s.payload), presentation: { aspectRatio: resolved.assembly.image.mediaBatch.aspectRatio } })
  const rows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
  // Human imports own author command receipts, not producer receipts. Keep
  // that existing distinction; only producer outputs use the producer reader.
  const authorRefs = [source.artifact, ...source.scripts.map(s => s.artifact),
    ...(source.authorStage ? [source.authorStage.artifact] : []),
    ...(source.mediaChoices ?? []).map(s => s.artifact), ...(source.voiceChoices ?? []).map(s => s.artifact)]
  const artifacts = []
  for (const key of task.inputArtifactKeys) {
    const matches = rows.filter(r => r.artifactKey === key && r.status === 'accepted' && r.controlEpoch === build.controlEpoch)
    if (matches.length !== 1) throw new Error(`[avg-context] 依赖缺失、重复或未采用:${key}`)
    const author = authorRefs.find(r => r.artifactKey === key)
    const actual = author ? matches[0]! : await verifyAcceptedProductBuildArtifactV1({ scope, buildId: build.id!, artifactKey: key,
      version: matches[0]!.version, contentHash: matches[0]!.contentHash })
    if (author && (author.version !== actual.version || author.contentHash !== actual.contentHash)) throw new Error('[avg-context] 作者依赖与实际采用凭证不一致')
    artifacts.push({ artifactKey: key, version: actual.version, kind: actual.kind,
      contentHash: actual.contentHash, producerReceiptHash: actual.producerReceiptHash,
      authorReceiptHash: author ? (JSON.parse(actual.metadataJson) as { receiptHash: string }).receiptHash : null })
  }
  const current = await db.productBuilds.get(build.id!), owner = await db.productProductions.get(production.id!)
  if (!current || !owner || current.stateRevision !== build.stateRevision || current.controlEpoch !== build.controlEpoch
    || current.planHash !== build.planHash || current.briefHash !== build.briefHash || current.status !== build.status
    || owner.status !== production.status || owner.controlEpoch !== production.controlEpoch
    || owner.currentBuildNumber !== production.currentBuildNumber || owner.currentBriefRevision !== production.currentBriefRevision) {
    throw new Error('[avg-context] 上下文读取期间制作状态已变化')
  }
  return stringifyAvgExactJsonV1({ schema: 'storyforge.avg.task-inputs', version: 1,
    productionKey: production.productionKey, buildNumber: build.buildNumber, controlEpoch: build.controlEpoch,
    planHash: build.planHash, taskKey: task.taskKey, briefRevision: row.revision, briefHash: row.briefHash,
    voicePacketHash: resolved.stored.voice.contentHash, sourceWorldContentHash: row.sourceWorldContentHash,
    requirement: projectAvgTaskRequirementV1({ ...resolved, task }), artifacts,
    capabilities: brief.capabilityRequirements.filter(c => task.capabilityRequirementKeys.includes(c.requirementKey)),
    taskBudget: task.budgetReservation })
}
