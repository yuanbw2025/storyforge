import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState, branchProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { loadTtrpgOpenPlayerContextV1 } from '../../src/lib/ttrpg/open-player-context'
import { readTtrpgOpenConsultationDeskV1, startTtrpgOpenConsultationDeskV1, consultTtrpgOpenConsultationDeskV1 } from '../../src/lib/ttrpg/open-consultation-desk'
import { prepareTtrpgOpenClueShareV1, confirmTtrpgOpenClueShareV1 } from '../../src/lib/ttrpg/open-knowledge-share-desk'
import { setupClueSharingDeskV1 } from '../helpers/open-consultation-runtime'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { changeTtrpgSafetyStatus, completeTtrpgOpenSessionZeroV1 } from '../../src/lib/ttrpg/runtime-commands'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

describe('R-TTRPGOPEN15 actual discovered clue review and explicit sharing', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  async function setup() {
    const s = await setupClueSharingDeskV1()
    await startTtrpgOpenConsultationDeskV1({ ...s.input, submissionKey: 'share.window', decision: 'start-this-consultation-and-sharing' })
    return s
  }
  const prepare = (s: Awaited<ReturnType<typeof setup>>, submissionKey = 'share.review') => prepareTtrpgOpenClueShareV1({ ...s.input, submissionKey,
    actorKey: 'hero', sourceKnowledgeKey: s.root.knowledgeKey, audience: 'party', recipientActorKeys: ['hero', 'companion.1', 'companion.2'] })
  it('previews only owned public fields, grants nothing before consent and shares attributed hearsay exactly once', async () => {
    const s = await setup(), before = await readProductRuntimeState(s.f.sessionId), world = await db.worldReleases.toArray()
    const review = await prepare(s)
    expect(review.reliability).toBe('hearsay'); expect(review.recipients).toHaveLength(3); expect(JSON.stringify(review)).not.toContain('CLUE-SHARING-GM-SECRET')
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
    expect((await loadTtrpgOpenPlayerContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'companion.1' })).view.knowledge).toEqual([])
    const input = { ...s.input, review, decision: 'share-this-exact-clue-with-these-recipients' as const }
    const event = await confirmTtrpgOpenClueShareV1(input); expect(await confirmTtrpgOpenClueShareV1(input)).toEqual(event)
    const after = await readProductRuntimeState(s.f.sessionId)
    expect(after.ttrpg!.openRun!.knowledge[0]).toEqual(s.root); expect(after.ttrpg!.openRun!.knowledge).toHaveLength(2)
    for (const actorKey of ['companion.1', 'companion.2']) {
      const view = (await loadTtrpgOpenPlayerContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey })).view
      expect(view.knowledge).toHaveLength(1); expect(view.knowledge[0]).toMatchObject({ title: review.title, description: review.description, reliability: 'hearsay' })
    }
    expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(await db.agentRuns.count()).toBe(0); expect(await db.worldReleases.toArray()).toEqual(world)
  })
  it('rejects copied, altered, foreign and stale pending reviews without granting knowledge', async () => {
    const s = await setup(), review = await prepare(s), decision = 'share-this-exact-clue-with-these-recipients' as const
    await expect(confirmTtrpgOpenClueShareV1({ ...s.input, review: structuredClone(review), decision })).rejects.toThrow(/重新审阅/)
    await expect(confirmTtrpgOpenClueShareV1({ ...s.input, viewerKey: 'viewer.seat.companion.2', review, decision })).rejects.toThrow(/重新审阅/)
    await expect(confirmTtrpgOpenClueShareV1({ ...s.input, scope: { ...s.input.scope, projectId: 'foreign' }, review, decision })).rejects.toThrow(/重新审阅/)
    review.description += ' 伪造新增'; await expect(confirmTtrpgOpenClueShareV1({ ...s.input, review, decision })).rejects.toThrow(/重新审阅/)
    const fresh = await prepare(s, 'fresh')
    await consultTtrpgOpenConsultationDeskV1({ ...s.input, submissionKey: 'changes-head', oracleKey: 'oracle.yes', question: '潮水是否涨高？', likelihoodTierKey: 'even' })
    await expect(confirmTtrpgOpenClueShareV1({ ...s.input, review: fresh, decision })).rejects.toThrow(/基线已变化/)
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.knowledge).toHaveLength(1)
  })
  it('excludes unshared knowledge from another human and does not expose an approved companion private source', async () => {
    const s = await setup()
    expect((await readTtrpgOpenConsultationDeskV1({ ...s.input, viewerKey: 'viewer.seat.companion.2' })).sharing.sources).toEqual([])
    const review = await prepareTtrpgOpenClueShareV1({ ...s.input, submissionKey: 'private', actorKey: 'hero', sourceKnowledgeKey: s.root.knowledgeKey,
      audience: 'private', recipientActorKeys: ['companion.1'] })
    await confirmTtrpgOpenClueShareV1({ ...s.input, review, decision: 'share-this-exact-clue-with-these-recipients' })
    const state = await readProductRuntimeState(s.f.sessionId), last = state.ttrpg!.openRun!.knowledge[1]
    expect((await readTtrpgOpenConsultationDeskV1(s.input)).sharing.sources.some(row => row.knowledgeKey === last.knowledgeKey)).toBe(false)
    await expect(prepareTtrpgOpenClueShareV1({ ...s.input, submissionKey: 'impersonate', actorKey: 'companion.1', sourceKnowledgeKey: last.knowledgeKey, audience: 'public', recipientActorKeys: [] })).rejects.toThrow(/本人有权/)
    expect((await loadTtrpgOpenPlayerContextV1({ scope: s.f.scope, sessionId: s.f.sessionId, actorKey: 'companion.2' })).view.knowledge).toEqual([])
  })
  it('rejects partial party recipients, absent explicit confirmation and a paused review', async () => {
    const s = await setup()
    await expect(prepareTtrpgOpenClueShareV1({ ...s.input, submissionKey: 'partial', actorKey: 'hero', sourceKnowledgeKey: s.root.knowledgeKey, audience: 'party', recipientActorKeys: ['companion.1'] })).rejects.toThrow(/接收者/)
    const review = await prepare(s)
    await expect(confirmTtrpgOpenClueShareV1({ ...s.input, review, decision: 'implicit' as 'share-this-exact-clue-with-these-recipients' })).rejects.toThrow()
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(s.f.sessionId, 'pause'), viewerKey: s.input.viewerKey, changedBy: s.input.viewerKey, status: 'paused', reason: '暂停核对' })
    await expect(confirmTtrpgOpenClueShareV1({ ...s.input, review, decision: 'share-this-exact-clue-with-these-recipients' })).rejects.toThrow(/基线已变化/)
    expect((await readProductRuntimeState(s.f.sessionId)).ttrpg!.openRun!.knowledge).toHaveLength(1)
  })
  it('retains original discovery/share lineage through branch and backup and never revives a pending review', async () => {
    const s = await setup(), review = await prepare(s)
    await confirmTtrpgOpenClueShareV1({ ...s.input, review, decision: 'share-this-exact-clue-with-these-recipients' })
    const original = await readProductRuntimeState(s.f.sessionId), child = await branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: original.lastSequence, title: 'clue desk child' })
    const state = await readProductRuntimeState(child.id!)
    await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(child.id!, 'child.zero'), viewerKey: s.input.viewerKey,
      acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
    const childPage = await readTtrpgOpenConsultationDeskV1({ ...s.input, sessionId: child.id! })
    expect(childPage.sharing.sources.some(row => row.title === review.title)).toBe(true)
    const projectId = await importProjectJSON(await exportProjectJSON(s.f.scope.projectId)), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(row => row.title === 'clue desk child')!
    const imported = await readProductRuntimeState(session.id!)
    expect(imported.ttrpg!.openRun!.knowledgeShares).toEqual(original.ttrpg!.openRun!.knowledgeShares)
    expect(imported.ttrpg!.openRun!.knowledge).toEqual(original.ttrpg!.openRun!.knowledge)
    await expect(confirmTtrpgOpenClueShareV1({ ...s.input, sessionId: session.id!, review, decision: 'share-this-exact-clue-with-these-recipients' })).rejects.toThrow(/重新审阅/)
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(original)
  })
})
