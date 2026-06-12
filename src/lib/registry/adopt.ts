/**
 * adopt() 统一写回入口(Phase 1.2a)。
 *
 * 本文件是纯新增写回层;现有调用方在 1.2b 再逐步迁移。
 */
import { PROJECT_TABLES, REGISTRY_BY_NAME } from './project-tables'
import { FIELD_BY_TARGET } from './field-registry'
import { ADOPTION_BY_TARGET } from './adoption-schema'
import type { AdoptInput, AdoptResult, CollectionAdoptionSpec, FieldSpec, TableSpec } from './types'

export async function adopt(input: AdoptInput): Promise<AdoptResult> {
  const result = emptyResult()
  const fieldSpecs = FIELD_BY_TARGET.get(input.target) ?? []
  if (!fieldSpecs.length) {
    result.skipped.push({ reason: `target ${input.target} 未在 FIELD_REGISTRY 登记`, data: input.data })
    return result
  }

  const tableSpec = REGISTRY_BY_NAME.get(input.target)
  if (!tableSpec) throw new Error(`[adopt] target ${input.target} 不在 PROJECT_TABLES`)

  const isCollection = input.mode === 'add' || input.mode === 'add-many' || input.mode === 'merge-diffs'
  if (isCollection) return adoptCollection(input, fieldSpecs, tableSpec, result)
  return adoptSingleton(input, fieldSpecs, tableSpec, result)
}

function emptyResult(): AdoptResult {
  return { written: [], aliasMapped: [], unknown: [], typeErrors: [], fkErrors: [], skipped: [] }
}

async function adoptSingleton(
  input: AdoptInput,
  fieldSpecs: FieldSpec[],
  tableSpec: TableSpec,
  result: AdoptResult,
): Promise<AdoptResult> {
  const data = input.data as Record<string, unknown>
  const patch = normalizeAndValidate(data, fieldSpecs, result)
  if (!patch || Object.keys(patch).length === 0) return result

  const target = await findSingleton(input, tableSpec)
  if (input.mode === 'append') {
    for (const [field, val] of Object.entries(patch)) {
      const spec = fieldSpecs.find(f => f.field === field)
      if (spec?.type === 'longtext') {
        const existing = target?.[field]
        patch[field] = existing ? `${String(existing)}\n\n${String(val)}` : val
      }
    }
  }

  const now = Date.now()
  if (target?.id != null) {
    await tableSpec.table.update(target.id, { ...patch, updatedAt: now } as any)
    result.written.push({ id: target.id, fields: Object.keys(patch) })
  } else {
    const row = {
      ...defaultSingletonRow(input.target),
      projectId: input.projectId,
      ...(tableSpec.worldScoped ? { [tableSpec.worldGroupField ?? 'worldGroupId']: input.worldGroupId ?? null } : {}),
      ...patch,
      createdAt: now,
      updatedAt: now,
    }
    const id = await tableSpec.table.add(row as any) as number
    result.written.push({ id, fields: Object.keys(patch) })
  }
  return result
}

async function adoptCollection(
  input: AdoptInput,
  fieldSpecs: FieldSpec[],
  tableSpec: TableSpec,
  result: AdoptResult,
): Promise<AdoptResult> {
  const adoption = ADOPTION_BY_TARGET.get(input.target)
  if (!adoption) throw new Error(`[adopt] target ${input.target} 是集合写回但未在 ADOPTION_SCHEMAS 登记`)

  const items = Array.isArray(input.data) ? input.data : [input.data as Record<string, unknown>]
  for (const raw of items) {
    const item = normalizeAndValidate(raw, fieldSpecs, result)
    if (!item) continue
    if (!applyRequired(item, raw, adoption, result)) continue
    if (!await applyFkChecks(item, raw, adoption, result)) continue
    await applyArrayMemberChecks(item, adoption, result)
    applyAutoStamps(item, input, tableSpec, adoption)

    const existing = await findExisting(input.projectId, tableSpec, item, adoption)
    if (existing?.id != null) {
      if (adoption.duplicatePolicy === 'skip') {
        result.skipped.push({ reason: '重复(skip)', data: raw })
      } else if (adoption.duplicatePolicy === 'update') {
        // 防误清空:更新既有记录时,不让 null 覆盖既有字段值(保持旧行为——null 视为"不提供")。
        // 新增记录(else 分支)仍保留 null(顶层卷 parentId 等需要)。
        const patch: Record<string, unknown> = { updatedAt: Date.now() }
        for (const [k, v] of Object.entries(item)) if (v !== null) patch[k] = v
        await tableSpec.table.update(existing.id, patch as any)
        result.written.push({ id: existing.id, fields: Object.keys(patch) })
      } else if (adoption.duplicatePolicy === 'merge') {
        const patch = mergeByStrategy(existing, item, adoption.mergeStrategy ?? 'overwrite-non-empty')
        patch.updatedAt = Date.now()
        await tableSpec.table.update(existing.id, patch as any)
        result.written.push({ id: existing.id, fields: Object.keys(patch) })
      } else {
        throw new Error(`[adopt] 重复记录 ${input.target}.${JSON.stringify(identityValue(item, adoption))}`)
      }
    } else {
      const id = await tableSpec.table.add(item as any) as number
      result.written.push({ id, fields: Object.keys(item) })
    }
  }
  return result
}

function normalizeAndValidate(
  raw: Record<string, unknown>,
  fieldSpecs: FieldSpec[],
  result: AdoptResult,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  const byName = new Map(fieldSpecs.map(f => [f.field, f] as const))
  const byAlias = new Map<string, FieldSpec>()
  for (const f of fieldSpecs) for (const a of f.aliases ?? []) byAlias.set(a, f)

  for (const [key, val] of Object.entries(raw)) {
    // 空字符串跳过;但 null 必须保留——如 outlineNodes 顶层卷的 parentId:null。
    // 旧实现 `val == null` 一并跳过,导致顶层卷写库时丢了 parentId(存成 undefined),
    // 而大纲面板用 `parentId === null` 严格过滤顶层卷 → 卷被藏起,表现为"采纳没反应"(FB-10b)。
    if (val === '') continue
    let spec = byName.get(key)
    let canonical = key
    if (!spec) {
      const aliasHit = byAlias.get(key)
      if (!aliasHit) {
        result.unknown.push(key)
        continue
      }
      spec = aliasHit
      canonical = aliasHit.field
      result.aliasMapped.push({ from: key, to: canonical })
    }

    // null 直接保留(不走类型转换,避免 String(null)→'null');是字段的合法显式值
    if (val == null) {
      out[canonical] = null
      continue
    }
    const cleaned = validateAndCoerce(spec, val, result)
    if (cleaned !== undefined) out[canonical] = cleaned
  }

  return out
}

function validateAndCoerce(spec: FieldSpec, value: unknown, result: AdoptResult): unknown {
  const raw = spec.sanitize ? spec.sanitize(value) : value
  if (spec.type === 'string' || spec.type === 'longtext') return String(raw)
  if (spec.type === 'number') {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n)) return n
    result.typeErrors.push({ field: spec.field, expected: 'number', got: typeof value })
    return undefined
  }
  if (spec.type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    if (raw === 'true' || raw === '是' || raw === 'yes' || raw === 1) return true
    if (raw === 'false' || raw === '否' || raw === 'no' || raw === 0) return false
    result.typeErrors.push({ field: spec.field, expected: 'boolean', got: typeof value })
    return undefined
  }
  if (spec.type === 'enum') {
    const normalized = spec.enumAliasMap?.[String(raw)] ?? String(raw)
    if (!spec.enums || spec.enums.includes(normalized)) return normalized
    result.typeErrors.push({ field: spec.field, expected: `enum:${spec.enums.join('|')}`, got: String(value) })
    return undefined
  }
  if (spec.type === 'array') {
    if (Array.isArray(raw)) return raw
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed
      } catch {
        // fall through
      }
    }
    result.typeErrors.push({ field: spec.field, expected: 'array', got: typeof value })
    return undefined
  }
  if (spec.type === 'json') {
    if (typeof raw === 'string') {
      try {
        JSON.parse(raw)
        return raw
      } catch {
        result.typeErrors.push({ field: spec.field, expected: 'json', got: 'string' })
        return undefined
      }
    }
    return JSON.stringify(raw)
  }
  return undefined
}

async function findSingleton(input: AdoptInput, tableSpec: TableSpec): Promise<any | null> {
  const rows = await tableSpec.table.where('projectId').equals(input.projectId).toArray()
  if (tableSpec.worldScoped) {
    const wgField = tableSpec.worldGroupField ?? 'worldGroupId'
    return (rows as any[]).find(r => (r[wgField] ?? null) === (input.worldGroupId ?? null)) ?? null
  }
  return (rows as any[])[0] ?? null
}

function defaultSingletonRow(target: string): Record<string, unknown> {
  if (target === 'worldviews') {
    return { geography: '', history: '', society: '', culture: '', economy: '', rules: '', summary: '' }
  }
  if (target === 'storyCores') {
    return { theme: '', centralConflict: '', plotPattern: '', storyLines: '' }
  }
  if (target === 'creativeRules') {
    return {
      writingStyle: '',
      narrativePOV: 'third-limited',
      toneAndMood: '',
      prohibitions: '[]',
      consistencyRules: '[]',
      specialRequirements: '',
      referenceWorks: '[]',
    }
  }
  return {}
}

function applyRequired(
  item: Record<string, unknown>,
  raw: unknown,
  adoption: CollectionAdoptionSpec,
  result: AdoptResult,
): boolean {
  for (const req of adoption.required) {
    if (item[req] == null || item[req] === '') {
      result.skipped.push({ reason: `必填字段 ${req} 缺失`, data: raw })
      return false
    }
  }
  return true
}

async function applyFkChecks(
  item: Record<string, unknown>,
  raw: unknown,
  adoption: CollectionAdoptionSpec,
  result: AdoptResult,
): Promise<boolean> {
  for (const fk of adoption.fkChecks ?? []) {
    const refValue = item[fk.field]
    if (refValue == null) continue
    const targetSpec = PROJECT_TABLES.find(s => s.name === fk.target)
    if (!targetSpec) continue
    const exists = await targetSpec.table.get(refValue as number)
    if (!exists) {
      result.fkErrors.push({ field: fk.field, refValue })
      result.skipped.push({ reason: 'FK 校验失败', data: raw })
      return false
    }
  }
  return true
}

async function applyArrayMemberChecks(
  item: Record<string, unknown>,
  adoption: CollectionAdoptionSpec,
  result: AdoptResult,
): Promise<void> {
  for (const arr of adoption.arrayMemberChecks ?? []) {
    const value = item[arr.field]
    if (!Array.isArray(value)) continue
    const targetSpec = PROJECT_TABLES.find(s => s.name === arr.itemTarget)
    if (!targetSpec) continue
    const filtered: unknown[] = []
    for (const v of value) {
      if (await targetSpec.table.get(v as number)) filtered.push(v)
      else result.fkErrors.push({ field: `${arr.field}[]`, refValue: v })
    }
    item[arr.field] = filtered
  }
}

function applyAutoStamps(
  item: Record<string, unknown>,
  input: AdoptInput,
  tableSpec: TableSpec,
  adoption: CollectionAdoptionSpec,
): void {
  const now = Date.now()
  for (const stamp of adoption.autoStamps) {
    if (stamp === 'projectId') item.projectId = input.projectId
    else if (stamp === 'worldGroupId' && tableSpec.worldScoped) item[tableSpec.worldGroupField ?? 'worldGroupId'] = input.worldGroupId ?? null
    else if (stamp === 'homeWorldGroupId' && tableSpec.homeWorldScoped) item.homeWorldGroupId = input.worldGroupId ?? null
    else if (stamp === 'createdAt' && item.createdAt == null) item.createdAt = now
    else if (stamp === 'updatedAt') item.updatedAt = now
  }
}

async function findExisting(
  projectId: number,
  tableSpec: TableSpec,
  item: Record<string, unknown>,
  adoption: CollectionAdoptionSpec,
): Promise<any | null> {
  if (adoption.identity === 'id' && item.id != null) return tableSpec.table.get(item.id as number)
  const candidates = await tableSpec.table.where('projectId').equals(projectId).toArray()
  return (candidates as any[]).find(row => identityMatches(row, item, adoption)) ?? null
}

function identityMatches(row: Record<string, unknown>, item: Record<string, unknown>, adoption: CollectionAdoptionSpec): boolean {
  if (adoption.identity === 'id') return row.id === item.id
  if (adoption.identity === 'name') return row.name === item.name
  return adoption.identity.fields.every(f => (row[f] ?? null) === (item[f] ?? null))
}

function identityValue(item: Record<string, unknown>, adoption: CollectionAdoptionSpec): unknown {
  if (adoption.identity === 'id') return item.id
  if (adoption.identity === 'name') return item.name
  return Object.fromEntries(adoption.identity.fields.map(f => [f, item[f] ?? null]))
}

function mergeByStrategy(
  existing: Record<string, unknown>,
  item: Record<string, unknown>,
  strategy: CollectionAdoptionSpec['mergeStrategy'],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(item)) {
    if (key === 'id' || key === 'projectId' || key === 'createdAt') continue
    if (value == null || value === '') continue
    const current = existing[key]
    if (strategy === 'append-text' && typeof current === 'string' && typeof value === 'string') {
      patch[key] = current ? `${current}\n\n${value}` : value
    } else if (strategy === 'union-array' && Array.isArray(current) && Array.isArray(value)) {
      patch[key] = Array.from(new Set([...current, ...value]))
    } else {
      patch[key] = value
    }
  }
  return patch
}
