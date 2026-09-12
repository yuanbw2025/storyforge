import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  finalizeTextOpenWorldCreatorQualityV1,
  portableTextOpenWorldCreatorIssueJsonV1,
  readTextOpenWorldCreatorQualityWorkspaceV1,
  recordTextOpenWorldCreatorGrayboxV1,
  recordTextOpenWorldCreatorIssueV1,
  requirePassedTextOpenWorldCreatorQualityGateV1,
  waiveTextOpenWorldCreatorAdvisoryIssueV1,
} from '../../src/lib/open-world/creator-quality'
import {
  TEXT_OPEN_WORLD_CREATOR_GRAYBOX_COVERAGE_KEYS_V1,
  TEXT_OPEN_WORLD_CREATOR_GRAYBOX_GATE_ID_V1,
  parseTextOpenWorldCreatorGrayboxEvidenceV1,
} from '../../src/lib/open-world/creator-quality-contract'
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
  readProductRuntimeState: vi.fn(async () => structuredClone(runtimeEvidence.state)),
  readProductRuntimeStateVersion: vi.fn(async () => ({
    sequence: runtimeEvidence.sequence,
    stateHash: runtimeEvidence.stateHash,
  })),
  verifyProductRuntimeCheckpoint: vi.fn(async () => true),
}))

vi.mock('../../src/lib/open-world/checkpoints', () => ({
  inspectTextOpenWorldRuntimeHeadV1: vi.fn(async () => ({
    code: 'valid', canonicalStateHash: runtimeEvidence.stateHash,
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
  const scores = [{ metricKey, score: advisory ? 80 : 90, rationale: `${kind}评审理由足够具体` }]
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

beforeEach(async () => {
  await db.delete()
  await db.open()
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
})
