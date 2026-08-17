import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { publishAdventureGameDraft, seedAdventureAcceptanceGame } from '../../src/lib/adventure/authoring'
import { adoptAdventureRuntimeCandidateV1, generateAdventureRuntimeCandidateV1 } from '../../src/lib/adventure/harness'
import { db } from '../../src/lib/db/schema'
import { commitAdventureAction, readSimulationStateVersion } from '../../src/lib/simulation/runtime'
import { createTextAdventureInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

describe('TEXTADV-1 · read-only result narrator', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('结果叙述候选引用正式事件但不改变确定性状态', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'TEXTADV Narrator', genre: 'adventure', genres: ['adventure'], status: 'drafting',
      description: '', targetWordCount: 10_000, createdAt: now, updatedAt: now,
    } as any) as number
    const owned = await ensureWorkspaceOwnership(projectId)
    const definition = await seedAdventureAcceptanceGame({ scope: owned.scope, title: '叙述样例' })
    const publication = await publishAdventureGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    const session = await createTextAdventureInstance({
      scope: owned.scope, gameReleaseId: publication.gameRelease.id!, title: '叙述存档', seed: 'narrator-seed',
    })
    const base = await readSimulationStateVersion(session.id!)
    const committed = await commitAdventureAction({
      sessionId: session.id!, actionKey: 'take.rope', commandId: 'button.rope',
      baseSequence: base.sequence, baseStateHash: base.stateHash,
    })
    const before = await readSimulationStateVersion(session.id!)
    const generated = await generateAdventureRuntimeCandidateV1({
      scope: owned.scope, simulationSessionId: session.id!,
      skillId: 'prose.adventure-result-narrator', objective: '润色刚才拿起绳索的结果',
      runAI: async () => JSON.stringify({
        kind: 'adventure-result', narrative: '盐雾浸透旧绳，你仍将它稳稳盘在臂弯。',
        evidenceEventSequences: [committed.sequence],
      }),
    })
    const adopted = await adoptAdventureRuntimeCandidateV1({ scope: owned.scope, runId: generated.snapshot.run.id })
    expect(adopted.event).toBeNull()
    expect(adopted.candidate).toMatchObject({ kind: 'adventure-narration-candidate' })
    expect(await readSimulationStateVersion(session.id!)).toEqual(before)
    expect(adopted.snapshot.projection.state).toBe('completed')
  }, 20_000)
})
