import { useAIConfigStore } from '../../stores/ai-config'
import { usePromptStore } from '../../stores/prompt'
import { chat, resolveRequestConfig } from '../ai/client'
import { appendSimplifiedChineseOutputConstraint, appendUserConstraint } from '../ai/adapters/prompt-guards'
import { renderPrompt } from '../ai/prompt-engine'
import { db } from '../db/schema'
import type {
  GenerationGateIssue,
  GenerationNode,
  PreparedGenerationNode,
} from '../generation/generation-node'
import { prepareGenerationNode } from '../generation/generation-node'
import { adopt } from '../registry/adopt'
import { assembleContext } from '../registry/assemble-context'
import type { AIConfig, ChatMessage, Character, WorkspaceScope } from '../types'
import {
  parseCharacterDrivenPlanArcs,
  parseCharacterDrivenPlotVolumes,
  type CharacterDrivenPlan,
  type CharacterDrivenPlotVolume,
} from '../types/character-driven-plan'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
} from '../workspace/scope'
import {
  attachAgentContextInputStateV1,
  mergeContextEvidence,
  resolveAgentContextPolicy,
  splitAgentContextPolicy,
  type AgentContextEvidence,
  type AgentContextProfile,
} from './context-policy'
import {
  createAgentContextCompressionSessionV1,
  type AgentContextCompressionRuntimeV1,
} from './context-compression'
import {
  buildAgentSkillInputGuidanceV1,
  resolveAgentSkillInputStateV1,
  resolveAgentSkillV1,
  type AgentSkillId,
} from './skill-registry'
import { executeAgentTool } from './tool-registry'
import { parseStructuredOutputV1 } from './structured-output-pipeline'

interface CharacterDrivenArcIdentityV1 {
  label: string
  aliases: string[]
}

export interface CharacterDrivenCopilotSnapshotV1 {
  planId: number
  serialized: string
  allowedCharacterNames: string[]
  arcCharacters: CharacterDrivenArcIdentityV1[]
}

export interface CharacterDrivenCopilotInputV1 {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  planId: number
  authorRequest: string
  inputGuidance: string
  planContext: string
  assembled: Awaited<ReturnType<typeof assembleContext>>
  snapshot: CharacterDrivenCopilotSnapshotV1
  projectName: string
  genres: string
  config: AIConfig
  routingCategory: string
  generationOverrides?: { temperature?: number; maxTokens?: number }
  signal?: AbortSignal
}

export interface PreparedCharacterDrivenCopilotV1 {
  node: GenerationNode<
    CharacterDrivenCopilotInputV1,
    CharacterDrivenPlotVolume[],
    { planId: number; writtenCount: number }
  >
  prepared: PreparedGenerationNode
  input: CharacterDrivenCopilotInputV1
  contextSources: string[]
  contextEvidence: AgentContextEvidence
  snapshot: CharacterDrivenCopilotSnapshotV1
  label: string
}

interface CharacterDrivenCopilotDependenciesV1 {
  runAI?: (messages: ChatMessage[]) => Promise<string>
  readCurrent?: () => Promise<CharacterDrivenCopilotSnapshotV1>
  saveCandidate?: (
    volumes: CharacterDrivenPlotVolume[],
  ) => Promise<{ planId: number; writtenCount: number }>
}

const MAX_CANDIDATE_CHARS = 240_000
const MAX_VOLUMES = 12
const MAX_CHAPTERS_PER_VOLUME = 40
const MAX_KEY_CHARACTERS = 12
const MAX_TITLE_CHARS = 160
const MAX_SUMMARY_CHARS = 3_000
const MAX_ARC_PROGRESS_CHARS = 1_500

export class CharacterDrivenCopilotStaleError extends Error {
  constructor() {
    super('角色驱动方案已在候选生成后发生变化。为避免覆盖作者的新输入，请重新生成。')
    this.name = 'CharacterDrivenCopilotStaleError'
  }
}

function normalizeIdentity(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')
}

function assertAuthorRequest(value: string): string {
  const request = value.trim()
  if (request.length < 2) throw new Error('请至少输入 2 个字符的角色驱动规划要求。')
  if (request.length > 2_000) throw new Error('单次角色驱动规划要求不能超过 2000 个字符。')
  return request
}

function assertString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串。`)
  const result = value.trim()
  if (result.length > maxLength) throw new Error(`${label} 超过 ${maxLength} 字符。`)
  return result
}

function assertExactKeys(value: Record<string, unknown>, required: readonly string[], label: string): void {
  const allowed = new Set(required)
  const missing = required.filter(key => !Object.prototype.hasOwnProperty.call(value, key))
  const unknown = Object.keys(value).filter(key => !allowed.has(key))
  if (missing.length) throw new Error(`${label} 缺少字段：${missing.join('、')}。`)
  if (unknown.length) throw new Error(`${label} 包含不允许的字段：${unknown.join('、')}。`)
}

function parseCharacterDrivenRowsV1(rows: unknown[]): CharacterDrivenPlotVolume[] {
  if (rows.length < 1 || rows.length > MAX_VOLUMES) {
    throw new Error(`角色驱动候选卷数必须在 1-${MAX_VOLUMES} 之间。`)
  }
  const volumes = rows.map((value, volumeIndex) => {
    const volumeLabel = `第 ${volumeIndex + 1} 卷候选`
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${volumeLabel} 必须是对象。`)
    }
    const source = value as Record<string, unknown>
    assertExactKeys(source, ['volumeTitle', 'volumeSummary', 'characterArcs', 'chapters'], volumeLabel)
    if (
      !Array.isArray(source.chapters)
      || source.chapters.length < 1
      || source.chapters.length > MAX_CHAPTERS_PER_VOLUME
    ) throw new Error(`${volumeLabel}.chapters 必须包含 1-${MAX_CHAPTERS_PER_VOLUME} 章。`)
    const chapters = source.chapters.map((chapter, chapterIndex) => {
      const chapterLabel = `${volumeLabel}第 ${chapterIndex + 1} 章`
      if (!chapter || typeof chapter !== 'object' || Array.isArray(chapter)) {
        throw new Error(`${chapterLabel} 必须是对象。`)
      }
      const row = chapter as Record<string, unknown>
      assertExactKeys(row, ['title', 'summary', 'keyCharacters', 'arcProgress'], chapterLabel)
      if (
        !Array.isArray(row.keyCharacters)
        || row.keyCharacters.length < 1
        || row.keyCharacters.length > MAX_KEY_CHARACTERS
      ) throw new Error(`${chapterLabel}.keyCharacters 必须包含 1-${MAX_KEY_CHARACTERS} 个角色。`)
      const keyCharacters = row.keyCharacters.map((name, characterIndex) => assertString(
        name,
        `${chapterLabel}.keyCharacters[${characterIndex}]`,
        MAX_TITLE_CHARS,
      ))
      if (new Set(keyCharacters.map(normalizeIdentity)).size !== keyCharacters.length) {
        throw new Error(`${chapterLabel}.keyCharacters 不得重复。`)
      }
      return {
        title: assertString(row.title, `${chapterLabel}.title`, MAX_TITLE_CHARS),
        summary: assertString(row.summary, `${chapterLabel}.summary`, MAX_SUMMARY_CHARS),
        keyCharacters,
        arcProgress: assertString(
          row.arcProgress,
          `${chapterLabel}.arcProgress`,
          MAX_ARC_PROGRESS_CHARS,
        ),
      }
    })
    const chapterTitles = chapters.map(chapter => normalizeIdentity(chapter.title))
    if (new Set(chapterTitles).size !== chapterTitles.length) {
      throw new Error(`${volumeLabel} 包含重复章节标题。`)
    }
    return {
      volumeTitle: assertString(source.volumeTitle, `${volumeLabel}.volumeTitle`, MAX_TITLE_CHARS),
      volumeSummary: assertString(source.volumeSummary, `${volumeLabel}.volumeSummary`, MAX_SUMMARY_CHARS),
      characterArcs: assertString(source.characterArcs, `${volumeLabel}.characterArcs`, MAX_SUMMARY_CHARS),
      chapters,
    }
  })
  const volumeTitles = volumes.map(volume => normalizeIdentity(volume.volumeTitle))
  if (new Set(volumeTitles).size !== volumeTitles.length) throw new Error('角色驱动候选包含重复卷标题。')
  return volumes
}

export function parseCharacterDrivenCandidateDraftV1(draft: string): CharacterDrivenPlotVolume[] {
  return parseStructuredOutputV1({
    raw: draft,
    contract: {
      version: 1,
      schemaId: 'character-driven-candidate.v1',
      target: 'characterDrivenPlans.volumes',
      root: 'array',
      maxChars: MAX_CANDIDATE_CHARS,
    },
    parse: value => parseCharacterDrivenRowsV1(value as unknown[]),
  })
}

function candidateIssues(
  output: CharacterDrivenPlotVolume[],
  snapshot: CharacterDrivenCopilotSnapshotV1,
): GenerationGateIssue[] {
  let parsed: CharacterDrivenPlotVolume[]
  try {
    parsed = parseCharacterDrivenCandidateDraftV1(JSON.stringify(output))
  } catch (error) {
    return [{
      code: 'character-driven-invalid-structure',
      message: error instanceof Error ? error.message : '角色驱动候选结构无效。',
    }]
  }
  const issues: GenerationGateIssue[] = []
  const allowed = new Set(snapshot.allowedCharacterNames.map(normalizeIdentity))
  const used = new Set(parsed.flatMap(volume => volume.chapters.flatMap(chapter => (
    chapter.keyCharacters.map(normalizeIdentity)
  ))))
  const unknown = [...used].filter(name => !allowed.has(name))
  if (unknown.length) {
    issues.push({
      code: 'character-driven-unknown-character',
      message: `keyCharacters 包含未登记角色：${unknown.join('、')}。请先创建角色或改用现有角色。`,
    })
  }
  const uncovered = snapshot.arcCharacters.filter(arc => (
    !arc.aliases.some(alias => used.has(normalizeIdentity(alias)))
  ))
  if (uncovered.length) {
    issues.push({
      code: 'character-driven-arc-uncovered',
      message: `以下作者指定角色没有进入任何章节：${uncovered.map(arc => arc.label).join('、')}。`,
    })
  }
  return issues
}

async function readSnapshot(
  projectId: number,
  scope: WorkspaceScope | undefined,
  planId: number,
): Promise<CharacterDrivenCopilotSnapshotV1> {
  const readScope = scope ?? await resolveReadScopeLike(projectId)
  const plan = await db.characterDrivenPlans.get(planId) as CharacterDrivenPlan | undefined
  if (!plan || !await assertRecordInScope(readScope, 'characterDrivenPlans', plan, { owner: 'work' })) {
    throw new Error('角色驱动方案不存在或不属于当前作品。')
  }
  const arcs = parseCharacterDrivenPlanArcs(plan.arcs)
  if (!arcs.length || arcs.some(arc => !arc.initialState.trim() || !arc.targetState.trim())) {
    throw new Error('请先为至少一个角色填写完整的起始状态和目标状态。')
  }
  const characters = await readOwnedRows<Character>(readScope, 'characters', { owner: 'world' })
  const byId = new Map(characters.flatMap(character => (
    character.id == null ? [] : [[character.id, character] as const]
  )))
  const arcCharacters = arcs.map(arc => {
    const currentName = arc.characterId == null ? '' : (byId.get(arc.characterId)?.name ?? '')
    const aliases = [...new Set([arc.name, currentName].map(name => name.trim()).filter(Boolean))]
    return { label: currentName || arc.name, aliases }
  })
  const allowedCharacterNames = [...new Set([
    ...characters.map(character => character.name.trim()).filter(Boolean),
    ...arcCharacters.flatMap(arc => arc.aliases),
  ])]
  return {
    planId,
    serialized: JSON.stringify({
      id: plan.id,
      arcs: plan.arcs,
      userHint: plan.userHint,
      generatedVolumes: plan.generatedVolumes,
      status: plan.status,
      updatedAt: plan.updatedAt,
    }),
    allowedCharacterNames,
    arcCharacters,
  }
}

function buildMessages(input: CharacterDrivenCopilotInputV1): ChatMessage[] {
  const template = usePromptStore.getState().getActive('plot.character-driven')
  const rendered = renderPrompt(template, {
    projectName: input.projectName,
    genres: input.genres,
    worldContext: input.assembled.text,
    storyCore: '',
    existingOutline: '',
    characterArcs: input.planContext,
    userHint: '',
    worldRulesContext: '',
  }).messages
  const constrained = appendUserConstraint(rendered, [
    input.inputGuidance,
    `【本轮操作要求】\n${input.authorRequest}`,
    '【角色驱动编排硬约束】',
    '1. 已确认的故事核心、主线、支线、世界规则和已有大纲都是边界；不得另起主线或静默改写上游。',
    '2. 所有作者指定角色都必须进入至少一章，并在 arcProgress 中写清触发事件、状态变化及其对本卷主线的作用。',
    '3. keyCharacters 只能使用正式上下文或本次角色弧方案中已经出现的角色名，不得临时发明角色。',
    '4. 规划中的未来事件不等于角色已经知情；摘要必须通过目击、调查、告知等剧情动作释放信息，不得让角色预知后续安排或其它未接触剧情线。',
    '5. 若角色终点与既有主线冲突，在 volumeSummary/characterArcs 中明确冲突和建议，不得擅改既有主线。',
    '6. 只输出严格 JSON 数组，不输出 Markdown、解释或额外字段；字段必须严格为 volumeTitle、volumeSummary、characterArcs、chapters，以及章节内 title、summary、keyCharacters、arcProgress。',
  ].join('\n'))
  return appendSimplifiedChineseOutputConstraint(constrained)
}

async function adoptCandidate(input: {
  projectId: number
  scope?: WorkspaceScope
  planId: number
  snapshot: CharacterDrivenCopilotSnapshotV1
  volumes: CharacterDrivenPlotVolume[]
}): Promise<{ planId: number; writtenCount: number }> {
  const current = await readSnapshot(input.projectId, input.scope, input.planId)
  if (current.serialized !== input.snapshot.serialized) throw new CharacterDrivenCopilotStaleError()
  const parsed = parseCharacterDrivenCandidateDraftV1(JSON.stringify(input.volumes))
  const issues = candidateIssues(parsed, input.snapshot)
  if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
  const result = await adopt({
    projectId: input.projectId,
    scope: input.scope,
    target: 'characterDrivenPlans',
    recordId: input.planId,
    mode: 'replace',
    data: {
      generatedVolumes: JSON.stringify(parsed),
      status: 'generated',
    },
  })
  if (
    result.written.length !== 1
    || result.unknown.length
    || result.typeErrors.length
    || result.fkErrors.length
    || result.skipped.length
  ) throw new Error('角色驱动候选未能完整写入当前方案，已停止采纳。')
  return { planId: input.planId, writtenCount: 1 }
}

export async function adoptRestoredCharacterDrivenCandidateV1(input: {
  projectId: number
  scope?: WorkspaceScope
  planId: number
  snapshot: CharacterDrivenCopilotSnapshotV1
  draft: string
}): Promise<{ planId: number; writtenCount: number }> {
  return adoptCandidate({
    ...input,
    volumes: parseCharacterDrivenCandidateDraftV1(input.draft),
  })
}

export function characterDrivenCandidateMatchesPlanV1(
  candidate: CharacterDrivenPlotVolume[],
  plan: CharacterDrivenPlan | undefined,
): boolean {
  if (!plan || (plan.status !== 'generated' && plan.status !== 'adopted')) return false
  return JSON.stringify(parseCharacterDrivenPlotVolumes(plan.generatedVolumes)) === JSON.stringify(candidate)
}

export async function prepareCharacterDrivenCopilotV1(
  input: {
    projectId: number
    scope?: WorkspaceScope
    worldGroupId: number | null
    planId: number
    authorRequest: string
    skillId?: AgentSkillId
    routingCategory?: string
    contextProfile?: AgentContextProfile
    configOverride?: AIConfig
    generationOverrides?: { temperature?: number; maxTokens?: number }
    contextCompressionRuntime?: AgentContextCompressionRuntimeV1
    signal?: AbortSignal
  },
  dependencies: CharacterDrivenCopilotDependenciesV1 = {},
): Promise<PreparedCharacterDrivenCopilotV1> {
  const request = assertAuthorRequest(input.authorRequest)
  const skill = resolveAgentSkillV1('outline', input.skillId ?? 'outline.character-driven')
  if (skill.executionMode !== 'character-driven') {
    throw new Error('角色驱动 Copilot 只接受 outline.character-driven Skill。')
  }
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  if (project.enableMultiWorld && input.worldGroupId == null) {
    throw new Error('多世界项目必须先选择一个世界，才能生成角色驱动剧情。')
  }
  const readScope = input.scope ?? await resolveReadScopeLike(input.projectId)
  const scope = readScope
  const before = await readSnapshot(input.projectId, scope, input.planId)
  const routingCategory = input.routingCategory ?? 'agent.outline.character-driven'
  const config = input.configOverride ?? resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: routingCategory },
  ).config
  const contextProfile = input.contextProfile ?? 'balanced'
  const contextPolicy = resolveAgentContextPolicy(skill.contextTaskKind, contextProfile)
  const [planPolicy, foundationPolicy] = splitAgentContextPolicy(contextPolicy, [1, 4])
  const compression = input.contextCompressionRuntime
    ? createAgentContextCompressionSessionV1({
        policy: skill.contextCompression,
        config,
        projectId: input.projectId,
        authorRequest: request,
        routingCategory,
        signal: input.signal,
        runtime: input.contextCompressionRuntime,
      })
    : undefined
  const planContext = await executeAgentTool(
    'read_character_driven_plan',
    {
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      provider: config.provider,
      model: config.model,
      contextPolicy: planPolicy,
      sourceTransformer: compression?.sourceTransformer,
    },
    { planId: input.planId },
  )
  if (!planContext.ok || !planContext.meta.included.includes('characterDrivenPlan')) {
    throw new Error(planContext.error || '当前角色驱动方案没有可用输入。')
  }
  const assembled = await assembleContext({
    projectId: input.projectId,
    scope,
    worldGroupId: project.enableMultiWorld ? input.worldGroupId : null,
    provider: config.provider,
    model: config.model,
    sourceKeys: [...skill.contextSourceKeys],
    inputBudgetMaxTokens: foundationPolicy.maxInputTokens,
    sourceBudgetScale: foundationPolicy.sourceBudgetScale,
    sourceTransformer: compression?.sourceTransformer,
  })
  const snapshot = await readSnapshot(input.projectId, scope, input.planId)
  if (before.serialized !== snapshot.serialized) throw new CharacterDrivenCopilotStaleError()
  const evidenceInputs = [planContext.meta, assembled]
  const inputState = resolveAgentSkillInputStateV1(skill, evidenceInputs)
  const contextEvidence = attachAgentContextInputStateV1(
    mergeContextEvidence(contextProfile, evidenceInputs),
    inputState,
  )
  const nodeInput: CharacterDrivenCopilotInputV1 = {
    projectId: input.projectId,
    scope,
    worldGroupId: project.enableMultiWorld ? input.worldGroupId : null,
    planId: input.planId,
    authorRequest: request,
    inputGuidance: buildAgentSkillInputGuidanceV1(skill, inputState),
    planContext: planContext.content,
    assembled,
    snapshot,
    projectName: project.name,
    genres: project.genres?.join('/') || project.genre || '',
    config,
    routingCategory,
    generationOverrides: input.generationOverrides,
    signal: input.signal,
  }
  const node = createCharacterDrivenCopilotNodeV1(nodeInput, dependencies)
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    input: nodeInput,
    contextSources: contextEvidence.included,
    contextEvidence,
    snapshot,
    label: '角色驱动卷章方案',
  }
}

export function createCharacterDrivenCopilotNodeV1(
  input: CharacterDrivenCopilotInputV1,
  dependencies: CharacterDrivenCopilotDependenciesV1 = {},
): PreparedCharacterDrivenCopilotV1['node'] {
  const readCurrent = dependencies.readCurrent
    ?? (() => readSnapshot(input.projectId, input.scope, input.planId))
  const saveCandidate = dependencies.saveCandidate ?? (volumes => adoptCandidate({
    projectId: input.projectId,
    scope: input.scope,
    planId: input.planId,
    snapshot: input.snapshot,
    volumes,
  }))
  const runAI = dependencies.runAI ?? (messages => chat(messages, input.config, {
    category: input.routingCategory,
    projectId: input.projectId,
    configOverrides: {
      maxTokens: input.generationOverrides?.maxTokens ?? 12_000,
      temperature: input.generationOverrides?.temperature ?? 0.55,
    },
    contextOverflowPolicy: 'reject',
  }, input.signal))
  return {
    id: `agent.outline.character-driven:${input.projectId}:${input.planId}:${input.snapshot.serialized.length}`,
    kind: 'outline.character-driven',
    editableInput: true,
    assembleInput: buildMessages,
    run: async messages => parseCharacterDrivenCandidateDraftV1(await runAI(messages)),
    gate: output => {
      const issues = candidateIssues(output, input.snapshot)
      return { status: issues.length ? 'blocked' : 'pass', issues }
    },
    adopt: async output => {
      const current = await readCurrent()
      if (current.serialized !== input.snapshot.serialized) throw new CharacterDrivenCopilotStaleError()
      const parsed = parseCharacterDrivenCandidateDraftV1(JSON.stringify(output))
      const issues = candidateIssues(parsed, current)
      if (issues.length) throw new Error(issues.map(issue => issue.message).join('；'))
      return saveCandidate(parsed)
    },
  }
}
