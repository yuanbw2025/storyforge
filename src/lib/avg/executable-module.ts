import type { AnyProductRuntimePackage, AvgPresentationContentV1, FrozenNarrativeBeat, FrozenRuntimeMediaAssetV2, ProductMediaAsset } from '../types'
import { parseAvgReadingPlanV1, type AvgReadingPlanV1 } from './reading-contract'
import type { AvgSystemPlan } from './system-contract'
import { parseAvgSystemPlan } from './system-contract'
import { buildAvgSystemGraphV1 } from './system-graph'
import { parseAvgPresentationContent, validateAvgPresentation } from './runtime'
import { freezeProductMediaAsset } from '../product-production/media-contracts'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { avgEnum, avgHash, avgKey, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'

export const AVG_EXECUTABLE_CAPABILITIES_V1 = ['narrative','presentation','avg.rules'] as const
export function avgExecutableCapabilities(module: Pick<AvgRuntimeModuleV2, 'systemPlan' | 'reading'>): string[] {
  return [...AVG_EXECUTABLE_CAPABILITIES_V1, ...(module.systemPlan.version === 2 ? ['avg.inventory'] : []), ...(module.reading ? ['avg.reading'] : [])]
}
export type AvgExecutableStageV1 = AvgPresentationContentV1 & { assets: FrozenRuntimeMediaAssetV2[] }
/** Native V2 module: V1's inert module/consumer codec is never reinterpreted.
 * The stage deliberately reuses the supported Cue protocol and renderer. */
export interface AvgRuntimeModuleV2 {
  schema: 'storyforge.avg.runtime-module'
  version: 2
  systemPlan: AvgSystemPlan
  lines: Array<{ lineKey: string; sceneKey: string; speakerKey: string | null; text: string; textRevision: number; locale: 'zh-CN' }>
  choices: Array<{ choiceKey: string; text: string }>
  aspectRatio: '16:9' | '4:3'
  stage: AvgExecutableStageV1
  reading?: AvgReadingPlanV1
}
export interface AvgRuntimeRulesStateV1 {
  schema: 'storyforge.avg.rules-state'
  version: 1
  systemPlan: AvgSystemPlan
}
export function assertAvgSnapshotKeyV1(value: unknown): string {
  const key = avgKey(value, 'snapshotKey')
  if (['__proto__','prototype','constructor'].includes(key)) throw new Error('[avg] snapshotKey 为保留键')
  return key
}
export function parseAvgRuntimeRulesStateV1(value: unknown): AvgRuntimeRulesStateV1 {
  const row = avgRecord(value, ['schema','version','systemPlan'], 'AVG rules state')
  if (row.schema !== 'storyforge.avg.rules-state' || row.version !== 1) throw new Error('[avg] rules state schema/version 无效')
  return { schema: 'storyforge.avg.rules-state', version: 1, systemPlan: parseAvgSystemPlan(row.systemPlan) }
}
export function avgModuleBeatsV2(module: Pick<AvgRuntimeModuleV2, 'lines'>): FrozenNarrativeBeat[] {
  return module.lines.map((line, order) => ({ beatKey: line.lineKey, nodeKey: line.sceneKey, speakerKey: line.speakerKey,
    text: line.text, kind: line.speakerKey ? 'dialogue' : 'narration', order }))
}
export function avgModuleNarrativeV2(module: AvgRuntimeModuleV2) {
  const { narrative } = buildAvgSystemGraphV1(module.systemPlan)
  return { ...narrative, beats: avgModuleBeatsV2(module), choices: narrative.choices.map(choice => ({ ...choice,
    text: module.choices.find(label => label.choiceKey === choice.choiceKey)!.text })) }
}
export function parseAvgRuntimeModuleV2(value: unknown): AvgRuntimeModuleV2 {
  const body = avgProtocolBody(value)
  const hasReading = !!body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'reading')
  const row = avgRecord(body, ['schema','version','systemPlan','lines','choices','aspectRatio','stage',...(hasReading ? ['reading'] : [])], 'AVG executable module')
  if (row.schema !== 'storyforge.avg.runtime-module' || row.version !== 2) throw new Error('[avg] 未登记可执行模块版本')
  const { plan: systemPlan } = buildAvgSystemGraphV1(row.systemPlan)
  const sceneKeys = new Set(systemPlan.scenes.map(scene => scene.key))
  const characterKeys = new Set(systemPlan.characters.map(character => character.key))
  const lines = avgUnique(avgList(row.lines, 'lines', value => {
    const line = avgRecord(value, ['lineKey','sceneKey','speakerKey','text','textRevision','locale'], 'line')
    const sceneKey = avgKey(line.sceneKey, 'sceneKey')
    const speakerKey = line.speakerKey === null ? null : avgKey(line.speakerKey, 'speakerKey')
    if (!sceneKeys.has(sceneKey) || speakerKey !== null && !characterKeys.has(speakerKey)) throw new Error('[avg] line 场景/角色不存在')
    return { lineKey: avgKey(line.lineKey, 'lineKey'), sceneKey, speakerKey, text: avgText(line.text, 'text', 10000),
      textRevision: avgNumber(line.textRevision, 'textRevision', 1, 1_000_000), locale: avgEnum(line.locale, ['zh-CN'] as const, 'locale') }
  }, 50_000), line => line.lineKey, 'lines')
  if (systemPlan.scenes.some(scene => !lines.some(line => line.sceneKey === scene.key))) throw new Error('[avg] 可执行场景缺少规范句')
  const choices = avgUnique(avgList(row.choices, 'choices', value => {
    const choice = avgRecord(value, ['choiceKey','text'], 'choice label')
    return { choiceKey: avgKey(choice.choiceKey, 'choiceKey'), text: avgText(choice.text, 'choice.text', 1000) }
  }, 5000), choice => choice.choiceKey, 'choices')
  if (choices.length !== systemPlan.actions.length || choices.some(choice => !systemPlan.actions.some(action => action.key === choice.choiceKey))) throw new Error('[avg] 选择标签与规则行动未闭合')
  const stageRow = avgRecord(row.stage, ['version','cues','assets'], 'stage')
  const rawCues = avgList(stageRow.cues, 'stage.cues', value => value, 50_000)
  const content = parseAvgPresentationContent(stageRow)
  rawCues.forEach((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.prototype.hasOwnProperty.call(content.cues[index], key))) throw new Error('[avg] Cue 含未知字段')
    const cue = content.cues[index]
    if (cue.snapshotKey != null) assertAvgSnapshotKeyV1(cue.snapshotKey)
    if (cue.actorKey && !characterKeys.has(cue.actorKey)) throw new Error('[avg] Cue 角色不在目录')
  })
  const assets = avgUnique(avgList(stageRow.assets, 'stage.assets', value => {
    if (!value || typeof value !== 'object') throw new Error('[avg] stage asset 无效')
    const raw = value as Record<string, unknown>
    const blobContentHash = avgHash(raw.blobContentHash, 'blobContentHash')
    const frozen = freezeProductMediaAsset(raw as unknown as ProductMediaAsset)
    avgKey(frozen.assetKey, 'assetKey')
    if (['constructor','prototype'].includes(frozen.assetKey)) throw new Error('[avg] assetKey 为保留键')
    if (frozen.contentHash !== blobContentHash || canonicalProductProductionJsonV2({ ...frozen, blobContentHash }) !== canonicalProductProductionJsonV2(raw)) throw new Error('[avg] stage asset 字段/hash 无效')
    return { ...frozen, blobContentHash }
  }, 10_000), asset => asset.assetKey, 'stage.assets')
  if (systemPlan.version === 2) {
    for (const item of systemPlan.inventory.items) for (const view of [item, ...item.variants]) {
      if (view.iconAssetKey && !assets.some(a => a.assetKey === view.iconAssetKey && a.kind === 'ui')
        || view.detailAssetKey && !assets.some(a => a.assetKey === view.detailAssetKey && ['ui','cg'].includes(a.kind))) throw new Error('[avg-inventory] 物件媒体引用缺失或类型不匹配')
    }
  }
  const reading = hasReading ? parseAvgReadingPlanV1(row.reading) : null
  if (reading) {
    for (const v of reading.voices) {
      const line = lines.find(l => l.lineKey === v.lineKey), asset = assets.find(a => a.assetKey === v.assetKey)
      if (!line || line.text !== v.text || line.textRevision !== v.textRevision || line.speakerKey !== v.speakerKey || line.locale !== v.locale
        || !asset || asset.kind !== 'voice' || !asset.mimeType.startsWith('audio/') || !Number.isFinite(asset.durationMs) || asset.durationMs! <= 0) throw new Error('[avg-reading] 配音绑定缺失或规范文本/版本/人物/语言/音频不匹配')
    }
    if (content.cues.some(c => c.type === 'play-audio' && c.loop && assets.some(a => a.assetKey === c.assetKey && a.kind === 'sfx'))) throw new Error('[avg-reading] 一次性音效不可循环，请使用环境声道')
    if (content.cues.some(c => c.type === 'play-audio' && assets.some(a => a.assetKey === c.assetKey && a.kind === 'voice'))) throw new Error('[avg-reading] 逐句配音不能同时从旧 Cue 声道重复播放')
  }
  const report = validateAvgPresentation({ content, beats: avgModuleBeatsV2({ lines }), assets })
  if (!report.valid) throw new Error(`[avg] stage 无效:${report.errors.join('；')}`)
  return { schema: 'storyforge.avg.runtime-module', version: 2, systemPlan, lines, choices,
    aspectRatio: avgEnum(row.aspectRatio, ['16:9','4:3'] as const, 'aspectRatio'), stage: { ...content, assets }, ...(reading ? { reading } : {}) }
}
export function avgExecutableModule(pkg: AnyProductRuntimePackage): AvgRuntimeModuleV2 | null {
  return pkg.version === 2 ? pkg.modules.find((module): module is AvgRuntimeModuleV2 => module.version === 2) ?? null : null
}
export function avgRuntimeStage(pkg: AnyProductRuntimePackage): AvgExecutableStageV1 | null {
  return pkg.version === 1 ? pkg.presentation ?? null : avgExecutableModule(pkg)?.stage ?? null
}
