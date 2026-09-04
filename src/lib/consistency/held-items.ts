import type { Chapter, ItemLedgerEntry, OutlineNode } from '../types'
import type { ConsistencyFinding } from '../ai/adapters/consistency-audit-adapter'
import { readOwnedRows, resolveScope } from '../workspace/scope'
import type { WorkspaceScope } from '../types/world-ownership'
import { resolveProjectionBoundary } from './projection-boundary'

export interface HeldItemProjection {
  itemName: string
  quantity: number
  heldByName: string
  characterId: number | null
  evidence: ItemLedgerEntry[]
}

export interface ProjectHeldItemsInput {
  entries: ItemLedgerEntry[]
  outlineNodes: OutlineNode[]
  chapters: Chapter[]
  chapterId?: number | null
  outlineNodeId?: number | null
  worldGroupId?: number | null
  characterId?: number | null
}

const GAIN_TRIGGERS = [
  '首次获得',
  '第一次获得',
  '重新获得',
  '再次获得',
  '获得',
  '得到',
  '拿到',
  '捡到',
  '拾起',
  '取得',
  '收下',
  '拿回',
  '夺回',
]

function normalizeItemName(name: string): string {
  return name.trim().replace(/\s+/g, '')
}

function includesInWorld(entry: ItemLedgerEntry, chapterWorld: Map<number, number | null>, targetWorldGroupId?: number | null): boolean {
  const chapterId = entry.chapterId ?? null
  if (chapterId == null) return true
  const entryWorldGroupId = chapterWorld.get(chapterId) ?? null
  return entryWorldGroupId == null || entryWorldGroupId === (targetWorldGroupId ?? null)
}

/**
 * CONSISTENCY-1 · 截止当前章的物品持有投影。
 * 按 resolveCanonicalChapterSequence 的规范章序实时计算，不缓存 order。
 */
export function projectHeldItems(input: ProjectHeldItemsInput): HeldItemProjection[] {
  const {
    targetOrder: currentOrder,
    orderOfChapter: orderOf,
    worldOfChapter: chapterWorld,
  } = resolveProjectionBoundary(input)
  if (currentOrder == null) return []

  const grouped = new Map<string, {
    displayName: string
    heldByName: string
    characterId: number | null
    quantity: number
    evidence: ItemLedgerEntry[]
  }>()
  for (const entry of input.entries) {
    if (input.characterId != null && (entry.characterId ?? null) !== (input.characterId ?? null)) continue
    const itemKey = normalizeItemName(entry.itemName)
    if (!itemKey) continue
    const heldByName = entry.heldByName.trim()
    const ownerKey = entry.characterId != null ? `id:${entry.characterId}` : `name:${heldByName}`
    const key = JSON.stringify([ownerKey, itemKey])
    const entryChapterId = entry.chapterId ?? null
    if (entryChapterId != null) {
      const entryOrder = orderOf.get(entryChapterId)
      if (entryOrder == null || entryOrder >= currentOrder) continue
    }
    if (!includesInWorld(entry, chapterWorld, input.worldGroupId)) continue
    const bucket = grouped.get(key) ?? {
      displayName: entry.itemName.trim(),
      heldByName,
      characterId: entry.characterId ?? null,
      quantity: 0,
      evidence: [],
    }
    bucket.quantity += entry.action === 'gain' ? entry.quantity : -entry.quantity
    bucket.evidence.push(entry)
    grouped.set(key, bucket)
  }

  return [...grouped.values()]
    .filter(item => item.quantity > 0)
    .sort((a, b) => b.quantity - a.quantity || a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'))
    .map(item => ({
      itemName: item.displayName,
      quantity: item.quantity,
      heldByName: item.heldByName,
      characterId: item.characterId,
      evidence: item.evidence,
    }))
}

export async function readProjectHeldItems(
  projectId: number,
  chapterId?: number | null,
  worldGroupId?: number | null,
  characterId?: number | null,
  outlineNodeId?: number | null,
  scope?: WorkspaceScope,
): Promise<HeldItemProjection[]> {
  const resolved = scope ?? await resolveScope({ projectId })
  const [entries, outlineNodes, chapters] = await Promise.all([
    readOwnedRows<any>(resolved, 'itemLedger', { owner: 'work' }),
    readOwnedRows<any>(resolved, 'outlineNodes', { owner: 'work' }),
    readOwnedRows<any>(resolved, 'chapters', { owner: 'work' }),
  ])
  return projectHeldItems({
    entries,
    outlineNodes,
    chapters,
    chapterId,
    outlineNodeId,
    worldGroupId,
    characterId,
  })
}

export function formatHeldItemsContext(items: HeldItemProjection[]): string {
  if (!items.length) return ''
  return [
    '【当前已持有物品(勿再写首次获得)】',
    ...items.slice(0, 80).map(item => {
      const latest = [...item.evidence]
        .sort((a, b) => (b.chapterId ?? 0) - (a.chapterId ?? 0) || b.createdAt - a.createdAt)[0]
      const source = latest?.chapterTitle || (latest?.chapterId != null ? `章节#${latest.chapterId}` : '未绑定章节')
      return `- ${item.heldByName ? `${item.heldByName}：` : ''}${item.itemName} ×${item.quantity}（已有记录，最近证据:${source}）`
    }),
  ].join('\n')
}

function findSentence(text: string, index: number): string {
  const startMarks = ['。', '！', '？', '\n']
  let start = 0
  for (let i = index - 1; i >= 0; i--) {
    if (startMarks.includes(text[i])) {
      start = i + 1
      break
    }
  }
  let end = text.length
  for (let i = index; i < text.length; i++) {
    if (startMarks.includes(text[i])) {
      end = i + 1
      break
    }
  }
  return text.slice(start, end).trim()
}

function hasNearbyGainTrigger(text: string, itemIndex: number): boolean {
  const from = Math.max(0, itemIndex - 18)
  const to = Math.min(text.length, itemIndex + 36)
  const window = text.slice(from, to)
  return GAIN_TRIGGERS.some(trigger => window.includes(trigger))
}

export function checkHeldItemAcquisition(
  generatedText: string,
  heldItems: HeldItemProjection[],
  knownItemNames: string[] = [],
  knownCharacterNames: string[] = [],
): ConsistencyFinding[] {
  const names = new Set<string>()
  for (const item of heldItems) names.add(item.itemName.trim())
  for (const name of knownItemNames) names.add(name.trim())

  const findings: ConsistencyFinding[] = []
  const seenQuotes = new Set<string>()
  const heldByNormalized = new Map<string, HeldItemProjection[]>()
  for (const item of heldItems) {
    const key = normalizeItemName(item.itemName)
    const values = heldByNormalized.get(key) ?? []
    values.push(item)
    heldByNormalized.set(key, values)
  }
  const characterNames = new Set([
    ...knownCharacterNames.map(name => name.trim()),
    ...heldItems.map(item => item.heldByName.trim()),
  ].filter(Boolean))

  for (const rawName of names) {
    if (!rawName || rawName.length < 2) continue
    let index = generatedText.indexOf(rawName)
    while (index >= 0) {
      if (hasNearbyGainTrigger(generatedText, index)) {
        const quote = findSentence(generatedText, index)
        const normalized = normalizeItemName(rawName)
        const holdersInQuote = [...characterNames].filter(name => quote.includes(name))
        const held = (heldByNormalized.get(normalized) ?? []).find(item =>
          holdersInQuote.length === 0 || holdersInQuote.includes(item.heldByName))
        if (held && quote && generatedText.includes(quote) && !seenQuotes.has(`${rawName}:${quote}`)) {
          seenQuotes.add(`${rawName}:${quote}`)
          const evidenceEntry = held.evidence[held.evidence.length - 1]
          const evidenceQuote = `${held.itemName} ×${held.quantity}`
          findings.push({
            category: '物品持有连续性',
            severity: 'risk',
            quote,
            evidence: [{
              sourceType: 'canon',
              sourceId: evidenceEntry?.id ?? 0,
              quote: evidenceQuote,
            }],
            reason: `“${held.itemName}”在当前章之前已处于持有状态（持有人：${held.heldByName || '该角色'}），正文又把它写成获得/拿到/捡到，可能造成重复获得。`,
            suggestion: '改为使用、确认、取出或提及该物品来源，避免再次写成首次获得。',
          })
        }
      }
      index = generatedText.indexOf(rawName, index + rawName.length)
    }
  }

  return findings
}
