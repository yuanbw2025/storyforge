import { db } from '../../src/lib/db/schema'
import {
  confirmTextOpenWorldCreatorBriefV1,
  startTextOpenWorldCreatorBriefSessionV1,
} from '../../src/lib/open-world/creator-brief'
import { createTextOpenWorldCreatorSourceLocatorV1 } from '../../src/lib/open-world/creator-brief-persistence'
import {
  confirmTextOpenWorldCreatorProductionPreflightV1,
  createTextOpenWorldCreatorProductionPreflightV1,
} from '../../src/lib/open-world/creator-production-preflight'
import {
  inspectTextOpenWorldCreatorNovelSourceV1,
  inspectTextOpenWorldCreatorWorldSourceV1,
} from '../../src/lib/open-world/creator-source'
import {
  previewTextOpenWorldCreatorProductionStartV1,
} from '../../src/lib/product-production/service'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import type {
  AdaptationSourceSelectionV1,
  AIConfig,
  TextOpenWorldCreatorSourceSelectionV1,
  WorkspaceScope,
} from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { stampNewRecord } from '../../src/lib/workspace/scope'

const TEST_AI_CONFIG: AIConfig = {
  provider: 'deepseek',
  apiKey: 'source-pin-creator-anchor-test-key',
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com/v1',
  temperature: 0.7,
  maxTokens: 0,
}

const BRIEF_ACKNOWLEDGEMENTS = {
  sourceIdentityReviewed: true,
  productBoundaryReviewed: true,
  unresolvedItemsClosed: true,
  directPublishWorkflowReviewed: true,
} as const

const PREFLIGHT_ACKNOWLEDGEMENT = {
  credentialPolicyReviewed: true,
  providerAndModelReviewed: true,
  priceAndBudgetReviewed: true,
  mediaCostBoundaryReviewed: true,
} as const

type CreatorSourceForTestV1 =
  | {
      kind: 'world-release'
      scope: WorkspaceScope
      localReleaseRecordId: number
      expectedReleaseHash: string
    }
  | {
      kind: 'novel'
      scope: WorkspaceScope
      selection: AdaptationSourceSelectionV1
    }

async function creatorSelection(source: CreatorSourceForTestV1): Promise<TextOpenWorldCreatorSourceSelectionV1> {
  if (source.kind === 'world-release') {
    const preview = await inspectTextOpenWorldCreatorWorldSourceV1({
      scope: source.scope,
      localReleaseRecordId: source.localReleaseRecordId,
      expectedReleaseHash: source.expectedReleaseHash,
    })
    return {
      sourceKind: 'world-release',
      sourceScope: source.scope,
      localReleaseRecordId: source.localReleaseRecordId,
      expectedReleaseHash: source.expectedReleaseHash,
      preview,
    }
  }
  const preview = await inspectTextOpenWorldCreatorNovelSourceV1({
    sourceScope: source.scope,
    selection: source.selection,
  })
  return {
    sourceKind: 'novel',
    sourceScope: source.scope,
    selection: source.selection,
    preview,
  }
}

/**
 * Seed a minimal formal Creator authorization anchor. Public compilers produce
 * every hash-closed contract; the test-only persistence mirrors the successful
 * Start transaction so SourcePin tests do not need to run the production queue.
 */
export async function seedAuthorizedTextOpenWorldCreatorBuildV1(input: {
  source: CreatorSourceForTestV1
  sessionKey: string
}) {
  const selection = await creatorSelection(input.source)
  const baseTime = Date.now() - 1_000
  const started = await startTextOpenWorldCreatorBriefSessionV1({
    selection,
    sessionKey: input.sessionKey,
    createdAt: baseTime,
  })
  const confirmed = await confirmTextOpenWorldCreatorBriefV1({
    session: started,
    draft: {
      ...started.draft,
      gameTitle: `SourcePin ${input.sessionKey}`,
      coreGoal: '只从作者冻结来源生产可验证的文字开放世界。',
    },
    acknowledgements: BRIEF_ACKNOWLEDGEMENTS,
    confirmedAt: baseTime + 1,
  })
  const brief = confirmed.confirmedBrief
  if (!brief) throw new Error('测试 Creator Brief 未确认')
  const preflight = await createTextOpenWorldCreatorProductionPreflightV1({
    brief,
    projectId: confirmed.scope.projectId,
    aiConfig: TEST_AI_CONFIG,
    rememberApiKey: false,
    pricing: { mode: 'catalog' },
  })
  const confirmation = await confirmTextOpenWorldCreatorProductionPreflightV1({
    brief,
    preflight,
    projectId: confirmed.scope.projectId,
    aiConfig: TEST_AI_CONFIG,
    rememberApiKey: false,
    acknowledgement: PREFLIGHT_ACKNOWLEDGEMENT,
    confirmedAt: baseTime + 2,
  })
  const startInput = {
    scope: confirmed.scope,
    productionId: confirmed.production.id,
    briefRevision: brief.revision,
    briefHash: brief.briefHash,
    expectedStateRevision: confirmed.production.stateRevision,
    sourceLocator: createTextOpenWorldCreatorSourceLocatorV1(confirmed.selection!),
    preflight,
    confirmation,
    rightsBasis: 'author-owned' as const,
    rightsNote: '作者确认拥有当前来源的改编与生产权利。',
    authorizationNonce: `source-pin-${input.sessionKey}`,
    authorizedAt: baseTime + 3,
  }
  const previousAIState = useAIConfigStore.getState()
  useAIConfigStore.setState({
    config: structuredClone(TEST_AI_CONFIG),
    rememberApiKey: false,
    presets: [],
    taskRoutes: {},
  })
  try {
    const preview = await previewTextOpenWorldCreatorProductionStartV1(startInput)
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]')
      .equals([confirmed.production.id, brief.revision])
      .first()
    if (!briefRow?.id) throw new Error('测试 Creator Brief 行不存在')
    const emptyHash = await hashProductProductionValueV2({})
    const buildId = await db.productBuilds.add(stampNewRecord(confirmed.scope, 'productBuilds', {
      projectId: confirmed.scope.projectId,
      worldId: confirmed.scope.worldId,
      workId: confirmed.scope.workId,
      productionId: confirmed.production.id,
      buildNumber: preview.buildNumber,
      briefRevision: brief.revision,
      briefHash: brief.briefHash,
      parentBuildNumber: null,
      sourceProductReleaseId: null,
      status: 'authorized',
      resumeState: null,
      stateRevision: 0,
      controlEpoch: preview.plan.controlEpoch,
      planRevision: 1,
      planJson: canonicalProductProductionJsonV2(preview.plan),
      planHash: preview.start.productionPlanHash,
      budgetLedgerJson: '{}',
      manifestJson: '{}',
      manifestHash: emptyHash,
      packageHash: '',
      previewManifestJson: '{}',
      previewHash: '',
      qualityReportJson: '{}',
      qualityReportHash: emptyHash,
      compatibilityJson: '{}',
      rootTerminalReceiptHash: null,
      adoptionIntentHash: null,
      releasedProductReleaseId: null,
      failureJson: '{}',
      authorizedAt: preview.start.authorizedAt,
      startedAt: null,
      completedAt: null,
      createdAt: preview.start.authorizedAt,
      updatedAt: preview.start.authorizedAt,
    } as never, { owner: 'work' })) as number
    await db.productProductionBriefs.update(briefRow.id, {
      status: 'authorized',
      sourcePlanJson: canonicalProductProductionJsonV2(preview.sourcePlan),
      sourcePlanHash: preview.sourcePlan.planHash,
      confirmedBriefJson: canonicalProductProductionJsonV2(preview.start),
      confirmedBriefHash: preview.start.startHash,
      authorizedAt: preview.start.authorizedAt,
    })
    await db.productProductions.update(confirmed.production.id, {
      status: 'producing',
      currentBuildNumber: preview.buildNumber,
      stateRevision: confirmed.production.stateRevision + 1,
      updatedAt: preview.start.authorizedAt,
    })
    const commandId = 'text-open-world.start.' + confirmation.confirmationHash.slice(0, 16)
      + '.' + preview.start.productionPlanHash.slice(0, 12)
    const command = {
      type: 'authorize-text-open-world-creator-start' as const,
      commandId,
      expectedStateRevision: startInput.expectedStateRevision,
      briefRevision: startInput.briefRevision,
      briefHash: startInput.briefHash,
      sourceLocator: startInput.sourceLocator,
      preflight,
      confirmation,
      rightsBasis: startInput.rightsBasis,
      rightsNote: startInput.rightsNote,
      authorizationNonce: startInput.authorizationNonce,
      expectedPlanHash: preview.start.productionPlanHash,
      authorizedAt: startInput.authorizedAt,
    }
    await db.productProductionCommands.add(stampNewRecord(confirmed.scope, 'productProductionCommands', {
      projectId: confirmed.scope.projectId,
      worldId: confirmed.scope.worldId,
      workId: confirmed.scope.workId,
      productionId: confirmed.production.id,
      commandId,
      type: command.type,
      payloadHash: await hashProductProductionValueV2(command),
      expectedStateRevision: startInput.expectedStateRevision,
      status: 'succeeded',
      resultJson: canonicalProductProductionJsonV2({
        buildId,
        buildNumber: preview.buildNumber,
        briefRevision: brief.revision,
        briefHash: brief.briefHash,
        sourcePlanHash: preview.sourcePlan.planHash,
        planHash: preview.start.productionPlanHash,
        startHash: preview.start.startHash,
      }),
      errorCode: null,
      createdAt: preview.start.authorizedAt,
      completedAt: preview.start.authorizedAt,
    } as never, { owner: 'work' }))
    return {
      scope: confirmed.scope,
      productionId: confirmed.production.id,
      productionKey: brief.productInstanceKey,
      buildId,
      buildNumber: preview.buildNumber,
      controlEpoch: preview.plan.controlEpoch,
      planHash: preview.start.productionPlanHash,
      brief,
      sourcePlan: preview.sourcePlan,
      start: preview.start,
      authorization: {
        productInstanceKey: brief.productInstanceKey,
        briefRevision: brief.revision,
        briefHash: brief.briefHash,
        authorStartRevision: preview.start.authorStartRevision,
        authorizationNonce: preview.start.authorizationNonceHash,
        rightsBasis: preview.start.rightsBasis,
        rightsNote: preview.start.rightsNote,
        authorizedAt: preview.start.authorizedAt,
      },
    }
  } finally {
    useAIConfigStore.setState(previousAIState)
  }
}
