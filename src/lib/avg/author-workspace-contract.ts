import { parseAvgSoundLocalRepairV1, type AvgSoundLocalRepairV1 } from './sound-local-repair-contract'
import { parseAvgProfessionalArtifactV1, type AvgSceneScriptV1 } from './artifact-contract'
import { parseAvgSystemPlan, type AvgSystemPlan } from './system-contract'
import { parseAvgReadingPlanV1, type AvgReadingPlanV1 } from './reading-contract'
import { parseAvgExecutableStageV1, type AvgExecutableStageV1 } from './stage-contract'
import { avgEnum, avgHash, avgList, avgProtocolBody, avgRecord, avgUnique } from './protocol-validation'
import { parseAvgVisualProductionBatchV1, type AvgVisualProductionBatchV1 } from './media-production-contract'
import { parseAvgInheritedStageImagesV1, type AvgInheritedStageImageV1 } from './stage-image-source-contract'
import { parseAvgImageProcessingPlan, assertAvgImageProcessingRequirements, type AvgImageProcessingPlan } from './image-processing-contract'
import { readAvgVoiceDraftV1 } from './voice-draft-contract'
import type { AvgVoiceExactStorageV1 } from './voice-exact-storage'
import { parseAvgInheritedStageVoices, type AvgInheritedStageVoice } from './stage-processed-voice-source-contract'
import { parseAvgSoundProductionDraftV1, type AvgSoundProductionDraftV1 } from './sound-draft-contract'
import { parseAvgInheritedStageSounds, type AvgInheritedStageSound } from './stage-processed-sound-source-contract'
import type { AvgAudioProductionProcessingPlan } from './audio-production-contract'
import { assertAvgVoiceProcessingDraft } from './voice-processing-draft-contract'
import { assertAvgSoundProcessingDraft } from './sound-processing-draft-contract'
import { parseAvgVoiceLocalRepairV2, type AvgVoiceLocalRepairV2 } from './voice-local-repair-contract'

/** Human-authored assembly, not a professional director Skill result. No local IDs. */
export interface AvgAuthorStageV1 {
  schema: 'storyforge.avg.author-stage'
  version: 1
  aspectRatio: '16:9' | '4:3'
  stage: AvgExecutableStageV1
  reading?: AvgReadingPlanV1
  inheritedImages?: AvgInheritedStageImageV1[]
  inheritedVoices?: AvgInheritedStageVoice[]
  inheritedSounds?: AvgInheritedStageSound[]
}
export function parseAvgAuthorStageV1(value: unknown): AvgAuthorStageV1 {
  const body = avgProtocolBody(value)
  const hasReading = !!body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'reading')
  const hasInherited=!!body&&typeof body==='object'&&Object.prototype.hasOwnProperty.call(body,'inheritedImages')
  const hasInheritedVoices = !!body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'inheritedVoices')
  const hasInheritedSounds = !!body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'inheritedSounds')
  const row = avgRecord(body, ['schema','version','aspectRatio','stage', ...(hasReading ? ['reading'] : []),...(hasInherited?['inheritedImages']:[]),
    ...(hasInheritedVoices ? ['inheritedVoices'] : []), ...(hasInheritedSounds ? ['inheritedSounds'] : [])], 'author stage')
  if (row.schema !== 'storyforge.avg.author-stage' || row.version !== 1) throw new Error('[avg] 作者演出版本无效')
  const stage = parseAvgExecutableStageV1(row.stage)
  if (stage.assets.length > 128 || stage.assets.reduce((sum,asset) => sum + asset.byteSize, 0) > 64*1024*1024)
    throw new Error('[avg] 当前作者联合预览最多 128 项、64 MiB 媒资；请拆分场景')
  return { schema: row.schema, version: 1, aspectRatio: avgEnum(row.aspectRatio, ['16:9','4:3'] as const, 'aspectRatio'),
    stage, ...(hasReading ? { reading: parseAvgReadingPlanV1(row.reading) } : {}),
    ...(hasInherited?{inheritedImages:parseAvgInheritedStageImagesV1(row.inheritedImages,stage.assets)}:{}),
    ...(hasInheritedVoices ? { inheritedVoices: parseAvgInheritedStageVoices(row.inheritedVoices, stage.assets) } : {}),
    ...(hasInheritedSounds ? { inheritedSounds: parseAvgInheritedStageSounds(row.inheritedSounds, stage.assets) } : {}) }
}

/** Editable input only. Saving this draft neither starts production nor adopts anything. */
export interface AvgAuthorWorkspaceV1 {
  schema: 'storyforge.avg.author-workspace'
  version: 1
  basePreviewHash: string | null
  systemPlan: AvgSystemPlan
  scripts: AvgSceneScriptV1[]
  presentation: AvgAuthorStageV1
  mediaBatch?: AvgVisualProductionBatchV1
  imageProcessing?: AvgImageProcessingPlan
  voiceProduction?: AvgVoiceExactStorageV1
  voiceProcessing?: AvgAudioProductionProcessingPlan
  voiceLocalRepair?: AvgVoiceLocalRepairV2
  soundProduction?: AvgSoundProductionDraftV1
  soundProcessing?: AvgAudioProductionProcessingPlan
  soundLocalRepair?: AvgSoundLocalRepairV1
}
export function parseAvgAuthorWorkspaceV1(value: unknown): AvgAuthorWorkspaceV1 {
  const body = avgProtocolBody(value)
  const hasBatch = !!body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'mediaBatch')
  const hasProcessing=!!body&&Object.prototype.hasOwnProperty.call(body,'imageProcessing')
  const hasVoice=!!body&&Object.prototype.hasOwnProperty.call(body,'voiceProduction')
  const hasVoiceProcessing=!!body&&Object.prototype.hasOwnProperty.call(body,'voiceProcessing')
  const hasVoiceRepair=!!body&&Object.prototype.hasOwnProperty.call(body,'voiceLocalRepair')
  const hasSound=!!body&&Object.prototype.hasOwnProperty.call(body,'soundProduction')
  const hasSoundProcessing=!!body&&Object.prototype.hasOwnProperty.call(body,'soundProcessing')
  const hasSoundRepair=!!body&&Object.prototype.hasOwnProperty.call(body,'soundLocalRepair')
  const row = avgRecord(body, ['schema','version','basePreviewHash','systemPlan','scripts','presentation', ...(hasBatch ? ['mediaBatch'] : []),...(hasProcessing?['imageProcessing']:[]),...(hasVoice?['voiceProduction']:[]),...(hasVoiceProcessing?['voiceProcessing']:[]),...(hasVoiceRepair?['voiceLocalRepair']:[]),...(hasSound?['soundProduction']:[]),...(hasSoundProcessing?['soundProcessing']:[]),...(hasSoundRepair?['soundLocalRepair']:[])], 'author workspace')
  if (row.schema !== 'storyforge.avg.author-workspace' || row.version !== 1) throw new Error('[avg] 作者工作区版本无效')
  const scripts = avgUnique(avgList(row.scripts, 'scripts', value => {
    const script = parseAvgProfessionalArtifactV1(value)
    if (script.schema !== 'storyforge.avg.scene-script') throw new Error('[avg] 工作区需要场景脚本')
    return script
  }), script => script.sceneKey, 'workspace scripts')
  const mediaBatch=hasBatch?parseAvgVisualProductionBatchV1(row.mediaBatch):undefined,imageProcessing=hasProcessing?parseAvgImageProcessingPlan(row.imageProcessing):undefined
  const voiceProduction=hasVoice?readAvgVoiceDraftV1(row.voiceProduction).packet:undefined
  if (hasVoiceProcessing && !voiceProduction) throw new Error('[avg-voice-process] 音量调整缺少已保存的逐句配音需求')
  const voiceProcessing = hasVoiceProcessing
    ? assertAvgVoiceProcessingDraft(row.voiceProcessing, readAvgVoiceDraftV1(voiceProduction).voice.batch.requirements) : undefined
  if (hasVoiceRepair && (!voiceProduction || !voiceProcessing)) throw new Error('[avg-voice-repair] 局部返修缺少准确单句和本地加工要求')
  const voiceLocalRepair = hasVoiceRepair ? parseAvgVoiceLocalRepairV2(row.voiceLocalRepair, readAvgVoiceDraftV1(voiceProduction).voice.batch) : undefined
  if (voiceLocalRepair && (voiceProcessing!.entries.length !== 1 || voiceProcessing!.entries[0].requirementKey !== voiceLocalRepair.retained[0].requirementKey)) {
    throw new Error('[avg-voice-repair] 局部返修加工要求必须只属于准确已保留的一句')
  }
  const soundProduction = hasSound ? parseAvgSoundProductionDraftV1(row.soundProduction) : undefined
  if (hasSoundProcessing && !soundProduction) throw new Error('[avg-sound-process] 音量调整缺少已保存的声音需求')
  const soundProcessing = hasSoundProcessing ? assertAvgSoundProcessingDraft(row.soundProcessing, soundProduction!.scope) : undefined
  if (hasSoundRepair && (hasBatch || hasProcessing || hasVoice || hasVoiceProcessing || hasVoiceRepair || hasSound || hasSoundProcessing)) {
    throw new Error('[avg-sound-repair] 单项原件返修不能夹带其他待生产批次或双写声音加工要求')
  }
  const soundLocalRepair = hasSoundRepair ? parseAvgSoundLocalRepairV1(row.soundLocalRepair) : undefined
  if(imageProcessing&&(!mediaBatch?.visualReviewPolicy||imageProcessing.entries.some(e=>!mediaBatch.requirements.some(r=>r.requirementKey===e.requirementKey))))throw new Error('[avg-process] 加工草稿缺少准确需求与独立视觉评审')
  if(imageProcessing?.version===2&&mediaBatch)assertAvgImageProcessingRequirements(imageProcessing,mediaBatch.requirements)
  return { schema: row.schema, version: 1, basePreviewHash: row.basePreviewHash === null ? null : avgHash(row.basePreviewHash, 'basePreviewHash'),
    systemPlan: parseAvgSystemPlan(row.systemPlan), scripts, presentation: parseAvgAuthorStageV1(row.presentation),
    ...(mediaBatch?{mediaBatch}:{}),...(imageProcessing?{imageProcessing}:{}),...(voiceProduction?{voiceProduction}:{}),
    ...(voiceProcessing?{voiceProcessing}:{}),
    ...(voiceLocalRepair?{voiceLocalRepair}:{}),
    ...(soundProduction?{soundProduction}:{}),...(soundProcessing?{soundProcessing}:{}),...(soundLocalRepair?{soundLocalRepair}:{}) }
}
