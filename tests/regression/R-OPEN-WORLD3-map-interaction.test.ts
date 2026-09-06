import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

describe('R-OPEN-WORLD3 · MapInteraction生产契约', () => {
  it('登记唯一Context、Skill写目标与地图/任务/需求闭包', () => {
    const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(item => item.taskKey === 'p8.catalog.map-interactions')!
    expect(task).toMatchObject({
      skillId: 'text-open-world.production.map-interaction-catalog.v1',
      inputArtifactKeys: [
        'text-open-world.region-skeleton',
        'text-open-world.region-narrative-packs',
        'text-open-world.quest-skeletons',
        'text-open-world.content-requirement-manifest',
      ],
      outputArtifactKeys: ['text-open-world.map-interaction-catalog'],
    })
    expect(getAgentSkillV1(task.skillId)).toMatchObject({
      contextSourceKeys: ['text-open-world.map-interaction-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
      regressionTests: ['R-OPEN-WORLD3-map-interaction'],
    })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.map-interaction-input')).toMatchObject({
      ownerFrom: 'work', layer: 'L0', protectedFromTrim: true,
    })
  })
})
