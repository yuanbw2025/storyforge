import { afterAll, beforeAll, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readTextAdventureRepairFeedbackV1 } from '../../src/lib/product-production/context'
import { seedQuestLocationConflict } from '../helpers/quest-location-conflict'

beforeAll(async () => { await db.delete(); await db.open() })
afterAll(() => db.close())

const mainKey = 'content.main-quest-plan'
const mapKey = 'content.adventure-architecture'
const reviewKey = 'content.adventure-quality-review'

async function fixture(name: string) {
  const result = await seedQuestLocationConflict(name)
  expect(result.aggregate.payload).toMatchObject({passed: false, issues: [expect.objectContaining({
    artifactKey: mainKey, severity: 'blocking',
    detail: expect.stringMatching(/objective\.001.*白石港口.*黑沙码头/u),
  })]})
  return result
}

it('routes a real deterministic main quest conflict to its owner and the dependent recheck', async () => {
  const f = await fixture('sfqa038-location')
  const invalidated = await f.invalidated()
  expect([...invalidated]).toContain(mainKey)
  expect([...invalidated]).toEqual(expect.arrayContaining([
    'content.quest-script', reviewKey, reviewKey + '.structure', 'integration.package',
  ]))
  expect(invalidated.has(mapKey)).toBe(false)
  expect(invalidated.has('content.story-bible')).toBe(false)
  expect(invalidated.has('integration.narrative')).toBe(true)
  expect(invalidated.has('content.ending-route-plan')).toBe(false)
  expect(invalidated.has('media.requirements')).toBe(false)
})

it('removes the blocker only after the accepted main quest actually changes and deterministic review runs again', async () => {
  const f = await fixture('sfqa038-corrected')
  expect((await f.invalidated()).has(mainKey)).toBe(true)
  const acceptedMain = f.rows.find(row => row.artifactKey === mainKey)!
  const nextEpoch = f.recovery.controlEpoch
  await db.productBuilds.update(f.build.id!, {controlEpoch: nextEpoch, failureJson: f.failureJson})
  await db.productProductions.update(f.productionId, {controlEpoch: nextEpoch})
  const feedback = await readTextAdventureRepairFeedbackV1({
    projectId: f.scope.projectId, scope: f.scope, productProductionId: f.productionId,
    productBuildId: f.build.id!, productProductionTaskKey: mainKey,
  })
  expect(JSON.parse(feedback).blockingIssues).toContainEqual(expect.objectContaining({
    repairTaskKeys: [mainKey], detail: expect.stringContaining('objective.001'),
    recommendation: expect.stringContaining('白石港口'),
  }))
  const revised = await f.accept(mainKey, f.quest('到白石港口核对航线'), 'narrative', nextEpoch)
  expect(revised.status).toBe('accepted')
  expect(revised.contentHash).not.toBe(acceptedMain.contentHash)
  const repairedInputs = await Promise.all(f.rows.map(row => row.artifactKey === mainKey ? revised
    : f.accept(row.artifactKey, JSON.parse(row.payloadJson), row.kind, nextEpoch)))
  const reviewed = await f.assemble(repairedInputs, f.recovery)
  expect(reviewed.payload).toMatchObject({passed: true, issues: []})
  await f.accept(reviewed.artifactKey, reviewed.payload, reviewed.kind, nextEpoch)
  expect((await f.invalidated(nextEpoch)).has(mainKey)).toBe(false)
  expect((await db.productBuildArtifacts.get(acceptedMain.id!))?.payloadJson).toBe(acceptedMain.payloadJson)
})

it.each([mainKey, mapKey])('stops when the reviewed %s is missing, even if an older exact hash remains', async artifactKey => {
  const f = await fixture('sfqa038-missing-' + artifactKey)
  const row = f.rows.find(candidate => candidate.artifactKey === artifactKey)!
  const {id, ...prior} = row
  await db.productBuildArtifacts.delete(id!)
  await db.productBuildArtifacts.add({...prior, controlEpoch: row.controlEpoch - 1})
  await expect(f.invalidated()).rejects.toThrow('返修证据缺失或无效:' + artifactKey)
})

it.each([mainKey, mapKey])('stops when the reviewed %s payload has changed under its recorded hash', async artifactKey => {
  const f = await fixture('sfqa038-corrupt-' + artifactKey)
  const row = f.rows.find(candidate => candidate.artifactKey === artifactKey)!
  await db.productBuildArtifacts.update(row.id!, {payloadJson: '{}'})
  await expect(f.invalidated()).rejects.toThrow('返修工件哈希不符:' + artifactKey)
})

it('stops when two same-epoch versions claim to be the reviewed main quest', async () => {
  const f = await fixture('sfqa038-ambiguous')
  const row = f.rows.find(candidate => candidate.artifactKey === mainKey)!
  const {id, ...duplicate} = row
  expect(id).toBeDefined()
  await db.productBuildArtifacts.add({...duplicate, version: row.version + 1})
  await expect(f.invalidated()).rejects.toThrow('返修证据缺失或无效:' + mainKey)
})
