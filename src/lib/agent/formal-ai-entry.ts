import registryJson from './ai-entry-registry.json'
import { AGENT_SKILL_BY_ID, type AgentSkillDefinitionV1 } from './skill-registry'
import {
  chat,
  streamChat,
  type AICallMeta,
  type AIRequestConfigResolution,
  type ChatRequestOptions,
  type ChatResult,
  type StreamResult,
} from '../ai/client'
import type { AIConfig, ChatMessage } from '../types'
import type { AgentRunFormalAIEntryBindingV1 } from '../types/agent-run'
import { canonicalStringify, hashCanonicalValue } from './run/hash'
import { parseLimitedAITransports } from './limited-ai-transport'

export type FormalAIEntryKindV1 = 'formal' | 'auxiliary' | 'evaluation' | 'experimental'
export type FormalAIExecutionBoundaryV1 =
  | 'durable-run'
  | 'generation-node'
  | 'read-only'
  | 'authoring-draft'
  | 'eval-only'
  | 'experimental'
  | 'product-runtime'

export interface FormalAIEntryBindingV1 {
  version: 1
  entryId: string
  skillId: string
  categories: readonly string[]
  runContractBuilderId: string
  executionBoundary: FormalAIExecutionBoundaryV1
  entryKind: FormalAIEntryKindV1
  candidateKind: string
  adoptAllowed: boolean
  adoptionTargets: readonly string[]
  allowedCallers: readonly string[]
  reason: string
  /** Omitted legacy entries retain their exact frozen text binding. */
  outputModality?: 'audio'
}

export interface FormalAIEntryRegistryV1 {
  version: 2
  bindingVersion: 1
  scope: 'formal-ai-execution-entry'
  entries: readonly FormalAIEntryBindingV1[]
}

export type FormalAIEntryId = string
export type FormalAICallMetaV1 = AICallMeta & { formalEntryId: FormalAIEntryId }

const ENTRY_KEYS = new Set([
  'entryId', 'skillId', 'categories', 'runContractBuilderId', 'executionBoundary',
  'entryKind', 'candidateKind', 'adoptAllowed', 'adoptionTargets', 'allowedCallers', 'reason', 'outputModality',
])
const ENTRY_KINDS = new Set<FormalAIEntryKindV1>(['formal', 'auxiliary', 'evaluation', 'experimental'])
const EXECUTION_BOUNDARIES = new Set<FormalAIExecutionBoundaryV1>([
  'durable-run', 'generation-node', 'read-only', 'authoring-draft',
  'eval-only', 'experimental', 'product-runtime',
])

function fail(message: string): never {
  throw new Error(`FormalAIEntryBindingV1: ${message}`)
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} 必须是对象`)
  return value as Record<string, unknown>
}

function readString(record: Record<string, unknown>, key: string, path: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) fail(`${path}.${key} 必须是非空字符串`)
  return value
}

function readStringArray(record: Record<string, unknown>, key: string, path: string): string[] {
  const value = record[key]
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== 'string' || !item.trim())) {
    fail(`${path}.${key} 必须是非空字符串数组`)
  }
  const strings = value as string[]
  if (new Set(strings).size !== strings.length) fail(`${path}.${key} 不得重复`)
  return strings
}

function skillWriteTables(skill: AgentSkillDefinitionV1): string[] {
  return skill.writeTargets.map(target => target.table)
}

export function parseFormalAIEntryRegistryV1(
  value: unknown,
  skills: ReadonlyMap<string, AgentSkillDefinitionV1> = AGENT_SKILL_BY_ID,
): FormalAIEntryRegistryV1 {
  const root = asRecord(value, 'registry')
  const rootKeys = Object.keys(root).sort()
  const expectedRootKeys = ['bindingVersion', 'entries', 'scope', 'version']
  if ('limitedTransports' in root) expectedRootKeys.push('limitedTransports')
  if ('offlineEvaluations' in root) expectedRootKeys.push('offlineEvaluations')
  expectedRootKeys.sort()
  if (JSON.stringify(rootKeys) !== JSON.stringify(expectedRootKeys)) fail('registry 含未知或缺失字段')
  if (root.version !== 2 || root.bindingVersion !== 1 || root.scope !== 'formal-ai-execution-entry') {
    fail('registry 版本或 scope 无效')
  }
  if (!Array.isArray(root.entries) || root.entries.length === 0) fail('registry.entries 必须是非空数组')
  const transports = 'limitedTransports' in root ? parseLimitedAITransports(root.limitedTransports) : []

  const ids = new Set<string>()
  const entries = root.entries.map((raw, index): FormalAIEntryBindingV1 => {
    const path = `registry.entries[${index}]`
    const record = asRecord(raw, path)
    for (const key of Object.keys(record)) if (!ENTRY_KEYS.has(key)) fail(`${path} 含未知字段 ${key}`)
    const required = [...ENTRY_KEYS].filter(key => key !== 'adoptionTargets' && key !== 'outputModality')
    for (const key of required) if (!(key in record)) fail(`${path} 缺少字段 ${key}`)

    const entryId = readString(record, 'entryId', path)
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(entryId)) fail(`${path}.entryId 格式无效`)
    if (ids.has(entryId)) fail(`重复 entryId ${entryId}`)
    ids.add(entryId)

    const skillId = readString(record, 'skillId', path)
    const skill = skills.get(skillId)
    if (!skill) fail(`${entryId} 引用了未知 Skill ${skillId}`)
    const categories = readStringArray(record, 'categories', path)
    const runContractBuilderId = readString(record, 'runContractBuilderId', path)
    const executionBoundary = readString(record, 'executionBoundary', path) as FormalAIExecutionBoundaryV1
    const entryKind = readString(record, 'entryKind', path) as FormalAIEntryKindV1
    const candidateKind = readString(record, 'candidateKind', path)
    const allowedCallers = readStringArray(record, 'allowedCallers', path)
    const reason = readString(record, 'reason', path)
    if (!EXECUTION_BOUNDARIES.has(executionBoundary)) fail(`${entryId} executionBoundary 无效`)
    if (!ENTRY_KINDS.has(entryKind)) fail(`${entryId} entryKind 无效`)
    if (typeof record.adoptAllowed !== 'boolean') fail(`${entryId} adoptAllowed 必须是 boolean`)
    const adoptAllowed = record.adoptAllowed
    // freezeFormalAIEntryBindingV1 serializes the normalized binding shape,
    // including an explicit [] for entries that cannot adopt. Preserve that
    // canonical frozen form while still requiring a non-empty list whenever
    // adoption is enabled.
    const adoptionTargets = record.adoptionTargets === undefined
      ? []
      : Array.isArray(record.adoptionTargets) && record.adoptionTargets.length === 0
        ? []
        : readStringArray(record, 'adoptionTargets', path)

    if (categories.includes('*') && (categories.length !== 1 || entryKind !== 'experimental')) {
      fail(`${entryId} 只有 experimental 入口可以使用单独的 * category`)
    }
    if (['auxiliary', 'evaluation', 'experimental'].includes(entryKind) && adoptAllowed) {
      fail(`${entryId} 的 ${entryKind} 边界不得开放采纳`)
    }
    if (!adoptAllowed && adoptionTargets.length > 0) fail(`${entryId} 未开放采纳却声明 adoptionTargets`)
    if (adoptAllowed) {
      const declared = new Set(skillWriteTables(skill))
      if (adoptionTargets.length === 0) fail(`${entryId} 开放采纳但没有 adoptionTargets`)
      for (const target of adoptionTargets) {
        if (!declared.has(target)) fail(`${entryId} 的采纳目标 ${target} 不在 Skill ${skillId} 写集合中`)
      }
      if (adoptionTargets.length !== declared.size) fail(`${entryId} 未完整绑定 Skill ${skillId} 的写集合`)
    }
    if (entryKind === 'evaluation' && executionBoundary !== 'eval-only') {
      fail(`${entryId} evaluation 必须使用 eval-only 边界`)
    }
    if (entryKind === 'experimental' && executionBoundary !== 'experimental') {
      fail(`${entryId} experimental 必须使用 experimental 边界`)
    }
    const outputModality = record.outputModality === undefined ? undefined : record.outputModality
    if (outputModality !== undefined && (outputModality !== 'audio' || entryKind !== 'formal' || executionBoundary !== 'product-runtime'
      || adoptAllowed || adoptionTargets.length || skill.writeTargets.length || skill.readToolNames.length)) fail(`${entryId} 音频入口必须是无工具、无写回和无自动采用的正式产品候选`)

    return {
      version: 1,
      entryId,
      skillId,
      categories,
      runContractBuilderId,
      executionBoundary,
      entryKind,
      candidateKind,
      adoptAllowed,
      adoptionTargets,
      allowedCallers,
      reason,
      ...(outputModality === undefined ? {} : { outputModality: 'audio' as const }),
    }
  })

  if (transports.some((entry) => ids.has(entry.entryId))) fail('有限语音入口不得与正式入口重名')
  if ('offlineEvaluations' in root) {
    if (!Array.isArray(root.offlineEvaluations)) fail('离线评测入口必须是数组')
    const offlineIds = new Set<string>()
    const keys = ['adoptAllowed', 'boundary', 'caller', 'contract', 'entryId', 'reason', 'transport']
    for (const raw of root.offlineEvaluations) {
      const entry = asRecord(raw, '离线评测入口')
      if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(keys)
        || entry.adoptAllowed !== false || entry.boundary !== 'eval-only' || entry.transport !== 'local-codex-subscription') {
        fail('离线评测入口不得获得作品采纳或正式执行权限')
      }
      const id = readString(entry, 'entryId', '离线评测入口')
      if (!/^eval\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id) || ids.has(id) || offlineIds.has(id)
        || transports.some(transport => transport.entryId === id)) fail('离线评测入口身份无效或重复')
      if (!/^scripts\/evaluate-[a-z-]+\.mjs$/.test(readString(entry, 'caller', '离线评测入口'))
        || !/^scripts\/[a-z-]+-contract\.mjs$/.test(readString(entry, 'contract', '离线评测入口'))) fail('离线评测只能绑定仓库评测脚本')
      readString(entry, 'reason', '离线评测入口')
      offlineIds.add(id)
    }
  }
  // Transports cannot enter a frozen creative binding or acquire its write authority.
  // Offline evaluations likewise have no binding in the creative executor.
  return { version: 2, bindingVersion: 1, scope: 'formal-ai-execution-entry', entries }
}

export const FORMAL_AI_ENTRY_REGISTRY_V1 = parseFormalAIEntryRegistryV1(registryJson)
export const FORMAL_AI_ENTRY_BY_ID_V1: ReadonlyMap<string, FormalAIEntryBindingV1> = new Map(
  FORMAL_AI_ENTRY_REGISTRY_V1.entries.map(entry => [entry.entryId, entry]),
)

export function getFormalAIEntryBindingV1(entryId: FormalAIEntryId): FormalAIEntryBindingV1 {
  const binding = FORMAL_AI_ENTRY_BY_ID_V1.get(entryId)
  if (!binding) fail(`未登记正式 AI 入口 ${entryId}`)
  return binding
}

export async function freezeFormalAIEntryBindingV1(
  entryId: FormalAIEntryId,
): Promise<AgentRunFormalAIEntryBindingV1> {
  const binding = getFormalAIEntryBindingV1(entryId)
  const { version: _version, ...body } = binding
  return {
    version: 1,
    entryId: binding.entryId,
    bindingJson: canonicalStringify(body),
    bindingHash: await hashCanonicalValue(body),
  }
}

export async function assertFormalAIEntrySnapshotIntegrityV1(
  snapshot: AgentRunFormalAIEntryBindingV1,
  skills: ReadonlyMap<string, AgentSkillDefinitionV1> = AGENT_SKILL_BY_ID,
): Promise<FormalAIEntryBindingV1> {
  if (snapshot.version !== 1 || snapshot.entryId.length === 0) fail('Run formal entry snapshot 版本无效')
  const parsed = JSON.parse(snapshot.bindingJson) as unknown
  const registry = parseFormalAIEntryRegistryV1({
    version: 2,
    bindingVersion: 1,
    scope: 'formal-ai-execution-entry',
    entries: [parsed],
  }, skills)
  const binding = registry.entries[0]
  const { version: _version, ...body } = binding
  if (binding.entryId !== snapshot.entryId) fail('Run formal entry snapshot 的 entryId 不匹配')
  if (canonicalStringify(body) !== snapshot.bindingJson) fail('Run formal entry snapshot 不是规范序列化')
  if (await hashCanonicalValue(body) !== snapshot.bindingHash) fail('Run formal entry snapshot hash 不匹配')
  return binding
}

export function assertFormalAIEntryCallV1(meta: FormalAICallMetaV1): FormalAIEntryBindingV1 {
  const binding = getFormalAIEntryBindingV1(meta.formalEntryId)
  const category = meta.category ?? ''
  if (!binding.categories.includes('*') && !binding.categories.includes(category)) {
    fail(`${binding.entryId} 不允许 category ${category || '<empty>'}`)
  }
  return binding
}

export async function executeRegisteredAIEntryV1(
  entryId: FormalAIEntryId,
  messages: ChatMessage[],
  config: AIConfig,
  meta: AICallMeta,
  signal?: AbortSignal,
  result?: ChatResult,
  options?: ChatRequestOptions,
  frozenResolution?: AIRequestConfigResolution,
): Promise<string> {
  const governedMeta: FormalAICallMetaV1 = { ...meta, formalEntryId: entryId }
  if (assertFormalAIEntryCallV1(governedMeta).outputModality !== undefined) fail(`${entryId} 音频入口不得借用文本模型执行器`)
  return chat(messages, config, governedMeta, signal, result, options, frozenResolution)
}

/**
 * Execute a durable Run's frozen formal entry without consulting the live
 * registry. Recovery must remain executable after a registry release changes,
 * while still proving the frozen Skill, category and caller authority.
 */
export async function executeFrozenFormalAIEntryV1(
  entryId: FormalAIEntryId,
  snapshot: AgentRunFormalAIEntryBindingV1,
  frozenSkill: AgentSkillDefinitionV1,
  caller: string,
  messages: ChatMessage[],
  config: AIConfig,
  meta: AICallMeta,
  signal?: AbortSignal,
  result?: ChatResult,
  options?: ChatRequestOptions,
  frozenResolution?: AIRequestConfigResolution,
): Promise<string> {
  const binding = await assertFormalAIEntrySnapshotIntegrityV1(
    snapshot,
    new Map([[frozenSkill.id, frozenSkill]]),
  )
  const category = meta.category ?? ''
  if (binding.entryId !== entryId
    || binding.skillId !== frozenSkill.id
    || (!binding.categories.includes('*') && !binding.categories.includes(category))
    || !binding.allowedCallers.includes(caller)) {
    fail(`${entryId} 的冻结入口、Skill、category 或 caller 权限不匹配`)
  }
  if (binding.outputModality !== undefined) fail(`${entryId} 音频入口不得借用文本模型执行器`)
  const governedMeta: FormalAICallMetaV1 = { ...meta, formalEntryId: binding.entryId }
  return chat(messages, config, governedMeta, signal, result, options, frozenResolution)
}

/** Non-text dispatch still requires the exact frozen entry/Skill/caller. The
 * product owns its durable attempt, offline transport, byte limits and raw
 * response. No Chat API, token fabrication, retry, playback or adoption here. */
export async function executeFrozenFormalAudioEntryV1<T>(
  entryId: FormalAIEntryId,
  snapshot: AgentRunFormalAIEntryBindingV1,
  frozenSkill: AgentSkillDefinitionV1,
  caller: string,
  invoke: () => Promise<T>,
  meta: AICallMeta,
  signal?: AbortSignal,
): Promise<T> {
  const binding = await assertFormalAIEntrySnapshotIntegrityV1(snapshot, new Map([[frozenSkill.id, frozenSkill]]))
  if (binding.entryId !== entryId || binding.skillId !== frozenSkill.id || binding.outputModality !== 'audio'
    || !binding.allowedCallers.includes(caller) || !binding.categories.includes(meta.category ?? '')) fail(`${entryId} 的冻结音频入口、Skill、category 或 caller 权限不匹配`)
  signal?.throwIfAborted()
  return invoke()
}

export async function* streamRegisteredAIEntryV1(
  messages: ChatMessage[],
  config: AIConfig,
  meta: FormalAICallMetaV1,
  signal?: AbortSignal,
  result?: StreamResult,
  frozenResolution?: AIRequestConfigResolution,
): AsyncGenerator<string> {
  if (assertFormalAIEntryCallV1(meta).outputModality !== undefined) fail(`${meta.formalEntryId} 音频入口不得借用文本模型执行器`)
  yield* streamChat(messages, config, signal, result, meta, frozenResolution)
}
