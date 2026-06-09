/**
 * 注册表完整性校验(Phase 1.1a)
 *
 * 启动期调用 validateRegistry():
 *   - PROJECT_TABLES 与 Dexie 实例双向覆盖(漏登记/多登记立刻发现)
 *   - 所有 ref/remap 的 target 表名存在
 *
 * 不一致 → 开发期 throw,生产期 console.error(不阻断启动,避免误伤用户)。
 */
import { db } from '../db/schema'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from './project-tables'
import { FIELD_REGISTRY, FIELD_BY_TARGET } from './field-registry'
import { ADOPTION_SCHEMAS } from './adoption-schema'
import { CONTEXT_SOURCES } from './context-sources'

/** 解析 'tableName[field]' → tableName */
function parseTargetTable(target: string): string | null {
  const m = target.match(/^(\w+)\[/)
  return m ? m[1] : null
}

export interface RegistryValidationResult {
  ok: boolean
  errors: string[]
}

/** 纯函数校验(测试可直接调用,不依赖 throw) */
export function checkRegistry(): RegistryValidationResult {
  const errors: string[] = []

  const dexieNames = db.tables.map(t => t.name)
  const registryNames = PROJECT_TABLES.map(s => s.name)

  // 双向覆盖
  for (const n of dexieNames) {
    if (!registryNames.includes(n)) errors.push(`Dexie 表 "${n}" 未在 PROJECT_TABLES 登记`)
  }
  for (const n of registryNames) {
    if (!dexieNames.includes(n)) errors.push(`PROJECT_TABLES 登记了不存在的表 "${n}"`)
  }

  // ref / remap target 表名存在性
  for (const spec of PROJECT_TABLES) {
    for (const ref of spec.refs ?? []) {
      if (ref.kind === 'simple' || ref.kind === 'json') {
        const t = parseTargetTable(ref.target)
        if (t && !REGISTRY_BY_NAME.has(t)) {
          errors.push(`${spec.name}.refs 指向不存在的表: ${ref.target}`)
        }
      } else if (ref.kind === 'array') {
        if (!REGISTRY_BY_NAME.has(ref.itemTarget)) {
          errors.push(`${spec.name}.refs(array) itemTarget 不存在: ${ref.itemTarget}`)
        }
      } else if (ref.kind === 'indirect') {
        if (!REGISTRY_BY_NAME.has(ref.via.table)) {
          errors.push(`${spec.name}.refs(indirect) via.table 不存在: ${ref.via.table}`)
        }
      } else if (ref.kind === 'blob-owner') {
        if (!REGISTRY_BY_NAME.has(ref.ownerTable)) {
          errors.push(`${spec.name}.refs(blob-owner) ownerTable 不存在: ${ref.ownerTable}`)
        }
      }
    }
    for (const rm of spec.exportRemap ?? []) {
      if (!REGISTRY_BY_NAME.has(rm.remapVia)) {
        errors.push(`${spec.name}.exportRemap 指向不存在的表: ${rm.remapVia}`)
      }
    }
  }

  const fieldKeys = new Set<string>()
  for (const field of FIELD_REGISTRY) {
    if (!REGISTRY_BY_NAME.has(field.target)) {
      errors.push(`FIELD_REGISTRY 指向不存在的表: ${field.target}.${field.field}`)
    }
    const key = `${field.target}.${field.field}`
    if (fieldKeys.has(key)) errors.push(`FIELD_REGISTRY 字段重复登记: ${key}`)
    fieldKeys.add(key)
    if (field.type === 'enum' && (!field.enums || field.enums.length === 0)) {
      errors.push(`FIELD_REGISTRY enum 缺少枚举值: ${key}`)
    }
  }

  const adoptionTargets = new Set<string>()
  for (const schema of ADOPTION_SCHEMAS) {
    if (!REGISTRY_BY_NAME.has(schema.target)) {
      errors.push(`ADOPTION_SCHEMAS 指向不存在的表: ${schema.target}`)
    }
    if (adoptionTargets.has(schema.target)) {
      errors.push(`ADOPTION_SCHEMAS target 重复登记: ${schema.target}`)
    }
    adoptionTargets.add(schema.target)

    const fields = new Set((FIELD_BY_TARGET.get(schema.target) ?? []).map(f => f.field))
    if (fields.size === 0) {
      errors.push(`ADOPTION_SCHEMAS target 未在 FIELD_REGISTRY 登记字段: ${schema.target}`)
    }
    for (const req of schema.required) {
      if (!fields.has(req)) errors.push(`${schema.target}.required 字段未在 FIELD_REGISTRY 登记: ${req}`)
    }
    if (schema.identity === 'name' && !fields.has('name')) {
      errors.push(`${schema.target}.identity=name 但 FIELD_REGISTRY 未登记 name`)
    } else if (typeof schema.identity === 'object') {
      for (const f of schema.identity.fields) {
        if (!fields.has(f)) errors.push(`${schema.target}.identity 字段未在 FIELD_REGISTRY 登记: ${f}`)
      }
    }
    for (const fk of schema.fkChecks ?? []) {
      if (!fields.has(fk.field)) errors.push(`${schema.target}.fkChecks 字段未在 FIELD_REGISTRY 登记: ${fk.field}`)
      if (!REGISTRY_BY_NAME.has(fk.target)) errors.push(`${schema.target}.fkChecks 指向不存在的表: ${fk.target}`)
    }
    for (const arr of schema.arrayMemberChecks ?? []) {
      if (!fields.has(arr.field)) errors.push(`${schema.target}.arrayMemberChecks 字段未在 FIELD_REGISTRY 登记: ${arr.field}`)
      if (!REGISTRY_BY_NAME.has(arr.itemTarget)) errors.push(`${schema.target}.arrayMemberChecks 指向不存在的表: ${arr.itemTarget}`)
    }
  }

  const sourceKeys = new Set<string>()
  for (const source of CONTEXT_SOURCES) {
    if (sourceKeys.has(source.key)) errors.push(`CONTEXT_SOURCES key 重复登记: ${source.key}`)
    sourceKeys.add(source.key)
    if (source.scope === 'world' && !source.requiresWorldGroupId) {
      errors.push(`CONTEXT_SOURCES world source 必须显式要求 worldGroupId: ${source.key}`)
    }
    if (source.scope === 'node' && !source.requiresOutlineNodeId) {
      errors.push(`CONTEXT_SOURCES node source 必须显式要求 outlineNodeId/chapterId: ${source.key}`)
    }
    if (source.scope === 'chapter' && !source.requiresChapterId && source.key !== 'foreshadows') {
      errors.push(`CONTEXT_SOURCES chapter source 必须显式要求 chapterId: ${source.key}`)
    }
    if (source.budgetTokens <= 0) {
      errors.push(`CONTEXT_SOURCES budgetTokens 必须为正数: ${source.key}`)
    }
  }

  return { ok: errors.length === 0, errors }
}

/** 启动期调用 */
export function validateRegistry(opts?: { throwOnError?: boolean }): void {
  const result = checkRegistry()
  if (result.ok) return

  const msg = `[Registry] 注册表校验失败:\n  - ${result.errors.join('\n  - ')}`
  if (opts?.throwOnError) {
    throw new Error(msg)
  } else {
    console.error(msg)
  }
}
