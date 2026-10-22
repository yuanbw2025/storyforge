import { describe, expect, it } from 'vitest'
import { parseTtrpgOpenKnowledgeEntryV1, parseTtrpgOpenKnowledgeV1, ttrpgOpenActorKnowsEvidenceV1,
  projectTtrpgOpenPublicKnowledgeV1, projectTtrpgOpenKnowledgeForViewerV1, hashTtrpgOpenEvidenceFieldsV1 } from '../../src/lib/ttrpg/open-knowledge'
import { evaluateTtrpgPredicateV1 } from '../../src/lib/ttrpg/predicate'
import { ttrpgOpenPredicateContextV1 } from '../../src/lib/ttrpg/open-rule-plan'
import { readyOpenTtrpgSessionV1 } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { db } from '../../src/lib/db/schema'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'
import type { TtrpgOpenAuthorizationV1 } from '../../src/lib/ttrpg/open-authorization'
const campaign = openCampaignFixture()
const entry = { knowledgeKey: 'session.a.discovery.1', evidenceRef: 'evidence.door', sourceFactRefs: ['fact.harbor'],
  sourceResourceRefs: ['world.harbor'], acquisitionRef: { sessionKey: 'session.a', sequence: 7 }, audience: 'private' as const,
  recipientActorKeys: ['hero'], publicFieldsHash: 'c'.repeat(64), reliability: 'observed' as const }
// Projection consumes a previously verified authority object. These tests are purely about grants, not Session Zero.
const authorization = { selectedActorKeys: ['hero', 'companion.1'], seats: [
  { actorKey: 'hero', role: 'player', viewerKey: 'viewer.hero' },
  { actorKey: 'companion.1', role: 'player', viewerKey: 'viewer.companion' },
] } as TtrpgOpenAuthorizationV1

describe('R-TTRPGOPEN1 durable knowledge owner', () => {
  it('requires explicit recipients, unique keys and qualified acquisition identities', () => {
    expect(parseTtrpgOpenKnowledgeEntryV1(entry)).toEqual(entry)
    expect(() => parseTtrpgOpenKnowledgeEntryV1({ ...entry, recipientActorKeys: [] })).toThrow(/接收者/)
    expect(() => parseTtrpgOpenKnowledgeEntryV1({ ...entry, acquisitionRef: 7 })).toThrow()
    expect(() => parseTtrpgOpenKnowledgeV1([entry, entry])).toThrow(/重复/)
  })
  it('does not count undetected frozen evidence or another actor private grant', () => {
    expect(ttrpgOpenActorKnowsEvidenceV1([], 'hero', 'evidence.door')).toBe(false)
    expect(ttrpgOpenActorKnowsEvidenceV1([entry], 'hero', 'evidence.door')).toBe(true)
    expect(ttrpgOpenActorKnowsEvidenceV1([entry], 'companion.1', 'evidence.door')).toBe(false)
    expect(projectTtrpgOpenPublicKnowledgeV1([entry], campaign)).toEqual([])
    expect(projectTtrpgOpenKnowledgeForViewerV1({ entries: [entry], authorization, viewerKey: 'viewer.companion', campaign })).toEqual([])
    expect(() => projectTtrpgOpenKnowledgeForViewerV1({ entries: [entry], authorization, viewerKey: 'fake.gm', campaign })).toThrow(/身份/)
  })
  it('keeps a party recipient snapshot without expanding to later entrants', () => {
    const party = { ...entry, audience: 'party' as const, recipientActorKeys: ['hero'] }
    expect(ttrpgOpenActorKnowsEvidenceV1([party], 'companion.1', 'evidence.door')).toBe(false)
    expect(projectTtrpgOpenKnowledgeForViewerV1({ entries: [party], authorization, viewerKey: 'viewer.hero', campaign })).toEqual([
      { evidenceRef: 'evidence.door', title: '磨损的标记', description: '有人刚刚来过', reliability: 'observed' },
    ])
    expect(projectTtrpgOpenPublicKnowledgeV1([party], campaign)).toEqual([])
  })
  it('labels hearsay/belief for display but excludes them from objective evidence gates', () => {
    const hearsay = { ...entry, reliability: 'hearsay' as const }
    expect(ttrpgOpenActorKnowsEvidenceV1([hearsay], 'hero', 'evidence.door')).toBe(false)
    expect(projectTtrpgOpenKnowledgeForViewerV1({ entries: [hearsay], authorization, viewerKey: 'viewer.hero', campaign })[0].reliability).toBe('hearsay')
    expect(ttrpgOpenActorKnowsEvidenceV1([{ ...entry, reliability: 'belief' }], 'hero', 'evidence.door')).toBe(false)
  })
  it('uses the knowledge owner in formal runtime predicates, never template party visibility', async () => {
    await db.delete(); await db.open()
    const fixture = await readyOpenTtrpgSessionV1('knowledge owner predicate')
    const state = await readProductRuntimeState(fixture.sessionId)
    const content = fixture.runtimePackage.ttrpg!
    const context = ttrpgOpenPredicateContextV1(state, content)
    const predicate = { op: 'evidence-known-by' as const, clueRef: 'evidence.door', actorKey: 'hero' }
    expect(evaluateTtrpgPredicateV1(predicate, context)).toBe(false)
    context.knowledge = [entry]
    expect(evaluateTtrpgPredicateV1(predicate, context)).toBe(true)
    expect(evaluateTtrpgPredicateV1({ ...predicate, actorKey: 'companion.1' }, context)).toBe(false)
    db.close()
  })

  it('hashes only the frozen discoverable title/description, not unrevealed source truth', async () => {
    const hash = await hashTtrpgOpenEvidenceFieldsV1(campaign, 'evidence.door')
    const changed = structuredClone(campaign)
    changed.frozenWorldPredicateIndex.entries[0].canonicalValue = false
    expect(await hashTtrpgOpenEvidenceFieldsV1(changed, 'evidence.door')).toBe(hash)
    changed.situationTemplates[0].evidence[0].description = '新的可读内容'
    expect(await hashTtrpgOpenEvidenceFieldsV1(changed, 'evidence.door')).not.toBe(hash)
  })
})
