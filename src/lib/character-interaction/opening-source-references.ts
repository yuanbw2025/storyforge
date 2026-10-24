import {canonicalStringify, hashCanonicalValue} from '../agent/run/hash'
import {parseChatSituationCandidatesV1, validateChatNarrativeProductionSourceV1, validateChatSituationOptionSubsetV1,
  type ChatNarrativeProductionSourceV1, type ChatSituationCandidatesV1} from './narrative-production'
import type {ChatSituationFactV1} from '../types/chat-narrative'
import {CHAT_INITIAL_FACT_CAPACITY_V1} from './narrative-contract'

export const CHAT_OPENING_REFERENCE_GATE_V1 = 'chat.opening-source-references.v1'
export const CHAT_OPENING_FACT_CATALOG_KEY = 'design.chat-fact-catalog'
export const CHAT_OPENING_REFERENCE_SCHEMA = 'storyforge.chat-situation-reference-draft'
export const CHAT_OPENING_SOURCE_COMPLETENESS_GATE_V1 = 'chat.opening-source-completeness.v1'
const worldPrefix = 'world-fact.'

export interface ChatOpeningFactCatalogV1 {
  schema: 'storyforge.chat-opening-fact-catalog'
  version: 1
  sourceHash: string
  facts: Array<{factKey: string; sourceKnowledgeKey: string; audienceKeys: string[]; required: boolean; discoverable: boolean}>
}
export interface ChatOpeningFactCatalogV2 extends Omit<ChatOpeningFactCatalogV1, 'version'> {version: 2}
type FactCatalog = ChatOpeningFactCatalogV1 | ChatOpeningFactCatalogV2
type Row = Record<string, unknown>
function fail(reason: string): never {throw new Error(`[chat-opening-references] ${reason}`)}
function row(value: unknown, fields: readonly string[]): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('候选必须是对象')
  const result = value as Row
  if (canonicalStringify(Object.keys(result).sort()) !== canonicalStringify([...fields].sort())) fail('候选包含缺失或额外字段')
  return result
}
function list(value: unknown): unknown[] {if (!Array.isArray(value)) fail('候选列表无效'); return value}
function referenceKeys(value: unknown): string[] {
  const values = list(value)
  if (values.some(v => typeof v !== 'string') || new Set(values).size !== values.length) fail('事实引用缺失或重复')
  return values as string[]
}

/** Read-only Build artifact: aliases are scoped to this exact frozen source.
 * Text remains in design.game; the catalog does not duplicate source prose. */
export async function buildChatOpeningFactCatalogV1(source: ChatNarrativeProductionSourceV1): Promise<ChatOpeningFactCatalogV1> {
  validateChatNarrativeProductionSourceV1(source)
  const knowledge = source.source.knowledge
  const required = new Set(knowledge.filter(k => k.discovery || k.source.unit)
    .flatMap(k => [k.key, ...(k.discovery?.prerequisiteKnowledgeKeys ?? [])]))
  const facts = knowledge.filter(k => ['identity', 'knowledge'].includes(k.source.purpose))
    .map((item, index) => ({
      factKey: `${worldPrefix}${String(index + 1).padStart(4, '0')}`, sourceKnowledgeKey: item.key,
      audienceKeys: [...item.audienceKeys], required: required.has(item.key), discoverable: !!item.discovery,
    }))
  if ([...required].some(key => !facts.some(f => f.sourceKnowledgeKey === key))) fail('必保留资料不属于可用事实来源')
  return {schema: 'storyforge.chat-opening-fact-catalog', version: 1, sourceHash: await hashCanonicalValue(source), facts}
}

export async function validateChatOpeningFactCatalogV1(value: unknown, source: ChatNarrativeProductionSourceV1): Promise<ChatOpeningFactCatalogV1> {
  const expected = await buildChatOpeningFactCatalogV1(source)
  if (canonicalStringify(value) !== canonicalStringify(expected)) fail('事实目录与冻结来源不一致')
  return expected
}

/** New production contracts retain the complete reviewed fact vocabulary.
 * Otherwise a role can read source knowledge that it cannot use or disclose. */
export async function buildChatOpeningFactCatalogV2(source: ChatNarrativeProductionSourceV1): Promise<ChatOpeningFactCatalogV2> {
  const previous = await buildChatOpeningFactCatalogV1(source)
  if (previous.facts.length > CHAT_INITIAL_FACT_CAPACITY_V1) fail('已确认来源事实超过初始情境容量；请先调整来源范围，不能省略后继续制作')
  return {...previous, version: 2, facts: previous.facts.map(fact => ({...fact, required: true}))}
}

export async function validateChatOpeningFactCatalogV2(value: unknown, source: ChatNarrativeProductionSourceV1): Promise<ChatOpeningFactCatalogV2> {
  const expected = await buildChatOpeningFactCatalogV2(source)
  if (canonicalStringify(value) !== canonicalStringify(expected)) fail('完整事实目录与冻结来源不一致')
  return expected
}

function sourceFacts(catalog: FactCatalog, source: ChatNarrativeProductionSourceV1, sceneKey: string,
  selected = catalog.facts): ChatSituationFactV1[] {
  return selected.map(entry => {
    const knowledge = source.source.knowledge.find(k => k.key === entry.sourceKnowledgeKey)!
    const fact: ChatSituationFactV1 = {factKey: entry.factKey, text: knowledge.content, audienceKeys: [...knowledge.audienceKeys],
      origin: 'reviewed-world', sourceKnowledgeKey: knowledge.key, sourceEventSequence: 0}
    if (knowledge.discovery) fact.discovery = {
      sceneKey, actorKeys: [...knowledge.discovery.actorKeys], condition: knowledge.discovery.condition,
      prerequisiteFactKeys: knowledge.discovery.prerequisiteKnowledgeKeys.map(key => catalog.facts.find(f => f.sourceKnowledgeKey === key)!.factKey),
    }
    return fact
  })
}

/** Deterministic expansion only. It never repairs text, changes audiences,
 * invents evidence or chooses goals, and it never adopts a candidate. */
export async function compileChatOpeningReferenceDraftV1(value: unknown, source: ChatNarrativeProductionSourceV1,
  catalogValue: unknown, subset = false): Promise<ChatSituationCandidatesV1> {
  const catalog = await validateChatOpeningFactCatalogV1(catalogValue, source)
  return compileReferences(value, source, catalog, subset)
}

export async function compileChatOpeningReferenceDraftV2(value: unknown, source: ChatNarrativeProductionSourceV1,
  catalogValue: unknown, subset = false): Promise<ChatSituationCandidatesV1> {
  const catalog = await validateChatOpeningFactCatalogV2(catalogValue, source)
  return compileReferences(value, source, catalog, subset)
}

function compileReferences(value: unknown, source: ChatNarrativeProductionSourceV1,
  catalog: FactCatalog, subset: boolean): ChatSituationCandidatesV1 {
  const root = row(value, ['schema', 'version', 'options'])
  if (root.schema !== CHAT_OPENING_REFERENCE_SCHEMA || root.version !== 1) fail('引用候选版本无效')
  const options = list(root.options).map(value => {
    const option = row(value, ['optionKey', 'title', 'pitch', 'situation'])
    const setup = row(option.situation, ['situationKey', 'sceneKey', 'title', 'location', 'timeLabel', 'worldFactKeys', 'localFacts', 'goals', 'beliefs', 'threads', 'possibilities'])
    const selectedKeys = referenceKeys(setup.worldFactKeys)
    if (selectedKeys.some(key => !catalog.facts.some(f => f.factKey === key))) fail('引用不属于本次事实目录')
    const selected = catalog.facts.filter(f => f.required || selectedKeys.includes(f.factKey))
    const reviewedFacts = sourceFacts(catalog, source, setup.sceneKey as string, selected)
    const localFacts = list(setup.localFacts).map(value => {
      const hasDiscovery = value != null && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'discovery')
      const local = row(value, ['factKey', 'text', 'audienceKeys', ...(hasDiscovery ? ['discovery'] : [])])
      if (typeof local.factKey !== 'string' || local.factKey.startsWith(worldPrefix)) fail('新增背景不能冒用世界事实标识')
      return {...local, origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0}
    })
    const goals = list(setup.goals).map(value => ({...row(value, ['goalKey', 'actorKey', 'desire', 'concern', 'boundary', 'evidenceFactKeys']), status: 'active', updatedSequence: 0}))
    const beliefs = list(setup.beliefs).map(value => ({...row(value, ['beliefKey', 'actorKey', 'text', 'evidenceFactKeys']), updatedSequence: 0}))
    const threads = list(setup.threads).map(value => ({...row(value, ['threadKey', 'title', 'question', 'audienceKeys', 'participantKeys', 'evidenceFactKeys', 'closureSignals']), status: 'open', updatedSequence: 0}))
    return {...option, situation: {
      situationKey: setup.situationKey, sceneKey: setup.sceneKey, title: setup.title, location: setup.location, timeLabel: setup.timeLabel,
      facts: [...reviewedFacts, ...localFacts], goals, beliefs, threads, possibilities: setup.possibilities,
    }}
  })
  const compiled = {schema: 'storyforge.chat-situation-candidates', version: 1, options}
  if (subset) {
    validateChatSituationOptionSubsetV1(options, source)
    return compiled as ChatSituationCandidatesV1
  }
  return parseChatSituationCandidatesV1(compiled, source)
}

/** The new contract can still receive a complete author/producer candidate,
 * but it must pass the unchanged complete parser with no field normalization. */
export async function parseChatOpeningSourceBoundOutputV1(value: unknown, source: ChatNarrativeProductionSourceV1,
  catalog: unknown): Promise<ChatSituationCandidatesV1> {
  await validateChatOpeningFactCatalogV1(catalog, source)
  return (value as Row)?.schema === CHAT_OPENING_REFERENCE_SCHEMA
    ? compileChatOpeningReferenceDraftV1(value, source, catalog)
    : parseChatSituationCandidatesV1(value, source)
}

export async function assertChatOpeningSourceCompletenessV1(value: unknown, source: ChatNarrativeProductionSourceV1): Promise<void> {
  const candidates = parseChatSituationCandidatesV1(value, source), catalog = await buildChatOpeningFactCatalogV2(source)
  for (const option of candidates.options) {
    if (catalog.facts.some(entry => option.situation.facts.filter(fact => fact.origin === 'reviewed-world'
      && fact.sourceKnowledgeKey === entry.sourceKnowledgeKey).length !== 1)) fail('情境必须为每条已确认来源事实保留唯一可用身份')
  }
}

/** Full-shape input keeps its valid authored identities and prose. Only omitted
 * reviewed facts are added deterministically before semantic review/selection.
 * Invalid full candidates are never made valid by changing their existing facts. */
export async function parseChatOpeningSourceBoundOutputV2(value: unknown, source: ChatNarrativeProductionSourceV1,
  catalogValue: unknown): Promise<ChatSituationCandidatesV1> {
  const catalog = await validateChatOpeningFactCatalogV2(catalogValue, source)
  if ((value as Row)?.schema === CHAT_OPENING_REFERENCE_SCHEMA) return compileChatOpeningReferenceDraftV2(value, source, catalog)
  const candidates = parseChatSituationCandidatesV1(value, source)
  for (const option of candidates.options) {
    const facts = option.situation.facts
    for (const fact of sourceFacts(catalog, source, option.situation.sceneKey)) {
      if (facts.some(existing => existing.origin === 'reviewed-world' && existing.sourceKnowledgeKey === fact.sourceKnowledgeKey)) continue
      if (facts.some(existing => existing.factKey === fact.factKey)) fail('保留来源事实所需的稳定标识已被其它内容占用')
      facts.push(fact)
    }
  }
  await assertChatOpeningSourceCompletenessV1(candidates, source)
  return candidates
}
