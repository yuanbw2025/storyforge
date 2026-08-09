import type { DetailedOutline, DetailedScene, EmotionArc, ScenePace } from '../types'
import { normalizeParsedScenes } from '../ai/adapters/detail-scene-adapter'

const VALID_PACES: readonly ScenePace[] = ['slow', 'medium', 'fast', 'climax']
const VALID_EMOTION_ARCS: readonly EmotionArc[] = ['rising', 'falling', 'flat', 'wave', 'climax']
const ENHANCED_KEYS = [
  'openingHook',
  'endingCliffhanger',
  'sceneLocation',
  'emotionArc',
  'appearingCharacterIds',
  'foreshadowIds',
  'prohibitions',
  'scenes',
] as const
const SCENE_KEYS = [
  'title',
  'summary',
  'location',
  'conflict',
  'pace',
  'estimatedWords',
  'characterIds',
] as const

export type DetailedOutlineCopilotOperationV1 = 'scenes' | 'enhanced'

export interface DetailedOutlineCopilotDraftV1 {
  openingHook?: string
  endingCliffhanger?: string
  sceneLocation?: string
  emotionArc?: EmotionArc
  appearingCharacterIds?: number[]
  foreshadowIds?: number[]
  prohibitions?: string[]
  scenes: Array<{
    title: string
    summary: string
    location: string
    conflict: string
    pace: ScenePace
    estimatedWords: number
    characterIds: number[]
  }>
}

function fail(message: string): never {
  throw new Error(`细纲候选协议错误：${message}`)
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value)
  const unknown = actual.find(key => !allowed.includes(key))
  if (unknown) fail(`${label}包含未声明字段 ${unknown}`)
  const missing = required.find(key => !Object.prototype.hasOwnProperty.call(value, key))
  if (missing) fail(`${label}缺少字段 ${missing}`)
}

function text(value: unknown, label: string, max = 20_000): string {
  if (typeof value !== 'string') fail(`${label}必须是文本`)
  const result = value.trim()
  if (result.length > max) fail(`${label}超过 ${max} 字符`)
  return result
}

function integerIds(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) fail(`${label}必须是整数数组`)
  const ids = value.map((item, index) => {
    if (!Number.isInteger(item) || (item as number) < 1) fail(`${label}[${index}] 必须是正整数`)
    return item as number
  })
  if (ids.length > 100) fail(`${label}不能超过 100 项`)
  if (new Set(ids).size !== ids.length) fail(`${label}不能包含重复 ID`)
  return ids
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) fail(`${label}必须是文本数组`)
  if (value.length > 40) fail(`${label}不能超过 40 项`)
  const items = value.map((item, index) => text(item, `${label}[${index}]`, 1_000))
  if (items.some(item => !item)) fail(`${label}不能包含空文本`)
  if (new Set(items).size !== items.length) fail(`${label}不能包含重复项`)
  return items
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  if (!trimmed) fail('输出为空')
  if (trimmed.length > 100_000) fail('输出超过 100000 字符')
  const fenced = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(trimmed)
  let value: unknown
  try {
    value = JSON.parse(fenced?.[1]?.trim() ?? trimmed)
  } catch {
    fail('输出不是严格 JSON 对象')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('顶层必须是 JSON 对象')
  return value as Record<string, unknown>
}

function parseScenes(value: unknown): DetailedOutlineCopilotDraftV1['scenes'] {
  if (!Array.isArray(value)) fail('scenes 必须是数组')
  if (value.length < 1 || value.length > 12) fail('scenes 数量必须在 1 到 12 之间')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`scenes[${index}] 必须是对象`)
    const scene = item as Record<string, unknown>
    exactKeys(
      scene,
      SCENE_KEYS,
      ['title', 'summary', 'location', 'conflict', 'pace', 'estimatedWords'],
      `scenes[${index}]`,
    )
    const title = text(scene.title, `scenes[${index}].title`, 500)
    const summary = text(scene.summary, `scenes[${index}].summary`, 4_000)
    const location = text(scene.location, `scenes[${index}].location`, 1_000)
    const conflict = text(scene.conflict, `scenes[${index}].conflict`, 2_000)
    if (!title || !summary || !conflict) fail(`scenes[${index}] 的 title、summary、conflict 不能为空`)
    if (!VALID_PACES.includes(scene.pace as ScenePace)) fail(`scenes[${index}].pace 不在允许范围`)
    if (!Number.isInteger(scene.estimatedWords) || (scene.estimatedWords as number) < 0 || (scene.estimatedWords as number) > 100_000) {
      fail(`scenes[${index}].estimatedWords 必须是 0 到 100000 的整数`)
    }
    return {
      title,
      summary,
      location,
      conflict,
      pace: scene.pace as ScenePace,
      estimatedWords: scene.estimatedWords as number,
      characterIds: scene.characterIds === undefined
        ? []
        : integerIds(scene.characterIds, `scenes[${index}].characterIds`),
    }
  })
}

export function parseDetailedOutlineCopilotDraftV1(
  raw: string,
  operation: DetailedOutlineCopilotOperationV1,
): DetailedOutlineCopilotDraftV1 {
  const value = parseJsonObject(raw)
  if (operation === 'scenes') {
    exactKeys(value, ['scenes'], ['scenes'], '场景拆分候选')
    return { scenes: parseScenes(value.scenes) }
  }
  exactKeys(
    value,
    ENHANCED_KEYS,
    [
      'openingHook',
      'endingCliffhanger',
      'sceneLocation',
      'emotionArc',
      'appearingCharacterIds',
      'foreshadowIds',
      'scenes',
    ],
    '增强细纲候选',
  )
  if (!VALID_EMOTION_ARCS.includes(value.emotionArc as EmotionArc)) fail('emotionArc 不在允许范围')
  return {
    openingHook: text(value.openingHook, 'openingHook'),
    endingCliffhanger: text(value.endingCliffhanger, 'endingCliffhanger'),
    sceneLocation: text(value.sceneLocation, 'sceneLocation'),
    emotionArc: value.emotionArc as EmotionArc,
    appearingCharacterIds: integerIds(value.appearingCharacterIds, 'appearingCharacterIds'),
    foreshadowIds: integerIds(value.foreshadowIds, 'foreshadowIds'),
    prohibitions: value.prohibitions === undefined ? [] : stringList(value.prohibitions, 'prohibitions'),
    scenes: parseScenes(value.scenes),
  }
}

function filterIds(ids: number[], validIds: ReadonlySet<number>): number[] {
  return ids.filter(id => validIds.has(id))
}

export function buildDetailedOutlineCopilotPatchV1(input: {
  raw: string
  operation: DetailedOutlineCopilotOperationV1
  currentScenes: readonly DetailedScene[]
  chapterSummary: string
  validCharacterIds: ReadonlySet<number>
  validForeshadowIds: ReadonlySet<number>
}): Partial<DetailedOutline> {
  const draft = parseDetailedOutlineCopilotDraftV1(input.raw, input.operation)
  const scenes = normalizeParsedScenes(
    draft.scenes,
    ids => filterIds(ids, input.validCharacterIds),
  )
  if (input.operation === 'scenes') {
    return {
      scenes: [...input.currentScenes, ...scenes],
      lastUsedSummary: input.chapterSummary,
    }
  }
  return {
    openingHook: draft.openingHook ?? '',
    endingCliffhanger: draft.endingCliffhanger ?? '',
    sceneLocation: draft.sceneLocation ?? '',
    emotionArc: draft.emotionArc,
    appearingCharacterIds: filterIds(draft.appearingCharacterIds ?? [], input.validCharacterIds),
    foreshadowIds: filterIds(draft.foreshadowIds ?? [], input.validForeshadowIds),
    prohibitions: draft.prohibitions ?? [],
    scenes,
    lastUsedSummary: input.chapterSummary,
  }
}

export function detailedOutlinePostStateMatchesPatchV1(
  value: unknown,
  outlineNodeId: number,
  patch: Partial<DetailedOutline>,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.outlineNodeId !== outlineNodeId) return false
  return Object.entries(patch).every(([key, expected]) => (
    JSON.stringify(record[key]) === JSON.stringify(expected)
  ))
}
