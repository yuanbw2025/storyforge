import { createAvgAuthoringPresetV1 } from '../../src/lib/avg/authoring-presets'
import { prepareNativeAvgAssembly } from './avg-production-assembly-fixture'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { importAvgMediaV1 } from '../../src/lib/avg/editor-service'
import type { AvgCharacterFamilyPlanV1 } from '../../src/lib/avg/character-family-contract'

const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0)).buffer
export const AVG_FAMILY_FOREGROUND_DECLARATION_FIXTURE='工程作者明确纯品红仅作背景、主体不使用该色，并允许本地分离与共同画布；结果仍待实际视觉评审，不签艺术通过。'

/** Actual isolated Work and imported baseline; no Build, model or simulated author receipt. */
export async function avgFamilyForegroundFixture(){
 const source=createAvgAuthoringPresetV1('evidence'),owner=await prepareNativeAvgAssembly(source)
 const asset=await importAvgMediaV1({scope:owner.scope,data:png,mimeType:'image/png',name:'原创身份工程参考',kind:'character-pose',license:'原创工程像素，不代表人物美术/外部确权',altText:'工程参考',characterTag:'keeper'})
 const plan:AvgCharacterFamilyPlanV1={schema:'storyforge.avg.character-family-plan',version:1,familyKey:'keeper',revision:1,subjectKey:'keeper',name:'保管员家族',
  baseline:{assetKey:asset.assetKey,assetVersion:asset.version,contentHash:asset.contentHash,mimeType:'image/png',byteSize:asset.byteSize,license:asset.license},
  stylePrompt:'原创工程人物',identityInvariants:['白色衬衣与蓝色外套'],negativePrompt:'不得出现文字',forbiddenDepictions:['新增道具'],allowedChange:'保留人物公开造型，姿态/表情与背景按明确声明变化',
  width:576,height:768,resolutionTier:'1K',alpha:'required',variants:source.scripts.slice(0,2).map((s,i)=>({variantKey:i?'smile':'neutral',name:i?'微笑':'平静',mediaKind:i?'character-expression':'character-pose',changeDescription:i?'微笑表情':'平静站立',sceneKey:s.sceneKey,lineKey:s.lines[0].lineKey}))}
 return {source,owner,plan,draft:await readAvgDraftV1(owner.scope)}
}
