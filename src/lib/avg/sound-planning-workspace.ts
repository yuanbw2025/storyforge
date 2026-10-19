import type { ProductProductionBriefV3, ProviderCapabilityRequirementV1, WorkspaceScope } from '../types'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { resolveConfiguredTextCapabilityV1 } from '../product-production/capabilities'
import { readAvgDraftV1 } from './draft-service'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { validateAvgSoundDraftSourcesV1 } from './sound-draft-service'
import { avgSoundProductionExecutionReadyV1, parseAvgSoundPlanningBriefV1, AVG_SOUND_TEXT_CAPABILITY_V1, AVG_SOUND_MUSIC_CAPABILITY_V1,
  AVG_SOUND_TEXT_DATA_CLASS_V1, AVG_SOUND_MUSIC_DATA_CLASS_V1 } from './sound-production-brief'
import { assertAvgSoundLibraryMetadataV1 } from './sound-provider-contract'
import { resolveAvgLocalMusicCapabilityV1 } from './sound-transport'
import { avgSoundProductionBudgetV1, avgSoundProductionGateIdsV1 } from './sound-production-policy'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Only explicit preparation/start reads current routes. No model/audio POST,
 * candidate, adoption, model load or copied secret is produced here. */
export async function prepareAvgSoundPlanningConfigurationV1(scope: WorkspaceScope, workspace: AvgAuthorWorkspaceV1, options: { expectedTextCapabilityHash?: string } = {}) {
  if (!avgSoundProductionExecutionReadyV1()) throw new Error('[avg-sound] 声音正式制作尚未开放；已保存需求仍保留')
  if (!workspace.soundProduction) throw new Error('[avg-sound] 请先保存本次声音需求')
  await (await import('./visual-planning-restart')).assertAvgSoundOtherRequestsKnownV1(scope, null)
  if (workspace.mediaBatch || workspace.voiceProduction || workspace.imageProcessing) throw new Error('[avg-sound] 本次声音制作不能隐式接管待生成图片或逐句配音，请先明确保留或处理原批次')
  const draft = await validateAvgSoundDraftSourcesV1(workspace.soundProduction, workspace)
  for (const source of draft.scope.librarySources) assertAvgSoundLibraryMetadataV1(source)
  if (draft.scope.templates.some(t => workspace.presentation.stage.assets.some(a => a.assetKey === t.assetKey))) throw new Error('[avg-sound] 本次声音已进入演出，不能把沿用当作重新生成')
  const { receipt } = await resolveConfiguredTextCapabilityV1({ projectId: scope.projectId, category: 'product-production', requirementKey: AVG_SOUND_TEXT_CAPABILITY_V1,
    expectedCapabilityHash: options.expectedTextCapabilityHash })
  const music = draft.scope.templates.some(t => t.source.kind === 'generate-music') ? await resolveAvgLocalMusicCapabilityV1() : null
  const textCapability: ProviderCapabilityRequirementV1 = { requirementKey: AVG_SOUND_TEXT_CAPABILITY_V1, mediaClass: 'text', operation: 'generate',
    adapterFamily: 'text-model', minimumCapabilityVersion: '1', allowedDataClasses: [AVG_SOUND_TEXT_DATA_CLASS_V1], maximumRequestCost: null,
    maximumTotalCost: null, rightsPolicyVersion: 'storyforge-avg-sound-planning.v1', capabilityHash: receipt.capabilityHash, required: true }
  return { scope: draft.scope, aspectRatio: workspace.presentation.aspectRatio, textCapability,
    musicBinding: music ? { adapterId: music.binding.adapterId as 'storyforge.avg.local-music.v1', requirementKey: AVG_SOUND_MUSIC_CAPABILITY_V1,
      bindingHash: music.bindingHash, endpointRouteHash: music.endpointRouteHash } : null }
}

export function completeAvgSoundPlanningBriefV1(base: ProductProductionBriefV3, configuration: Awaited<ReturnType<typeof prepareAvgSoundPlanningConfigurationV1>>): ProductProductionBriefV3 {
  const { avgAssembly, ...source } = base
  if (avgAssembly?.version !== 1 || source.avgVisualPlanning || source.avgSoundPlanning || source.avgRevision) throw new Error('[avg-sound] 声音准备需要本次准确原生组装基线')
  const declaration = parseAvgSoundPlanningBriefV1({ schema: 'storyforge.avg.sound-planning-brief', version: 1,
    assembly: { ...avgAssembly, mediaAssetKeys: [...new Set([...avgAssembly.mediaAssetKeys, ...configuration.scope.templates.map(t => t.assetKey)])] },
    aspectRatio: configuration.aspectRatio, scope: configuration.scope, musicBinding: configuration.musicBinding })
  const generated = declaration.scope.templates.filter(t => t.source.kind === 'generate-music').length
  const music: ProviderCapabilityRequirementV1[] = configuration.musicBinding ? [{ requirementKey: AVG_SOUND_MUSIC_CAPABILITY_V1, mediaClass: 'music',
    operation: 'generate', adapterFamily: 'storyforge-local-music', minimumCapabilityVersion: '1', allowedDataClasses: [AVG_SOUND_MUSIC_DATA_CLASS_V1],
    maximumRequestCost: 0, maximumTotalCost: 0, rightsPolicyVersion: 'storyforge-avg-local-music.v1', capabilityHash: configuration.musicBinding.bindingHash, required: true }] : []
  const next = { ...source, avgSoundPlanning: declaration, capabilityRequirements: [configuration.textCapability, ...music],
    media: { visualLevel: 'none' as const, audioLevel: 'music-sfx' as const, imageCount: 0, voiceLineCount: 0, musicTrackCount: generated,
      sfxCount: declaration.scope.templates.length - generated, requiredMediaKinds: [...new Set(declaration.scope.templates.map(t => t.channel))] },
    externalDataPolicy: { ...source.externalDataPolicy, allowedDataClasses: [AVG_SOUND_TEXT_DATA_CLASS_V1, ...(generated ? [AVG_SOUND_MUSIC_DATA_CLASS_V1] : [])],
      allowReferenceImages: false, allowVoiceScripts: false },
    fallbackPolicy: { allowTextOnly: false, allowProceduralAudio: false, allowExistingProjectMedia: true, onRequiredCapabilityMissing: 'pause' as const } }
  return parseProductProductionBriefV3({ ...next, productionBudget: avgSoundProductionBudgetV1(next), completionContract: {
    requiresPlayablePreview: true, requiredGateIds: avgSoundProductionGateIdsV1(next), minimumMediaCoverage: 1, allowSoftWaivers: false } })
}

/** UI authorization preflight only; old immutable Briefs/Run proofs are never
 * rewritten to acquire this new editable-draft requirement retroactively. */
export async function assertAvgSoundPreparationMatchesBriefV1(input: { scope: WorkspaceScope; productionId: number; brief: ProductProductionBriefV3 }) {
  const draft = await readAvgDraftV1(input.scope), workspace = parseAvgAuthorWorkspaceV1(draft.editorJson), sound = input.brief.avgSoundPlanning
  if (draft.productionId !== input.productionId || draft.worldReleaseId !== input.brief.source.worldReleaseId || !sound) throw new Error('[avg-sound] 待开始声音方案或冻结世界来源已变化')
  const configuration = await prepareAvgSoundPlanningConfigurationV1(input.scope, workspace, {
    expectedTextCapabilityHash: input.brief.capabilityRequirements.find(c => c.requirementKey === AVG_SOUND_TEXT_CAPABILITY_V1)?.capabilityHash,
  })
  if (!same(configuration.scope, sound.scope) || configuration.aspectRatio !== sound.aspectRatio || !same(configuration.musicBinding, sound.musicBinding)
    || configuration.textCapability.capabilityHash !== input.brief.capabilityRequirements.find(c => c.requirementKey === AVG_SOUND_TEXT_CAPABILITY_V1)?.capabilityHash) {
    throw new Error('[avg-sound] 需求、规则、文字路由或本机音乐记录身份已变化，请重新准备方案')
  }
  const current = await readAvgDraftV1(input.scope)
  if (current.revision !== draft.revision || current.productionId !== draft.productionId || current.editorJson !== draft.editorJson) throw new Error('[avg-sound] 开始预检期间作者草稿已变化')
}
