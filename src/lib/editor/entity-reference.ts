import type {
  Character,
  ImportantLocation,
  ItemLedgerEntry,
} from '../types'
import type { CodexCategory, CodexEntry } from '../types/codex'
import { parseEntryFields, parseFieldSchema } from '../types/codex'
import { aggregateInventory } from '../types/item-ledger'

export type EditorEntityKind = 'character' | 'item' | 'location' | 'codex'

export interface EditorEntityReference {
  id: string
  name: string
  kind: EditorEntityKind
  kindLabel: string
  summary: string
  details: Array<{ label: string; value: string }>
}

export interface BuildEditorEntityReferencesInput {
  characters: Character[]
  itemEntries: ItemLedgerEntry[]
  locations: ImportantLocation[]
  codexCategories: CodexCategory[]
  codexEntries: CodexEntry[]
  worldGroupId?: number | null
}

const KIND_PRIORITY: Record<EditorEntityKind, number> = {
  character: 0,
  item: 1,
  location: 2,
  codex: 3,
}

function clip(value: string | undefined, max = 160): string {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? ''
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
}

function inWorld(value: { worldGroupId?: number | null }, target?: number | null): boolean {
  if (target === undefined) return true
  const worldGroupId = value.worldGroupId ?? null
  return worldGroupId === null || worldGroupId === (target ?? null)
}

export function buildEditorEntityReferences(
  input: BuildEditorEntityReferencesInput,
): EditorEntityReference[] {
  const references: EditorEntityReference[] = []
  const worldGroupId = input.worldGroupId

  for (const character of input.characters) {
    if (worldGroupId !== undefined
      && !character.isCrossWorld
      && (character.homeWorldGroupId ?? null) !== (worldGroupId ?? null)) continue
    if (!character.name.trim()) continue
    references.push({
      id: `character:${character.id ?? character.name}`,
      name: character.name.trim(),
      kind: 'character',
      kindLabel: '角色',
      summary: clip(character.shortDescription || character.identity || character.personality),
      details: [
        { label: '身份', value: clip(character.identity || character.shortDescription, 100) },
        { label: '性格', value: clip(character.personality, 100) },
        { label: '当前目标', value: clip(character.goals || character.motivation, 100) },
      ].filter(item => item.value),
    })
  }

  for (const item of aggregateInventory(input.itemEntries)) {
    if (!item.itemName.trim()) continue
    const latest = item.entries[item.entries.length - 1]
    references.push({
      id: `item:${item.itemName.trim().toLocaleLowerCase()}`,
      name: item.itemName.trim(),
      kind: 'item',
      kindLabel: '物品',
      summary: item.quantity > 0 ? `当前持有 ${item.quantity}` : '当前未持有',
      details: [
        { label: '数量', value: String(item.quantity) },
        { label: '最近记录', value: clip(latest?.chapterTitle || latest?.note, 100) },
      ].filter(row => row.value),
    })
  }

  for (const location of input.locations) {
    if (!location.name.trim()) continue
    let tags = ''
    try {
      const parsed = JSON.parse(location.tags || '[]')
      if (Array.isArray(parsed)) tags = parsed.filter(value => typeof value === 'string').slice(0, 6).join(' / ')
    } catch { /* invalid legacy tags stay hidden */ }
    references.push({
      id: `location:${location.id ?? location.name}`,
      name: location.name.trim(),
      kind: 'location',
      kindLabel: '地点',
      summary: clip(location.description || location.significance),
      details: [
        { label: '类型', value: tags },
        { label: '剧情作用', value: clip(location.significance, 100) },
      ].filter(row => row.value),
    })
  }

  const visibleCategories = input.codexCategories.filter(category => !category.hidden && inWorld(category, worldGroupId))
  const categoryById = new Map(visibleCategories.map(category => [category.id, category]))
  for (const entry of input.codexEntries) {
    if (!entry.name.trim() || !inWorld(entry, worldGroupId)) continue
    const category = categoryById.get(entry.categoryId)
    if (!category) continue
    const fields = parseEntryFields(entry.fields)
    const details = parseFieldSchema(category.fieldSchema)
      .filter(field => field.type !== 'ref' && fields[field.key]?.trim())
      .slice(0, 3)
      .map(field => ({ label: field.label, value: clip(fields[field.key], 100) }))
    references.push({
      id: `codex:${entry.id ?? entry.name}`,
      name: entry.name.trim(),
      kind: 'codex',
      kindLabel: category.name,
      summary: clip(entry.summary || entry.description),
      details,
    })
  }

  const byName = new Map<string, EditorEntityReference>()
  for (const reference of references.sort((a, b) => {
    return KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]
      || b.name.length - a.name.length
      || a.name.localeCompare(b.name, 'zh-Hans-CN')
  })) {
    const key = reference.name.toLocaleLowerCase()
    if (!byName.has(key)) byName.set(key, reference)
  }
  return [...byName.values()]
}

export function findEditorEntityMatches(
  text: string,
  references: readonly EditorEntityReference[],
): Array<{ from: number; to: number; reference: EditorEntityReference }> {
  const matches: Array<{ from: number; to: number; reference: EditorEntityReference }> = []
  const occupied = new Set<number>()
  const sorted = [...references].sort((a, b) => b.name.length - a.name.length || KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind])

  for (const reference of sorted) {
    if (reference.name.length < 2) continue
    let index = text.indexOf(reference.name)
    while (index >= 0) {
      const end = index + reference.name.length
      let overlaps = false
      for (let pos = index; pos < end; pos++) {
        if (occupied.has(pos)) { overlaps = true; break }
      }
      if (!overlaps) {
        matches.push({ from: index, to: end, reference })
        for (let pos = index; pos < end; pos++) occupied.add(pos)
      }
      index = text.indexOf(reference.name, end)
    }
  }
  return matches.sort((a, b) => a.from - b.from)
}

export function filterEditorEntityReferences(
  references: readonly EditorEntityReference[],
  query: string,
  limit = 8,
): EditorEntityReference[] {
  const normalized = query.trim().toLocaleLowerCase()
  return references
    .filter(reference => !normalized || reference.name.toLocaleLowerCase().includes(normalized))
    .sort((a, b) => {
      const aStarts = a.name.toLocaleLowerCase().startsWith(normalized) ? 0 : 1
      const bStarts = b.name.toLocaleLowerCase().startsWith(normalized) ? 0 : 1
      return aStarts - bStarts || KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
    .slice(0, limit)
}
