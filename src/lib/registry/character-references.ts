import { db } from '../db/schema'
import { parseFields, stringifyFields } from '../types/state-card'
import { PROJECT_TABLES } from './project-tables'
import type { ArrayRef, JsonRef } from './types'

interface CharacterReferenceRemapInput {
  projectId: number
  fromCharacterId: number
  fromName: string
  toCharacterId?: number
  toName?: string
}

/** Remove or remap every registered reference to a character. Must run inside a rw transaction. */
export async function applyCharacterReferenceRemap(input: CharacterReferenceRemapInput): Promise<void> {
  const toCharacterId = input.toCharacterId
  const toName = input.toName

  await remapSimpleCharacterRefs(input.projectId, input.fromCharacterId, toCharacterId)
  await remapRegisteredCharacterArrays(input.projectId, input.fromCharacterId, toCharacterId)
  await remapRegisteredCharacterJson(input.projectId, input.fromCharacterId, toCharacterId)
  await remapCharacterStateCards(input.projectId, input.fromName, toName)
}

function targetTable(target: string): string {
  return target.split('[')[0]
}

function targetField(target: string): string | null {
  const match = target.match(/\[([^\]]+)\]/)
  return match?.[1] ?? null
}

async function remapSimpleCharacterRefs(projectId: number, fromId: number, toId?: number): Promise<void> {
  const spec = PROJECT_TABLES.find(s => s.name === 'characters')
  for (const ref of spec?.refs ?? []) {
    if (ref.kind !== 'simple' || ref.field !== 'id') continue
    const tableName = targetTable(ref.target)
    const field = targetField(ref.target)
    const targetSpec = PROJECT_TABLES.find(s => s.name === tableName)
    if (!field || !targetSpec) continue

    if (toId == null) {
      await (targetSpec.table as any).where(field).equals(fromId).delete()
    } else {
      const keys = await (targetSpec.table as any).where(field).equals(fromId).primaryKeys()
      for (const key of keys as number[]) {
        await targetSpec.table.update(key, { [field]: toId } as any)
      }
    }
  }

  if (toId != null) {
    const rows = await db.characterRelations.where('projectId').equals(projectId).toArray()
    const selfIds = rows
      .filter(r => r.fromCharacterId === r.toCharacterId)
      .map(r => r.id)
      .filter((id): id is number => id != null)
    if (selfIds.length) await db.characterRelations.bulkDelete(selfIds)
  }
}

async function remapRegisteredCharacterArrays(
  projectId: number,
  fromId: number,
  toId?: number,
): Promise<void> {
  for (const spec of PROJECT_TABLES) {
    const refs = (spec.refs ?? []).filter((ref): ref is ArrayRef =>
      ref.kind === 'array' && ref.itemTarget === 'characters' && ref.onDelete === 'removeItem')
    if (!refs.length) continue

    const rows = await (spec.table as any).where('projectId').equals(projectId).toArray()
    for (const row of rows as any[]) {
      const patch: Record<string, unknown> = {}
      for (const ref of refs) {
        const current = row[ref.field]
        if (!Array.isArray(current)) continue
        const next = remapIdArray(current, fromId, toId)
        if (next.changed) patch[ref.field] = next.values
      }
      if (Object.keys(patch).length) {
        patch.updatedAt = Date.now()
        await spec.table.update(row.id, patch as any)
      }
    }
  }
}

async function remapRegisteredCharacterJson(
  projectId: number,
  fromId: number,
  toId?: number,
): Promise<void> {
  for (const spec of PROJECT_TABLES) {
    const refs = (spec.refs ?? []).filter((ref): ref is JsonRef =>
      ref.kind === 'json' && targetTable(ref.target) === 'characters' && ref.onDelete === 'remap')
    if (!refs.length) continue

    const rows = await (spec.table as any).where('projectId').equals(projectId).toArray()
    for (const row of rows as any[]) {
      const patch: Record<string, unknown> = {}
      for (const ref of refs) {
        if (ref.jsonPath === '$[].characterIds[]') {
          const next = remapSceneCharacterIds(row[ref.field], fromId, toId)
          if (next.changed) patch[ref.field] = next.value
        }
      }
      if (Object.keys(patch).length) {
        patch.updatedAt = Date.now()
        await spec.table.update(row.id, patch as any)
      }
    }
  }
}

function remapIdArray(values: unknown[], fromId: number, toId?: number): { values: number[]; changed: boolean } {
  let changed = false
  const next: number[] = []
  for (const value of values) {
    if (value === fromId) {
      changed = true
      if (toId != null && !next.includes(toId)) next.push(toId)
      continue
    }
    if (typeof value === 'number' && !next.includes(value)) next.push(value)
  }
  return { values: next, changed }
}

function remapSceneCharacterIds(
  scenes: unknown,
  fromId: number,
  toId?: number,
): { value: unknown; changed: boolean } {
  if (!Array.isArray(scenes)) return { value: scenes, changed: false }
  let changed = false
  const next = scenes.map(scene => {
    if (!scene || typeof scene !== 'object') return scene
    const record = scene as Record<string, unknown>
    if (!Array.isArray(record.characterIds)) return scene
    const remapped = remapIdArray(record.characterIds, fromId, toId)
    if (!remapped.changed) return scene
    changed = true
    return { ...record, characterIds: remapped.values }
  })
  return { value: next, changed }
}

async function remapCharacterStateCards(
  projectId: number,
  fromName: string,
  toName?: string,
): Promise<void> {
  const rows = await db.stateCards.where('projectId').equals(projectId).toArray()
  const fromCards = rows.filter(c => c.category === 'character' && c.entityName === fromName)
  if (!fromCards.length) return

  if (!toName || toName === fromName) {
    const ids = fromCards.map(c => c.id).filter((id): id is number => id != null)
    if (ids.length) await db.stateCards.bulkDelete(ids)
    return
  }

  const primary = rows.find(c => c.category === 'character' && c.entityName === toName)
  if (!primary?.id) {
    const [first, ...rest] = fromCards
    if (first.id) await db.stateCards.update(first.id, { entityName: toName, updatedAt: Date.now() })
    const restIds = rest.map(c => c.id).filter((id): id is number => id != null)
    if (restIds.length) await db.stateCards.bulkDelete(restIds)
    return
  }

  const mergedFields = parseFields(primary.fields)
  for (const card of fromCards) {
    for (const field of parseFields(card.fields)) {
      const existing = mergedFields.find(f => f.key === field.key)
      if (!existing) mergedFields.push(field)
      else if (!existing.value && field.value) existing.value = field.value
    }
  }
  await db.stateCards.update(primary.id, { fields: stringifyFields(mergedFields), updatedAt: Date.now() })
  const fromIds = fromCards.map(c => c.id).filter((id): id is number => id != null)
  if (fromIds.length) await db.stateCards.bulkDelete(fromIds)
}
