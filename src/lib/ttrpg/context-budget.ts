import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import { estimateTokens } from '../ai/context-budget'
import * as p from './open-contract-parse'

export const TTRPG_CONTEXT_TIER_KEYS_V1 = [
  'rules',
  'authority-state',
  'active-situations',
  'known-facts',
  'recent-events',
  'memory-summary',
  'dynamic-injection',
  'flavor',
] as const

export type TtrpgContextTierKeyV1 = typeof TTRPG_CONTEXT_TIER_KEYS_V1[number]

export interface TtrpgContextBudgetReceiptTierV1 {
  tierKey: TtrpgContextTierKeyV1
  demotable: boolean
  includedTokens: number
  demoted: boolean
  demoteReason: string | null
}

export interface TtrpgContextBudgetReceiptV1 {
  tiers: Array<TtrpgContextBudgetReceiptTierV1>
  totalTokens: number
  budgetTokens: number
  overflowHandled: boolean
}

export interface TtrpgContextBudgetBlockV1 {
  tierKey: TtrpgContextTierKeyV1
  sourceKey?: string
  sourceKeys?: readonly string[]
  sourceRefs?: readonly string[]
  content?: string
  text?: string
  tokens?: number
  tokenCount?: number
  required?: boolean
  protected?: boolean
  protectedFromTrim?: boolean
  demotable?: boolean
  blockKey?: string
  order?: number
  [key: string]: unknown
}

export interface TtrpgContextBudgetAssemblyInputV1 {
  tiers?: readonly TtrpgContextBudgetBlockV1[]
  blocks?: readonly TtrpgContextBudgetBlockV1[]
  segments?: readonly TtrpgContextBudgetBlockV1[]
  budgetTokens: number
  requiredTierKeys?: readonly TtrpgContextTierKeyV1[]
  protectedTierKeys?: readonly TtrpgContextTierKeyV1[]
  [key: string]: unknown
}

export interface TtrpgContextBudgetIncludedBlockV1 {
  tierKey: TtrpgContextTierKeyV1
  sourceKey: string
  sourceKeys: string[]
  content: string
  tokens: number
  blockKey: string
}

export interface TtrpgContextBudgetAssemblyResultV1 {
  text: string
  context: string
  segments: TtrpgContextBudgetIncludedBlockV1[]
  included: string[]
  omitted: string[]
  receipt: TtrpgContextBudgetReceiptV1
  failed: false
}

export class TtrpgContextBudgetErrorV1 extends Error {
  constructor(
    message: string,
    readonly receipt: TtrpgContextBudgetReceiptV1,
  ) {
    super(message)
    this.name = 'TtrpgContextBudgetErrorV1'
  }
}

const FIXED_NON_DEMOTABLE_TIERS = new Set<TtrpgContextTierKeyV1>(['rules', 'authority-state'])
const DEMOTION_ORDER: readonly TtrpgContextTierKeyV1[] = [
  'flavor',
  'dynamic-injection',
  'memory-summary',
  'recent-events',
  'known-facts',
  'active-situations',
]

function fail(message: string): never {
  return p.fail(`[ttrpg-context-budget] ${message}`)
}

function tierKey(value: unknown, label: string): TtrpgContextTierKeyV1 {
  return p.oneOf(value, TTRPG_CONTEXT_TIER_KEYS_V1, label)
}

function integerOrUndefined(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  return p.integer(value, label, 0, Number.MAX_SAFE_INTEGER)
}

function sourceKeysFor(block: TtrpgContextBudgetBlockV1, label: string): string[] {
  const raw = block.sourceKeys ?? block.sourceRefs ?? (block.sourceKey === undefined ? [] : [block.sourceKey])
  if (!Array.isArray(raw)) fail(`${label}.sourceKey 必须是已登记 sourceKey 数组`)
  const keys = p.keys(raw, `${label}.sourceKeys`, 128, 1)
  for (const sourceKey of keys) {
    if (!CONTEXT_SOURCE_BY_KEY.has(sourceKey)) fail(`${label}含未登记 sourceKey:${sourceKey}`)
  }
  return keys
}

interface NormalizedBlockV1 {
  tierKey: TtrpgContextTierKeyV1
  sourceKey: string
  sourceKeys: string[]
  content: string
  tokens: number
  required: boolean
  protected: boolean
  demotable: boolean | undefined
  blockKey: string
  order: number
}

function normalizeBlock(block: TtrpgContextBudgetBlockV1, index: number): NormalizedBlockV1 {
  const label = `contextBudget.blocks[${index}]`
  const normalizedTierKey = tierKey(block.tierKey, `${label}.tierKey`)
  const sourceKeys = sourceKeysFor(block, label)
  const content = block.content ?? block.text
  if (typeof content !== 'string') fail(`${label}.content 必须是字符串`)
  const explicitTokens = block.tokens ?? block.tokenCount
  const tokens = explicitTokens === undefined
    ? estimateTokens(content)
    : integerOrUndefined(explicitTokens, `${label}.tokens`)!
  const blockKey = typeof block.blockKey === 'string' && block.blockKey.trim()
    ? block.blockKey.trim()
    : `${sourceKeys.join(',')}\u0000${normalizedTierKey}\u0000${content}`
  const order = integerOrUndefined(block.order, `${label}.order`) ?? 0
  const required = block.required === true
  const protectedBlock = block.protected === true || block.protectedFromTrim === true
  return {
    tierKey: normalizedTierKey,
    sourceKey: sourceKeys[0]!,
    sourceKeys,
    content,
    tokens,
    required,
    protected: protectedBlock,
    demotable: block.demotable,
    blockKey,
    order,
  }
}

function blocksFromInput(input: TtrpgContextBudgetAssemblyInputV1): readonly TtrpgContextBudgetBlockV1[] {
  const blocks = input.blocks ?? input.tiers ?? input.segments
  if (!blocks) return []
  if (!Array.isArray(blocks)) fail('必须提供 tiers、blocks 或 segments 数组')
  return blocks
}

function forcedTierKeys(input: TtrpgContextBudgetAssemblyInputV1): Set<TtrpgContextTierKeyV1> {
  const result = new Set<TtrpgContextTierKeyV1>(FIXED_NON_DEMOTABLE_TIERS)
  for (const key of input.requiredTierKeys ?? []) result.add(tierKey(key, 'contextBudget.requiredTierKeys'))
  for (const key of input.protectedTierKeys ?? []) result.add(tierKey(key, 'contextBudget.protectedTierKeys'))
  return result
}

function buildReceipt(
  includedTokens: ReadonlyMap<TtrpgContextTierKeyV1, number>,
  demoted: ReadonlySet<TtrpgContextTierKeyV1>,
  demotable: ReadonlyMap<TtrpgContextTierKeyV1, boolean>,
  totalTokens: number,
  budgetTokens: number,
  overflowHandled: boolean,
): TtrpgContextBudgetReceiptV1 {
  return {
    tiers: TTRPG_CONTEXT_TIER_KEYS_V1.map(tier => {
      const wasDemoted = demoted.has(tier)
      return {
        tierKey: tier,
        demotable: demotable.get(tier) ?? !FIXED_NON_DEMOTABLE_TIERS.has(tier),
        includedTokens: includedTokens.get(tier) ?? 0,
        demoted: wasDemoted,
        demoteReason: wasDemoted ? 'budget-overflow:fixed-order' : null,
      }
    }),
    totalTokens,
    budgetTokens,
    overflowHandled,
  }
}

function sortBlocks(left: NormalizedBlockV1, right: NormalizedBlockV1): number {
  return left.order - right.order
    || left.blockKey.localeCompare(right.blockKey)
    || left.sourceKey.localeCompare(right.sourceKey)
    || left.content.localeCompare(right.content)
}

function readBudgetInput(
  inputOrBlocks: TtrpgContextBudgetAssemblyInputV1 | readonly TtrpgContextBudgetBlockV1[],
  budgetArgument: number | undefined,
): TtrpgContextBudgetAssemblyInputV1 {
  if (Array.isArray(inputOrBlocks)) {
    if (budgetArgument === undefined) fail('数组参数形式必须提供 budgetTokens')
    return { blocks: inputOrBlocks, budgetTokens: budgetArgument }
  }
  return inputOrBlocks as TtrpgContextBudgetAssemblyInputV1
}

export function assembleTtrpgContextWithBudgetV1(
  input: TtrpgContextBudgetAssemblyInputV1,
): TtrpgContextBudgetAssemblyResultV1
export function assembleTtrpgContextWithBudgetV1(
  blocks: readonly TtrpgContextBudgetBlockV1[],
  budgetTokens: number,
): TtrpgContextBudgetAssemblyResultV1
export function assembleTtrpgContextWithBudgetV1(
  inputOrBlocks: TtrpgContextBudgetAssemblyInputV1 | readonly TtrpgContextBudgetBlockV1[],
  budgetArgument?: number,
): TtrpgContextBudgetAssemblyResultV1 {
  const input = readBudgetInput(inputOrBlocks, budgetArgument)
  const budgetTokens = p.integer(input.budgetTokens, 'contextBudget.budgetTokens', 1, Number.MAX_SAFE_INTEGER)
  const blocks = blocksFromInput(input).map(normalizeBlock)
  const forced = forcedTierKeys(input)
  const byTier = new Map<TtrpgContextTierKeyV1, NormalizedBlockV1[]>()
  for (const key of TTRPG_CONTEXT_TIER_KEYS_V1) byTier.set(key, [])
  for (const block of blocks) byTier.get(block.tierKey)!.push(block)
  for (const tier of TTRPG_CONTEXT_TIER_KEYS_V1) byTier.get(tier)!.sort(sortBlocks)

  const demotable = new Map<TtrpgContextTierKeyV1, boolean>()
  const includedTokens = new Map<TtrpgContextTierKeyV1, number>()
  for (const tier of TTRPG_CONTEXT_TIER_KEYS_V1) {
    const tierBlocks = byTier.get(tier)!
    const locked = forced.has(tier)
      || tierBlocks.some(block => block.required || block.protected || block.demotable === false)
    demotable.set(tier, !locked)
    includedTokens.set(tier, tierBlocks.reduce((sum, block) => sum + block.tokens, 0))
  }

  const initialTotalTokens = [...includedTokens.values()].reduce((sum, tokens) => sum + tokens, 0)
  const demoted = new Set<TtrpgContextTierKeyV1>()
  let currentTotalTokens = initialTotalTokens
  if (currentTotalTokens > budgetTokens) {
    for (const tier of DEMOTION_ORDER) {
      if (currentTotalTokens <= budgetTokens) break
      if (demotable.get(tier) !== true) continue
      const tierTokens = includedTokens.get(tier) ?? 0
      if (tierTokens === 0) continue
      demoted.add(tier)
      includedTokens.set(tier, 0)
      currentTotalTokens -= tierTokens
    }
  }

  const overflowHandled = initialTotalTokens > budgetTokens
  const receipt = buildReceipt(
    includedTokens,
    demoted,
    demotable,
    currentTotalTokens,
    budgetTokens,
    overflowHandled,
  )
  if (currentTotalTokens > budgetTokens) {
    throw new TtrpgContextBudgetErrorV1(
      '[ttrpg-context-budget] 不可降级上下文仍超出预算，已停止模型调用',
      receipt,
    )
  }

  const includedSegments = TTRPG_CONTEXT_TIER_KEYS_V1
    .filter(tier => !demoted.has(tier))
    .flatMap(tier => byTier.get(tier)!.map(block => ({
      tierKey: block.tierKey,
      sourceKey: block.sourceKey,
      sourceKeys: [...block.sourceKeys],
      content: block.content,
      tokens: block.tokens,
      blockKey: block.blockKey,
    })))
  const text = includedSegments.map(segment => segment.content).filter(Boolean).join('\n\n')
  const included = [...new Set(includedSegments.flatMap(segment => segment.sourceKeys))]
  const omitted = [...new Set(
    TTRPG_CONTEXT_TIER_KEYS_V1
      .filter(tier => demoted.has(tier))
      .flatMap(tier => byTier.get(tier)!.flatMap(block => block.sourceKeys)),
  )]
  return {
    text,
    context: text,
    segments: includedSegments,
    included,
    omitted,
    receipt,
    failed: false,
  }
}

function parseReceiptTier(value: unknown, label: string): TtrpgContextBudgetReceiptTierV1 {
  const row = p.record(value, ['tierKey', 'demotable', 'includedTokens', 'demoted', 'demoteReason'], label)
  const tier = tierKey(row.tierKey, `${label}.tierKey`)
  const demotable = p.bool(row.demotable, `${label}.demotable`)
  const includedTokens = p.integer(row.includedTokens, `${label}.includedTokens`, 0, Number.MAX_SAFE_INTEGER)
  const demoted = p.bool(row.demoted, `${label}.demoted`)
  const demoteReason = p.nullable(row.demoteReason, (candidate, nestedLabel) => p.text(candidate, nestedLabel, 500), `${label}.demoteReason`)
  if (FIXED_NON_DEMOTABLE_TIERS.has(tier) && demotable) {
    fail(`${label} 不可降级层不得标记 demotable`)
  }
  if (!demotable && demoted) fail(`${label} 不可降级层不得 demoted`)
  if (demoted !== (demoteReason !== null)) fail(`${label} demoted 与 demoteReason 不一致`)
  return { tierKey: tier, demotable, includedTokens, demoted, demoteReason }
}

export function parseTtrpgContextBudgetReceiptV1(value: unknown): TtrpgContextBudgetReceiptV1 {
  const row = p.record(p.json(value), [
    'tiers', 'totalTokens', 'budgetTokens', 'overflowHandled',
  ], 'contextBudgetReceipt')
  const tiers = p.list(row.tiers, 'contextBudgetReceipt.tiers', parseReceiptTier, 8, 1)
  const keys = tiers.map(tier => tier.tierKey)
  if (new Set(keys).size !== keys.length) fail('contextBudgetReceipt.tiers 存在重复 tierKey')
  const totalTokens = p.integer(row.totalTokens, 'contextBudgetReceipt.totalTokens', 0, Number.MAX_SAFE_INTEGER)
  const budgetTokens = p.integer(row.budgetTokens, 'contextBudgetReceipt.budgetTokens', 1, Number.MAX_SAFE_INTEGER)
  const overflowHandled = p.bool(row.overflowHandled, 'contextBudgetReceipt.overflowHandled')
  if (tiers.reduce((sum, tier) => sum + tier.includedTokens, 0) !== totalTokens) {
    fail('contextBudgetReceipt.totalTokens 与 tiers.includedTokens 不一致')
  }
  const demotedTiers = tiers.filter(tier => tier.demoted)
  let lastDemotionIndex = -1
  for (const tier of demotedTiers) {
    const demotionIndex = DEMOTION_ORDER.indexOf(tier.tierKey)
    if (demotionIndex === -1 || demotionIndex <= lastDemotionIndex) {
      fail('contextBudgetReceipt.demoted 层不符合固定降级顺序')
    }
    lastDemotionIndex = demotionIndex
  }
  if (demotedTiers.length > 0 && !overflowHandled) {
    fail('发生降级时必须标记 overflowHandled')
  }
  if (totalTokens > budgetTokens && !overflowHandled) {
    fail('超预算 receipt 必须标记 overflowHandled')
  }
  return { tiers, totalTokens, budgetTokens, overflowHandled }
}
