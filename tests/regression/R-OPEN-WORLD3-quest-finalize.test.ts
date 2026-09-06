import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

describe('R-OPEN-WORLD3 · QuestFinalize生产契约', () => {
  it('登记唯一Context、Skill写目标与全部叙事/玩法目录闭包', () => {
    const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(item => item.taskKey === 'p8f.quest-finalize')!
    expect(task).toMatchObject({
      skillId: 'text-open-world.production.quest-finalize.v1',
      dependsOn: expect.arrayContaining([
        'p5.mainline', 'p6.significant-threads', 'p7.region-narrative-packs', 'p8.quest-skeletons',
        'p8.catalog.progression', 'p8.catalog.encounters', 'p8.catalog.items-rewards',
        'p8.catalog.crafting-economy', 'p8.catalog.npc-runtime', 'p8.catalog.map-interactions',
      ]),
      inputArtifactKeys: expect.arrayContaining([
        'text-open-world.region-narrative-packs', 'text-open-world.quest-skeletons',
        'text-open-world.content-requirement-manifest', 'text-open-world.progression-catalogs',
        'text-open-world.enemy-encounter-catalog', 'text-open-world.item-reward-catalog',
        'text-open-world.crafting-economy-catalog', 'text-open-world.npc-runtime-catalog',
        'text-open-world.map-interaction-catalog',
      ]),
      outputArtifactKeys: ['text-open-world.quest-design-documents', 'text-open-world.director-decks'],
    })
    expect(getAgentSkillV1(task.skillId)).toMatchObject({
      contextSourceKeys: ['text-open-world.quest-finalize-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
      regressionTests: ['R-OPEN-WORLD3-quest-finalize'],
    })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.quest-finalize-input')).toMatchObject({
      ownerFrom: 'work', layer: 'L0', protectedFromTrim: true, atomic: true,
    })
  })
})
