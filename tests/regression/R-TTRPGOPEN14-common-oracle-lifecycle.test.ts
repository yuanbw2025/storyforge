import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { setupCommonOracleModelV1 } from '../helpers/open-common-oracle-model'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { generateTtrpgOpenCommonOracleCandidateV1, executeTtrpgOpenCommonOracleRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'
import { reviewTtrpgOpenCommonOracleCandidateV1, completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { closeTtrpgOpenReviewedCommonOracleWindowV1 } from '../../src/lib/ttrpg/open-common-oracle-close'
import { loadTtrpgOpenCommonOracleContextV1 } from '../../src/lib/ttrpg/open-common-oracle-context'
import { readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScope } from '../../src/lib/workspace/scope'

describe('R-TTRPGOPEN14 confirmed common Oracle fact lineage without inherited execution', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('keeps actual before/after confirmation cuts, parent deletion and complete backup while the original model Run cannot execute in either child', async () => {
    const s = await setupCommonOracleModelV1(), fact = { kind: 'relation', subjectRef: s.npc, predicateKey: 'knows', objectRef: 'harbor', canonicalValue: true,
      detail: 'COMMON-CONFIRMED-LINEAGE-FACT', sourceFactRefs: [], audience: 'party', knownByActorKeys: s.grant.basis.recipientActorKeys, supersedes: null, supersedeReason: null }
    const generated = await generateTtrpgOpenCommonOracleCandidateV1({ ...s.read, runAI: async () => JSON.stringify({ interpretation: '保留原共同解释。', facts: [fact] }) })
    const before = await readProductRuntimeState(s.f.sessionId)
    await reviewTtrpgOpenCommonOracleCandidateV1({ ...s.read, ...await openEnvelopeV1(s.f.sessionId, 'common.lifecycle.review'), candidateHash: generated.candidate.candidateHash,
      interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }] })
    await closeTtrpgOpenReviewedCommonOracleWindowV1({ ...s.owner, epochKey: s.grant.epochKey, decision: 'close-this-reviewed-common-oracle-window' })
    const after = await readProductRuntimeState(s.f.sessionId), children = []
    for (const [label, throughSequence] of [['before', before.lastSequence], ['after', after.lastSequence]] as const) {
      const child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence, title: 'Common fact cut ' + label })
      const state = await readProductRuntimeState(child.id!)
      await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'common.lifecycle.' + label + '.zero'), viewerKey: s.owner.viewerKey,
        selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'], acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys })
      const owner = { ...s.owner, sessionId: child.id! }
      await expect(executeTtrpgOpenCommonOracleRequestV1({ ...s.read, ...owner, runAI: async () => { throw new Error('child must not send') } })).rejects.toThrow()
      children.push({ child, owner, source: await loadTtrpgOpenCommonOracleContextV1({ ...owner, actorKey: 'gm' }) })
    }
    expect(JSON.stringify(children[0].source.resources)).not.toContain(fact.detail)
    expect(JSON.stringify(children[1].source.resources)).toContain(fact.detail)
    await deleteProductRuntimeSession(s.f.sessionId)
    for (const row of children) expect((await loadTtrpgOpenCommonOracleContextV1({ ...row.owner, actorKey: 'gm' })).resources).toEqual(row.source.resources)
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId))
    for (const row of children) {
      const copy = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(session => JSON.parse(session.initialStateJson).ttrpg.sessionKey === row.source.readEvidence.sessionKey)!
      const scope = await resolveScope({ scope: { projectId, worldId: copy.worldId!, workId: copy.workId! } })
      const restored = await loadTtrpgOpenCommonOracleContextV1({ scope, sessionId: copy.id!, actorKey: 'gm' })
      expect(restored.resources).toEqual(row.source.resources)
      expect((await readProductRuntimeState(copy.id!)).ttrpg!.openRun!.factLedger).toEqual((await readProductRuntimeState(row.child.id!)).ttrpg!.openRun!.factLedger)
    }
  })
})
