import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { publishAdventureGameDraft, seedAdventureAcceptanceGame } from '../../src/lib/adventure/authoring'
import { adoptAdventureRuntimeCandidateV1, generateAdventureRuntimeCandidateV1 } from '../../src/lib/adventure/harness'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { commitAdventureAction, readSimulationState, readSimulationStateVersion } from '../../src/lib/simulation/runtime'
import { createTextAdventureInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

async function fixture() {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'TEXTADV Harness', genre: 'adventure', genres: ['adventure'], status: 'drafting',
    description: '', targetWordCount: 10_000, createdAt: now, updatedAt: now,
  } as any) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  const definition = await seedAdventureAcceptanceGame({ scope: owned.scope, title: '雾港自由输入', gameKey: 'mist-harness' })
  const publication = await publishAdventureGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
  const create = (title: string) => createTextAdventureInstance({
    scope: owned.scope, gameReleaseId: publication.gameRelease.id!, title, seed: 'same-adventure-seed',
  })
  return { ...owned, create }
}

async function act(sessionId: number, actionKey: string, commandId: string) {
  const base = await readSimulationStateVersion(sessionId)
  return commitAdventureAction({ sessionId, actionKey, commandId, baseSequence: base.sequence, baseStateHash: base.stateHash })
}

describe('TEXTADV-1 · unified Harness free input and narration', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('adventureRuntime 只装配冻结玩家视角和当前位置行动闭集', async () => {
    const seeded = await fixture()
    const session = await seeded.create('上下文存档')
    const context = await assembleContext({
      projectId: seeded.scope.projectId, scope: seeded.scope,
      simulationSessionId: session.id!, sourceKeys: ['adventureRuntime'],
    })
    expect(context.included).toEqual(['adventureRuntime'])
    expect(context.text).toContain('【文字冒险运行时】')
    expect(context.text).toContain('inspect.notice｜inspect｜查看告示｜可执行')
    expect(context.text).not.toContain('角色私密知识')
  }, 30_000)

  it('自由输入候选经 Instance Harness 采用，状态语义与同一按钮行动一致且可幂等恢复', async () => {
    const seeded = await fixture()
    const button = await seeded.create('按钮存档')
    const free = await seeded.create('自由输入存档')
    await act(button.id!, 'inspect.notice', 'button.inspect')

    const generated = await generateAdventureRuntimeCandidateV1({
      scope: seeded.scope, simulationSessionId: free.id!,
      skillId: 'prose.adventure-intent-parser', objective: '我想看看码头上的失物告示',
      runAI: async messages => {
        const context = messages.map(item => item.content).join('\n')
        expect(context).toContain('inspect.notice｜inspect｜查看告示｜可执行')
        return JSON.stringify({
          kind: 'adventure-intent', actionKey: 'inspect.notice',
          rationale: '玩家明确要求查看当前地点的告示。', requiresConfirmation: true,
        })
      },
    })
    expect(generated.snapshot.run.workId).toBeNull()
    expect(generated.snapshot.run.simulationSessionId).toBe(free.id)
    expect(generated.snapshot.contract.permissions).toEqual({ contextSourceKeys: ['adventureRuntime'], writeTargets: [] })
    const adopted = await adoptAdventureRuntimeCandidateV1({ scope: seeded.scope, runId: generated.snapshot.run.id })
    expect(adopted.event?.type).toBe('adventure.action.committed')
    expect(adopted.snapshot.projection.state).toBe('completed')
    const repeated = await adoptAdventureRuntimeCandidateV1({ scope: seeded.scope, runId: generated.snapshot.run.id })
    expect(repeated.event?.id).toBe(adopted.event?.id)

    const buttonState = (await readSimulationState(button.id!)).adventure!
    const freeState = (await readSimulationState(free.id!)).adventure!
    expect(freeState.quests).toEqual(buttonState.quests)
    expect(freeState.inventory).toEqual(buttonState.inventory)
    expect(freeState.resources).toEqual(buttonState.resources)
    expect(freeState.currentLocationKey).toBe(buttonState.currentLocationKey)
    expect(freeState.actionHistory.map(item => ({ actionKey: item.actionKey, outcome: item.outcome })))
      .toEqual(buttonState.actionHistory.map(item => ({ actionKey: item.actionKey, outcome: item.outcome })))
  }, 30_000)

  it('实例推进后旧行动候选 fail-closed，未登记或不可用 action 也在生成期拒绝', async () => {
    const seeded = await fixture()
    const session = await seeded.create('过期存档')
    const generated = await generateAdventureRuntimeCandidateV1({
      scope: seeded.scope, simulationSessionId: session.id!,
      skillId: 'prose.adventure-intent-parser', objective: '拿起绳索',
      runAI: async () => JSON.stringify({
        kind: 'adventure-intent', actionKey: 'take.rope', rationale: '玩家要拿当前地点的绳索。', requiresConfirmation: true,
      }),
    })
    await act(session.id!, 'inspect.notice', 'advance.inspect')
    await expect(adoptAdventureRuntimeCandidateV1({ scope: seeded.scope, runId: generated.snapshot.run.id }))
      .rejects.toThrow(/已经变化|已过期/)
    expect((await readSimulationState(session.id!)).adventure?.completedActionKeys).not.toContain('take.rope')

    await expect(generateAdventureRuntimeCandidateV1({
      scope: seeded.scope, simulationSessionId: session.id!,
      skillId: 'prose.adventure-intent-parser', objective: '瞬移到终点',
      runAI: async () => JSON.stringify({
        kind: 'adventure-intent', actionKey: 'teleport.ending', rationale: '臆造行动。', requiresConfirmation: true,
      }),
    })).rejects.toThrow('未登记行动')
  }, 30_000)

})
