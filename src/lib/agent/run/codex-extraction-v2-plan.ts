import { splitCodexSourceUnitsV1, type CodexProductionPolicyV1 } from './codex-extraction-v2-source-units'
import type { ChatMessage } from '../../types'
import type { ContextMaterialAllocationV2 } from '../../types/agent-run'
import { planAdaptiveDocumentParseChunksV1, type ChunkPlan } from '../../import/chunker'
import { createAIRequestAssessorV2, readPreparedRequestFrameV2, type AIRequestEvidenceV2, type ChatRequestOptions,
  type FrozenRequestAssessmentContextV2, type PreparedAIRequestV2Handle } from '../../ai/client'
import { hashCanonicalValue } from './hash'
import { assertCodexExtractionPlanV2, type CodexExtractionFrameV2,
  type CodexExtractionPlanV2, type CodexExtractionRootV2 } from './codex-extraction-v2-contract'

/** Uses the existing UTF16/CRLF-safe range planner. Unknown or estimated fits
 * keep the complete request; they never turn the V1 fallback into a quota. */
export async function buildCodexExtractionPlanV2(input: {
  root: CodexExtractionRootV2
  sourceText: string
  sourceOffset?: number
  material: ContextMaterialAllocationV2
  assessmentContext: FrozenRequestAssessmentContextV2
  options: ChatRequestOptions
  render: (chunk: ChunkPlan, totalChunks: number) => readonly ChatMessage[]
  /** Freeze each chosen physical request once. Native callers allocate a fresh
   * frozen assessment context per frame, retaining their exact one requestId. */
  prepareRange: (messages: readonly ChatMessage[], options: ChatRequestOptions) => Promise<{
    handle: PreparedAIRequestV2Handle; evidence: AIRequestEvidenceV2
  }>
}): Promise<{ plan: CodexExtractionPlanV2; prepared: Array<{ frame: CodexExtractionFrameV2; handle: PreparedAIRequestV2Handle }> }> {
  if (!input.sourceText.trim() || input.material.authorityHash !== input.root.rootHash) throw new Error('范围计划缺少原始来源或材料权限身份。')
  const assessor = createAIRequestAssessorV2(input.assessmentContext)
  const accepts = (chunk: ChunkPlan, total: number) => assessor.assess(input.render(chunk, total), input.options).decision !== 'proved-overflow'
  let chunks: ChunkPlan[]
  if (input.root.productionPolicy) {
    const offset = input.sourceOffset ?? 0
    const boundaries = [0, ...input.root.productionPolicy.sourceUnitEnds]
    if (!boundaries.includes(offset) || !boundaries.includes(offset + input.sourceText.length)) throw new Error('请求范围不属于冻结原文单元。')
    const policy = { ...input.root.productionPolicy, sourceUnitEnds: input.root.productionPolicy.sourceUnitEnds
      .filter(end => end > offset && end <= offset + input.sourceText.length).map(end => end - offset) }
    const pending = [{ startChar: 0, endChar: input.sourceText.length, text: input.sourceText }]
    chunks = []
    while (pending.length) {
      const range = pending.shift()!
      const chunk = { ...range, index: chunks.length, charCount: range.endChar - range.startChar }
      if (accepts(chunk, chunks.length + pending.length + 1)) chunks.push(chunk)
      else pending.unshift(...splitCodexSourceUnitsV1({ sourceText: input.sourceText, ...range, policy }))
    }
  } else {
    chunks = planAdaptiveDocumentParseChunksV1(input.sourceText, accepts)
  }
  const prepared: Array<{ frame: CodexExtractionFrameV2; handle: PreparedAIRequestV2Handle }> = []
  for (const chunk of chunks) {
    const messages = input.render(chunk, chunks.length)
    const request = await input.prepareRange(messages, input.options)
    if (request.evidence.messagesHash !== await hashCanonicalValue(messages)
      || request.evidence.optionsHash !== await hashCanonicalValue(input.options)
      || request.evidence.materialAllocationHash !== input.material.allocationHash) throw new Error('实际范围请求与最终完整消息不一致。')
    const body = { version: 'codex-extraction-frame-v2' as const, rootHash: input.root.rootHash,
      startChar: chunk.startChar, endChar: chunk.endChar, sourceRangeHash: await hashCanonicalValue(chunk.text),
      wireFrameHash: await hashCanonicalValue(readPreparedRequestFrameV2(request.handle)),
      materialAllocationHash: input.material.allocationHash, request: request.evidence }
    prepared.push({ frame: { ...body, frameHash: await hashCanonicalValue(body) }, handle: request.handle })
  }
  const frames = prepared.map(row => row.frame)
  const body = { version: 'codex-extraction-plan-v2' as const, portable: false as const, rootHash: input.root.rootHash,
    sourceUTF16Length: input.sourceText.length, frames, previousPlanHash: null, predecessorResultHashes: [], carriedFrameHashes: [],
    forecast: { modelCalls: frames.length,
      inputTokens: frames.reduce((total, frame) => total + frame.request.inputMeasurement.tokens, 0),
      outputTokens: frames.reduce((total, frame) => total + frame.request.forecastOutputTokens, 0) } }
  const plan = { ...body, planHash: await hashCanonicalValue(body) }
  await assertCodexExtractionPlanV2(plan)
  return { plan, prepared }
}

/** Known output-incomplete is not an input-overflow proof. Refine only its
 * unfinished original range and require a strictly smaller finite partition. */
export function refineIncompleteCodexRangeV2(input: {
  sourceText: string; startChar: number; endChar: number; completion: 'incomplete'; productionPolicy?: CodexProductionPolicyV1
}): Array<{ startChar: number; endChar: number; text: string }> {
  const { sourceText, startChar, endChar } = input
  if (input.productionPolicy && input.completion === 'incomplete') return splitCodexSourceUnitsV1({ ...input, policy: input.productionPolicy })
  if (input.completion !== 'incomplete' || !Number.isSafeInteger(startChar) || !Number.isSafeInteger(endChar)
    || startChar < 0 || endChar > sourceText.length || endChar <= startChar) throw new Error('未完成来源范围无效。')
  let middle = startChar + Math.floor((endChar - startChar) / 2)
  const before = sourceText.charCodeAt(middle - 1), after = sourceText.charCodeAt(middle)
  if (before === 13 && after === 10 || before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) middle--
  if (middle <= startChar || middle >= endChar) throw new Error('未完成范围无法继续严格缩小；原答已保留，需要处理。')
  return [{ startChar, endChar: middle, text: sourceText.slice(startChar, middle) },
    { startChar: middle, endChar, text: sourceText.slice(middle, endChar) }]
}
