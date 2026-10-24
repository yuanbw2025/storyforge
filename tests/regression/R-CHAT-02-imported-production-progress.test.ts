import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {executeProductProductionCommand} from '../../src/lib/product-production/commands'
import {createConfiguredProductProductionExecutorV1} from '../../src/lib/product-production/production-executor'
import {
  projectProductProductionSchedulerV1,
  recoverImportedChatProductionPrefixV1,
  runProductProductionUntilBlockedV1,
} from '../../src/lib/product-production/scheduler'
import {resolveWorkspaceOwnership} from '../../src/lib/workspace/ownership'
import {seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {await db.delete()})

it('shows imported completed history as awaiting verification without pretending it is executing or authorizing dependent work', async () => {
  const f = await seedChatNarrativeProductionFixture()
  const created = await executeProductProductionCommand({scope: f.scope, command: {
    type: 'create-intent', commandId: 'import-progress.create', productionKey: 'import-progress',
    productType: 'character-interaction', worldReleaseId: f.confirmed.worldReleaseId!, userText: '制作角色聊天',
  }})
  const productionId = created.productionId
  const saved = await executeProductProductionCommand({scope: f.scope, productionId, command: {
    type: 'save-brief-revision', commandId: 'import-progress.brief',
    expectedStateRevision: 0, parentRevision: null, brief: f.brief,
  }})
  await executeProductProductionCommand({scope: f.scope, productionId, command: {
    type: 'authorize-start', commandId: 'import-progress.start', expectedStateRevision: 1,
    briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'author.start',
  }})
  const requirementKey = f.brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey
  const bindingHash = 'a'.repeat(64)
  let calls = 0
  const executor = createConfiguredProductProductionExecutorV1({
    production: (await db.productProductions.get(productionId))!, brief: f.brief,
    runText: async () => {
      calls++
      const active = await projectProductProductionSchedulerV1({scope: f.scope, productionId})
      expect(active.tasks.find(t => t.taskKey === 'content.design')?.status).toBe('completed')
      expect(active.tasks.find(t => t.taskKey === 'content.product-module')).toMatchObject({
        status: 'running', recoveryCheckAt: expect.any(Number),
      })
      return {output: '{', usage: {inputTokens: 100, outputTokens: 1}, bindingReceipt: {
        schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey,
        adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'fixture',
        endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct',
        credentialSource: 'existing-ai-config', credentialPresent: true,
        capabilityHash: bindingHash, boundAt: 1, receiptHash: 'b'.repeat(64),
      }}
    },
  })
  await runProductProductionUntilBlockedV1({scope: f.scope, productionId, executor,
    capabilityBindings: [{requirementKey, adapterId: 'configured-text.v1', bindingHash}]})
  expect(calls).toBe(1)

  const importedId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const scope = (await resolveWorkspaceOwnership(importedId)).scope
  const production = (await db.productProductions.where('projectId').equals(importedId).toArray())[0]
  const imported = {scope, productionId: production.id!}
  const eventsBefore = await db.agentRunEvents.toArray()
  const progress = await projectProductProductionSchedulerV1(imported)
  const design = progress.tasks.find(t => t.taskKey === 'content.design')!
  expect(design).toMatchObject({
    status: 'verification-required', terminalReceiptHash: null, recoveryCheckAt: null,
    blocker: '导入的已完成步骤待核对，尚未重新执行。',
  })
  // The portable ledger deliberately invalidates its local receipt. A read
  // must neither rewrite that history nor grant its dependent tasks permission.
  expect((await db.agentRuns.get(design.runId!))!.status).toBe('running')
  expect(progress.terminal).toBe(false)
  expect(progress.tasks.find(t => t.taskKey === 'content.product-module')?.status).toBe('blocked')
  expect(progress.tasks.filter(t => t.status === 'ready')).toEqual([])
  expect(await db.agentRunEvents.toArray()).toEqual(eventsBefore)

  // The existing explicit recovery path can recheck completed work without
  // repeating the failed model call or completing the failed Build/root.
  await recoverImportedChatProductionPrefixV1({...imported, expectedStateRevision: production.stateRevision})
  const recovered = await projectProductProductionSchedulerV1(imported)
  expect(recovered.tasks.find(t => t.taskKey === 'content.design')?.status).toBe('completed')
  expect(recovered.tasks.find(t => t.taskKey === 'content.product-module')?.status).toBe('blocked')
  expect(recovered.buildStatus).toBe('recovery-required')
  expect(recovered.terminal).toBe(false)
  expect(calls).toBe(1)
  expect(await db.productReleases.where('projectId').equals(importedId).count()).toBe(0)
  expect(await db.productRuntimeSessions.where('projectId').equals(importedId).count()).toBe(0)
}, 30_000)
