import { describe, expect, it } from 'vitest'
import {
  projectTextOpenWorldArtifactGovernanceV1,
  type TextOpenWorldArtifactBuildEvidenceV1,
  type TextOpenWorldArtifactRunEvidenceV1,
} from '../../src/lib/open-world/creator-artifact-governance'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import {
  hashProductProductionCarriedCandidateV1,
  hashProductProductionCarriedReceiptV1,
  hashProductProductionParentArtifactProofV1,
  hashProductProductionPortableRootSealV1,
  hashProductProductionSealedParentArtifactProofV1,
  hashProductProductionTaskCandidateV1,
  hashProductProductionTaskReceiptV1,
  parseProductProductionPortableTaskLedgerV1,
} from '../../src/lib/product-production/task-evidence'
import { createLegacyProductBuildRootTerminalReceiptV1 } from '../../src/lib/product-production/receipts'
import type {
  ProductBuildArtifactKindV1,
  ProductBuildArtifactRecordV1,
  ProductBuildRecordV1,
  ProductProductionPlanTaskV3,
  ProductProductionPlanV3,
  ProductProductionRecordV1,
  WorkspaceScope,
} from '../../src/lib/types'
import type {
  ProductProductionTaskArtifactV1,
  ProductProductionTaskExecutionResultV1,
} from '../../src/lib/product-production/scheduler'
import { countWords } from '../../src/lib/utils/html'
import { createTextOpenWorldProductionPlanV1 } from '../../src/lib/open-world/production-contract'
import {
  inspectTextOpenWorldProductionPlanAuthorityV1,
  type TextOpenWorldProductionPlanAuthorityV1,
} from '../../src/lib/open-world/production-authority'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import {
  CURRENT_PRODUCT_RESOURCE_KEYS,
  currentProductSelection,
} from '../helpers/current-product-world'

const SCOPE: WorkspaceScope = { projectId: 1, worldId: 2, workId: 3 }
const PRODUCTION_KEY = 'tow.creator.governance'
const BUILD_ID = 11
const BUILD_NUMBER = 4
const CONTROL_EPOCH = 7
const ROOT_RUN_ID = 100
const BRIEF_HASH = 'b'.repeat(64)

function officialBrief() {
  return parseProductProductionBriefV3({
    schema: 'storyforge.product-production-brief',
    version: 3,
    source: {
      worldReleaseId: 1,
      worldContentHash: 'c'.repeat(64),
      selection: currentProductSelection('text-open-world', {
        characters: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
        regions: [CURRENT_PRODUCT_RESOURCE_KEYS.location],
        items: [CURRENT_PRODUCT_RESOURCE_KEYS.artifact],
        factions: [CURRENT_PRODUCT_RESOURCE_KEYS.lore],
        quests: [CURRENT_PRODUCT_RESOURCE_KEYS.arc],
      }),
      startingPoint: {
        kind: 'mainline', title: '盐脊断流', summary: '调查盐渠断流。',
        sourceRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.story],
        protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
        openingConflict: '盐港与断脊争夺最后的供水。',
      },
    },
    intent: {
      productType: 'text-open-world', playerRole: '来客',
      protagonistRefs: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
      openingSituation: '从盐港开始调查断流。',
      coreExperience: ['调查', '成长', '抉择'], requiredFacts: [], forbiddenChanges: [],
      contentBoundaries: [], tone: ['克制', '冒险'],
    },
    scale: { scope: 'campaign', targetPlayMinutes: 360, targetWordCount: 80_000, targetEndingCount: 2 },
    media: {
      visualLevel: 'none', audioLevel: 'none', imageCount: 0, musicTrackCount: 0,
      sfxCount: 0, voiceLineCount: 0, requiredMediaKinds: [],
    },
    consultationBudget: {
      maximumModelCalls: 3, maximumInputTokens: 30_000,
      maximumOutputTokens: 8_000, maximumCostUsd: null,
    },
    productionBudget: {
      maximumModelCalls: 200, maximumInputTokens: 320_000, maximumOutputTokens: 128_000,
      maximumCostUsd: 80, maximumMediaCalls: 0, maximumDurationMs: 7_200_000,
      maximumStorageBytes: 200_000_000,
    },
    qualityProfile: 'commercial-candidate',
    capabilityRequirements: [],
    externalDataPolicy: {
      allowedDataClasses: ['world-selection'], forbiddenDataClasses: ['api-key'],
      allowReferenceImages: false, allowVoiceScripts: false,
    },
    fallbackPolicy: {
      allowTextOnly: true, allowExistingProjectMedia: true,
      allowProceduralAudio: true, onRequiredCapabilityMissing: 'pause',
    },
    completionContract: {
      requiresPlayablePreview: true,
      requiredGateIds: ['runtime.package.valid', 'runtime.playable', 'rights.complete'],
      minimumMediaCoverage: 0, allowSoftWaivers: false,
    },
    unresolvedDecisionKeys: [],
  })
}

interface ArtifactSpec {
  artifactKey: string
  kind: ProductBuildArtifactKindV1
  payload: Record<string, unknown>
  metadata?: Record<string, unknown>
  quality?: Record<string, unknown>
  rights?: Record<string, unknown>
}

interface TaskSpec {
  taskKey: string
  artifacts: ArtifactSpec[]
}

interface ProjectionFixture {
  scope: WorkspaceScope
  production: ProductProductionRecordV1 & { id: number }
  build: ProductBuildRecordV1 & { id: number }
  plan: ProductProductionPlanV3
  artifactRows: ProductBuildArtifactRecordV1[]
  lineageArtifactRows: ProductBuildArtifactRecordV1[]
  buildEvidenceById: Map<number, TextOpenWorldArtifactBuildEvidenceV1>
  runEvidenceById: Map<number, TextOpenWorldArtifactRunEvidenceV1>
  productionAuthority?: TextOpenWorldProductionPlanAuthorityV1
}

function task(taskKey: string, artifacts: ArtifactSpec[]): ProductProductionPlanTaskV3 {
  return {
    taskKey,
    lane: 'content',
    kind: `fixture.${taskKey}`,
    skillId: null,
    executionMode: 'deterministic',
    dependsOn: [],
    requiredReceipts: [],
    inputArtifactKeys: [],
    outputArtifactKeys: artifacts.map(item => item.artifactKey),
    requirementKeys: [],
    capabilityRequirementKeys: [],
    concurrencyGroup: 'fixture',
    subjectLockKeys: artifacts.map(item => item.artifactKey),
    priority: 1,
    budgetReservation: {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      mediaCalls: 0,
      maximumCostUsd: 0,
      durationMs: 1_000,
      storageBytes: 1_000_000,
    },
    maxAttempts: 1,
    timeoutMs: 1_000,
    failurePolicy: 'fail-build',
    fallbackTaskKey: null,
    acceptanceGateIds: [`gate.${taskKey}`],
    reuse: null,
  }
}

async function governedPayload(
  kind: string,
  ownHashField: string,
  content: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const collectionDefaults: Record<string, Record<string, unknown>> = {
    'text-open-world.story-arc': { macroBeats: [] },
    'text-open-world.region-skeleton': {
      regions: [], locations: [], edges: [], fastTravelPoints: [],
    },
    'text-open-world.map-interaction-catalog': {
      regions: [], locations: [], interactions: [],
    },
  }
  const body = {
    schema: `storyforge.${kind.replace(/\./g, '-')}`,
    version: 1,
    productType: 'text-open-world',
    productInstanceKey: PRODUCTION_KEY,
    createdAt: 1,
    ...(collectionDefaults[kind] ?? {}),
    ...content,
  }
  return { ...body, [ownHashField]: await hashProductProductionValueV2(body) }
}

function candidateArtifact(spec: ArtifactSpec): ProductProductionTaskArtifactV1 {
  return {
    artifactKey: spec.artifactKey,
    kind: spec.kind,
    payload: structuredClone(spec.payload),
    metadata: structuredClone(spec.metadata ?? {}),
    quality: structuredClone(spec.quality ?? {}),
    rights: structuredClone(spec.rights ?? {}),
  }
}

async function makeFixture(
  taskSpecs: TaskSpec[],
  options: { officialAuthority?: boolean } = {},
): Promise<ProjectionFixture> {
  const fixtureTasks = taskSpecs.map(item => task(item.taskKey, item.artifacts))
  const plan: ProductProductionPlanV3 = options.officialAuthority
    ? await (async () => {
        const parsedBrief = officialBrief()
        return createTextOpenWorldProductionPlanV1({
          buildNumber: BUILD_NUMBER,
          controlEpoch: CONTROL_EPOCH,
          briefHash: await hashProductProductionValueV2(parsedBrief),
          brief: parsedBrief,
        })
      })()
    : {
        schema: 'storyforge.product-production-plan',
        version: 3,
        buildNumber: BUILD_NUMBER,
        productType: 'text-open-world',
        briefHash: BRIEF_HASH,
        controlEpoch: CONTROL_EPOCH,
        concurrency: {
          maximumCostBearingTasks: 1,
          maximumTextProviderTasks: 1,
          maximumMediaProviderTasks: 1,
        },
        tasks: fixtureTasks,
        terminalTaskKey: fixtureTasks.at(-1)!.taskKey,
      }
  const planHash = await hashProductProductionValueV2(plan)
  const structuralAuthority = inspectTextOpenWorldProductionPlanAuthorityV1(plan)
  const productionAuthority = options.officialAuthority
    ? {
        ...structuralAuthority,
        origin: 'creator-start-v1' as const,
        authorityReceiptHash: await hashProductProductionValueV2({
          schema: 'fixture.text-open-world-production-plan-authority',
          planHash,
        }),
      }
    : undefined
  const production: ProductProductionRecordV1 & { id: number } = {
    id: 5,
    ...SCOPE,
    productionKey: PRODUCTION_KEY,
    productType: 'text-open-world',
    title: 'Creator artifact governance fixture',
    status: 'producing',
    stateRevision: 9,
    controlEpoch: CONTROL_EPOCH,
    currentBriefRevision: 2,
    currentBuildNumber: BUILD_NUMBER,
    currentProductReleaseId: null,
    lastErrorJson: '{}',
    createdAt: 1,
    updatedAt: 2,
  }
  const build: ProductBuildRecordV1 & { id: number } = {
    id: BUILD_ID,
    ...SCOPE,
    productionId: production.id,
    buildNumber: BUILD_NUMBER,
    briefRevision: 2,
    briefHash: plan.briefHash,
    parentBuildNumber: null,
    sourceProductReleaseId: null,
    status: 'producing',
    resumeState: null,
    stateRevision: 3,
    controlEpoch: CONTROL_EPOCH,
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
    updatedAt: 2,
  }
  const runEvidenceById = new Map<number, TextOpenWorldArtifactRunEvidenceV1>()
  runEvidenceById.set(ROOT_RUN_ID, {
    runId: ROOT_RUN_ID,
    state: 'completed',
    projectId: SCOPE.projectId,
    workId: SCOPE.workId,
    productBuildId: BUILD_ID,
    parentRunId: null,
    parentRelation: null,
    terminalReceiptHash: null,
    boundary: {
      productBuildId: BUILD_ID,
      buildNumber: BUILD_NUMBER,
      controlEpoch: CONTROL_EPOCH,
      planHash,
      taskKey: '$root',
    },
    taskStep: null,
    candidate: null,
    error: null,
  })

  const artifactRows: ProductBuildArtifactRecordV1[] = []
  const taskLedger: TextOpenWorldArtifactBuildEvidenceV1['taskLedger'] = {}
  let rowId = 1
  for (const [taskIndex, taskSpec] of taskSpecs.entries()) {
    const planTask = options.officialAuthority
      ? plan.tasks.find(item => item.taskKey === taskSpec.taskKey)
      : fixtureTasks[taskIndex]
    if (!planTask) throw new Error(`fixture task 不存在:${taskSpec.taskKey}`)
    const runId = ROOT_RUN_ID + taskIndex + 1
    const inputHash = await hashProductProductionValueV2({
      taskKey: taskSpec.taskKey,
      controlEpoch: CONTROL_EPOCH,
      inputs: [],
    })
    const result: ProductProductionTaskExecutionResultV1 = {
      artifacts: taskSpec.artifacts.map(candidateArtifact),
      passedGateIds: [...planTask.acceptanceGateIds],
      usage: {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        mediaCalls: 0,
        costUsd: 0,
        durationMs: 1,
        storageBytes: 0,
      },
    }
    const candidateHash = await hashProductProductionTaskCandidateV1(result)
    const receiptHash = await hashProductProductionTaskReceiptV1({
      taskKey: taskSpec.taskKey,
      attempt: 1,
      inputHash,
      candidateHash,
      passedGateIds: result.passedGateIds,
      usage: result.usage,
      controlEpoch: CONTROL_EPOCH,
    })
    for (const spec of taskSpec.artifacts) {
      const payloadJson = canonicalProductProductionJsonV2(spec.payload)
      artifactRows.push({
        id: rowId++,
        ...SCOPE,
        buildId: BUILD_ID,
        artifactKey: spec.artifactKey,
        requirementKey: null,
        version: 1,
        kind: spec.kind,
        mediaKind: null,
        status: 'accepted',
        producerRunId: runId,
        producerReceiptHash: receiptHash,
        controlEpoch: CONTROL_EPOCH,
        inputHash,
        contentHash: await hashProductProductionValueV2(spec.payload),
        payloadJson,
        metadataJson: canonicalProductProductionJsonV2(spec.metadata ?? {}),
        qualityJson: canonicalProductProductionJsonV2(spec.quality ?? {}),
        rightsJson: canonicalProductProductionJsonV2(spec.rights ?? {}),
        blobObjectId: null,
        mimeType: null,
        byteSize: new TextEncoder().encode(payloadJson).byteLength,
        parentArtifactHash: null,
        carriedFrom: null,
        createdAt: 1,
        updatedAt: 2,
      })
    }
    runEvidenceById.set(runId, {
      runId,
      state: 'completed',
      projectId: SCOPE.projectId,
      workId: SCOPE.workId,
      productBuildId: BUILD_ID,
      parentRunId: ROOT_RUN_ID,
      parentRelation: `task:${taskSpec.taskKey}`,
      terminalReceiptHash: receiptHash,
      boundary: {
        productBuildId: BUILD_ID,
        buildNumber: BUILD_NUMBER,
        controlEpoch: CONTROL_EPOCH,
        planHash,
        taskKey: taskSpec.taskKey,
      },
      taskStep: {
        currentAttempt: 1,
        candidateHash,
        outputHash: candidateHash,
      },
      candidate: {
        checkpointHash: await hashProductProductionValueV2({
          schema: 'storyforge.agent-run-checkpoint',
          taskKey: taskSpec.taskKey,
          candidateHash,
        }),
        taskKey: taskSpec.taskKey,
        attempt: 1,
        controlEpoch: CONTROL_EPOCH,
        inputHash,
        candidateHash,
        result,
      },
      error: null,
    })
    taskLedger[taskSpec.taskKey] = {
      runId,
      status: 'settled',
      idempotencyKey: inputHash,
      candidateHash,
      terminalReceiptHash: receiptHash,
    }
  }
  const buildEvidenceById = new Map<number, TextOpenWorldArtifactBuildEvidenceV1>([[BUILD_ID, {
    build,
    plan,
    rootRunId: ROOT_RUN_ID,
    taskLedger,
  }]])
  return {
    scope: SCOPE,
    production,
    build,
    plan,
    artifactRows,
    lineageArtifactRows: artifactRows,
    buildEvidenceById,
    runEvidenceById,
    productionAuthority,
  }
}

function project(fixture: ProjectionFixture) {
  return projectTextOpenWorldArtifactGovernanceV1(fixture)
}

function diagnosticCodes(
  projection: Awaited<ReturnType<typeof projectTextOpenWorldArtifactGovernanceV1>>,
  artifactKey: string,
) {
  return projection.artifacts
    .filter(item => item.artifactKey === artifactKey)
    .flatMap(item => item.diagnostics.map(diagnostic => diagnostic.code))
}

describe('R-OPEN-WORLD5 · Creator domain artifact governance projection', () => {
  it('共享 parent proof 只绑定声明的稳定字段，不绑定整行状态与时间戳', async () => {
    const payload = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [{ key: 'region.parent-proof', title: '父证明地区', locationKeys: [] }] },
    )
    const fixture = await makeFixture([{
      taskKey: 'region.parent-proof',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload,
      }],
    }])
    const artifact = fixture.artifactRows[0]
    const producerEvidence = fixture.runEvidenceById.get(artifact.producerRunId!)!
    const rootEvidence = fixture.runEvidenceById.get(producerEvidence.parentRunId!)!
    const witness = (evidence: TextOpenWorldArtifactRunEvidenceV1) => ({
      parentRelation: evidence.parentRelation,
      status: evidence.state,
      terminalReceiptHash: evidence.terminalReceiptHash,
      boundary: {
        buildNumber: evidence.boundary!.buildNumber,
        controlEpoch: evidence.boundary!.controlEpoch,
        planHash: evidence.boundary!.planHash,
        taskKey: evidence.boundary!.taskKey,
      },
    })
    const baseHash = await hashProductProductionParentArtifactProofV1({
      artifact,
      producer: witness(producerEvidence),
      root: witness(rootEvidence),
    })
    const mutableRowOnly = {
      ...structuredClone(artifact),
      status: 'invalid' as const,
      updatedAt: artifact.updatedAt + 10_000,
    }
    const stableHash = await hashProductProductionParentArtifactProofV1({
      artifact: mutableRowOnly,
      producer: witness(producerEvidence),
      root: witness(rootEvidence),
    })
    const changedContractHash = await hashProductProductionParentArtifactProofV1({
      artifact: { ...mutableRowOnly, inputHash: 'd'.repeat(64) },
      producer: witness(producerEvidence),
      root: witness(rootEvidence),
    })

    expect(stableHash).toBe(baseHash)
    expect(changedContractHash).not.toBe(baseHash)
  })

  it('纯投影只确认 candidate/checkpoint/receipt 完整性，不把内存伪权威提升为生产实体', async () => {
    const currentPayload = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [{ key: 'region.current', title: '当前地区', locationKeys: [] }] },
    )
    const fixture = await makeFixture([{
      taskKey: 'p4.region-skeleton',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload: currentPayload,
      }],
    }], { officialAuthority: true })
    const historicalPayload = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [{ key: 'region.historical', title: '旧地区', locationKeys: [] }] },
    )
    const historical = structuredClone(fixture.artifactRows[0])
    historical.id = 99
    historical.version = 2
    historical.controlEpoch = CONTROL_EPOCH - 1
    historical.payloadJson = canonicalProductProductionJsonV2(historicalPayload)
    historical.contentHash = await hashProductProductionValueV2(historicalPayload)
    historical.byteSize = new TextEncoder().encode(historical.payloadJson).byteLength
    fixture.artifactRows.push(historical)

    const projection = await project(fixture)
    const current = projection.artifacts.find(item => item.currentEpoch
      && item.artifactKey === 'text-open-world.region-skeleton'
      && item.version === 1)!
    const old = projection.artifacts.find(item => !item.currentEpoch)!

    expect(current).toMatchObject({
      health: 'verified',
      productionValidation: 'integrity-only',
      producerRunState: 'completed',
      entityIdentities: [],
    })
    expect(current.validationReceiptHash).toBeNull()
    expect(old.health).toBe('stale')
    expect(projection.entities).toEqual([])
    expect(projection.summary).toMatchObject({
      currentVerifiedArtifactCount: 1,
      historicalArtifactCount: 1,
      currentProductionValidatedArtifactCount: 0,
      currentIntegrityOnlyArtifactCount: 1,
      entityCount: 0,
    })
  })

  it('自声明Plan即使证据链可重算也只能标记为完整性通过，不能进入正式内容投影', async () => {
    const payload = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [{ key: 'region.self-declared', title: '伪权威地区', locationKeys: [] }] },
    )
    const fixture = await makeFixture([{
      taskKey: 'fixture.self-declared',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload,
      }],
    }])

    const projection = await project(fixture)
    const artifact = projection.artifacts.find(item => item.artifactKey === 'text-open-world.region-skeleton')!

    expect(artifact).toMatchObject({
      health: 'verified',
      productionValidation: 'integrity-only',
      validatorId: null,
      validationReceiptHash: null,
    })
    expect(diagnosticCodes(projection, artifact.artifactKey))
      .toContain('artifact.production-validation-unavailable')
    expect(projection.entities).toEqual([])
    expect(projection.summary).toMatchObject({
      currentVerifiedArtifactCount: 1,
      currentProductionValidatedArtifactCount: 0,
      currentIntegrityOnlyArtifactCount: 1,
      entityCount: 0,
    })
  })

  it('当前 epoch active duplicate 全部失去权威，且不产生实体', async () => {
    const payload = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [{ key: 'region.duplicate-row', title: '重复行', locationKeys: [] }] },
    )
    const fixture = await makeFixture([{
      taskKey: 'region.duplicate-row',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload,
      }],
    }])
    const duplicate = structuredClone(fixture.artifactRows[0])
    duplicate.id = 2
    duplicate.version = 2
    fixture.artifactRows.push(duplicate)

    const projection = await project(fixture)

    expect(projection.artifacts).toHaveLength(2)
    expect(projection.artifacts.every(item => item.health === 'corrupt')).toBe(true)
    expect(diagnosticCodes(projection, 'text-open-world.region-skeleton'))
      .toContain('artifact.active-duplicate')
    expect(projection.entities).toEqual([])
  })

  it('accepted 不得携带伪 lineage，当前 Build 也不得缺失冻结 rootRunId', async () => {
    const payload = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [{ key: 'region.lineage-shape', title: '谱系地区', locationKeys: [] }] },
    )
    const lineageFixture = await makeFixture([{
      taskKey: 'region.lineage-shape',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload,
      }],
    }])
    lineageFixture.artifactRows[0].parentArtifactHash = lineageFixture.artifactRows[0].contentHash
    lineageFixture.artifactRows[0].carriedFrom = {
      buildNumber: BUILD_NUMBER - 1,
      artifactKey: lineageFixture.artifactRows[0].artifactKey,
      version: 1,
      contentHash: lineageFixture.artifactRows[0].contentHash,
      proofHash: 'e'.repeat(64),
    }
    const rootFixture = await makeFixture([{
      taskKey: 'region.root-missing',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload,
      }],
    }])
    rootFixture.buildEvidenceById.get(BUILD_ID)!.rootRunId = null

    const [lineageProjection, rootProjection] = await Promise.all([
      project(lineageFixture),
      project(rootFixture),
    ])

    expect(diagnosticCodes(lineageProjection, 'text-open-world.region-skeleton'))
      .toContain('artifact.lineage-shape')
    expect(diagnosticCodes(rootProjection, 'text-open-world.region-skeleton'))
      .toContain('artifact.run-provenance')
    expect(lineageProjection.entities).toEqual([])
    expect(rootProjection.entities).toEqual([])
  })

  it('当前已完成 Build 的 legacy v1 root receipt 只能诊断兼容，不能保留治理权威', async () => {
    const regionPayload = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [{ key: 'region.current-v1-root', title: '旧根证明地区', locationKeys: [] }] },
    )
    const runtimePayload = {
      schema: 'storyforge.product-runtime-package',
      version: 1,
      productType: 'text-open-world',
      fixture: 'legacy-root-version-gate',
    }
    const packageHash = await hashProductProductionValueV2(runtimePayload)
    const qualityPayload = {
      schema: 'storyforge.product-build-quality-report',
      version: 1,
      buildNumber: BUILD_NUMBER,
      packageHash,
      hardGateResults: [],
      softGateResults: [],
      mediaCoverage: 1,
      playable: true,
      releaseReady: true,
      warnings: [],
    }
    const fixture = await makeFixture([{
      taskKey: 'legacy.current-root',
      artifacts: [
        {
          artifactKey: 'text-open-world.region-skeleton',
          kind: 'text-open-world.region-skeleton',
          payload: regionPayload,
        },
        {
          artifactKey: 'text-open-world.runtime-package',
          kind: 'text-open-world.runtime-package',
          payload: runtimePayload,
        },
        {
          artifactKey: 'text-open-world.quality-report',
          kind: 'text-open-world.quality-report',
          payload: qualityPayload,
        },
      ],
    }])
    const task = fixture.plan.tasks[0]
    const ledger = fixture.buildEvidenceById.get(BUILD_ID)!.taskLedger[task.taskKey]
    fixture.build.budgetLedgerJson = canonicalProductProductionJsonV2({
      schema: 'storyforge.product-production-budget-ledger',
      version: 2,
      rootRunId: ROOT_RUN_ID,
      rootClaim: null,
      charges: {},
      reservations: {},
      tasks: {
        [task.taskKey]: {
          runId: ledger.runId,
          attempt: 1,
          status: 'settled',
          idempotencyKey: ledger.idempotencyKey,
          candidateHash: ledger.candidateHash,
          terminalReceiptHash: ledger.terminalReceiptHash,
          passedGateIds: [...task.acceptanceGateIds],
          usage: {
            modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0,
            costUsd: 0, durationMs: 1, storageBytes: 0,
          },
          errorCode: null,
        },
      },
    })
    const qualityReportHash = await hashProductProductionValueV2(qualityPayload)
    const orderedRows = [...fixture.artifactRows]
      .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
    const manifest = {
      schema: 'storyforge.product-build-manifest',
      version: 1,
      productionKey: fixture.production.productionKey,
      buildNumber: BUILD_NUMBER,
      briefRevision: fixture.build.briefRevision,
      briefHash: fixture.build.briefHash,
      planHash: fixture.build.planHash,
      controlEpoch: CONTROL_EPOCH,
      runtimePackageHash: packageHash,
      artifactReceipts: orderedRows.map(row => ({
        artifactKey: row.artifactKey,
        version: row.version,
        contentHash: row.contentHash,
        producerReceiptHash: row.producerReceiptHash,
      })),
      completedGateIds: [...task.acceptanceGateIds],
      fallbackSummary: [],
    }
    fixture.build.manifestJson = canonicalProductProductionJsonV2(manifest)
    fixture.build.manifestHash = await hashProductProductionValueV2(manifest)
    fixture.build.packageHash = packageHash
    fixture.build.qualityReportJson = canonicalProductProductionJsonV2(qualityPayload)
    fixture.build.qualityReportHash = qualityReportHash
    fixture.build.status = 'release-ready'
    fixture.build.completedAt = 3
    fixture.build.rootTerminalReceiptHash = await createLegacyProductBuildRootTerminalReceiptV1({
      planHash: fixture.build.planHash,
      manifestHash: fixture.build.manifestHash,
      packageHash,
      qualityReportHash,
      controlEpoch: CONTROL_EPOCH,
      budgetLedgerJson: fixture.build.budgetLedgerJson,
      artifacts: orderedRows,
    })
    const rootEvidence = fixture.runEvidenceById.get(ROOT_RUN_ID)!
    rootEvidence.terminalReceiptHash = fixture.build.rootTerminalReceiptHash

    const projection = await project(fixture)
    expect(projection.artifacts.every(item => item.health === 'corrupt')).toBe(true)
    for (const artifact of projection.artifacts) {
      expect(artifact.productionValidation).toBe('not-applicable')
      expect(artifact.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'build.root-proof',
          message: expect.stringMatching(/不是当前 v2 完整封存证明/),
        }),
      ]))
    }
  })

  it('合法的同 Build carry 可通过共享父证明并追溯到 accepted candidate 叶', async () => {
    const payload = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [{ key: 'region.same-build', title: '同 Build 沿用地区', locationKeys: [] }] },
    )
    const fixture = await makeFixture([{
      taskKey: 'region.same-build',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload,
      }],
    }])
    const targetTask = fixture.plan.tasks[0]
    targetTask.executionMode = 'model'
    const currentPlanHash = await hashProductProductionValueV2(fixture.plan)
    fixture.build.planJson = canonicalProductProductionJsonV2(fixture.plan)
    fixture.build.planHash = currentPlanHash
    fixture.runEvidenceById.get(ROOT_RUN_ID)!.boundary!.planHash = currentPlanHash

    const parentEpoch = CONTROL_EPOCH - 1
    const parentPlanHash = await hashProductProductionValueV2({
      ...structuredClone(fixture.plan),
      controlEpoch: parentEpoch,
    })
    const parent = structuredClone(fixture.artifactRows[0])
    parent.id = 90
    parent.version = 1
    parent.controlEpoch = parentEpoch
    parent.status = 'invalid'
    parent.updatedAt = 3

    const parentRun = fixture.runEvidenceById.get(parent.producerRunId!)!
    const parentInputHash = await hashProductProductionValueV2({
      taskKey: targetTask.taskKey,
      controlEpoch: parentEpoch,
      inputs: [],
    })
    parent.inputHash = parentInputHash
    parentRun.parentRunId = 90
    parentRun.boundary!.controlEpoch = parentEpoch
    parentRun.boundary!.planHash = parentPlanHash
    parentRun.candidate!.controlEpoch = parentEpoch
    parentRun.candidate!.inputHash = parentInputHash
    const parentReceiptHash = await hashProductProductionTaskReceiptV1({
      taskKey: parentRun.candidate!.taskKey,
      attempt: parentRun.candidate!.attempt,
      inputHash: parentRun.candidate!.inputHash,
      candidateHash: parentRun.candidate!.candidateHash,
      passedGateIds: parentRun.candidate!.result.passedGateIds,
      usage: parentRun.candidate!.result.usage,
      controlEpoch: parentEpoch,
    })
    parent.producerReceiptHash = parentReceiptHash
    parentRun.terminalReceiptHash = parentReceiptHash
    fixture.runEvidenceById.set(90, {
      runId: 90,
      state: 'completed',
      projectId: SCOPE.projectId,
      workId: SCOPE.workId,
      productBuildId: BUILD_ID,
      parentRunId: null,
      parentRelation: null,
      terminalReceiptHash: null,
      boundary: {
        productBuildId: BUILD_ID,
        buildNumber: BUILD_NUMBER,
        controlEpoch: parentEpoch,
        planHash: parentPlanHash,
        taskKey: '$root',
      },
      taskStep: null,
      candidate: null,
      error: null,
    })
    const witness = (evidence: TextOpenWorldArtifactRunEvidenceV1) => ({
      parentRelation: evidence.parentRelation,
      status: evidence.state,
      terminalReceiptHash: evidence.terminalReceiptHash,
      boundary: {
        buildNumber: evidence.boundary!.buildNumber,
        controlEpoch: evidence.boundary!.controlEpoch,
        planHash: evidence.boundary!.planHash,
        taskKey: evidence.boundary!.taskKey,
      },
    })
    const parentProofHash = await hashProductProductionParentArtifactProofV1({
      artifact: parent,
      producer: witness(parentRun),
      root: witness(fixture.runEvidenceById.get(90)!),
    })

    const target = fixture.artifactRows[0]
    target.version = 2
    target.status = 'carried-forward'
    target.producerRunId = 102
    target.parentArtifactHash = target.contentHash
    target.carriedFrom = {
      buildNumber: BUILD_NUMBER,
      artifactKey: parent.artifactKey,
      version: parent.version,
      contentHash: parent.contentHash,
      proofHash: parentProofHash,
    }
    const carriedCandidateHash = await hashProductProductionCarriedCandidateV1([target])
    const carriedReceiptHash = await hashProductProductionCarriedReceiptV1({
      taskKey: targetTask.taskKey,
      inputHash: target.inputHash,
      candidateHash: carriedCandidateHash,
      dependencies: [],
      passedGateIds: targetTask.acceptanceGateIds,
      controlEpoch: CONTROL_EPOCH,
    })
    target.producerReceiptHash = carriedReceiptHash
    fixture.runEvidenceById.set(102, {
      runId: 102,
      state: 'completed',
      projectId: SCOPE.projectId,
      workId: SCOPE.workId,
      productBuildId: BUILD_ID,
      parentRunId: ROOT_RUN_ID,
      parentRelation: `task:${targetTask.taskKey}`,
      terminalReceiptHash: carriedReceiptHash,
      boundary: {
        productBuildId: BUILD_ID,
        buildNumber: BUILD_NUMBER,
        controlEpoch: CONTROL_EPOCH,
        planHash: currentPlanHash,
        taskKey: targetTask.taskKey,
      },
      taskStep: {
        currentAttempt: 1,
        candidateHash: carriedCandidateHash,
        outputHash: carriedCandidateHash,
      },
      candidate: null,
      error: null,
    })
    fixture.buildEvidenceById.get(BUILD_ID)!.taskLedger[targetTask.taskKey] = {
      runId: 102,
      status: 'settled',
      idempotencyKey: target.inputHash,
      candidateHash: carriedCandidateHash,
      terminalReceiptHash: carriedReceiptHash,
    }
    fixture.lineageArtifactRows = [target, parent]

    const projection = await project(fixture)
    const current = projection.artifacts.find(item => item.currentEpoch)!
    expect(current).toMatchObject({
      artifactKey: target.artifactKey,
      version: 2,
      health: 'verified',
      producerReceiptHash: carriedReceiptHash,
    })
    expect(diagnosticCodes(projection, target.artifactKey)).not.toContain('artifact.carried-lineage')
  })

  it('legacy v1 父 Build 即使能计算公开 portable proof，也不能授权跨 Build carried 内容', async () => {
    const payload = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [{ key: 'region.legacy-parent', title: '旧封存地区', locationKeys: [] }] },
    )
    const fixture = await makeFixture([{
      taskKey: 'region.legacy-parent',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload,
      }],
    }])
    const targetTask = fixture.plan.tasks[0]
    const parentBuildNumber = BUILD_NUMBER - 1
    const parentControlEpoch = CONTROL_EPOCH - 1
    const parentBuildId = BUILD_ID - 1
    const parentPlan: ProductProductionPlanV3 = {
      ...structuredClone(fixture.plan),
      buildNumber: parentBuildNumber,
      controlEpoch: parentControlEpoch,
    }
    const parentPlanHash = await hashProductProductionValueV2(parentPlan)
    const parentInputHash = await hashProductProductionValueV2({
      fixture: 'legacy-parent.input',
      parentPlanHash,
    })
    const parentCandidateHash = await hashProductProductionValueV2({
      fixture: 'legacy-parent.candidate',
      parentPlanHash,
    })
    const parentReceiptHash = await hashProductProductionValueV2({
      fixture: 'legacy-parent.receipt',
      parentPlanHash,
    })
    const zeroUsage = {
      modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0,
      costUsd: 0, durationMs: 1, storageBytes: 0,
    }
    const parentBudgetLedgerJson = canonicalProductProductionJsonV2({
      schema: 'storyforge.product-production-budget-ledger',
      version: 2,
      rootRunId: 90,
      rootClaim: null,
      charges: {},
      reservations: {},
      tasks: {
        [targetTask.taskKey]: {
          runId: 91,
          attempt: 1,
          status: 'settled',
          idempotencyKey: parentInputHash,
          candidateHash: parentCandidateHash,
          terminalReceiptHash: parentReceiptHash,
          passedGateIds: [...targetTask.acceptanceGateIds],
          usage: zeroUsage,
          errorCode: null,
        },
      },
    })
    const parentArtifact: ProductBuildArtifactRecordV1 = {
      ...structuredClone(fixture.artifactRows[0]),
      id: 90,
      buildId: parentBuildId,
      controlEpoch: parentControlEpoch,
      inputHash: parentInputHash,
      producerReceiptHash: parentReceiptHash,
      producerRunId: 91,
      status: 'accepted',
      parentArtifactHash: null,
      carriedFrom: null,
    }
    const packageHash = 'a'.repeat(64)
    const quality = {
      schema: 'storyforge.product-build-quality-report',
      version: 1,
      buildNumber: parentBuildNumber,
      packageHash,
      hardGateResults: [],
      softGateResults: [],
      mediaCoverage: 1,
      playable: true,
      releaseReady: true,
      warnings: [],
    }
    const qualityReportJson = canonicalProductProductionJsonV2(quality)
    const qualityReportHash = await hashProductProductionValueV2(quality)
    const manifest = {
      schema: 'storyforge.product-build-manifest',
      version: 1,
      productionKey: fixture.production.productionKey,
      buildNumber: parentBuildNumber,
      briefRevision: fixture.build.briefRevision,
      briefHash: parentPlan.briefHash,
      planHash: parentPlanHash,
      controlEpoch: parentControlEpoch,
      runtimePackageHash: packageHash,
      artifactReceipts: [{
        artifactKey: parentArtifact.artifactKey,
        version: parentArtifact.version,
        contentHash: parentArtifact.contentHash,
        producerReceiptHash: parentArtifact.producerReceiptHash,
      }],
      completedGateIds: [...targetTask.acceptanceGateIds],
      fallbackSummary: [],
    }
    const manifestJson = canonicalProductProductionJsonV2(manifest)
    const manifestHash = await hashProductProductionValueV2(manifest)
    const legacyRootReceiptHash = await createLegacyProductBuildRootTerminalReceiptV1({
      planHash: parentPlanHash,
      manifestHash,
      packageHash,
      qualityReportHash,
      controlEpoch: parentControlEpoch,
      budgetLedgerJson: parentBudgetLedgerJson,
      artifacts: [parentArtifact],
    })
    const parentBuild: ProductBuildRecordV1 & { id: number } = {
      ...structuredClone(fixture.build),
      id: parentBuildId,
      buildNumber: parentBuildNumber,
      parentBuildNumber: null,
      status: 'release-ready',
      controlEpoch: parentControlEpoch,
      planJson: canonicalProductProductionJsonV2(parentPlan),
      planHash: parentPlanHash,
      budgetLedgerJson: parentBudgetLedgerJson,
      manifestJson,
      manifestHash,
      packageHash,
      qualityReportJson,
      qualityReportHash,
      rootTerminalReceiptHash: legacyRootReceiptHash,
      completedAt: 2,
    }
    const portableTaskLedger = parseProductProductionPortableTaskLedgerV1({
      budgetLedgerJson: parentBudgetLedgerJson,
      plan: parentPlan,
    })
    const portableRootSealHash = await hashProductProductionPortableRootSealV1({
      planHash: parentPlanHash,
      manifestHash,
      packageHash,
      qualityReportHash,
      rootTerminalReceiptHash: legacyRootReceiptHash,
      controlEpoch: parentControlEpoch,
      portableTaskLedger,
    })
    const proofHash = await hashProductProductionSealedParentArtifactProofV1({
      productionKey: fixture.production.productionKey,
      productType: fixture.production.productType,
      build: parentBuild,
      portableTaskLedger,
      portableRootSealHash,
      ownerTask: parentPlan.tasks[0],
      manifestMember: manifest.artifactReceipts[0],
      artifact: parentArtifact,
      blobContentHash: null,
    })
    const targetArtifact = fixture.artifactRows[0]
    targetArtifact.status = 'carried-forward'
    targetArtifact.parentArtifactHash = targetArtifact.contentHash
    targetArtifact.carriedFrom = {
      buildNumber: parentBuildNumber,
      artifactKey: parentArtifact.artifactKey,
      version: parentArtifact.version,
      contentHash: parentArtifact.contentHash,
      proofHash,
    }
    const carriedCandidateHash = await hashProductProductionCarriedCandidateV1([targetArtifact])
    const carriedReceiptHash = await hashProductProductionCarriedReceiptV1({
      taskKey: targetTask.taskKey,
      inputHash: targetArtifact.inputHash,
      candidateHash: carriedCandidateHash,
      dependencies: [],
      passedGateIds: targetTask.acceptanceGateIds,
      controlEpoch: CONTROL_EPOCH,
    })
    targetArtifact.producerReceiptHash = carriedReceiptHash
    const targetEvidence = fixture.runEvidenceById.get(targetArtifact.producerRunId!)!
    targetEvidence.terminalReceiptHash = carriedReceiptHash
    targetEvidence.taskStep = {
      currentAttempt: 1,
      candidateHash: carriedCandidateHash,
      outputHash: carriedCandidateHash,
    }
    targetEvidence.candidate = null
    const targetBuildEvidence = fixture.buildEvidenceById.get(BUILD_ID)!
    targetBuildEvidence.taskLedger[targetTask.taskKey] = {
      runId: targetArtifact.producerRunId!,
      status: 'settled',
      idempotencyKey: targetArtifact.inputHash,
      candidateHash: carriedCandidateHash,
      terminalReceiptHash: carriedReceiptHash,
    }
    fixture.build.parentBuildNumber = parentBuildNumber
    fixture.buildEvidenceById.set(parentBuildId, {
      build: parentBuild,
      plan: parentPlan,
      rootRunId: 90,
      taskLedger: {
        [targetTask.taskKey]: {
          runId: 91,
          status: 'settled',
          idempotencyKey: parentInputHash,
          candidateHash: parentCandidateHash,
          terminalReceiptHash: parentReceiptHash,
        },
      },
    })
    fixture.lineageArtifactRows = [targetArtifact, parentArtifact]

    const projection = await project(fixture)
    const target = projection.artifacts.find(item => item.currentEpoch)!
    expect(target.health).toBe('corrupt')
    expect(target.productionValidation).toBe('not-applicable')
    expect(target.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'artifact.proof-error',
        message: expect.stringMatching(/不是 v2 完整 Artifact 封存证明/),
      }),
    ]))
    expect(projection.entities).toEqual([])
  })

  it('损坏 checkpoint 只使 task 证明失败，不得让整个 Creator reader 抛错', async () => {
    const payload = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [{ key: 'region.bad-checkpoint', title: '损坏检查点', locationKeys: [] }] },
    )
    const fixture = await makeFixture([{
      taskKey: 'region.bad-checkpoint',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload,
      }],
    }])
    const evidence = fixture.runEvidenceById.get(ROOT_RUN_ID + 1)!
    evidence.candidate!.result.artifacts = [null as never]

    const projection = await project(fixture)

    expect(diagnosticCodes(projection, 'text-open-world.region-skeleton'))
      .toContain('artifact.proof-error')
    expect(projection.entities).toEqual([])
  })

  it('多输出 task 只剩半组时，已有 sibling 也不能进入受治理实体', async () => {
    const region = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [{ key: 'region.half', title: '半组地区', locationKeys: [] }] },
    )
    const map = await governedPayload(
      'text-open-world.map-interaction-catalog',
      'mapInteractionCatalogHash',
      { regions: [{ key: 'region.half', title: '半组地区', locationKeys: [] }] },
    )
    const fixture = await makeFixture([{
      taskKey: 'world.atomic',
      artifacts: [
        { artifactKey: 'text-open-world.region-skeleton', kind: 'text-open-world.region-skeleton', payload: region },
        { artifactKey: 'text-open-world.map-interaction-catalog', kind: 'text-open-world.map-interaction-catalog', payload: map },
      ],
    }])
    fixture.artifactRows = fixture.artifactRows.filter(
      row => row.artifactKey === 'text-open-world.region-skeleton',
    )

    const projection = await project(fixture)

    expect(projection.artifacts[0].health).toBe('corrupt')
    expect(diagnosticCodes(projection, 'text-open-world.region-skeleton'))
      .toContain('artifact.atomic-group-incomplete')
    expect(projection.entities).toEqual([])
  })

  it.each(['metadataJson', 'qualityJson', 'rightsJson'] as const)(
    'checkpoint 候选与 Artifact 的 %s 不一致时拒绝整组',
    async field => {
      const payload = await governedPayload(
        'text-open-world.region-skeleton',
        'regionSkeletonHash',
        { regions: [{ key: `region.${field}`, title: field, locationKeys: [] }] },
      )
      const fixture = await makeFixture([{
        taskKey: `tamper.${field}`,
        artifacts: [{
          artifactKey: 'text-open-world.region-skeleton',
          kind: 'text-open-world.region-skeleton',
          payload,
          metadata: { model: 'verified' },
          quality: { score: 1 },
          rights: { basis: 'author-owned' },
        }],
      }])
      fixture.artifactRows[0][field] = canonicalProductProductionJsonV2({ tampered: true })

      const projection = await project(fixture)

      expect(projection.artifacts[0].health).toBe('corrupt')
      expect(diagnosticCodes(projection, 'text-open-world.region-skeleton'))
        .toContain('artifact.candidate-proof')
      expect(projection.entities).toEqual([])
    },
  )

  it('即使 row/candidate 自洽重签，也拒绝错误 schema 与错误领域 own hash', async () => {
    const wrongSchema = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      {
        schema: 'storyforge.text-open-world-not-region-skeleton',
        regions: [{ key: 'region.wrong-schema', title: '错误 schema', locationKeys: [] }],
      },
    )
    const validBody = {
      schema: 'storyforge.text-open-world-region-skeleton',
      version: 1,
      productType: 'text-open-world',
      productInstanceKey: PRODUCTION_KEY,
      regions: [{ key: 'region.wrong-own-hash', title: '错误 own hash', locationKeys: [] }],
    }
    const wrongOwnHash = { ...validBody, regionSkeletonHash: 'f'.repeat(64) }
    const schemaFixture = await makeFixture([{
      taskKey: 'wrong.schema',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload: wrongSchema,
      }],
    }])
    const hashFixture = await makeFixture([{
      taskKey: 'wrong.own-hash',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload: wrongOwnHash,
      }],
    }])

    const [schemaProjection, hashProjection] = await Promise.all([
      project(schemaFixture),
      project(hashFixture),
    ])

    expect(diagnosticCodes(schemaProjection, 'text-open-world.region-skeleton'))
      .toContain('artifact.schema')
    expect(diagnosticCodes(hashProjection, 'text-open-world.region-skeleton'))
      .toContain('artifact.domain-contract')
    expect(schemaProjection.entities).toEqual([])
    expect(hashProjection.entities).toEqual([])
  })

  it('内容声明的 source claim 不在 verified SourceLedger 时判 dangling', async () => {
    const ledger = await governedPayload(
      'text-open-world.source-ledger',
      'ledgerHash',
      { entries: [{ claimKey: 'claim.known', statement: '已知事实' }] },
    )
    const story = await governedPayload(
      'text-open-world.story-arc',
      'storyArcHash',
      {
        title: '带来源声明的故事',
        sourceClaimKeys: ['claim.missing'],
        macroBeats: [],
      },
    )
    const fixture = await makeFixture([
      {
        taskKey: 'source.ledger',
        artifacts: [{
          artifactKey: 'text-open-world.source-ledger',
          kind: 'text-open-world.source-ledger',
          payload: ledger,
        }],
      },
      {
        taskKey: 'story.claims',
        artifacts: [{
          artifactKey: 'text-open-world.story-arc',
          kind: 'text-open-world.story-arc',
          payload: story,
        }],
      },
    ])

    const projection = await project(fixture)
    const storyView = projection.artifacts.find(item => item.artifactKey === 'text-open-world.story-arc')!

    expect(storyView.health).toBe('dangling')
    expect(storyView.sourceEvidence).toContainEqual({
      kind: 'source-claim',
      key: 'claim.missing',
      field: 'sourceClaimKeys',
    })
    expect(diagnosticCodes(projection, 'text-open-world.story-arc'))
      .toContain('source-claim.dangling')
    expect(projection.entities).toEqual([])
  })

  it('来源证据只截断展示，不得漏验第 501 条 source claim', async () => {
    const knownClaims = Array.from({ length: 500 }, (_, index) => (
      `claim.${String(index).padStart(4, '0')}`
    ))
    const ledger = await governedPayload(
      'text-open-world.source-ledger',
      'ledgerHash',
      { entries: knownClaims.map(claimKey => ({ claimKey, statement: claimKey })) },
    )
    const story = await governedPayload(
      'text-open-world.story-arc',
      'storyArcHash',
      {
        title: '证据截断边界',
        sourceClaimKeys: [...knownClaims, 'claim.zzzz-missing'],
        macroBeats: [],
      },
    )
    const fixture = await makeFixture([
      {
        taskKey: 'source.ledger.large',
        artifacts: [{
          artifactKey: 'text-open-world.source-ledger',
          kind: 'text-open-world.source-ledger',
          payload: ledger,
        }],
      },
      {
        taskKey: 'story.claims.large',
        artifacts: [{
          artifactKey: 'text-open-world.story-arc',
          kind: 'text-open-world.story-arc',
          payload: story,
        }],
      },
    ])

    const projection = await project(fixture)
    const storyView = projection.artifacts.find(item => item.artifactKey === 'text-open-world.story-arc')!

    expect(storyView).toMatchObject({
      health: 'dangling',
      sourceEvidenceCount: 502,
      truncatedSourceEvidenceCount: 2,
    })
    expect(storyView.sourceEvidence).toHaveLength(500)
    expect(storyView.sourceEvidence.some(item => item.key === 'claim.zzzz-missing')).toBe(false)
    expect(diagnosticCodes(projection, 'text-open-world.story-arc'))
      .toContain('source-claim.dangling')
  })

  it('快照 Hash 绑定全部治理字节，元数据损坏后旧游标不能继续复用', async () => {
    const payload = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [{ key: 'region.snapshot', title: '快照地区', locationKeys: [] }] },
    )
    const fixture = await makeFixture([{
      taskKey: 'region.snapshot',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload,
        metadata: { source: 'checkpoint' },
      }],
    }])
    const verified = await project(fixture)
    fixture.artifactRows[0].metadataJson = canonicalProductProductionJsonV2({ source: 'tampered' })
    const corrupted = await project(fixture)

    expect(verified.artifacts[0].health).toBe('verified')
    expect(corrupted.artifacts[0].health).toBe('corrupt')
    expect(corrupted.snapshotHash).not.toBe(verified.snapshotHash)
  })

  it('拒绝同 Artifact 重复实体，以及 RegionSkeleton/Map 的镜像权威冲突', async () => {
    const duplicated = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      {
        regions: [
          { key: 'region.same', title: '同名一', description: 'A', locationKeys: [] },
          { key: 'region.same', title: '同名二', description: 'B', locationKeys: [] },
        ],
      },
    )
    const duplicateFixture = await makeFixture([{
      taskKey: 'p4.region-skeleton',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload: duplicated,
      }],
    }], { officialAuthority: true })

    const skeleton = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [{
        key: 'region.mirror', order: 0, title: '骨架标题', description: '骨架描述',
        theme: '盐雾', locationKeys: [], fastTravelPointKey: null, initialKnowledge: '公开',
      }] },
    )
    const map = await governedPayload(
      'text-open-world.map-interaction-catalog',
      'mapInteractionCatalogHash',
      { regions: [{
        key: 'region.mirror', order: 0, title: '地图篡改标题', description: '地图描述',
        theme: '盐雾', locationKeys: [], fastTravelPointKey: null, initialKnowledge: '公开',
      }] },
    )
    const mirrorFixture = await makeFixture([
      {
        taskKey: 'p4.region-skeleton',
        artifacts: [{
          artifactKey: 'text-open-world.region-skeleton',
          kind: 'text-open-world.region-skeleton',
          payload: skeleton,
        }],
      },
      {
        taskKey: 'p8.catalog.map-interactions',
        artifacts: [{
          artifactKey: 'text-open-world.map-interaction-catalog',
          kind: 'text-open-world.map-interaction-catalog',
          payload: map,
        }],
      },
    ], { officialAuthority: true })

    const [duplicateProjection, mirrorProjection] = await Promise.all([
      project(duplicateFixture),
      project(mirrorFixture),
    ])

    expect(diagnosticCodes(duplicateProjection, 'text-open-world.region-skeleton'))
      .toContain('projection.entity-duplicate')
    expect(duplicateProjection.entities).toEqual([])
    expect(diagnosticCodes(mirrorProjection, 'text-open-world.region-skeleton'))
      .toContain('projection.mirror-conflict')
    expect(diagnosticCodes(mirrorProjection, 'text-open-world.map-interaction-catalog'))
      .toContain('projection.mirror-conflict')
    expect(mirrorProjection.entities).toEqual([])
  })

  it('第 1001 个引用即使被 DTO 截断，仍参与 dangling 判定与计数', async () => {
    const resolvedKeys = Array.from({ length: 1_000 }, (_, index) => `location.${String(index).padStart(4, '0')}`)
    const danglingKey = 'location.zzzz'
    const payload = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      {
        regions: [{
          key: 'region.large',
          title: '大地区',
          locationKeys: [...resolvedKeys, danglingKey],
        }],
        locations: resolvedKeys.map((key, index) => ({
          key,
          regionKey: 'region.large',
          order: index,
          title: key,
        })),
      },
    )
    const fixture = await makeFixture([{
      taskKey: 'p4.region-skeleton',
      artifacts: [{
        artifactKey: 'text-open-world.region-skeleton',
        kind: 'text-open-world.region-skeleton',
        payload,
      }],
    }], { officialAuthority: true })

    const projection = await project(fixture)
    expect(projection.entities.find(item => item.identity === 'region:region.large')).toBeUndefined()
    expect(projection.artifacts.find(item => item.artifactKey === 'text-open-world.region-skeleton'))
      .toMatchObject({ health: 'dangling', productionValidation: 'not-applicable' })
    expect(diagnosticCodes(projection, 'text-open-world.region-skeleton'))
      .toContain('artifact.dangling-reference')
  })

  it('同 identity 的错误来源 Artifact 不能满足 targetArtifacts 白名单引用', async () => {
    const skeleton = await governedPayload(
      'text-open-world.quest-skeletons',
      'questSkeletonsHash',
      {
        quests: [{ key: 'quest.only-skeleton', title: '只有骨架的任务', regionKeys: [], stageKeys: [] }],
        stages: [],
        objectives: [],
      },
    )
    const requirements = await governedPayload(
      'text-open-world.content-requirement-manifest',
      'contentRequirementManifestHash',
      { requirements: [] },
    )
    const questDocuments = await governedPayload(
      'text-open-world.quest-design-documents',
      'questDesignDocumentsHash',
      { quests: [], stages: [], objectives: [], conditions: [], effects: [], actions: [] },
    )
    const director = await governedPayload(
      'text-open-world.director-decks',
      'directorDecksHash',
      {
        templates: [{
          key: 'quest-seed.only-skeleton',
          title: '不得借用骨架任务',
          questKey: 'quest.only-skeleton',
          regionKeys: [],
        }],
        randomEvents: [],
      },
    )
    const fixture = await makeFixture([
      {
        taskKey: 'quest.skeleton.group',
        artifacts: [
          { artifactKey: 'text-open-world.quest-skeletons', kind: 'text-open-world.quest-skeletons', payload: skeleton },
          { artifactKey: 'text-open-world.content-requirement-manifest', kind: 'text-open-world.content-requirement-manifest', payload: requirements },
        ],
      },
      {
        taskKey: 'quest.runtime.group',
        artifacts: [
          { artifactKey: 'text-open-world.quest-design-documents', kind: 'text-open-world.quest-design-documents', payload: questDocuments },
          { artifactKey: 'text-open-world.director-decks', kind: 'text-open-world.director-decks', payload: director },
        ],
      },
    ])

    const projection = await project(fixture)
    const directorView = projection.artifacts.find(
      item => item.artifactKey === 'text-open-world.director-decks',
    )!
    expect(directorView.health).toBe('dangling')
    expect(diagnosticCodes(projection, 'text-open-world.director-decks'))
      .toContain('artifact.dangling-reference')
    expect(projection.entities).toEqual([])
  })

  it('A→缺失X 会使同 Artifact 的健康 sibling 一并失权，并沿 B→sibling 继续级联', async () => {
    const regions = await governedPayload(
      'text-open-world.region-skeleton',
      'regionSkeletonHash',
      { regions: [], locations: [], edges: [], fastTravelPoints: [] },
    )
    const actors = await governedPayload(
      'text-open-world.npc-runtime-catalog',
      'npcRuntimeCatalogHash',
      {
        factions: [{ key: 'faction.sibling', title: '同包势力' }],
        actors: [
          { key: 'character.bad-a', title: '引用缺失地点的角色', homeLocationKey: 'location.missing-x' },
          { key: 'character.clean-sibling', title: '本身无坏引用的同包角色' },
        ],
        schedules: [],
      },
    )
    const scenes = await governedPayload(
      'text-open-world.scene-scripts',
      'sceneScriptsHash',
      {
        scenes: [{
          key: 'scene.ref-sibling-b',
          title: '引用同包健康角色的下游场景',
          actorKey: 'character.clean-sibling',
          participantKeys: [],
        }],
      },
    )
    const fixture = await makeFixture([
      {
        taskKey: 'region.empty',
        artifacts: [{
          artifactKey: 'text-open-world.region-skeleton',
          kind: 'text-open-world.region-skeleton',
          payload: regions,
        }],
      },
      {
        taskKey: 'npc.atomic',
        artifacts: [{
          artifactKey: 'text-open-world.npc-runtime-catalog',
          kind: 'text-open-world.npc-runtime-catalog',
          payload: actors,
        }],
      },
      {
        taskKey: 'scene.downstream',
        artifacts: [{
          artifactKey: 'text-open-world.scene-scripts',
          kind: 'text-open-world.scene-scripts',
          payload: scenes,
        }],
      },
    ])

    const projection = await project(fixture)
    expect(projection.artifacts.find(item => item.artifactKey === 'text-open-world.npc-runtime-catalog'))
      .toMatchObject({ health: 'dangling' })
    expect(projection.artifacts.find(item => item.artifactKey === 'text-open-world.scene-scripts'))
      .toMatchObject({ health: 'dangling' })
    expect(diagnosticCodes(projection, 'text-open-world.scene-scripts'))
      .toContain('artifact.dangling-reference-cascade')
    expect(projection.entities).toEqual([])
  })

  it('DTO 不披露 SourcePinUnit.contentText 或 PlayerBuild.privateKnowledge', async () => {
    const sourceSecret = 'SOURCE-PRIVATE-NOVEL-TEXT-9a7f'
    const playerSecret = 'PLAYER-PRIVATE-KNOWLEDGE-4c2e'
    const sourceUnit = {
      schema: 'storyforge.text-open-world-source-pin-unit',
      version: 1,
      productInstanceKey: PRODUCTION_KEY,
      sourceKind: 'novel',
      unitKey: 'chapter.private.1',
      artifactKey: 'text-open-world.source-pin-unit',
      kind: 'chapter',
      label: '私有正文',
      order: 0,
      partIndex: 1,
      partCount: 1,
      readDepth: 'full',
      sourceResourceKey: null,
      sourceArea: null,
      sourceResourceKind: null,
      sourceContentHash: await hashProductProductionValueV2(sourceSecret),
      contentText: sourceSecret,
      charCount: sourceSecret.length,
      wordCount: countWords(sourceSecret),
      capturedAt: 1,
    }
    const playerBuild = await governedPayload(
      'text-open-world.player-build',
      'playerBuildHash',
      {
        identity: {
          displayName: '公开名字',
          publicKnowledge: '公开信息',
          privateKnowledge: playerSecret,
        },
      },
    )
    const fixture = await makeFixture([
      {
        taskKey: 'source.unit',
        artifacts: [{
          artifactKey: 'text-open-world.source-pin-unit',
          kind: 'text-open-world.source-pin-unit',
          payload: sourceUnit,
        }],
      },
      {
        taskKey: 'player.build',
        artifacts: [{
          artifactKey: 'text-open-world.player-build',
          kind: 'text-open-world.player-build',
          payload: playerBuild,
        }],
      },
    ])

    const projection = await project(fixture)
    const serialized = JSON.stringify(projection)

    expect(serialized).not.toContain(sourceSecret)
    expect(serialized).not.toContain(playerSecret)
    expect(serialized).not.toContain('contentText')
    expect(serialized).not.toContain('privateKnowledge')
    expect(projection.artifacts.find(item => item.artifactKey === 'text-open-world.player-build')?.health)
      .toBe('verified')
  })
})
