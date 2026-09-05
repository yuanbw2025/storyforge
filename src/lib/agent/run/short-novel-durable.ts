import { chat } from '../../ai/client'
import { assembleContext } from '../../registry/assemble-context'
import { readOwnedRows } from '../../workspace/scope'
import type {
  AIConfig,
  ChatMessage,
  ShortNovelBriefV1,
  ShortNovelChapterDraftV1,
  ShortNovelChapterPlanV1,
  ShortNovelReviewIssueV1,
  ShortNovelReviewV1,
  ShortNovelStoryDesignV1,
  WorkspaceScope,
} from '../../types'
import {
  adoptShortNovelChapterDraftV1,
  adoptShortNovelChapterPlanV1,
  adoptShortNovelReviewV1,
  buildShortNovelManuscriptSnapshotV1,
  confirmShortNovelBriefV1,
  confirmShortNovelStoryDesignV1,
  ensureShortNovelProductionV1,
} from '../../short-novel/service'
import {
  parseShortNovelBriefV1,
  parseShortNovelChapterDraftV1,
  parseShortNovelChapterPlanV1,
  parseShortNovelReviewV1,
  parseShortNovelStoryDesignV1,
} from '../../short-novel/contracts'
import { buildShortNovelPromptV1, type ShortNovelArtifactKindV1 } from '../../short-novel/prompts'
import { createAgentSkillExecutionBindingV1 } from '../execution-binding'
import { getAgentSkillV1 } from '../skill-registry'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { appendAgentRunEventV1, createAgentRunV1, readAgentRunV1, type AgentRunSnapshotV1 } from './event-store'
import { canonicalStringify, hashCanonicalValue } from './hash'
import { createVerificationReceiptV1 } from './verification-receipt'
import { plainTextToHtml } from '../../utils/html'

type ShortNovelCandidatePayloadMapV1 = {
  brief: ShortNovelBriefV1
  'story-design': ShortNovelStoryDesignV1
  'scene-plan': ShortNovelChapterPlanV1[]
  'chapter-draft': ShortNovelChapterDraftV1
  'continuity-review': ShortNovelReviewV1
  'targeted-rewrite': ShortNovelChapterDraftV1
}

export interface ShortNovelStructuredCandidateV1<K extends ShortNovelArtifactKindV1 = ShortNovelArtifactKindV1> {
  version: 1
  kind: 'short-novel-structured-candidate'
  portable: false
  artifactKind: K
  projectId: number
  worldId: number
  workId: number
  productionRevision: number
  manuscriptHash: string
  chapterKey: string | null
  issueKey: string | null
  contextManifestHash: string
  contextInputHash: string
  promptHash: string
  modelOutputHash: string
  payload: ShortNovelCandidatePayloadMapV1[K]
  payloadHash: string
  candidateHash: string
}

interface ShortNovelAdoptionIntentV1<K extends ShortNovelArtifactKindV1 = ShortNovelArtifactKindV1> {
  version: 1
  kind: 'short-novel-adoption-intent'
  portable: false
  candidate: ShortNovelStructuredCandidateV1<K>
  authorPayload: ShortNovelCandidatePayloadMapV1[K]
  authorPayloadHash: string
  intentHash: string
}

type RunAI = (messages: ChatMessage[]) => Promise<string>

const ARTIFACT_CONFIG = {
  brief: { skillId: 'short.intent-brief', stepId: 'short:brief', category: 'short-novel.brief', verifier: 'short-novel-brief-terminal-v1' },
  'story-design': { skillId: 'short.story-design', stepId: 'short:story-design', category: 'short-novel.story-design', verifier: 'short-novel-story-design-terminal-v1' },
  'scene-plan': { skillId: 'short.scene-plan', stepId: 'short:scene-plan', category: 'short-novel.scene-plan', verifier: 'short-novel-scene-plan-terminal-v1' },
  'chapter-draft': { skillId: 'short.chapter-draft', stepId: 'short:chapter-draft', category: 'short-novel.chapter-draft', verifier: 'short-novel-chapter-draft-terminal-v1' },
  'continuity-review': { skillId: 'short.continuity-review', stepId: 'short:continuity-review', category: 'short-novel.continuity-review', verifier: 'short-novel-continuity-review-terminal-v1' },
  'targeted-rewrite': { skillId: 'short.targeted-rewrite', stepId: 'short:targeted-rewrite', category: 'short-novel.targeted-rewrite', verifier: 'short-novel-targeted-rewrite-terminal-v1' },
} as const

function parseJson(raw: string): unknown {
  const normalized = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try { return JSON.parse(normalized) } catch { throw new Error('[short-novel-run] 模型输出不是严格 JSON') }
}

function parsePayload<K extends ShortNovelArtifactKindV1>(kind: K, value: unknown): ShortNovelCandidatePayloadMapV1[K] {
  if (kind === 'brief') return parseShortNovelBriefV1(value) as ShortNovelCandidatePayloadMapV1[K]
  if (kind === 'story-design') return parseShortNovelStoryDesignV1(value) as ShortNovelCandidatePayloadMapV1[K]
  if (kind === 'scene-plan') return parseShortNovelChapterPlanV1(value) as ShortNovelCandidatePayloadMapV1[K]
  if (kind === 'continuity-review') return parseShortNovelReviewV1(value) as ShortNovelCandidatePayloadMapV1[K]
  return parseShortNovelChapterDraftV1(value) as ShortNovelCandidatePayloadMapV1[K]
}

async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence } as never)
}

function runContract(scope: WorkspaceScope, artifactKind: ShortNovelArtifactKindV1) {
  const config = ARTIFACT_CONFIG[artifactKind]
  const skill = getAgentSkillV1(config.skillId)
  return {
    version: 1 as const,
    objective: `生成并由作者确认短篇 ${artifactKind} 候选`,
    workflowKind: 'plan-execute' as const,
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: {
      contextSourceKeys: [...skill.contextSourceKeys],
      writeTargets: skill.writeTargets.map(target => ({ table: target.table, fields: [...target.fields], mode: 'author-confirmed' as const })),
    },
    executionBindings: [{ stepId: config.stepId, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 64_000, maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 1, maxProtocolErrors: 0 },
    acceptance: [
      { id: `${config.stepId}.candidate`, kind: 'output-present' as const, required: true },
      { id: `${config.stepId}.author`, kind: 'author-confirmed' as const, required: true },
      { id: `${config.stepId}.post-state`, kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{ id: `${config.stepId}.terminal`, kind: 'terminal' as const, verifier: config.verifier, criterionIds: [`${config.stepId}.candidate`, `${config.stepId}.author`, `${config.stepId}.post-state`] }],
    failurePolicy: { onProtocolError: 'fail' as const, onVerificationFailure: 'fail' as const, onStaleInput: 'pause-for-author' as const },
  }
}

function findIssue(review: ShortNovelReviewV1 | null, issueKey?: string): ShortNovelReviewIssueV1 | undefined {
  if (!issueKey) return undefined
  return review?.issues.find(issue => issue.stableKey === issueKey)
}

async function assertPrerequisites(input: { scope: WorkspaceScope; artifactKind: ShortNovelArtifactKindV1; chapterKey?: string; issueKey?: string }) {
  const [production, manuscript] = await Promise.all([ensureShortNovelProductionV1(input.scope), buildShortNovelManuscriptSnapshotV1(input.scope)])
  if (input.artifactKind !== 'brief' && !production.briefConfirmedAt) throw new Error('[short-novel-run] 请先确认创作 Brief')
  if (!['brief', 'story-design'].includes(input.artifactKind) && !production.designConfirmedAt) throw new Error('[short-novel-run] 请先确认故事设计')
  if (['chapter-draft', 'targeted-rewrite'].includes(input.artifactKind)) {
    if (!input.chapterKey || !manuscript.chapters.some(chapter => chapter.stableKey === input.chapterKey)) throw new Error('[short-novel-run] 目标章节不存在')
  }
  const issue = findIssue(production.latestReview, input.issueKey)
  if (input.artifactKind === 'targeted-rewrite') {
    if (!issue || issue.status !== 'open') throw new Error('[short-novel-run] 定向重写必须绑定一个 open 审校问题')
    if (!issue.chapterKeys.includes(input.chapterKey!)) throw new Error('[short-novel-run] 审校问题没有指向目标章节')
  }
  return { production, manuscript, issue }
}

export async function generateShortNovelCandidateV1<K extends ShortNovelArtifactKindV1>(input: {
  scope: WorkspaceScope
  artifactKind: K
  authorInstruction?: string
  chapterKey?: string
  issueKey?: string
  aiConfig?: AIConfig
  runAI?: RunAI
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ShortNovelStructuredCandidateV1<K> }> {
  if (!input.aiConfig && !input.runAI) throw new Error('[short-novel-run] 缺少 AI 配置')
  const { production, manuscript, issue } = await assertPrerequisites(input)
  const config = ARTIFACT_CONFIG[input.artifactKind]
  const skill = getAgentSkillV1(config.skillId)
  let snapshot = await createAgentRunV1({ scope: input.scope, worldGroupId: null, contract: runContract(input.scope, input.artifactKind) })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: config.stepId })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: config.stepId, attempt: 1 })
  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: [...skill.contextSourceKeys],
    provider: input.aiConfig?.provider,
    model: input.aiConfig?.model,
    inputBudgetMaxTokens: 64_000,
  })
  const manifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId: config.stepId, attempt: 1, projectId: input.scope.projectId, worldGroupId: null, declaredSourceKeys: [...skill.contextSourceKeys], assembled, readerVersion: `${config.skillId}-context-v1` })
  snapshot = await append(input.scope, snapshot, 'context.assembled', { stepId: config.stepId, attempt: 1, manifestHash: manifest.manifestHash })
  const messages = buildShortNovelPromptV1({ kind: input.artifactKind, context: assembled.text, authorInstruction: input.authorInstruction ?? '', chapterKey: input.chapterKey, issue })
  snapshot = await append(input.scope, snapshot, 'model.requested', { stepId: config.stepId, attempt: 1, bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]) })
  let raw: string
  try {
    raw = await (input.runAI ? input.runAI(messages) : chat(messages, input.aiConfig!, { category: config.category, projectId: input.scope.projectId, configOverrides: { maxTokens: skill.maxOutputTokens }, contextOverflowPolicy: 'reject' }))
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'run.paused', { reason: `short-${input.artifactKind}-model-outcome-unknown`, recoverable: false })
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', { stepId: config.stepId, attempt: 1, outputHash: await hashCanonicalValue({ raw }) })
  let payload: ShortNovelCandidatePayloadMapV1[K]
  try { payload = parsePayload(input.artifactKind, parseJson(raw)) } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', { stepId: config.stepId, attempt: 1, code: `short-${input.artifactKind}-protocol-failed`, retryable: false, category: 'protocol', action: 'fail' })
    await append(input.scope, snapshot, 'run.failed', { code: `short-${input.artifactKind}-protocol-failed`, retryable: false })
    throw error
  }
  if (input.artifactKind === 'brief') {
    const brief = payload as ShortNovelBriefV1
    if (brief.targetWordCount !== manuscript.work.targetWordCount || brief.chapterCount !== manuscript.chapters.length) throw new Error('[short-novel-run] Brief 的目标字数/章节数必须与当前 Work 骨架一致')
  }
  if (input.artifactKind === 'scene-plan' && (payload as ShortNovelChapterPlanV1[]).length !== manuscript.chapters.length) throw new Error('[short-novel-run] 章节计划数量与当前骨架不一致')
  if (['chapter-draft', 'targeted-rewrite'].includes(input.artifactKind) && (payload as ShortNovelChapterDraftV1).chapterKey !== input.chapterKey) throw new Error('[short-novel-run] 模型返回了非目标章节')
  const body = {
    version: 1 as const,
    kind: 'short-novel-structured-candidate' as const,
    portable: false as const,
    artifactKind: input.artifactKind,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    productionRevision: production.revision,
    manuscriptHash: manuscript.manuscriptHash,
    chapterKey: input.chapterKey ?? null,
    issueKey: input.issueKey ?? null,
    contextManifestHash: manifest.manifestHash,
    contextInputHash: await hashCanonicalValue({ text: assembled.text, sourceEvidence: assembled.sourceEvidence }),
    promptHash: await hashCanonicalValue(messages),
    modelOutputHash: await hashCanonicalValue({ raw }),
    payload,
    payloadHash: await hashCanonicalValue(payload),
  }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) } as ShortNovelStructuredCandidateV1<K>
  snapshot = (await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate })).snapshot
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', { stepId: config.stepId, attempt: 1, candidateHash: candidate.candidateHash, requiresConfirmation: true })
  return { snapshot, candidate }
}

async function parseCandidate(value: unknown): Promise<ShortNovelStructuredCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[short-novel-run] 候选检查点无效')
  const candidate = value as ShortNovelStructuredCandidateV1
  if (candidate.version !== 1 || candidate.kind !== 'short-novel-structured-candidate' || candidate.portable !== false || !(candidate.artifactKind in ARTIFACT_CONFIG)) throw new Error('[short-novel-run] 候选类型无效')
  const payload = parsePayload(candidate.artifactKind, candidate.payload)
  if (await hashCanonicalValue(payload) !== candidate.payloadHash) throw new Error('[short-novel-run] 候选 payload hash 不匹配')
  const { candidateHash: _candidateHash, ...body } = candidate
  if (await hashCanonicalValue(body) !== candidate.candidateHash) throw new Error('[short-novel-run] 候选 hash 不匹配')
  return candidate
}

async function latestState(scope: WorkspaceScope, runId: number): Promise<{ candidate: ShortNovelStructuredCandidateV1; intent: ShortNovelAdoptionIntentV1 | null }> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('[short-novel-run] 运行缺少可验证检查点')
  const value = checkpoint.resumePayload
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as { kind?: string }).kind === 'short-novel-adoption-intent') {
    const intent = value as ShortNovelAdoptionIntentV1
    const candidate = await parseCandidate(intent.candidate)
    const authorPayload = parsePayload(candidate.artifactKind, intent.authorPayload)
    if (await hashCanonicalValue(authorPayload) !== intent.authorPayloadHash) throw new Error('[short-novel-run] 作者 payload hash 不匹配')
    const { intentHash: _intentHash, ...body } = intent
    if (await hashCanonicalValue(body) !== intent.intentHash) throw new Error('[short-novel-run] 采纳意图 hash 不匹配')
    return { candidate, intent }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

function targets(scope: WorkspaceScope, candidate: ShortNovelStructuredCandidateV1): boolean {
  return candidate.projectId === scope.projectId && candidate.worldId === scope.worldId && candidate.workId === scope.workId
}

export async function readPendingShortNovelCandidateV1(input: { scope: WorkspaceScope; artifactKind?: ShortNovelArtifactKindV1 }): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ShortNovelStructuredCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['awaiting_confirmation', 'running'].includes(row.status) && row.contractJson?.includes('short:'))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const state = await latestState(input.scope, row.id)
      if (!targets(input.scope, state.candidate) || state.intent || (input.artifactKind && state.candidate.artifactKind !== input.artifactKind)) continue
      const stepId = ARTIFACT_CONFIG[state.candidate.artifactKind].stepId
      if (!snapshot.projection.steps[stepId]?.candidateHash && snapshot.projection.steps[stepId]?.status === 'running') snapshot = await append(input.scope, snapshot, 'candidate.persisted', { stepId, attempt: 1, candidateHash: state.candidate.candidateHash, requiresConfirmation: true })
      if (snapshot.projection.state === 'awaiting_confirmation') return { snapshot, candidate: state.candidate }
    } catch { /* damaged/stale runs are not usable candidates */ }
  }
  return null
}

async function assertFresh(scope: WorkspaceScope, candidate: ShortNovelStructuredCandidateV1): Promise<void> {
  const [production, manuscript] = await Promise.all([ensureShortNovelProductionV1(scope), buildShortNovelManuscriptSnapshotV1(scope)])
  if (production.revision !== candidate.productionRevision) throw new Error('[short-novel-run] 生产状态已变化，候选已 stale')
  if (manuscript.manuscriptHash !== candidate.manuscriptHash) throw new Error('[short-novel-run] 手稿已变化，候选已 stale')
}

async function formalStateAlreadyMatches(scope: WorkspaceScope, intent: ShortNovelAdoptionIntentV1): Promise<boolean> {
  const [production, manuscript] = await Promise.all([ensureShortNovelProductionV1(scope), buildShortNovelManuscriptSnapshotV1(scope)])
  if (production.revision !== intent.candidate.productionRevision + 1) return false
  const payload = intent.authorPayload
  if (intent.candidate.artifactKind === 'brief') return canonicalStringify(production.brief) === canonicalStringify(payload)
  if (intent.candidate.artifactKind === 'story-design') return canonicalStringify(production.storyDesign) === canonicalStringify(payload)
  if (intent.candidate.artifactKind === 'continuity-review') {
    return canonicalStringify(production.latestReview) === canonicalStringify(payload)
      && production.reviewedManuscriptHash === intent.candidate.manuscriptHash
  }
  if (intent.candidate.artifactKind === 'scene-plan') {
    const plan = payload as ShortNovelChapterPlanV1[]
    return manuscript.chapters.length === plan.length
      && manuscript.chapters.every((chapter, index) => chapter.title === plan[index].title
        && chapter.summary.includes(plan[index].purpose)
        && chapter.summary.includes(plan[index].turn))
  }
  const draft = payload as ShortNovelChapterDraftV1
  const chapter = manuscript.chapters.find(item => item.stableKey === draft.chapterKey)
  return !!chapter && chapter.title === draft.title && chapter.contentHtml === plainTextToHtml(draft.content)
}

async function writeFormal(scope: WorkspaceScope, intent: ShortNovelAdoptionIntentV1): Promise<void> {
  const { candidate, authorPayload } = intent
  if (await formalStateAlreadyMatches(scope, intent)) return
  await assertFresh(scope, candidate)
  if (candidate.artifactKind === 'brief') await confirmShortNovelBriefV1({ scope, expectedRevision: candidate.productionRevision, brief: authorPayload as ShortNovelBriefV1 })
  else if (candidate.artifactKind === 'story-design') await confirmShortNovelStoryDesignV1({ scope, expectedRevision: candidate.productionRevision, storyDesign: authorPayload as ShortNovelStoryDesignV1 })
  else if (candidate.artifactKind === 'scene-plan') await adoptShortNovelChapterPlanV1({ scope, expectedRevision: candidate.productionRevision, plan: authorPayload as ShortNovelChapterPlanV1[] })
  else if (candidate.artifactKind === 'continuity-review') await adoptShortNovelReviewV1({ scope, expectedRevision: candidate.productionRevision, expectedManuscriptHash: candidate.manuscriptHash, review: authorPayload as ShortNovelReviewV1 })
  else await adoptShortNovelChapterDraftV1({ scope, expectedRevision: candidate.productionRevision, draft: authorPayload as ShortNovelChapterDraftV1, rewrite: candidate.artifactKind === 'targeted-rewrite' })
}

async function verifyPostState(scope: WorkspaceScope, intent: ShortNovelAdoptionIntentV1): Promise<string> {
  const [production, manuscript] = await Promise.all([ensureShortNovelProductionV1(scope), buildShortNovelManuscriptSnapshotV1(scope)])
  const payload = intent.authorPayload
  if (intent.candidate.artifactKind === 'brief' && canonicalStringify(production.brief) !== canonicalStringify(payload)) throw new Error('[short-novel-run] Brief 正式状态不匹配')
  if (intent.candidate.artifactKind === 'story-design' && canonicalStringify(production.storyDesign) !== canonicalStringify(payload)) throw new Error('[short-novel-run] 故事设计正式状态不匹配')
  if (intent.candidate.artifactKind === 'scene-plan') {
    const plan = payload as ShortNovelChapterPlanV1[]
    if (manuscript.chapters.length !== plan.length || manuscript.chapters.some((chapter, index) => chapter.title !== plan[index].title || !chapter.summary.includes(plan[index].turn))) throw new Error('[short-novel-run] 章节计划正式状态不匹配')
  }
  if (intent.candidate.artifactKind === 'continuity-review' && canonicalStringify(production.latestReview) !== canonicalStringify(payload)) throw new Error('[short-novel-run] 审校正式状态不匹配')
  if (['chapter-draft', 'targeted-rewrite'].includes(intent.candidate.artifactKind)) {
    const draft = payload as ShortNovelChapterDraftV1
    const chapter = manuscript.chapters.find(item => item.stableKey === draft.chapterKey)
    if (!chapter || chapter.title !== draft.title || chapter.contentHtml !== plainTextToHtml(draft.content)) throw new Error('[short-novel-run] 章节正文正式状态不匹配')
  }
  return hashCanonicalValue({ productionRevision: production.revision, phase: production.phase, manuscriptHash: manuscript.manuscriptHash, artifactKind: intent.candidate.artifactKind, payloadHash: intent.authorPayloadHash })
}

export async function adoptShortNovelCandidateV1<K extends ShortNovelArtifactKindV1>(input: { scope: WorkspaceScope; runId: number; authorPayload?: ShortNovelCandidatePayloadMapV1[K] }): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ShortNovelStructuredCandidateV1<K>; receiptHash: string }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate as ShortNovelStructuredCandidateV1<K>
  if (!targets(input.scope, candidate)) throw new Error('[short-novel-run] 候选越过当前 Work')
  const config = ARTIFACT_CONFIG[candidate.artifactKind]
  let intent = state.intent
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash) return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    await assertFresh(input.scope, candidate)
    if (!intent) {
      const authorPayload = parsePayload(candidate.artifactKind, input.authorPayload ?? candidate.payload)
      const authorPayloadHash = await hashCanonicalValue(authorPayload)
      const body = { version: 1 as const, kind: 'short-novel-adoption-intent' as const, portable: false as const, candidate, authorPayload, authorPayloadHash }
      intent = { ...body, intentHash: await hashCanonicalValue(body) }
      snapshot = (await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent })).snapshot
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', { stepId: config.stepId, candidateHash: candidate.candidateHash, decision: 'adopt' })
    snapshot = await append(input.scope, snapshot, 'adoption.started', { stepId: config.stepId, candidateHash: candidate.candidateHash, intentHash: intent.intentHash })
  }
  if (!intent || snapshot.projection.steps[config.stepId]?.confirmation !== 'adopt') throw new Error('[short-novel-run] 候选不在可恢复采纳状态')
  let adoptionHash = snapshot.projection.steps[config.stepId]?.adoptionHash
  if (!adoptionHash) {
    await writeFormal(input.scope, intent)
    const postStateHash = await verifyPostState(input.scope, intent)
    adoptionHash = await hashCanonicalValue({ intentHash: intent.intentHash, postStateHash })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', { stepId: config.stepId, candidateHash: candidate.candidateHash, adoptionHash })
  }
  const postStateHash = await verifyPostState(input.scope, intent)
  if (snapshot.projection.steps[config.stepId]?.status === 'running') snapshot = await append(input.scope, snapshot, 'step.succeeded', { stepId: config.stepId, attempt: 1, outputHash: adoptionHash })
  if (snapshot.projection.state === 'running') snapshot = await append(input.scope, snapshot, 'verification.started', { verifierSetVersion: config.verifier })
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [candidate.contextManifestHash],
    candidateHashes: [candidate.candidateHash],
    adoptionEventIds: [],
    postStateHash,
    verifierSetVersion: config.verifier,
    criteria: [
      { id: `${config.stepId}.candidate`, status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: `${config.stepId}.author`, status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: `${config.stepId}.post-state`, status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function rejectShortNovelCandidateV1(input: { scope: WorkspaceScope; runId: number }): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate, intent } = await latestState(input.scope, input.runId)
  if (!targets(input.scope, candidate) || snapshot.projection.state !== 'awaiting_confirmation' || intent) throw new Error('[short-novel-run] 候选不在等待确认状态')
  const stepId = ARTIFACT_CONFIG[candidate.artifactKind].stepId
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', { stepId, candidateHash: candidate.candidateHash, decision: 'reject' })
  return append(input.scope, snapshot, 'run.cancelled', { reason: `author-rejected-${candidate.artifactKind}` })
}
