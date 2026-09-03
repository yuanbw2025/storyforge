import { db } from '../db/schema'
import type { GenerationGateIssue } from '../generation/generation-node'
import {
  readCognitionAuditSnapshot,
  type CognitionCatalogEntry,
  type ProjectedKnowledge,
} from '../knowledge-ledger/knowledge-ledger'
import { walkOutlineChaptersInCanonicalOrder } from '../outline/canonical-outline-walk'
import {
  parseCharacterDrivenPlanArcs,
  parseCharacterDrivenPlotVolumes,
} from '../types/character-driven-plan'
import { parseStages } from '../types/story-arc'
import type {
  Character,
  OutlineNode,
  StoryArc,
  StorylineProgress,
  WorkspaceScope,
} from '../types'
import { readOwnedRows } from '../workspace/scope'
import { hashCanonicalValue } from './run/hash'

export const INFORMATION_BOUNDARY_VERSION_V1 = 1

export type InformationBoundaryClaimKindV1 =
  | 'future-outline'
  | 'private-knowledge'
  | 'character-future'
  | 'storyline-future'

export interface InformationBoundaryClaimV1 {
  id: string
  kind: InformationBoundaryClaimKindV1
  text: string
  sourceId: string
  characterId?: number
  characterName?: string
}

export interface InformationBoundaryManifestV1 {
  version: typeof INFORMATION_BOUNDARY_VERSION_V1
  projectId: number
  worldGroupId: number | null
  chapterId: number | null
  outlineNodeId: number
  chapterOrdinal: number
  perspectiveCharacterId: number | null
  perspectiveCharacterName: string | null
  allowedKnowledgeKeys: string[]
  forbiddenClaims: InformationBoundaryClaimV1[]
  manifestHash: string
}

function boundaryRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function boundaryInteger(value: unknown, label: string, nullable = false): number | null {
  if (nullable && value === null) return null
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${label} 必须是非负整数。`)
  return value as number
}

function boundaryString(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串。`)
  return value.trim()
}

export function parseInformationBoundaryManifestV1(value: unknown): InformationBoundaryManifestV1 {
  if (!boundaryRecord(value)) throw new Error('信息边界清单必须是对象。')
  const keys = [
    'version', 'projectId', 'worldGroupId', 'chapterId', 'outlineNodeId', 'chapterOrdinal',
    'perspectiveCharacterId', 'perspectiveCharacterName', 'allowedKnowledgeKeys',
    'forbiddenClaims', 'manifestHash',
  ]
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    throw new Error('信息边界清单字段无效。')
  }
  if (value.version !== INFORMATION_BOUNDARY_VERSION_V1) throw new Error('信息边界清单版本无效。')
  if (!Array.isArray(value.allowedKnowledgeKeys) || value.allowedKnowledgeKeys.length > 10_000) {
    throw new Error('信息边界清单 allowedKnowledgeKeys 无效。')
  }
  const allowedKnowledgeKeys = value.allowedKnowledgeKeys.map((item, index) => (
    boundaryString(item, `allowedKnowledgeKeys[${index}]`)!
  ))
  if (new Set(allowedKnowledgeKeys).size !== allowedKnowledgeKeys.length) {
    throw new Error('信息边界清单 allowedKnowledgeKeys 重复。')
  }
  if (!Array.isArray(value.forbiddenClaims) || value.forbiddenClaims.length > 10_000) {
    throw new Error('信息边界清单 forbiddenClaims 无效。')
  }
  const forbiddenClaims = value.forbiddenClaims.map((item, index): InformationBoundaryClaimV1 => {
    if (!boundaryRecord(item)) throw new Error(`forbiddenClaims[${index}] 必须是对象。`)
    const required = ['id', 'kind', 'text', 'sourceId']
    const optional = ['characterId', 'characterName']
    const actual = Object.keys(item)
    if (required.some(key => !(key in item)) || actual.some(key => !required.includes(key) && !optional.includes(key))) {
      throw new Error(`forbiddenClaims[${index}] 字段无效。`)
    }
    const kind = item.kind
    if (!['future-outline', 'private-knowledge', 'character-future', 'storyline-future'].includes(String(kind))) {
      throw new Error(`forbiddenClaims[${index}].kind 无效。`)
    }
    return {
      id: boundaryString(item.id, `forbiddenClaims[${index}].id`)!,
      kind: kind as InformationBoundaryClaimKindV1,
      text: boundaryString(item.text, `forbiddenClaims[${index}].text`)!,
      sourceId: boundaryString(item.sourceId, `forbiddenClaims[${index}].sourceId`)!,
      ...(item.characterId === undefined ? {} : {
        characterId: boundaryInteger(item.characterId, `forbiddenClaims[${index}].characterId`)!,
      }),
      ...(item.characterName === undefined ? {} : {
        characterName: boundaryString(item.characterName, `forbiddenClaims[${index}].characterName`)!,
      }),
    }
  })
  if (new Set(forbiddenClaims.map(claim => claim.id)).size !== forbiddenClaims.length) {
    throw new Error('信息边界清单 forbiddenClaims 身份重复。')
  }
  const manifestHash = boundaryString(value.manifestHash, 'manifestHash')!
  if (!/^[a-f0-9]{64}$/i.test(manifestHash)) throw new Error('信息边界清单 manifestHash 无效。')
  return {
    version: INFORMATION_BOUNDARY_VERSION_V1,
    projectId: boundaryInteger(value.projectId, 'projectId')!,
    worldGroupId: boundaryInteger(value.worldGroupId, 'worldGroupId', true),
    chapterId: boundaryInteger(value.chapterId, 'chapterId', true),
    outlineNodeId: boundaryInteger(value.outlineNodeId, 'outlineNodeId')!,
    chapterOrdinal: boundaryInteger(value.chapterOrdinal, 'chapterOrdinal')!,
    perspectiveCharacterId: boundaryInteger(value.perspectiveCharacterId, 'perspectiveCharacterId', true),
    perspectiveCharacterName: boundaryString(value.perspectiveCharacterName, 'perspectiveCharacterName', true),
    allowedKnowledgeKeys,
    forbiddenClaims,
    manifestHash: manifestHash.toLowerCase(),
  }
}

type InformationBoundaryBodyV1 = Omit<InformationBoundaryManifestV1, 'manifestHash'>

const MIN_CLAIM_CHARS = 10
const FUTURE_MARKERS = /未来|后续|最终|终局|终章|终卷|结局|后来|将会|将要|成为|死亡|牺牲|背叛|揭示/u
const COGNITION_MARKERS = /知道|知晓|明白|意识到|记得|认出|确信|确定|早就|原来|察觉/u
const ACQUISITION_MARKERS = /告诉|告知|听见|看见|发现|读到|收到|获知|得知|亲眼目睹/u
const SPECULATIVE_PREFIX = /如果|假如|倘若|也许|或许|可能|猜测|担心|梦见|预感|设想|未必/u
const NEGATION_PREFIX = /没有|未曾|尚未|并未|不曾/u

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\s，。；！？、“”‘’：:,.!?;()（）【】\x5b\x5d—-]+/gu, '')
    .toLocaleLowerCase('zh-CN')
}

function splitClaims(value: string): string[] {
  return value
    .split(/[。！？；\n]+/u)
    .map(item => item.trim())
    .filter(item => normalizeForMatch(item).length >= MIN_CLAIM_CHARS)
    .map(item => item.slice(0, 240))
}

function claimId(kind: InformationBoundaryClaimKindV1, sourceId: string, index: number): string {
  return `${kind}:${sourceId}:${index}`
}

function appendClaims(
  target: InformationBoundaryClaimV1[],
  input: {
    kind: InformationBoundaryClaimKindV1
    sourceId: string
    text: string
    characterId?: number
    characterName?: string
    requireFutureMarker?: boolean
  },
): void {
  const parts = splitClaims(input.text)
  parts.forEach((text, index) => {
    if (input.requireFutureMarker && !FUTURE_MARKERS.test(text)) return
    target.push({
      id: claimId(input.kind, input.sourceId, index),
      kind: input.kind,
      text,
      sourceId: input.sourceId,
      ...(input.characterId != null ? { characterId: input.characterId } : {}),
      ...(input.characterName ? { characterName: input.characterName } : {}),
    })
  })
}

function dedupeClaims(claims: InformationBoundaryClaimV1[]): InformationBoundaryClaimV1[] {
  const seen = new Set<string>()
  return claims.filter(claim => {
    const key = `${claim.kind}:${claim.characterId ?? 'none'}:${normalizeForMatch(claim.text)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function allowedKnowledge(
  perspectiveCharacterId: number | null,
  projected: ProjectedKnowledge[],
): Map<string, ProjectedKnowledge> {
  if (perspectiveCharacterId == null) return new Map()
  return new Map(projected
    .filter(item => item.characterId === perspectiveCharacterId)
    .map(item => [item.knowledgeKey, item]))
}

function appendPrivateKnowledgeClaims(
  claims: InformationBoundaryClaimV1[],
  catalog: CognitionCatalogEntry[],
  projected: ProjectedKnowledge[],
  perspectiveCharacterId: number | null,
): string[] {
  const allowed = allowedKnowledge(perspectiveCharacterId, projected)
  for (const item of catalog) {
    const known = allowed.get(item.knowledgeKey)
    const exactKnown = known?.state === 'known'
      && normalizeForMatch(known.statement) === normalizeForMatch(item.statement)
    if (item.characterId === perspectiveCharacterId && exactKnown) continue
    appendClaims(claims, {
      kind: 'private-knowledge',
      sourceId: `knowledge:${item.characterId}:${item.knowledgeKey}`,
      text: item.statement,
      characterId: item.characterId,
      characterName: item.characterName,
    })
  }
  return [...allowed.keys()].sort()
}

function appendFutureOutlineClaims(
  claims: InformationBoundaryClaimV1[],
  outlineNodes: OutlineNode[],
  outlineNodeId: number,
  worldGroupId: number | null,
): number {
  const walk = walkOutlineChaptersInCanonicalOrder(outlineNodes)
  const target = walk.chapters.find(item => item.outlineNode.id === outlineNodeId)
  if (!target) throw new Error('信息边界无法定位当前章节的规范序位。')
  for (const item of walk.chapters) {
    if (item.ordinal <= target.ordinal || item.worldGroupId !== worldGroupId) continue
    appendClaims(claims, {
      kind: 'future-outline',
      sourceId: `outline:${item.outlineNode.id}`,
      text: item.outlineNode.summary,
    })
  }
  return target.ordinal
}

function appendCharacterFutureClaims(
  claims: InformationBoundaryClaimV1[],
  characters: Character[],
): void {
  for (const character of characters) {
    if (character.id == null) continue
    appendClaims(claims, {
      kind: 'character-future',
      sourceId: `character:${character.id}:arc`,
      text: character.arc || '',
      characterId: character.id,
      characterName: character.name,
      requireFutureMarker: true,
    })
    appendClaims(claims, {
      kind: 'character-future',
      sourceId: `character:${character.id}:ending`,
      text: character.ending || '',
      characterId: character.id,
      characterName: character.name,
    })
  }
}

async function appendCharacterDrivenFutureClaims(input: {
  scope: WorkspaceScope
  claims: InformationBoundaryClaimV1[]
  targetTitle: string
}): Promise<void> {
  const work = await db.works.get(input.scope.workId)
  const activeId = work?.activeCharacterDrivenPlanId
  if (activeId == null) return
  const plans = await readOwnedRows<any>(input.scope, 'characterDrivenPlans', { owner: 'work' })
  const plan = plans.find(row => row.id === activeId)
  if (!plan) return
  for (const arc of parseCharacterDrivenPlanArcs(plan.arcs)) {
    appendClaims(input.claims, {
      kind: 'character-future',
      sourceId: `character-plan:${plan.id}:${arc.characterId ?? arc.name}`,
      text: arc.targetState,
      ...(arc.characterId != null ? { characterId: arc.characterId } : {}),
      characterName: arc.name,
    })
  }
  const flattened = parseCharacterDrivenPlotVolumes(plan.generatedVolumes)
    .flatMap(volume => volume.chapters)
  const currentIndex = flattened.findIndex(chapter => chapter.title.trim() === input.targetTitle.trim())
  if (currentIndex < 0) return
  flattened.slice(currentIndex + 1).forEach((chapter, index) => {
    appendClaims(input.claims, {
      kind: 'future-outline',
      sourceId: `character-plan:${plan.id}:chapter:${currentIndex + index + 1}`,
      text: [chapter.summary, chapter.arcProgress].filter(Boolean).join('。'),
    })
  })
}

function appendStorylineFutureClaims(
  claims: InformationBoundaryClaimV1[],
  arcs: StoryArc[],
  progress: StorylineProgress[],
): void {
  const progressByArc = new Map(progress.map(item => [item.arcId, item]))
  for (const arc of arcs) {
    if (arc.id == null) continue
    const stages = parseStages(arc.stages)
    const currentStageId = progressByArc.get(arc.id)?.currentStageId
    const currentIndex = currentStageId == null
      ? -1
      : stages.findIndex(stage => stage.id === currentStageId)
    if (currentIndex < 0) continue
    stages.slice(currentIndex + 1).forEach((stage, index) => {
      appendClaims(claims, {
        kind: 'storyline-future',
        sourceId: `story-arc:${arc.id}:${stage.id || currentIndex + index + 1}`,
        text: [stage.description, ...stage.keyEvents, stage.turningPoint].filter(Boolean).join('。'),
      })
    })
  }
}

function manifestBody(manifest: InformationBoundaryManifestV1): InformationBoundaryBodyV1 {
  const { manifestHash: _manifestHash, ...body } = manifest
  return body
}

export async function buildChapterInformationBoundaryV1(input: {
  scope: WorkspaceScope
  chapterId?: number | null
  outlineNodeId: number
  worldGroupId: number | null
  perspectiveCharacterId?: number | null
}): Promise<InformationBoundaryManifestV1> {
  const perspectiveCharacterId = input.perspectiveCharacterId ?? null
  const [outlineNodes, characters, arcs, progress, cognition] = await Promise.all([
    readOwnedRows<OutlineNode>(input.scope, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<Character>(input.scope, 'characters', { owner: 'world' }),
    readOwnedRows<StoryArc>(input.scope, 'storyArcs', { owner: 'work' }),
    readOwnedRows<StorylineProgress>(input.scope, 'storylineProgress', { owner: 'work' }),
    readCognitionAuditSnapshot(
      input.scope.projectId,
      input.chapterId ?? null,
      input.worldGroupId,
      input.outlineNodeId,
      input.scope,
    ),
  ])
  const target = outlineNodes.find(node => node.id === input.outlineNodeId)
  if (!target) throw new Error('信息边界找不到当前章节大纲。')
  const visibleCharacters = characters.filter(character => (
    character.isCrossWorld || (character.homeWorldGroupId ?? null) === input.worldGroupId
  ))
  const perspective = perspectiveCharacterId == null
    ? null
    : visibleCharacters.find(character => character.id === perspectiveCharacterId) ?? null
  if (perspectiveCharacterId != null && !perspective) {
    throw new Error('信息边界中的视角角色不存在或不属于当前世界。')
  }

  const forbiddenClaims: InformationBoundaryClaimV1[] = []
  const chapterOrdinal = appendFutureOutlineClaims(
    forbiddenClaims,
    outlineNodes,
    input.outlineNodeId,
    input.worldGroupId,
  )
  const allowedKnowledgeKeys = appendPrivateKnowledgeClaims(
    forbiddenClaims,
    cognition.catalog,
    cognition.projected,
    perspectiveCharacterId,
  )
  appendCharacterFutureClaims(forbiddenClaims, visibleCharacters)
  appendStorylineFutureClaims(forbiddenClaims, arcs, progress)
  await appendCharacterDrivenFutureClaims({
    scope: input.scope,
    claims: forbiddenClaims,
    targetTitle: target.title,
  })

  const body: InformationBoundaryBodyV1 = {
    version: INFORMATION_BOUNDARY_VERSION_V1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    chapterId: input.chapterId ?? null,
    outlineNodeId: input.outlineNodeId,
    chapterOrdinal,
    perspectiveCharacterId,
    perspectiveCharacterName: perspective?.name ?? null,
    allowedKnowledgeKeys,
    forbiddenClaims: dedupeClaims(forbiddenClaims),
  }
  const provisional: InformationBoundaryManifestV1 = {
    ...body,
    manifestHash: '0'.repeat(64),
  }
  return {
    ...body,
    manifestHash: await hashCanonicalValue(manifestBody(provisional)),
  }
}

export async function verifyInformationBoundaryManifestV1(
  manifest: InformationBoundaryManifestV1,
): Promise<boolean> {
  return manifest.manifestHash === await hashCanonicalValue(manifestBody(manifest))
}

export function buildInformationBoundaryInstructionV1(
  manifest: InformationBoundaryManifestV1,
): string {
  const perspective = manifest.perspectiveCharacterName
    ? `${manifest.perspectiveCharacterName}（characterId=${manifest.perspectiveCharacterId}）`
    : '未指定视角角色；不得擅自代入任何角色的私人认知'
  return [
    '【正文信息边界】',
    `当前为规范序位第 ${manifest.chapterOrdinal} 章；叙事视角：${perspective}。`,
    '角色档案中的结局/弧光、后续章纲和故事线未来阶段只是作者规划，不是当前已发生事实，也不是角色已知信息。',
    '角色可以在本章通过可见行动、对话或证据新获得信息，但必须先写出获得过程，再让角色据此行动；不得无来源地提前知情。',
    '不得把其他世界、其他角色私人认知或后续章节结果直接写成当前视角已经知道、已经经历或已经确认的事实。',
  ].join('\n')
}

function sentenceAround(text: string, needle: string): string {
  const index = text.indexOf(needle)
  if (index < 0) return ''
  const before = Math.max(
    text.lastIndexOf('。', index),
    text.lastIndexOf('！', index),
    text.lastIndexOf('？', index),
    text.lastIndexOf('\n', index),
  )
  const endings = ['。', '！', '？', '\n']
    .map(marker => text.indexOf(marker, index + needle.length))
    .filter(position => position >= 0)
  const after = endings.length ? Math.min(...endings) : text.length
  return text.slice(before + 1, after + 1)
}

function exactRealizedMatch(
  output: string,
  claim: InformationBoundaryClaimV1,
  perspectiveCharacterName: string | null,
): boolean {
  const normalizedOutput = normalizeForMatch(output)
  const normalizedClaim = normalizeForMatch(claim.text)
  if (!normalizedClaim || normalizedClaim.length < MIN_CLAIM_CHARS) return false
  const index = normalizedOutput.indexOf(normalizedClaim)
  if (index < 0) return false
  const prefix = normalizedOutput.slice(Math.max(0, index - 12), index)
  if (SPECULATIVE_PREFIX.test(prefix) || NEGATION_PREFIX.test(prefix)) return false
  if (claim.kind !== 'private-knowledge') return true

  const sentence = sentenceAround(output, claim.text) || output
  if (!COGNITION_MARKERS.test(sentence)) return false
  if (perspectiveCharacterName) {
    const rawIndex = output.indexOf(claim.text)
    const preceding = rawIndex < 0 ? '' : output.slice(Math.max(0, rawIndex - 120), rawIndex)
    if (preceding.includes(perspectiveCharacterName) && ACQUISITION_MARKERS.test(preceding)) return false
    return sentence.includes(perspectiveCharacterName)
      || /(?:他|她|主角|视角人物).{0,12}(?:知道|知晓|明白|意识到|记得|认出|确信|确定|察觉)/u.test(sentence)
  }
  if (!claim.characterName) return true
  return sentence.includes(claim.characterName)
    || /(?:他|她|主角|视角人物).{0,12}(?:知道|知晓|明白|意识到|记得|认出|确信|确定|察觉)/u.test(sentence)
}

const ISSUE_LABELS: Record<InformationBoundaryClaimKindV1, string> = {
  'future-outline': '后续章节事件',
  'private-knowledge': '越权角色认知',
  'character-future': '角色未来规划',
  'storyline-future': '故事线未来阶段',
}

export function validateProseInformationBoundaryV1(
  output: string,
  manifest: InformationBoundaryManifestV1,
): GenerationGateIssue[] {
  return manifest.forbiddenClaims.flatMap(claim => {
    if (!exactRealizedMatch(output, claim, manifest.perspectiveCharacterName)) return []
    const excerpt = claim.text.length > 48 ? `${claim.text.slice(0, 48)}...` : claim.text
    return [{
      code: `prose-information-boundary:${claim.kind}:${claim.sourceId}`,
      message: `${ISSUE_LABELS[claim.kind]}被逐字写成当前事实：“${excerpt}”。请补出本章内的获知/发生过程，或删除提前泄漏。`,
    }]
  })
}
