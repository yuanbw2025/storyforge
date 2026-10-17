import { parseAvgProfessionalArtifactV1, type AvgSceneScriptV1 } from './artifact-contract'
import { parseAvgSystemPlan, type AvgSystemPlan } from './system-contract'
import { parseAvgReadingPlanV1, type AvgReadingPlanV1 } from './reading-contract'
import { parseAvgExecutableStageV1, type AvgExecutableStageV1 } from './stage-contract'
import { avgEnum, avgHash, avgList, avgProtocolBody, avgRecord, avgUnique } from './protocol-validation'
import { parseAvgVisualProductionBatchV1, type AvgVisualProductionBatchV1 } from './media-production-contract'
import { parseAvgInheritedStageImagesV1, type AvgInheritedStageImageV1 } from './stage-image-source-contract'
import { parseAvgImageProcessingPlanV1, type AvgImageProcessingPlanV1 } from './image-processing-contract'
import { readAvgVoiceDraftV1 } from './voice-draft-contract'
import type { AvgVoiceExactStorageV1 } from './voice-exact-storage'
import { parseAvgInheritedStageVoicesV1, type AvgInheritedStageVoiceV1 } from './stage-voice-source-contract'

/** Human-authored assembly, not a professional director Skill result. No local IDs. */
export interface AvgAuthorStageV1 {
  schema: 'storyforge.avg.author-stage'
  version: 1
  aspectRatio: '16:9' | '4:3'
  stage: AvgExecutableStageV1
  reading?: AvgReadingPlanV1
  inheritedImages?: AvgInheritedStageImageV1[]
  inheritedVoices?: AvgInheritedStageVoiceV1[]
}
export function parseAvgAuthorStageV1(value: unknown): AvgAuthorStageV1 {
  const body = avgProtocolBody(value)
  const hasReading = !!body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'reading')
  const hasInherited=!!body&&typeof body==='object'&&Object.prototype.hasOwnProperty.call(body,'inheritedImages')
  const hasInheritedVoices = !!body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'inheritedVoices')
  const row = avgRecord(body, ['schema','version','aspectRatio','stage', ...(hasReading ? ['reading'] : []),...(hasInherited?['inheritedImages']:[]),
    ...(hasInheritedVoices ? ['inheritedVoices'] : [])], 'author stage')
  if (row.schema !== 'storyforge.avg.author-stage' || row.version !== 1) throw new Error('[avg] 作者演出版本无效')
  const stage = parseAvgExecutableStageV1(row.stage)
  if (stage.assets.length > 128 || stage.assets.reduce((sum,asset) => sum + asset.byteSize, 0) > 64*1024*1024)
    throw new Error('[avg] 当前作者联合预览最多 128 项、64 MiB 媒资；请拆分场景')
  return { schema: row.schema, version: 1, aspectRatio: avgEnum(row.aspectRatio, ['16:9','4:3'] as const, 'aspectRatio'),
    stage, ...(hasReading ? { reading: parseAvgReadingPlanV1(row.reading) } : {}),
    ...(hasInherited?{inheritedImages:parseAvgInheritedStageImagesV1(row.inheritedImages,stage.assets)}:{}),
    ...(hasInheritedVoices ? { inheritedVoices: parseAvgInheritedStageVoicesV1(row.inheritedVoices, stage.assets) } : {}) }
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
  imageProcessing?: AvgImageProcessingPlanV1
  voiceProduction?: AvgVoiceExactStorageV1
}
export function parseAvgAuthorWorkspaceV1(value: unknown): AvgAuthorWorkspaceV1 {
  const body = avgProtocolBody(value)
  const hasBatch = !!body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'mediaBatch')
  const hasProcessing=!!body&&Object.prototype.hasOwnProperty.call(body,'imageProcessing')
  const hasVoice=!!body&&Object.prototype.hasOwnProperty.call(body,'voiceProduction')
  const row = avgRecord(body, ['schema','version','basePreviewHash','systemPlan','scripts','presentation', ...(hasBatch ? ['mediaBatch'] : []),...(hasProcessing?['imageProcessing']:[]),...(hasVoice?['voiceProduction']:[])], 'author workspace')
  if (row.schema !== 'storyforge.avg.author-workspace' || row.version !== 1) throw new Error('[avg] 作者工作区版本无效')
  const scripts = avgUnique(avgList(row.scripts, 'scripts', value => {
    const script = parseAvgProfessionalArtifactV1(value)
    if (script.schema !== 'storyforge.avg.scene-script') throw new Error('[avg] 工作区需要场景脚本')
    return script
  }), script => script.sceneKey, 'workspace scripts')
  const mediaBatch=hasBatch?parseAvgVisualProductionBatchV1(row.mediaBatch):undefined,imageProcessing=hasProcessing?parseAvgImageProcessingPlanV1(row.imageProcessing):undefined
  const voiceProduction=hasVoice?readAvgVoiceDraftV1(row.voiceProduction).packet:undefined
  if(imageProcessing&&(!mediaBatch?.visualReviewPolicy||imageProcessing.entries.some(e=>!mediaBatch.requirements.some(r=>r.requirementKey===e.requirementKey))))throw new Error('[avg-process] 加工草稿缺少准确需求与独立视觉评审')
  return { schema: row.schema, version: 1, basePreviewHash: row.basePreviewHash === null ? null : avgHash(row.basePreviewHash, 'basePreviewHash'),
    systemPlan: parseAvgSystemPlan(row.systemPlan), scripts, presentation: parseAvgAuthorStageV1(row.presentation),
    ...(mediaBatch?{mediaBatch}:{}),...(imageProcessing?{imageProcessing}:{}),...(voiceProduction?{voiceProduction}:{}) }
}
