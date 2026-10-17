import { db } from '../db/schema'
import type { ProductProductionBriefV3, WorkspaceScope } from '../types'
import { resolveScope, assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { readAvgConfirmedVisualArtifactsV4, readAvgSystemPlanForCompilationV1, readAvgFrozenVisualSourceInputsV4 } from './author-artifacts'
import { assertAvgVisualPlanningProposalV1 } from './media-source'
import { AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4 } from './visual-planning-plan'
import { verifyAvgReferenceBytesV1, AVG_IMAGE_REFERENCE_CAPABILITY_V1 } from './media-reference-contract'
import { readAvgDraftReferenceBytesV1 } from './editor-service'
import { validateAvgGeneratedReferencesV1 } from './media-generated-reference'
import { prepareAvgRawImageRequestFromBatchV1 } from './media-raw-contract'

/** V4 requests come from an actual accepted compiler artifact. This is a
 * read-only current-Build authority check, never a synthesized V2 Brief or
 * permission to resume imported history. Callers retain the original Brief. */
export async function readAvgCompiledImageDefinitionV4(input: {
  scope: WorkspaceScope; buildId: number; expectedBuildRevision: number; controlEpoch: number
  expectedBrief?: ProductProductionBriefV3
  purpose?: 'assembly' | 'frozen-verification'
}) {
  const scope = await resolveScope({ scope: input.scope }), build = await db.productBuilds.get(input.buildId)
  const frozen=input.purpose==='frozen-verification'
  if (!build?.id || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || !(frozen?['building','validating','preview-ready','release-ready','released']:input.purpose==='assembly'?['building','integrating']:['building']).includes(build.status)
    || (frozen? !build.packageHash||!build.previewHash||!build.rootTerminalReceiptHash:!!build.packageHash||!!build.previewHash||build.releasedProductReleaseId!=null)
    || build.stateRevision !== input.expectedBuildRevision || build.controlEpoch !== input.controlEpoch) throw new Error('[avg-visual-image] 准确当前 Build 已 stale 或跨 Work')
  const production = await db.productProductions.get(build.productionId)
  const briefRow = await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || production.productType !== 'avg' || !frozen&&(production.status !== 'producing' || production.currentBuildNumber !== build.buildNumber
    || production.controlEpoch !== build.controlEpoch || production.currentBriefRevision !== build.briefRevision)
    || !briefRow || !await assertRecordInScope(scope, 'productProductionBriefs', briefRow, { owner: 'work' })
    || briefRow.status !== 'authorized' || briefRow.briefHash !== build.briefHash || briefRow.authorizedAt !== build.authorizedAt) throw new Error('[avg-visual-image] 缺少准确当前 V4 授权来源')
  const brief = parseProductProductionBriefV3(briefRow.briefJson), planning = brief.avgVisualPlanning
  const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
  if (!planning || await hashProductProductionValueV2(brief) !== build.briefHash
    || input.expectedBrief && !same(input.expectedBrief, brief)) throw new Error('[avg-visual-image] 实际完整 V4 Brief 不一致')
  const capability = brief.capabilityRequirements.find(c => c.requirementKey === 'avg.media.image')!
  if (capability.capabilityHash !== await hashProductProductionValueV2(AVG_IMAGE_REFERENCE_CAPABILITY_V1)) throw new Error('[avg-visual-image] 图片能力不是当前冻结参考输入协议')
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  const compiler = plan.tasks.find(t => t.kind === 'avg-v4-visual-requirements-compile')
  if (!compiler || plan.controlEpoch !== build.controlEpoch || plan.buildNumber !== build.buildNumber
    || await hashProductProductionValueV2(plan) !== build.planHash || !same(plan, JSON.parse(build.planJson))) throw new Error('[avg-visual-image] 编译任务不属于当前准确固定 Plan')
  const rows = await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id, AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4])
    .filter(r => r.status === 'accepted' && r.controlEpoch === build.controlEpoch).toArray()
  if (rows.length !== 1) throw new Error('[avg-visual-image] 图片需求尚未准确编译/接收')
  const compilation = await verifyAcceptedProductBuildArtifactV1({ scope, buildId: build.id, artifactKey: rows[0].artifactKey,
    version: rows[0].version, contentHash: rows[0].contentHash })
  const boundary={scope,buildId:build.id,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch}
  const source = frozen?await readAvgFrozenVisualSourceInputsV4(boundary):await readAvgSystemPlanForCompilationV1({...boundary,includeSceneScripts:true})
  const visualKeys = compiler.inputArtifactKeys.filter(k => k === 'avg.media.visual-bible' || /^avg\.media\.(character|environment|prop)-brief\./.test(k))
  const visual = await readAvgConfirmedVisualArtifactsV4({ scope, buildId: build.id, expectedBuildRevision: build.stateRevision,
    controlEpoch: build.controlEpoch, artifactKeys: visualKeys },frozen)
  const visualBible = visual.find(r => r.payload.schema === 'storyforge.avg.visual-bible')?.payload
  const mediaBriefs = visual.filter(r => r.payload.schema === 'storyforge.avg.media-brief').map(r => r.payload)
  const proposal = await assertAvgVisualPlanningProposalV1(compilation.payloadJson, { scope: planning.scope, visualBible, mediaBriefs,
    source: { systemPlan: source.plan, scripts: source.scripts.map(s => s.payload), presentation: { aspectRatio: planning.scope.aspectRatio } } })
  const available = [source.artifact, ...source.scripts.map(s => s.artifact), ...visual.map(v => v.artifact)]
  const inputs = compiler.inputArtifactKeys.map(key => available.find(r => r.artifactKey === key))
  if (available.length !== inputs.length || new Set(available.map(r => r.artifactKey)).size !== inputs.length || inputs.some(r => !r)
    || !same(JSON.parse(compilation.qualityJson), { schema: 'storyforge.avg.visual-compilation-evidence', version: 1,
      scopeHash: await hashProductProductionValueV2(planning.scope), inputs })) throw new Error('[avg-visual-image] 需求工件未绑定准确已采用输入')
  for (const requirement of proposal.batch.requirements) {
    for (const reference of requirement.references) await verifyAvgReferenceBytesV1(reference, await readAvgDraftReferenceBytesV1(scope, reference))
    await validateAvgGeneratedReferencesV1(scope, requirement.references, requirement.family)
  }
  const current = await db.productBuilds.get(build.id)
  if (!same(current, build) || !same(await db.productProductions.get(production.id!), production)
    || !same(await db.productProductionBriefs.get(briefRow.id!), briefRow)
    || !same(await db.productBuildArtifacts.get(compilation.id!), compilation)) throw new Error('[avg-visual-image] 编译来源在读取期间变化')
  return { brief, planning, build, production, plan, compiler, compilation, proposal, source, visual, capability,
    definition: { schema: 'storyforge.avg.compiled-image-definition' as const, version: 4 as const,
      assembly: planning.assembly, mediaBatch: proposal.batch, imageBinding: planning.imageBinding,
      compilation: { artifactKey: compilation.artifactKey, version: compilation.version, contentHash: compilation.contentHash } } }
}

export async function prepareAvgCompiledImageRequestV4(input: Parameters<typeof readAvgCompiledImageDefinitionV4>[0] & {
  requirementKey: string; idempotencyKey: string
}) {
  if(input.purpose)throw new Error('[avg-visual-image] 组装或冻结只读证明不能授予图片请求权')
  const resolved = await readAvgCompiledImageDefinitionV4(input)
  const frozen = await prepareAvgRawImageRequestFromBatchV1({ batch: resolved.definition.mediaBatch, capability: resolved.capability,
    qualityProfile: resolved.brief.qualityProfile, requirementKey: input.requirementKey, idempotencyKey: input.idempotencyKey })
  return { resolved, frozen }
}
