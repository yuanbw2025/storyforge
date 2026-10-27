import type { ChatMessage, PromptTemplate } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'
import {
  CONTINUITY_CORE_END,
  CONTINUITY_CORE_START,
} from '../chapter-memory/continuity-envelope'
import { appendSimplifiedChineseOutputConstraint } from './prompt-guards'
import { proseLengthExpectationV1 } from '../../prose/length-observation'
import { SCENE_EXECUTION_GUIDANCE_V1 } from '../../prose/scene-craft'

export interface RunOptions {
  parameterValues?: Record<string, unknown>
  overrides?: { systemPrompt?: string; userPromptTemplate?: string }
  continuity?: {
    handoff?: string
    planReconciliation?: string
    previousTail?: string
    recentSummaries?: string
  }
  continuityBudgetTokens?: number
  /** 仅用于冻结旧生产基线，正常创作不得设置。 */
  skipContinuityEnvelope?: boolean
  /** 正式路径的原 Gateway packet；不得靠词语过滤删掉已声明读取的资料。 */
  requiredGatewayContext?: string
}

export interface ChapterPromptRequestV1 {
  messages: ChatMessage[]
  modelOverride?: { temperature?: number; maxTokens?: number }
}

const QUARANTINED_GENERATION_MARKERS = ['未来计划', '尚未发生', '异世界档案']

/**
 * Planning-only and foreign-world sentences can remain available to planning
 * tools, but prose generation must not see them as competing current canon.
 */
export function sanitizeProseGenerationContext(text: string): string {
  if (!text) return text
  const chunks = text.match(/[^。！？\n]*[。！？\n]?/gu) ?? [text]
  return chunks
    .filter(chunk => !QUARANTINED_GENERATION_MARKERS.some(marker => chunk.includes(marker)))
    .join('')
    .trim()
}

function trimPart(text: string, maxChars: number, keepTail = false): string {
  if (!text || text.length <= maxChars) return text
  return keepTail
    ? `…（前部压缩）\n${text.slice(-maxChars)}`
    : `${text.slice(0, maxChars)}\n…（后部压缩）`
}

function buildContinuityEnvelope(args: {
  task: string
  continuity?: RunOptions['continuity']
  currentDraftTail?: string
  budgetTokens?: number
}): string {
  const budget = Math.max(1200, args.budgetTokens ?? 3200)
  const approxChars = Math.floor(budget * 0.62)
  const taskChars = Math.max(180, Math.floor(approxChars * 0.15))
  const memoryCount = Number(!!args.continuity?.handoff) + Number(!!args.continuity?.planReconciliation)
  const memoryPoolChars = Math.max(240, Math.floor(approxChars * 0.25))
  const memoryPartChars = memoryCount > 0 ? Math.floor(memoryPoolChars / memoryCount) : 0
  const tailPoolChars = Math.max(400, Math.floor(approxChars * 0.4))
  const hasPreviousTail = !!args.continuity?.previousTail
  const hasCurrentDraftTail = !!args.currentDraftTail
  const tailCount = Number(hasPreviousTail) + Number(hasCurrentDraftTail)
  const tailChars = tailCount > 0 ? Math.floor(tailPoolChars / tailCount) : 0
  const summaryChars = Math.max(180, approxChars - taskChars - memoryPoolChars - tailPoolChars)
  const parts = [
    CONTINUITY_CORE_START,
    `【本章任务与章纲】\n${trimPart(args.task, taskChars)}`,
  ]
  if (args.continuity?.handoff) {
    parts.push(`【直接前驱 handoff】\n${trimPart(args.continuity.handoff, memoryPartChars)}`)
  }
  if (args.continuity?.planReconciliation) {
    parts.push(`【前章实际进展与计划冲突】\n${trimPart(args.continuity.planReconciliation, memoryPartChars)}`)
  }
  if (args.continuity?.previousTail) {
    parts.push(`【直接前驱真实 tail】\n${trimPart(args.continuity.previousTail, tailChars, true)}`)
  }
  if (args.currentDraftTail) {
    parts.push(`【当前正文续写锚点】\n${trimPart(args.currentDraftTail, tailChars, true)}`)
  }
  if (args.continuity?.recentSummaries) {
    parts.push(`【当前世界最近 verified summaries】\n${trimPart(args.continuity.recentSummaries, summaryChars)}`)
  }
  parts.push(
    '连续性执行协议：核对已发生事实、禁令与人物认知，按章纲和场景规定的次序安排目标、行动、选择与兑现；后段重点保留在对应场景，不提前结算奖励。缓冲、留白与悬念以作者任务为准，不强制每段发生冲突。规划的退出状态与奖励不代表已经发生。',
    SCENE_EXECUTION_GUIDANCE_V1,
    '篇幅纪律：优先完成本章任务终点与全部硬约束，再补充氛围和细节；不得在关键动作完成前耗尽篇幅。',
    '以上内容是最低连续性约束；不得用未来章或其他世界资料覆盖。',
    CONTINUITY_CORE_END,
  )
  return parts.join('\n\n')
}

/** 保留作者模板；模板缺少 worldContext 时，仍交付同一份已冻结的必读 packet。 */
function deliverRequiredGatewayContext(messages: ChatMessage[], content: string | undefined): ChatMessage[] {
  if (content === undefined || messages.some(message => message.content.includes(content))) return messages
  const required = `【本轮必读资料 · 已冻结 Context Gateway】\n${content}`
  return [...messages, { role: 'user', content: required }]
}

/** A custom template may omit userHint; explicit author requirements must still reach this request. */
function deliverAuthorHint(messages: ChatMessage[], hint: string | undefined): ChatMessage[] {
  const content = hint?.trim()
  if (!content || messages.some(message => message.content.includes(content))) return messages
  return [...messages, { role: 'user', content: `【本轮作者补充要求】\n${content}` }]
}

function injectContinuityEnvelope(
  messages: ChatMessage[],
  mode: 'inherit' | 'required' | 'off' | undefined,
  envelope: string,
): ChatMessage[] {
  if (mode === 'off') return messages
  return messages.map((message, index) => (
    index === messages.length - 1 && message.role === 'user'
      ? { ...message, content: `${message.content}\n\n${envelope}` }
      : message
  ))
}

/** Align the managed length variable with this request, without changing the
 * stored template, literal prose, or the author's optional-parameter choices. */
function authorLengthOptionsV1(template: PromptTemplate, userHint: string | undefined, options: RunOptions | undefined): RunOptions | undefined {
  const length = proseLengthExpectationV1(userHint ?? '')
  const parameterKey = template.moduleKey === 'chapter.continue' ? 'continueLength' : 'chapterLength'
  const parameter = template.parameters?.find(item => item.key === parameterKey)
  if (!length || !parameter) return options
  const current = options?.parameterValues ? options.parameterValues[parameterKey] : parameter.default
  if (parameter.optional && (current === undefined || current === null || current === '' || current === false || current === 0)) return options
  const value = length.target ?? (length.min !== null && length.max !== null
    ? `${length.min}～${length.max}` : length.min !== null ? `≥${length.min}` : `≤${length.max}`)
  const parameterValues = options?.parameterValues ? { ...options.parameterValues }
    : Object.fromEntries((template.parameters ?? []).map(item => [item.key, item.default]))
  return { ...options, parameterValues: { ...parameterValues, [parameterKey]: value } }
}

export function buildChapterContentRequestV1(
  chapterTitle: string,
  chapterSummary: string,
  worldContext: string,
  characterContext: string,
  previousChapterEnding: string,
  worldRulesContext?: string,
  userHint?: string,
  options?: RunOptions,
): ChapterPromptRequestV1 {
  const tpl = usePromptStore.getState().getActive('chapter.content')
  const safeWorldContext = options?.skipContinuityEnvelope || options?.requiredGatewayContext !== undefined
    ? worldContext
    : sanitizeProseGenerationContext(worldContext)
  const { messages, modelOverride } = renderPrompt(tpl, {
    chapterTitle,
    chapterSummary,
    worldContext: safeWorldContext || '（暂无）',
    characters: characterContext || '（暂无角色设定）',
    previousChapterEnding: options?.continuity ? '（见文末连续性保护块）' : (previousChapterEnding || '（这是第一章）'),
    worldRulesContext: worldRulesContext || '',
    userHint,
  }, authorLengthOptionsV1(tpl, userHint, options))
  const envelope = buildContinuityEnvelope({
    task: `${chapterTitle}\n${chapterSummary}`,
    continuity: options?.continuity,
    budgetTokens: options?.continuityBudgetTokens,
  })
  const guarded = appendSimplifiedChineseOutputConstraint(userHint?.trim() ? messages.map(message => message.role === 'system'
    ? { ...message, content: `${message.content}\n\n本轮作者明确指定的篇幅、文风、章节收尾和禁止事项优先于模板默认值。达到作者指定的结束位置就停止，不为凑默认字数追加情节；仍须遵守作品信息边界。` }
    : message) : messages)
  const result = options?.skipContinuityEnvelope
    ? guarded
    : injectContinuityEnvelope(guarded, tpl.continuityMode, envelope)
  return { messages: deliverRequiredGatewayContext(deliverAuthorHint(result, userHint), options?.requiredGatewayContext), ...(modelOverride ? { modelOverride: { ...modelOverride } } : {}) }
}

export function buildChapterContentPrompt(...args: Parameters<typeof buildChapterContentRequestV1>): ChatMessage[] {
  return buildChapterContentRequestV1(...args).messages
}

export function buildContinueRequestV1(
  existingContent: string,
  chapterSummary: string,
  worldContext: string,
  userHint?: string,
  options?: RunOptions,
): ChapterPromptRequestV1 {
  const tpl = usePromptStore.getState().getActive('chapter.continue')
  const safeWorldContext = options?.skipContinuityEnvelope || options?.requiredGatewayContext !== undefined
    ? worldContext
    : sanitizeProseGenerationContext(worldContext)
  const { messages, modelOverride } = renderPrompt(tpl, {
    chapterSummary,
    worldContext: safeWorldContext || '（暂无）',
    existingContent: existingContent.slice(-3000),
    userHint,
  }, authorLengthOptionsV1(tpl, userHint, options))
  const envelope = buildContinuityEnvelope({
    task: chapterSummary,
    continuity: options?.continuity,
    currentDraftTail: existingContent.slice(-1600),
    budgetTokens: options?.continuityBudgetTokens,
  })
  const guarded = appendSimplifiedChineseOutputConstraint(userHint?.trim() ? messages.map(message => message.role === 'system'
    ? { ...message, content: `${message.content}\n\n本轮作者明确指定的篇幅、文风、章节收尾和禁止事项优先于模板默认值。达到作者指定的结束位置就停止，不为凑默认字数追加情节；仍须遵守作品信息边界。` }
    : message) : messages)
  const result = options?.skipContinuityEnvelope
    ? guarded
    : injectContinuityEnvelope(guarded, tpl.continuityMode, envelope)
  return { messages: deliverRequiredGatewayContext(deliverAuthorHint(result, userHint), options?.requiredGatewayContext), ...(modelOverride ? { modelOverride: { ...modelOverride } } : {}) }
}

export function buildContinuePrompt(...args: Parameters<typeof buildContinueRequestV1>): ChatMessage[] {
  return buildContinueRequestV1(...args).messages
}

export function buildPolishPrompt(text: string, instruction: string, options?: RunOptions): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('chapter.polish')
  const { messages } = renderPrompt(tpl, { text, instruction }, options)
  return messages
}

export function buildExpandPrompt(text: string, hint?: string, options?: RunOptions): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('chapter.expand')
  const { messages } = renderPrompt(tpl, { text, userHint: hint }, options)
  return messages
}

export function buildDeAIPrompt(text: string, options?: RunOptions): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('chapter.de-ai')
  const { messages } = renderPrompt(tpl, { text }, options)
  return messages
}
