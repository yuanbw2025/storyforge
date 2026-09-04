/**
 * 当前三注册表完整性校验。启动时双向核对 PROJECT_TABLES、
 * FIELD_REGISTRY、Adoption Schema 与 CONTEXT_SOURCES；任何不一致都必须阻断应用启动。
 */
import { db } from '../db/schema'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from './project-tables'
import { FIELD_REGISTRY, FIELD_BY_TARGET } from './field-registry'
import { ADOPTION_EXTENSIONS, ADOPTION_SCHEMAS } from './adoption-schema'
import { CONTEXT_SOURCES } from './context-sources'
import { CONTEXT_RESOURCE_KINDS_V1 } from './types'

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
    if (spec.resourceIdentity) {
      if (!CONTEXT_RESOURCE_KINDS_V1.includes(spec.resourceIdentity.contextKind)) {
        errors.push(`${spec.name}.resourceIdentity.contextKind 未登记: ${spec.resourceIdentity.contextKind}`)
      }
      if (!spec.resourceIdentity.label.trim()) {
        errors.push(`${spec.name}.resourceIdentity.label 不能为空`)
      }
      if (spec.resourceIdentity.descriptorMode === 'registered-fields'
        && !(FIELD_BY_TARGET.get(spec.name)?.length)) {
        errors.push(`${spec.name}.resourceIdentity 要求 registered-fields，但 FIELD_REGISTRY 无字段`)
      }
    }
    if (spec.owner !== 'global' && !spec.domainOwner) {
      errors.push(`${spec.name}.domainOwner 未登记逻辑归属`)
    }
    if (spec.domainOwner) {
      const { allowed, defaultOwner, locator } = spec.domainOwner
      if (allowed.length === 0) errors.push(`${spec.name}.domainOwner.allowed 不能为空`)
      if (new Set(allowed).size !== allowed.length) {
        errors.push(`${spec.name}.domainOwner.allowed 存在重复 owner`)
      }
      if (!allowed.includes(defaultOwner)) {
        errors.push(`${spec.name}.domainOwner.defaultOwner 不在 allowed 中`)
      }
      if (spec.worldSemantic && defaultOwner === 'workspace') {
        errors.push(`${spec.name}.worldSemantic 不能默认归属 workspace`)
      }
      if (spec.worldSemantic?.canonPolicy === 'confirmed-rows-only'
        && (!spec.worldSemantic.statusField || !spec.worldSemantic.confirmedStatusValues?.length)) {
        errors.push(`${spec.name}.worldSemantic confirmed-rows-only 缺少状态字段/允许值`)
      }
      if (locator.kind === 'workspace' && !allowed.includes('workspace')) {
        errors.push(`${spec.name}.domainOwner workspace locator 未允许 workspace`)
      } else if (locator.kind === 'field' && !allowed.includes(locator.owner)) {
        errors.push(`${spec.name}.domainOwner field owner 未在 allowed 中: ${locator.owner}`)
      } else if (locator.kind === 'exclusive-fields'
        && (!allowed.includes('world') || !allowed.includes('work'))) {
        errors.push(`${spec.name}.domainOwner exclusive-fields 必须同时允许 world/work`)
      } else if (locator.kind === 'exclusive-work-instance'
        && (!allowed.includes('work') || !allowed.includes('instance'))) {
        errors.push(`${spec.name}.domainOwner exclusive-work-instance 必须同时允许 work/instance`)
      } else if (locator.kind === 'parent') {
        if (!REGISTRY_BY_NAME.has(locator.table)) {
          errors.push(`${spec.name}.domainOwner parent 指向不存在的表: ${locator.table}`)
        }
        if (locator.owner !== 'inherit' && !allowed.includes(locator.owner)) {
          errors.push(`${spec.name}.domainOwner parent owner 未在 allowed 中: ${locator.owner}`)
        }
      }
    }

    for (const ref of spec.refs ?? []) {
      if (ref.kind === 'simple' || ref.kind === 'json') {
        if (ref.kind === 'simple' && ref.field !== 'id') {
          errors.push(`${spec.name}.refs(simple) 必须从父表 id 指向依赖表外键，禁止反向登记: ${ref.field} -> ${ref.target}`)
        }
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
      if (rm.deferred && (rm.selfTree || rm.onUnmapped === 'drop' || rm.onUnmapped === 'require')) {
        errors.push(`${spec.name}.exportRemap deferred 只允许可空的非树引用: ${rm.field}`)
      }
    }
  }

  const fieldKeys = new Set<string>()
  const candidateIds = new Set<string>()
  const generatableFieldsByDomain = new Map<string, Set<string>>()
  for (const field of FIELD_REGISTRY.filter(item => item.aiGeneration)) {
    const domain = field.aiGeneration!.domain
    const fields = generatableFieldsByDomain.get(domain) ?? new Set<string>()
    fields.add(field.field)
    generatableFieldsByDomain.set(domain, fields)
  }
  for (const field of FIELD_REGISTRY) {
    if (!REGISTRY_BY_NAME.has(field.target)) {
      errors.push(`FIELD_REGISTRY 指向不存在的表: ${field.target}.${field.field}`)
    }
    const key = `${field.target}.${field.field}`
    if (fieldKeys.has(key)) errors.push(`FIELD_REGISTRY 字段重复登记: ${key}`)
    fieldKeys.add(key)
    if (field.candidateId) {
      if (candidateIds.has(field.candidateId)) errors.push(`FIELD_REGISTRY candidateId 重复登记: ${field.candidateId}`)
      candidateIds.add(field.candidateId)
    }
    if (field.type === 'enum' && (!field.enums || field.enums.length === 0)) {
      errors.push(`FIELD_REGISTRY enum 缺少枚举值: ${key}`)
    }
    if (field.aiGeneration) {
      const capability = field.aiGeneration
      const expectedTarget = capability.domain === 'worldview-foundation' ? 'worldviews' : 'storyCores'
      if (field.target !== expectedTarget) {
        errors.push(`FIELD_REGISTRY ${capability.domain} 生成能力挂载到错误目标: ${key}`)
      }
      if (!capability.label.trim() || !capability.outputSchemaId.trim() || capability.maxChars < 2) {
        errors.push(`FIELD_REGISTRY 生成能力 label/schema/maxChars 无效: ${key}`)
      }
      if (capability.kind === 'text' && !['string', 'longtext'].includes(field.type)) {
        errors.push(`FIELD_REGISTRY 生成能力 kind=text 但字段不是文本: ${key}`)
      }
      if (capability.kind !== 'text' && field.type !== 'object') {
        errors.push(`FIELD_REGISTRY 生成能力 kind=${capability.kind} 但字段不是 object: ${key}`)
      }
      if (!capability.modes.length || new Set(capability.modes).size !== capability.modes.length) {
        errors.push(`FIELD_REGISTRY 生成能力 modes 为空或重复: ${key}`)
      }
      for (const dependency of capability.directDependencies) {
        if (dependency === field.field || !generatableFieldsByDomain.get(capability.domain)?.has(dependency)) {
          errors.push(`FIELD_REGISTRY 生成能力直接依赖无效: ${key} -> ${dependency}`)
        }
      }
    }
  }

  for (const domain of generatableFieldsByDomain.keys()) {
    const dependencyGraph = new Map(FIELD_REGISTRY
      .filter(field => field.aiGeneration?.domain === domain)
      .map(field => [field.field, [...field.aiGeneration!.directDependencies]]))
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (field: string): void => {
      if (visiting.has(field)) {
        errors.push(`FIELD_REGISTRY ${domain} 生成能力依赖成环: ${field}`)
        return
      }
      if (visited.has(field)) return
      visiting.add(field)
      for (const dependency of dependencyGraph.get(field) ?? []) visit(dependency)
      visiting.delete(field)
      visited.add(field)
    }
    for (const field of dependencyGraph.keys()) visit(field)
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
    for (const scopeField of schema.replaceScope ?? []) {
      if (!fields.has(scopeField)) errors.push(`${schema.target}.replaceScope 字段未在 FIELD_REGISTRY 登记: ${scopeField}`)
    }
  }

  const extensionIds = new Set<string>()
  const extensionTargets = new Set<string>()
  for (const extension of ADOPTION_EXTENSIONS) {
    if (extensionIds.has(extension.id)) errors.push(`ADOPTION_EXTENSIONS id 重复登记: ${extension.id}`)
    if (extensionTargets.has(extension.target)) errors.push(`ADOPTION_EXTENSIONS target 重复登记: ${extension.target}`)
    extensionIds.add(extension.id)
    extensionTargets.add(extension.target)
    if (!REGISTRY_BY_NAME.has(extension.target)) {
      errors.push(`ADOPTION_EXTENSIONS 指向不存在的表: ${extension.target}`)
    }
    if (!extension.entrypoints.length) errors.push(`ADOPTION_EXTENSIONS 缺少入口: ${extension.id}`)
    if (!extension.policyRegistry.trim()) errors.push(`ADOPTION_EXTENSIONS 缺少领域策略注册表: ${extension.id}`)
    if (!extension.reason.trim()) errors.push(`ADOPTION_EXTENSIONS 缺少例外理由: ${extension.id}`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(extension.reviewAfter)) {
      errors.push(`ADOPTION_EXTENSIONS reviewAfter 不是 ISO 日期: ${extension.id}`)
    }
  }

  const sourceKeys = new Set<string>()
  const providerIds = new Set<string>()
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
    if (source.scope !== 'manual' && !source.ownerFrom) {
      errors.push(`CONTEXT_SOURCES 必须登记 ownerFrom: ${source.key}`)
    }
    if (source.budgetTokens <= 0) {
      errors.push(`CONTEXT_SOURCES budgetTokens 必须为正数: ${source.key}`)
    }
    if (source.resources) {
      const provider = source.resources
      if (providerIds.has(provider.providerId)) {
        errors.push(`CONTEXT_SOURCES resource providerId 重复: ${provider.providerId}`)
      }
      providerIds.add(provider.providerId)
      if (!provider.providerVersion.trim() || !provider.normalizationVersion.trim()) {
        errors.push(`CONTEXT_SOURCES resource provider 缺版本: ${source.key}`)
      }
      if (!provider.kinds.length) errors.push(`CONTEXT_SOURCES resource provider kinds 不能为空: ${source.key}`)
      for (const kind of provider.kinds) {
        if (!CONTEXT_RESOURCE_KINDS_V1.includes(kind)) {
          errors.push(`CONTEXT_SOURCES resource provider kind 未登记: ${source.key}.${kind}`)
        }
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

/** 启动期硬门。 */
export function validateRegistry(): void {
  const result = checkRegistry()
  if (result.ok) return

  const msg = `[Registry] 注册表校验失败:\n  - ${result.errors.join('\n  - ')}`
  throw new Error(msg)
}
