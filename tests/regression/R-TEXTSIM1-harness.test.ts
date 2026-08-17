import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { publishNarrativeSimulationGame, seedNarrativeSimulationAcceptanceGame } from '../../src/lib/narrative-simulation/authoring'
import {
  adoptNarrativeSimulationRuntimeCandidateV1,
  generateNarrativeSimulationRuntimeCandidateV1,
} from '../../src/lib/narrative-simulation/harness'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { commitNarrativeSimulationTurn, readSimulationState, readSimulationStateVersion } from '../../src/lib/simulation/runtime'
import { createNarrativeSimulationInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

async function fixture(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    name, genre: 'simulation', genres: ['simulation'], status: 'drafting', description: '',
    targetWordCount: 10_000, createdAt: now, updatedAt: now,
  } as any) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  const definition = await seedNarrativeSimulationAcceptanceGame({ scope: owned.scope })
  const publication = await publishNarrativeSimulationGame({ scope: owned.scope, gameDefinitionId: definition.id! })
  const session = await createNarrativeSimulationInstance({
    scope: owned.scope,
    gameReleaseId: publication.gameRelease.id!,
    title: 'Harness 存档',
    seed: 'harness-seed',
  })
  const base = await readSimulationStateVersion(session.id!)
  await commitNarrativeSimulationTurn({
    sessionId: session.id!, decisionKeys: [], commandId: 'fixture.turn.1',
    baseSequence: base.sequence, baseStateHash: base.stateHash,
  })
  return { ...owned, session }
}

describe('TEXTSIM-1 · unified Harness presentation candidates', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it.sequential('narrativeSimulationRuntime 只装配冻结事实、行动闭集和玩家报告', async () => {
    const seeded = await fixture('TEXTSIM Harness Context')
    const assembled = await assembleContext({
      projectId: seeded.scope.projectId,
      scope: seeded.scope,
      simulationSessionId: seeded.session.id!,
      sourceKeys: ['narrativeSimulationRuntime'],
    })
    expect(assembled.included).toEqual(['narrativeSimulationRuntime'])
    expect(assembled.text).toContain('【叙事模拟玩家视角】')
    expect(assembled.text).toContain('repair-homes｜decision｜修缮住房｜可执行')
    expect(assembled.text).toContain('turn-summary')
    expect(assembled.text).not.toContain('监察员记录了本回合的资金变化')
  }, 30_000)

  it.sequential('四类表现候选走 Instance Harness，采用保持 SIM 状态只读且可幂等恢复', async () => {
    const seeded = await fixture('TEXTSIM Harness Adopt')
    const before = await readSimulationStateVersion(seeded.session.id!)
    const evidence = (await db.simulationEvents.where('sessionId').equals(seeded.session.id!).toArray())
      .find(event => event.type === 'simulation.turn.started')!
    const state = await readSimulationState(seeded.session.id!)
    const generated = await generateNarrativeSimulationRuntimeCandidateV1({
      scope: seeded.scope,
      simulationSessionId: seeded.session.id!,
      skillId: 'prose.simulation-turn-briefing',
      objective: '写一段本回合局势简报',
      runAI: async messages => {
        expect(messages.map(message => message.content).join('\n')).toContain('模型只能输出有事件证据')
        return JSON.stringify({
          kind: 'turn-briefing',
          text: '首回合没有主动决策，系统按冻结规则继续演化。',
          evidenceEventSequences: [evidence.sequence],
          assertedFacts: [{ source: 'resource', key: 'funds', value: state.narrativeSimulation!.resources.funds }],
        })
      },
    })
    expect(generated.snapshot.run.workId).toBeNull()
    expect(generated.snapshot.run.simulationSessionId).toBe(seeded.session.id)
    expect(generated.snapshot.contract.permissions).toEqual({
      contextSourceKeys: ['narrativeSimulationRuntime'],
      writeTargets: [],
    })
    const adopted = await adoptNarrativeSimulationRuntimeCandidateV1({
      scope: seeded.scope,
      runId: generated.snapshot.run.id,
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(await readSimulationStateVersion(seeded.session.id!)).toEqual(before)
    const repeated = await adoptNarrativeSimulationRuntimeCandidateV1({
      scope: seeded.scope,
      runId: generated.snapshot.run.id,
    })
    expect(repeated.receiptHash).toBe(adopted.receiptHash)
  }, 30_000)

  it.sequential('旧候选在实例推进后 fail-closed，事实冲突在持久候选前拒绝', async () => {
    const seeded = await fixture('TEXTSIM Harness Stale')
    const evidence = (await db.simulationEvents.where('sessionId').equals(seeded.session.id!).toArray())
      .find(event => event.type === 'simulation.turn.started')!
    const generated = await generateNarrativeSimulationRuntimeCandidateV1({
      scope: seeded.scope,
      simulationSessionId: seeded.session.id!,
      skillId: 'prose.simulation-advisor-performance',
      objective: '给出顾问意见',
      runAI: async () => JSON.stringify({
        kind: 'advisor-performance', text: '建议下一回合优先处理住房。',
        evidenceEventSequences: [evidence.sequence], assertedFacts: [],
      }),
    })
    const base = await readSimulationStateVersion(seeded.session.id!)
    await commitNarrativeSimulationTurn({
      sessionId: seeded.session.id!, decisionKeys: [], commandId: 'advance.turn.2',
      baseSequence: base.sequence, baseStateHash: base.stateHash,
    })
    await expect(adoptNarrativeSimulationRuntimeCandidateV1({
      scope: seeded.scope,
      runId: generated.snapshot.run.id,
    })).rejects.toThrow(/已经变化|已过期/)

    const currentState = await readSimulationState(seeded.session.id!)
    const currentEvidence = (await db.simulationEvents.where('sessionId').equals(seeded.session.id!).toArray())
      .filter(event => event.type.startsWith('simulation.')).pop()!
    await expect(generateNarrativeSimulationRuntimeCandidateV1({
      scope: seeded.scope,
      simulationSessionId: seeded.session.id!,
      skillId: 'prose.simulation-outcome-narrator',
      objective: '叙述结果',
      runAI: async () => JSON.stringify({
        kind: 'outcome-narration', text: '资金已经凭空归零。',
        evidenceEventSequences: [currentEvidence.sequence],
        assertedFacts: [{ source: 'resource', key: 'funds', value: currentState.narrativeSimulation!.resources.funds - 999 }],
      }),
    })).rejects.toThrow('事实冲突')
  }, 30_000)
})
