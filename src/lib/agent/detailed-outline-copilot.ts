import type { DetailedOutline, DetailedScene, EmotionArc, ScenePace } from '../types'
import { DETAILED_SCENE_TASK_FIELDS, parseDetailedSceneTaskFieldsV1, type DetailedSceneTaskV1 } from '../types/detailed-outline'
import { normalizeParsedScenes } from '../ai/adapters/detail-scene-adapter'
import { estimateTokens } from '../ai/context-budget'
import { computeKnownCostUsd } from '../ai/usage-log'
import {
  parseCreativeArtifactV1,
  type CreativeArtifactV1,
  type CreativeQualityModeV1,
} from './creative-reliability'
import { createCreativeIssueV1 } from './creative-execution'
import type { NarrativeBriefV1 } from './narrative-brief'
import { hashCanonicalValue } from './run/hash'
import { parseStructuredOutputV1 } from './structured-output-pipeline'

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
  'action',
  'sceneId',
  'title',
  'summary',
  'location',
  'conflict',
  'pace',
  'estimatedWords',
  'characterIds',
  'notes',
  ...DETAILED_SCENE_TASK_FIELDS.map(({ key }) => key),
] as const

const SCENE_ACTIONS = ['retain', 'modify', 'add', 'delete'] as const
type DetailedSceneActionV1 = typeof SCENE_ACTIONS[number]
export type DetailedScenePlanModeV1 = 'replace' | 'merge-proposal'

export type DetailedOutlineCopilotOperationV1 = 'scenes' | 'enhanced'

export interface DetailedOutlineCopilotDraftV1 {
  openingHook?: string
  endingCliffhanger?: string
  sceneLocation?: string
  emotionArc?: EmotionArc
  appearingCharacterIds?: number[]
  foreshadowIds?: number[]
  prohibitions?: string[]
  scenePlanMode: DetailedScenePlanModeV1
  scenes: Array<DetailedSceneTaskV1 & {
    action: DetailedSceneActionV1
    sceneId?: string
    title?: string
    summary?: string
    location?: string
    conflict?: string
    pace?: ScenePace
    estimatedWords?: number
    characterIds?: number[]
    notes?: string
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

function parseScenePlanMode(value: unknown): DetailedScenePlanModeV1 {
  if (value === undefined) return 'replace'
  if (value !== 'replace' && value !== 'merge-proposal') fail('scenePlanMode 必须是 replace 或 merge-proposal')
  return value
}

function parseScenes(value: unknown): DetailedOutlineCopilotDraftV1['scenes'] {
  if (!Array.isArray(value)) fail('scenes 必须是数组')
  if (value.length < 1 || value.length > 12) fail('scenes 数量必须在 1 到 12 之间')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`scenes[${index}] 必须是对象`)
    const scene = item as Record<string, unknown>
    exactKeys(scene, SCENE_KEYS, [], `scenes[${index}]`)
    const actionValue = scene.action === undefined ? 'add' : scene.action
    if (!SCENE_ACTIONS.includes(actionValue as DetailedSceneActionV1)) fail(`scenes[${index}].action 不在允许范围`)
    const action = actionValue as DetailedSceneActionV1
    const sceneId = scene.sceneId === undefined ? undefined : text(scene.sceneId, `scenes[${index}].sceneId`, 200)
    if ((action === 'retain' || action === 'modify' || action === 'delete') && !sceneId) {
      fail(`scenes[${index}] 的 ${action} 动作必须声明 sceneId`)
    }
    if (action === 'add' && sceneId) fail(`scenes[${index}] 的 add 动作不得伪造 sceneId`)
    if (action === 'retain' || action === 'delete') return { action, sceneId }
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
    if (!title || !summary) fail(`scenes[${index}] 的 title、summary 不能为空；冲突允许留白`)
    if (!VALID_PACES.includes(scene.pace as ScenePace)) fail(`scenes[${index}].pace 不在允许范围`)
    if (!Number.isInteger(scene.estimatedWords) || (scene.estimatedWords as number) < 0 || (scene.estimatedWords as number) > 100_000) {
      fail(`scenes[${index}].estimatedWords 必须是 0 到 100000 的整数`)
    }
    return {
      action,
      ...(sceneId ? { sceneId } : {}),
      title,
      summary,
      location,
      conflict,
      pace: scene.pace as ScenePace,
      estimatedWords: scene.estimatedWords as number,
      ...(scene.characterIds === undefined ? {} : { characterIds: integerIds(scene.characterIds, `scenes[${index}].characterIds`) }),
      ...(scene.notes === undefined ? {} : { notes: text(scene.notes, `scenes[${index}].notes`, 8000) }),
      ...parseDetailedSceneTaskFieldsV1(scene),
    }
  })
}

export function parseDetailedOutlineCopilotDraftV1(
  raw: string,
  operation: DetailedOutlineCopilotOperationV1,
): DetailedOutlineCopilotDraftV1 {
  const required = operation === 'scenes'
    ? ['scenes']
    : [
        'openingHook',
        'endingCliffhanger',
        'sceneLocation',
        'emotionArc',
        'appearingCharacterIds',
        'foreshadowIds',
        'scenes',
      ]
  return parseStructuredOutputV1({
    raw,
    contract: {
      version: 1,
      schemaId: `detailed-outline-${operation}-candidate.v1`,
      target: operation === 'scenes' ? 'detailedOutlines.scenes' : 'detailedOutlines.enhanced',
      root: 'object',
      maxChars: 100_000,
      allowedRootFields: operation === 'scenes' ? ['scenePlanMode', 'scenes'] : ['scenePlanMode', ...ENHANCED_KEYS],
      requiredRootFields: required,
    },
    parse: parsed => {
      const value = parsed as Record<string, unknown>
      const scenePlanMode = parseScenePlanMode(value.scenePlanMode)
      if (operation === 'scenes') {
        exactKeys(value, ['scenePlanMode', 'scenes'], ['scenes'], '场景拆分候选')
        return { scenePlanMode, scenes: parseScenes(value.scenes) }
      }
      exactKeys(value, ['scenePlanMode', ...ENHANCED_KEYS], required, '增强细纲候选')
      if (!VALID_EMOTION_ARCS.includes(value.emotionArc as EmotionArc)) fail('emotionArc 不在允许范围')
      return {
        scenePlanMode,
        openingHook: text(value.openingHook, 'openingHook'),
        endingCliffhanger: text(value.endingCliffhanger, 'endingCliffhanger'),
        sceneLocation: text(value.sceneLocation, 'sceneLocation'),
        emotionArc: value.emotionArc as EmotionArc,
        appearingCharacterIds: integerIds(value.appearingCharacterIds, 'appearingCharacterIds'),
        foreshadowIds: integerIds(value.foreshadowIds, 'foreshadowIds'),
        prohibitions: value.prohibitions === undefined ? [] : stringList(value.prohibitions, 'prohibitions'),
        scenes: parseScenes(value.scenes),
      }
    },
  })
}

function detailedOutlineArtifactBodyV1(input: {
  raw: string
  operation: DetailedOutlineCopilotOperationV1
  narrativeBrief: NarrativeBriefV1
}) {
  try {
    const output = parseDetailedOutlineCopilotDraftV1(input.raw, input.operation)
    return {
      status: 'ready' as const,
      validFragments: output.scenes.map((scene, index) => ({
        version: 1 as const,
        id: `detailed-outline:scene:${index}`,
        path: `$.scenes[${index}]`,
        text: JSON.stringify(scene, null, 2),
        status: 'valid' as const,
        issueCodes: [],
      })),
      rejectedFragments: [],
      issues: [],
      assumptions: input.narrativeBrief.assumptions,
    }
  } catch (error) {
    const issue = createCreativeIssueV1({
      code: 'detailed-outline-response-invalid',
      path: '$',
      message: error instanceof Error ? error.message : '场景细纲结构无效。',
      action: 'edit',
    })
    return {
      status: 'manual-repair' as const,
      validFragments: [],
      rejectedFragments: [{
        version: 1 as const,
        id: 'detailed-outline:response',
        path: '$',
        text: input.raw.slice(0, 40_000),
        status: 'rejected' as const,
        issueCodes: [issue.code],
      }],
      issues: [issue],
      assumptions: input.narrativeBrief.assumptions,
    }
  }
}

export async function createDetailedOutlineCreativeArtifactV1(input: {
  raw: string
  operation: DetailedOutlineCopilotOperationV1
  narrativeBrief: NarrativeBriefV1
  qualityMode: CreativeQualityModeV1
  modelIdentity: { provider: string; model: string }
  inputText: string
  durationMs: number
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number }
}): Promise<CreativeArtifactV1> {
  const body = detailedOutlineArtifactBodyV1(input)
  const inputTokens = input.usage?.inputTokens ?? estimateTokens(input.inputText)
  const outputTokens = input.usage?.outputTokens ?? estimateTokens(input.raw)
  return parseCreativeArtifactV1({
    version: 1,
    policyVersion: 'creative-reliability-v1',
    ...body,
    qualityMode: input.qualityMode,
    originalText: input.raw,
    editableText: input.raw,
    canonEvidenceRefs: [],
    callEvidence: [{
      version: 1,
      callIndex: 1,
      purpose: 'generate',
      status: 'succeeded',
      provider: input.modelIdentity.provider,
      model: input.modelIdentity.model,
      usageSource: input.usage ? 'provider' : 'estimated',
      inputTokens,
      outputTokens,
      totalTokens: input.usage?.totalTokens ?? inputTokens + outputTokens,
      latencyMs: input.durationMs,
      estimatedCostUsd: computeKnownCostUsd(input.modelIdentity.model, inputTokens, outputTokens),
      outputHash: await hashCanonicalValue(input.raw),
    }],
    repair: null,
  })
}

export function revalidateDetailedOutlineCreativeDraftV1(input: {
  raw: string
  operation: DetailedOutlineCopilotOperationV1
  narrativeBrief: NarrativeBriefV1
  previousArtifact: CreativeArtifactV1
}): CreativeArtifactV1 {
  return parseCreativeArtifactV1({
    ...input.previousArtifact,
    ...detailedOutlineArtifactBodyV1(input),
    editableText: input.raw,
  })
}

function filterIds(ids: number[], validIds: ReadonlySet<number>): number[] {
  return ids.filter(id => validIds.has(id))
}

function sceneContent(
  operation: DetailedOutlineCopilotDraftV1['scenes'][number],
  validCharacterIds: ReadonlySet<number>,
): Omit<DetailedScene, 'sceneId'> {
  if (operation.action !== 'add' && operation.action !== 'modify') {
    fail(`${operation.action} 场景没有可写正文`)
  }
  const normalized = normalizeParsedScenes([{
    title: operation.title ?? '',
    summary: operation.summary ?? '',
    location: operation.location ?? '',
    conflict: operation.conflict ?? '',
    pace: operation.pace ?? 'medium',
    estimatedWords: operation.estimatedWords ?? 0,
    characterIds: operation.characterIds ?? [],
    notes: operation.notes,
    ...parseDetailedSceneTaskFieldsV1(operation as unknown as Record<string, unknown>),
  }], ids => filterIds(ids, validCharacterIds))[0]
  if (!normalized) fail('场景正文无法归一化')
  const { sceneId: _sceneId, ...content } = normalized
  return content
}

function mergeDetailedScenesV1(input: {
  planMode: DetailedScenePlanModeV1
  operations: DetailedOutlineCopilotDraftV1['scenes']
  currentScenes: readonly DetailedScene[]
  validCharacterIds: ReadonlySet<number>
}): DetailedScene[] {
  if (!input.currentScenes.length) {
    if (input.planMode !== 'replace') fail('空细纲首次生成必须声明 scenePlanMode=replace')
    if (input.operations.some(operation => operation.action !== 'add')) fail('首次生成只能声明 add 场景')
    return normalizeParsedScenes(input.operations.map(operation => ({
      title: operation.title ?? '',
      summary: operation.summary ?? '',
      location: operation.location ?? '',
      conflict: operation.conflict ?? '',
      pace: operation.pace ?? 'medium',
      estimatedWords: operation.estimatedWords ?? 0,
      characterIds: operation.characterIds ?? [],
      notes: operation.notes,
      ...parseDetailedSceneTaskFieldsV1(operation as unknown as Record<string, unknown>),
    })), ids => filterIds(ids, input.validCharacterIds))
  }
  if (input.planMode !== 'merge-proposal') {
    fail('已有场景时必须声明 scenePlanMode=merge-proposal，禁止无条件追加或覆盖')
  }
  const byId = new Map(input.currentScenes.map(scene => [scene.sceneId, scene]))
  if (byId.size !== input.currentScenes.length || byId.has('')) fail('已有场景缺少唯一稳定 sceneId')
  const decisions = new Map<string, DetailedOutlineCopilotDraftV1['scenes'][number]>()
  const additions: DetailedScene[] = []
  for (const operation of input.operations) {
    if (operation.action === 'add') {
      const normalized = normalizeParsedScenes([{
        title: operation.title ?? '', summary: operation.summary ?? '', location: operation.location ?? '',
        conflict: operation.conflict ?? '', pace: operation.pace ?? 'medium',
        estimatedWords: operation.estimatedWords ?? 0, characterIds: operation.characterIds ?? [],
        notes: operation.notes,
        ...parseDetailedSceneTaskFieldsV1(operation as unknown as Record<string, unknown>),
      }], ids => filterIds(ids, input.validCharacterIds))[0]
      if (!normalized) fail('新增场景无法归一化')
      additions.push(normalized)
      continue
    }
    const sceneId = operation.sceneId!
    if (!byId.has(sceneId)) fail(`模型返回未知 sceneId ${sceneId}`)
    if (decisions.has(sceneId)) fail(`sceneId ${sceneId} 被重复声明`)
    decisions.set(sceneId, operation)
  }
  const missing = input.currentScenes.find(scene => !decisions.has(scene.sceneId))
  if (missing) fail(`已有场景 ${missing.sceneId} 未声明保留、修改或删除`)
  const merged = input.currentScenes.flatMap(scene => {
    const decision = decisions.get(scene.sceneId)!
    if (decision.action === 'delete') return []
    if (decision.action === 'retain') return [{ ...scene }]
    return [{ ...scene, ...sceneContent(decision, input.validCharacterIds), sceneId: scene.sceneId,
      ...(decision.notes === undefined ? { notes: scene.notes } : {}),
      ...(decision.characterIds === undefined ? { characterIds: scene.characterIds } : {}),
    }]
  }).concat(additions)
  const signatures = merged.map(scene => [scene.title, scene.summary, scene.location, scene.conflict]
    .map(value => value.trim().toLocaleLowerCase()).join('\u0000'))
  if (new Set(signatures).size !== signatures.length) fail('合并结果包含重复场景')
  return merged
}

export function buildDetailedOutlineSceneMergeGuidanceV1(
  currentScenes: readonly DetailedScene[],
): string {
  if (!currentScenes.length) {
    return '场景协议：输出 scenePlanMode="replace"；每个 scenes 项声明 action="add"，不得提供 sceneId。可选文本字段 entryState（进入状态）、goal（目标）、keyChoice（关键选择）、outcome（后果）、exitState（退出状态）、sceneFunction（场景功能与读者期待）、notes（备注）；按需填写，允许留白。conflict 也允许留白，日常和缓冲场景不强制添加阻力。'
  }
  return [
    '场景协议：已有场景时输出 scenePlanMode="merge-proposal"。',
    '必须对下面每个 sceneId 恰好声明一次 action="retain"|"modify"|"delete"；新增场景用 action="add" 且不得提供 sceneId。',
    'retain/delete 只需 action 与 sceneId；modify/add 还需完整 title/summary/location/conflict/pace/estimatedWords/characterIds。',
    '可选任务字段：entryState/goal/keyChoice/outcome/exitState/sceneFunction；notes 为作者备注。修改时省略的任务字段和备注保留原值；需要清空必须显式输出空字符串。允许安静场景，conflict 可留白。',
    `已有场景：${JSON.stringify(currentScenes)}`,
  ].join('\n')
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
  const scenes = mergeDetailedScenesV1({
    planMode: draft.scenePlanMode,
    operations: draft.scenes,
    currentScenes: input.currentScenes,
    validCharacterIds: input.validCharacterIds,
  })
  if (input.operation === 'scenes') {
    return {
      scenes,
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
