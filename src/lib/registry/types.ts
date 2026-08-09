/**
 * 三注册表 · 共享类型定义(Phase 1.1a)
 *
 * 这里只定义类型,不含数据。数据在 project-tables.ts。
 * 设计依据:MASTER-BLUEPRINT.md §5.1(PROJECT_TABLES 强化版)。
 */
import type { Table } from 'dexie'
import type { AIProvider } from '../types/ai'
import type { ContextLayer, ContextSegment } from '../ai/context-budget'
import type { PreparedContinuityContext } from '../ai/chapter-memory/continuity-context'
import type { InspirationResultMode } from '../types/inspiration-workspace'
import type { RagSelectionTraceCollector } from '../types/rag-library'
import type { WorkspaceScope } from '../types/world-ownership'

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

/**
 * 世界引擎产品域的内容归属。
 *
 * 这不是第二套数据库生命周期注册表，而是 PROJECT_TABLES 上的产品投影元数据：
 * 世界工作台、完整度和发布预检都从同一份表登记派生，避免组件再次手写表清单。
 */
export type WorldDomainArea = 'foundation' | 'assets' | 'narrative' | 'structure' | 'runtime'
export type WorldReleaseSection = 'foundation' | 'characters' | 'narrative' | 'outline'

/** WORLD-2C product ownership, separate from the physical project lifecycle owner. */
export type DomainOwnerKind = 'workspace' | 'world' | 'work' | 'instance'

export type DomainOwnerLocator =
  | { kind: 'workspace' }
  | { kind: 'compat-project' }
  | { kind: 'field'; owner: DomainOwnerKind; field: string }
  | {
      kind: 'exclusive-fields'
      worldField: string
      workField: string
    }
  | {
      kind: 'parent'
      owner: DomainOwnerKind
      table: string
      field: string
    }

/**
 * Logical product owner for a table. `compat-project` means the table has been
 * classified but its legacy rows have not yet received explicit owner fields.
 */
export interface DomainOwnershipSpec {
  allowed: readonly DomainOwnerKind[]
  legacyDefault: DomainOwnerKind
  locator: DomainOwnerLocator
}

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
  /** 拥有此 blob 的父表名 */
  ownerTable: string
  /** 由父表行计算出 blob 主键(如 row => 100000 + row.id) */
  keyResolver: (ownerRow: unknown) => number | string
  onDelete: 'cascade'
}

export type RefSpec = SimpleRef | JsonRef | ArrayRef | IndirectRef | BlobOwnerRef

/** 导出时的 ID 重映射声明 */
export interface ExportRemapField {
  /** 字段名(库内真实外键字段) */
  field: string
  /** 重映射到哪张表的导出序号(如 'worldGroups' / 'outlineNodes') */
  remapVia: string
  /** 是否树形自引用(parentId) */
  selfTree?: boolean
  /**
   * 导出后该字段在 JSON 里的名字(历史命名,毫无规律,必须逐字段声明以逐字节兼容旧备份)。
   * 例:worldGroupId → '_worldGroupExportId'、outlineNodeId → '_outlineExportId'、
   *     fromCharacterId → '_fromCharacterIndex'。
   */
  exportAs: string
  /**
   * 该外键找不到映射时:
   * - 'drop'    丢弃整行(孤儿,如 characterRelations 端点角色已删)
   * - 'require' 导入时抛错并整体回滚(必填外键完整性保护,如 chapters.outlineNodeId)
   * - 'null' / 省略  置空(可空外键 / worldGroupId / 树 parentId)
   */
  onUnmapped?: 'drop' | 'require' | 'null'
}

/**
 * JSON 字段内引用的导出重映射(区别于 refs:refs 管删除级联,这里管导出/导入重映射)。
 * exportAs 是新增的便携影子字段；保留原字段保证旧版导出契约可读，新版导入优先用影子字段重映射。
 */
export type ExportRefRemap = {
  field: string
  remapVia: string
  kind: 'portals'
} | {
  field: string
  remapVia: string
  kind: 'id-array'
  exportAs: string
  storage?: 'array' | 'json-string'
} | {
  field: string
  remapVia: string
  kind: 'scene-character-ids'
  exportAs: string
} | {
  /** CharacterDrivenPlan.arcs JSON 内逐项 characterId 的便携影子数组。 */
  field: string
  remapVia: string
  kind: 'character-plan-arcs'
  exportAs: string
}

/**
 * Structured payloads whose embedded IDs or integrity hashes must participate
 * in the registry-derived backup lifecycle. These declarations prevent domain
 * JSON from silently bypassing normal exportRemap handling.
 */
export type PortableDataSpec = {
  kind: 'agent-run-root'
  contractField: string
  contractHashField: string
  dependencies: readonly string[]
} | {
  kind: 'agent-run-child'
  parentField: string
  contractHashField: string
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
  /**
   * 导入后必须改写为本行新主键的嵌套字段路径。
   * 例：chapters.continuityHandoff.chapterId。
   */
  selfIdPaths?: string[]
  /** worldGroupId 的字段名(默认 'worldGroupId') */
  worldGroupField?: string
  /** 是否带 homeWorldGroupId(仅 characters) */
  homeWorldScoped?: boolean
  /** 世界引擎产品投影域；同一表可同时属于多个域。 */
  worldDomains?: readonly WorldDomainArea[]
  /** WORLD-2C 逻辑归属；物理删除/导出根仍由 owner 表达。 */
  domainOwner?: DomainOwnershipSpec
  /** 树形(parentId 字段名) */
  tree?: { parentField: string }
  /** 外键/引用关系(删除级联用) */
  refs?: RefSpec[]
  /** 是否纳入 JSON 备份导出 */
  exportable: boolean
  /** PLATFORM-1：允许进入本地世界分享包；未显式登记的表默认禁止发布。 */
  communityShare?: 'world'
  /** WORLD-2E：发布选择 UI 的注册表派生分区；不得在组件手写表清单。 */
  releaseSection?: WorldReleaseSection
  /** 导出时需要的 ID 重映射 */
  exportRemap?: ExportRemapField[]
  /**
   * 导出时是否写显式 `_exportId` 字段(= 该行在导出数组里的下标)。
   * 被别的表用「_exportId 命名」引用的表要 true(worldGroups/outlineNodes/worldNodes/
   * references/importantLocations/codexCategories);用「数组下标隐式索引」的表(characters/
   * chapters)留空。
   */
  exportIdField?: boolean
  /** 导出查询排序字段(仅 worldGroups: 'order',保证导出序稳定 = 世界组重映射依据) */
  exportOrderBy?: string
  /** JSON 字段内引用的导出/导入重映射(仅 worldNodes.portalsJSON) */
  exportRefRemap?: ExportRefRemap[]
  /** Embedded structured data / integrity rebind behavior during export/import. */
  portableData?: PortableDataSpec
  /**
   * 导入兜底默认值：声明该表"非可选字段"在缺失时的默认值。
   * 导入引擎写入前做 `{ ...defaults, ...row }`,保证老数据/跨版本导入的 JSON
   * 即使缺某个非可选字段,落库时也满足类型不变量(如 outlineNodes.summary 恒为 string)。
   * 这是「数据进入边界统一兜底」的单一来源,避免在每个读取处散补 `?.`。
   */
  defaults?: Record<string, unknown>
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
  type: 'string' | 'longtext' | 'json' | 'object' | 'number' | 'boolean' | 'enum' | 'array'
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
  /** 只允许通过 recordId 定点更新，禁止 AI 新增集合行。 */
  recordOnly?: boolean
  duplicatePolicy: 'skip' | 'update' | 'merge' | 'error'
  /** 必填字段;缺失则跳过该条 */
  required: string[]
  /** 自动盖章字段 */
  autoStamps: ('projectId' | 'worldId' | 'workId' | 'worldGroupId' | 'homeWorldGroupId' | 'createdAt' | 'updatedAt')[]
  /** Owner selected from the trusted WorkspaceScope, never from AI output. */
  ownerFrom?: Exclude<DomainOwnerKind, 'instance'>
  /** FK 校验:写入前检查字段引用是否存在 */
  fkChecks?: { field: string; target: string }[]
  /** 数组成员校验:过滤不存在的成员,并记录 fkErrors */
  arrayMemberChecks?: { field: string; itemTarget: string }[]
  mergeStrategy?: 'overwrite-non-empty' | 'append-text' | 'union-array'
  /** 允许统一写回入口按这些字段清空旧集合，再写入新结果。 */
  replaceScope?: string[]
}

/**
 * 不适合通用 FIELD_REGISTRY/adopt() 语义的领域写回扩展。
 * 扩展必须声明自己的策略注册表和唯一入口，禁止演变成平行通用写回层。
 */
export interface AdoptionExtensionSpec {
  id: string
  target: string
  entrypoints: string[]
  policyRegistry: string
  reason: string
  /** 到期后 CI 必须重新审查，而不是让例外永久沉积。ISO 日期。 */
  reviewAfter: string
}

export interface AdoptInput {
  projectId: number
  /** WORLD-2C C3: explicit logical read/write boundary. projectId remains a legacy adapter. */
  scope?: WorkspaceScope
  worldGroupId?: number | null
  /** 集合表中定点更新既有记录；AI 补全空卷/空章等场景使用。 */
  recordId?: number
  /**
   * NS-1: chapters 派生记忆的原子 compare-and-set。
   * adopt() 必须在写 summary/handoff 的同一事务中重算当前正文 hash。
   */
  compareAndSet?: {
    kind: 'chapter-source-text-hash'
    expectedHash: string
    textNormalizationVersion: string
  }
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

export type ContextSourceScope = 'project' | 'world' | 'node' | 'chapter' | 'manual' | 'runtime'

export type ContextCompressionFallbackV1 = 'none' | 'full-source' | 'deterministic-truncation'

/**
 * Durable-safe proof for one semantic compression decision. It intentionally
 * stores hashes/counts only; Canon source text remains in its registered table.
 */
export interface ContextCompressionEvidenceV1 {
  version: 1
  promptVersion: 'agent-context-compression-v1'
  outcome: 'verified' | 'fallback'
  fallback: ContextCompressionFallbackV1
  sourceHash: string
  artifactHash?: string
  attempts: number
  targetTokens: number
  requiredAnchorCount: number
  coveredAnchorCount: number
  failureCode?: string
}

export interface ContextSourceTransformInput {
  source: Pick<ContextSource, 'key' | 'label' | 'layer' | 'budgetTokens' | 'protectedFromTrim'>
  content: string
  originalTokens: number
  sourceBudgetTokens: number
  inputBudgetTokens: number
}

export interface ContextSourceTransformResult {
  /** Omit to retain assembleContext's deterministic truncation fallback. */
  content?: string
  delivery?: 'full' | 'compressed'
  /** Only the verified full-source fallback may exceed the registered soft cap. */
  allowSourceBudgetOverflow?: boolean
  compression: ContextCompressionEvidenceV1
}

export type ContextSourceTransformer = (
  input: ContextSourceTransformInput,
) => Promise<ContextSourceTransformResult | undefined>

export interface AssembleContextInput {
  projectId: number
  /** WORLD-2C C3: explicit logical read boundary. projectId remains a legacy adapter. */
  scope?: WorkspaceScope
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
  /** 调用方的领域级输入上限；与模型窗口取较小值，不覆盖测试用精确预算。 */
  inputBudgetMaxTokens?: number
  /** 调用方只能按比例收窄每个登记源的软上限，不能放大或绕过注册表。 */
  sourceBudgetScale?: number
  /** HARNESS-16: registered-reader output may be transformed before source capping. */
  sourceTransformer?: ContextSourceTransformer
  citedReferenceIds?: number[]
  previousChapterEnding?: string
  stateReferenceText?: string
  extraStateIds?: number[]
  /** 手动输入/当前字段内容，供“内容反推结构化设定”类动作走注册表。 */
  manualSourceText?: string
  /** HARNESS-11: 同一批量章纲任务中，上一卷尚未采纳的结构化候选。 */
  priorOutlineCandidateText?: string
  /** C2 反向哺喂：以某角色为主体，召回剧情里关于 TA 的事实/正文证据（characterFacts/characterPassages 源用）。 */
  subjectCharacterName?: string
  /** INV-1: 按角色过滤物品流水/持有投影。 */
  characterId?: number | null
  /** SIM-1C: 冻结运行时会话，供 NPC 演进候选只读上下文使用。 */
  simulationSessionId?: number
  /** CM-1: 本次明确参与增量融合的碎片；由 inspirationWorkspace source 读取。 */
  inspirationFragmentIds?: string[]
  /** CM-1: 单世界与多世界各自维护最近确认版本。 */
  inspirationMode?: InspirationResultMode
  /** STORY-1: 角色驱动规划 Skill 明确冻结的方案；缺省时仍读取作者激活的下游参考方案。 */
  characterDrivenPlanId?: number
  /** AGENT-1: 本地确定性项目搜索；只由 searchResults 上下文源消费。 */
  searchQuery?: string
  /** AGENT-1: 搜索最多返回 10 条短摘。 */
  searchLimit?: number
  /** AGENT-1: 搜索限定的数据类型。 */
  searchKinds?: string[]
  /** RAG-1: 节点/Agent 明确选择的稳定资料字段键。 */
  ragEntryKeys?: string[]
  /** RAG-1 内部执行证据收集器；调用结束后由节点运行快照冻结。 */
  ragSelectionTrace?: RagSelectionTraceCollector
  /** assembleContext 内部批量预取；调用方无需传。 */
  continuitySnapshot?: PreparedContinuityContext
}

export interface ContextSource {
  key: string
  label: string
  scope: ContextSourceScope
  layer: ContextLayer
  /** Logical owner resolved before the registered reader runs. */
  ownerFrom?: DomainOwnerKind
  /** Approximate per-source soft cap. Adapters can still return less. */
  budgetTokens: number
  /** NS-1: assembleContext 总预算裁剪时不得整段删除。 */
  protectedFromTrim?: boolean
  /** Source can use a caller-provided continuity snapshot without reading a Chapter row. */
  acceptsDetachedContinuitySnapshot?: boolean
  requiresWorldGroupId?: boolean
  requiresSimulationSessionId?: boolean
  requiresOutlineNodeId?: boolean
  requiresChapterId?: boolean
  /** 规划尚未创建正文 Chapter 时，允许用 outlineNodeId 作为规范章序边界。 */
  acceptsOutlineNodeAsChapterBoundary?: boolean
  enabled?: (input: AssembleContextInput) => boolean | Promise<boolean>
  read: (input: AssembleContextInput) => Promise<string>
}

export type AssembleContextSourceStatus = 'included' | 'omitted' | 'trimmed'
export type AssembleContextSourceDelivery = 'full' | 'compressed' | 'truncated' | 'none'

/**
 * Per-source delivery evidence derived by assembleContext(). It records only
 * token counts and delivery state; source text remains in segments/business tables.
 */
export interface AssembleContextSourceEvidence {
  key: string
  status: AssembleContextSourceStatus
  delivery: AssembleContextSourceDelivery
  /** SHA-256 of the registered reader's complete raw output before compression or truncation. */
  sourceHash?: string
  /** Tokens returned by the registered reader before its source budget was applied. */
  originalTokens: number
  /** Tokens actually delivered to the model. Zero for omitted/trimmed sources. */
  inputTokens: number
  /** Optional for sources processed by the HARNESS-16 semantic compression policy. */
  compression?: ContextCompressionEvidenceV1
}

export interface AssembleContextResult {
  text: string
  segments: ContextSegment[]
  included: string[]
  omitted: string[]
  trimmed: string[]
  /** Optional for historical/test fixtures; production assembleContext always supplies it. */
  sourceEvidence?: AssembleContextSourceEvidence[]
  totalInputTokens: number
  inputBudget: number
  overBudgetBeforeTrim: boolean
  overBudgetAfterTrim: boolean
}
