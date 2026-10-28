import { db } from '../db/schema'
import { readAvgVisualContextAuthority,assertAvgVisualContextFresh } from './visual-planning-context-authority'
import type { AssembleContextInput } from '../registry/types'
import type { ProductProductionPlanTaskV3 } from '../types'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readAvgConfirmedVisualArtifactsV4, readAvgSystemPlanForCompilationV1 } from './author-artifacts'
import { freezeAvgVisualPlanningScopeV1, type AvgMediaSourceInputV1 } from './media-source'
import { parseAvgVisualPlanningBriefV4, type AvgVisualPlanningBriefV4 } from './visual-planning-brief'
import { parseAvgVisualBibleV1, type AvgVisualBibleV1 } from './visual-planning-contract'
import { AVG_VISUAL_PLANNING_ROLES_V1 } from './visual-planning-roles'
import { avgVisualProposalArtifactKeyV4 } from './visual-planning-plan'
import { readAvgDraftReferenceBytesV1 } from './editor-service'
import { verifyAvgReferenceBytesV1 } from './media-reference-contract'
import { validateAvgGeneratedReferencesV1 } from './media-generated-reference'
import { readAvgCompiledImageDefinitionV4 } from './visual-planning-image-definition'
import { AVG_COMPILED_IMAGE_SKILL_V4 } from './visual-planning-roles'
import { avgVisualRoleTargetV4, isAvgVisualReuseTaskV4 } from './visual-role-proposal'

/** Only author-declared visible details are delivered. Full rules, secrets,
 * item descriptions, script text and reference-image bytes are not a default
 * visual-model input. The full source still participates in stale checking. */
export function projectAvgVisualPlanningTaskV4(input: { planning: AvgVisualPlanningBriefV4; task: ProductProductionPlanTaskV3;
  source: AvgMediaSourceInputV1; visualBible?: AvgVisualBibleV1 }) {
  const planning = parseAvgVisualPlanningBriefV4(input.planning), target=avgVisualRoleTargetV4(input.task,planning.scope)
  const reuse=isAvgVisualReuseTaskV4(input.task), selectedKind=target==='avg.media.visual-bible'?null:planning.scope.templates.find(t=>
    target===`avg.media.${t.subjectKind}-brief.${t.parameters.family.subjectKey}`)?.subjectKind
  const role = AVG_VISUAL_PLANNING_ROLES_V1.find(r => reuse?r.subjectKind===selectedKind:r.skillId===input.task.skillId)
  if(!role)throw new Error('[avg-visual-plan] 只接受登记的专业方案任务')
  const scope = planning.scope, isDirection = role.subjectKind === null
  const subjects = [...new Map(scope.templates.map(t => [t.parameters.family.subjectKey, t.subjectKind])).entries()]
  const selected = isDirection ? subjects : subjects.filter(([key, kind]) => kind === role.subjectKind
    && avgVisualProposalArtifactKeyV4(kind, key) === input.task.outputArtifactKeys[0])
  if (!selected.length || !isDirection && selected.length !== 1 || isDirection && input.task.outputArtifactKeys[0] !== avgVisualProposalArtifactKeyV4(null)) {
    throw new Error('[avg-visual-plan] 专业岗位与准确主体输出域不一致')
  }
  const templates = scope.templates.filter(t => selected.some(([key]) => key === t.parameters.family.subjectKey))
  const usedReferences = new Set(templates.flatMap(t => t.allowedReferenceKeys))
  const bible = input.visualBible === undefined ? null : parseAvgVisualBibleV1(input.visualBible)
  if (!isDirection && !bible) throw new Error('[avg-visual-plan] 主体设计缺少已确认视觉基准')
  if (!isDirection && selected.some(([key, kind]) => !bible!.subjects.some(s => s.subjectKey === key && s.subjectKind === kind))) throw new Error('[avg-visual-plan] 视觉基准未覆盖准确主体')
  const reuseSource=reuse?planning.proposalReuse?.find(r=>r.artifact.artifactKey===target):undefined
  if(reuse&&!reuseSource)throw new Error('[avg-visual-reuse] 准确岗位没有冻结来源')
  return { schema: 'storyforge.avg.visual-planning-inputs' as const, version: 4 as const,
    ...(reuse?{operation:'reuse-confirmed-visual-proposal',reuseSource}:{}),
    sourceInputHash: scope.sourceInputHash, aspectRatio: scope.aspectRatio,
    subjects: selected.map(([subjectKey, subjectKind]) => ({ subjectKey, subjectKind,
      name: subjectKind === 'character' ? input.source.systemPlan.characters.find(c => c.key === subjectKey)?.displayName
        : subjectKind === 'environment' ? input.source.systemPlan.scenes.find(s => s.key === subjectKey)?.title
          : input.source.systemPlan.version === 2 ? input.source.systemPlan.inventory.items.find(i => i.key === subjectKey)?.name : undefined })),
    requirements: templates.map(t => ({ requirementKey: t.parameters.requirementKey, name: t.parameters.name,
      mediaKind: t.parameters.mediaKind, width: t.parameters.width, height: t.parameters.height, alpha: t.parameters.alpha,
      purpose: { domain: t.parameters.consumer.domain, slot: t.parameters.consumer.slot }, requiredDetails: t.requiredDetails,
      forbiddenDepictions: t.forbiddenDepictions, allowedReferenceKeys: t.allowedReferenceKeys, requiredReferenceKeys: t.requiredReferenceKeys })),
    references: scope.referenceCatalog.filter(r => usedReferences.has(r.referenceKey)).map(r => ({ referenceKey: r.referenceKey,
      purpose: r.reference.purpose, allowedChange: r.reference.allowedChange, observation: 'metadata-only; original image not delivered' })),
    visualDirection: bible && !isDirection ? { style: bible.style, subjects: bible.subjects.filter(s => selected.some(([key]) => key === s.subjectKey)) } : null }
}

/** Registered reader, never a caller-supplied packet or a new context engine. */
export async function readAvgVisualPlanningContextV4(input: AssembleContextInput): Promise<string> {
  const authority=await readAvgVisualContextAuthority(input,4)
  const {scope,build,production,row,brief,task,planning}=authority
  const rawReuse=task.kind==='avg-media-image-reuse'&&task.executionMode==='deterministic'&&task.contextProfile==='avg-visual-planning-v4'
  const processing=task.kind==='avg-media-image-process'&&task.executionMode==='deterministic'&&task.contextProfile==='avg-visual-planning-v4'
  const imageTask = task.kind === 'avg-media-image-generate' && task.executionMode === 'media-provider' && task.skillId === AVG_COMPILED_IMAGE_SKILL_V4
  const image = imageTask||rawReuse||processing ? await readAvgCompiledImageDefinitionV4({ scope, buildId: build.id!, expectedBuildRevision: build.stateRevision,
    controlEpoch: build.controlEpoch, expectedBrief: brief }) : null
  const source = image?.source ?? await readAvgSystemPlanForCompilationV1({ scope, buildId: build.id!, expectedBuildRevision: build.stateRevision,
    controlEpoch: build.controlEpoch, includeSceneScripts: true })
  const canonicalSource = { systemPlan: source.plan, scripts: source.scripts.map(s => s.payload), presentation: { aspectRatio: planning.scope.aspectRatio } }
  const { sourceInputHash: _hash, aspectRatio: _ratio, ...unhashed } = planning.scope
  const checked = await freezeAvgVisualPlanningScopeV1(unhashed, canonicalSource)
  if (canonicalProductProductionJsonV2(checked) !== canonicalProductProductionJsonV2(planning.scope)) throw new Error('[avg-visual-plan] 规则、文本或策划输入已 stale')
  const keys = task.inputArtifactKeys.filter(k => k === 'avg.media.visual-bible' || /^avg\.media\.(character|environment|prop)-brief\./.test(k))
  const adopted = keys.length ? await readAvgConfirmedVisualArtifactsV4({ scope, buildId: build.id!, expectedBuildRevision: build.stateRevision,
    controlEpoch: build.controlEpoch, artifactKeys: keys }) : []
  const bible = adopted.find(row => row.payload.schema === 'storyforge.avg.visual-bible')?.payload
  const compilation = task.kind === 'avg-v4-visual-requirements-compile' && task.executionMode === 'deterministic' && task.contextProfile === 'avg-visual-planning-v4'
  const requirement = image?.definition.mediaBatch.requirements.find(r => task.taskKey === `${processing?'avg.media.process':'avg.media.generate'}.${r.requirementKey}`)
  if (image && !requirement) throw new Error('[avg-visual-image] 当前图片任务不属于准确编译需求')
  const processEntry=processing?planning.imageProcessing?.entries.find(e=>e.requirementKey===requirement!.requirementKey):undefined
  const rawRows=processing?await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!,`avg.media.raw.${requirement!.requirementKey}`])
    .filter(r=>r.status==='accepted'&&r.controlEpoch===build.controlEpoch).limit(2).toArray():[]
  if(processing&&rawRows.length!==1)throw new Error('[avg-process] 当前加工任务缺少唯一准确原图')
  const raw=processing?await verifyAcceptedProductBuildArtifactV1({scope,buildId:build.id!,artifactKey:rawRows[0].artifactKey,
    version:rawRows[0].version,contentHash:rawRows[0].contentHash}):null
  if(processing&&!processEntry)throw new Error('[avg-process] 当前加工任务没有准确冻结配方')
  const packet = image ? { schema: 'storyforge.avg.visual-planning-inputs', version: 4, sourceInputHash: checked.sourceInputHash,
    aspectRatio: checked.aspectRatio, operation: processing?'process-compiled-image':rawReuse?'revalidate-original-compiled-image':'produce-compiled-image',
    ...(processEntry?{processing:processEntry}:{}),
    ...(rawReuse?{rawReuseSource:planning.rawReuse?.find(r=>r.requirementKey===requirement!.requirementKey)}:{}),
    requirement, imageBinding: image.definition.imageBinding,
    compilation: image.definition.compilation }
    : compilation ? { schema: 'storyforge.avg.visual-planning-inputs', version: 4, sourceInputHash: checked.sourceInputHash,
    aspectRatio: checked.aspectRatio, operation: 'compile-adopted-visual-requirements' }
    : projectAvgVisualPlanningTaskV4({ planning: planning, task, source: canonicalSource,
      visualBible: bible?.schema === 'storyforge.avg.visual-bible' ? bible : undefined })
  const references = compilation ? checked.referenceCatalog : checked.referenceCatalog.filter(ref => 'references' in packet
    && packet.references.some(selected => selected.referenceKey === ref.referenceKey))
  for (const { reference } of references) await verifyAvgReferenceBytesV1(reference, await readAvgDraftReferenceBytesV1(scope, reference))
  for (const template of checked.templates) await validateAvgGeneratedReferencesV1(scope,
    references.filter(ref => template.allowedReferenceKeys.includes(ref.referenceKey)).map(ref => ref.reference), template.parameters.family)
  const availableRefs = [source.artifact, ...source.scripts.map(s => s.artifact), ...adopted.map(row => row.artifact), ...(image ? [image.definition.compilation] : []),
    ...(raw?[{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}]:[])]
  if (availableRefs.length !== task.inputArtifactKeys.length || availableRefs.some(r => !task.inputArtifactKeys.includes(r.artifactKey))) throw new Error('[avg-visual-plan] 准确作者依赖不闭合')
  const refs = task.inputArtifactKeys.map(key => availableRefs.find(r => r.artifactKey === key)!)
  await assertAvgVisualContextFresh(authority)
  return canonicalProductProductionJsonV2({ ...packet, taskKey: task.taskKey, productionKey: production.productionKey,
    buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: build.planHash, briefRevision: row.revision, briefHash: build.briefHash,
    sourcePlanHash: row.sourcePlanHash, confirmedBriefHash: row.confirmedBriefHash,
    sourceWorldContentHash: row.sourceWorldContentHash, artifacts: refs, taskBudget: task.budgetReservation })
}
