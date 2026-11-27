import { planAdaptiveDocumentParseChunksV1 } from './chunker'
import { prepareDocumentParseRequestConfigV1 } from './document-parse-durable'
import { assessDocumentParseRequestV1, buildDocumentParseFrameV1, DOCUMENT_PARSE_KNOWN_CONTEXT_V1 } from './document-parse-request'
import { loadCodexImportCategoryOptions } from './codex-classification'
import { requireFixedBudgetValueV1 } from '../agent/finite-budget'
import { useCodexStore } from '../../stores/codex'
import { usePromptStore } from '../../stores/prompt'
import { resolveScope } from '../workspace/scope'
import { verifyImportProjectTargetGroupV1 } from '../../stores/import-session'
import type { ImportTarget, WorkspaceScope } from '../types'

/** New sessions only. This is local feasibility, never a request/claim or an AI context bypass.
 * Dispatch still reads its registered sources and rechecks the complete actual frame. */
export async function planNewDocumentImportV1(input: {
  scope: WorkspaceScope; importTarget: ImportTarget; targetWorldGroupId: number | null; text: string
}) {
  const scope = await resolveScope({ scope: input.scope, projectId: input.scope.projectId })
  if (input.importTarget === 'project') await verifyImportProjectTargetGroupV1(scope, input.targetWorldGroupId)
  else if (input.targetWorldGroupId !== null) throw new Error('项目参考不能绑定写入世界组。')
  const { resolved, skill, inputBudgetTokens } = await prepareDocumentParseRequestConfigV1(scope.projectId)
  if (input.importTarget === 'project') await useCodexStore.getState().ensureBuiltIns(scope)
  // The same scoped catalog loader used by the registered import source. No
  // session exists yet; the formal source independently freezes it at dispatch.
  const categories = input.importTarget === 'project' ? await loadCodexImportCategoryOptions(scope, { initialize: false }) : []
  const template = structuredClone(usePromptStore.getState().getActive('import.parse-chunk'))
  const plans = planAdaptiveDocumentParseChunksV1(input.text, (chunk, totalChunks) => {
    const frame = buildDocumentParseFrameV1({ template, provider: resolved.config.provider, sourceText: chunk.text,
      chunkIndex: chunk.index, totalChunks, categories, knownContext: DOCUMENT_PARSE_KNOWN_CONTEXT_V1 })
    if (chunk.text.length && !frame.messages.some(message => message.content.includes(chunk.text)))
      throw new Error('文档解析模板没有完整包含本块原文；未创建解析任务。')
    return assessDocumentParseRequestV1({ config: resolved.config, ...frame,
      maxInputTokens: inputBudgetTokens, maxOutputTokens: requireFixedBudgetValueV1(skill.maxOutputTokens) }).fits
  })
  if (plans.some(plan => !plan.text.trim())) throw new Error('原文中有无法随正文一起容纳的纯空白区间；未创建解析任务，原文保持不变。')
  return plans
}
