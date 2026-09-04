import { useAIConfigStore } from '../../stores/ai-config'
import { useInspirationWorkspaceStore } from '../../stores/inspiration-workspace'
import {
  buildInspirationReverseMultiWorldPrompt,
  buildInspirationReversePrompt,
  parseReverseMultiWorldOutput,
  parseReverseOutput,
  type ReverseMultiWorldResult,
  type ReverseResult,
} from '../ai/inspiration-reverse'
import { chat, resolveRequestConfig } from '../ai/client'
import { db } from '../db/schema'
import type {
  GenerationGateIssue,
  GenerationNode,
  PreparedGenerationNode,
} from '../generation/generation-node'
import { prepareGenerationNode } from '../generation/generation-node'
import {
  latestInspirationVersion,
  MAX_INSPIRATION_FRAGMENTS,
  MAX_INSPIRATION_RESULT_CHARS,
  parseInspirationFragments,
  parseInspirationVersions,
} from '../inspiration/workspace'
import type { AIConfig } from '../types'
import type { WorkspaceScope } from '../types/world-ownership'
import type {
  InspirationResultMode,
  InspirationVersion,
  InspirationWorkspace,
} from '../types/inspiration-workspace'
import {
  attachAgentContextInputStateV1,
  evidenceFromContextResult,
  resolveAgentContextPolicy,
  type AgentContextEvidence,
  type AgentContextProfile,
} from './context-policy'
import {
  createAgentContextCompressionSessionV1,
  type AgentContextCompressionRuntimeV1,
} from './context-compression'
import { executeAgentTool } from './tool-registry'
import {
  buildAgentSkillInputGuidanceV1,
  resolveAgentSkillInputStateV1,
  resolveAgentSkillV1,
  type AgentSkillId,
} from './skill-registry'
import type { MasterCandidateModelIdentityV1 } from './master-candidate-semantic-review'
import { parseStructuredOutputV1 } from './structured-output-pipeline'
import {
  readOwnedRows,
  resolveReadScopeLike,
  type WorkspaceScopeLike,
} from '../workspace/scope'

export type InspirationCopilotResult = ReverseResult | ReverseMultiWorldResult

export interface InspirationWorkspaceSnapshot {
  id: number | null
  updatedAt: number | null
  fragments: string
  versions: string
}

export interface InspirationCopilotInput {
  projectId: number
  scope?: WorkspaceScope
  projectName: string
  genres: string
  mode: InspirationResultMode
  authorRequest: string
  contextText: string
  inputGuidance: string
  selectedFragmentIds: string[]
  parentVersionId: string | null
  snapshot: InspirationWorkspaceSnapshot
  config: AIConfig
  routingCategory?: string
  signal?: AbortSignal
}

export interface PreparedInspirationCopilot {
  node: GenerationNode<InspirationCopilotInput, InspirationCopilotResult, InspirationVersion>
  prepared: PreparedGenerationNode
  mode: InspirationResultMode
  previousResult: InspirationCopilotResult | null
  contextSources: string[]
  selectedFragmentIds: string[]
  snapshot: InspirationWorkspaceSnapshot
  contextEvidence: AgentContextEvidence
  modelIdentity: MasterCandidateModelIdentityV1
}

interface InspirationCopilotDependencies {
  runAI?: (
    messages: ReturnType<typeof buildInspirationReversePrompt>,
  ) => Promise<string>
  readCurrent?: () => Promise<InspirationWorkspaceSnapshot>
  saveVersion?: (result: InspirationCopilotResult) => Promise<InspirationVersion>
}

export class InspirationCopilotStaleError extends Error {
  constructor() {
    super('灵感工作区已在候选生成后发生变化。为避免覆盖新版本，请重新生成候选。')
    this.name = 'InspirationCopilotStaleError'
  }
}

function snapshotOf(row: InspirationWorkspace | null): InspirationWorkspaceSnapshot {
  return {
    id: row?.id ?? null,
    updatedAt: row?.updatedAt ?? null,
    fragments: row?.fragments ?? '[]',
    versions: row?.versions ?? '[]',
  }
}

function sameSnapshot(
  left: InspirationWorkspaceSnapshot,
  right: InspirationWorkspaceSnapshot,
): boolean {
  return left.id === right.id
    && left.updatedAt === right.updatedAt
    && left.fragments === right.fragments
    && left.versions === right.versions
}

async function snapshotFromResolvedScope(scope: WorkspaceScope): Promise<InspirationWorkspaceSnapshot> {
  const row = (await readOwnedRows<InspirationWorkspace>(
    scope,
    'inspirationWorkspaces',
    { owner: 'work' },
  ))[0] ?? null
  return snapshotOf(row)
}

async function readWorkspaceSnapshot(scopeInput: WorkspaceScopeLike): Promise<InspirationWorkspaceSnapshot> {
  return snapshotFromResolvedScope(await resolveReadScopeLike(scopeInput))
}

function assertAuthorRequest(value: string): string {
  const request = value.trim()
  if (request.length < 2) throw new Error('请至少输入 2 个字符的本轮反推要求。')
  if (request.length > 1000) throw new Error('单次反推要求不能超过 1000 个字符。')
  return request
}

export function hasInspirationCandidateMaterialV1(
  result: InspirationCopilotResult,
  mode: InspirationResultMode,
): boolean {
  if (mode === 'multiworld') {
    const candidate = result as ReverseMultiWorldResult
    return candidate.worlds.some(world => [
      world.worldOrigin,
      world.powerHierarchy,
      world.continentLayout,
      world.climateByRegion,
      world.historyOverview,
      world.races,
      world.factionLayout,
      world.entryCondition,
      world.powerRestriction,
    ].some(value => value.trim().length > 0))
      || Object.values(candidate.storyCore).some(value => value.trim())
      || candidate.characters.some(character => character.name.trim())
  }
  const candidate = result as ReverseResult
  return Object.values(candidate.worldview).some(value => value.trim())
    || candidate.history.overview.trim().length > 0
    || Object.values(candidate.storyCore).some(value => value.trim())
    || candidate.characters.some(character => character.name.trim())
}

function parseResult(output: string, mode: InspirationResultMode): InspirationCopilotResult | null {
  return mode === 'multiworld'
    ? parseReverseMultiWorldOutput(output)
    : parseReverseOutput(output)
}

export function parseInspirationCandidateDraft(
  draft: string,
  mode: InspirationResultMode,
): InspirationCopilotResult {
  const fields = mode === 'multiworld'
    ? ['storyCore', 'worlds', 'characters']
    : ['worldview', 'history', 'storyCore', 'characters']
  return parseStructuredOutputV1({
    raw: draft,
    contract: {
      version: 1,
      schemaId: `inspiration-reverse-${mode}.v1`,
      target: mode === 'multiworld'
        ? 'worldGroups+worldviews+histories+storyCores+characters'
        : 'worldviews+histories+storyCores+characters',
      root: 'object',
      maxChars: MAX_INSPIRATION_RESULT_CHARS,
      allowedRootFields: fields,
      requiredRootFields: fields,
    },
    parse: value => {
      const parsed = parseResult(JSON.stringify(value), mode)
      if (!parsed) throw new Error('候选不是有效的灵感反推 JSON 结构。')
      return parsed
    },
  })
}

/**
 * 只把作者明确选择的灵感碎片交给正式 Agent read tool，再冻结候选写回快照。
 * 用户本轮要求是手动输入，不作为项目事实写库。
 */
export async function prepareInspirationCopilot(input: {
  projectId: number
  scope?: WorkspaceScope
  selectedFragmentIds: string[]
  authorRequest: string
  skillId?: AgentSkillId
  routingCategory?: string
  contextProfile?: AgentContextProfile
  contextCompressionRuntime?: AgentContextCompressionRuntimeV1
  signal?: AbortSignal
}): Promise<PreparedInspirationCopilot> {
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  const mode: InspirationResultMode = project.enableMultiWorld ? 'multiworld' : 'single'
  const readScope = await resolveReadScopeLike(input.scope ?? input.projectId)
  const scope = readScope
  const work = await db.works.get(scope.workId)
  if (!work || work.projectId !== input.projectId) throw new Error('当前作品不存在。')
  const snapshot = await snapshotFromResolvedScope(readScope)
  const fragments = parseInspirationFragments(snapshot.fragments)
  const selectedFragmentIds = [...new Set(input.selectedFragmentIds)]
  if (
    selectedFragmentIds.length === 0
    || selectedFragmentIds.length > MAX_INSPIRATION_FRAGMENTS
  ) throw new Error(`请选择 1-${MAX_INSPIRATION_FRAGMENTS} 条已保存的灵感碎片。`)
  const existingIds = new Set(fragments.map(fragment => fragment.id))
  if (selectedFragmentIds.some(id => !existingIds.has(id))) {
    throw new Error('所选灵感碎片已不存在或不属于当前项目。')
  }

  const routingCategory = input.routingCategory ?? 'inspiration.reverse'
  const config = resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: routingCategory },
  ).config
  const contextProfile = input.contextProfile ?? 'full'
  const skill = resolveAgentSkillV1('inspiration', input.skillId)
  const authorRequest = assertAuthorRequest(input.authorRequest)
  const compression = input.contextCompressionRuntime
    ? createAgentContextCompressionSessionV1({
        policy: skill.contextCompression,
        config,
        projectId: input.projectId,
        authorRequest,
        routingCategory,
        signal: input.signal,
        runtime: input.contextCompressionRuntime,
      })
    : undefined
  const [readToolName] = skill.readToolNames
  if (!readToolName || skill.readToolNames.length !== 1) {
    throw new Error(`Agent Skill ${skill.id} 的只读工具契约无效`)
  }
  const contextPolicy = resolveAgentContextPolicy(skill.contextTaskKind, contextProfile)
  const context = await executeAgentTool(
    readToolName,
    {
      projectId: input.projectId,
      scope,
      provider: config.provider,
      model: config.model,
      contextPolicy,
      sourceTransformer: compression?.sourceTransformer,
    },
    { fragmentIds: selectedFragmentIds, mode },
  )
  if (!context.ok || !context.meta.included.includes('inspirationWorkspace')) {
    throw new Error(context.error || '当前选择没有可用的灵感上下文。')
  }

  const versions = parseInspirationVersions(snapshot.versions)
  const parent = latestInspirationVersion(versions, mode)
  let previousResult: InspirationCopilotResult | null = null
  if (parent) previousResult = parseResult(parent.resultJson, mode)

  const inputState = resolveAgentSkillInputStateV1(skill, [context.meta])
  const contextEvidence = attachAgentContextInputStateV1(
    evidenceFromContextResult(contextProfile, context.meta),
    inputState,
  )
  const inputGuidance = buildAgentSkillInputGuidanceV1(skill, inputState)
  const nodeInput: InspirationCopilotInput = {
    projectId: input.projectId,
    scope,
    projectName: work.title,
    genres: work.genres.join('/'),
    mode,
    authorRequest,
    contextText: `${inputGuidance}\n\n${context.content}`,
    inputGuidance,
    selectedFragmentIds,
    parentVersionId: parent?.id ?? null,
    snapshot,
    config,
    routingCategory,
    signal: input.signal,
  }
  const node = createInspirationCopilotNode(nodeInput)
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    mode,
    previousResult,
    contextSources: context.meta.included,
    selectedFragmentIds,
    snapshot,
    contextEvidence,
    modelIdentity: { provider: config.provider, model: config.model },
  }
}

/**
 * Phase 27.1-d 的首个领域节点：生成结构化灵感版本，作者确认后才复用既有版本写回。
 */
export function createInspirationCopilotNode(
  input: InspirationCopilotInput,
  dependencies: InspirationCopilotDependencies = {},
): GenerationNode<InspirationCopilotInput, InspirationCopilotResult, InspirationVersion> {
  const scopeInput = input.scope ?? input.projectId
  const readCurrent = dependencies.readCurrent ?? (() => readWorkspaceSnapshot(scopeInput))
  const saveVersion = dependencies.saveVersion ?? (async result => {
    await useInspirationWorkspaceStore.getState().load(scopeInput)
    return useInspirationWorkspaceStore.getState().saveVersion(scopeInput, {
      mode: input.mode,
      parentVersionId: input.parentVersionId,
      fragmentIds: input.selectedFragmentIds,
      result,
    })
  })
  const runAI = dependencies.runAI ?? (messages => chat(messages, input.config, {
    category: input.routingCategory ?? 'inspiration.reverse',
    projectId: input.projectId,
    configOverrides: { maxTokens: 6000 },
    contextOverflowPolicy: 'reject',
  }, input.signal))

  return {
    id: `agent.chat-copilot.inspiration:${input.projectId}:${input.mode}:${input.snapshot.updatedAt ?? 0}:${input.parentVersionId ?? 'root'}`,
    kind: input.mode === 'multiworld' ? 'inspiration.reverse.multiworld' : 'inspiration.reverse',
    editableInput: true,
    assembleInput: current => current.mode === 'multiworld'
      ? buildInspirationReverseMultiWorldPrompt(
          current.projectName,
          current.genres,
          current.contextText,
          current.authorRequest,
        )
      : buildInspirationReversePrompt(
          current.projectName,
          current.genres,
          current.contextText,
          current.authorRequest,
        ),
    run: async messages => {
      return parseInspirationCandidateDraft(await runAI(messages), input.mode)
    },
    gate: output => {
      const issues: GenerationGateIssue[] = []
      let serialized = ''
      try {
        serialized = JSON.stringify(output)
      } catch {
        issues.push({ code: 'inspiration-not-serializable', message: '候选无法序列化为 JSON。' })
      }
      if (serialized.length > MAX_INSPIRATION_RESULT_CHARS) {
        issues.push({
          code: 'inspiration-too-long',
          message: `候选超过 ${MAX_INSPIRATION_RESULT_CHARS} 字符。`,
        })
      }
      if (!hasInspirationCandidateMaterialV1(output, input.mode)) {
        issues.push({ code: 'inspiration-empty-shell', message: '候选没有可用的世界、故事或角色内容。' })
      }
      if (input.mode === 'multiworld' && (output as ReverseMultiWorldResult).worlds.length === 0) {
        issues.push({ code: 'inspiration-no-world', message: '多世界候选至少需要一个世界。' })
      }
      return { status: issues.length ? 'blocked' : 'pass', issues }
    },
    adopt: async output => {
      if (!sameSnapshot(input.snapshot, await readCurrent())) {
        throw new InspirationCopilotStaleError()
      }
      return saveVersion(output)
    },
  }
}
