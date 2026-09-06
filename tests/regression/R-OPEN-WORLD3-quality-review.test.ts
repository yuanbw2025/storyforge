import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'

describe('R-OPEN-WORLD3-quality-review · 确定性预检与双模型评审合同', () => {
  it('强制V1先行，并让双评审进入V3前的同一依赖闭包', () => {
    for (const key of ['text-open-world.balance-review-input', 'text-open-world.semantic-review-input']) {
      expect(CONTEXT_SOURCE_BY_KEY.get(key)).toMatchObject({ atomic: true, protectedFromTrim: true })
    }
    expect(getAgentSkillV1('text-open-world.production.balance-review.v1').contextSourceKeys)
      .toEqual(['text-open-world.balance-review-input'])
    expect(getAgentSkillV1('text-open-world.production.semantic-review.v1').contextSourceKeys)
      .toEqual(['text-open-world.semantic-review-input'])
    const byKey = new Map(TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.map(task => [task.taskKey, task]))
    expect(byKey.get('v1.deterministic-preflight')).toMatchObject({ executionMode: 'deterministic', dependsOn: ['p10.system-finalize'] })
    expect(byKey.get('v2.balance-review')?.dependsOn).toContain('v1.deterministic-preflight')
    expect(byKey.get('v2.semantic-review')?.dependsOn).toContain('v1.deterministic-preflight')
    expect(byKey.get('v3.runtime-package')?.dependsOn).toEqual(expect.arrayContaining(['v2.balance-review', 'v2.semantic-review']))
  })
})
