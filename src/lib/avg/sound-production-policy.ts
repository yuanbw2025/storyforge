import type { ProductProductionBriefV3, ProductProductionBudgetV3 } from '../types'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { buildAvgSoundProductionPlanV1, type AvgSoundTopologyInputV1 } from './sound-production-plan'
import { AVG_SOUND_MUSIC_CAPABILITY_V1, AVG_SOUND_MUSIC_DATA_CLASS_V1, AVG_SOUND_TEXT_CAPABILITY_V1,
  AVG_SOUND_TEXT_DATA_CLASS_V1, parseAvgSoundPlanningBriefV1 } from './sound-production-brief'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
const topology = (brief: AvgSoundTopologyInputV1) => buildAvgSoundProductionPlanV1({ brief, briefHash: '0'.repeat(64), buildNumber: 1, controlEpoch: 0 })
export function avgSoundProductionBudgetV1(brief: AvgSoundTopologyInputV1): ProductProductionBudgetV3 {
  const tasks = topology(brief).tasks
  const sum = (key: keyof typeof tasks[number]['budgetReservation']) => tasks.reduce((n, t) => n + Number(t.budgetReservation[key]), 0)
  const costs = tasks.map(t => t.budgetReservation.maximumCostUsd)
  return { maximumModelCalls: sum('modelCalls'), maximumInputTokens: sum('inputTokens'), maximumOutputTokens: sum('outputTokens'),
    maximumMediaCalls: sum('mediaCalls'), maximumDurationMs: sum('durationMs'), maximumStorageBytes: sum('storageBytes'),
    maximumCostUsd: costs.some(c => c === null) ? null : costs.reduce<number>((n, c) => n + c!, 0) }
}
export function avgSoundProductionGateIdsV1(brief: AvgSoundTopologyInputV1): string[] {
  const plan = topology(brief)
  return [...new Set(plan.tasks.find(t => t.taskKey === plan.terminalTaskKey)!.acceptanceGateIds)]
}
/** Declarative policy only; no live account, licence or audio acceptance. */
export function assertAvgSoundProductionPolicyV1(brief: ProductProductionBriefV3): void {
  const sound = parseAvgSoundPlanningBriefV1(brief.avgSoundPlanning)
  if (brief.intent.productType !== 'avg' || brief.avgAssembly || brief.avgVisualPlanning || brief.avgRevision || brief.qualityProfile === 'commercial-candidate') {
    throw new Error('[avg-sound] 声音制作须独立 AVG prototype/internal 合同，不借用旧图声或其他产品授权')
  }
  const text = brief.capabilityRequirements.find(c => c.requirementKey === AVG_SOUND_TEXT_CAPABILITY_V1)!
  const music = brief.capabilityRequirements.find(c => c.requirementKey === AVG_SOUND_MUSIC_CAPABILITY_V1)
  const budget = avgSoundProductionBudgetV1(brief)
  if (!text || text.adapterFamily !== 'text-model' || text.operation !== 'generate' || text.minimumCapabilityVersion !== '1'
    || !same(text.allowedDataClasses, [AVG_SOUND_TEXT_DATA_CLASS_V1])
    || music && (music.adapterFamily !== 'storyforge-local-music' || music.operation !== 'generate' || music.minimumCapabilityVersion !== '1'
      || !same(music.allowedDataClasses, [AVG_SOUND_MUSIC_DATA_CLASS_V1]) || music.capabilityHash !== sound.musicBinding?.bindingHash
      || music.maximumRequestCost !== 0 || music.maximumTotalCost !== 0)) throw new Error('[avg-sound] 文字/本机音乐能力和准确路由预算不闭合')
  const generated = sound.scope.templates.filter(t => t.source.kind === 'generate-music').length
  const kinds = [...new Set(sound.scope.templates.map(t => t.channel))].sort()
  if (brief.media.imageCount !== 0 || brief.media.visualLevel !== 'none' || brief.media.audioLevel !== 'music-sfx' || brief.media.voiceLineCount !== 0
    || brief.media.musicTrackCount !== generated || brief.media.sfxCount !== sound.scope.templates.length - generated
    || !same([...brief.media.requiredMediaKinds].sort(), kinds)) throw new Error('[avg-sound] 声音批次计数须与准确生产/导入闭集一致，旧图片/配音仍属原版本')
  const external = brief.externalDataPolicy, allowed = [AVG_SOUND_TEXT_DATA_CLASS_V1, ...(generated ? [AVG_SOUND_MUSIC_DATA_CLASS_V1] : [])]
  if (!same([...external.allowedDataClasses].sort(), allowed.sort()) || allowed.some(k => external.forbiddenDataClasses.includes(k))
    || external.allowReferenceImages || external.allowVoiceScripts) throw new Error('[avg-sound] 声音外发范围只允许本次策划投影与音乐说明')
  if (!same(brief.productionBudget, budget) || text.maximumTotalCost !== budget.maximumCostUsd
    || !same(brief.consultationBudget, { maximumModelCalls: 0, maximumInputTokens: 0, maximumOutputTokens: 0, maximumCostUsd: 0 })) throw new Error('[avg-sound] 声音预算必须来自同一有限任务图')
  if (brief.fallbackPolicy.allowTextOnly || brief.fallbackPolicy.allowProceduralAudio || !brief.fallbackPolicy.allowExistingProjectMedia
    || brief.fallbackPolicy.onRequiredCapabilityMissing !== 'pause' || !brief.completionContract.requiresPlayablePreview
    || brief.completionContract.minimumMediaCoverage !== 1 || brief.completionContract.allowSoftWaivers
    || !same([...brief.completionContract.requiredGateIds].sort(), avgSoundProductionGateIdsV1(brief).sort())) throw new Error('[avg-sound] 真实音频、独立审听采用与可玩终态门不可绕过')
}
