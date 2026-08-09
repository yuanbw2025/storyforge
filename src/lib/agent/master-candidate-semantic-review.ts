import { estimateTokens } from '../ai/context-budget'
import { chat, resolveRequestConfig } from '../ai/client'
import { assembleContext } from '../registry/assemble-context'
import type { AssembleContextResult } from '../registry/types'
import type { AIConfig, ChatMessage } from '../types'
import type { WorkspaceScope } from '../types/world-ownership'
import { useAIConfigStore } from '../../stores/ai-config'
import { resolveAgentContextPolicy, type AgentContextProfile } from './context-policy'
import {
  assertAgentSkillExecutionBindingV1,
  createAgentSkillExecutionBindingV1,
} from './execution-binding'
import { getAgentSkillV1, resolveAgentSkillContextSourceKeysV1 } from './skill-registry'
import { AgentTeamBudgetTracker } from './team-budget'
import { createContextManifestFromAssemblyV1 } from './run/context-manifest'
import { hashCanonicalValue } from './run/hash'

export const MASTER_CANDIDATE_SEMANTIC_REVIEW_TYPE_V1 = 'master-candidate-semantic-review'
export const MASTER_CANDIDATE_SEMANTIC_REVIEW_VERIFIER_SET_V1 = 'master-candidate-step-v2-semantic'
export const MASTER_CANDIDATE_REVIEW_CATEGORY_V1 = 'review.master-candidate'

export const MASTER_CANDIDATE_REVIEW_DOMAINS_V1 = ['world-origin', 'inspiration'] as const
export type MasterCandidateReviewDomainV1 = typeof MASTER_CANDIDATE_REVIEW_DOMAINS_V1[number]

export const WORLD_ORIGIN_REVIEW_ISSUE_CODES_V1 = [
  'registered-source-contradiction',
  'unsupported-canon-claim',
  'author-intent-drift',
  'incomplete-causal-chain',
  'low-specificity',
] as const

export const INSPIRATION_REVIEW_ISSUE_CODES_V1 = [
  'registered-source-contradiction',
  'unsupported-canon-claim',
  'seed-drift',
  'duplicate-entity-risk',
  'missing-output-domain',
] as const

export type MasterCandidateSemanticReviewSeverityV1 = 'blocking' | 'warning' | 'uncertain'

export interface MasterCandidateModelIdentityV1 {
  provider: string
  model: string
}

export interface MasterCandidateSemanticReviewFindingV1 {
  code: string
  severity: MasterCandidateSemanticReviewSeverityV1
  message: string
  candidateQuote: string
  sourceKey: string | null
  sourceQuote: string | null
}

export interface MasterCandidateSemanticReviewerIdentityV1 extends MasterCandidateModelIdentityV1 {
  promptVersion: string
  executionBinding: ReturnType<typeof createAgentSkillExecutionBindingV1>
  correlatedJudge: false
}

export interface MasterCandidateSemanticReviewArtifactV1 {
  version: 1
  type: typeof MASTER_CANDIDATE_SEMANTIC_REVIEW_TYPE_V1
  taskId: string
  domain: MasterCandidateReviewDomainV1
  runGeneration: number
  candidateStepId: string
  reviewStepId: string
  attempt: number
  candidateTextHash: string
  generationContextManifestHash: string
  reviewContextManifestHash: string
  reviewResponseHash: string
  reviewer: MasterCandidateSemanticReviewerIdentityV1
  verdict: 'pass' | 'block'
  findings: MasterCandidateSemanticReviewFindingV1[]
  createdAt: number
  artifactHash: string
}

export interface MasterCandidateSemanticReviewResultV1 {
  artifact: MasterCandidateSemanticReviewArtifactV1
  assembled: AssembleContextResult
  contextManifest: Awaited<ReturnType<typeof createContextManifestFromAssemblyV1>>
  messages: ChatMessage[]
}

export class MasterCandidateSemanticReviewBlockedError extends Error {
  readonly artifact: MasterCandidateSemanticReviewArtifactV1

  constructor(artifact: MasterCandidateSemanticReviewArtifactV1) {
    super(`候选语义终验硬门未通过：${artifact.findings
      .filter(finding => finding.severity === 'blocking')
      .map(finding => finding.message)
      .join('；')}`)
    this.name = 'MasterCandidateSemanticReviewBlockedError'
    this.artifact = artifact
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} 字段不符合严格协议。`)
  }
}

function nonEmptyString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`${label} 必须是 1-${max} 字符的非空字符串。`)
  }
  return value.trim()
}

function hashString(value: unknown, label: string): string {
  const result = nonEmptyString(value, label, 64)
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error(`${label} 不是有效 SHA-256。`)
  return result
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error(`${label} 必须是正整数。`)
  return Number(value)
}

function reviewSkillId(domain: MasterCandidateReviewDomainV1) {
  return domain === 'world-origin' ? 'world-origin.review' as const : 'inspiration.review' as const
}

export function masterCandidateReviewStepIdV1(taskId: string, attempt: number): string {
  return `master:${taskId}:semantic-review:${positiveInteger(attempt, 'review attempt')}`
}

function issueCodesFor(domain: MasterCandidateReviewDomainV1): readonly string[] {
  return domain === 'world-origin'
    ? WORLD_ORIGIN_REVIEW_ISSUE_CODES_V1
    : INSPIRATION_REVIEW_ISSUE_CODES_V1
}

function reviewSegments(assembled: AssembleContextResult): Array<{ key: string; content: string }> {
  return assembled.included.flatMap((key, index) => {
    const content = assembled.segments[index]?.content?.trim()
    return content ? [{ key, content }] : []
  })
}

function formatReviewContext(assembled: AssembleContextResult): string {
  const segments = reviewSegments(assembled)
  return segments.length
    ? segments.map(segment => `【${segment.key}】\n${segment.content}`).join('\n\n')
    : '本次没有实际交付给 reviewer 的登记来源。'
}

function domainRubric(domain: MasterCandidateReviewDomainV1): string {
  return domain === 'world-origin'
    ? [
        '核对世界基座候选是否与已登记世界观、故事核心、力量体系、角色、故事线、词条和项目概况发生可逐字举证的冲突。',
        '没有登记来源证据时，空泛、因果不足或偏离作者意图只能记为 warning/uncertain，不能 blocking。',
      ].join('\n')
    : [
        '核对候选是否忠实保留已选灵感、是否与最近确认版本冲突、是否制造可逐字举证的重复实体风险。',
        '没有登记来源证据时，缺项或创意强弱只能记为 warning/uncertain，不能 blocking。',
      ].join('\n')
}

export function buildMasterCandidateSemanticReviewPromptV1(input: {
  domain: MasterCandidateReviewDomainV1
  authorRequest: string
  candidateText: string
  assembled: AssembleContextResult
}): ChatMessage[] {
  const issueCodes = issueCodesFor(input.domain).join('|')
  return [
    {
      role: 'system',
      content: [
        '你是 StoryForge 候选终验 reviewer。你不续写、不润色、不补设定，只做证据型语义核对。',
        domainRubric(input.domain),
        'blocking 必须同时给出候选逐字引文、登记来源 key 和该来源逐字引文；任一引文无法逐字找到都不得 blocking。',
        '确定性格式校验已经由代码完成，不要重复声称 JSON/长度问题。',
        '只返回一个 JSON 对象，禁止 Markdown、解释或额外字段：',
        '{"verdict":"pass|block","findings":[{"code":"问题码","severity":"blocking|warning|uncertain","message":"简述","candidateQuote":"候选逐字引文","sourceKey":"登记来源key或null","sourceQuote":"来源逐字引文或null"}]}',
        `允许的问题码：${issueCodes}。`,
        'verdict=block 当且仅当至少存在一条 blocking；否则 verdict=pass。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【作者本轮要求】\n${input.authorRequest.trim()}`,
        `【待终验候选】\n${input.candidateText}`,
        `【独立装配的登记来源】\n${formatReviewContext(input.assembled)}`,
      ].join('\n\n'),
    },
  ]
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1] ?? raw
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('候选语义终验没有返回 JSON 对象。')
  const parsed = JSON.parse(fenced.slice(start, end + 1)) as unknown
  if (!isRecord(parsed)) throw new Error('候选语义终验返回值不是对象。')
  return parsed
}

function parseFindings(input: {
  value: unknown
  domain: MasterCandidateReviewDomainV1
  candidateText: string
  assembled: AssembleContextResult
}): MasterCandidateSemanticReviewFindingV1[] {
  if (!Array.isArray(input.value) || input.value.length > 20) {
    throw new Error('候选语义终验 findings 必须是最多 20 项的数组。')
  }
  const allowedCodes = new Set(issueCodesFor(input.domain))
  const sourceByKey = new Map(reviewSegments(input.assembled).map(segment => [segment.key, segment.content]))
  const seen = new Set<string>()
  return input.value.map((item, index) => {
    if (!isRecord(item)) throw new Error(`候选语义终验 findings[${index}] 不是对象。`)
    assertExactKeys(
      item,
      ['code', 'severity', 'message', 'candidateQuote', 'sourceKey', 'sourceQuote'],
      `候选语义终验 findings[${index}]`,
    )
    const code = nonEmptyString(item.code, `findings[${index}].code`, 80)
    if (!allowedCodes.has(code)) throw new Error(`候选语义终验使用了未登记问题码 ${code}。`)
    if (!['blocking', 'warning', 'uncertain'].includes(String(item.severity))) {
      throw new Error(`候选语义终验 findings[${index}].severity 无效。`)
    }
    const severity = item.severity as MasterCandidateSemanticReviewSeverityV1
    const message = nonEmptyString(item.message, `findings[${index}].message`, 500)
    const candidateQuote = nonEmptyString(item.candidateQuote, `findings[${index}].candidateQuote`, 600)
    if (!input.candidateText.includes(candidateQuote)) {
      throw new Error(`候选语义终验 findings[${index}] 的候选引文无法逐字定位。`)
    }
    const sourceKey = item.sourceKey === null
      ? null
      : nonEmptyString(item.sourceKey, `findings[${index}].sourceKey`, 100)
    const sourceQuote = item.sourceQuote === null
      ? null
      : nonEmptyString(item.sourceQuote, `findings[${index}].sourceQuote`, 600)
    if ((sourceKey === null) !== (sourceQuote === null)) {
      throw new Error(`候选语义终验 findings[${index}] 的来源 key 与引文必须同时存在或同时为空。`)
    }
    if (sourceKey !== null && !sourceByKey.get(sourceKey)?.includes(sourceQuote!)) {
      throw new Error(`候选语义终验 findings[${index}] 的来源引文无法在 ${sourceKey} 逐字定位。`)
    }
    if (severity === 'blocking' && (sourceKey === null || sourceQuote === null)) {
      throw new Error(`候选语义终验 findings[${index}] 的 blocking 缺少登记来源逐字证据。`)
    }
    const fingerprint = [code, severity, candidateQuote, sourceKey ?? '', sourceQuote ?? ''].join('\n')
    if (seen.has(fingerprint)) throw new Error(`候选语义终验 findings[${index}] 重复。`)
    seen.add(fingerprint)
    return { code, severity, message, candidateQuote, sourceKey, sourceQuote }
  })
}

function artifactBody(
  artifact: MasterCandidateSemanticReviewArtifactV1,
): Omit<MasterCandidateSemanticReviewArtifactV1, 'artifactHash'> {
  const { artifactHash: _artifactHash, ...body } = artifact
  return body
}

function parseReviewerIdentity(
  value: unknown,
  domain: MasterCandidateReviewDomainV1,
): MasterCandidateSemanticReviewerIdentityV1 {
  if (!isRecord(value)) throw new Error('候选语义 reviewer 身份无效。')
  assertExactKeys(
    value,
    ['provider', 'model', 'promptVersion', 'executionBinding', 'correlatedJudge'],
    '候选语义 reviewer',
  )
  if (value.correlatedJudge !== false) throw new Error('候选语义终验不得使用相关 judge。')
  const skill = getAgentSkillV1(reviewSkillId(domain), domain)
  assertAgentSkillExecutionBindingV1(value.executionBinding as any, skill, '候选语义 reviewer execution binding')
  const promptVersion = nonEmptyString(value.promptVersion, '候选语义 reviewer.promptVersion', 120)
  if (promptVersion !== skill.promptVersion) throw new Error('候选语义 reviewer Prompt 版本已变化。')
  return {
    provider: nonEmptyString(value.provider, '候选语义 reviewer.provider', 100),
    model: nonEmptyString(value.model, '候选语义 reviewer.model', 200),
    promptVersion,
    executionBinding: value.executionBinding as MasterCandidateSemanticReviewerIdentityV1['executionBinding'],
    correlatedJudge: false,
  }
}

export function parseMasterCandidateSemanticReviewArtifactV1(
  value: unknown,
): MasterCandidateSemanticReviewArtifactV1 {
  if (!isRecord(value)) throw new Error('候选语义终验 artifact 无效。')
  assertExactKeys(value, [
    'version',
    'type',
    'taskId',
    'domain',
    'runGeneration',
    'candidateStepId',
    'reviewStepId',
    'attempt',
    'candidateTextHash',
    'generationContextManifestHash',
    'reviewContextManifestHash',
    'reviewResponseHash',
    'reviewer',
    'verdict',
    'findings',
    'createdAt',
    'artifactHash',
  ], '候选语义终验 artifact')
  if (value.version !== 1 || value.type !== MASTER_CANDIDATE_SEMANTIC_REVIEW_TYPE_V1) {
    throw new Error('候选语义终验 artifact 版本或类型无效。')
  }
  if (!MASTER_CANDIDATE_REVIEW_DOMAINS_V1.includes(value.domain as MasterCandidateReviewDomainV1)) {
    throw new Error('候选语义终验 artifact 领域无效。')
  }
  const domain = value.domain as MasterCandidateReviewDomainV1
  if (!['pass', 'block'].includes(String(value.verdict))) throw new Error('候选语义终验 verdict 无效。')
  if (!Array.isArray(value.findings)) throw new Error('候选语义终验 findings 无效。')
  const findings = value.findings.map((finding, index) => {
    if (!isRecord(finding)) throw new Error(`候选语义终验 artifact.findings[${index}] 无效。`)
    assertExactKeys(
      finding,
      ['code', 'severity', 'message', 'candidateQuote', 'sourceKey', 'sourceQuote'],
      `候选语义终验 artifact.findings[${index}]`,
    )
    const code = nonEmptyString(finding.code, `artifact.findings[${index}].code`, 80)
    if (!issueCodesFor(domain).includes(code)) throw new Error(`候选语义终验 artifact 问题码无效：${code}`)
    if (!['blocking', 'warning', 'uncertain'].includes(String(finding.severity))) {
      throw new Error(`候选语义终验 artifact.findings[${index}].severity 无效。`)
    }
    return {
      code,
      severity: finding.severity as MasterCandidateSemanticReviewSeverityV1,
      message: nonEmptyString(finding.message, `artifact.findings[${index}].message`, 500),
      candidateQuote: nonEmptyString(finding.candidateQuote, `artifact.findings[${index}].candidateQuote`, 600),
      sourceKey: finding.sourceKey === null
        ? null
        : nonEmptyString(finding.sourceKey, `artifact.findings[${index}].sourceKey`, 100),
      sourceQuote: finding.sourceQuote === null
        ? null
        : nonEmptyString(finding.sourceQuote, `artifact.findings[${index}].sourceQuote`, 600),
    }
  })
  const blocking = findings.some(finding => finding.severity === 'blocking')
  if ((value.verdict === 'block') !== blocking) throw new Error('候选语义终验 verdict 与 blocking findings 不一致。')
  const attempt = positiveInteger(value.attempt, '候选语义终验 attempt')
  const taskId = nonEmptyString(value.taskId, '候选语义终验 taskId', 80)
  const reviewStepId = nonEmptyString(value.reviewStepId, '候选语义终验 reviewStepId', 180)
  if (reviewStepId !== masterCandidateReviewStepIdV1(taskId, attempt)) {
    throw new Error('候选语义终验 reviewStepId 与任务/attempt 不一致。')
  }
  return {
    version: 1,
    type: MASTER_CANDIDATE_SEMANTIC_REVIEW_TYPE_V1,
    taskId,
    domain,
    runGeneration: positiveInteger(value.runGeneration, '候选语义终验 runGeneration'),
    candidateStepId: nonEmptyString(value.candidateStepId, '候选语义终验 candidateStepId', 160),
    reviewStepId,
    attempt,
    candidateTextHash: hashString(value.candidateTextHash, '候选语义终验 candidateTextHash'),
    generationContextManifestHash: hashString(
      value.generationContextManifestHash,
      '候选语义终验 generationContextManifestHash',
    ),
    reviewContextManifestHash: hashString(
      value.reviewContextManifestHash,
      '候选语义终验 reviewContextManifestHash',
    ),
    reviewResponseHash: hashString(value.reviewResponseHash, '候选语义终验 reviewResponseHash'),
    reviewer: parseReviewerIdentity(value.reviewer, domain),
    verdict: value.verdict as 'pass' | 'block',
    findings,
    createdAt: positiveInteger(value.createdAt, '候选语义终验 createdAt'),
    artifactHash: hashString(value.artifactHash, '候选语义终验 artifactHash'),
  }
}

export async function verifyMasterCandidateSemanticReviewArtifactV1(input: {
  artifact: MasterCandidateSemanticReviewArtifactV1
  candidateText?: string
  generator?: MasterCandidateModelIdentityV1
}): Promise<boolean> {
  try {
    const artifact = parseMasterCandidateSemanticReviewArtifactV1(input.artifact)
    if (await hashCanonicalValue(artifactBody(artifact)) !== artifact.artifactHash) return false
    if (input.candidateText !== undefined
      && await hashCanonicalValue(input.candidateText) !== artifact.candidateTextHash) return false
    if (input.generator
      && input.generator.provider === artifact.reviewer.provider
      && input.generator.model === artifact.reviewer.model) return false
    return true
  } catch {
    return false
  }
}

export async function createMasterCandidateSemanticReviewArtifactV1(input: {
  raw: string
  taskId: string
  domain: MasterCandidateReviewDomainV1
  runGeneration: number
  candidateStepId: string
  reviewStepId: string
  attempt: number
  candidateText: string
  generationContextManifestHash: string
  reviewContextManifestHash: string
  assembled: AssembleContextResult
  reviewer: MasterCandidateSemanticReviewerIdentityV1
  createdAt: number
}): Promise<MasterCandidateSemanticReviewArtifactV1> {
  const parsed = parseJsonObject(input.raw)
  assertExactKeys(parsed, ['verdict', 'findings'], '候选语义终验响应')
  if (!['pass', 'block'].includes(String(parsed.verdict))) throw new Error('候选语义终验 verdict 无效。')
  const findings = parseFindings({
    value: parsed.findings,
    domain: input.domain,
    candidateText: input.candidateText,
    assembled: input.assembled,
  })
  const blocking = findings.some(finding => finding.severity === 'blocking')
  if ((parsed.verdict === 'block') !== blocking) {
    throw new Error('候选语义终验 verdict 与 blocking findings 不一致。')
  }
  const body: Omit<MasterCandidateSemanticReviewArtifactV1, 'artifactHash'> = {
    version: 1,
    type: MASTER_CANDIDATE_SEMANTIC_REVIEW_TYPE_V1,
    taskId: input.taskId,
    domain: input.domain,
    runGeneration: input.runGeneration,
    candidateStepId: input.candidateStepId,
    reviewStepId: input.reviewStepId,
    attempt: input.attempt,
    candidateTextHash: await hashCanonicalValue(input.candidateText),
    generationContextManifestHash: input.generationContextManifestHash,
    reviewContextManifestHash: input.reviewContextManifestHash,
    reviewResponseHash: await hashCanonicalValue(input.raw),
    reviewer: input.reviewer,
    verdict: parsed.verdict as 'pass' | 'block',
    findings,
    createdAt: input.createdAt,
  }
  return { ...body, artifactHash: await hashCanonicalValue(body) }
}

function resolvedReviewerConfig(): AIConfig {
  return resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: MASTER_CANDIDATE_REVIEW_CATEGORY_V1 },
  ).config
}

export async function runMasterCandidateSemanticReviewV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  runId: number
  runGeneration: number
  taskId: string
  candidateStepId: string
  attempt: number
  domain: MasterCandidateReviewDomainV1
  authorRequest: string
  candidateText: string
  generationContextManifestHash: string
  generator: MasterCandidateModelIdentityV1
  selectedFragmentIds?: string[]
  inspirationMode?: 'single' | 'multiworld'
  budget: AgentTeamBudgetTracker
  reviewerConfig: AIConfig
  review: (messages: ChatMessage[]) => Promise<string>
  contextProfile?: AgentContextProfile
  signal?: AbortSignal
  onCall?: (event: {
    state: 'requested' | 'responded'
    reviewStepId: string
    contextManifest: Awaited<ReturnType<typeof createContextManifestFromAssemblyV1>>
    messages?: ChatMessage[]
    output?: string
    estimatedInputTokens: number
    reservedOutputTokens: number
  }) => Promise<void>
  now?: () => number
}): Promise<MasterCandidateSemanticReviewResultV1> {
  if (
    input.generator.provider === input.reviewerConfig.provider
    && input.generator.model === input.reviewerConfig.model
  ) throw new Error('候选语义终验必须使用与生成器不同的 provider/model。')
  const skill = getAgentSkillV1(reviewSkillId(input.domain), input.domain)
  const sourceKeys = resolveAgentSkillContextSourceKeysV1(skill)
  const profile = input.contextProfile
    ?? useAIConfigStore.getState().agentContextProfiles[skill.contextTaskKind]
  const policy = resolveAgentContextPolicy(skill.contextTaskKind, profile)
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    sourceKeys,
    provider: input.reviewerConfig.provider,
    model: input.reviewerConfig.model,
    inputBudgetMaxTokens: policy.maxInputTokens,
    sourceBudgetScale: policy.sourceBudgetScale,
    inspirationFragmentIds: input.selectedFragmentIds,
    inspirationMode: input.inspirationMode,
  })
  const reviewStepId = masterCandidateReviewStepIdV1(input.taskId, input.attempt)
  const contextManifest = await createContextManifestFromAssemblyV1({
    runId: input.runId,
    stepId: reviewStepId,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: sourceKeys,
    assembled,
    readerVersion: `${skill.promptVersion}-context-v1`,
  })
  const messages = buildMasterCandidateSemanticReviewPromptV1({
    domain: input.domain,
    authorRequest: input.authorRequest,
    candidateText: input.candidateText,
    assembled,
  })
  const reservation = input.budget.reserveCall({
    label: `${skill.label} · ${input.taskId}`,
    messages,
    maxOutputTokens: skill.maxOutputTokens,
  })
  let settled = false
  let raw: string
  try {
    await input.onCall?.({
      state: 'requested',
      reviewStepId,
      contextManifest,
      messages,
      estimatedInputTokens: reservation.estimatedInputTokens,
      reservedOutputTokens: reservation.reservedOutputTokens,
    })
    raw = await input.review(messages)
    input.budget.settleCall(reservation, raw)
    settled = true
    await input.onCall?.({
      state: 'responded',
      reviewStepId,
      contextManifest,
      output: raw,
      estimatedInputTokens: reservation.estimatedInputTokens,
      reservedOutputTokens: reservation.reservedOutputTokens,
    })
  } catch (error) {
    if (!settled) input.budget.settleFailedCall(reservation)
    throw error
  }
  const reviewer: MasterCandidateSemanticReviewerIdentityV1 = {
    provider: input.reviewerConfig.provider,
    model: input.reviewerConfig.model,
    promptVersion: skill.promptVersion,
    executionBinding: createAgentSkillExecutionBindingV1(skill),
    correlatedJudge: false,
  }
  const artifact = await createMasterCandidateSemanticReviewArtifactV1({
    raw,
    taskId: input.taskId,
    domain: input.domain,
    runGeneration: input.runGeneration,
    candidateStepId: input.candidateStepId,
    reviewStepId,
    attempt: input.attempt,
    candidateText: input.candidateText,
    generationContextManifestHash: input.generationContextManifestHash,
    reviewContextManifestHash: contextManifest.manifestHash,
    assembled,
    reviewer,
    createdAt: (input.now ?? Date.now)(),
  })
  return { artifact, assembled, contextManifest, messages }
}

export function runMasterCandidateSemanticReviewWithClientV1(
  input: Omit<Parameters<typeof runMasterCandidateSemanticReviewV1>[0], 'reviewerConfig' | 'review'>,
): Promise<MasterCandidateSemanticReviewResultV1> {
  const reviewerConfig = resolvedReviewerConfig()
  return runMasterCandidateSemanticReviewV1({
    ...input,
    reviewerConfig,
    review: messages => chat(messages, reviewerConfig, {
      category: MASTER_CANDIDATE_REVIEW_CATEGORY_V1,
      projectId: input.scope.projectId,
      configOverrides: { maxTokens: 3_000, temperature: 0 },
      contextOverflowPolicy: 'reject',
    }, input.signal),
  })
}

export function estimateMasterCandidateSemanticReviewInputTokensV1(
  messages: readonly ChatMessage[],
): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
}
