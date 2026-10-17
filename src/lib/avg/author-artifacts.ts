/** Author-supplied professional candidates. No provider/Skill invocation occurs here.
 * AI candidates keep the closed admission gate until their role package is registered. */
import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, ProductProductionCommandV1, ProductProductionRecordV1, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { canonicalStringify } from '../agent/run/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { parseConfirmedProductBriefV1, parseProductProductionSourcePlanV1 } from '../product-production/source-contracts'
import { applyAvgDialoguePatchV1, parseAvgProfessionalArtifactV1, prepareAvgProfessionalArtifactV1, type AvgProfessionalArtifactV1 } from './artifact-contract'
import { parseAvgAuthorStageV1, type AvgAuthorStageV1 } from './author-workspace-contract'
import { validateAvgAuthorAssemblyV1, type AvgAssemblyValidationV1 } from './author-stage-validation'
import { avgKey, avgText } from './protocol-validation'
import { validateAvgSystemPlanForAuthorV1, type AvgSystemValidationV1 } from './system-compiler'
import { buildAvgNativeAssemblyPlan } from './assembly-plan'
import { buildAvgVisualPlanningPlanV4 } from './visual-planning-plan'
import { parseAvgAuthorMediaChoice, avgMediaChoiceArtifactKeyV1, avgVisualReviewArtifactKeyV1, type AvgAuthorMediaChoice } from './media-production-contract'
import { inspectAvgChosenImageV1, readAvgChosenMediaSourceV2, validateAvgMediaChoiceV1, type AvgMediaChoiceValidation } from './media-choice-validation'
import { verifyAcceptedProductBuildArtifactV1, verifyAvgReferenceRawImageArtifactV1, verifyAvgProcessedImageArtifactV1, verifyAvgHistoricalRawVoiceArtifactV1, verifyHistoricalAvgVisualPlanningArtifactV4 } from '../product-production/artifact-store'
import { assertAvgRawImageOriginV1 } from './media-recovery'
import { readAvgInheritedStageImagesV1 } from './stage-image-sources'
import { readAvgInheritedStageVoicesV1 } from './stage-voice-sources'
import { assertAvgVisualReviewSelectableV1, assertAvgVisualReviewRevisionV1, validateAvgAuthorVisualReviewV1 } from './visual-review'
import { parseAvgAuthorVoiceChoiceV1, type AvgAuthorVoiceChoiceV1 } from './voice-choice-contract'
import { assertAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1, avgVoiceChoiceArtifactKeyV1, avgVoiceReviewArtifactKeyV1 } from './voice-assembly-contract'
import { bindAvgVoiceChoiceToSourceV1, readAvgChosenVoiceSourceV1, readAvgRawVoiceSourceV1, type AvgVoiceChoiceValidationV1 } from './voice-choice-validation'
import { parseAvgRetainedVoiceProofV1 } from './voice-recovery-contract'
import { assertAvgVoiceReviewRevisionV1, assertAvgVoiceReviewScopeV1, assertAvgVoiceReviewSelectableV1 } from './voice-review'
import { readAvgOptionalImageDefinitionV3 } from './media-production-definition'
import { assertAvgVisualRoleProposalV4, validateAvgVisualSemanticV4 } from './visual-role-proposal'
import { readAvgVisualProposalEvidenceV4 } from './visual-planning-evidence'
import { AVG_VISUAL_TEXT_CAPABILITY_V4 } from './visual-planning-roles'
import { readAvgImageConsumptionDefinitionV4 } from './image-consumption'
import type { AvgVisualReusePathV4 } from './visual-planning-reuse-contract'

type Ref = { artifactKey: string; version: number; contentHash: string }
interface AuthorCandidateBase {
  schema: 'storyforge.avg.author-candidate'; origin: 'author-import' | 'model-proposal' | 'history-reuse'
  productionKey: string; buildNumber: number; briefRevision: number; briefHash: string
  confirmedBriefHash: string; sourcePlanHash: string; planRevision: number; planHash: string
  controlEpoch: number; taskKey: string; artifactKey: string; kind: ProductBuildArtifactRecordV1['kind']
  payloadHash: string; base: Ref | null; inputs: Ref[]; declaration: string
}
type AuthorCandidateBody = AuthorCandidateBase & ({ version: 1 } | { version: 2; systemValidation: AvgSystemValidationV1 } | { version: 3; assemblyValidation: AvgAssemblyValidationV1 }
  | { version: 4; mediaChoiceValidation: AvgMediaChoiceValidation } | { version: 5; voiceChoiceValidation: AvgVoiceChoiceValidationV1 }
  | { version: 6 | 7; visualProposalValidation: AvgVisualProposalValidationV4 })
interface AvgVisualProposalValidationV4 { proposal: Ref; scopeHash: string; originalPayloadHash: string; authorEdited: boolean; reuseSourceHash?:string }
type AuthorCandidate = AuthorCandidateBody & { candidateHash: string }
type AdoptCommand = Extract<ProductProductionCommandV1, { type: 'adopt-avg-artifact' }>

export class AvgAuthorArtifactErrorV1 extends Error {}
const hash = hashProductProductionValueV2
const ref = (row: ProductBuildArtifactRecordV1): Ref => ({ artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash })

async function mediaProofTables(buildId: number, withStageSources = false) {
  const build = await db.productBuilds.get(buildId)
  const row = build ? await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first() : null
  // Only chooses transaction tables; authority() rechecks the actual frozen
  // scope/Brief/hash inside the transaction before any read or write grant.
  const stored = row && JSON.parse(row.briefJson) as { avgAssembly?: { version?: number }; avgVisualPlanning?: unknown }
  const version = stored?.avgAssembly?.version
  const media = withStageSources || version === 2 || version === 3 || !!stored?.avgVisualPlanning
  return media ? [db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, db.agentRunArtifacts] : []
}

function validateSystem(value: unknown) {
  // Validation only computes on its frozen payload; it does not read/write DB.
  // Keep one transaction lease around this entire crypto pipeline. Its hash
  // helpers must not enqueue nested waitFor calls behind that same lease.
  return Dexie.currentTransaction
    ? Dexie.waitFor(Dexie.ignoreTransaction(() => validateAvgSystemPlanForAuthorV1(value)))
    : validateAvgSystemPlanForAuthorV1(value)
}

type AuthorPayload = AvgProfessionalArtifactV1 | AvgAuthorStageV1 | AvgAuthorMediaChoice | AvgAuthorVoiceChoiceV1
function prepareAuthorInput(input: Parameters<typeof prepareAvgProfessionalArtifactV1>[0]): { payload: AuthorPayload; payloadJson: string } {
  if (input.artifactKey.startsWith('avg.voice.choice.')) {
    const payload = parseAvgAuthorVoiceChoiceV1(input.payload)
    if (input.kind !== 'presentation' || input.artifactKey !== avgVoiceChoiceArtifactKeyV1(payload.requirementKey)
      || !input.allowedOutputKeys.includes(input.artifactKey)) throw new Error('[avg-voice] 作者配音选择超出冻结输出域')
    return { payload, payloadJson: canonicalProductProductionJsonV2(payload) }
  }
  if (input.artifactKey.startsWith('avg.media.choice.')) {
    const payload = parseAvgAuthorMediaChoice(input.payload)
    if (input.kind !== 'presentation' || input.artifactKey !== avgMediaChoiceArtifactKeyV1(payload.requirementKey)
      || !input.allowedOutputKeys.includes(input.artifactKey)) throw new Error('[avg-media] 作者选择超出冻结输出域')
    return { payload, payloadJson: canonicalProductProductionJsonV2(payload) }
  }
  if (input.artifactKey !== 'avg.author.stage') return prepareAvgProfessionalArtifactV1(input)
  if (input.kind !== 'presentation' || !input.allowedOutputKeys.includes(input.artifactKey)) throw new Error('[avg] 作者演出超出冻结写域或 kind 无效')
  const payload = parseAvgAuthorStageV1(input.payload)
  return { payload, payloadJson: canonicalProductProductionJsonV2(payload) }
}
async function validateAssembly(context: Awaited<ReturnType<typeof authority>>, scope: WorkspaceScope, payload: AuthorPayload, inputs: ProductBuildArtifactRecordV1[]) {
  if (payload.schema !== 'storyforge.avg.author-stage') return undefined
  const generated = new Map<string, { asset: AvgAuthorMediaChoice['asset']; blobObjectId: number }>()
  const a = context.brief.avgAssembly
  const image = context.brief.avgVisualPlanning || readAvgOptionalImageDefinitionV3(context.brief)
    ? await readAvgImageConsumptionDefinitionV4({scope,buildId:context.build.id!,brief:context.brief}) : null
  if (image) {
    if (payload.aspectRatio !== image.mediaBatch.aspectRatio) throw new Error('[avg-media] 最终演出画幅与冻结批次不一致')
    const choices = inputs.filter(row => row.artifactKey.startsWith('avg.media.choice.'))
    if (choices.length !== image.mediaBatch.requirements.length) throw new Error('[avg-media] 演出缺少全部准确的作者媒资选择')
    for (const r of image.mediaBatch.requirements) {
      const row = choices.find(row => row.artifactKey === avgMediaChoiceArtifactKeyV1(r.requirementKey))
      if (!row) throw new Error('[avg-media] 缺少准确需求的作者选择')
      const choice = parseAvgAuthorMediaChoice(row.payloadJson)
      const selected = await readAvgChosenMediaSourceV2({ scope, buildId: context.build.id!, brief: context.brief, choice })
      const review=await readChoiceVisualReview(context,scope,choice,selected.raw,context.build.controlEpoch,selected.processed?.row)
      await assertFrozenAuthorCandidateV1(context,row,context.plan.tasks.find(task=>task.taskKey===`avg.author.media.${r.requirementKey}`)!,[selected.raw,...(selected.processed?[selected.processed.row]:[]),...(review?[review.row]:[])],context.build.controlEpoch)
      const receipt = JSON.parse(row.metadataJson) as { candidate: AuthorCandidate }
      if (receipt.candidate.version !== 4 || canonicalProductProductionJsonV2(receipt.candidate.mediaChoiceValidation) !== canonicalProductProductionJsonV2(selected.validation)) throw new Error('[avg-media] 选择缺少准确的真实解码采用回执')
      if (choice.referenceOnly) {
        if (payload.stage.assets.some(asset => asset.assetKey === choice.asset.assetKey)) throw new Error('[avg-media] reference-only 原图不得进入运行媒资')
        continue
      }
      if (!payload.stage.assets.some(asset => canonicalProductProductionJsonV2(asset) === canonicalProductProductionJsonV2(choice.asset))) throw new Error('[avg-media] 已选择的原图未准确进入演出媒资')
      if (r.consumer.domain === 'stage') {
        const type = r.consumer.slot === 'actor' ? 'show-actor' : r.consumer.slot === 'background' ? 'set-background' : 'show-cg'
        if (!payload.stage.cues.some(cue => cue.type === type && cue.assetKey === r.assetKey && cue.beatKey === r.triggerBeatKey
          && (r.consumer.slot !== 'actor' || cue.actorKey === r.consumer.subjectKey))) throw new Error('[avg-media] 原图未绑定冻结的舞台主体和触发拍')
      } else if (r.consumer.domain === 'inventory' || r.consumer.domain === 'evidence') {
        const rule = inputs.find(row => row.artifactKey === 'avg.system.plan')
        const plan = rule ? JSON.parse(rule.payloadJson) as import('./system-contract').AvgSystemPlan : null
        const item = plan?.version === 2 ? plan.inventory.items.find(item => item.key === r.consumer.subjectKey) : undefined
        const view = r.itemVariantKey === null ? item : item?.variants.find(v => v.key === r.itemVariantKey)
        if (!view || (r.consumer.domain === 'inventory' ? view.iconAssetKey : view.detailAssetKey) !== r.assetKey) throw new Error('[avg-media] 物件图未绑定冻结的准确显示变体')
      }
      generated.set(choice.asset.assetKey, { asset: choice.asset, blobObjectId: selected.image.blobObjectId! })
    }
  }
  if (a?.version === 3) {
    const voice = await readVoiceDefinition(context)
    const choices = inputs.filter(row => row.artifactKey.startsWith('avg.voice.choice.'))
    if (choices.length !== voice.assembly.voice.batch.requirements.length || !payload.reading) throw new Error('[avg-voice] 演出缺少全部已采用配音选择或明确的阅读策略')
    for (const r of voice.assembly.voice.batch.requirements) {
      const row = choices.find(row => row.artifactKey === avgVoiceChoiceArtifactKeyV1(r.requirementKey))
      if (!row) throw new Error('[avg-voice] 演出缺少准确需求的配音选择')
      const choice = parseAvgAuthorVoiceChoiceV1(row.payloadJson)
      const selected = await readAvgChosenVoiceSourceV1({ scope, buildId: context.build.id!, ...voice, choice })
      const review = await readChoiceVoiceReview(context, scope, choice, selected)
      const task = context.plan.tasks.find(task => task.taskKey === `avg.author.voice-choice.${r.requirementKey}`)
      if (!task || task.kind !== 'avg-author-voice-choice') throw new Error('[avg-voice] 演出配音选择任务不存在')
      const candidate = await assertFrozenAuthorCandidateV1(context, row, task, [selected.raw, review.row], context.build.controlEpoch)
      if (candidate.version !== 5 || canonicalProductProductionJsonV2(candidate.voiceChoiceValidation) !== canonicalProductProductionJsonV2(selected.validation)) throw new Error('[avg-voice] 演出配音选择缺少准确字节采用回执')
      const expectedVoice = { lineKey: r.lineKey, assetKey: r.assetKey, text: r.text, textRevision: r.textRevision,
        speakerKey: r.speakerKey, locale: r.locale }
      const binding = payload.reading.voices.filter(v => v.lineKey === r.lineKey)
      if (!payload.stage.assets.some(asset => canonicalProductProductionJsonV2(asset) === canonicalProductProductionJsonV2(selected.asset))
        || binding.length !== 1 || canonicalStringify(binding[0]) !== canonicalStringify(expectedVoice)
        || selected.asset.durationMs! >= payload.reading.maximumVoiceWaitMs
        || payload.stage.cues.some(cue => cue.assetKey === r.assetKey)) throw new Error('[avg-voice] 配音未准确绑定台词、阅读等待或出现重复声音 Cue')
      if (generated.has(r.assetKey)) throw new Error('[avg-voice] 配音与其他生成媒资不能占用同一 key')
      generated.set(r.assetKey, { asset: selected.asset, blobObjectId: selected.blobObjectId })
    }
  }
  const inherited=await readAvgInheritedStageImagesV1({scope,payload,productionKey:context.production.productionKey,
    targetBuildNumber:context.build.buildNumber,worldContentHash:context.brief.source.worldContentHash})
  for(const [key,image] of inherited){
    if(generated.has(key))throw new Error('[avg-media] 本批生成图片不能借旧图来源替代')
    generated.set(key,image)
  }
  if (payload.inheritedVoices?.length) {
    const scripts = inputs.filter(row => row.artifactKey.startsWith('avg.content.scene-script.')).map(row => {
      const script = parseAvgProfessionalArtifactV1(row.payloadJson)
      if (script.schema !== 'storyforge.avg.scene-script') throw new Error('[avg-voice] 沿用配音缺少已采用的准确脚本')
      return script
    })
    const inheritedVoices = await readAvgInheritedStageVoicesV1({ scope, payload, scripts, productionKey: context.production.productionKey,
      targetBuildNumber: context.build.buildNumber, worldContentHash: context.brief.source.worldContentHash })
    for (const [key, voice] of inheritedVoices) {
      if (generated.has(key)) throw new Error('[avg-voice] 本批新配音不能同时借旧版配音来源')
      generated.set(key, voice)
    }
  }
  return validateAvgAuthorAssemblyV1({ scope, payload, inputs: context.brief.avgVisualPlanning || a && a.version !== 1
    ? inputs.filter(row => !row.artifactKey.startsWith('avg.media.choice.') && !row.artifactKey.startsWith('avg.voice.choice.')) : inputs,
    generated, productKey: context.production.productionKey,
    sourceWorld: { contentHash: context.brief.source.worldContentHash, selection: context.brief.source.selection } })
}

async function authority(scope: WorkspaceScope, buildId: number, forCompilation = false, frozenVerification = false,
  referenceEpoch?: number, referenceKind: 'image' | 'voice' | 'visual' = 'image') {
  const referenceRead = referenceEpoch !== undefined
  const build = await db.productBuilds.get(buildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) throw new Error('[avg] Build 不存在或跨 Work')
  const production = await db.productProductions.get(build.productionId)
  const work = await db.works.get(scope.workId)
  if (!production?.id || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || production.productType !== 'avg' || work?.kind !== 'avg') throw new Error('[avg] 必须属于当前 AVG Work/Production')
  if (!frozenVerification && !referenceRead && (production.status !== 'producing' || production.currentBuildNumber !== build.buildNumber
    || production.controlEpoch !== build.controlEpoch || !(forCompilation ? ['authorized','building','integrating'] : ['authorized','building']).includes(build.status)
    || build.packageHash || build.previewHash || build.releasedProductReleaseId != null)) throw new Error('[avg] 当前 Build 不可采用；已冻结版本须建立新 Build')
  if (frozenVerification && (!['building','validating','preview-ready','release-ready','released'].includes(build.status)
    || !build.packageHash || !build.previewHash || !build.rootTerminalReceiptHash)) throw new Error('[avg] 只读作者验证要求已封存的原生 Build')
  if (referenceRead && (!Number.isSafeInteger(referenceEpoch) || referenceEpoch < 0 || referenceEpoch > build.controlEpoch
    || !['building','integrating','validating','preview-ready','release-ready','released','paused','cancelled','failed','recovery-required'].includes(build.status))) throw new Error('[avg-media] 生成参考来源不属于可验证的已执行版本')
  const briefRow = await db.productProductionBriefs.where('[productionId+revision]').equals([production.id, build.briefRevision]).first()
  if (!briefRow || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || !(referenceRead ? ['authorized','superseded'] : ['authorized']).includes(briefRow.status) || briefRow.authorizedAt !== build.authorizedAt
    || briefRow.briefHash !== build.briefHash || !frozenVerification && !referenceRead && production.currentBriefRevision !== build.briefRevision) throw new Error('[avg] Brief 授权已 stale')
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (brief.intent.productType !== 'avg' || await hash(brief) !== build.briefHash) throw new Error('[avg] Brief 内容/hash 不一致')
  if (frozenVerification && !brief.avgAssembly&&!brief.avgVisualPlanning) throw new Error('[avg] 只读作者验证只接受原生组装合同')
  if (referenceRead && referenceKind === 'image' && !readAvgOptionalImageDefinitionV3(brief)) throw new Error('[avg-media] 生成参考只接受原生图片生产来源')
  if (referenceRead && referenceKind === 'voice' && brief.avgAssembly?.version !== 3) throw new Error('[avg-voice] 沿用配音只接受原生配音生产来源')
  if (referenceRead && referenceKind === 'visual' && !brief.avgVisualPlanning) throw new Error('[avg-visual-history] 历史专业方案只接受准确 V4 来源')
  if (!forCompilation && brief.avgAssembly?.version === 1 && Object.keys((JSON.parse(build.budgetLedgerJson) as { tasks?: object }).tasks ?? {}).length) throw new Error('[avg] 组装已开始执行；请保留旧版本并创建新 Build 修订')
  const sourcePlan = await Dexie.waitFor(parseProductProductionSourcePlanV1(briefRow))
  const confirmed = await Dexie.waitFor(parseConfirmedProductBriefV1({ row: briefRow, sourcePlan }))
  if (sourcePlan.productType !== 'avg' || sourcePlan.productInstanceKey !== production.productionKey
    || confirmed.briefRevision !== build.briefRevision || confirmed.briefContentHash !== build.briefHash
    || confirmed.confirmedBy !== 'author') throw new Error('[avg] 冻结来源/作者开始合同不一致')
  const starts = await db.productProductionCommands.where('productionId').equals(production.id).toArray()
  const started = starts.some(row => {
    if (row.type !== 'authorize-start' || row.status !== 'succeeded' || row.completedAt !== build.authorizedAt
      || row.expectedStateRevision !== confirmed.authorStartRevision) return false
    const result = JSON.parse(row.resultJson) as Record<string, unknown>
    return result.buildNumber === build.buildNumber && result.briefRevision === build.briefRevision && result.briefHash === build.briefHash
  })
  if (!started) throw new Error('[avg] 缺少实际作者开始命令回执')
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  const sourceEpoch = referenceEpoch ?? build.controlEpoch
  if (plan.productType !== 'avg' || plan.buildNumber !== build.buildNumber || plan.controlEpoch !== sourceEpoch
    || build.planRevision < 1 || await hash(plan) !== build.planHash
    || canonicalProductProductionJsonV2(plan) !== build.planJson) throw new Error('[avg] 冻结 Plan/hash 已 stale')
  if (frozenVerification || referenceRead) {
    const input={brief,briefHash:build.briefHash,buildNumber:build.buildNumber,controlEpoch:sourceEpoch}
    const expected=brief.avgVisualPlanning?buildAvgVisualPlanningPlanV4({...input,brief:{...brief,avgVisualPlanning:brief.avgVisualPlanning}}):buildAvgNativeAssemblyPlan(input)
    if(canonicalProductProductionJsonV2(expected)!==build.planJson)throw new Error('[avg] 原生作者 Plan 不是冻结的固定组装拓扑')
  }
  return { scope,build, production: production as ProductProductionRecordV1 & { id: number }, briefRow, brief, plan, sourcePlan,reusePath:[] as AvgVisualReusePathV4 }
}

async function acceptedInputs(scope: WorkspaceScope, buildId: number, epoch: number, keys: string[]) {
  const rows = await db.productBuildArtifacts.where('buildId').equals(buildId).toArray()
  const result: ProductBuildArtifactRecordV1[] = []
  for (const key of keys) {
    const matches = rows.filter(row => row.artifactKey === key && row.status === 'accepted' && row.controlEpoch === epoch)
    if (key.startsWith('avg.media.raw.')||key.startsWith('avg.media.processed.')||key.startsWith('avg.voice.raw.')||key.startsWith('avg.proposal.')||key==='avg.media.compiled-visual-requirements') {
      const row = matches[0]
      if (matches.length !== 1 || !row) throw new Error('[avg-media] 原图未准确接收')
      const verified = await verifyAcceptedProductBuildArtifactV1({ scope, buildId, artifactKey: key, version: row.version, contentHash: row.contentHash })
      if (key.startsWith('avg.proposal.')) await readAvgVisualProposalEvidenceV4(scope, verified)
      result.push(verified)
      continue
    }
    if (matches.length !== 1 || !await assertRecordInScope(scope, 'productBuildArtifacts', matches[0]!, { owner: 'work' })
      || await hash(JSON.parse(matches[0]!.payloadJson)) !== matches[0]!.contentHash) throw new Error(`[avg] 上游未采用或内容已 stale:${key}`)
    await assertAuthorAdoptionReceipt(scope, matches[0]!)
    result.push(matches[0]!)
  }
  return result
}

async function assertAuthorAdoptionReceipt(scope: WorkspaceScope, artifact: ProductBuildArtifactRecordV1) {
  const envelope = JSON.parse(artifact.metadataJson) as { schema: string; commandId: string; receiptHash: string; [key: string]: unknown }
  const { receiptHash, ...body } = envelope
  if (envelope.schema !== 'storyforge.avg.author-adoption' || receiptHash !== await hash(body)) throw new Error('[avg] 正式工件缺少可验证作者采用回执')
  const build = await db.productBuilds.get(artifact.buildId)
  const command = build ? await db.productProductionCommands.where('[productionId+commandId]').equals([build.productionId, envelope.commandId]).first() : null
  if (!command || !await assertRecordInScope(scope, 'productProductionCommands', command, { owner: 'work' })
    || command.type !== 'adopt-avg-artifact' || command.status !== 'succeeded') throw new Error('[avg] 作者采用命令未完成或跨 Work')
  const result = JSON.parse(command.resultJson) as { authorReceiptHash: string; artifactKey: string; version: number; contentHash: string; derivedScript: Ref | null }
  const adopted = result.artifactKey === artifact.artifactKey && result.version === artifact.version && result.contentHash === artifact.contentHash
  const derived = result.derivedScript?.artifactKey === artifact.artifactKey && result.derivedScript.version === artifact.version && result.derivedScript.contentHash === artifact.contentHash
  if (result.authorReceiptHash !== receiptHash || !adopted && !derived) throw new Error('[avg] 作者回执与正式 revision 不一致')
}

function authorTask(context: Awaited<ReturnType<typeof authority>>, taskKey: string, artifactKey: string, readOnly = false) {
  const task = context.plan.tasks.find(task => task.taskKey === taskKey)
  if (!task || task.executionMode !== 'human-import' || task.skillId !== null
    || task.outputArtifactKeys.length !== 1 || task.outputArtifactKeys[0] !== artifactKey
    || task.budgetReservation.modelCalls !== 0 || task.budgetReservation.mediaCalls !== 0) throw new Error('[avg] 候选超出冻结的作者输入写域')
  if(['avg-author-visual-review','avg-author-voice-review'].includes(task.kind)&&Object.prototype.hasOwnProperty.call((JSON.parse(context.build.budgetLedgerJson) as {tasks?:object}).tasks??{},task.taskKey))throw new Error('[avg-review] 评审已被执行消费；修订须新建 Build')
  if (!readOnly && context.brief.avgVisualPlanning && ['avg-author-rules', 'avg-author-script'].includes(task.kind)
    && Object.keys((JSON.parse(context.build.budgetLedgerJson) as { tasks?: object }).tasks ?? {}).length) throw new Error('[avg-visual-plan] 正式来源已进入生产，规则或脚本修订须新建 Build')
  if (!readOnly && context.brief.avgVisualPlanning && ['avg-author-visual-bible', 'avg-author-media-brief'].includes(task.kind)) {
    const ledger = (JSON.parse(context.build.budgetLedgerJson) as { tasks?: Record<string, unknown> }).tasks ?? {}
    if (context.plan.tasks.some(t => t.executionMode !== 'human-import' && t.inputArtifactKeys.includes(artifactKey) && ledger[t.taskKey])) throw new Error('[avg-visual-plan] 视觉方案已被下游执行消费；修订须新建 Build')
  }
  if (context.brief.avgAssembly && context.brief.avgAssembly.version !== 1
    && !['avg-author-media-choice', 'avg-author-stage','avg-author-visual-review','avg-author-voice-review','avg-author-voice-choice'].includes(task.kind)
    && Object.keys((JSON.parse(context.build.budgetLedgerJson) as { tasks?: object }).tasks ?? {}).length) {
    throw new Error('[avg-media] 媒资来源已进入执行，规则或文本修订须新建 Build')
  }
  return task
}

function assertSourceReferences(context: Awaited<ReturnType<typeof authority>>, payload: AuthorPayload) {
  const expected = context.brief.avgAssembly ?? context.brief.avgVisualPlanning?.assembly
  if (expected) {
    const same = (a: string[], b: string[]) => canonicalProductProductionJsonV2([...a].sort()) === canonicalProductProductionJsonV2([...b].sort())
    if (payload.schema === 'storyforge.avg.system-plan' && !same(expected.sceneKeys, payload.scenes.map(scene => scene.key))
      || payload.schema === 'storyforge.avg.author-stage' && !same(expected.mediaAssetKeys, payload.stage.assets.map(asset => asset.assetKey))) throw new Error('[avg] 场景或媒资目录超出冻结 Brief；请创建新 Build')
  }
  const references = payload.schema === 'storyforge.avg.source-audit' ? payload.facts.flatMap(fact => fact.resourceKeys)
    : payload.schema === 'storyforge.avg.cast-bible' ? payload.characters.flatMap(character => character.sourceResourceKey ? [character.sourceResourceKey] : []) : []
  const frozen = new Set(context.sourcePlan.initialResourceKeys)
  if (references.some(key => !frozen.has(key))) throw new Error('[avg] 作者来源引用不在冻结初始资源中；新增读取需专业来源包的实际 manifest')
}

async function validateVisualReviewInput(context:Awaited<ReturnType<typeof authority>>,scope:WorkspaceScope,payload:AuthorPayload,inputs:ProductBuildArtifactRecordV1[]){
  if(payload.schema!=='storyforge.avg.review-issues'||!context.brief.avgAssembly&&!context.brief.avgVisualPlanning)return
  if (payload.audioEvidence || inputs.some(row => row.artifactKey.startsWith('avg.voice.raw.'))) {
    if (inputs.length !== 1 || inputs[0]!.artifactKey !== `avg.voice.raw.${payload.targetKey}`) throw new Error('[avg-voice] 审听缺少准确的原始音频依赖')
    const voice = await readVoiceDefinition(context)
    const selected = await readAvgRawVoiceSourceV1({ scope, buildId: context.build.id!, ...voice, raw: ref(inputs[0]!) })
    assertAvgVoiceReviewScopeV1(payload, selected.payload)
    return
  }
  const processed=readAvgOptionalImageDefinitionV3(context.brief)?.imageProcessing?.entries.some(e=>e.requirementKey===payload.targetKey)
  if(inputs.length!==(processed?2:1)||inputs[0].artifactKey!==`avg.media.raw.${payload.targetKey}`)throw new Error('[avg-review] 评审缺少准确原图依赖')
  await validateAvgAuthorVisualReviewV1({scope,brief:context.brief,raw:inputs[0],payload,...(processed?{processed:inputs[1]}:{})})
}

async function readVoiceDefinition(context: Awaited<ReturnType<typeof authority>>) {
  const stored = context.brief.avgAssembly
  if (stored?.version !== 3) throw new Error('[avg-voice] 作者配音输入必须属于准确的 V3 冻结合同')
  const parse = () => assertAvgStoredAssemblyBriefV3(stored)
  const resolved = Dexie.currentTransaction ? await Dexie.waitFor(Dexie.ignoreTransaction(parse), 20_000) : await parse()
  const capability = context.brief.capabilityRequirements.find(c => c.requirementKey === AVG_VOICE_CAPABILITY_REQUIREMENT_KEY_V1)
  if (!capability) throw new Error('[avg-voice] 冻结合同缺少准确配音能力')
  return { assembly: resolved.assembly, capability }
}

async function readChoiceVoiceReview(context: Awaited<ReturnType<typeof authority>>, scope: WorkspaceScope,
  choice: AvgAuthorVoiceChoiceV1, selected: Awaited<ReturnType<typeof readAvgChosenVoiceSourceV1>>, epoch = context.build.controlEpoch) {
  const key = avgVoiceReviewArtifactKeyV1(choice.requirementKey)
  const [row] = await acceptedInputs(scope, context.build.id!, epoch, [key])
  const task = context.plan.tasks.find(t => t.taskKey === `avg.author.voice-review.${choice.requirementKey}`)
  if (!task || task.kind !== 'avg-author-voice-review' || task.executionMode !== 'human-import' || task.skillId !== null
    || row.kind !== 'quality-report' || canonicalProductProductionJsonV2(task.outputArtifactKeys) !== canonicalProductProductionJsonV2([key])
    || canonicalProductProductionJsonV2(task.inputArtifactKeys) !== canonicalProductProductionJsonV2([selected.raw.artifactKey])
    || canonicalProductProductionJsonV2(choice.review) !== canonicalProductProductionJsonV2(ref(row))) {
    throw new Error('[avg-voice] 选择未绑定准确且已采用的审听任务或版本')
  }
  await assertFrozenAuthorCandidateV1(context, row, task, [selected.raw], epoch)
  const report = assertAvgVoiceReviewSelectableV1(row.payloadJson, selected.payload)
  return { row, payload: report, artifact: ref(row), authorReceiptHash: String(JSON.parse(row.metadataJson).receiptHash) }
}

async function validateVoiceChoice(context: Awaited<ReturnType<typeof authority>>, scope: WorkspaceScope, payload: AuthorPayload) {
  if (payload.schema !== 'storyforge.avg.voice-choice') return undefined
  const voice = await readVoiceDefinition(context)
  const selected = await readAvgChosenVoiceSourceV1({ scope, buildId: context.build.id!, ...voice, choice: payload })
  await readChoiceVoiceReview(context, scope, payload, selected)
  return selected.validation
}

function assertReviewRevision(previous: string | null, payload: AuthorPayload) {
  if (payload.schema !== 'storyforge.avg.review-issues') return
  if (payload.audioEvidence) assertAvgVoiceReviewRevisionV1(previous, payload)
  else assertAvgVisualReviewRevisionV1(previous, payload)
}

/** Reused by current staging/adoption/compiler and the read-only old-image
 * verifier. The caller supplies a proved raw row for its exact epoch. */
async function readChoiceVisualReview(context:Awaited<ReturnType<typeof authority>>,scope:WorkspaceScope,choice:AvgAuthorMediaChoice,raw:ProductBuildArtifactRecordV1,epoch=context.build.controlEpoch,processed?:ProductBuildArtifactRecordV1){
  const a=context.brief.avgVisualPlanning||readAvgOptionalImageDefinitionV3(context.brief)
    ?await readAvgImageConsumptionDefinitionV4({scope,buildId:context.build.id!,brief:context.brief}):null
  if(!a?.mediaBatch.visualReviewPolicy)return undefined
  const key=avgVisualReviewArtifactKeyV1(choice.requirementKey),[row]=await acceptedInputs(scope,context.build.id!,epoch,[key])
  const task=context.plan.tasks.find(task=>task.taskKey===`avg.author.visual-review.${choice.requirementKey}`)
  if(!task||task.kind!=='avg-author-visual-review'||task.executionMode!=='human-import'||task.skillId!==null||row.kind!=='quality-report'
    ||canonicalProductProductionJsonV2(task.outputArtifactKeys)!==canonicalProductProductionJsonV2([key])
    ||canonicalProductProductionJsonV2(task.inputArtifactKeys)!==canonicalProductProductionJsonV2([raw.artifactKey,...(processed?[processed.artifactKey]:[])]))throw new Error('[avg-review] 评审任务与原图不在准确冻结输入域')
  await assertFrozenAuthorCandidateV1(context,row,task,[raw,...(processed?[processed]:[])],epoch)
  const report=await validateAvgAuthorVisualReviewV1({scope,brief:context.brief,raw,payload:row.payloadJson,processed})
  const r=a.mediaBatch.requirements.find(r=>r.requirementKey===choice.requirementKey)!
  assertAvgVisualReviewSelectableV1(report,r,(processed??raw).contentHash)
  return {row,payload:report,artifact:ref(row),authorReceiptHash:String(JSON.parse(row.metadataJson).receiptHash)}
}

function candidateBody(context: Awaited<ReturnType<typeof authority>>, input: {
  taskKey: string; artifactKey: string; kind: ProductBuildArtifactRecordV1['kind']; payloadHash: string
  base: Ref | null; inputs: Ref[]; declaration: string; systemValidation?: AvgSystemValidationV1; assemblyValidation?: AvgAssemblyValidationV1; mediaChoiceValidation?: AvgMediaChoiceValidation; voiceChoiceValidation?: AvgVoiceChoiceValidationV1; visualProposalValidation?: AvgVisualProposalValidationV4
}): AuthorCandidateBody {
  const { systemValidation, assemblyValidation, mediaChoiceValidation, voiceChoiceValidation, visualProposalValidation, ...payload } = input
  const base: AuthorCandidateBase = { schema: 'storyforge.avg.author-candidate', origin: visualProposalValidation?.reuseSourceHash?'history-reuse':visualProposalValidation ? 'model-proposal' : 'author-import',
    productionKey: context.production.productionKey, buildNumber: context.build.buildNumber,
    briefRevision: context.build.briefRevision, briefHash: context.build.briefHash,
    confirmedBriefHash: context.briefRow.confirmedBriefHash, sourcePlanHash: context.briefRow.sourcePlanHash,
    planRevision: context.build.planRevision, planHash: context.build.planHash, controlEpoch: context.build.controlEpoch,
    ...payload }
  return visualProposalValidation ? { ...base, version: visualProposalValidation.reuseSourceHash?7:6, visualProposalValidation } : voiceChoiceValidation ? { ...base, version: 5, voiceChoiceValidation } : mediaChoiceValidation ? { ...base, version: 4, mediaChoiceValidation } : assemblyValidation ? { ...base, version: 3, assemblyValidation } : systemValidation ? { ...base, version: 2, systemValidation } : { ...base, version: 1 }
}

async function validateVisualProposal(context: Awaited<ReturnType<typeof authority>>, payload: AuthorPayload, artifactKey: string, inputs: ProductBuildArtifactRecordV1[]) {
  if (!context.brief.avgVisualPlanning || !['storyforge.avg.visual-bible', 'storyforge.avg.media-brief'].includes(payload.schema)) return undefined
  const scope = context.brief.avgVisualPlanning.scope, originals = inputs.filter(r => r.artifactKey.startsWith('avg.proposal.'))
  if (originals.length !== 1) throw new Error('[avg-visual-plan] 作者采用必须绑定唯一实际原始方案')
  const original = originals[0], task = context.plan.tasks.find(t => t.outputArtifactKeys.includes(original.artifactKey))
  if (!task || original.producerRunId === null || original.producerReceiptHash === null) throw new Error('[avg-visual-plan] 原始方案缺少准确 producer')
  const proposal = await assertAvgVisualRoleProposalV4(original.payloadJson, task, scope)
  if (proposal.targetArtifactKey !== artifactKey) throw new Error('[avg-visual-plan] 作者候选不能借用其他岗位或主体方案')
  validateAvgVisualSemanticV4(payload, scope, artifactKey)
  const modelPayload=proposal.version===2?proposal.modelPayload:proposal.payload
  const evidence=proposal.version===2?await readAvgVisualProposalEvidenceV4(context.scope,original,context.reusePath):null
  if(proposal.version===2&&!evidence?.reused)throw new Error('[avg-visual-reuse] 当前作者候选缺少准确复用证据')
  return { proposal: ref(original), scopeHash: proposal.scopeHash, originalPayloadHash: await hash(modelPayload),
    authorEdited: canonicalProductProductionJsonV2(payload) !== canonicalProductProductionJsonV2(modelPayload),
    ...(evidence?.reused?{reuseSourceHash:await hash(evidence.source)}:{}) }
}

/** Stores only a pending candidate, never an author receipt or accepted content.
 * The frozen human-import task supplies the complete output/input domain. */
export async function stageAvgAuthorArtifactV1(input: {
  scope: WorkspaceScope; buildId: number; expectedBuildRevision: number; controlEpoch: number
  taskKey: string; artifactKey: string; kind: ProductBuildArtifactRecordV1['kind']; payload: unknown; declaration: string
}) {
  const scope = await resolveScope({ scope: input.scope })
  const taskKey = avgKey(input.taskKey, 'taskKey'); const artifactKey = avgKey(input.artifactKey, 'artifactKey')
  const declaration = avgText(input.declaration, 'author declaration', 2000)
  const prepared = prepareAuthorInput({ ...input, artifactKey, allowedOutputKeys: [artifactKey] })
  const systemValidation = prepared.payload.schema === 'storyforge.avg.system-plan'
    ? await validateSystem(prepared.payload) : undefined
  const proofTables = await mediaProofTables(input.buildId,prepared.payload.schema==='storyforge.avg.author-stage'
    && (!!prepared.payload.inheritedImages?.length || !!prepared.payload.inheritedVoices?.length))
  return db.transaction('rw', scopeTransactionTables(db.productProductions, db.productProductionBriefs, db.productProductionCommands, db.productBuilds, db.productBuildArtifacts, db.avgDraftMedia, db.mediaBlobObjects,
    ...proofTables), async () => {
    const context = await authority(scope, input.buildId)
    if (context.build.stateRevision !== input.expectedBuildRevision || context.build.controlEpoch !== input.controlEpoch) throw new Error('[avg] Build revision/epoch 已 stale')
    const task = authorTask(context, taskKey, artifactKey)
    assertSourceReferences(context, prepared.payload)
    const inputs = await acceptedInputs(scope, input.buildId, input.controlEpoch, task.inputArtifactKeys)
    await validateVisualReviewInput(context,scope,prepared.payload,inputs)
    if(prepared.payload.schema==='storyforge.avg.media-choice')await readChoiceVisualReview(context,scope,prepared.payload,inputs[0],context.build.controlEpoch,prepared.payload.version===2?inputs[1]:undefined)
    const rows = await db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray()
    const bases = rows.filter(row => row.artifactKey === artifactKey && row.status === 'accepted')
    if (bases.length > 1) throw new Error('[avg] 正式 revision 不唯一')
    if(context.brief.avgAssembly||context.brief.avgVisualPlanning)assertReviewRevision(bases[0]?.payloadJson??null,prepared.payload)
    const base = bases[0] ? ref(bases[0]) : null
    if (bases[0]) await acceptedInputs(scope, input.buildId, input.controlEpoch, [artifactKey])
    if (prepared.payload.schema === 'storyforge.avg.dialogue-patch') {
      const scriptKey = `avg.content.scene-script.${prepared.payload.sceneKey}`
      const script = inputs.find(row => row.artifactKey === scriptKey)
      if (!script) throw new Error('[avg] 表达补丁缺少冻结的正式脚本输入')
      await applyAvgDialoguePatchV1(script.payloadJson, prepared.payload)
    }
    const assemblyValidation = await validateAssembly(context, scope, prepared.payload, inputs)
    const mediaChoiceValidation = prepared.payload.schema === 'storyforge.avg.media-choice'
      ? await validateAvgMediaChoiceV1({ scope, buildId: input.buildId, brief: context.brief, choice: prepared.payload }) : undefined
    const voiceChoiceValidation = await validateVoiceChoice(context, scope, prepared.payload)
    const visualProposalValidation = await validateVisualProposal(context, prepared.payload, artifactKey, inputs)
    const contentHash = await hash(prepared.payload)
    const body = candidateBody(context, { taskKey, artifactKey, kind: input.kind, payloadHash: contentHash,
      base, inputs: inputs.map(ref), declaration, systemValidation, assemblyValidation, mediaChoiceValidation, voiceChoiceValidation, visualProposalValidation })
    const candidateHash = await hash(body)
    const metadataJson = canonicalProductProductionJsonV2({ ...body, candidateHash } satisfies AuthorCandidate)
    const existing = rows.find(row => row.artifactKey === artifactKey && row.status === 'pending' && row.metadataJson === metadataJson)
    if (existing) {
      if (!await assertRecordInScope(scope, 'productBuildArtifacts', existing, { owner: 'work' })
        || existing.payloadJson !== prepared.payloadJson || existing.contentHash !== contentHash) throw new Error('[avg] 已有候选被篡改或跨 Work')
      return existing
    }
    const now = Date.now()
    const row = stampNewRecord(scope, 'productBuildArtifacts', {
      ...scope, buildId: input.buildId, artifactKey, requirementKey: null,
      version: Math.max(0, ...rows.filter(row => row.artifactKey === artifactKey).map(row => row.version)) + 1,
      kind: input.kind, mediaKind: null, status: 'pending' as const, producerRunId: null, producerReceiptHash: null,
      controlEpoch: input.controlEpoch, inputHash: await hash({ ...body, payloadHash: null }), contentHash,
      payloadJson: prepared.payloadJson, metadataJson, qualityJson: '{}', rightsJson: canonicalProductProductionJsonV2({ origin: body.origin, declaration }),
      blobObjectId: null, mimeType: null, byteSize: new TextEncoder().encode(prepared.payloadJson).byteLength,
      parentArtifactHash: base?.contentHash ?? null, carriedFrom: null, createdAt: now, updatedAt: now,
    } satisfies ProductBuildArtifactRecordV1, { owner: 'work' })
    const id = await db.productBuildArtifacts.add(row) as number
    return { ...row, id }
  })
}

async function prepareAdoption(scope: WorkspaceScope, production: ProductProductionRecordV1 & { id: number }, command: AdoptCommand) {
  const build = await db.productBuilds.where('[productionId+buildNumber]').equals([production.id, command.buildNumber]).first()
  if (!build?.id) throw new Error('[avg] Build 不存在')
  const context = await authority(scope, build.id)
  if (context.production.id !== production.id || context.production.stateRevision !== command.expectedStateRevision) throw new Error('[avg] Production revision 已 stale')
  if (build.stateRevision !== command.expectedBuildRevision || build.controlEpoch !== command.controlEpoch) throw new Error('[avg] Build revision/epoch 已 stale')
  const rows = await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
  const candidate = rows.find(row => row.artifactKey === command.artifactKey && row.version === command.candidateVersion)
  if (!candidate?.id || candidate.status !== 'pending' || !await assertRecordInScope(scope, 'productBuildArtifacts', candidate, { owner: 'work' })
    || candidate.controlEpoch !== command.controlEpoch || candidate.producerRunId !== null || candidate.producerReceiptHash !== null
    || candidate.blobObjectId !== null || candidate.mediaKind !== null || candidate.mimeType !== null) throw new Error('[avg] 不是可采用的作者候选')
  const envelope = JSON.parse(candidate.metadataJson) as AuthorCandidate
  const task = authorTask(context, envelope.taskKey, command.artifactKey)
  const prepared = prepareAuthorInput({ artifactKey: candidate.artifactKey, kind: candidate.kind,
    payload: candidate.payloadJson, allowedOutputKeys: task.outputArtifactKeys })
  const systemValidation = prepared.payload.schema === 'storyforge.avg.system-plan'
    ? await validateSystem(prepared.payload) : undefined
  assertSourceReferences(context, prepared.payload)
  const inputs = await acceptedInputs(scope, build.id, command.controlEpoch, task.inputArtifactKeys)
  await validateVisualReviewInput(context,scope,prepared.payload,inputs)
  if(prepared.payload.schema==='storyforge.avg.media-choice')await readChoiceVisualReview(context,scope,prepared.payload,inputs[0],context.build.controlEpoch,prepared.payload.version===2?inputs[1]:undefined)
  const bases = rows.filter(row => row.artifactKey === candidate.artifactKey && row.status === 'accepted')
  if (bases.length > 1) throw new Error('[avg] 正式 revision 不唯一')
  if(context.brief.avgAssembly||context.brief.avgVisualPlanning)assertReviewRevision(bases[0]?.payloadJson??null,prepared.payload)
  if (bases[0]) await acceptedInputs(scope, build.id, command.controlEpoch, [candidate.artifactKey])
  const assemblyValidation = await validateAssembly(context, scope, prepared.payload, inputs)
  const mediaChoiceValidation = prepared.payload.schema === 'storyforge.avg.media-choice'
    ? await validateAvgMediaChoiceV1({ scope, buildId: build.id, brief: context.brief, choice: prepared.payload }) : undefined
  const voiceChoiceValidation = await validateVoiceChoice(context, scope, prepared.payload)
  const visualProposalValidation = await validateVisualProposal(context, prepared.payload, candidate.artifactKey, inputs)
  const body = candidateBody(context, { taskKey: task.taskKey, artifactKey: candidate.artifactKey, kind: candidate.kind,
    payloadHash: await hash(prepared.payload), base: bases[0] ? ref(bases[0]) : null, inputs: inputs.map(ref),
    declaration: avgText(envelope.declaration, 'author declaration', 2000), systemValidation, assemblyValidation, mediaChoiceValidation, voiceChoiceValidation, visualProposalValidation })
  const candidateHash = await hash(body)
  if (candidateHash !== command.candidateHash || envelope.candidateHash !== candidateHash
    || canonicalProductProductionJsonV2({ ...body, candidateHash }) !== candidate.metadataJson
    || prepared.payloadJson !== candidate.payloadJson || body.payloadHash !== candidate.contentHash
    || candidate.inputHash !== await hash({ ...body, payloadHash: null })
    || candidate.byteSize !== new TextEncoder().encode(prepared.payloadJson).byteLength
    || candidate.parentArtifactHash !== (body.base?.contentHash ?? null)
    || candidate.qualityJson !== '{}' || candidate.carriedFrom !== null
    || candidate.rightsJson !== canonicalProductProductionJsonV2({ origin: body.origin, declaration: body.declaration })) throw new Error('[avg] 候选、来源、写域或正式基线已 stale/篡改')
  let derived: { base: ProductBuildArtifactRecordV1; payloadJson: string; contentHash: string; version: number } | null = null
  if (prepared.payload.schema === 'storyforge.avg.dialogue-patch') {
    const scriptKey = `avg.content.scene-script.${prepared.payload.sceneKey}`
    const script = inputs.find(row => row.artifactKey === scriptKey)
    if (!script) throw new Error('[avg] 表达补丁缺少正式脚本')
    const patched = await applyAvgDialoguePatchV1(script.payloadJson, prepared.payload)
    derived = { base: script, payloadJson: canonicalProductProductionJsonV2(patched.script), contentHash: patched.scriptHash,
      version: Math.max(...rows.filter(row => row.artifactKey === scriptKey).map(row => row.version)) + 1 }
  }
  // Validate all affected metadata before the first write. Only new typed
  // author candidates have this closure; legacy artifacts retain their policy.
  const identity = (value: Ref) => `${value.artifactKey}:${value.version}:${value.contentHash}`
  const replaced = new Set([...(bases[0] ? [identity(ref(bases[0]))] : []), ...(derived ? [identity(ref(derived.base))] : [])])
  const invalidated = new Set<number>()
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (row.status !== 'accepted' || row.id === candidate.id || !row.id || invalidated.has(row.id)
        || !row.artifactKey.startsWith('avg.')) continue
      const metadata = JSON.parse(row.metadataJson) as { schema?: string; candidate?: AuthorCandidate; inputs?: Ref[]; derivedScript?: Ref | null }
      if (!metadata || typeof metadata !== 'object') continue
      const source = metadata.schema === 'storyforge.avg.author-adoption' ? metadata.candidate : metadata
      if (replaced.has(identity(ref(row))) || source?.schema === 'storyforge.avg.author-candidate'
        && (source.inputs?.some(input => replaced.has(identity(input)))
          || metadata.derivedScript && replaced.has(identity(metadata.derivedScript)))) {
        invalidated.add(row.id); replaced.add(identity(ref(row))); changed = true
      }
    }
  }
  return { context, candidate, body: { ...body, candidateHash } as AuthorCandidate, derived, invalidated: [...invalidated] }
}

async function assertFrozenAuthorCandidateV1(context: Awaited<ReturnType<typeof authority>>, row: ProductBuildArtifactRecordV1,
  task: typeof context.plan.tasks[number], upstream: ProductBuildArtifactRecordV1[], epoch: number) {
  const envelope = JSON.parse(row.metadataJson) as { candidate: AuthorCandidate }
  const { candidateHash, ...body } = envelope.candidate
  if (row.producerRunId !== null || row.producerReceiptHash !== null || row.carriedFrom !== null
    || body.schema !== 'storyforge.avg.author-candidate' || body.origin !== (body.version === 7?'history-reuse':body.version === 6 ? 'model-proposal' : 'author-import')
    || body.productionKey !== context.production.productionKey || body.buildNumber !== context.build.buildNumber
    || body.briefRevision !== context.build.briefRevision || body.briefHash !== context.build.briefHash
    || body.confirmedBriefHash !== context.briefRow.confirmedBriefHash || body.sourcePlanHash !== context.briefRow.sourcePlanHash
    || body.planRevision !== context.build.planRevision || body.planHash !== context.build.planHash || body.controlEpoch !== epoch
    || body.taskKey !== task.taskKey || body.artifactKey !== row.artifactKey || body.kind !== row.kind
    || body.payloadHash !== row.contentHash || candidateHash !== await hash(body)
    || row.inputHash !== await hash({ ...body, payloadHash: null })
    || row.parentArtifactHash !== (body.base?.contentHash ?? null)
    || canonicalProductProductionJsonV2(body.inputs) !== canonicalProductProductionJsonV2(upstream.map(ref))) throw new Error(`[avg] 冻结作者输入来源/候选不闭合:${task.taskKey}`)
  const validation = context.brief.avgVisualPlanning && ['avg-author-visual-bible', 'avg-author-media-brief'].includes(task.kind)
    ? await validateVisualProposal(context, parseAvgProfessionalArtifactV1(row.payloadJson), row.artifactKey, upstream) : undefined
  if ([6,7].includes(body.version) !== !!validation || validation && (!('visualProposalValidation' in body)
    ||body.version!==(validation.reuseSourceHash?7:6)||canonicalProductProductionJsonV2(body.visualProposalValidation) !== canonicalProductProductionJsonV2(validation))) throw new Error('[avg-visual-plan] 模型来源或作者修订证据不一致')
  return envelope.candidate
}

/** Only a current, confirmed rule revision can enter formal Build compilation.
 * Pure engineering previews remain available without this persistence receipt. */
async function readAuthorInputs(input: {
  scope: WorkspaceScope; buildId: number; expectedBuildRevision: number; controlEpoch: number; includeSceneScripts?: boolean; includeAuthorStage?: boolean; includeMediaChoices?: boolean; includeVoiceChoices?: boolean
}, frozenVerification = false) {
  const scope = await resolveScope({ scope: input.scope })
  const proofTables = await mediaProofTables(input.buildId,!!input.includeAuthorStage)
  return db.transaction('r', scopeTransactionTables(db.productProductions, db.productProductionBriefs, db.productProductionCommands, db.productBuilds, db.productBuildArtifacts, db.avgDraftMedia, db.mediaBlobObjects,
    ...proofTables), async () => {
    const context = await authority(scope, input.buildId, true, frozenVerification)
    if (context.build.stateRevision !== input.expectedBuildRevision || context.build.controlEpoch !== input.controlEpoch) throw new Error('[avg] 规则编译 Build revision/epoch 已 stale')
    if (frozenVerification) {
      for (const task of context.plan.tasks.filter(task => task.executionMode === 'human-import')) {
        const [row] = await acceptedInputs(scope, input.buildId, input.controlEpoch, task.outputArtifactKeys)
        const upstream = await acceptedInputs(scope, input.buildId, input.controlEpoch, task.inputArtifactKeys)
        await assertFrozenAuthorCandidateV1(context, row, task, upstream, input.controlEpoch)
      }
    }
    const [artifact] = await acceptedInputs(scope, input.buildId, input.controlEpoch, ['avg.system.plan'])
    const prepared = prepareAuthorInput({ artifactKey: artifact.artifactKey, kind: artifact.kind, payload: artifact.payloadJson, allowedOutputKeys: ['avg.system.plan'] })
    if (prepared.payload.schema !== 'storyforge.avg.system-plan') throw new Error('[avg] 不是正式系统规则')
    const validation = await validateSystem(prepared.payload)
    const receipt = JSON.parse(artifact.metadataJson) as { candidate: AuthorCandidate; receiptHash: string }
    if (receipt.candidate.version !== 2 || canonicalProductProductionJsonV2(receipt.candidate.systemValidation) !== canonicalProductProductionJsonV2(validation)) throw new Error('[avg] 规则编译证据缺失、版本不匹配或已 stale')
    const scriptKeys = input.includeSceneScripts || input.includeAuthorStage || input.includeMediaChoices || input.includeVoiceChoices ? prepared.payload.scenes.map(scene => `avg.content.scene-script.${scene.key}`) : []
    const scriptRows = await acceptedInputs(scope, input.buildId, input.controlEpoch, scriptKeys)
    const scripts = scriptRows.map(row => {
      const parsed = prepareAvgProfessionalArtifactV1({ artifactKey: row.artifactKey, kind: row.kind, payload: row.payloadJson, allowedOutputKeys: scriptKeys }).payload
      const scriptReceipt = JSON.parse(row.metadataJson) as { candidate: AuthorCandidate; receiptHash: string }
      if (parsed.schema !== 'storyforge.avg.scene-script' || !scriptReceipt.candidate.inputs.some(source => source.artifactKey === artifact.artifactKey && source.version === artifact.version && source.contentHash === artifact.contentHash)) throw new Error('[avg] 脚本缺少当前正式规则依赖')
      return { payload: parsed, artifact: ref(row), authorReceiptHash: scriptReceipt.receiptHash }
    })
    const mediaChoices: Array<{ payload: AvgAuthorMediaChoice; artifact: Ref; authorReceiptHash: string; raw: ProductBuildArtifactRecordV1;image:ProductBuildArtifactRecordV1;processed?:NonNullable<Awaited<ReturnType<typeof readAvgChosenMediaSourceV2>>>['processed'];review?:NonNullable<Awaited<ReturnType<typeof readChoiceVisualReview>>> }> = []
    // Resolve V4 only for image consumption. Source/visual compilation reads
    // must not recursively ask for the compilation artifact they are proving.
    const image = context.brief.avgVisualPlanning
      ? (input.includeAuthorStage||input.includeMediaChoices
        ?await readAvgImageConsumptionDefinitionV4({scope,buildId:input.buildId,brief:context.brief}):null)
      :readAvgOptionalImageDefinitionV3(context.brief)
    if ((input.includeAuthorStage || input.includeMediaChoices) && image) {
      const keys = image.mediaBatch.requirements.map(r => avgMediaChoiceArtifactKeyV1(r.requirementKey))
      const rows = await acceptedInputs(scope, input.buildId, input.controlEpoch, keys)
      for (const row of rows) {
        const payload = parseAvgAuthorMediaChoice(row.payloadJson)
        const selected = await readAvgChosenMediaSourceV2({ scope, buildId: input.buildId, brief: context.brief, choice: payload })
        const review=await readChoiceVisualReview(context,scope,payload,selected.raw,input.controlEpoch,selected.processed?.row)
        const receipt = JSON.parse(row.metadataJson) as { candidate: AuthorCandidate; receiptHash: string }
        if (receipt.candidate.version !== 4 || canonicalProductProductionJsonV2(receipt.candidate.mediaChoiceValidation) !== canonicalProductProductionJsonV2(selected.validation)) throw new Error('[avg-media] 作者选择解码证据已 stale')
        const task=context.plan.tasks.find(task=>task.taskKey===`avg.author.media.${payload.requirementKey}`)!
        await assertFrozenAuthorCandidateV1(context,row,task,[selected.raw,...(selected.processed?[selected.processed.row]:[]),...(review?[review.row]:[])],input.controlEpoch)
        mediaChoices.push({ payload, artifact: ref(row), authorReceiptHash: receipt.receiptHash, raw: selected.raw,image:selected.image,processed:selected.processed,...(review?{review}:{}) })
      }
    }
    const voiceChoices: Array<{ payload: AvgAuthorVoiceChoiceV1; artifact: Ref; authorReceiptHash: string;
      raw: ProductBuildArtifactRecordV1; blobObjectId: number; validation: AvgVoiceChoiceValidationV1;
      review: Awaited<ReturnType<typeof readChoiceVoiceReview>> }> = []
    if ((input.includeAuthorStage || input.includeVoiceChoices) && context.brief.avgAssembly?.version === 3) {
      const voice = await readVoiceDefinition(context)
      const rows = await acceptedInputs(scope, input.buildId, input.controlEpoch,
        voice.assembly.voice.batch.requirements.map(r => avgVoiceChoiceArtifactKeyV1(r.requirementKey)))
      for (const row of rows) {
        const payload = parseAvgAuthorVoiceChoiceV1(row.payloadJson)
        const selected = await readAvgChosenVoiceSourceV1({ scope, buildId: input.buildId, ...voice, choice: payload })
        const review = await readChoiceVoiceReview(context, scope, payload, selected)
        const task = context.plan.tasks.find(task => task.taskKey === `avg.author.voice-choice.${payload.requirementKey}`)
        if (!task || task.kind !== 'avg-author-voice-choice') throw new Error('[avg-voice] 已采用配音缺少准确选择任务')
        const candidate = await assertFrozenAuthorCandidateV1(context, row, task, [selected.raw, review.row], input.controlEpoch)
        if (candidate.version !== 5 || canonicalProductProductionJsonV2(candidate.voiceChoiceValidation) !== canonicalProductProductionJsonV2(selected.validation)) throw new Error('[avg-voice] 已采用配音的来源或测量已 stale')
        voiceChoices.push({ payload, artifact: ref(row), authorReceiptHash: String(JSON.parse(row.metadataJson).receiptHash),
          raw: selected.raw, blobObjectId: selected.blobObjectId, validation: selected.validation, review })
      }
    }
    let authorStage: { payload: AvgAuthorStageV1; artifact: Ref; authorReceiptHash: string; validation: AvgAssemblyValidationV1 } | null = null
    if (input.includeAuthorStage) {
      const [stageRow] = await acceptedInputs(scope, input.buildId, input.controlEpoch, ['avg.author.stage'])
      const payload = parseAvgAuthorStageV1(stageRow.payloadJson)
      const stageReceipt = JSON.parse(stageRow.metadataJson) as { candidate: AuthorCandidate; receiptHash: string }
      const upstream = [...[artifact, ...scriptRows].map(ref), ...mediaChoices.map(choice => choice.artifact), ...voiceChoices.map(choice => choice.artifact)]
      if (canonicalProductProductionJsonV2([...stageReceipt.candidate.inputs].sort((a,b) => a.artifactKey.localeCompare(b.artifactKey))) !== canonicalProductProductionJsonV2(upstream.sort((a,b) => a.artifactKey.localeCompare(b.artifactKey)))) throw new Error('[avg] 作者演出未绑定当前规则及全部脚本')
      const choiceRows = mediaChoices.length ? await acceptedInputs(scope, input.buildId, input.controlEpoch, mediaChoices.map(row => row.artifact.artifactKey)) : []
      const voiceRows = voiceChoices.length ? await acceptedInputs(scope, input.buildId, input.controlEpoch, voiceChoices.map(row => row.artifact.artifactKey)) : []
      const validation = await validateAssembly(context, scope, payload, [artifact, ...scriptRows, ...choiceRows, ...voiceRows])
      if (!validation || stageReceipt.candidate.version !== 3
        || canonicalProductProductionJsonV2(stageReceipt.candidate.assemblyValidation) !== canonicalProductProductionJsonV2(validation)) throw new Error('[avg] 作者演出组装证据缺失或 stale')
      authorStage = { payload, artifact: ref(stageRow), authorReceiptHash: stageReceipt.receiptHash, validation }
    }
    return { plan: prepared.payload, artifact: ref(artifact), validation, authorReceiptHash: receipt.receiptHash, scripts, ...(input.includeAuthorStage ? { authorStage } : {}),
      ...(image ? { mediaChoices } : {}),
      ...(context.brief.avgAssembly?.version === 3 ? { voiceChoices } : {}),
      sourceWorld: { contentHash: context.brief.source.worldContentHash, selection: context.brief.source.selection },
      build: { productionKey: context.production.productionKey, buildNumber: context.build.buildNumber, stateRevision: context.build.stateRevision, controlEpoch: context.build.controlEpoch, planRevision: context.build.planRevision, planHash: context.build.planHash } }
  })
}

export function readAvgSystemPlanForCompilationV1(input: Parameters<typeof readAuthorInputs>[0]) {
  return readAuthorInputs(input)
}

/** Frozen source verification only; author mutation retains authority(false).
 * No stage/choice recursion while proving the compiled visual definition. */
export function readAvgFrozenVisualSourceInputsV4(input: Pick<Parameters<typeof readAuthorInputs>[0], 'scope'|'buildId'|'expectedBuildRevision'|'controlEpoch'>) {
  return readAuthorInputs({...input,includeSceneScripts:true},true)
}

/** Planning reads canonical direction only after the existing author command,
 * frozen candidate and exact raw-proposal producer have all been verified. */
export async function readAvgConfirmedVisualArtifactsV4(input: Pick<Parameters<typeof readAuthorInputs>[0], 'scope' | 'buildId' | 'expectedBuildRevision' | 'controlEpoch'> & { artifactKeys: string[] }, frozenVerification = false) {
  const scope = await resolveScope({ scope: input.scope })
  return db.transaction('r', scopeTransactionTables(db.productProductions, db.productProductionBriefs, db.productProductionCommands,
    db.productBuilds, db.productBuildArtifacts, db.avgDraftMedia, db.mediaBlobObjects, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, db.agentRunArtifacts), async () => {
    const context = await authority(scope, input.buildId, true, frozenVerification)
    if (!context.brief.avgVisualPlanning || context.build.stateRevision !== input.expectedBuildRevision || context.build.controlEpoch !== input.controlEpoch
      || new Set(input.artifactKeys).size !== input.artifactKeys.length) throw new Error('[avg-visual-plan] 视觉方案来源或 Build 已 stale')
    const result = []
    for (const key of input.artifactKeys) {
      const task = context.plan.tasks.find(t => ['avg-author-visual-bible', 'avg-author-media-brief'].includes(t.kind) && t.outputArtifactKeys[0] === key)
      if (!task) throw new Error('[avg-visual-plan] 读取超出准确作者视觉工件域')
      authorTask(context, task.taskKey, key, true)
      const [row] = await acceptedInputs(scope, input.buildId, input.controlEpoch, [key])
      const upstream = await acceptedInputs(scope, input.buildId, input.controlEpoch, task.inputArtifactKeys)
      await assertFrozenAuthorCandidateV1(context, row, task, upstream, input.controlEpoch)
      const payload = parseAvgProfessionalArtifactV1(row.payloadJson)
      if (!['storyforge.avg.visual-bible', 'storyforge.avg.media-brief'].includes(payload.schema)) throw new Error('[avg-visual-plan] 采用的视觉 schema 无效')
      result.push({ payload, artifact: ref(row), authorReceiptHash: String(JSON.parse(row.metadataJson).receiptHash) })
    }
    return result
  })
}

/** Exact historical author/model evidence only. This read does not create a
 * candidate, copy adoption, grant carry authority or authorize a new request.
 * Every human ancestor uses its original candidate and command receipt; raw
 * proposals retain their original Run, checkpoint and request/response bytes. */
export async function readAvgHistoricalVisualArtifactV4(input: {
  scope: WorkspaceScope; buildId: number; expectedBuildRevision: number; controlEpoch: number
  expectedBriefHash: string; expectedPlanHash: string; artifact: Ref
},reusePath:AvgVisualReusePathV4=[]) {
  const scope = await resolveScope({ scope: input.scope })
  return db.transaction('r', scopeTransactionTables(db.productProductions, db.productProductionBriefs, db.productProductionCommands,
    db.productBuilds, db.productBuildArtifacts, db.avgDraftMedia, db.mediaBlobObjects,
    db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, db.agentRunArtifacts), async () => {
    const context = await authority(scope, input.buildId, true, false, input.controlEpoch, 'visual')
    if(!Array.isArray(reusePath)||reusePath.length>32)throw new Error('[avg-visual-history] 历史复用谱系超界')
    context.reusePath=reusePath
    if (!context.brief.avgVisualPlanning || context.build.stateRevision !== input.expectedBuildRevision
      || context.build.briefHash !== input.expectedBriefHash || context.build.planHash !== input.expectedPlanHash
      || !['paused','cancelled','failed','recovery-required','preview-ready','release-ready','released'].includes(context.build.status)) throw new Error('[avg-visual-history] 历史版本不准确或仍在执行')
    const task = context.plan.tasks.find(t => ['avg-author-visual-bible','avg-author-media-brief'].includes(t.kind)
      && t.outputArtifactKeys[0] === input.artifact.artifactKey)
    if (!task) throw new Error('[avg-visual-history] 读取仅限准确已采用专业方案')
    const cache = new Map<string, ProductBuildArtifactRecordV1>(), visiting = new Set<string>()
    const candidates = new Map<string, AuthorCandidate>()
    const evidence = new Map<string, Awaited<ReturnType<typeof readAvgVisualProposalEvidenceV4>>>()
    const read = async (key: string): Promise<ProductBuildArtifactRecordV1> => {
      const cached = cache.get(key)
      if (cached) return cached
      if (visiting.has(key) || visiting.size >= 100) throw new Error('[avg-visual-history] 历史作者依赖循环或超界')
      visiting.add(key)
      let row: ProductBuildArtifactRecordV1
      if (key.startsWith('avg.proposal.')) {
        const matches = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([input.buildId,key])
          .filter(r => r.status === 'accepted' && r.controlEpoch === input.controlEpoch).toArray()
        if (matches.length !== 1) throw new Error('[avg-visual-history] 历史原始方案不唯一或缺失')
        row = await verifyHistoricalAvgVisualPlanningArtifactV4({ scope, buildId: input.buildId,
          expectedBuildRevision: input.expectedBuildRevision, expectedBriefHash: input.expectedBriefHash, expectedPlanHash: input.expectedPlanHash,
          sourceControlEpoch: input.controlEpoch, ...ref(matches[0]) })
        const proof = await readAvgVisualProposalEvidenceV4(scope,row,reusePath), planning = context.brief.avgVisualPlanning!
        if (proof.quality.scopeHash !== await hash(planning.scope) || proof.request.sourceInputHash !== planning.scope.sourceInputHash
          || proof.binding.bindingHash !== context.brief.capabilityRequirements.find(c => c.requirementKey === AVG_VISUAL_TEXT_CAPABILITY_V4)?.capabilityHash) throw new Error('[avg-visual-history] 历史模型实际输入不属于原冻结范围或路由')
        evidence.set(key,proof)
      } else {
        const owner = context.plan.tasks.find(t => t.outputArtifactKeys.length === 1 && t.outputArtifactKeys[0] === key)
        if (!owner || !['avg-author-rules','avg-author-script','avg-author-visual-bible','avg-author-media-brief'].includes(owner.kind)) throw new Error('[avg-visual-history] 历史读取超出准确作者来源域')
        authorTask(context,owner.taskKey,key,true)
        const [adopted] = await acceptedInputs(scope,input.buildId,input.controlEpoch,[key])
        row = adopted
        const upstream = []
        for (const dependency of owner.inputArtifactKeys) upstream.push(await read(dependency))
        const prepared = prepareAuthorInput({artifactKey:key,kind:row.kind,payload:row.payloadJson,allowedOutputKeys:owner.outputArtifactKeys})
        if (prepared.payloadJson !== row.payloadJson) throw new Error('[avg-visual-history] 历史作者载荷不是准确规范字节')
        candidates.set(key,await assertFrozenAuthorCandidateV1(context,row,owner,upstream,input.controlEpoch))
      }
      visiting.delete(key);cache.set(key,row)
      return row
    }
    const row = await read(input.artifact.artifactKey)
    if (row.version !== input.artifact.version || row.contentHash !== input.artifact.contentHash) throw new Error('[avg-visual-history] 历史作者方案不是指定版本')
    const candidate = candidates.get(row.artifactKey)!
    if (candidate.version !== 6&&candidate.version!==7) throw new Error('[avg-visual-history] 历史方案缺少模型与人工修订的准确区分')
    const original = cache.get(candidate.visualProposalValidation.proposal.artifactKey)!, originalEvidence = evidence.get(original.artifactKey)!
    const same = (a:unknown,b:unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
    if (!same(JSON.parse(row.rightsJson),{origin:candidate.origin,declaration:candidate.declaration})) throw new Error('[avg-visual-history] 历史权利声明与作者原候选不一致')
    if (!same(await db.productBuilds.get(input.buildId),context.build)
      || !same(await db.productProductions.get(context.production.id),context.production)
      || !same(await db.productProductionBriefs.get(context.briefRow.id!),context.briefRow)) throw new Error('[avg-visual-history] 历史来源在读取期间变化')
    return structuredClone({ payload: parseAvgProfessionalArtifactV1(row.payloadJson), artifact: ref(row), candidate, rights: JSON.parse(row.rightsJson),
      authorReceiptHash: String(JSON.parse(row.metadataJson).receiptHash),
      original: { artifact: ref(original), payload: JSON.parse(original.payloadJson), producerRunId: original.producerRunId!,
        producerReceiptHash: original.producerReceiptHash!, rawText: originalEvidence.rawText, requestText: originalEvidence.requestText,
        request: originalEvidence.request,modelRequest:originalEvidence.modelRequest,modelRequestText:originalEvidence.modelRequestText,
        modelRun:originalEvidence.modelRun,reused:originalEvidence.reused,
        binding: originalEvidence.binding, quality: originalEvidence.quality, rights: JSON.parse(original.rightsJson) },
      source: { productionKey: context.production.productionKey, buildNumber: context.build.buildNumber,
        buildRevision: context.build.stateRevision, controlEpoch: input.controlEpoch, briefHash: context.build.briefHash,
        planHash: context.build.planHash, sourceWorldContentHash: context.brief.source.worldContentHash,
        planning: context.brief.avgVisualPlanning.scope }, inputs: task.inputArtifactKeys.map(key => ref(cache.get(key)!)) })
  })
}

export async function readAvgConfirmedVisualBibleV4(input: Pick<Parameters<typeof readAuthorInputs>[0], 'scope' | 'buildId' | 'expectedBuildRevision' | 'controlEpoch'>) {
  const [row] = await readAvgConfirmedVisualArtifactsV4({ ...input, artifactKeys: ['avg.media.visual-bible'] })
  if (!row || row.payload.schema !== 'storyforge.avg.visual-bible') throw new Error('[avg-visual-plan] 缺少已确认视觉方向')
  return { ...row, payload: row.payload }
}

export function readAvgMediaChoicesForConfigurationV2(input: Pick<Parameters<typeof readAuthorInputs>[0], 'scope' | 'buildId' | 'expectedBuildRevision' | 'controlEpoch'>) {
  return readAuthorInputs({ ...input, includeSceneScripts: true, includeMediaChoices: true })
}

export function readAvgVoiceChoicesForConfigurationV3(input: Pick<Parameters<typeof readAuthorInputs>[0], 'scope' | 'buildId' | 'expectedBuildRevision' | 'controlEpoch'>) {
  return readAuthorInputs({ ...input, includeSceneScripts: true, includeVoiceChoices: true })
}

/** Historical image use is an explicit read, not adoption into the old Build.
 * Preserve the exact original start, author command, producer and pixel proof
 * even after stop, supersession or portable import. */
export async function readAvgAdoptedGeneratedReferenceChoiceV1(input: { scope: WorkspaceScope; buildId: number; controlEpoch: number;
  artifactKey: string; version: number; contentHash: string }) {
  const scope = await resolveScope({ scope: input.scope }), proofTables = await mediaProofTables(input.buildId)
  return db.transaction('r', scopeTransactionTables(db.productProductions, db.productProductionBriefs, db.productProductionCommands,
    db.productBuilds, db.productBuildArtifacts, db.avgDraftMedia, db.mediaBlobObjects, ...proofTables), async () => {
    const context = await authority(scope, input.buildId, true, false, input.controlEpoch)
    const [row] = await acceptedInputs(scope, input.buildId, input.controlEpoch, [input.artifactKey])
    if (row.version !== input.version || row.contentHash !== input.contentHash) throw new Error('[avg-media] 生成参考不是准确的作者已采用版本')
    const choice = parseAvgAuthorMediaChoice(row.payloadJson)
    const task = context.plan.tasks.find(task => task.taskKey === `avg.author.media.${choice.requirementKey}`)
    if (!task || task.kind !== 'avg-author-media-choice' || task.executionMode !== 'human-import' || task.skillId !== null
      || canonicalProductProductionJsonV2(task.outputArtifactKeys) !== canonicalProductProductionJsonV2([row.artifactKey])
      || canonicalProductProductionJsonV2(task.inputArtifactKeys) !== canonicalProductProductionJsonV2([choice.raw.artifactKey,...(choice.version===2?[choice.processed.artifactKey]:[]),...(readAvgOptionalImageDefinitionV3(context.brief)?.mediaBatch.visualReviewPolicy?[avgVisualReviewArtifactKeyV1(choice.requirementKey)]:[])])) throw new Error('[avg-media] 生成参考不属于原冻结作者选图任务')
    const proved = await verifyAvgReferenceRawImageArtifactV1({ scope, buildId: input.buildId, expectedBuildRevision: context.build.stateRevision,
      expectedBriefHash: context.build.briefHash, expectedPlanHash: context.build.planHash, sourceControlEpoch: input.controlEpoch,
      artifactKey: choice.raw.artifactKey, version: choice.raw.version, contentHash: choice.raw.contentHash })
    await assertAvgRawImageOriginV1({ scope, productionId: context.production.id, brief: context.brief, build: context.build,
      artifact: proved.artifact, requirementKey: choice.requirementKey, taskKey: proved.provenance.taskKey }, [context.build.buildNumber])
    const processed=choice.version===2?await verifyAvgProcessedImageArtifactV1({scope,buildId:input.buildId,expectedBuildRevision:context.build.stateRevision,
      expectedBriefHash:context.build.briefHash,expectedPlanHash:context.build.planHash,sourceControlEpoch:input.controlEpoch,...choice.processed}):undefined
    const selected = await inspectAvgChosenImageV1({ scope, brief: context.brief, choice, row: proved.artifact,processed:processed?.artifact })
    const review=await readChoiceVisualReview(context,scope,choice,proved.artifact,input.controlEpoch,processed?.artifact)
    const candidate = await assertFrozenAuthorCandidateV1(context, row, task, [proved.artifact,...(processed?[processed.artifact]:[]),...(review?[review.row]:[])], input.controlEpoch)
    if (candidate.version !== 4 || canonicalProductProductionJsonV2(candidate.mediaChoiceValidation) !== canonicalProductProductionJsonV2(selected.validation)) throw new Error('[avg-media] 生成参考缺少准确的作者解码采用证据')
    const envelope = JSON.parse(row.metadataJson) as { receiptHash: string }
    return { choice, artifact: ref(row), authorReceiptHash: envelope.receiptHash, raw: proved.artifact, rawProof: proved.provenance,image:selected.image,
      ...(processed?{processingProof:processed.provenance}:{}),
      productionKey: context.production.productionKey, buildNumber: context.build.buildNumber, requirement: selected.requirement,
      sourceWorldContentHash:context.brief.source.worldContentHash }
  })
}

/** Exact historical voice authority only. The original producer, physical
 * bytes, saved response, native decoder, review and author command remain
 * mandatory. This does not adopt into either Build or reopen an old Run. */
export async function readAvgAdoptedGeneratedVoiceChoiceV1(input: { scope: WorkspaceScope; buildId: number; controlEpoch: number;
  artifactKey: string; version: number; contentHash: string }) {
  const scope = await resolveScope({ scope: input.scope }), proofTables = await mediaProofTables(input.buildId)
  return db.transaction('r', scopeTransactionTables(db.productProductions, db.productProductionBriefs, db.productProductionCommands,
    db.productBuilds, db.productBuildArtifacts, db.avgDraftMedia, db.mediaBlobObjects, ...proofTables), async () => {
    const context = await authority(scope, input.buildId, true, false, input.controlEpoch, 'voice')
    const [row] = await acceptedInputs(scope, input.buildId, input.controlEpoch, [input.artifactKey])
    if (row.version !== input.version || row.contentHash !== input.contentHash) throw new Error('[avg-voice] 沿用来源不是准确的已采用配音版本')
    const choice = parseAvgAuthorVoiceChoiceV1(row.payloadJson), voice = await readVoiceDefinition(context)
    const task = context.plan.tasks.find(task => task.taskKey === `avg.author.voice-choice.${choice.requirementKey}`)
    if (!task || task.kind !== 'avg-author-voice-choice' || task.executionMode !== 'human-import' || task.skillId !== null
      || row.kind !== 'presentation' || canonicalProductProductionJsonV2(task.outputArtifactKeys) !== canonicalProductProductionJsonV2([row.artifactKey])
      || canonicalProductProductionJsonV2(task.inputArtifactKeys) !== canonicalProductProductionJsonV2([choice.raw.artifactKey, choice.review.artifactKey])) {
      throw new Error('[avg-voice] 沿用来源不属于原冻结配音选择任务')
    }
    const historicalReadOnly = { expectedBuildRevision: context.build.stateRevision, expectedBriefHash: context.build.briefHash,
      expectedPlanHash: context.build.planHash, sourceControlEpoch: input.controlEpoch }
    const proved = await verifyAvgHistoricalRawVoiceArtifactV1({ scope, buildId: input.buildId, ...historicalReadOnly, ...choice.raw })
    const selected = await bindAvgVoiceChoiceToSourceV1(choice, await readAvgRawVoiceSourceV1({ scope, buildId: input.buildId,
      ...voice, raw: choice.raw, historicalReadOnly }))
    const review = await readChoiceVoiceReview(context, scope, choice, selected, input.controlEpoch)
    const candidate = await assertFrozenAuthorCandidateV1(context, row, task, [selected.raw, review.row], input.controlEpoch)
    if (candidate.version !== 5 || canonicalProductProductionJsonV2(candidate.voiceChoiceValidation) !== canonicalProductProductionJsonV2(selected.validation)) {
      throw new Error('[avg-voice] 沿用来源缺少准确的原作者解码采用回执')
    }
    return { choice, artifact: ref(row), authorReceiptHash: String(JSON.parse(row.metadataJson).receiptHash),
      review: { artifact: review.artifact, authorReceiptHash: review.authorReceiptHash },
      rawProof: parseAvgRetainedVoiceProofV1(proved.provenance), requirement: selected.payload.requirement,
      preset: selected.payload.preset, asset: selected.asset, blobObjectId: selected.blobObjectId,
      productionKey: context.production.productionKey, sourceWorldContentHash: context.brief.source.worldContentHash }
  })
}

/** Read-only proof of the original author receipts on an immutable Build.
 * It deliberately grants no adoption or compilation authority to old Builds. */
export function verifyFrozenAvgAuthorInputsV1(input: Omit<Parameters<typeof readAuthorInputs>[0], 'includeSceneScripts' | 'includeAuthorStage'>) {
  return readAuthorInputs({ ...input, includeSceneScripts: true, includeAuthorStage: true }, true)
}

/** Called only inside the registered production command transaction. The
 * existing command claim/CAS/replay mechanism supplies the author action. */
export async function applyAvgAuthorArtifactAdoptionV1(input: {
  scope: WorkspaceScope; production: ProductProductionRecordV1 & { id: number }; command: AdoptCommand; now: number
}) {
  let prepared: Awaited<ReturnType<typeof prepareAdoption>>
  try {
    if (!Dexie.currentTransaction || input.command.expectedStateRevision !== input.production.stateRevision) throw new Error('[avg] 作者采用必须进入当前命令事务')
    const claim = await db.productProductionCommands.where('[productionId+commandId]').equals([input.production.id, input.command.commandId]).first()
    if (!claim || !await assertRecordInScope(input.scope, 'productProductionCommands', claim, { owner: 'work' })
      || claim.type !== 'adopt-avg-artifact' || claim.status !== 'claimed' || claim.payloadHash !== await hash(input.command)) throw new Error('[avg] 缺少实际作者命令 claim')
    prepared = await prepareAdoption(input.scope, input.production, input.command)
  }
  catch (cause) { throw new AvgAuthorArtifactErrorV1(cause instanceof Error ? cause.message : String(cause)) }
  const { context, candidate, body, derived, invalidated } = prepared
  const receiptBody = { schema: 'storyforge.avg.author-adoption', version: 1, commandId: input.command.commandId,
    candidate: body, adoptedAt: input.now, derivedScript: derived ? { artifactKey: derived.base.artifactKey, version: derived.version, contentHash: derived.contentHash } : null }
  const receiptHash = await hash(receiptBody)
  const metadataJson = canonicalProductProductionJsonV2({ ...receiptBody, receiptHash })
  const derivedInputHash = derived ? await hash({ baseScriptHash: derived.base.contentHash, patchHash: candidate.contentHash, receiptHash }) : null
  await db.productBuildArtifacts.update(candidate.id!, { status: 'accepted', metadataJson, updatedAt: input.now })
  if (invalidated.length) await db.productBuildArtifacts.where('id').anyOf(invalidated).modify({ status: 'invalid', updatedAt: input.now })
  if (derived) await db.productBuildArtifacts.add(stampNewRecord(input.scope, 'productBuildArtifacts', {
    ...derived.base, id: undefined, version: derived.version, status: 'accepted' as const,
    payloadJson: derived.payloadJson, contentHash: derived.contentHash, inputHash: derivedInputHash!,
    parentArtifactHash: derived.base.contentHash, metadataJson,
    byteSize: new TextEncoder().encode(derived.payloadJson).byteLength, createdAt: input.now, updatedAt: input.now,
  }, { owner: 'work' }))
  const stateRevision = input.production.stateRevision + 1
  await db.productBuilds.update(context.build.id!, { stateRevision: context.build.stateRevision + 1, updatedAt: input.now })
  await db.productProductions.update(input.production.id, { stateRevision, updatedAt: input.now })
  return { production: { ...input.production, stateRevision, updatedAt: input.now }, result: {
    buildNumber: context.build.buildNumber, artifactKey: candidate.artifactKey, version: candidate.version,
    contentHash: candidate.contentHash, candidateHash: body.candidateHash, authorReceiptHash: receiptHash,
    derivedScript: derived ? { artifactKey: derived.base.artifactKey, version: derived.version, contentHash: derived.contentHash } : null,
    invalidatedCount: invalidated.length,
  } }
}
