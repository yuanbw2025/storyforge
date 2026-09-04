import type { AgentSkillDefinitionV1 } from '../agent/skill-registry'
import { AGENT_TOOL_BY_NAME } from '../agent/tool-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../registry/context-sources'
import type { ContextAccessPolicyV1, ContextResourceKind } from '../registry/types'
import { getContextSelectorPolicyV1 } from './selector'

export class ContextGatewaySkillPolicyErrorV1 extends Error {
  constructor(message: string) {
    super(`[context-gateway-skill-policy] ${message}`)
    this.name = 'ContextGatewaySkillPolicyErrorV1'
  }
}

function fail(message: string): never {
  throw new ContextGatewaySkillPolicyErrorV1(message)
}

export function assertAgentSkillContextGatewayPolicyV1(
  skill: AgentSkillDefinitionV1,
): NonNullable<AgentSkillDefinitionV1['contextGateway']> {
  const gateway = skill.contextGateway
  if (!gateway) fail(`Skill ${skill.id} 尚未声明 Context Gateway 权限`)
  if (gateway.version !== 1 || gateway.rollout !== 'required') {
    fail(`Skill ${skill.id} 的 Gateway version/rollout 无效`)
  }
  const registeredTargets = new Set(skill.writeTargets.flatMap(target => (
    target.fields.map(field => `${target.table}.${field}`)
  )))
  if (
    gateway.requiredWriteTargets !== undefined
    && (
      !Array.isArray(gateway.requiredWriteTargets)
      || new Set(gateway.requiredWriteTargets).size !== gateway.requiredWriteTargets.length
      || gateway.requiredWriteTargets.some(target => !registeredTargets.has(target))
    )
  ) fail(`Skill ${skill.id} 的 Gateway requiredWriteTargets 必须是已登记且不重复的写目标`)
  for (const sourceKey of gateway.providerSourceKeys) {
    if (!CONTEXT_SOURCE_BY_KEY.get(sourceKey)?.resources) fail(`Skill ${skill.id} 的 ${sourceKey} 未挂 Provider`)
  }
  for (const name of gateway.additionalReadToolNames) {
    const tool = AGENT_TOOL_BY_NAME.get(name)
    if (!tool || tool.risk !== 'read' || ![
      'list_context_catalog', 'search_context', 'read_context_resource', 'read_original_evidence',
    ].includes(name)) {
      fail(`Skill ${skill.id} 未获 Gateway 工具 ${name}`)
    }
  }
  return gateway
}

export function isContextGatewayRequiredForWriteTargetV1(
  skill: AgentSkillDefinitionV1,
  writeTarget?: string,
): boolean {
  const gateway = skill.contextGateway
  if (!gateway) return false
  if (gateway.rollout === 'required') return true
  return writeTarget != null && gateway.requiredWriteTargets?.includes(writeTarget) === true
}

export function createContextAccessPolicyFromSkillV1(
  skill: AgentSkillDefinitionV1,
): ContextAccessPolicyV1 {
  const gateway = assertAgentSkillContextGatewayPolicyV1(skill)
  return {
    version: 'context-access-policy-v1',
    policyId: `skill-${skill.id}-${skill.promptVersion}-gateway-v1`,
    // A provider may legitimately be empty in a new project. Mandatory evidence
    // is expressed by resource/target obligations, not provider presence.
    mandatorySourceKeys: [],
    allowedSourceKeys: [...gateway.providerSourceKeys],
    allowedResourceKinds: [...gateway.allowedResourceKinds],
    allowedDepths: [...gateway.allowedDepths],
    selectorPolicyId: getContextSelectorPolicyV1(skill.contextTaskKind).selectorPolicyId,
    maxReadCalls: gateway.maxReadCalls,
    maxRetrievedTokens: gateway.maxRetrievedTokens,
    allowOriginalRead: gateway.allowOriginalRead,
    candidateAccess: 'forbidden',
  }
}

/** Rebuild the exact runtime policy used by a Gateway execution. Callers may
 * only narrow the Skill-declared resource kinds; they cannot grant themselves
 * an undeclared kind. Adoption uses this same function so a legitimate
 * narrowed run is not mistaken for a policy change after refresh. */
export function createContextAccessPolicyForExecutionV1(
  skill: AgentSkillDefinitionV1,
  excludedResourceKinds: readonly ContextResourceKind[] = [],
): ContextAccessPolicyV1 {
  const declared = createContextAccessPolicyFromSkillV1(skill)
  const excluded = new Set(excludedResourceKinds)
  // Adjacent worlds are exposed only by the explicit channel task. Normal
  // worldview/character/story/prose work cannot gain one-hop access merely
  // because a world-link happens to exist in the catalog.
  if (skill.executionMode !== 'world-link-context') excluded.add('world-link')
  return {
    ...declared,
    allowedResourceKinds: declared.allowedResourceKinds.filter(kind => !excluded.has(kind)),
  }
}

export function contextGatewayAdditionalReadToolNamesForSkillV1(
  skill: AgentSkillDefinitionV1,
): readonly string[] {
  return [...assertAgentSkillContextGatewayPolicyV1(skill).additionalReadToolNames]
}
