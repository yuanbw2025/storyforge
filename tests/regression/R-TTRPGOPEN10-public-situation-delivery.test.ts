import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { createTtrpgOpenPublicSituationAuthorizationV1 } from '../../src/lib/ttrpg/open-public-situation-authorization'
import { loadTtrpgOpenPublicSituationKernelV1 } from '../../src/lib/ttrpg/open-public-situation-kernel'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { reviewTtrpgOpenDeliveredPublicSituationV1 } from '../../src/lib/ttrpg/open-public-situation-delivery'
import { publicSituationOutputV1 } from '../helpers/open-public-situation-generation'

async function setup() {
  const f = await readyOpenTtrpgSessionV1('Public delivery proof', pkg => {
    const c = pkg.ttrpg!.campaign; c.runtimePolicy.enabled = true; c.runtimePolicy.maximumEpochTokens = 50000; c.runtimePolicy.maximumOutputTokens = 8000
    c.fronts[0].goal = 'PRIVATE-DELIVERY-FRONT'; c.characterTemplates[0].description = 'PRIVATE-DELIVERY-BIOGRAPHY'
  })
  const auth = await createTtrpgOpenPublicSituationAuthorizationV1({ ...await openEnvelopeV1(f.sessionId, 'public.delivery.authorize'),
    scope: f.scope, viewerKey: OPEN_HUMAN_VIEWER, rawInput: '只根据共同资料拟定一次新局势', sharingDecision: 'share-this-request-with-current-party',
    delegationDecision: 'draft-only', modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 4000, maximumCostUsd: 0.1 })
  const epoch = (await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.epochs.find(e => e.publicSituation?.run.runId === auth.runId)!
  const snapshot = await loadTtrpgOpenPublicSituationKernelV1({ ...f, actorKey: 'gm' }, epoch.publicSituation!)
  const reads = snapshot.resources.map(row => ({ sourceKey: 'ttrpgOpenPublicSituationInput', resourceKey: `fact:ttrpg-open:${snapshot.basis.sessionKey}:gm:${row.suffix}`, content: canonicalStringify(row.value) }))
  return { f, snapshot, reads, value: publicSituationOutputV1(snapshot) }
}
describe('R-TTRPGOPEN10 independent common projection reference evidence', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('accepts complete public bodies while retaining S1-S10 and A1-A3 and honest projection granularity', async () => {
    const { snapshot, reads, value } = await setup()
    expect(JSON.stringify(reads)).not.toContain('PRIVATE-DELIVERY-')
    const result = await reviewTtrpgOpenDeliveredPublicSituationV1({ snapshot, reads, value })
    expect(result.review.evaluation.accepted).toBe(true)
    expect(result.references).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'clock', ref: 'flood', projection: 'visible-clock' }),
      expect.objectContaining({ kind: 'personalization', projection: 'selected-identity' }),
      expect.objectContaining({ kind: 'fact', ref: 'fact.harbor', projection: 'release-observation' }),
    ]))
    for (const proof of result.references) expect(proof.contentHash).toBe(await hashCanonicalValue(JSON.parse(reads.find(row => row.resourceKey === proof.resourceKey)!.content)))
  })
  it('requires the exact full used body and all mandatory resources; a directory, duplicate, private source or edited body cannot substitute', async () => {
    const { snapshot, reads, value } = await setup()
    const fact = reads.find(row => row.content.includes('"factRef":"fact.harbor"'))!
    for (const invalid of [reads.filter(row => row !== fact), reads.slice(1), [...reads, reads[0]],
      reads.map(row => row === fact ? { ...row, content: '{}' } : row), reads.map(row => ({ ...row, sourceKey: 'ttrpgOpenSituationInput' }))]) {
      await expect(reviewTtrpgOpenDeliveredPublicSituationV1({ snapshot, reads: invalid, value })).rejects.toThrow(/共同资料证明/)
    }
  })
  it('rejects private owners, full effects and invented commitments before inspecting hidden kernel values', async () => {
    const { snapshot, reads, value } = await setup()
    const variants = [structuredClone(value), structuredClone(value), structuredClone(value), structuredClone(value), structuredClone(value)]
    variants[0].template.preconditions = [{ op: 'actor-at', actorKey: 'keeper', locationRef: 'harbor' } as any]
    variants[1].template.noInterventionOutcome.effectPlanRef = snapshot.basis.campaign.effectPlanTemplates[0].planKey
    variants[2].template.driverBinding = { kind: 'front', frontKey: snapshot.basis.campaign.fronts[0].frontKey }
    variants[3].personalizationSourceKeys = ['commitment.invented']
    variants[4].template.evidence[0].discoveryPolicy.recipientActorKeys = ['keeper'] // Visible NPC is not a selected player recipient.
    for (const variant of variants) {
      let message = ''
      try { await reviewTtrpgOpenDeliveredPublicSituationV1({ snapshot, reads, value: variant }) } catch (error) { message = String(error) }
      expect(message).toMatch(/共同资料|当前权威/); expect(message).not.toContain('PRIVATE-DELIVERY-')
    }
  })
})
