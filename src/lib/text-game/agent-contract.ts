import type {
  GameProductType,
  NarrativeBeatKind,
  NarrativeModuleKind,
  NarrativeNodeKind,
  WorldGameSourceSelectionV1,
} from '../types'
import {
  NARRATIVE_BEAT_KINDS,
  NARRATIVE_MODULE_KINDS,
  NARRATIVE_NODE_KINDS,
} from '../types'
import type { PortableStoryGameDraftV1 } from './world-generation'

export type WorldGameAuthoringProductV1 = Extract<
  GameProductType,
  'storygame' | 'text-adventure' | 'avg'
>

export interface WorldGameAuthoringRequestV1 {
  schema: 'storyforge.world-game-authoring-request'
  version: 1
  productType: WorldGameAuthoringProductV1
  worldReleaseId: number
  worldContentHash: string
  narrativeModuleExportId: number
  characterExportIds: number[]
  characterRelationExportIds: number[]
  importantLocationExportIds: number[]
  artifactExportIds: number[]
  codexEntryExportIds: number[]
  storyArcExportIds: number[]
  avgMediaAssetExportIds: number[]
  creativeBrief: string
}

export interface WorldGameNarrativeBeatCandidateV1 {
  beatKey: string
  kind: NarrativeBeatKind
  speakerCharacterExportId: number | null
  text: string
}

export interface WorldGameNarrativeChoiceCandidateV1 {
  choiceKey: string
  text: string
  description: string
  targetNodeKey: string
}

export interface WorldGameNarrativeNodeCandidateV1 {
  key: string
  kind: NarrativeNodeKind
  title: string
  summary: string
  beats: WorldGameNarrativeBeatCandidateV1[]
  choices: WorldGameNarrativeChoiceCandidateV1[]
}

export interface WorldGameNarrativeCandidateV1 {
  version: 1
  title: string
  description: string
  moduleKind: NarrativeModuleKind
  entryNodeKey: string
  nodes: WorldGameNarrativeNodeCandidateV1[]
}

const REQUEST_MARKER = 'STORYFORGE_WORLD_GAME_REQUEST_V1:'
const STABLE_KEY = /^[a-zA-Z0-9._:-]+$/
const REQUEST_ID_FIELDS = [
  'characterExportIds',
  'characterRelationExportIds',
  'importantLocationExportIds',
  'artifactExportIds',
  'codexEntryExportIds',
  'storyArcExportIds',
  'avgMediaAssetExportIds',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort()
  const expected = [...required].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} 字段不符合严格协议`)
  }
}

function stringValue(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`${label} 必须是 1-${max} 字符的非空字符串`)
  }
  return value.trim()
}

function stableKey(value: unknown, label: string): string {
  const key = stringValue(value, label, 120)
  if (!STABLE_KEY.test(key)) throw new Error(`${label} 只能包含字母、数字、点、下划线、冒号或短横线`)
  return key
}

function portableIds(value: unknown, label: string): number[] {
  if (!Array.isArray(value)
    || value.some(item => !Number.isInteger(item) || Number(item) < 0)
    || new Set(value).size !== value.length) {
    throw new Error(`${label} 必须是不重复的非负整数数组`)
  }
  return value.map(Number)
}

export function parseWorldGameAuthoringRequestV1(value: unknown): WorldGameAuthoringRequestV1 {
  if (!isRecord(value)) throw new Error('世界游戏创作请求必须是对象')
  exactKeys(value, [
    'schema',
    'version',
    'productType',
    'worldReleaseId',
    'worldContentHash',
    'narrativeModuleExportId',
    ...REQUEST_ID_FIELDS,
    'creativeBrief',
  ], '世界游戏创作请求')
  if (value.schema !== 'storyforge.world-game-authoring-request' || value.version !== 1) {
    throw new Error('世界游戏创作请求版本不支持')
  }
  if (!['storygame', 'text-adventure', 'avg'].includes(String(value.productType))) {
    throw new Error('世界游戏创作请求产品类型无效')
  }
  if (!Number.isInteger(value.worldReleaseId) || Number(value.worldReleaseId) < 1) {
    throw new Error('世界游戏创作请求缺少 WorldRelease')
  }
  if (typeof value.worldContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.worldContentHash)) {
    throw new Error('世界游戏创作请求 contentHash 无效')
  }
  if (!Number.isInteger(value.narrativeModuleExportId) || Number(value.narrativeModuleExportId) < 0) {
    throw new Error('世界游戏创作请求叙事 exportId 无效')
  }
  return {
    schema: 'storyforge.world-game-authoring-request',
    version: 1,
    productType: value.productType as WorldGameAuthoringProductV1,
    worldReleaseId: Number(value.worldReleaseId),
    worldContentHash: value.worldContentHash,
    narrativeModuleExportId: Number(value.narrativeModuleExportId),
    characterExportIds: portableIds(value.characterExportIds, 'characterExportIds'),
    characterRelationExportIds: portableIds(value.characterRelationExportIds, 'characterRelationExportIds'),
    importantLocationExportIds: portableIds(value.importantLocationExportIds, 'importantLocationExportIds'),
    artifactExportIds: portableIds(value.artifactExportIds, 'artifactExportIds'),
    codexEntryExportIds: portableIds(value.codexEntryExportIds, 'codexEntryExportIds'),
    storyArcExportIds: portableIds(value.storyArcExportIds, 'storyArcExportIds'),
    avgMediaAssetExportIds: portableIds(value.avgMediaAssetExportIds, 'avgMediaAssetExportIds'),
    creativeBrief: stringValue(value.creativeBrief, 'creativeBrief', 2_000),
  }
}

export function encodeWorldGameAuthoringInstructionV1(request: WorldGameAuthoringRequestV1): string {
  const parsed = parseWorldGameAuthoringRequestV1(request)
  return `${parsed.creativeBrief}\n\n${REQUEST_MARKER}${JSON.stringify(parsed)}`
}

export function parseWorldGameAuthoringInstructionV1(value: string): WorldGameAuthoringRequestV1 | null {
  const index = value.lastIndexOf(REQUEST_MARKER)
  if (index < 0) return null
  const encoded = value.slice(index + REQUEST_MARKER.length).trim()
  try {
    return parseWorldGameAuthoringRequestV1(JSON.parse(encoded))
  } catch (error) {
    throw new Error(`主 Agent 的世界游戏选择无效：${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseBeat(
  value: unknown,
  nodeIndex: number,
  beatIndex: number,
  allowedSpeakers: Set<number>,
): WorldGameNarrativeBeatCandidateV1 {
  const label = `节点 ${nodeIndex + 1} 的 Beat ${beatIndex + 1}`
  if (!isRecord(value)) throw new Error(`${label} 必须是对象`)
  exactKeys(value, ['beatKey', 'kind', 'speakerCharacterExportId', 'text'], label)
  if (!NARRATIVE_BEAT_KINDS.includes(value.kind as NarrativeBeatKind)) throw new Error(`${label}.kind 无效`)
  const speaker = value.speakerCharacterExportId
  if (speaker !== null && (!Number.isInteger(speaker) || !allowedSpeakers.has(Number(speaker)))) {
    throw new Error(`${label} 引用了未选择的角色 exportId`)
  }
  if (value.kind === 'dialogue' && speaker === null) throw new Error(`${label} 的对白缺少角色 exportId`)
  return {
    beatKey: stableKey(value.beatKey, `${label}.beatKey`),
    kind: value.kind as NarrativeBeatKind,
    speakerCharacterExportId: speaker === null ? null : Number(speaker),
    text: stringValue(value.text, `${label}.text`, 2_000),
  }
}

function parseChoice(value: unknown, nodeIndex: number, choiceIndex: number): WorldGameNarrativeChoiceCandidateV1 {
  const label = `节点 ${nodeIndex + 1} 的 Choice ${choiceIndex + 1}`
  if (!isRecord(value)) throw new Error(`${label} 必须是对象`)
  exactKeys(value, ['choiceKey', 'text', 'description', 'targetNodeKey'], label)
  return {
    choiceKey: stableKey(value.choiceKey, `${label}.choiceKey`),
    text: stringValue(value.text, `${label}.text`, 240),
    description: stringValue(value.description, `${label}.description`, 800),
    targetNodeKey: stableKey(value.targetNodeKey, `${label}.targetNodeKey`),
  }
}

function parseNode(
  value: unknown,
  index: number,
  allowedSpeakers: Set<number>,
): WorldGameNarrativeNodeCandidateV1 {
  const label = `节点 ${index + 1}`
  if (!isRecord(value)) throw new Error(`${label} 必须是对象`)
  exactKeys(value, ['key', 'kind', 'title', 'summary', 'beats', 'choices'], label)
  if (!NARRATIVE_NODE_KINDS.includes(value.kind as NarrativeNodeKind)) throw new Error(`${label}.kind 无效`)
  if (!Array.isArray(value.beats) || value.beats.length < 1 || value.beats.length > 8) {
    throw new Error(`${label}.beats 必须包含 1-8 个节拍`)
  }
  if (!Array.isArray(value.choices) || value.choices.length > 4) {
    throw new Error(`${label}.choices 最多包含 4 个选项`)
  }
  return {
    key: stableKey(value.key, `${label}.key`),
    kind: value.kind as NarrativeNodeKind,
    title: stringValue(value.title, `${label}.title`, 160),
    summary: stringValue(value.summary, `${label}.summary`, 1_000),
    beats: value.beats.map((beat, beatIndex) => parseBeat(beat, index, beatIndex, allowedSpeakers)),
    choices: value.choices.map((choice, choiceIndex) => parseChoice(choice, index, choiceIndex)),
  }
}

function assertPlayableGraph(candidate: WorldGameNarrativeCandidateV1): void {
  const nodeKeys = candidate.nodes.map(node => node.key)
  if (new Set(nodeKeys).size !== nodeKeys.length) throw new Error('AI 游戏候选包含重复节点 key')
  const nodeByKey = new Map(candidate.nodes.map(node => [node.key, node]))
  const entry = nodeByKey.get(candidate.entryNodeKey)
  if (!entry || entry.kind !== 'entry') throw new Error('AI 游戏候选入口不存在或不是 entry 节点')
  if (candidate.nodes.filter(node => node.kind === 'entry').length !== 1) throw new Error('AI 游戏候选必须且只能有一个 entry')
  if (candidate.nodes.filter(node => node.kind === 'ending').length < 2) throw new Error('AI 游戏候选至少需要两个不同结局')
  if (!candidate.nodes.some(node => node.choices.length >= 2)) throw new Error('AI 游戏候选至少需要一个真正的分支点')
  const beatKeys = candidate.nodes.flatMap(node => node.beats.map(beat => beat.beatKey))
  if (new Set(beatKeys).size !== beatKeys.length) throw new Error('AI 游戏候选包含重复 Beat key')
  const choiceKeys = candidate.nodes.flatMap(node => node.choices.map(choice => choice.choiceKey))
  if (new Set(choiceKeys).size !== choiceKeys.length) throw new Error('AI 游戏候选包含重复 Choice key')
  for (const node of candidate.nodes) {
    if (node.kind === 'ending' && node.choices.length) throw new Error(`结局节点 ${node.key} 不得继续分支`)
    if (node.kind !== 'ending' && !node.choices.length) throw new Error(`非结局节点 ${node.key} 形成死路`)
    for (const choice of node.choices) {
      if (!nodeByKey.has(choice.targetNodeKey)) throw new Error(`Choice ${choice.choiceKey} 指向不存在节点`)
    }
  }
  const visited = new Set<string>()
  const active = new Set<string>()
  let hasCycle = false
  const walk = (key: string) => {
    if (active.has(key)) { hasCycle = true; return }
    if (visited.has(key)) return
    visited.add(key); active.add(key)
    for (const choice of nodeByKey.get(key)?.choices ?? []) walk(choice.targetNodeKey)
    active.delete(key)
  }
  walk(candidate.entryNodeKey)
  const unreachable = nodeKeys.filter(key => !visited.has(key))
  if (unreachable.length) throw new Error(`AI 游戏候选包含不可达节点：${unreachable.join('、')}`)
  if (hasCycle) throw new Error('AI 游戏候选包含循环风险；演示版只接受可终止有向图')
}

export function parseWorldGameNarrativeCandidateV1(
  draft: string,
  request: WorldGameAuthoringRequestV1,
): WorldGameNarrativeCandidateV1 {
  const source = draft.trim()
  if (!source || source.length > 160_000) throw new Error('AI 游戏候选为空或过长')
  const fenced = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(source)?.[1]?.trim() ?? source
  let value: unknown
  try { value = JSON.parse(fenced) } catch { throw new Error('AI 游戏候选不是严格 JSON') }
  if (!isRecord(value)) throw new Error('AI 游戏候选必须是对象')
  exactKeys(value, ['version', 'title', 'description', 'moduleKind', 'entryNodeKey', 'nodes'], 'AI 游戏候选')
  if (value.version !== 1) throw new Error('AI 游戏候选版本不支持')
  if (!NARRATIVE_MODULE_KINDS.includes(value.moduleKind as NarrativeModuleKind)) {
    throw new Error('AI 游戏候选 moduleKind 无效')
  }
  if (!Array.isArray(value.nodes) || value.nodes.length < 5 || value.nodes.length > 18) {
    throw new Error('AI 游戏候选必须包含 5-18 个节点')
  }
  const allowedSpeakers = new Set(request.characterExportIds)
  const candidate: WorldGameNarrativeCandidateV1 = {
    version: 1,
    title: stringValue(value.title, 'AI 游戏标题', 160),
    description: stringValue(value.description, 'AI 游戏说明', 2_000),
    moduleKind: value.moduleKind as NarrativeModuleKind,
    entryNodeKey: stableKey(value.entryNodeKey, 'entryNodeKey'),
    nodes: value.nodes.map((node, index) => parseNode(node, index, allowedSpeakers)),
  }
  assertPlayableGraph(candidate)
  return candidate
}

export function worldGameRequestToSourceSelectionV1(
  request: WorldGameAuthoringRequestV1,
): WorldGameSourceSelectionV1 {
  return {
    schema: 'storyforge.world-game-source',
    version: 1,
    productType: request.productType,
    worldContentHash: request.worldContentHash,
    narrativeModuleExportId: request.narrativeModuleExportId,
    characterExportIds: request.characterExportIds,
    characterRelationExportIds: request.characterRelationExportIds,
    importantLocationExportIds: request.importantLocationExportIds,
    artifactExportIds: request.artifactExportIds,
    codexEntryExportIds: request.codexEntryExportIds,
    storyArcExportIds: request.storyArcExportIds,
    avgMediaAssetExportIds: request.avgMediaAssetExportIds,
  }
}

export function worldGameCandidateToPortableDraftV1(
  candidate: WorldGameNarrativeCandidateV1,
  request: WorldGameAuthoringRequestV1,
): PortableStoryGameDraftV1 {
  return {
    source: worldGameRequestToSourceSelectionV1(request),
    title: candidate.title,
    description: candidate.description,
    moduleKind: candidate.moduleKind,
    entryNodeKey: candidate.entryNodeKey,
    nodes: candidate.nodes.map((node, order) => ({
      key: node.key,
      kind: node.kind,
      title: node.title,
      summary: node.summary,
      conditionJson: '{}',
      effectsJson: '[]',
      successorKeys: node.choices.map(choice => choice.targetNodeKey),
      order,
    })),
    beats: candidate.nodes.flatMap(node => node.beats.map((beat, order) => ({
      ...beat,
      nodeKey: node.key,
      order,
    }))),
    choices: candidate.nodes.flatMap(node => node.choices.map((choice, order) => ({
      sourceNodeKey: node.key,
      ...choice,
      unavailableReason: '',
      displayConditionJson: '{}',
      availableConditionJson: '{}',
      effectsJson: '[]',
      tagsJson: '["ai-authored"]',
      order,
    }))),
  }
}
