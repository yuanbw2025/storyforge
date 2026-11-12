import { db } from '../../src/lib/db/schema'
import { acceptProductBuildArtifact } from '../../src/lib/product-production/artifact-store'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { recoveryInvalidatedTaskKeys } from '../../src/lib/product-production/scheduler'
import type { ProductBuildArtifactKindV1 } from '../../src/lib/types'
import { seedCurrentProductWorld } from './current-product-world'

const mainKey = 'content.main-quest-plan'
const mapKey = 'content.adventure-architecture'
const reviewKey = 'content.adventure-quality-review'

export async function seedQuestLocationConflict(name: string) {
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
  return {aggregate, current, build, recovery, scope, productionId, failureJson, rows, assemble, quest, accept, invalidated}
}
