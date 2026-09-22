import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { appendAgentRunEventV1, createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { db } from '../../src/lib/db/schema'
import { readTextOpenWorldArtifactGovernanceV1 } from '../../src/lib/open-world/creator-artifact-governance'
import { acceptProductBuildArtifact } from '../../src/lib/product-production/artifact-store'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import {
  hashProductProductionTaskCandidateV1,
  hashProductProductionTaskReceiptV1,
} from '../../src/lib/product-production/task-evidence'
import type {
  ProductProductionPlanTaskV3,
  ProductProductionPlanV3,
  ProductProductionTaskArtifactV1,
  ProductProductionTaskExecutionResultV1,
  WorkspaceScope,
} from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedAuthorizedTextOpenWorldCreatorBuildV1 } from '../helpers/text-open-world-creator-build'

const ZERO_USAGE = {
  modelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  mediaCalls: 0,
  costUsd: 0,
  durationMs: 1,
  storageBytes: 0,
} as const

async function governedPayload(
  productInstanceKey: string,
  kind: string,
  ownHashField: string,
  content: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const body = {
    schema: `storyforge.${kind.replace(/\./g, '-')}`,
    version: 1,
    productType: 'text-open-world',
    productInstanceKey,
    createdAt: Date.now(),
    ...content,
  }
  return { ...body, [ownHashField]: await hashProductProductionValueV2(body) }
}

async function createRootRun(input: {
  scope: WorkspaceScope
  buildId: number
  buildNumber: number
  controlEpoch: number
  planHash: string
}) {
  let root = await createAgentRunV1({
    scope: input.scope,
    productBuildId: input.buildId,
    contract: {
      version: 1,
      objective: `负责 ProductBuild ${input.buildNumber} 的 Creator 治理顺序反例`,
      workflowKind: 'long-running-resumable',
      scope: {
        projectId: input.scope.projectId,
        worldGroupId: null,
        productProduction: {
          productBuildId: input.buildId,
          buildNumber: input.buildNumber,
          controlEpoch: input.controlEpoch,
          planHash: input.planHash,
          taskKey: '$root',
        },
      },
      permissions: { contextSourceKeys: ['product-production.brief'], writeTargets: [] },
      runtimeBindingHash: await hashProductProductionValueV2({
        fixture: 'g5-05-official-authority-reference-cascade-root',
        planHash: input.planHash,
      }),
      dependencyReceiptPolicy: {
        requiredForJoin: true,
        verifierSetVersion: 'product-production-root-v1',
      },
      budget: {
        maxModelCalls: 1,
        maxToolCalls: 0,
        maxInputTokens: 1,
        maxOutputTokens: 1,
        maxAttemptsPerStep: 1,
      },
      acceptance: [
        { id: 'product-production.children', kind: 'deterministic-check', required: true },
        { id: 'product-production.package', kind: 'gate-passed', required: true },
      ],
      verificationPlan: [{
        id: 'product-production.root-terminal',
        kind: 'terminal',
        verifier: 'product-production-root-v1',
        criterionIds: ['product-production.children', 'product-production.package'],
      }],
      failurePolicy: {
        onProtocolError: 'fail',
        onVerificationFailure: 'fail',
        onStaleInput: 'pause-for-author',
      },
    },
  })
  root = await appendAgentRunEventV1({
    scope: input.scope,
    runId: root.run.id,
    type: 'step.scheduled',
    payload: { stepId: '$join' },
    expectedLastSequence: root.projection.lastSequence,
  })
  return appendAgentRunEventV1({
    scope: input.scope,
    runId: root.run.id,
    type: 'step.started',
    payload: { stepId: '$join', attempt: 1 },
    expectedLastSequence: root.projection.lastSequence,
  })
}

async function acceptTaskGroup(input: {
  scope: WorkspaceScope
  buildId: number
  buildNumber: number
  controlEpoch: number
  planHash: string
  rootRunId: number
  task: ProductProductionPlanTaskV3
  artifacts: ProductProductionTaskArtifactV1[]
}) {
  const result: ProductProductionTaskExecutionResultV1 = {
    artifacts: input.artifacts,
    passedGateIds: [...input.task.acceptanceGateIds],
    usage: ZERO_USAGE,
  }
  const candidateHash = await hashProductProductionTaskCandidateV1(result)
  const inputHash = await hashProductProductionValueV2({
    fixture: 'g5-05-official-authority-reference-cascade-task',
    planHash: input.planHash,
    taskKey: input.task.taskKey,
  })
  let child = await createAgentRunV1({
    scope: input.scope,
    productBuildId: input.buildId,
    contract: {
      version: 1,
      objective: `执行 ProductBuild ${input.buildNumber} 的任务 ${input.task.taskKey}`,
      workflowKind: 'long-running-resumable',
      ownership: { parentRunId: input.rootRunId, relation: `task:${input.task.taskKey}` },
      scope: {
        projectId: input.scope.projectId,
        worldGroupId: null,
        productProduction: {
          productBuildId: input.buildId,
          buildNumber: input.buildNumber,
          controlEpoch: input.controlEpoch,
          planHash: input.planHash,
          taskKey: input.task.taskKey,
        },
      },
      permissions: { contextSourceKeys: ['product-production.brief'], writeTargets: [] },
      runtimeBindingHash: await hashProductProductionValueV2({
        fixture: 'g5-05-official-authority-reference-cascade-child',
        planHash: input.planHash,
        taskKey: input.task.taskKey,
      }),
      dependencyReceiptPolicy: {
        requiredForJoin: true,
        verifierSetVersion: 'product-production-task-v1',
      },
      budget: {
        maxModelCalls: Math.max(1, input.task.budgetReservation.modelCalls),
        maxToolCalls: input.task.budgetReservation.mediaCalls,
        maxInputTokens: Math.max(1, input.task.budgetReservation.inputTokens),
        maxOutputTokens: Math.max(1, input.task.budgetReservation.outputTokens),
        maxAttemptsPerStep: input.task.maxAttempts,
      },
      acceptance: [
        { id: `${input.task.taskKey}.output`, kind: 'output-present', required: true },
        { id: `${input.task.taskKey}.gates`, kind: 'gate-passed', required: true },
      ],
      verificationPlan: [{
        id: `${input.task.taskKey}.terminal`,
        kind: 'terminal',
        verifier: 'product-production-task-v1',
        criterionIds: [`${input.task.taskKey}.output`, `${input.task.taskKey}.gates`],
      }],
      failurePolicy: {
        onProtocolError: input.task.maxAttempts > 1 ? 'retry' : 'fail',
        onVerificationFailure: 'fail',
        onStaleInput: 'pause-for-author',
      },
    },
  })
  const append = async (
    type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
    payload: unknown,
  ) => {
    child = await appendAgentRunEventV1({
      scope: input.scope,
      runId: child.run.id,
      type,
      payload,
      expectedLastSequence: child.projection.lastSequence,
    } as Parameters<typeof appendAgentRunEventV1>[0])
  }
  await append('step.scheduled', { stepId: input.task.taskKey })
  await append('step.started', { stepId: input.task.taskKey, attempt: 1 })
  await append('candidate.persisted', {
    stepId: input.task.taskKey,
    attempt: 1,
    candidateHash,
    requiresConfirmation: false,
  })
  child = (await createAgentRunCheckpointV1({
    scope: input.scope,
    runId: child.run.id,
    expectedLastSequence: child.projection.lastSequence,
    resumePayload: {
      schema: 'storyforge.product-production-task-candidate',
      version: 1,
      taskKey: input.task.taskKey,
      attempt: 1,
      controlEpoch: input.controlEpoch,
      inputHash,
      candidateHash,
      result,
    },
  })).snapshot
  await append('budget.settled', {
    stepId: input.task.taskKey,
    modelCalls: 0,
    toolCalls: 0,
    tokens: 0,
  })
  await append('step.succeeded', {
    stepId: input.task.taskKey,
    attempt: 1,
    outputHash: candidateHash,
  })
  await append('verification.started', { verifierSetVersion: 'product-production-task-v1' })
  const producerReceiptHash = await hashProductProductionTaskReceiptV1({
    taskKey: input.task.taskKey,
    attempt: 1,
    inputHash,
    candidateHash,
    passedGateIds: result.passedGateIds,
    usage: result.usage,
    controlEpoch: input.controlEpoch,
  })
  await append('verification.accepted', { receiptHash: producerReceiptHash })

  for (const artifact of input.artifacts) {
    await acceptProductBuildArtifact({
      scope: input.scope,
      buildId: input.buildId,
      controlEpoch: input.controlEpoch,
      artifactKey: artifact.artifactKey,
      requirementKey: artifact.requirementKey,
      kind: artifact.kind,
      payload: artifact.payload,
      metadata: artifact.metadata,
      quality: artifact.quality,
      rights: artifact.rights,
      producerRunId: child.run.id,
      producerReceiptHash,
      inputHash,
    })
  }
  const build = await db.productBuilds.get(input.buildId)
  if (!build?.id) throw new Error('测试 Build 不存在')
  const ledger = JSON.parse(build.budgetLedgerJson) as Record<string, any>
  ledger.tasks[input.task.taskKey] = {
    runId: child.run.id,
    attempt: 1,
    status: 'settled',
    idempotencyKey: inputHash,
    candidateHash,
    terminalReceiptHash: producerReceiptHash,
    passedGateIds: [...input.task.acceptanceGateIds],
    usage: ZERO_USAGE,
    errorCode: null,
  }
  await db.productBuilds.update(input.buildId, {
    budgetLedgerJson: canonicalProductProductionJsonV2(ledger),
    updatedAt: Date.now(),
  })
}

async function runOfficialOrderCase(order: readonly string[], suffix: string) {
  const owned = await seedCurrentProductWorld(`G5-05 official reference cascade ${suffix}`)
  const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
    source: {
      kind: 'world-release',
      scope: owned.scope,
      localReleaseRecordId: owned.release.id!,
      expectedReleaseHash: owned.release.contentHash,
    },
    sessionKey: `g5-05-official-reference-cascade-${suffix}`,
  })
  const build = await db.productBuilds.get(creator.buildId)
  if (!build?.id) throw new Error('测试 Creator Build 不存在')
  const plan = JSON.parse(build.planJson) as ProductProductionPlanV3
  const root = await createRootRun({
    scope: owned.scope,
    buildId: build.id,
    buildNumber: build.buildNumber,
    controlEpoch: build.controlEpoch,
    planHash: build.planHash,
  })
  await db.productBuilds.update(build.id, {
    status: 'building',
    stateRevision: build.stateRevision + 1,
    budgetLedgerJson: canonicalProductProductionJsonV2({
      schema: 'storyforge.product-production-budget-ledger',
      version: 2,
      rootRunId: root.run.id,
      rootClaim: null,
      charges: {},
      reservations: {},
      tasks: {},
    }),
    startedAt: Date.now(),
    updatedAt: Date.now(),
  })

  const taskArtifacts = new Map<string, ProductProductionTaskArtifactV1[]>([
    ['p4.region-skeleton', [{
      artifactKey: 'text-open-world.region-skeleton',
      kind: 'text-open-world.region-skeleton',
      payload: await governedPayload(
        creator.productionKey,
        'text-open-world.region-skeleton',
        'regionSkeletonHash',
        { regions: [], locations: [], edges: [], fastTravelPoints: [] },
      ),
    }]],
    ['p8.catalog.npc-runtime', [{
      artifactKey: 'text-open-world.npc-runtime-catalog',
      kind: 'text-open-world.npc-runtime-catalog',
      payload: await governedPayload(
        creator.productionKey,
        'text-open-world.npc-runtime-catalog',
        'npcRuntimeCatalogHash',
        {
          factions: [{ key: 'faction.clean-sibling', title: '同包势力' }],
          actors: [
            {
              key: 'character.bad-a',
              title: '引用缺失地点的角色 A',
              homeLocationKey: 'location.missing-x',
            },
            { key: 'character.clean-sibling', title: '同包健康角色' },
          ],
          schedules: [],
        },
      ),
    }]],
    ['p9.scene-scripts', [
      {
        artifactKey: 'text-open-world.scene-scripts',
        kind: 'text-open-world.scene-scripts',
        payload: await governedPayload(
          creator.productionKey,
          'text-open-world.scene-scripts',
          'sceneScriptsHash',
          {
            scenes: [{
              key: 'scene.ref-sibling-b',
              title: '引用同包健康角色的下游场景 B',
              actorKey: 'character.clean-sibling',
              participantKeys: [],
            }],
          },
        ),
      },
      {
        artifactKey: 'text-open-world.choice-contracts',
        kind: 'text-open-world.choice-contracts',
        payload: await governedPayload(
          creator.productionKey,
          'text-open-world.choice-contracts',
          'choiceContractsHash',
          { choices: [] },
        ),
      },
      {
        artifactKey: 'text-open-world.action-bindings',
        kind: 'text-open-world.action-bindings',
        payload: await governedPayload(
          creator.productionKey,
          'text-open-world.action-bindings',
          'actionBindingsHash',
          { bindings: [] },
        ),
      },
    ]],
  ])
  for (const taskKey of order) {
    const task = plan.tasks.find(item => item.taskKey === taskKey)
    const artifacts = taskArtifacts.get(taskKey)
    if (!task || !artifacts) throw new Error(`测试缺少任务 ${taskKey}`)
    await acceptTaskGroup({
      scope: owned.scope,
      buildId: build.id,
      buildNumber: build.buildNumber,
      controlEpoch: build.controlEpoch,
      planHash: build.planHash,
      rootRunId: root.run.id,
      task,
      artifacts,
    })
  }
  return readTextOpenWorldArtifactGovernanceV1({
    scope: owned.scope,
    productionId: creator.productionId,
  })
}

describe('R-OPEN-WORLD5 · official Creator authority reference cascade', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('A→缺失X 在两种 Artifact 顺序下都撤销 A、同包 sibling 与 B 的生产权威', async () => {
    const projections = [
      await runOfficialOrderCase(
        ['p9.scene-scripts', 'p8.catalog.npc-runtime', 'p4.region-skeleton'],
        'b-before-a',
      ),
      await runOfficialOrderCase(
        ['p4.region-skeleton', 'p8.catalog.npc-runtime', 'p9.scene-scripts'],
        'a-before-b',
      ),
    ]
    for (const projection of projections) {
      const npc = projection.artifacts.find(
        item => item.artifactKey === 'text-open-world.npc-runtime-catalog',
      )
      const scene = projection.artifacts.find(
        item => item.artifactKey === 'text-open-world.scene-scripts',
      )
      expect(npc).toMatchObject({ health: 'dangling', productionValidation: 'not-applicable' })
      expect(scene).toMatchObject({ health: 'dangling', productionValidation: 'not-applicable' })
      expect(scene?.diagnostics.map(item => item.code))
        .toContain('artifact.dangling-reference-cascade')
      expect(projection.entities).toEqual([])
    }
    expect(projections[0].summary).toEqual(projections[1].summary)
  }, 60_000)
})
