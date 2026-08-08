import type { ChatMessage } from '../types'
import type { AssembleContextResult } from '../registry/types'
import type { GenerationGateIssue } from '../generation/generation-node'
import type { AgentSkillExecutionBindingV1 } from '../types/agent-run'
import { estimateTokens } from '../ai/context-budget'
import { hashCanonicalValue } from './run/hash'
import {
  AgentTeamBudgetTracker,
  type AgentTeamBudgetEvidence,
} from './team-budget'

export const PROSE_SEMANTIC_REVIEW_PROMPT_VERSION_V1 = 'prose-semantic-review-v1'
export const PROSE_SEMANTIC_REVISION_PROMPT_VERSION_V1 = 'prose-semantic-revision-v1'

export const PROSE_SEMANTIC_ISSUE_CODES_V1 = [
  'world-rule-conflict',
  'character-motivation-break',
  'causal-gap',
  'continuity-conflict',
  'pov-knowledge-leak',
  'future-plot-leak',
  'character-voice-drift',
  'outline-deviation',
  'unsupported-state-change',
] as const

export type ProseSemanticIssueCodeV1 = typeof PROSE_SEMANTIC_ISSUE_CODES_V1[number]
export type ProseSemanticIssueSeverityV1 = 'blocking' | 'warning' | 'uncertain'

export interface ProseSemanticReviewEvidenceV1 {
  sourceKey: string
  quote: string
}

export interface ProseSemanticReviewIssueV1 {
  code: ProseSemanticIssueCodeV1
  severity: ProseSemanticIssueSeverityV1
  candidateQuote: string
  evidence: ProseSemanticReviewEvidenceV1[]
  reason: string
  revisionInstruction?: string
  autoRevisable: boolean
}

export interface ProseSemanticReviewerIdentityV1 {
  provider: string
  model: string
  promptVersion: typeof PROSE_SEMANTIC_REVIEW_PROMPT_VERSION_V1
  executionBinding: AgentSkillExecutionBindingV1
  correlatedJudge: boolean
}

export interface ProseSemanticReviewArtifactV1 {
  version: 1
  type: 'prose-semantic-review'
  round: 1 | 2
  candidateTextHash: string
  contextManifestHash: string
  reviewer: ProseSemanticReviewerIdentityV1
  verdict: 'pass' | 'revise' | 'author-review'
  issues: ProseSemanticReviewIssueV1[]
  createdAt: number
  artifactHash: string
}

export interface ProseSemanticRevisionArtifactV1 {
  version: 1
  type: 'prose-semantic-revision'
  sourceCandidateTextHash: string
  sourceReviewArtifactHash: string
  issueCodes: ProseSemanticIssueCodeV1[]
  outputTextHash: string
  executionBinding: AgentSkillExecutionBindingV1
  createdAt: number
  artifactHash: string
}

export interface ProseSemanticReviewCycleResultV1 {
  status: 'passed' | 'blocked'
  outputText: string
  initialReview: ProseSemanticReviewArtifactV1
  finalReview: ProseSemanticReviewArtifactV1
  revision?: ProseSemanticRevisionArtifactV1
  deterministicIssues: GenerationGateIssue[]
  budget: AgentTeamBudgetEvidence
}

interface ReviewSegmentV1 {
  key: string
  content: string
}

function reviewSegments(assembled: AssembleContextResult): ReviewSegmentV1[] {
  return assembled.included.flatMap((key, index) => {
    const content = assembled.segments[index]?.content?.trim()
    return content ? [{ key, content }] : []
  })
}

function formatReviewContext(segments: readonly ReviewSegmentV1[]): string {
  return segments.length
    ? segments.map(segment => `<source key="${segment.key}">\n${segment.content}\n</source>`).join('\n\n')
    : '（没有可用的已登记证据来源）'
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('语义评审没有返回 JSON 对象。')
  const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('语义评审 JSON 根节点必须是对象。')
  }
  return parsed as Record<string, unknown>
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(record)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${label} 字段必须严格为 ${keys.join('、')}。`)
  }
}

function nonEmptyString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new Error(`${label} 必须是 1-${max} 字符的非空文本。`)
  }
  return value.trim()
}

function artifactBody(
  artifact: ProseSemanticReviewArtifactV1,
): Omit<ProseSemanticReviewArtifactV1, 'artifactHash'> {
  const { artifactHash: _artifactHash, ...body } = artifact
  return body
}

function revisionArtifactBody(
  artifact: ProseSemanticRevisionArtifactV1,
): Omit<ProseSemanticRevisionArtifactV1, 'artifactHash'> {
  const { artifactHash: _artifactHash, ...body } = artifact
  return body
}

function parseIssues(input: {
  value: unknown
  candidateText: string
  segments: readonly ReviewSegmentV1[]
}): ProseSemanticReviewIssueV1[] {
  if (!Array.isArray(input.value)) throw new Error('语义评审 issues 必须是数组。')
  if (input.value.length > 12) throw new Error('语义评审 issues 超过 12 条上限。')
  const segmentByKey = new Map(input.segments.map(segment => [segment.key, segment.content]))
  const issues = input.value.map((raw, index): ProseSemanticReviewIssueV1 => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`语义评审 issues[${index}] 必须是对象。`)
    }
    const record = raw as Record<string, unknown>
    exactKeys(
      record,
      ['code', 'severity', 'candidateQuote', 'evidence', 'reason', 'revisionInstruction', 'autoRevisable'],
      `语义评审 issues[${index}]`,
    )
    const code = nonEmptyString(record.code, `issues[${index}].code`, 80)
    if (!PROSE_SEMANTIC_ISSUE_CODES_V1.includes(code as ProseSemanticIssueCodeV1)) {
      throw new Error(`语义评审 issues[${index}] 使用了未知 issue code。`)
    }
    const severity = nonEmptyString(record.severity, `issues[${index}].severity`, 20)
    if (!['blocking', 'warning', 'uncertain'].includes(severity)) {
      throw new Error(`语义评审 issues[${index}] severity 无效。`)
    }
    const candidateQuote = nonEmptyString(record.candidateQuote, `issues[${index}].candidateQuote`, 600)
    if (!input.candidateText.includes(candidateQuote)) {
      throw new Error(`语义评审 issues[${index}] candidateQuote 不是候选逐字引文。`)
    }
    if (!Array.isArray(record.evidence) || record.evidence.length > 8) {
      throw new Error(`语义评审 issues[${index}].evidence 必须是至多 8 条的数组。`)
    }
    const evidence = record.evidence.map((entry, evidenceIndex): ProseSemanticReviewEvidenceV1 => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`issues[${index}].evidence[${evidenceIndex}] 必须是对象。`)
      }
      const evidenceRecord = entry as Record<string, unknown>
      exactKeys(evidenceRecord, ['sourceKey', 'quote'], `issues[${index}].evidence[${evidenceIndex}]`)
      const sourceKey = nonEmptyString(evidenceRecord.sourceKey, 'evidence.sourceKey', 120)
      const quote = nonEmptyString(evidenceRecord.quote, 'evidence.quote', 600)
      const sourceContent = segmentByKey.get(sourceKey)
      if (!sourceContent || !sourceContent.includes(quote)) {
        throw new Error(`issues[${index}].evidence[${evidenceIndex}] 不是声明来源的逐字引文。`)
      }
      return { sourceKey, quote }
    })
    const reason = nonEmptyString(record.reason, `issues[${index}].reason`, 1_000)
    const revisionInstruction = record.revisionInstruction === ''
      ? undefined
      : nonEmptyString(record.revisionInstruction, `issues[${index}].revisionInstruction`, 800)
    if (typeof record.autoRevisable !== 'boolean') {
      throw new Error(`issues[${index}].autoRevisable 必须是布尔值。`)
    }
    if (severity === 'blocking' && evidence.length === 0) {
      throw new Error(`issues[${index}] blocking 问题缺少登记来源证据。`)
    }
    if (record.autoRevisable && (severity !== 'blocking' || !revisionInstruction)) {
      throw new Error(`issues[${index}] 只有带定向指令的 blocking 问题可以自动修订。`)
    }
    return {
      code: code as ProseSemanticIssueCodeV1,
      severity: severity as ProseSemanticIssueSeverityV1,
      candidateQuote,
      evidence,
      reason,
      revisionInstruction,
      autoRevisable: record.autoRevisable,
    }
  })
  const unique = new Set(issues.map(issue => `${issue.code}\u0000${issue.candidateQuote}`))
  if (unique.size !== issues.length) throw new Error('语义评审包含重复问题。')
  return issues
}

export function buildProseSemanticReviewPromptV1(input: {
  chapterTitle: string
  candidateText: string
  assembled: AssembleContextResult
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是 StoryForge 正文候选的证据型语义评审 Skill。只判断需要语义理解的质量问题；格式、信息边界、作用域、物品数量等硬规则由代码负责，你不得覆盖硬判。

输出严格 JSON：
{"issues":[{"code":"${PROSE_SEMANTIC_ISSUE_CODES_V1.join('|')}","severity":"blocking|warning|uncertain","candidateQuote":"候选逐字引文","evidence":[{"sourceKey":"已提供的 source key","quote":"该来源逐字引文"}],"reason":"问题与影响","revisionInstruction":"仅 blocking 且可定向修复时填写，否则空字符串","autoRevisable":true}]}

规则：
1. candidateQuote 必须逐字来自候选；每条 evidence.quote 必须逐字来自所标 sourceKey；
2. blocking 只用于有直接登记证据的明确矛盾，并且必须至少一条 evidence；证据不足用 warning 或 uncertain；
3. 只有能在不改动作者设定、章纲目标和事实前提下局部修复的问题才可 autoRevisable=true；
4. 不评判个人文风偏好，不要求把留白解释完整，不把有意伏笔当漏洞；
5. 没有问题返回 {"issues":[]}；不得输出总分、思维过程或修改后的正文。`,
    },
    {
      role: 'user',
      content: `【章节】${input.chapterTitle}\n\n【待审候选】\n${input.candidateText}\n\n【登记证据来源】\n${formatReviewContext(reviewSegments(input.assembled))}\n\n请输出 JSON：`,
    },
  ]
}

export function buildProseSemanticRevisionPromptV1(input: {
  generationMessages: readonly ChatMessage[]
  candidateText: string
  review: ProseSemanticReviewArtifactV1
}): ChatMessage[] {
  const issues = input.review.issues.filter(issue => issue.severity === 'blocking' && issue.autoRevisable)
  return [
    ...input.generationMessages.map(message => ({ ...message })),
    { role: 'assistant', content: input.candidateText },
    {
      role: 'user',
      content: [
        '【语义评审定向打回】上一版没有写入项目。只修复下列有逐字证据的问题；不得改动未列出的情节、事实、信息边界和输出格式，也不要解释。',
        ...issues.map(issue => [
          `- ${issue.code}: ${issue.reason}`,
          `  候选引文：“${issue.candidateQuote}”`,
          `  修订要求：${issue.revisionInstruction}`,
        ].join('\n')),
      ].join('\n'),
    },
  ]
}

async function createReviewArtifact(input: {
  raw: string
  round: 1 | 2
  candidateText: string
  assembled: AssembleContextResult
  contextManifestHash: string
  reviewer: ProseSemanticReviewerIdentityV1
  now: number
}): Promise<ProseSemanticReviewArtifactV1> {
  const parsed = parseJsonObject(input.raw)
  exactKeys(parsed, ['issues'], '语义评审根对象')
  const issues = parseIssues({
    value: parsed.issues,
    candidateText: input.candidateText,
    segments: reviewSegments(input.assembled),
  })
  const blocking = issues.filter(issue => issue.severity === 'blocking')
  const verdict = blocking.length === 0
    ? 'pass'
    : blocking.every(issue => issue.autoRevisable)
      ? 'revise'
      : 'author-review'
  const body: Omit<ProseSemanticReviewArtifactV1, 'artifactHash'> = {
    version: 1,
    type: 'prose-semantic-review',
    round: input.round,
    candidateTextHash: await hashCanonicalValue(input.candidateText),
    contextManifestHash: input.contextManifestHash,
    reviewer: input.reviewer,
    verdict,
    issues,
    createdAt: input.now,
  }
  return { ...body, artifactHash: await hashCanonicalValue(body) }
}

export async function verifyProseSemanticReviewArtifactV1(input: {
  artifact: ProseSemanticReviewArtifactV1
  candidateText?: string
  candidateTextHash?: string
  contextManifestHash?: string
}): Promise<boolean> {
  try {
    const artifact = input.artifact
    if (
      artifact.version !== 1
      || artifact.type !== 'prose-semantic-review'
      || ![1, 2].includes(artifact.round)
      || artifact.reviewer.promptVersion !== PROSE_SEMANTIC_REVIEW_PROMPT_VERSION_V1
      || artifact.reviewer.executionBinding.promptVersion !== PROSE_SEMANTIC_REVIEW_PROMPT_VERSION_V1
      || artifact.reviewer.executionBinding.skillId !== 'prose.review'
      || artifact.candidateTextHash !== (
        input.candidateTextHash ?? await hashCanonicalValue(input.candidateText ?? '')
      )
      || (input.contextManifestHash != null && artifact.contextManifestHash !== input.contextManifestHash)
      || artifact.artifactHash !== await hashCanonicalValue(artifactBody(artifact))
    ) return false
    return artifact.verdict === (artifact.issues.some(issue => issue.severity === 'blocking')
      ? artifact.issues.filter(issue => issue.severity === 'blocking').every(issue => issue.autoRevisable)
        ? 'revise'
        : 'author-review'
      : 'pass')
  } catch {
    return false
  }
}

async function callBudgeted(input: {
  budget: AgentTeamBudgetTracker
  label: string
  messages: ChatMessage[]
  maxOutputTokens: number
  call: (messages: ChatMessage[]) => Promise<string>
  onRequested?: (messages: ChatMessage[]) => Promise<void>
  onResponded?: (output: string) => Promise<void>
}): Promise<string> {
  const reservation = input.budget.reserveCall({
    label: input.label,
    messages: input.messages,
    maxOutputTokens: input.maxOutputTokens,
  })
  let settled = false
  try {
    await input.onRequested?.(input.messages)
    const output = await input.call(input.messages)
    input.budget.settleCall(reservation, output)
    settled = true
    await input.onResponded?.(output)
    return output
  } catch (error) {
    if (!settled) input.budget.settleFailedCall(reservation)
    throw error
  }
}

export async function runProseSemanticReviewCycleV1(input: {
  chapterTitle: string
  originalText: string
  generationMessages: readonly ChatMessage[]
  assembled: AssembleContextResult
  contextManifestHashes: { initial: string; final: string }
  reviewer: ProseSemanticReviewerIdentityV1
  revisionExecutionBinding: AgentSkillExecutionBindingV1
  budget: AgentTeamBudgetTracker
  review: (messages: ChatMessage[]) => Promise<string>
  revise: (messages: ChatMessage[]) => Promise<string>
  validateRevision: (output: string) => Promise<GenerationGateIssue[]> | GenerationGateIssue[]
  onCall?: (event: {
    phase: 'review' | 'revision' | 'rereview'
    state: 'requested' | 'responded'
    messages?: ChatMessage[]
    output?: string
    estimatedInputTokens: number
    reservedOutputTokens: number
  }) => Promise<void>
  onReviewArtifact?: (artifact: ProseSemanticReviewArtifactV1) => Promise<void>
  onRevisionArtifact?: (artifact: ProseSemanticRevisionArtifactV1) => Promise<void>
  now?: () => number
}): Promise<ProseSemanticReviewCycleResultV1> {
  const now = input.now ?? Date.now
  const reviewOnce = async (candidateText: string, round: 1 | 2) => {
    const phase = round === 1 ? 'review' as const : 'rereview' as const
    const messages = buildProseSemanticReviewPromptV1({
      chapterTitle: input.chapterTitle,
      candidateText,
      assembled: input.assembled,
    })
    const raw = await callBudgeted({
      budget: input.budget,
      label: round === 1 ? '正文语义评审' : '正文修订复核',
      messages,
      maxOutputTokens: 3_000,
      call: input.review,
      onRequested: request => input.onCall?.({
        phase,
        state: 'requested',
        messages: request,
        estimatedInputTokens: request.reduce((sum, message) => sum + estimateTokens(message.content), 0),
        reservedOutputTokens: 3_000,
      }) ?? Promise.resolve(),
      onResponded: output => input.onCall?.({
        phase,
        state: 'responded',
        output,
        estimatedInputTokens: messages.reduce((sum, message) => sum + estimateTokens(message.content), 0),
        reservedOutputTokens: 3_000,
      }) ?? Promise.resolve(),
    })
    const artifact = await createReviewArtifact({
      raw,
      round,
      candidateText,
      assembled: input.assembled,
      contextManifestHash: round === 1
        ? input.contextManifestHashes.initial
        : input.contextManifestHashes.final,
      reviewer: input.reviewer,
      now: now(),
    })
    await input.onReviewArtifact?.(artifact)
    return artifact
  }

  const initialReview = await reviewOnce(input.originalText, 1)
  if (initialReview.verdict === 'pass') {
    return {
      status: 'passed',
      outputText: input.originalText,
      initialReview,
      finalReview: initialReview,
      deterministicIssues: [],
      budget: input.budget.snapshot(),
    }
  }
  if (initialReview.verdict === 'author-review') {
    return {
      status: 'blocked',
      outputText: input.originalText,
      initialReview,
      finalReview: initialReview,
      deterministicIssues: [],
      budget: input.budget.snapshot(),
    }
  }

  const revisionMessages = buildProseSemanticRevisionPromptV1({
    generationMessages: input.generationMessages,
    candidateText: input.originalText,
    review: initialReview,
  })
  const revisedText = await callBudgeted({
    budget: input.budget,
    label: '正文语义定向修订',
    messages: revisionMessages,
    maxOutputTokens: 16_000,
    call: input.revise,
    onRequested: request => input.onCall?.({
      phase: 'revision',
      state: 'requested',
      messages: request,
      estimatedInputTokens: request.reduce((sum, message) => sum + estimateTokens(message.content), 0),
      reservedOutputTokens: 16_000,
    }) ?? Promise.resolve(),
    onResponded: output => input.onCall?.({
      phase: 'revision',
      state: 'responded',
      output,
      estimatedInputTokens: revisionMessages.reduce((sum, message) => sum + estimateTokens(message.content), 0),
      reservedOutputTokens: 16_000,
    }) ?? Promise.resolve(),
  })
  if (!revisedText.trim()) throw new Error('语义修订没有返回正文。')
  const deterministicIssues = await input.validateRevision(revisedText)
  const revisionBody: Omit<ProseSemanticRevisionArtifactV1, 'artifactHash'> = {
    version: 1,
    type: 'prose-semantic-revision',
    sourceCandidateTextHash: await hashCanonicalValue(input.originalText),
    sourceReviewArtifactHash: initialReview.artifactHash,
    issueCodes: initialReview.issues
      .filter(issue => issue.severity === 'blocking' && issue.autoRevisable)
      .map(issue => issue.code),
    outputTextHash: await hashCanonicalValue(revisedText),
    executionBinding: input.revisionExecutionBinding,
    createdAt: now(),
  }
  const revision = { ...revisionBody, artifactHash: await hashCanonicalValue(revisionBody) }
  await input.onRevisionArtifact?.(revision)
  if (deterministicIssues.length > 0) {
    return {
      status: 'blocked',
      outputText: revisedText,
      initialReview,
      finalReview: initialReview,
      revision,
      deterministicIssues,
      budget: input.budget.snapshot(),
    }
  }

  const finalReview = await reviewOnce(revisedText, 2)
  return {
    status: finalReview.verdict === 'pass' ? 'passed' : 'blocked',
    outputText: revisedText,
    initialReview,
    finalReview,
    revision,
    deterministicIssues: [],
    budget: input.budget.snapshot(),
  }
}

export async function verifyProseSemanticRevisionArtifactV1(
  artifact: ProseSemanticRevisionArtifactV1,
): Promise<boolean> {
  return artifact.version === 1
    && artifact.type === 'prose-semantic-revision'
    && artifact.executionBinding.skillId === 'prose.revise'
    && artifact.executionBinding.promptVersion === PROSE_SEMANTIC_REVISION_PROMPT_VERSION_V1
    && artifact.artifactHash === await hashCanonicalValue(revisionArtifactBody(artifact))
}
