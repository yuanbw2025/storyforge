import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

describe('R-OPEN-WORLD3 · StoryArchitecture生产契约', () => {
  it('登记唯一Context、Skill写目标与P3来源闭包', () => {
    const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1
      .find(item => item.taskKey === 'p3.story-architecture')!
    expect(task).toMatchObject({
      skillId: 'text-open-world.production.story-architecture.v1',
      dependsOn: ['p2.experience-design'],
      inputArtifactKeys: [
        'text-open-world.game-brief',
        'text-open-world.experience-contract',
        'text-open-world.protagonist-asset',
        'text-open-world.source-ledger',
        'text-open-world.source-gap-report',
      ],
      outputArtifactKeys: [
        'text-open-world.story-arc',
        'text-open-world.ending-contracts',
        'text-open-world.narrative-promises',
      ],
    })
    expect(getAgentSkillV1(task.skillId)).toMatchObject({
      contextSourceKeys: ['text-open-world.story-architecture-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
      regressionTests: ['R-OPEN-WORLD3-story-architecture'],
    })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.story-architecture-input')).toMatchObject({
      ownerFrom: 'work', layer: 'L0', protectedFromTrim: true,
    })
  })
})
