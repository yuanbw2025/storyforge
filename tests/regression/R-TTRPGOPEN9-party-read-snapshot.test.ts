import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupIdentityKnowledgeRuntimeV1 } from '../helpers/open-identity-knowledge-runtime'
import { loadTtrpgOpenPartyProjectionV1, loadTtrpgOpenCommonProjectionV1, loadTtrpgOpenKpPartyProjectionV1 } from '../../src/lib/ttrpg/open-player-context'
import * as source from '../../src/lib/product-production/preview-source'
import * as plan from '../../src/lib/ttrpg/open-rule-plan'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { branchProductRuntimeSession, readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { stableProductRuntimeJsonV1 as stable } from '../../src/lib/product/runtime-values'

describe('R-TTRPGOPEN9 one verified party snapshot with unchanged recipient projections', { timeout: 30000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('verifies the immutable package once and exactly reproduces the independently read old party intersection', async () => {
    const s = await setupIdentityKnowledgeRuntimeV1(false, true)
    const input = { scope: s.f.scope, sessionId: s.f.sessionId }
    const original = await Promise.all(['companion.1', 'companion.2', 'hero'].map(actorKey => loadTtrpgOpenPartyProjectionV1({ ...input, actorKey })))
    const verify = vi.spyOn(source, 'verifyProductRuntimeSessionSourceV1')
    const common = await loadTtrpgOpenCommonProjectionV1(input)
    expect(verify).toHaveBeenCalledTimes(1)
    for (const key of ['actorsHere', 'initialObservations', 'knowledge', 'sessionFacts', 'pressureSignals'] as const) {
      const sets = original.map(row => new Set(row.view[key].map(value => stable(value))))
      const expected = original[0].view[key].filter(value => sets.every(set => set.has(stable(value))))
      expect(stable(common.view[key]), key).toBe(stable(expected))
    }
    expect(common.recipientActorKeys).toEqual(['companion.1', 'companion.2', 'hero'])
    expect(JSON.stringify(common)).not.toMatch(/gmProfile|playerProfile|characterSheet|新守灯人|害怕洪水/)
    expect(common.view).not.toHaveProperty('self')
    expect(common.view.knowledge).toEqual([])
    expect(original.every(row => stable(row.readEvidence) === stable(common.readEvidence))).toBe(true)
  })
  it('preserves legacy KP consent without granting the logging-dependent common memory reader', async () => {
    const s = await setupIdentityKnowledgeRuntimeV1(false, true)
    const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, title: 'legacy KP consent', throughSequence: (await readProductRuntimeState(s.f.sessionId)).lastSequence })
    const seat = (await readTtrpgSessionParticipantsV2(child.id!)).find(row => row.actorKey === 'hero')!
    await configureTtrpgSessionParticipantV2({ sessionId: child.id!, seatKey: seat.seatKey, expectedRevision: seat.revision, commandId: 'legacy.no-log', requestedByViewerKey: OPEN_HUMAN_VIEWER, consent: { sessionLoggingAllowed: false } })
    const state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'legacy.no-log.zero'), viewerKey: 'viewer.gm', acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    const input = { scope: s.f.scope, sessionId: child.id! }
    expect((await loadTtrpgOpenKpPartyProjectionV1(input)).recipientActorKeys).toEqual(['companion.1', 'companion.2', 'hero'])
    await expect(loadTtrpgOpenCommonProjectionV1(input)).rejects.toThrow(/记录同意/)
  })
  it('still refuses actual participant storage drift after the shared basis was authenticated', async () => {
    const s = await setupIdentityKnowledgeRuntimeV1(false, true), original = plan.ttrpgOpenMechanicalStateHashV1
    const seat = (await readTtrpgSessionParticipantsV2(s.f.sessionId)).find(row => row.actorKey === 'hero')!
    vi.spyOn(plan, 'ttrpgOpenMechanicalStateHashV1').mockImplementationOnce(async state => {
      const hash = await original(state)
      // Corrupt/stale storage evidence, not an authorized consent update after Session Zero.
      await db.ttrpgSessionParticipants.update(seat.id!, { revision: seat.revision + 1 })
      return hash
    })
    await expect(loadTtrpgOpenCommonProjectionV1({ scope: s.f.scope, sessionId: s.f.sessionId })).rejects.toThrow(/变化|参与者|授权|revision/)
  })
})
