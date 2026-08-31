import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendAgentRunEventV1 } from '../../src/lib/agent/run/event-store'
import {
  adoptInteractionRuntimeCandidateV1,
  generateInteractionRuntimeCandidateV1,
} from '../../src/lib/character-interaction/harness'
import { db } from '../../src/lib/db/schema'
import { deriveStrictExportProjectJSON } from '../../src/lib/export/registry-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { buildSimulationCanonSnapshot } from '../../src/lib/simulation/canon-snapshot'
import {
  commitInteractionPlayerMessage,
  createSimulationSessionFixtureV1,
  deleteSimulationSession,
  readSimulationState,
  readSimulationStateVersion,
  startInteractionScene,
} from '../../src/lib/simulation/runtime'
import type {
  SimulationInteractionState,
  SimulationRuntimeState,
  WorkspaceScope,
} from '../../src/lib/types'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

function interaction(): SimulationInteractionState {
  return {
    schema: 'storyforge.character-interaction', version: 1, playerKey: 'player',
    profiles: [{
      participantKey: 'aria', characterKey: 'character:aria', name: '阿莉娅',
      roleLabel: '信使', voiceRules: '克制直接', maxMemoryEntries: 20,
    }],
    sceneTemplates: [{
      sceneKey: 'tower', title: '钟楼', purpose: '回应玩家', location: '旧钟楼', timeLabel: '雨夜',
      participantKeys: ['aria'], publicKnowledgeKeys: [], goals: ['回答问题'], endingConditions: ['玩家离开'],
      safetyBoundaries: ['不替玩家发言'], openingNodeKey: null, endingNodeKey: null,
      maxTurns: 20, directorBudget: 100,
    }],
    activeScene: null, sceneHistory: [], messages: [], knowledge: [], memories: [],
    relationships: [], relationshipHistory: [], threads: [], totalPlayerTurns: 0, remainingDirectorBudget: 0,
  }
}

function initialState(): SimulationRuntimeState {
  return {
    version: 1, clock: 0, entities: {}, memories: [], narratives: [],
    ttrpg: null, chat: null, interaction: interaction(), narrative: null, lastSequence: 0,
  }
}

async function fixture(): Promise<{ scope: WorkspaceScope; sessionId: number; playerSequence: number }> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'HARNESS-RUNTIME-1', genre: 'drama', genres: ['drama'], description: '', status: 'drafting',
    targetWordCount: 10_000, enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `runtime-${projectId}`, name: '钟楼世界', description: '', currentVersion: 1,
    createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: '钟楼来信', description: '', genres: ['drama'], status: 'drafting',
    targetWordCount: 10_000, createdAt: now, updatedAt: now,
  }) as number
  await db.projects.update(projectId, {
    activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1,
    worldCode: `runtime-${projectId}`, worldVersion: 1,
  })
  const scope = { projectId, worldId, workId }
  const canon = await buildSimulationCanonSnapshot({
    projectId, scope, worldGroupId: null, sourceKeys: [`project-world:${projectId}`],
  })
  const draftSnapshotHash = await hashCanonicalValue({ kind: 'chatgame-draft', projectId, worldId, workId })
  const created = await createSimulationSessionFixtureV1({
    projectId, kind: 'chatgame', title: '雨夜钟楼', canonSnapshot: canon.snapshot, initialState: initialState(),
  })
  await db.simulationSessions.update(created.id!, { worldId, workId, draftSnapshotHash })
  let version = await readSimulationStateVersion(created.id!)
  await startInteractionScene({
    sessionId: created.id!, commandId: 'fixture:scene', baseSequence: version.sequence,
    baseStateHash: version.stateHash, sceneId: 'scene:tower:1', sceneKey: 'tower',
  })
  version = await readSimulationStateVersion(created.id!)
  const player = await commitInteractionPlayerMessage({
    sessionId: created.id!, commandId: 'fixture:player', baseSequence: version.sequence,
    baseStateHash: version.stateHash, messageId: 'message:player:1', text: '你收到我的信了吗？', audienceKeys: ['aria'],
  })
  return { scope, sessionId: created.id!, playerSequence: player.sequence }
}

describe('R-HARNESS-RUNTIME1 · Instance-scoped 统一 Harness', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('冻结角色可见输入，严格生成候选，并经现有 SIM 命令和终验回执采用', async () => {
    const seeded = await fixture()
    const generated = await generateInteractionRuntimeCandidateV1({
      scope: seeded.scope,
      simulationSessionId: seeded.sessionId,
      participantKey: 'aria',
      skillId: 'character.interaction-reply',
      objective: '回应玩家的问题',
      runAI: async messages => {
        expect(messages.map(message => message.content).join('\n')).toContain('你收到我的信了吗')
        return JSON.stringify({
          kind: 'character-reply', text: '收到了，只是雨把封口打湿了。',
          replyToSequence: seeded.playerSequence, audienceKeys: ['player'], budgetCost: 1, disclosures: [],
        })
      },
    })
    expect(generated.snapshot.run.workId).toBeNull()
    expect(generated.snapshot.run.simulationSessionId).toBe(seeded.sessionId)
    expect(generated.snapshot.contract.scope.runtime?.baseSequence).toBe(seeded.playerSequence)

    const adopted = await adoptInteractionRuntimeCandidateV1({ scope: seeded.scope, runId: generated.snapshot.run.id })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.event?.type).toBe('interaction.character.reply.committed')
    expect((await readSimulationState(seeded.sessionId)).interaction?.messages.at(-1)?.text)
      .toBe('收到了，只是雨把封口打湿了。')

    const repeated = await adoptInteractionRuntimeCandidateV1({ scope: seeded.scope, runId: generated.snapshot.run.id })
    expect(repeated.event?.id).toBe(adopted.event?.id)
    expect((await db.simulationEvents.where('sessionId').equals(seeded.sessionId).toArray())
      .filter(event => event.commandId === `harness:${generated.snapshot.run.id}:character-reply-candidate`)).toHaveLength(1)
  })

  it('SIM 推进后候选 fail-closed，不写角色回复', async () => {
    const seeded = await fixture()
    const generated = await generateInteractionRuntimeCandidateV1({
      scope: seeded.scope, simulationSessionId: seeded.sessionId, participantKey: 'aria',
      skillId: 'character.interaction-reply', objective: '回应玩家',
      runAI: async () => JSON.stringify({
        kind: 'character-reply', text: '这是即将过期的回复。', replyToSequence: seeded.playerSequence,
        audienceKeys: null, budgetCost: 0, disclosures: [],
      }),
    })
    const version = await readSimulationStateVersion(seeded.sessionId)
    await commitInteractionPlayerMessage({
      sessionId: seeded.sessionId, commandId: 'fixture:advance', baseSequence: version.sequence,
      baseStateHash: version.stateHash, messageId: 'message:player:2', text: '我又问了一次。', audienceKeys: ['aria'],
    })
    await expect(adoptInteractionRuntimeCandidateV1({ scope: seeded.scope, runId: generated.snapshot.run.id }))
      .rejects.toThrow(/已经变化|已过期/)
    expect((await readSimulationState(seeded.sessionId)).interaction?.messages.some(message => message.text === '这是即将过期的回复。')).toBe(false)
    expect((await db.agentRuns.get(generated.snapshot.run.id))?.status).toBe('paused')
  })

  it('采用事件保留为专用入口，并可从采用后崩溃边界幂等恢复终验', async () => {
    const seeded = await fixture()
    const generated = await generateInteractionRuntimeCandidateV1({
      scope: seeded.scope, simulationSessionId: seeded.sessionId, participantKey: 'aria',
      skillId: 'character.interaction-reply', objective: '回应玩家',
      runAI: async () => JSON.stringify({
        kind: 'character-reply', text: '我会记住这封信。', replyToSequence: seeded.playerSequence,
        audienceKeys: ['player'], budgetCost: 0, disclosures: [],
      }),
    })
    await expect(appendAgentRunEventV1({
      scope: seeded.scope, runId: generated.snapshot.run.id, type: 'runtime.candidate.adopted',
      payload: {
        stepId: 'interaction:runtime-candidate', candidateHash: 'a'.repeat(64), adoptionHash: 'b'.repeat(64),
        commandIds: [], baseSequence: seeded.playerSequence, resultingSequence: seeded.playerSequence,
      },
    })).rejects.toMatchObject({ code: 'reserved_event' })

    await expect(adoptInteractionRuntimeCandidateV1({
      scope: seeded.scope,
      runId: generated.snapshot.run.id,
      onDurableBoundary: type => { if (type === 'runtime.candidate.adopted') throw new Error('simulated-crash') },
    })).rejects.toThrow('simulated-crash')
    const resumed = await adoptInteractionRuntimeCandidateV1({ scope: seeded.scope, runId: generated.snapshot.run.id })
    expect(resumed.snapshot.projection.state).toBe('completed')
    expect((await db.simulationEvents.where('sessionId').equals(seeded.sessionId).toArray())
      .filter(event => event.commandId === `harness:${generated.snapshot.run.id}:character-reply-candidate`)).toHaveLength(1)
  })

  it('严格备份往返重映射 Instance owner 和契约 runtime session ID', async () => {
    const seeded = await fixture()
    const generated = await generateInteractionRuntimeCandidateV1({
      scope: seeded.scope, simulationSessionId: seeded.sessionId, participantKey: 'aria',
      skillId: 'prose.interaction-scene-director', objective: '选择回应角色',
      runAI: async () => JSON.stringify({
        kind: 'scene-director', responders: [{ participantKey: 'aria', intent: '确认收到信件' }],
        shouldEnd: false, endReason: null,
      }),
    })
    const exported = await deriveStrictExportProjectJSON(seeded.scope.projectId)
    const exportedRun = exported.agentRuns?.find(row => row._exportId === 0) as any
    expect(exportedRun._instanceOwnerExportId).toBeTypeOf('number')
    expect(exportedRun.simulationSessionId).toBeUndefined()
    expect(JSON.parse(exportedRun.contractJson).scope.runtime.simulationSessionId).toBe(exportedRun._instanceOwnerExportId + 1)

    const importedProjectId = await deriveImportProjectJSON(exported)
    const importedRun = (await db.agentRuns.where('projectId').equals(importedProjectId).toArray())[0]
    const importedSession = (await db.simulationSessions.where('projectId').equals(importedProjectId).toArray())[0]
    expect(importedRun.workId).toBeNull()
    expect(importedRun.simulationSessionId).toBe(importedSession.id)
    expect(JSON.parse(importedRun.contractJson).scope.runtime.simulationSessionId).toBe(importedSession.id)
    expect(importedRun.id).not.toBe(generated.snapshot.run.id)
  })

  it('删除实例通过 PROJECT_TABLES 引用级联清理 run、事件与检查点', async () => {
    const seeded = await fixture()
    const generated = await generateInteractionRuntimeCandidateV1({
      scope: seeded.scope, simulationSessionId: seeded.sessionId, participantKey: 'aria',
      skillId: 'character.interaction-memory-curator', objective: '整理可追溯记忆',
      runAI: async () => JSON.stringify({
        kind: 'memory-curator', memoryKind: 'key-memory', content: '玩家询问信件是否收到。', importance: 70,
        sourceEventSequences: [seeded.playerSequence], evidenceExcerpt: '你收到我的信了吗',
      }),
    })
    expect(await db.agentRunEvents.where('runId').equals(generated.snapshot.run.id).count()).toBeGreaterThan(0)
    expect(await db.agentRunCheckpoints.where('runId').equals(generated.snapshot.run.id).count()).toBe(1)
    await deleteSimulationSession(seeded.sessionId)
    expect(await db.agentRuns.get(generated.snapshot.run.id)).toBeUndefined()
    expect(await db.agentRunEvents.where('runId').equals(generated.snapshot.run.id).count()).toBe(0)
    expect(await db.agentRunCheckpoints.where('runId').equals(generated.snapshot.run.id).count()).toBe(0)
  })
})
