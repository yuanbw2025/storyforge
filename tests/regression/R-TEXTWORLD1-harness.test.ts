import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  adoptOpenWorldRuntimeCandidateV1,
  generateOpenWorldRuntimeCandidateV1,
} from '../../src/lib/open-world/harness'
import { publishTextOpenWorldGame, seedTextOpenWorldAcceptanceGame } from '../../src/lib/open-world/authoring'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import {
  commitOpenWorldCommand,
  readSimulationState,
  readSimulationStateVersion,
} from '../../src/lib/simulation/runtime'
import { createTextOpenWorldInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

let shared: {
  owned: Awaited<ReturnType<typeof ensureWorkspaceOwnership>>
  gameReleaseId: number
} | null = null

async function fixture(name: string) {
  if (!shared) {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'TEXTWORLD Harness 验收项目',
      genre: 'open-world',
      genres: ['open-world'],
      status: 'drafting',
      description: '',
      targetWordCount: 10_000,
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const owned = await ensureWorkspaceOwnership(projectId)
    const definition = await seedTextOpenWorldAcceptanceGame({ scope: owned.scope })
    const publication = await publishTextOpenWorldGame({
      scope: owned.scope,
      gameDefinitionId: definition.id!,
    })
    shared = { owned, gameReleaseId: publication.gameRelease.id! }
  }
  const fixtureBase = shared
  const session = await createTextOpenWorldInstance({
    scope: fixtureBase.owned.scope,
    gameReleaseId: fixtureBase.gameReleaseId,
    title: name,
    seed: 'textworld-harness-seed',
  })
  const base = await readSimulationStateVersion(session.id!)
  await commitOpenWorldCommand({
    sessionId: session.id!,
    command: { kind: 'draw', trigger: 'observe' },
    commandId: 'fixture.draw.1',
    baseSequence: base.sequence,
    baseStateHash: base.stateHash,
  })
  const state = await readSimulationState(session.id!)
  const instance = state.openWorld?.questInstances.find(item => item.status === 'revealed')
  if (!instance) throw new Error('验收内容未产生公开任务')
  const evidence = (await db.simulationEvents.where('sessionId').equals(session.id!).toArray())
    .find(event => event.type === 'world.quest.revealed' && event.targetKey === null)
    ?? (await db.simulationEvents.where('sessionId').equals(session.id!).toArray())
      .find(event => event.type === 'world.quest.revealed')
  if (!evidence) throw new Error('验收内容缺少任务公开事件')
  return { ...fixtureBase.owned, session, instance, evidence }
}

describe('TEXTWORLD-1 · unified Harness expression candidates', () => {
  beforeAll(async () => { shared = null; await db.delete(); await db.open() })
  afterAll(() => db.close())

  it.sequential('openWorldRuntime 只装配玩家可见区域、公开任务和正式事件', async () => {
    const seeded = await fixture('TEXTWORLD Harness Context')
    const assembled = await assembleContext({
      projectId: seeded.scope.projectId,
      scope: seeded.scope,
      simulationSessionId: seeded.session.id!,
      sourceKeys: ['openWorldRuntime'],
    })
    expect(assembled.included).toEqual(['openWorldRuntime'])
    expect(assembled.text).toContain('【文字开放世界玩家视角】')
    expect(assembled.text).toContain(seeded.instance.instanceKey)
    expect(assembled.text).toContain(`#${seeded.evidence.sequence}｜world.quest.revealed`)
    expect(assembled.text).not.toContain('sourceCooldowns')
    expect(assembled.text).not.toContain('recentFingerprints')
  }, 45_000)

  it.sequential('表现候选走 Instance Harness，采用保持 SIM 只读并可幂等恢复', async () => {
    const seeded = await fixture('TEXTWORLD Harness Adopt')
    const before = await readSimulationStateVersion(seeded.session.id!)
    const generated = await generateOpenWorldRuntimeCandidateV1({
      scope: seeded.scope,
      simulationSessionId: seeded.session.id!,
      skillId: 'prose.open-world-quest-expression',
      objective: '为刚公开的任务写玩家可见描述',
      runAI: async messages => {
        expect(messages.map(message => message.content).join('\n')).toContain('不得改变区域、人物、组织、旅行、任务、资源、问题或结局事实')
        return JSON.stringify({
          kind: 'quest-expression',
          instanceKey: seeded.instance.instanceKey,
          title: seeded.instance.title,
          text: '线索已经公开，玩家可以决定是否接下这项任务。',
          dialogue: '',
          evidenceEventSequences: [seeded.evidence.sequence],
          assertedReferences: [
            { kind: 'region', key: seeded.instance.regionKey },
            { kind: 'quest', key: seeded.instance.questKey },
            { kind: 'participant', key: seeded.instance.participantKeys[0] },
            { kind: 'channel', key: seeded.instance.channelKey },
          ],
        })
      },
    })
    expect(generated.snapshot.run.workId).toBeNull()
    expect(generated.snapshot.run.simulationSessionId).toBe(seeded.session.id)
    expect(generated.snapshot.contract.permissions).toEqual({
      contextSourceKeys: ['openWorldRuntime'],
      writeTargets: [],
    })
    const adopted = await adoptOpenWorldRuntimeCandidateV1({
      scope: seeded.scope,
      runId: generated.snapshot.run.id,
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(await readSimulationStateVersion(seeded.session.id!)).toEqual(before)
    const repeated = await adoptOpenWorldRuntimeCandidateV1({
      scope: seeded.scope,
      runId: generated.snapshot.run.id,
    })
    expect(repeated.receiptHash).toBe(adopted.receiptHash)
  }, 45_000)

  it.sequential('实例推进使旧候选 fail-closed，伪造引用在持久候选前拒绝', async () => {
    const seeded = await fixture('TEXTWORLD Harness Stale')
    const generated = await generateOpenWorldRuntimeCandidateV1({
      scope: seeded.scope,
      simulationSessionId: seeded.session.id!,
      skillId: 'prose.open-world-scene-narration',
      objective: '叙述任务出现后的当前场景',
      runAI: async () => JSON.stringify({
        kind: 'scene-narration',
        instanceKey: seeded.instance.instanceKey,
        title: '区域异动',
        text: '一条已经确认的线索在当前区域传开。',
        dialogue: '',
        evidenceEventSequences: [seeded.evidence.sequence],
        assertedReferences: [{ kind: 'region', key: seeded.instance.regionKey }],
      }),
    })
    const base = await readSimulationStateVersion(seeded.session.id!)
    await commitOpenWorldCommand({
      sessionId: seeded.session.id!,
      command: { kind: 'tick' },
      commandId: 'advance.tick.1',
      baseSequence: base.sequence,
      baseStateHash: base.stateHash,
    })
    await expect(adoptOpenWorldRuntimeCandidateV1({
      scope: seeded.scope,
      runId: generated.snapshot.run.id,
    })).rejects.toThrow(/已经变化|已过期/)

    const currentState = await readSimulationState(seeded.session.id!)
    const currentInstance = currentState.openWorld!.questInstances
      .find(item => item.instanceKey === seeded.instance.instanceKey)!
    const currentEvidence = (await db.simulationEvents.where('sessionId').equals(seeded.session.id!).toArray())
      .filter(event => event.type.startsWith('world.')).pop()!
    await expect(generateOpenWorldRuntimeCandidateV1({
      scope: seeded.scope,
      simulationSessionId: seeded.session.id!,
      skillId: 'prose.open-world-quest-expression',
      objective: '伪造一个人物引用',
      runAI: async () => JSON.stringify({
        kind: 'quest-expression',
        instanceKey: currentInstance.instanceKey,
        title: '伪造内容',
        text: '不存在的人物参与了任务。',
        dialogue: '',
        evidenceEventSequences: [currentEvidence.sequence],
        assertedReferences: [{ kind: 'participant', key: 'participant.missing' }],
      }),
    })).rejects.toThrow('伪造引用')
  }, 45_000)
})
