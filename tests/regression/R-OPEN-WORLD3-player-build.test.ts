import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

describe('R-OPEN-WORLD3 · PlayerBuild生产契约', () => {
  it('登记唯一Context、Skill写目标与P4输入闭包', () => {
    const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(item => item.taskKey === 'p4.player-build')!
    expect(task).toMatchObject({
      skillId: 'text-open-world.production.player-build.v1',
      inputArtifactKeys: [
        'text-open-world.game-brief',
        'text-open-world.protagonist-asset',
        'text-open-world.experience-contract',
        'text-open-world.gameplay-ruleset-skeleton',
      ],
      outputArtifactKeys: ['text-open-world.player-build'],
    })
    expect(getAgentSkillV1(task.skillId)).toMatchObject({
      contextSourceKeys: ['text-open-world.player-build-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
    })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.player-build-input')).toMatchObject({
      ownerFrom: 'work', layer: 'L0', protectedFromTrim: true,
    })
  })
})
