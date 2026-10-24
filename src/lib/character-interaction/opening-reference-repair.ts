import {canonicalStringify, hashCanonicalValue} from '../agent/run/hash'
import {sha256Text} from '../ai/chapter-memory/text-normalization'
import type {ChatNarrativeProductionSourceV1} from './narrative-production'
import {CHAT_OPENING_REFERENCE_SCHEMA, compileChatOpeningReferenceDraftV1, validateChatOpeningFactCatalogV1} from './opening-source-references'
import {applyChatOpeningRepairPatchV1, planChatOpeningRepairV2, readChatOpeningRepairEnvelopeV1,
  readChatOpeningRepairPatchOptionsV1, type ChatOpeningRepairV2, type ChatOpeningRepairPlan} from './opening-repair-patch'

export interface ChatOpeningRepairV3 extends Omit<ChatOpeningRepairV2, 'version'> {
  version: 3
  format: 'references' | 'full'
  catalogHash: string
}
export type ChatOpeningRepairPlanV3 = ChatOpeningRepairPlan | ChatOpeningRepairV3

export async function planChatOpeningRepairV3(raw: string, source: ChatNarrativeProductionSourceV1,
  catalogValue: unknown, error: string): Promise<ChatOpeningRepairV3 | null> {
  const catalog = await validateChatOpeningFactCatalogV1(catalogValue, source)
  const reference = readChatOpeningRepairEnvelopeV1(raw, CHAT_OPENING_REFERENCE_SCHEMA)
  if (!reference) {
    const legacy = await planChatOpeningRepairV2(raw, source, error)
    return legacy ? {...legacy, version: 3, format: 'full', catalogHash: await hashCanonicalValue(catalog)} : null
  }
  try {await compileChatOpeningReferenceDraftV1(reference.draft, source, catalog, true)} catch {return null}
  const missingOptions = source.settings.narrative.openingCount - reference.draft.options.length
  if (!reference.recoverRootOption && !missingOptions) return null
  return {
    schema: 'storyforge.chat-opening-targeted-repair', version: 3, format: 'references',
    sourceHash: await hashCanonicalValue(source), catalogHash: await hashCanonicalValue(catalog),
    rawResponseHash: await sha256Text(raw), error, recoverRootOption: reference.recoverRootOption,
    originalOptionCount: reference.draft.options.length, missingOptions, repairs: [],
  }
}

export async function applyChatOpeningReferenceRepairV1(input: {
  raw: string; candidate: unknown; source: ChatNarrativeProductionSourceV1; catalog: unknown; repair: ChatOpeningRepairV3
}) {
  const expected = await planChatOpeningRepairV3(input.raw, input.source, input.catalog, input.repair.error)
  if (!expected || canonicalStringify(expected) !== canonicalStringify(input.repair)) throw new Error('[chat-opening-repair] 引用修复缺少相同原文、来源与目录')
  if (expected.format === 'full') {
    const {format: _format, catalogHash: _catalogHash, ...legacy} = expected
    return applyChatOpeningRepairPatchV1({...input, repair: {...legacy, version: 2}})
  }
  const appended = readChatOpeningRepairPatchOptionsV1(input.candidate, expected)
  const {draft} = readChatOpeningRepairEnvelopeV1(input.raw, CHAT_OPENING_REFERENCE_SCHEMA)!
  draft.options.push(...structuredClone(appended))
  return compileChatOpeningReferenceDraftV1(draft, input.source, input.catalog)
}
