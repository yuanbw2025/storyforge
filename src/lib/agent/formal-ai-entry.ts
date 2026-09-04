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
  'entryKind', 'candidateKind', 'adoptAllowed', 'adoptionTargets', 'allowedCallers', 'reason',
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
  if (JSON.stringify(rootKeys) !== JSON.stringify(expectedRootKeys)) fail('registry 含未知或缺失字段')
  if (root.version !== 2 || root.bindingVersion !== 1 || root.scope !== 'formal-ai-execution-entry') {
    fail('registry 版本或 scope 无效')
  }
  if (!Array.isArray(root.entries) || root.entries.length === 0) fail('registry.entries 必须是非空数组')

  const ids = new Set<string>()
  const entries = root.entries.map((raw, index): FormalAIEntryBindingV1 => {
    const path = `registry.entries[${index}]`
    const record = asRecord(raw, path)
    for (const key of Object.keys(record)) if (!ENTRY_KEYS.has(key)) fail(`${path} 含未知字段 ${key}`)
    const required = [...ENTRY_KEYS].filter(key => key !== 'adoptionTargets')
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
    const adoptionTargets = record.adoptionTargets === undefined
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
    }
  })

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
): Promise<FormalAIEntryBindingV1> {
  if (snapshot.version !== 1 || snapshot.entryId.length === 0) fail('Run formal entry snapshot 版本无效')
  const parsed = JSON.parse(snapshot.bindingJson) as unknown
  const registry = parseFormalAIEntryRegistryV1({
    version: 2,
    bindingVersion: 1,
    scope: 'formal-ai-execution-entry',
    entries: [parsed],
  })
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
  assertFormalAIEntryCallV1(governedMeta)
  return chat(messages, config, governedMeta, signal, result, options, frozenResolution)
}

export async function* streamRegisteredAIEntryV1(
  messages: ChatMessage[],
  config: AIConfig,
  meta: FormalAICallMetaV1,
  signal?: AbortSignal,
  result?: StreamResult,
): AsyncGenerator<string> {
  assertFormalAIEntryCallV1(meta)
  yield* streamChat(messages, config, signal, result, meta)
}
