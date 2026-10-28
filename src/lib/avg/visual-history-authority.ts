import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1,ProductProductionBriefV3,WorkspaceScope } from '../types'
import { assertRecordInScope,resolveScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { verifyHistoricalAvgVisualPlanningArtifactV4,verifyHistoricalAvgVisualPlanningArtifactV5 } from '../product-production/artifact-store'
import { readAvgHistoricalVisualArtifactsV4,readAvgHistoricalVisualArtifactsV5 } from './author-artifacts'
import { parseAvgProfessionalArtifactV1 } from './artifact-contract'
import { AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4 } from './visual-planning-plan'
import { avgImageReferenceCapabilityV2 } from './media-reference-contract'

type Ref={artifactKey:string;version:number;contentHash:string}
const ref=(r:ProductBuildArtifactRecordV1):Ref=>({artifactKey:r.artifactKey,version:r.version,contentHash:r.contentHash})
const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
export interface AvgHistoricalVisualBoundary {
  scope:WorkspaceScope;buildId:number;expectedBuildRevision:number;controlEpoch:number
  expectedBriefHash:string;expectedPlanHash:string
}
/** One read-only original dependency graph. Versioned callers still validate
 * their own proposal, reference permission, raw image and author review. */
export async function readAvgHistoricalVisualCompilationInputs<V extends 4|5>(input:AvgHistoricalVisualBoundary,version:V){
  const scope=await resolveScope({scope:input.scope}),build=await db.productBuilds.get(input.buildId)
  if(!build?.id||!await assertRecordInScope(scope,'productBuilds',build,{owner:'work'})
    ||build.stateRevision!==input.expectedBuildRevision||build.briefHash!==input.expectedBriefHash||build.planHash!==input.expectedPlanHash
    ||!Number.isSafeInteger(input.controlEpoch)||input.controlEpoch<0||input.controlEpoch>build.controlEpoch
    ||!['paused','cancelled','failed','recovery-required','preview-ready','release-ready','released'].includes(build.status))throw new Error('[avg-visual-history] 图片来源不是准确已停止或冻结版本')
  const production=await db.productProductions.get(build.productionId)
  const briefRow=await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId,build.briefRevision]).first()
  if(!production||production.productType!=='avg'||!await assertRecordInScope(scope,'productProductions',production,{owner:'work'})
    ||!briefRow||!await assertRecordInScope(scope,'productProductionBriefs',briefRow,{owner:'work'})
    ||!['authorized','superseded'].includes(briefRow.status)||briefRow.briefHash!==build.briefHash||briefRow.authorizedAt!==build.authorizedAt)throw new Error('[avg-visual-history] 原图片缺少准确授权来源')
  const brief=parseProductProductionBriefV3(briefRow.briefJson),originalPlanning=brief.avgVisualPlanning
  if(originalPlanning?.version!==version||await hashProductProductionValueV2(brief)!==build.briefHash)throw new Error('[avg-visual-history] 需要原始完整版本化图片合同')
  const planning=originalPlanning as Extract<NonNullable<ProductProductionBriefV3['avgVisualPlanning']>,{version:V}>
  const capability=brief.capabilityRequirements.find(c=>c.requirementKey==='avg.media.image')
  if(!capability||capability.capabilityHash!==await hashProductProductionValueV2(avgImageReferenceCapabilityV2(planning.imageBinding.adapterId)))throw new Error('[avg-visual-history] 原图片模型与能力不一致')
  const plan=parseProductProductionPlanV3(build.planJson,brief,build.briefHash)
  if(plan.controlEpoch!==input.controlEpoch||plan.buildNumber!==build.buildNumber||await hashProductProductionValueV2(plan)!==build.planHash)throw new Error('[avg-visual-history] 原图片 Plan/epoch 不一致')
  const compiler=plan.tasks.find(t=>t.kind===`avg-v${version}-visual-requirements-compile`)
  if(!compiler||!same(compiler.outputArtifactKeys,[AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4]))throw new Error('[avg-visual-history] 原编译任务缺失')
  const rows=await db.productBuildArtifacts.where('buildId').equals(build.id).toArray()
  const exact=(key:string)=>{
    const matches=rows.filter(r=>r.status==='accepted'&&r.controlEpoch===input.controlEpoch&&r.artifactKey===key)
    if(matches.length!==1)throw new Error(`[avg-visual-history] 原输入不唯一或缺失：${key}`)
    return matches[0]
  }
  const proofInput={scope,buildId:build.id,expectedBuildRevision:build.stateRevision,expectedBriefHash:build.briefHash,
    expectedPlanHash:build.planHash,sourceControlEpoch:input.controlEpoch}
  const compilation=await (version===5?verifyHistoricalAvgVisualPlanningArtifactV5:verifyHistoricalAvgVisualPlanningArtifactV4)({...proofInput,...ref(exact(AVG_VISUAL_REQUIREMENTS_ARTIFACT_V4))})
  const visualKeys=compiler.inputArtifactKeys.filter(k=>k==='avg.media.visual-bible'||/^avg\.media\.(character|environment|prop)-brief\./.test(k))
  const visual=visualKeys.length?await (version===5?readAvgHistoricalVisualArtifactsV5:readAvgHistoricalVisualArtifactsV4)({scope,buildId:build.id,expectedBuildRevision:build.stateRevision,
    controlEpoch:input.controlEpoch,expectedBriefHash:build.briefHash,expectedPlanHash:build.planHash,artifacts:visualKeys.map(key=>ref(exact(key)))}):[]
  const witnessed=new Map<string,Ref>()
  for(const history of visual){
    for(const witness of [...history.inputs,history.artifact]){
      const old=witnessed.get(witness.artifactKey)
      if(old&&!same(old,witness))throw new Error('[avg-visual-history] 原作者来源见证相互冲突')
      witnessed.set(witness.artifactKey,witness)
    }
  }
  const inputs=compiler.inputArtifactKeys.map(key=>{
    const row=exact(key),witness=witnessed.get(key)
    if(!witness||!same(witness,ref(row)))throw new Error('[avg-visual-history] 编译输入缺少实际原作者见证')
    return row
  })
  const rule=exact('avg.system.plan'),systemPlan=parseAvgProfessionalArtifactV1(rule.payloadJson)
  if(systemPlan.schema!=='storyforge.avg.system-plan')throw new Error('[avg-visual-history] 原规则不是准确正式系统')
  const scripts=systemPlan.scenes.map(scene=>{
    const row=exact(`avg.content.scene-script.${scene.key}`),payload=parseAvgProfessionalArtifactV1(row.payloadJson)
    if(payload.schema!=='storyforge.avg.scene-script'||!inputs.some(i=>same(ref(i),ref(row))))throw new Error('[avg-visual-history] 原脚本缺少编译来源')
    return {payload,artifact:ref(row)}
  })
  if(inputs.length!==1+scripts.length+visual.length||!inputs.some(i=>same(ref(i),ref(rule))))throw new Error('[avg-visual-history] 原编译依赖域不完整')
  return {scope,brief,planning,build:{...build,id:build.id},production,plan,compiler,compilation,capability,inputs,visual,systemPlan,rule,scripts,
    records:{brief:briefRow,artifacts:[...new Map([compilation,...inputs,...rows.filter(r=>r.status==='accepted'&&r.controlEpoch===input.controlEpoch&&r.artifactKey.startsWith('avg.proposal.'))].map(r=>[r.id,r])).values()]},source:{plan:systemPlan,artifact:ref(rule),scripts}}
}
type Sources=Pick<Awaited<ReturnType<typeof readAvgHistoricalVisualCompilationInputs>>,'scope'|'build'|'production'|'records'>
export async function assertAvgHistoricalVisualSourcesFresh(resolved:Sources){
  if(!same(await db.productBuilds.get(resolved.build.id),resolved.build)
    ||!same(await db.productProductions.get(resolved.production.id!),resolved.production)
    ||!same(await db.productProductionBriefs.get(resolved.records.brief.id!),resolved.records.brief))throw new Error('[avg-visual-history] 原图片来源在读取期间变化，请重新读取')
  for(const row of resolved.records.artifacts)if(!await assertRecordInScope(resolved.scope,'productBuildArtifacts',row,{owner:'work'})
    ||!same(await db.productBuildArtifacts.get(row.id!),row))throw new Error('[avg-visual-history] 原作者或编译输入在读取期间变化')
}
