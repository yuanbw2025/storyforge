import { adopt } from '../registry/adopt'
import { db } from '../db/schema'
import type { Character, CharacterRelation } from '../types'

export const RELATION_FIELD_PREFIX = '- 与【'

type RelationForSummary = Pick<
  CharacterRelation,
  'fromCharacterId' | 'toCharacterId' | 'label' | 'description' | 'isBidirectional'
>

interface RelationSummaryPatchInput {
  projectId: number
  relation: RelationForSummary
  characters: Character[]
}

function relationLine(otherName: string, relation: RelationForSummary, perspective: 'from' | 'to'): string {
  const label = relation.label?.trim() || '关系'
  const description = relation.description?.trim()
  const prefix = perspective === 'from'
    ? `- 与【${otherName}】：${label}`
    : relation.isBidirectional
      ? `- 与【${otherName}】：${label}`
      : `- 被【${otherName}】关联：${label}`
  return description ? `${prefix}。${description}` : `${prefix}。`
}

function appendUniqueLine(existing: string | undefined, line: string): string | null {
  const normalizedExisting = String(existing ?? '').trim()
  const existingLines = normalizedExisting
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
  if (existingLines.includes(line)) return null
  return normalizedExisting ? `${normalizedExisting}\n${line}` : line
}

export function buildRelationshipFieldPatches({ projectId, relation, characters }: RelationSummaryPatchInput): Array<{ characterId: number; relationships: string }> {
  const from = characters.find(c => c.projectId === projectId && c.id === relation.fromCharacterId)
  const to = characters.find(c => c.projectId === projectId && c.id === relation.toCharacterId)
  if (!from?.id || !to?.id) return []

  const patches: Array<{ characterId: number; relationships: string }> = []
  const fromRelationships = appendUniqueLine(from.relationships, relationLine(to.name, relation, 'from'))
  if (fromRelationships != null) patches.push({ characterId: from.id, relationships: fromRelationships })

  const toRelationships = appendUniqueLine(to.relationships, relationLine(from.name, relation, 'to'))
  if (toRelationships != null) patches.push({ characterId: to.id, relationships: toRelationships })

  return patches
}

export async function syncRelationToCharacterFields(input: RelationSummaryPatchInput): Promise<number> {
  const endpoints = [input.relation.fromCharacterId, input.relation.toCharacterId]
  const latestRows = await db.characters.bulkGet(endpoints)
  const characterById = new Map<number, Character>()
  for (const character of input.characters) {
    if (character.id != null && character.projectId === input.projectId) {
      characterById.set(character.id, character)
    }
  }
  for (const character of latestRows) {
    if (character?.id != null && character.projectId === input.projectId) {
      characterById.set(character.id, character)
    }
  }

  const patches = buildRelationshipFieldPatches({
    ...input,
    characters: Array.from(characterById.values()),
  })
  let written = 0
  for (const patch of patches) {
    const result = await adopt({
      projectId: input.projectId,
      target: 'characters',
      recordId: patch.characterId,
      mode: 'merge-diffs',
      data: { relationships: patch.relationships },
    })
    written += result.written.length
  }
  return written
}
