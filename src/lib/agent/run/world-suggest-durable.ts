import { chat } from '../../ai/client'
import {
  buildWorldSuggestPromptFromRegisteredContextV1,
  parseWorldSuggestOutputStrictV1,
  readWorldSuggestPromptTemplateSnapshotV1,
  type SuggestedWorld,
} from '../../ai/world-group-ai'
import { db } from '../../db/schema'
import { adopt } from '../../registry/adopt'
import { assembleContext } from '../../registry/assemble-context'
import type { AIConfig, ChatMessage, Project, WorkspaceScope, WorldGroup, WorldGroupLink } from '../../types'
import { readOwnedRows, scopeTransactionTables } from '../../workspace/scope'
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

export const WORLD_SUGGEST_STEP_ID_V1 = 'world-origin:world-suggest' as const
export const WORLD_SUGGEST_VERIFIER_SET_V1 = 'world-suggest-terminal-v1' as const
export const WORLD_SUGGEST_CONTEXT_SOURCE_KEYS_V1 = ['manualText', 'worldGroups', 'storyCore'] as const

type RunAI = (messages: ChatMessage[]) => Promise<string>

interface ProjectPromptSnapshotV1 {
  id: number
  name: string
  description: string
  genres: string[]
  enableMultiWorld: boolean
}

interface WorldGroupSnapshotV1 {
  id: number
  projectId: number
  worldId: number | null
  name: string
  description: string
  type: WorldGroup['type']
  icon: string | null
  color: string | null
  order: number
  entryCondition: string | null
  exitCondition: string | null
  plannedChapterCount: number | null
  powerRestriction: string | null
  takeawayRules: string | null
  createdAt: number
  updatedAt: number
}

interface WorldGroupLinkSnapshotV1 {
  id: number
  projectId: number
  worldId: number | null
  fromGroupId: number
  toGroupId: number
  linkType: WorldGroupLink['linkType']
  name: string | null
  description: string | null
  bidirectional: boolean
  createdAt: number
}

interface StoryCoreSnapshotV1 {
  id: number
  fields: Record<string, unknown>
}

export interface WorldSuggestFormalItemV1 {
  name: string
  type: SuggestedWorld['type']
  description: string
  icon: string
  color: string | null
  order: number
  entryCondition: string
  exitCondition: string | null
  powerRestriction: string
  takeawayRules: string | null
  plannedChapterCount: number
}

export interface WorldSuggestCandidateV1 {
  version: 1
  kind: 'world-suggest-candidate'
  portable: false
  projectId: number
  worldId: number
  workId: number
  authorConcept: string
  projectSnapshot: ProjectPromptSnapshotV1
  projectHash: string
  worldGroupsBaseline: WorldGroupSnapshotV1[]
  worldGroupsBaselineHash: string
  worldGroupLinksBaseline: WorldGroupLinkSnapshotV1[]
  worldGroupLinksBaselineHash: string
  storyCoreBaseline: StoryCoreSnapshotV1[]
  storyCoreBaselineHash: string
  contextManifestHash: string
  contextInputHash: string
  storyContextInputHash: string
  promptTemplateHash: string
  promptHash: string
  modelOutputHash: string
  worlds: SuggestedWorld[]
  worldsHash: string
  candidateHash: string
}

interface WorldSuggestAdoptionIntentV1 {
  version: 1
  kind: 'world-suggest-adoption-intent'
  portable: false
  candidate: WorldSuggestCandidateV1
  selectedIndexes: number[]
  formalItems: WorldSuggestFormalItemV1[]
  formalItemsHash: string
  intentHash: string
}

export type WorldSuggestBoundaryV1 =
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

function projectSnapshot(project: Project & { id: number }): ProjectPromptSnapshotV1 {
  return {
    id: project.id,
    name: project.name,
    description: project.description || '',
    genres: [...(project.genres || [])],
    enableMultiWorld: project.enableMultiWorld === true,
  }
}

function worldGroupSnapshot(row: WorldGroup & { id: number }): WorldGroupSnapshotV1 {
  return {
    id: row.id,
    projectId: row.projectId,
    worldId: typeof (row as any).worldId === 'number' ? (row as any).worldId : null,
    name: row.name,
    description: row.description || '',
    type: row.type,
    icon: row.icon ?? null,
    color: row.color ?? null,
    order: row.order,
    entryCondition: row.entryCondition ?? null,
    exitCondition: row.exitCondition ?? null,
    plannedChapterCount: row.plannedChapterCount ?? null,
    powerRestriction: row.powerRestriction ?? null,
    takeawayRules: row.takeawayRules ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function worldGroupLinkSnapshot(row: WorldGroupLink & { id: number }): WorldGroupLinkSnapshotV1 {
  return {
    id: row.id,
    projectId: row.projectId,
    worldId: typeof (row as any).worldId === 'number' ? (row as any).worldId : null,
    fromGroupId: row.fromGroupId,
    toGroupId: row.toGroupId,
    linkType: row.linkType,
    name: row.name ?? null,
    description: row.description ?? null,
    bidirectional: row.bidirectional,
    createdAt: row.createdAt,
  }
}

const STORY_CORE_META_FIELDS = new Set(['projectId', 'worldId', 'workId', 'createdAt', 'updatedAt'])

function storyCoreSnapshot(row: Record<string, unknown> & { id: number }): StoryCoreSnapshotV1 {
  const fields = Object.fromEntries(
    Object.keys(row)
      .filter(key => key !== 'id' && !STORY_CORE_META_FIELDS.has(key))
      .sort()
      .map(key => [key, row[key]]),
  )
  return { id: row.id, fields }
}

function formalItemSnapshot(row: WorldGroup): WorldSuggestFormalItemV1 {
  return {
    name: row.name,
    type: row.type,
    description: row.description || '',
    icon: row.icon ?? '',
    color: row.color ?? null,
    order: row.order,
    entryCondition: row.entryCondition ?? '',
    exitCondition: row.exitCondition ?? null,
    powerRestriction: row.powerRestriction ?? '',
    takeawayRules: row.takeawayRules ?? null,
    plannedChapterCount: row.plannedChapterCount ?? 0,
  }
}

async function readBaseline(scope: WorkspaceScope): Promise<{
  project: ProjectPromptSnapshotV1
  groups: WorldGroupSnapshotV1[]
  links: WorldGroupLinkSnapshotV1[]
  storyCores: StoryCoreSnapshotV1[]
}> {
  const project = await db.projects.get(scope.projectId)
  if (!project?.id) throw new Error('世界建议目标项目不存在。')
  const [groups, links, storyCores] = await Promise.all([
    readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' }),
    readOwnedRows<WorldGroupLink>(scope, 'worldGroupLinks', { owner: 'world' }),
    readOwnedRows<Record<string, unknown>>(scope, 'storyCores', { owner: 'work' }),
  ])
  return {
    project: projectSnapshot(project as Project & { id: number }),
    groups: groups
      .filter((row): row is WorldGroup & { id: number } => typeof row.id === 'number')
      .sort((left, right) => left.order - right.order || left.id - right.id)
      .map(worldGroupSnapshot),
    links: links
      .filter((row): row is WorldGroupLink & { id: number } => typeof row.id === 'number')
      .sort((left, right) => left.id - right.id)
      .map(worldGroupLinkSnapshot),
    storyCores: storyCores
      .filter((row): row is Record<string, unknown> & { id: number } => typeof row.id === 'number')
      .sort((left, right) => left.id - right.id)
      .map(storyCoreSnapshot),
  }
}

function manualRequest(project: ProjectPromptSnapshotV1, authorConcept: string): string {
  return [
    '【作者本轮世界规划】',
    `作品：${project.name}`,
    `题材：${project.genres.join('、') || '未设置'}`,
    `项目简介：${project.description || '未设置'}`,
    `本轮概念：${authorConcept || project.description || '请根据当前作品资料建议差异化的新世界'}`,
  ].join('\n')
}

async function assembleWorldSuggestContext(
  scope: WorkspaceScope,
  project: ProjectPromptSnapshotV1,
  authorConcept: string,
  sourceKeys: readonly string[] = WORLD_SUGGEST_CONTEXT_SOURCE_KEYS_V1,
) {
  return assembleContext({
    projectId: scope.projectId,
    scope,
    sourceKeys: [...sourceKeys],
    manualSourceText: manualRequest(project, authorConcept),
    inputBudgetTokens: 24_000,
  })
}

async function assemblyHash(assembled: Awaited<ReturnType<typeof assembleWorldSuggestContext>>) {
  return hashCanonicalValue({ text: assembled.text, sourceEvidence: assembled.sourceEvidence })
}

async function promptEvidence(contextText: string) {
  const messages = buildWorldSuggestPromptFromRegisteredContextV1(contextText)
  return {
    messages,
    promptTemplateHash: await hashCanonicalValue(readWorldSuggestPromptTemplateSnapshotV1()),
    promptHash: await hashCanonicalValue(messages),
  }
}

function contract(scope: WorkspaceScope) {
  const skill = getAgentSkillV1('world-origin.world-suggest', 'world-origin')
  return {
    version: 1 as const,
    objective: '根据当前 Work 的作品概念与当前 World 目录生成可选择的新世界建议',
    workflowKind: 'plan-execute' as const,
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: {
      contextSourceKeys: [...WORLD_SUGGEST_CONTEXT_SOURCE_KEYS_V1],
      writeTargets: skill.writeTargets.map(target => ({
        table: target.table,
        fields: [...target.fields],
        mode: 'author-confirmed' as const,
      })),
    },
    executionBindings: [{ stepId: WORLD_SUGGEST_STEP_ID_V1, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 24_000,
      maxOutputTokens: skill.maxOutputTokens,
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: 'world-suggest.candidate', kind: 'output-present' as const, required: true },
      { id: 'world-suggest.author', kind: 'author-confirmed' as const, required: true },
      { id: 'world-suggest.post-state', kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: 'world-suggest.terminal',
      kind: 'terminal' as const,
      verifier: WORLD_SUGGEST_VERIFIER_SET_V1,
      criterionIds: ['world-suggest.candidate', 'world-suggest.author', 'world-suggest.post-state'],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

function isWorldSuggestContract(contractJson: unknown): boolean {
  return typeof contractJson === 'string' && contractJson.includes('world-origin.world-suggest')
}

function assertCandidateTarget(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, candidate: WorldSuggestCandidateV1): void {
  if (
    candidate.projectId !== scope.projectId
    || candidate.worldId !== scope.worldId
    || candidate.workId !== scope.workId
    || snapshot.run.projectId !== scope.projectId
    || (snapshot.run.worldGroupId ?? null) !== null
  ) throw new Error('世界建议候选与当前 World 或 Work 不匹配。')
}

function parseFormalItems(value: unknown): WorldSuggestFormalItemV1[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) throw new Error('世界建议正式选择必须包含 1-4 个世界。')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`世界建议正式选择第 ${index + 1} 项无效。`)
    const row = item as Record<string, unknown>
    assertExactKeys(row, [
      'name', 'type', 'description', 'icon', 'color', 'order', 'entryCondition', 'exitCondition',
      'powerRestriction', 'takeawayRules', 'plannedChapterCount',
    ], '世界建议正式选择')
    const parsedInput = {
      name: row.name,
      type: row.type,
      description: row.description,
      entryCondition: row.entryCondition,
      powerRestriction: row.powerRestriction,
      plannedChapterCount: row.plannedChapterCount,
    }
    let placeholderName = `__world_suggest_validation_${index}__`
    while (placeholderName === row.name) placeholderName = `${placeholderName}_reserved`
    const parsed = parseWorldSuggestOutputStrictV1(JSON.stringify([parsedInput, {
      name: placeholderName,
      type: 'custom',
      description: '仅用于复用严格字段校验。',
      entryCondition: '由作者明确触发。',
      powerRestriction: '遵守当前世界规则。',
      plannedChapterCount: 1,
    }]))[0]
    if (row.icon !== '🌐' || row.color !== null || row.exitCondition !== null || row.takeawayRules !== null || !Number.isInteger(row.order)) {
      throw new Error('世界建议正式选择包含未冻结字段。')
    }
    return { ...parsed, icon: '🌐', color: null, order: Number(row.order), exitCondition: null, takeawayRules: null }
  })
}

async function parseCandidate(value: unknown): Promise<WorldSuggestCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('世界建议候选检查点无效。')
  const row = value as Record<string, any>
  const keys = [
    'version', 'kind', 'portable', 'projectId', 'worldId', 'workId', 'authorConcept',
    'projectSnapshot', 'projectHash', 'worldGroupsBaseline', 'worldGroupsBaselineHash',
    'worldGroupLinksBaseline', 'worldGroupLinksBaselineHash', 'storyCoreBaseline', 'storyCoreBaselineHash',
    'contextManifestHash', 'contextInputHash', 'storyContextInputHash', 'promptTemplateHash',
    'promptHash', 'modelOutputHash', 'worlds', 'worldsHash', 'candidateHash',
  ] as const
  assertExactKeys(row, keys, '世界建议候选')
  if (
    row.version !== 1
    || row.kind !== 'world-suggest-candidate'
    || row.portable !== false
    || ![row.projectId, row.worldId, row.workId].every(Number.isInteger)
    || typeof row.authorConcept !== 'string'
    || ![
      row.projectHash, row.worldGroupsBaselineHash, row.worldGroupLinksBaselineHash, row.storyCoreBaselineHash,
      row.contextManifestHash, row.contextInputHash, row.storyContextInputHash, row.promptTemplateHash,
      row.promptHash, row.modelOutputHash, row.worldsHash, row.candidateHash,
    ].every(isHash)
  ) throw new Error('世界建议候选检查点不完整。')
  const worlds = parseWorldSuggestOutputStrictV1(JSON.stringify(row.worlds))
  if (canonicalStringify(worlds) !== canonicalStringify(row.worlds)) throw new Error('世界建议候选未规范化。')
  if (await hashCanonicalValue(worlds) !== row.worldsHash) throw new Error('世界建议候选值 hash 不匹配。')
  if (await hashCanonicalValue(row.projectSnapshot) !== row.projectHash) throw new Error('世界建议项目快照 hash 不匹配。')
  if (await hashCanonicalValue(row.worldGroupsBaseline) !== row.worldGroupsBaselineHash) throw new Error('世界建议世界组 baseline hash 不匹配。')
  if (await hashCanonicalValue(row.worldGroupLinksBaseline) !== row.worldGroupLinksBaselineHash) throw new Error('世界建议关系 baseline hash 不匹配。')
  if (await hashCanonicalValue(row.storyCoreBaseline) !== row.storyCoreBaselineHash) throw new Error('世界建议故事核心 baseline hash 不匹配。')
  const { candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== candidateHash) throw new Error('世界建议候选 hash 不匹配。')
  return row as WorldSuggestCandidateV1
}

async function parseState(value: unknown): Promise<{
  candidate: WorldSuggestCandidateV1
  intent: WorldSuggestAdoptionIntentV1 | null
}> {
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).kind === 'world-suggest-adoption-intent') {
    const row = value as Record<string, any>
    assertExactKeys(row, [
      'version', 'kind', 'portable', 'candidate', 'selectedIndexes', 'formalItems', 'formalItemsHash', 'intentHash',
    ], '世界建议采纳意图')
    if (
      row.version !== 1 || row.portable !== false || !isHash(row.formalItemsHash) || !isHash(row.intentHash)
      || !Array.isArray(row.selectedIndexes) || row.selectedIndexes.some((index: unknown) => !Number.isInteger(index))
    ) throw new Error('世界建议采纳意图无效。')
    const candidate = await parseCandidate(row.candidate)
    const selectedIndexes = [...row.selectedIndexes]
    if (
      selectedIndexes.length < 1
      || selectedIndexes.length > candidate.worlds.length
      || new Set(selectedIndexes).size !== selectedIndexes.length
      || selectedIndexes.some((index: number) => index < 0 || index >= candidate.worlds.length)
      || selectedIndexes.some((index: number, position: number) => position > 0 && selectedIndexes[position - 1] >= index)
    ) throw new Error('世界建议采纳索引无效。')
    const formalItems = parseFormalItems(row.formalItems)
    if (formalItems.length !== selectedIndexes.length || await hashCanonicalValue(formalItems) !== row.formalItemsHash) {
      throw new Error('世界建议正式选择 hash 不匹配。')
    }
    for (let position = 0; position < selectedIndexes.length; position += 1) {
      const source = candidate.worlds[selectedIndexes[position]]
      const target = formalItems[position]
      if (canonicalStringify(source) !== canonicalStringify({
        name: target.name,
        type: target.type,
        description: target.description,
        entryCondition: target.entryCondition,
        powerRestriction: target.powerRestriction,
        plannedChapterCount: target.plannedChapterCount,
      })) throw new Error('世界建议正式选择与候选不一致。')
    }
    const body = {
      version: 1 as const,
      kind: 'world-suggest-adoption-intent' as const,
      portable: false as const,
      candidate,
      selectedIndexes,
      formalItems,
      formalItemsHash: row.formalItemsHash,
    }
    if (await hashCanonicalValue(body) !== row.intentHash) throw new Error('世界建议采纳意图 hash 不匹配。')
    return { candidate, intent: row as WorldSuggestAdoptionIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function latestState(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('世界建议运行缺少可验证检查点。')
  return parseState(checkpoint.resumePayload)
}

function buildFormalItems(candidate: WorldSuggestCandidateV1, selectedIndexes: readonly number[]): WorldSuggestFormalItemV1[] {
  const nextOrder = candidate.worldGroupsBaseline.reduce((max, row) => Math.max(max, row.order), -1) + 1
  return selectedIndexes.map((index, position) => ({
    ...candidate.worlds[index],
    icon: '🌐' as const,
    color: null,
    order: nextOrder + position,
    exitCondition: null,
    takeawayRules: null,
  }))
}

async function currentEvidence(scope: WorkspaceScope, candidate: WorldSuggestCandidateV1, intent?: WorldSuggestAdoptionIntentV1 | null) {
  const baseline = await readBaseline(scope)
  const assembled = await assembleWorldSuggestContext(scope, baseline.project, candidate.authorConcept)
  const storyOnly = await assembleWorldSuggestContext(scope, baseline.project, candidate.authorConcept, ['storyCore'])
  const prompt = await promptEvidence(assembled.text)
  const oldIds = new Set(candidate.worldGroupsBaseline.map(row => row.id))
  const oldRows = baseline.groups.filter(row => oldIds.has(row.id))
  const newRows = baseline.groups.filter(row => !oldIds.has(row.id))
  const expectedMatches = !!intent
    && canonicalStringify(oldRows) === canonicalStringify(candidate.worldGroupsBaseline)
    && newRows.length === intent.formalItems.length
    && intent.formalItems.every(item => {
      const row = newRows.find(candidateRow => candidateRow.name === item.name)
      return !!row && canonicalStringify(formalItemSnapshot(row as unknown as WorldGroup)) === canonicalStringify(item)
    })
  return {
    projectFresh: canonicalStringify(baseline.project) === canonicalStringify(candidate.projectSnapshot),
    groupsFresh: canonicalStringify(baseline.groups) === canonicalStringify(candidate.worldGroupsBaseline),
    linksFresh: canonicalStringify(baseline.links) === canonicalStringify(candidate.worldGroupLinksBaseline),
    storyFresh: canonicalStringify(baseline.storyCores) === canonicalStringify(candidate.storyCoreBaseline),
    inputFresh: await assemblyHash(assembled) === candidate.contextInputHash,
    storyContextFresh: await assemblyHash(storyOnly) === candidate.storyContextInputHash,
    promptFresh: prompt.promptHash === candidate.promptHash,
    templateFresh: prompt.promptTemplateHash === candidate.promptTemplateHash,
    expectedMatches,
  }
}

async function pauseUnsafeRun(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, reason: string) {
  if (snapshot.projection.state === 'running' || snapshot.projection.state === 'awaiting_confirmation') {
    return append(scope, snapshot, 'run.paused', { reason, recoverable: false })
  }
  return snapshot
}

async function assertFreshBeforeWrite(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  candidate: WorldSuggestCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const evidence = await currentEvidence(scope, candidate)
  if (
    evidence.projectFresh && evidence.groupsFresh && evidence.linksFresh && evidence.storyFresh
    && evidence.inputFresh && evidence.promptFresh && evidence.templateFresh
  ) return snapshot
  const reason = !evidence.projectFresh
    ? 'world-suggest-project-changed'
    : !evidence.groupsFresh
      ? 'world-suggest-world-groups-changed'
      : !evidence.linksFresh
        ? 'world-suggest-links-changed'
        : !evidence.storyFresh
          ? 'world-suggest-story-core-changed'
          : 'world-suggest-context-or-prompt-changed'
  const next = await append(scope, snapshot, 'candidate.staled', {
    stepId: WORLD_SUGGEST_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    reason,
  })
  throw Object.assign(new Error('项目资料、世界目录、关系、故事核心、Context 或 Prompt 已变化，请重新生成。'), { snapshot: next })
}

export async function generateWorldSuggestCandidateV1(input: {
  scope: WorkspaceScope
  authorConcept: string
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: WorldSuggestBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: WorldSuggestCandidateV1 }> {
  if (!input.runAI && !input.aiConfig) throw new Error('世界建议生成缺少 AI 配置。')
  const authorConcept = input.authorConcept.trim()
  const baseline = await readBaseline(input.scope)
  let snapshot = await createAgentRunV1({ scope: input.scope, worldGroupId: null, contract: contract(input.scope) })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: WORLD_SUGGEST_STEP_ID_V1 })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: WORLD_SUGGEST_STEP_ID_V1, attempt: 1 })

  const assembled = await assembleWorldSuggestContext(input.scope, baseline.project, authorConcept)
  const storyOnly = await assembleWorldSuggestContext(input.scope, baseline.project, authorConcept, ['storyCore'])
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: WORLD_SUGGEST_STEP_ID_V1,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: null,
    declaredSourceKeys: [...WORLD_SUGGEST_CONTEXT_SOURCE_KEYS_V1],
    assembled,
    readerVersion: 'world-suggest-context-v1',
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', {
    stepId: WORLD_SUGGEST_STEP_ID_V1,
    attempt: 1,
    manifestHash: manifest.manifestHash,
  })
  const prompt = await promptEvidence(assembled.text)
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: WORLD_SUGGEST_STEP_ID_V1,
    attempt: 1,
    bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]),
  })
  let raw: string
  try {
    await input.onDurableBoundary?.('model.requested', snapshot)
    raw = await (input.runAI
      ? input.runAI(prompt.messages)
      : chat(prompt.messages, input.aiConfig!, {
          category: 'world-group.suggest',
          projectId: input.scope.projectId,
          configOverrides: { maxTokens: getAgentSkillV1('world-origin.world-suggest').maxOutputTokens },
          contextOverflowPolicy: 'reject',
        }))
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'world-suggest-model-outcome-unknown')
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', {
    stepId: WORLD_SUGGEST_STEP_ID_V1,
    attempt: 1,
    outputHash: await hashCanonicalValue({ raw }),
  })
  try {
    await input.onDurableBoundary?.('model.responded', snapshot)
  } catch (error) {
    await pauseUnsafeRun(input.scope, snapshot, 'world-suggest-model-result-uncheckpointed')
    throw error
  }

  let worlds: SuggestedWorld[]
  try {
    worlds = parseWorldSuggestOutputStrictV1(raw)
    const existingNames = new Set(baseline.groups.map(row => row.name.trim().toLocaleLowerCase()))
    const duplicate = worlds.find(world => existingNames.has(world.name.toLocaleLowerCase()))
    if (duplicate) throw new Error(`世界建议“${duplicate.name}”与已有世界重名。`)
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', {
      stepId: WORLD_SUGGEST_STEP_ID_V1,
      attempt: 1,
      code: 'world-suggest-protocol-failed',
      retryable: false,
      category: 'protocol',
      action: 'fail',
    })
    await append(input.scope, snapshot, 'run.failed', { code: 'world-suggest-protocol-failed', retryable: false })
    throw error
  }

  const body = {
    version: 1 as const,
    kind: 'world-suggest-candidate' as const,
    portable: false as const,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    authorConcept,
    projectSnapshot: baseline.project,
    projectHash: await hashCanonicalValue(baseline.project),
    worldGroupsBaseline: baseline.groups,
    worldGroupsBaselineHash: await hashCanonicalValue(baseline.groups),
    worldGroupLinksBaseline: baseline.links,
    worldGroupLinksBaselineHash: await hashCanonicalValue(baseline.links),
    storyCoreBaseline: baseline.storyCores,
    storyCoreBaselineHash: await hashCanonicalValue(baseline.storyCores),
    contextManifestHash: manifest.manifestHash,
    contextInputHash: await assemblyHash(assembled),
    storyContextInputHash: await assemblyHash(storyOnly),
    promptTemplateHash: prompt.promptTemplateHash,
    promptHash: prompt.promptHash,
    modelOutputHash: await hashCanonicalValue({ raw }),
    worlds,
    worldsHash: await hashCanonicalValue(worlds),
  }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', {
    stepId: WORLD_SUGGEST_STEP_ID_V1,
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
  candidate: WorldSuggestCandidateV1,
): Promise<AgentRunSnapshotV1> {
  const step = snapshot.projection.steps[WORLD_SUGGEST_STEP_ID_V1]
  if (step?.candidateHash) return snapshot
  if (step?.status !== 'running') throw new Error('世界建议候选事件无法安全重建。')
  return append(scope, snapshot, 'candidate.persisted', {
    stepId: WORLD_SUGGEST_STEP_ID_V1,
    attempt: 1,
    candidateHash: candidate.candidateHash,
    requiresConfirmation: true,
  })
}

export async function readPendingWorldSuggestCandidateV1(input: {
  scope: WorkspaceScope
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: WorldSuggestCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      ['awaiting_confirmation', 'running', 'verifying'].includes(row.status)
      && (row.worldGroupId ?? null) === null
      && isWorldSuggestContract(row.contractJson)
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const { candidate, intent } = await latestState(input.scope, row.id)
      assertCandidateTarget(input.scope, snapshot, candidate)
      snapshot = await repairCandidateEventIfNeeded(input.scope, snapshot, candidate)
      if (snapshot.projection.state === 'awaiting_confirmation' && !intent) return { snapshot, candidate }
    } catch {
      // Damaged or unrelated local run is not surfaced as a usable candidate.
    }
  }
  return null
}

export async function readRecoverableWorldSuggestRunV1(input: {
  scope: WorkspaceScope
}): Promise<{
  snapshot: AgentRunSnapshotV1
  safeToResume: boolean
  candidate?: WorldSuggestCandidateV1
  adoptionPending?: boolean
  selectedIndexes?: number[]
} | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => (
      ['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(row.status)
      && (row.worldGroupId ?? null) === null
      && isWorldSuggestContract(row.contractJson)
    ))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    const snapshot = await readAgentRunV1(input.scope, row.id)
    try {
      const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(input.scope, row.id)
      if (checkpoint) {
        const state = await parseState(checkpoint.resumePayload)
        assertCandidateTarget(input.scope, snapshot, state.candidate)
        return {
          snapshot,
          safeToResume: true,
          candidate: state.candidate,
          adoptionPending: state.intent != null,
          selectedIndexes: state.intent?.selectedIndexes,
        }
      }
    } catch {
      // Conservative unsafe result below.
    }
    return { snapshot, safeToResume: false }
  }
  return null
}

async function writeFormalItems(
  scope: WorkspaceScope,
  intent: WorldSuggestAdoptionIntentV1,
): Promise<void> {
  await db.transaction(
    'rw',
    scopeTransactionTables(db.worldGroups, db.worldGroupLinks, db.storyCores),
    async () => {
      const baseline = await readBaseline(scope)
      if (
        canonicalStringify(baseline.project) !== canonicalStringify(intent.candidate.projectSnapshot)
        || canonicalStringify(baseline.groups) !== canonicalStringify(intent.candidate.worldGroupsBaseline)
        || canonicalStringify(baseline.links) !== canonicalStringify(intent.candidate.worldGroupLinksBaseline)
        || canonicalStringify(baseline.storyCores) !== canonicalStringify(intent.candidate.storyCoreBaseline)
      ) throw new Error('世界建议 CAS 失败：项目、世界目录、关系或故事核心已变化。')
      const result = await adopt({
        projectId: scope.projectId,
        scope,
        target: 'worldGroups',
        mode: 'add-many',
        data: intent.formalItems.map(item => ({
          name: item.name,
          type: item.type,
          description: item.description,
          icon: item.icon,
          order: item.order,
          entryCondition: item.entryCondition,
          powerRestriction: item.powerRestriction,
          plannedChapterCount: item.plannedChapterCount,
        })),
      })
      const expectedFields = ['name', 'type', 'description', 'icon', 'order', 'entryCondition', 'powerRestriction', 'plannedChapterCount']
      if (
        result.written.length !== intent.formalItems.length
        || result.unknown.length || result.typeErrors.length || result.fkErrors.length || result.skipped.length
        || result.written.some(written => !expectedFields.every(field => written.fields.includes(field)))
      ) throw new Error(result.skipped[0]?.reason ?? '世界建议没有完整通过字段注册表与采纳策略。')
    },
  )
}

export async function adoptWorldSuggestCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  selectedIndexes?: readonly number[]
  onDurableBoundary?: (boundary: WorldSuggestBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: WorldSuggestCandidateV1; receiptHash: string }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate
  let intent = state.intent
  assertCandidateTarget(input.scope, snapshot, candidate)

  let evidence = await currentEvidence(input.scope, candidate, intent)
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash && intent) {
    if (!evidence.expectedMatches || !evidence.projectFresh || !evidence.linksFresh || !evidence.storyFresh || !evidence.storyContextFresh || !evidence.templateFresh) {
      snapshot = await staleAgentRunVerificationV1({
        scope: input.scope,
        runId: snapshot.run.id,
        reason: 'world-suggest-terminal-evidence-stale',
      })
      await append(input.scope, snapshot, 'candidate.staled', {
        stepId: WORLD_SUGGEST_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        reason: 'world-suggest-terminal-evidence-stale',
      })
      throw new Error('世界建议完成回执已过期；正式世界组或上游资料已变化。')
    }
    return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  }

  if (snapshot.projection.state === 'awaiting_confirmation') {
    snapshot = await assertFreshBeforeWrite(input.scope, snapshot, candidate)
    if (!intent) {
      const selectedIndexes = [...(input.selectedIndexes ?? [])].sort((left, right) => left - right)
      if (
        selectedIndexes.length < 1
        || selectedIndexes.length > candidate.worlds.length
        || new Set(selectedIndexes).size !== selectedIndexes.length
        || selectedIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= candidate.worlds.length)
      ) throw new Error('请至少选择一个有效世界建议后再确认。')
      const formalItems = buildFormalItems(candidate, selectedIndexes)
      const formalItemsHash = await hashCanonicalValue(formalItems)
      const body = {
        version: 1 as const,
        kind: 'world-suggest-adoption-intent' as const,
        portable: false as const,
        candidate,
        selectedIndexes,
        formalItems,
        formalItemsHash,
      }
      intent = { ...body, intentHash: await hashCanonicalValue(body) }
      const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent })
      snapshot = saved.snapshot
      await input.onDurableBoundary?.('intent.checkpoint', snapshot)
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
      stepId: WORLD_SUGGEST_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      decision: 'adopt',
    })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', {
      stepId: WORLD_SUGGEST_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      intentHash: intent.intentHash,
    })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  } else if (snapshot.projection.steps[WORLD_SUGGEST_STEP_ID_V1]?.confirmation !== 'adopt' || !intent) {
    throw new Error('世界建议候选不在可恢复采纳状态。')
  }

  let adoptionHash = snapshot.projection.steps[WORLD_SUGGEST_STEP_ID_V1]?.adoptionHash
  if (!adoptionHash) {
    evidence = await currentEvidence(input.scope, candidate, intent)
    if (!evidence.expectedMatches) {
      snapshot = await assertFreshBeforeWrite(input.scope, snapshot, candidate)
      await writeFormalItems(input.scope, intent)
      evidence = await currentEvidence(input.scope, candidate, intent)
    }
    if (!evidence.expectedMatches) {
      await pauseUnsafeRun(input.scope, snapshot, 'world-suggest-formal-state-diverged')
      throw new Error('正式世界组与冻结采纳意图不一致。')
    }
    await input.onDurableBoundary?.('formal.written', snapshot)
    adoptionHash = await hashCanonicalValue({ intentHash: intent.intentHash, formalItemsHash: intent.formalItemsHash })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', {
      stepId: WORLD_SUGGEST_STEP_ID_V1,
      candidateHash: candidate.candidateHash,
      adoptionHash,
    })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }

  evidence = await currentEvidence(input.scope, candidate, intent)
  if (!evidence.expectedMatches || !evidence.projectFresh || !evidence.linksFresh || !evidence.storyFresh || !evidence.storyContextFresh || !evidence.templateFresh) {
    await pauseUnsafeRun(input.scope, snapshot, 'world-suggest-terminal-evidence-stale')
    throw new Error('正式写入后世界组、关系或上游资料变化，本次回执不会通过终验。')
  }
  if (snapshot.projection.steps[WORLD_SUGGEST_STEP_ID_V1]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', {
      stepId: WORLD_SUGGEST_STEP_ID_V1,
      attempt: 1,
      outputHash: adoptionHash,
    })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', {
      verifierSetVersion: WORLD_SUGGEST_VERIFIER_SET_V1,
    })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  const postStateHash = await hashCanonicalValue({
    formalItemsHash: intent.formalItemsHash,
    projectHash: candidate.projectHash,
    worldGroupLinksBaselineHash: candidate.worldGroupLinksBaselineHash,
    storyCoreBaselineHash: candidate.storyCoreBaselineHash,
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
    verifierSetVersion: WORLD_SUGGEST_VERIFIER_SET_V1,
    criteria: [
      { id: 'world-suggest.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: 'world-suggest.author', status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: 'world-suggest.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function rejectWorldSuggestCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate, intent } = await latestState(input.scope, input.runId)
  assertCandidateTarget(input.scope, snapshot, candidate)
  if (snapshot.projection.state !== 'awaiting_confirmation' || intent) throw new Error('世界建议候选不在等待确认状态。')
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', {
    stepId: WORLD_SUGGEST_STEP_ID_V1,
    candidateHash: candidate.candidateHash,
    decision: 'reject',
  })
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-rejected-world-suggest' })
}

export async function abandonWorldSuggestRunV1(input: {
  scope: WorkspaceScope
  runId: number
}): Promise<AgentRunSnapshotV1> {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!['running', 'paused', 'awaiting_confirmation', 'verifying'].includes(snapshot.projection.state)) {
    throw new Error('世界建议运行不在可放弃状态。')
  }
  return append(input.scope, snapshot, 'run.cancelled', { reason: 'author-abandoned-world-suggest' })
}
