import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

describe('R-OPEN-WORLD3 · RegionSkeleton生产契约', () => {
  it('登记唯一Context、Skill写目标与P4来源闭包', () => {
    const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1
      .find(item => item.taskKey === 'p4.region-skeleton')!
    expect(task).toMatchObject({
      skillId: 'text-open-world.production.region-skeleton.v1',
      dependsOn: ['p1.source-curation', 'p2.experience-design', 'p3.story-architecture'],
      inputArtifactKeys: [
        'text-open-world.game-brief',
        'text-open-world.source-manifest',
        'text-open-world.source-ledger',
        'text-open-world.experience-contract',
        'text-open-world.story-arc',
      ],
      outputArtifactKeys: ['text-open-world.region-skeleton'],
    })
    expect(getAgentSkillV1(task.skillId)).toMatchObject({
      contextSourceKeys: ['text-open-world.region-skeleton-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
      regressionTests: ['R-OPEN-WORLD3-region-skeleton'],
    })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.region-skeleton-input')).toMatchObject({
      ownerFrom: 'work', layer: 'L0', protectedFromTrim: true,
    })
  })
})
