import type { AgentSkillDefinitionV1 } from './skill-registry'
import { getAgentToolSchemaSnapshotV1 } from './tool-registry'
import { hashCanonicalValue } from './run/hash'
import type { AgentSkillExecutionBindingV1 } from '../types/agent-run'

export const AGENT_EXECUTION_BINDING_VERSION_V1 = 1 as const
export const AGENT_TOOL_SCHEMA_VERSION_V1 = 'agent-read-tools-v2' as const
// Updated only together with AGENT_TOOL_SCHEMA_VERSION_V1 after the runtime
// snapshot and regression evidence have been reviewed.
export const AGENT_TOOL_SCHEMA_HASH_V1 = '7afce7157736be4d7376340e64227a87359282f0ccb10d1aa03a5a004726c3c7'

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
