import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

describe('R-OPEN-WORLD3 · QuestSkeleton生产契约', () => {
  it('登记唯一Context、Skill写目标与P8故事/玩法/地区闭包', () => {
    const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(item => item.taskKey === 'p8.quest-skeletons')!
    expect(task).toMatchObject({
      skillId: 'text-open-world.production.quest-skeletons.v1',
      inputArtifactKeys: [
        'text-open-world.game-brief',
        'text-open-world.experience-contract',
        'text-open-world.gameplay-ruleset-skeleton',
        'text-open-world.mainline-thread',
        'text-open-world.significant-threads',
        'text-open-world.region-narrative-packs',
      ],
      outputArtifactKeys: [
        'text-open-world.quest-skeletons',
        'text-open-world.content-requirement-manifest',
      ],
    })
    expect(getAgentSkillV1(task.skillId)).toMatchObject({
      contextSourceKeys: ['text-open-world.quest-skeletons-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
      regressionTests: ['R-OPEN-WORLD3-quest-skeletons'],
    })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.quest-skeletons-input')).toMatchObject({
      ownerFrom: 'work', layer: 'L0', protectedFromTrim: true,
    })
  })
})
