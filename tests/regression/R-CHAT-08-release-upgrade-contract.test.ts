import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {compareChatReleaseUpgradeV1} from '../../src/lib/character-interaction/release-upgrade-contract'
import {seedChatExperiencePackageFixture} from '../helpers/chat-experience-package-fixture'
import {createFixtureProductReleaseManifestV1} from '../helpers/product-release-v1'
import {hashCanonicalValue} from '../../src/lib/agent/run/hash'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import type {ProductReleaseManifestV1, ProductRuntimePackageV1} from '../../src/lib/types'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
async function next(source: ProductReleaseManifestV1, change: (pkg: ProductRuntimePackageV1) => void) {
  const runtimePackage = structuredClone(source.runtimePackage); change(runtimePackage)
  return createFixtureProductReleaseManifestV1({runtimePackage, productionKey: source.productionProvenance.productionKey, releaseVersion: source.lineage.releaseVersion + 1,
    parentRelease: {releaseUid: source.lineage.releaseUid, releaseHash: source.lineage.releaseHash}})
}

it('verifies a directly related picture update, freezes async inputs and emits only compatibility evidence without touching saves', async () => {
  const f = await seedChatExperiencePackageFixture(), source = f.original.productRelease.manifest, target = f.illustrated.productRelease.manifest
  const sessions = await db.productRuntimeSessions.toArray(), events = await db.productRuntimeEvents.toArray()
  const pending = compareChatReleaseUpgradeV1(source, target)
  target.runtimePackage.interaction!.profiles[0].name = '迟到篡改'
  const report = await pending
  expect(report).toMatchObject({disposition: 'copy-preserving-story', blockers: [], changes: ['pictures', 'release-metadata'],
    sourceReleaseHash: f.original.productRelease.contentHash, targetReleaseHash: f.illustrated.productRelease.contentHash})
  const {compatibilityHash, ...body} = report
  expect(await hashProductProductionValueV2(body)).toBe(compatibilityHash)
  expect(JSON.stringify(report)).not.toContain('铜印')
  expect(report).not.toHaveProperty('sourceExperienceInfo')
  expect(report).not.toHaveProperty('targetExperienceInfo')
  expect(await db.productRuntimeSessions.toArray()).toEqual(sessions)
  expect(await db.productRuntimeEvents.toArray()).toEqual(events)
  const display = await next(source, pkg => {pkg.definition.title = '雨后驿站'; pkg.definition.description = '新版作品介绍'})
  expect(await compareChatReleaseUpgradeV1(source, display)).toMatchObject({disposition: 'copy-preserving-story', changes: ['title', 'description', 'release-metadata']})
})

it('compares public author statements before a compatible copy without treating them as character knowledge', async () => {
  const f = await seedChatExperiencePackageFixture(), source = f.original.productRelease.manifest
  const info = {version: 1 as const, author: '本作品作者', attribution: '公开素材致谢', usageTerms: '仅供工程验证'}
  const target = await next(source, pkg => {pkg.interaction!.chatExperienceInfo = info})
  const report = await compareChatReleaseUpgradeV1(source, target)
  expect(report).toMatchObject({disposition: 'copy-preserving-story', blockers: [],
    sourceExperienceInfo: null, targetExperienceInfo: info})
  expect(JSON.stringify(report)).not.toContain('铜印')
  const removed = await next(target, pkg => {delete pkg.interaction!.chatExperienceInfo})
  expect(await compareChatReleaseUpgradeV1(target, removed)).toMatchObject({disposition: 'copy-preserving-story',
    sourceExperienceInfo: info, targetExperienceInfo: null})
})

it('does not treat a compatible lineage declaration as permission to reinterpret actors, secrets, rules or the old story', async () => {
  const f = await seedChatExperiencePackageFixture(), source = f.original.productRelease.manifest
  const cases: Array<[string, (pkg: ProductRuntimePackageV1) => void]> = [
    ['character-knowledge', pkg => {pkg.interaction!.profiles[0].voiceRules += '改变人物原则。'}],
    ['scene-rules', pkg => {pkg.interaction!.sceneTemplates[0].maxTurns += 1}],
    ['story-contract', pkg => {pkg.interaction!.chatNarrative!.permissions.maxActionsPerTrigger += 1}],
    ['story-contract', pkg => {pkg.interaction!.chatNarrative!.initialSituation.facts.find(fact => fact.factKey === 'secret')!.text = '铜印在另一处地方。'}],
    ['runtime-rules', pkg => {pkg.definition.rulesetVersion += 1}],
  ]
  for (const [reason, change] of cases) {
    const target = await next(source, change)
    expect(target.lineage.compatibility.status).toBe('compatible')
    expect(await compareChatReleaseUpgradeV1(source, target)).toMatchObject({disposition: 'new-session-required', blockers: expect.arrayContaining([reason])})
  }
  // Ordinary interaction has its own frozen navigation; the narrative mode's
  // derived shell cannot be edited independently even in a fixture.
  const ordinaryPackage = structuredClone(source.runtimePackage)
  delete ordinaryPackage.interaction!.chatNarrative
  ordinaryPackage.narrative.nodes[0].kind = 'ending'
  const ordinary = await createFixtureProductReleaseManifestV1({runtimePackage: ordinaryPackage, productionKey: 'ordinary.chat'})
  const ordinaryNext = await next(ordinary, pkg => {pkg.narrative.moduleTitle += ' · 新规则'})
  expect(await compareChatReleaseUpgradeV1(ordinary, ordinaryNext)).toMatchObject({disposition: 'new-session-required', blockers: ['narrative-rules']})
})

it('rejects unrelated or explicitly incompatible releases and rejects broken hashes before issuing a compatibility result', async () => {
  const f = await seedChatExperiencePackageFixture(), source = f.original.productRelease.manifest
  expect(await compareChatReleaseUpgradeV1(source, source)).toMatchObject({disposition: 'same-version', blockers: []})
  const unrelated = await createFixtureProductReleaseManifestV1({runtimePackage: source.runtimePackage, productionKey: 'another-author-copy'})
  expect(await compareChatReleaseUpgradeV1(source, unrelated)).toMatchObject({disposition: 'new-session-required', blockers: ['unrelated-release']})
  const target = structuredClone(f.illustrated.productRelease.manifest)
  target.lineage.compatibility.status = 'incompatible'
  const {lineageHash: _oldHash, ...lineage} = target.lineage
  target.lineage.lineageHash = await hashCanonicalValue(lineage)
  expect(await compareChatReleaseUpgradeV1(source, target)).toMatchObject({disposition: 'new-session-required', blockers: ['author-incompatible']})
  target.runtimePackage.definition.description = '没有重建冻结合同'
  await expect(compareChatReleaseUpgradeV1(source, target)).rejects.toThrow()
})
