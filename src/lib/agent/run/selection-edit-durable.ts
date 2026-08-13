import { db } from '../../db/schema'
import type { AIConfig, Chapter, ChatMessage, WorkspaceScope } from '../../types'
import { chat } from '../../ai/client'
import {
  buildSelectionEditPromptV1,
  isSelectionEditActionV1,
  selectionPromptModuleKeyV1,
  type SelectionEditActionV1,
} from '../../ai/adapters/selection-edit-adapter'
import {
  CHAPTER_TEXT_NORMALIZATION_VERSION,
  hashChapterText,
  normalizeChapterText,
  sha256Text,
} from '../../ai/chapter-memory/text-normalization'
import { countWords, htmlToPlainText } from '../../utils/html'
import { assembleContext } from '../../registry/assemble-context'
import { adopt } from '../../registry/adopt'
import { assertRecordInScope, readOwnedRows } from '../../world-engine/scope'
import { usePromptStore } from '../../../stores/prompt'
import { propagateChapterEditStale } from '../../consistency/impact-analysis'
import { getAgentSkillV1 } from '../skill-registry'
import { createAgentSkillExecutionBindingV1 } from '../execution-binding'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  staleAgentRunVerificationV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { createVerificationReceiptV1 } from './verification-receipt'
import { hashCanonicalValue } from './hash'

export const SELECTION_EDIT_STEP_ID_V1 = 'prose:selection-edit' as const
export const SELECTION_CHECK_STEP_ID_V1 = 'prose:selection-check' as const
export const SELECTION_EDIT_VERIFIER_SET_V1 = 'prose-selection-edit-terminal-v1' as const
export const SELECTION_CHECK_VERIFIER_SET_V1 = 'prose-selection-check-terminal-v1' as const
const SOURCE_KEYS = ['manualText'] as const

export interface SelectionSnapshotV1 {
  from: number
  to: number
  text: string
  sourceHtml: string
}

export interface SelectionEditCandidateV1 {
  version: 1
  kind: 'selection-edit-candidate'
  portable: false
  mode: 'edit' | 'check'
  projectId: number
  workId: number
  worldGroupId: number | null
  chapterId: number
  action: SelectionEditActionV1
  from: number
  to: number
  selectedText: string
  selectedTextHash: string
  sourceTextHash: string
  sourceContentHash: string
  contextManifestHash: string
  contextInputHash: string
  promptModuleKey: string
  promptTemplateHash: string
  promptHash: string
  outputText: string
  outputHash: string
  expectedContentHtml: string | null
  expectedContentHash: string | null
  expectedTextHash: string | null
  expectedWordCount: number | null
  candidateHash: string
}

interface SelectionEditAdoptionIntentV1 {
  version: 1
  kind: 'selection-edit-adoption-intent'
  portable: false
  candidate: SelectionEditCandidateV1
  intentHash: string
}

export type SelectionEditBoundaryV1 =
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

type RunAI = (messages: ChatMessage[]) => Promise<string>
type PreviewReplacement = (input: {
  selection: SelectionSnapshotV1
  outputText: string
}) => string | Promise<string>

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function assertExactKeys(row: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) {
    throw new Error(`${label}字段不在允许闭集。`)
  }
}

function stepId(action: SelectionEditActionV1): typeof SELECTION_EDIT_STEP_ID_V1 | typeof SELECTION_CHECK_STEP_ID_V1 {
  return action === 'check' ? SELECTION_CHECK_STEP_ID_V1 : SELECTION_EDIT_STEP_ID_V1
}

function modeFor(action: SelectionEditActionV1): 'edit' | 'check' {
  return action === 'check' ? 'check' : 'edit'
}

function verifierFor(mode: 'edit' | 'check'): string {
  return mode === 'edit' ? SELECTION_EDIT_VERIFIER_SET_V1 : SELECTION_CHECK_VERIFIER_SET_V1
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

async function exactContentHash(content: string): Promise<string> {
  return sha256Text(content)
}

async function readChapter(scope: WorkspaceScope, chapterId: number): Promise<Chapter & { id: number }> {
  const chapter = await db.chapters.get(chapterId)
  if (!chapter?.id || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
    throw new Error('目标章节不存在或不属于当前 Work。')
  }
  return chapter as Chapter & { id: number }
}

function promptTemplateBody(action: SelectionEditActionV1) {
  const template = usePromptStore.getState().getActive(selectionPromptModuleKeyV1(action))
  return {
    moduleKey: template.moduleKey,
    name: template.name,
    systemPrompt: template.systemPrompt,
    userPromptTemplate: template.userPromptTemplate,
    variables: template.variables,
    parameters: template.parameters ?? [],
    modelOverride: template.modelOverride ?? null,
  }
}

async function promptEvidence(action: SelectionEditActionV1, text: string): Promise<{
  messages: ChatMessage[]
  promptTemplateHash: string
  promptHash: string
}> {
  const messages = buildSelectionEditPromptV1(action, text)
  return {
    messages,
    promptTemplateHash: await hashCanonicalValue(promptTemplateBody(action)),
    promptHash: await hashCanonicalValue(messages),
  }
}

function validateSelection(selection: SelectionSnapshotV1): void {
  if (
    !Number.isInteger(selection.from)
    || !Number.isInteger(selection.to)
    || selection.from < 1
    || selection.to <= selection.from
  ) throw new Error('局部编辑选区位置无效。')
  const text = selection.text.trim()
  if (text.length < 6 || text.length >= 5_000) throw new Error('请选择 6～4999 个字符进行局部处理。')
  if (!selection.sourceHtml.trim()) throw new Error('当前章节正文为空。')
  if (!normalizeChapterText(selection.sourceHtml).includes(normalizeChapterText(text))) {
    throw new Error('冻结选中文字不在当前章节正文中。')
  }
}

function assertPlainReplacementOnly(selection: SelectionSnapshotV1, outputText: string, expectedHtml: string): void {
  const source = normalizeChapterText(selection.sourceHtml)
  const selected = normalizeChapterText(selection.text)
  const output = normalizeChapterText(outputText)
  const expected = normalizeChapterText(expectedHtml)
  if (!selected || !output) throw new Error('局部编辑范围预演缺少可验证文本。')
  let cursor = 0
  let matched = false
  while (cursor <= source.length) {
    const index = source.indexOf(selected, cursor)
    if (index < 0) break
    if (normalizeChapterText(`${source.slice(0, index)}${output}${source.slice(index + selected.length)}`) === expected) {
      matched = true
      break
    }
    cursor = index + 1
  }
  if (!matched) throw new Error('局部编辑范围预演改变了冻结选区之外的正文。')
}

export function parseSelectionModelOutputV1(
  action: SelectionEditActionV1,
  sourceText: string,
  raw: string,
): string {
  const output = raw.trim()
  if (!output) throw new Error('局部处理模型输出为空。')
  if (/^```[\s\S]*```$/.test(output)) throw new Error('局部处理模型输出不得包含 Markdown 代码围栏。')
  const sourceLength = countWords(sourceText)
  const outputLength = countWords(output)
  if (!outputLength) throw new Error('局部处理模型输出没有有效文字。')
  if (action === 'check') {
    if (output.length > 8_000) throw new Error('局部查漏报告超过 8000 字符上限。')
    return output
  }
  if (output === sourceText.trim()) throw new Error('局部编辑结果与原文完全相同。')
  if (output.length > 20_000) throw new Error('局部编辑结果超过 20000 字符上限。')
  if (action === 'condense' && (outputLength >= sourceLength || outputLength < Math.max(1, Math.floor(sourceLength * 0.2)))) {
    throw new Error('缩写结果未满足比原文更短且保留至少 20% 内容的硬边界。')
  }
  if (action === 'expand' && (outputLength <= sourceLength || outputLength > Math.min(20_000, Math.max(sourceLength * 5, sourceLength + 1_000)))) {
    throw new Error('扩写结果未满足比原文更长且不超过五倍的硬边界。')
  }
  if ((action === 'polish' || action === 'rewrite') && (
    outputLength < Math.max(1, Math.floor(sourceLength * 0.35))
    || outputLength > Math.max(sourceLength * 3, sourceLength + 500)
  )) throw new Error('润色或改写结果超出原文字数的保真边界。')
  return output
}

function contract(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  chapterId: number
  action: SelectionEditActionV1
}) {
  const mode = modeFor(input.action)
  const skill = getAgentSkillV1(mode === 'edit' ? 'prose.selection-edit' : 'prose.selection-check', 'prose')
  const criterionPrefix = mode === 'edit' ? 'selection-edit' : 'selection-check'
  return {
    version: 1 as const,
    objective: mode === 'edit'
      ? `对当前章节冻结选区执行 ${input.action}，等待作者确认后精确替换`
      : '检查当前章节冻结选区并生成只读报告',
    workflowKind: 'plan-execute' as const,
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: input.worldGroupId,
      chapterIds: [input.chapterId],
    },
    permissions: {
      contextSourceKeys: [...SOURCE_KEYS],
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table,
        fields: [...target.fields],
        mode: 'author-confirmed' as const,
      })),
    },
    executionBindings: [{ stepId: stepId(input.action), ...createAgentSkillExecutionBindingV1(skill) }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 8_000,
      maxOutputTokens: skill.maxOutputTokens,
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: mode === 'edit' ? [
      { id: `${criterionPrefix}.candidate`, kind: 'output-present' as const, required: true },
      { id: `${criterionPrefix}.author`, kind: 'author-confirmed' as const, required: true },
      { id: `${criterionPrefix}.post-state`, kind: 'post-state-matches' as const, required: true },
    ] : [
      { id: `${criterionPrefix}.report`, kind: 'output-present' as const, required: true },
      { id: `${criterionPrefix}.post-state`, kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: `${criterionPrefix}.terminal`,
      kind: 'terminal' as const,
      verifier: verifierFor(mode),
      criterionIds: mode === 'edit'
        ? [`${criterionPrefix}.candidate`, `${criterionPrefix}.author`, `${criterionPrefix}.post-state`]
        : [`${criterionPrefix}.report`, `${criterionPrefix}.post-state`],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

async function parseCandidate(value: unknown): Promise<SelectionEditCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('局部编辑候选检查点无效。')
  const row = value as Record<string, any>
  const keys = [
    'version', 'kind', 'portable', 'mode', 'projectId', 'workId', 'worldGroupId', 'chapterId', 'action',
    'from', 'to', 'selectedText', 'selectedTextHash', 'sourceTextHash', 'sourceContentHash',
    'contextManifestHash', 'contextInputHash', 'promptModuleKey', 'promptTemplateHash', 'promptHash',
    'outputText', 'outputHash', 'expectedContentHtml', 'expectedContentHash', 'expectedTextHash',
    'expectedWordCount', 'candidateHash',
  ] as const
  assertExactKeys(row, keys, '局部编辑候选')
  if (
    row.version !== 1
    || row.kind !== 'selection-edit-candidate'
    || row.portable !== false
    || !['edit', 'check'].includes(row.mode)
    || !isSelectionEditActionV1(row.action)
    || row.mode !== modeFor(row.action)
    || !Number.isInteger(row.projectId)
    || !Number.isInteger(row.workId)
    || !Number.isInteger(row.chapterId)
    || !Number.isInteger(row.from)
    || !Number.isInteger(row.to)
    || row.from < 1
    || row.to <= row.from
    || typeof row.selectedText !== 'string'
    || typeof row.promptModuleKey !== 'string'
    || typeof row.outputText !== 'string'
    || ![
      row.selectedTextHash, row.sourceTextHash, row.sourceContentHash, row.contextManifestHash,
      row.contextInputHash, row.promptTemplateHash, row.promptHash, row.outputHash, row.candidateHash,
    ].every(isHash)
  ) throw new Error('局部编辑候选检查点不完整。')
  if (row.mode === 'edit') {
    if (
      typeof row.expectedContentHtml !== 'string'
      || !isHash(row.expectedContentHash)
      || !isHash(row.expectedTextHash)
      || !Number.isInteger(row.expectedWordCount)
      || row.expectedWordCount < 0
    ) throw new Error('局部编辑候选缺少正式正文意图。')
  } else if (
    row.expectedContentHtml !== null
    || row.expectedContentHash !== null
    || row.expectedTextHash !== null
    || row.expectedWordCount !== null
  ) throw new Error('只读查漏候选不得包含正文写入意图。')
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('局部编辑候选 hash 不匹配。')
  if (
    await sha256Text(row.selectedText) !== row.selectedTextHash
    || await hashCanonicalValue({ outputText: row.outputText }) !== row.outputHash
    || row.promptModuleKey !== selectionPromptModuleKeyV1(row.action)
  ) throw new Error('局部编辑候选内部证据不一致。')
  if (row.mode === 'edit' && (
    await exactContentHash(row.expectedContentHtml) !== row.expectedContentHash
    || await hashChapterText(row.expectedContentHtml) !== row.expectedTextHash
    || countWords(htmlToPlainText(row.expectedContentHtml)) !== row.expectedWordCount
  )) throw new Error('局部编辑候选正式正文证据不一致。')
  return row as SelectionEditCandidateV1
}

async function parseState(value: unknown): Promise<{
  candidate: SelectionEditCandidateV1
  intent: SelectionEditAdoptionIntentV1 | null
}> {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'selection-edit-adoption-intent') {
    const row = value as Record<string, any>
    assertExactKeys(row, ['version', 'kind', 'portable', 'candidate', 'intentHash'], '局部编辑采纳意图')
    if (row.version !== 1 || row.portable !== false || !isHash(row.intentHash)) {
      throw new Error('局部编辑采纳意图检查点无效。')
    }
    const candidate = await parseCandidate(row.candidate)
    if (candidate.mode !== 'edit') throw new Error('只读查漏报告不能生成采纳意图。')
    const body = {
      version: 1 as const,
      kind: 'selection-edit-adoption-intent' as const,
      portable: false as const,
      candidate,
    }
    if (await hashCanonicalValue(body) !== row.intentHash) throw new Error('局部编辑采纳意图 hash 不匹配。')
    return { candidate, intent: row as SelectionEditAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function latestState(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('局部编辑运行缺少可验证检查点。')
  return parseState(checkpoint.resumePayload)
}

function assertCandidateTarget(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: SelectionEditCandidateV1,
): void {
  if (
    candidate.projectId !== scope.projectId
    || candidate.workId !== scope.workId
    || snapshot.run.projectId !== scope.projectId
    || snapshot.contract.scope.chapterIds?.length !== 1
    || snapshot.contract.scope.chapterIds[0] !== candidate.chapterId
    || (snapshot.run.worldGroupId ?? null) !== candidate.worldGroupId
  ) throw new Error('局部编辑候选与当前 Work、World 或章节不匹配。')
}

async function currentPromptIsFresh(candidate: SelectionEditCandidateV1): Promise<boolean> {
  const evidence = await promptEvidence(candidate.action, candidate.selectedText)
  return evidence.promptTemplateHash === candidate.promptTemplateHash && evidence.promptHash === candidate.promptHash
}

async function currentContentState(scope: WorkspaceScope, candidate: SelectionEditCandidateV1) {
  const chapter = await readChapter(scope, candidate.chapterId)
  return {
    chapter,
    sourceMatches: await exactContentHash(chapter.content ?? '') === candidate.sourceContentHash,
    expectedMatches: candidate.expectedContentHash != null
      && await exactContentHash(chapter.content ?? '') === candidate.expectedContentHash,
  }
}

async function pauseUnsafeRun(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, reason: string) {
  if (snapshot.projection.state === 'running' || snapshot.projection.state === 'awaiting_confirmation') {
    return append(scope, snapshot, 'run.paused', { reason, recoverable: false })
  }
  return snapshot
}

async function finalizeCheck(input: {
  scope: WorkspaceScope
  snapshot: AgentRunSnapshotV1
  candidate: SelectionEditCandidateV1
  onDurableBoundary?: (boundary: SelectionEditBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<AgentRunSnapshotV1> {
  let snapshot = input.snapshot
  const id = SELECTION_CHECK_STEP_ID_V1
  if (!await currentPromptIsFresh(input.candidate)) {
    await pauseUnsafeRun(input.scope, snapshot, 'selection-check-prompt-stale')
    throw new Error('局部查漏 Prompt 已变化，旧报告不能签发当前回执。')
  }
  const state = await currentContentState(input.scope, input.candidate)
  if (!state.sourceMatches) {
    await pauseUnsafeRun(input.scope, snapshot, 'selection-check-source-stale')
    throw new Error('章节正文已变化，旧查漏报告不能签发当前回执。')
  }
  if (snapshot.projection.steps[id]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: id,
      attempt: 1,
      outputHash: input.candidate.outputHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: SELECTION_CHECK_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  const postStateHash = await hashCanonicalValue({
    chapterId: input.candidate.chapterId,
    sourceContentHash: input.candidate.sourceContentHash,
    reportHash: input.candidate.outputHash,
  })
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [input.candidate.contextManifestHash],
    candidateHashes: [input.candidate.candidateHash],
    adoptionEventIds: [],
    postStateHash,
    verifierSetVersion: SELECTION_CHECK_VERIFIER_SET_V1,
    criteria: [
      { id: 'selection-check.report', status: 'passed', evidenceRefs: [`report:${input.candidate.outputHash}`] },
      { id: 'selection-check.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return snapshot
}

/** One model call. The selected text is the only model-visible context. */
export async function generateSelectionEditCandidateV1(input: {
  scope: WorkspaceScope
  worldGroupId: number | null
  chapterId: number
  action: SelectionEditActionV1
  selection: SelectionSnapshotV1
  previewReplacement?: PreviewReplacement
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: SelectionEditBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: SelectionEditCandidateV1 }> {
  validateSelection(input.selection)
  if (!isSelectionEditActionV1(input.action)) throw new Error('未知的局部编辑动作。')
  if (input.action !== 'check' && !input.previewReplacement) throw new Error('局部编辑缺少富文本范围预演器。')
  const chapter = await readChapter(input.scope, input.chapterId)
  if (chapter.content !== input.selection.sourceHtml) throw new Error('编辑器正文尚未保存或已变化，请保存后重新选择。')
  const workId = input.scope.workId
  if (!Number.isInteger(workId)) throw new Error('局部编辑需要明确的 Work 作用域。')
  const id = stepId(input.action)
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    contract: contract({
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      chapterId: input.chapterId,
      action: input.action,
    }),
  })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: id })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: id, attempt: 1 })

  const assembled = await assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    worldGroupId: input.worldGroupId,
    chapterId: input.chapterId,
    sourceKeys: [...SOURCE_KEYS],
    manualSourceText: input.selection.text,
    inputBudgetMaxTokens: 8_000,
  })
  if (assembled.included.length !== 1 || assembled.included[0] !== 'manualText' || assembled.text !== input.selection.text) {
    throw new Error('局部编辑必须且只能完整读取冻结选中文字。')
  }
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: id,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: input.worldGroupId,
    declaredSourceKeys: [...SOURCE_KEYS],
    assembled,
    boundary: { chapterId: input.chapterId },
    readerVersion: 'selection-edit-manual-text-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: id,
    attempt: 1,
    manifestHash: manifest.manifestHash,
  })
  const prompt = await promptEvidence(input.action, assembled.text)
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: id,
    attempt: 1,
    bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]),
  })
  let raw: string
  try {
    await input.onDurableBoundary?.('model.requested', snapshot)
    raw = await (input.runAI
      ? input.runAI(prompt.messages)
      : chat(prompt.messages, input.aiConfig!, {
          category: 'chapter.toolbar',
          projectId: input.scope.projectId,
          contextOverflowPolicy: 'reject',
        }))
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'selection-edit-model-outcome-unknown')
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', {
    stepId: id,
    attempt: 1,
    outputHash: await hashCanonicalValue({ raw }),
  })
  try {
    await input.onDurableBoundary?.('model.responded', snapshot)
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'selection-edit-model-result-uncheckpointed')
    throw error
  }

  let outputText: string
  let expectedContentHtml: string | null = null
  try {
    outputText = parseSelectionModelOutputV1(input.action, input.selection.text, raw)
    if (input.action !== 'check') {
      expectedContentHtml = await input.previewReplacement!({ selection: input.selection, outputText })
      if (!expectedContentHtml?.trim() || expectedContentHtml === input.selection.sourceHtml) {
        throw new Error('局部编辑范围预演没有产生有效正文变化。')
      }
      if (!normalizeChapterText(expectedContentHtml).includes(normalizeChapterText(outputText))) {
        throw new Error('局部编辑范围预演未包含模型输出。')
      }
      assertPlainReplacementOnly(input.selection, outputText, expectedContentHtml)
    }
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: id,
      attempt: 1,
      code: 'selection-edit-protocol-failed',
      retryable: false,
      category: 'protocol',
      action: 'fail',
    })
    await append(input.scope, snapshot, 'run.failed', { code: 'selection-edit-protocol-failed', retryable: false })
    throw error
  }

  const sourceTextHash = await hashChapterText(input.selection.sourceHtml)
  const expectedTextHash = expectedContentHtml == null ? null : await hashChapterText(expectedContentHtml)
  const body = {
    version: 1 as const,
    kind: 'selection-edit-candidate' as const,
    portable: false as const,
    mode: modeFor(input.action),
    projectId: input.scope.projectId,
    workId: workId!,
    worldGroupId: input.worldGroupId,
    chapterId: input.chapterId,
    action: input.action,
    from: input.selection.from,
    to: input.selection.to,
    selectedText: input.selection.text,
    selectedTextHash: await sha256Text(input.selection.text),
    sourceTextHash,
    sourceContentHash: await exactContentHash(input.selection.sourceHtml),
    contextManifestHash: manifest.manifestHash,
    contextInputHash: await hashCanonicalValue({ text: assembled.text, sourceEvidence: assembled.sourceEvidence }),
    promptModuleKey: selectionPromptModuleKeyV1(input.action),
    promptTemplateHash: prompt.promptTemplateHash,
    promptHash: prompt.promptHash,
    outputText,
    outputHash: await hashCanonicalValue({ outputText }),
    expectedContentHtml,
    expectedContentHash: expectedContentHtml == null ? null : await exactContentHash(expectedContentHtml),
    expectedTextHash,
    expectedWordCount: expectedContentHtml == null ? null : countWords(htmlToPlainText(expectedContentHtml)),
  }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
  const checkpoint = await createAgentRunCheckpointV1({
    scope: input.scope,
    runId: snapshot.run.id,
    resumePayload: candidate,
  })
  snapshot = checkpoint.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: id,
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
  candidate: SelectionEditCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const id = stepId(candidate.action)
  const step = snapshot.projection.steps[id]
  if (step?.candidateHash) return snapshot
  if (step?.status !== 'running') throw new Error('局部编辑候选事件无法安全重建。')
  return append(scope, snapshot, 'candidate.persisted', {
    stepId: id,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
}

/** Recover a safe candidate checkpoint; no model call is repeated. */
export async function readPendingSelectionEditCandidateV1(input: {
  scope: WorkspaceScope
  chapterId: number
  worldGroupId: number | null
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: SelectionEditCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      ['awaiting_confirmation', 'running', 'verifying'].includes(row.status)
      && (row.worldGroupId ?? null) === input.worldGroupId
      && row.contractJson?.includes('prose.selection-')
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const state = await latestState(input.scope, row.id)
      assertCandidateTarget(input.scope, snapshot, state.candidate)
      if (state.candidate.chapterId !== input.chapterId) continue
      snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, state.candidate)
      return { snapshot, candidate: state.candidate }
    } catch {
      // Damaged or unsafe historical runs remain auditable but are not candidates.
    }
  }
  return null
}

/** Author acknowledges a read-only report; no business table is written. */
export async function acknowledgeSelectionCheckReportV1(input: {
  scope: WorkspaceScope
  runId: number
  onDurableBoundary?: (boundary: SelectionEditBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: SelectionEditCandidateV1; receiptHash: string }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate } = await latestState(input.scope, input.runId)
  assertCandidateTarget(input.scope, snapshot, candidate)
  if (candidate.mode !== 'check') throw new Error('正文编辑候选不能作为只读查漏报告关闭。')
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash) {
    return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  }
  if (snapshot.projection.state !== 'awaiting_confirmation') throw new Error('局部查漏报告不在等待确认状态。')
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: SELECTION_CHECK_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    decision: 'adopt',
  })
  await input.onDurableBoundary?.('confirmation.recorded', snapshot)
  snapshot = await finalizeCheck({ ...input, snapshot, candidate })
  return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash! }
}

export async function readRecoverableSelectionEditRunV1(input: {
  scope: WorkspaceScope
  chapterId: number
  worldGroupId: number | null
}): Promise<{ snapshot: AgentRunSnapshotV1; safeToResume: boolean } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      ['running', 'paused'].includes(row.status)
      && (row.worldGroupId ?? null) === input.worldGroupId
      && row.contractJson?.includes('prose.selection-')
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    const snapshot = await readAgentRunV1(input.scope, row.id)
    if (snapshot.contract.scope.chapterIds?.[0] !== input.chapterId) continue
    try {
      const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, row.id)
      if (checkpoint) {
        await parseState(checkpoint.resumePayload)
        return { snapshot, safeToResume: true }
      }
    } catch {
      // Fall through to conservative unsafe result.
    }
    return { snapshot, safeToResume: false }
  }
  return null
}

async function assertFreshBeforeWrite(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: SelectionEditCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const state = await currentContentState(scope, candidate)
  if (state.sourceMatches && await currentPromptIsFresh(candidate)) return snapshot
  const next = await append(scope, snapshot, 'candidate.staled', {
    stepId: SELECTION_EDIT_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    reason: state.sourceMatches ? 'selection-edit-prompt-changed' : 'selection-edit-source-changed',
  })
  throw Object.assign(new Error(state.sourceMatches
    ? '局部编辑 Prompt 已变化，请重新生成。'
    : '章节正文或格式已变化，请重新选择并生成。'), { snapshot: next })
}

export async function adoptSelectionEditCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  onDurableBoundary?: (boundary: SelectionEditBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{
  snapshot: AgentRunSnapshotV1
  candidate: SelectionEditCandidateV1
  receiptHash: string
  demotedFacts: number
}> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate
  let intent = state.intent
  assertCandidateTarget(input.scope, snapshot, candidate)
  if (candidate.mode !== 'edit' || candidate.expectedContentHtml == null || candidate.expectedContentHash == null
    || candidate.expectedTextHash == null || candidate.expectedWordCount == null) {
    throw new Error('只读查漏报告不能采纳为正文。')
  }
  const completedState = await currentContentState(input.scope, candidate)
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    if (!completedState.expectedMatches || !await currentPromptIsFresh(candidate)) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope,
        runId: snapshot.run.id,
        reason: completedState.expectedMatches
          ? 'selection-edit-prompt-changed-after-verification'
          : 'selection-edit-content-changed-after-verification',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: SELECTION_EDIT_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'selection-edit-terminal-evidence-stale',
      })
      throw new Error('局部编辑完成回执已过期；正文或 Prompt 在终验后发生变化。')
    }
    return {
      snapshot,
      candidate,
      receiptHash: snapshot.projection.terminalReceiptHash,
      demotedFacts: 0,
    }
  }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    snapshot = await assertFreshBeforeWrite(input.scope, snapshot, candidate)
    if (!intent) {
      const body = {
        version: 1 as const,
        kind: 'selection-edit-adoption-intent' as const,
        portable: false as const,
        candidate,
      }
      intent = { ...body, intentHash: await hashCanonicalValue(body) }
      const saved = await createAgentRunCheckpointV1({
        scope: input.scope,
        runId: snapshot.run.id,
        resumePayload: intent,
      })
      snapshot = saved.snapshot
      await input.onDurableBoundary?.('intent.checkpoint', snapshot)
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: SELECTION_EDIT_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: SELECTION_EDIT_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  } else if (snapshot.projection.steps[SELECTION_EDIT_STEP_ID_V1]?.confirmation !== 'adopt' || !intent) {
    throw new Error('局部编辑候选不在可恢复采纳状态。')
  }

  let adoptionHash = snapshot.projection.steps[SELECTION_EDIT_STEP_ID_V1]?.adoptionHash
  let demotedFacts = 0
  let current = await currentContentState(input.scope, candidate)
  if (!adoptionHash) {
    if (!current.expectedMatches) {
      snapshot = await assertFreshBeforeWrite(input.scope, snapshot, candidate)
      const result = await adopt({
        projectId: input.scope.projectId,
        scope: input.scope,
        target: 'chapters',
        recordId: candidate.chapterId,
        mode: 'replace',
        data: {
          content: candidate.expectedContentHtml,
          wordCount: candidate.expectedWordCount,
        },
        compareAndSet: {
          kind: 'chapter-source-text-hash',
          expectedHash: candidate.sourceTextHash,
          expectedContentHash: candidate.sourceContentHash,
          textNormalizationVersion: CHAPTER_TEXT_NORMALIZATION_VERSION,
        },
      })
      if (!result.written.some(row => row.id === candidate.chapterId && row.fields.includes('content'))) {
        throw new Error(result.skipped[0]?.reason ?? '局部编辑候选未写入章节。')
      }
      current = await currentContentState(input.scope, candidate)
    }
    if (!current.expectedMatches) {
      await pauseUnsafeRun(input.scope, snapshot, 'selection-edit-formal-state-diverged')
      throw new Error('局部编辑正式正文与冻结意图不一致。')
    }
    demotedFacts = (await propagateChapterEditStale(input.scope, candidate.chapterId)).demotedFacts
    await input.onDurableBoundary?.('formal.written', snapshot)
    adoptionHash = await hashCanonicalValue({
      intentHash: intent.intentHash,
      chapterId: candidate.chapterId,
      expectedContentHash: candidate.expectedContentHash,
      expectedWordCount: candidate.expectedWordCount,
    })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: SELECTION_EDIT_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  current = await currentContentState(input.scope, candidate)
  if (!current.expectedMatches || !await currentPromptIsFresh(candidate)) {
    await pauseUnsafeRun(input.scope, snapshot, 'selection-edit-terminal-evidence-stale')
    throw new Error('正式写入后正文或 Prompt 发生变化，本次回执不会通过终验。')
  }
  if (await hashChapterText(current.chapter.content ?? '') !== candidate.expectedTextHash
    || current.chapter.wordCount !== candidate.expectedWordCount) {
    await pauseUnsafeRun(input.scope, snapshot, 'selection-edit-post-state-mismatch')
    throw new Error('局部编辑正文文本或字数与冻结意图不一致。')
  }
  if (snapshot.projection.steps[SELECTION_EDIT_STEP_ID_V1]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: SELECTION_EDIT_STEP_ID_V1,
      attempt: 1,
      outputHash: adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: SELECTION_EDIT_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  const postStateHash = await hashCanonicalValue({
    chapterId: candidate.chapterId,
    contentHash: candidate.expectedContentHash,
    textHash: candidate.expectedTextHash,
    wordCount: candidate.expectedWordCount,
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
    verifierSetVersion: SELECTION_EDIT_VERIFIER_SET_V1,
    criteria: [
      { id: 'selection-edit.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'selection-edit.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'selection-edit.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, candidate, receiptHash: receipt.receiptHash, demotedFacts }
}

export async function rejectSelectionEditCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate } = await latestState(input.scope, input.runId)
  assertCandidateTarget(input.scope, snapshot, candidate)
  if (candidate.mode !== 'edit' || snapshot.projection.state !== 'awaiting_confirmation') {
    throw new Error('局部编辑候选不在等待确认状态。')
  }
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: SELECTION_EDIT_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-selection-edit' })
}

export async function abandonSelectionEditRunV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(snapshot.projection.state)) {
    throw new Error('局部编辑运行不在可放弃状态。')
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-selection-edit' })
}
