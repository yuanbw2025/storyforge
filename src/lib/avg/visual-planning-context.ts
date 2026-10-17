import { db } from '../db/schema'
import type { AssembleContextInput } from '../registry/types'
import type { ProductProductionPlanTaskV3 } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
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
  const { scope } = input
  if (!scope || input.projectId !== scope.projectId || !input.productBuildId || !input.productProductionId || !input.productProductionTaskKey) throw new Error('[avg-visual-plan] 缺少准确 Work/Build/任务')
  const build = await db.productBuilds.get(input.productBuildId), production = await db.productProductions.get(input.productProductionId)
  if (!build || !production || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' }) || build.productionId !== production.id
    || production.productType !== 'avg' || production.status !== 'producing' || production.currentBuildNumber !== build.buildNumber
    || production.controlEpoch !== build.controlEpoch || production.currentBriefRevision !== build.briefRevision || build.status !== 'building') throw new Error('[avg-visual-plan] 制作来源已 stale 或跨 Work')
  const row = await db.productProductionBriefs.where('[productionId+revision]').equals([production.id!, build.briefRevision]).first()
  if (!row || !await assertRecordInScope(scope, 'productProductionBriefs', row, { owner: 'work' }) || row.status !== 'authorized'
    || row.briefHash !== build.briefHash || row.authorizedAt !== build.authorizedAt) throw new Error('[avg-visual-plan] 缺少准确已授权 Brief')
  const brief = parseProductProductionBriefV3(row.briefJson)
  if (!brief.avgVisualPlanning || await hashProductProductionValueV2(brief) !== build.briefHash) throw new Error('[avg-visual-plan] 专业视觉 Brief 内容或版本不一致')
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash), task = plan.tasks.find(t => t.taskKey === input.productProductionTaskKey)
  if (!task || await hashProductProductionValueV2(plan) !== build.planHash || plan.buildNumber !== build.buildNumber || plan.controlEpoch !== build.controlEpoch
    || canonicalProductProductionJsonV2(input.productArtifactKeys ?? []) !== canonicalProductProductionJsonV2(task.inputArtifactKeys)) throw new Error('[avg-visual-plan] Plan 或准确依赖选择不一致')
  const imageTask = task.kind === 'avg-media-image-generate' && task.executionMode === 'media-provider' && task.skillId === AVG_COMPILED_IMAGE_SKILL_V4
  const image = imageTask ? await readAvgCompiledImageDefinitionV4({ scope, buildId: build.id!, expectedBuildRevision: build.stateRevision,
    controlEpoch: build.controlEpoch, expectedBrief: brief }) : null
  const source = image?.source ?? await readAvgSystemPlanForCompilationV1({ scope, buildId: build.id!, expectedBuildRevision: build.stateRevision,
    controlEpoch: build.controlEpoch, includeSceneScripts: true })
  const canonicalSource = { systemPlan: source.plan, scripts: source.scripts.map(s => s.payload), presentation: { aspectRatio: brief.avgVisualPlanning.scope.aspectRatio } }
  const { sourceInputHash: _hash, aspectRatio: _ratio, ...unhashed } = brief.avgVisualPlanning.scope
  const checked = await freezeAvgVisualPlanningScopeV1(unhashed, canonicalSource)
  if (canonicalProductProductionJsonV2(checked) !== canonicalProductProductionJsonV2(brief.avgVisualPlanning.scope)) throw new Error('[avg-visual-plan] 规则、文本或策划输入已 stale')
  const keys = task.inputArtifactKeys.filter(k => k === 'avg.media.visual-bible' || /^avg\.media\.(character|environment|prop)-brief\./.test(k))
  const adopted = keys.length ? await readAvgConfirmedVisualArtifactsV4({ scope, buildId: build.id!, expectedBuildRevision: build.stateRevision,
    controlEpoch: build.controlEpoch, artifactKeys: keys }) : []
  const bible = adopted.find(row => row.payload.schema === 'storyforge.avg.visual-bible')?.payload
  const compilation = task.kind === 'avg-v4-visual-requirements-compile' && task.executionMode === 'deterministic' && task.contextProfile === 'avg-visual-planning-v4'
  const requirement = image?.definition.mediaBatch.requirements.find(r => task.taskKey === `avg.media.generate.${r.requirementKey}`)
  if (image && !requirement) throw new Error('[avg-visual-image] 当前图片任务不属于准确编译需求')
  const packet = image ? { schema: 'storyforge.avg.visual-planning-inputs', version: 4, sourceInputHash: checked.sourceInputHash,
    aspectRatio: checked.aspectRatio, operation: 'produce-compiled-image', requirement, imageBinding: image.definition.imageBinding,
    compilation: image.definition.compilation }
    : compilation ? { schema: 'storyforge.avg.visual-planning-inputs', version: 4, sourceInputHash: checked.sourceInputHash,
    aspectRatio: checked.aspectRatio, operation: 'compile-adopted-visual-requirements' }
    : projectAvgVisualPlanningTaskV4({ planning: brief.avgVisualPlanning, task, source: canonicalSource,
      visualBible: bible?.schema === 'storyforge.avg.visual-bible' ? bible : undefined })
  const references = compilation ? checked.referenceCatalog : checked.referenceCatalog.filter(ref => 'references' in packet
    && packet.references.some(selected => selected.referenceKey === ref.referenceKey))
  for (const { reference } of references) await verifyAvgReferenceBytesV1(reference, await readAvgDraftReferenceBytesV1(scope, reference))
  for (const template of checked.templates) await validateAvgGeneratedReferencesV1(scope,
    references.filter(ref => template.allowedReferenceKeys.includes(ref.referenceKey)).map(ref => ref.reference), template.parameters.family)
  const availableRefs = [source.artifact, ...source.scripts.map(s => s.artifact), ...adopted.map(row => row.artifact), ...(image ? [image.definition.compilation] : [])]
  if (availableRefs.length !== task.inputArtifactKeys.length || availableRefs.some(r => !task.inputArtifactKeys.includes(r.artifactKey))) throw new Error('[avg-visual-plan] 准确作者依赖不闭合')
  const refs = task.inputArtifactKeys.map(key => availableRefs.find(r => r.artifactKey === key)!)
  const current = await db.productBuilds.get(build.id!), owner = await db.productProductions.get(production.id!)
  if (!current || !owner || current.stateRevision !== build.stateRevision || current.controlEpoch !== build.controlEpoch
    || current.briefHash !== build.briefHash || current.planHash !== build.planHash || current.status !== build.status
    || owner.status !== production.status || owner.controlEpoch !== production.controlEpoch || owner.currentBriefRevision !== production.currentBriefRevision
    || owner.currentBuildNumber !== production.currentBuildNumber) throw new Error('[avg-visual-plan] 读取期间制作状态已变化')
  return canonicalProductProductionJsonV2({ ...packet, taskKey: task.taskKey, productionKey: production.productionKey,
    buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: build.planHash, briefRevision: row.revision, briefHash: build.briefHash,
    sourcePlanHash: row.sourcePlanHash, confirmedBriefHash: row.confirmedBriefHash,
    sourceWorldContentHash: row.sourceWorldContentHash, artifacts: refs, taskBudget: task.budgetReservation })
}
