import { useAIConfigStore } from '../../stores/ai-config'
import { buildWorldviewPrompt } from '../ai/adapters/worldview-adapter'
import { chat, resolveRequestConfig } from '../ai/client'
import { db } from '../db/schema'
import type {
  GenerationGateIssue,
  GenerationNode,
  PreparedGenerationNode,
} from '../generation/generation-node'
import { prepareGenerationNode } from '../generation/generation-node'
import { adopt } from '../registry/adopt'
import type { AdoptResult } from '../registry/types'
import type { AIConfig, Worldview } from '../types'
import type { WorkspaceScope } from '../types/world-ownership'
import {
  isLegacyReadScope,
  readOwnedRows,
  resolveReadScopeLike,
  type WorkspaceScopeLike,
} from '../world-engine/scope'
import {
  attachAgentContextInputStateV1,
  mergeContextEvidence,
  resolveAgentContextPolicy,
  splitAgentContextPolicy,
  type AgentContextEvidence,
  type AgentContextProfile,
} from './context-policy'
import { AGENT_TOOL_BY_NAME, executeAgentTool } from './tool-registry'
import {
  buildAgentSkillInputGuidanceV1,
  resolveAgentSkillInputStateV1,
  resolveAgentSkillV1,
  type AgentSkillId,
} from './skill-registry'

const WORLD_ORIGIN_MAX_CHARS = 12_000

export interface WorldOriginCopilotScope {
  projectId: number
  scope?: WorkspaceScope
  projectName: string
  genre: string
  worldGroupId: number | null
}

export interface WorldOriginSnapshot {
  id: number | null
  updatedAt: number | null
  worldOrigin: string
}

export interface WorldOriginCopilotInput extends WorldOriginCopilotScope {
  authorRequest: string
  contextText: string
  inputGuidance: string
  snapshot: WorldOriginSnapshot
  config: AIConfig
  routingCategory?: string
  signal?: AbortSignal
}

export interface PreparedWorldOriginCopilot {
  node: GenerationNode<WorldOriginCopilotInput, string, AdoptResult>
  prepared: PreparedGenerationNode
  snapshot: WorldOriginSnapshot
  contextSources: string[]
  contextEvidence: AgentContextEvidence
}

interface WorldOriginCopilotDependencies {
  runAI?: (messages: ReturnType<typeof buildWorldviewPrompt>) => Promise<string>
  readCurrent?: () => Promise<WorldOriginSnapshot>
  adoptOutput?: (output: string) => Promise<AdoptResult>
}

export class WorldOriginCopilotStaleError extends Error {
  constructor() {
    super('世界来源已在候选生成后发生变化。为避免覆盖新内容，请重新生成候选。')
    this.name = 'WorldOriginCopilotStaleError'
  }
}

async function readScopedWorldview(
  scopeInput: WorkspaceScopeLike,
  worldGroupId: number | null,
): Promise<Worldview | null> {
  return readWorldviewFromResolvedScope(await resolveReadScopeLike(scopeInput), worldGroupId)
}

async function readWorldviewFromResolvedScope(
  scope: WorkspaceScope,
  worldGroupId: number | null,
): Promise<Worldview | null> {
  const rows = await readOwnedRows<Worldview>(scope, 'worldviews', { owner: 'world' })
  return worldGroupId == null
    ? (rows.find(row => (row.worldGroupId ?? null) === null) ?? rows[0] ?? null)
    : (rows.find(row => row.worldGroupId === worldGroupId) ?? null)
}

function snapshotOf(row: Worldview | null): WorldOriginSnapshot {
  return {
    id: row?.id ?? null,
    updatedAt: row?.updatedAt ?? null,
    worldOrigin: row?.worldOrigin ?? '',
  }
}

function sameSnapshot(left: WorldOriginSnapshot, right: WorldOriginSnapshot): boolean {
  return left.id === right.id
    && left.updatedAt === right.updatedAt
    && left.worldOrigin === right.worldOrigin
}

function assertAuthorRequest(value: string): string {
  const request = value.trim()
  if (request.length < 2) throw new Error('请至少输入 2 个字符的创作要求。')
  if (request.length > 1000) throw new Error('单次创作要求不能超过 1000 个字符。')
  return request
}

/**
 * 经 Agent 只读工具登记入口读取当前项目概况与世界观，再冻结写回前快照。
 * 不读取整库，也不在这里调用模型或写入业务表。
 */
export async function prepareWorldOriginCopilot(
  input: Pick<WorldOriginCopilotScope, 'projectId' | 'worldGroupId'> & {
    scope?: WorkspaceScope
    authorRequest: string
    skillId?: AgentSkillId
    routingCategory?: string
    contextProfile?: AgentContextProfile
    signal?: AbortSignal
  },
): Promise<PreparedWorldOriginCopilot> {
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  if (project.enableMultiWorld && input.worldGroupId == null) {
    throw new Error('多世界项目必须先选择世界。')
  }
  const routingCategory = input.routingCategory ?? 'worldview.dimension'
  const config = resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: routingCategory },
  ).config
  const contextProfile = input.contextProfile ?? 'full'
  const skill = resolveAgentSkillV1('world-origin', input.skillId)
  const tools = skill.readToolNames.map(name => AGENT_TOOL_BY_NAME.get(name)!)
  const [statusTool, worldviewTool] = tools
  if (!statusTool || !worldviewTool || tools.length !== 2) {
    throw new Error(`Agent Skill ${skill.id} 的只读工具契约无效`)
  }
  const contextPolicy = resolveAgentContextPolicy(skill.contextTaskKind, contextProfile)
  const [statusPolicy, worldviewPolicy] = splitAgentContextPolicy(
    contextPolicy,
    tools.map(tool => tool.inputBudgetTokens),
  )
  const readScope = await resolveReadScopeLike(input.scope ?? input.projectId)
  const scope = isLegacyReadScope(readScope) ? undefined : readScope
  const toolContextBase = {
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    provider: config.provider,
    model: config.model,
  }
  const [status, worldview, row] = await Promise.all([
    executeAgentTool(statusTool.name, { ...toolContextBase, contextPolicy: statusPolicy }),
    executeAgentTool(worldviewTool.name, { ...toolContextBase, contextPolicy: worldviewPolicy }),
    readWorldviewFromResolvedScope(readScope, input.worldGroupId),
  ])
  for (const result of [status, worldview]) {
    if (!result.ok) throw new Error(result.error || `${result.meta.toolName} 读取失败`)
  }

  const snapshot = snapshotOf(row)
  const contextResults = [status.meta, worldview.meta]
  const inputState = resolveAgentSkillInputStateV1(skill, contextResults)
  const contextEvidence = attachAgentContextInputStateV1(
    mergeContextEvidence(contextProfile, contextResults),
    inputState,
  )
  const inputGuidance = buildAgentSkillInputGuidanceV1(skill, inputState)
  const nodeInput: WorldOriginCopilotInput = {
    projectId: input.projectId,
    scope,
    projectName: project.name,
    genre: project.genre || project.genres.join('、'),
    worldGroupId: input.worldGroupId,
    signal: input.signal,
    authorRequest: assertAuthorRequest(input.authorRequest),
    inputGuidance,
    contextText: [
      inputGuidance,
      '【只读项目概况】',
      status.content,
      '【当前世界的已登记设定】',
      worldview.content,
    ].join('\n\n'),
    snapshot,
    config,
    routingCategory,
  }
  const node = createWorldOriginCopilotNode(nodeInput)
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    snapshot,
    contextSources: [...status.meta.included, ...worldview.meta.included],
    contextEvidence,
  }
}

/**
 * ChatCopilot 27.1-c 的首个可写 GenerationNode：只生成并采纳 worldOrigin。
 * 生成、gate 与 adopt 三段分离，采纳前还会用快照拒绝覆盖并发修改。
 */
export function createWorldOriginCopilotNode(
  input: WorldOriginCopilotInput,
  dependencies: WorldOriginCopilotDependencies = {},
): GenerationNode<WorldOriginCopilotInput, string, AdoptResult> {
  const readCurrent = dependencies.readCurrent
    ?? (async () => snapshotOf(await readScopedWorldview(input.scope ?? input.projectId, input.worldGroupId)))
  const adoptOutput = dependencies.adoptOutput
    ?? (async output => adopt({
      projectId: input.projectId,
      scope: input.scope,
      worldGroupId: input.worldGroupId,
      target: 'worldviews',
      mode: 'replace',
      data: { worldOrigin: output },
    }))
  const runAI = dependencies.runAI
    ?? (messages => chat(messages, input.config, {
      category: input.routingCategory ?? 'worldview.dimension',
      projectId: input.projectId,
      configOverrides: { maxTokens: 3000 },
      contextOverflowPolicy: 'reject',
    }, input.signal))

  return {
    id: `agent.chat-copilot.world-origin:${input.projectId}:${input.worldGroupId ?? 'global'}:${input.snapshot.id ?? 'new'}:${input.snapshot.updatedAt ?? 0}`,
    kind: 'worldview.dimension',
    editableInput: true,
    assembleInput: current => buildWorldviewPrompt(
      'origin',
      current.projectName,
      current.genre,
      current.contextText,
      current.authorRequest,
      undefined,
      current.snapshot.worldOrigin,
      current.snapshot.worldOrigin.trim() ? 'expand' : 'rewrite',
    ),
    run: async messages => (await runAI(messages)).trim(),
    gate: output => {
      const candidate = output.trim()
      const issues: GenerationGateIssue[] = []
      if (!candidate) {
        issues.push({ code: 'empty-world-origin', message: '候选世界来源为空。' })
      } else if (candidate.length < 4) {
        issues.push({ code: 'world-origin-too-short', message: '候选世界来源少于 4 个字符。' })
      } else if (candidate.length > WORLD_ORIGIN_MAX_CHARS) {
        issues.push({
          code: 'world-origin-too-long',
          message: `候选世界来源超过 ${WORLD_ORIGIN_MAX_CHARS} 个字符。`,
        })
      }
      if (candidate && candidate === input.snapshot.worldOrigin.trim()) {
        issues.push({ code: 'world-origin-unchanged', message: '候选与当前世界来源完全相同。' })
      }
      return {
        status: issues.length ? 'blocked' : 'pass',
        issues,
      }
    },
    adopt: async output => {
      if (!sameSnapshot(input.snapshot, await readCurrent())) {
        throw new WorldOriginCopilotStaleError()
      }
      const result = await adoptOutput(output.trim())
      if (
        result.written.length !== 1
        || result.unknown.length
        || result.typeErrors.length
        || result.fkErrors.length
        || result.skipped.length
      ) {
        throw new Error('世界来源写回未完整通过字段注册表校验。')
      }
      return result
    },
  }
}
