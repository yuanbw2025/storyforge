import {canonicalStringify, hashCanonicalValue} from '../agent/run/hash'
import {sha256Text} from '../ai/chapter-memory/text-normalization'
import {parseChatSituationCandidatesV1, validateChatSituationOptionSubsetV1, type ChatNarrativeProductionSourceV1, type ChatSituationCandidatesV1} from './narrative-production'
import {planChatOpeningRepairV1, type ChatOpeningRepairV1} from './opening-repair'

export const CHAT_OPENING_REPAIR_GATE_V2 = 'chat.opening-targeted-repair.v2'
export const CHAT_OPENING_REPAIR_PROMPT_V2 = `
所有开场都要遵守：threads.participantKeys 是可调度 AI 角色名单，只能填写 participants 中的 participantKey，不能含 player；玩家可在 audienceKeys 中。threads.evidenceFactKeys 的每条依据必须对该事项 audienceKeys 的所有知情者可见；角色独有的秘密可支撑该角色自身目标，但不能成为公开事项的依据。不要用扩大事实知情者来消除这类错误。
若 product-production.repair-feedback 含 version=2 的 automaticOpeningRepair，本次只输出修复补丁，不再输出或重写完整候选。读取同一包中的原响应与错误。原有开场全部保留；recoverRootOption=true 时，系统会将原响应顶层错位的完整开场原样移入 options 末尾，再应用 repairs。applyRepairs 必须逐项列出全部 repairs.path；系统只会应用这些已由冻结来源核实的 expectedValue，无需你抄写原文。appendedOptions 只写 missingOptions 个新增完整开场，格式遵守上述单个 option 规则，与保留开场有实质区别，身份不重复。禁止添加修改标题、剧情、目标、知情范围或其它字段的操作。
修复时唯一顶层结构为 {"schema":"storyforge.chat-opening-repair-patch","version":1,"rawResponseHash":"修复包中的原响应hash","recoverRootOption":false,"applyRepairs":["修复包中全部repairs.path"],"appendedOptions":[]}；recoverRootOption 必须等于修复包同名字段，缺少开场时 appendedOptions 必须补齐，missingOptions=0 时为空数组。补丁应用后仍须完整校验、独立开场审查和作者选择。没有 version=2 修复包时正常生成完整开场候选。`

export interface ChatOpeningRepairV2 extends Omit<ChatOpeningRepairV1, 'version'> {
  version: 2
  /** Retain a complete misplaced option, never discard distinct draft content. */
  recoverRootOption: boolean
}
export type ChatOpeningRepairPlan = ChatOpeningRepairV1 | ChatOpeningRepairV2

type ObjectValue = Record<string, unknown>
const optionFields = ['optionKey', 'title', 'pitch', 'situation']
function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function exactKeys(value: ObjectValue, keys: string[]): boolean {
  return canonicalStringify(Object.keys(value).sort()) === canonicalStringify([...keys].sort())
}
export function readChatOpeningRepairEnvelopeV1(raw: string, schema: string): {draft: {schema: string; version: 1; options: unknown[]}; recoverRootOption: boolean} | null {
  let value: unknown
  try {value = JSON.parse(raw)} catch {return null}
  if (!object(value) || value.schema !== schema || value.version !== 1
    || !Array.isArray(value.options) || !value.options.length) return null
  const rootKeys = ['schema', 'version', 'options']
  const recoverRootOption = exactKeys(value, [...rootKeys, ...optionFields])
  if (!recoverRootOption && !exactKeys(value, rootKeys)) return null
  const options = [...value.options]
  if (recoverRootOption) options.push(Object.fromEntries(optionFields.map(key => [key, value[key]])))
  // These casts do not authorize a candidate; the shared full option validator
  // below checks every retained option, including the recovered root option.
  return {draft: {schema, version: 1, options}, recoverRootOption}
}
function readDraft(raw: string): {draft: ChatSituationCandidatesV1; recoverRootOption: boolean} | null {
  const value = readChatOpeningRepairEnvelopeV1(raw, 'storyforge.chat-situation-candidates')
  return value ? {...value, draft: value.draft as ChatSituationCandidatesV1} : null
}
function applyFields(draft: ChatSituationCandidatesV1, repairs: ChatOpeningRepairV1['repairs']): void {
  for (const repair of repairs) {
    const fact = draft.options[repair.optionIndex].situation.facts[repair.factIndex]
    if (repair.field === 'origin') fact.origin = 'reviewed-world'
    else fact.text = repair.expectedValue
  }
}

/** A complete deterministic repair plan, with no draft adoption or model call. */
export async function planChatOpeningRepairV2(raw: string, source: ChatNarrativeProductionSourceV1, error: string): Promise<ChatOpeningRepairV2 | null> {
  const original = readDraft(raw)
  if (!original) return null
  const {draft, recoverRootOption} = original
  const fieldPlan = await planChatOpeningRepairV1(JSON.stringify(draft), source, error)
  const repairs = fieldPlan?.repairs ?? []
  applyFields(draft, repairs)
  // Unlike v1, a missing option cannot hide another unrepairable field.
  try {validateChatSituationOptionSubsetV1(draft.options, source)} catch {return null}
  const missingOptions = source.settings.narrative.openingCount - draft.options.length
  if (!recoverRootOption && !repairs.length && !missingOptions) return null
  return {
    schema: 'storyforge.chat-opening-targeted-repair', version: 2,
    sourceHash: await hashCanonicalValue(source), rawResponseHash: await sha256Text(raw), error,
    originalOptionCount: draft.options.length, missingOptions, repairs, recoverRootOption,
  }
}

/** Apply only the acknowledged frozen operations; arbitrary edits are not part
 * of the patch language. The result remains an unadopted production candidate. */
export async function applyChatOpeningRepairPatchV1(input: {
  raw: string; candidate: unknown; source: ChatNarrativeProductionSourceV1; repair: ChatOpeningRepairV2
}): Promise<ChatSituationCandidatesV1> {
  const expected = await planChatOpeningRepairV2(input.raw, input.source, input.repair.error)
  if (!expected || canonicalStringify(expected) !== canonicalStringify(input.repair)) {
    throw new Error('[chat-opening-repair] 原候选、冻结来源或修复范围不一致')
  }
  const appended = readChatOpeningRepairPatchOptionsV1(input.candidate, expected)
  const {draft} = readDraft(input.raw)!
  applyFields(draft, expected.repairs)
  draft.options.push(...structuredClone(appended) as ChatSituationCandidatesV1['options'])
  return parseChatSituationCandidatesV1(draft, input.source)
}

export function readChatOpeningRepairPatchOptionsV1(patch: unknown, expected: Pick<ChatOpeningRepairV2,
  'rawResponseHash' | 'recoverRootOption' | 'repairs' | 'missingOptions'>): unknown[] {
  if (!object(patch) || !exactKeys(patch, ['schema', 'version', 'rawResponseHash', 'recoverRootOption', 'applyRepairs', 'appendedOptions'])
    || patch.schema !== 'storyforge.chat-opening-repair-patch' || patch.version !== 1
    || patch.rawResponseHash !== expected.rawResponseHash || patch.recoverRootOption !== expected.recoverRootOption
    || !Array.isArray(patch.applyRepairs) || patch.applyRepairs.some(path => typeof path !== 'string')
    || canonicalStringify([...patch.applyRepairs].sort()) !== canonicalStringify(expected.repairs.map(item => item.path).sort())
    || !Array.isArray(patch.appendedOptions) || patch.appendedOptions.length !== expected.missingOptions) {
    throw new Error('[chat-opening-repair] 补丁必须精确应用已授权的修复并补齐开场，不能改写原候选')
  }
  return patch.appendedOptions
}
