/**
 * ARCH-07B · StoryForge product entry catalog.
 *
 * This registry describes release maturity and cross-product ownership only.
 * Product-specific feature acceptance remains in each product contract; a page
 * or route existing in the bundle never upgrades its maturity automatically.
 */
export const PRODUCT_RELEASE_STATUSES_V1 = [
  'experimental',
  'internal',
  'preview',
  'released',
] as const

export type ProductReleaseStatusV1 = typeof PRODUCT_RELEASE_STATUSES_V1[number]
export type ProductCatalogChannelV1 = 'local-development' | 'production' | 'test'

export type StoryForgeProductIdV1 =
  | 'world-engine'
  | 'independent.longform'
  | 'independent.shortform'
  | 'independent.screenplay'
  | 'independent.comic'
  | 'authoring.nodes'
  | 'upper.ttrpg'
  | 'upper.character-interaction'
  | 'upper.ai-town'
  | 'upper.storygame'
  | 'upper.text-adventure'
  | 'upper.avg'
  | 'upper.narrative-simulation'
  | 'upper.text-open-world'
  | 'platform.marketplace'

export interface ProductCatalogEntryV1 {
  version: 1
  id: StoryForgeProductIdV1
  label: string
  family: 'world-engine' | 'independent-creation' | 'authoring-view' | 'upper-product' | 'platform'
  status: ProductReleaseStatusV1
  /** Governing charter phase; this is not a claim that the phase is complete. */
  charterPhase: 'B' | 'C' | 'D' | 'E' | 'F'
  requiresWorldReference: boolean
  ownsRuntime: boolean
  ownsMedia: boolean
  /** Every non-released surface must state why it is not a production promise. */
  maturityNote: string
}

function entry(input: Omit<ProductCatalogEntryV1, 'version'>): ProductCatalogEntryV1 {
  return Object.freeze({ version: 1, ...input })
}

export const PRODUCT_CATALOG_V1: readonly ProductCatalogEntryV1[] = Object.freeze([
  entry({ id: 'world-engine', label: '世界引擎', family: 'world-engine', status: 'released', charterPhase: 'D', requiresWorldReference: false, ownsRuntime: false, ownsMedia: false, maturityNote: '语义编辑、显式派生、冻结版本与中立读取出口。' }),
  entry({ id: 'independent.longform', label: '分步骤长篇', family: 'independent-creation', status: 'released', charterPhase: 'B', requiresWorldReference: false, ownsRuntime: false, ownsMedia: false, maturityNote: 'Phase 5 工程主链已验收；文学质量继续增量研究。' }),
  entry({ id: 'independent.shortform', label: '短篇小说', family: 'independent-creation', status: 'preview', charterPhase: 'C', requiresWorldReference: false, ownsRuntime: false, ownsMedia: false, maturityNote: '复用长篇底座，但独立产品体验尚未专项封板。' }),
  entry({ id: 'independent.screenplay', label: '小说转剧本', family: 'independent-creation', status: 'preview', charterPhase: 'C', requiresWorldReference: false, ownsRuntime: false, ownsMedia: false, maturityNote: '已有生产基础，完整改编与导出纵切面待专项验收。' }),
  entry({ id: 'independent.comic', label: '小说转漫画', family: 'independent-creation', status: 'preview', charterPhase: 'C', requiresWorldReference: false, ownsRuntime: false, ownsMedia: true, maturityNote: '已有数据与工作台基础，生图、一致性、排版和交付待专项验收。' }),
  entry({ id: 'authoring.nodes', label: '节点创作', family: 'authoring-view', status: 'preview', charterPhase: 'B', requiresWorldReference: false, ownsRuntime: false, ownsMedia: false, maturityNote: '已与分步骤领域后端同源；完整跨模式真实 UI 验收仍持续。' }),
  entry({ id: 'upper.ttrpg', label: '跑团', family: 'upper-product', status: 'preview', charterPhase: 'E', requiresWorldReference: true, ownsRuntime: true, ownsMedia: true, maturityNote: '架构入口与既有功能可预览，玩法和多人体验尚未专项封板。' }),
  entry({ id: 'upper.character-interaction', label: '角色聊天', family: 'upper-product', status: 'preview', charterPhase: 'E', requiresWorldReference: true, ownsRuntime: true, ownsMedia: true, maturityNote: '冻结来源生产与运行纵切面可预览，完整长期体验待专项验收。' }),
  entry({ id: 'upper.ai-town', label: 'AI 小镇', family: 'upper-product', status: 'experimental', charterPhase: 'E', requiresWorldReference: true, ownsRuntime: true, ownsMedia: true, maturityNote: '尚未形成独立产品闭环，默认隐藏。' }),
  entry({ id: 'upper.storygame', label: '分支叙事', family: 'upper-product', status: 'preview', charterPhase: 'E', requiresWorldReference: true, ownsRuntime: true, ownsMedia: true, maturityNote: '制作与运行基础可预览，完整产品体验待专项验收。' }),
  entry({ id: 'upper.text-adventure', label: '文字冒险', family: 'upper-product', status: 'preview', charterPhase: 'E', requiresWorldReference: true, ownsRuntime: true, ownsMedia: true, maturityNote: '制作与运行基础可预览，完整产品体验待专项验收。' }),
  entry({ id: 'upper.avg', label: 'AVG', family: 'upper-product', status: 'preview', charterPhase: 'E', requiresWorldReference: true, ownsRuntime: true, ownsMedia: true, maturityNote: '制作与运行基础可预览，真实视听资产和演出交付待专项验收。' }),
  entry({ id: 'upper.narrative-simulation', label: '叙事模拟', family: 'upper-product', status: 'experimental', charterPhase: 'E', requiresWorldReference: true, ownsRuntime: true, ownsMedia: true, maturityNote: '研究性产品入口，默认隐藏。' }),
  entry({ id: 'upper.text-open-world', label: '文字开放世界', family: 'upper-product', status: 'experimental', charterPhase: 'E', requiresWorldReference: true, ownsRuntime: true, ownsMedia: true, maturityNote: '研究性产品入口，默认隐藏。' }),
  entry({ id: 'platform.marketplace', label: '社区市场', family: 'platform', status: 'internal', charterPhase: 'F', requiresWorldReference: false, ownsRuntime: false, ownsMedia: false, maturityNote: '平台与商业化阶段后置，仅供本地内部验证。' }),
])

export const PRODUCT_CATALOG_BY_ID_V1: ReadonlyMap<StoryForgeProductIdV1, ProductCatalogEntryV1> = new Map(
  PRODUCT_CATALOG_V1.map(item => [item.id, item] as const),
)

export interface ProductEntryDecisionV1 {
  entry: ProductCatalogEntryV1
  channel: ProductCatalogChannelV1
  visible: boolean
  enterable: boolean
  badge: string | null
  blockers: string[]
}

export function evaluateProductEntryV1(input: {
  productId: StoryForgeProductIdV1
  channel: ProductCatalogChannelV1
  /** Explicit local opt-in is required for experimental research surfaces. */
  experimentalOptIn?: boolean
}): ProductEntryDecisionV1 {
  const entry = PRODUCT_CATALOG_BY_ID_V1.get(input.productId)
  if (!entry) throw new Error(`[product-catalog] 未登记产品：${input.productId}`)
  const local = input.channel === 'local-development' || input.channel === 'test'
  const released = entry.status === 'released'
  const experimentalAllowed = local && input.experimentalOptIn === true
  const visible = released
    || (local && (entry.status === 'preview' || entry.status === 'internal'))
    || (entry.status === 'experimental' && experimentalAllowed)
  const blockers = visible ? [] : [
    entry.status === 'experimental'
      ? '实验产品默认隐藏，需要本地显式启用。'
      : '该产品尚未发布，生产环境默认隐藏。',
  ]
  return {
    entry,
    channel: input.channel,
    visible,
    enterable: visible,
    badge: released ? null : entry.status === 'preview' ? '预览' : entry.status === 'internal' ? '内部' : '实验',
    blockers,
  }
}

export function currentProductCatalogChannelV1(): ProductCatalogChannelV1 {
  if (typeof window === 'undefined') return 'test'
  const hostname = window.location.hostname.toLocaleLowerCase('en-US')
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
    ? 'local-development'
    : 'production'
}

export function currentExperimentalProductOptInV1(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem('storyforge:experimental-products') === 'enabled' }
  catch { return false }
}

function validateProductCatalogV1(): void {
  const ids = new Set<string>()
  for (const item of PRODUCT_CATALOG_V1) {
    if (ids.has(item.id)) throw new Error(`[product-catalog] 重复产品 ID：${item.id}`)
    ids.add(item.id)
    if (!item.maturityNote.trim()) throw new Error(`[product-catalog] ${item.id} 缺少成熟度边界说明`)
    if (item.family === 'world-engine' && (item.ownsRuntime || item.ownsMedia)) {
      throw new Error('[product-catalog] 世界引擎不得拥有 runtime 或产品媒资')
    }
    if (item.requiresWorldReference && item.family !== 'upper-product') {
      throw new Error(`[product-catalog] 只有上层产品可强制要求 WorldReference：${item.id}`)
    }
  }
}

validateProductCatalogV1()
