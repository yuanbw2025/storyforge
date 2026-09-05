import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import type {
  ProductRuntimeEvent,
  TextOpenWorldEffectChangeV1,
  TextOpenWorldEffectDefinitionV1,
  TextOpenWorldEffectImpactDomainV1,
  TextOpenWorldEffectPlanV1,
  TextOpenWorldEffectReceiptV1,
  TextOpenWorldEffectsAppliedEventPayloadV1,
  TextOpenWorldEventBatchProjectionV1,
  TextOpenWorldEventProtocolProjectionV1,
  TextOpenWorldRandomEvidenceV1,
  TextOpenWorldRandomRequestV1,
  TextOpenWorldRandomResolvedEventPayloadV1,
  TextOpenWorldRulesetStampV1,
} from '../types'
import { parseTextOpenWorldCommandEventPayloadV1 } from './command-contract'

type Row = Record<string, unknown>

const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const STABLE_KEY = /^[a-z][a-z0-9._:-]{0,199}$/
const IMPACT_DOMAINS: TextOpenWorldEffectImpactDomainV1[] = ['player', 'inventory', 'quests', 'map', 'time', 'relationships', 'combat', 'actors', 'world', 'knowledge', 'endings']

function fail(message: string): never { throw new Error(`[text-open-world-event] ${message}`) }
function row(value: unknown, label: string): Row { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}必须是对象`); return value as Row }
function exact(value: Row, fields: readonly string[], label: string) {
  const expected = [...fields].sort(); const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((field, index) => field !== actual[index])) fail(`${label}字段不符合合同:${actual.join(',')}`)
}
function token(value: unknown, label: string, pattern = STABLE_KEY): string { if (typeof value !== 'string' || !pattern.test(value)) fail(`${label}无效`); return value }
function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label}必须是安全整数`); return Number(value) }
function hash(value: unknown, label: string): string { if (!isSha256Hash(value)) fail(`${label}不是SHA-256`); return value }
function text(value: unknown, label: string, maximum = 2_000): string { if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label}无效`); return value.trim() }
function uniqueStrings(value: unknown, label: string, allowed?: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) fail(`${label}必须是数组`)
  const values = value.map((item, index) => token(item, `${label}[${index}]`))
  if (new Set(values).size !== values.length) fail(`${label}不能重复`)
  if (allowed) values.forEach(item => { if (!allowed.has(item)) fail(`${label}值无效:${item}`) })
  return values
}
function uniqueIntegers(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) fail(`${label}必须是数组`)
  const values = value.map((item, index) => integer(item, `${label}[${index}]`, 1))
  if (new Set(values).size !== values.length) fail(`${label}不能重复`)
  return values
}

function parseRuleset(value: unknown, label: string): TextOpenWorldRulesetStampV1 {
  const parsed = row(value, label); exact(parsed, ['key', 'version'], label)
  return { key: token(parsed.key, `${label}.key`), version: integer(parsed.version, `${label}.version`, 1, 1_000_000) }
}

export function parseTextOpenWorldRandomRequestV1(value: unknown, label = 'randomRequest'): TextOpenWorldRandomRequestV1 {
  const parsed = row(value, label); exact(parsed, ['drawKey', 'minimumInclusive', 'maximumInclusive'], label)
  const minimumInclusive = integer(parsed.minimumInclusive, `${label}.minimumInclusive`, -1_000_000_000, 1_000_000_000)
  const maximumInclusive = integer(parsed.maximumInclusive, `${label}.maximumInclusive`, -1_000_000_000, 1_000_000_000)
  if (maximumInclusive < minimumInclusive) fail(`${label}范围倒置`)
  return { drawKey: token(parsed.drawKey, `${label}.drawKey`), minimumInclusive, maximumInclusive }
}

function parseRandomEvidence(value: unknown, label: string): TextOpenWorldRandomEvidenceV1 {
  const parsed = row(value, label); exact(parsed, ['drawKey', 'minimumInclusive', 'maximumInclusive', 'algorithm', 'seedHash', 'inputHash', 'drawIndex', 'value'], label)
  if (parsed.algorithm !== 'sha256-range-v1') fail(`${label}.algorithm无效`)
  const request = parseTextOpenWorldRandomRequestV1({ drawKey: parsed.drawKey, minimumInclusive: parsed.minimumInclusive, maximumInclusive: parsed.maximumInclusive }, label)
  const result = {
    ...request, algorithm: 'sha256-range-v1' as const,
    seedHash: hash(parsed.seedHash, `${label}.seedHash`), inputHash: hash(parsed.inputHash, `${label}.inputHash`),
    drawIndex: integer(parsed.drawIndex, `${label}.drawIndex`, 0, 1_000_000),
    value: integer(parsed.value, `${label}.value`, request.minimumInclusive, request.maximumInclusive),
  }
  return result
}

function requestFromEvidence(evidence: TextOpenWorldRandomEvidenceV1): TextOpenWorldRandomRequestV1 {
  return { drawKey: evidence.drawKey, minimumInclusive: evidence.minimumInclusive, maximumInclusive: evidence.maximumInclusive }
}

function parseChange(value: unknown, label: string): TextOpenWorldEffectChangeV1 {
  const parsed = row(value, label); exact(parsed, ['effectKey', 'domain', 'operation', 'summary', 'before', 'after'], label)
  canonicalProductProductionJsonV2(parsed.before); canonicalProductProductionJsonV2(parsed.after)
  const domain = token(parsed.domain, `${label}.domain`) as TextOpenWorldEffectImpactDomainV1
  if (!IMPACT_DOMAINS.includes(domain)) fail(`${label}.domain无效`)
  return {
    effectKey: token(parsed.effectKey, `${label}.effectKey`), domain,
    operation: token(parsed.operation, `${label}.operation`) as TextOpenWorldEffectChangeV1['operation'],
    summary: text(parsed.summary, `${label}.summary`), before: structuredClone(parsed.before), after: structuredClone(parsed.after),
  }
}

function parsePlan(value: unknown, label: string): TextOpenWorldEffectPlanV1 {
  const parsed = row(value, label); exact(parsed, ['schema', 'version', 'claimKey', 'baseStateHash', 'resultingStateHash', 'effectKeys', 'effects', 'impactDomains', 'previewChanges', 'planHash'], label)
  if (parsed.schema !== 'storyforge.text-open-world.effect-plan' || parsed.version !== 1) fail(`${label} schema/version无效`)
  const effectKeys = uniqueStrings(parsed.effectKeys, `${label}.effectKeys`)
  if (!Array.isArray(parsed.effects) || parsed.effects.length !== effectKeys.length) fail(`${label}.effects无效`)
  const effects = parsed.effects.map((value, index) => {
    const effect = row(value, `${label}.effects[${index}]`); exact(effect, ['key', 'operation', 'payload'], `${label}.effects[${index}]`)
    if (token(effect.key, `${label}.effects[${index}].key`) !== effectKeys[index]) fail(`${label}.effects与effectKeys顺序不一致`)
    token(effect.operation, `${label}.effects[${index}].operation`); canonicalProductProductionJsonV2(effect.payload)
    return structuredClone(effect) as TextOpenWorldEffectDefinitionV1
  })
  const impactDomains = uniqueStrings(parsed.impactDomains, `${label}.impactDomains`, new Set(IMPACT_DOMAINS)) as TextOpenWorldEffectImpactDomainV1[]
  if (!Array.isArray(parsed.previewChanges)) fail(`${label}.previewChanges必须是数组`)
  return {
    schema: 'storyforge.text-open-world.effect-plan', version: 1,
    claimKey: token(parsed.claimKey, `${label}.claimKey`, COMMAND_ID),
    baseStateHash: hash(parsed.baseStateHash, `${label}.baseStateHash`), resultingStateHash: hash(parsed.resultingStateHash, `${label}.resultingStateHash`),
    effectKeys, effects, impactDomains,
    previewChanges: parsed.previewChanges.map((item, index) => parseChange(item, `${label}.previewChanges[${index}]`)),
    planHash: hash(parsed.planHash, `${label}.planHash`),
  }
}

function parseReceipt(value: unknown, label: string): TextOpenWorldEffectReceiptV1 {
  const parsed = row(value, label); exact(parsed, ['schema', 'version', 'claimKey', 'planHash', 'baseStateHash', 'resultingStateHash', 'impactDomains', 'changes'], label)
  if (parsed.schema !== 'storyforge.text-open-world.effect-receipt' || parsed.version !== 1) fail(`${label} schema/version无效`)
  if (!Array.isArray(parsed.changes)) fail(`${label}.changes必须是数组`)
  return {
    schema: 'storyforge.text-open-world.effect-receipt', version: 1,
    claimKey: token(parsed.claimKey, `${label}.claimKey`, COMMAND_ID), planHash: hash(parsed.planHash, `${label}.planHash`),
    baseStateHash: hash(parsed.baseStateHash, `${label}.baseStateHash`), resultingStateHash: hash(parsed.resultingStateHash, `${label}.resultingStateHash`),
    impactDomains: uniqueStrings(parsed.impactDomains, `${label}.impactDomains`, new Set(IMPACT_DOMAINS)) as TextOpenWorldEffectImpactDomainV1[],
    changes: parsed.changes.map((item, index) => parseChange(item, `${label}.changes[${index}]`)),
  }
}

export function parseTextOpenWorldRandomResolvedEventPayloadV1(value: unknown): TextOpenWorldRandomResolvedEventPayloadV1 {
  const parsed = row(value, 'randomEvent'); exact(parsed, ['schema', 'version', 'commandId', 'commandSequence', 'ruleset', 'evidence'], 'randomEvent')
  if (parsed.schema !== 'storyforge.text-open-world.random-resolved-event' || parsed.version !== 1) fail('randomEvent schema/version无效')
  return {
    schema: 'storyforge.text-open-world.random-resolved-event', version: 1,
    commandId: token(parsed.commandId, 'randomEvent.commandId', COMMAND_ID), commandSequence: integer(parsed.commandSequence, 'randomEvent.commandSequence', 1),
    ruleset: parseRuleset(parsed.ruleset, 'randomEvent.ruleset'), evidence: parseRandomEvidence(parsed.evidence, 'randomEvent.evidence'),
  }
}

export function parseTextOpenWorldEffectsAppliedEventPayloadV1(value: unknown): TextOpenWorldEffectsAppliedEventPayloadV1 {
  const parsed = row(value, 'effectsEvent'); exact(parsed, ['schema', 'version', 'commandId', 'commandSequence', 'ruleset', 'randomEventSequences', 'plan', 'receipt', 'outcomeFingerprint'], 'effectsEvent')
  if (parsed.schema !== 'storyforge.text-open-world.effects-applied-event' || parsed.version !== 1) fail('effectsEvent schema/version无效')
  const plan = parsePlan(parsed.plan, 'effectsEvent.plan'); const receipt = parseReceipt(parsed.receipt, 'effectsEvent.receipt')
  if (receipt.claimKey !== plan.claimKey || receipt.planHash !== plan.planHash || receipt.baseStateHash !== plan.baseStateHash || receipt.resultingStateHash !== plan.resultingStateHash || canonicalProductProductionJsonV2(receipt.impactDomains) !== canonicalProductProductionJsonV2(plan.impactDomains) || canonicalProductProductionJsonV2(receipt.changes) !== canonicalProductProductionJsonV2(plan.previewChanges)) fail('effectsEvent plan与receipt不一致')
  return {
    schema: 'storyforge.text-open-world.effects-applied-event', version: 1,
    commandId: token(parsed.commandId, 'effectsEvent.commandId', COMMAND_ID), commandSequence: integer(parsed.commandSequence, 'effectsEvent.commandSequence', 1),
    ruleset: parseRuleset(parsed.ruleset, 'effectsEvent.ruleset'), randomEventSequences: uniqueIntegers(parsed.randomEventSequences, 'effectsEvent.randomEventSequences'),
    plan, receipt, outcomeFingerprint: hash(parsed.outcomeFingerprint, 'effectsEvent.outcomeFingerprint'),
  }
}

export async function resolveTextOpenWorldRandomEvidenceV1(input: {
  seed: string
  commandId: string
  commandSequence: number
  drawIndex: number
  request: TextOpenWorldRandomRequestV1 | unknown
}): Promise<TextOpenWorldRandomEvidenceV1> {
  if (typeof input.seed !== 'string' || !input.seed.trim() || input.seed.length > 500) fail('随机seed无效')
  const request = parseTextOpenWorldRandomRequestV1(input.request)
  const commandId = token(input.commandId, 'commandId', COMMAND_ID); const commandSequence = integer(input.commandSequence, 'commandSequence', 1); const drawIndex = integer(input.drawIndex, 'drawIndex', 0, 1_000_000)
  const algorithm = 'sha256-range-v1' as const
  const seedHash = await hashProductProductionValueV2(input.seed)
  const inputHash = await hashProductProductionValueV2({ algorithm, seed: input.seed, commandId, commandSequence, drawIndex, ...request })
  const sample = Number.parseInt(inputHash.slice(0, 8), 16)
  const value = request.minimumInclusive + sample % (request.maximumInclusive - request.minimumInclusive + 1)
  return { ...request, algorithm, seedHash, inputHash, drawIndex, value }
}

async function outcomeFingerprint(input: {
  commandId: string
  commandSequence: number
  ruleset: TextOpenWorldRulesetStampV1
  requests: TextOpenWorldRandomRequestV1[]
  plan: TextOpenWorldEffectPlanV1
  receipt: TextOpenWorldEffectReceiptV1
}) { return hashProductProductionValueV2({ schema: 'storyforge.text-open-world.outcome-batch', version: 1, ...input }) }

export async function createTextOpenWorldOutcomeFingerprintV1(input: {
  commandId: string
  commandSequence: number
  ruleset: TextOpenWorldRulesetStampV1
  randomRequests: TextOpenWorldRandomRequestV1[]
  plan: TextOpenWorldEffectPlanV1
  receipt: TextOpenWorldEffectReceiptV1
}): Promise<string> {
  const ruleset = parseRuleset(input.ruleset, 'ruleset')
  const requests = input.randomRequests.map((request, index) => parseTextOpenWorldRandomRequestV1(request, `randomRequests[${index}]`))
  const effect = parseTextOpenWorldEffectsAppliedEventPayloadV1({
    schema: 'storyforge.text-open-world.effects-applied-event', version: 1,
    commandId: input.commandId, commandSequence: input.commandSequence, ruleset, randomEventSequences: [],
    plan: input.plan, receipt: input.receipt, outcomeFingerprint: '0'.repeat(64),
  })
  return outcomeFingerprint({ commandId: effect.commandId, commandSequence: effect.commandSequence, ruleset, requests, plan: effect.plan, receipt: effect.receipt })
}

function payload(event: ProductRuntimeEvent): unknown { try { return JSON.parse(event.payloadJson) } catch { fail(`事件${event.sequence} payload不是合法JSON`) } }

export async function replayTextOpenWorldEventProtocolV1(events: readonly ProductRuntimeEvent[], seed: string): Promise<TextOpenWorldEventProtocolProjectionV1> {
  const projection: TextOpenWorldEventProtocolProjectionV1 = {
    schema: 'storyforge.text-open-world.event-protocol-projection', version: 1, sessionId: null, lastSequence: 0, batches: [], pendingCommandId: null,
  }
  let pending: TextOpenWorldEventBatchProjectionV1 | null = null
  const randomRequests: TextOpenWorldRandomRequestV1[] = []
  for (const event of events) {
    if (event.sequence !== projection.lastSequence + 1) fail(`事件序号不连续:${projection.lastSequence + 1}->${event.sequence}`)
    if (projection.sessionId == null) projection.sessionId = event.sessionId
    else if (projection.sessionId !== event.sessionId) fail('事件流混入其他Session')
    if (event.type === 'textworld.command.committed') {
      if (pending) fail(`上一命令尚未终结:${pending.commandId}`)
      const command = parseTextOpenWorldCommandEventPayloadV1(payload(event))
      if (command.envelope.sessionId !== event.sessionId || command.envelope.commandId !== event.commandId || command.envelope.baseSequence !== projection.lastSequence || command.resultingSequence !== event.sequence) fail('命令事件索引或顺序无效')
      pending = { commandId: command.envelope.commandId, commandSequence: event.sequence, randomEventSequences: [], effectsEventSequence: null, ruleset: null, outcomeFingerprint: null }
      randomRequests.length = 0
    } else if (event.type === 'textworld.random.resolved') {
      if (!pending) fail('随机事件前没有待处理命令')
      const random = parseTextOpenWorldRandomResolvedEventPayloadV1(payload(event))
      if (random.commandId !== pending.commandId || random.commandSequence !== pending.commandSequence || random.evidence.drawIndex !== pending.randomEventSequences.length) fail('随机事件命令归属或drawIndex无效')
      if (pending.ruleset && canonicalProductProductionJsonV2(pending.ruleset) !== canonicalProductProductionJsonV2(random.ruleset)) fail('同一命令批次ruleset不一致')
      const request = requestFromEvidence(random.evidence)
      const expected = await resolveTextOpenWorldRandomEvidenceV1({ seed, commandId: pending.commandId, commandSequence: pending.commandSequence, drawIndex: random.evidence.drawIndex, request })
      if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(random.evidence)) fail('随机证据无法由Session seed重放')
      pending.ruleset = random.ruleset; pending.randomEventSequences.push(event.sequence); randomRequests.push(request)
    } else if (event.type === 'textworld.effects.applied') {
      if (!pending) fail('Effect事件前没有待处理命令')
      const effect = parseTextOpenWorldEffectsAppliedEventPayloadV1(payload(event))
      if (effect.commandId !== pending.commandId || effect.commandSequence !== pending.commandSequence || canonicalProductProductionJsonV2(effect.randomEventSequences) !== canonicalProductProductionJsonV2(pending.randomEventSequences)) fail('Effect事件命令归属或随机证据序列无效')
      if (pending.ruleset && canonicalProductProductionJsonV2(pending.ruleset) !== canonicalProductProductionJsonV2(effect.ruleset)) fail('同一命令批次ruleset不一致')
      const { planHash, ...planBody } = effect.plan
      if (await hashProductProductionValueV2(planBody) !== planHash) fail('EffectPlan planHash无法重放')
      const expectedFingerprint = await outcomeFingerprint({ commandId: effect.commandId, commandSequence: effect.commandSequence, ruleset: effect.ruleset, requests: randomRequests, plan: effect.plan, receipt: effect.receipt })
      if (expectedFingerprint !== effect.outcomeFingerprint) fail('命令结果批次指纹无效')
      pending.ruleset = effect.ruleset; pending.effectsEventSequence = event.sequence; pending.outcomeFingerprint = effect.outcomeFingerprint
      projection.batches.push(structuredClone(pending)); pending = null; randomRequests.length = 0
    } else fail(`事件类型不属于vNext协议:${event.type}`)
    projection.lastSequence = event.sequence
  }
  projection.pendingCommandId = pending?.commandId ?? null
  return projection
}
