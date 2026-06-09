/**
 * 三注册表 · 共享类型定义(Phase 1.1a)
 *
 * 这里只定义类型,不含数据。数据在 project-tables.ts。
 * 设计依据:MASTER-BLUEPRINT.md §5.1(PROJECT_TABLES 强化版)。
 */
import type { Table } from 'dexie'
import type { AIProvider } from '../types/ai'
import type { ContextLayer, ContextSegment } from '../ai/context-budget'

/**
 * 表的归属方式 —— 决定删项目时如何定位该表的记录。
 */
export type TableOwner =
  | 'project'      // 直接有 projectId 字段(绝大多数)
  | 'direct-child' // 通过另一张表的 id 间接归属(如 referenceChunkAnalysis.referenceId)
  | 'indirect'     // 通过非直接外键间接归属(如 importLogs.sessionId → importSessions.projectId)
  | 'transient'    // 临时态(与项目同生命周期,但不导出)
  | 'blob'         // Blob 存储,特殊 owner(如 importFiles 复用为 master blob)
  | 'global'       // 全局(不绑项目,不参与 deleteProject 级联)

/** 简单外键引用(table[field] 形式) */
export interface SimpleRef {
  kind: 'simple'
  field: string
  /** 'tableName[fieldName]' —— 指向哪张表的哪个字段被本表引用 */
  target: string
  onDelete: 'cascade' | 'setNull' | 'keep'
}

/** JSON 字段内的引用(如 detailedOutlines.scenes 里嵌套的 characterIds) */
export interface JsonRef {
  kind: 'json'
  field: string      // 存 JSON 的字段名
  jsonPath: string   // 简化 path,如 '$.characterId' 或 '$[].characterIds[]'
  target: string     // 'tableName[fieldName]'
  onDelete: 'cascade' | 'setNull' | 'keep' | 'remap'
}

/** 数组字段内的多引用(字段本身就是 number[]) */
export interface ArrayRef {
  kind: 'array'
  field: string       // 数组字段名(或 JSON 数组字符串字段名)
  itemTarget: string  // 数组元素指向哪张表
  onDelete: 'removeItem' | 'setNullItem' | 'keep'
}

/** 间接归属(本表没有 projectId,通过另一张表的字段间接挂项目) */
export interface IndirectRef {
  kind: 'indirect'
  via: {
    /** 间接父表名 */
    table: string
    /** 本表用哪个字段关联父表主键 */
    field: string
    /** 父表用什么字段解析到 projectId(通常就是 'projectId') */
    resolveProject: string
  }
  onDelete: 'cascade'
}

/** Blob owner(blob 表用特殊 key 计算复用,如 importFiles 给 master 用 100000+workId) */
export interface BlobOwnerRef {
  kind: 'blob-owner'
  /** 拥有此 blob 的父表名(如 masterWorks) */
  ownerTable: string
  /** 由父表行计算出 blob 主键(如 row => 100000 + row.id) */
  keyResolver: (ownerRow: unknown) => number | string
  onDelete: 'cascade'
}

export type RefSpec = SimpleRef | JsonRef | ArrayRef | IndirectRef | BlobOwnerRef

/** 导出时的 ID 重映射声明 */
export interface ExportRemapField {
  /** 字段名 */
  field: string
  /** 重映射到哪张表的 _exportId(如 'worldGroups' / 'outlineNodes') */
  remapVia: string
  /** 是否树形自引用(parentId) */
  selfTree?: boolean
}

/**
 * 单张表的元信息。
 */
export interface TableSpec<T = any> {
  /** Dexie 表对象(可直接操作) */
  table: Table<T, number>
  /** 表名(与 db 实例属性名一致) */
  name: string
  /** 归属方式 */
  owner: TableOwner
  /** owner!=='project' 时如何解析到 projectId(可选,删项目用) */
  projectResolver?: (projectId: number) => Promise<number[]>
  /** 是否带 worldGroupId(参与多世界隔离/盖章/删世界级联) */
  worldScoped?: boolean
  /** worldGroupId 的字段名(默认 'worldGroupId') */
  worldGroupField?: string
  /** 是否带 homeWorldGroupId(仅 characters) */
  homeWorldScoped?: boolean
  /** 树形(parentId 字段名) */
  tree?: { parentField: string }
  /** 外键/引用关系(删除级联用) */
  refs?: RefSpec[]
  /** 是否纳入 JSON 备份导出 */
  exportable: boolean
  /** 导出时需要的 ID 重映射 */
  exportRemap?: ExportRemapField[]
  /** 备注(说明为什么这样配) */
  note?: string
}

/**
 * FIELD_REGISTRY 字段定义(Phase 1.2a)。
 *
 * 只描述 AI/结构化采纳允许写入的字段。调用方给出的别名字段会在 adopt()
 * 里归一成这里登记的 canonical field。
 */
export interface FieldSpec {
  /** 目标表名,必须存在于 PROJECT_TABLES */
  target: string
  /** canonical 字段名 */
  field: string
  type: 'string' | 'longtext' | 'json' | 'number' | 'boolean' | 'enum' | 'array'
  enums?: string[]
  worldScoped?: boolean
  aliases?: string[]
  sanitize?: (val: unknown) => unknown
  label?: string
  /** 中文/别名枚举归一,如 主角 -> protagonist */
  enumAliasMap?: Record<string, string>
}

export interface CompositeIdentity {
  kind: 'composite'
  fields: string[]
}

export interface CollectionAdoptionSpec {
  /** 集合目标表名 */
  target: string
  /** 唯一键策略(去重定位) */
  identity: 'id' | 'name' | CompositeIdentity
  duplicatePolicy: 'skip' | 'update' | 'merge' | 'error'
  /** 必填字段;缺失则跳过该条 */
  required: string[]
  /** 自动盖章字段 */
  autoStamps: ('projectId' | 'worldGroupId' | 'homeWorldGroupId' | 'createdAt' | 'updatedAt')[]
  /** FK 校验:写入前检查字段引用是否存在 */
  fkChecks?: { field: string; target: string }[]
  /** 数组成员校验:过滤不存在的成员,并记录 fkErrors */
  arrayMemberChecks?: { field: string; itemTarget: string }[]
  mergeStrategy?: 'overwrite-non-empty' | 'append-text' | 'union-array'
}

export interface AdoptInput {
  projectId: number
  worldGroupId?: number | null
  target: string
  data: Record<string, unknown> | Record<string, unknown>[]
  mode: 'replace' | 'append' | 'add' | 'add-many' | 'merge-diffs'
}

export interface AdoptResult {
  written: { id: number; fields: string[] }[]
  aliasMapped: { from: string; to: string }[]
  unknown: string[]
  typeErrors: { field: string; expected: string; got: string }[]
  fkErrors: { field: string; refValue: unknown }[]
  skipped: { reason: string; data: unknown }[]
}

export type ContextSourceScope = 'project' | 'world' | 'node' | 'chapter' | 'manual'

export interface AssembleContextInput {
  projectId: number
  /** Explicit world target. null is a valid explicit single-world/global target. */
  worldGroupId?: number | null
  outlineNodeId?: number | null
  chapterId?: number | null
  currentChapterOrder?: number
  sourceKeys?: string[]
  provider?: AIProvider
  model?: string
  /** Test/override hook. When set, this is the real input budget used for trimming. */
  inputBudgetTokens?: number
  citedReferenceIds?: number[]
  masterInsightIds?: number[]
  previousChapterEnding?: string
  stateReferenceText?: string
  extraStateIds?: number[]
}

export interface ContextSource {
  key: string
  label: string
  scope: ContextSourceScope
  layer: ContextLayer
  /** Approximate per-source soft cap. Adapters can still return less. */
  budgetTokens: number
  requiresWorldGroupId?: boolean
  requiresOutlineNodeId?: boolean
  requiresChapterId?: boolean
  enabled?: (input: AssembleContextInput) => boolean | Promise<boolean>
  read: (input: AssembleContextInput) => Promise<string>
}

export interface AssembleContextResult {
  text: string
  segments: ContextSegment[]
  included: string[]
  omitted: string[]
  trimmed: string[]
  totalInputTokens: number
  inputBudget: number
  overBudgetBeforeTrim: boolean
}
