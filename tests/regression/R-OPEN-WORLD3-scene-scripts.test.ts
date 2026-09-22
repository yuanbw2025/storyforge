import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

describe('R-OPEN-WORLD3 · SceneScripts生产契约', () => {
  it('登记原子Context、唯一Skill写目标与三类输入的共同Action结果源', () => {
    const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(item => item.taskKey === 'p9.scene-scripts')!
    expect(task).toMatchObject({
      skillId: 'text-open-world.production.scene-scripts.v1',
      dependsOn: ['p7.region-narrative-packs', 'p8f.quest-finalize'],
      inputArtifactKeys: [
        'text-open-world.source-ledger', 'text-open-world.experience-contract',
        'text-open-world.story-arc', 'text-open-world.region-narrative-packs',
        'text-open-world.quest-skeletons', 'text-open-world.content-requirement-manifest',
        'text-open-world.npc-runtime-catalog', 'text-open-world.map-interaction-catalog',
        'text-open-world.quest-design-documents', 'text-open-world.director-decks',
      ],
      outputArtifactKeys: [
        'text-open-world.scene-scripts', 'text-open-world.choice-contracts',
        'text-open-world.action-bindings',
      ],
    })
    expect(getAgentSkillV1(task.skillId)).toMatchObject({
      contextSourceKeys: ['text-open-world.scene-scripts-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
      regressionTests: ['R-OPEN-WORLD3-scene-scripts'],
    })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.scene-scripts-input')).toMatchObject({
      ownerFrom: 'work', layer: 'L0', protectedFromTrim: true, atomic: true,
    })
  })
})
