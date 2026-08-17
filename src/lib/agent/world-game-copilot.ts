import { useAIConfigStore } from '../../stores/ai-config'
import { chat, resolveRequestConfig } from '../ai/client'
import { db } from '../db/schema'
import type {
  GenerationGateIssue,
  GenerationNode,
  PreparedGenerationNode,
} from '../generation/generation-node'
import { prepareGenerationNode } from '../generation/generation-node'
import { assembleContext } from '../registry/assemble-context'
import {
  encodeWorldGameAuthoringInstructionV1,
  parseWorldGameAuthoringInstructionV1,
  parseWorldGameNarrativeCandidateV1,
  worldGameCandidateToPortableDraftV1,
  type WorldGameAuthoringProductV1,
  type WorldGameAuthoringRequestV1,
  type WorldGameNarrativeCandidateV1,
} from '../text-game/agent-contract'
import {
  generateAuthoredWorldGameFromWorldRelease,
  loadWorldGameSourceCatalog,
} from '../text-game/world-generation'
import type { AIConfig, ChatMessage, GameDefinition, WorkspaceScope } from '../types'
import { listWorldReleases } from '../world-engine/releases'
import { resolveScope } from '../world-engine/scope'
import {
  attachAgentContextInputStateV1,
  evidenceFromContextResult,
  resolveAgentContextPolicy,
  type AgentContextEvidence,
  type AgentContextProfile,
} from './context-policy'
import { hashCanonicalValue } from './run/hash'
import {
  buildAgentSkillInputGuidanceV1,
  resolveAgentSkillInputStateV1,
  resolveAgentSkillV1,
  type AgentSkillId,
} from './skill-registry'
import type { MasterCandidateModelIdentityV1 } from './master-candidate-semantic-review'

export interface WorldGameCopilotSnapshotV1 {
  request: WorldGameAuthoringRequestV1
}

interface WorldGameCopilotInputV1 {
  projectId: number
  scope: WorkspaceScope
  authorRequest: string
  inputGuidance: string
  assembled: Awaited<ReturnType<typeof assembleContext>>
  snapshot: WorldGameCopilotSnapshotV1
  config: AIConfig
  routingCategory: string
  signal?: AbortSignal
}

export interface PreparedWorldGameCopilotV1 {
  node: GenerationNode<WorldGameCopilotInputV1, WorldGameNarrativeCandidateV1, GameDefinition>
  prepared: PreparedGenerationNode
  input: WorldGameCopilotInputV1
  snapshot: WorldGameCopilotSnapshotV1
  contextSources: string[]
  contextEvidence: AgentContextEvidence
  label: string
  modelIdentity: MasterCandidateModelIdentityV1
}

interface WorldGameCopilotDependenciesV1 {
  runAI?: (messages: ChatMessage[]) => Promise<string>
}

function productFromRequest(value: string): WorldGameAuthoringProductV1 {
  if (/AVG|视觉小说|视觉叙事/i.test(value)) return 'avg'
  if (/文字冒险|冒险游戏|探索游戏/.test(value)) return 'text-adventure'
  return 'storygame'
}

function productLabel(product: WorldGameAuthoringProductV1): string {
  return product === 'storygame' ? '分支互动叙事' : product === 'text-adventure' ? '文字冒险' : 'AVG'
}

async function defaultRequest(input: {
  scope: WorkspaceScope
  authorRequest: string
}): Promise<WorldGameAuthoringRequestV1> {
  const releases = await listWorldReleases(input.scope)
  const release = releases[0]
  if (!release?.id) throw new Error('请先冻结并发布 WorldRelease，再让主 Agent 生成文字游戏。')
  const catalog = await loadWorldGameSourceCatalog({ scope: input.scope, worldReleaseId: release.id })
  const narrative = catalog.narrativeModules[0]
  if (!narrative) throw new Error('最新 WorldRelease 没有可用的冻结叙事。')
  const characterIds = catalog.characters.map(item => item.exportId)
  const selectedCharacters = new Set(characterIds)
  return {
    schema: 'storyforge.world-game-authoring-request',
    version: 1,
    productType: productFromRequest(input.authorRequest),
    worldReleaseId: release.id,
    worldContentHash: release.contentHash,
    narrativeModuleExportId: narrative.exportId,
    characterExportIds: characterIds,
    characterRelationExportIds: catalog.relationships
      .filter(item => selectedCharacters.has(item.fromCharacterExportId) && selectedCharacters.has(item.toCharacterExportId))
      .map(item => item.exportId),
    importantLocationExportIds: catalog.locations.map(item => item.exportId),
    artifactExportIds: catalog.artifacts.map(item => item.exportId),
    codexEntryExportIds: catalog.loreEntries.map(item => item.exportId),
    storyArcExportIds: catalog.storyArcs.map(item => item.exportId),
    avgMediaAssetExportIds: catalog.mediaAssets.map(item => item.exportId),
    creativeBrief: input.authorRequest.trim().slice(0, 2_000),
  }
}

export async function resolveWorldGameAuthoringRequestV1(input: {
  scope: WorkspaceScope
  authorRequest: string
}): Promise<WorldGameAuthoringRequestV1> {
  const explicit = parseWorldGameAuthoringInstructionV1(input.authorRequest)
  const request = explicit ?? await defaultRequest(input)
  const catalog = await loadWorldGameSourceCatalog({
    scope: input.scope,
    worldReleaseId: request.worldReleaseId,
  })
  if (catalog.release.contentHash !== request.worldContentHash) {
    throw new Error('所选 WorldRelease 已变化，请重新发起游戏生成。')
  }
  if (request.productType === 'text-adventure') {
    if (request.importantLocationExportIds.length < 2) throw new Error('文字冒险至少需要选择两个冻结地点。')
    if (!request.artifactExportIds.length) throw new Error('文字冒险至少需要选择一个 artifact 道具。')
  }
  return request
}

function buildMessages(input: WorldGameCopilotInputV1): ChatMessage[] {
  const request = input.snapshot.request
  const speakerIds = request.characterExportIds.length
    ? request.characterExportIds.join(', ')
    : '无（所有 speakerCharacterExportId 必须为 null，且不得输出 dialogue Beat）'
  return [
    {
      role: 'system',
      content: [
        '你是 StoryForge 的互动叙事游戏编剧。你的任务是基于冻结世界继续演化一个新的、能玩的游戏，不是复刻或摘要来源叙事。',
        '保留来源角色、地点、道具和世界规则作为创作地基；主动加入新的当下危机、玩家目标、阻碍、线索、转折、选择后果和不同结局。',
        '本次演示不做长篇语义一致性审判，但必须满足结构正确、完整可达、无死路、无循环、至少一个二选一分支和至少两个结局。',
        input.inputGuidance,
        '只输出一个严格 JSON 对象，禁止 Markdown、注释和额外字段。',
        '{"version":1,"title":"游戏名","description":"玩家目标与核心冲突","moduleKind":"main|side|quest|opening|free","entryNodeKey":"entry","nodes":[{"key":"entry","kind":"entry|scene|choice|ending","title":"节点名","summary":"该节点发生的新剧情","beats":[{"beatKey":"entry.1","kind":"narration|dialogue|action|system","speakerCharacterExportId":null,"text":"玩家实际看到的文本"}],"choices":[{"choiceKey":"entry.a","text":"玩家选择","description":"选择意图与风险","targetNodeKey":"scene-a"}]}]}',
        '节点总数 5-18；每个节点 1-8 个 Beat；非结局 1-4 个 Choice；结局 Choice 必须为空。',
        'key 只能使用英文字母、数字、点、下划线、冒号和短横线，且所有 node/beat/choice key 全局唯一。',
        `dialogue Beat 只能引用这些冻结角色 exportId：${speakerIds}。`,
        request.productType === 'text-adventure'
          ? '这是文字冒险：剧情要明确驱动玩家在地点间调查、取得 artifact 道具并形成成功与代价结局。'
          : request.productType === 'avg'
            ? '这是 AVG：Beat 应包含可演出的场景切换、角色登场、对白、情绪反转与结局画面时机。'
            : '这是分支互动叙事：每个 Choice 都应改变后续信息、关系或代价，避免只有措辞不同的假分支。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `【作者要求】\n${request.creativeBrief}`,
        `【已登记冻结世界创作包】\n${input.assembled.text}`,
        '现在请在这些素材之上推进出一段新的可玩剧情。不要把来源节点原样换名复刻。',
      ].join('\n\n'),
    },
  ]
}

function candidateIssues(
  output: WorldGameNarrativeCandidateV1,
  request: WorldGameAuthoringRequestV1,
): GenerationGateIssue[] {
  try {
    parseWorldGameNarrativeCandidateV1(JSON.stringify(output), request)
    return []
  } catch (error) {
    return [{
      code: 'world-game-candidate-invalid',
      message: error instanceof Error ? error.message : String(error),
    }]
  }
}

async function currentReleaseMatches(snapshot: WorldGameCopilotSnapshotV1): Promise<boolean> {
  const release = await db.worldReleases.get(snapshot.request.worldReleaseId)
  return release?.contentHash === snapshot.request.worldContentHash
}

export async function adoptRestoredWorldGameCandidateV1(input: {
  scope: WorkspaceScope
  snapshot: WorldGameCopilotSnapshotV1
  draft: string
}): Promise<GameDefinition> {
  if (!await currentReleaseMatches(input.snapshot)) {
    throw new Error('WorldRelease 已在候选生成后变化，请重新生成游戏。')
  }
  const candidate = parseWorldGameNarrativeCandidateV1(input.draft, input.snapshot.request)
  const candidateHash = await hashCanonicalValue(candidate)
  const generated = await generateAuthoredWorldGameFromWorldRelease({
    scope: input.scope,
    worldReleaseId: input.snapshot.request.worldReleaseId,
    draft: worldGameCandidateToPortableDraftV1(candidate, input.snapshot.request),
    candidateHash,
  })
  return generated.definition
}

export async function worldGameCandidateMatchesBusinessStateV1(input: {
  scope: WorkspaceScope
  snapshot: WorldGameCopilotSnapshotV1
  draft: string
}): Promise<boolean> {
  const candidate = parseWorldGameNarrativeCandidateV1(input.draft, input.snapshot.request)
  const candidateHash = await hashCanonicalValue(candidate)
  const gameKey = `ai-${input.snapshot.request.productType}-${candidateHash.slice(0, 20)}`
  const definition = await db.gameDefinitions.where('[workId+gameKey]').equals([
    input.scope.workId,
    gameKey,
  ]).first()
  return definition?.productType === input.snapshot.request.productType
    && definition.sourceWorldContentHash === input.snapshot.request.worldContentHash
}

export async function prepareWorldGameCopilotV1(
  input: {
    projectId: number
    scope?: WorkspaceScope
    authorRequest: string
    skillId?: AgentSkillId
    routingCategory?: string
    contextProfile?: AgentContextProfile
    configOverride?: AIConfig
    signal?: AbortSignal
  },
  dependencies: WorldGameCopilotDependenciesV1 = {},
): Promise<PreparedWorldGameCopilotV1> {
  const scope = await resolveScope({ projectId: input.projectId, scope: input.scope })
  const skill = resolveAgentSkillV1('outline', input.skillId ?? 'outline.world-game')
  if (skill.executionMode !== 'world-game') throw new Error('世界游戏 Copilot 只接受 outline.world-game Skill。')
  const request = await resolveWorldGameAuthoringRequestV1({ scope, authorRequest: input.authorRequest })
  const routingCategory = input.routingCategory ?? 'agent.outline.world-game'
  const config = input.configOverride ?? resolveRequestConfig(
    useAIConfigStore.getState().config,
    { category: routingCategory },
  ).config
  const contextProfile = input.contextProfile ?? 'balanced'
  const contextPolicy = resolveAgentContextPolicy(skill.contextTaskKind, contextProfile)
  const assembled = await assembleContext({
    projectId: input.projectId,
    scope,
    provider: config.provider,
    model: config.model,
    sourceKeys: [...skill.contextSourceKeys],
    manualSourceText: JSON.stringify(request),
    inputBudgetMaxTokens: contextPolicy.maxInputTokens,
    sourceBudgetScale: contextPolicy.sourceBudgetScale,
  })
  const inputState = resolveAgentSkillInputStateV1(skill, [assembled])
  const contextEvidence = attachAgentContextInputStateV1(
    evidenceFromContextResult(contextProfile, assembled),
    inputState,
  )
  const snapshot = { request } satisfies WorldGameCopilotSnapshotV1
  const nodeInput: WorldGameCopilotInputV1 = {
    projectId: input.projectId,
    scope,
    authorRequest: input.authorRequest,
    inputGuidance: buildAgentSkillInputGuidanceV1(skill, inputState),
    assembled,
    snapshot,
    config,
    routingCategory,
    signal: input.signal,
  }
  const node = createWorldGameCopilotNodeV1(nodeInput, dependencies)
  return {
    node,
    prepared: prepareGenerationNode(node, nodeInput),
    input: nodeInput,
    snapshot,
    contextSources: assembled.included,
    contextEvidence,
    label: `${productLabel(request.productType)} · AI 演化游戏`,
    modelIdentity: { provider: config.provider, model: config.model },
  }
}

export function createWorldGameCopilotNodeV1(
  input: WorldGameCopilotInputV1,
  dependencies: WorldGameCopilotDependenciesV1 = {},
): PreparedWorldGameCopilotV1['node'] {
  const runAI = dependencies.runAI ?? (messages => chat(messages, input.config, {
    category: input.routingCategory,
    projectId: input.projectId,
    configOverrides: { maxTokens: 12_000, temperature: 0.75 },
    contextOverflowPolicy: 'reject',
  }, input.signal))
  return {
    id: `agent.outline.world-game:${input.projectId}:${input.snapshot.request.worldContentHash}:${input.snapshot.request.productType}`,
    kind: 'outline.world-game',
    editableInput: true,
    assembleInput: buildMessages,
    run: async messages => parseWorldGameNarrativeCandidateV1(
      await runAI(messages),
      input.snapshot.request,
    ),
    gate: output => {
      const issues = candidateIssues(output, input.snapshot.request)
      return { status: issues.length ? 'blocked' : 'pass', issues }
    },
    adopt: async output => {
      if (!await currentReleaseMatches(input.snapshot)) {
        throw new Error('WorldRelease 已在候选生成后变化，请重新生成游戏。')
      }
      return adoptRestoredWorldGameCandidateV1({
        scope: input.scope,
        snapshot: input.snapshot,
        draft: JSON.stringify(output),
      })
    },
  }
}

export function createWorldGameTargetInstructionV1(request: WorldGameAuthoringRequestV1): string {
  return encodeWorldGameAuthoringInstructionV1(request)
}
