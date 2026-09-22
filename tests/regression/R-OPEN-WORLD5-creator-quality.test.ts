import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  finalizeTextOpenWorldCreatorQualityV1,
  portableTextOpenWorldCreatorIssueJsonV1,
  readTextOpenWorldCreatorQualityWorkspaceV1,
  recordTextOpenWorldCreatorFullPlaytestV1,
  recordTextOpenWorldCreatorGrayboxV1,
  recordTextOpenWorldCreatorIssueV1,
  requirePassedTextOpenWorldCreatorQualityGateV1,
  waiveTextOpenWorldCreatorAdvisoryIssueV1,
} from '../../src/lib/open-world/creator-quality'
import {
  TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1,
  TEXT_OPEN_WORLD_CREATOR_GRAYBOX_GATE_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_CALIBRATION_GATE_ID_V1,
  TEXT_OPEN_WORLD_CREATOR_FULL_PLAYTEST_CRITERIA_V1,
  TEXT_OPEN_WORLD_CREATOR_FULL_PLAYTEST_GATE_ID_V1,
  parseTextOpenWorldCreatorCalibrationEvidenceV1,
  parseTextOpenWorldCreatorGrayboxEvidenceV1,
  parseTextOpenWorldCreatorUpdateVerificationEvidenceV1,
} from '../../src/lib/open-world/creator-quality-contract'
import { readTextOpenWorldCreatorDerivedBuildAuthorityV1 } from '../../src/lib/open-world/creator-derived-authority'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import type {
  ProductBuildArtifactRecordV1,
  ProductBuildQualityReportV1,
  ProductQualityGateReceiptRecordV1,
} from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedAuthorizedTextOpenWorldCreatorBuildV1 } from '../helpers/text-open-world-creator-build'
import { appendAgentRunEventV1, createAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { createTextOpenWorldRuntimeAIRunContractV1 } from '../../src/lib/open-world/runtime-ai-contract'

const governance = vi.hoisted(() => ({
  productionId: 0,
  productionStateRevision: 0,
  buildId: 0,
  buildNumber: 0,
  planHash: '',
  snapshotHash: 'a'.repeat(64),
  artifactKeys: [] as string[],
}))

const runtimeEvidence = vi.hoisted(() => ({
  state: null as unknown,
  stateHash: '',
  sequence: 0,
  bySession: new Map<number, { state: unknown; stateHash: string; sequence: number }>(),
}))

vi.mock('../../src/lib/open-world/creator-artifact-governance', () => ({
  readTextOpenWorldArtifactGovernanceV1: vi.fn(async () => ({
    production: { id: governance.productionId, stateRevision: governance.productionStateRevision },
    build: { id: governance.buildId, buildNumber: governance.buildNumber, planHash: governance.planHash },
    snapshotHash: governance.snapshotHash,
    summary: {
      currentProblemArtifactCount: 0,
      currentIntegrityOnlyArtifactCount: 0,
      currentProductionValidatedArtifactCount: governance.artifactKeys.length,
    },
    artifacts: governance.artifactKeys.map(artifactKey => ({ artifactKey, currentEpoch: true })),
  })),
}))

vi.mock('../../src/lib/open-world/runtime-api', () => ({
  readProductRuntimeState: vi.fn(async (sessionId: number) => structuredClone(
    runtimeEvidence.bySession.get(sessionId)?.state ?? runtimeEvidence.state,
  )),
  readProductRuntimeStateVersion: vi.fn(async (sessionId: number) => ({
    sequence: runtimeEvidence.bySession.get(sessionId)?.sequence ?? runtimeEvidence.sequence,
    stateHash: runtimeEvidence.bySession.get(sessionId)?.stateHash ?? runtimeEvidence.stateHash,
  })),
  verifyProductRuntimeCheckpoint: vi.fn(async () => true),
}))

vi.mock('../../src/lib/open-world/checkpoints', () => ({
  inspectTextOpenWorldRuntimeHeadV1: vi.fn(async (sessionId: number) => ({
    code: 'valid', canonicalStateHash: runtimeEvidence.bySession.get(sessionId)?.stateHash ?? runtimeEvidence.stateHash,
  })),
  inspectTextOpenWorldCheckpointV1: vi.fn(async () => ({ valid: true })),
}))

interface FixtureV1 {
  scope: Awaited<ReturnType<typeof seedCurrentProductWorld>>['scope']
  productionId: number
  buildId: number
  buildBinding: {
    productionKey: string
    buildNumber: number
    packageHash: string
    previewHash: string
    manifestHash: string
    qualityReportHash: string
    rootTerminalReceiptHash: string
  }
  findingKeys: string[]
}

async function reviewPayload(kind: 'balance' | 'semantic', advisory: boolean) {
  const metricKey = kind === 'balance' ? 'progression' : 'mainline-arc'
  const metricKeys = kind === 'balance'
    ? [metricKey]
    : ['mainline-arc', 'significant-stories', 'repetition', 'duration-and-guidance']
  const scores = metricKeys.map(key => ({
    metricKey: key, score: advisory ? 80 : 90, rationale: `${kind}评审理由足够具体`,
  }))
  const findings = advisory ? [{
    key: `${kind}.finding.1`, metricKey, severity: 'advisory', score: 80,
    summary: `${kind}建议项`, evidence: '当前内容的具体证据',
    targetArtifactKey: kind === 'balance'
      ? 'text-open-world.progression-catalogs' : 'text-open-world.story-arc',
    targetEntityKeys: [`${kind}.entity.1`],
    repair: { targetTaskKey: kind === 'balance' ? 'p8a.progression' : 'p3.story-arc' },
  }] : []
  const hashKey = kind === 'balance' ? 'balanceReviewHash' : 'semanticReviewHash'
  const body = {
    schema: `storyforge.text-open-world-${kind}-review`, version: 1,
    productType: 'text-open-world', productInstanceKey: 'quality.fixture',
    scores, findings, verdict: 'pass', threshold: 70,
    minimumScore: advisory ? 80 : 90,
  }
  return { ...body, [hashKey]: await hashProductProductionValueV2(body) }
}

async function fixture(input: { advisories?: boolean } = {}): Promise<FixtureV1> {
  const world = await seedCurrentProductWorld(`G5-09 quality ${crypto.randomUUID()}`)
  const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
    source: {
      kind: 'world-release', scope: world.scope,
      localReleaseRecordId: world.release.id!, expectedReleaseHash: world.release.contentHash,
    },
    sessionKey: `g5-09-quality-${crypto.randomUUID()}`,
  })
  const build = (await db.productBuilds.get(creator.buildId))!
  const production = (await db.productProductions.get(creator.productionId))!
  const now = Date.now()
  const artifacts: ProductBuildArtifactRecordV1[] = []
  for (const kind of ['balance', 'semantic'] as const) {
    const payload = await reviewPayload(kind, input.advisories ?? true)
    const payloadJson = canonicalProductProductionJsonV2(payload)
    const artifactKey = `text-open-world.${kind}-review`
    const row: ProductBuildArtifactRecordV1 = {
      projectId: world.scope.projectId, worldId: world.scope.worldId, workId: world.scope.workId,
      buildId: build.id!, artifactKey, requirementKey: null, version: 1, kind: artifactKey,
      mediaKind: null, status: 'accepted', producerRunId: 100 + artifacts.length,
      producerReceiptHash: await hashProductProductionValueV2({ artifactKey, receipt: true }),
      controlEpoch: build.controlEpoch,
      inputHash: await hashProductProductionValueV2({ artifactKey, input: true }),
      contentHash: await hashProductProductionValueV2(payload), payloadJson,
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null,
      mimeType: null, byteSize: new TextEncoder().encode(payloadJson).byteLength,
      parentArtifactHash: null, carriedFrom: null, createdAt: now, updatedAt: now,
    }
    row.id = await db.productBuildArtifacts.add(row) as number
    artifacts.push(row)
  }
  for (const artifactKey of [
    'text-open-world.mainline-thread', 'text-open-world.significant-threads',
    'text-open-world.region-narrative-packs', 'text-open-world.scene-scripts',
    'text-open-world.content-budget',
  ] as const) {
    const payload = { schema: `storyforge.fixture.${artifactKey}`, version: 1, artifactKey }
    const payloadJson = canonicalProductProductionJsonV2(payload)
    const row: ProductBuildArtifactRecordV1 = {
      projectId: world.scope.projectId, worldId: world.scope.worldId, workId: world.scope.workId,
      buildId: build.id!, artifactKey, requirementKey: null, version: 1, kind: artifactKey,
      mediaKind: null, status: 'accepted', producerRunId: 200 + artifacts.length,
      producerReceiptHash: await hashProductProductionValueV2({ artifactKey, receipt: true }),
      controlEpoch: build.controlEpoch, inputHash: await hashProductProductionValueV2({ artifactKey, input: true }),
      contentHash: await hashProductProductionValueV2(payload), payloadJson,
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null,
      mimeType: null, byteSize: new TextEncoder().encode(payloadJson).byteLength,
      parentArtifactHash: null, carriedFrom: null, createdAt: now, updatedAt: now,
    }
    row.id = await db.productBuildArtifacts.add(row) as number
    artifacts.push(row)
  }
  const packageHash = await hashProductProductionValueV2({ package: creator.productionKey })
  const previewHash = await hashProductProductionValueV2({ preview: creator.productionKey })
  const manifestHash = await hashProductProductionValueV2({ manifest: creator.productionKey })
  const rootTerminalReceiptHash = await hashProductProductionValueV2({ terminal: creator.productionKey })
  const quality: ProductBuildQualityReportV1 = {
    schema: 'storyforge.product-build-quality-report', version: 1,
    buildNumber: build.buildNumber, packageHash,
    hardGateResults: [
      { gateId: 'schema.valid', passed: true, evidence: [manifestHash] },
      { gateId: 'rights.complete', passed: true, evidence: [rootTerminalReceiptHash] },
    ],
    softGateResults: [], mediaCoverage: 1, playable: true, releaseReady: true, warnings: [],
  }
  const qualityReportJson = canonicalProductProductionJsonV2(quality)
  const qualityReportHash = await hashProductProductionValueV2(quality)
  await db.productBuilds.update(build.id!, {
    status: 'release-ready', stateRevision: build.stateRevision + 1,
    packageHash, previewHash, manifestHash, qualityReportJson, qualityReportHash,
    rootTerminalReceiptHash, completedAt: now, updatedAt: now,
  })
  const productionStateRevision = production.stateRevision + 1
  await db.productProductions.update(production.id!, {
    status: 'preview-ready', stateRevision: productionStateRevision, updatedAt: now,
  })
  governance.productionId = production.id!
  governance.productionStateRevision = productionStateRevision
  governance.buildId = build.id!
  governance.buildNumber = build.buildNumber
  governance.planHash = build.planHash
  governance.snapshotHash = await hashProductProductionValueV2({
    productionId: production.id, buildId: build.id, artifacts: artifacts.map(row => row.contentHash),
  })
  governance.artifactKeys = artifacts.map(row => row.artifactKey)
  return {
    scope: world.scope, productionId: production.id!, buildId: build.id!,
    buildBinding: {
      productionKey: production.productionKey, buildNumber: build.buildNumber,
      packageHash, previewHash, manifestHash, qualityReportHash, rootTerminalReceiptHash,
    },
    findingKeys: (input.advisories ?? true)
      ? ['balance:balance.finding.1', 'semantic:semantic.finding.1'] : [],
  }
}

async function insertGrayboxReceipt(input: FixtureV1): Promise<string> {
  const confirmedAt = Date.now()
  const hash = (label: string) => hashProductProductionValueV2({ label, build: input.buildId })
  const environment = {
    browserName: 'Vitest Chromium', browserVersion: '1', platform: 'test',
    viewport: { width: 1280, height: 720 },
  }
  const evidence = parseTextOpenWorldCreatorGrayboxEvidenceV1({
    schema: 'storyforge.text-open-world-creator-graybox-evidence', version: 1,
    build: input.buildBinding,
    sessions: [{
      sessionWitnessKey: 'session.fixture-quality', runtimeSourceHash: input.buildBinding.packageHash,
      seedHash: await hash('seed'), titleHash: await hash('title'), status: 'completed',
      initialStateHash: await hash('initial'), currentStateHash: await hash('current'),
      eventStreamHash: await hash('events'), eventCount: 24, throughSequence: 24,
      endingKey: 'ending.fixture', actionKeys: ['action.combat', 'action.craft'],
      checkpointStateHashes: [await hash('checkpoint')],
      coverageKeys: [...TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1].sort(),
      startedAt: confirmedAt - 100, updatedAt: confirmedAt - 1,
    }],
    combinedCoverageKeys: [...TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1].sort(),
    environment,
    humanChecks: {
      refreshedAndRecovered: true, guidanceWasUnderstandable: true,
      narrativeExperienceReviewed: true, mediaAndFallbacksReviewed: true,
      allObservedProblemsReported: true,
    },
    authorNote: '', confirmedAt,
  })
  const body = {
    schema: 'storyforge.product-quality-gate-receipt' as const, version: 1 as const,
    gateId: TEXT_OPEN_WORLD_CREATOR_GRAYBOX_GATE_ID_V1, gateVersion: '1',
    verifierId: 'storyforge.creator-graybox-playtest', verifierVersion: '1',
    verifierKind: 'human-evidence' as const,
    inputHashes: [input.buildBinding.packageHash, input.buildBinding.previewHash, evidence.sessions[0]!.eventStreamHash],
    environmentHash: await hashProductProductionValueV2(environment),
    measuredJson: canonicalProductProductionJsonV2(evidence), status: 'passed' as const,
    thresholdProfileId: 'storyforge.text-open-world-creator-graybox.v1',
    thresholdProfileVersion: '1',
    evidenceRefs: [evidence.sessions[0]!.currentStateHash, evidence.sessions[0]!.eventStreamHash,
      ...evidence.sessions[0]!.checkpointStateHashes],
    createdAt: confirmedAt,
  }
  const receipt = { ...body, receiptHash: await hashProductProductionValueV2(body) }
  const row: ProductQualityGateReceiptRecordV1 = {
    projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId,
    buildId: input.buildId, gateId: receipt.gateId, gateVersion: '1',
    verifierId: receipt.verifierId, verifierVersion: '1', status: 'passed',
    receiptJson: canonicalProductProductionJsonV2(receipt), receiptHash: receipt.receiptHash,
    createdAt: confirmedAt,
  }
  await db.productQualityGateReceipts.add(row)
  return receipt.receiptHash
}

async function insertCalibrationReceipt(input: FixtureV1): Promise<string> {
  const [build, derived, artifacts] = await Promise.all([
    db.productBuilds.get(input.buildId),
    readTextOpenWorldCreatorDerivedBuildAuthorityV1({ scope: input.scope, buildId: input.buildId }),
    db.productBuildArtifacts.where('buildId').equals(input.buildId).toArray(),
  ])
  if (!build) throw new Error('fixture build missing')
  const quote = derived.contracts.start.preflight.priceQuote!
  const semanticRow = artifacts.find(row => row.artifactKey === 'text-open-world.semantic-review')!
  const semantic = JSON.parse(semanticRow.payloadJson)
  const artifactHash = (key: string) => artifacts.find(row => row.artifactKey === key)!.contentHash
  const ledgerHash = await hashProductProductionValueV2(JSON.parse(build.budgetLedgerJson))
  const inputHash = await hashProductProductionValueV2({ calibration: 'input', buildId: input.buildId })
  const outputHash = await hashProductProductionValueV2({ calibration: 'output', buildId: input.buildId })
  const evaluatedAt = Date.now()
  const checks = [
    'real-independent-provider-identities', 'production-semantic-release-line',
    'independent-narrative-release-line', 'three-distinct-variants-per-template',
    'authored-duration-inventory', 'production-call-usage-observed', 'production-budget-and-cost',
  ].map(key => ({ key, passed: true, summary: `${key} fixture evidence` }))
  const evidence = parseTextOpenWorldCreatorCalibrationEvidenceV1({
    schema: 'storyforge.text-open-world-creator-calibration-evidence', version: 1,
    build: input.buildBinding,
    generator: {
      provider: derived.contracts.start.preflight.providerBinding.provider,
      model: derived.contracts.start.preflight.providerBinding.model,
      bindingHash: derived.contracts.start.preflight.providerBinding.bindingHash,
    },
    independentReview: {
      provider: 'claude', model: 'claude-sonnet-4-20250514',
      promptVersion: 'text-open-world-release-calibration-grader.v1',
      inputHash, outputHash, inputTokens: 100, outputTokens: 50,
      finishReason: 'stop', durationMs: 100,
      scores: [
        { metricKey: 'mainline-quality', score: 90, rationale: '主线结构清晰完整。' },
        { metricKey: 'significant-stories', score: 90, rationale: '重要故事冲突完整。' },
        { metricKey: 'template-differentiation', score: 90, rationale: '模板变体有明确差异。' },
      ], findings: [],
    },
    productionSemanticReview: { reviewHash: semantic.semanticReviewHash, scores: semantic.scores },
    templateDifferentiation: {
      templateCount: 5, variantCount: 15, minimumVariantsPerTemplate: 3,
      exactDuplicateTitleCount: 0, exactDuplicateDescriptionCount: 0,
      maximumPairSimilarityBasisPoints: 3000,
    },
    contentDuration: {
      mainlineMinutes: 105, optionalInventoryMinutes: 220, totalAuthoredMinutes: 325,
      typicalPlaythroughMinutes: 240, requestedMainlineMinimum: 90, requestedMainlineMaximum: 120,
      requestedOptionalMinimum: 180, requestedOptionalMaximum: 300,
    },
    productionUsage: {
      ledgerHash, modelCalls: 1, inputTokens: 100, outputTokens: 50,
      totalDurationMs: 100, averageCallDurationMs: 100, p95CallDurationMs: 100,
      maximumCallDurationMs: 100, estimatedTextCostUsd: 0.01,
      priceQuoteHash: quote.quoteHash, priceQuoteSource: quote.source, priceQuoteAsOf: quote.asOf,
      budgetMaximumCalls: 200, budgetMaximumInputTokens: 1_200_000,
      budgetMaximumOutputTokens: 360_000, budgetMaximumDurationMs: 86_400_000,
      budgetMaximumCostUsd: 30,
    },
    checks, passed: true, evaluatedAt,
  })
  const inputHashes = [
    input.buildBinding.packageHash,
    artifactHash('text-open-world.mainline-thread'), artifactHash('text-open-world.significant-threads'),
    artifactHash('text-open-world.region-narrative-packs'), artifactHash('text-open-world.scene-scripts'),
    artifactHash('text-open-world.content-budget'), artifactHash('text-open-world.semantic-review'),
    evidence.generator.bindingHash, evidence.productionUsage.priceQuoteHash,
    evidence.productionUsage.ledgerHash, evidence.independentReview.inputHash,
    evidence.independentReview.outputHash,
  ]
  const receiptBody = {
    schema: 'storyforge.product-quality-gate-receipt' as const, version: 1 as const,
    gateId: TEXT_OPEN_WORLD_CREATOR_CALIBRATION_GATE_ID_V1, gateVersion: '1',
    verifierId: 'storyforge.creator-independent-release-calibration', verifierVersion: '1',
    verifierKind: 'provider-review' as const, inputHashes, environmentHash: null,
    measuredJson: canonicalProductProductionJsonV2(evidence), status: 'passed' as const,
    thresholdProfileId: 'storyforge.text-open-world-creator-release-calibration.v1', thresholdProfileVersion: '1',
    evidenceRefs: [semantic.semanticReviewHash, inputHash, outputHash, ledgerHash], createdAt: evaluatedAt,
  }
  const receipt = { ...receiptBody, receiptHash: await hashProductProductionValueV2(receiptBody) }
  await db.productQualityGateReceipts.add({
    projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId,
    buildId: input.buildId, gateId: receipt.gateId, gateVersion: '1',
    verifierId: receipt.verifierId, verifierVersion: '1', status: 'passed',
    receiptJson: canonicalProductProductionJsonV2(receipt), receiptHash: receipt.receiptHash,
    createdAt: evaluatedAt,
  })
  return receipt.receiptHash
}

async function insertCompletedPlaytestRoute(input: FixtureV1, endingKey: string, suffix: string): Promise<number> {
  const now = Date.now()
  const initialState = {
    version: 1, clock: 0, entities: {}, memories: [], narratives: [],
    ttrpg: null, interaction: null, narrative: null, adventure: null,
    presentation: null, openWorldEvolution: null, openWorld: null,
    textOpenWorld: {
      state: {
        player: { level: 1, experience: 0 },
        inventory: { currency: 0, stackQuantities: {}, itemInstances: {} },
        endings: { reachedKey: null },
      },
    },
    lastSequence: 0,
  }
  const currentState = structuredClone(initialState)
  currentState.textOpenWorld.state.player = { level: 2, experience: 20 }
  currentState.textOpenWorld.state.inventory.currency = 10
  currentState.textOpenWorld.state.endings.reachedKey = endingKey
  currentState.lastSequence = 6
  const stateHash = await hashProductProductionValueV2(currentState)
  const sessionId = await db.productRuntimeSessions.add({
    projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId,
    worldGroupId: null, productReleaseId: null, productBuildId: input.buildId,
    runtimeSourceHash: input.buildBinding.packageHash, kind: 'text-open-world',
    title: `真人完整试玩 ${suffix}`, status: 'completed', rulesetVersion: 1,
    seed: `full-playtest-${suffix}`, canonSnapshotJson: '{}',
    initialStateJson: canonicalProductProductionJsonV2(initialState),
    runtimeHeadSequence: 6, runtimeHeadStateJson: canonicalProductProductionJsonV2(currentState),
    runtimeHeadStateHash: stateHash, parentSessionId: null, parentThroughSequence: null,
    createdAt: now - 10_000, updatedAt: now,
  }) as number
  runtimeEvidence.bySession.set(sessionId, { state: currentState, stateHash, sequence: 6 })
  const event = (sequence: number, type: string, payload: unknown) => ({
    projectId: input.scope.projectId, worldGroupId: null, sessionId, sequence,
    type, actorKey: null, targetKey: null,
    payloadJson: canonicalProductProductionJsonV2(payload), createdAt: now - 9_000 + sequence,
  })
  await db.productRuntimeEvents.bulkAdd([
    event(1, 'text-open-world.command.committed', { envelope: { actionKey: 'action.travel' } }),
    event(2, 'text-open-world.effects.applied', { effectKind: 'travel' }),
    event(3, 'world.travel.completed', { regionKey: 'region.fixture' }),
    event(4, 'text-open-world.command.committed', { envelope: { actionKey: 'action.combat.attack' } }),
    event(5, 'text-open-world.effects.applied', { effectKind: 'combat' }),
    event(6, 'text-open-world.command.committed', { envelope: { actionKey: 'action.craft' } }),
  ] as never[])
  await db.productRuntimeCheckpoints.add({
    projectId: input.scope.projectId, worldGroupId: null, sessionId,
    throughSequence: 6, name: `结局检查点 ${suffix}`, purpose: 'manual', subjectKey: null,
    stateJson: canonicalProductProductionJsonV2(currentState),
    stateHash: await hashProductProductionValueV2({ checkpoint: suffix, stateHash }), createdAt: now,
  })
  const runtimeBindingHash = await hashProductProductionValueV2({ sessionId, kind: 'full-playtest-runtime-ai' })
  const contract = await createTextOpenWorldRuntimeAIRunContractV1({
    skillId: 'prose.text-open-world-runtime-intent', objective: `真人试玩自由输入 ${suffix}`,
    scope: {
      projectId: input.scope.projectId, worldGroupId: null,
      runtime: {
        productRuntimeSessionId: sessionId, baseSequence: 6, stateHash,
        visibilityHash: await hashProductProductionValueV2({ visibility: suffix }),
        releaseHash: input.buildBinding.packageHash,
      },
    },
    runtimeBindingHash,
  })
  let snapshot = await createAgentRunV1({
    scope: input.scope, productRuntimeSessionId: sessionId, worldGroupId: null, contract, now: now - 500,
  })
  const append = async (type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown, eventNow: number) => {
    snapshot = await appendAgentRunEventV1({
      scope: input.scope, productRuntimeSessionId: sessionId, runId: snapshot.run.id,
      type, payload, expectedLastSequence: snapshot.projection.lastSequence, now: eventNow,
    } as Parameters<typeof appendAgentRunEventV1>[0])
  }
  const stepId = 'text-open-world-runtime-ai:intent'
  await append('step.scheduled', { stepId }, now - 400)
  await append('step.started', { stepId, attempt: 1 }, now - 350)
  await append('model.requested', {
    stepId, attempt: 1, bindingHash: await hashProductProductionValueV2({ request: suffix }),
  }, now - 300)
  await append('model.responded', {
    stepId, attempt: 1, outputHash: await hashProductProductionValueV2({ response: suffix }),
  }, now - 100)
  return sessionId
}

function fullPlaytestAssessments(rating = 4) {
  return TEXT_OPEN_WORLD_CREATOR_FULL_PLAYTEST_CRITERIA_V1.map(criterionKey => ({
    criterionKey, rating: rating as 1 | 2 | 3 | 4 | 5,
    note: `${criterionKey} 已由真人在两条完整路线中实际检查并记录。`,
  }))
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  runtimeEvidence.bySession.clear()
})

afterAll(async () => {
  await db.delete()
})

describe('TOW-G5-09 · Creator质量、灰盒和问题回执', () => {
  it('复用生产双评审与完整Artifact治理，代码硬门和建议项分轴展示', async () => {
    const seeded = await fixture()
    const workspace = await readTextOpenWorldCreatorQualityWorkspaceV1({
      scope: seeded.scope, productionId: seeded.productionId, expectedBuildId: seeded.buildId,
    })
    expect(workspace.hardGatesPassed).toBe(true)
    expect(workspace.reviews.map(review => [review.reviewKind, review.minimumScore])).toEqual([
      ['balance', 80], ['semantic', 80],
    ])
    expect(workspace.modelFindings.map(finding => finding.findingKey)).toEqual(seeded.findingKeys)
    expect(workspace.releaseQualityReady).toBe(false)
    expect(workspace.blockers).toContain('尚无当前Build的完整隔离灰盒试玩回执')
  })

  it('问题回执不含本地ID或世界原文；阻断项不可豁免，非阻断项可逐项接受风险', async () => {
    const seeded = await fixture()
    const advisory = await recordTextOpenWorldCreatorIssueV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
      severity: 'advisory', category: 'ui-accessibility', summary: '窄屏任务按钮不够醒目',
      preconditions: ['390px视口'], reproductionSteps: ['打开任务页', '滚动到当前目标'],
      expected: '当前目标按钮保持清晰可见', actual: '按钮与背景对比度偏低',
      affectedStableKeys: ['ui.quest.primary'], sessionId: null, sourceTextExcluded: true,
    })
    const portable = portableTextOpenWorldCreatorIssueJsonV1(advisory)
    expect(portable).not.toContain('productionId')
    expect(portable).not.toContain('buildId')
    expect(portable).not.toContain('sessionId')
    const waiver = await waiveTextOpenWorldCreatorAdvisoryIssueV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
      issueReceiptHash: advisory.receipt.receiptHash,
      reason: '首版仍有文字标签与键盘焦点作为等价提示，下个Build提高视觉对比度。',
      confirmation: 'author-accepts-advisory-risk',
    })
    expect(waiver.status).toBe('waived')

    const blocking = await recordTextOpenWorldCreatorIssueV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
      severity: 'blocking', category: 'save-recovery', summary: '刷新后无法恢复当前任务',
      preconditions: [], reproductionSteps: ['推进任务', '刷新页面'],
      expected: '恢复到刷新前事件头', actual: '当前任务退回初始状态',
      affectedStableKeys: ['quest.main.1'], sessionId: null, sourceTextExcluded: true,
    })
    await expect(waiveTextOpenWorldCreatorAdvisoryIssueV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
      issueReceiptHash: blocking.receipt.receiptHash,
      reason: '试图绕过阻断问题的说明不得被系统接受，应创建新的修复Build。',
      confirmation: 'author-accepts-advisory-risk',
    })).rejects.toThrow(/阻断问题不可豁免/)
  })

  it('灰盒、逐项软豁免和人工抽检汇合成当前Build唯一发布质量回执；新问题会使旧结论失效', async () => {
    const seeded = await fixture()
    await insertCalibrationReceipt(seeded)
    await insertGrayboxReceipt(seeded)
    const finalized = await finalizeTextOpenWorldCreatorQualityV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
      semanticWaivers: seeded.findingKeys.map(findingKey => ({
        findingKey,
        reason: `当前验收世界已完成真人核心循环，接受${findingKey}建议并排入下一Build优化。`,
      })),
      humanChecks: {
        narrativeAndGuidanceReviewed: true, regionalAndQuestVarietyReviewed: true,
        dialogueAndKnowledgeReviewed: true, mediaAndAccessibilityReviewed: true,
        issueListComplete: true,
      },
      authorNote: '首版质量抽检完成。',
    })
    expect(finalized.releaseQualityReady).toBe(true)
    const required = await requirePassedTextOpenWorldCreatorQualityGateV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
    })
    expect(required.gateId).toBe('text-open-world.creator.release-quality')

    await recordTextOpenWorldCreatorIssueV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
      severity: 'advisory', category: 'narrative', summary: '结局前一段转折略显仓促',
      preconditions: [], reproductionSteps: ['沿主路线到达最终选择'],
      expected: '转折有充分铺垫', actual: '两段关键说明之间缺少过渡',
      affectedStableKeys: ['ending.fixture'], sessionId: null, sourceTextExcluded: true,
    })
    const stale = await readTextOpenWorldCreatorQualityWorkspaceV1({
      scope: seeded.scope, productionId: seeded.productionId, expectedBuildId: seeded.buildId,
    })
    expect(stale.releaseQualityReady).toBe(false)
    await expect(requirePassedTextOpenWorldCreatorQualityGateV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
    })).rejects.toThrow(/未通过发布质量门/)
  })

  it('只从当前Build的可重放事件、状态头和检查点生成完整灰盒凭据', async () => {
    const seeded = await fixture({ advisories: false })
    const now = Date.now()
    const initialState = {
      version: 1, clock: 0, entities: {}, memories: [], narratives: [],
      ttrpg: null, interaction: null, narrative: null, adventure: null,
      presentation: null, openWorldEvolution: null, openWorld: null,
      textOpenWorld: {
        state: {
          player: { level: 1, experience: 0 },
          inventory: { currency: 0, stackQuantities: {}, itemInstances: {} },
          endings: { reachedKey: null },
        },
      },
      lastSequence: 0,
    }
    const currentState = structuredClone(initialState)
    currentState.textOpenWorld.state.player = { level: 2, experience: 20 }
    currentState.textOpenWorld.state.inventory.currency = 10
    currentState.textOpenWorld.state.endings.reachedKey = 'ending.fixture'
    currentState.lastSequence = 6
    runtimeEvidence.state = currentState
    runtimeEvidence.sequence = 6
    runtimeEvidence.stateHash = await hashProductProductionValueV2(currentState)
    const sessionId = await db.productRuntimeSessions.add({
      projectId: seeded.scope.projectId, worldId: seeded.scope.worldId, workId: seeded.scope.workId,
      worldGroupId: null, productReleaseId: null, productBuildId: seeded.buildId,
      runtimeSourceHash: seeded.buildBinding.packageHash, kind: 'text-open-world',
      title: 'Creator Build 灰盒验收', status: 'completed', rulesetVersion: 1,
      seed: 'creator-quality-graybox', canonSnapshotJson: '{}',
      initialStateJson: canonicalProductProductionJsonV2(initialState),
      runtimeHeadSequence: 6,
      runtimeHeadStateJson: canonicalProductProductionJsonV2(currentState),
      runtimeHeadStateHash: runtimeEvidence.stateHash,
      parentSessionId: null, parentThroughSequence: null, createdAt: now - 100, updatedAt: now,
    }) as number
    const event = (sequence: number, type: string, payload: unknown) => ({
      projectId: seeded.scope.projectId, worldGroupId: null, sessionId, sequence,
      type, actorKey: null, targetKey: null,
      payloadJson: canonicalProductProductionJsonV2(payload), createdAt: now - 90 + sequence,
    })
    await db.productRuntimeEvents.bulkAdd([
      event(1, 'text-open-world.command.committed', { envelope: { actionKey: 'action.travel' } }),
      event(2, 'text-open-world.effects.applied', { effectKind: 'travel' }),
      event(3, 'world.travel.completed', { regionKey: 'region.fixture' }),
      event(4, 'text-open-world.command.committed', { envelope: { actionKey: 'action.combat.attack' } }),
      event(5, 'text-open-world.effects.applied', { effectKind: 'combat' }),
      event(6, 'text-open-world.command.committed', { envelope: { actionKey: 'action.craft' } }),
    ] as never[])
    const checkpointHash = await hashProductProductionValueV2({ checkpoint: sessionId })
    await db.productRuntimeCheckpoints.add({
      projectId: seeded.scope.projectId, worldGroupId: null, sessionId,
      throughSequence: 6, name: '结局前检查点', purpose: 'manual', subjectKey: null,
      stateJson: canonicalProductProductionJsonV2(currentState), stateHash: checkpointHash,
      createdAt: now,
    })

    const receipt = await recordTextOpenWorldCreatorGrayboxV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
      sessionIds: [sessionId],
      environment: {
        browserName: 'Vitest Chromium', browserVersion: '1', platform: 'test',
        viewport: { width: 1280, height: 720 },
      },
      humanChecks: {
        refreshedAndRecovered: true, guidanceWasUnderstandable: true,
        narrativeExperienceReviewed: true, mediaAndFallbacksReviewed: true,
        allObservedProblemsReported: true,
      },
      authorNote: '完成完整核心循环。',
    })
    expect(receipt.evidence.sessions).toHaveLength(1)
    expect(receipt.evidence.combinedCoverageKeys).toEqual(
      [...TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1].sort(),
    )
    expect(receipt.evidence.sessions[0]).not.toHaveProperty('sessionId')
    expect(receipt.evidence.sessions[0]?.eventStreamHash).toMatch(/^[a-f0-9]{64}$/)
    const workspace = await readTextOpenWorldCreatorQualityWorkspaceV1({
      scope: seeded.scope, productionId: seeded.productionId, expectedBuildId: seeded.buildId,
    })
    expect(workspace.grayboxReceipt?.receiptHash).toBe(receipt.receiptHash)
    expect(workspace.grayboxCandidates[0]?.sessionId).toBe(sessionId)
  })

  it('灰盒回执被篡改时失败关闭且不写入发布通过回执', async () => {
    const seeded = await fixture({ advisories: false })
    await insertGrayboxReceipt(seeded)
    const graybox = await db.productQualityGateReceipts
      .where('[buildId+gateId]').equals([seeded.buildId, TEXT_OPEN_WORLD_CREATOR_GRAYBOX_GATE_ID_V1]).first()
    expect(graybox?.id).toBeTypeOf('number')
    await db.productQualityGateReceipts.update(graybox!.id!, {
      receiptJson: graybox!.receiptJson.replace('Vitest Chromium', 'Tampered Chromium'),
    })
    await expect(finalizeTextOpenWorldCreatorQualityV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
      semanticWaivers: [],
      humanChecks: {
        narrativeAndGuidanceReviewed: true, regionalAndQuestVarietyReviewed: true,
        dialogueAndKnowledgeReviewed: true, mediaAndAccessibilityReviewed: true,
        issueListComplete: true,
      }, authorNote: '',
    })).rejects.toThrow(/质量回执索引或Hash无效/)
    expect(await db.productQualityGateReceipts
      .where('[buildId+gateId]').equals([seeded.buildId, 'text-open-world.creator.release-quality']).count()).toBe(0)
  })

  it('真人完整试玩必须绑定两个不同结局、运行时AI与十项人工判断，并在问题集变化后失效', async () => {
    const seeded = await fixture({ advisories: false })
    await insertCalibrationReceipt(seeded)
    const firstSessionId = await insertCompletedPlaytestRoute(seeded, 'ending.harbor', 'harbor')
    const secondSessionId = await insertCompletedPlaytestRoute(seeded, 'ending.ridge', 'ridge')
    const receipt = await recordTextOpenWorldCreatorFullPlaytestV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
      routes: [
        { sessionId: firstSessionId, reportedActiveMinutes: 95 },
        { sessionId: secondSessionId, reportedActiveMinutes: 110 },
      ],
      environment: {
        browserName: 'Vitest Chromium', browserVersion: '1', platform: 'test',
        viewport: { width: 1280, height: 720 },
      },
      humanChecks: {
        personallyPlayedAllRoutes: true, noAutomationOrModelProxy: true,
        freeInputActuallyTested: true, allObservedProblemsReported: true,
      },
      assessments: fullPlaytestAssessments(4),
      costObservation: {
        source: 'provider-dashboard', runtimeCostUsd: 0.42,
        note: '服务商后台可看到本次调用费用，等待时间和费用均在可接受范围。',
      },
      authorNote: '两条路线由真人完成，选择和结局差异已核对。',
    })
    expect(receipt.status).toBe('passed')
    expect(receipt.evidence.endingKeys).toEqual(['ending.harbor', 'ending.ridge'])
    expect(receipt.evidence.runtimeAi.modelResponseCount).toBe(2)
    expect(receipt.evidence.runtimeAi.freeInputResponseCount).toBe(2)
    expect(receipt.evidence.runtimeAi.totalObservedWaitMs).toBe(400)
    expect(receipt.evidence.routes.every(route => !('sessionId' in route.session))).toBe(true)
    const workspace = await readTextOpenWorldCreatorQualityWorkspaceV1({
      scope: seeded.scope, productionId: seeded.productionId, expectedBuildId: seeded.buildId,
    })
    expect(workspace.fullPlaytestReceipt?.receiptHash).toBe(receipt.receiptHash)

    await recordTextOpenWorldCreatorIssueV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
      severity: 'advisory', category: 'cost-wait', summary: '晚间运行时模型等待略长',
      preconditions: ['晚间调用'], reproductionSteps: ['在场景中输入自由行动'],
      expected: '等待时间保持稳定', actual: '偶发等待明显超过白天体验',
      affectedStableKeys: [], sessionId: firstSessionId, sourceTextExcluded: true,
    })
    const stale = await readTextOpenWorldCreatorQualityWorkspaceV1({
      scope: seeded.scope, productionId: seeded.productionId, expectedBuildId: seeded.buildId,
    })
    expect(stale.fullPlaytestReceipt).toBeNull()
  })

  it('相同结局或没有真实运行时AI响应不能冒充完整试玩', async () => {
    const seeded = await fixture({ advisories: false })
    await insertCalibrationReceipt(seeded)
    const firstSessionId = await insertCompletedPlaytestRoute(seeded, 'ending.same', 'same-a')
    const secondSessionId = await insertCompletedPlaytestRoute(seeded, 'ending.same', 'same-b')
    const common = {
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
      environment: {
        browserName: 'Vitest Chromium', browserVersion: '1', platform: 'test',
        viewport: { width: 1280, height: 720 },
      },
      humanChecks: {
        personallyPlayedAllRoutes: true as const, noAutomationOrModelProxy: true as const,
        freeInputActuallyTested: true as const, allObservedProblemsReported: true as const,
      },
      assessments: fullPlaytestAssessments(4),
      costObservation: {
        source: 'not-available' as const, runtimeCostUsd: null,
        note: '服务商不能按本次路线拆分费用，但等待体验已人工记录。',
      },
      authorNote: '',
    }
    await expect(recordTextOpenWorldCreatorFullPlaytestV1({
      ...common,
      routes: [
        { sessionId: firstSessionId, reportedActiveMinutes: 80 },
        { sessionId: secondSessionId, reportedActiveMinutes: 82 },
      ],
    })).rejects.toThrow(/两个不同结局/)

    const thirdSessionId = await insertCompletedPlaytestRoute(seeded, 'ending.other', 'other')
    await db.agentRunEvents.clear()
    await db.agentRuns.clear()
    await expect(recordTextOpenWorldCreatorFullPlaytestV1({
      ...common,
      routes: [
        { sessionId: firstSessionId, reportedActiveMinutes: 80 },
        { sessionId: thirdSessionId, reportedActiveMinutes: 90 },
      ],
    })).rejects.toThrow(/至少真实完成一次玩家自由输入/)
  })

  it('低分或未解决问题只生成修复态回执，回执内容篡改会失败关闭', async () => {
    const seeded = await fixture({ advisories: false })
    await insertCalibrationReceipt(seeded)
    const firstSessionId = await insertCompletedPlaytestRoute(seeded, 'ending.one', 'one')
    const secondSessionId = await insertCompletedPlaytestRoute(seeded, 'ending.two', 'two')
    await recordTextOpenWorldCreatorIssueV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
      severity: 'blocking', category: 'gameplay', summary: '最终战斗反馈无法判断伤害来源',
      preconditions: ['进入最终战'], reproductionSteps: ['连续使用两个技能'],
      expected: '每次伤害来源清晰', actual: '两次伤害合并显示且无法区分',
      affectedStableKeys: ['combat.final'], sessionId: secondSessionId, sourceTextExcluded: true,
    })
    const assessments = fullPlaytestAssessments(4)
    assessments.find(item => item.criterionKey === 'combat-experience')!.rating = 2
    const receipt = await recordTextOpenWorldCreatorFullPlaytestV1({
      scope: seeded.scope, productionId: seeded.productionId, buildId: seeded.buildId,
      routes: [
        { sessionId: firstSessionId, reportedActiveMinutes: 75 },
        { sessionId: secondSessionId, reportedActiveMinutes: 86 },
      ],
      environment: {
        browserName: 'Vitest Chromium', browserVersion: '1', platform: 'test',
        viewport: { width: 390, height: 844 },
      },
      humanChecks: {
        personallyPlayedAllRoutes: true, noAutomationOrModelProxy: true,
        freeInputActuallyTested: true, allObservedProblemsReported: true,
      },
      assessments,
      costObservation: {
        source: 'not-available', runtimeCostUsd: null,
        note: '本次无法从后台拆分实际费用，等待时长仍由事件账本冻结。',
      },
      authorNote: '战斗低分项已登记阻断问题，进入下一Build修复。',
    })
    expect(receipt.status).toBe('needs-human')
    expect(receipt.evidence.outcome).toBe('repair-required')
    const row = await db.productQualityGateReceipts
      .where('[buildId+gateId]').equals([seeded.buildId, TEXT_OPEN_WORLD_CREATOR_FULL_PLAYTEST_GATE_ID_V1]).first()
    const tampered = JSON.parse(row!.receiptJson)
    tampered.measuredJson = tampered.measuredJson.replace('"rating":2', '"rating":5')
    await db.productQualityGateReceipts.update(row!.id!, {
      receiptJson: canonicalProductProductionJsonV2(tampered),
    })
    await expect(readTextOpenWorldCreatorQualityWorkspaceV1({
      scope: seeded.scope, productionId: seeded.productionId, expectedBuildId: seeded.buildId,
    })).rejects.toThrow(/质量回执索引或Hash无效/)
  })

  it('更新验证合同要求直接后继、逐项修复路线、真人声明和保守存档策略', () => {
    const sourceBuild = {
      productionKey: 'text-open-world.update', buildNumber: 1,
      packageHash: '1'.repeat(64), previewHash: '2'.repeat(64), manifestHash: '3'.repeat(64),
      qualityReportHash: '4'.repeat(64), rootTerminalReceiptHash: '5'.repeat(64),
    }
    const value = {
      schema: 'storyforge.text-open-world-creator-update-verification-evidence', version: 1,
      sourceBuild,
      targetBuild: {
        ...sourceBuild, buildNumber: 2, packageHash: '6'.repeat(64), previewHash: '7'.repeat(64),
        manifestHash: '8'.repeat(64), qualityReportHash: '9'.repeat(64), rootTerminalReceiptHash: 'a'.repeat(64),
      },
      sourceRelease: { releaseUid: 'release.v1', releaseVersion: 1, releaseHash: 'b'.repeat(64), packageHash: sourceBuild.packageHash },
      targetRelease: { releaseUid: 'release.v2', releaseVersion: 2, releaseHash: 'c'.repeat(64), packageHash: '6'.repeat(64) },
      sourceFullPlaytestReceiptHash: 'd'.repeat(64), targetFullPlaytestReceiptHash: 'e'.repeat(64),
      repairAuthorizationHash: 'f'.repeat(64), impactPlanHash: '0'.repeat(64),
      derivedCommandHashes: ['6'.repeat(64)],
      targetTaskKeys: ['p3.story-arc'], staleTaskKeys: ['p3.story-arc', 'p4.quest-packs'],
      issueResolutions: [{
        sourceIssueReceiptHash: '1'.repeat(64), issueKey: 'issue.combat-feedback',
        category: 'gameplay', severity: 'blocking', affectedStableKeys: ['combat.final'],
        targetRouteWitnessKeys: ['session.route.one'],
        verificationNote: '已由真人在新版最终战中重新复现，伤害来源现在分别显示。',
      }],
      lowScoreResolutions: [{
        criterionKey: 'combat-experience', sourceRating: 2, targetRating: 4,
        targetRouteWitnessKeys: ['session.route.one', 'session.route.two'],
        verificationNote: '两条新版路线均由真人确认战斗反馈已经清晰且节奏合理。',
      }],
      compatibility: { level: 'breaking', migrationPolicy: 'pin-old-save', reportHash: '2'.repeat(64) },
      saveWitness: {
        mode: 'continued-on-source-release', sourceSessionWitnessKey: 'save.source',
        sourceStateHash: '3'.repeat(64), sourceThroughSequence: 24,
        targetSessionWitnessKey: null, targetStateHash: null, migrationPreviewHash: null,
      },
      humanChecks: {
        repairedBehaviorRetested: true, oldVersionStillAvailable: true,
        savePolicyActuallyVerified: true, noAutomationOrModelProxy: true,
      },
      authorNote: '修复版已完成真人更新验证。', verifiedAt: 100,
    }
    expect(parseTextOpenWorldCreatorUpdateVerificationEvidenceV1(value).compatibility.migrationPolicy)
      .toBe('pin-old-save')
    expect(() => parseTextOpenWorldCreatorUpdateVerificationEvidenceV1({
      ...value,
      humanChecks: { ...value.humanChecks, noAutomationOrModelProxy: false },
    })).toThrow(/人工声明必须全部确认/)
    expect(() => parseTextOpenWorldCreatorUpdateVerificationEvidenceV1({
      ...value,
      saveWitness: {
        ...value.saveWitness, mode: 'explicit-migration-child',
        targetSessionWitnessKey: 'save.target', targetStateHash: '4'.repeat(64),
        migrationPreviewHash: '5'.repeat(64),
      },
    })).toThrow(/破坏性更新不能声明存档迁移/)
  })
})
