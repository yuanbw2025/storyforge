import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

describe('R-OPEN-WORLD3 · ProgressionCatalog生产契约', () => {
  it('登记唯一Context、Skill写目标与P8玩法/主角/需求闭包', () => {
    const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(item => item.taskKey === 'p8.catalog.progression')!
    expect(task).toMatchObject({
      skillId: 'text-open-world.production.progression-catalogs.v1',
      inputArtifactKeys: [
        'text-open-world.gameplay-ruleset-skeleton',
        'text-open-world.player-build',
        'text-open-world.content-requirement-manifest',
      ],
      outputArtifactKeys: ['text-open-world.progression-catalogs'],
    })
    expect(getAgentSkillV1(task.skillId)).toMatchObject({
      contextSourceKeys: ['text-open-world.progression-catalogs-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
      regressionTests: ['R-OPEN-WORLD3-progression-catalogs'],
    })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.progression-catalogs-input')).toMatchObject({
      ownerFrom: 'work', layer: 'L0', protectedFromTrim: true,
    })
  })
})
