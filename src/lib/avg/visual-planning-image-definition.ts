import { db } from '../db/schema'
import { readAvgCompiledImageAuthority } from './visual-image-authority'
import type { ProductBuildRecordV1, ProductProductionBriefV3, WorkspaceScope } from '../types'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { readAvgConfirmedVisualArtifactsV4, readAvgSystemPlanForCompilationV1, readAvgFrozenVisualSourceInputsV4 } from './author-artifacts'
import { assertAvgVisualPlanningProposalV1 } from './media-source'
import { AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4 } from './visual-planning-plan'
import { verifyAvgReferenceBytesV1 } from './media-reference-contract'
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
  const {scope,build,production,briefRow,brief,planning,capability,plan,compiler,frozen,same}=await readAvgCompiledImageAuthority(input,4)
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
  return { brief, planning, build:build as ProductBuildRecordV1, production, plan, compiler, compilation, proposal, source, visual, capability,
    definition: { schema: 'storyforge.avg.compiled-image-definition' as const, version: 4 as const,
      assembly: planning.assembly, mediaBatch: proposal.batch, imageBinding: planning.imageBinding,
      ...(planning.imageProcessing?{imageProcessing:planning.imageProcessing}:{}),
      compilation: { artifactKey: compilation.artifactKey, version: compilation.version, contentHash: compilation.contentHash } } }
}

export async function prepareAvgCompiledImageRequestV4(input: Parameters<typeof readAvgCompiledImageDefinitionV4>[0] & {
  requirementKey: string; idempotencyKey: string
}) {
  if(input.purpose)throw new Error('[avg-visual-image] 组装或冻结只读证明不能授予图片请求权')
  const resolved = await readAvgCompiledImageDefinitionV4(input)
  const frozen = await prepareAvgRawImageRequestFromBatchV1({ batch: resolved.definition.mediaBatch, capability: resolved.capability,
    qualityProfile: resolved.brief.qualityProfile, requirementKey: input.requirementKey, idempotencyKey: input.idempotencyKey,adapterId:resolved.definition.imageBinding.adapterId })
  return { resolved, frozen }
}
