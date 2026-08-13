import { chat } from '../../ai/client'
import {
  adoptSettingAssertionCandidatesAtomicV1,
  buildSettingAssertionExtractMessagesFromRegisteredContextV1,
  buildSettingAssertionFactCandidateV1,
  formatSettingAssertionScanContext,
  listSettingAssertionSources,
  listSettingAssertionSubjects,
  normalizeConstitutionValue,
  parseSettingAssertionCandidatesStrictV1,
  readSettingAssertionExtractPromptTemplateSnapshotV1,
  type ExtractedSettingAssertion,
  type SettingAssertionSource,
  type SettingAssertionSubjects,
} from '../../fact-ledger/setting-assertions'
import { assembleContext } from '../../registry/assemble-context'
import type { AIConfig, ChatMessage, TemporalFact, WorkspaceScope } from '../../types'
import { readOwnedRows } from '../../world-engine/scope'
import { createAgentSkillExecutionBindingV1 } from '../execution-binding'
import { getAgentSkillV1 } from '../skill-registry'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  staleAgentRunVerificationV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { canonicalStringify, hashCanonicalValue } from './hash'
import { createVerificationReceiptV1 } from './verification-receipt'

export const CONSTITUTION_EXTRACTION_STEP_ID_V1 = 'world-origin:constitution-extract' as const
export const CONSTITUTION_EXTRACTION_VERIFIER_SET_V1 = 'constitution-extraction-terminal-v1' as const
export const CONSTITUTION_EXTRACTION_CONTEXT_SOURCE_KEYS_V1 = ['constitutionScanSources'] as const

type RunAI = (messages: ChatMessage[]) => Promise<string>

interface SettingAssertionSourceSnapshotV1 {
  sourceKey: string
  table: SettingAssertionSource['table']
  recordId: number
  field: string
  label: string
  text: string
  worldGroupId: number | null
  characterId: number | null
  characterName: string | null
  fingerprint: string
}

type StableTemporalFactV1 = Record<string, unknown> & { id: number }

export interface ConstitutionExtractionCandidateV1 {
  version: 1
  kind: 'constitution-extraction-candidate'
  portable: false
  projectId: number
  worldId: number
  workId: number
  sources: SettingAssertionSourceSnapshotV1[]
  sourcesHash: string
  subjects: SettingAssertionSubjects
  subjectsHash: string
  originalFacts: StableTemporalFactV1[]
  originalFactsHash: string
  contextManifestHash: string
  contextInputHash: string
  promptTemplateHash: string
  promptHash: string
  modelOutputHash: string
  assertions: ExtractedSettingAssertion[]
  assertionsHash: string
  writeTimestamp: number
  candidateHash: string
}

interface ConstitutionExtractionAdoptionIntentV1 {
  version: 1
  kind: 'constitution-extraction-adoption-intent'
  portable: false
  candidate: ConstitutionExtractionCandidateV1
  expectedFactsHash: string
  intentHash: string
}

export type ConstitutionExtractionBoundaryV1 =
  | 'model.requested'
  | 'model.responded'
  | 'candidate.checkpoint'
  | 'candidate.persisted'
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function assertExactKeys(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(row)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${label}字段不在允许闭集。`)
  }
}

async function append(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: any,
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope,
    runId: snapshot.run.id,
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as any)
}

function stableSources(rows: readonly SettingAssertionSource[]): SettingAssertionSourceSnapshotV1[] {
  return rows.map(row => ({
      sourceKey: row.sourceKey,
      table: row.table,
      recordId: row.recordId,
      field: row.field,
      label: row.label,
      text: row.text,
      worldGroupId: row.worldGroupId ?? null,
      characterId: row.characterId ?? null,
      characterName: row.characterName ?? null,
      fingerprint: row.fingerprint,
  }))
}

function stableSubjects(subjects: SettingAssertionSubjects): SettingAssertionSubjects {
  return {
    worldGroups: subjects.worldGroups.map(item => ({ id: item.id, name: item.name })),
    characters: subjects.characters.map(item => ({
      id: item.id,
      name: item.name,
      worldGroupId: item.worldGroupId ?? null,
    })),
  }
}

function stableFacts(rows: readonly TemporalFact[]): StableTemporalFactV1[] {
  return rows
    .filter((row): row is TemporalFact & { id: number } => Number.isInteger(row.id))
    .sort((left, right) => left.id - right.id)
    .map(row => JSON.parse(canonicalStringify(row)) as StableTemporalFactV1)
}

function stripFactId(row: TemporalFact): Record<string, unknown> {
  const { id: _id, ...rest } = row
  return JSON.parse(canonicalStringify(rest)) as Record<string, unknown>
}

async function readRegisteredInput(scope: WorkspaceScope) {
  const [sourceRows, rawSubjects, factRows, assembled] = await Promise.all([
    listSettingAssertionSources(scope.projectId, undefined, scope),
    listSettingAssertionSubjects(scope),
    readOwnedRows<TemporalFact>(scope, 'temporalFacts', { owner: 'work' }),
    assembleContext({
      projectId: scope.projectId,
      scope,
      sourceKeys: [...CONSTITUTION_EXTRACTION_CONTEXT_SOURCE_KEYS_V1],
      inputBudgetMaxTokens: 30_000,
    }),
  ])
  const sources = stableSources(sourceRows)
  const subjects = stableSubjects(rawSubjects)
  const originalFacts = stableFacts(factRows)
  const expectedContext = formatSettingAssertionScanContext(sources, subjects)
  const delivered = assembled.segments.find(segment => segment.label === '世界宪法扫描来源闭集')
  const evidence = assembled.sourceEvidence?.find(item => item.key === 'constitutionScanSources')
  if (!delivered || evidence?.status !== 'included' || evidence.delivery !== 'full'
    || delivered.content !== expectedContext || assembled.text !== expectedContext) {
    throw new Error('世界宪法扫描登记闭集在读取期间变化或超过无损输入预算；未调用模型，请缩短来源后重试。')
  }
  return { sources, subjects, originalFacts, assembled }
}

function contextInput(assembled: Awaited<ReturnType<typeof assembleContext>>) {
  return { text: assembled.text, sourceEvidence: assembled.sourceEvidence }
}

async function promptEvidence(contextText: string) {
  const messages = buildSettingAssertionExtractMessagesFromRegisteredContextV1(contextText)
  return {
    messages,
    promptTemplateHash: await hashCanonicalValue(readSettingAssertionExtractPromptTemplateSnapshotV1()),
    promptHash: await hashCanonicalValue(messages),
  }
}

function contract(scope: WorkspaceScope) {
  const skill = getAgentSkillV1('world-origin.constitution-extract', 'world-origin')
  return {
    version: 1 as const,
    objective: '从已登记设定来源抽取需作者双层确认的世界宪法事实候选',
    workflowKind: 'plan-execute' as const,
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: {
      contextSourceKeys: [...CONSTITUTION_EXTRACTION_CONTEXT_SOURCE_KEYS_V1],
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table,
        fields: [...target.fields],
        mode: 'author-confirmed' as const,
        ...(target.adoptionExtension ? { adoptionExtension: target.adoptionExtension } : {}),
      })),
    },
    executionBindings: [{
      stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
      ...createAgentSkillExecutionBindingV1(skill),
    }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 30_000,
      maxOutputTokens: skill.maxOutputTokens,
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'constitution-extraction.candidate', kind: 'output-present' as const, required: true },
      { id: 'constitution-extraction.author', kind: 'author-confirmed' as const, required: true },
      { id: 'constitution-extraction.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'constitution-extraction.terminal',
      kind: 'terminal' as const,
      verifier: CONSTITUTION_EXTRACTION_VERIFIER_SET_V1,
      criterionIds: [
        'constitution-extraction.candidate',
        'constitution-extraction.author',
        'constitution-extraction.post-state',
      ],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function contractIsConstitutionExtraction(contractJson: unknown): boolean {
  return typeof contractJson === 'string' && contractJson.includes('world-origin.constitution-extract')
}

function assertSourceSnapshots(value: unknown): asserts value is SettingAssertionSourceSnapshotV1[] {
  if (!Array.isArray(value)) throw new Error('世界宪法抽取来源快照无效。')
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('世界宪法抽取来源快照无效。')
    const row = item as Record<string, unknown>
    assertExactKeys(row, [
      'sourceKey', 'table', 'recordId', 'field', 'label', 'text', 'worldGroupId',
      'characterId', 'characterName', 'fingerprint',
    ], '世界宪法抽取来源快照')
    if (!['worldviews', 'powerSystems', 'cultivationSystems', 'storyCores', 'characters'].includes(String(row.table))
      || !Number.isInteger(row.recordId)
      || (row.worldGroupId !== null && !Number.isInteger(row.worldGroupId))
      || (row.characterId !== null && !Number.isInteger(row.characterId))
      || (row.characterName !== null && typeof row.characterName !== 'string')
      || !['sourceKey', 'field', 'label', 'text', 'fingerprint'].every(key => typeof row[key] === 'string')) {
      throw new Error('世界宪法抽取来源快照不完整。')
    }
  }
}

function assertSubjects(value: unknown): asserts value is SettingAssertionSubjects {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('世界宪法抽取主体快照无效。')
  const row = value as Record<string, unknown>
  assertExactKeys(row, ['worldGroups', 'characters'], '世界宪法抽取主体快照')
  if (!Array.isArray(row.worldGroups) || !Array.isArray(row.characters)) throw new Error('世界宪法抽取主体快照无效。')
  row.worldGroups.forEach(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('世界主体快照无效。')
    const subject = item as Record<string, unknown>
    assertExactKeys(subject, ['id', 'name'], '世界主体快照')
    if ((subject.id !== null && !Number.isInteger(subject.id)) || typeof subject.name !== 'string') throw new Error('世界主体快照无效。')
  })
  row.characters.forEach(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('角色主体快照无效。')
    const subject = item as Record<string, unknown>
    assertExactKeys(subject, ['id', 'name', 'worldGroupId'], '角色主体快照')
    if (!Number.isInteger(subject.id) || typeof subject.name !== 'string'
      || (subject.worldGroupId !== null && !Number.isInteger(subject.worldGroupId))) throw new Error('角色主体快照无效。')
  })
}

async function parseCandidate(value: unknown): Promise<ConstitutionExtractionCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('世界宪法抽取候选检查点无效。')
  const row = value as Record<string, any>
  const keys = [
    'version', 'kind', 'portable', 'projectId', 'worldId', 'workId',
    'sources', 'sourcesHash', 'subjects', 'subjectsHash', 'originalFacts', 'originalFactsHash',
    'contextManifestHash', 'contextInputHash', 'promptTemplateHash', 'promptHash',
    'modelOutputHash', 'assertions', 'assertionsHash', 'writeTimestamp', 'candidateHash',
  ] as const
  assertExactKeys(row, keys, '世界宪法抽取候选')
  if (row.version !== 1 || row.kind !== 'constitution-extraction-candidate' || row.portable !== false
    || ![row.projectId, row.worldId, row.workId, row.writeTimestamp].every(Number.isInteger)
    || ![
      row.sourcesHash, row.subjectsHash, row.originalFactsHash, row.contextManifestHash,
      row.contextInputHash, row.promptTemplateHash, row.promptHash, row.modelOutputHash,
      row.assertionsHash, row.candidateHash,
    ].every(isHash)) throw new Error('世界宪法抽取候选检查点不完整。')
  assertSourceSnapshots(row.sources)
  assertSubjects(row.subjects)
  if (!Array.isArray(row.originalFacts) || row.originalFacts.some((item: unknown) => (
    !item || typeof item !== 'object' || Array.isArray(item) || !Number.isInteger((item as Record<string, unknown>).id)
  ))) throw new Error('世界宪法抽取事实 baseline 无效。')
  const assertions = parseSettingAssertionCandidatesStrictV1(
    JSON.stringify({ assertions: row.assertions }),
    row.sources,
    row.subjects,
  )
  if (canonicalStringify(assertions) !== canonicalStringify(row.assertions)) throw new Error('世界宪法抽取候选未规范化。')
  if (await hashCanonicalValue(row.sources) !== row.sourcesHash
    || await hashCanonicalValue(row.subjects) !== row.subjectsHash
    || await hashCanonicalValue(row.originalFacts) !== row.originalFactsHash
    || await hashCanonicalValue(row.assertions) !== row.assertionsHash) {
    throw new Error('世界宪法抽取候选内容 hash 不匹配。')
  }
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('世界宪法抽取候选 hash 不匹配。')
  return row as ConstitutionExtractionCandidateV1
}

async function expectedFactRows(candidate: ConstitutionExtractionCandidateV1): Promise<Record<string, unknown>[]> {
  const sourceByKey = new Map(candidate.sources.map(source => [source.sourceKey, source]))
  return candidate.assertions.map(assertion => {
    const source = sourceByKey.get(assertion.sourceKey)
    if (!source) throw new Error('世界宪法抽取候选引用了未知来源。')
    const fact = buildSettingAssertionFactCandidateV1({
      scope: {
        projectId: candidate.projectId,
        worldId: candidate.worldId,
        workId: candidate.workId,
      },
      projectId: candidate.projectId,
      candidate: assertion,
      source,
      subjects: candidate.subjects,
      timestamp: candidate.writeTimestamp,
    })
    if (!fact) throw new Error('世界宪法抽取候选无法构造登记事实。')
    return stripFactId(fact)
  })
}

async function parseState(value: unknown): Promise<{
  candidate: ConstitutionExtractionCandidateV1
  intent: ConstitutionExtractionAdoptionIntentV1 | null
}> {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'constitution-extraction-adoption-intent') {
    const row = value as Record<string, any>
    assertExactKeys(row, ['version', 'kind', 'portable', 'candidate', 'expectedFactsHash', 'intentHash'], '世界宪法抽取采纳意图')
    if (row.version !== 1 || row.portable !== false || !isHash(row.expectedFactsHash) || !isHash(row.intentHash)) {
      throw new Error('世界宪法抽取采纳意图无效。')
    }
    const candidate = await parseCandidate(row.candidate)
    if (await hashCanonicalValue(await expectedFactRows(candidate)) !== row.expectedFactsHash) {
      throw new Error('世界宪法抽取预期事实 hash 不匹配。')
    }
    const body = {
      version: 1 as const,
      kind: 'constitution-extraction-adoption-intent' as const,
      portable: false as const,
      candidate,
      expectedFactsHash: row.expectedFactsHash,
    }
    if (await hashCanonicalValue(body) !== row.intentHash) throw new Error('世界宪法抽取采纳意图 hash 不匹配。')
    return { candidate, intent: row as ConstitutionExtractionAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function latestState(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('世界宪法抽取运行缺少可验证检查点。')
  return parseState(checkpoint.resumePayload)
}

function assertCandidateScope(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: ConstitutionExtractionCandidateV1,
): void {
  if (candidate.projectId !== scope.projectId || candidate.worldId !== scope.worldId || candidate.workId !== scope.workId
    || snapshot.run.projectId !== scope.projectId || snapshot.run.worldGroupId != null) {
    throw new Error('世界宪法抽取候选与当前 World/Work 不匹配。')
  }
}

function sameAssertionAsFact(assertion: ExtractedSettingAssertion, fact: StableTemporalFactV1): boolean {
  const subjectMatches = assertion.subjectType === 'character'
    ? fact.characterId === assertion.subjectId
    : (fact.subjectWorldGroupId ?? null) === assertion.subjectId
  return fact.status !== 'rejected'
    && subjectMatches
    && fact.predicate === assertion.predicate
    && normalizeConstitutionValue(String(fact.value ?? '')) === normalizeConstitutionValue(assertion.value)
    && fact.sourceQuote === assertion.quote
}

async function currentEvidence(scope: WorkspaceScope, candidate: ConstitutionExtractionCandidateV1) {
  const current = await readRegisteredInput(scope)
  const prompt = await promptEvidence(current.assembled.text)
  const currentFactsHash = await hashCanonicalValue(current.originalFacts)
  const baselineFresh = currentFactsHash === candidate.originalFactsHash
  const expected = await expectedFactRows(candidate)
  const originalIds = new Set(candidate.originalFacts.map(row => row.id))
  const currentById = new Map(current.originalFacts.map(row => [row.id, row]))
  const originalUnchanged = candidate.originalFacts.every(row => canonicalStringify(currentById.get(row.id)) === canonicalStringify(row))
  const added = current.originalFacts.filter(row => !originalIds.has(row.id)).map(row => {
    const { id: _id, ...rest } = row
    return rest
  })
  return {
    sourcesFresh: await hashCanonicalValue(current.sources) === candidate.sourcesHash,
    subjectsFresh: await hashCanonicalValue(current.subjects) === candidate.subjectsHash,
    baselineFresh,
    contextFresh: await hashCanonicalValue(contextInput(current.assembled)) === candidate.contextInputHash,
    promptFresh: prompt.promptHash === candidate.promptHash,
    templateFresh: prompt.promptTemplateHash === candidate.promptTemplateHash,
    expectedMatches: originalUnchanged && canonicalStringify(added) === canonicalStringify(expected),
  }
}

async function pauseUnsafeRun(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, reason: string) {
  if (snapshot.projection.state === 'running' || snapshot.projection.state === 'awaiting_confirmation') {
    return append(scope, snapshot, 'run.paused', { reason, recoverable: false })
  }
  return snapshot
}

async function staleBeforeWrite(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: ConstitutionExtractionCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const evidence = await currentEvidence(scope, candidate)
  if (evidence.sourcesFresh && evidence.subjectsFresh && evidence.baselineFresh
    && evidence.contextFresh && evidence.promptFresh && evidence.templateFresh) return snapshot
  const reason = !evidence.sourcesFresh
    ? 'constitution-extraction-sources-changed'
    : !evidence.subjectsFresh
      ? 'constitution-extraction-subjects-changed'
      : !evidence.baselineFresh
        ? 'constitution-extraction-facts-changed'
        : !evidence.contextFresh
          ? 'constitution-extraction-context-changed'
          : 'constitution-extraction-prompt-changed'
  const next = await append(scope, snapshot, 'candidate.staled', {
    stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    reason,
  })
  throw Object.assign(new Error('设定来源、主体、事实 baseline、Context 或 Prompt 已变化，请重新扫描。'), { snapshot: next })
}

export async function generateConstitutionExtractionCandidateV1(input: {
  scope: WorkspaceScope
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: ConstitutionExtractionBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ConstitutionExtractionCandidateV1 }> {
  if (!input.runAI && !input.aiConfig) throw new Error('世界宪法抽取缺少 AI 配置。')
  const prepared = await readRegisteredInput(input.scope)
  if (!prepared.sources.length) throw new Error('当前世界观、力量体系、故事核心和角色档案中没有可扫描的已登记字段。')
  let snapshot = await createAgentRunV1({ scope: input.scope, contract: contract(input.scope) })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1, attempt: 1 })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: null,
    declaredSourceKeys: [...CONSTITUTION_EXTRACTION_CONTEXT_SOURCE_KEYS_V1],
    assembled: prepared.assembled,
    readerVersion: 'constitution-extraction-context-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
    attempt: 1,
    manifestHash: manifest.manifestHash,
  })
  const prompt = await promptEvidence(prepared.assembled.text)
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]),
  })
  let raw: string
  try {
    await input.onDurableBoundary?.('model.requested', snapshot)
    raw = await (input.runAI
      ? input.runAI(prompt.messages)
      : chat(prompt.messages, input.aiConfig!, {
          category: 'canon.setting.extract',
          projectId: input.scope.projectId,
          configOverrides: { maxTokens: getAgentSkillV1('world-origin.constitution-extract').maxOutputTokens },
          contextOverflowPolicy: 'reject',
        }))
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'constitution-extraction-model-outcome-unknown')
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', {
    stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
    attempt: 1,
    outputHash: await hashCanonicalValue({ raw }),
  })
  try {
    await input.onDurableBoundary?.('model.responded', snapshot)
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'constitution-extraction-model-result-uncheckpointed')
    throw error
  }
  let assertions: ExtractedSettingAssertion[]
  try {
    assertions = parseSettingAssertionCandidatesStrictV1(raw, prepared.sources, prepared.subjects)
    if (assertions.some(assertion => prepared.originalFacts.some(fact => sameAssertionAsFact(assertion, fact)))) {
      throw new Error('模型返回了事实库中已存在的同值同证据候选。')
    }
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
      attempt: 1,
      code: 'constitution-extraction-protocol-failed',
      retryable: false,
      category: 'protocol',
      action: 'fail',
    })
    await append(input.scope, snapshot, 'run.failed', { code: 'constitution-extraction-protocol-failed', retryable: false })
    throw error
  }
  const body = {
    version: 1 as const,
    kind: 'constitution-extraction-candidate' as const,
    portable: false as const,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    sources: prepared.sources,
    sourcesHash: await hashCanonicalValue(prepared.sources),
    subjects: prepared.subjects,
    subjectsHash: await hashCanonicalValue(prepared.subjects),
    originalFacts: prepared.originalFacts,
    originalFactsHash: await hashCanonicalValue(prepared.originalFacts),
    contextManifestHash: manifest.manifestHash,
    contextInputHash: await hashCanonicalValue(contextInput(prepared.assembled)),
    promptTemplateHash: prompt.promptTemplateHash,
    promptHash: prompt.promptHash,
    modelOutputHash: await hashCanonicalValue({ raw }),
    assertions,
    assertionsHash: await hashCanonicalValue(assertions),
    writeTimestamp: Date.now(),
  }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
  await input.onDurableBoundary?.('candidate.persisted', snapshot)
  return { snapshot, candidate }
}

async function repairCandidateEventIfNeeded(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: ConstitutionExtractionCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const step = snapshot.projection.steps[CONSTITUTION_EXTRACTION_STEP_ID_V1]
  if (step?.candidateHash) return snapshot
  if (step?.status !== 'running') throw new Error('世界宪法抽取候选事件无法安全重建。')
  return append(scope, snapshot, 'candidate.persisted', {
    stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
}

export async function readPendingConstitutionExtractionCandidateV1(input: {
  scope: WorkspaceScope
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ConstitutionExtractionCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['awaiting_confirmation', 'running', 'verifying'].includes(row.status)
      && contractIsConstitutionExtraction(row.contractJson))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const { candidate, intent } = await latestState(input.scope, row.id)
      assertCandidateScope(input.scope, snapshot, candidate)
      snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
      if (snapshot.projection.state === 'awaiting_confirmation' && !intent) return { snapshot, candidate }
    } catch {
      // Damaged or unrelated local run is not surfaced as a usable candidate.
    }
  }
  return null
}

export async function readRecoverableConstitutionExtractionRunV1(input: {
  scope: WorkspaceScope
}): Promise<{
  snapshot: AgentRunSnapshotV1
  safeToResume: boolean
  candidate?: ConstitutionExtractionCandidateV1
  adoptionPending?: boolean
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(row.status)
      && contractIsConstitutionExtraction(row.contractJson))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    const snapshot = await readAgentRunV1(input.scope, row.id)
    try {
      const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, row.id)
      if (checkpoint) {
        const state = await parseState(checkpoint.resumePayload)
        assertCandidateScope(input.scope, snapshot, state.candidate)
        return {
          snapshot,
          safeToResume: true,
          candidate: state.candidate,
          adoptionPending: state.intent != null,
        }
      }
    } catch {
      // Conservative unsafe result below.
    }
    return { snapshot, safeToResume: false }
  }
  return null
}

async function writeFormalFacts(scope: WorkspaceScope, candidate: ConstitutionExtractionCandidateV1): Promise<void> {
  await adoptSettingAssertionCandidatesAtomicV1({
    scope,
    candidates: candidate.assertions,
    sources: candidate.sources,
    subjects: candidate.subjects,
    timestamp: candidate.writeTimestamp,
    assertBaseline: async () => {
      const [currentSourceRows, currentSubjects, currentFactRows] = await Promise.all([
        listSettingAssertionSources(scope.projectId, undefined, scope),
        listSettingAssertionSubjects(scope),
        readOwnedRows<TemporalFact>(scope, 'temporalFacts', { owner: 'work' }),
      ])
      if (canonicalStringify(stableSources(currentSourceRows)) !== canonicalStringify(candidate.sources)
        || canonicalStringify(stableSubjects(currentSubjects)) !== canonicalStringify(candidate.subjects)
        || canonicalStringify(stableFacts(currentFactRows)) !== canonicalStringify(candidate.originalFacts)) {
        throw new Error('世界宪法抽取 CAS 失败：来源、主体或事实 baseline 已变化。')
      }
    },
  })
}

export async function adoptConstitutionExtractionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  onDurableBoundary?: (boundary: ConstitutionExtractionBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{
  snapshot: AgentRunSnapshotV1
  candidate: ConstitutionExtractionCandidateV1
  receiptHash: string
  written: number
}> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate
  let intent = state.intent
  assertCandidateScope(input.scope, snapshot, candidate)
  let evidence = await currentEvidence(input.scope, candidate)
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    if (!evidence.expectedMatches || !evidence.sourcesFresh || !evidence.subjectsFresh
      || !evidence.contextFresh || !evidence.templateFresh) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope,
        runId: snapshot.run.id,
        reason: 'constitution-extraction-terminal-evidence-stale',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'constitution-extraction-terminal-evidence-stale',
      })
      throw new Error('世界宪法抽取完成回执已过期；来源、主体或事实批次已变化。')
    }
    return {
      snapshot,
      candidate,
      receiptHash: snapshot.projection.terminalReceiptHash,
      written: candidate.assertions.length,
    }
  }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    snapshot = await staleBeforeWrite(input.scope, snapshot, candidate)
    if (!intent) {
      const expectedFactsHash = await hashCanonicalValue(await expectedFactRows(candidate))
      const body = {
        version: 1 as const,
        kind: 'constitution-extraction-adoption-intent' as const,
        portable: false as const,
        candidate,
        expectedFactsHash,
      }
      intent = { ...body, intentHash: await hashCanonicalValue(body) }
      const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent })
      snapshot = saved.snapshot
      await input.onDurableBoundary?.('intent.checkpoint', snapshot)
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  } else if (snapshot.projection.steps[CONSTITUTION_EXTRACTION_STEP_ID_V1]?.confirmation !== 'adopt' || !intent) {
    throw new Error('世界宪法抽取候选不在可恢复采纳状态。')
  }
  let adoptionHash = snapshot.projection.steps[CONSTITUTION_EXTRACTION_STEP_ID_V1]?.adoptionHash
  if (!adoptionHash) {
    evidence = await currentEvidence(input.scope, candidate)
    if (!evidence.expectedMatches) {
      snapshot = await staleBeforeWrite(input.scope, snapshot, candidate)
      await writeFormalFacts(input.scope, candidate)
      evidence = await currentEvidence(input.scope, candidate)
    }
    if (!evidence.expectedMatches) {
      await pauseUnsafeRun(input.scope, snapshot, 'constitution-extraction-formal-state-diverged')
      throw new Error('事实库与冻结世界宪法候选批次不一致。')
    }
    await input.onDurableBoundary?.('formal.written', snapshot)
    adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      expectedFactsHash: intent.expectedFactsHash,
      written: candidate.assertions.length,
    })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  evidence = await currentEvidence(input.scope, candidate)
  if (!evidence.expectedMatches || !evidence.sourcesFresh || !evidence.subjectsFresh
    || !evidence.contextFresh || !evidence.templateFresh) {
    await pauseUnsafeRun(input.scope, snapshot, 'constitution-extraction-terminal-evidence-stale')
    throw new Error('世界宪法候选写入后来源、主体或事实批次变化，本次回执不会通过终验。')
  }
  if (snapshot.projection.steps[CONSTITUTION_EXTRACTION_STEP_ID_V1]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
      attempt: 1,
      outputHash: adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: CONSTITUTION_EXTRACTION_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  const postStateHash = await hashCanonicalValue({
    candidateHash: candidate.candidateHash,
    expectedFactsHash: intent.expectedFactsHash,
    sourcesHash: candidate.sourcesHash,
    subjectsHash: candidate.subjectsHash,
  })
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [candidate.contextManifestHash],
    candidateHashes: [candidate.candidateHash],
    adoptionEventIds: [],
    postStateHash,
    verifierSetVersion: CONSTITUTION_EXTRACTION_VERIFIER_SET_V1,
    criteria: [
      { id: 'constitution-extraction.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'constitution-extraction.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'constitution-extraction.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, candidate, receiptHash: receipt.receiptHash, written: candidate.assertions.length }
}

export async function rejectConstitutionExtractionCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate } = await latestState(input.scope, input.runId)
  assertCandidateScope(input.scope, snapshot, candidate)
  if (snapshot.projection.state !== 'awaiting_confirmation') throw new Error('世界宪法抽取候选不在等待确认状态。')
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: CONSTITUTION_EXTRACTION_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-constitution-extraction' })
}

export async function abandonConstitutionExtractionRunV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(snapshot.projection.state)) {
    throw new Error('世界宪法抽取运行不在可放弃状态。')
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-constitution-extraction' })
}
