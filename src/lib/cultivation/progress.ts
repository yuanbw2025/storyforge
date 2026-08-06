import type {
  ChatMessage,
  Chapter,
  Character,
  CultivationProgress,
  CultivationStage,
  CultivationSystem,
  CultivationTransition,
  OutlineNode,
} from '../types'
import { CULTIVATION_TRANSITIONS, parseCultivationStages } from '../types'
import { db } from '../db/schema'
import { adopt } from '../registry/adopt'
import { resolveCanonicalChapterSequence } from '../ai/chapter-memory/canonical-chapter-sequence'
import { walkOutlineChaptersInCanonicalOrder } from '../outline/canonical-outline-walk'
import { htmlToPlainText } from '../utils/html'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  type WorkspaceScopeLike,
} from '../world-engine/scope'
import type { WorkspaceScope } from '../types/world-ownership'

export interface CultivationProgressCandidate {
  characterId: number
  cultivationSystemId: number
  stageId: string
  transition: CultivationTransition
  trigger: string
  evidenceQuote: string
  sourceOffset: number
}

type CharacterBoundary = Pick<
  Character,
  'id' | 'name' | 'cultivationSystemId' | 'homeWorldGroupId' | 'isCrossWorld'
>

type SystemBoundary = Pick<CultivationSystem, 'id' | 'name' | 'worldGroupId' | 'stages'>

export function buildCultivationProgressPrompt(args: {
  chapterTitle: string
  chapterContent: string
  characters: CharacterBoundary[]
  systems: SystemBoundary[]
}): ChatMessage[] {
  const systems = new Map(args.systems
    .filter(system => system.id != null)
    .map(system => [system.id!, system]))
  const registry = args.characters.flatMap(character => {
    if (character.id == null || character.cultivationSystemId == null) return []
    const system = systems.get(character.cultivationSystemId)
    if (!system) return []
    return [{
      characterId: character.id,
      characterName: character.name,
      cultivationSystemId: system.id,
      cultivationSystemName: system.name,
      stages: parseCultivationStages(system.stages).map(stage => ({
        id: stage.id,
        name: stage.name,
        parentStageIds: stage.parentStageIds,
        branchLabel: stage.branchLabel || '',
      })),
    }]
  })

  return [
    {
      role: 'system',
      content: `你是小说修炼进度映射器。只能把正文中已经明确发生的真实境界变化映射到登记闭集，不得推测。

输出严格 JSON，不要 Markdown：
{"events":[{"characterId":1,"cultivationSystemId":2,"stageId":"stage-id","transition":"enter|advance|regress|switch","trigger":"变化触发或原因","quote":"正文逐字引文"}]}

硬规则：
1. 三个 ID 只能取登记闭集中的组合，禁止输出名称代替 ID；
2. quote 必须逐字连续出现在正文，且直接证明角色真实到达该境界；
3. enter=正文首次可确认的境界；advance=沿 DAG 前进；regress=真实境界倒退；switch=明确改走另一分支；
4. 临时压制、封印、伪装、跨世界规则削弱、借力、爆发和“接近突破”都不是境界变化；
5. 同一角色只输出正文明确发生的变化；仅提到境界名、回忆、传闻或计划不得输出；
6. 没有可靠变化时返回 {"events":[]}，宁缺毋滥。`,
    },
    {
      role: 'user',
      content: `【角色与修炼体系闭集】\n${JSON.stringify(registry)}\n\n【章节】${args.chapterTitle}\n\n【正文】\n${args.chapterContent}\n\n请输出 JSON：`,
    },
  ]
}

export function parseCultivationProgressResult(args: {
  raw: string
  chapterContent: string
  characters: CharacterBoundary[]
  systems: SystemBoundary[]
}): CultivationProgressCandidate[] {
  const start = args.raw.indexOf('{')
  const end = args.raw.lastIndexOf('}')
  if (start < 0 || end <= start) return []

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(args.raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return []
  }

  const characters = new Map(args.characters
    .filter(character => character.id != null)
    .map(character => [character.id!, character]))
  const systems = new Map(args.systems
    .filter(system => system.id != null)
    .map(system => [system.id!, {
      system,
      stages: new Set(parseCultivationStages(system.stages).map(stage => stage.id)),
    }]))
  const seen = new Set<string>()

  return arrayOfRecords(parsed.events).flatMap((item): CultivationProgressCandidate[] => {
    const characterId = finiteId(item.characterId)
    const cultivationSystemId = finiteId(item.cultivationSystemId)
    const stageId = String(item.stageId ?? '').trim()
    const transition = String(item.transition ?? '').trim() as CultivationTransition
    const trigger = String(item.trigger ?? '').trim()
    const evidenceQuote = String(item.quote ?? '').trim()
    const character = characterId == null ? undefined : characters.get(characterId)
    const boundary = cultivationSystemId == null ? undefined : systems.get(cultivationSystemId)
    const sourceOffset = uniqueQuoteOffset(args.chapterContent, evidenceQuote)
    if (
      characterId == null || cultivationSystemId == null || !character || !boundary
      || character.cultivationSystemId !== cultivationSystemId
      || !boundary.stages.has(stageId)
      || !CULTIVATION_TRANSITIONS.includes(transition)
      || sourceOffset < 0
    ) return []
    const key = `${characterId}\u0000${cultivationSystemId}\u0000${stageId}\u0000${evidenceQuote}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{
      characterId,
      cultivationSystemId,
      stageId,
      transition,
      trigger,
      evidenceQuote,
      sourceOffset,
    }]
  }).sort((left, right) => left.sourceOffset - right.sourceOffset)
}

export async function acceptCultivationProgressCandidate(args: {
  projectId: number
  scope?: WorkspaceScope
  chapterId: number
  candidate: CultivationProgressCandidate
}): Promise<number> {
  const scope = await resolveScopeLike(args.scope ?? args.projectId)
  const [chapter, character, system, outlineNodes] = await Promise.all([
    db.chapters.get(args.chapterId),
    db.characters.get(args.candidate.characterId),
    db.cultivationSystems.get(args.candidate.cultivationSystemId),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
  ])
  if (!chapter || chapter.projectId !== args.projectId) throw new Error('来源章节不存在或不属于当前项目')
  if (!character || character.projectId !== args.projectId) throw new Error('角色不存在或不属于当前项目')
  if (!system || system.projectId !== args.projectId) throw new Error('修炼体系不存在或不属于当前项目')
  if (!await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('来源章节不属于当前作品')
  }
  if (!await assertRecordInScope(scope, 'characters', character, { owner: 'world' })) {
    throw new Error('角色不属于当前世界')
  }
  if (!await assertRecordInScope(scope, 'cultivationSystems', system, { owner: 'world' })) {
    throw new Error('修炼体系不属于当前世界')
  }
  if (character.cultivationSystemId !== system.id) throw new Error('角色主修体系已变化，请重新分析')

  const outline = outlineNodes.find(node => node.id === chapter.outlineNodeId)
  const chapterWorld = outline?.worldGroupId ?? null
  if ((system.worldGroupId ?? null) !== chapterWorld) throw new Error('来源章节与修炼体系不在同一世界')
  if (!character.isCrossWorld && (character.homeWorldGroupId ?? null) !== chapterWorld) {
    throw new Error('来源章节与角色归属世界不一致')
  }

  const plain = htmlToPlainText(chapter.content || '').trim()
  const sourceOffset = uniqueQuoteOffset(plain, args.candidate.evidenceQuote)
  if (sourceOffset < 0) throw new Error('正文证据已变化、重复或不存在，请重新分析')
  const stages = parseCultivationStages(system.stages)
  const stage = stages.find(item => item.id === args.candidate.stageId)
  if (!stage) throw new Error('目标境界已从体系中删除，请重新分析')

  const existing = (await readOwnedRows<CultivationProgress>(scope, 'cultivationProgress', { owner: 'work' }))
    .filter(row =>
      row.characterId === character.id
      && row.cultivationSystemId === system.id
      && row.status === 'confirmed')
  if (existing.some(row =>
    row.sourceChapterId === chapter.id
    && row.stageId === stage.id
    && row.sourceQuote === args.candidate.evidenceQuote)) {
    throw new Error('这条境界事件已经确认')
  }

  const candidateRow: CultivationProgress = {
    projectId: args.projectId,
    worldGroupId: chapterWorld,
    characterId: character.id,
    characterName: character.name,
    cultivationSystemId: system.id,
    cultivationSystemName: system.name,
    stageId: stage.id,
    stageName: stage.name,
    transition: args.candidate.transition,
    sourceChapterId: chapter.id,
    sourceChapterTitle: chapter.title,
    sourceQuote: args.candidate.evidenceQuote,
    sourceOffset,
    trigger: args.candidate.trigger,
    status: 'confirmed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  const sorted = await sortProgressRows(scope, [...existing, candidateRow])
  const candidateIndex = sorted.indexOf(candidateRow)
  const expected = transitionBetween(
    candidateIndex > 0 ? sorted[candidateIndex - 1].stageId ?? null : null,
    candidateRow.stageId ?? null,
    stages,
  )
  if (args.candidate.transition !== expected) {
    throw new Error(`境界路径与变化类型不一致：当前应为 ${expected}`)
  }

  const result = await adopt({
    projectId: args.projectId,
    scope,
    worldGroupId: chapterWorld,
    target: 'cultivationProgress',
    mode: 'add',
    data: Object.fromEntries(Object.entries(candidateRow).filter(
      ([field]) => field !== 'projectId' && field !== 'createdAt' && field !== 'updatedAt',
    )),
  })
  const id = result.written[0]?.id
  if (id == null) throw new Error(result.skipped[0]?.reason || '修炼进度写入失败')

  await normalizeProgressTransitions(scope, character.id!, system.id!, stages)
  return id
}

export async function deleteCultivationProgressEvent(projectId: number, id: number): Promise<void> {
  const scope = await resolveScopeLike(projectId)
  const row = await db.cultivationProgress.get(id)
  if (!row || row.projectId !== projectId
    || !await assertRecordInScope(scope, 'cultivationProgress', row, { owner: 'work' })) return
  await db.cultivationProgress.delete(id)
  if (row.characterId == null || row.cultivationSystemId == null) return
  const system = await db.cultivationSystems.get(row.cultivationSystemId)
  if (!system || system.projectId !== projectId
    || !await assertRecordInScope(scope, 'cultivationSystems', system, { owner: 'world' })) return
  await normalizeProgressTransitions(
    scope,
    row.characterId,
    row.cultivationSystemId,
    parseCultivationStages(system.stages),
  )
}

export async function readCultivationProgressContext(
  projectId: number,
  worldGroupId?: number | null,
  chapterId?: number | null,
  outlineNodeId?: number | null,
  workspaceScope?: WorkspaceScope,
): Promise<string> {
  const project = await db.projects.get(projectId)
  if (!project?.includeCultivationProgressInAI) return ''
  const scope = await resolveReadScopeLike(workspaceScope ?? projectId)
  const [rows, chapters, outlineNodes] = await Promise.all([
    readOwnedRows<CultivationProgress>(scope, 'cultivationProgress', { owner: 'work' }),
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
  ])
  const walk = walkOutlineChaptersInCanonicalOrder(outlineNodes)
  const orderOf = new Map<number, number>()
  const outlineOrder = new Map<number, number>()
  walk.chapters.forEach((entry, index) => {
    if (entry.outlineNode.id != null) outlineOrder.set(entry.outlineNode.id, index)
  })
  chapters.forEach(chapter => {
    if (chapter.id == null) return
    const order = outlineOrder.get(chapter.outlineNodeId)
    if (order != null) orderOf.set(chapter.id, order)
  })
  const targetOutlineId = outlineNodeId
    ?? (chapterId == null ? null : chapters.find(chapter => chapter.id === chapterId)?.outlineNodeId)
  const boundary = targetOutlineId == null ? null : outlineOrder.get(targetOutlineId)
  if (targetOutlineId != null && boundary == null) return ''
  const targetWorld = worldGroupId === undefined ? null : worldGroupId
  const usable = rows.filter(row => {
    if (
      row.status !== 'confirmed'
      || row.characterId == null
      || row.cultivationSystemId == null
      || row.stageId == null
      || row.sourceChapterId == null
      || (row.worldGroupId ?? null) !== targetWorld
    ) return false
    const order = orderOf.get(row.sourceChapterId)
    return order != null && (boundary == null || order < boundary)
  })
  if (!usable.length) return ''

  const grouped = new Map<string, CultivationProgress[]>()
  for (const row of usable) {
    const key = `${row.characterId}:${row.cultivationSystemId}`
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  const lines = ['【作者确认的正文修炼进度】']
  for (const group of grouped.values()) {
    const sorted = await sortProgressRows(scope, group)
    const current = sorted[sorted.length - 1]
    const path = sorted.map(row => row.stageName).filter((name, index, all) => index === 0 || name !== all[index - 1])
    lines.push(
      `- ${current.characterName} / ${current.cultivationSystemName}：当前 ${current.stageName}`
      + `；已确认路径 ${path.join(' → ')}`
      + `（最近证据：${current.sourceChapterTitle}）`,
    )
  }
  return lines.join('\n')
}

export async function sortProgressRows(
  scopeInput: WorkspaceScopeLike,
  rows: CultivationProgress[],
): Promise<CultivationProgress[]> {
  const scope = await resolveReadScopeLike(scopeInput)
  const [chapters, outlineNodes] = await Promise.all([
    readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
  ])
  const { sequence } = resolveCanonicalChapterSequence(outlineNodes, chapters)
  const orderOf = new Map<number, number>()
  sequence.forEach((entry, index) => {
    if (entry.chapter.id != null) orderOf.set(entry.chapter.id, index)
  })
  return [...rows].sort((left, right) => {
    const leftOrder = left.sourceChapterId == null
      ? Number.MAX_SAFE_INTEGER
      : orderOf.get(left.sourceChapterId) ?? Number.MAX_SAFE_INTEGER
    const rightOrder = right.sourceChapterId == null
      ? Number.MAX_SAFE_INTEGER
      : orderOf.get(right.sourceChapterId) ?? Number.MAX_SAFE_INTEGER
    return leftOrder - rightOrder
      || left.sourceOffset - right.sourceOffset
      || (left.id ?? Number.MAX_SAFE_INTEGER) - (right.id ?? Number.MAX_SAFE_INTEGER)
  })
}

function transitionBetween(
  previousStageId: string | null,
  nextStageId: string | null,
  stages: CultivationStage[],
): CultivationTransition {
  if (previousStageId == null) return 'enter'
  if (nextStageId == null || nextStageId === previousStageId) return 'switch'
  if (isReachable(stages, previousStageId, nextStageId)) return 'advance'
  if (isReachable(stages, nextStageId, previousStageId)) return 'regress'
  return 'switch'
}

async function normalizeProgressTransitions(
  scope: WorkspaceScope,
  characterId: number,
  systemId: number,
  stages: CultivationStage[],
): Promise<void> {
  const rows = (await readOwnedRows<CultivationProgress>(scope, 'cultivationProgress', { owner: 'work' }))
    .filter(row =>
      row.characterId === characterId
      && row.cultivationSystemId === systemId
      && row.status === 'confirmed')
  const sorted = await sortProgressRows(scope, rows)
  for (let index = 0; index < sorted.length; index++) {
    const row = sorted[index]
    if (row.id == null) continue
    const transition = transitionBetween(sorted[index - 1]?.stageId ?? null, row.stageId ?? null, stages)
    if (row.transition !== transition) {
      await db.cultivationProgress.update(row.id, { transition, updatedAt: Date.now() })
    }
  }
}

function isReachable(stages: CultivationStage[], fromId: string, targetId: string): boolean {
  const children = new Map<string, string[]>()
  for (const stage of stages) {
    for (const parentId of stage.parentStageIds) {
      children.set(parentId, [...(children.get(parentId) ?? []), stage.id])
    }
  }
  const queue = [...(children.get(fromId) ?? [])]
  const visited = new Set<string>()
  while (queue.length) {
    const id = queue.shift()!
    if (id === targetId) return true
    if (visited.has(id)) continue
    visited.add(id)
    queue.push(...(children.get(id) ?? []))
  }
  return false
}

function uniqueQuoteOffset(content: string, quote: string): number {
  if (quote.length < 4) return -1
  const first = content.indexOf(quote)
  if (first < 0 || content.indexOf(quote, first + 1) >= 0) return -1
  return first
}

function finiteId(value: unknown): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}
