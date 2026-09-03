import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  adoptAdventureRuntimeCandidateV1,
  generateAdventureRuntimeCandidateV1,
} from '../../src/lib/adventure/harness'
import { availableAdventureActions } from '../../src/lib/adventure/runtime'
import { db } from '../../src/lib/db/schema'
import {
  adoptOpenWorldEvolutionRuntimeCandidateV1,
  generateOpenWorldEvolutionRuntimeCandidateV1,
  type OpenWorldEvolutionRuntimeSkillIdV1,
} from '../../src/lib/open-world/evolution-harness'
import {
  adoptOpenWorldRuntimeCandidateV1,
  generateOpenWorldRuntimeCandidateV1,
  type OpenWorldRuntimeSkillIdV1,
} from '../../src/lib/open-world/harness'
import {
  commitOpenWorldEvolutionTurn,
  commitOpenWorldCommand,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from '../../src/lib/open-world/runtime-api'
import type {
  ProductionProductKindV1,
  ProductRuntimePackageV1,
  ProductRuntimeSession,
  WorkspaceScope,
  WorldRelease,
} from '../../src/lib/types'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import {
  loadCurrentProductWorldSourceCatalogV1,
  seedCurrentProductWorld,
} from '../helpers/current-product-world'
import { createCurrentRuntimePackageFixture } from '../helpers/current-runtime-package'
import { useAdventureGamePlayerStore } from '../../src/stores/adventure-game-player'
import { useAvgGamePlayerStore } from '../../src/stores/avg-game-player'
import { useCharacterInteractionPlayerStore } from '../../src/stores/character-interaction-player'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'

interface RuntimeFixture {
  scope: WorkspaceScope
  release: WorldRelease & { id: number }
  session: ProductRuntimeSession & { id: number }
  runtimePackage: ProductRuntimePackageV1
}

async function runtimeFixture(
  productType: Exclude<ProductionProductKindV1, 'ttrpg'>,
  title: string,
): Promise<RuntimeFixture> {
  const world = await seedCurrentProductWorld(title)
  const release = world.release as WorldRelease & { id: number }
  const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({
    scope: world.scope,
    worldReleaseId: release.id,
    productType,
  })
  const runtimePackage = createCurrentRuntimePackageFixture({
    productType,
    worldRelease: release,
    sourceCatalog,
  })
  const created = await seedCurrentProductBuild({
    scope: world.scope,
    worldRelease: release,
    runtimePackage,
    title,
  })
  return {
    scope: world.scope,
    release,
    session: created.session as ProductRuntimeSession & { id: number },
    runtimePackage,
  }
}

describe('R-HARNESS-RUNTIME2 · current Product Build runtime Skills', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('文字冒险意图与结果叙述 Skill 只消费正式 Build，候选分别写动作和只读表现', async () => {
    const seeded = await runtimeFixture('text-adventure', '现行文字冒险 Harness')
    const initial = await readProductRuntimeState(seeded.session.id)
    const action = availableAdventureActions(
      seeded.runtimePackage.adventure!,
      initial.adventure!,
    ).find(candidate => candidate.available)?.action
    if (!action) throw new Error('现行文字冒险包缺少可执行动作')

    const intent = await generateAdventureRuntimeCandidateV1({
      scope: seeded.scope,
      productRuntimeSessionId: seeded.session.id,
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

    const evidence = (await db.productRuntimeEvents.where('sessionId').equals(seeded.session.id).toArray())
      .find(event => event.id === actionAdoption.event?.id)
    if (!evidence) throw new Error('动作采用后缺少正式事件证据')
    const beforeNarration = await readProductRuntimeStateVersion(seeded.session.id)
    const narration = await generateAdventureRuntimeCandidateV1({
      scope: seeded.scope,
      productRuntimeSessionId: seeded.session.id,
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
    expect(await readProductRuntimeStateVersion(seeded.session.id)).toEqual(beforeNarration)
  })

  it('开放世界内部模拟能力的四类表现 Skill 均绑定正式 Build，且保持状态只读', async () => {
    const seeded = await runtimeFixture('text-open-world', '现行开放世界内部模拟 Harness')
    const base = await readProductRuntimeStateVersion(seeded.session.id)
    await commitOpenWorldEvolutionTurn({
      sessionId: seeded.session.id,
      decisionKeys: [],
      commandId: 'fixture:open-world-evolution-turn',
      baseSequence: base.sequence,
      baseStateHash: base.stateHash,
    })
    const evidence = (await db.productRuntimeEvents.where('sessionId').equals(seeded.session.id).toArray())
      .filter(event => event.type.startsWith('open-world-evolution.')).at(-1)
    if (!evidence) throw new Error('开放世界模拟缺少正式事件证据')
    const frozen = await readProductRuntimeStateVersion(seeded.session.id)
    const cases: Array<[OpenWorldEvolutionRuntimeSkillIdV1, string]> = [
      ['prose.open-world-turn-briefing', 'turn-briefing'],
      ['prose.open-world-advisor-performance', 'advisor-performance'],
      ['prose.open-world-outcome-narrator', 'outcome-narration'],
      ['prose.open-world-actor-action-suggestion', 'actor-action-suggestion'],
    ]
    for (const [skillId, kind] of cases) {
      const generated = await generateOpenWorldEvolutionRuntimeCandidateV1({
        scope: seeded.scope,
        productRuntimeSessionId: seeded.session.id,
        skillId,
        objective: `验证 ${kind}`,
        runAI: async () => JSON.stringify({
          kind, text: `${kind} 只解释已经发生的冻结事件。`,
          evidenceEventSequences: [evidence.sequence], assertedFacts: [],
        }),
      })
      const adopted = await adoptOpenWorldEvolutionRuntimeCandidateV1({
        scope: seeded.scope,
        runId: generated.snapshot.run.id,
      })
      expect(adopted.snapshot.projection.state).toBe('completed')
      expect(adopted.candidate.kind).toBe(kind)
    }
    expect(await readProductRuntimeStateVersion(seeded.session.id)).toEqual(frozen)
  })

  it('开放世界任务表现与场景叙述 Skill 只引用已公开任务和正式事件', async () => {
    const seeded = await runtimeFixture('text-open-world', '现行开放世界 Harness')
    let state = await readProductRuntimeState(seeded.session.id)
    let instance = state.openWorld?.questInstances.find(candidate => candidate.status === 'revealed')
    for (let attempt = 0; attempt < 8 && !instance; attempt += 1) {
      const base = await readProductRuntimeStateVersion(seeded.session.id)
      await commitOpenWorldCommand({
        sessionId: seeded.session.id,
        command: attempt % 2 === 0 ? { kind: 'draw', trigger: 'observe' } : { kind: 'tick' },
        commandId: `fixture:open-world:${attempt}`,
        baseSequence: base.sequence,
        baseStateHash: base.stateHash,
      })
      state = await readProductRuntimeState(seeded.session.id)
      instance = state.openWorld?.questInstances.find(candidate => candidate.status === 'revealed')
    }
    const runtimeEvents = await db.productRuntimeEvents.where('sessionId').equals(seeded.session.id).toArray()
    if (!instance) throw new Error(`现行开放世界包未公开任务:${JSON.stringify({
      tick: state.openWorld?.tick,
      quests: state.openWorld?.questInstances,
      events: runtimeEvents.map(event => event.type),
    })}`)
    const evidence = runtimeEvents
      .filter(event => event.type === 'world.quest.revealed').at(-1)
    if (!evidence) throw new Error('开放世界缺少任务公开事件')
    const frozen = await readProductRuntimeStateVersion(seeded.session.id)
    const cases: Array<[OpenWorldRuntimeSkillIdV1, 'quest-expression' | 'scene-narration']> = [
      ['prose.open-world-quest-expression', 'quest-expression'],
      ['prose.open-world-scene-narration', 'scene-narration'],
    ]
    for (const [skillId, kind] of cases) {
      const generated = await generateOpenWorldRuntimeCandidateV1({
        scope: seeded.scope,
        productRuntimeSessionId: seeded.session.id,
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
    expect(await readProductRuntimeStateVersion(seeded.session.id)).toEqual(frozen)
  })

  it('四类现行非跑团产品界面都能直接接住统一 Production 返回的 Build Preview 会话', async () => {
    const interaction = await runtimeFixture('character-interaction', '现行角色互动预览界面')
    await useCharacterInteractionPlayerStore.getState().load(interaction.scope, null)
    expect(useCharacterInteractionPlayerStore.getState()).toMatchObject({
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

    const openWorld = await runtimeFixture('text-open-world', '现行开放世界预览界面')
    await useTextOpenWorldPlayerStore.getState().load(openWorld.scope, null)
    expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({
      selectedSessionId: openWorld.session.id, error: '',
      selectedManifest: { productType: 'text-open-world' },
    })
  })
})
