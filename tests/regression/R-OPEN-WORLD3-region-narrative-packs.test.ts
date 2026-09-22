import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'

describe('R-OPEN-WORLD3 · RegionNarrativePacks生产契约', () => {
  it('登记唯一Context、Skill写目标与P7完整上游闭包', () => {
    const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(item => item.taskKey === 'p7.region-narrative-packs')!
    expect(task).toMatchObject({
      skillId: 'text-open-world.production.region-narrative-packs.v1',
      dependsOn: [
        'p1.source-curation', 'p2.experience-design', 'p4.region-skeleton',
        'p5.mainline', 'p6.significant-threads',
      ],
      inputArtifactKeys: [
        'text-open-world.game-brief',
        'text-open-world.experience-contract',
        'text-open-world.source-ledger',
        'text-open-world.region-skeleton',
        'text-open-world.mainline-thread',
        'text-open-world.significant-threads',
      ],
      outputArtifactKeys: ['text-open-world.region-narrative-packs'],
    })
    expect(getAgentSkillV1(task.skillId)).toMatchObject({
      contextSourceKeys: ['text-open-world.region-narrative-packs-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
      regressionTests: ['R-OPEN-WORLD3-region-narrative-packs'],
    })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.region-narrative-packs-input')).toMatchObject({
      ownerFrom: 'work', layer: 'L0', protectedFromTrim: true,
    })
  })
})
