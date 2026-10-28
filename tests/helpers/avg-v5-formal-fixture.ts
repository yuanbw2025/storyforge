import { avgVersionedPlanningFixture } from './avg-versioned-planning-fixture'
import { prepareNativeAvgAssembly } from './avg-production-assembly-fixture'
import { avgVoiceAssemblyFixtureV3 } from './avg-voice-production-fixture'
import { freezeAvgVisualPlanningScopeV2 } from '../../src/lib/avg/media-production-v2'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseAvgVisualPlanningBriefV5 } from '../../src/lib/avg/visual-planning-brief-v5'
import { avgVisualPlanningBudgetV5,avgVisualPlanningGateIdsV5,AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V5 } from '../../src/lib/avg/visual-planning-policy-v5'
import { AVG_VISUAL_TEXT_CAPABILITY_V4 } from '../../src/lib/avg/visual-planning-roles'
import type { ProviderCapabilityRequirementV1 } from '../../src/lib/types'

/** Actual isolated S2 owner and author draft; references are declared engineering
 * metadata, not verified bytes or rights. No saved V5 Brief, Build or Run. */
export async function avgV5FormalFixture(){
  const author=avgVersionedPlanningFixture(),owner=await prepareNativeAvgAssembly(author.source)
  const base=parseProductProductionBriefV3(owner.details.brief!.briefJson);delete base.avgAssembly
  const image=await avgVoiceAssemblyFixtureV3(true),scope=await freezeAvgVisualPlanningScopeV2(author.versioned,author.source)
  const planning=parseAvgVisualPlanningBriefV5({schema:'storyforge.avg.visual-planning-brief',version:5,
    assembly:{schema:'storyforge.avg.assembly-brief',version:1,title:'新版专业媒资合同工程夹具',sceneKeys:author.source.systemPlan.scenes.map(s=>s.key),
      mediaAssetKeys:scope.templates.filter(t=>t.parameters.consumer.domain!=='reference').map(t=>t.parameters.assetKey),basePackageHash:null},scope,imageBinding:image.assembly.image!.imageBinding})
  const text:ProviderCapabilityRequirementV1={requirementKey:AVG_VISUAL_TEXT_CAPABILITY_V4,mediaClass:'text',operation:'generate',adapterFamily:'text-model',minimumCapabilityVersion:'1',
    allowedDataClasses:[AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V5],maximumRequestCost:null,maximumTotalCost:null,rightsPolicyVersion:'fixture-text-rights',capabilityHash:'b'.repeat(64),required:true}
  const imageCapability={...image.capabilities.find(c=>c.mediaClass==='image')!,allowedDataClasses:['image-prompt','avg-authorized-reference']}
  const proposed={...base,avgVisualPlanning:planning,capabilityRequirements:[text,imageCapability]}
  const budget=avgVisualPlanningBudgetV5(proposed)
  const brief=parseProductProductionBriefV3({...proposed,productionBudget:budget,
    capabilityRequirements:proposed.capabilityRequirements.map(c=>({...c,maximumTotalCost:budget.maximumCostUsd})),
    consultationBudget:{maximumModelCalls:0,maximumInputTokens:0,maximumOutputTokens:0,maximumCostUsd:0},
    media:{visualLevel:'key-scenes',audioLevel:'none',imageCount:scope.templates.length,voiceLineCount:0,musicTrackCount:0,sfxCount:0,
      requiredMediaKinds:[...new Set(scope.templates.map(t=>t.parameters.mediaKind))]},
    externalDataPolicy:{allowedDataClasses:['image-prompt','avg-authorized-reference',AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V5],forbiddenDataClasses:[],allowReferenceImages:true,allowVoiceScripts:false},
    fallbackPolicy:{allowTextOnly:false,allowExistingProjectMedia:true,allowProceduralAudio:false,onRequiredCapabilityMissing:'pause'},
    completionContract:{requiresPlayablePreview:true,requiredGateIds:avgVisualPlanningGateIdsV5(proposed),minimumMediaCoverage:1,allowSoftWaivers:false}})
  return {owner,author,planning,brief:{...brief,avgVisualPlanning:planning}}
}
