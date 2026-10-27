/** Routing is selected from the original verified execution snapshot, never the live registry. */
import type { AgentRunRecord } from '../types'
import { parseAgentRunContract } from '../agent/run/contract'
import { hashCanonicalValue } from '../agent/run/hash'
import { assertAgentSkillExecutionBindingIntegrityV2, projectFrozenAgentSkillDefinitionV1 } from '../agent/execution-binding'
import type { TtrpgOpenModelCallV1 } from './open-model-calls'

type Call = Pick<TtrpgOpenModelCallV1, 'skillId' | 'stepId' | 'runContractHash' | 'intentRoutingVersion'>
export function ttrpgOpenIntentRoutingVersionForSkillV1(skill: { id: string; promptVersion: string }): 1 | 2 {
  const kind = skill.id === 'prose.ttrpg-open-intent' ? 'intent' : skill.id === 'prose.ttrpg-open-companion' ? 'companion' : null
  const prefix = `ttrpg-open-${kind}-v`, version = kind && skill.promptVersion.startsWith(prefix) ? skill.promptVersion.slice(prefix.length) : ''
  if (/^[1-5]$/.test(version)) return 1
  if (version === '6') return 2
  throw Error('执行定义未声明受支持的行动识别版本，请保留原请求核对')
}
export async function ttrpgOpenIntentRoutingVersionForRunV1(run: AgentRunRecord, call: Call): Promise<1 | 2> {
  const kind = call.skillId === 'prose.ttrpg-open-intent' ? 'intent' : call.skillId === 'prose.ttrpg-open-companion' ? 'companion' : null
  const contract = parseAgentRunContract(JSON.parse(run.contractJson))
  if (!kind || run.contractHash !== call.runContractHash || await hashCanonicalValue(contract) !== call.runContractHash
    || !run.productRuntimeSessionId || contract.scope.runtime?.productRuntimeSessionId !== run.productRuntimeSessionId) throw Error('行动识别版本没有同一实例/角色/Skill 的真实运行契约，请保留原请求核对')
  const bindings = contract.executionBindings?.filter(row => row.stepId === call.stepId) ?? [], binding = bindings[0]
  if (bindings.length !== 1 || binding.skillId !== call.skillId) throw Error('行动识别版本必须绑定唯一原执行步骤')
  if (binding.version === 2) {
    await assertAgentSkillExecutionBindingIntegrityV2(binding)
    const definition = projectFrozenAgentSkillDefinitionV1(binding)
    if (definition.id !== call.skillId || definition.promptVersion !== binding.promptVersion) throw Error('原执行定义与行动识别版本不一致')
  }
  const prefix = `ttrpg-open-${kind}-v`, version = binding.promptVersion.startsWith(prefix) ? binding.promptVersion.slice(prefix.length) : ''
  const declared = ttrpgOpenIntentRoutingVersionForSkillV1({ id: call.skillId, promptVersion: binding.promptVersion })
  // The legacy V1 execution contract has no frozen definition/terminal routing
  // declaration. Its API stays on V1, including a newly prepared legacy Run.
  const expected = binding.version === 1 ? 1 : declared
  if ((call.intentRoutingVersion ?? 1) !== expected) throw Error('请求账本的行动识别版本未绑定原冻结执行定义')
  if (binding.version === 1 || /^[1-5]$/.test(version)) return 1
  if (version === '6' && binding.version === 2 && contract.verificationPlan?.some(row => row.kind === 'terminal'
    && row.verifier === binding.promptVersion && row.criterionIds.includes('intent.protocol'))) return 2
  throw Error('原执行定义未声明受支持的行动识别版本，请保留原请求核对')
}
