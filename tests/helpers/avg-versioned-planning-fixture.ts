import { avgProfessionalFamilyScopeFixtureV4 } from './avg-professional-family-scope-fixture'
import type { AvgMediaReferenceV1 } from '../../src/lib/avg/media-reference-contract'
import type { AvgMediaReferenceV2 } from '../../src/lib/avg/media-reference-contract-v2'
import type { AvgMediaBriefV1, AvgVisualBibleV1 } from '../../src/lib/avg/visual-planning-contract'

/** Pure author intent, no Blob, credentials, model, Run or adoption. */
export function avgVersionedPlanningFixture() {
  const {workspace:source,planning}=avgProfessionalFamilyScopeFixtureV4('versioned')
  if(source.systemPlan.version!==2)throw new Error('Expected inventory fixture')
  for(const t of planning.templates){
    if(t.subjectKind==='prop'){
      const item=source.systemPlan.inventory.items.find(i=>i.key===t.parameters.consumer.subjectKey)!
      if(t.parameters.consumer.slot==='icon')item.iconAssetKey=t.parameters.assetKey
      else item.detailAssetKey=t.parameters.assetKey
    }
    t.allowedReferenceKeys=['ref.style',...(t.subjectKind==='character'?['ref.identity']:[])]
    t.requiredReferenceKeys=[...t.allowedReferenceKeys]
  }
  const reference=(assetKey:string,purpose:AvgMediaReferenceV1['purpose']):AvgMediaReferenceV1=>({
    assetKey,assetVersion:1,contentHash:(purpose==='identity'?'a':'b').repeat(64),mimeType:'image/png',byteSize:128,purpose,
    allowedChange:'仅允许冻结需求中的变更',dataClass:'avg-authorized-reference',license:'原创工程元数据，不证明真实字节或商用权',
    providerInputAllowed:true,derivativeUseAllowed:true,crop:null,mask:null})
  const catalog=[{referenceKey:'ref.style',reference:reference('original.style','style')},
    {referenceKey:'ref.identity',reference:reference('original.identity','identity')}]
  const versioned=catalog.map(entry=>({...entry,reference:{...entry.reference,schema:'storyforge.avg.media-reference' as const,version:2 as const,
    contentPolicy:{permittedFeatures:entry.reference.purpose==='identity'?['脸部比例与服装轮廓']:['冷暖配色与绘制笔触'],excludedFeatures:['蜡封信件','发光按钮']}} satisfies AvgMediaReferenceV2}))
  const subjects=[...new Map(planning.templates.map(t=>[t.parameters.family.subjectKey,t])).values()]
  const visualBible:AvgVisualBibleV1={schema:'storyforge.avg.visual-bible',version:1,
    style:{medium:'二维插画',rendering:'清晰轮廓',palette:['冷青','暖赭'],lighting:'关闭机械开关，仅自然弱光',composition:'保留对白安全区'},
    subjects:subjects.map(t=>({subjectKey:t.parameters.family.subjectKey,subjectKind:t.subjectKind,identityInvariants:['保持已确认主体'],allowedChanges:['仅本需求允许变化'],forbiddenDepictions:['新增剧情物件']}))}
  const mediaBriefs:AvgMediaBriefV1[]=subjects.map(t=>({schema:'storyforge.avg.media-brief',version:1,subjectKey:t.parameters.family.subjectKey,subjectKind:t.subjectKind,
    designIntent:'使用准确消费者与参考范围',outputs:planning.templates.filter(x=>x.parameters.family.subjectKey===t.parameters.family.subjectKey).map(x=>({
      requirementKey:x.parameters.requirementKey,prompt:'准确表现作者确认的主体',negativePrompt:'发光开关',invariants:['保留明确细节'],forbiddenDepictions:['蜡封信件'],referenceKeys:[...x.requiredReferenceKeys]}))}))
  return {source,legacy:{...planning,referenceCatalog:catalog},versioned:{...planning,version:2 as const,referenceCatalog:versioned},visualBible,mediaBriefs}
}
