import {canonicalStringify, hashCanonicalValue} from '../agent/run/hash'
import {sha256Text} from '../ai/chapter-memory/text-normalization'
import type {ChatNarrativeProductionSourceV1} from './narrative-production'
import {chatOpeningReferencePromptV1} from './opening-reference-prompt'
import {applyChatOpeningReferenceRepairV1, planChatOpeningRepairV3, type ChatOpeningRepairPlanV3, type ChatOpeningRepairV3} from './opening-reference-repair'
import {readChatOpeningRepairEnvelopeV1, readChatOpeningRepairPatchOptionsV1, planChatOpeningRepairV2, applyChatOpeningRepairPatchV1} from './opening-repair-patch'
import {CHAT_OPENING_REFERENCE_SCHEMA, compileChatOpeningReferenceDraftV1, validateChatOpeningFactCatalogV1, compileChatOpeningReferenceDraftV2, validateChatOpeningFactCatalogV2, parseChatOpeningSourceBoundOutputV2} from './opening-source-references'

export const CHAT_OPENING_OPTION_REPAIR_GATE_V1 = 'chat.opening-option-repair.v1'
export interface ChatOpeningRepairV4 extends Omit<ChatOpeningRepairV3, 'version'> {
  version: 4
  invalidOptions: Array<{optionIndex: number; optionKey: string; error: string}>
}
export type ChatOpeningRepairPlanV4 = ChatOpeningRepairPlanV3 | ChatOpeningRepairV4
export interface ChatOpeningRepairV5 extends Omit<ChatOpeningRepairV4, 'version'> {version: 5}
export type ChatOpeningRepairPlanV5 = ChatOpeningRepairPlanV4 | ChatOpeningRepairV5

/** v10 adds replacement authority only for individually rejected options.
 * It does not reinterpret v9 evidence, adopt a story or change source rights. */
export async function planChatOpeningRepairV4(raw: string, source: ChatNarrativeProductionSourceV1,
  catalogValue: unknown, error: string): Promise<ChatOpeningRepairV4 | null> {
  return planOptionRepair(raw, source, catalogValue, error, 4)
}

export async function planChatOpeningRepairV5(raw: string, source: ChatNarrativeProductionSourceV1,
  catalogValue: unknown, error: string): Promise<ChatOpeningRepairV5 | null> {
  return planOptionRepair(raw, source, catalogValue, error, 5)
}

async function planOptionRepair<V extends 4 | 5>(raw: string, source: ChatNarrativeProductionSourceV1,
  catalogValue: unknown, error: string, version: V): Promise<(Omit<ChatOpeningRepairV4, 'version'> & {version: V}) | null> {
  const complete = version === 5
  const catalog = await (complete ? validateChatOpeningFactCatalogV2 : validateChatOpeningFactCatalogV1)(catalogValue, source)
  const compile = complete ? compileChatOpeningReferenceDraftV2 : compileChatOpeningReferenceDraftV1
  const envelope = readChatOpeningRepairEnvelopeV1(raw, CHAT_OPENING_REFERENCE_SCHEMA)
  if (!envelope) {
    const full = complete ? await planChatOpeningRepairV2(raw, source, error) : await planChatOpeningRepairV3(raw, source, catalog, error)
    return full ? {...full, version, format: 'full', catalogHash: await hashCanonicalValue(catalog), invalidOptions: []} : null
  }
  const {draft, recoverRootOption} = envelope
  if (draft.options.length > source.settings.narrative.openingCount) return null
  const keys = new Set<string>(), valid: unknown[] = [], invalidOptions: ChatOpeningRepairV4['invalidOptions'] = []
  for (const [optionIndex, option] of draft.options.entries()) {
    const key = option && typeof option === 'object' && !Array.isArray(option)
      ? (option as Record<string, unknown>).optionKey : null
    // Identity ambiguity cannot be resolved by choosing which story to discard.
    if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key) || keys.has(key)) return null
    keys.add(key)
    try {
      await compile({...draft, options: [option]}, source, catalog, true)
      valid.push(option)
    } catch (failure) {
      invalidOptions.push({optionIndex, optionKey: key, error: failure instanceof Error ? failure.message : String(failure)})
    }
  }
  // Cross-option conflicts between otherwise valid stories are not an
  // individually located failure and do not authorize arbitrary rewriting.
  if (valid.length) {
    try {await compile({...draft, options: valid}, source, catalog, true)} catch {return null}
  }
  const missingOptions = source.settings.narrative.openingCount - draft.options.length
  if (!recoverRootOption && !missingOptions && !invalidOptions.length) return null
  return {
    schema: 'storyforge.chat-opening-targeted-repair', version, format: 'references',
    sourceHash: await hashCanonicalValue(source), catalogHash: await hashCanonicalValue(catalog),
    rawResponseHash: await sha256Text(raw), error, recoverRootOption,
    originalOptionCount: draft.options.length, missingOptions, repairs: [], invalidOptions,
  }
}

export async function applyChatOpeningOptionRepairV1(input: {
  raw: string; candidate: unknown; source: ChatNarrativeProductionSourceV1; catalog: unknown; repair: ChatOpeningRepairV4
}) {
  return applyOptionRepair(input)
}

export async function applyChatOpeningOptionRepairV2(input: {
  raw: string; candidate: unknown; source: ChatNarrativeProductionSourceV1; catalog: unknown; repair: ChatOpeningRepairV5
}) {
  return applyOptionRepair(input)
}

async function applyOptionRepair(input: {
  raw: string; candidate: unknown; source: ChatNarrativeProductionSourceV1; catalog: unknown; repair: ChatOpeningRepairV4 | ChatOpeningRepairV5
}) {
  const complete = input.repair.version === 5
  const expected = await (complete ? planChatOpeningRepairV5 : planChatOpeningRepairV4)(input.raw, input.source, input.catalog, input.repair.error)
  if (!expected || canonicalStringify(expected) !== canonicalStringify(input.repair)) throw new Error('[chat-opening-repair] 开场修复范围与原文、来源或目录不一致')
  if (expected.format === 'full') {
    if (complete) {
      const {invalidOptions: _invalid, format: _format, catalogHash: _catalogHash, ...legacy} = expected
      const candidate = await applyChatOpeningRepairPatchV1({...input, repair: {...legacy, version: 2}})
      return parseChatOpeningSourceBoundOutputV2(candidate, input.source, input.catalog)
    }
    const {invalidOptions: _invalid, ...legacy} = expected
    return applyChatOpeningReferenceRepairV1({...input, repair: {...legacy, version: 3}})
  }
  const patch = input.candidate as Record<string, unknown> | null
  const fields = ['schema', 'version', 'rawResponseHash', 'recoverRootOption', 'applyRepairs', 'appendedOptions', 'replacementOptions']
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)
    || canonicalStringify(Object.keys(patch).sort()) !== canonicalStringify(fields.sort())
    || patch.version !== 2 || !Array.isArray(patch.replacementOptions)
    || patch.replacementOptions.length !== expected.invalidOptions.length) throw new Error('[chat-opening-repair] 补丁必须完整且仅包含已定位的失败开场')
  const {replacementOptions, ...basePatch} = patch
  const appended = readChatOpeningRepairPatchOptionsV1({...basePatch, version: 1}, expected)
  const {draft} = readChatOpeningRepairEnvelopeV1(input.raw, CHAT_OPENING_REFERENCE_SCHEMA)!
  const seen = new Set<number>()
  for (const value of replacementOptions as unknown[]) {
    const row = value as {optionIndex: number; option: Record<string, unknown>} | null
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || canonicalStringify(Object.keys(row).sort()) !== canonicalStringify(['option', 'optionIndex'])
      || !Number.isInteger(row.optionIndex) || seen.has(row.optionIndex)
      || !expected.invalidOptions.some(item => item.optionIndex === row.optionIndex && item.optionKey === row.option?.optionKey)) {
      throw new Error('[chat-opening-repair] 禁止替换合法开场、变更身份或重复修复')
    }
    seen.add(row.optionIndex)
    draft.options[row.optionIndex] = structuredClone(row.option)
  }
  draft.options.push(...structuredClone(appended))
  // All retained stories are copied from the original response, never from
  // model acknowledgements. The complete set still needs independent review.
  return (complete ? compileChatOpeningReferenceDraftV2 : compileChatOpeningReferenceDraftV1)(draft, input.source, input.catalog)
}

export function chatOpeningReferencePromptV2(): string {
  const base = chatOpeningReferencePromptV1()
  return `${base.slice(0, base.indexOf('如果 repair-feedback'))}如果 repair-feedback 含 version=4 的 automaticOpeningRepair，读取其中原响应及逐项错误，只返回修复补丁，不生成完整候选集合。
format=references 时精确结构为 {"schema":"storyforge.chat-opening-repair-patch","version":2,"rawResponseHash":"原响应hash","recoverRootOption":false,"applyRepairs":[],"appendedOptions":[],"replacementOptions":[{"optionIndex":0,"option":{"optionKey":"必须保留原optionKey","title":"修复后的标题","pitch":"修复后的说明","situation":{}}}]}。situation 必须使用上述完整引用格式。optionIndex 是原 options 的零起始索引；recoverRootOption=true 时，顶层完整错位开场在系统移回后占最后一个索引。只替换 invalidOptions 中明确列出的每个开场，保留其 optionKey。其它开场由系统原样保留，不能在补丁中重写。replacementOptions 没有失败项时为空。
修复要处理该开场整体一致性：私有事实不能成为公开事项依据，也不能把同一秘密换写进标题、pitch、新背景或玩家已知信息。可以保留角色自己的私有顾虑，以双方已知的实际问题建立公开事项；不得扩大知情范围、伪造玩家授权或改写来源来通过检查。不能把目标降成仅提出建议或等待玩家，仍须留下有动机、可演绎且允许玩家拒绝的发展可能。
appendedOptions 仅补齐 missingOptions 个缺少的引用开场；recoverRootOption 与修复包一致，applyRepairs 按 repairs.path 完整列出。format=full 时沿用版本1补丁，只含 schema、version、rawResponseHash、recoverRootOption、applyRepairs、appendedOptions，不含 replacementOptions，也不得重写完整旧候选。
系统会重新核对原响应、来源、目录、失败位置并完整校验所有开场，随后仍须独立审查和作者选择。修复只有这一次，失败后保留原始证据并停止。无修复包时生成完整开场集合。`
}

/** v11 keeps the v10 repair policy but binds complete source-fact catalog v2. */
export function chatOpeningReferencePromptV3(): string {
  return chatOpeningReferencePromptV2().replace('version=4 的 automaticOpeningRepair', 'version=5 的 automaticOpeningRepair')
    .replace('required=true 的事实与发现前提由系统必然保留，不依赖你的选择。', '本合同的目录版本为2：目录中的全部已确认身份与知识事实由系统完整保留，不依赖 worldFactKeys 的选择；该选择只表达本开场关注的材料。私有事实仍只对原知情者可见，只有原授权允许的事实才能被发现。')
    + '\n完整资料保留不等于公开：角色的私有知识可支撑自己的动机与可行方向，公开事项仍只能引用其全部听众已知的事实。身份或知识的 sourceKnowledgeKey 是来源编号；行动依据使用对应的 factKey。目标、顾虑、口吻和未知推断不因资料保留而成为客观事实。'
}
