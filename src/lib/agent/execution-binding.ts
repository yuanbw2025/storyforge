import type { AgentSkillDefinitionV1 } from './skill-registry'
import { resolveAgentSkillContextSourceKeysV1 } from './skill-registry'
import { getAgentToolSchemaSnapshotV1 } from './tool-registry'
import { canonicalStringify, hashCanonicalValue } from './run/hash'
import type {
  AgentOptionalContextActivationV2,
  AgentRunWriteTargetV1,
  AgentSkillExecutionBindingV1,
  AgentSkillExecutionBindingV2,
  AgentRunWriteMode,
} from '../types/agent-run'
import type { AssembleContextResult } from '../registry/types'

export const AGENT_EXECUTION_BINDING_VERSION_V1 = 1 as const
export const AGENT_TOOL_SCHEMA_VERSION_V1 = 'agent-read-tools-v4' as const
// Updated only together with AGENT_TOOL_SCHEMA_VERSION_V1 after the runtime
// snapshot and regression evidence have been reviewed.
export const AGENT_TOOL_SCHEMA_HASH_V1 = 'cf43c625b3c1051f49aadbb66822f77341018f9a0c795436c68a08ba3125d76a'

export type AgentSkillDefinitionV2 = Omit<AgentSkillDefinitionV1, 'version'> & {
  version: 2
  sourceDefinitionVersion: 1
  resolvedToolSourceKeys: readonly string[]
}

export interface AgentSkillWriteSelectionV2 {
  table: string
  fields: readonly string[]
  mode: AgentRunWriteMode
  adoptionExtension?: string
}

export interface CreateAgentSkillExecutionBindingV2Input {
  optionalContextActivations?: readonly AgentOptionalContextActivationV2[]
  writeTargets?: readonly AgentSkillWriteSelectionV2[]
}

function failV2(message: string): never {
  throw new Error(`[agent-skill-binding-v2] ${message}`)
}

function toSkillDefinitionV2(skill: AgentSkillDefinitionV1): AgentSkillDefinitionV2 {
  const directSources = new Set(skill.contextSourceKeys)
  return {
    ...skill,
    version: 2,
    sourceDefinitionVersion: 1,
    resolvedToolSourceKeys: resolveAgentSkillContextSourceKeysV1(skill, { includeGatewayProviders: true })
      .filter(sourceKey => !directSources.has(sourceKey)),
  }
}

function contextAccessPolicyBodyV2(skill: AgentSkillDefinitionV2) {
  return {
    version: 2,
    skillId: skill.id,
    readToolNames: skill.readToolNames,
    resolvedToolSourceKeys: skill.resolvedToolSourceKeys,
    contextSourceKeys: skill.contextSourceKeys,
    optionalContextSourceKeys: skill.optionalContextSourceKeys,
    inputPolicy: skill.inputPolicy,
    contextCompression: skill.contextCompression,
    ...(skill.contextGateway ? { contextGateway: skill.contextGateway } : {}),
    writeTargets: skill.writeTargets,
  }
}

function normalizeActivations(
  skill: Pick<AgentSkillDefinitionV1, 'id' | 'optionalContextSourceKeys'>,
  activations: readonly AgentOptionalContextActivationV2[],
): AgentOptionalContextActivationV2[] {
  const allowed = new Set(skill.optionalContextSourceKeys)
  const seen = new Set<string>()
  return activations.map(activation => {
    if (!allowed.has(activation.sourceKey)) {
      failV2(`${skill.id} 未授权 optional source ${activation.sourceKey}`)
    }
    if (seen.has(activation.sourceKey)) failV2(`${skill.id} 重复激活 ${activation.sourceKey}`)
    seen.add(activation.sourceKey)
    if (!['perspective-character', 'prior-outline-candidate', 'explicit-runtime-boundary'].includes(activation.reasonCode)) {
      failV2(`${skill.id} optional source ${activation.sourceKey} 的 reasonCode 无效`)
    }
    if (activation.boundaryHash !== undefined && !/^[0-9a-f]{64}$/.test(activation.boundaryHash)) {
      failV2(`${skill.id} optional source ${activation.sourceKey} 的 boundaryHash 无效`)
    }
    return {
      sourceKey: activation.sourceKey,
      reasonCode: activation.reasonCode,
      ...(activation.boundaryHash ? { boundaryHash: activation.boundaryHash } : {}),
    }
  }).sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))
}

function normalizeWriteTargets(
  skill: Pick<AgentSkillDefinitionV1, 'id' | 'writeTargets'>,
  selected: readonly AgentSkillWriteSelectionV2[],
): AgentRunWriteTargetV1[] {
  const seen = new Set<string>()
  return selected.map(target => {
    const declared = skill.writeTargets.find(item => (
      item.table === target.table
        && (item.adoptionExtension ?? '') === (target.adoptionExtension ?? '')
    ))
    if (!declared) failV2(`${skill.id} 未授权写目标 ${target.table}`)
    const allowedFields = new Set(declared.fields)
    const fields = [...new Set(target.fields)]
    for (const field of fields) {
      if (!allowedFields.has(field)) failV2(`${skill.id} 未授权写字段 ${target.table}.${field}`)
    }
    if (target.mode === 'none' && fields.length > 0) {
      failV2(`${skill.id} mode=none 不得包含写字段`)
    }
    if (target.mode !== 'none' && fields.length === 0 && !target.adoptionExtension) {
      failV2(`${skill.id} 可写目标 ${target.table} 缺少字段或 adoption extension`)
    }
    const identity = `${target.table}:${target.adoptionExtension ?? ''}`
    if (seen.has(identity)) failV2(`${skill.id} 重复写目标 ${identity}`)
    seen.add(identity)
    return {
      table: target.table,
      fields,
      mode: target.mode,
      ...(target.adoptionExtension ? { adoptionExtension: target.adoptionExtension } : {}),
    }
  }).sort((left, right) => (
    `${left.table}:${left.adoptionExtension ?? ''}`.localeCompare(`${right.table}:${right.adoptionExtension ?? ''}`)
  ))
}

export async function createAgentSkillExecutionBindingV2(
  skill: AgentSkillDefinitionV1,
  input: CreateAgentSkillExecutionBindingV2Input = {},
): Promise<AgentSkillExecutionBindingV2> {
  const definition = toSkillDefinitionV2(skill)
  const skillDefinitionJson = canonicalStringify(definition)
  const activations = normalizeActivations(skill, input.optionalContextActivations ?? [])
  const activated = new Set(activations.map(item => item.sourceKey))
  const contextSourceKeys = [
    ...definition.resolvedToolSourceKeys,
    ...skill.contextSourceKeys,
    ...skill.optionalContextSourceKeys.filter(sourceKey => activated.has(sourceKey)),
  ]
  const writeTargets = normalizeWriteTargets(skill, input.writeTargets ?? [])
  return {
    version: 2,
    skillId: skill.id,
    skillVersion: 2,
    skillDefinitionJson,
    skillDefinitionHash: await hashCanonicalValue(definition),
    contextAccessPolicyHash: await hashCanonicalValue(contextAccessPolicyBodyV2(definition)),
    promptVersion: skill.promptVersion,
    toolSchemaVersion: AGENT_TOOL_SCHEMA_VERSION_V1,
    toolSchemaHash: AGENT_TOOL_SCHEMA_HASH_V1,
    contextSourceKeys,
    optionalContextActivations: activations,
    writeTargets,
    maxOutputTokens: skill.maxOutputTokens,
  }
}

function parseDefinitionJsonV2(binding: AgentSkillExecutionBindingV2): AgentSkillDefinitionV2 {
  let value: unknown
  try {
    value = JSON.parse(binding.skillDefinitionJson)
  } catch {
    failV2(`${binding.skillId} 的 skillDefinitionJson 不是合法 JSON`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failV2(`${binding.skillId} 的 Skill definition snapshot 无效`)
  }
  const definition = value as AgentSkillDefinitionV2
  if (definition.version !== 2 || definition.sourceDefinitionVersion !== 1 || definition.id !== binding.skillId) {
    failV2(`${binding.skillId} 的 Skill definition snapshot 身份无效`)
  }
  return definition
}

function assertFrozenGatewayPolicyV1(definition: AgentSkillDefinitionV2): void {
  const gateway = definition.contextGateway
  if (gateway == null) return
  const required = [
    'version', 'rollout', 'providerSourceKeys', 'allowedResourceKinds', 'allowedDepths',
    'maxReadCalls', 'maxRetrievedTokens', 'maxPlanningSteps', 'maxPlanningModelTokens',
    'allowOriginalRead', 'additionalReadToolNames',
  ]
  const allowed = [...required, 'requiredWriteTargets']
  if (required.some(key => !Object.prototype.hasOwnProperty.call(gateway, key))
    || Object.keys(gateway).some(key => !allowed.includes(key))
    || gateway.version !== 1
    || !['shadow', 'required'].includes(gateway.rollout)
    || typeof gateway.allowOriginalRead !== 'boolean') {
    failV2(`${definition.id} 的冻结 Context Gateway policy 结构无效`)
  }
  if (gateway.requiredWriteTargets !== undefined && (
    !Array.isArray(gateway.requiredWriteTargets)
    || gateway.requiredWriteTargets.some(value => typeof value !== 'string' || !value)
    || new Set(gateway.requiredWriteTargets).size !== gateway.requiredWriteTargets.length
  )) failV2(`${definition.id} 的冻结 Context Gateway requiredWriteTargets 无效`)
  for (const [label, values] of [
    ['providerSourceKeys', gateway.providerSourceKeys],
    ['allowedResourceKinds', gateway.allowedResourceKinds],
    ['allowedDepths', gateway.allowedDepths],
    ['additionalReadToolNames', gateway.additionalReadToolNames],
  ] as const) {
    if (!Array.isArray(values) || values.length === 0
      || values.some(value => typeof value !== 'string' || !value)
      || new Set(values).size !== values.length) {
      failV2(`${definition.id} 的冻结 Context Gateway ${label} 无效`)
    }
  }
  for (const value of [
    gateway.maxReadCalls, gateway.maxRetrievedTokens,
    gateway.maxPlanningSteps, gateway.maxPlanningModelTokens,
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      failV2(`${definition.id} 的冻结 Context Gateway budget 无效`)
    }
  }
  if (gateway.allowedDepths.includes('original') && !gateway.allowOriginalRead) {
    failV2(`${definition.id} 的冻结 Context Gateway original 权限冲突`)
  }
}

function writeTargetsEqual(left: readonly AgentRunWriteTargetV1[], right: readonly AgentRunWriteTargetV1[]): boolean {
  return canonicalStringify(left) === canonicalStringify(right)
}

/** Verify a frozen V2 binding without consulting the mutable live registry. */
export async function assertAgentSkillExecutionBindingIntegrityV2(
  binding: AgentSkillExecutionBindingV2,
  label = 'Agent Skill execution binding v2',
): Promise<void> {
  if (binding.version !== 2 || binding.skillVersion !== 2) failV2(`${label} 版本无效`)
  if (!binding.toolSchemaVersion.trim() || !/^[a-f0-9]{64}$/.test(binding.toolSchemaHash)) {
    failV2(`${label} tool schema 快照无效`)
  }
  const definition = parseDefinitionJsonV2(binding)
  assertFrozenGatewayPolicyV1(definition)
  if (canonicalStringify(definition) !== binding.skillDefinitionJson) {
    failV2(`${label} Skill definition JSON 不是规范序列化`)
  }
  if (await hashCanonicalValue(definition) !== binding.skillDefinitionHash) {
    failV2(`${label} skillDefinitionHash 不匹配`)
  }
  if (await hashCanonicalValue(contextAccessPolicyBodyV2(definition)) !== binding.contextAccessPolicyHash) {
    failV2(`${label} contextAccessPolicyHash 不匹配`)
  }
  if (definition.promptVersion !== binding.promptVersion || definition.maxOutputTokens !== binding.maxOutputTokens) {
    failV2(`${label} Prompt 或输出预算未绑定到 Skill snapshot`)
  }
  const activations = normalizeActivations(definition, binding.optionalContextActivations)
  if (canonicalStringify(activations) !== canonicalStringify(binding.optionalContextActivations)) {
    failV2(`${label} optional source activation 不是规范顺序`)
  }
  const activated = new Set(activations.map(item => item.sourceKey))
  const expectedSources = [
    ...definition.resolvedToolSourceKeys,
    ...definition.contextSourceKeys,
    ...definition.optionalContextSourceKeys.filter(sourceKey => activated.has(sourceKey)),
  ]
  if (canonicalStringify(expectedSources) !== canonicalStringify(binding.contextSourceKeys)) {
    failV2(`${label} contextSourceKeys 不是 Skill snapshot 的精确派生集合`)
  }
  const selected = binding.writeTargets.map(target => ({
    table: target.table,
    fields: target.fields,
    mode: target.mode,
    ...(target.adoptionExtension ? { adoptionExtension: target.adoptionExtension } : {}),
  }))
  const normalizedWrites = normalizeWriteTargets(definition, selected)
  if (!writeTargetsEqual(normalizedWrites, binding.writeTargets)) {
    failV2(`${label} writeTargets 不是 Skill snapshot 的规范子集`)
  }
}

export function assertAgentSkillBindingMatchesAssemblyV2(
  binding: AgentSkillExecutionBindingV2,
  assembled: AssembleContextResult,
  label = 'Agent Skill binding/assembly',
): void {
  const observed = assembled.sourceEvidence?.map(item => item.key)
    ?? [...new Set([...assembled.included, ...assembled.omitted, ...assembled.trimmed])]
  const expected = [...binding.contextSourceKeys].sort()
  const actual = [...new Set(observed)].sort()
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    failV2(`${label} 实际来源集合与冻结 Skill binding 不相等`)
  }
}

export function createAgentSkillExecutionBindingV1(
  skill: AgentSkillDefinitionV1,
): AgentSkillExecutionBindingV1 {
  return {
    version: AGENT_EXECUTION_BINDING_VERSION_V1,
    skillId: skill.id,
    skillVersion: skill.version,
    promptVersion: skill.promptVersion,
    toolSchemaVersion: AGENT_TOOL_SCHEMA_VERSION_V1,
    toolSchemaHash: AGENT_TOOL_SCHEMA_HASH_V1,
  }
}

export function assertAgentSkillExecutionBindingV1(
  binding: AgentSkillExecutionBindingV1,
  skill: AgentSkillDefinitionV1,
  label = 'Agent execution binding',
): void {
  const exactKeys = [
    'version',
    'skillId',
    'skillVersion',
    'promptVersion',
    'toolSchemaVersion',
    'toolSchemaHash',
  ]
  if (
    !binding
    || typeof binding !== 'object'
    || Array.isArray(binding)
    || Object.keys(binding).length !== exactKeys.length
    || Object.keys(binding).some(key => !exactKeys.includes(key))
    || binding.version !== AGENT_EXECUTION_BINDING_VERSION_V1
    || binding.skillId !== skill.id
    || binding.skillVersion !== skill.version
    || binding.promptVersion !== skill.promptVersion
    || binding.toolSchemaVersion !== AGENT_TOOL_SCHEMA_VERSION_V1
    || binding.toolSchemaHash !== AGENT_TOOL_SCHEMA_HASH_V1
  ) throw new Error(`${label} 与当前 Skill/Prompt/Tool 版本不一致`)
}

export async function verifyAgentToolSchemaBindingV1(): Promise<boolean> {
  return await hashCanonicalValue(getAgentToolSchemaSnapshotV1()) === AGENT_TOOL_SCHEMA_HASH_V1
}
