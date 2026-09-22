import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

describe('R-OPEN-WORLD3 · Mainline生产契约', () => {
  it('登记唯一Context、Skill写目标与P5完整上游闭包', () => {
    const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(item => item.taskKey === 'p5.mainline')!
    expect(task).toMatchObject({
      skillId: 'text-open-world.production.mainline.v1',
      dependsOn: ['p2.gameplay-ruleset', 'p3.story-architecture', 'p4.region-skeleton', 'p4.player-build'],
      inputArtifactKeys: [
        'text-open-world.game-brief',
        'text-open-world.gameplay-ruleset-skeleton',
        'text-open-world.story-arc',
        'text-open-world.ending-contracts',
        'text-open-world.narrative-promises',
        'text-open-world.region-skeleton',
        'text-open-world.player-build',
      ],
      outputArtifactKeys: ['text-open-world.mainline-thread'],
    })
    expect(getAgentSkillV1(task.skillId)).toMatchObject({
      contextSourceKeys: ['text-open-world.mainline-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
      regressionTests: ['R-OPEN-WORLD3-mainline'],
    })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.mainline-input')).toMatchObject({
      ownerFrom: 'work', layer: 'L0', protectedFromTrim: true,
    })
  })
})
