import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'

describe('R-OPEN-WORLD3-system-finalize · P2表现与P10系统收口合同', () => {
  it('登记原子Context、正式Skill和完整P10输入输出边界', () => {
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.presentation-profile-input')).toMatchObject({ atomic: true, protectedFromTrim: true })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.system-finalize-input')).toMatchObject({ atomic: true, protectedFromTrim: true })
    expect(getAgentSkillV1('text-open-world.production.presentation-profile.v1').contextSourceKeys)
      .toEqual(['text-open-world.presentation-profile-input'])
    expect(getAgentSkillV1('text-open-world.production.system-finalize.v1').contextSourceKeys)
      .toEqual(['text-open-world.system-finalize-input'])
    const p10 = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(task => task.taskKey === 'p10.system-finalize')!
    expect(p10.inputArtifactKeys).toContain('text-open-world.gameplay-ruleset-skeleton')
    expect(p10.inputArtifactKeys).toContain('text-open-world.action-bindings')
    expect(p10.outputArtifactKeys).toEqual([
      'text-open-world.system-configs', 'text-open-world.media-requirements', 'text-open-world.content-budget',
    ])
  })
})
