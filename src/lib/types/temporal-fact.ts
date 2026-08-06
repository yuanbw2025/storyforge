/**
 * NS-4 · 双层事实记忆 — 时序事实账本数据模型。
 *
 * 设计权威：桌面《StoryForge_长期一致性目标实现方案.md》§14（LC-1 数据模型）
 * 与 docs/MASTER-BLUEPRINT.md §16 / ROADMAP NS-4。
 *
 * 核心取舍（§14.1，已核 schema.ts）：
 * - 实体身份用【方案A·分类型 FK】，不用多态 subjectType+subjectId
 *   —— 因为 PROJECT_TABLES.refs 按"明确目标表"声明引用，多态外键表达不了
 *      删除级联/角色合并重映射/导入导出 ID 重映射/FK 校验/多世界校验。
 * - LC-1 事实主体集合 = 有稳定主表的实体：
 *   {character, location(importantLocations), storyArc, worldGroup, codexEntry}。
 *   势力已并入 codex（factions 表 v29 删），用 codexEntryId 指代，无 factionId；
 *   物品只有事件流 itemLedger（无 items 主表），不作为事实主体，物品状态仍由 itemLedger 承担。
 *
 * 双层语义（§22.8 NS-4）：
 * - Evidence Observation = status:'candidate'（有证据、待作者确认，不自动升级为权威）；
 * - Canon Assertion      = status:'confirmed'（作者确认的权威事实）。
 */

/** LC-1 事实主体/客体的实体类型（仅有稳定主表者）。 */
export type FactEntityType = 'character' | 'location' | 'storyArc' | 'worldGroup' | 'codexEntry'

/** 事实种类：state 可被新值取代；event 只增不改、不可 supersede；derived 由计算得出、不可人工直接编辑。 */
export type FactKind = 'state' | 'event' | 'derived'

/**
 * 事实状态机（§14.3 + §16.7）。
 * - candidate：观察证据/导入候选，待作者确认；
 * - confirmed：作者确认的权威 Canon；
 * - superseded：被新确认事实取代；
 * - rejected：作者否决；
 * - stale：来源正文已改，原证据不再成立；
 * - source-missing：主体/客体/来源被删除或无法映射；
 * - invalid-range：validFrom/validTo 的章节引用失效，时序区间需人工复核。
 */
export type FactStatus =
  | 'candidate'
  | 'confirmed'
  | 'rejected'
  | 'superseded'
  | 'stale'
  | 'source-missing'
  | 'invalid-range'

export type FactValueType = 'string' | 'number' | 'boolean' | 'enum' | 'entity-ref' | 'json'

/** 谓词冲突策略：supersede=新值关闭旧值；append=多值累加；manual=只提示、由作者裁决。 */
export type FactConflictPolicy = 'supersede' | 'append' | 'manual'

/** 事实来源（§14.3，不强制 chapter）。 */
export type FactSourceType = 'chapter' | 'manual' | 'import' | 'setting'

/**
 * 受控谓词定义（§14.2）。AI 输出必须映射到已登记谓词；未知谓词只进"候选待登记"，
 * 不得直接写权威账本。这是事实账本的单一事实源之一（与 AdoptionSchema 配合）。
 */
export interface FactPredicateSpec {
  /** 谓词 key，如 location / powerStage / owns / relation */
  key: string
  label: string
  /** 该谓词允许的主体类型 */
  subjectTypes: FactEntityType[]
  /** ★区分 state/event/derived（§14.2 解 §12.4.4） */
  factKind: FactKind
  valueType: FactValueType
  enums?: string[]
  /** enum 自由输入别名 → 规范枚举值；写入账本前必须归一或拒绝。 */
  enumAliases?: Readonly<Record<string, string>>
  /** single=同一主体同一时点最多一个有效值；multi=可并存多值 */
  cardinality: 'single' | 'multi'
  temporal: boolean
  /** AI 别名归一（把模型自由措辞映射到本谓词） */
  aliases?: string[]
  conflictPolicy: FactConflictPolicy
  /** CONSISTENCY-3：是否属于可做确定性单值互斥判断的世界宪法主题。 */
  constitution?: boolean
  /** 关系类谓词（entity-ref）的客体允许类型 */
  objectEntityTypes?: FactEntityType[]
}

/**
 * 时序事实（§14.3）。时序以 chapterId 为稳定身份，绝不缓存 order
 * —— 章节可拖动重排 → order 不稳定 → 只存 chapterId，比较"截止第 N 章"时按当前 order 实时解析。
 */
export interface TemporalFact {
  id?: number
  projectId: number
  workId?: number | null
  worldGroupId?: number | null

  // —— 主体：分类型 FK（方案A），只对有稳定主表的实体建 ——
  characterId?: number | null
  locationId?: number | null            // → importantLocations
  storyArcId?: number | null
  subjectWorldGroupId?: number | null   // 主体本身是世界时
  codexEntryId?: number | null          // 势力/概念等（factions 已删并入 codex）
  subjectName: string                   // 显示/检索 + 无主表实体的暂存身份，非唯一外键

  // —— 关系/事件的客体：同样分类型 FK ——
  objectCharacterId?: number | null
  objectLocationId?: number | null
  objectCodexEntryId?: number | null

  // —— 谓词：必须 = FACT_PREDICATE_REGISTRY.key ——
  predicate: string
  factKind: FactKind
  value: string

  // —— 来源：不强制 chapter ——
  sourceType: FactSourceType
  sourceChapterId?: number | null
  sourceRecordTable?: string
  sourceRecordId?: number | null
  sourceQuote?: string
  /** CONSISTENCY-3：可移植的设定来源 FK；旧多态 sourceRecordId 仅保留兼容。 */
  sourceWorldviewId?: number | null
  sourcePowerSystemId?: number | null
  sourceCultivationSystemId?: number | null
  sourceStoryCoreId?: number | null
  sourceCharacterId?: number | null
  /** 来源字段必须来自 CANON_ASSERTION_SOURCE_REGISTRY。 */
  sourceField?: string
  /** 提取时来源字段全文的规范化指纹，用于检测来源修改。 */
  sourceFingerprint?: string

  // —— 时序：以 chapterId 为稳定身份，绝不缓存 order ——
  validFromChapterId?: number | null
  validToChapterId?: number | null      // null = 至今有效

  // —— 确认与状态：confidence 不决定生效 ——
  status: FactStatus
  locked: boolean                       // 作者锁定，AI 不得自动 supersede
  confidence?: number                   // 仅 UI 排序提示
  supersedesFactId?: number | null

  createdAt: number
  updatedAt: number
}

/** 主体分类型 FK 字段名 → 实体类型（用于 refs 派生重映射与校验）。 */
export const FACT_SUBJECT_FK: Readonly<Record<string, FactEntityType>> = {
  characterId: 'character',
  locationId: 'location',
  storyArcId: 'storyArc',
  subjectWorldGroupId: 'worldGroup',
  codexEntryId: 'codexEntry',
}

/** 客体分类型 FK 字段名 → 实体类型。 */
export const FACT_OBJECT_FK: Readonly<Record<string, FactEntityType>> = {
  objectCharacterId: 'character',
  objectLocationId: 'location',
  objectCodexEntryId: 'codexEntry',
}
