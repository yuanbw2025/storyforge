import { db } from '../db/schema'
import { remapTemporalFactCharacterRefs } from '../fact-ledger/lifecycle'
import { remapKnowledgeCharacterRefs } from '../knowledge-ledger/lifecycle'
import { remapCultivationProgressCharacterRefs } from '../cultivation/progress-lifecycle'
import { readStateCardFields, stringifyFields } from '../types/state-card'
import { PROJECT_TABLES } from './project-tables'
import type { ArrayRef, JsonRef } from './types'
import { remapNarrativeDomainReferencesV1 } from '../narrative-domain/lifecycle'
import type { Character, StateCard } from '../types'

interface CharacterReferenceRemapInput {
  projectId: number
  fromCharacterId: number
  fromName: string
  toCharacterId?: number
  toName?: string
}

/** Remove or remap every registered reference to a character. Must run inside a rw transaction. */
export async function applyCharacterReferenceRemap(input: CharacterReferenceRemapInput): Promise<void> {
  const source = await db.characters.get(input.fromCharacterId)
  const sourceWorldId = (source as (Character & { worldId?: number }) | undefined)?.worldId
  if (!source || source.projectId !== input.projectId || typeof sourceWorldId !== 'number') throw new Error('角色引用重映射缺少原 World 归属；原数据保持不变。')
  if (typeof source.name === 'string' && source.name !== input.fromName) throw new Error('角色名称已变化，请重新审阅合并。')
  if (input.toCharacterId != null) {
    const target = await db.characters.get(input.toCharacterId)
    if (!target || target.projectId !== source.projectId || (target as Character & { worldId?: number }).worldId !== sourceWorldId || target.id === source.id) throw new Error('角色合并不能跨 World/Work，目标须属于原 World 且不能是原角色。')
  }
  const toCharacterId = input.toCharacterId
  const toName = input.toName
  await remapNarrativeDomainReferencesV1({ table: 'characters', fromId: input.fromCharacterId, toId: toCharacterId })

  // itemLedger 同时保存稳定 ID 与作者可读名称；必须先更新两者，再让
  // 注册表通用重映射处理其余 ID 引用。否则通用步骤先改 ID 后，名称
  // 修复就再也找不到原角色记录。
  await remapItemLedgerCharacterRefs(
    input.projectId,
    input.fromCharacterId,
    toCharacterId,
    toName,
  )
  await remapSimpleCharacterRefs(input.projectId, input.fromCharacterId, toCharacterId)
  await remapRegisteredCharacterArrays(input.projectId, input.fromCharacterId, toCharacterId)
  await remapRegisteredCharacterJson(
    input.projectId,
    input.fromCharacterId,
    toCharacterId,
    toName,
  )
  await remapCharacterStateCards(source, sourceWorldId, input.fromName, toName)
  await remapTemporalFactCharacterRefs({
    projectId: input.projectId,
    fromCharacterId: input.fromCharacterId,
    toCharacterId,
    toName,
  })
  await remapKnowledgeCharacterRefs({
    projectId: input.projectId,
    fromCharacterId: input.fromCharacterId,
    toCharacterId,
    toName,
  })
  await remapCultivationProgressCharacterRefs({
    projectId: input.projectId,
    fromCharacterId: input.fromCharacterId,
    toCharacterId,
    toName,
  })
}

/**
 * itemLedger 是角色的软引用：删除角色时只断开 ID 并保留原持有人名；
 * 合并角色时同时把 ID 和持有人名改为 canonical，避免物品留在已删除别名下。
 */
async function remapItemLedgerCharacterRefs(
  projectId: number,
  fromCharacterId: number,
  toCharacterId?: number,
  toName?: string,
): Promise<void> {
  const rows = await db.itemLedger
    .where('projectId').equals(projectId)
    .filter(entry => entry.characterId === fromCharacterId)
    .toArray()
  for (const row of rows) {
    if (row.id == null) continue
    await db.itemLedger.update(row.id, {
      characterId: toCharacterId ?? null,
      ...(toCharacterId != null && toName ? { heldByName: toName } : {}),
    })
  }
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
    const keys = (await (targetSpec.table as any)
      .filter((row: Record<string, unknown>) => row.projectId === projectId && row[field] === fromId)
      .primaryKeys()) as number[]

    if (toId == null) {
      if (ref.onDelete === 'setNull') {
        for (const key of keys) {
          await targetSpec.table.update(key, { [field]: null } as any)
        }
      } else if (ref.onDelete === 'cascade') {
        for (const key of keys) await remapNarrativeDomainReferencesV1({ table: tableName, fromId: key })
        if (keys.length) await targetSpec.table.bulkDelete(keys)
      }
    } else {
      for (const key of keys) {
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
    for (const id of selfIds) await remapNarrativeDomainReferencesV1({ table: 'characterRelations', fromId: id })
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
  toName?: string,
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
        } else if (ref.jsonPath === '$[].characterId') {
          const next = remapCharacterPlanArcs(row[ref.field], fromId, toId, toName)
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

function remapCharacterPlanArcs(
  value: unknown,
  fromId: number,
  toId?: number,
  toName?: string,
): { value: unknown; changed: boolean } {
  const storedAsJson = typeof value === 'string'
  let arcs: unknown = value
  if (storedAsJson) {
    try {
      arcs = JSON.parse(value)
    } catch {
      return { value, changed: false }
    }
  }
  if (!Array.isArray(arcs)) return { value, changed: false }

  let changed = false
  const next = arcs.map(arc => {
    if (!arc || typeof arc !== 'object') return arc
    const record = arc as Record<string, unknown>
    if (record.characterId !== fromId) return arc
    changed = true
    return {
      ...record,
      characterId: toId ?? null,
      // 删除只断开 ID 并保留快照名；合并才更新到 canonical 名称。
      ...(toId != null && toName ? { name: toName } : {}),
    }
  })
  return {
    value: storedAsJson ? JSON.stringify(next) : next,
    changed,
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
  source: Character,
  worldId: number,
  fromName: string,
  toName?: string,
): Promise<void> {
  // State cards carry a Work owner and a name snapshot, not a character ID.
  // Equal names retain their existing snapshot; ambiguous survivors must not
  // lose it. A World-owned character can serve several independent Works.
  if (toName === fromName) return
  const workIds = new Set((await db.works.where('worldId').equals(worldId).toArray()).filter(work => work.projectId === source.projectId).map(work => work.id))
  type ScopedCard = StateCard & { workId?: number; worldGroupId?: number | null }
  const rows = (await db.stateCards.where('projectId').equals(source.projectId).toArray() as ScopedCard[]).filter(card => card.workId != null && workIds.has(card.workId))
  const sameNames = (await db.characters.where('projectId').equals(source.projectId).toArray()).filter(character => (character as Character & { worldId?: number }).worldId === worldId && character.id !== source.id && character.name === fromName)
  const fromCards = rows.filter(c => c.category === 'character' && c.entityName === fromName
    && (source.isCrossWorld || (c.worldGroupId ?? null) === (source.homeWorldGroupId ?? null))
    && !sameNames.some(character => character.isCrossWorld || (character.homeWorldGroupId ?? null) === (c.worldGroupId ?? null)))
  if (!fromCards.length) return

  if (!toName) {
    const ids = fromCards.map(c => c.id).filter((id): id is number => id != null)
    if (ids.length) await db.stateCards.bulkDelete(ids)
    return
  }

  // A rename/merge must not discard unreadable fields while removing duplicate cards.
  fromCards.forEach(readStateCardFields)
  const groups = new Map<string, ScopedCard[]>()
  for (const card of fromCards) {
    const key = `${card.workId}:${card.worldGroupId ?? 'default'}`
    groups.set(key, [...(groups.get(key) ?? []), card])
  }
  for (const cards of groups.values()) {
    const primary = rows.find(c => c.category === 'character' && c.entityName === toName && c.workId === cards[0].workId && (c.worldGroupId ?? null) === (cards[0].worldGroupId ?? null))
    if (!primary?.id) {
      const [first, ...rest] = cards
      if (first.id) await db.stateCards.update(first.id, { entityName: toName, updatedAt: Date.now() })
      const restIds = rest.map(c => c.id).filter((id): id is number => id != null)
      if (restIds.length) await db.stateCards.bulkDelete(restIds)
      continue
    }

    const mergedFields = readStateCardFields(primary)
    for (const card of cards) {
      for (const field of readStateCardFields(card)) {
        const existing = mergedFields.find(f => f.key === field.key)
        if (!existing) mergedFields.push(field)
        else if (!existing.value && field.value) existing.value = field.value
      }
    }
    await db.stateCards.update(primary.id, { fields: stringifyFields(mergedFields), updatedAt: Date.now() })
    const fromIds = cards.map(c => c.id).filter((id): id is number => id != null)
    if (fromIds.length) await db.stateCards.bulkDelete(fromIds)
  }
}
