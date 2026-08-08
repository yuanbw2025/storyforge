import JSON5 from 'json5'
import { chat } from '../ai/client'
import { estimateTokens } from '../ai/context-budget'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import type { AIConfig, ChatMessage } from '../types'
import type {
  ContextCompressionEvidenceV1,
  ContextSourceTransformInput,
  ContextSourceTransformResult,
  ContextSourceTransformer,
} from '../registry/types'
import { hashCanonicalValue } from './run/hash'
import type { AgentSkillContextCompressionPolicyV1 } from './skill-registry'
import type { AgentTeamBudgetTracker } from './team-budget'

export const AGENT_CONTEXT_COMPRESSION_PROMPT_VERSION = 'agent-context-compression-v1' as const

export type ContextCompressionAnchorKindV1 = 'constraint' | 'boundary' | 'timeline' | 'identity'

export interface ContextCompressionAnchorV1 {
  id: string
  kind: ContextCompressionAnchorKindV1
  quote: string
}

export interface VerifiedContextCompressionArtifactV1 {
  version: 1
  promptVersion: typeof AGENT_CONTEXT_COMPRESSION_PROMPT_VERSION
  sourceKey: string
  sourceHash: string
  originalTokens: number
  targetTokens: number
  summary: string
  anchors: ContextCompressionAnchorV1[]
  artifactHash: string
}

interface CompressionCandidateV1 {
  version: 1
  summary: string
  coveredAnchorIds: string[]
  evidenceQuotes: Array<{ anchorId: string; quote: string }>
}

export interface AgentContextCompressionRuntimeV1 {
  budget: AgentTeamBudgetTracker
  /** Final generation calls and the remaining Canon retry must stay available. */
  requiredFutureModelCalls: number
  complete?: (
    messages: ChatMessage[],
    request: { maxOutputTokens: number; temperature: number },
  ) => Promise<string>
}

export interface AgentContextCompressionSessionV1 {
  sourceTransformer: ContextSourceTransformer
  attemptedSourceKeys(): string[]
}

const CONSTRAINT_PATTERN = /不得|禁止|不能|不可|必须|只能|仅限|唯一|务必|除非|例外|上限|下限|规则|代价/u
const BOUNDARY_PATTERN = /不知|未知|秘密|隐瞒|尚未|当前章|后续|未来|视角|认知|获知|知晓|透露/u
const TIMELINE_PATTERN = /第\s*[零〇一二两三四五六七八九十百千万\d]+\s*[章节卷幕年日月]|\d{2,}|公元|纪元|年前|年后|此前|之后/u
const IDENTITY_PATTERN = /^【[^】]{1,80}】|^[^\n]{1,60}[：:=]/u

function normalizedSentences(content: string): string[] {
  return content
    .replace(/\r\n?/g, '\n')
    .split(/\n+|(?<=[。！？!?；;])\s*/u)
    .map(value => value.trim())
    .filter(Boolean)
}

function anchorKind(value: string): ContextCompressionAnchorKindV1 | null {
  if (CONSTRAINT_PATTERN.test(value)) return 'constraint'
  if (BOUNDARY_PATTERN.test(value)) return 'boundary'
  if (TIMELINE_PATTERN.test(value)) return 'timeline'
  if (IDENTITY_PATTERN.test(value)) return 'identity'
  return null
}

function anchorExcerpt(value: string, kind: ContextCompressionAnchorKindV1): string {
  const pattern = kind === 'constraint'
    ? CONSTRAINT_PATTERN
    : kind === 'boundary'
      ? BOUNDARY_PATTERN
      : kind === 'timeline'
        ? TIMELINE_PATTERN
        : IDENTITY_PATTERN
  const index = value.search(pattern)
  const start = index < 0 ? 0 : Math.max(0, index - 80)
  return value.slice(start, start + 240).trim()
}

/** Deterministic, source-verifiable excerpts that the semantic summary cannot erase. */
export function extractContextCompressionAnchorsV1(input: {
  content: string
  targetTokens: number
  maxAnchors?: number
}): ContextCompressionAnchorV1[] {
  const sentences = normalizedSentences(input.content)
  const ranked = sentences.flatMap((quote, index) => {
    const kind = anchorKind(quote)
    if (!kind) return []
    const rank = kind === 'constraint' ? 0 : kind === 'boundary' ? 1 : kind === 'timeline' ? 2 : 3
    return [{ quote: anchorExcerpt(quote, kind), kind, rank, index }]
  }).sort((left, right) => left.rank - right.rank || left.index - right.index)
  const lastChunkStart = Math.max(0, input.content.length - 240)
  const fallback = [0, Math.floor(lastChunkStart / 2), lastChunkStart]
    .map((start, index) => ({
      quote: input.content.slice(start, start + 240).trim(),
      kind: 'identity' as const,
      rank: 4,
      index,
    }))
    .filter(candidate => candidate.quote)
  const candidates = [...ranked, ...fallback]
  const seen = new Set<string>()
  const selected: Array<Omit<ContextCompressionAnchorV1, 'id'>> = []
  const anchorBudget = Math.max(48, Math.floor(input.targetTokens * 0.38))
  let usedTokens = 0
  for (const candidate of candidates) {
    if (seen.has(candidate.quote)) continue
    const tokens = estimateTokens(candidate.quote) + 8
    if (selected.length > 0 && usedTokens + tokens > anchorBudget) continue
    seen.add(candidate.quote)
    selected.push({ kind: candidate.kind, quote: candidate.quote })
    usedTokens += tokens
    if (selected.length >= (input.maxAnchors ?? 12)) break
  }
  return selected.map((anchor, index) => ({ ...anchor, id: `A${index + 1}` }))
}

function parseCandidate(raw: string): CompressionCandidateV1 {
  const stripped = raw.trim().replace(/^```(?:json|json5)?\s*/i, '').replace(/\s*```$/i, '')
  const first = stripped.indexOf('{')
  const last = stripped.lastIndexOf('}')
  if (first < 0 || last <= first) throw new Error('compression-json-missing')
  const value = JSON5.parse(stripped.slice(first, last + 1)) as Record<string, unknown>
  const allowed = new Set(['version', 'summary', 'coveredAnchorIds', 'evidenceQuotes'])
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('compression-json-unknown-field')
  if (value.version !== 1 || typeof value.summary !== 'string' || value.summary.trim().length < 8) {
    throw new Error('compression-summary-invalid')
  }
  if (!Array.isArray(value.coveredAnchorIds) || value.coveredAnchorIds.some(id => typeof id !== 'string')) {
    throw new Error('compression-anchor-ids-invalid')
  }
  if (!Array.isArray(value.evidenceQuotes) || value.evidenceQuotes.some(item => (
    !item || typeof item !== 'object' || Array.isArray(item)
    || typeof (item as Record<string, unknown>).anchorId !== 'string'
    || typeof (item as Record<string, unknown>).quote !== 'string'
  ))) throw new Error('compression-evidence-invalid')
  return {
    version: 1,
    summary: value.summary.trim(),
    coveredAnchorIds: value.coveredAnchorIds as string[],
    evidenceQuotes: (value.evidenceQuotes as Array<Record<string, unknown>>).map(item => ({
      anchorId: item.anchorId as string,
      quote: item.quote as string,
    })),
  }
}

function buildCompressedContent(summary: string, anchors: readonly ContextCompressionAnchorV1[]): string {
  return [
    '【经校验的语义压缩导航摘要（不得覆盖 Canon 或原文锚点）】',
    summary,
    '【必须保留的原文锚点】',
    ...anchors.map(anchor => `[${anchor.id}/${anchor.kind}] ${anchor.quote}`),
  ].join('\n')
}

async function verifyCandidate(input: {
  candidate: CompressionCandidateV1
  sourceKey: string
  sourceHash: string
  sourceText: string
  originalTokens: number
  targetTokens: number
  anchors: ContextCompressionAnchorV1[]
}): Promise<{ artifact: VerifiedContextCompressionArtifactV1; content: string }> {
  const ids = input.candidate.coveredAnchorIds
  if (new Set(ids).size !== ids.length) throw new Error('compression-anchor-ids-duplicate')
  const requiredIds = input.anchors.map(anchor => anchor.id)
  if (ids.length !== requiredIds.length || requiredIds.some(id => !ids.includes(id))) {
    throw new Error('compression-anchor-coverage-incomplete')
  }
  const quotes = new Map(input.candidate.evidenceQuotes.map(item => [item.anchorId, item.quote]))
  if (quotes.size !== input.anchors.length) throw new Error('compression-evidence-incomplete')
  for (const anchor of input.anchors) {
    if (quotes.get(anchor.id) !== anchor.quote || !input.sourceText.includes(anchor.quote)) {
      throw new Error('compression-evidence-not-verbatim')
    }
  }
  const content = buildCompressedContent(input.candidate.summary, input.anchors)
  if (estimateTokens(content) > input.targetTokens) throw new Error('compression-artifact-over-budget')
  const body = {
    version: 1 as const,
    promptVersion: AGENT_CONTEXT_COMPRESSION_PROMPT_VERSION,
    sourceKey: input.sourceKey,
    sourceHash: input.sourceHash,
    originalTokens: input.originalTokens,
    targetTokens: input.targetTokens,
    summary: input.candidate.summary,
    anchors: input.anchors,
  }
  const artifact: VerifiedContextCompressionArtifactV1 = {
    ...body,
    artifactHash: await hashCanonicalValue(body),
  }
  return { artifact, content }
}

export function buildContextCompressionMessagesV1(input: {
  sourceKey: string
  sourceLabel: string
  sourceText: string
  authorRequest: string
  summaryTargetTokens: number
  anchors: readonly ContextCompressionAnchorV1[]
  priorFailure?: string
}): ChatMessage[] {
  const anchorJson = JSON.stringify(input.anchors)
  return [{
    role: 'system',
    content: `你是 StoryForge 的上下文压缩执行器。你只压缩给定来源，不创作新设定，不修正原文。
必须保留事实、禁止项、条件、时间顺序、角色认知边界和术语。逐字复制所有锚点 quote，
并将全部锚点 id 放入 coveredAnchorIds。summary 不超过约 ${input.summaryTargetTokens} tokens。
只输出严格 JSON：{"version":1,"summary":"...","coveredAnchorIds":["A1"],"evidenceQuotes":[{"anchorId":"A1","quote":"逐字原文"}]}。`,
  }, {
    role: 'user',
    content: [
      `【目标任务】${input.authorRequest}`,
      `【来源】${input.sourceLabel} (${input.sourceKey})`,
      `【必须覆盖的逐字锚点】${anchorJson}`,
      ...(input.priorFailure ? [`【上一轮确定性检查失败】${input.priorFailure}`] : []),
      '【待压缩原文】',
      input.sourceText,
    ].join('\n\n'),
  }]
}

function fallbackEvidence(input: {
  sourceHash: string
  attempts: number
  targetTokens: number
  anchorCount: number
  failureCode: string
  fallback: 'full-source' | 'deterministic-truncation'
}): ContextCompressionEvidenceV1 {
  return {
    version: 1,
    promptVersion: AGENT_CONTEXT_COMPRESSION_PROMPT_VERSION,
    outcome: 'fallback',
    fallback: input.fallback,
    sourceHash: input.sourceHash,
    attempts: input.attempts,
    targetTokens: input.targetTokens,
    requiredAnchorCount: input.anchorCount,
    coveredAnchorCount: 0,
    failureCode: input.failureCode.slice(0, 160),
  }
}

/**
 * Creates one bounded per-task compression session. A mutable claimed-source set
 * prevents concurrent read tools from exceeding the Skill quota.
 */
export function createAgentContextCompressionSessionV1(input: {
  policy: AgentSkillContextCompressionPolicyV1
  config: AIConfig
  projectId: number
  authorRequest: string
  routingCategory: string
  signal?: AbortSignal
  runtime: AgentContextCompressionRuntimeV1
}): AgentContextCompressionSessionV1 {
  const attempted = new Set<string>()

  const canCall = (): boolean => {
    const snapshot = input.runtime.budget.snapshot()
    return snapshot.calls + 1 + input.runtime.requiredFutureModelCalls <= snapshot.maxCalls
  }

  const transform: ContextSourceTransformer = async (
    sourceInput: ContextSourceTransformInput,
  ): Promise<ContextSourceTransformResult | undefined> => {
    if (!input.policy.sourceKeys.includes(sourceInput.source.key)) return undefined
    if (sourceInput.originalTokens < input.policy.minimumOriginalTokens) return undefined
    if (attempted.has(sourceInput.source.key) || attempted.size >= input.policy.maxSourcesPerTask) return undefined
    attempted.add(sourceInput.source.key)

    const sourceHash = await sha256Text(sourceInput.content)
    const anchors = extractContextCompressionAnchorsV1({
      content: sourceInput.content,
      targetTokens: sourceInput.sourceBudgetTokens,
      maxAnchors: input.policy.maxAnchors,
    })
    const anchorTokens = estimateTokens(buildCompressedContent('', anchors))
    const summaryTargetTokens = Math.max(96, sourceInput.sourceBudgetTokens - anchorTokens - 32)
    const maxOutputTokens = Math.min(
      input.policy.maxOutputTokens,
      Math.max(256, summaryTargetTokens + 160),
    )
    let attempts = 0
    let failureCode = 'compression-budget-unavailable'

    while (attempts < input.policy.maxAttemptsPerSource && canCall()) {
      const messages = buildContextCompressionMessagesV1({
        sourceKey: sourceInput.source.key,
        sourceLabel: sourceInput.source.label,
        sourceText: sourceInput.content,
        authorRequest: input.authorRequest,
        summaryTargetTokens,
        anchors,
        ...(attempts > 0 ? { priorFailure: failureCode } : {}),
      })
      let reservation: ReturnType<AgentTeamBudgetTracker['reserveCall']> | null = null
      let settled = false
      try {
        reservation = input.runtime.budget.reserveCall({
          label: `${sourceInput.source.label}上下文压缩`,
          messages,
          maxOutputTokens,
        })
      } catch (error) {
        failureCode = error instanceof Error ? error.message : 'compression-budget-unavailable'
        break
      }
      attempts += 1
      try {
        const raw = input.runtime.complete
          ? await input.runtime.complete(messages, { maxOutputTokens, temperature: 0.1 })
          : await chat(messages, input.config, {
              category: `${input.routingCategory}.context-compression`,
              projectId: input.projectId,
              configOverrides: { maxTokens: maxOutputTokens, temperature: 0.1 },
              contextOverflowPolicy: 'reject',
            }, input.signal)
        input.runtime.budget.settleCall(reservation, raw)
        settled = true
        const verified = await verifyCandidate({
          candidate: parseCandidate(raw),
          sourceKey: sourceInput.source.key,
          sourceHash,
          sourceText: sourceInput.content,
          originalTokens: sourceInput.originalTokens,
          targetTokens: sourceInput.sourceBudgetTokens,
          anchors,
        })
        return {
          content: verified.content,
          delivery: 'compressed',
          compression: {
            version: 1,
            promptVersion: AGENT_CONTEXT_COMPRESSION_PROMPT_VERSION,
            outcome: 'verified',
            fallback: 'none',
            sourceHash,
            artifactHash: verified.artifact.artifactHash,
            attempts,
            targetTokens: sourceInput.sourceBudgetTokens,
            requiredAnchorCount: anchors.length,
            coveredAnchorCount: anchors.length,
          },
        }
      } catch (error) {
        if (!settled) input.runtime.budget.settleFailedCall(reservation)
        failureCode = error instanceof Error ? error.message : 'compression-call-failed'
      }
    }

    const fullFallbackAllowed = sourceInput.originalTokens <= input.policy.maxFullTextFallbackTokens
      && sourceInput.originalTokens <= sourceInput.inputBudgetTokens
      && sourceInput.originalTokens <= sourceInput.sourceBudgetTokens * input.policy.maxFullTextBudgetScale
    const fallback = fullFallbackAllowed ? 'full-source' : 'deterministic-truncation'
    return {
      ...(fullFallbackAllowed
        ? { content: sourceInput.content, delivery: 'full' as const, allowSourceBudgetOverflow: true }
        : {}),
      compression: fallbackEvidence({
        sourceHash,
        attempts,
        targetTokens: sourceInput.sourceBudgetTokens,
        anchorCount: anchors.length,
        failureCode,
        fallback,
      }),
    }
  }

  return {
    sourceTransformer: transform,
    attemptedSourceKeys: () => [...attempted],
  }
}
