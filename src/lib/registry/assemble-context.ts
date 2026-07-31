/**
 * assembleContext(Phase 1.3a) · 统一上下文装配入口。
 *
 * 1.3a 只新增入口。1.3b 再把 ai.start/chat 调用迁移到这里。
 */
import { estimateTokens, getModelPreset, type ContextLayer, type ContextSegment } from '../ai/context-budget'
import { CONTEXT_SOURCES, CONTEXT_SOURCE_BY_KEY } from './context-sources'
import type { AssembleContextInput, AssembleContextResult, ContextSource } from './types'
import { prepareContinuityContext } from '../ai/chapter-memory/continuity-context'
import { getContextBudgetOverrides, getTotalBudgetOverride } from '../../stores/context-budget'

/** 拿不到模型时的保守默认输入预算(原固定 24K 偏紧,放宽避免内部提前裁) */
const FALLBACK_INPUT_BUDGET = 48_000
const LAYERS_BY_TRIM_PRIORITY: ContextLayer[] = ['L3', 'L2', 'L1']

/**
 * 输入预算 = 所选模型的上下文窗口(减输出预留与安全边际)。
 * 这样上下文只在「真的接近模型窗口」时才按优先级软裁,而不是被固定小预算提前砍。
 *
 * 优先级：调用方显式传入 > 设置区「总窗口预算」覆盖 > 模型预设 > 兜底。
 */
function deriveInputBudget(input: AssembleContextInput): number {
  if (input.inputBudgetTokens && input.inputBudgetTokens > 0) return input.inputBudgetTokens
  const userTotal = getTotalBudgetOverride()
  if (userTotal && userTotal > 0) return userTotal
  if (input.provider && input.model) {
    const preset = getModelPreset(input.provider, input.model)
    const budget = preset.maxContext - preset.maxOutput - Math.round(preset.maxContext * 0.05)
    if (budget > 0) return budget
  }
  return FALLBACK_INPUT_BUDGET
}

export async function assembleContext(input: AssembleContextInput): Promise<AssembleContextResult> {
  const selected = selectSources(input)
  const inputBudget = deriveInputBudget(input)
  // 设置区「提示词预算」面板的覆盖值：sourceKey → 自定义预算（无覆盖则用默认）。
  const budgetOverrides = getContextBudgetOverrides()
  const needsContinuity = selected.some(source => (
    source.key === 'previousChapterEnding'
    || source.key === 'chapterContinuityHandoff'
    || source.key === 'previousPlanReconciliation'
    || source.key === 'recentChapterSummaries'
  ))
  const resolvedInput: AssembleContextInput = needsContinuity && input.chapterId != null
    ? {
        ...input,
        continuitySnapshot: input.continuitySnapshot ?? await prepareContinuityContext({
          projectId: input.projectId,
          chapterId: input.chapterId,
        }),
      }
    : input
  const omitted: string[] = []
  const keyedSegments: { key: string; segment: ContextSegment }[] = []

  for (const source of selected) {
    if (!requirementsMet(source, resolvedInput)) {
      omitted.push(source.key)
      continue
    }
    if (source.enabled && !await source.enabled(resolvedInput)) {
      omitted.push(source.key)
      continue
    }
    const content = await source.read(resolvedInput)
    if (!content.trim()) {
      omitted.push(source.key)
      continue
    }
    // 单一源也不能突破整个请求预算。L0/protected 只表示不得整段丢弃，
    // 不表示可以绕过总窗口；截断会留下显式标记并进入 tokens 元数据。
    const sourceBudget = budgetOverrides[source.key] ?? source.budgetTokens
    const capped = capBySourceBudget(content, Math.min(sourceBudget, inputBudget))
    keyedSegments.push({
      key: source.key,
      segment: {
        label: source.label,
        layer: source.layer,
        content: capped,
        tokens: estimateTokens(capped),
        trimmable: source.layer !== 'L0' && !source.protectedFromTrim,
      },
    })
  }

  const totalBeforeTrim = keyedSegments.reduce((sum, s) => sum + s.segment.tokens, 0)
  const overBudgetBeforeTrim = totalBeforeTrim > inputBudget
  const { kept, trimmed } = trimToFit(keyedSegments, inputBudget)
  const segments = kept.map(s => s.segment)
  const totalInputTokens = segments.reduce((sum, s) => sum + s.tokens, 0)

  return {
    text: segments.map(s => s.content).join('\n\n'),
    segments,
    included: kept.map(s => s.key),
    omitted,
    trimmed,
    totalInputTokens,
    inputBudget,
    overBudgetBeforeTrim,
    overBudgetAfterTrim: totalInputTokens > inputBudget,
  }
}

function selectSources(input: AssembleContextInput): ContextSource[] {
  if (!input.sourceKeys?.length) return CONTEXT_SOURCES
  return input.sourceKeys
    .map(key => CONTEXT_SOURCE_BY_KEY.get(key))
    .filter((source): source is ContextSource => !!source)
}

function requirementsMet(source: ContextSource, input: AssembleContextInput): boolean {
  if (source.requiresWorldGroupId && !Object.prototype.hasOwnProperty.call(input, 'worldGroupId')) return false
  if (source.requiresOutlineNodeId && input.outlineNodeId == null && input.chapterId == null) return false
  if (
    source.requiresChapterId
    && input.chapterId == null
    && !(source.acceptsOutlineNodeAsChapterBoundary && input.outlineNodeId != null)
  ) return false
  return true
}

function capBySourceBudget(content: string, budgetTokens: number): string {
  if (!budgetTokens || estimateTokens(content) <= budgetTokens) return content
  const marker = '\n…（该上下文源已按预算截断）'
  let low = 0
  let high = content.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateTokens(`${content.slice(0, middle)}${marker}`) <= budgetTokens) low = middle
    else high = middle - 1
  }
  return `${content.slice(0, low)}${marker}`
}

function trimToFit(
  segments: { key: string; segment: ContextSegment }[],
  inputBudget: number,
): { kept: { key: string; segment: ContextSegment }[]; trimmed: string[] } {
  let kept = [...segments]
  const trimmed: string[] = []
  let total = kept.reduce((sum, s) => sum + s.segment.tokens, 0)
  if (total <= inputBudget) return { kept, trimmed }

  for (const layer of LAYERS_BY_TRIM_PRIORITY) {
    if (total <= inputBudget) break
    const removed = kept.filter(s => s.segment.layer === layer && s.segment.trimmable)
    if (!removed.length) continue
    kept = kept.filter(s => s.segment.layer !== layer || !s.segment.trimmable)
    total = kept.reduce((sum, s) => sum + s.segment.tokens, 0)
    trimmed.push(...removed.map(s => s.key))
  }

  return { kept, trimmed }
}
