import { chat, resolveRequestConfig, type ChatResult } from '../ai/client'
import {
  adoptCharacterCopilotCandidate,
  parseCharacterCandidateDraft,
  prepareCharacterCopilot,
} from '../agent/character-copilot'
import {
  WORLDVIEW_AGENT_FIELDS,
  adoptRestoredWorldviewFieldCandidate,
  formatWorldviewFieldGenerationRequestV1,
  prepareWorldviewFieldCopilot,
  type WorldviewAgentField,
} from '../agent/worldview-field-copilot'
import {
  STORY_CORE_FIELDS,
  adoptRestoredStoryCoreCandidate,
  formatStoryCoreGenerationRequestV1,
  prepareStoryCoreCopilot,
  type StoryCoreField,
} from '../agent/story-core-copilot'
import {
  adoptRestoredCharacterSupplementCandidateV1,
  prepareCharacterSupplementCopilotV1,
} from '../agent/character-supplement-copilot'
import {
  adoptRestoredStoryArcCandidate,
  prepareStoryArcCopilot,
  runStoryArcCreativeReliabilityV1,
} from '../agent/story-arc-copilot'
import {
  adoptCharacterRelationshipCandidateV1,
  generateCharacterRelationshipCandidateV1,
} from '../agent/run/character-relationship-durable'
import {
  CHARACTER_DIMENSIONS,
  type CharacterDimensionKey,
} from '../character/character-dimensions'
import { hashCanonicalValue } from '../agent/run/hash'
import {
  prepareOutlineCopilot,
  adoptRestoredOutlineCandidate,
  runOutlineCreativeReliabilityV1,
  type OutlineCopilotMode,
} from '../agent/outline-copilot'
import {
  prepareProseCopilot,
  adoptRestoredProseCandidate,
  runProseCreativeReliabilityV1,
} from '../agent/prose-copilot'
import { buildEnhancedDetailPrompt, parseEnhancedDetailResult } from '../ai/adapters/detail-scene-adapter'
import { createDetailedOutlineCreativeArtifactV1 } from '../agent/detailed-outline-copilot'
import {
  isCreativeReliabilityRuntimeEnabledV1,
  type CreativeArtifactV1,
  type CreativeQualityModeV1,
} from '../agent/creative-reliability'
import { buildNarrativeBriefV1, formatNarrativeBriefForPromptV1 } from '../agent/narrative-brief'
import {
  buildChapterOrganizationPrompt,
  isChapterOrganizationCurrent,
  persistChapterOrganizationCandidate,
  adoptChapterOrganizationSelection,
  selectAllChapterOrganizationCandidates,
  type ChapterOrganizationCandidate,
} from '../agent/chapter-organization'
import { AgentTeamBudgetTracker, type AgentTeamBudgetProfile } from '../agent/team-budget'
import { hashChapterText, normalizeChapterText } from '../ai/chapter-memory/text-normalization'
import { buildFactExtractPrompt, parseFactExtractResult } from '../ai/adapters/fact-extract-adapter'
import { adoptFactCandidates } from '../fact-ledger/fact-ledger'
import { adoptChapterOutlineWorkshopResult } from '../outline/adopt-workshop'
import { assembleContext } from '../registry/assemble-context'
import { db } from '../db/schema'
import type { AIConfig, WorkspaceScope } from '../types'
import type { AdoptResult } from '../registry/types'
import { AUTHORING_NODE_BY_ID } from './catalog'
import {
  hashAuthoringText,
  readAuthoringCanonBinding,
  resolveAuthoringBoundRecordId,
} from './bindings'
import type {
  AuthoringCandidateDomain,
  AuthoringInputEnvelope,
  AuthoringNodeInstance,
  AuthoringSemantic,
} from './contracts'
import { assertRecordInScope, readOwnedRows, resolveScopeLike } from '../world-engine/scope'

export interface DomainExecutionResult {
  output: string
  variants?: string[]
  creativeArtifacts?: CreativeArtifactV1[]
  sourceKeys?: string[]
  sourceHash?: string
  sourceEvidence?: {
    included: string[]
    omitted: string[]
    trimmed: string[]
    missing: string[]
  }
  semantic: AuthoringSemantic
  domain: AuthoringCandidateDomain
}

export interface DomainExecutionInput {
  node: AuthoringNodeInstance
  inputs: AuthoringInputEnvelope[]
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  aiConfig: AIConfig
  creativeReliability?: {
    enabled: boolean
    qualityMode: CreativeQualityModeV1
    budgetProfile: AgentTeamBudgetProfile
  }
  signal?: AbortSignal
}

async function resolveDomainScope(input: Pick<DomainExecutionInput, 'projectId' | 'scope'>): Promise<WorkspaceScope> {
  return input.scope ?? resolveScopeLike(input.projectId)
}

function configText(node: AuthoringNodeInstance, key: string): string {
  return typeof node.config[key] === 'string' ? String(node.config[key]).trim() : ''
}

function configNumber(node: AuthoringNodeInstance, key: string, fallback: number): number {
  const value = node.config[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function inputControl(inputs: AuthoringInputEnvelope[], semantic: string): string {
  return inputs.find(input => input.semantic === semantic)?.content.trim() ?? ''
}

function nonControlInput(inputs: AuthoringInputEnvelope[]): string {
  return inputs
    .filter(input => input.state !== 'control' && input.content.trim())
    .map(input => `【${input.targetPortId}｜${input.semantic}】\n${input.content.trim()}`)
    .join('\n\n')
}

function requestFor(node: AuthoringNodeInstance, fallback: string): string {
  return configText(node, 'request') || fallback
}

function profileForBudget(value: number): 'lean' | 'balanced' | 'full' {
  if (value <= 14_000) return 'lean'
  if (value <= 32_000) return 'balanced'
  return 'full'
}

function organizationBudgetProfile(value: number): AgentTeamBudgetProfile {
  if (value <= 14_000) return 'economy'
  if (value <= 32_000) return 'balanced'
  return 'expanded'
}

function creativeReliabilitySettings(input: DomainExecutionInput) {
  return input.creativeReliability ?? {
    enabled: isCreativeReliabilityRuntimeEnabledV1(),
    qualityMode: 'balanced' as const,
    budgetProfile: 'balanced' as const,
  }
}

function registeredSingleField(input: DomainExecutionInput): string {
  const fields = AUTHORING_NODE_BY_ID.get(input.node.templateId)?.writes?.fields ?? []
  if (fields.length !== 1) throw new Error(`节点 ${input.node.templateId} 缺少唯一字段写回契约。`)
  return fields[0]!
}

async function domainBinding(input: DomainExecutionInput) {
  const scope = await resolveDomainScope(input)
  return readAuthoringCanonBinding({
    node: input.node,
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    contextBudget: typeof input.node.config.contextBudget === 'number'
      ? input.node.config.contextBudget
      : undefined,
  })
}

async function executeWorldviewField(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const scope = await resolveDomainScope(input)
  const targetField = registeredSingleField(input)
  if (!WORLDVIEW_AGENT_FIELDS.includes(targetField as WorldviewAgentField)) {
    throw new Error(`世界观节点 ${input.node.templateId} 的字段 ${targetField} 未登记为可生成字段。`)
  }
  const field = targetField as WorldviewAgentField
  const prepared = await prepareWorldviewFieldCopilot({
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    authorRequest: formatWorldviewFieldGenerationRequestV1({
      field,
      mode: 'expand',
      hint: requestFor(input.node, `生成${AUTHORING_NODE_BY_ID.get(input.node.templateId)?.label ?? targetField}。`),
    }),
    supplementalContext: nonControlInput(input.inputs),
    routingCategory: AUTHORING_NODE_BY_ID.get(input.node.templateId)?.promptModuleKey,
    contextProfile: profileForBudget(contextBudget(input.node, input.inputs, 28_500)),
    configOverride: input.aiConfig,
    generationOverrides: generationOverrides(input.node, input.inputs),
    signal: input.signal,
  })
  if (prepared.targetField !== field) throw new Error('世界观节点与字段 Copilot 解析出的目标不一致。')
  const binding = await domainBinding(input)
  const variants: string[] = []
  for (let index = 0; index < generationCount(input.node, input.inputs); index += 1) {
    variants.push(JSON.stringify(await prepared.node.run(prepared.prepared.messages), null, 2))
  }
  return {
    output: variants[0] ?? '',
    variants,
    semantic: input.node.outputs[0]?.semantic ?? 'world.setting',
    sourceKeys: binding.sourceKeys,
    sourceHash: binding.sourceHash,
    sourceEvidence: binding,
    domain: { kind: 'worldview-field', targetField: field, snapshot: prepared.snapshot },
  }
}

async function executeStoryCoreField(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const scope = await resolveDomainScope(input)
  const targetField = registeredSingleField(input)
  if (!STORY_CORE_FIELDS.includes(targetField as StoryCoreField)) {
    throw new Error(`故事节点 ${input.node.templateId} 的字段 ${targetField} 未登记为可生成字段。`)
  }
  const field = targetField as StoryCoreField
  const prepared = await prepareStoryCoreCopilot({
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    authorRequest: formatStoryCoreGenerationRequestV1({
      field,
      mode: 'expand',
      hint: requestFor(input.node, `生成${AUTHORING_NODE_BY_ID.get(input.node.templateId)?.label ?? targetField}。`),
    }),
    supplementalContext: nonControlInput(input.inputs),
    routingCategory: AUTHORING_NODE_BY_ID.get(input.node.templateId)?.promptModuleKey,
    contextProfile: profileForBudget(contextBudget(input.node, input.inputs, 28_500)),
    configOverride: input.aiConfig,
    generationOverrides: generationOverrides(input.node, input.inputs),
    signal: input.signal,
  })
  if (prepared.targetField !== field) throw new Error('故事节点与字段 Copilot 解析出的目标不一致。')
  const binding = await domainBinding(input)
  const variants: string[] = []
  for (let index = 0; index < generationCount(input.node, input.inputs); index += 1) {
    variants.push(JSON.stringify(await prepared.node.run(prepared.prepared.messages), null, 2))
  }
  return {
    output: variants[0] ?? '',
    variants,
    semantic: input.node.outputs[0]?.semantic ?? 'story.theme',
    sourceKeys: binding.sourceKeys,
    sourceHash: binding.sourceHash,
    sourceEvidence: binding,
    domain: { kind: 'story-core-field', targetField: field, snapshot: prepared.snapshot },
  }
}

async function executeCharacterSupplement(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const scope = await resolveDomainScope(input)
  const targetField = registeredSingleField(input)
  const dimension = CHARACTER_DIMENSIONS.find(item => item.key === targetField)?.key
  if (!dimension) throw new Error(`角色节点 ${input.node.templateId} 的字段 ${targetField} 未登记为角色维度。`)
  const characterId = await resolveAuthoringBoundRecordId({
    node: input.node,
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    target: 'characters',
  })
  if (characterId == null) throw new Error('角色维度节点必须先绑定一个目标角色，才能复用分步骤补全流程。')
  const prepared = await prepareCharacterSupplementCopilotV1({
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    request: { characterId, dimensions: [dimension as CharacterDimensionKey], useEvidence: true },
    authorRequest: requestFor(input.node, `补全角色的${AUTHORING_NODE_BY_ID.get(input.node.templateId)?.label ?? targetField}。`),
    routingCategory: AUTHORING_NODE_BY_ID.get(input.node.templateId)?.promptModuleKey,
    contextProfile: profileForBudget(contextBudget(input.node, input.inputs, 28_500)),
    configOverride: input.aiConfig,
    generationOverrides: generationOverrides(input.node, input.inputs),
    signal: input.signal,
  })
  const binding = await domainBinding(input)
  const variants: string[] = []
  for (let index = 0; index < generationCount(input.node, input.inputs); index += 1) {
    variants.push(JSON.stringify(await prepared.node.run(prepared.prepared.messages), null, 2))
  }
  return {
    output: variants[0] ?? '',
    variants,
    semantic: 'character.profile',
    sourceKeys: binding.sourceKeys,
    sourceHash: binding.sourceHash,
    sourceEvidence: binding,
    domain: { kind: 'character-supplement', snapshot: prepared.snapshot },
  }
}

async function executeStoryArc(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const scope = await resolveDomainScope(input)
  const reliability = creativeReliabilitySettings(input)
  const prepared = await prepareStoryArcCopilot({
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    authorRequest: requestFor(input.node, '根据现有世界、故事和角色规划故事线。'),
    supplementalContext: nonControlInput(input.inputs),
    routingCategory: AUTHORING_NODE_BY_ID.get(input.node.templateId)?.promptModuleKey,
    contextProfile: profileForBudget(contextBudget(input.node, input.inputs, 32_000)),
    configOverride: input.aiConfig,
    generationOverrides: generationOverrides(input.node, input.inputs),
    creativeReliabilityEnabled: reliability.enabled,
    signal: input.signal,
  })
  const binding = await domainBinding(input)
  const variants: string[] = []
  const creativeArtifacts: CreativeArtifactV1[] = []
  for (let index = 0; index < generationCount(input.node, input.inputs); index += 1) {
    if (reliability.enabled) {
      const result = await runStoryArcCreativeReliabilityV1({
        prepared,
        budget: new AgentTeamBudgetTracker(reliability.budgetProfile),
        qualityMode: reliability.qualityMode,
      })
      variants.push(result.draft)
      creativeArtifacts.push(result.artifact)
    } else {
      variants.push(JSON.stringify(await prepared.node.run(prepared.prepared.messages), null, 2))
    }
  }
  return {
    output: variants[0] ?? '',
    variants,
    ...(creativeArtifacts.length ? { creativeArtifacts } : {}),
    semantic: 'story.arc',
    sourceKeys: binding.sourceKeys,
    sourceHash: binding.sourceHash,
    sourceEvidence: binding,
    domain: { kind: 'story-arc', snapshot: prepared.snapshot, mutation: prepared.mutation },
  }
}

async function executeCharacterRelation(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const scope = await resolveDomainScope(input)
  const generated = await generateCharacterRelationshipCandidateV1({
    scope,
    worldGroupId: input.worldGroupId,
    aiConfig: input.aiConfig,
  })
  const binding = await domainBinding(input)
  const output = JSON.stringify(generated.candidate, null, 2)
  return {
    output,
    variants: [output],
    semantic: 'character.relation',
    sourceKeys: binding.sourceKeys,
    sourceHash: binding.sourceHash,
    sourceEvidence: binding,
    domain: {
      kind: 'character-relation',
      producerRunId: generated.snapshot.run.id,
      candidateHash: generated.candidate.candidateHash,
      candidateCount: generated.candidate.relations.length,
    },
  }
}

function generationOverrides(node: AuthoringNodeInstance, inputs: AuthoringInputEnvelope[]) {
  const temperature = Number(inputControl(inputs, 'control.temperature') || configNumber(node, 'temperature', NaN))
  const maxTokens = Number(inputControl(inputs, 'control.max-tokens') || configNumber(node, 'maxTokens', NaN))
  return {
    ...(Number.isFinite(temperature) ? { temperature } : {}),
    ...(Number.isFinite(maxTokens) && maxTokens > 0
      ? { maxTokens: Math.max(100, Math.round(maxTokens)) }
      : {}),
  }
}

function generationCount(node: AuthoringNodeInstance, inputs: AuthoringInputEnvelope[]): number {
  const raw = Number(inputControl(inputs, 'control.count') || configNumber(node, 'candidateCount', 1))
  return Math.min(8, Math.max(1, Number.isFinite(raw) ? Math.round(raw) : 1))
}

function contextBudget(node: AuthoringNodeInstance, inputs: AuthoringInputEnvelope[], fallback: number): number {
  const value = Number(inputControl(inputs, 'control.context-budget') || configNumber(node, 'contextBudget', fallback))
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback
}

function structuredTitleInput(inputs: AuthoringInputEnvelope[], semantic: AuthoringSemantic): string {
  const content = inputs.find(input => input.semantic === semantic && input.content.trim())?.content.trim()
  if (!content) return ''
  try {
    const parsed = JSON.parse(content) as unknown
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const title = (first as Record<string, unknown>).title
      if (typeof title === 'string') return title.trim()
    }
  } catch {
    // Free-form upstream content remains available as supplemental context, but is not a safe target key.
  }
  return ''
}

function targetTitle(
  node: AuthoringNodeInstance,
  inputs: AuthoringInputEnvelope[],
  key: string,
  semantic: AuthoringSemantic,
): string {
  return configText(node, key) || structuredTitleInput(inputs, semantic)
}

async function executeCharacter(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const scope = await resolveDomainScope(input)
  const supplementalContext = nonControlInput(input.inputs)
  const budget = contextBudget(input.node, input.inputs, 28_500)
  const prepared = await prepareCharacterCopilot({
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    authorRequest: requestFor(input.node, '根据当前世界资料创建一个结构完整的新角色。'),
    supplementalContext,
    routingCategory: AUTHORING_NODE_BY_ID.get(input.node.templateId)?.promptModuleKey,
    contextProfile: profileForBudget(budget),
    configOverride: input.aiConfig,
    generationOverrides: generationOverrides(input.node, input.inputs),
    signal: input.signal,
  })
  const binding = await readAuthoringCanonBinding({
    node: input.node,
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    contextBudget: typeof input.node.config.contextBudget === 'number' ? input.node.config.contextBudget : undefined,
  })
  const variants: string[] = []
  for (let index = 0; index < generationCount(input.node, input.inputs); index += 1) {
    const candidate = await prepared.node.run(prepared.prepared.messages)
    variants.push(JSON.stringify(candidate, null, 2))
  }
  return {
    output: variants[0] ?? '',
    variants,
    semantic: 'character.profile',
    sourceKeys: binding.sourceKeys,
    sourceHash: binding.sourceHash,
    sourceEvidence: binding,
    domain: { kind: 'character', rosterSnapshot: prepared.snapshot.serialized },
  }
}

async function executeOutline(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const scope = await resolveDomainScope(input)
  const supplementalContext = nonControlInput(input.inputs)
  const template = AUTHORING_NODE_BY_ID.get(input.node.templateId)
  const mode: OutlineCopilotMode = input.node.templateId === 'outline.volume' ? 'volumes' : 'chapters'
  const configuredVolume = configText(input.node, 'volumeTitle')
  const request = requestFor(
    input.node,
    mode === 'volumes' ? '根据当前世界和故事核心规划卷纲。' : '根据所属卷规划章节大纲。',
  )
  const modeHint = mode === 'volumes' && !/卷纲|卷级|分卷|全书大纲|规划.{0,6}卷/.test(request)
    ? `${request} 请输出卷纲。`
    : request
  const requestWithTarget = configuredVolume && !modeHint.includes(configuredVolume)
    ? `${modeHint} 目标卷：《${configuredVolume}》`
    : modeHint
  const parameterValues = {
    ...(mode === 'volumes'
      ? { volumeCount: Number(inputControl(input.inputs, 'control.volume-count')) || '' }
      : { chaptersPerVolume: Number(inputControl(input.inputs, 'control.chapter-count')) || '' }),
  }
  const prepared = await prepareOutlineCopilot({
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    authorRequest: requestWithTarget,
    supplementalContext,
    routingCategory: template?.promptModuleKey,
    contextProfile: profileForBudget(contextBudget(input.node, input.inputs, 48_000)),
    parameterValues,
    configOverride: input.aiConfig,
    generationOverrides: generationOverrides(input.node, input.inputs),
    signal: input.signal,
  })
  const reliability = creativeReliabilitySettings(input)
  const binding = await readAuthoringCanonBinding({
    node: input.node,
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    contextBudget: typeof input.node.config.contextBudget === 'number' ? input.node.config.contextBudget : undefined,
  })
  const variants: string[] = []
  const creativeArtifacts: CreativeArtifactV1[] = []
  for (let index = 0; index < generationCount(input.node, input.inputs); index += 1) {
    if (reliability.enabled) {
      const result = await runOutlineCreativeReliabilityV1({
        prepared,
        budget: new AgentTeamBudgetTracker(reliability.budgetProfile),
        qualityMode: reliability.qualityMode,
      })
      variants.push(result.draft)
      creativeArtifacts.push(result.artifact)
    } else {
      const candidate = await prepared.node.run(prepared.prepared.messages)
      variants.push(JSON.stringify(candidate, null, 2))
    }
  }
  return {
    output: variants[0] ?? '',
    variants,
    ...(creativeArtifacts.length ? { creativeArtifacts } : {}),
    semantic: mode === 'volumes' ? 'outline.volume' : 'outline.chapter',
    sourceKeys: binding.sourceKeys,
    sourceHash: binding.sourceHash,
    sourceEvidence: binding,
    domain: {
      kind: 'outline',
      mode: prepared.mode,
      parentVolumeId: prepared.parentVolumeId,
      snapshot: prepared.snapshot,
    },
  }
}

function segmentText(assembled: Awaited<ReturnType<typeof assembleContext>>, key: string): string {
  const index = assembled.included.indexOf(key)
  return index >= 0 ? assembled.segments[index]?.content ?? '' : ''
}

async function executeDetail(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const scope = await resolveDomainScope(input)
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('项目不存在。')
  const allNodes = await readOwnedRows<any>(scope, 'outlineNodes', { owner: 'work' })
  const title = targetTitle(input.node, input.inputs, 'chapterTitle', 'outline.chapter')
  const candidates = allNodes.filter(node => (
    node.type === 'chapter'
    && (node.worldGroupId ?? null) === input.worldGroupId
    && (!title || node.title === title || nonControlInput(input.inputs).includes(node.title))
  ))
  if (candidates.length !== 1 || candidates[0]?.id == null) {
    throw new Error(title ? `找不到唯一的目标章节《${title}》。` : '章节细纲节点需要填写唯一的目标章节标题。')
  }
  const outline = candidates[0]!
  const outlineId = outline.id!
  const siblings = allNodes
    .filter(node => node.type === 'chapter' && node.parentId === outline.parentId && (node.worldGroupId ?? null) === input.worldGroupId)
    .sort((left, right) => left.order - right.order)
  const index = siblings.findIndex(node => node.id === outline.id)
  const assembled = await assembleContext({
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    outlineNodeId: outlineId,
    sourceKeys: AUTHORING_NODE_BY_ID.get(input.node.templateId)?.reads?.sourceKeys,
    inputBudgetTokens: contextBudget(input.node, input.inputs, 16_000),
    provider: input.aiConfig.provider,
    model: input.aiConfig.model,
  })
  const binding = await readAuthoringCanonBinding({
    node: input.node,
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    contextBudget: typeof input.node.config.contextBudget === 'number' ? input.node.config.contextBudget : undefined,
  })
  const reliability = creativeReliabilitySettings(input)
  const narrativeBrief = buildNarrativeBriefV1({
    authorRequest: `完善《${outline.title}》的场景、冲突、情绪变化和结尾压力。`,
    assembled,
  })
  const baseMessages = buildEnhancedDetailPrompt(
    outline.title,
    outline.summary,
    siblings[index - 1]?.summary ?? '',
    siblings[index + 1]?.summary ?? '',
    segmentText(assembled, 'worldview'),
    segmentText(assembled, 'characters'),
    segmentText(assembled, 'foreshadows'),
  )
  const messages = reliability.enabled
    ? [{ role: 'system' as const, content: formatNarrativeBriefForPromptV1(narrativeBrief) }, ...baseMessages]
    : baseMessages
  const callMeta = {
    category: 'detail.chapter-planning',
    projectId: input.projectId,
    configOverrides: generationOverrides(input.node, input.inputs),
    contextOverflowPolicy: 'reject' as const,
  }
  const resolved = resolveRequestConfig(input.aiConfig, callMeta)
  const variants: string[] = []
  const creativeArtifacts: CreativeArtifactV1[] = []
  for (let index = 0; index < generationCount(input.node, input.inputs); index += 1) {
    const budget = new AgentTeamBudgetTracker(reliability.budgetProfile)
    const reservation = budget.reserveCall({
      label: '细纲领域 Agent',
      messages,
      maxOutputTokens: resolved.config.maxTokens > 0 ? resolved.config.maxTokens : 16_000,
    })
    const result: ChatResult = {}
    const startedAt = Date.now()
    let raw: string
    try {
      raw = await chat(messages, input.aiConfig, {
        category: 'detail.chapter-planning',
        projectId: input.projectId,
        configOverrides: generationOverrides(input.node, input.inputs),
        contextOverflowPolicy: 'reject',
      }, input.signal, result, undefined, resolved)
      budget.settleCall(reservation, raw)
    } catch (error) {
      budget.settleFailedCall(reservation)
      throw error
    }
    if (reliability.enabled) {
      const artifact = await createDetailedOutlineCreativeArtifactV1({
        raw,
        operation: 'enhanced',
        narrativeBrief,
        qualityMode: reliability.qualityMode,
        modelIdentity: {
          provider: resolved.config.provider,
          model: resolved.config.model,
        },
        inputText: messages.map(message => message.content).join('\n'),
        durationMs: Math.max(0, Date.now() - startedAt),
        ...(result.usage ? { usage: result.usage } : {}),
      })
      variants.push(artifact.editableText)
      creativeArtifacts.push(artifact)
    } else {
      const parsed = parseEnhancedDetailResult(raw)
      if (!parsed) throw new Error('细纲候选不是有效的 JSON 对象。')
      variants.push(JSON.stringify(parsed, null, 2))
    }
  }
  return {
    output: variants[0] ?? '',
    variants,
    ...(creativeArtifacts.length ? { creativeArtifacts } : {}),
    semantic: 'outline.plan',
    sourceKeys: binding.sourceKeys,
    sourceHash: binding.sourceHash,
    sourceEvidence: binding,
    domain: { kind: 'detail', outlineNodeId: outlineId, chapterSummary: outline.summary },
  }
}

async function executeProse(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const scope = await resolveDomainScope(input)
  const configuredTitle = configText(input.node, 'chapterTitle')
  const baseRequest = requestFor(input.node, '根据当前章纲生成正文。')
  const request = configuredTitle && !baseRequest.includes(configuredTitle)
    ? `${baseRequest} 目标章节：《${configuredTitle}》`
    : baseRequest
  const supplementalContext = nonControlInput(input.inputs)
  const prepared = await prepareProseCopilot({
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    authorRequest: request,
    supplementalContext,
    routingCategory: AUTHORING_NODE_BY_ID.get(input.node.templateId)?.promptModuleKey,
    contextProfile: profileForBudget(contextBudget(input.node, input.inputs, 64_000)),
    parameterValues: { wordCount: inputControl(input.inputs, 'control.word-count') },
    configOverride: input.aiConfig,
    generationOverrides: generationOverrides(input.node, input.inputs),
    signal: input.signal,
  })
  const reliability = creativeReliabilitySettings(input)
  const binding = await readAuthoringCanonBinding({
    node: input.node,
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    contextBudget: typeof input.node.config.contextBudget === 'number' ? input.node.config.contextBudget : undefined,
  })
  const variants: string[] = []
  const creativeArtifacts: CreativeArtifactV1[] = []
  for (let index = 0; index < generationCount(input.node, input.inputs); index += 1) {
    if (reliability.enabled) {
      const result = await runProseCreativeReliabilityV1({
        prepared,
        budget: new AgentTeamBudgetTracker(reliability.budgetProfile),
        qualityMode: reliability.qualityMode,
      })
      variants.push(result.draft)
      creativeArtifacts.push(result.artifact)
    } else {
      variants.push(await prepared.node.run(prepared.prepared.messages))
    }
  }
  return {
    output: variants[0] ?? '',
    variants,
    ...(creativeArtifacts.length ? { creativeArtifacts } : {}),
    semantic: 'chapter.prose',
    sourceKeys: binding.sourceKeys,
    sourceHash: binding.sourceHash,
    sourceEvidence: binding,
    domain: {
      kind: 'prose',
      operation: prepared.operation,
      outlineNodeId: prepared.outlineNodeId,
      snapshot: prepared.snapshot,
    },
  }
}

async function resolveOrganizationChapter(input: DomainExecutionInput) {
  const scope = await resolveDomainScope(input)
  const title = configText(input.node, 'chapterTitle') || targetTitle(input.node, input.inputs, 'chapterTitle', 'outline.chapter')
  const [chapters, outlines] = await Promise.all([
    readOwnedRows<any>(scope, 'chapters', { owner: 'work' }),
    readOwnedRows<any>(scope, 'outlineNodes', { owner: 'work' }),
  ])
  const outlineById = new Map(outlines.flatMap(item => item.id == null ? [] : [[item.id, item] as const]))
  const candidates = chapters.filter(chapter => {
    const outline = outlineById.get(chapter.outlineNodeId)
    return (outline?.worldGroupId ?? null) === input.worldGroupId
      && (!title || chapter.title === title || outline?.title === title)
  })
  if (candidates.length !== 1 || candidates[0]?.id == null) {
    throw new Error(title ? `找不到唯一的目标章节《${title}》。` : '整理本章节点需要填写唯一的目标章节标题。')
  }
  const chapter = candidates[0]!
  const outline = outlineById.get(chapter.outlineNodeId)
  if (!outline?.id) throw new Error('目标章节缺少有效的大纲节点。')
  return { chapter, outline, scope }
}

function chapterSegment(assembled: Awaited<ReturnType<typeof assembleContext>>, key: string): string {
  const index = assembled.included.indexOf(key)
  return index >= 0 ? assembled.segments[index]?.content ?? '' : ''
}

async function executeChapterOrganization(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const { chapter, outline, scope } = await resolveOrganizationChapter(input)
  const contextBudgetValue = contextBudget(input.node, input.inputs, 28_000)
  const assembled = await assembleContext({
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    outlineNodeId: outline.id,
    chapterId: chapter.id,
    sourceKeys: AUTHORING_NODE_BY_ID.get(input.node.templateId)?.reads?.sourceKeys,
    inputBudgetTokens: contextBudgetValue,
    provider: input.aiConfig.provider,
    model: input.aiConfig.model,
  })
  const chapterText = normalizeChapterText(chapterSegment(assembled, 'chapterContent') || chapter.content || '')
  if (!chapterText) throw new Error('目标章节没有可整理的正文。')
  const [allCharacters, relations, foreshadows, itemRows] = await Promise.all([
    readOwnedRows<any>(scope, 'characters', { owner: 'world' }),
    readOwnedRows<any>(scope, 'characterRelations', { owner: 'world' }),
    readOwnedRows<any>(scope, 'foreshadows', { owner: 'work' }),
    readOwnedRows<any>(scope, 'itemLedger', { owner: 'work' }),
  ])
  const characters = allCharacters.filter(character => (
    Boolean(character.isCrossWorld) || (character.homeWorldGroupId ?? null) === input.worldGroupId
  ))
  const visibleCharacterIds = new Set(characters.flatMap(character => character.id == null ? [] : [character.id]))
  const visibleRelations = relations.filter(relation => (
    visibleCharacterIds.has(relation.fromCharacterId) && visibleCharacterIds.has(relation.toCharacterId)
  ))
  const knownItemNames = [...new Set(itemRows.map(item => item.itemName.trim()).filter(Boolean))]
  const tracker = new AgentTeamBudgetTracker(organizationBudgetProfile(contextBudgetValue))
  const messages = buildChapterOrganizationPrompt({
    chapterTitle: chapter.title,
    chapterText,
    stateContext: [
      chapterSegment(assembled, 'stateCards'),
      chapterSegment(assembled, 'currentFacts'),
      chapterSegment(assembled, 'characterKnowledge'),
      chapterSegment(assembled, 'storylineProgress'),
    ].filter(Boolean).join('\n\n'),
    characters,
    knownItemNames,
    existingRelations: visibleRelations,
    foreshadows,
  })
  const trackerReservation = tracker.reserveCall({ label: '整理本章', messages, maxOutputTokens: 8_000 })
  let raw: string
  try {
    raw = await chat(messages, input.aiConfig, {
      category: 'chapter.continuity',
      projectId: input.projectId,
      configOverrides: generationOverrides(input.node, input.inputs),
      contextOverflowPolicy: 'reject',
    }, input.signal)
    tracker.settleCall(trackerReservation, raw)
  } catch (error) {
    tracker.settleFailedCall(trackerReservation)
    throw error
  }
  const sourceTextHash = await hashChapterText(chapter.content || '')
  const parsed = (await import('../agent/chapter-organization')).parseChapterOrganizationOutput({
    raw,
    projectId: input.projectId,
    chapterId: chapter.id!,
    chapterTitle: chapter.title,
    worldGroupId: input.worldGroupId,
    chapterText,
    sourceTextHash,
    characters,
    existingRelations: visibleRelations,
    foreshadows,
    budget: tracker.snapshot(),
  })
  if (!parsed) throw new Error('整理本章返回的 JSON 无法解析；没有写入任何项目数据。')
  return {
    output: JSON.stringify(parsed, null, 2),
    semantic: 'continuity.report',
    sourceKeys: assembled.included,
    sourceHash: hashAuthoringText(`${assembled.included.join(',')}:${sourceTextHash}`),
    sourceEvidence: {
      included: assembled.included,
      omitted: assembled.omitted,
      trimmed: assembled.trimmed,
      missing: [],
    },
    domain: {
      kind: 'chapter-organization',
      chapterId: chapter.id!,
      chapterTitle: chapter.title,
      sourceTextHash,
      candidateJson: JSON.stringify(parsed),
    },
  }
}

async function executeFactNode(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const { chapter, outline, scope } = await resolveOrganizationChapter(input)
  const contextBudgetValue = contextBudget(input.node, input.inputs, 20_000)
  const assembled = await assembleContext({
    projectId: input.projectId,
    scope,
    worldGroupId: input.worldGroupId,
    outlineNodeId: outline.id,
    chapterId: chapter.id,
    sourceKeys: AUTHORING_NODE_BY_ID.get(input.node.templateId)?.reads?.sourceKeys,
    inputBudgetTokens: contextBudgetValue,
    provider: input.aiConfig.provider,
    model: input.aiConfig.model,
  })
  const chapterText = normalizeChapterText(chapterSegment(assembled, 'chapterContent') || chapter.content || '')
  if (!chapterText) throw new Error('目标章节没有可抽取事实的正文。')
  const messages = buildFactExtractPrompt({ chapterTitle: chapter.title, chapterContent: chapterText })
  const raw = await chat(messages, input.aiConfig, {
    category: 'chapter.continuity',
    projectId: input.projectId,
    configOverrides: generationOverrides(input.node, input.inputs),
    contextOverflowPolicy: 'reject',
  }, input.signal)
  const candidates = parseFactExtractResult({ raw, chapterContent: chapterText })
  const sourceTextHash = await hashChapterText(chapter.content || '')
  return {
    output: JSON.stringify({ facts: candidates }, null, 2),
    semantic: 'continuity.fact',
    sourceKeys: assembled.included,
    sourceHash: hashAuthoringText(`${assembled.included.join(',')}:${sourceTextHash}`),
    sourceEvidence: { included: assembled.included, omitted: assembled.omitted, trimmed: assembled.trimmed, missing: [] },
    domain: { kind: 'facts', chapterId: chapter.id!, sourceTextHash, candidateJson: JSON.stringify(candidates) },
  }
}

/** 领域节点专用执行器；返回 null 时由通用 FLOW-3 执行器处理。 */
export async function executeDomainNode(input: DomainExecutionInput): Promise<DomainExecutionResult | null> {
  if (input.node.templateId.startsWith('world.')) return executeWorldviewField(input)
  if (input.node.templateId.startsWith('story.') && input.node.templateId !== 'story.arc') {
    return executeStoryCoreField(input)
  }
  if (input.node.templateId.startsWith('character.field.')) return executeCharacterSupplement(input)
  switch (input.node.templateId) {
    case 'character.profile': return executeCharacter(input)
    case 'character.relation': return executeCharacterRelation(input)
    case 'story.arc':
    case 'continuity.storyline': return executeStoryArc(input)
    case 'outline.volume':
    case 'outline.chapter': return executeOutline(input)
    case 'outline.plan': return executeDetail(input)
    case 'chapter.prose': return executeProse(input)
    case 'chapter.organize': return executeChapterOrganization(input)
    case 'continuity.fact': return executeFactNode(input)
    default: return null
  }
}

function emptyAdoptResult(): AdoptResult {
  return { written: [], aliasMapped: [], unknown: [], typeErrors: [], fkErrors: [], skipped: [] }
}

/** 领域节点专用采纳器；未命中领域候选时返回 null。 */
export async function adoptDomainCandidate(input: {
  node: AuthoringNodeInstance
  domain: AuthoringCandidateDomain
  output: string
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
}): Promise<AdoptResult | null> {
  const scope = await resolveDomainScope(input)
  if (input.domain.kind === 'worldview-field') {
    return adoptRestoredWorldviewFieldCandidate({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      snapshot: input.domain.snapshot,
      targetField: input.domain.targetField as WorldviewAgentField,
      draft: input.output,
    })
  }
  if (input.domain.kind === 'story-core-field') {
    return adoptRestoredStoryCoreCandidate({
      projectId: input.projectId,
      scope,
      snapshot: input.domain.snapshot,
      targetField: input.domain.targetField as StoryCoreField,
      draft: input.output,
    })
  }
  if (input.domain.kind === 'character-supplement') {
    const result = await adoptRestoredCharacterSupplementCandidateV1({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      snapshot: input.domain.snapshot,
      draft: input.output,
    })
    return { ...emptyAdoptResult(), written: [{ id: result.characterId, fields: result.fields }] }
  }
  if (input.domain.kind === 'story-arc') {
    const result = await adoptRestoredStoryArcCandidate({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      snapshot: input.domain.snapshot,
      draft: input.output,
      mutation: input.domain.mutation,
    })
    return {
      ...emptyAdoptResult(),
      written: result.ids.map(id => ({ id, fields: ['name', 'type', 'description', 'stages'] })),
    }
  }
  if (input.domain.kind === 'character-relation') {
    let candidate: Record<string, unknown>
    try {
      candidate = JSON.parse(input.output) as Record<string, unknown>
    } catch {
      throw new Error('角色关系候选必须是合法 JSON；请重新运行关系节点。')
    }
    const { candidateHash: _candidateHash, ...body } = candidate
    const computedHash = await hashCanonicalValue(body)
    if (
      candidate.kind !== 'character-relationship-candidate'
      || candidate.candidateHash !== input.domain.candidateHash
      || computedHash !== input.domain.candidateHash
      || !Array.isArray(candidate.relations)
      || candidate.relations.length !== input.domain.candidateCount
    ) throw new Error('角色关系候选已被编辑或证据不完整；请重新运行关系节点后再采纳。')
    const result = await adoptCharacterRelationshipCandidateV1({
      scope,
      runId: input.domain.producerRunId,
      selectedIndexes: Array.from({ length: input.domain.candidateCount }, (_, index) => index),
    })
    return {
      ...emptyAdoptResult(),
      written: Array.from({ length: result.written }, () => ({ id: 0, fields: ['relationType', 'label', 'description'] })),
    }
  }
  if (input.domain.kind === 'character') {
    const candidate = parseCharacterCandidateDraft(input.output)
    return adoptCharacterCopilotCandidate({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      snapshot: { serialized: input.domain.rosterSnapshot, visibleNames: [] },
      candidate,
    })
  }
  if (input.domain.kind === 'outline') {
    const result = await adoptRestoredOutlineCandidate({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      mode: input.domain.mode,
      parentVolumeId: input.domain.parentVolumeId,
      snapshot: input.domain.snapshot,
      draft: input.output,
    })
    const written = Array.from({ length: result.writtenCount }, (_, index) => ({
      id: index === 0 ? (result.firstId ?? 0) : 0,
      fields: ['title', 'summary'],
    }))
    return { ...emptyAdoptResult(), written, skipped: result.skippedReasons.map(reason => ({ reason, data: input.output })) }
  }
  if (input.domain.kind === 'detail') {
    const outlineNodeId = input.domain.outlineNodeId
    const current = await db.outlineNodes.get(outlineNodeId)
    if (!current
      || !await assertRecordInScope(scope, 'outlineNodes', current, { owner: 'work' })
      || current.summary !== input.domain.chapterSummary) {
      throw new Error('目标章纲已变化，请重新运行细纲节点后再采纳。')
    }
    const [characters, foreshadows] = await Promise.all([
      readOwnedRows<any>(scope, 'characters', { owner: 'world' }),
      readOwnedRows<any>(scope, 'foreshadows', { owner: 'work' }),
    ])
    const visibleCharacters = characters.filter(character => (
      Boolean(character.isCrossWorld) || (character.homeWorldGroupId ?? null) === input.worldGroupId
    ))
    const result = await adoptChapterOutlineWorkshopResult({
      raw: input.output,
      projectId: input.projectId,
      scope,
      outlineNodeId,
      chapterSummary: current.summary,
      validCharacterIds: new Set(visibleCharacters.flatMap(row => row.id == null ? [] : [row.id])),
      // 伏笔是项目级共享表，可跨世界引用；埋设/呼应/回收章节仍由其软引用处理。
      validForeshadowIds: new Set(foreshadows.flatMap(row => row.id == null ? [] : [row.id])),
    })
    if (!result.ok) throw new Error(result.reason ?? '细纲候选未能采纳。')
    const saved = (await readOwnedRows<any>(scope, 'detailedOutlines', { owner: 'work' }))
      .filter(row => row.outlineNodeId === outlineNodeId)
    const latest = saved.sort((left, right) => right.updatedAt - left.updatedAt)[0]
    return { ...emptyAdoptResult(), written: [{ id: latest?.id ?? 0, fields: ['scenes', 'openingHook', 'endingCliffhanger'] }] }
  }
  if (input.domain.kind === 'prose') {
    const result = await adoptRestoredProseCandidate({
      projectId: input.projectId,
      scope,
      worldGroupId: input.worldGroupId,
      operation: input.domain.operation,
      outlineNodeId: input.domain.outlineNodeId,
      snapshot: input.domain.snapshot,
      draft: input.output,
    })
    return { ...emptyAdoptResult(), written: [{ id: result.chapterId, fields: ['content'] }] }
  }
  if (input.domain.kind === 'chapter-organization') {
    let candidate: ChapterOrganizationCandidate
    try {
      candidate = JSON.parse(input.output) as ChapterOrganizationCandidate
    } catch {
      throw new Error('整理本章候选必须是合法 JSON；请先修正候选后再采纳。')
    }
    if (
      candidate.type !== 'chapter-organization'
      || candidate.projectId !== input.projectId
      || candidate.chapterId !== input.domain.chapterId
      || candidate.sourceTextHash !== input.domain.sourceTextHash
    ) {
      throw new Error('整理本章候选的项目、章节或来源 hash 不匹配，请重新运行节点。')
    }
    if (!await isChapterOrganizationCurrent(candidate)) {
      throw new Error('章节正文已变化，这批整理候选已过期；请重新运行“整理本章”。')
    }
    const run = await persistChapterOrganizationCandidate(candidate)
    const adopted = await adoptChapterOrganizationSelection({
      run,
      selection: selectAllChapterOrganizationCandidates(candidate),
    })
    const written = Object.entries(adopted.written).flatMap(([domain, count]) => (
      count > 0 ? [{ id: 0, fields: [domain] }] : []
    ))
    return { ...emptyAdoptResult(), written }
  }
  if (input.domain.kind === 'facts') {
    let candidates: Parameters<typeof adoptFactCandidates>[0]['candidates']
    try {
      const parsed = JSON.parse(input.output) as { facts?: unknown }
      const sourceChapter = await db.chapters.get(input.domain.chapterId)
      candidates = parseFactExtractResult({ raw: JSON.stringify(parsed), chapterContent: normalizeChapterText(sourceChapter?.content ?? '') })
    } catch {
      throw new Error('事实候选必须是合法 JSON；请先修正候选后再采纳。')
    }
    const chapter = await db.chapters.get(input.domain.chapterId)
    if (!chapter || !await assertRecordInScope(scope, 'chapters', chapter, { owner: 'work' })) {
      throw new Error('事实候选来源章节不存在或不属于当前作品。')
    }
    if (await hashChapterText(chapter.content || '') !== input.domain.sourceTextHash) {
      throw new Error('章节正文已变化，这批事实候选已过期；请重新运行事实节点。')
    }
    const result = await adoptFactCandidates({
      projectId: input.projectId,
      scope,
      sourceChapterId: input.domain.chapterId,
      worldGroupId: input.worldGroupId,
      candidates,
    })
    return { ...emptyAdoptResult(), written: result.written ? [{ id: 0, fields: ['temporalFacts'] }] : [] }
  }
  return null
}
