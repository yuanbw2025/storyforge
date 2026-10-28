import { createAvgAuthoringPresetV1 } from '../../src/lib/avg/authoring-presets'
import { freezeAvgVisualPlanningScopeV1 } from '../../src/lib/avg/media-source'
import { parseAvgVisualPlanningBriefV4 } from '../../src/lib/avg/visual-planning-brief'
import { avgVisualPlanningBudgetV4, avgVisualPlanningGateIdsV4, AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V4 } from '../../src/lib/avg/visual-planning-policy'
import { AVG_VISUAL_TEXT_CAPABILITY_V4 } from '../../src/lib/avg/visual-planning-roles'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import type { ProviderCapabilityRequirementV1 } from '../../src/lib/types'
import { prepareNativeAvgAssembly } from './avg-production-assembly-fixture'
import { avgVoiceAssemblyFixtureV3 } from './avg-voice-production-fixture'

/** Actual S2 V1 setup supplies a valid full outer Brief and isolated Work.
 * V4 itself cannot be saved/started yet; this is a contract fixture, not a Run. */
export async function avgVisualPlanningFixtureV4(mode: 'evidence' | 'linear' = 'evidence') {
  const source = createAvgAuthoringPresetV1(mode), owner = await prepareNativeAvgAssembly(source)
  const brief = parseProductProductionBriefV3(owner.details.brief!.briefJson)
  delete brief.avgAssembly
  const { assembly, capabilities } = await avgVoiceAssemblyFixtureV3(true), original = assembly.image!.mediaBatch.requirements[0]
  const { prompt: _prompt, negativePrompt: _negative, invariants: _invariants, forbiddenDepictions: _forbidden, references: _references, ...parameters } = structuredClone(original)
  const sceneKey = source.systemPlan.scenes[0].key
  parameters.requirementKey = `${sceneKey}.background`; parameters.assetKey = `${sceneKey}.background`
  parameters.family.subjectKey = sceneKey; parameters.family.familyKey = `${sceneKey}.light`
  parameters.consumer.subjectKey = parameters.consumer.sceneKey = sceneKey
  parameters.consumer.consumerKey = `${sceneKey}.background`; parameters.triggerBeatKey = source.scripts[0].lines[0].lineKey
  const scope = await freezeAvgVisualPlanningScopeV1({ schema: 'storyforge.avg.visual-planning-scope', version: 1,
    batchKey: 'professional.visual.contract', revision: 1, referenceCatalog: [], templates: [{ subjectKind: 'environment', parameters,
      requiredDetails: ['作者确认的房间布局；对白区域留白'], forbiddenDepictions: ['不得新增剧情秘密'], allowedReferenceKeys: [], requiredReferenceKeys: [] }] }, source)
  const avgVisualPlanning = parseAvgVisualPlanningBriefV4({ schema: 'storyforge.avg.visual-planning-brief', version: 4,
    assembly: { schema: 'storyforge.avg.assembly-brief', version: 1, title: '原创视觉合同夹具', sceneKeys: source.systemPlan.scenes.map(s => s.key),
      mediaAssetKeys: [parameters.assetKey], basePackageHash: null }, scope, imageBinding: assembly.image!.imageBinding })
  const text: ProviderCapabilityRequirementV1 = { requirementKey: AVG_VISUAL_TEXT_CAPABILITY_V4, mediaClass: 'text', operation: 'generate',
    adapterFamily: 'text-model', minimumCapabilityVersion: '1', allowedDataClasses: [AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V4],
    maximumRequestCost: null, maximumTotalCost: null, rightsPolicyVersion: 'fixture-text-rights', capabilityHash: 'b'.repeat(64), required: true }
  brief.avgVisualPlanning = avgVisualPlanning
  brief.capabilityRequirements = [text, capabilities.find(c => c.mediaClass === 'image')!]
  brief.consultationBudget = { maximumModelCalls: 0, maximumInputTokens: 0, maximumOutputTokens: 0, maximumCostUsd: 0 }
  brief.productionBudget = avgVisualPlanningBudgetV4(brief)
  brief.media = { visualLevel: 'key-scenes', audioLevel: 'none', imageCount: 1, voiceLineCount: 0, musicTrackCount: 0, sfxCount: 0, requiredMediaKinds: ['background'] }
  brief.externalDataPolicy = { allowedDataClasses: ['image-prompt', AVG_VISUAL_PLANNING_TEXT_DATA_CLASS_V4], forbiddenDataClasses: [], allowReferenceImages: false, allowVoiceScripts: false }
  brief.fallbackPolicy = { allowTextOnly: false, allowExistingProjectMedia: true, allowProceduralAudio: false, onRequiredCapabilityMissing: 'pause' }
  brief.completionContract = { requiresPlayablePreview: true, requiredGateIds: avgVisualPlanningGateIdsV4(brief), minimumMediaCoverage: 1, allowSoftWaivers: false }
  return { source, owner, planning: avgVisualPlanning, brief: parseProductProductionBriefV3(brief) }
}
