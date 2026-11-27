import { planAdaptiveDocumentParseChunksV1, type ChunkPlan } from './chunker'
import { prepareDocumentParseRequestConfigV1 } from './document-parse-durable'
import { assessDocumentParseRequestV1, buildDocumentParseFrameV1, DOCUMENT_PARSE_KNOWN_CONTEXT_V1 } from './document-parse-request'
import { loadCodexImportCategoryOptions } from './codex-classification'
import { requireFixedBudgetValueV1 } from '../agent/finite-budget'
import { useCodexStore } from '../../stores/codex'
import { usePromptStore } from '../../stores/prompt'
import { resolveScope } from '../workspace/scope'
import { verifyImportProjectTargetGroupV1 } from '../../stores/import-session'
import type { ImportBlobTextSourceV1 } from './blob-text-source'
import { hashImportChunkTextV1 } from '../../stores/import-session'
import type { ImportTarget, WorkspaceScope } from '../types'

/** New sessions only. This is local feasibility, never a request/claim or an AI context bypass.
 * Dispatch still reads its registered sources and rechecks the complete actual frame. */
type PlanTarget = { scope: WorkspaceScope; importTarget: ImportTarget; targetWorldGroupId: number | null }
async function preparePlan(input: PlanTarget) {
  const scope = await resolveScope({ scope: input.scope, projectId: input.scope.projectId })
  if (input.importTarget === 'project') await verifyImportProjectTargetGroupV1(scope, input.targetWorldGroupId)
  else if (input.targetWorldGroupId !== null) throw new Error('项目参考不能绑定写入世界组。')
  const { resolved, skill, inputBudgetTokens } = await prepareDocumentParseRequestConfigV1(scope.projectId)
  if (input.importTarget === 'project') await useCodexStore.getState().ensureBuiltIns(scope)
  // The same scoped catalog loader used by the registered import source. No
  // session exists yet; the formal source independently freezes it at dispatch.
  const categories = input.importTarget === 'project' ? await loadCodexImportCategoryOptions(scope, { initialize: false }) : []
  const template = structuredClone(usePromptStore.getState().getActive('import.parse-chunk'))
  const fits = (chunk: ChunkPlan, totalChunks: number) => {
    const frame = buildDocumentParseFrameV1({ template, provider: resolved.config.provider, sourceText: chunk.text,
      chunkIndex: chunk.index, totalChunks, categories, knownContext: DOCUMENT_PARSE_KNOWN_CONTEXT_V1 })
    if (chunk.text.length && !frame.messages.some(message => message.content.includes(chunk.text)))
      throw new Error('文档解析模板没有完整包含本块原文；未创建解析任务。')
    return assessDocumentParseRequestV1({ config: resolved.config, ...frame,
      maxInputTokens: inputBudgetTokens, maxOutputTokens: requireFixedBudgetValueV1(skill.maxOutputTokens) }).fits
  }
  return { fits, inputBudgetTokens }
}

export async function planNewDocumentImportV1(input: PlanTarget & { text: string }) {
  const { fits } = await preparePlan(input)
  const plans = planAdaptiveDocumentParseChunksV1(input.text, fits)
  if (plans.some(plan => !plan.text.trim())) throw new Error('原文中有无法随正文一起容纳的纯空白区间；未创建解析任务，原文保持不变。')
  return plans
}

/** Large-file plans retain only ranges/digests; request-sized text is released
 * after each window. The actual formal dispatch independently checks its frame. */
export async function planNewBlobDocumentImportV1(input: PlanTarget & {
  source: ImportBlobTextSourceV1; signal?: AbortSignal; manualChunkChars?: number
  onProgress?: (chars: number, total: number) => void
}) {
  const { fits, inputBudgetTokens } = await preparePlan(input)
  // IO window bounds allocation; it never truncates the source or substitutes a summary.
  const windowChars = Math.max(8, Math.min(1_048_576, Math.floor(inputBudgetTokens * 4), input.manualChunkChars ?? Infinity))
  let nextWindowChars = windowChars
  const plans: (Omit<ChunkPlan, 'text'> & { sourceTextHash: string })[] = []
  let start = 0
  while (start < input.source.totalChars) {
    input.signal?.throwIfAborted()
    let end = Math.min(input.source.totalChars, start + nextWindowChars)
    if (end < input.source.totalChars) {
      const pair = await input.source.read(end - 1, end + 1, input.signal)
      if ((/[\uD800-\uDBFF]/.test(pair[0]) && /[\uDC00-\uDFFF]/.test(pair[1])) || pair === '\r\n') end--
    }
    const text = await input.source.read(start, end, input.signal)
    const offset = plans.length
    const local = planAdaptiveDocumentParseChunksV1(text, (chunk) => fits({ ...chunk, index: offset + chunk.index,
      startChar: start + chunk.startChar, endChar: start + chunk.endChar }, input.source.totalChars))
    for (const plan of local) {
      if (!plan.text.trim()) throw new Error('原文中有无法随正文一起容纳的纯空白区间；未创建解析任务，原文保持不变。')
      plans.push({ index: plans.length, startChar: start + plan.startChar, endChar: start + plan.endChar,
        charCount: plan.charCount, label: `区段 ${plans.length + 1}`, sourceTextHash: await hashImportChunkTextV1(plan.text) })
    }
    // Reuse the largest actually admitted span as the next IO probe. Repeated
    // pages must not binary-search the same oversized window thousands of times.
    // Every new page still passes the complete-frame check; this grants no fit.
    nextWindowChars = Math.max(8, Math.min(windowChars, Math.max(...local.map(plan => plan.charCount))))
    start = end
    input.onProgress?.(start, input.source.totalChars)
  }
  // Counts in customized templates may affect the frame: verify the final value.
  for (const plan of plans) {
    input.signal?.throwIfAborted()
    const text = await input.source.read(plan.startChar, plan.endChar, input.signal)
    if (!fits({ ...plan, text }, plans.length)) throw new Error('完整请求超出当前文档解析预算；未创建解析任务。')
  }
  return plans
}
