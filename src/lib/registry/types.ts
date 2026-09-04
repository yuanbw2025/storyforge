/** 三注册表的当前共享类型；实际表数据只在 project-tables.ts 登记。 */
import type { Table } from 'dexie'
import type { AIProvider } from '../types/ai'
import type { ContextLayer, ContextSegment } from '../ai/context-budget'
import type { PreparedContinuityContext } from '../ai/chapter-memory/continuity-context'
import type { InspirationResultMode } from '../types/inspiration-workspace'
import type { RagSelectionTraceCollector } from '../types/rag-library'
import type { WorkspaceScope } from '../types/world-ownership'
import type {
  ExactRunArtifactKindV1,
  WorkspaceDocumentCodecV1,
  WorkspaceDocumentEditPolicyV1,
} from '../types/memory-engineering'

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
export type WorldReleaseSection = 'foundation' | 'characters' | 'narrative' | 'outline'

/** ARCH-02/07A: semantic capabilities a frozen world may actually own. */
export const WORLD_CAPABILITY_AREAS = [
  'foundation',
  'story',
  'characters',
  'relations',
  'entities',
  'storylines',
  'outline',
  'detailed-outline',
  'manuscript',
  'multi-world',
] as const

export type WorldCapabilityArea = typeof WORLD_CAPABILITY_AREAS[number]

export interface WorldSemanticResourceSpec {
  version: 1
  area: WorldCapabilityArea
  /** Stable logical resource kind exposed by the neutral release gateway. */
  resourceKind: string
  /** Canon rows only; candidate/derived/runtime rows need a different owner. */
  canonPolicy: 'authoritative-table' | 'confirmed-rows-only'
  statusField?: string
  confirmedStatusValues?: readonly string[]
}

/** WORLD-2C product ownership, separate from the physical project lifecycle owner. */
export type DomainOwnerKind = 'workspace' | 'world' | 'work' | 'instance'

export type DomainOwnerLocator =
  | { kind: 'workspace' }
  | { kind: 'field'; owner: DomainOwnerKind; field: string }
  | {
      kind: 'exclusive-fields'
      worldField: string
      workField: string
    }
  | {
      /** A durable record is owned by exactly one Work or one runtime instance. */
      kind: 'exclusive-work-instance'
      workField: string
      instanceField: string
    }
  | {
      kind: 'parent'
      /** `inherit` means the child follows whichever owner the parent resolves to. */
      owner: DomainOwnerKind | 'inherit'
      table: string
      field: string
    }

/**
 * Logical product owner for a table. Every current row must resolve through
 * one explicit locator; malformed or ownerless rows are rejected before entering this layer.
 */
export interface DomainOwnershipSpec {
  allowed: readonly DomainOwnerKind[]
  defaultOwner: DomainOwnerKind
  locator: DomainOwnerLocator
}

export type WorkspaceProjectionClassificationV1 =
  | 'editable'
  | 'evidence'
  | 'derived-none'
  | 'not-applicable'

export interface WorkspaceMemoryClassificationV1 {
  version: 1
  classification: WorkspaceProjectionClassificationV1
  mirrorPolicy: 'editable-document' | 'recovery-evidence' | 'rebuild-or-local-only' | 'excluded-global'
  reason: string
}

/**
 * MEMORY-2 disk projection metadata. It extends PROJECT_TABLES instead of
 * introducing a fourth domain registry. Mapper ids resolve to pure codecs.
 */
export interface WorkspaceProjectionSpecV1 {
  version: 1
  classification: WorkspaceProjectionClassificationV1
  documentKind: string
  mapper:
    | 'workspace-root-v1'
    | 'world-root-v1'
    | 'work-root-v1'
    | 'chapter-markdown-v1'
    | 'work-semantic-v1'
  codec: WorkspaceDocumentCodecV1
  editPolicy: WorkspaceDocumentEditPolicyV1
  scopeOwner: 'workspace' | 'world' | 'work'
  dependencyEmitter:
    | 'workspace-root-impact-v1'
    | 'world-root-impact-v1'
    | 'work-root-impact-v1'
    | 'chapter-impact-v1'
    | 'work-semantic-impact-v1'
  schemaVersion: 1
}

/**
 * 简单反向引用(table[field] 形式)。注册在被引用的父表上：field 是父表
 * 主键字段，target 是持有外键的依赖表字段。生命周期据此从父记录派生
 * cascade/setNull，禁止把“子表外键 -> 父表主键”倒着登记。
 */
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
   * 可空反向引用允许先导入当前行、最后统一回填，用于解除两个内容表之间
   * 合法的可空拓扑环。必填或 onUnmapped=drop 的引用不得设为 deferred。
   */
  deferred?: true
  /** 当前便携协议中的外键坐标字段名。 */
  exportAs: string
  /**
   * 该外键找不到映射时:
   * - 'drop'    丢弃整行(孤儿,如 characterRelations 端点角色已删)
   * - 'require' 导入时抛错并整体回滚(必填外键完整性保护,如 chapters.outlineNodeId)
   * - 'null' / 省略  置空(可空外键 / worldGroupId / 树 parentId)
   */
  onUnmapped?: 'drop' | 'require' | 'null'
  /**
   * Optional cyclic pointer patched after every table is imported. Use only
   * to break an intentional parent/current-child cycle; ordinary refs still
   * participate in topological ordering so source-missing policies remain
   * accurate during the first pass.
   */
  deferImport?: true
}

/**
 * JSON 字段内引用的导出重映射(区别于 refs:refs 管删除级联,这里管导出/导入重映射)。
 * exportAs 是当前便携协议的稳定影子坐标；导入时只用该坐标重映射。
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
  /** Object-array field containing one optional numeric reference per item. */
  field: string
  remapVia: string
  kind: 'object-array-id'
  exportAs: string
  itemField: string
  storage?: 'array' | 'json-string'
} | {
  /** JSON object paths containing one local foreign key each. */
  field: string
  remapVia: string
  kind: 'json-id-paths'
  paths: readonly string[]
  exportAs: string
  onUnmapped?: 'require' | 'null'
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
} | {
  /** CTXG-2 immutable UTF-8 body or a verified evidence-pruned tombstone. */
  kind: 'exact-run-artifact'
} | {
  /** Content-addressed media object exported as verified inline binary. */
  kind: 'shared-media-object'
  dataField: string
  hashField: string
  sizeField: string
  mimeField: string
  backendField: string
  stateField: string
  pathField: string
  leaseOwnerField: string
  leaseExpiresAtField: string
  lastVerifiedAtField: string
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
  /** ARCH-02: explicit allow-list for immutable semantic WorldRelease content. */
  worldSemantic?: WorldSemanticResourceSpec
  /** WORLD-2C 逻辑归属；物理删除/导出根仍由 owner 表达。 */
  domainOwner?: DomainOwnershipSpec
  /** MEMORY-2 人工可编辑工作区投影；未登记即禁止落盘。 */
  workspaceProjection?: WorkspaceProjectionSpecV1
  /**
   * CTXG-2 portable resource identity. This remains PROJECT_TABLES metadata so
   * creation, backfill, export/import and Gateway catalog cannot drift into a
   * fourth hand-written table list.
   */
  resourceIdentity?: {
    version: 1
    field: 'ragDocumentId'
    resourceKind: string
    /** Context Gateway catalog metadata remains on this registry entry. */
    contextKind: ContextResourceKind
    label: string
    /** registered-fields follows FIELD_REGISTRY; semantic-fields derives safe row fields. */
    descriptorMode: 'registered-fields' | 'semantic-fields'
  }
  /** MEMORY-10: every table receives one registry-derived disk-memory policy. */
  memoryClassification: WorkspaceMemoryClassificationV1
  /** 树形(parentId 字段名) */
  tree?: { parentField: string }
  /** 外键/引用关系(删除级联用) */
  refs?: RefSpec[]
  /** 是否纳入 JSON 备份导出 */
  exportable: boolean
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
  /** Product-neutral stable reference to a governed binary object table, used by shared GC. */
  mediaRef?: { blobTable: string; field: string }
  /**
   * 当前版本的规范构造默认值。只在已通过 FIELD_REGISTRY 闭集校验的数据上应用，
   * 不接受缺失身份、历史字段或跨版本输入。
   */
  defaults?: Record<string, unknown>
  /** 备注(说明为什么这样配) */
  note?: string
}

/**
 * FIELD_REGISTRY 字段定义。
 *
 * 只描述当前 AI/结构化采纳允许写入的 canonical 字段。未知字段必须拒绝，
 * 不得在 adopt() 中猜测或映射字段名。
 */
export interface FieldSpec {
  /** 目标表名,必须存在于 PROJECT_TABLES */
  target: string
  /** canonical 字段名 */
  field: string
  /** Optional stable CreativeArtifact output id resolved through this same registry. */
  candidateId?: string
  type: 'string' | 'longtext' | 'json' | 'object' | 'number' | 'boolean' | 'enum' | 'array'
  enums?: string[]
  worldScoped?: boolean
  /** 仅用于界面和上下文展示的自然语言标签；不得作为写入字段名。 */
  labels?: string[]
  sanitize?: (val: unknown) => unknown
  label?: string
  /**
   * AI generation is opt-in. A registered writable field is not automatically
   * generatable; formal Skills derive their target set and field contract from
   * this capability instead of maintaining a second field list.
   */
  aiGeneration?: {
    version: 1
    domain: 'worldview-foundation' | 'story-intent'
    label: string
    kind: 'text' | 'divine-design' | 'natural-resources'
    directDependencies: readonly string[]
    modes: readonly ('expand' | 'rewrite' | 'polish')[]
    outputSchemaId: string
    maxChars: number
    temporaryAssumptions: 'allowed' | 'forbidden'
  }
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
  /** 允许统一写回入口按这些字段清空当前集合，再写入新结果。 */
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
  /** Explicit logical read/write boundary. */
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
    /** Optional exact HTML guard for range edits where formatting changes matter. */
    expectedContentHash?: string
  } | {
    /** HARNESS-66: exact CAS for one FIELD_REGISTRY-governed record field. */
    kind: 'record-field-value-hash'
    field: string
    expectedHash: string
  } | {
    /** MEMORY-5: atomic CAS for an author-edited workspace document. */
    kind: 'record-fields-value-hash'
    fields: readonly string[]
    expectedHash: string
  }
  target: string
  data: Record<string, unknown> | Record<string, unknown>[]
  mode: 'replace' | 'append' | 'add' | 'add-many' | 'merge-diffs'
}

export interface AdoptResult {
  written: { id: number; fields: string[] }[]
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
  /** Explicit logical read boundary; callers should always provide current WorkspaceScope. */
  scope?: WorkspaceScope
  /** Explicit world target. null is a valid explicit single-world/global target. */
  worldGroupId?: number | null
  /** HARNESS-70: trusted target category for the registered Codex extraction baseline. */
  codexCategoryId?: number
  /** HARNESS-73: trusted target for the registered history consultation baseline. */
  historyAgentMode?: 'consult' | 'storm'
  historyAgentTargetKind?: 'event' | 'keyword'
  historyAgentTargetId?: number
  /** HARNESS-74: trusted version target for reference summary/character derivation. */
  referenceDerivedMode?: 'summary' | 'characters'
  referenceAnalysisRunId?: number
  /** HARNESS-76: trusted chapter selection for the registered style-learning baseline. */
  styleLearningChapterIds?: number[]
  /** HARNESS-79: trusted existing story-timeline event for single-record impact remediation. */
  storyTimelineEventId?: number
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
  /** ProductRuntime: 冻结的上层产品运行会话，仅供对应产品 Skill 读取。 */
  productRuntimeSessionId?: number
  /** TTRPG R7: exact player character POV for the isolated AI-player reader. */
  ttrpgPlayerActorKey?: string
  /** PRODUCTPROD-1 registered production context anchors. */
  productProductionId?: number
  productBuildId?: number
  productArtifactKeys?: string[]
  /** Character interaction: exactly one viewpoint for the registered reader. */
  interactionParticipantKey?: string
  /** Character interaction: frozen product source + confirmed product Brief. */
  /** CM-1: 本次明确参与增量融合的碎片；由 inspirationWorkspace source 读取。 */
  inspirationFragmentIds?: string[]
  /** CM-1: 单世界与多世界各自维护最近确认版本。 */
  inspirationMode?: InspirationResultMode
  /** STORY-1: 角色驱动规划 Skill 明确冻结的方案；缺省时仍读取作者激活的下游参考方案。 */
  characterDrivenPlanId?: number
  /** ADAPT-CORE-1: target-owned adaptation selector; never a caller supplied source Work ID. */
  adaptationProjectId?: number
  /** Exact immutable manifest version frozen by the current adaptation Run. */
  adaptationSourceManifestVersion?: number
  /** Explicit source-unit capability list for adaptation.sourceContent. */
  adaptationSourceUnitKeys?: string[]
  /** SCREEN-1: explicit target scene capability list for review/revision Runs. */
  screenplaySceneIds?: number[]
  /** COMIC-1: explicit target page capability list for storyboard review Runs. */
  comicPageIds?: number[]
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

export const CONTEXT_RESOURCE_KINDS_V1 = [
  'workspace', 'world', 'worldview-field', 'story-core-field', 'character',
  'character-relation', 'story-arc', 'storyline-progress', 'outline-node',
  'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry',
  'world-link', 'fact', 'reference', 'narrative-blueprint',
] as const

export type ContextResourceKind = typeof CONTEXT_RESOURCE_KINDS_V1[number]

export type ContextResourceDepthV1 = 'index' | 'summary' | 'focused' | 'full' | 'original'
export type ContextResourceAuthorityV1 =
  | 'author-canon'
  | 'adopted-canon'
  | 'confirmed-evidence'
  | 'derived-summary'
  | 'candidate'

export interface ContextSourceRefV1 {
  table: string
  recordId: number | string
  field: string
  revision: number | string
  contentHash: string
  anchor?: { start: number; end: number; quoteHash: string }
}

export interface ContextResourceRelationV1 {
  kind: 'parent' | 'child' | 'same-entity' | 'appears-in' | 'depends-on' | 'world-link' | 'temporal-neighbor'
  targetResourceKey: string
  direction: 'outgoing' | 'incoming' | 'undirected'
}

export interface ContextTimeRangeV1 {
  start?: number | string
  end?: number | string
  throughChapterId?: number
}

export interface ContextResourceDescriptorV1 {
  version: 1
  resourceKey: string
  sourceKey: string
  kind: ContextResourceKind
  title: string
  shortSummary: string
  authority: ContextResourceAuthorityV1
  /** Canon body identity, independent from retrieval policy. */
  contentRevision: number | string
  contentHash: string
  /** Retrieval policy identity, independent from Canon edits. */
  policyRevision: number
  policyHash: string
  scope: {
    projectId: number
    worldId?: number
    workId?: number
    worldGroupId?: number | null
    chapterId?: number
    /** Immutable release locator when the resource comes from WorldReference. */
    worldReleaseId?: number
    worldReleaseHash?: string
  }
  /** Provider-neutral semantic identity. Product adapters match this instead
   * of copying physical WorldRelease table names. */
  worldSemantic?: {
    area: WorldCapabilityArea
    resourceKind: string
    /** Release-scoped portable row identity; never a Dexie id. */
    resourceCoordinate: string
  }
  relations: ContextResourceRelationV1[]
  timeRange?: ContextTimeRangeV1
  sourceRefs: ContextSourceRefV1[]
  tokenEstimate: Partial<Record<ContextResourceDepthV1, number>>
  availableDepths: ContextResourceDepthV1[]
  priority: 'normal' | 'pinned' | 'must-read'
  /** 作者检索权重；未设置时按 1 处理。 */
  retrievalWeight?: number
  /** 作者为该资源冻结的单次读取上限；未设置时不额外收窄。 */
  tokenCap?: number
}

export interface FrozenResourceScopeV1 {
  projectId: number
  worldId?: number
  workId?: number
  worldGroupId?: number | null
  /** Optional operation boundary. Providers may expose target-specific
   * aggregate resources without materializing one aggregate for every chapter. */
  chapterId?: number
  /** undefined = unrestricted catalog; null = explicitly no character
   * knowledge; number = only this perspective character's knowledge. */
  characterId?: number | null
  /** Required by the registered immutable WorldRelease provider. */
  worldReleaseId?: number
  worldReleaseHash?: string
}

export interface ResourceListInputV1 {
  scope: FrozenResourceScopeV1
  kinds?: ContextResourceKind[]
  cursor?: string
  limit: number
}

export interface ResourceSearchInputV1 extends ResourceListInputV1 {
  query: string
  /** Resource keys matched against the descriptor itself or one-hop relations. */
  entityKeys?: string[]
  /** Story-arc resource keys matched independently from general entity filters. */
  storyArcKeys?: string[]
  /** Deterministic metadata range filter; it never scans resource bodies. */
  timeRange?: ContextTimeRangeV1
}

export interface ResourcePageV1 {
  version: 1
  items: ContextResourceDescriptorV1[]
  nextCursor: string | null
  scopeFingerprint: string
}

export interface ResourceReadInputV1 {
  scope: FrozenResourceScopeV1
  resourceKey: string
  depth: Exclude<ContextResourceDepthV1, 'original'>
  maxTokens: number
}

export interface OriginalEvidenceReadInputV1 {
  scope: FrozenResourceScopeV1
  resourceKey: string
  sourceRef: ContextSourceRefV1
  maxTokens: number
}

export interface ContextResourceReadV1 {
  version: 1
  descriptor: ContextResourceDescriptorV1
  depth: Exclude<ContextResourceDepthV1, 'original'>
  content: string
  contentHash: string
  tokenCount: number
  sourceRefs: ContextSourceRefV1[]
}

export interface OriginalEvidenceReadV1 {
  version: 1
  descriptor: ContextResourceDescriptorV1
  sourceRef: ContextSourceRefV1
  content: string
  contentHash: string
  tokenCount: number
}

export interface ContextResourceProviderV1 {
  version: 'context-resource-provider-v1'
  providerId: string
  providerVersion: string
  normalizationVersion: string
  kinds: readonly ContextResourceKind[]
  listMetadata(input: ResourceListInputV1): Promise<ResourcePageV1>
  searchMetadata(input: ResourceSearchInputV1): Promise<ResourcePageV1>
  read(input: ResourceReadInputV1): Promise<ContextResourceReadV1>
  readOriginal(input: OriginalEvidenceReadInputV1): Promise<OriginalEvidenceReadV1>
  fingerprint(scope: FrozenResourceScopeV1): Promise<string>
}

export interface ContextAccessPolicyV1 {
  version: 'context-access-policy-v1'
  policyId: string
  mandatorySourceKeys: string[]
  allowedSourceKeys: string[]
  allowedResourceKinds: ContextResourceKind[]
  allowedDepths: ContextResourceDepthV1[]
  selectorPolicyId: string
  maxReadCalls: number
  maxRetrievedTokens: number
  perKindMinimumTokens?: Partial<Record<ContextResourceKind, number>>
  allowOriginalRead: boolean
  candidateAccess: 'forbidden' | 'explicit-resource-key-only'
}

export interface ContextSufficiencyObligationV1 {
  id: string
  kind: 'mandatory-source' | 'resource-kind' | 'entity' | 'time-boundary' | 'conflict-check'
  required: boolean
  status: 'satisfied' | 'missing' | 'conflicted' | 'not-applicable'
  evidenceResourceKeys: string[]
  reasonCode: string
}

export interface ContextSufficiencyReportV1 {
  version: 'context-sufficiency-v1'
  obligations: ContextSufficiencyObligationV1[]
  assumptions: string[]
  additionalRead: 'forbidden' | 'not-needed' | 'needed'
  reportHash: string
}

export interface RetrievalDecisionV1 {
  resourceKey: string
  sourceKey: string
  reason: string
  depth: ContextResourceDepthV1
  revision: number | string
  contentHash: string
  /** Optional for historical V1 traces; required by ContextManifestV3 evidence. */
  policyRevision?: number
  /** Optional for historical V1 traces; required by ContextManifestV3 evidence. */
  policyHash?: string
  sourceRefs: ContextSourceRefV1[]
  tokenCount: number
}

export interface RetrievalOmissionV1 {
  resourceKey: string
  sourceKey: string
  reasonCode: string
  tokenEstimate: number
}

export interface RetrievalQueryTraceV1 {
  query: string
  sourceKeys: string[]
  resultResourceKeys: string[]
  resultFingerprint: string
}

export interface RetrievalTraceV1 {
  version: 1
  catalogVersion: string
  selectorPolicyId: string
  mandatory: RetrievalDecisionV1[]
  autoSelected: RetrievalDecisionV1[]
  agentReads: RetrievalDecisionV1[]
  omitted: RetrievalOmissionV1[]
  queries: RetrievalQueryTraceV1[]
  totalTokens: number
  fallbackUsed: boolean
  traceHash: string
}

export interface ContextPacketV1 {
  version: 'context-packet-v1'
  scopeFingerprint: string
  gatewayVersionHash: string
  policyHash: string
  sufficiencyReportHash: string
  retrievalTraceHash: string
  content: string
  contentHash: string
  tokenCount: number
  sourceRefs: ContextSourceRefV1[]
  packetHash: string
}

/** CTXG physical persistence is introduced in CTXG-2; this is its frozen wire contract. */
export interface AgentRunArtifactV1 {
  version: 'agent-run-artifact-v1'
  artifactKind: ExactRunArtifactKindV1
  projectId: number
  scopeFingerprint: string
  contentHash: string
  byteSize: number
  encoding: 'utf-8' | 'gzip-utf-8'
  content: string | Uint8Array
  createdAt: number
}

export interface ContextGatewayVersionV1 {
  version: 'context-gateway-version-v1'
  gatewayVersion: string
  selectorVersion: string
  descriptorContractVersion: 'context-resource-descriptor-v1'
  providerSetHash: string
  sufficiencyObligationsVersion: string
  toolSchemaHash: string
  normalizationVersion: string
  versionHash: string
}

export interface ContextGatewayContractSnapshotV1 {
  version: 1
  policy: ContextAccessPolicyV1
  policyHash: string
  providers: Array<{
    sourceKey: string
    providerId: string
    providerVersion: string
    normalizationVersion: string
    kinds: ContextResourceKind[]
  }>
  gateway: ContextGatewayVersionV1
  snapshotHash: string
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
  requiresProductRuntimeSessionId?: boolean
  requiresOutlineNodeId?: boolean
  requiresChapterId?: boolean
  requiresAdaptationProjectId?: boolean
  requiresAdaptationSourceUnits?: boolean
  requiresScreenplayScenes?: boolean
  requiresComicPages?: boolean
  /** 规划尚未创建正文 Chapter 时，允许用 outlineNodeId 作为规范章序边界。 */
  acceptsOutlineNodeAsChapterBoundary?: boolean
  enabled?: (input: AssembleContextInput) => boolean | Promise<boolean>
  /** CTXG resource navigation extension. It is the only Provider registration point. */
  resources?: ContextResourceProviderV1
  read: (input: AssembleContextInput) => Promise<string>
}

export type AssembleContextSourceStatus = 'included' | 'omitted' | 'trimmed'
export type AssembleContextSourceDelivery = 'full' | 'compressed' | 'truncated' | 'none'

/**
 * Per-source delivery evidence derived by assembleContext(). It records only
 * counts, hashes and delivery state; source text remains in segments/business tables.
 */
export interface AssembleContextSourceEvidence {
  key: string
  status: AssembleContextSourceStatus
  delivery: AssembleContextSourceDelivery
  /** SHA-256 of the registered reader's complete raw output before compression or truncation. */
  sourceHash?: string
  /** UTF-16 character count returned by the registered reader before its source budget was applied. */
  originalCharacters?: number
  /** UTF-16 character count actually delivered to the model. Zero for omitted/trimmed sources. */
  inputCharacters?: number
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
