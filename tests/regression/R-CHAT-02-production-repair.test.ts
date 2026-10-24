import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {executeProductProductionCommand} from '../../src/lib/product-production/commands'
import {createConfiguredProductProductionExecutorV1, type ProductionTextRunnerV1} from '../../src/lib/product-production/production-executor'
import {runProductProductionUntilBlockedV1} from '../../src/lib/product-production/scheduler'
import {readProductProductionDetailsV1, retryProductProductionBlockerV1} from '../../src/lib/product-production/service'
import {chatOpeningProofReviewFixture, chatSituationCandidatesFixture, seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'
import type {ChatNarrativeProductionSourceV1} from '../../src/lib/character-interaction/narrative-production'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {await db.delete()})

it.each([false, true])('retains the rejected opening and its paid usage, then delivers exact failure feedback only after an explicit repair command (repairRejected=%s)', async repairRejected => {
  const f = await seedChatNarrativeProductionFixture()
  const worldBefore = await db.worldReleases.get(f.confirmed.worldReleaseId!)
  const created = await executeProductProductionCommand({scope: f.scope, command: {
    type: 'create-intent', commandId: 'repair.create', productionKey: 'repair.chat',
    productType: 'character-interaction', worldReleaseId: f.confirmed.worldReleaseId!, userText: '制作角色聊天',
  }})
  expect(created.ok).toBe(true)
  const productionId = created.productionId
  const saved = await executeProductProductionCommand({scope: f.scope, productionId, command: {
    type: 'save-brief-revision', commandId: 'repair.brief', expectedStateRevision: 0, parentRevision: null, brief: f.brief,
  }})
  expect(saved.ok).toBe(true)
  const started = await executeProductProductionCommand({scope: f.scope, productionId, command: {
    type: 'authorize-start', commandId: 'repair.start', expectedStateRevision: 1, briefRevision: 1,
    briefHash: saved.result.briefHash as string, authorizationNonce: 'author.start',
  }})
  expect(started.ok).toBe(true)
  const requirementKey = f.brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey
  const bindingHash = 'a'.repeat(64), calls: Array<{kind: string; contextText: string}> = []
  let rejectedOutput = ''
  const runText: ProductionTextRunnerV1 = async request => {
    const isOpening = request.system.includes('初始情境编辑')
    calls.push({kind: isOpening ? 'opening' : 'review', contextText: request.contextText})
    const sourceRow = await db.productBuildArtifacts.where('projectId').equals(f.scope.projectId)
      .filter(row => row.artifactKey === 'design.game').last()
    const source = JSON.parse(sourceRow!.payloadJson) as ChatNarrativeProductionSourceV1
    const candidates = isOpening ? chatSituationCandidatesFixture(source) : JSON.parse((await db.productBuildArtifacts.filter(row => row.artifactKey === 'content.chat-candidates').last())!.payloadJson)
    if (calls.length === 1 || (isOpening && repairRejected)) {
      // Reproduce the observed Agnes output: private background cannot carry
      // a world-source key. Do not normalize away this provenance violation.
      candidates.options[0].situation.facts[0].origin = 'author-private'
      // Unknown evidence requires the author; the automatic repair cannot
      // invent or substitute a source key to make this candidate pass.
      candidates.options[0].situation.facts[0].sourceKnowledgeKey = 'unknown-world-evidence'
    }
    const output = JSON.stringify(isOpening ? candidates : chatOpeningProofReviewFixture(source, candidates))
    if (calls.length === 1) rejectedOutput = output
    return {output, usage: {inputTokens: 100, outputTokens: 100}, bindingReceipt: {
      schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
      provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
      credentialSource: 'existing-ai-config', credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: 'b'.repeat(64),
    }}
  }
  const execute = async () => runProductProductionUntilBlockedV1({scope: f.scope, productionId,
    capabilityBindings: [{requirementKey, adapterId: 'configured-text.v1', bindingHash}],
    executor: createConfiguredProductProductionExecutorV1({production: (await db.productProductions.get(productionId))!, brief: f.brief, runText}),
  })
  await execute()
  let details = await readProductProductionDetailsV1(f.scope, productionId)
  expect(calls.map(c => c.kind)).toEqual(['opening'])
  expect(details.build!.status).toBe('recovery-required')
  expect(JSON.parse(details.build!.failureJson)).toMatchObject({code: 'task-draft-rejected', attempt: 1, detail: '[chat-narrative] 私域事实不能伪造世界证据'})
  const firstAttempts = JSON.parse(details.build!.budgetLedgerJson).attempts
  expect(firstAttempts.filter((a: {taskKey: string}) => a.taskKey === 'content.product-module'))
    .toEqual([expect.objectContaining({attempt: 1, outcome: 'failed', usageKnown: true, usage: expect.objectContaining({modelCalls: 1, inputTokens: 100, outputTokens: 100})})])
  const originalRaw = await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId)
    .filter(a => a.artifactKind === 'raw-response' && a.content === rejectedOutput).first()
  expect(originalRaw).toBeDefined()
  await execute()
  expect(calls).toHaveLength(1)

  await retryProductProductionBlockerV1({scope: f.scope, details})
  await execute()
  details = await readProductProductionDetailsV1(f.scope, productionId)
  expect(calls.map(c => c.kind)).toEqual(repairRejected ? ['opening', 'opening'] : ['opening', 'opening', 'review'])
  expect(calls[1].contextText).toContain('私域事实不能伪造世界证据')
  expect(calls[1].contextText).toContain(JSON.stringify(rejectedOutput))
  expect(JSON.parse(details.build!.failureJson)).toMatchObject(repairRejected
    ? {taskKey: 'content.product-module', code: 'task-draft-rejected', attempt: 1}
    : {taskKey: 'content.chat-author-gate'})
  if (repairRejected) {
    await execute()
    expect(calls).toHaveLength(2)
  }
  expect((await db.agentRunArtifacts.get(originalRaw!.id!))!.content).toBe(rejectedOutput)
  expect(await db.worldReleases.get(f.confirmed.worldReleaseId!)).toEqual(worldBefore)
  expect(await db.productReleases.where('projectId').equals(f.scope.projectId).count()).toBe(0)
  expect(await db.productRuntimeSessions.where('projectId').equals(f.scope.projectId).count()).toBe(0)
})
