import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

describe('R-OPEN-WORLD3 · CraftingEconomy生产契约', () => {
  it('登记唯一Context、Skill写目标与任务/物品/地区闭包', () => {
    const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(item => item.taskKey === 'p8.catalog.crafting-economy')!
    expect(task).toMatchObject({
      skillId: 'text-open-world.production.crafting-economy-catalog.v1',
      inputArtifactKeys: [
        'text-open-world.gameplay-ruleset-skeleton',
        'text-open-world.region-narrative-packs',
        'text-open-world.quest-skeletons',
        'text-open-world.content-requirement-manifest',
        'text-open-world.item-reward-catalog',
      ],
      outputArtifactKeys: ['text-open-world.crafting-economy-catalog'],
    })
    expect(getAgentSkillV1(task.skillId)).toMatchObject({
      contextSourceKeys: ['text-open-world.crafting-economy-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
      regressionTests: ['R-OPEN-WORLD3-crafting-economy'],
    })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.crafting-economy-input')).toMatchObject({
      ownerFrom: 'work', layer: 'L0', protectedFromTrim: true,
    })
  })
})
