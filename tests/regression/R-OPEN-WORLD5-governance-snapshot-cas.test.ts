import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { db } from '../../src/lib/db/schema'
import {
  readTextOpenWorldArtifactGovernanceV1,
} from '../../src/lib/open-world/creator-artifact-governance'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import type { ProductProductionPlanV3 } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

const BRIEF_HASH = 'b'.repeat(64)

function replaceSameLengthValueCharacter(value: string): string {
  for (let index = value.length - 2; index >= 0; index -= 1) {
    const character = value[index]
    if (/[A-Za-z0-9]/.test(character)) {
      const replacement = character === 'x' ? 'y' : 'x'
      return `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`
    }
  }
  throw new Error('测试正文没有可替换字符')
}

function digestInputText(data: BufferSource): string {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data)
  return new TextDecoder().decode(bytes)
}

async function seedGovernanceReadFixture() {
  const owned = await seedCurrentProductWorld('tow-governance-snapshot-cas')
  const productionId = await db.productProductions.add({
    ...owned.scope,
    productionKey: 'tow.governance.snapshot.cas',
    productType: 'text-open-world',
    title: '稳定治理快照夹具',
    status: 'producing',
    stateRevision: 1,
    controlEpoch: 0,
    currentBriefRevision: 1,
    currentBuildNumber: 1,
    currentProductReleaseId: null,
    lastErrorJson: '{}',
    createdAt: 1,
    updatedAt: 1,
  }) as number
  const plan: ProductProductionPlanV3 = {
    schema: 'storyforge.product-production-plan',
    version: 3,
    buildNumber: 1,
    productType: 'text-open-world',
    briefHash: BRIEF_HASH,
    controlEpoch: 0,
    concurrency: {
      maximumCostBearingTasks: 1,
      maximumTextProviderTasks: 1,
      maximumMediaProviderTasks: 1,
    },
    tasks: [{
      taskKey: 'fixture.pending',
      lane: 'content',
      kind: 'fixture.pending',
      skillId: null,
      executionMode: 'deterministic',
      dependsOn: [],
      requiredReceipts: [],
      inputArtifactKeys: [],
      outputArtifactKeys: ['text-open-world.region-skeleton'],
      requirementKeys: [],
      capabilityRequirementKeys: [],
      concurrencyGroup: 'fixture',
      subjectLockKeys: ['text-open-world.region-skeleton'],
      priority: 1,
      budgetReservation: {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        mediaCalls: 0,
        maximumCostUsd: 0,
        durationMs: 1_000,
        storageBytes: 1_000,
      },
      maxAttempts: 1,
      timeoutMs: 1_000,
      failurePolicy: 'fail-build',
      fallbackTaskKey: null,
      acceptanceGateIds: [],
      reuse: null,
    }],
    terminalTaskKey: 'fixture.pending',
  }
  const planHash = await hashProductProductionValueV2(plan)
  const buildId = await db.productBuilds.add({
    ...owned.scope,
    productionId,
    buildNumber: 1,
    briefRevision: 1,
    briefHash: BRIEF_HASH,
    parentBuildNumber: null,
    sourceProductReleaseId: null,
    status: 'producing',
    resumeState: null,
    stateRevision: 1,
    controlEpoch: 0,
    planRevision: 1,
    planJson: canonicalProductProductionJsonV2(plan),
    planHash,
    budgetLedgerJson: '{}',
    manifestJson: '{}',
    manifestHash: '',
    packageHash: '',
    previewManifestJson: '{}',
    previewHash: '',
    qualityReportJson: '{}',
    qualityReportHash: '',
    compatibilityJson: '{}',
    rootTerminalReceiptHash: null,
    adoptionIntentHash: null,
    releasedProductReleaseId: null,
    failureJson: '{}',
    authorizedAt: 1,
    startedAt: 1,
    completedAt: null,
    createdAt: 1,
    updatedAt: 1,
  }) as number
  const root = await createAgentRunV1({
    scope: owned.scope,
    productBuildId: buildId,
    worldGroupId: null,
    now: 2,
    contract: {
      version: 1,
      objective: '为 Creator 治理读取建立可验证的 root Run。',
      workflowKind: 'long-running-resumable',
      runtimeBindingHash: 'a'.repeat(64),
      scope: {
        projectId: owned.scope.projectId,
        worldGroupId: null,
        productProduction: {
          productBuildId: buildId,
          buildNumber: 1,
          controlEpoch: 0,
          planHash,
          taskKey: '$root',
        },
      },
      permissions: { contextSourceKeys: ['text-open-world.source-pin'], writeTargets: [] },
      budget: {
        maxModelCalls: 1,
        maxToolCalls: 0,
        maxInputTokens: 1,
        maxOutputTokens: 1,
        maxAttemptsPerStep: 1,
      },
      acceptance: [{ id: 'fixture.pending', kind: 'output-present', required: true }],
      verificationPlan: [{
        id: 'fixture.pending.terminal',
        kind: 'terminal',
        verifier: 'tow-governance-snapshot-cas-v1',
        criterionIds: ['fixture.pending'],
      }],
      failurePolicy: {
        onProtocolError: 'fail',
        onVerificationFailure: 'fail',
        onStaleInput: 'pause-for-author',
      },
    },
  })
  const created = await createAgentRunCheckpointV1({
    scope: owned.scope,
    runId: root.run.id,
    resumePayload: { marker: 'checkpoint-original' },
    now: 3,
  })
  await db.productBuilds.update(buildId, {
    budgetLedgerJson: canonicalProductProductionJsonV2({
      schema: 'storyforge.product-production-budget-ledger',
      version: 2,
      rootRunId: root.run.id,
      tasks: {},
    }),
  })
  const event = await db.agentRunEvents
    .where('[runId+sequence]')
    .equals([root.run.id, 1])
    .first()
  const run = await db.agentRuns.get(root.run.id)
  return {
    scope: owned.scope,
    productionId,
    productionKey: 'tow.governance.snapshot.cas',
    run: run!,
    event: event!,
    checkpoint: created.checkpoint,
  }
}

async function seedGovernanceMediaReadFixture() {
  const fixture = await seedGovernanceReadFixture()
  const build = await db.productBuilds
    .where('[productionId+buildNumber]')
    .equals([fixture.productionId, 1])
    .first()
  if (!build?.id) throw new Error('测试 Build 不存在')
  const plan = JSON.parse(build.planJson) as ProductProductionPlanV3
  plan.tasks[0] = {
    ...plan.tasks[0],
    outputArtifactKeys: ['text-open-world.media.visual.001'],
    subjectLockKeys: ['text-open-world.media.visual.001'],
  }
  const planHash = await hashProductProductionValueV2(plan)
  await db.productBuilds.update(build.id, {
    planJson: canonicalProductProductionJsonV2(plan),
    planHash,
  })
  const data = new Uint8Array([1, 2, 3, 4, 5, 6]).buffer
  const tamperedData = new Uint8Array([6, 5, 4, 3, 2, 1]).buffer
  const contentHash = await sha256MediaData(data)
  const blobObjectId = await db.mediaBlobObjects.add({
    ...fixture.scope,
    contentHash,
    mimeType: 'image/png',
    byteSize: data.byteLength,
    backend: 'indexeddb',
    storageState: 'ready',
    data,
    opfsPath: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    lastVerifiedAt: null,
    createdAt: 4,
    updatedAt: 4,
  }) as number
  const payloadJson = canonicalProductProductionJsonV2({
    schema: 'storyforge.generated-media-artifact',
    version: 1,
    assetKey: 'visual.fixture',
    request: { mediaKind: 'background', prompt: '仅用于物理字节完整性测试。' },
  })
  await db.productBuildArtifacts.add({
    ...fixture.scope,
    buildId: build.id,
    artifactKey: 'text-open-world.media.visual.001',
    requirementKey: 'visual.fixture',
    version: 1,
    kind: 'image',
    mediaKind: 'background',
    status: 'accepted',
    producerRunId: 999_998,
    producerReceiptHash: 'c'.repeat(64),
    controlEpoch: 0,
    inputHash: 'd'.repeat(64),
    contentHash,
    payloadJson,
    metadataJson: '{}',
    qualityJson: '{}',
    rightsJson: '{}',
    blobObjectId,
    mimeType: 'image/png',
    byteSize: data.byteLength,
    parentArtifactHash: null,
    carriedFrom: null,
    createdAt: 4,
    updatedAt: 4,
  })
  return { ...fixture, blobObjectId, data, tamperedData }
}

async function expectMutationDuringProjectionToInvalidateSnapshot(
  mutate: () => Promise<void>,
  read: () => Promise<unknown>,
): Promise<void> {
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle)
  let mutated = false
  const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
    const result = await nativeDigest(algorithm, data)
    if (!mutated && digestInputText(data).includes(
      '"schema":"storyforge.text-open-world-artifact-governance-projection"',
    )) {
      mutated = true
      await mutate()
    }
    return result
  })
  try {
    await expect(read()).rejects.toThrow(/读取期间治理快照已变化/)
    expect(mutated).toBe(true)
  } finally {
    digest.mockRestore()
  }
}

describe('R-OPEN-WORLD5 · Creator governance stable snapshot CAS', () => {
  beforeEach(async () => {
    db.close()
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('Artifact 引用不存在的 producer Run 时返回可定位诊断而不是误报快照变化', async () => {
    const fixture = await seedGovernanceReadFixture()
    const build = await db.productBuilds
      .where('[productionId+buildNumber]')
      .equals([fixture.productionId, 1])
      .first()
    const body = {
      schema: 'storyforge.text-open-world-region-skeleton',
      version: 1,
      productType: 'text-open-world',
      productInstanceKey: fixture.productionKey,
      createdAt: 4,
      regions: [{ key: 'region.missing-run', title: '失联地区', locationKeys: [] }],
      locations: [],
      edges: [],
      fastTravelPoints: [],
    }
    const payload = {
      ...body,
      regionSkeletonHash: await hashProductProductionValueV2(body),
    }
    const payloadJson = canonicalProductProductionJsonV2(payload)
    const acceptedRow = {
      ...fixture.scope,
      buildId: build!.id!,
      artifactKey: 'text-open-world.region-skeleton',
      requirementKey: null,
      version: 1,
      kind: 'text-open-world.region-skeleton',
      mediaKind: null,
      status: 'accepted',
      producerRunId: 999_999,
      producerReceiptHash: 'd'.repeat(64),
      controlEpoch: 0,
      inputHash: 'e'.repeat(64),
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
      createdAt: 4,
      updatedAt: 4,
    } as const
    const invalidRow = {
      ...acceptedRow,
      version: 2,
      status: 'invalid' as const,
      producerRunId: null,
      producerReceiptHash: null,
      createdAt: 3,
      updatedAt: 3,
    }
    await db.productBuildArtifacts.add(acceptedRow)
    await db.productBuildArtifacts.add(invalidRow)

    const projection = await readTextOpenWorldArtifactGovernanceV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
    })

    expect(projection.artifacts).toHaveLength(2)
    const active = projection.artifacts.find(item => item.artifactStatus === 'accepted')!
    expect(active.health).toBe('corrupt')
    expect(active.diagnostics.map(item => item.code))
      .toContain('artifact.run-provenance')
    expect(projection.artifacts.some(item => item.artifactStatus === 'invalid')).toBe(true)
  })

  it('Production、Run、事件或 checkpoint 正文保持长度不变时，尾读也拒绝旧 verified 快照', async () => {
    const fixture = await seedGovernanceReadFixture()
    const read = () => readTextOpenWorldArtifactGovernanceV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
    })
    const baseline = await read()
    expect(baseline.artifacts[0]).toMatchObject({
      artifactKey: 'text-open-world.region-skeleton',
      health: 'pending',
    })

    const mutations = [
      {
        table: 'production.productionKey',
        original: fixture.productionKey,
        mutate: async (value: string) => {
          await db.productProductions.update(fixture.productionId, { productionKey: value })
        },
      },
      {
        table: 'run.contractJson',
        original: fixture.run.contractJson,
        mutate: async (value: string) => {
          await db.agentRuns.update(fixture.run.id, { contractJson: value })
        },
      },
      {
        table: 'run.projectionJson',
        original: fixture.run.projectionJson,
        mutate: async (value: string) => {
          await db.agentRuns.update(fixture.run.id, { projectionJson: value })
        },
      },
      {
        table: 'event.payloadJson',
        original: fixture.event.payloadJson,
        mutate: async (value: string) => {
          await db.agentRunEvents.update(fixture.event.id!, { payloadJson: value })
        },
      },
      {
        table: 'checkpoint.projectionJson',
        original: fixture.checkpoint.projectionJson,
        mutate: async (value: string) => {
          await db.agentRunCheckpoints.update(fixture.checkpoint.id, { projectionJson: value })
        },
      },
      {
        table: 'checkpoint.resumePayloadJson',
        original: fixture.checkpoint.resumePayloadJson!,
        mutate: async (value: string) => {
          await db.agentRunCheckpoints.update(fixture.checkpoint.id, { resumePayloadJson: value })
        },
      },
    ]
    for (const mutation of mutations) {
      const tampered = replaceSameLengthValueCharacter(mutation.original)
      expect(tampered).toHaveLength(mutation.original.length)
      await expectMutationDuringProjectionToInvalidateSnapshot(
        () => mutation.mutate(tampered),
        read,
      )
      await mutation.mutate(mutation.original)
      const restored = await read()
      expect(restored.snapshotHash).toBe(baseline.snapshotHash)
    }
  }, 30_000)

  it('Blob 元数据不变但 IndexedDB 物理字节损坏时不再标记媒资可信', async () => {
    const fixture = await seedGovernanceMediaReadFixture()
    await db.mediaBlobObjects.update(fixture.blobObjectId, {
      data: fixture.tamperedData,
    })

    const projection = await readTextOpenWorldArtifactGovernanceV1({
      scope: fixture.scope,
      productionId: fixture.productionId,
    })
    const media = projection.artifacts.find(
      item => item.artifactKey === 'text-open-world.media.visual.001',
    )
    expect(media?.health).toBe('corrupt')
    expect(media?.productionValidation).toBe('not-applicable')
    expect(media?.diagnostics.map(item => item.code)).toContain('artifact.media-blob-bytes')
  })

  it('投影形成后只替换 Blob 物理字节也会使尾部快照校验失败', async () => {
    const fixture = await seedGovernanceMediaReadFixture()
    await expectMutationDuringProjectionToInvalidateSnapshot(
      async () => {
        await db.mediaBlobObjects.update(fixture.blobObjectId, {
          data: fixture.tamperedData,
        })
      },
      () => readTextOpenWorldArtifactGovernanceV1({
        scope: fixture.scope,
        productionId: fixture.productionId,
      }),
    )
  })
})
