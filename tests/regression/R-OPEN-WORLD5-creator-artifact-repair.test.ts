import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  assertTextOpenWorldCreatorRepairPreparationCurrentV1,
  prepareTextOpenWorldCreatorArtifactRepairV1,
} from '../../src/lib/open-world/creator-artifact-repair'
import {
  readTextOpenWorldCreatorRepairExecutionAuthorityV1,
  resolveTextOpenWorldCreatorRepairTaskResultV1,
} from '../../src/lib/open-world/creator-artifact-repair-authority'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { createProductBuildRootTerminalReceiptV1 } from '../../src/lib/product-production/receipts'
import type {
  ProductBuildArtifactRecordV1,
  ProductProductionPlanTaskV3,
} from '../../src/lib/types'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedAuthorizedTextOpenWorldCreatorBuildV1 } from '../helpers/text-open-world-creator-build'

const repairMocks = vi.hoisted(() => ({
  handoffs: [] as any[],
  governanceValid: true,
  governance: null as null | {
    productionId: number
    productionStateRevision: number
    buildId: number
    buildNumber: number
    planHash: string
    artifactKeys: string[]
  },
}))

vi.mock('../../src/lib/open-world/creator-artifact-edit', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/open-world/creator-artifact-edit')>()
  return {
    ...actual,
    listTextOpenWorldCreatorArtifactEditHandoffsV1: vi.fn(async () => (
      structuredClone(repairMocks.handoffs)
    )),
  }
})

// G5-05 owns the expensive byte/Run/checkpoint/root/Blob seal verifier and has
// dedicated adversarial suites. Here we keep its public fail-closed boundary
// real while supplying a deterministic projection so this suite can focus on
// G5-07 impact, command, carry and scheduler behavior.
vi.mock('../../src/lib/open-world/creator-artifact-governance', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/open-world/creator-artifact-governance')>()
  return {
    ...actual,
    readTextOpenWorldArtifactGovernanceV1: vi.fn(async () => {
      const fixture = repairMocks.governance
      if (!fixture) throw new Error('fixture governance projection is not initialized')
      const artifacts = fixture.artifactKeys.map((artifactKey, index) => ({
        artifactKey,
        currentEpoch: true,
        health: repairMocks.governanceValid || index > 0 ? 'verified' : 'corrupt',
        productionValidation: repairMocks.governanceValid || index > 0
          ? 'production-validated'
          : 'not-applicable',
        artifactStatus: 'accepted',
      }))
      return {
        production: {
          id: fixture.productionId,
          stateRevision: fixture.productionStateRevision,
        },
        build: {
          id: fixture.buildId,
          buildNumber: fixture.buildNumber,
          planHash: fixture.planHash,
        },
        summary: {
          currentProblemArtifactCount: repairMocks.governanceValid ? 0 : 1,
          currentProductionValidatedArtifactCount: repairMocks.governanceValid
            ? fixture.artifactKeys.length
            : fixture.artifactKeys.length - 1,
        },
        artifacts,
      }
    }),
  }
})

// The fixture deliberately stores schema-minimal parent payloads because this
// suite exercises repair authority and scheduler adoption, not every upstream
// domain parser (those have their own production tests). Preserve the exact
// registered source-key envelope while avoiding unrelated semantic parsing.
vi.mock('../../src/lib/registry/assemble-context', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/registry/assemble-context')>()
  return {
    ...actual,
    assembleContext: vi.fn(async (input: { sourceKeys: string[]; productProductionTaskKey?: string; inputBudgetTokens?: number; inputBudgetMaxTokens?: number }) => {
      if (!input.productProductionTaskKey) {
        return actual.assembleContext(input as Parameters<typeof actual.assembleContext>[0])
      }
      const segments = input.sourceKeys.map(key => ({ key, content: `fixture:${key}`, tokens: 1 }))
      const inputBudget = input.inputBudgetTokens ?? input.inputBudgetMaxTokens ?? 10_000
      return {
        text: segments.map(item => item.content).join('\n'),
        segments,
        included: [...input.sourceKeys],
        omitted: [],
        trimmed: [],
        sourceEvidence: input.sourceKeys.map(key => ({
          key,
          status: 'included',
          delivery: 'full',
          originalTokens: 1,
          deliveredTokens: 1,
        })),
        totalInputTokens: segments.length,
        inputBudget,
        overBudgetBeforeTrim: false,
        overBudgetAfterTrim: false,
      }
    }),
  }
})

interface RepairFixtureV1 {
  scope: Awaited<ReturnType<typeof seedCurrentProductWorld>>['scope']
  productionId: number
  buildId: number
  buildNumber: number
  stateRevision: number
  plan: { tasks: ProductProductionPlanTaskV3[] }
  sourceArtifacts: ProductBuildArtifactRecordV1[]
}

async function handoffFor(input: {
  fixture: RepairFixtureV1
  taskKey: string
  runId: number
  unchangedSiblingIndexes?: number[]
}) {
  const build = (await db.productBuilds.get(input.fixture.buildId))!
  const production = (await db.productProductions.get(input.fixture.productionId))!
  const task = input.fixture.plan.tasks.find(item => item.taskKey === input.taskKey)!
  const sourceByKey = new Map(input.fixture.sourceArtifacts.map(row => [row.artifactKey, row]))
  const rebuiltArtifacts = await Promise.all(task.outputArtifactKeys.map(async (artifactKey, index) => {
    const source = sourceByKey.get(artifactKey)!
    const unchanged = input.unchangedSiblingIndexes?.includes(index) ?? false
    const payload = unchanged ? JSON.parse(source.payloadJson) : {
      schema: source.kind,
      version: 1,
      marker: `作者确认修改:${input.taskKey}:${index}`,
    }
    const payloadJson = canonicalProductProductionJsonV2(payload)
    return {
      schema: 'storyforge.text-open-world-creator-edit-rebuilt-artifact',
      version: 1,
      artifactKey,
      requirementKey: source.requirementKey,
      kind: source.kind,
      baseVersion: source.version,
      nextVersion: source.version + 1,
      baseContentHash: source.contentHash,
      contentHash: unchanged ? source.contentHash : await hashProductProductionValueV2(payload),
      payload,
      metadata: unchanged ? JSON.parse(source.metadataJson) : { source: 'creator-edit' },
      quality: unchanged ? JSON.parse(source.qualityJson) : { reviewed: true },
      rights: unchanged ? JSON.parse(source.rightsJson) : { basis: 'author-owned' },
      byteSize: new TextEncoder().encode(payloadJson).byteLength,
    }
  }))
  const baseGroupHash = await hashProductProductionValueV2({
    taskKey: input.taskKey,
    artifacts: task.outputArtifactKeys.map(key => sourceByKey.get(key)!.contentHash),
  })
  const candidate: any = {
    production: {
      productionId: production.id,
      productionKey: production.productionKey,
      stateRevision: production.stateRevision,
    },
    baseBuild: {
      buildId: build.id,
      buildNumber: build.buildNumber,
      stateRevision: build.stateRevision,
      controlEpoch: build.controlEpoch,
      planHash: build.planHash,
      manifestHash: build.manifestHash,
      rootTerminalReceiptHash: build.rootTerminalReceiptHash,
    },
    target: { artifactKey: task.outputArtifactKeys[0], entityIdentity: null },
    ownerSiblingGroup: {
      ownerTaskKey: task.taskKey,
      outputArtifactKeys: [...task.outputArtifactKeys],
      baseGroupHash,
    },
    rebuiltArtifacts,
    status: 'ready',
    validation: { status: 'ready' },
    candidateHash: await hashProductProductionValueV2({
      taskKey: input.taskKey,
      rebuiltArtifacts: rebuiltArtifacts.map(row => row.contentHash),
    }),
  }
  const intentHash = await hashProductProductionValueV2({
    candidateHash: candidate.candidateHash,
    confirmed: true,
  })
  return {
    snapshot: { run: { id: input.runId } },
    checkpoint: {},
    candidate,
    intent: { candidate, intentHash },
    terminalReceipt: { receiptHash: await hashProductProductionValueV2({ intentHash, terminal: true }) },
    verificationReceipt: { receiptHash: await hashProductProductionValueV2({ intentHash, verified: true }) },
  }
}

async function seedRepairFixture(): Promise<RepairFixtureV1> {
  const world = await seedCurrentProductWorld(`G5-07 repair ${crypto.randomUUID()}`)
  const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
    source: {
      kind: 'world-release',
      scope: world.scope,
      localReleaseRecordId: world.release.id!,
      expectedReleaseHash: world.release.contentHash,
    },
    sessionKey: `g5-07-repair-${crypto.randomUUID()}`,
  })
  const build = (await db.productBuilds.get(creator.buildId))!
  const production = (await db.productProductions.get(creator.productionId))!
  const plan = JSON.parse(build.planJson) as { tasks: ProductProductionPlanTaskV3[] }
  const now = Date.now()
  const sourceArtifacts: ProductBuildArtifactRecordV1[] = []
  const ledgerTasks: Record<string, unknown> = {}
  for (const task of plan.tasks) {
    const taskInputHash = await hashProductProductionValueV2({ taskKey: task.taskKey, input: true })
    const taskCandidateHash = await hashProductProductionValueV2({ taskKey: task.taskKey, candidate: true })
    const taskReceiptHash = await hashProductProductionValueV2({ taskKey: task.taskKey, receipt: true })
    for (const artifactKey of task.outputArtifactKeys) {
      const payload = { schema: artifactKey, version: 1, marker: `base:${artifactKey}` }
      const payloadJson = canonicalProductProductionJsonV2(payload)
      const row = stampNewRecord(world.scope, 'productBuildArtifacts', {
        projectId: world.scope.projectId,
        worldId: world.scope.worldId,
        workId: world.scope.workId,
        buildId: build.id!,
        artifactKey,
        requirementKey: null,
        version: 1,
        kind: artifactKey,
        mediaKind: null,
        status: 'accepted' as const,
        producerRunId: 10_000 + sourceArtifacts.length,
        producerReceiptHash: taskReceiptHash,
        controlEpoch: build.controlEpoch,
        inputHash: taskInputHash,
        contentHash: await hashProductProductionValueV2(payload),
        payloadJson,
        metadataJson: '{}',
        qualityJson: '{}',
        rightsJson: '{}',
        blobObjectId: null,
        mimeType: null,
        byteSize: new TextEncoder().encode(payloadJson).byteLength,
        parentArtifactHash: null,
        carriedFrom: null,
        createdAt: now,
        updatedAt: now,
      } as never, { owner: 'work' })
      const id = await db.productBuildArtifacts.add(row) as number
      sourceArtifacts.push({ ...row, id } as ProductBuildArtifactRecordV1)
    }
    ledgerTasks[task.taskKey] = {
      runId: 20_000 + Object.keys(ledgerTasks).length,
      attempt: 1,
      status: 'settled',
      idempotencyKey: taskInputHash,
      candidateHash: taskCandidateHash,
      terminalReceiptHash: taskReceiptHash,
      passedGateIds: [...task.acceptanceGateIds],
      usage: {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        mediaCalls: 0,
        costUsd: 0,
        durationMs: 0,
        storageBytes: 0,
      },
      errorCode: null,
    }
  }
  const runtime = sourceArtifacts.find(row => row.artifactKey === 'text-open-world.runtime-package')!
  const runtimePayload = { schema: 'storyforge.product-runtime-package', version: 3, fixture: true }
  runtime.payloadJson = canonicalProductProductionJsonV2(runtimePayload)
  runtime.contentHash = await hashProductProductionValueV2(runtimePayload)
  runtime.byteSize = new TextEncoder().encode(runtime.payloadJson).byteLength
  await db.productBuildArtifacts.update(runtime.id!, {
    payloadJson: runtime.payloadJson,
    contentHash: runtime.contentHash,
    byteSize: runtime.byteSize,
  })
  const quality = sourceArtifacts.find(row => row.artifactKey === 'text-open-world.quality-report')!
  const qualityPayload = {
    schema: 'storyforge.product-build-quality-report',
    version: 1,
    buildNumber: build.buildNumber,
    packageHash: runtime.contentHash,
    hardGateResults: [],
    softGateResults: [],
    mediaCoverage: 0,
    playable: true,
    releaseReady: true,
    warnings: [],
  }
  quality.payloadJson = canonicalProductProductionJsonV2(qualityPayload)
  quality.contentHash = await hashProductProductionValueV2(qualityPayload)
  quality.byteSize = new TextEncoder().encode(quality.payloadJson).byteLength
  await db.productBuildArtifacts.update(quality.id!, {
    payloadJson: quality.payloadJson,
    contentHash: quality.contentHash,
    byteSize: quality.byteSize,
  })
  const orderedArtifacts = [...sourceArtifacts]
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
  const budgetLedgerJson = canonicalProductProductionJsonV2({
    schema: 'storyforge.product-production-budget-ledger',
    version: 2,
    rootRunId: 1,
    rootClaim: null,
    charges: {},
    reservations: {},
    tasks: ledgerTasks,
  })
  const manifest = {
    schema: 'storyforge.product-build-manifest',
    version: 1,
    productionKey: production.productionKey,
    buildNumber: build.buildNumber,
    briefRevision: build.briefRevision,
    briefHash: build.briefHash,
    planHash: build.planHash,
    controlEpoch: build.controlEpoch,
    runtimePackageHash: runtime.contentHash,
    artifactReceipts: orderedArtifacts.map(row => ({
      artifactKey: row.artifactKey,
      version: row.version,
      contentHash: row.contentHash,
      producerReceiptHash: row.producerReceiptHash,
    })),
    completedGateIds: [...new Set(plan.tasks.flatMap(task => task.acceptanceGateIds))].sort(),
    fallbackSummary: [],
  }
  const manifestJson = canonicalProductProductionJsonV2(manifest)
  const manifestHash = await hashProductProductionValueV2(manifest)
  const rootTerminalReceiptHash = await createProductBuildRootTerminalReceiptV1({
    planHash: build.planHash,
    manifestHash,
    packageHash: runtime.contentHash,
    qualityReportHash: quality.contentHash,
    controlEpoch: build.controlEpoch,
    budgetLedgerJson,
    artifacts: orderedArtifacts,
  })
  const buildStateRevision = build.stateRevision + 1
  const productionStateRevision = production.stateRevision + 1
  await db.productBuilds.update(build.id!, {
    status: 'release-ready',
    stateRevision: buildStateRevision,
    budgetLedgerJson,
    manifestJson,
    manifestHash,
    packageHash: runtime.contentHash,
    qualityReportJson: quality.payloadJson,
    qualityReportHash: quality.contentHash,
    rootTerminalReceiptHash,
    completedAt: now,
    updatedAt: now,
  })
  await db.productProductions.update(production.id!, {
    status: 'preview-ready',
    stateRevision: productionStateRevision,
    currentBuildNumber: build.buildNumber,
    updatedAt: now,
  })
  const fixture: RepairFixtureV1 = {
    scope: world.scope,
    productionId: creator.productionId,
    buildId: creator.buildId,
    buildNumber: build.buildNumber,
    stateRevision: productionStateRevision,
    plan,
    sourceArtifacts,
  }
  repairMocks.governance = {
    productionId: creator.productionId,
    productionStateRevision,
    buildId: creator.buildId,
    buildNumber: build.buildNumber,
    planHash: build.planHash,
    artifactKeys: plan.tasks.flatMap(task => task.outputArtifactKeys),
  }
  repairMocks.handoffs = [await handoffFor({
    fixture,
    taskKey: 'p4.player-build',
    runId: 90_001,
  })]
  return fixture
}

function commandFor(prepared: Awaited<ReturnType<typeof prepareTextOpenWorldCreatorArtifactRepairV1>>) {
  return {
    type: 'authorize-text-open-world-creator-repair' as const,
    commandId: `g5-07-repair:${prepared.impactPlan.impactPlanHash.slice(0, 16)}`,
    expectedStateRevision: prepared.production.stateRevision,
    baseBuildNumber: prepared.baseBuild.buildNumber,
    expectedBasePlanHash: prepared.baseBuild.planHash,
    expectedHandoffSetHash: prepared.impactPlan.handoffSetHash,
    expectedImpactPlanHash: prepared.impactPlan.impactPlanHash,
    expectedTargetPlanHash: prepared.targetPlanHash,
    authorizationNonce: 'g5-07-author-confirmation',
    authorizedAt: Date.now() + 1,
  }
}

function capabilityBindingsFor(plan: RepairFixtureV1['plan']) {
  const byKey = new Map<string, { requirementKey: string; adapterId: string; bindingHash: string }>()
  for (const task of plan.tasks) {
    for (const requirementKey of task.capabilityRequirementKeys) {
      byKey.set(requirementKey, {
        requirementKey,
        adapterId: task.taskKey === 'media.visual'
          ? 'storyforge.procedural-svg.v1'
          : task.taskKey === 'media.audio'
            ? 'storyforge.procedural-audio.v1'
            : 'fixture-text.v1',
        bindingHash: 'a'.repeat(64),
      })
    }
  }
  return [...byKey.values()]
}

describe.sequential('Text Open World G5-07 · governed local repair Build', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    repairMocks.handoffs = []
    repairMocks.governanceValid = true
    repairMocks.governance = null
  })
  afterAll(() => db.close())

  it('derives target/stale/reuse from the official DAG and refuses ancestor-descendant edits together', async () => {
    const fixture = await seedRepairFixture()
    const prepared = await prepareTextOpenWorldCreatorArtifactRepairV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      buildId: fixture.buildId,
    })
    expect(prepared.impactPlan.targetTaskKeys).toEqual(['p4.player-build'])
    expect(prepared.impactPlan.staleTaskKeys[0]).toBe('p4.player-build')
    expect(prepared.impactPlan.staleTaskKeys).toContain('qa.release')
    expect(prepared.impactPlan.reuseTaskKeys).toContain('p0.source-lock')
    expect(prepared.targetPlan.tasks.find(task => task.taskKey === 'p4.player-build')?.reuse)
      .toBeNull()
    expect(prepared.targetPlan.tasks.find(task => task.taskKey === 'p0.source-lock')?.reuse)
      .toMatchObject({ sourceBuildNumber: fixture.buildNumber, requiresRevalidation: true })

    repairMocks.handoffs.push(await handoffFor({
      fixture,
      taskKey: 'p5.mainline',
      runId: 90_002,
    }))
    await expect(prepareTextOpenWorldCreatorArtifactRepairV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      buildId: fixture.buildId,
    })).rejects.toThrow(/祖先\/后代任务/)
  }, 30_000)

  it('accepts a changed target while preserving byte-identical owner siblings', async () => {
    const fixture = await seedRepairFixture()
    repairMocks.handoffs = [await handoffFor({
      fixture,
      taskKey: 'p8.quest-skeletons',
      runId: 90_010,
      unchangedSiblingIndexes: [1],
    })]
    const prepared = await prepareTextOpenWorldCreatorArtifactRepairV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      buildId: fixture.buildId,
    })
    const artifacts = prepared.impactPlan.handoffs[0]!.artifacts
    expect(artifacts).toHaveLength(2)
    expect(artifacts[0]!.contentHash).not.toBe(artifacts[0]!.baseContentHash)
    expect(artifacts[1]!.contentHash).toBe(artifacts[1]!.baseContentHash)
  }, 30_000)

  it('refuses a status-shaped Build that lacks the complete G5-05 production seal', async () => {
    const fixture = await seedRepairFixture()
    repairMocks.governanceValid = false
    await expect(prepareTextOpenWorldCreatorArtifactRepairV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      buildId: fixture.buildId,
    })).rejects.toThrow(/完整封印与生产权威验证/)
    expect(await db.productBuilds.where('productionId').equals(fixture.productionId).count()).toBe(1)
  }, 30_000)

  it('creates one immutable child Build, stages full siblings, and replays the same command idempotently', async () => {
    const fixture = await seedRepairFixture()
    const baseBefore = structuredClone(await db.productBuilds.get(fixture.buildId))
    const sourceArtifactsBefore = await db.productBuildArtifacts
      .where('buildId').equals(fixture.buildId).sortBy('id')
    const prepared = await prepareTextOpenWorldCreatorArtifactRepairV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      buildId: fixture.buildId,
    })
    const command = commandFor(prepared)
    const first = await executeProductProductionCommand({
      scope: fixture.scope,
      productionId: fixture.productionId,
      command,
      now: command.authorizedAt,
    })
    expect(first).toMatchObject({ ok: true, replayed: false, stateRevision: fixture.stateRevision + 1 })
    const second = await executeProductProductionCommand({
      scope: fixture.scope,
      productionId: fixture.productionId,
      command,
      now: command.authorizedAt + 1,
    })
    expect(second).toMatchObject({ ok: true, replayed: true, result: first.result })
    expect(await db.productBuilds.where('productionId').equals(fixture.productionId).count()).toBe(2)
    expect(await db.productBuilds.get(fixture.buildId)).toEqual(baseBefore)
    expect(await db.productBuildArtifacts.where('buildId').equals(fixture.buildId).sortBy('id'))
      .toEqual(sourceArtifactsBefore)

    const target = await db.productBuilds.where('[productionId+buildNumber]')
      .equals([fixture.productionId, fixture.buildNumber + 1]).first()
    expect(target).toMatchObject({
      parentBuildNumber: fixture.buildNumber,
      status: 'authorized',
      planHash: prepared.targetPlanHash,
    })
    const staged = await db.productBuildArtifacts.where('buildId').equals(target!.id!).toArray()
    expect(staged).toHaveLength(1)
    expect(staged[0]).toMatchObject({
      artifactKey: 'text-open-world.player-build',
      status: 'candidate',
      parentArtifactHash: repairMocks.handoffs[0].candidate.rebuiltArtifacts[0].baseContentHash,
      contentHash: repairMocks.handoffs[0].candidate.rebuiltArtifacts[0].contentHash,
    })

    const authority = await readTextOpenWorldCreatorRepairExecutionAuthorityV1({
      scope: fixture.scope,
      buildId: target!.id!,
    })
    expect(authority.authorization.authorizationHash).toBe(first.result.authorizationHash)
    const task = authority.targetProductionPlan.tasks.find(item => item.taskKey === 'p4.player-build')!
    const inputArtifacts = fixture.sourceArtifacts.filter(row => task.inputArtifactKeys.includes(row.artifactKey))
    const adopted = await resolveTextOpenWorldCreatorRepairTaskResultV1({
      authority,
      taskKey: task.taskKey,
      inputArtifacts,
    })
    expect(adopted?.result.usage).toMatchObject({ modelCalls: 0, mediaCalls: 0, costUsd: 0 })
    expect(adopted?.result.artifacts.map(row => row.artifactKey)).toEqual(task.outputArtifactKeys)
  }, 30_000)

  it('uses the immutable current Release as the source of a repair child Build after publication', async () => {
    const fixture = await seedRepairFixture()
    const releasedProductReleaseId = 9_500_711
    const releasedStateRevision = fixture.stateRevision + 1
    await db.productBuilds.update(fixture.buildId, {
      status: 'released',
      releasedProductReleaseId,
      updatedAt: Date.now() + 1,
    })
    await db.productProductions.update(fixture.productionId, {
      status: 'released',
      currentProductReleaseId: releasedProductReleaseId,
      stateRevision: releasedStateRevision,
      updatedAt: Date.now() + 1,
    })
    fixture.stateRevision = releasedStateRevision
    repairMocks.governance!.productionStateRevision = releasedStateRevision
    repairMocks.handoffs = [await handoffFor({
      fixture,
      taskKey: 'p4.player-build',
      runId: 90_071,
    })]

    const prepared = await prepareTextOpenWorldCreatorArtifactRepairV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      buildId: fixture.buildId,
    })
    const command = commandFor(prepared)
    const receipt = await executeProductProductionCommand({
      scope: fixture.scope,
      productionId: fixture.productionId,
      command,
      now: command.authorizedAt,
    })
    expect(receipt).toMatchObject({ ok: true, replayed: false })
    const target = await db.productBuilds.where('[productionId+buildNumber]')
      .equals([fixture.productionId, fixture.buildNumber + 1]).first()
    expect(target).toMatchObject({
      parentBuildNumber: fixture.buildNumber,
      sourceProductReleaseId: releasedProductReleaseId,
      releasedProductReleaseId: null,
      status: 'authorized',
    })
    await expect(db.productBuilds.get(fixture.buildId)).resolves.toMatchObject({
      status: 'released',
      releasedProductReleaseId,
    })
    await expect(db.productProductions.get(fixture.productionId)).resolves.toMatchObject({
      status: 'producing',
      currentProductReleaseId: releasedProductReleaseId,
      currentBuildNumber: fixture.buildNumber + 1,
    })
  }, 30_000)

  it('fails stale preview hashes without a partial Build and detects any witnessed source mutation', async () => {
    const fixture = await seedRepairFixture()
    const prepared = await prepareTextOpenWorldCreatorArtifactRepairV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      buildId: fixture.buildId,
    })
    const badCommand = { ...commandFor(prepared), expectedImpactPlanHash: 'f'.repeat(64) }
    await expect(executeProductProductionCommand({
      scope: fixture.scope,
      productionId: fixture.productionId,
      command: badCommand,
    })).rejects.toThrow(/预览 Hash 已变化/)
    expect(await db.productBuilds.where('productionId').equals(fixture.productionId).count()).toBe(1)
    expect(await db.productProductionCommands
      .where('[productionId+commandId]').equals([fixture.productionId, badCommand.commandId]).count())
      .toBe(0)

    const source = fixture.sourceArtifacts.find(row => row.artifactKey === 'text-open-world.player-build')!
    await db.productBuildArtifacts.update(source.id!, { updatedAt: source.updatedAt + 1 })
    await expect(assertTextOpenWorldCreatorRepairPreparationCurrentV1(prepared))
      .rejects.toThrow(/读取集合已变化/)
  }, 30_000)

  it('invalidates persisted authority when the target Plan or staged candidate is tampered', async () => {
    const fixture = await seedRepairFixture()
    const prepared = await prepareTextOpenWorldCreatorArtifactRepairV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      buildId: fixture.buildId,
    })
    const command = commandFor(prepared)
    await executeProductProductionCommand({
      scope: fixture.scope,
      productionId: fixture.productionId,
      command,
      now: command.authorizedAt,
    })
    const target = (await db.productBuilds.where('[productionId+buildNumber]')
      .equals([fixture.productionId, fixture.buildNumber + 1]).first())!
    const sourceTarget = fixture.sourceArtifacts.find(
      row => row.artifactKey === 'text-open-world.player-build',
    )!
    await db.productBuildArtifacts.update(sourceTarget.id!, { contentHash: '0'.repeat(64) })
    await expect(readTextOpenWorldCreatorRepairExecutionAuthorityV1({
      scope: fixture.scope,
      buildId: target.id!,
    })).rejects.toThrow(/base sibling 已偏离授权来源/)
    await db.productBuildArtifacts.update(sourceTarget.id!, { contentHash: sourceTarget.contentHash })

    const authority = await readTextOpenWorldCreatorRepairExecutionAuthorityV1({
      scope: fixture.scope,
      buildId: target.id!,
    })
    const staged = (await db.productBuildArtifacts.where('buildId').equals(target.id!).first())!
    await db.productBuildArtifacts.update(staged.id!, { inputHash: '0'.repeat(64) })
    const task = authority.targetProductionPlan.tasks.find(item => item.taskKey === 'p4.player-build')!
    await expect(resolveTextOpenWorldCreatorRepairTaskResultV1({
      authority,
      taskKey: task.taskKey,
      inputArtifacts: fixture.sourceArtifacts.filter(row => task.inputArtifactKeys.includes(row.artifactKey)),
    })).rejects.toThrow(/staged candidate 证据不闭合/)

    await db.productBuilds.update(target.id!, { planHash: '0'.repeat(64) })
    await expect(readTextOpenWorldCreatorRepairExecutionAuthorityV1({
      scope: fixture.scope,
      buildId: target.id!,
    })).rejects.toThrow(/唯一成功授权命令回执|Plan Hash/)
  }, 30_000)

  it('scheduler revalidates reusable ancestors and recovers checkpointed direct adoption with zero provider call', async () => {
    const fixture = await seedRepairFixture()
    const prepared = await prepareTextOpenWorldCreatorArtifactRepairV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      buildId: fixture.buildId,
    })
    const command = commandFor(prepared)
    await executeProductProductionCommand({
      scope: fixture.scope,
      productionId: fixture.productionId,
      command,
      now: command.authorizedAt,
    })
    const executor = vi.fn(async () => {
      throw new Error('direct repair target must not call external executor')
    })
    let interruptedTargetRunId: number | null = null
    await expect(runProductProductionSchedulerCycleV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      executor,
      capabilityBindings: capabilityBindingsFor(fixture.plan),
      onDurableBoundary(boundary, snapshot) {
        if (boundary === 'candidate.checkpoint'
          && snapshot.contract.scope.productProduction?.taskKey === 'p4.player-build') {
          interruptedTargetRunId = snapshot.run.id
          throw new Error('injected-after-direct-repair-checkpoint')
        }
      },
    })).rejects.toThrow('injected-after-direct-repair-checkpoint')
    expect(executor).not.toHaveBeenCalled()
    expect(interruptedTargetRunId).not.toBeNull()
    const interrupted = await readAgentRunV1(fixture.scope, interruptedTargetRunId!)
    expect(interrupted.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
    expect(interrupted.events.filter(event => event.type === 'step.succeeded')).toHaveLength(0)

    const projection = await runProductProductionSchedulerCycleV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
      executor,
      capabilityBindings: capabilityBindingsFor(fixture.plan),
    })
    const targetTask = projection.tasks.find(task => task.taskKey === 'p4.player-build')
    expect(targetTask).toMatchObject({ status: 'completed', attempt: 1 })
    expect(executor.mock.calls.some(([call]) => call.task.taskKey === 'p4.player-build')).toBe(false)
    expect(executor.mock.calls.some(([call]) => call.task.taskKey === 'p5.mainline')).toBe(true)
    expect(projection.tasks.find(task => task.taskKey === 'p0.source-lock')).toMatchObject({
      status: 'completed',
    })
    const run = await readAgentRunV1(fixture.scope, targetTask!.runId!)
    expect(run.run.id).toBe(interruptedTargetRunId)
    expect(run.events.filter(event => event.type === 'model.requested')).toHaveLength(0)
    expect(run.events.filter(event => event.type === 'tool.called')).toHaveLength(1)
    expect(run.events.find(event => event.type === 'tool.called')?.payload)
      .toMatchObject({ toolName: 'text-open-world-creator-repair-adoption' })
    const targetBuild = (await db.productBuilds.where('[productionId+buildNumber]')
      .equals([fixture.productionId, fixture.buildNumber + 1]).first())!
    const activeTarget = (await db.productBuildArtifacts.where('buildId').equals(targetBuild.id!).toArray())
      .filter(row => row.controlEpoch === targetBuild.controlEpoch
        && row.artifactKey === 'text-open-world.player-build'
        && row.status === 'accepted')
    expect(activeTarget).toHaveLength(1)
    expect(activeTarget[0].contentHash)
      .toBe(repairMocks.handoffs[0].candidate.rebuiltArtifacts[0].contentHash)
  }, 30_000)
})
