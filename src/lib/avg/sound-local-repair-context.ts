import { db } from '../db/schema'
import type { AssembleContextInput } from '../registry/types'
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, ProductProductionBriefRecordV1,
  ProductProductionBriefV3, ProductProductionPlanTaskV3, ProductProductionRecordV1, WorkspaceScope } from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAcceptedProductBuildArtifactV1, verifyHistoricalAvgSoundArtifactV1 } from '../product-production/artifact-store'
import { readAvgSystemPlanForCompilationV1, readAvgFrozenSoundSourceInputsV1 } from './author-artifacts'
import { readAvgSoundLocalRepairEvidenceV1 } from './sound-local-repair-evidence'
import { parseAvgSoundPlanningBriefV2 } from './sound-production-brief'
import { parseAvgAudioProductionProcessingPlan } from './audio-production-contract'
import { AVG_SOUND_COMPILED_KEY_V1 } from './sound-production-plan'
import { assertAvgInheritedSoundBindingV1 } from './stage-sound-sources'

type Ref = { artifactKey: string; version: number; contentHash: string }
const ref = (r: Ref): Ref => ({ artifactKey: r.artifactKey, version: r.version, contentHash: r.contentHash })
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Only the registered sound reader dispatches here after actual shared
 * Brief/Plan parsing and exact task/dependency checks. This is not an alternate
 * Context gateway, authority verifier or producer/adoption entry point. */
export async function readAvgSoundLocalRepairContextV1(boundary: {
  input: AssembleContextInput; scope: WorkspaceScope; build: ProductBuildRecordV1; production: ProductProductionRecordV1
  row: ProductProductionBriefRecordV1; brief: ProductProductionBriefV3; task: ProductProductionPlanTaskV3; frozen: boolean
}) {
  const { input, scope, build, production, row, brief, task, frozen } = boundary
  const declaration = parseAvgSoundPlanningBriefV2(brief.avgSoundPlanning), { repair } = declaration, key = repair.source.requirementKey
  const compilation = task.kind === 'avg-sound-requirements-reuse' && task.taskKey === 'avg.sound.compile.requirements'
    && same(task.outputArtifactKeys, [AVG_SOUND_COMPILED_KEY_V1])
  const raw = task.kind === 'avg-sound-raw-reuse' && task.taskKey === `avg.sound.generate.${key}`
    && same(task.outputArtifactKeys, [`avg.sound.raw.${key}`])
  const processing = task.kind === 'avg-audio-process' && task.taskKey === `avg.sound.process.${key}`
    && same(task.outputArtifactKeys, [`avg.sound.processed.${key}`])
  const assembly = task.kind === 'avg-assembly-integrate' && task.taskKey === 'avg.assembly.integrate'
    || task.kind === 'avg-assembly-verify' && task.taskKey === 'avg.assembly.verify'
  if (!build.id || !production.id || !row.id || build.id !== input.productBuildId || production.id !== input.productProductionId
    || (!compilation && !raw && !processing && !assembly) || frozen && !compilation && !raw
    || task.executionMode !== 'deterministic' || task.skillId !== null || task.contextProfile !== 'avg-sound-planning-v1'
    || task.capabilityRequirementKeys.length || task.maxAttempts !== 1 || task.fallbackTaskKey !== null || task.reuse !== null
    || task.budgetReservation.modelCalls !== 0 || task.budgetReservation.mediaCalls !== 0
    || task.budgetReservation.outputTokens !== 0 || task.budgetReservation.maximumCostUsd !== 0) {
    throw new Error('[avg-sound-repair] Context仅属于准确单次零调用复验、加工或组装；封存只读不授予新执行权')
  }
  const expectedProcessing = parseAvgAudioProductionProcessingPlan({ schema: 'storyforge.avg.audio-production-processing-plan',
    version: repair.recipe.version, entries: [{ domain: 'sound', requirementKey: key, recipe: repair.recipe }] })
  if (!brief.avgAudioProcessing || !same(parseAvgAudioProductionProcessingPlan(brief.avgAudioProcessing), expectedProcessing)) {
    throw new Error('[avg-sound-repair] 加工要求与返修单一配方不一致，不能回退原件')
  }
  // The shared helper proves real original producers/compiled/request/bytes,
  // adoption and exact parent Stage membership. Do not reconstruct a second
  // history/adoption verifier or copy the old plan's author receipt.
  const evidence = await readAvgSoundLocalRepairEvidenceV1({ scope, productionId: production.id, repair })
  if (evidence.selected.sourceWorldContentHash !== brief.source.worldContentHash
    || evidence.parentStage.aspectRatio !== declaration.aspectRatio) throw new Error('[avg-sound-repair] 返修不能替换原冻结世界或父演出画幅')
  const sourceInput = { scope, buildId: build.id, expectedBuildRevision: build.stateRevision, controlEpoch: build.controlEpoch }
  const source = frozen ? await readAvgFrozenSoundSourceInputsV1(sourceInput)
    : await readAvgSystemPlanForCompilationV1({ ...sourceInput, includeSceneScripts: true, includeAuthorStage: assembly })
  if (!source.plan.scenes.some(s => s.key === evidence.requirement.template.consumer.sceneKey)) throw new Error('[avg-sound-repair] 所选原声音场景不属于当前已采用规则')
  assertAvgInheritedSoundBindingV1({ asset: repair.sourceAsset, raw: evidence.selected.rawPayload,
    payload: evidence.parentStage, scripts: source.scripts.map(s => s.payload) })
  const refs: Ref[] = [source.artifact, ...source.scripts.map(s => s.artifact), ...(assembly && source.authorStage ? [source.authorStage.artifact] : [])]
  const rows = new Map<string, ProductBuildArtifactRecordV1>()
  for (const key of task.inputArtifactKeys.filter(key => !refs.some(r => r.artifactKey === key))) {
    const matches = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id, key])
      .filter(r => r.status === 'accepted' && r.controlEpoch === build.controlEpoch).limit(2).toArray()
    if (matches.length !== 1) throw new Error('[avg-sound-repair] 当前复验任务的准确依赖缺失或不唯一')
    const actual = frozen ? await verifyHistoricalAvgSoundArtifactV1({ scope, buildId: build.id,
      expectedBuildRevision: build.stateRevision, expectedBriefHash: build.briefHash, expectedPlanHash: build.planHash,
      sourceControlEpoch: build.controlEpoch, ...ref(matches[0]!) }) : await verifyAcceptedProductBuildArtifactV1({ scope, buildId: build.id, ...ref(matches[0]!) })
    rows.set(key, actual); refs.push(ref(actual))
  }
  if (refs.length !== task.inputArtifactKeys.length || refs.some(r => !task.inputArtifactKeys.includes(r.artifactKey))) {
    throw new Error('[avg-sound-repair] 登记Context须完整覆盖当前准确规则、脚本及生产依赖')
  }
  if (raw || processing) {
    const compiled = rows.get(AVG_SOUND_COMPILED_KEY_V1)
    if (!compiled || !compiled.producerReceiptHash || compiled.contentHash !== repair.source.compiled.contentHash
      || compiled.payloadJson !== canonicalProductProductionJsonV2(evidence.compiled)) {
      throw new Error('[avg-sound-repair] 本Build缺少完整原compiled的准确零调用复验结果')
    }
  }
  const common = { schema: 'storyforge.avg.sound-planning-inputs', version: 2,
    sourceInputHash: repair.sourceScope.sourceInputHash, scopeHash: evidence.compiled.scopeHash, soundPlanHash: evidence.compiled.planHash,
    repairHash: await hashProductProductionValueV2(repair), source: { productionKey: repair.source.productionKey,
      buildNumber: repair.source.buildNumber, buildRevision: repair.sourceBuildRevision, briefHash: repair.source.briefHash,
      planHash: repair.source.planHash, controlEpoch: repair.source.controlEpoch, compiled: repair.source.compiled,
      raw: repair.source.raw, review: repair.source.review, choice: repair.source.choice, requestIdentityHash: repair.source.requestIdentityHash },
    parent: repair.parent }
  let packet: Record<string, unknown>
  if (compilation || raw) {
    const original = raw ? evidence.selected.raw : evidence.selected.compiled
    const retainedArtifact = { artifactKey: original.artifactKey, version: original.version, contentHash: original.contentHash,
      kind: original.kind, mediaKind: original.mediaKind, mimeType: original.mimeType, byteSize: original.byteSize,
      payload: JSON.parse(original.payloadJson), metadata: JSON.parse(original.metadataJson), rights: JSON.parse(original.rightsJson) }
    packet = { ...common, operation: raw ? 'reuse-original-sound' : 'reuse-original-sound-requirements', retainedArtifact,
      ...(raw ? { requirement: evidence.requirement } : {}) }
  }
  else if (processing) {
    const original = rows.get(`avg.sound.raw.${key}`)
    if (!original?.producerReceiptHash || original.contentHash !== repair.source.raw.contentHash) throw new Error('[avg-sound-repair] 本Build缺少所选原件的准确复验producer')
    packet = { ...common, operation: 'process-compiled-sound', requirement: evidence.requirement,
      processing: expectedProcessing.entries[0]!, raw: { ...ref(original), producerReceiptHash: original.producerReceiptHash } }
  } else {
    if (!source.authorStage || source.soundChoices?.length !== 1 || source.soundChoices[0]!.payload.requirementKey !== key) {
      throw new Error('[avg-sound-repair] 组装需要所选新声音的独立审听采用及准确新演出')
    }
    packet = { ...common, operation: task.kind === 'avg-assembly-integrate' ? 'integrate-adopted-sound-stage' : 'verify-adopted-sound-stage',
      stage: source.authorStage.artifact, soundChoices: source.soundChoices.map(c => ({ choice: c.artifact, authorReceiptHash: c.authorReceiptHash,
        raw: ref(c.raw), rawReceiptHash: c.raw.producerReceiptHash, compiled: c.validation.compiled,
        review: c.review.artifact, reviewReceiptHash: c.review.authorReceiptHash })) }
  }
  if (!same(await db.productBuilds.get(build.id), build) || !same(await db.productProductions.get(production.id), production)
    || !same(await db.productProductionBriefs.get(row.id), row)
    || !same(await db.productBuilds.get(evidence.parent.id!), evidence.parent)
    || !same(await db.productBuilds.get(evidence.selected.build.id!), evidence.selected.build)) {
    throw new Error('[avg-sound-repair] Context读取期间当前制作、父预览或原声音版本已变化')
  }
  return canonicalProductProductionJsonV2({ ...packet, taskKey: task.taskKey, productionKey: production.productionKey,
    buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: build.planHash, briefHash: build.briefHash,
    briefRevision: row.revision, sourcePlanHash: row.sourcePlanHash, confirmedBriefHash: row.confirmedBriefHash,
    sourceWorldContentHash: row.sourceWorldContentHash,
    artifacts: task.inputArtifactKeys.map(key => refs.find(r => r.artifactKey === key)!), taskBudget: task.budgetReservation })
}
