import {canonicalStringify, hashCanonicalValue} from '../agent/run/hash'
import {sha256Text} from '../ai/chapter-memory/text-normalization'
import {parseChatSituationCandidatesV1, validateChatNarrativeProductionSourceV1, type ChatNarrativeProductionSourceV1} from './narrative-production'

export const CHAT_OPENING_REPAIR_GATE_V1 = 'chat.opening-targeted-repair.v1'
export const CHAT_OPENING_REPAIR_PROMPT_V1 = `
若 product-production.repair-feedback 含 automaticOpeningRepair，本次是同一候选的唯一一次定向修复。读取 previous.evidence 中的原始响应和具体错误；只改 repairs 指定的字段为 expectedValue，并在末尾补齐 missingOptions 个不同开场。已有候选的身份、顺序、剧情、目标、知情范围和其他字段必须完整保留。不能删掉来源引用、改成私域事实、扩大知情范围或重新创作已有开场来绕过错误。仍输出完整的原候选 JSON；修复后还须通过完整校验、独立开场审查和作者选择。没有该修复包时正常生成开场。`

type ObjectValue = Record<string, unknown>
function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export interface ChatOpeningRepairV1 {
  schema: 'storyforge.chat-opening-targeted-repair'
  version: 1
  sourceHash: string
  rawResponseHash: string
  error: string
  originalOptionCount: number
  missingOptions: number
  repairs: Array<{
    path: string
    optionIndex: number
    factIndex: number
    field: 'origin' | 'text'
    expectedValue: string
  }>
}

/** Propose corrections, never adopt or silently normalize a model response. */
export async function planChatOpeningRepairV1(raw: string, source: ChatNarrativeProductionSourceV1, error: string): Promise<ChatOpeningRepairV1 | null> {
  validateChatNarrativeProductionSourceV1(source)
  let original: unknown
  try {original = JSON.parse(raw)} catch {return null}
  if (!object(original) || original.schema !== 'storyforge.chat-situation-candidates' || original.version !== 1
    || !Array.isArray(original.options) || original.options.length < 1
    || original.options.length > source.settings.narrative.openingCount) return null
  const repairs: ChatOpeningRepairV1['repairs'] = []
  for (const [optionIndex, option] of original.options.entries()) {
    if (!object(option) || !object(option.situation) || !Array.isArray(option.situation.facts)) return null
    for (const [factIndex, fact] of option.situation.facts.entries()) {
      if (!object(fact)) return null
      if (fact.sourceKnowledgeKey == null) continue
      const knowledge = source.source.knowledge.find(item => item.key === fact.sourceKnowledgeKey)
      // An unknown source, personality instruction or visibility error is not
      // permission to invent provenance or broaden the candidate's audience.
      if (!knowledge || !['identity', 'knowledge'].includes(knowledge.source.purpose)
        || !Array.isArray(fact.audienceKeys) || fact.audienceKeys.some(key => !knowledge.audienceKeys.includes(key))
        || typeof fact.text !== 'string') return null
      for (const [field, expectedValue] of [['origin', 'reviewed-world'], ['text', knowledge.content]] as const) {
        if (fact[field] !== expectedValue) repairs.push({
          path: `/options/${optionIndex}/situation/facts/${factIndex}/${field}`,
          optionIndex, factIndex, field, expectedValue,
        })
      }
    }
  }
  const missingOptions = source.settings.narrative.openingCount - original.options.length
  if (!missingOptions && !repairs.length) return null
  // If all options exist, prove these exact corrections address the entire
  // deterministic failure before spending on a repair.
  if (!missingOptions) {
    const probe = structuredClone(original)
    applyExpectedFields(probe, repairs)
    try {parseChatSituationCandidatesV1(probe, source)} catch {return null}
  }
  return {
    schema: 'storyforge.chat-opening-targeted-repair', version: 1,
    sourceHash: await hashCanonicalValue(source), rawResponseHash: await sha256Text(raw), error,
    originalOptionCount: original.options.length, missingOptions, repairs,
  }
}

function applyExpectedFields(value: ObjectValue, repairs: ChatOpeningRepairV1['repairs']): void {
  for (const repair of repairs) {
    const option = (value.options as ObjectValue[])[repair.optionIndex]
    const facts = (option.situation as ObjectValue).facts as ObjectValue[]
    facts[repair.factIndex][repair.field] = repair.expectedValue
  }
}

/** Restrict the diff before the normal complete candidate validator/reviewer. */
export async function validateChatOpeningRepairV1(input: {
  raw: string
  candidate: unknown
  source: ChatNarrativeProductionSourceV1
  repair: ChatOpeningRepairV1
}): Promise<void> {
  const expected = await planChatOpeningRepairV1(input.raw, input.source, input.repair.error)
  if (!expected || canonicalStringify(expected) !== canonicalStringify(input.repair)) {
    throw new Error('[chat-opening-repair] 原候选、冻结来源或修复范围不一致')
  }
  const candidate = input.candidate
  if (!object(candidate) || !Array.isArray(candidate.options)
    || candidate.options.length !== expected.originalOptionCount + expected.missingOptions) {
    throw new Error('[chat-opening-repair] 修复必须保留原开场并补齐指定数量')
  }
  const original = JSON.parse(input.raw) as ObjectValue
  applyExpectedFields(original, expected.repairs)
  const retained = {...candidate, options: candidate.options.slice(0, expected.originalOptionCount)}
  if (canonicalStringify(retained) !== canonicalStringify(original)) {
    throw new Error('[chat-opening-repair] 修改了错误路径之外的原候选内容')
  }
  parseChatSituationCandidatesV1(candidate, input.source)
}
