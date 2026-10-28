import { db } from '../db/schema'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import type { AssembleContextInput } from '../registry/types'
import type { ProductProductionPlanTaskV3 } from '../types'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { readAvgVisualContextAuthority,assertAvgVisualContextFresh } from './visual-planning-context-authority'
import { readAvgSystemPlanForCompilationV1,readAvgConfirmedVisualArtifactsV5 } from './author-artifacts'
import { parseAvgVisualPlanningBriefV5,type AvgVisualPlanningBriefV5 } from './visual-planning-brief-v5'
import { freezeAvgVisualPlanningScopeV2 } from './media-source-v2'
import type { AvgMediaSourceInputV1 } from './media-source'
import { parseAvgVisualBibleV1,type AvgVisualBibleV1 } from './visual-planning-contract'
import { avgVisualRoleTargetV5,isAvgVisualReuseTaskV5 } from './visual-role-proposal-v5'
import { readAvgDraftReferenceBytesV2 } from './editor-service'
import { readAvgCompiledImageDefinitionV5 } from './visual-planning-image-definition-v5'
import { AVG_COMPILED_IMAGE_SKILL_V5 } from './visual-planning-plan-v5'

/** Explicit projection, never a spread of a reference or its portable proof.
 * Raw story text, hidden facts, bytes, license packets and Run ids stay local. */
export function projectAvgVisualPlanningTaskV5(input:{planning:AvgVisualPlanningBriefV5;task:ProductProductionPlanTaskV3;source:AvgMediaSourceInputV1;visualBible?:AvgVisualBibleV1}){
  const planning=parseAvgVisualPlanningBriefV5(input.planning),scope=planning.scope,target=avgVisualRoleTargetV5(input.task,scope),direction=target==='avg.media.visual-bible',reuse=isAvgVisualReuseTaskV5(input.task)
  const reuseSource=reuse?planning.proposalReuse?.find(r=>r.artifact.artifactKey===target):undefined
  if(reuse&&!reuseSource)throw new Error('[avg-visual-reuse] V5 准确岗位没有冻结来源')
  const selected=[...new Map(scope.templates.map(t=>[t.parameters.family.subjectKey,t.subjectKind])).entries()]
    .filter(([key,kind])=>direction||target===`avg.media.${kind}-brief.${key}`)
  const templates=scope.templates.filter(t=>selected.some(([key])=>key===t.parameters.family.subjectKey))
  const bible=input.visualBible?parseAvgVisualBibleV1(input.visualBible):null
  if(!direction&&(!bible||selected.some(([key,kind])=>!bible.subjects.some(s=>s.subjectKey===key&&s.subjectKind===kind))))throw new Error('[avg-visual-plan] 新主体方案缺少准确已确认视觉基准')
  const usedReferences=new Set(templates.flatMap(t=>t.allowedReferenceKeys))
  return {schema:'storyforge.avg.visual-planning-inputs' as const,version:5 as const,...(reuse?{operation:'reuse-confirmed-visual-proposal',reuseSource}:{}),sourceInputHash:scope.sourceInputHash,aspectRatio:scope.aspectRatio,
    subjects:selected.map(([subjectKey,subjectKind])=>({subjectKey,subjectKind,
      name:subjectKind==='character'?input.source.systemPlan.characters.find(c=>c.key===subjectKey)?.displayName
        :subjectKind==='environment'?input.source.systemPlan.scenes.find(s=>s.key===subjectKey)?.title
          :input.source.systemPlan.version===2?input.source.systemPlan.inventory.items.find(i=>i.key===subjectKey)?.name:undefined})),
    requirements:templates.map(t=>({requirementKey:t.parameters.requirementKey,name:t.parameters.name,mediaKind:t.parameters.mediaKind,
      width:t.parameters.width,height:t.parameters.height,alpha:t.parameters.alpha,family:t.parameters.family,
      purpose:{domain:t.parameters.consumer.domain,slot:t.parameters.consumer.slot},requiredDetails:t.requiredDetails,forbiddenDepictions:t.forbiddenDepictions,
      allowedReferenceKeys:t.allowedReferenceKeys,requiredReferenceKeys:t.requiredReferenceKeys})),
    references:scope.referenceCatalog.filter(r=>usedReferences.has(r.referenceKey)).map(({referenceKey,reference:r})=>({referenceKey,
      purpose:r.purpose,allowedChange:r.allowedChange,permittedFeatures:r.contentPolicy.permittedFeatures,excludedFeatures:r.contentPolicy.excludedFeatures,
      observation:'metadata-only; original image not delivered'})),
    visualDirection:bible&&!direction?{style:bible.style,subjects:bible.subjects.filter(s=>selected.some(([key])=>s.subjectKey===key))}:null}
}

/** Registered roles, compiler, original and bounded local processing inputs.
 * Only exact physical raw references enter the zero-provider processing task. */
export async function readAvgVisualPlanningContextV5(input:AssembleContextInput):Promise<string>{
  const authority=await readAvgVisualContextAuthority(input,5),{scope,build,production,row,brief,task,planning}=authority
  const compile=task.kind==='avg-v5-visual-requirements-compile'&&task.executionMode==='deterministic'&&task.contextProfile==='avg-visual-planning-v5'
  const imageTask=task.kind==='avg-media-image-generate'&&task.executionMode==='media-provider'&&task.skillId===AVG_COMPILED_IMAGE_SKILL_V5
  const rawReuse=task.kind==='avg-media-image-reuse'&&task.executionMode==='deterministic'&&task.contextProfile==='avg-visual-planning-v5'
  const processing=task.kind==='avg-media-image-process'&&task.executionMode==='deterministic'&&task.contextProfile==='avg-visual-planning-v5'
  if(!compile&&!imageTask&&!rawReuse&&!processing)avgVisualRoleTargetV5(task,planning.scope)
  const image=imageTask||rawReuse||processing?await readAvgCompiledImageDefinitionV5({scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,expectedBrief:brief}):null
  const source=image?.source??await readAvgSystemPlanForCompilationV1({scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,includeSceneScripts:true})
  const canonicalSource={systemPlan:source.plan,scripts:source.scripts.map(s=>s.payload),presentation:{aspectRatio:planning.scope.aspectRatio}}
  const {sourceInputHash:_hash,aspectRatio:_ratio,...unhashed}=planning.scope
  const checked=await freezeAvgVisualPlanningScopeV2(unhashed,canonicalSource)
  if(canonicalProductProductionJsonV2(checked)!==canonicalProductProductionJsonV2(planning.scope))throw new Error('[avg-visual-plan] 新岗位规则、文本或策划输入已 stale')
  const keys=task.inputArtifactKeys.filter(k=>k==='avg.media.visual-bible'||/^avg\.media\.(character|environment|prop)-brief\./.test(k))
  const adopted=keys.length?await readAvgConfirmedVisualArtifactsV5({scope,buildId:build.id!,expectedBuildRevision:build.stateRevision,controlEpoch:build.controlEpoch,artifactKeys:keys}):[]
  const bible=adopted.find(r=>r.payload.schema==='storyforge.avg.visual-bible')?.payload
  const requirement=image?.definition.mediaBatch.requirements.find(r=>task.taskKey===`${processing?'avg.media.process':'avg.media.generate'}.${r.requirementKey}`)
  if(image&&!requirement)throw new Error('[avg-visual-image] 新图片任务没有准确编译需求')
  const processEntry=processing?planning.imageProcessing?.entries.find(e=>e.requirementKey===requirement!.requirementKey):undefined
  const rawRows=processing?await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([build.id!,`avg.media.raw.${requirement!.requirementKey}`])
    .filter(r=>r.status==='accepted'&&r.controlEpoch===build.controlEpoch).limit(2).toArray():[]
  if(processing&&(!processEntry||rawRows.length!==1))throw new Error('[avg-process] 新版加工缺少准确冻结配方或唯一原图')
  const raw=processing?await verifyAcceptedProductBuildArtifactV1({scope,buildId:build.id!,artifactKey:rawRows[0].artifactKey,
    version:rawRows[0].version,contentHash:rawRows[0].contentHash}):null
  // No portable proof, license packet or Run id is disclosed in this context.
  // The full original requirement is still bound by its canonical hash.
  const packet=image?{schema:'storyforge.avg.visual-planning-inputs',version:5,sourceInputHash:checked.sourceInputHash,aspectRatio:checked.aspectRatio,
    operation:processing?'process-compiled-image':rawReuse?'revalidate-original-compiled-image':'produce-compiled-image',
    ...(processEntry?{processing:processEntry}:{}),...(rawReuse?{rawReuseSource:planning.rawReuse?.find(r=>r.requirementKey===requirement!.requirementKey)}:{}),
    requirementHash:await hashProductProductionValueV2(requirement),
    requirement:{requirementKey:requirement!.requirementKey,revision:requirement!.revision,name:requirement!.name,mediaKind:requirement!.mediaKind,
      family:requirement!.family,width:requirement!.width,height:requirement!.height,resolutionTier:requirement!.resolutionTier,alpha:requirement!.alpha,
      prompt:requirement!.prompt,negativePrompt:requirement!.negativePrompt,invariants:requirement!.invariants,forbiddenDepictions:requirement!.forbiddenDepictions,
      references:requirement!.references.map(r=>({assetKey:r.assetKey,assetVersion:r.assetVersion,contentHash:r.contentHash,purpose:r.purpose,
        allowedChange:r.allowedChange,permittedFeatures:r.contentPolicy.permittedFeatures,excludedFeatures:r.contentPolicy.excludedFeatures,
        observation:'exact original bytes delivered separately to image provider; purpose compliance requires review'}))},
    imageBinding:image.definition.imageBinding,compilation:image.definition.compilation}
    :compile?{schema:'storyforge.avg.visual-planning-inputs',version:5,sourceInputHash:checked.sourceInputHash,aspectRatio:checked.aspectRatio,operation:'compile-adopted-visual-requirements'}
    :projectAvgVisualPlanningTaskV5({planning,task,source:canonicalSource,visualBible:bible?.schema==='storyforge.avg.visual-bible'?bible:undefined})
  const references=compile?checked.referenceCatalog:image?[]:checked.referenceCatalog.filter(ref=>'references' in packet&&packet.references.some(r=>r.referenceKey===ref.referenceKey))
  for(const {referenceKey,reference} of references){
    const targets=checked.templates.filter(t=>t.allowedReferenceKeys.includes(referenceKey))
    const families=[...new Map(targets.map(t=>{const f=t.parameters.family;return [`${f.subjectKey}/${f.familyKey}/${f.revision}`,f] as const})).values()]
    if(reference.purpose==='identity'&&families.length)for(const family of families)await readAvgDraftReferenceBytesV2(scope,reference,family)
    else await readAvgDraftReferenceBytesV2(scope,reference)
  }
  const availableRefs=[source.artifact,...source.scripts.map(s=>s.artifact),...adopted.map(r=>r.artifact),...(image?[image.definition.compilation]:[]),...(raw?[{artifactKey:raw.artifactKey,version:raw.version,contentHash:raw.contentHash}]:[])]
  if(availableRefs.length!==task.inputArtifactKeys.length||availableRefs.some(r=>!task.inputArtifactKeys.includes(r.artifactKey)))throw new Error('[avg-visual-plan] 新岗位准确作者依赖不闭合')
  const refs=task.inputArtifactKeys.map(key=>availableRefs.find(r=>r.artifactKey===key)!)
  await assertAvgVisualContextFresh(authority)
  return canonicalProductProductionJsonV2({...packet,taskKey:task.taskKey,productionKey:production.productionKey,buildNumber:build.buildNumber,
    controlEpoch:build.controlEpoch,planHash:build.planHash,briefRevision:row.revision,briefHash:build.briefHash,sourcePlanHash:row.sourcePlanHash,
    confirmedBriefHash:row.confirmedBriefHash,sourceWorldContentHash:row.sourceWorldContentHash,artifacts:refs,taskBudget:task.budgetReservation})
}
