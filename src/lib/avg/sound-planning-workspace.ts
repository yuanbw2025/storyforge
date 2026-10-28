import { parseAvgSoundPlanningBriefV2 } from './sound-production-brief'
import { parseAvgAudioProductionProcessingPlan } from './audio-production-contract'
import { avgSoundProductionBudget, avgSoundProductionGateIds } from './sound-production-policy'
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
import { assertAvgSoundProcessingDraft } from './sound-processing-draft-contract'
import { avgAudioProcessingExecutionReadyV1 } from './audio-production-brief'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Only explicit preparation/start reads current routes. No model/audio POST,
 * candidate, adoption, model load or copied secret is produced here. */
export async function prepareAvgSoundPlanningConfigurationV1(scope: WorkspaceScope, workspace: AvgAuthorWorkspaceV1, options: { expectedTextCapabilityHash?: string } = {}) {
  if (!avgSoundProductionExecutionReadyV1()) throw new Error('[avg-sound] 声音正式制作尚未开放；已保存需求仍保留')
  if (!workspace.soundProduction) throw new Error('[avg-sound] 请先保存本次声音需求')
  await (await import('./visual-planning-restart')).assertAvgSoundOtherRequestsKnownV1(scope, null)
  if (workspace.mediaBatch || workspace.voiceProduction || workspace.imageProcessing) throw new Error('[avg-sound] 本次声音制作不能隐式接管待生成图片或逐句配音，请先明确保留或处理原批次')
  const draft = await validateAvgSoundDraftSourcesV1(workspace.soundProduction, workspace)
  const processing = workspace.soundProcessing ? assertAvgSoundProcessingDraft(workspace.soundProcessing, draft.scope) : undefined
  if (processing && !avgAudioProcessingExecutionReadyV1()) throw new Error('[avg-sound-process] 本地音量加工尚未开放；已保存要求继续保留')
  for (const source of draft.scope.librarySources) assertAvgSoundLibraryMetadataV1(source)
  if (draft.scope.templates.some(t => workspace.presentation.stage.assets.some(a => a.assetKey === t.assetKey))) throw new Error('[avg-sound] 本次声音已进入演出，不能把沿用当作重新生成')
  const { receipt } = await resolveConfiguredTextCapabilityV1({ projectId: scope.projectId, category: 'product-production', requirementKey: AVG_SOUND_TEXT_CAPABILITY_V1,
    expectedCapabilityHash: options.expectedTextCapabilityHash })
  const music = draft.scope.templates.some(t => t.source.kind === 'generate-music') ? await resolveAvgLocalMusicCapabilityV1() : null
  const textCapability: ProviderCapabilityRequirementV1 = { requirementKey: AVG_SOUND_TEXT_CAPABILITY_V1, mediaClass: 'text', operation: 'generate',
    adapterFamily: 'text-model', minimumCapabilityVersion: '1', allowedDataClasses: [AVG_SOUND_TEXT_DATA_CLASS_V1], maximumRequestCost: null,
    maximumTotalCost: null, rightsPolicyVersion: 'storyforge-avg-sound-planning.v1', capabilityHash: receipt.capabilityHash, required: true }
  return { scope: draft.scope, aspectRatio: workspace.presentation.aspectRatio, textCapability, ...(processing ? { processing } : {}),
    musicBinding: music ? { adapterId: music.binding.adapterId as 'storyforge.avg.local-music.v1', requirementKey: AVG_SOUND_MUSIC_CAPABILITY_V1,
      bindingHash: music.bindingHash, endpointRouteHash: music.endpointRouteHash } : null }
}

export function completeAvgSoundPlanningBriefV1(base: ProductProductionBriefV3, configuration: Awaited<ReturnType<typeof prepareAvgSoundPlanningConfigurationV1>>): ProductProductionBriefV3 {
  const { avgAssembly, ...source } = base
  if (avgAssembly?.version !== 1 || source.avgVisualPlanning || source.avgSoundPlanning || source.avgRevision || source.avgAudioProcessing) throw new Error('[avg-sound] 声音准备需要本次准确原生组装基线')
  const declaration = parseAvgSoundPlanningBriefV1({ schema: 'storyforge.avg.sound-planning-brief', version: 1,
    assembly: { ...avgAssembly, mediaAssetKeys: [...new Set([...avgAssembly.mediaAssetKeys, ...configuration.scope.templates.map(t => t.assetKey)])] },
    aspectRatio: configuration.aspectRatio, scope: configuration.scope, musicBinding: configuration.musicBinding })
  const processing = configuration.processing ? assertAvgSoundProcessingDraft(configuration.processing, declaration.scope) : undefined
  const generated = declaration.scope.templates.filter(t => t.source.kind === 'generate-music').length
  const music: ProviderCapabilityRequirementV1[] = configuration.musicBinding ? [{ requirementKey: AVG_SOUND_MUSIC_CAPABILITY_V1, mediaClass: 'music',
    operation: 'generate', adapterFamily: 'storyforge-local-music', minimumCapabilityVersion: '1', allowedDataClasses: [AVG_SOUND_MUSIC_DATA_CLASS_V1],
    maximumRequestCost: 0, maximumTotalCost: 0, rightsPolicyVersion: 'storyforge-avg-local-music.v1', capabilityHash: configuration.musicBinding.bindingHash, required: true }] : []
  const next = { ...source, avgSoundPlanning: declaration, ...(processing ? { avgAudioProcessing: processing } : {}),
    capabilityRequirements: [configuration.textCapability, ...music],
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
  if (sound.version === 2) {
    const config = await prepareAvgSoundLocalRepairConfigurationV2(input.scope, workspace)
    const processing = parseAvgAudioProductionProcessingPlan({ schema: 'storyforge.avg.audio-production-processing-plan',
      version: sound.repair.recipe.version, entries: [{ domain: 'sound', requirementKey: sound.repair.source.requirementKey, recipe: sound.repair.recipe }] })
    if (!same(config.repair, sound.repair) || config.aspectRatio !== sound.aspectRatio || !same(processing, input.brief.avgAudioProcessing)) {
      throw new Error('[avg-sound-repair] 返修要求与待开始方案不一致，请重新核对')
    }
    const current = await readAvgDraftV1(input.scope)
    if (current.revision !== draft.revision || current.editorJson !== draft.editorJson || current.productionId !== draft.productionId) throw new Error('[avg-sound-repair] 开始预检期间草稿已变化')
    return
  }
  if (workspace.soundLocalRepair) throw new Error('[avg-sound-repair] 已保存返修不能回退为新声音请求')
  if (!same(workspace.soundProcessing ?? null, input.brief.avgAudioProcessing ?? null)) {
    throw new Error('[avg-sound-process] 音量要求与制作方案不一致，请重新核对方案')
  }
  const configuration = await prepareAvgSoundPlanningConfigurationV1(input.scope, workspace, {
    expectedTextCapabilityHash: input.brief.capabilityRequirements.find(c => c.requirementKey === AVG_SOUND_TEXT_CAPABILITY_V1)?.capabilityHash,
  })
  if (!same(configuration.scope, sound.scope) || configuration.aspectRatio !== sound.aspectRatio || !same(configuration.musicBinding, sound.musicBinding)
    || !same(configuration.processing ?? null, input.brief.avgAudioProcessing ?? null)
    || configuration.textCapability.capabilityHash !== input.brief.capabilityRequirements.find(c => c.requirementKey === AVG_SOUND_TEXT_CAPABILITY_V1)?.capabilityHash) {
    throw new Error('[avg-sound] 需求、规则、文字路由或本机音乐记录身份已变化，请重新准备方案')
  }
  const current = await readAvgDraftV1(input.scope)
  if (current.revision !== draft.revision || current.productionId !== draft.productionId || current.editorJson !== draft.editorJson) throw new Error('[avg-sound] 开始预检期间作者草稿已变化')
}

/** Frozen original-source repair, independent of text/music configuration.
 * Preparation reads existing owned bytes and author proof; it never performs
 * a provider request or writes an adoption on the author's behalf. */
export async function prepareAvgSoundLocalRepairConfigurationV2(scope: WorkspaceScope, workspace: AvgAuthorWorkspaceV1) {
  if (!avgSoundProductionExecutionReadyV1() || !avgAudioProcessingExecutionReadyV1()) throw new Error('[avg-sound-repair] 本地声音返修尚未启用，原件和要求保留')
  if (!workspace.soundLocalRepair || workspace.soundProduction || workspace.soundProcessing || workspace.mediaBatch
    || workspace.voiceProduction || workspace.voiceProcessing || workspace.voiceLocalRepair || workspace.imageProcessing) {
    throw new Error('[avg-sound-repair] 请单独准备已保存的单项声音返修')
  }
  const draft = await readAvgDraftV1(scope)
  if (!draft.productionId) throw new Error('[avg-sound-repair] 返修缺少原制作记录')
  const { readProductProductionDetailsV1 } = await import('../product-production/service')
  const { readAvgSoundLocalRepairEvidenceV1 } = await import('./sound-local-repair-evidence')
  const details = await readProductProductionDetailsV1(scope, draft.productionId, ['avg'])
  const evidence = await readAvgSoundLocalRepairEvidenceV1({ scope, productionId: draft.productionId, repair: workspace.soundLocalRepair })
  const parent = evidence.parent, repair = evidence.repair
  const pending = details.brief && details.brief.revision !== parent.briefRevision ? parseProductProductionBriefV3(details.brief.briefJson).avgSoundPlanning : null
  if (!details.build || !same(details.build, parent) || details.production.currentBuildNumber !== parent.buildNumber
    || pending && (pending.version !== 2 || !same(pending.repair, repair))
    || workspace.presentation.aspectRatio !== evidence.parentStage.aspectRatio
    || !same(workspace.presentation.stage.assets.find(a => a.assetKey === repair.sourceAsset.assetKey), repair.sourceAsset)
    || !workspace.presentation.inheritedSounds?.some(e => e.assetKey === repair.sourceAsset.assetKey && same(e.source, repair.source))
    || details.executionBrief?.source.worldContentHash !== evidence.selected.sourceWorldContentHash) {
    throw new Error('[avg-sound-repair] 当前预览、所选原声音、画幅或待开始方案已变化')
  }
  const { assertAvgInheritedSoundBindingV1 } = await import('./stage-sound-sources')
  assertAvgInheritedSoundBindingV1({ asset: repair.sourceAsset, raw: evidence.selected.rawPayload,
    payload: workspace.presentation, scripts: workspace.scripts })
  await (await import('./visual-planning-restart')).assertAvgSoundOtherRequestsKnownV1(scope, null)
  return { repair, aspectRatio: workspace.presentation.aspectRatio }
}

export function completeAvgSoundLocalRepairBriefV2(base: ProductProductionBriefV3,
  configuration: Awaited<ReturnType<typeof prepareAvgSoundLocalRepairConfigurationV2>>): ProductProductionBriefV3 {
  const { avgAssembly, ...source } = base
  if (avgAssembly?.version !== 1 || source.avgVisualPlanning || source.avgSoundPlanning || source.avgRevision || source.avgAudioProcessing) {
    throw new Error('[avg-sound-repair] 返修需要本次准确原生组装基线')
  }
  const declaration = parseAvgSoundPlanningBriefV2({ schema: 'storyforge.avg.sound-planning-brief', version: 2,
    assembly: avgAssembly, aspectRatio: configuration.aspectRatio, repair: configuration.repair })
  const processing = parseAvgAudioProductionProcessingPlan({ schema: 'storyforge.avg.audio-production-processing-plan',
    version: declaration.repair.recipe.version, entries: [{ domain: 'sound', requirementKey: declaration.repair.source.requirementKey, recipe: declaration.repair.recipe }] })
  const kind = declaration.repair.sourceAsset.kind
  const next = { ...source, avgSoundPlanning: declaration, avgAudioProcessing: processing, capabilityRequirements: [],
    consultationBudget: { maximumModelCalls: 0, maximumInputTokens: 0, maximumOutputTokens: 0, maximumCostUsd: 0 },
    media: { visualLevel: 'none' as const, audioLevel: 'music-sfx' as const, imageCount: 0, voiceLineCount: 0,
      musicTrackCount: kind === 'bgm' ? 1 : 0, sfxCount: kind === 'bgm' ? 0 : 1, requiredMediaKinds: [kind] },
    externalDataPolicy: { ...source.externalDataPolicy, allowedDataClasses: [], allowReferenceImages: false, allowVoiceScripts: false },
    fallbackPolicy: { allowTextOnly: false, allowProceduralAudio: false, allowExistingProjectMedia: true, onRequiredCapabilityMissing: 'pause' as const } }
  return parseProductProductionBriefV3({ ...next, productionBudget: avgSoundProductionBudget(next), completionContract: {
    requiresPlayablePreview: true, requiredGateIds: avgSoundProductionGateIds(next), minimumMediaCoverage: 1, allowSoftWaivers: false } })
}
