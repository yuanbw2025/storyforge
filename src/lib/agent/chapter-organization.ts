import { db } from '../db/schema'
import { normalizeChapterText, hashChapterText } from '../ai/chapter-memory/text-normalization'
import { parseStateDiffs } from '../ai/adapters/state-extract-adapter'
import {
  parseFactExtractResult,
  type ExtractedFactCandidate,
} from '../ai/adapters/fact-extract-adapter'
import {
  parseInventoryEvents,
  type ExtractedItemEvent,
} from '../ai/adapters/inventory-extract-adapter'
import {
  parseStoryEvents,
  type ExtractedStoryEvent,
} from '../ai/adapters/story-timeline-adapter'
import {
  matchRelations,
  parseRelationOutput,
  type MatchedRelation,
} from '../ai/relation-extractor'
import type {
  AgentConversation,
  AgentEvent,
  Character,
  CharacterRelation,
  ChatMessage,
  Foreshadow,
  ForeshadowStatus,
  StateDiffItem,
} from '../types'
import { parseAgentEventPayload } from '../types'
import {
  AgentTeamBudgetTracker,
  type AgentTeamBudgetEvidence,
} from './team-budget'
import { adopt, replaceAdoptedCollection } from '../registry/adopt'
import { useStateCardStore } from '../../stores/state-card'
import { useFactLedgerStore } from '../../stores/fact-ledger'
import { useItemLedgerStore } from '../../stores/item-ledger'
import { useStoryTimelineStore } from '../../stores/story-timeline'
import { useCharacterRelationStore } from '../../stores/character-relation'
import { useCharacterStore } from '../../stores/character'
import { useForeshadowStore } from '../../stores/foreshadow'
import { syncRelationToCharacterFields } from '../relations/relationship-summary'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  stampNewRecord,
} from '../world-engine/scope'

export const CHAPTER_ORGANIZATION_VERSION = 1
export const CHAPTER_ORGANIZATION_PAYLOAD_TYPE = 'chapter-organization'

export type ChapterOrganizationDomain =
  | 'state'
  | 'facts'
  | 'inventory'
  | 'timeline'
  | 'relations'
  | 'foreshadows'

export type ChapterOrganizationDomainStatus =
  | 'pending'
  | 'adopted'
  | 'failed'
  | 'skipped'

export interface EvidencedStateDiff extends StateDiffItem {
  sourceQuote: string
}

export interface EvidencedItemEvent extends ExtractedItemEvent {
  sourceQuote: string
}

export interface EvidencedStoryEvent extends ExtractedStoryEvent {
  sourceQuote: string
}

export interface EvidencedRelation extends MatchedRelation {
  sourceQuote: string
}

export interface ForeshadowProgressCandidate {
  foreshadowId: number
  name: string
  fromStatus: ForeshadowStatus
  toStatus: ForeshadowStatus
  sourceQuote: string
  note: string
}

export interface ChapterOrganizationCandidate {
  version: typeof CHAPTER_ORGANIZATION_VERSION
  type: typeof CHAPTER_ORGANIZATION_PAYLOAD_TYPE
  projectId: number
  chapterId: number
  chapterTitle: string
  worldGroupId: number | null
  sourceTextHash: string
  createdAt: number
  stateDiffs: EvidencedStateDiff[]
  facts: ExtractedFactCandidate[]
  inventoryEvents: EvidencedItemEvent[]
  storyEvents: EvidencedStoryEvent[]
  relations: EvidencedRelation[]
  foreshadowUpdates: ForeshadowProgressCandidate[]
  domainStatus: Record<ChapterOrganizationDomain, ChapterOrganizationDomainStatus>
  domainErrors: Partial<Record<ChapterOrganizationDomain, string>>
  budget: AgentTeamBudgetEvidence
}

export interface ChapterOrganizationSelection {
  stateDiffs: number[]
  facts: number[]
  inventoryEvents: number[]
  storyEvents: number[]
  relations: number[]
  foreshadowUpdates: number[]
}

export interface ChapterOrganizationRun {
  conversation: AgentConversation
  event: AgentEvent
  candidate: ChapterOrganizationCandidate
}

export interface ChapterOrganizationAdoptionResult {
  run: ChapterOrganizationRun
  written: Record<ChapterOrganizationDomain, number>
}

interface RawRoot {
  stateDiffs?: unknown
  facts?: unknown
  inventoryEvents?: unknown
  storyEvents?: unknown
  relations?: unknown
  foreshadowUpdates?: unknown
}

const DOMAIN_STATUS: Record<ChapterOrganizationDomain, ChapterOrganizationDomainStatus> = {
  state: 'pending',
  facts: 'pending',
  inventory: 'pending',
  timeline: 'pending',
  relations: 'pending',
  foreshadows: 'pending',
}

const FORESHADOW_TRANSITIONS: Record<ForeshadowStatus, readonly ForeshadowStatus[]> = {
  planned: ['planted', 'echoed', 'resolved'],
  planted: ['echoed', 'resolved'],
  echoed: ['resolved'],
  resolved: [],
}

function parseObject(raw: string): RawRoot | null {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const text = fenced ? fenced[1].trim() : trimmed
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as RawRoot
      : null
  } catch {
    return null
  }
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => (
      item != null && typeof item === 'object' && !Array.isArray(item)
    ))
    : []
}

function exactQuote(item: Record<string, unknown>, text: string): string | null {
  const sourceQuote = String(item.sourceQuote ?? item.quote ?? '').trim()
  return sourceQuote && text.includes(sourceQuote) ? sourceQuote : null
}

function withExactEvidence(value: unknown, text: string): Array<{
  item: Record<string, unknown>
  sourceQuote: string
}> {
  return records(value).flatMap(item => {
    const sourceQuote = exactQuote(item, text)
    return sourceQuote ? [{ item, sourceQuote }] : []
  })
}

function parseStateCandidates(
  value: unknown,
  text: string,
  characterNames: string[],
): EvidencedStateDiff[] {
  return withExactEvidence(value, text).flatMap(({ item, sourceQuote }) => {
    const { diffs } = parseStateDiffs(JSON.stringify([item]), characterNames)
    return diffs.map(diff => ({ ...diff as StateDiffItem, sourceQuote }))
  })
}

function parseInventoryCandidates(value: unknown, text: string): EvidencedItemEvent[] {
  return withExactEvidence(value, text).flatMap(({ item, sourceQuote }) => (
    parseInventoryEvents(JSON.stringify([item])).map(event => ({ ...event, sourceQuote }))
  ))
}

function parseStoryCandidates(value: unknown, text: string): EvidencedStoryEvent[] {
  return withExactEvidence(value, text).flatMap(({ item, sourceQuote }) => (
    parseStoryEvents(JSON.stringify([item])).map(event => ({ ...event, sourceQuote }))
  ))
}

function parseRelationCandidates(input: {
  value: unknown
  text: string
  characters: Character[]
  existingRelations: CharacterRelation[]
}): EvidencedRelation[] {
  return withExactEvidence(input.value, input.text).flatMap(({ item, sourceQuote }) => {
    const extracted = parseRelationOutput(JSON.stringify([item]))
    return matchRelations(extracted, input.characters, input.existingRelations)
      .filter(relation => !relation.isDuplicate)
      .map(relation => ({ ...relation, sourceQuote }))
  })
}

function parseForeshadowCandidates(
  value: unknown,
  text: string,
  foreshadows: Foreshadow[],
): ForeshadowProgressCandidate[] {
  const byId = new Map(foreshadows.filter(item => item.id != null).map(item => [item.id!, item]))
  return withExactEvidence(value, text).flatMap(({ item, sourceQuote }) => {
    const foreshadowId = Number(item.foreshadowId)
    const current = byId.get(foreshadowId)
    const toStatus = String(item.toStatus ?? '') as ForeshadowStatus
    if (!current || !FORESHADOW_TRANSITIONS[current.status].includes(toStatus)) return []
    return [{
      foreshadowId,
      name: current.name,
      fromStatus: current.status,
      toStatus,
      sourceQuote,
      note: String(item.note ?? '').trim(),
    }]
  })
}

function compactList(values: readonly string[], limit: number): string {
  return values.map(value => value.trim()).filter(Boolean).slice(0, limit).join('、') || '无'
}

export function buildChapterOrganizationPrompt(input: {
  chapterTitle: string
  chapterText: string
  stateContext: string
  characters: Character[]
  knownItemNames: string[]
  existingRelations: CharacterRelation[]
  foreshadows: Foreshadow[]
}): ChatMessage[] {
  const characterList = input.characters
    .filter(character => character.id != null && character.name.trim())
    .slice(0, 120)
    .map(character => `- #${character.id} ${character.name}`)
    .join('\n') || '无'
  const relationList = input.existingRelations.slice(0, 160).map(relation => (
    `- ${relation.fromCharacterId} -> ${relation.toCharacterId} (${relation.relationType})`
  )).join('\n') || '无'
  const foreshadowList = input.foreshadows
    .filter(item => item.id != null && item.status !== 'resolved')
    .slice(0, 80)
    .map(item => `- #${item.id} ${item.name} [${item.status}] ${item.description.slice(0, 240)}`)
    .join('\n') || '无'

  return [
    {
      role: 'system',
      content: `你是 StoryForge 的“整理本章 Agent”。只从本章正文抽取明确发生的变化，输出一个严格 JSON 对象，不要 markdown，不要解释。

每一条候选都必须有 sourceQuote，且必须逐字复制自正文；没有逐字证据就不要输出。只可引用登记清单中的角色和伏笔，不得新建实体。

JSON 结构：
{
  "stateDiffs":[{"entityName":"角色名","category":"character","field":"位置","oldValue":"旧值或null","newValue":"新值","sourceQuote":"逐字引文"}],
  "facts":[{"subject":"角色名","predicate":"location|aliveStatus|healthStatus|powerStage|goal|owns|knows|relation","value":"事实值","object":"可选对象","quote":"逐字引文"}],
  "inventoryEvents":[{"itemName":"物品","heldByName":"角色名","action":"gain|consume","quantity":1,"note":"说明","sourceQuote":"逐字引文"}],
  "storyEvents":[{"title":"事件标题","storyTime":"正文明确时间或空串","importance":1,"description":"说明","sourceQuote":"逐字引文"}],
  "relations":[{"char1":"角色名","char2":"角色名","type":"family|lover|friend|rival|enemy|master|student|ally|subordinate|other","label":"关系名","description":"说明","bidirectional":true,"sourceQuote":"逐字引文"}],
  "foreshadowUpdates":[{"foreshadowId":1,"toStatus":"planted|echoed|resolved","note":"为何推进","sourceQuote":"逐字引文"}]
}

规则：
1. 状态只写本章发生变化后的值，不重复当前状态；category 固定 character。
2. 事实谓词只能使用给定 key；拿不准时省略。
3. 物品只写实际获得或消耗，不把看见、提及、计划获得当成流水。
4. 年表只写改变剧情进程的大事，importance 为 1-3。
5. 关系只写本章新建立或明确改变的关系；已有同类型关系不重复。
6. 伏笔只可单向推进 planned→planted/echoed/resolved、planted→echoed/resolved、echoed→resolved；普通提及不等于呼应或回收。
7. 没有候选的分区返回空数组。`,
    },
    {
      role: 'user',
      content: `【章节】${input.chapterTitle}

【已登记角色】
${characterList}

【当前状态】
${input.stateContext.slice(0, 10_000) || '无'}

【已知物品名】
${compactList(input.knownItemNames, 120)}

【已有关系（角色 ID）】
${relationList}

【未完成伏笔】
${foreshadowList}

【正文】
${input.chapterText}

请输出严格 JSON：`,
    },
  ]
}

export function parseChapterOrganizationOutput(input: {
  raw: string
  projectId: number
  chapterId: number
  chapterTitle: string
  worldGroupId: number | null
  chapterText: string
  sourceTextHash: string
  characters: Character[]
  existingRelations: CharacterRelation[]
  foreshadows: Foreshadow[]
  budget: AgentTeamBudgetEvidence
  createdAt?: number
}): ChapterOrganizationCandidate | null {
  const root = parseObject(input.raw)
  if (!root) return null
  const normalizedText = normalizeChapterText(input.chapterText)
  const characterNames = input.characters.map(character => character.name)
  const facts = parseFactExtractResult({
    raw: JSON.stringify({ facts: records(root.facts) }),
    chapterContent: normalizedText,
  })
  return {
    version: CHAPTER_ORGANIZATION_VERSION,
    type: CHAPTER_ORGANIZATION_PAYLOAD_TYPE,
    projectId: input.projectId,
    chapterId: input.chapterId,
    chapterTitle: input.chapterTitle,
    worldGroupId: input.worldGroupId,
    sourceTextHash: input.sourceTextHash,
    createdAt: input.createdAt ?? Date.now(),
    stateDiffs: parseStateCandidates(root.stateDiffs, normalizedText, characterNames),
    facts,
    inventoryEvents: parseInventoryCandidates(root.inventoryEvents, normalizedText),
    storyEvents: parseStoryCandidates(root.storyEvents, normalizedText),
    relations: parseRelationCandidates({
      value: root.relations,
      text: normalizedText,
      characters: input.characters,
      existingRelations: input.existingRelations,
    }),
    foreshadowUpdates: parseForeshadowCandidates(root.foreshadowUpdates, normalizedText, input.foreshadows),
    domainStatus: { ...DOMAIN_STATUS },
    domainErrors: {},
    budget: input.budget,
  }
}

export async function runChapterOrganization(input: {
  projectId: number
  chapterId: number
  chapterTitle: string
  worldGroupId: number | null
  chapterContent: string
  stateContext: string
  characters: Character[]
  knownItemNames: string[]
  existingRelations: CharacterRelation[]
  foreshadows: Foreshadow[]
  budget: AgentTeamBudgetTracker
  call: (messages: ChatMessage[]) => Promise<string>
}): Promise<ChapterOrganizationCandidate> {
  const chapterText = normalizeChapterText(input.chapterContent)
  const sourceTextHash = await hashChapterText(input.chapterContent)
  const messages = buildChapterOrganizationPrompt({ ...input, chapterText })
  const reservation = input.budget.reserveCall({
    label: '整理本章',
    messages,
    maxOutputTokens: 8_000,
  })
  let raw: string
  try {
    raw = await input.call(messages)
    input.budget.settleCall(reservation, raw)
  } catch (error) {
    input.budget.settleFailedCall(reservation)
    throw error
  }
  const candidate = parseChapterOrganizationOutput({
    ...input,
    raw,
    chapterText,
    sourceTextHash,
    budget: input.budget.snapshot(),
  })
  if (!candidate) throw new Error('整理本章返回的 JSON 无法解析；没有写入任何项目数据。')
  return candidate
}

function isChapterOrganizationCandidate(value: unknown): value is ChapterOrganizationCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<ChapterOrganizationCandidate>
  return candidate.version === CHAPTER_ORGANIZATION_VERSION
    && candidate.type === CHAPTER_ORGANIZATION_PAYLOAD_TYPE
    && typeof candidate.projectId === 'number'
    && typeof candidate.chapterId === 'number'
    && typeof candidate.sourceTextHash === 'string'
}

export async function persistChapterOrganizationCandidate(
  candidate: ChapterOrganizationCandidate,
): Promise<ChapterOrganizationRun> {
  const scope = await resolveScopeLike(candidate.projectId)
  const chapter = await db.chapters.get(candidate.chapterId)
  if (!await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('整理本章候选的章节不存在或不属于当前作品。')
  }
  const now = Date.now()
  const conversation = stampNewRecord(scope, 'agentConversations', {
    projectId: candidate.projectId,
    worldGroupId: candidate.worldGroupId,
    title: `整理本章 · ${candidate.chapterTitle}`,
    status: 'archived',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }) as AgentConversation
  return db.transaction('rw', db.agentConversations, db.agentEvents, async () => {
    const conversationId = await db.agentConversations.add(conversation) as number
    const event = stampNewRecord(scope, 'agentEvents', {
      projectId: candidate.projectId,
      conversationId,
      sequence: 1,
      kind: 'candidate',
      content: summarizeChapterOrganizationCandidate(candidate),
      payload: JSON.stringify(candidate),
      createdAt: now,
    }, { owner: 'work' }) as AgentEvent
    const eventId = await db.agentEvents.add(event) as number
    return {
      conversation: { ...conversation, id: conversationId },
      event: { ...event, id: eventId },
      candidate,
    }
  })
}

export async function readLatestChapterOrganizationRun(input: {
  projectId: number
  chapterId: number
}): Promise<ChapterOrganizationRun | null> {
  const scope = await resolveReadScopeLike(input.projectId)
  const chapter = await db.chapters.get(input.chapterId)
  if (!await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) return null
  const events = await readOwnedRows<AgentEvent>(scope, 'agentEvents', { owner: 'work' })
  const matches = events
    .filter(event => event.kind === 'candidate')
    .map(event => ({ event, candidate: parseAgentEventPayload<unknown>(event, null) }))
    .filter((row): row is { event: AgentEvent; candidate: ChapterOrganizationCandidate } => (
      isChapterOrganizationCandidate(row.candidate)
      && row.candidate.projectId === input.projectId
      && row.candidate.chapterId === input.chapterId
    ))
    .sort((left, right) => right.event.createdAt - left.event.createdAt)
  const latest = matches[0]
  if (!latest) return null
  const conversation = await db.agentConversations.get(latest.event.conversationId)
  return conversation && await assertRecordInScope(scope, 'agentConversations', conversation, { owner: 'work' })
    ? { conversation, event: latest.event, candidate: latest.candidate }
    : null
}

export async function updateChapterOrganizationRun(input: {
  run: ChapterOrganizationRun
  candidate: ChapterOrganizationCandidate
  confirmation?: unknown
}): Promise<ChapterOrganizationRun> {
  if (
    input.run.event.id == null
    || input.run.conversation.id == null
    || input.candidate.projectId !== input.run.event.projectId
    || input.candidate.chapterId !== input.run.candidate.chapterId
  ) {
    throw new Error('整理本章运行记录不存在或范围不匹配。')
  }
  const scope = await resolveScopeLike(input.candidate.projectId)
  const [chapter, event, conversation] = await Promise.all([
    db.chapters.get(input.candidate.chapterId),
    db.agentEvents.get(input.run.event.id),
    db.agentConversations.get(input.run.conversation.id),
  ])
  if (
    !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })
    || !await assertRecordInScope(scope, 'agentEvents', event, { owner: 'work' })
    || !await assertRecordInScope(scope, 'agentConversations', conversation, { owner: 'work' })
    || event?.conversationId !== conversation?.id
  ) {
    throw new Error('整理本章运行记录不存在或不属于当前作品。')
  }
  const now = Date.now()
  return db.transaction('rw', db.agentConversations, db.agentEvents, async () => {
    await db.agentEvents.update(input.run.event.id!, {
      content: summarizeChapterOrganizationCandidate(input.candidate),
      payload: JSON.stringify(input.candidate),
    })
    if (input.confirmation != null) {
      const rows = await db.agentEvents
        .where('conversationId')
        .equals(input.run.conversation.id!)
        .toArray()
      const confirmationEvent = stampNewRecord(scope, 'agentEvents', {
        projectId: input.candidate.projectId,
        conversationId: input.run.conversation.id!,
        sequence: rows.reduce((max, event) => Math.max(max, event.sequence), 0) + 1,
        kind: 'confirmation',
        content: '作者已审核整理本章候选。',
        payload: JSON.stringify(input.confirmation),
        createdAt: now,
      }, { owner: 'work' }) as AgentEvent
      await db.agentEvents.add(confirmationEvent)
    }
    await db.agentConversations.update(input.run.conversation.id!, { updatedAt: now })
    return {
      conversation: { ...input.run.conversation, updatedAt: now },
      event: {
        ...input.run.event,
        content: summarizeChapterOrganizationCandidate(input.candidate),
        payload: JSON.stringify(input.candidate),
      },
      candidate: input.candidate,
    }
  })
}

export async function isChapterOrganizationCurrent(
  candidate: ChapterOrganizationCandidate,
): Promise<boolean> {
  const scope = await resolveReadScopeLike(candidate.projectId)
  const chapter = await db.chapters.get(candidate.chapterId)
  return Boolean(
    chapter
    && await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })
    && await hashChapterText(chapter.content ?? '') === candidate.sourceTextHash
  )
}

export function selectAllChapterOrganizationCandidates(
  candidate: ChapterOrganizationCandidate,
): ChapterOrganizationSelection {
  const indexes = (length: number) => Array.from({ length }, (_, index) => index)
  return {
    stateDiffs: indexes(candidate.stateDiffs.length),
    facts: indexes(candidate.facts.length),
    inventoryEvents: indexes(candidate.inventoryEvents.length),
    storyEvents: indexes(candidate.storyEvents.length),
    relations: indexes(candidate.relations.length),
    foreshadowUpdates: indexes(candidate.foreshadowUpdates.length),
  }
}

export function summarizeChapterOrganizationCandidate(candidate: ChapterOrganizationCandidate): string {
  return [
    `状态 ${candidate.stateDiffs.length}`,
    `事实 ${candidate.facts.length}`,
    `物品 ${candidate.inventoryEvents.length}`,
    `年表 ${candidate.storyEvents.length}`,
    `关系 ${candidate.relations.length}`,
    `伏笔 ${candidate.foreshadowUpdates.length}`,
  ].join(' · ')
}

function selectedAt<T>(items: readonly T[], indexes: readonly number[]): T[] {
  return [...new Set(indexes)].flatMap(index => (
    Number.isInteger(index) && items[index] != null ? [items[index]] : []
  ))
}

function nextEchoChapterIds(current: Foreshadow, chapterId: number): string {
  let ids: number[] = []
  try {
    const parsed = JSON.parse(current.echoChapterIds || '[]')
    if (Array.isArray(parsed)) {
      ids = parsed.filter((value): value is number => typeof value === 'number')
    }
  } catch {
    ids = []
  }
  return JSON.stringify([...new Set([...ids, chapterId])])
}

/**
 * 作者确认后的正式写回。每个领域独立落库和记账；失败不会被伪装为整批成功。
 * 调用前必须通过正文 hash 守卫。
 */
export async function adoptChapterOrganizationSelection(input: {
  run: ChapterOrganizationRun
  selection: ChapterOrganizationSelection
}): Promise<ChapterOrganizationAdoptionResult> {
  if (!await isChapterOrganizationCurrent(input.run.candidate)) {
    throw new Error('章节正文已变化，这批整理候选已过期；请重新运行“整理本章”。')
  }
  const candidate: ChapterOrganizationCandidate = {
    ...input.run.candidate,
    domainStatus: { ...input.run.candidate.domainStatus },
    domainErrors: { ...input.run.candidate.domainErrors },
  }
  const workspaceScope = await resolveScopeLike(candidate.projectId)
  const sourceChapter = await db.chapters.get(candidate.chapterId)
  if (
    !await assertRecordInScope(workspaceScope, 'chapters', sourceChapter, { owner: 'work' })
    || await hashChapterText(sourceChapter?.content ?? '') !== candidate.sourceTextHash
  ) {
    throw new Error('章节正文已变化，这批整理候选已过期；请重新运行“整理本章”。')
  }
  const written: Record<ChapterOrganizationDomain, number> = {
    state: 0,
    facts: 0,
    inventory: 0,
    timeline: 0,
    relations: 0,
    foreshadows: 0,
  }

  const applyDomain = async (
    domain: ChapterOrganizationDomain,
    count: number,
    action: () => Promise<number>,
  ) => {
    if (count === 0) {
      candidate.domainStatus[domain] = 'skipped'
      delete candidate.domainErrors[domain]
      return
    }
    try {
      written[domain] = await action()
      candidate.domainStatus[domain] = 'adopted'
      delete candidate.domainErrors[domain]
    } catch (error) {
      candidate.domainStatus[domain] = 'failed'
      candidate.domainErrors[domain] = error instanceof Error ? error.message : '未知写入错误'
    }
  }

  const states = selectedAt(candidate.stateDiffs, input.selection.stateDiffs)
  await applyDomain('state', states.length, async () => {
    await useStateCardStore.getState().loadAll(workspaceScope)
    await useStateCardStore.getState().applyDiffs(workspaceScope, states, candidate.chapterId)
    return states.length
  })

  const facts = selectedAt(candidate.facts, input.selection.facts)
  await applyDomain('facts', facts.length, async () => (
    useFactLedgerStore.getState().adopt({
      projectId: candidate.projectId,
      scope: workspaceScope,
      sourceChapterId: candidate.chapterId,
      worldGroupId: candidate.worldGroupId,
      candidates: facts,
    })
  ))

  const inventory = selectedAt(candidate.inventoryEvents, input.selection.inventoryEvents)
  await applyDomain('inventory', inventory.length, async () => {
    const result = await replaceAdoptedCollection({
      projectId: candidate.projectId,
      workspaceScope,
      target: 'itemLedger',
      scope: { chapterId: candidate.chapterId },
      data: inventory.map(event => ({
        itemName: event.itemName,
        heldByName: event.heldByName,
        action: event.action,
        quantity: event.quantity,
        chapterId: candidate.chapterId,
        chapterTitle: candidate.chapterTitle,
        note: event.note,
      })),
    })
    await useItemLedgerStore.getState().loadAll(workspaceScope)
    return result.written.length
  })

  const storyEvents = selectedAt(candidate.storyEvents, input.selection.storyEvents)
  await applyDomain('timeline', storyEvents.length, async () => {
    const result = await replaceAdoptedCollection({
      projectId: candidate.projectId,
      workspaceScope,
      target: 'storyTimelineEvents',
      scope: { chapterId: candidate.chapterId },
      data: storyEvents.map((event, order) => ({
        title: event.title,
        storyTime: event.storyTime,
        importance: event.importance,
        description: event.description,
        chapterId: candidate.chapterId,
        chapterTitle: candidate.chapterTitle,
        order,
      })),
    })
    await useStoryTimelineStore.getState().loadAll(workspaceScope)
    return result.written.length
  })

  const relations = selectedAt(candidate.relations, input.selection.relations)
  await applyDomain('relations', relations.length, async () => {
    const result = await adopt({
      projectId: candidate.projectId,
      scope: workspaceScope,
      target: 'characterRelations',
      mode: 'add-many',
      data: relations.map(relation => ({
        fromCharacterId: relation.fromCharacterId,
        toCharacterId: relation.toCharacterId,
        relationType: relation.type,
        label: relation.label,
        description: relation.description,
        isBidirectional: relation.bidirectional,
      })),
    })
    const [characters, currentRelations] = await Promise.all([
      readOwnedRows<Character>(workspaceScope, 'characters', { owner: 'world' }),
      readOwnedRows<CharacterRelation>(workspaceScope, 'characterRelations', { owner: 'world' }),
    ])
    for (const selected of relations) {
      const relation = currentRelations.find(current => (
        current.relationType === selected.type
        && (
          (
            current.fromCharacterId === selected.fromCharacterId
            && current.toCharacterId === selected.toCharacterId
          )
          || (
            current.fromCharacterId === selected.toCharacterId
            && current.toCharacterId === selected.fromCharacterId
          )
        )
      ))
      if (relation) {
        await syncRelationToCharacterFields({
          projectId: candidate.projectId,
          scope: workspaceScope,
          relation,
          characters,
        })
      }
    }
    await useCharacterRelationStore.getState().loadAll(workspaceScope)
    await useCharacterStore.getState().loadAll(workspaceScope)
    return result.written.length
  })

  const foreshadowUpdates = selectedAt(candidate.foreshadowUpdates, input.selection.foreshadowUpdates)
  await applyDomain('foreshadows', foreshadowUpdates.length, async () => {
    const currentRows = await db.foreshadows.bulkGet(
      foreshadowUpdates.map(update => update.foreshadowId),
    )
    for (const [index, update] of foreshadowUpdates.entries()) {
      const current = currentRows[index]
      if (
        !current
        || !await assertRecordInScope(workspaceScope, 'foreshadows', current, { owner: 'work' })
        || current.status !== update.fromStatus
        || !FORESHADOW_TRANSITIONS[current.status].includes(update.toStatus)
      ) {
        throw new Error(`伏笔“${update.name}”状态已变化，未覆盖当前数据。`)
      }
    }
    let count = 0
    for (const [index, update] of foreshadowUpdates.entries()) {
      const current = currentRows[index]!
      const patch: Record<string, unknown> = {
        status: update.toStatus,
        notes: update.note
          ? [current.notes, `【${candidate.chapterTitle}】${update.note}`].filter(Boolean).join('\n')
          : current.notes,
      }
      if (update.toStatus === 'planted' && current.plantChapterId == null) {
        patch.plantChapterId = candidate.chapterId
      }
      if (update.toStatus === 'echoed') {
        patch.echoChapterIds = nextEchoChapterIds(current, candidate.chapterId)
      }
      if (update.toStatus === 'resolved') {
        patch.resolveChapterId = candidate.chapterId
      }
      const result = await adopt({
        projectId: candidate.projectId,
        scope: workspaceScope,
        target: 'foreshadows',
        recordId: update.foreshadowId,
        mode: 'merge-diffs',
        data: patch,
      })
      count += result.written.length
    }
    await useForeshadowStore.getState().loadAll(workspaceScope)
    return count
  })

  const run = await updateChapterOrganizationRun({
    run: input.run,
    candidate,
    confirmation: { selection: input.selection, written, domainStatus: candidate.domainStatus },
  })
  return { run, written }
}
