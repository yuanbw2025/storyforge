/**
 * assembleContext(Phase 1.3a) · 统一上下文装配入口。
 *
 * 1.3a 只新增入口。1.3b 再把 ai.start/chat 调用迁移到这里。
 */
import { estimateTokens, getModelPreset, type ContextLayer, type ContextSegment } from '../ai/context-budget'
import { CONTEXT_SOURCES, CONTEXT_SOURCE_BY_KEY } from './context-sources'
import type {
  AssembleContextInput,
  AssembleContextResult,
  AssembleContextSourceEvidence,
  ContextSource,
} from './types'
import { prepareContinuityContext } from '../ai/chapter-memory/continuity-context'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { db } from '../db/schema'
import { assertRecordInScope, resolveReadScope } from '../world-engine/scope'

/** 拿不到模型时的保守默认输入预算(原固定 24K 偏紧,放宽避免内部提前裁) */
const FALLBACK_INPUT_BUDGET = 48_000
const LAYERS_BY_TRIM_PRIORITY: ContextLayer[] = ['L3', 'L2', 'L1']

interface KeyedContextSegment {
  key: string
  segment: ContextSegment
  sourceHash: string
  originalTokens: number
  delivery: 'full' | 'compressed' | 'truncated'
  compression?: AssembleContextSourceEvidence['compression']
}

async function assertSourceTransformResult(
  result: NonNullable<Awaited<ReturnType<NonNullable<AssembleContextInput['sourceTransformer']>>>>,
  input: {
    content: string
    originalTokens: number
    sourceBudgetTokens: number
    inputBudgetTokens: number
  },
): Promise<void> {
  const evidence = result.compression
  if (
    evidence.version !== 1
    || evidence.promptVersion !== 'agent-context-compression-v1'
    || evidence.sourceHash !== await sha256Text(input.content)
    || evidence.targetTokens !== input.sourceBudgetTokens
    || !Number.isInteger(evidence.attempts)
    || evidence.attempts < 0
    || !Number.isInteger(evidence.requiredAnchorCount)
    || evidence.requiredAnchorCount < 1
    || !Number.isInteger(evidence.coveredAnchorCount)
    || evidence.coveredAnchorCount < 0
    || evidence.coveredAnchorCount > evidence.requiredAnchorCount
  ) throw new Error('[assembleContext] 上下文转换证据无效')
  if (evidence.outcome === 'verified') {
    if (
      evidence.fallback !== 'none'
      || !/^[a-f0-9]{64}$/.test(evidence.artifactHash ?? '')
      || evidence.coveredAnchorCount !== evidence.requiredAnchorCount
      || result.delivery !== 'compressed'
      || !result.content
      || estimateTokens(result.content) >= input.originalTokens
      || estimateTokens(result.content) > input.sourceBudgetTokens
      || result.allowSourceBudgetOverflow
    ) throw new Error('[assembleContext] 已验证压缩产物与交付内容不一致')
    return
  }
  if (
    evidence.outcome !== 'fallback'
    || evidence.fallback === 'none'
    || evidence.artifactHash !== undefined
    || !evidence.failureCode?.trim()
  ) throw new Error('[assembleContext] 上下文转换回退证据无效')
  if (evidence.fallback === 'full-source') {
    if (
      result.content !== input.content
      || result.delivery !== 'full'
      || result.allowSourceBudgetOverflow !== true
      || input.originalTokens > input.inputBudgetTokens
    ) throw new Error('[assembleContext] 单来源全文回退越界')
  } else if (result.content !== undefined || result.delivery !== undefined || result.allowSourceBudgetOverflow) {
    throw new Error('[assembleContext] 确定性截断回退不得提供旁路内容')
  }
}

/**
 * 输入预算 = 所选模型的上下文窗口(减输出预留与安全边际)。
 * 这样上下文只在「真的接近模型窗口」时才按优先级软裁,而不是被固定小预算提前砍。
 */
function deriveInputBudget(input: AssembleContextInput): number {
  if (input.inputBudgetTokens && input.inputBudgetTokens > 0) return input.inputBudgetTokens
  let modelBudget = FALLBACK_INPUT_BUDGET
  if (input.provider && input.model) {
    const preset = getModelPreset(input.provider, input.model)
    const budget = preset.maxContext - preset.maxOutput - Math.round(preset.maxContext * 0.05)
    if (budget > 0) modelBudget = budget
  }
  if (input.inputBudgetMaxTokens && input.inputBudgetMaxTokens > 0) {
    return Math.min(modelBudget, input.inputBudgetMaxTokens)
  }
  return modelBudget
}

export async function assembleContext(input: AssembleContextInput): Promise<AssembleContextResult> {
  const scope = await resolveReadScope(input)
  const resolvedBase: AssembleContextInput = { ...input, projectId: scope.projectId, scope }
  const selected = selectSources(resolvedBase)
  await assertContextAnchors(resolvedBase, selected)
  const inputBudget = deriveInputBudget(input)
  const needsContinuity = selected.some(source => (
    source.key === 'previousChapterEnding'
    || source.key === 'chapterContinuityHandoff'
    || source.key === 'previousPlanReconciliation'
    || source.key === 'recentChapterSummaries'
  ))
  const resolvedInput: AssembleContextInput = needsContinuity && resolvedBase.chapterId != null
    ? {
        ...resolvedBase,
        continuitySnapshot: resolvedBase.continuitySnapshot ?? await prepareContinuityContext({
          projectId: scope.projectId,
          chapterId: resolvedBase.chapterId,
          scope,
        }),
      }
    : resolvedBase
  const omitted: string[] = []
  const omittedEvidence: AssembleContextSourceEvidence[] = []
  const keyedSegments: KeyedContextSegment[] = []

  const omit = (key: string, sourceHash?: string): void => {
    omitted.push(key)
    omittedEvidence.push({
      key,
      status: 'omitted',
      delivery: 'none',
      ...(sourceHash ? { sourceHash } : {}),
      originalTokens: 0,
      inputTokens: 0,
    })
  }

  for (const source of selected) {
    if (source.ownerFrom && source.ownerFrom !== 'workspace' && source.ownerFrom !== 'instance') {
      const ownerId = source.ownerFrom === 'world' ? scope.worldId : scope.workId
      if (!Number.isInteger(ownerId)) {
        omit(source.key)
        continue
      }
    }
    if (!requirementsMet(source, resolvedInput)) {
      omit(source.key)
      continue
    }
    if (source.enabled && !await source.enabled(resolvedInput)) {
      omit(source.key)
      continue
    }
    const content = await source.read(resolvedInput)
    const sourceHash = await sha256Text(content)
    if (!content.trim()) {
      omit(source.key, sourceHash)
      continue
    }
    // 单一源也不能突破整个请求预算。L0/protected 只表示不得整段丢弃，
    // 不表示可以绕过总窗口；截断会留下显式标记并进入 tokens 元数据。
    const sourceBudgetScale = Number.isFinite(input.sourceBudgetScale)
      ? Math.max(0.1, Math.min(1, input.sourceBudgetScale!))
      : 1
    const scaledSourceBudget = Math.max(64, Math.floor(source.budgetTokens * sourceBudgetScale))
    const sourceBudgetTokens = Math.min(scaledSourceBudget, inputBudget)
    const originalTokens = estimateTokens(content)
    const transformed = originalTokens > sourceBudgetTokens && input.sourceTransformer
      ? await input.sourceTransformer({
          source: {
            key: source.key,
            label: source.label,
            layer: source.layer,
            budgetTokens: source.budgetTokens,
            protectedFromTrim: source.protectedFromTrim,
          },
          content,
          originalTokens,
          sourceBudgetTokens,
          inputBudgetTokens: inputBudget,
        })
      : undefined
    if (transformed) {
      await assertSourceTransformResult(transformed, {
        content,
        originalTokens,
        sourceBudgetTokens,
        inputBudgetTokens: inputBudget,
      })
    }
    let preparedContent = content
    let delivery: KeyedContextSegment['delivery'] = 'full'
    if (transformed?.content != null) {
      const transformedTokens = estimateTokens(transformed.content)
      const overflowAllowed = transformed.allowSourceBudgetOverflow === true
        && transformed.delivery === 'full'
        && transformed.content === content
        && transformedTokens <= inputBudget
      if (transformedTokens > sourceBudgetTokens && !overflowAllowed) {
        throw new Error(`[assembleContext] 来源 ${source.key} 转换后仍超出预算`)
      }
      preparedContent = transformed.content
      delivery = transformed.delivery ?? (transformedTokens < originalTokens ? 'compressed' : 'full')
    }
    const capped = delivery === 'full'
      && preparedContent === content
      && originalTokens > sourceBudgetTokens
      && transformed?.allowSourceBudgetOverflow !== true
      ? capContextSourceByBudget(content, sourceBudgetTokens)
      : { content: preparedContent, truncated: false }
    keyedSegments.push({
      key: source.key,
      sourceHash,
      segment: {
        label: source.label,
        layer: source.layer,
        content: capped.content,
        tokens: estimateTokens(capped.content),
        trimmable: source.layer !== 'L0' && !source.protectedFromTrim,
      },
      originalTokens,
      delivery: capped.truncated ? 'truncated' : delivery,
      compression: transformed?.compression,
    })
  }

  const totalBeforeTrim = keyedSegments.reduce((sum, s) => sum + s.segment.tokens, 0)
  const overBudgetBeforeTrim = totalBeforeTrim > inputBudget
  const { kept, trimmed } = trimToFit(keyedSegments, inputBudget)
  const segments = kept.map(s => s.segment)
  const totalInputTokens = segments.reduce((sum, s) => sum + s.tokens, 0)
  const keptKeys = new Set(kept.map(item => item.key))
  const sourceEvidence: AssembleContextSourceEvidence[] = selected.map(source => {
    const omittedItem = omittedEvidence.find(item => item.key === source.key)
    if (omittedItem) return omittedItem
    const item = keyedSegments.find(segment => segment.key === source.key)
    if (!item) {
      throw new Error(`[assembleContext] 来源 ${source.key} 缺少装配证据`)
    }
    if (!keptKeys.has(source.key)) {
      return {
        key: source.key,
        status: 'trimmed',
        delivery: 'none',
        sourceHash: item.sourceHash,
        originalTokens: item.originalTokens,
        inputTokens: 0,
      }
    }
    return {
      key: source.key,
      status: 'included',
      delivery: item.delivery,
      sourceHash: item.sourceHash,
      originalTokens: item.originalTokens,
      inputTokens: item.segment.tokens,
      ...(item.compression ? { compression: item.compression } : {}),
    }
  })

  return {
    text: segments.map(s => s.content).join('\n\n'),
    segments,
    included: kept.map(s => s.key),
    omitted,
    trimmed,
    sourceEvidence,
    totalInputTokens,
    inputBudget,
    overBudgetBeforeTrim,
    overBudgetAfterTrim: totalInputTokens > inputBudget,
  }
}

async function assertContextAnchors(input: AssembleContextInput, selected: ContextSource[]): Promise<void> {
  if (!input.scope) return
  const detachedContinuity = input.continuitySnapshot != null
    && selected.length > 0
    && selected.every(source => source.acceptsDetachedContinuitySnapshot)
  if (input.chapterId != null && !detachedContinuity) {
    const chapter = await db.chapters.get(input.chapterId)
    if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) {
      throw new Error('[assembleContext] chapterId 不属于当前 Work')
    }
  }
  if (input.outlineNodeId != null) {
    const node = await db.outlineNodes.get(input.outlineNodeId)
    if (!node || !await assertRecordInScope(input.scope, 'outlineNodes', node, { owner: 'work' })) {
      throw new Error('[assembleContext] outlineNodeId 不属于当前 Work')
    }
  }
  // Runtime readers omit foreign sessions themselves and surface only same-scope
  // snapshot-integrity failures, preserving a fail-closed read contract.
}

function selectSources(input: AssembleContextInput): ContextSource[] {
  if (!input.sourceKeys?.length) return CONTEXT_SOURCES
  return input.sourceKeys
    .map(key => CONTEXT_SOURCE_BY_KEY.get(key))
    .filter((source): source is ContextSource => !!source)
}

function requirementsMet(source: ContextSource, input: AssembleContextInput): boolean {
  if (source.requiresWorldGroupId && !Object.prototype.hasOwnProperty.call(input, 'worldGroupId')) return false
  if (source.requiresSimulationSessionId && input.simulationSessionId == null) return false
  if (source.requiresOutlineNodeId && input.outlineNodeId == null && input.chapterId == null) return false
  if (
    source.requiresChapterId
    && input.chapterId == null
    && !(source.acceptsOutlineNodeAsChapterBoundary && input.outlineNodeId != null)
  ) return false
  return true
}

/** Shared deterministic source cap used by production assembly and paired evals. */
export function capContextSourceByBudget(
  content: string,
  budgetTokens: number,
): { content: string; truncated: boolean } {
  if (!budgetTokens || estimateTokens(content) <= budgetTokens) {
    return { content, truncated: false }
  }
  const marker = '\n…（该上下文源已按预算截断）'
  let low = 0
  let high = content.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (estimateTokens(`${content.slice(0, middle)}${marker}`) <= budgetTokens) low = middle
    else high = middle - 1
  }
  return { content: `${content.slice(0, low)}${marker}`, truncated: true }
}

function trimToFit(
  segments: KeyedContextSegment[],
  inputBudget: number,
): { kept: KeyedContextSegment[]; trimmed: string[] } {
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
