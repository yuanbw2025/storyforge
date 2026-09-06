import { describe, expect, it } from 'vitest'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import {
  TEXT_OPEN_WORLD_COMPILER_OWNED_EFFECT_OPERATIONS_V1,
  TEXT_OPEN_WORLD_LEGACY_EFFECT_OPERATIONS_V1,
  TEXT_OPEN_WORLD_MODEL_PROPOSABLE_EFFECT_OPERATIONS_V1,
  TEXT_OPEN_WORLD_NEW_BUILD_EFFECT_OPERATIONS_V1,
} from '../../src/lib/open-world/gameplay-ruleset'
import { TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1 } from '../../src/lib/open-world/production-contract'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { TEXT_OPEN_WORLD_EFFECT_OPERATIONS_V1 } from '../../src/lib/types/text-open-world-effect'

describe('R-OPEN-WORLD3 · GameplayRuleset G2权限与生产契约', () => {
  it('用同一运行时Effect词表形成无重叠的新建、编译器和旧版分区', () => {
    const newBuild = new Set(TEXT_OPEN_WORLD_NEW_BUILD_EFFECT_OPERATIONS_V1)
    const model = new Set(TEXT_OPEN_WORLD_MODEL_PROPOSABLE_EFFECT_OPERATIONS_V1)
    const compiler = new Set(TEXT_OPEN_WORLD_COMPILER_OWNED_EFFECT_OPERATIONS_V1)
    const legacy = new Set(TEXT_OPEN_WORLD_LEGACY_EFFECT_OPERATIONS_V1)

    expect(newBuild.size).toBe(TEXT_OPEN_WORLD_NEW_BUILD_EFFECT_OPERATIONS_V1.length)
    expect([...model].filter(operation => compiler.has(operation))).toEqual([])
    expect([...newBuild].filter(operation => legacy.has(operation))).toEqual([])
    expect(new Set([...newBuild, ...legacy])).toEqual(new Set(TEXT_OPEN_WORLD_EFFECT_OPERATIONS_V1))
  })

  it('登记唯一Context、Skill写目标和P2 Artifact依赖闭包', () => {
    const task = TEXT_OPEN_WORLD_PRODUCTION_TASK_CONTRACTS_V1.find(item => item.taskKey === 'p2.gameplay-ruleset')!
    expect(task).toMatchObject({
      skillId: 'text-open-world.production.gameplay-ruleset.v1',
      inputArtifactKeys: [
        'text-open-world.source-ledger',
        'text-open-world.game-brief',
        'text-open-world.experience-contract',
        'text-open-world.protagonist-asset',
      ],
      outputArtifactKeys: ['text-open-world.gameplay-ruleset-skeleton'],
    })
    expect(getAgentSkillV1(task.skillId)).toMatchObject({
      contextSourceKeys: ['text-open-world.gameplay-ruleset-input'],
      writeTargets: [{ table: 'productBuildArtifacts', fields: ['payloadJson'] }],
    })
    expect(CONTEXT_SOURCE_BY_KEY.get('text-open-world.gameplay-ruleset-input')).toMatchObject({
      ownerFrom: 'work', layer: 'L0', protectedFromTrim: true,
    })
  })
})
