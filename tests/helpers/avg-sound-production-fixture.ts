import { avgSoundPlanningFixtureV1 } from './avg-sound-planning-fixture'
import { prepareNativeAvgAssembly } from './avg-production-assembly-fixture'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { parseAvgSoundPlanningBriefV1, AVG_SOUND_TEXT_CAPABILITY_V1, AVG_SOUND_MUSIC_CAPABILITY_V1,
  AVG_SOUND_TEXT_DATA_CLASS_V1, AVG_SOUND_MUSIC_DATA_CLASS_V1 } from '../../src/lib/avg/sound-production-brief'
import { avgSoundProductionBudgetV1, avgSoundProductionGateIdsV1 } from '../../src/lib/avg/sound-production-policy'

/** Real isolated S2 supplies the outer Brief. The sound contract itself is not
 * started and this fixture grants no sound producer/Run/audio acceptance. */
export async function avgSoundProductionFixtureV1(libraryOnly = false) {
  const s = await avgSoundPlanningFixtureV1(), owner = await prepareNativeAvgAssembly(s.workspace)
  const brief = parseProductProductionBriefV3(owner.details.brief!.briefJson), legacy = structuredClone(brief)
  const scope = structuredClone(s.scope)
  if (libraryOnly) scope.templates = scope.templates.filter(t => t.source.kind === 'licensed-library')
  const assembly = { ...brief.avgAssembly!, version: 1 as const,
    mediaAssetKeys: [...new Set([...s.workspace.presentation.stage.assets.map(a => a.assetKey), ...scope.templates.map(t => t.assetKey)])] }
  delete brief.avgAssembly
  brief.avgSoundPlanning = parseAvgSoundPlanningBriefV1({ schema: 'storyforge.avg.sound-planning-brief', version: 1,
    assembly, aspectRatio: s.workspace.presentation.aspectRatio, scope, musicBinding: libraryOnly ? null : { adapterId: 'storyforge.avg.local-music.v1', requirementKey: AVG_SOUND_MUSIC_CAPABILITY_V1,
      bindingHash: 'a'.repeat(64), endpointRouteHash: 'b'.repeat(64) } })
  brief.capabilityRequirements = [{ requirementKey: AVG_SOUND_TEXT_CAPABILITY_V1, mediaClass: 'text', operation: 'generate',
    adapterFamily: 'text-model', minimumCapabilityVersion: '1', allowedDataClasses: [AVG_SOUND_TEXT_DATA_CLASS_V1],
    maximumRequestCost: null, maximumTotalCost: null, rightsPolicyVersion: 'fixture-text-rights', capabilityHash: 'c'.repeat(64), required: true },
  ...libraryOnly ? [] : [{ requirementKey: AVG_SOUND_MUSIC_CAPABILITY_V1, mediaClass: 'music' as const, operation: 'generate',
    adapterFamily: 'storyforge-local-music', minimumCapabilityVersion: '1', allowedDataClasses: [AVG_SOUND_MUSIC_DATA_CLASS_V1],
    maximumRequestCost: 0, maximumTotalCost: 0, rightsPolicyVersion: 'fixture-local-rights', capabilityHash: 'a'.repeat(64), required: true }]]
  brief.productionBudget = avgSoundProductionBudgetV1(brief)
  brief.media = { visualLevel: 'none', audioLevel: 'music-sfx', imageCount: 0, voiceLineCount: 0,
    musicTrackCount: libraryOnly ? 0 : 1, sfxCount: 1, requiredMediaKinds: libraryOnly ? ['sfx'] : ['bgm', 'sfx'] }
  brief.externalDataPolicy = { ...brief.externalDataPolicy, allowedDataClasses: [AVG_SOUND_TEXT_DATA_CLASS_V1, ...libraryOnly ? [] : [AVG_SOUND_MUSIC_DATA_CLASS_V1]],
    forbiddenDataClasses: [], allowReferenceImages: false, allowVoiceScripts: false }
  brief.fallbackPolicy = { ...brief.fallbackPolicy, allowTextOnly: false, allowProceduralAudio: false, allowExistingProjectMedia: true, onRequiredCapabilityMissing: 'pause' }
  brief.completionContract = { requiresPlayablePreview: true, requiredGateIds: avgSoundProductionGateIdsV1(brief), minimumMediaCoverage: 1, allowSoftWaivers: false }
  return { ...s, owner, legacy, brief: parseProductProductionBriefV3(brief) }
}
