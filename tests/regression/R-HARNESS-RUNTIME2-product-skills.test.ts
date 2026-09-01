import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  adoptAdventureRuntimeCandidateV1,
  generateAdventureRuntimeCandidateV1,
} from '../../src/lib/adventure/harness'
import { availableAdventureActions } from '../../src/lib/adventure/runtime'
import { db } from '../../src/lib/db/schema'
import { loadGameProductionWorldSourceCatalogV2 } from '../../src/lib/game-production/world-source'
import {
  adoptNarrativeSimulationRuntimeCandidateV1,
  generateNarrativeSimulationRuntimeCandidateV1,
  type NarrativeSimulationRuntimeSkillIdV1,
} from '../../src/lib/narrative-simulation/harness'
import {
  adoptOpenWorldRuntimeCandidateV1,
  generateOpenWorldRuntimeCandidateV1,
  type OpenWorldRuntimeSkillIdV1,
} from '../../src/lib/open-world/harness'
import {
  commitNarrativeSimulationTurn,
  commitOpenWorldCommand,
  readSimulationState,
  readSimulationStateVersion,
} from '../../src/lib/simulation/runtime'
import type {
  GameProductType,
  GameRuntimePackageV2,
  SimulationSession,
  WorkspaceScope,
  WorldRelease,
} from '../../src/lib/types'
import { seedCurrentPlayableBuild } from '../helpers/current-playable-build'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { createCurrentRuntimePackageFixture } from '../helpers/current-runtime-package'
import { useAdventureGamePlayerStore } from '../../src/stores/adventure-game-player'
import { useAvgGamePlayerStore } from '../../src/stores/avg-game-player'
import { useInteractionGamePlayerStore } from '../../src/stores/interaction-game-player'
import { useNarrativeSimulationPlayerStore } from '../../src/stores/narrative-simulation-player'
import { useStoryGamePlayerStore } from '../../src/stores/story-game-player'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'

interface RuntimeFixture {
  scope: WorkspaceScope
  release: WorldRelease & { id: number }
  session: SimulationSession & { id: number }
  runtimePackage: GameRuntimePackageV2
}

async function runtimeFixture(
  productType: Exclude<GameProductType, 'ttrpg'>,
  title: string,
): Promise<RuntimeFixture> {
  const world = await seedCurrentProductWorld(title)
  const release = world.release as WorldRelease & { id: number }
  const sourceCatalog = await loadGameProductionWorldSourceCatalogV2({
    scope: world.scope,
    worldReleaseId: release.id,
  })
  const runtimePackage = createCurrentRuntimePackageFixture({
    productType,
    worldRelease: release,
    sourceCatalog,
  })
  const created = await seedCurrentPlayableBuild({
    scope: world.scope,
    worldRelease: release,
    runtimePackage,
    title,
  })
  return {
    scope: world.scope,
    release,
    session: created.session as SimulationSession & { id: number },
    runtimePackage,
  }
}

describe('R-HARNESS-RUNTIME2 · current Product Build runtime Skills', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('文字冒险意图与结果叙述 Skill 只消费正式 Build，候选分别写动作和只读表现', async () => {
    const seeded = await runtimeFixture('text-adventure', '现行文字冒险 Harness')
    const initial = await readSimulationState(seeded.session.id)
    const action = availableAdventureActions(
      seeded.runtimePackage.adventure!,
      initial.adventure!,
    ).find(candidate => candidate.available)?.action
    if (!action) throw new Error('现行文字冒险包缺少可执行动作')

    const intent = await generateAdventureRuntimeCandidateV1({
      scope: seeded.scope,
      simulationSessionId: seeded.session.id,
      skillId: 'prose.adventure-intent-parser',
      objective: `执行 ${action.label}`,
      runAI: async messages => {
        expect(messages.map(message => message.content).join('\n')).toContain(action.key)
        return JSON.stringify({
          kind: 'adventure-intent', actionKey: action.key,
          rationale: '该行动属于当前冻结闭集。', requiresConfirmation: true,
        })
      },
    })
    const actionAdoption = await adoptAdventureRuntimeCandidateV1({
      scope: seeded.scope,
      runId: intent.snapshot.run.id,
    })
    expect(actionAdoption.snapshot.projection.state).toBe('completed')
    expect(actionAdoption.event?.type).toBe('adventure.action.committed')

    const evidence = (await db.simulationEvents.where('sessionId').equals(seeded.session.id).toArray())
      .find(event => event.id === actionAdoption.event?.id)
    if (!evidence) throw new Error('动作采用后缺少正式事件证据')
    const beforeNarration = await readSimulationStateVersion(seeded.session.id)
    const narration = await generateAdventureRuntimeCandidateV1({
      scope: seeded.scope,
      simulationSessionId: seeded.session.id,
      skillId: 'prose.adventure-result-narrator',
      objective: '叙述刚才已结算的行动',
      runAI: async () => JSON.stringify({
        kind: 'adventure-result', narrative: '守灯人依照已经结算的结果继续调查。',
        evidenceEventSequences: [evidence.sequence],
      }),
    })
    const narrationAdoption = await adoptAdventureRuntimeCandidateV1({
      scope: seeded.scope,
      runId: narration.snapshot.run.id,
    })
    expect(narrationAdoption.snapshot.projection.state).toBe('completed')
    expect(await readSimulationStateVersion(seeded.session.id)).toEqual(beforeNarration)
  })

  it('叙事模拟四类表现 Skill 均在正式 Build 上生成、终验并保持 SIM 状态只读', async () => {
    const seeded = await runtimeFixture('narrative-simulation', '现行叙事模拟 Harness')
    const base = await readSimulationStateVersion(seeded.session.id)
    await commitNarrativeSimulationTurn({
      sessionId: seeded.session.id,
      decisionKeys: [],
      commandId: 'fixture:simulation-turn',
      baseSequence: base.sequence,
      baseStateHash: base.stateHash,
    })
    const evidence = (await db.simulationEvents.where('sessionId').equals(seeded.session.id).toArray())
      .filter(event => event.type.startsWith('simulation.')).at(-1)
    if (!evidence) throw new Error('叙事模拟缺少正式事件证据')
    const frozen = await readSimulationStateVersion(seeded.session.id)
    const cases: Array<[NarrativeSimulationRuntimeSkillIdV1, string]> = [
      ['prose.simulation-turn-briefing', 'turn-briefing'],
      ['prose.simulation-advisor-performance', 'advisor-performance'],
      ['prose.simulation-outcome-narrator', 'outcome-narration'],
      ['prose.simulation-actor-action-suggestion', 'actor-action-suggestion'],
    ]
    for (const [skillId, kind] of cases) {
      const generated = await generateNarrativeSimulationRuntimeCandidateV1({
        scope: seeded.scope,
        simulationSessionId: seeded.session.id,
        skillId,
        objective: `验证 ${kind}`,
        runAI: async () => JSON.stringify({
          kind, text: `${kind} 只解释已经发生的冻结事件。`,
          evidenceEventSequences: [evidence.sequence], assertedFacts: [],
        }),
      })
      const adopted = await adoptNarrativeSimulationRuntimeCandidateV1({
        scope: seeded.scope,
        runId: generated.snapshot.run.id,
      })
      expect(adopted.snapshot.projection.state).toBe('completed')
      expect(adopted.candidate.kind).toBe(kind)
    }
    expect(await readSimulationStateVersion(seeded.session.id)).toEqual(frozen)
  })

  it('开放世界任务表现与场景叙述 Skill 只引用已公开任务和正式事件', async () => {
    const seeded = await runtimeFixture('text-open-world', '现行开放世界 Harness')
    let state = await readSimulationState(seeded.session.id)
    let instance = state.openWorld?.questInstances.find(candidate => candidate.status === 'revealed')
    for (let attempt = 0; attempt < 8 && !instance; attempt += 1) {
      const base = await readSimulationStateVersion(seeded.session.id)
      await commitOpenWorldCommand({
        sessionId: seeded.session.id,
        command: attempt % 2 === 0 ? { kind: 'draw', trigger: 'observe' } : { kind: 'tick' },
        commandId: `fixture:open-world:${attempt}`,
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
      })
      state = await readSimulationState(seeded.session.id)
      instance = state.openWorld?.questInstances.find(candidate => candidate.status === 'revealed')
    }
    const worldEvents = await db.simulationEvents.where('sessionId').equals(seeded.session.id).toArray()
    if (!instance) throw new Error(`现行开放世界包未公开任务:${JSON.stringify({
      tick: state.openWorld?.tick,
      quests: state.openWorld?.questInstances,
      events: worldEvents.map(event => event.type),
    })}`)
    const evidence = worldEvents
      .filter(event => event.type === 'world.quest.revealed').at(-1)
    if (!evidence) throw new Error('开放世界缺少任务公开事件')
    const frozen = await readSimulationStateVersion(seeded.session.id)
    const cases: Array<[OpenWorldRuntimeSkillIdV1, 'quest-expression' | 'scene-narration']> = [
      ['prose.open-world-quest-expression', 'quest-expression'],
      ['prose.open-world-scene-narration', 'scene-narration'],
    ]
    for (const [skillId, kind] of cases) {
      const generated = await generateOpenWorldRuntimeCandidateV1({
        scope: seeded.scope,
        simulationSessionId: seeded.session.id,
        skillId,
        objective: `验证 ${kind}`,
        runAI: async () => JSON.stringify({
          kind,
          instanceKey: instance.instanceKey,
          title: instance.title,
          text: `${kind} 仅呈现已经公开的任务。`,
          dialogue: '',
          evidenceEventSequences: [evidence.sequence],
          assertedReferences: [],
        }),
      })
      const adopted = await adoptOpenWorldRuntimeCandidateV1({
        scope: seeded.scope,
        runId: generated.snapshot.run.id,
      })
      expect(adopted.snapshot.projection.state).toBe('completed')
      expect(adopted.candidate.kind).toBe(kind)
    }
    expect(await readSimulationStateVersion(seeded.session.id)).toEqual(frozen)
  })

  it('六类玩家界面都能直接接住统一 Production 返回的 Build Preview 会话', async () => {
    const story = await runtimeFixture('storygame', '现行分支叙事预览界面')
    await useStoryGamePlayerStore.getState().load(story.scope, null)
    expect(useStoryGamePlayerStore.getState()).toMatchObject({
      selectedSessionId: story.session.id, error: '',
    })

    const interaction = await runtimeFixture('character-interaction', '现行角色互动预览界面')
    await useInteractionGamePlayerStore.getState().load(interaction.scope, null)
    expect(useInteractionGamePlayerStore.getState()).toMatchObject({
      selectedSessionId: interaction.session.id, error: '',
    })

    const adventure = await runtimeFixture('text-adventure', '现行文字冒险预览界面')
    await useAdventureGamePlayerStore.getState().load(adventure.scope, null)
    expect(useAdventureGamePlayerStore.getState()).toMatchObject({
      selectedSessionId: adventure.session.id, error: '',
      selectedManifest: { productType: 'text-adventure' },
    })

    const avg = await runtimeFixture('avg', '现行 AVG 预览界面')
    await useAvgGamePlayerStore.getState().load(avg.scope, null)
    expect(useAvgGamePlayerStore.getState()).toMatchObject({
      selectedSessionId: avg.session.id, error: '',
      selectedManifest: { productType: 'avg' },
    })

    const simulation = await runtimeFixture('narrative-simulation', '现行叙事模拟预览界面')
    await useNarrativeSimulationPlayerStore.getState().load(simulation.scope, null)
    expect(useNarrativeSimulationPlayerStore.getState()).toMatchObject({
      selectedSessionId: simulation.session.id, error: '',
      selectedManifest: { productType: 'narrative-simulation' },
    })

    const openWorld = await runtimeFixture('text-open-world', '现行开放世界预览界面')
    await useTextOpenWorldPlayerStore.getState().load(openWorld.scope, null)
    expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({
      selectedSessionId: openWorld.session.id, error: '',
      selectedManifest: { productType: 'text-open-world' },
    })
  })
})
