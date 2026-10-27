/** Optional immutable product context policy. It never grants knowledge, rule writes or player decisions. */
import * as p from './open-contract-parse'
import { TTRPG_OPEN_BASE_CONTEXT_SOURCES_V1, TTRPG_OPEN_CONTEXT_CONSUMERS_V1, type TtrpgOpenContextConsumerV1 } from './open-model-purpose-contract'
import { parseTtrpgContextTriggerDefinitionV1, TTRPG_CONTEXT_TEXT_NORMALIZATION_V1,
  type TtrpgContextTriggerV1 } from './context-trigger-contract'

export { TTRPG_OPEN_CONTEXT_CONSUMERS_V1, type TtrpgOpenContextConsumerV1 } from './open-model-purpose-contract'
export interface TtrpgOpenContextPolicyV1 {
  schema: 'storyforge.ttrpg-open-context-policy'
  version: 1
  normalization: typeof TTRPG_CONTEXT_TEXT_NORMALIZATION_V1
  maximumContextTokens: number
  cjkTextMatching: 'disabled' | 'explicit-phrase'
  triggers: Array<{ consumers: TtrpgOpenContextConsumerV1[]; trigger: TtrpgContextTriggerV1 }>
}

const sourcesFor = (consumer: TtrpgOpenContextConsumerV1): readonly string[] => TTRPG_OPEN_BASE_CONTEXT_SOURCES_V1[consumer]

export function parseTtrpgOpenContextPolicyV1(value: unknown): TtrpgOpenContextPolicyV1 {
  const r = p.record(p.json(value), ['schema', 'version', 'normalization', 'maximumContextTokens', 'cjkTextMatching', 'triggers'], 'contextPolicy')
  const cjkTextMatching = p.oneOf(r.cjkTextMatching, ['disabled', 'explicit-phrase'], 'contextPolicy.cjkTextMatching')
  const triggers = p.list(r.triggers, 'contextPolicy.triggers', (value, label) => {
    const row = p.record(value, ['consumers', 'trigger'], label)
    const consumers = p.unique(p.list(row.consumers, `${label}.consumers`, value => p.oneOf(value, TTRPG_OPEN_CONTEXT_CONSUMERS_V1, label), 3, 1), label)
    const trigger = parseTtrpgContextTriggerDefinitionV1(row.trigger)
    if (trigger.audience === 'gm-only' && consumers.some(c => c !== 'gm-assistant')) p.fail(`${label}: 主持私域指引不能用于角色或共同叙述`)
    if (trigger.audience !== 'private' && trigger.knownByActorKeys.length) p.fail(`${label}: 仅 private 指引声明接收者`)
    if (cjkTextMatching === 'disabled' && trigger.textPatterns.some(text => /[\u3400-\u9fff\uf900-\ufaff]/u.test(text))) {
      p.fail(`${label}: 中文短语匹配须由作者明确启用`)
    }
    // These are source-category dependencies, never a claim that a concrete fact was read.
    if (consumers.some(consumer => trigger.sourceRefs.some(key => !sourcesFor(consumer).includes(key)))) {
      p.fail(`${label}: 来源依赖超出本指引接收场景的登记读取范围`)
    }
    return { consumers, trigger }
  }, 256)
  p.unique(triggers.map(row => row.trigger.triggerKey), 'contextPolicy.triggerKey')
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-context-policy', 'contextPolicy.schema'),
    version: p.literal(r.version, 1, 'contextPolicy.version'),
    normalization: p.literal(r.normalization, TTRPG_CONTEXT_TEXT_NORMALIZATION_V1, 'contextPolicy.normalization'),
    maximumContextTokens: p.integer(r.maximumContextTokens, 'contextPolicy.maximumContextTokens', 256, 16000),
    cjkTextMatching, triggers }
}
