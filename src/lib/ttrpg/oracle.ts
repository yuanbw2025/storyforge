import type { RulePackV1 } from '../types'
import type { RuleDiceResolutionV1 } from './rule-pack'
import { resolveRulePackDiceModelV1, verifyRulePackDiceResolutionV2 } from './rule-pack'
import type { RulePackV2, TtrpgOracleTableV1, TtrpgOpenSocialTierMappingV1 } from './open-contract'
import { projectTtrpgRulePackMechanicalCoreV1 } from './rule-pack-v2'
import * as p from './open-contract-parse'
import { hashProductProductionValueV2 } from '../product-production/hash'

export const TTRPG_CHAOS_ADVANCE_TRIGGERS_V1 = [
  'failed-check', 'front-advanced', 'clock-complete', 'player-retreat',
] as const
export const TTRPG_CHAOS_RECEDE_TRIGGERS_V1 = [
  'situation-resolved', 'front-defeated', 'stage-closed',
] as const

export type TtrpgChaosAdvanceTriggerV1 = typeof TTRPG_CHAOS_ADVANCE_TRIGGERS_V1[number]
export type TtrpgChaosRecedeTriggerV1 = typeof TTRPG_CHAOS_RECEDE_TRIGGERS_V1[number]
export type TtrpgChaosTriggerV1 = TtrpgChaosAdvanceTriggerV1 | TtrpgChaosRecedeTriggerV1
export type TtrpgOracleRawResultV1 =
  | 'yes'
  | 'yes-but'
  | 'no-but'
  | 'no'
  | { entryKey: string }

export interface TtrpgChaosStateV1 {
  value: number
  lastChangedAtSequence: number
}

export interface TtrpgOracleOutcomeV1 {
  oracleKey: string
  question: string
  askedBy: 'gm' | `player:${string}` | `companion:${string}`
  likelihoodTierKey: string | null
  chaosValueAtRoll: number | null
  rawResult: TtrpgOracleRawResultV1
  finalized: true
  interpretationCandidateId: string | null
}

export interface TtrpgOracleEntrySelectionV1 {
  nonce: string
  weightTotal: number
  consumedSamples: number
  rejectedSamples: number
  index: number
}

export interface TtrpgOracleRollReceiptV1 {
  rulePackContentHash: string
  oracleKey: string
  commandId: string
  eventSequence: number
  diceModelKey: string
  nonce: string
  diceResolution: RuleDiceResolutionV1
  chaosBefore: number | null
  chaosAfter: number | null
  likelihoodTierKey: string | null
  entrySelection: TtrpgOracleEntrySelectionV1 | null
  selectedEntryKey: string | null
  receiptHash: string
}

export interface TtrpgOracleResolutionV1 {
  outcome: TtrpgOracleOutcomeV1
  rollReceipt: TtrpgOracleRollReceiptV1
}

export interface TtrpgOracleResolutionInputV1 {
  rulePack: RulePackV1 | RulePackV2
  oracleKey?: string
  oracle?: TtrpgOracleTableV1
  question: string
  askedBy: TtrpgOracleOutcomeV1['askedBy']
  seed: string
  commandId: string
  eventSequence: number
  chaosValue?: number | null
  likelihoodTierKey?: string | null
  socialTierMapping?: TtrpgOpenSocialTierMappingV1 | null
  socialBalanceValue?: number | null
  modifier?: number
}

export type TtrpgOracleForbiddenScopeV1 =
  'world-fact' | 'rule-change' | 'player-decision' | 'retcon'

export interface TtrpgOracleInterpretationScopeInputV1 {
  oracle: TtrpgOracleTableV1
  attemptedScopes: readonly TtrpgOracleForbiddenScopeV1[]
  newEntityCount: number
}

type OracleRulePackV1 = RulePackV1 | RulePackV2

const ORACLE_FIELDS = [
  'oracleKey', 'title', 'kind', 'diceModelKey', 'audience', 'chaosCoupled',
  'likelihood', 'entries', 'interpretation', 'tests', 'sourceRefs',
] as const
const CHAOS_VALUES = { minimum: 1, maximum: 9 }

function fail(message: string): never {
  return p.fail(`[ttrpg-oracle] ${message}`)
}

function finiteInteger(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return fail(`${label}: 必须是安全整数`)
  }
  return value
}

function assertExactKeys(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const row = p.object(value, label)
  p.exact(row, keys, label)
  return row
}

function assertClosedKeys(value: unknown, keys: readonly string[], label: string): void {
  const row = p.object(value, label)
  if (Object.keys(row).some(key => !keys.includes(key))) fail(`${label}: 字段不精确`)
}

function mechanicalRulePack(rulePack: OracleRulePackV1): RulePackV1 {
  return rulePack.version === 2
    ? projectTtrpgRulePackMechanicalCoreV1(rulePack)
    : rulePack
}

function diceBounds(rulePack: RulePackV1, diceModelKey: string): { minimum: number; maximum: number } {
  const dice = rulePack.diceModels.find(row => row.key === diceModelKey)
  if (!dice) return fail(`未知 diceModelKey:${diceModelKey}`)
  return {
    minimum: (dice.keep === 'all' ? dice.count : 1),
    maximum: dice.keep === 'all' ? dice.count * dice.sides : dice.sides,
  }
}

function parseAskedBy(value: unknown, label: string): TtrpgOracleOutcomeV1['askedBy'] {
  const result = p.text(value, label, 200)
  if (result === 'gm') return result
  const match = /^(player|companion):([A-Za-z0-9][A-Za-z0-9._:-]{0,199})$/.exec(result)
  if (!match) return fail(`${label}: askedBy 无效`)
  return result as TtrpgOracleOutcomeV1['askedBy']
}

function parseChaos(value: unknown, label: string): number | null {
  return p.nullable(value, (candidate, nestedLabel) =>
    p.integer(candidate, nestedLabel, CHAOS_VALUES.minimum, CHAOS_VALUES.maximum), label)
}

function parseOracleTest(value: unknown, label: string, tableKind: TtrpgOracleTableV1['kind'], chaosCoupled: boolean, tierKeys: readonly string[], entryKeys: readonly string[]) {
  const row = p.record(value, [
    'testKey', 'seed', 'nonce', 'chaosValue', 'likelihoodTierKey', 'expectedRawResult', 'expectedEntryKey',
  ], label)
  const chaosValue = parseChaos(row.chaosValue, `${label}.chaosValue`)
  const likelihoodTierKey = p.nullable(row.likelihoodTierKey, p.key, `${label}.likelihoodTierKey`)
  const expectedRawResult = p.nullable(row.expectedRawResult, (candidate, nestedLabel) =>
    p.oneOf(candidate, ['yes', 'yes-but', 'no-but', 'no'], nestedLabel), `${label}.expectedRawResult`)
  const expectedEntryKey = p.nullable(row.expectedEntryKey, p.key, `${label}.expectedEntryKey`)
  if (chaosCoupled !== (chaosValue !== null)) fail(`${label}: chaosValue 与 chaosCoupled 不匹配`)
  if (tableKind === 'yes-no') {
    if (likelihoodTierKey === null || expectedRawResult === null || expectedEntryKey !== null) {
      fail(`${label}: yes-no 测试字段无效`)
    }
    p.known(likelihoodTierKey, tierKeys, label)
  } else {
    if (likelihoodTierKey !== null || expectedRawResult !== null || expectedEntryKey === null) {
      fail(`${label}: entry 测试字段无效`)
    }
    p.known(expectedEntryKey, entryKeys, label)
  }
  return {
    testKey: p.key(row.testKey, label),
    seed: p.text(row.seed, label, 2_000),
    nonce: p.text(row.nonce, label, 2_000),
    chaosValue,
    likelihoodTierKey,
    expectedRawResult,
    expectedEntryKey,
  }
}

/**
 * The parser is intentionally independent from the RulePack V2 parser. P2's
 * parser keeps its own closed package parser; P4 uses this function anywhere a
 * runtime Oracle table is received as an isolated value.
 */
export function parseTtrpgOracleTableV1(input: unknown, rulePack?: RulePackV1 | RulePackV2): TtrpgOracleTableV1 {
  const row = p.record(p.json(input), ORACLE_FIELDS, 'oracle')
  const core = rulePack == null ? null : mechanicalRulePack(rulePack)
  const diceModelKey = p.key(row.diceModelKey, 'oracle.diceModelKey')
  const bounds = core == null ? null : diceBounds(core, diceModelKey)
  const kind = p.oneOf(row.kind, ['yes-no', 'meaning', 'event'], 'oracle.kind')
  const chaosCoupled = p.bool(row.chaosCoupled, 'oracle.chaosCoupled')
  const likelihood = p.nullable(row.likelihood, (value, label) => {
    const likelihoodRow = p.record(value, ['tiers', 'defaultTierKey'], label)
    const tiers = p.list(likelihoodRow.tiers, label, (tierValue, tierLabel) => {
      const tier = p.record(tierValue, [
        'tierKey', 'label', 'yesAtOrAbove', 'yesButBand', 'noButBand',
      ], tierLabel)
      const minimum = bounds?.minimum ?? 0
      const maximum = bounds?.maximum ?? 1_000_000
      const yesAtOrAbove = p.integer(tier.yesAtOrAbove, tierLabel, minimum, maximum)
      return {
        tierKey: p.key(tier.tierKey, tierLabel),
        label: p.text(tier.label, tierLabel, 300),
        yesAtOrAbove,
        yesButBand: p.integer(tier.yesButBand, tierLabel, 0, maximum - yesAtOrAbove + 1),
        noButBand: p.integer(tier.noButBand, tierLabel, 0, yesAtOrAbove - minimum),
      }
    }, 100, 1)
    p.unique(tiers.map(tier => tier.tierKey), label)
    const defaultTierKey = p.key(likelihoodRow.defaultTierKey, label)
    p.known(defaultTierKey, tiers.map(tier => tier.tierKey), label)
    return { tiers, defaultTierKey }
  }, 'oracle.likelihood')
  const entries = p.nullable(row.entries, (value, label) => p.list(value, label, (entryValue, entryLabel) => {
    const entry = p.record(entryValue, ['entryKey', 'weight', 'text', 'tags'], entryLabel)
    return {
      entryKey: p.key(entry.entryKey, entryLabel),
      weight: p.integer(entry.weight, entryLabel, 1, 1_000),
      text: p.text(entry.text, entryLabel, 2_000),
      tags: p.texts(entry.tags, entryLabel, 100),
    }
  }, 1_000, 4), 'oracle.entries')
  if ((kind === 'yes-no') !== (likelihood !== null) || (kind === 'yes-no') !== (entries === null)) {
    fail('oracle.kind 与 likelihood/entries 字段组合无效')
  }
  if (entries) {
    p.unique(entries.map(entry => entry.entryKey), 'oracle.entries')
    if (entries.reduce((sum, entry) => sum + entry.weight, 0) > 100_000) fail('Oracle 总权重超过100000')
  }
  const interpretation = p.record(row.interpretation, [
    'mustRespect', 'forbiddenScopes', 'maxNewEntities',
  ], 'oracle.interpretation')
  const forbiddenScopes = p.unique(p.list(
    interpretation.forbiddenScopes,
    'oracle.interpretation.forbiddenScopes',
    (value, label) => p.oneOf(value, ['world-fact', 'rule-change', 'player-decision', 'retcon'], label),
    4,
    4,
  ), 'oracle.interpretation.forbiddenScopes')
  const tierKeys = likelihood?.tiers.map(tier => tier.tierKey) ?? []
  const entryKeys = entries?.map(entry => entry.entryKey) ?? []
  const tests = p.list(row.tests, 'oracle.tests', (value, label) =>
    parseOracleTest(value, label, kind, chaosCoupled, tierKeys, entryKeys), 1_000, 1)
  p.unique(tests.map(test => test.testKey), 'oracle.tests')
  if (core && !core.diceModels.some(dice => dice.key === diceModelKey)) {
    fail(`未知 diceModelKey:${diceModelKey}`)
  }
  return {
    oracleKey: p.key(row.oracleKey, 'oracle.oracleKey'),
    title: p.text(row.title, 'oracle.title', 300),
    kind,
    diceModelKey,
    audience: p.oneOf(row.audience, ['gm-only', 'party', 'public'], 'oracle.audience'),
    chaosCoupled,
    likelihood,
    entries,
    interpretation: {
      mustRespect: p.texts(interpretation.mustRespect, 'oracle.interpretation.mustRespect', 100, 1),
      forbiddenScopes,
      maxNewEntities: p.integer(interpretation.maxNewEntities, 'oracle.interpretation.maxNewEntities', 0, 3),
    },
    tests,
    sourceRefs: p.keys(row.sourceRefs, 'oracle.sourceRefs', 100, 1),
  }
}

export async function selectTtrpgOracleEntryIndexV1(input: {
  seed: string
  nonce: string
  weightTotal: number
}): Promise<{ index: number; consumedSamples: number; rejectedSamples: number }> {
  assertExactKeys(input, ['seed', 'nonce', 'weightTotal'], 'select')
  const seed = p.text(input.seed, 'select.seed', 10_000)
  const nonce = p.text(input.nonce, 'select.nonce', 2_000)
  const weightTotal = p.integer(input.weightTotal, 'select.weightTotal', 1, 100_000)
  const acceptedRange = Math.floor(0x1_0000_0000 / weightTotal) * weightTotal
  const encoder = new TextEncoder()
  let consumedSamples = 0
  let rejectedSamples = 0
  let blockIndex = 0
  while (true) {
    const digest = new Uint8Array(await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(`${seed}:${nonce}:${blockIndex}`),
    ))
    const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength)
    for (let offset = 0; offset <= digest.byteLength - 4; offset += 4) {
      const sample = view.getUint32(offset, false)
      consumedSamples += 1
      if (sample < acceptedRange) {
        return { index: sample % weightTotal, consumedSamples, rejectedSamples }
      }
      rejectedSamples += 1
    }
    blockIndex += 1
  }
}

function rawResultForYesNo(
  total: number,
  tier: NonNullable<TtrpgOracleTableV1['likelihood']>['tiers'][number],
  chaosValue: number | null,
  minimum: number,
  maximum: number,
  chaosCoupled: boolean,
): TtrpgOracleRawResultV1 {
  const threshold = Math.min(
    maximum,
    Math.max(
      minimum,
      tier.yesAtOrAbove + (chaosCoupled ? (chaosValue! - 5) : 0),
    ),
  )
  if (total >= threshold + tier.yesButBand) return 'yes'
  if (total >= threshold) return 'yes-but'
  if (total >= threshold - tier.noButBand) return 'no-but'
  return 'no'
}

function selectedEntry(
  table: TtrpgOracleTableV1,
  selection: TtrpgOracleEntrySelectionV1,
): string {
  const entries = [...(table.entries ?? [])].sort((left, right) => left.entryKey.localeCompare(right.entryKey))
  let cursor = 0
  for (const entry of entries) {
    cursor += entry.weight
    if (selection.index < cursor) return entry.entryKey
  }
  return fail('entrySelection.index 不在词条区间内')
}

function resolveTier(
  table: TtrpgOracleTableV1,
  requestedTierKey: string | null | undefined,
  socialTierMapping?: TtrpgOpenSocialTierMappingV1 | null,
  socialBalanceValue?: number | null,
): NonNullable<TtrpgOracleTableV1['likelihood']>['tiers'][number] | null {
  if (!table.likelihood) return null
  const explicit = table.likelihood.tiers.find(tier => tier.tierKey === requestedTierKey)
  if (explicit) return explicit
  if (socialTierMapping && socialBalanceValue != null) {
    const range = socialTierMapping.ranges.find(candidate =>
      (candidate.minimumInclusive ? socialBalanceValue >= candidate.minimum : socialBalanceValue > candidate.minimum)
      && (candidate.maximumInclusive ? socialBalanceValue <= candidate.maximum : socialBalanceValue < candidate.maximum))
    const mappedKey = range?.tierKey ?? socialTierMapping.defaultTierKey
    const mappedTier = table.likelihood.tiers.find(tier => tier.tierKey === mappedKey)
    if (mappedTier) return mappedTier
  }
  return table.likelihood.tiers.find(tier => tier.tierKey === table.likelihood!.defaultTierKey)
    ?? fail('Oracle 缺少 default likelihood tier')
}

function assertResolutionInput(input: TtrpgOracleResolutionInputV1): void {
  assertClosedKeys(input, [
    'rulePack', 'oracleKey', 'oracle', 'question', 'askedBy', 'seed', 'commandId',
    'eventSequence', 'chaosValue', 'likelihoodTierKey', 'socialTierMapping',
    'socialBalanceValue', 'modifier',
  ], 'resolveTtrpgOracleV1')
  p.key(input.oracle?.oracleKey ?? input.oracleKey, 'oracleKey')
  p.text(input.question, 'question', 2_000)
  parseAskedBy(input.askedBy, 'askedBy')
  p.text(input.seed, 'seed', 10_000)
  p.key(input.commandId, 'commandId')
  finiteInteger(input.eventSequence, 'eventSequence')
  if (input.modifier != null && (!Number.isSafeInteger(input.modifier) || input.modifier < -1_000 || input.modifier > 1_000)) {
    fail('modifier 无效')
  }
}

export async function resolveTtrpgOracleV1(input: TtrpgOracleResolutionInputV1): Promise<TtrpgOracleResolutionV1> {
  assertResolutionInput(input)
  const table = parseTtrpgOracleTableV1(
    input.oracle
      ?? (input.rulePack.version === 2
        ? input.rulePack.oracles.find(oracle => oracle.oracleKey === input.oracleKey) ?? fail(`未知 Oracle:${input.oracleKey ?? 'unknown'}`)
        : fail('RulePack V1 没有冻结 Oracle 表')),
    input.rulePack,
  )
  const core = mechanicalRulePack(input.rulePack)
  const modifier = input.modifier ?? 0
  const nonce = `oracle:${table.oracleKey}:${input.commandId}`
  const chaosValue = table.chaosCoupled
    ? parseChaos(input.chaosValue ?? null, 'chaosValue') ?? fail('chaosCoupled Oracle 必须提供 chaosValue')
    : null
  const tier = resolveTier(table, input.likelihoodTierKey, input.socialTierMapping, input.socialBalanceValue)
  const diceResolution = await resolveRulePackDiceModelV1({
    rulePack: core,
    diceModelKey: table.diceModelKey,
    seed: input.seed,
    nonce,
    modifier,
  })
  const bounds = diceBounds(core, table.diceModelKey)
  const adjustedMinimum = bounds.minimum + modifier
  const adjustedMaximum = bounds.maximum + modifier
  const entrySelection = table.kind === 'yes-no'
    ? null
    : await selectTtrpgOracleEntryIndexV1({
      seed: input.seed,
      nonce: `${nonce}:entry`,
      weightTotal: table.entries!.reduce((sum, entry) => sum + entry.weight, 0),
    }).then(selection => ({
      ...selection,
      nonce: `${nonce}:entry`,
      weightTotal: table.entries!.reduce((sum, entry) => sum + entry.weight, 0),
    }))
  const selectedEntryKey = entrySelection ? selectedEntry(table, entrySelection) : null
  const rawResult = table.kind === 'yes-no'
    ? rawResultForYesNo(
      diceResolution.total,
      tier!,
      chaosValue,
      adjustedMinimum,
      adjustedMaximum,
      table.chaosCoupled,
    )
    : { entryKey: selectedEntryKey! }
  const outcome: TtrpgOracleOutcomeV1 = {
    oracleKey: table.oracleKey,
    question: p.text(input.question, 'question', 2_000),
    askedBy: parseAskedBy(input.askedBy, 'askedBy'),
    likelihoodTierKey: tier?.tierKey ?? null,
    chaosValueAtRoll: chaosValue,
    rawResult,
    finalized: true,
    interpretationCandidateId: null,
  }
  const receiptBody: Omit<TtrpgOracleRollReceiptV1, 'receiptHash'> = {
    rulePackContentHash: await hashProductProductionValueV2(input.rulePack),
    oracleKey: table.oracleKey,
    commandId: input.commandId,
    eventSequence: input.eventSequence,
    diceModelKey: table.diceModelKey,
    nonce,
    diceResolution,
    chaosBefore: chaosValue,
    chaosAfter: chaosValue,
    likelihoodTierKey: tier?.tierKey ?? null,
    entrySelection,
    selectedEntryKey,
  }
  return {
    outcome,
    rollReceipt: {
      ...receiptBody,
      receiptHash: await hashProductProductionValueV2(receiptBody),
    },
  }
}

function assertReceiptShape(receipt: TtrpgOracleRollReceiptV1): void {
  assertExactKeys(receipt, [
    'rulePackContentHash', 'oracleKey', 'commandId', 'eventSequence', 'diceModelKey',
    'nonce', 'diceResolution', 'chaosBefore', 'chaosAfter', 'likelihoodTierKey',
    'entrySelection', 'selectedEntryKey', 'receiptHash',
  ], 'rollReceipt')
  if (receipt.entrySelection !== null) {
    assertExactKeys(receipt.entrySelection, [
      'nonce', 'weightTotal', 'consumedSamples', 'rejectedSamples', 'index',
    ], 'rollReceipt.entrySelection')
  }
}

/** Closed persisted values; cryptographic seed/receipt verification remains asynchronous. */
export function parseTtrpgOracleResolutionV1(value: unknown, rulePack: RulePackV2): TtrpgOracleResolutionV1 {
  const root = p.record(value, ['outcome', 'rollReceipt'], 'oracle resolution')
  const o = p.record(root.outcome, ['oracleKey', 'question', 'askedBy', 'likelihoodTierKey', 'chaosValueAtRoll', 'rawResult', 'finalized', 'interpretationCandidateId'], 'oracle outcome')
  const r = p.record(root.rollReceipt, ['rulePackContentHash', 'oracleKey', 'commandId', 'eventSequence', 'diceModelKey', 'nonce', 'diceResolution', 'chaosBefore', 'chaosAfter', 'likelihoodTierKey', 'entrySelection', 'selectedEntryKey', 'receiptHash'], 'oracle receipt')
  const table = rulePack.oracles.find(table => table.oracleKey === o.oracleKey) ?? fail('结果没有冻结 Oracle 表')
  const core = mechanicalRulePack(rulePack)
  const model = core.diceModels.find(model => model.key === table.diceModelKey) ?? fail('结果缺少骰子模型')
  const d = p.record(r.diceResolution, ['diceModelKey', 'dice', 'keptDice', 'modifier', 'total', 'rollTrace', 'seedCommitment', 'nonce', 'proofHash'], 'oracle dice')
  const t = p.record(d.rollTrace, ['algorithm', 'sides', 'requestedDice', 'consumedSamples', 'rejectedSamples'], 'oracle dice trace')
  const dice = p.list(d.dice, 'oracle dice', v => p.integer(v, 'die', 1, model.sides), model.count, model.count)
  const keptDice = p.list(d.keptDice, 'oracle kept dice', v => p.integer(v, 'kept die', 1, model.sides), model.count, 1)
  const expectedKept = model.keep === 'all' ? dice : [model.keep === 'highest' ? Math.max(...dice) : Math.min(...dice)]
  const modifier = p.integer(d.modifier, 'oracle modifier', -1000, 1000)
  const total = p.integer(d.total, 'oracle total', -1000, 1_000_000)
  const nonce = p.text(r.nonce, 'oracle nonce', 2000)
  const commandId = p.key(r.commandId, 'oracle command')
  const chaosBefore = parseChaos(r.chaosBefore, 'oracle chaos')
  const likelihoodTierKey = p.nullable(r.likelihoodTierKey, p.key, 'oracle tier')
  const entrySelection = r.entrySelection === null ? null : (() => {
    const e = p.record(r.entrySelection, ['nonce', 'weightTotal', 'consumedSamples', 'rejectedSamples', 'index'], 'oracle entry selection')
    const weightTotal = p.integer(e.weightTotal, 'oracle weight', 1, 100000)
    const consumedSamples = p.integer(e.consumedSamples, 'entry consumed', 1, Number.MAX_SAFE_INTEGER)
    const rejectedSamples = p.integer(e.rejectedSamples, 'entry rejected', 0, Number.MAX_SAFE_INTEGER)
    if (consumedSamples !== rejectedSamples + 1 || e.nonce !== `${nonce}:entry`
      || weightTotal !== table.entries?.reduce((sum, entry) => sum + entry.weight, 0)) fail('词条采样回执不一致')
    return { nonce: p.text(e.nonce, 'entry nonce', 2000), weightTotal, consumedSamples, rejectedSamples, index: p.integer(e.index, 'entry index', 0, weightTotal - 1) }
  })()
  const selectedEntryKey = p.nullable(r.selectedEntryKey, p.key, 'selected entry')
  const rawResult: TtrpgOracleRawResultV1 = typeof o.rawResult === 'string'
    ? p.oneOf(o.rawResult, ['yes', 'yes-but', 'no-but', 'no'], 'oracle result')
    : { entryKey: p.key(p.record(o.rawResult, ['entryKey'], 'entry result').entryKey, 'entry key') }
  const tier = resolveTier(table, likelihoodTierKey)
  const bounds = diceBounds(core, model.key)
  const expectedRaw = table.kind === 'yes-no'
    ? rawResultForYesNo(total, tier!, chaosBefore, bounds.minimum + modifier, bounds.maximum + modifier, table.chaosCoupled)
    : entrySelection ? { entryKey: selectedEntry(table, entrySelection) } : fail('词条结果缺少采样')
  if (JSON.stringify(keptDice) !== JSON.stringify(expectedKept) || total !== keptDice.reduce((sum, die) => sum + die, 0) + modifier
    || d.diceModelKey !== model.key || r.diceModelKey !== model.key || r.oracleKey !== table.oracleKey
    || nonce !== `oracle:${table.oracleKey}:${commandId}` || d.nonce !== nonce || modifier !== 0
    || t.algorithm !== 'uint32-rejection-v2' || t.sides !== model.sides || t.requestedDice !== model.count
    || Number(t.consumedSamples) !== Number(t.rejectedSamples) + model.count
    || r.chaosAfter !== chaosBefore || o.chaosValueAtRoll !== chaosBefore || table.chaosCoupled !== (chaosBefore !== null)
    || (tier?.tierKey ?? null) !== likelihoodTierKey || o.likelihoodTierKey !== likelihoodTierKey
    || (table.kind === 'yes-no') !== (entrySelection === null) || selectedEntryKey !== (entrySelection ? selectedEntry(table, entrySelection) : null)
    || JSON.stringify(rawResult) !== JSON.stringify(expectedRaw) || o.interpretationCandidateId !== null) fail('Oracle 原始结果或冻结回执被改换')
  return { outcome: { oracleKey: table.oracleKey, question: p.text(o.question, 'oracle question', 2000), askedBy: parseAskedBy(o.askedBy, 'oracle askedBy'),
    likelihoodTierKey, chaosValueAtRoll: chaosBefore, rawResult, finalized: p.literal(o.finalized, true, 'oracle finalized'), interpretationCandidateId: null },
    rollReceipt: { rulePackContentHash: p.hash(r.rulePackContentHash, 'oracle rule hash'), oracleKey: table.oracleKey, commandId,
      eventSequence: p.integer(r.eventSequence, 'oracle sequence', 1, Number.MAX_SAFE_INTEGER), diceModelKey: model.key, nonce,
      diceResolution: { diceModelKey: model.key, dice, keptDice, modifier, total, rollTrace: { algorithm: 'uint32-rejection-v2', sides: model.sides, requestedDice: model.count,
        consumedSamples: p.integer(t.consumedSamples, 'dice consumed', model.count, Number.MAX_SAFE_INTEGER), rejectedSamples: p.integer(t.rejectedSamples, 'dice rejected', 0, Number.MAX_SAFE_INTEGER) },
        seedCommitment: p.hash(d.seedCommitment, 'oracle seed'), nonce, proofHash: p.hash(d.proofHash, 'oracle dice proof') },
      chaosBefore, chaosAfter: chaosBefore, likelihoodTierKey, entrySelection, selectedEntryKey, receiptHash: p.hash(r.receiptHash, 'oracle receipt hash') } }
}

export async function verifyTtrpgOracleOutcomeV1(input: {
  rulePack: RulePackV1 | RulePackV2
  seed: string
  outcome: TtrpgOracleOutcomeV1
  rollReceipt: TtrpgOracleRollReceiptV1
  modifier?: number
}): Promise<boolean> {
  try {
    assertReceiptShape(input.rollReceipt)
    const tableValue = input.rulePack.version === 2
      ? input.rulePack.oracles.find(oracle => oracle.oracleKey === input.rollReceipt.oracleKey)
      : null
    if (!tableValue) return false
    const table = parseTtrpgOracleTableV1(tableValue, input.rulePack)
    const core = mechanicalRulePack(input.rulePack)
    const receipt = input.rollReceipt
    const modifier = input.modifier ?? receipt.diceResolution.modifier
    const expectedRuleHash = await hashProductProductionValueV2(input.rulePack)
    if (receipt.rulePackContentHash !== expectedRuleHash
      || receipt.oracleKey !== table.oracleKey
      || receipt.diceModelKey !== table.diceModelKey
      || receipt.nonce !== `oracle:${table.oracleKey}:${receipt.commandId}`
      || receipt.chaosBefore !== receipt.chaosAfter
      || input.outcome.oracleKey !== receipt.oracleKey
      || input.outcome.likelihoodTierKey !== receipt.likelihoodTierKey
      || input.outcome.chaosValueAtRoll !== receipt.chaosBefore
      || !p.text(input.outcome.question, 'outcome.question', 2_000)
      || parseAskedBy(input.outcome.askedBy, 'outcome.askedBy') !== input.outcome.askedBy
      || input.outcome.finalized !== true) return false
    const diceValid = await verifyRulePackDiceResolutionV2({
      rulePack: core,
      diceModelKey: table.diceModelKey,
      seed: input.seed,
      nonce: receipt.nonce,
      modifier,
      resolution: receipt.diceResolution,
    })
    if (!diceValid) return false
    const receiptBody = { ...receipt }
    delete (receiptBody as Partial<TtrpgOracleRollReceiptV1>).receiptHash
    if (await hashProductProductionValueV2(receiptBody) !== receipt.receiptHash) return false
    const chaosValue = table.chaosCoupled
      ? parseChaos(receipt.chaosBefore, 'receipt.chaosBefore')
      : null
    if (table.chaosCoupled !== (chaosValue !== null)
      || table.chaosCoupled !== (input.outcome.chaosValueAtRoll !== null)) return false
    const tier = resolveTier(table, receipt.likelihoodTierKey)
    if ((tier?.tierKey ?? null) !== receipt.likelihoodTierKey) return false
    let expectedRawResult: TtrpgOracleRawResultV1
    let expectedSelectedEntryKey: string | null = null
    if (table.kind === 'yes-no') {
      if (receipt.entrySelection !== null || receipt.selectedEntryKey !== null || !tier) return false
      const bounds = diceBounds(core, table.diceModelKey)
      const modifierForBounds = input.modifier ?? receipt.diceResolution.modifier
      expectedRawResult = rawResultForYesNo(
        receipt.diceResolution.total,
        tier,
        chaosValue,
        bounds.minimum + modifierForBounds,
        bounds.maximum + modifierForBounds,
        table.chaosCoupled,
      )
    } else {
      if (!receipt.entrySelection || !table.entries || receipt.selectedEntryKey === null || receipt.likelihoodTierKey !== null) return false
      const entries = [...table.entries].sort((left, right) => left.entryKey.localeCompare(right.entryKey))
      const weightTotal = entries.reduce((sum, entry) => sum + entry.weight, 0)
      const expectedSelection = await selectTtrpgOracleEntryIndexV1({
        seed: input.seed,
        nonce: receipt.entrySelection.nonce,
        weightTotal,
      })
      if (receipt.entrySelection.nonce !== `${receipt.nonce}:entry`
        || receipt.entrySelection.weightTotal !== weightTotal
        || receipt.entrySelection.index !== expectedSelection.index
        || receipt.entrySelection.consumedSamples !== expectedSelection.consumedSamples
        || receipt.entrySelection.rejectedSamples !== expectedSelection.rejectedSamples) return false
      expectedSelectedEntryKey = selectedEntry(table, receipt.entrySelection)
      if (receipt.selectedEntryKey !== expectedSelectedEntryKey) return false
      expectedRawResult = { entryKey: expectedSelectedEntryKey }
    }
    return JSON.stringify(input.outcome.rawResult) === JSON.stringify(expectedRawResult)
  } catch {
    return false
  }
}

export function assertTtrpgOracleInterpretationScopeV1(input: TtrpgOracleInterpretationScopeInputV1): void {
  const table = parseTtrpgOracleTableV1(input.oracle)
  if (!Number.isSafeInteger(input.newEntityCount) || input.newEntityCount < 0) {
    fail('interpretation.newEntityCount 无效')
  }
  if (input.newEntityCount > table.interpretation.maxNewEntities) {
    fail('oracle-scope:max-new-entities')
  }
  for (const scope of input.attemptedScopes) {
    if (!table.interpretation.forbiddenScopes.includes(scope)) continue
    fail(`oracle-scope:${scope}`)
  }
}

export function advanceTtrpgChaosV1(input: {
  state: TtrpgChaosStateV1
  trigger: TtrpgChaosTriggerV1
  eventSequence: number
}): TtrpgChaosStateV1 {
  const value = finiteInteger(input.state.value, 'chaos.value', 1, 9)
  finiteInteger(input.state.lastChangedAtSequence, 'chaos.lastChangedAtSequence')
  const eventSequence = finiteInteger(input.eventSequence, 'eventSequence')
  if (![...TTRPG_CHAOS_ADVANCE_TRIGGERS_V1, ...TTRPG_CHAOS_RECEDE_TRIGGERS_V1].includes(input.trigger)) {
    fail(`未知 chaos trigger:${input.trigger}`)
  }
  const nextValue = TTRPG_CHAOS_ADVANCE_TRIGGERS_V1.includes(input.trigger as TtrpgChaosAdvanceTriggerV1)
    ? Math.min(9, value + 1)
    : Math.max(1, value - 1)
  return { value: nextValue, lastChangedAtSequence: eventSequence }
}
