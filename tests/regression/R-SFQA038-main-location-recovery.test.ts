import { afterAll, beforeAll, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { acceptProductBuildArtifact } from '../../src/lib/product-production/artifact-store'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { readTextAdventureRepairFeedbackV1 } from '../../src/lib/product-production/context'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { recoveryInvalidatedTaskKeys } from '../../src/lib/product-production/scheduler'
import type { ProductBuildArtifactKindV1 } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

beforeAll(async () => { await db.delete(); await db.open() })
afterAll(() => db.close())

const mainKey = 'content.main-quest-plan'
const mapKey = 'content.adventure-architecture'
const reviewKey = 'content.adventure-quality-review'

async function fixture(name: string) {
  const {scope, release} = await seedCurrentProductWorld(name)
  const worldReleaseId = release.id!
  const suggestions = await suggestProductStartingPoints({scope, worldReleaseId})
  const brief = await draftProductProductionBriefV3({
    scope, worldReleaseId, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'text-adventure', qualityProfile: 'prototype', scale: 'short-arc',
    visualLevel: 'none', audioLevel: 'none', playerRole: '扮演林舟', openingSituation: '在潮门关闭前作出选择。',
    coreExperience: ['选择与后果'], requiredFacts: ['潮门只在满月开启'], forbiddenChanges: ['不得改写冻结世界'],
    contentBoundaries: ['不含露骨内容'], tone: ['克制', '紧张'], textAdventure: {confirmAll: true},
  })
  const {productionId} = await executeProductProductionCommand({scope, command: {
    type: 'create-intent', commandId: name + '.intent', productionKey: name + '.production',
    productType: 'text-adventure', worldReleaseId, userText: '主线地点恢复',
  }})
  const saved = await executeProductProductionCommand({scope, productionId, command: {
    type: 'save-brief-revision', commandId: name + '.brief', expectedStateRevision: 0, parentRevision: null, brief,
  }})
  const briefHash = saved.result.briefHash as string
  await executeProductProductionCommand({scope, productionId, command: {
    type: 'authorize-start', commandId: name + '.start', expectedStateRevision: 1,
    briefRevision: 1, briefHash, authorizationNonce: name + '.click',
  }})
  const build = (await db.productBuilds.where('[productionId+buildNumber]').equals([productionId, 1]).first())!
  const buildId = build.id!
  const production = (await db.productProductions.get(productionId))!
  const plan = (controlEpoch: number) => createProductProductionPlanV3({
    brief, briefHash, buildNumber: build.buildNumber, controlEpoch,
  })
  const current = await plan(build.controlEpoch)
  const recovery = await plan(build.controlEpoch + 1)
  const execute = createConfiguredProductProductionExecutorV1({production, brief,
    runText: async () => { throw Error('038 must not call a model') },
  })
  const accept = (artifactKey: string, payload: unknown, kind: ProductBuildArtifactKindV1 = 'narrative',
    controlEpoch = build.controlEpoch) => acceptProductBuildArtifact({
    scope, buildId, controlEpoch, artifactKey, kind, payload,
    inputHash: '1'.repeat(64), producerReceiptHash: '2'.repeat(64),
  })
  const quest = (title: string) => ({quests: [{objectives: [
    {key: 'objective.001', locationOrdinal: 1, title, narrativePurpose: '核对被取走的航线记录', sceneKeys: ['scene.001']},
  ]}]})
  const sources: Record<string, unknown> = {
    [mainKey]: quest('到黑沙码头核对航线'),
    [mapKey]: {regions: [{areas: [{locations: [
      {key: 'location.001', title: '白石港口'}, {key: 'location.002', title: '黑沙码头'},
    ]}]}]},
    'content.cast-bible': {characters: []},
    'content.narrative-arc-plan': {acts: [{sceneCards: [{key: 'scene.001'}]}]},
    'content.narrative': {entryNodeKey: 'scene.001', beats: [], choices: []},
  }
  const task = current.tasks.find(row => row.taskKey === reviewKey)!
  const rows = await Promise.all(task.inputArtifactKeys.map(artifactKey => {
    const match = /^quality\.adventure-review\.(structure|act-[1-3])$/.exec(artifactKey)
    if (!match) return accept(artifactKey, sources[artifactKey] ?? {})
    const reviewScope = match[1]
    const scores = reviewScope === 'structure'
      ? {causality: 5, routeDifferentiation: 5, setupPayoff: 5, characterMotivation: 5}
      : {causality: 5, playerAgency: 5, routeDifferentiation: 5, pacing: 5, characterMotivation: 5, emotionalImpact: 5}
    return accept(artifactKey, {schema: 'storyforge.text-adventure-quality-review-batch-artifact',
      version: 1, scope: reviewScope, scores, issues: [], passed: true}, 'playtest-report')
  }))
  const assemble = async (inputArtifacts = rows, boundPlan = current) => {
    const result = await execute({
      scope, productionId, buildId, buildNumber: build.buildNumber, controlEpoch: boundPlan.controlEpoch,
      planHash: await hashProductProductionValueV2(boundPlan), task: boundPlan.tasks.find(row => row.taskKey === reviewKey)!,
      attempt: 1, idempotencyKey: name + '.review.' + boundPlan.controlEpoch, contextText: '',
      inputArtifacts, capabilityBindings: [], authorResolution: null, signal: new AbortController().signal,
    })
    return result.artifacts[0]
  }
  const aggregate = await assemble()
  expect(aggregate.payload).toMatchObject({passed: false, issues: [expect.objectContaining({
    artifactKey: mainKey, severity: 'blocking',
    detail: expect.stringMatching(/objective\.001.*白石港口.*黑沙码头/u),
  })]})
  await accept(aggregate.artifactKey, aggregate.payload, aggregate.kind)
  const failureJson = canonicalProductProductionJsonV2({
    code: 'blocker-resolved', blockerKey: 'integration.package',
    previousFailure: {taskKey: 'integration.package', detail: '文字冒险叙事质量审查未通过'},
    resolution: {action: 'retry', note: '修复地点矛盾'},
  })
  const invalidated = async (previousControlEpoch = build.controlEpoch) => recoveryInvalidatedTaskKeys({
    buildId, previousControlEpoch, plan: previousControlEpoch === build.controlEpoch
      ? recovery : await plan(previousControlEpoch + 1), failureJson,
  })
  return {build, recovery, scope, productionId, failureJson, rows, assemble, quest, accept, invalidated}
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
