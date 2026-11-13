import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  createTextOpenWorldCreatorStartPreparationV1,
  type TextOpenWorldCreatorStartPreparationV1,
} from '../../src/lib/open-world/creator-production-start'
import {
  TEXT_OPEN_WORLD_CREATOR_ENDING_COUNT_V1,
  TEXT_OPEN_WORLD_CREATOR_ENDING_COUNT_ERROR_V1,
  isTextOpenWorldCreatorEndingCountV1,
} from '../../src/lib/open-world/creator-ending-count'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  inspectTextOpenWorldCreatorWorldSourceV1,
  listTextOpenWorldCreatorProtagonistChoicesV1,
} from '../../src/lib/open-world/creator-source'
import {
  textOpenWorldCreatorSourceBindingFromSelectionV1,
  textOpenWorldCreatorSourceSummaryFromSelectionV1,
} from '../../src/lib/open-world/creator-brief-persistence'
import {
  confirmTextOpenWorldCreatorProductionPreflightV1,
  createTextOpenWorldCreatorProductionPreflightV1,
} from '../../src/lib/open-world/creator-production-preflight'
import {
  authorizeTextOpenWorldCreatorProductionStartV1,
  previewTextOpenWorldCreatorProductionStartV1,
} from '../../src/lib/product-production/service'
import type {
  AIConfig,
  ProductProductionBriefRecordV1,
  ProductProductionRecordV1,
  TextOpenWorldCreatorBriefV1,
} from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

// Create a synthetic, historically signed Brief to exercise the formal production
// start boundary even when current authoring already rejects a single ending.
const AI_CONFIG: AIConfig = {
  provider: 'deepseek',
  apiKey: 'creator-start-merge-gates-synthetic-key',
  model: 'deepseek-v4-flash',
  baseUrl: 'https://api.deepseek.com/v1',
  temperature: 0.7,
  maxTokens: 0,
}

const PREFLIGHT_ACKNOWLEDGEMENT = {
  credentialPolicyReviewed: true,
  providerAndModelReviewed: true,
  priceAndBudgetReviewed: true,
  mediaCostBoundaryReviewed: true,
} as const

const originalAIState = useAIConfigStore.getState()

async function productionFootprint() {
  return {
    productions: await db.productProductions.toArray(),
    briefs: await db.productProductionBriefs.toArray(),
    commands: await db.productProductionCommands.toArray(),
    builds: await db.productBuilds.toArray(),
    runs: await db.agentRuns.toArray(),
    releases: await db.worldReleases.toArray(),
    receipts: await db.worldSourceReceipts.toArray(),
  }
}

function draft(overridesEndings: number): TextOpenWorldCreatorBriefV1['draft'] {
  return {
    schema: 'storyforge.text-open-world-creator-brief-draft' as const,
    version: 1 as const,
    gameTitle: '合并门合成校验',
    playerRole: '调查者',
    playerFantasy: '在冻结尾声处做出选择。',
    protagonistMode: 'source-character' as const,
    protagonistDirective: '保持来源角色身份。',
    coreGoal: '完成可验证主线。',
    primaryConflict: '冻结来源的冲突必须在来源边界内解决。',
    openingSituation: '调查者在起点发现第一处异常。',
    experiencePillars: ['受保护主线', '有后果的局部自由'],
    toneKeywords: ['克制'],
    mustKeep: ['来源事实'],
    allowedInferences: ['局部对白'],
    forbiddenChanges: ['不得改写冻结来源'],
    contentRating: 'all-ages',
    contentBoundaries: ['无血腥'],
    authorNotes: '',
    unresolvedQuestions: [],
    acceptedAssumptions: [],
    scale: {
      regions: 3,
      namedLocations: { minimum: 3, maximum: 6 },
      mainlineStages: { minimum: 3, maximum: 6 },
      endings: overridesEndings,
      significantStorylines: 2,
      ordinaryQuests: { minimum: 2, maximum: 4 },
      taskTemplates: { minimum: 2, maximum: 4 },
      randomEvents: { minimum: 2, maximum: 4 },
      requiredPlayMinutes: { minimum: 60, maximum: 90 },
      optionalInventoryMinutes: { minimum: 5, maximum: 15 },
    },
    media: {
      proceduralMap: 'required' as const,
      characterPortraits: 'required' as const,
      sceneBackgrounds: 'required' as const,
      audio: 'none' as const,
      artDirection: '冷色港口插画风格。',
    },
    completion: {
      playablePreviewRequired: true,
      deterministicGatesRequired: true,
      semanticReviewRequired: true,
      publishAfterGates: true,
      humanPlaytest: 'post-release' as const,
      repairPolicy: 'new-release' as const,
    },
  }
}

async function seedCreatorStart(input: { endings: number; name: string }) {
  const { scope, release } = await seedCurrentProductWorld(`${input.name} 冻结来源`)
  const productionRow = {
    creatorSourceKind: 'world-release' as const,
    creatorSourceWorldReleaseId: release.id!,
    creatorSourceWorkId: null,
    creatorSourceSelectionMode: null,
    creatorSourceOutlineRootId: null,
    creatorSourceStartChapterId: null,
    creatorSourceEndChapterId: null,
    creatorSourceChapterIdsJson: '[]',
    creatorSourceVersionHash: release.contentHash,
    creatorSourceBoundaryHash: '9'.repeat(64),
    creatorSourceBindingJson: '{}',
    creatorSourceBindingHash: 'e'.repeat(64),
  }
  const productionBody = stampNewRecord(scope, 'productProductions', {
    ...productionRow,
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    productionKey: `productprod.merge-gates.${input.name.replace(/\W+/g, '-')}`,
    productType: 'text-open-world' as const,
    title: '合并门合成校验',
    status: 'brief-ready' as const,
    stateRevision: 4,
    controlEpoch: 0,
    currentBriefRevision: 1,
    currentBuildNumber: null,
    currentProductReleaseId: null,
    lastErrorJson: '{}',
    createdAt: Date.now() - 20_000, updatedAt: Date.now() - 20_000,
  } satisfies ProductProductionRecordV1, { owner: 'work' })
  const productionId = await db.productProductions.add(productionBody) as number
  // The binding and summary are the real ones for this frozen release, so the
  // SourcePlan CAS below is genuine. No purpose proof is bound here, exactly
  // like a pre-purpose historical Brief: the start locator supplies the #370
  // witness under test.
  const preview = await inspectTextOpenWorldCreatorWorldSourceV1({
    scope,
    localReleaseRecordId: release.id!,
    expectedReleaseHash: release.contentHash,
  })
  const selection = {
    sourceKind: 'world-release' as const,
    sourceScope: scope,
    localReleaseRecordId: release.id!,
    expectedReleaseHash: release.contentHash,
    preview,
  }
  const [selectedProtagonist] = await listTextOpenWorldCreatorProtagonistChoicesV1(selection)
  if (!selectedProtagonist) throw new Error('The frozen fixture requires a selectable character')
  const sourceBinding = textOpenWorldCreatorSourceBindingFromSelectionV1(selection)
  const brief = {
    schema: 'storyforge.text-open-world-creator-brief' as const,
    version: 1 as const,
    productInstanceKey: productionBody.productionKey,
    revision: 1,
    sourceBinding,
    sourceBindingHash: await hashCanonicalValue(sourceBinding),
    sourceSummary: textOpenWorldCreatorSourceSummaryFromSelectionV1(selection),
    draft: { ...draft(input.endings), protagonistSourceResourceKey: selectedProtagonist.resourceKey },
    productBoundary: {
      freedomModel: 'bounded-guided' as const,
      mainlineStructure: 'strict-sequential-with-multiple-endings' as const,
      mainlineWaitsForPlayer: true,
      significantStorylinesWaitAtSafePoints: true,
      ordinaryWorldContinues: true,
      criticalActorsProtected: true,
      criticalItemsProtected: true,
      freeTextPolicy: 'respond-then-redirect-or-reject' as const,
      unsupportedSolutionPolicy: 'declared-actions-only' as const,
      combatMode: 'turn-based-four-actions' as const,
      difficulty: 'standard' as const,
      locationOnlyCriticalTriggersForbidden: true,
    },
    confirmation: {
      sourceIdentityReviewed: true, productBoundaryReviewed: true,
      unresolvedItemsClosed: true, directPublishWorkflowReviewed: true,
    },
    candidateEvidence: {
      candidateHash: 'a'.repeat(64), runBindingHash: 'b'.repeat(64),
      origin: 'author' as const, contextManifestHashes: ['d'.repeat(64)],
    },
    confirmedAt: Date.now() - 15_000,
    briefHash: '',
  } satisfies TextOpenWorldCreatorBriefV1
  const { briefHash: _empty, ...body } = brief
  void _empty
  const verified: TextOpenWorldCreatorBriefV1 = {
    ...body,
    briefHash: await hashCanonicalValue(body),
  }
  await db.productProductionBriefs.add(stampNewRecord(scope, 'productProductionBriefs', {
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    productionId, revision: 1, parentRevision: null, status: 'draft' as const,
    briefKind: 'text-open-world-creator-v1' as const,
    sourceKind: 'world-release' as const,
    sourceWorldReleaseId: release.id!,
    sourceWorldContentHash: release.contentHash,
    sourceVersionHash: release.contentHash,
    sourceBoundaryHash: verified.sourceBinding.kind === 'world-release'
      ? verified.sourceBinding.referenceHash : verified.sourceBinding.sourceBoundaryHash,
    sourceBindingJson: JSON.stringify(verified.sourceBinding),
    sourceBindingHash: verified.sourceBindingHash,
    candidateRunId: null,
    userIntentSummary: verified.draft.coreGoal,
    unresolvedJson: '[]',
    estimateJson: JSON.stringify({ scale: verified.draft.scale, media: verified.draft.media,
      completion: verified.draft.completion }),
    briefJson: JSON.stringify(verified),
    briefHash: verified.briefHash,
    sourcePlanJson: '{}',
    sourcePlanHash: 'c'.repeat(64),
    confirmedBriefJson: '{}',
    confirmedBriefHash: '',
    authorizedAt: null,
    createdAt: Date.now() - 15_000,
  } satisfies ProductProductionBriefRecordV1, { owner: 'work' }))
  // Brief row and production row must carry the same portable binding hash.
  await db.productProductions.update(productionId, {
    creatorSourceBindingJson: JSON.stringify(verified.sourceBinding),
    creatorSourceBindingHash: verified.sourceBindingHash,
  })
  return {
    scope, release, productionId, selectedProtagonist,
    production: { ...productionBody, id: productionId, creatorSourceBindingHash: verified.sourceBindingHash },
    brief: verified,
  }
}

async function startInput(fixture: Awaited<ReturnType<typeof seedCreatorStart>>) {
  const baseTime = Date.now() - 1_000
  const preflight = await createTextOpenWorldCreatorProductionPreflightV1({
    brief: fixture.brief, projectId: fixture.scope.projectId,
    aiConfig: AI_CONFIG, rememberApiKey: false, pricing: { mode: 'catalog' },
  })
  const confirmation = await confirmTextOpenWorldCreatorProductionPreflightV1({
    brief: fixture.brief, preflight, projectId: fixture.scope.projectId,
    aiConfig: AI_CONFIG, rememberApiKey: false,
    acknowledgement: PREFLIGHT_ACKNOWLEDGEMENT, confirmedAt: baseTime,
  })
  const sourcePurpose = fixture.brief.sourceBinding.kind === 'world-release'
    ? fixture.brief.sourceBinding.sourcePurpose
    : undefined
  return {
    scope: fixture.scope,
    productionId: fixture.productionId,
    briefRevision: 1,
    briefHash: fixture.brief.briefHash,
    expectedStateRevision: fixture.production.stateRevision,
    sourceLocator: {
      kind: 'world-release' as const,
      localReleaseRecordId: fixture.release.id!,
      expectedReleaseHash: fixture.release.contentHash,
      ...(sourcePurpose ? { sourcePurpose } : {}),
    },
    preflight,
    confirmation,
    aiConfig: AI_CONFIG,
    rememberApiKey: false,
    rightsBasis: 'author-owned' as const,
    rightsNote: '作者确认拥有当前来源的改编与生产权利。',
    authorizationNonce: 'merge-gates.synthetic',
    authorizedAt: baseTime + 1,
  }
}

describe('Creator 正式启动 · 结局门与来源用途门同一入口', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useAIConfigStore.setState({ config: structuredClone(AI_CONFIG), rememberApiKey: false, presets: [], taskRoutes: {} })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('No external transport is authorized') }))
  })
  afterEach(() => {
    try { expect(fetch).not.toHaveBeenCalled() } finally {
      db.close()
      useAIConfigStore.setState(originalAIState)
      vi.unstubAllGlobals()
    }
  })


  it('反例：1 个结局先被生产准备快照的结局门拒绝', async () => {
    const fixture = await seedCreatorStart({ endings: 1, name: 'ending-denied' })
    expect(isTextOpenWorldCreatorEndingCountV1(fixture.brief.draft.scale.endings)).toBe(false)
    const before = await productionFootprint()
    await expect(createTextOpenWorldCreatorProductionPreflightV1({
      brief: fixture.brief, projectId: fixture.scope.projectId,
      aiConfig: AI_CONFIG, rememberApiKey: false, pricing: { mode: 'catalog' },
    })).rejects.toThrow(TEXT_OPEN_WORLD_CREATOR_ENDING_COUNT_ERROR_V1)
    expect(await productionFootprint()).toEqual(before)
    expect(await db.productBuilds.where('productionId').equals(fixture.productionId).count()).toBe(0)
  })

  it('反例：正式启动准备入口拒绝 1 个结局，不生成 SourcePlan/Start/Plan/Build', async () => {
    const fixture = await seedCreatorStart({ endings: 1, name: 'ending-denied-start' })
    // 真实准备快照只接受合规 Brief，因此这里用同一 Brief 的合规副本取得
    // 快照，再把落库 Brief 换成旧单结局版：结局门必须在 SourcePlan 与来源
    // 用途见证之前结束，并保持生产链零写入。
    const valid = await seedCreatorStart({ endings: 2, name: 'ending-allowed-base' })
    const input = await startInput(valid)
    const before = await productionFootprint()
    await expect(createTextOpenWorldCreatorStartPreparationV1({
      ...input,
      scope: fixture.scope,
      productionId: fixture.productionId,
      briefHash: fixture.brief.briefHash,
    })).rejects.toThrow(TEXT_OPEN_WORLD_CREATOR_ENDING_COUNT_ERROR_V1)
    expect(await productionFootprint()).toEqual(before)
    expect(await db.productBuilds.where('productionId').equals(fixture.productionId).count()).toBe(0)
  })

  it('正例：2 个结局通过同一入口，并在同一准备中生成来源用途事务外见证', async () => {
    const fixture = await seedCreatorStart({ endings: 2, name: 'gates-allowed' })
    expect(isTextOpenWorldCreatorEndingCountV1(2)).toBe(true)
    expect(isTextOpenWorldCreatorEndingCountV1(TEXT_OPEN_WORLD_CREATOR_ENDING_COUNT_V1.maximum + 1)).toBe(false)
    const before = await productionFootprint()
    const input = await startInput(fixture)
    const prepared: TextOpenWorldCreatorStartPreparationV1 =
      await createTextOpenWorldCreatorStartPreparationV1(input)
    expect(prepared.start.executionBrief.scale.targetEndingCount).toBe(2)
    expect(prepared.start.executionBrief.intent.protagonistRefs).toEqual([fixture.selectedProtagonist.resourceKey])
    expect(prepared.start.executionBrief.source.startingPoint.protagonistRefs).toEqual([fixture.selectedProtagonist.resourceKey])
    expect(prepared.worldSourcePurposeCasWitness).not.toBeNull()
    expect(prepared.worldSourcePurposeCasWitness!.input.worldReleaseId).toBe(fixture.release.id)
    expect(prepared.worldSourcePurposeCasWitness!.input.purpose).toBe('text-open-world')
    expect(prepared.novelSourceCasWitness).toBeNull()
    // 准备与预览都是零写入边界。
    expect(await productionFootprint()).toEqual(before)
    const preview = await previewTextOpenWorldCreatorProductionStartV1(input)
    expect(preview.start.startHash).toBe(prepared.start.startHash)
    expect(await productionFootprint()).toEqual(before)
    expect(typeof authorizeTextOpenWorldCreatorProductionStartV1).toBe('function')
  })
})
