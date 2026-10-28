import { parseAvgAssemblyBriefV1, type AvgAssemblyBriefV1 } from './assembly-contract'
import { avgEnum, avgHash, avgProtocolBody, avgRecord } from './protocol-validation'
import { parseAvgSoundPlanningScopeV1, type AvgSoundPlanningScopeV1 } from './sound-scope-contract'
import { parseAvgSoundLocalRepairV1, type AvgSoundLocalRepairV1 } from './sound-local-repair-contract'

export const AVG_SOUND_TEXT_CAPABILITY_V1 = 'avg.sound.planning.text'
export const AVG_SOUND_MUSIC_CAPABILITY_V1 = 'avg.media.music'
export const AVG_SOUND_TEXT_DATA_CLASS_V1 = 'avg-sound-planning-text-v1'
export const AVG_SOUND_MUSIC_DATA_CLASS_V1 = 'avg-music-prompt-v1'
export const AVG_SOUND_CONTEXT_V1 = 'product-production.avg-sound-planning-inputs'

/** New private production declaration. Old image/voice Briefs are not converted
 * into this contract and their original hashes retain their meaning. Route
 * declarations do not prove a live service, rights or actual audio bytes. */
export interface AvgSoundPlanningBriefV1 {
  schema: 'storyforge.avg.sound-planning-brief'; version: 1
  assembly: AvgAssemblyBriefV1
  aspectRatio: '16:9' | '4:3'
  scope: AvgSoundPlanningScopeV1
  musicBinding: null | {
    adapterId: 'storyforge.avg.local-music.v1'
    requirementKey: typeof AVG_SOUND_MUSIC_CAPABILITY_V1
    bindingHash: string; endpointRouteHash: string
  }
}

export function parseAvgSoundPlanningBriefV1(value: unknown): AvgSoundPlanningBriefV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'assembly', 'aspectRatio', 'scope', 'musicBinding'], 'sound production Brief')
  if (r.schema !== 'storyforge.avg.sound-planning-brief' || r.version !== 1) throw new Error('[avg-sound] 声音制作 Brief 版本无效')
  const assembly = parseAvgAssemblyBriefV1(r.assembly), scope = parseAvgSoundPlanningScopeV1(r.scope)
  if (scope.templates.some(t => !assembly.sceneKeys.includes(t.consumer.sceneKey!) || !assembly.mediaAssetKeys.includes(t.assetKey))) {
    throw new Error('[avg-sound] 声音场景和媒资必须属于本次准确组装目录')
  }
  const needsMusic = scope.templates.some(t => t.source.kind === 'generate-music')
  if (needsMusic === (r.musicBinding === null)) throw new Error('[avg-sound] 音乐路由必须准确对应本批实际生成需求')
  let musicBinding: AvgSoundPlanningBriefV1['musicBinding'] = null
  if (r.musicBinding !== null) {
    const b = avgRecord(r.musicBinding, ['adapterId', 'requirementKey', 'bindingHash', 'endpointRouteHash'], 'local music binding')
    if (b.adapterId !== 'storyforge.avg.local-music.v1' || b.requirementKey !== AVG_SOUND_MUSIC_CAPABILITY_V1) throw new Error('[avg-sound] 不接受未登记音乐接口或其他媒资路由')
    musicBinding = { adapterId: b.adapterId, requirementKey: b.requirementKey,
      bindingHash: avgHash(b.bindingHash, 'music binding hash'), endpointRouteHash: avgHash(b.endpointRouteHash, 'music route hash') }
  }
  return { schema: r.schema, version: 1, assembly, aspectRatio: avgEnum(r.aspectRatio, ['16:9', '4:3'] as const, 'sound source aspect ratio'), scope, musicBinding }
}

/** Bounded experimental original Sound factory, default hidden. This flag
 * grants no start/adoption by itself: original source/route, Brief/Plan/Run,
 * native observation, author commands and Preview proofs remain mandatory.
 * Local prototype publication additionally needs full catalog/route evidence
 * and an explicit author command; commercial quality remains separate. */
export function avgSoundProductionExecutionReadyV1(): boolean {
  return import.meta.env.VITE_STORYFORGE_AVG_SOUND_PRODUCTION === '1'
}

/** Default-hidden author requirement editor only. This switch never opens
 * preparation, authorization, model/audio dispatch, review or adoption. */
export function avgSoundPreparationEnabledV1(): boolean {
  return import.meta.env.VITE_STORYFORGE_AVG_SOUND_PREPARATION === '1'
}

/** Explicit single adopted-sound repair. Original scope/plan live only in
 * repair as immutable source snapshots, never a new full-batch generation
 * range. There is no text/music capability or provider route in this variant. */
export interface AvgSoundPlanningBriefV2 {
  schema: 'storyforge.avg.sound-planning-brief'
  version: 2
  assembly: AvgAssemblyBriefV1
  aspectRatio: '16:9' | '4:3'
  repair: AvgSoundLocalRepairV1
}
export type AvgSoundPlanningBrief = AvgSoundPlanningBriefV1 | AvgSoundPlanningBriefV2

export function parseAvgSoundPlanningBriefV2(value: unknown): AvgSoundPlanningBriefV2 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'assembly', 'aspectRatio', 'repair'], 'sound repair Brief')
  if (r.schema !== 'storyforge.avg.sound-planning-brief' || r.version !== 2) throw new Error('[avg-sound-repair] 声音返修Brief版本无效')
  const assembly = parseAvgAssemblyBriefV1(r.assembly), repair = parseAvgSoundLocalRepairV1(r.repair)
  const template = repair.sourceScope.templates.find(t => t.requirementKey === repair.source.requirementKey)!
  if (!assembly.sceneKeys.includes(template.consumer.sceneKey!) || !assembly.mediaAssetKeys.includes(template.assetKey)) {
    throw new Error('[avg-sound-repair] 所选声音必须属于本次准确组装场景与媒资目录')
  }
  return { schema: r.schema, version: 2, assembly,
    aspectRatio: avgEnum(r.aspectRatio, ['16:9', '4:3'] as const, 'sound repair aspect ratio'), repair }
}

/** Reading a successor does not enable its production path. The original V1
 * parser remains strict and unchanged; unknown versions are never guessed. */
export function parseAvgSoundPlanningBrief(value: unknown): AvgSoundPlanningBrief {
  const body = avgProtocolBody(value)
  return (body as { version?: unknown } | null)?.version === 2
    ? parseAvgSoundPlanningBriefV2(body) : parseAvgSoundPlanningBriefV1(body)
}

/** Actual current production targets only. The full origin scope on a repair
 * remains an immutable witness; it never becomes a new generation range. */
export function avgSoundProductionTemplates(sound: AvgSoundPlanningBrief) {
  return sound.version === 1 ? sound.scope.templates
    : sound.repair.sourceScope.templates.filter(t => t.requirementKey === sound.repair.source.requirementKey)
}
