import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readContextGatewayManifestV3ForAttemptV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { readTextAdventureRepairFeedbackV1 } from '../../src/lib/product-production/context'
import {
  canonicalProductProductionJsonV2,
  hashProductProductionValueV2,
} from '../../src/lib/product-production/hash'
import {
  acceptProductBuildArtifact,
  carryForwardProductBuildArtifactsAcrossBuildsV1,
  carryForwardProductBuildArtifactsToEpochV1,
} from '../../src/lib/product-production/artifact-store'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import {
  assertProductProductionBudgetLedgerV1,
  runProductProductionSchedulerCycleV1,
  runProductProductionUntilBlockedV1,
  ProductProductionDraftRejectedErrorV1,
  textAdventureInvalidQualityRollbackSourceV1,
  invalidTextAdventureQualityReviewRollbackEpochV1,
  textAdventureQualityRollbackAlreadyAppliedV1,
  recoveryInvalidatedTaskKeys,
  executionBindingDriftInvalidatedTaskKeysV1,
  effectiveTextProviderConcurrencyV1,
  textAdventureTaskFailures,
  textAdventureNarrativeRepairPreservesFrozenMediaV1,
  activeTextAdventureQualityRepairCauseV1,
  latestConfirmedTextAdventureAnchorRecoveryEpochV1,
  regressedTextAdventureQualityPassEpochV1,
  textAdventureRecoveryUsesQualityRollbackV1,
  productProductionArtifactEligibleForSyntheticCarryV1,
  selectProductBuildCompatibilityBaselineV1,
  type ProductProductionTaskExecutionResultV1,
  type ProductProductionTaskExecutorV1,
} from '../../src/lib/product-production/scheduler'
import type { ProductBuildArtifactKindV1, ProductRuntimePackageV1 } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { resolveProductProductionWorldCompilationDescriptorsV2 } from '../../src/lib/product-production/world-source'
import { AIError } from '../../src/lib/types'
import { AICompletionResponseErrorV1 } from '../../src/lib/ai/completion-response'
import { readProductProductionTaskEvidenceV1 } from '../../src/lib/product-production/service'
import { readProductProductionRepairFeedback } from '../../src/lib/product-production/context'
import {
  textAdventureQualityArcRepairTaskKeysV1,
  textAdventureQualityChoiceCopyOnlyRepairV1,
  textAdventureQualityExecutableRecommendationV1,
  textAdventureQualityIssueOwnerArtifactKeyV1,
  textAdventureQualityIssueSupersededByCompiledEchoV1,
  textAdventureQualityReviewFactualContradictionV1,
  textAdventureQualityReviewAuthorityViolationsV1,
  textAdventureQualityReviewBatchCoverageViolationsV1,
  textAdventureQualityReviewReferenceViolationsV1,
  textAdventureQualityResolveArtifactOwningKeyV1,
  textAdventureQualityScopeSafeIssueV1,
  normalizeTextAdventureQualityStableReferenceV1,
} from '../../src/lib/product-production/text-adventure-quality'

async function fixture(name: string, extraFactsOrOptions: string[] | { retryModelCallHeadroom?: number } = {}) {
  const extraFacts = Array.isArray(extraFactsOrOptions) ? extraFactsOrOptions : []
  const options = Array.isArray(extraFactsOrOptions) ? {} : extraFactsOrOptions
  const owned = await seedCurrentProductWorld(name)
  const release = owned.release
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
  const draftedBrief = await draftProductProductionBriefV3({
    scope: owned.scope, worldReleaseId: release.id!, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'avg', scale: 'scene', visualLevel: 'none', audioLevel: 'none',
    requiredFacts: ['冻结世界事实保持一致', ...extraFacts], forbiddenChanges: ['不得写回世界正式表'],
  })
  const brief = options.retryModelCallHeadroom
    ? {
        ...draftedBrief,
        productionBudget: {
          ...draftedBrief.productionBudget,
          maximumModelCalls: draftedBrief.productionBudget.maximumModelCalls
            + options.retryModelCallHeadroom,
          // The v2 append-only ledger conservatively holds the full frozen
          // reservation when a provider result is unknown. A fixture that
          // authorizes extra calls must therefore authorize the matching
          // input/output/time envelope as well; call count alone is not a
          // truthful retry budget.
          maximumInputTokens: draftedBrief.productionBudget.maximumInputTokens
            + Math.floor(draftedBrief.productionBudget.maximumInputTokens / 5)
              * options.retryModelCallHeadroom,
          maximumOutputTokens: draftedBrief.productionBudget.maximumOutputTokens
            + Math.floor(draftedBrief.productionBudget.maximumOutputTokens / 4)
              * options.retryModelCallHeadroom,
          maximumDurationMs: draftedBrief.productionBudget.maximumDurationMs
            + Math.floor(draftedBrief.productionBudget.maximumDurationMs / 8)
              * options.retryModelCallHeadroom,
        },
      }
    : draftedBrief
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: `${name}.intent`, productionKey: `${name}.production`,
      productType: 'avg', worldReleaseId: release.id!, userText: `${name} 自动生产`,
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: `${name}.brief`, expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: `${name}.start`, expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: `${name}.click`,
    },
  })
  return { ...owned, productionId: created.productionId, brief }
}

async function textAdventureQualityRecoveryFixture(name: string) {
  const owned = await seedCurrentProductWorld(name)
  const worldReleaseId = owned.release.id!
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId })
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope,
    worldReleaseId,
    suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'text-adventure',
    qualityProfile: 'prototype',
    scale: 'short-arc',
    visualLevel: 'none',
    audioLevel: 'none',
    playerRole: '扮演林舟',
    openingSituation: '在潮门关闭前作出选择。',
    coreExperience: ['选择与后果'],
    requiredFacts: ['潮门只在满月开启'],
    forbiddenChanges: ['不得改写冻结世界'],
    contentBoundaries: ['不含露骨内容'],
    tone: ['克制', '紧张'],
    textAdventure: { confirmAll: true },
  })
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: `${name}.intent`, productionKey: `${name}.production`,
      productType: 'text-adventure', worldReleaseId, userText: `${name} 质量审查恢复`,
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: `${name}.brief`, expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: `${name}.start`, expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string,
      authorizationNonce: `${name}.click`,
    },
  })
  const build = (await db.productBuilds
    .where('[productionId+buildNumber]').equals([created.productionId, 1]).first())!
  const recoveryPlan = await createProductProductionPlanV3({
    brief,
    briefHash: saved.result.briefHash as string,
    buildNumber: build.buildNumber,
    controlEpoch: build.controlEpoch + 1,
  })
  return { ...owned, productionId: created.productionId, brief, build, recoveryPlan }
}

function failedTextAdventureReview(input: {
  issues: Array<{ severity: 'warning' | 'blocking'; artifactKey: string; detail: string; recommendation: string }>
  pacing?: number
}) {
  return {
    schema: 'storyforge.text-adventure-quality-review-artifact', version: 1,
    scores: {
      causality: 5, playerAgency: 5, routeDifferentiation: 5, pacing: input.pacing ?? 5,
      setupPayoff: 5, characterMotivation: 5, emotionalImpact: 5,
    },
    issues: input.issues,
    passed: false,
  }
}

async function seedFrozenTextAdventureQualityReviewEpoch(input: {
  fixture: Awaited<ReturnType<typeof textAdventureQualityRecoveryFixture>>
  issueScope: 'structure' | 'act-1' | 'act-2' | 'act-3'
  issue: { severity: 'warning' | 'blocking'; artifactKey: string; detail: string; recommendation: string }
}) {
  const { build } = input.fixture
  const sourcePayloads: Record<string, Record<string, unknown>> = {
    'content.adventure-architecture': {
      schema: 'fixture.architecture', version: 1,
      regions: [{ areas: [{ locations: [{ key: 'location.1' }, { key: 'location.2' }, { key: 'location.3' }] }] }],
    },
    'content.narrative-arc-plan': {
      schema: 'fixture.arc', version: 1,
      acts: [
        { key: 'act.1', sceneCards: [{ key: 'scene.001' }] },
        { key: 'act.2', sceneCards: [{ key: 'scene.002' }] },
        { key: 'act.3', sceneCards: [{ key: 'scene.003' }] },
      ],
      decisions: [{
        key: 'decision.001', sceneKey: 'scene.001',
        options: [{
          key: 'option.001.a', persistentEffectKey: 'flag.decision.001.a',
          echoSceneKeys: ['scene.002'],
        }, {
          key: 'option.001.b', persistentEffectKey: 'flag.decision.001.b',
          echoSceneKeys: ['scene.002'],
        }],
      }],
      endings: [{ endingKey: 'ending.001', sceneKey: 'scene.003' }],
    },
    'content.narrative': {
      schema: 'fixture.narrative', version: 1,
      entryNodeKey: 'scene.001',
      choices: [
        { choiceKey: 'choice.001', sourceNodeKey: 'scene.001', targetNodeKey: 'scene.002' },
        { choiceKey: 'choice.002', sourceNodeKey: 'scene.002', targetNodeKey: 'scene.003' },
        { choiceKey: 'choice.003', sourceNodeKey: 'scene.003', targetNodeKey: 'ending.001' },
      ],
    },
    'content.main-quest-plan': {
      schema: 'fixture.main-quest', version: 1,
      quests: [{ objectives: [
        { key: 'objective.001', sceneKeys: ['scene.001'], alternatives: [{ key: 'alternative.001.a' }] },
        { key: 'objective.002', sceneKeys: ['scene.002'], alternatives: [{ key: 'alternative.002.a' }] },
        { key: 'objective.003', sceneKeys: ['scene.003'], alternatives: [{ key: 'alternative.003.a' }] },
      ] }],
    },
  }
  const sourceRows = []
  for (const [artifactKey, payload] of Object.entries(sourcePayloads)) {
    sourceRows.push(await acceptProductBuildArtifact({
      scope: input.fixture.scope,
      buildId: build.id!,
      controlEpoch: build.controlEpoch,
      artifactKey,
      kind: 'narrative',
      payload,
      inputHash: '1'.repeat(64),
      producerReceiptHash: '2'.repeat(64),
    }))
  }
  const sourceHashes = sourceRows.map(row => ({
    artifactKey: row.artifactKey,
    contentHash: row.contentHash,
  })).sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
  const scopeSceneKeys = {
    structure: ['scene.001', 'scene.002', 'scene.003'],
    'act-1': ['scene.001'],
    'act-2': ['scene.002'],
    'act-3': ['scene.003'],
  } as const
  const scopes = ['structure', 'act-1', 'act-2', 'act-3'] as const
  for (const scope of scopes) {
    const issues = scope === input.issueScope ? [input.issue] : []
    const scores = scope === 'structure'
      ? { causality: 5, routeDifferentiation: 5, setupPayoff: 5, characterMotivation: 5 }
      : {
          causality: 5, playerAgency: 5, routeDifferentiation: 5, pacing: 5,
          characterMotivation: 5, emotionalImpact: 5,
        }
    await acceptProductBuildArtifact({
      scope: input.fixture.scope,
      buildId: build.id!,
      controlEpoch: build.controlEpoch,
      artifactKey: `quality.adventure-review.${scope}`,
      kind: 'playtest-report',
      payload: {
        schema: 'storyforge.text-adventure-quality-review-batch-artifact',
        version: 1,
        scope,
        scores,
        issues,
        passed: issues.length === 0,
      },
      quality: {
        reviewBatchContractVerified: true,
        reviewScope: scope,
        coverage: { scope, sourceHashes, sceneKeys: [...scopeSceneKeys[scope]] },
      },
      inputHash: '3'.repeat(64),
      producerReceiptHash: '4'.repeat(64),
    })
  }
  await acceptProductBuildArtifact({
    scope: input.fixture.scope,
    buildId: build.id!,
    controlEpoch: build.controlEpoch,
    artifactKey: 'quality.adventure-review',
    kind: 'playtest-report',
    payload: failedTextAdventureReview({ issues: [input.issue] }),
    inputHash: '5'.repeat(64),
    producerReceiptHash: '6'.repeat(64),
  })
  return { originEpoch: build.controlEpoch, sourcePayloads }
}

async function writeBroadIntermediateTextAdventureRewrite(input: {
  fixture: Awaited<ReturnType<typeof textAdventureQualityRecoveryFixture>>
  sourcePayloads: Record<string, Record<string, unknown>>
}) {
  const intermediateEpoch = input.fixture.build.controlEpoch + 1
  await db.productBuilds.update(input.fixture.build.id!, { controlEpoch: intermediateEpoch })
  for (const [artifactKey, payload] of Object.entries(input.sourcePayloads)) {
    await acceptProductBuildArtifact({
      scope: input.fixture.scope,
      buildId: input.fixture.build.id!,
      controlEpoch: intermediateEpoch,
      artifactKey,
      kind: 'narrative',
      payload: { ...payload, accidentalIntermediateRewrite: artifactKey },
      inputHash: '7'.repeat(64),
      producerReceiptHash: '8'.repeat(64),
    })
  }
  return intermediateEpoch
}

function packageFor(brief: Awaited<ReturnType<typeof fixture>>['brief'], productionKey: string): ProductRuntimePackageV1 {
  return {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'avg',
    definition: {
      productKey: productionKey, title: '耐久调度游戏', description: '自动生产测试',
      enabledCapabilities: ['narrative', 'presentation'], rulesetVersion: 1, initialVariables: {},
    },
    sourceWorld: { contentHash: brief.source.worldContentHash, selection: brief.source.selection },
    narrative: {
      moduleKind: 'main', moduleTitle: '耐久调度故事', entryNodeKey: 'opening',
      nodes: [
        { key: 'opening', title: '开场', summary: '从这里开始', kind: 'entry', conditionJson: '{}', effectsJson: '[]', successorKeys: ['ending'] },
        { key: 'ending', title: '结束', summary: '完成', kind: 'ending', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
      ],
      beats: [
        { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '故事开始。', order: 0 },
        { beatKey: 'beat.ending', nodeKey: 'ending', kind: 'narration', speakerKey: null, text: '故事结束。', order: 0 },
      ],
      choices: [{
        choiceKey: 'choice.continue', sourceNodeKey: 'opening', targetNodeKey: 'ending',
        text: '继续', description: '走向结局', unavailableReason: '',
        displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0,
      }],
    },
    presentation: { version: 1, cues: [], assets: [] },
  }
}

function executorFor(
  input: Awaited<ReturnType<typeof fixture>>,
  calls: Map<string, number>,
  concurrency: { active: number; peak: number; proveSiblingOverlap?: boolean; overlapWaiters?: Array<() => void> },
): ProductProductionTaskExecutorV1 {
  return async request => {
    calls.set(request.task.taskKey, (calls.get(request.task.taskKey) ?? 0) + 1)
    concurrency.active++
    concurrency.peak = Math.max(concurrency.peak, concurrency.active)
    // These two sibling tasks must be selected in the same scheduler cycle.
    // A deterministic barrier proves actual overlap without depending on real
    // timers, which unrelated full-suite fake-timer cases can starve.
    if (concurrency.proveSiblingOverlap
      && (request.task.taskKey === 'content.narrative' || request.task.taskKey === 'media.requirements')) {
      await new Promise<void>(resolve => {
        const waiters = concurrency.overlapWaiters ??= []
        waiters.push(resolve)
        if (waiters.length === 2) {
          concurrency.overlapWaiters = []
          waiters.forEach(release => release())
        }
      })
    }
    let payload: unknown = { taskKey: request.task.taskKey, inputs: request.inputArtifacts.map(row => row.contentHash) }
    if (request.task.taskKey === 'integration.package') {
      payload = packageFor(input.brief, `${input.productionId}.scheduler`)
    } else if (request.task.taskKey === 'qa.release') {
      const packageHash = request.inputArtifacts.find(row => row.artifactKey === 'runtime.package')!.contentHash
      payload = {
        schema: 'storyforge.product-build-quality-report', version: 1,
        buildNumber: request.buildNumber, packageHash,
        hardGateResults: input.brief.completionContract.requiredGateIds.map(gateId => ({
          gateId, passed: true, evidence: [`task:${request.task.taskKey}`],
        })),
        softGateResults: [], mediaCoverage: 1, playable: true, releaseReady: true, warnings: [],
      }
    }
    const kindByTask: Record<string, ProductBuildArtifactKindV1> = {
      'content.design': 'product-design', 'content.narrative': 'narrative',
      'content.product-module': 'product-module', 'media.requirements': 'asset-manifest',
      'integration.package': 'presentation', 'qa.release': 'quality-report',
    }
    const result: ProductProductionTaskExecutionResultV1 = {
      artifacts: [{
        artifactKey: request.task.outputArtifactKeys[0], kind: kindByTask[request.task.taskKey],
        payload, rights: { origin: 'test-executor', commercialUse: true, license: 'test' },
      }],
      passedGateIds: [...request.task.acceptanceGateIds],
      usage: {
        modelCalls: request.task.executionMode === 'model' ? 1 : 0,
        inputTokens: request.task.executionMode === 'model' ? 10 : 0,
        outputTokens: request.task.executionMode === 'model' ? 10 : 0,
        mediaCalls: 0, costUsd: 0, durationMs: 1, storageBytes: 0,
      },
    }
    concurrency.active--
    return result
  }
}

describe('R-PRODUCTPROD-1D · durable bounded DAG scheduler', () => {
  it('兼容性沿 lineage 找最近真实 package，失败父 Build 不会伪装成必需基线', () => {
    expect(selectProductBuildCompatibilityBaselineV1({
      currentBuildNumber: 92,
      parentBuildNumber: 91,
      priorBuilds: [
        { id: 90, buildNumber: 90, controlEpoch: 1, packageHash: '' },
        { id: 91, buildNumber: 91, controlEpoch: 2, packageHash: '' },
      ],
    })).toBeNull()
    expect(selectProductBuildCompatibilityBaselineV1({
      currentBuildNumber: 5,
      parentBuildNumber: 4,
      priorBuilds: [
        { id: 2, buildNumber: 2, controlEpoch: 1, packageHash: 'a'.repeat(64) },
        { id: 3, buildNumber: 3, controlEpoch: 2, packageHash: 'b'.repeat(64) },
        { id: 4, buildNumber: 4, controlEpoch: 3, packageHash: '' },
      ],
    })).toEqual({ id: 3, buildNumber: 3, controlEpoch: 2, packageHash: 'b'.repeat(64) })
    expect(() => selectProductBuildCompatibilityBaselineV1({
      currentBuildNumber: 92,
      parentBuildNumber: 91,
      priorBuilds: [{ id: 90, buildNumber: 90, controlEpoch: 1, packageHash: '' }],
    })).toThrow('compatibility lineage parent Build 缺失')
  })

  it('只把无 Run 的作者决策或显式 carried-forward 工件送入合成沿用 Run', () => {
    expect(productProductionArtifactEligibleForSyntheticCarryV1({
      taskKey: 'media.repair-feedback', executionMode: 'human-import',
      artifactStatus: 'accepted', producerRunId: 16795,
    })).toBe(false)
    expect(productProductionArtifactEligibleForSyntheticCarryV1({
      taskKey: 'source.author-gate', executionMode: 'human-import',
      artifactStatus: 'accepted', producerRunId: null,
    })).toBe(true)
    expect(productProductionArtifactEligibleForSyntheticCarryV1({
      taskKey: 'media.anchor-author-gate', executionMode: 'human-import',
      artifactStatus: 'accepted', producerRunId: 42,
    })).toBe(false)
    expect(productProductionArtifactEligibleForSyntheticCarryV1({
      taskKey: 'content.story-bible', executionMode: 'model',
      artifactStatus: 'carried-forward', producerRunId: 12,
    })).toBe(true)
  })

  it('Agnes 长上下文文本能力在 Plan 上限内串行执行，不限制独立媒资 lane', () => {
    const agnesText = [{
      requirementKey: 'cap.text', adapterId: 'configured-text.v1',
      bindingHash: 'a'.repeat(64), provider: 'agnes', model: 'agnes-2.5-flash',
    }]
    expect(effectiveTextProviderConcurrencyV1(2, agnesText)).toBe(1)
    expect(effectiveTextProviderConcurrencyV1(2, [{
      ...agnesText[0], provider: 'openai', model: 'gpt-example',
    }])).toBe(2)
    expect(effectiveTextProviderConcurrencyV1(2, [{
      ...agnesText[0], adapterId: 'agnes.image-2.1-flash.v1',
    }])).toBe(2)
  })
  it('把审查模型错称为任务脚本的主线地点字段归还给真正 owner', () => {
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      severity: 'blocking', artifactKey: 'content.quest-script',
      detail: 'stage.01 的 objective.03 locationOrdinal 与 description 中的地点错配。',
      recommendation: '修正目标发生地。',
    })).toBe('content.main-quest-plan')
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      severity: 'blocking', artifactKey: 'content.quest-script',
      detail: 'objective.03 的 failureForwardText 没有产生新局面。',
      recommendation: '重写失败推进结算文本。',
    })).toBe('content.quest-script')
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      severity: 'blocking', artifactKey: 'content.dialogue-pass.act-2',
      detail: 'beat.act-2.017 的 speakerKey 错标为 character.npc-02，实际说话人应为 character.npc-03。',
      recommendation: '修正说话者归属，保持台词含义不变。',
    })).toBe('content.scene-script.act-2')
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      severity: 'blocking', artifactKey: 'content.dialogue-pass.act-2',
      detail: 'beat.act-2.017 的台词语气与 character.npc-02 的声音锚点不一致。',
      recommendation: '只重写对白措辞，不修改 speakerKey。',
    })).toBe('content.dialogue-pass.act-2')
    const compiledEchoIssue = {
      severity: 'blocking', artifactKey: 'content.dialogue-pass.act-2',
      detail: '[owningKey=scene.007] decision.3 的两种选择在 scene.007 未体现路线差异，实际体验被抹平。',
      recommendation: '在 scene.007 增加根据 flag.decision.3.1 与 flag.decision.3.2 显示的条件化叙述。',
    }
    expect(textAdventureQualityIssueOwnerArtifactKeyV1(compiledEchoIssue))
      .toBe('content.narrative')
    expect(textAdventureQualityIssueSupersededByCompiledEchoV1(compiledEchoIssue, {
      decisions: [{
        key: 'decision.3', options: [
          { persistentEffectKey: 'flag.decision.3.1', echoSceneKeys: ['scene.007'] },
          { persistentEffectKey: 'flag.decision.3.2', echoSceneKeys: ['scene.007'] },
        ],
      }],
    })).toBe(true)
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      severity: 'blocking', artifactKey: 'content.dialogue-pass.act-3',
      detail: '[owningKey=scene.011] narration beat 持续使用「她」「岚舟」指代玩家，造成第三人称视角漂移。',
      recommendation: '将 scene.011 所有 narration beat 中指向玩家角色的「她/岚舟」改为第二人称「你」。',
    })).toBe('content.scene-script.act-3')
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      severity: 'blocking', artifactKey: 'content.quest-script',
      detail: 'alternative.03.1 的 sceneKey 登记为 scene.005，但叙事内容发生在 scene.009。',
      recommendation: '将 alternative.03.1.sceneKey 改为 scene.009。',
    })).toBe('content.main-quest-plan')
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      severity: 'blocking', artifactKey: 'content.quest-script',
      detail: 'mainObjectiveScripts[2].sceneKey 登记为 scene.005，但目标发生在后续地点。',
      recommendation: '将 mainObjectiveScripts[2].sceneKey 调整为 scene.009。',
    })).toBe('content.main-quest-plan')
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      severity: 'blocking', artifactKey: 'content.quest-script',
      detail: 'mainObjectiveScripts[2].sceneKey 为 scene.005；successText 没有描述当场结果。',
      recommendation: '保留冻结 sceneKey，仅重写 successText。',
    })).toBe('content.quest-script')
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      severity: 'blocking', artifactKey: 'content.quest-script',
      detail: 'mainObjectiveScripts[2].sceneKey 登记为 scene.005；successText 却写成后续地点。',
      recommendation: '保留 sceneKey，仅重写 successText 与 failureForwardText。',
    })).toBe('content.quest-script')
  })

  it('把错归空间架构的决定与选择送回专业工件，并只重跑决定设计源', () => {
    const decisionIssue = {
      severity: 'blocking', artifactKey: 'content.adventure-architecture',
      detail: 'decision.5 的 sceneKey 为 scene.005，但 prompt 提前描述第二潮钟海底井。',
      recommendation: '移动 decision.5 并更新 option.5.1 的 echoSceneKeys。',
    }
    expect(textAdventureQualityIssueOwnerArtifactKeyV1(decisionIssue))
      .toBe('content.narrative-arc-plan')
    expect(textAdventureQualityArcRepairTaskKeysV1(decisionIssue))
      .toEqual(['content.narrative-decision-plan'])
    expect(textAdventureQualityArcRepairTaskKeysV1({
      ...decisionIssue, detail: 'decision.first 的 prompt 与冻结场景错位。',
    })).toEqual(['content.narrative-decision-plan'])
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      ...decisionIssue,
      detail: 'decision.3 的 prompt 与 scene.003 openingBeat 不一致。',
    })).toBe('content.narrative-arc-plan')
    expect(textAdventureQualityArcRepairTaskKeysV1({
      ...decisionIssue,
      detail: 'decision.5 的 locationOrdinal=2 仅用于核对冻结场景，prompt 仍提前描述后续行动。',
      recommendation: '保留 sceneKey 与 locationOrdinal，重写 decision.5 prompt 和 option.5.1。',
    })).toEqual(['content.narrative-decision-plan'])
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      severity: 'blocking', artifactKey: 'content.adventure-architecture',
      detail: 'choice.016 的 sourceNodeKey 为 scene.010，但 description 与 targetNodeKey 开场矛盾。',
      recommendation: '重写 choice.016 description 以匹配 openingBeat。',
    })).toBe('content.narrative')
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      severity: 'blocking', artifactKey: 'content.narrative',
      detail: 'scene.005 openingBeat 与冻结场景卡 purpose 矛盾。',
      recommendation: '保留冻结场景卡，仅重写 openingBeat。',
    })).toBe('content.narrative')
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      severity: 'blocking', artifactKey: 'content.narrative-arc-plan',
      detail: '[owningKey=scene.008] scene.008 没有任何入边选择，导致该场景不可达。',
      recommendation: '从 scene.007 补充一条指向 scene.008 的选择边，保持场景卡不变。',
    })).toBe('content.narrative')
    const mislabeledDecisionIssue = {
      severity: 'blocking', artifactKey: 'content.narrative',
      detail: 'decision.6 只有 option.6.1 与 option.6.2，缺少第三条终局路线。',
      recommendation: '在 decision.6 中新增 option.6.3，并保持其他 scene copy 不变。',
    }
    expect(textAdventureQualityIssueOwnerArtifactKeyV1(mislabeledDecisionIssue))
      .toBe('content.narrative-arc-plan')
    expect(textAdventureQualityArcRepairTaskKeysV1(mislabeledDecisionIssue))
      .toEqual(['content.narrative-decision-plan'])
    expect(textAdventureQualityIssueOwnerArtifactKeyV1({
      severity: 'blocking', artifactKey: 'content.narrative',
      detail: 'choice.020 与 decision.6 的最终立场不一致。',
      recommendation: '只重写 choice.020 description，保留 decision.6 与 option.6.1。',
    })).toBe('content.narrative')
    expect(textAdventureQualityChoiceCopyOnlyRepairV1({
      detail: 'choice.route-left 的 description 与目标节点开场矛盾。',
      recommendation: '只重写 choice.route-left description，保持图结构不变。',
    })).toBe(true)
    expect(textAdventureQualityChoiceCopyOnlyRepairV1({
      detail: 'choice.route-left 的 targetNodeKey 指向错误节点。',
      recommendation: '将 targetNodeKey 改为 scene.009。',
    })).toBe(false)
    expect(textAdventureQualityChoiceCopyOnlyRepairV1({
      detail: 'choice.route-left 的承诺与目标场景都不完整。',
      recommendation: '同时重写 choice.route-left description 与 scene.009 openingBeat。',
    })).toBe(false)
    expect(textAdventureQualityChoiceCopyOnlyRepairV1({
      detail: '[owningKey=choice.005] 当前选择文案未表达等待批准的行动，且引用了 targetNodeKey。',
      recommendation: '将 choice.005 的 label 与 description 改为等待批准；保持 targetNodeKey 不变。',
    })).toBe(true)
    expect(textAdventureQualityChoiceCopyOnlyRepairV1({
      detail: '[owningKey=scene.001] choice.002.label 把目的地写成了当前场景。',
      recommendation: '将 choice.002.label 改回雾隐酒馆；同步修正 choice.002.description，使描述与 scene.002 开场内容相符。',
    })).toBe(true)
    expect(textAdventureQualityChoiceCopyOnlyRepairV1({
      detail: '[owningKey=choice.005] 当前选择文案与目标节点开场不一致。',
      recommendation: '将 choice.005 的 label 与 description 改为等待批准；同时把 targetNodeKey 改为 scene.009。',
    })).toBe(true)
    expect(textAdventureQualityExecutableRecommendationV1({
      detail: '[owningKey=choice.005] 当前选择文案与目标节点开场不一致。',
      recommendation: '将 choice.005 的 label 与 description 改为等待批准；同时把 targetNodeKey 改为 scene.009。',
    })).toBe('保持 choice.005 的 sourceNodeKey、targetNodeKey、order 与冻结图完全不变；仅重写 choice.005 的 text、description 或 unavailableReason，使玩家可见文案准确承诺冻结目标场景中的立即行动、地点与可知事实。')
    expect(textAdventureNarrativeRepairPreservesFrozenMediaV1([{
      severity: 'blocking', artifactKey: 'content.adventure-architecture',
      detail: 'choice.route-left 的 description 与 targetNodeKey 开场矛盾。',
      recommendation: '只重写选择文案，保持其他内容不变。',
    }])).toBe(true)
  })

  it('拒绝审查模型虚构稳定身份或错引冻结边，而不是把幽灵问题广播给整个团队', () => {
    const index = {
      decisionSceneByKey: { 'decision.1': 'scene.001', 'decision.2': 'scene.002' },
      decisionOptionKeysByKey: {
        'decision.1': ['option.1.1', 'option.1.2'],
        'decision.2': ['option.2.1'],
      },
      optionKeys: ['option.1.1', 'option.1.2', 'option.2.1'],
      choiceEdgeByKey: {
        'choice.001': { sourceNodeKey: 'scene.001', targetNodeKey: 'scene.002' },
        'choice.002': { sourceNodeKey: 'scene.002', targetNodeKey: 'scene.003' },
        'choice.ending': { sourceNodeKey: 'scene.003', targetNodeKey: 'ending.001' },
      },
      sceneKeys: ['scene.001', 'scene.002', 'scene.003'],
      endingKeys: ['ending.001', 'ending.002'],
      objectiveSceneByKey: { 'objective.01': 'scene.001', 'objective.02': 'scene.002' },
      objectiveAlternativeKeysByKey: {
        'objective.01': ['alternative.01.1'],
        'objective.02': ['alternative.02.1'],
      },
      alternativeKeys: ['alternative.01.1', 'alternative.02.1'],
    }
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'choice.999 的目标开场缺少兑现。', recommendation: '重写选择文案。',
    }], index)).toEqual(['审查 引用未登记 key:choice.999'])
    expect(normalizeTextAdventureQualityStableReferenceV1(
      'scene.03', new Set(index.sceneKeys),
    )).toBe('scene.003')
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'scene.03 的 openingBeat 缺少前置回响。',
      recommendation: '重写 scene.03.openingBeat，但保持场景身份不变。',
    }], index)).toEqual([])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'decision.4.1 的 prompt 缺少代价。', recommendation: '重写该 prompt。',
    }], index)).toEqual(['审查 引用未登记 key:decision.4.1'])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'choice.001: 选择承诺与目标开场一致。',
      recommendation: '保留 choice.001.description。',
    }], index)).toEqual([])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'choice.999: 目标开场缺少兑现。', recommendation: '重写选择文案。',
    }], index)).toEqual(['审查 引用未登记 key:choice.999'])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'decision.1 的 sceneKey 登记为 scene.002。', recommendation: '移动决定。',
    }], index)).toContain('decision.1 的冻结 sceneKey 被错误引用为 scene.002')
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'choice.001 的 sourceNodeKey=scene.002、targetNodeKey=scene.003。',
      recommendation: '重写选择。',
    }], index)).toEqual(expect.arrayContaining([
      'choice.001 的 sourceNodeKey 被错误引用为 scene.002',
      'choice.001 的 targetNodeKey 被错误引用为 scene.003',
    ]))
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'choice.001 的 sourceNodeKey=scene.001、targetNodeKey=scene.002；'
        + 'choice.002 的 sourceNodeKey=scene.002、targetNodeKey=scene.001。',
      recommendation: '保持第一条边，只修正第二条边的玩家承诺。',
    }], index)).toContain('choice.002 的 targetNodeKey 被错误引用为 scene.001')
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'choice.ending 的 targetNodeKey=ending.002。',
      recommendation: '按该结局重写选择。',
    }], index)).toContain('choice.ending 的 targetNodeKey 被错误引用为 ending.002')
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'choice.ending 的 sourceNodeKey=scene.003、targetNodeKey=ending.001。',
      recommendation: '保留冻结边，只重写选择文案。',
    }], index)).toEqual([])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'choice.ending 的 sourceNodeKey=ending.001、targetNodeKey=ending.001。',
      recommendation: '按该边重写选择。',
    }], index)).toContain('choice.ending 的 sourceNodeKey 被错误引用为 ending.001')
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'choice.ending 的 targetNodeKey=ending.999。',
      recommendation: '按该结局重写选择。',
    }], index)).toContain('审查 引用未登记 key:ending.999')
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'decision.1 的 optionKey 被引用为 option.2.1。',
      recommendation: '保持该 option 并重写代价。',
    }], index)).toContain('decision.1 的冻结 option 被错误引用为 option.2.1')
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'objective.01 的 alternativeKey 被引用为 alternative.02.1。',
      recommendation: '保留该解法并重写结算。',
    }], index)).toContain('objective.01 的冻结 alternative 被错误引用为 alternative.02.1')
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'decision.1 在 scene.001 的 prompt 缺少代价。',
      recommendation: '保留 sceneKey，重写 option.1.1 与 option.1.2。',
    }], index)).toEqual([])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'decision.1.option.1.1.label 没有表达持续代价。',
      recommendation: '重写 decision.1.option.1.1.label。',
    }], index)).toEqual([])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'decision.1.1.label 没有表达持续代价。',
      recommendation: '重写 decision.1.1.label。',
    }], index)).toEqual([])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'decision.1.option.2.1.label 没有表达持续代价。',
      recommendation: '重写 decision.1.option.2.1.label。',
    }], index)).toEqual(['审查 引用未登记 key:decision.1.option.2.1.label'])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'choice.001.description 与 alternative.01.1.cost 对风险的表述不一致。',
      recommendation: '保留 choice.001.targetNodeKey，只重写文案。',
    }], index)).toEqual([])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'choice.001.label 没有准确承诺目标场景的即时行动。',
      recommendation: '重写 choice.001.label，使其与 choice.001.targetNodeKey 保持一致。',
    }], index)).toEqual([])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'choice.001.fakeLabel 没有准确承诺目标场景的即时行动。',
      recommendation: '重写 choice.001.fakeLabel。',
    }], index)).toEqual(['审查 引用未登记 key:choice.001.fakeLabel'])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'alternative.01.1.sceneKey 被写成 scene.001。',
      recommendation: '调整 alternative.01.1.sceneKey。',
    }], index)).toEqual([])
    expect(textAdventureQualityReviewReferenceViolationsV1([{
      detail: 'alternative.01.1.success 与 alternative.01.1.failureForward 缺少差异。',
      recommendation: '分别强化成功和失败推进结果。',
    }], index)).toEqual([])
    expect(textAdventureQualityReviewAuthorityViolationsV1([{
      artifactKey: 'content.quest-script',
      detail: 'alternative.01.1 的 sceneKey 被登记为 scene.001。',
      recommendation: '将 alternative.01.1.sceneKey 改到 scene.002。',
    }], 3)).toEqual([
      '主线解法不拥有 sceneKey；场景与地点绑定由父 objective 持有',
    ])
    expect(textAdventureQualityReviewAuthorityViolationsV1([{
      artifactKey: 'content.narrative-arc-plan',
      detail: 'decision.6 只有 option.6.1 与 option.6.2，第三结局缺少直接按钮。',
      recommendation: '在 decision.6 中新增第三个 option.6.3。',
    }], 3)).toEqual([
      '通用叙事决定固定拥有两个立场选项；第三结局必须由跨决定状态组合进入，不得增删单个 decision 的 option',
    ])
    expect(textAdventureQualityReviewAuthorityViolationsV1([{
      artifactKey: 'content.main-quest-plan',
      detail: 'alternative.01.1.locationOrdinal 缺失。',
      recommendation: '为 alternatives[0].locationOrdinal 设置为 2。',
    }], 3)).toEqual([
      '主线解法不拥有 locationOrdinal；场景与地点绑定由父 objective 持有',
    ])
    expect(textAdventureQualityReviewAuthorityViolationsV1([{
      artifactKey: 'content.main-quest-plan',
      detail: 'alternative.01.1 的 cost 没有体现机会代价。',
      recommendation: '重写 cost，保留父 objective 的地点绑定。',
    }], 3)).toEqual([])
  })

  it('确定性图和决定事实驳回 AI 的幽灵缺边、不可达与空回响断言，但保留主观质量批评', () => {
    const index = {
      decisionSceneByKey: { 'decision.3': 'scene.004' },
      decisionOptionKeysByKey: { 'decision.3': ['option.3.1', 'option.3.2'] },
      optionKeys: ['option.3.1', 'option.3.2'],
      choiceEdgeByKey: {
        'choice.006': { sourceNodeKey: 'scene.004', targetNodeKey: 'scene.005' },
        'choice.010': { sourceNodeKey: 'scene.007', targetNodeKey: 'scene.008' },
      },
      sceneKeys: ['scene.001', 'scene.004', 'scene.005', 'scene.007', 'scene.008', 'scene.009'],
      endingKeys: [],
      objectiveSceneByKey: {}, objectiveAlternativeKeysByKey: {}, alternativeKeys: [],
      entryNodeKey: 'scene.001',
      outgoingChoiceKeysByNodeKey: {
        'scene.004': ['choice.006'], 'scene.007': ['choice.010'],
      },
      incomingChoiceKeysByNodeKey: {
        'scene.005': ['choice.006'], 'scene.008': ['choice.010'],
      },
      reachableNodeKeys: ['scene.001', 'scene.004', 'scene.005', 'scene.007', 'scene.008'],
      decisionOptionFactsByKey: {
        'decision.3': [{
          optionKey: 'option.3.1', cost: '失去盟友信任',
          persistentEffectKey: 'flag.decision.3.a', echoSceneKeys: ['scene.005', 'scene.008'],
        }, {
          optionKey: 'option.3.2', cost: '消耗稀缺时间',
          persistentEffectKey: 'flag.decision.3.b', echoSceneKeys: ['scene.007', 'scene.008'],
        }],
      },
      beatFactsByKey: {
        'beat.act-1.part-2.scene-02.014': {
          nodeKey: 'scene.005', kind: 'dialogue', speakerKey: 'character.npc-05',
          text: '因为我三年前亲手抹掉了一份包含十七个名字的档案。',
        },
      },
    }
    expect(textAdventureQualityReviewFactualContradictionV1({
      detail: '[owningKey=scene.004] scene.004 缺少通往 scene.005 的出边选择。',
      recommendation: '为 scene.004 补充通往 scene.005 的 choice。',
    }, index)).toContain('冻结出边实际存在')
    expect(textAdventureQualityReviewFactualContradictionV1({
      detail: '[owningKey=scene.008] scene.008 没有来自 scene.007 的入边。',
      recommendation: '新增进入 scene.008 的选择。',
    }, index)).toContain('冻结入边实际存在')
    expect(textAdventureQualityReviewFactualContradictionV1({
      detail: '[owningKey=scene.008] scene.008 从入口不可达。',
      recommendation: '建立一条可达路线。',
    }, index)).toContain('实际可达')
    expect(textAdventureQualityReviewFactualContradictionV1({
      detail: '[owningKey=decision.3] decision.3 两个 option 的 persistentEffectKey 相同，且 echoSceneKeys 均为空。',
      recommendation: '为 decision.3 补充持久状态差异与后续回响。',
    }, index)).toContain('不同 persistentEffectKey')
    expect(textAdventureQualityReviewFactualContradictionV1({
      detail: '[owningKey=decision.3] decision.3 的回响虽然存在，但措辞过于泛化，人物情绪没有实质变化。',
      recommendation: '保留 echoSceneKeys，只强化对应场景中的人物反应。',
    }, index)).toBeNull()
    expect(textAdventureQualityReviewFactualContradictionV1({
      detail: '[owningKey=scene.009] scene.009 没有任何出边选择。',
      recommendation: '补充一条合法出边。',
    }, index)).toBeNull()
    expect(textAdventureQualityReviewFactualContradictionV1({
      detail: '[owningKey=scene.004] scene.004 的出边选择没有足够的后果差异。',
      recommendation: '强化现有选择的持久影响与玩家可见回响。',
    }, index)).toBeNull()
    expect(textAdventureQualityReviewFactualContradictionV1({
      detail: '[owningKey=decision.3] decision.3 的跨场景回响过于泛化，情绪差异不明显。',
      recommendation: '保留 echoSceneKeys，重写不同 option 的具体可见回响。',
    }, index)).toBeNull()
    expect(textAdventureQualityReviewFactualContradictionV1({
      detail: "[owningKey=scene.005] scene.005, beat.act-1.part-2.scene-02.014: speakerKey=character.npc-05 所说话术'我会把他们的名字找回来'与角色语气冲突。",
      recommendation: '修复该台词。',
    }, index)).toContain('引用的台词与冻结正文不一致')
    expect(textAdventureQualityReviewFactualContradictionV1({
      detail: "[owningKey=scene.005] beat.act-1.part-2.scene-02.014 的台词'因为我三年前亲手抹掉了一份包含十七个名字的档案。'缺少情绪变化。",
      recommendation: '强化情绪层次。',
    }, index)).toBeNull()
    expect(textAdventureQualityReviewFactualContradictionV1({
      detail: '[owningKey=scene.005] beat.act-1.part-2.scene-02.014 当前 speakerKey=character.npc-01。',
      recommendation: '保持台词，调整语气。',
    }, index)).toContain('冻结正文实际为 character.npc-05')
  })

  it('纯预算和运行包恢复继承父 Build 当前签收状态，执行计划恢复仍保留无效审查原产回滚', () => {
    expect(textAdventureRecoveryUsesQualityRollbackV1(['production-budget'])).toBe(false)
    expect(textAdventureRecoveryUsesQualityRollbackV1(['runtime'])).toBe(false)
    expect(textAdventureRecoveryUsesQualityRollbackV1(['execution-plan'])).toBe(true)
    expect(textAdventureRecoveryUsesQualityRollbackV1(['content'])).toBe(true)
  })

  it('只有节点、地点与选择衔接修正可以复用冻结媒资，视觉语义改动必须重做媒资链', () => {
    expect(textAdventureNarrativeRepairPreservesFrozenMediaV1([{
      severity: 'blocking', artifactKey: 'content.narrative',
      detail: 'choice.013 的 targetNodeKey 与 scene.008 的 locationOrdinal 错位。',
      recommendation: '修正选择标签与目标节点。',
    }])).toBe(true)
    expect(textAdventureNarrativeRepairPreservesFrozenMediaV1([{
      severity: 'blocking', artifactKey: 'content.narrative',
      detail: 'scene.008 的角色身份与插图视觉锚点不一致。',
      recommendation: '替换图片与服饰。',
    }])).toBe(false)
    expect(textAdventureNarrativeRepairPreservesFrozenMediaV1([{
      severity: 'blocking', artifactKey: 'content.adventure-side-quests',
      detail: '支线 stage-one 的 locationOrdinal 与发生地错位。', recommendation: '修正绑定地点。',
    }])).toBe(true)
    expect(textAdventureNarrativeRepairPreservesFrozenMediaV1([{
      severity: 'blocking', artifactKey: 'content.adventure-side-quests',
      detail: '支线中的关键道具与插图不一致。', recommendation: '重做媒资。',
    }])).toBe(false)
    expect(textAdventureNarrativeRepairPreservesFrozenMediaV1([{
      severity: 'blocking', artifactKey: 'content.narrative-arc-plan',
      detail: 'decision.3 的两个 option 缺少跨场景状态回响。',
      recommendation: '保持冻结场景与地点，只补充 option.3.1 和 option.3.2 的 echoSceneKeys。',
    }, {
      severity: 'blocking', artifactKey: 'content.narrative-arc-plan',
      detail: 'scene.008 缺少来自 scene.007 的入边选择。',
      recommendation: '补充出边选择，保持场景卡和地点不变。',
    }])).toBe(true)
    expect(textAdventureNarrativeRepairPreservesFrozenMediaV1([{
      severity: 'blocking', artifactKey: 'content.narrative-arc-plan',
      detail: 'scene.008 的冻结场景卡发生地不正确。',
      recommendation: '把 scene.008 场景卡移动到另一个区域并修改 locationOrdinal。',
    }])).toBe(false)
  })

  it('act 质量批次只拥有本幕稳定身份，跨幕 boundary 只能佐证当前选择或决定的返修', () => {
    const coverage = {
      scope: 'act-1' as const,
      supplementalAssignmentRule: 'bundle-entry-index-modulo-three' as const,
      allSceneKeys: ['scene.001', 'scene.002', 'scene.005', 'scene.009', 'scene.010'],
      sceneKeys: ['scene.001', 'scene.002'],
      allEndingKeys: ['ending.001'],
      endingKeys: [],
      ownedChoiceKeys: ['choice.001'],
      choiceTargetByKey: {
        'choice.001': 'scene.005',
        'choice.009': 'scene.010',
      },
      ownedDecisionKeys: ['decision.001'],
      decisionEchoSceneKeysByKey: {
        'decision.001': ['scene.005'],
        'decision.009': ['scene.010'],
      },
      ownedOptionKeys: ['option.001.a'],
      optionEchoSceneKeysByKey: {
        'option.001.a': ['scene.005'],
        'option.009.a': ['scene.010'],
      },
      objectiveKeys: ['objective.001', 'objective.009'],
      ownedObjectiveKeys: ['objective.001'],
      alternativeKeys: ['alternative.001.a', 'alternative.009.a'],
      ownedAlternativeKeys: ['alternative.001.a'],
      allSupplementalEntryKeys: ['side-1', 'side-3', 'ambient-1'],
      ownedSupplementalEntryKeys: ['side-1', 'ambient-1'],
      allSupplementalStageKeys: ['side-1.stage-1', 'side-3.stage-1', 'ambient-1.stage-1'],
      ownedSupplementalStageKeys: ['side-1.stage-1', 'ambient-1.stage-1'],
    }
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([{
      artifactKey: 'content.dialogue-pass.act-1',
      detail: '[owningKey=choice.001] choice.001 的文案与目标 scene.005 的开场动作不一致。',
      recommendation: '修改 choice.001 的 description，准确预告立即行动。',
    }], coverage)).toEqual([])
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([{
      artifactKey: 'content.narrative-arc-plan',
      detail: '[owningKey=option.001.a] option.001.a 在 scene.005 的回响不足。',
      recommendation: '修改 option.001.a 的 echoSceneKeys，使回响保持可核验。',
    }], coverage)).toEqual([])
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([{
      artifactKey: 'content.narrative',
      detail: '[owningKey=choice.001] choice.001 指向的 scene.005 开场动作不足。',
      recommendation: '重写 scene.005 的 openingBeat。',
    }], coverage)).toEqual([
      'act-1 审查把批次外内容当作返修目标:scene.005',
    ])
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([{
      artifactKey: 'content.narrative',
      detail: '[owningKey=scene.001] 真实但非本幕边界的 scene.009 开场动作不足。',
      recommendation: '重写 scene.009 的 openingBeat。',
    }], coverage)).toEqual([
      'act-1 审查把批次外内容当作返修目标:scene.009',
    ])
    const scopedIssue = textAdventureQualityScopeSafeIssueV1({
      severity: 'blocking' as const,
      artifactKey: 'content.narrative' as const,
      detail: '[owningKey=scene.001] 真实但非本幕边界的 scene.009 开场动作不足。',
      recommendation: '重写 scene.009 的 openingBeat。',
    }, coverage)
    expect(scopedIssue).toMatchObject({
      detail: '[owningKey=scene.001] 真实但非本幕边界的 批次外只读衔接场景 开场动作不足。',
      recommendation: '仅修改 scene.001 所属正式工件来解决上述问题；批次外场景或结局只能作为只读衔接证据，不得改写。',
    })
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([scopedIssue], coverage))
      .toEqual([])
    const resolvedArtifactOwner = textAdventureQualityResolveArtifactOwningKeyV1({
      artifactKey: 'content.dialogue-pass.act-1',
      detail: '[owningKey=content.dialogue-pass.act-1] scene.001 的对白越过角色知识边界。',
      recommendation: '只修改该场景对白。',
    }, coverage)
    expect(resolvedArtifactOwner.detail).toBe(
      '[owningKey=scene.001] scene.001 的对白越过角色知识边界。',
    )
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([resolvedArtifactOwner], coverage))
      .toEqual([])
    const resolvedCompoundBeatLocator = textAdventureQualityResolveArtifactOwningKeyV1({
      artifactKey: 'content.scene-script.act-1',
      detail: '[owningKey=scene.001, beatKey=beat.act-1.part-1.scene-01.003] 对白承接不足。',
      recommendation: '只修改该场景中的登记 beat。',
    }, coverage)
    expect(resolvedCompoundBeatLocator.detail).toBe(
      '[owningKey=scene.001] beatKey=beat.act-1.part-1.scene-01.003 对白承接不足。',
    )
    expect(textAdventureQualityReviewBatchCoverageViolationsV1(
      [resolvedCompoundBeatLocator], coverage,
    )).toEqual([])
    expect(textAdventureQualityResolveArtifactOwningKeyV1({
      artifactKey: 'content.scene-script.act-1',
      detail: '[owningKey=scene.999, beatKey=beat.fake.001] 不应被修正。',
      recommendation: '无。',
    }, coverage).detail).toContain('[owningKey=scene.999, beatKey=beat.fake.001]')
    expect(textAdventureQualityResolveArtifactOwningKeyV1({
      artifactKey: 'content.narrative',
      detail: '[owningKey=content.narrative:choices.choice.001] 选项承诺错位。',
      recommendation: '修订选择文案。',
    }, coverage).detail).toBe('[owningKey=choice.001] 选项承诺错位。')
    expect(textAdventureQualityResolveArtifactOwningKeyV1({
      artifactKey: 'content.narrative-arc-plan',
      detail: '[owningKey=content.narrative-arc-plan:arcPlan.act-1.sceneCards.scene.001] 场景节奏重复。',
      recommendation: '修订场景卡。',
    }, coverage).detail).toBe('[owningKey=scene.001] 场景节奏重复。')
    expect(textAdventureQualityResolveArtifactOwningKeyV1({
      artifactKey: 'content.narrative',
      detail: '[owningKey=content.narrative:choices.choice.999] 不应被修正。',
      recommendation: '无。',
    }, coverage).detail).toContain('content.narrative:choices.choice.999')
    const ambiguousArtifactOwner = textAdventureQualityResolveArtifactOwningKeyV1({
      artifactKey: 'content.narrative-arc-plan',
      detail: '[owningKey=content.narrative-arc-plan] scene.001 与 decision.001 都缺少回响。',
      recommendation: '修改对应内容。',
    }, coverage)
    expect(ambiguousArtifactOwner.detail).toContain(
      '[owningKey=content.narrative-arc-plan]',
    )
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([{
      artifactKey: 'content.narrative',
      detail: '[owningKey=choice.009] choice.009 与 scene.010 的衔接不足。',
      recommendation: '修改 choice.009 的 description。',
    }], coverage)).toEqual([
      'act-1 审查 issue.detail 的 owningKey 未登记或不归本批:choice.009',
    ])
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([{
      artifactKey: 'content.main-quest-plan',
      detail: '[owningKey=objective.009] objective.009 与 alternative.009.a 的代价不足。',
      recommendation: '修改 objective.009 的解法。',
    }], coverage)).toEqual([
      'act-1 审查 issue.detail 的 owningKey 未登记或不归本批:objective.009',
    ])
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([{
      artifactKey: 'content.adventure-side-quests',
      detail: '[owningKey=side-1.stage-1] side-1 的 side-1.stage-1 缺少失败推进。',
      recommendation: '改写 side-1.stage-1 的 failureText。',
    }], coverage)).toEqual([])
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([{
      artifactKey: 'content.adventure-side-quests',
      detail: '[owningKey=side-3.stage-1] side-3 的 side-3.stage-1 缺少失败推进。',
      recommendation: '改写 side-3.stage-1 的 failureText。',
    }], coverage)).toEqual([
      'act-1 审查 issue.detail 的 owningKey 未登记或不归本批:side-3.stage-1',
    ])
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([{
      artifactKey: 'content.narrative',
      detail: '[owningKey=content.narrative] 本幕主要转折缺少因果铺垫。',
      recommendation: '补充前置场景与可见状态回响。',
    }], coverage)).toEqual([
      'act-1 审查 issue.detail 的 owningKey 未登记或不归本批:content.narrative',
    ])

    const structureCoverage = { ...coverage, scope: 'structure' as const }
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([{
      artifactKey: 'content.narrative-arc-plan',
      detail: '跨幕转折缺少因果铺垫。',
      recommendation: '补充可见状态回响。',
    }], structureCoverage)).toEqual([
      'structure 审查 issue.detail 缺少开头 owningKey',
    ])
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([{
      artifactKey: 'content.narrative-arc-plan',
      detail: '[owningKey=scene.009] scene.009 的转折与 ending.001 的后果缺少衔接。',
      recommendation: '保持 stable key，修正 scene.009 的 exitState。',
    }], structureCoverage)).toEqual([])
    expect(textAdventureQualityReviewBatchCoverageViolationsV1([{
      artifactKey: 'content.narrative-arc-plan',
      detail: '[owningKey=side-3.stage-1] side-3 与 side-3.stage-1 的因果衔接不足。',
      recommendation: '保持补充任务内容，只修正主线对 side-3.stage-1 的回响。',
    }], structureCoverage)).toEqual([])
  })

  it('紧邻 epoch 缺少来源时普通恢复与无效审查回滚均不携带更早旧版', async () => {
    const f = await fixture('missing-immediate-epoch-carry')
    const production = (await db.productProductions.get(f.productionId))!
    const build = (await db.productBuilds.where('[productionId+buildNumber]')
      .equals([f.productionId, production.currentBuildNumber!]).first())!
    const payload = { schema: 'fixture.historical-media', version: 1, value: '已验证媒资需求' }
    const source = await acceptProductBuildArtifact({
      scope: f.scope, buildId: build.id!, controlEpoch: build.controlEpoch,
      artifactKey: 'media.requirements', kind: 'asset-manifest', payload,
      inputHash: 'a'.repeat(64), producerReceiptHash: 'b'.repeat(64),
    })
    await db.productBuildArtifacts.update(source.id!, { status: 'invalid' })
    await db.productBuilds.update(build.id!, { controlEpoch: build.controlEpoch + 2 })

    const carried = await carryForwardProductBuildArtifactsToEpochV1({
      scope: f.scope, buildId: build.id!,
      fromControlEpoch: build.controlEpoch + 1,
      toControlEpoch: build.controlEpoch + 2,
      artifactKeys: ['media.requirements'],
    })
    expect(carried).toEqual([])
    const reviewRollbackCarried = await carryForwardProductBuildArtifactsToEpochV1({
      scope: f.scope, buildId: build.id!,
      fromControlEpoch: build.controlEpoch + 1,
      toControlEpoch: build.controlEpoch + 2,
      artifactKeys: ['media.requirements'], allowInvalidSourceAtFromEpoch: true,
    })
    expect(reviewRollbackCarried).toEqual([])
    expect(await db.productBuildArtifacts.where('buildId').equals(build.id!).and(row => (
      row.artifactKey === 'media.requirements' && row.controlEpoch === build.controlEpoch + 2
    )).count()).toBe(0)
    expect((await db.productBuildArtifacts.get(source.id!))?.status).toBe('invalid')
  })

  it('紧邻 epoch 存在已签收来源时仍正常携带', async () => {
    const f = await fixture('exact-epoch-carry')
    const production = (await db.productProductions.get(f.productionId))!
    const build = (await db.productBuilds.where('[productionId+buildNumber]')
      .equals([f.productionId, production.currentBuildNumber!]).first())!
    const source = await acceptProductBuildArtifact({
      scope: f.scope, buildId: build.id!, controlEpoch: build.controlEpoch,
      artifactKey: 'media.requirements', kind: 'asset-manifest',
      payload: { schema: 'fixture.current-media', version: 1, value: '当前版本媒资需求' },
      inputHash: '7'.repeat(64), producerReceiptHash: '8'.repeat(64),
    })
    await db.productBuilds.update(build.id!, { controlEpoch: build.controlEpoch + 1 })

    const carried = await carryForwardProductBuildArtifactsToEpochV1({
      scope: f.scope, buildId: build.id!,
      fromControlEpoch: build.controlEpoch,
      toControlEpoch: build.controlEpoch + 1,
      artifactKeys: ['media.requirements'],
    })
    expect(carried).toHaveLength(1)
    expect(carried[0]).toMatchObject({
      artifactKey: 'media.requirements', status: 'carried-forward',
      controlEpoch: build.controlEpoch + 1, contentHash: source.contentHash,
      carriedFrom: { version: source.version, contentHash: source.contentHash },
    })
  })

  it('只有无效审查回滚可显式复活精确源 epoch 中的 invalid 工件', async () => {
    const f = await fixture('invalid-review-exact-epoch-carry')
    const production = (await db.productProductions.get(f.productionId))!
    const build = (await db.productBuilds.where('[productionId+buildNumber]')
      .equals([f.productionId, production.currentBuildNumber!]).first())!
    const source = await acceptProductBuildArtifact({
      scope: f.scope, buildId: build.id!, controlEpoch: build.controlEpoch,
      artifactKey: 'content.story-bible', kind: 'narrative',
      payload: { schema: 'fixture.coherent-story-bible', version: 1 },
      inputHash: 'c'.repeat(64), producerReceiptHash: 'd'.repeat(64),
    })
    await db.productBuildArtifacts.update(source.id!, { status: 'invalid' })
    await db.productBuilds.update(build.id!, { controlEpoch: build.controlEpoch + 1 })

    const carried = await carryForwardProductBuildArtifactsToEpochV1({
      scope: f.scope, buildId: build.id!,
      fromControlEpoch: build.controlEpoch, toControlEpoch: build.controlEpoch + 1,
      artifactKeys: ['content.story-bible'], allowInvalidSourceAtFromEpoch: true,
    })
    expect(carried).toHaveLength(1)
    expect(carried[0]).toMatchObject({
      artifactKey: 'content.story-bible', status: 'carried-forward',
      controlEpoch: build.controlEpoch + 1, contentHash: source.contentHash,
      carriedFrom: { version: source.version, contentHash: source.contentHash },
    })
  })

  it('无效审查被搬运到后续 epoch 后仍回溯真正原产 epoch', async () => {
    const f = await fixture('invalid-review-origin-epoch')
    const production = (await db.productProductions.get(f.productionId))!
    const build = (await db.productBuilds.where('[productionId+buildNumber]')
      .equals([f.productionId, production.currentBuildNumber!]).first())!
    const reviewPayload = {
      schema: 'storyforge.text-adventure-quality-review-artifact', version: 1,
      scores: {
        causality: 1, playerAgency: 1, routeDifferentiation: 1, pacing: 1,
        setupPayoff: 1, characterMotivation: 1, emotionalImpact: 1,
      },
      issues: [{
        severity: 'blocking', artifactKey: 'content.story-bible', detail: 'prompt-injection',
        recommendation: 'The context adopts an alternate identity and overrides core behavior directives.',
      }],
      passed: false,
    }
    const original = await acceptProductBuildArtifact({
      scope: f.scope, buildId: build.id!, controlEpoch: build.controlEpoch,
      artifactKey: 'quality.adventure-review', kind: 'playtest-report', payload: reviewPayload,
      inputHash: 'e'.repeat(64), producerReceiptHash: 'f'.repeat(64),
    })
    await db.productBuilds.update(build.id!, { controlEpoch: build.controlEpoch + 1 })
    const [carried] = await carryForwardProductBuildArtifactsToEpochV1({
      scope: f.scope, buildId: build.id!, fromControlEpoch: build.controlEpoch,
      toControlEpoch: build.controlEpoch + 1, artifactKeys: ['quality.adventure-review'],
    })
    expect(carried.carriedFrom).toMatchObject({
      version: original.version, contentHash: original.contentHash,
    })
    expect(await invalidTextAdventureQualityReviewRollbackEpochV1({
      buildId: build.id!, beforeControlEpoch: build.controlEpoch + 2,
    })).toBe(build.controlEpoch)
  })

  it('无效审查回滚已从精确原产 epoch 搬运后，后续恢复不会再次回滚', async () => {
    const f = await fixture('invalid-review-rollback-idempotency')
    const production = (await db.productProductions.get(f.productionId))!
    const build = (await db.productBuilds.where('[productionId+buildNumber]')
      .equals([f.productionId, production.currentBuildNumber!]).first())!
    const originEpoch = build.controlEpoch
    const source = await acceptProductBuildArtifact({
      scope: f.scope, buildId: build.id!, controlEpoch: originEpoch,
      artifactKey: 'content.story-bible', kind: 'narrative',
      payload: { schema: 'fixture.story-bible', version: 1 },
      inputHash: '1'.repeat(64), producerReceiptHash: '2'.repeat(64),
    })
    const rollbackEpoch = originEpoch + 3
    await db.productBuilds.update(build.id!, { controlEpoch: rollbackEpoch })
    await db.productBuildArtifacts.update(source.id!, { status: 'invalid' })
    await carryForwardProductBuildArtifactsToEpochV1({
      scope: f.scope, buildId: build.id!, fromControlEpoch: originEpoch,
      toControlEpoch: rollbackEpoch, artifactKeys: ['content.story-bible'],
      allowInvalidSourceAtFromEpoch: true,
    })
    expect(await textAdventureQualityRollbackAlreadyAppliedV1({
      buildId: build.id!, currentControlEpoch: rollbackEpoch, originControlEpoch: originEpoch,
    })).toBe(true)
    await db.productBuilds.update(build.id!, { controlEpoch: rollbackEpoch + 1 })
    await carryForwardProductBuildArtifactsToEpochV1({
      scope: f.scope, buildId: build.id!, fromControlEpoch: rollbackEpoch,
      toControlEpoch: rollbackEpoch + 1, artifactKeys: ['content.story-bible'],
    })
    expect(await textAdventureQualityRollbackAlreadyAppliedV1({
      buildId: build.id!, currentControlEpoch: rollbackEpoch + 1, originControlEpoch: originEpoch,
    })).toBe(true)
    expect(await textAdventureQualityRollbackAlreadyAppliedV1({
      buildId: build.id!, currentControlEpoch: rollbackEpoch + 1, originControlEpoch: originEpoch - 1,
    })).toBe(false)
  })

  it('旧幽灵 key 审查导致广泛中间返工后仍按冻结 source hash 回到原产 epoch', async () => {
    const f = await textAdventureQualityRecoveryFixture('invalid-review-ghost-rollback')
    const seeded = await seedFrozenTextAdventureQualityReviewEpoch({
      fixture: f,
      issueScope: 'act-1',
      issue: {
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: 'choice.999 的 targetNodeKey 指向未登记的 scene.999。',
        recommendation: '修改 choice.999，并重写 scene.999 的开场。',
      },
    })
    const intermediateEpoch = await writeBroadIntermediateTextAdventureRewrite({
      fixture: f,
      sourcePayloads: seeded.sourcePayloads,
    })
    expect(await invalidTextAdventureQualityReviewRollbackEpochV1({
      buildId: f.build.id!, beforeControlEpoch: intermediateEpoch + 1,
    })).toBe(seeded.originEpoch)
    const originReview = (await db.productBuildArtifacts.where('buildId').equals(f.build.id!).toArray())
      .find(row => row.artifactKey === 'quality.adventure-review'
        && row.controlEpoch === seeded.originEpoch)!
    expect(await textAdventureInvalidQualityRollbackSourceV1({
      buildId: f.build.id!, declaredControlEpoch: intermediateEpoch,
    })).toEqual({
      originControlEpoch: seeded.originEpoch,
      invalidReviewContentHash: originReview.contentHash,
    })
  })

  it('旧纯泛化审查缺少冻结身份时回到原产 epoch，不把猜测广播给故事团队', async () => {
    const f = await textAdventureQualityRecoveryFixture('invalid-review-generic-rollback')
    const seeded = await seedFrozenTextAdventureQualityReviewEpoch({
      fixture: f,
      issueScope: 'structure',
      issue: {
        severity: 'blocking', artifactKey: 'content.narrative-arc-plan',
        detail: '跨幕主要转折缺少因果铺垫。',
        recommendation: '补充前置场景与可见状态回响。',
      },
    })
    const intermediateEpoch = await writeBroadIntermediateTextAdventureRewrite({
      fixture: f,
      sourcePayloads: seeded.sourcePayloads,
    })
    expect(await invalidTextAdventureQualityReviewRollbackEpochV1({
      buildId: f.build.id!, beforeControlEpoch: intermediateEpoch + 1,
    })).toBe(seeded.originEpoch)
  })

  it('恢复子 Build 只从无效审查原产 epoch 搬运，不会回退到更近污染版本', async () => {
    const f = await textAdventureQualityRecoveryFixture('cross-build-exact-quality-origin')
    const seeded = await seedFrozenTextAdventureQualityReviewEpoch({
      fixture: f,
      issueScope: 'act-1',
      issue: {
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: 'choice.999 指向未登记的 scene.999。',
        recommendation: '重写 choice.999 与 scene.999。',
      },
    })
    const origin = (await db.productBuildArtifacts.where('buildId').equals(f.build.id!).toArray())
      .find(row => row.artifactKey === 'content.adventure-architecture'
        && row.controlEpoch === seeded.originEpoch)!
    const intermediateEpoch = await writeBroadIntermediateTextAdventureRewrite({
      fixture: f,
      sourcePayloads: seeded.sourcePayloads,
    })
    const nearer = (await db.productBuildArtifacts.where('buildId').equals(f.build.id!).toArray())
      .find(row => row.artifactKey === 'content.adventure-architecture'
        && row.controlEpoch === intermediateEpoch)!
    const review = (await db.productBuildArtifacts.where('buildId').equals(f.build.id!).toArray())
      .find(row => row.artifactKey === 'quality.adventure-review'
        && row.controlEpoch === seeded.originEpoch)!
    await db.productBuilds.update(f.build.id!, {
      status: 'recovery-required', controlEpoch: intermediateEpoch,
    })
    const parent = (await db.productBuilds.get(f.build.id!))!
    const { id: _parentId, ...parentFields } = parent
    const targetBuildId = await db.productBuilds.add({
      ...parentFields,
      buildNumber: parent.buildNumber + 1,
      parentBuildNumber: parent.buildNumber,
      status: 'authorized',
      planRevision: 0,
      controlEpoch: intermediateEpoch,
      createdAt: parent.createdAt + 1,
      updatedAt: parent.updatedAt + 1,
    }) as number
    const recoverySource = {
      briefHash: parent.briefHash,
      planHash: parent.planHash,
      controlEpoch: intermediateEpoch,
      qualityRollback: {
        originControlEpoch: seeded.originEpoch,
        invalidReviewContentHash: review.contentHash,
      },
    }
    const [carried] = await carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: f.scope,
      sourceBuildId: parent.id!,
      targetBuildId,
      targetControlEpoch: intermediateEpoch,
      artifactKeys: ['content.adventure-architecture'],
      recoverySource,
    })
    expect(carried.contentHash).toBe(origin.contentHash)
    expect(carried.contentHash).not.toBe(nearer.contentHash)
    expect(carried.carriedFrom).toMatchObject({
      buildNumber: parent.buildNumber,
      version: origin.version,
      contentHash: origin.contentHash,
    })

    await expect(carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: f.scope,
      sourceBuildId: parent.id!,
      targetBuildId,
      targetControlEpoch: intermediateEpoch,
      artifactKeys: ['content.adventure-architecture'],
      recoverySource: {
        ...recoverySource,
        qualityRollback: {
          ...recoverySource.qualityRollback,
          invalidReviewContentHash: 'f'.repeat(64),
        },
      },
    })).rejects.toThrow('cross-build 无效审查回滚证据不可验证')

    await db.productBuildArtifacts.delete(carried.id!)
    await db.productBuildArtifacts.update(origin.id!, { controlEpoch: intermediateEpoch + 1 })
    await expect(carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: f.scope,
      sourceBuildId: parent.id!,
      targetBuildId,
      targetControlEpoch: intermediateEpoch,
      artifactKeys: ['content.adventure-architecture'],
      recoverySource,
    })).rejects.toThrow('cross-build 来源 Artifact 不完整或不唯一')
    expect(await db.productBuildArtifacts.where('buildId').equals(targetBuildId).count()).toBe(0)
  })

  it('旧调度器已初始化恢复子 Build 后，下一同 Build epoch 从父链原产 epoch 撤销污染搬运', async () => {
    const f = await textAdventureQualityRecoveryFixture('initialized-child-parent-origin-recovery')
    const originalSupervision = await acceptProductBuildArtifact({
      scope: f.scope,
      buildId: f.build.id!,
      controlEpoch: f.build.controlEpoch,
      artifactKey: 'production.supervision',
      kind: 'product-design',
      payload: { schema: 'fixture.supervision', version: 1, epoch: 'coherent-origin' },
      inputHash: '9'.repeat(64),
      producerReceiptHash: 'a'.repeat(64),
    })
    const seeded = await seedFrozenTextAdventureQualityReviewEpoch({
      fixture: f,
      issueScope: 'act-1',
      issue: {
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: 'choice.999 指向未登记的 scene.999。',
        recommendation: '重写 choice.999 与 scene.999。',
      },
    })
    const intermediateEpoch = await writeBroadIntermediateTextAdventureRewrite({
      fixture: f,
      sourcePayloads: seeded.sourcePayloads,
    })
    const pollutedSupervision = await acceptProductBuildArtifact({
      scope: f.scope,
      buildId: f.build.id!,
      controlEpoch: intermediateEpoch,
      artifactKey: 'production.supervision',
      kind: 'product-design',
      payload: { schema: 'fixture.supervision', version: 1, epoch: 'polluted-nearer' },
      inputHash: 'b'.repeat(64),
      producerReceiptHash: 'c'.repeat(64),
    })
    const parentPlan = await createProductProductionPlanV3({
      brief: f.brief,
      briefHash: f.build.briefHash,
      buildNumber: f.build.buildNumber,
      controlEpoch: intermediateEpoch,
    })
    const parentPlanHash = await hashProductProductionValueV2(parentPlan)
    await db.productBuilds.update(f.build.id!, {
      status: 'recovery-required',
      controlEpoch: intermediateEpoch,
      planRevision: 1,
      planJson: canonicalProductProductionJsonV2(parentPlan),
      planHash: parentPlanHash,
    })
    const parent = (await db.productBuilds.get(f.build.id!))!
    const parentBriefRow = (await db.productProductionBriefs
      .where('[productionId+revision]').equals([f.productionId, parent.briefRevision]).first())!
    const childBrief = {
      ...f.brief,
      evolution: {
        schema: 'storyforge.product-evolution-impact' as const,
        version: 1 as const,
        base: {
          kind: 'recovery-build' as const,
          buildNumber: parent.buildNumber,
          briefHash: parent.briefHash,
          planHash: parent.planHash,
          controlEpoch: intermediateEpoch,
        },
        userGoal: '升级执行计划并安全恢复',
        affectedLanes: ['execution-plan' as const],
      },
    }
    const childBriefHash = await hashProductProductionValueV2(childBrief)
    const { id: _parentBriefId, ...parentBriefFields } = parentBriefRow
    const childBriefRevision = parentBriefRow.revision + 1
    await db.productProductionBriefs.update(parentBriefRow.id!, { status: 'superseded' })
    await db.productProductionBriefs.add({
      ...parentBriefFields,
      revision: childBriefRevision,
      parentRevision: parentBriefRow.revision,
      status: 'authorized',
      userIntentSummary: '升级执行计划并安全恢复',
      briefJson: canonicalProductProductionJsonV2(childBrief),
      briefHash: childBriefHash,
      authorizedAt: Date.now(),
      createdAt: Date.now(),
    })
    const childBuildNumber = parent.buildNumber + 1
    const childBasePlan = await createProductProductionPlanV3({
      brief: childBrief,
      briefHash: childBriefHash,
      buildNumber: childBuildNumber,
      controlEpoch: intermediateEpoch,
    })
    const childPlan = {
      ...childBasePlan,
      tasks: childBasePlan.tasks.map(task => task.taskKey === 'production.supervision'
        ? {
            ...task,
            reuse: {
              sourceBuildNumber: parent.buildNumber,
              sourceArtifactKey: 'production.supervision',
              sourceContentHash: pollutedSupervision.contentHash,
              reuseKey: 'd'.repeat(64),
              requiresRevalidation: true,
              reason: 'fixture:旧调度器按父 Build 较近 epoch 复用',
            },
          }
        : task),
    }
    const childPlanHash = await hashProductProductionValueV2(childPlan)
    const { id: _parentBuildId, ...parentBuildFields } = parent
    const childBuildId = await db.productBuilds.add({
      ...parentBuildFields,
      buildNumber: childBuildNumber,
      briefRevision: childBriefRevision,
      briefHash: childBriefHash,
      parentBuildNumber: parent.buildNumber,
      status: 'building',
      stateRevision: 0,
      controlEpoch: intermediateEpoch,
      planRevision: 1,
      planJson: canonicalProductProductionJsonV2(childPlan),
      planHash: childPlanHash,
      failureJson: '{}',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }) as number
    const [oldChildCarry] = await carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: f.scope,
      sourceBuildId: parent.id!,
      targetBuildId: childBuildId,
      targetControlEpoch: intermediateEpoch,
      artifactKeys: ['production.supervision'],
      recoverySource: {
        briefHash: parent.briefHash,
        planHash: parent.planHash,
        controlEpoch: intermediateEpoch,
      },
    })
    expect(oldChildCarry.contentHash).toBe(pollutedSupervision.contentHash)
    const nextEpoch = intermediateEpoch + 1
    const production = (await db.productProductions.get(f.productionId))!
    await db.productBuilds.update(childBuildId, {
      status: 'building',
      stateRevision: 1,
      controlEpoch: nextEpoch,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: 'integration.package',
        detail: '文字冒险叙事质量审查未通过，必须先修复阻塞问题并重新生产',
      }),
    })
    await db.productProductions.update(f.productionId, {
      status: 'producing',
      currentBriefRevision: childBriefRevision,
      currentBuildNumber: childBuildNumber,
      controlEpoch: nextEpoch,
      stateRevision: production.stateRevision + 1,
    })
    await runProductProductionSchedulerCycleV1({
      scope: f.scope,
      productionId: f.productionId,
      executor: async () => { throw new Error('fixture-stop-after-plan-materialization') },
      capabilityBindings: [{
        requirementKey: childBrief.capabilityRequirements.find(item => item.mediaClass === 'text')!.requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    const childRows = await db.productBuildArtifacts.where('buildId').equals(childBuildId).toArray()
    const restored = childRows.find(row => row.artifactKey === 'production.supervision'
      && row.controlEpoch === nextEpoch)
    expect(restored).toMatchObject({
      status: 'carried-forward',
      contentHash: originalSupervision.contentHash,
      carriedFrom: {
        buildNumber: parent.buildNumber,
        version: originalSupervision.version,
        contentHash: originalSupervision.contentHash,
      },
    })
    expect(restored?.contentHash).not.toBe(pollutedSupervision.contentHash)
    expect(childRows.find(row => row.id === oldChildCarry.id)?.status).toBe('invalid')
    expect(childRows.some(row => row.controlEpoch === nextEpoch
      && row.contentHash === pollutedSupervision.contentHash)).toBe(false)
    expect(childRows.some(row => row.controlEpoch === nextEpoch
      && row.artifactKey.startsWith('quality.adventure-review'))).toBe(false)
  })

  it('旧批次错幕 key 导致广泛中间返工后仍按冻结 coverage 回到原产 epoch', async () => {
    const f = await textAdventureQualityRecoveryFixture('invalid-review-cross-act-rollback')
    const seeded = await seedFrozenTextAdventureQualityReviewEpoch({
      fixture: f,
      issueScope: 'act-1',
      issue: {
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: 'choice.002 的文案没有兑现 scene.003 的开场。',
        recommendation: '修改 choice.002 的 description，保持目标节点不变。',
      },
    })
    const intermediateEpoch = await writeBroadIntermediateTextAdventureRewrite({
      fixture: f,
      sourcePayloads: seeded.sourcePayloads,
    })
    expect(await invalidTextAdventureQualityReviewRollbackEpochV1({
      buildId: f.build.id!, beforeControlEpoch: intermediateEpoch + 1,
    })).toBe(seeded.originEpoch)
  })

  it('旧审查错绑已登记 choice 图边时按冻结 reference index 回到原产 epoch', async () => {
    const f = await textAdventureQualityRecoveryFixture('invalid-review-edge-binding-rollback')
    const seeded = await seedFrozenTextAdventureQualityReviewEpoch({
      fixture: f,
      issueScope: 'act-1',
      issue: {
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: 'choice.001 的 sourceNodeKey=scene.002、targetNodeKey=scene.003。',
        recommendation: '修改 choice.001 的图边以匹配当前描述。',
      },
    })
    const intermediateEpoch = await writeBroadIntermediateTextAdventureRewrite({
      fixture: f,
      sourcePayloads: seeded.sourcePayloads,
    })
    expect(await invalidTextAdventureQualityReviewRollbackEpochV1({
      buildId: f.build.id!, beforeControlEpoch: intermediateEpoch + 1,
    })).toBe(seeded.originEpoch)
  })

  it('旧审查把实际存在的冻结出边误报为缺失时只回滚审查，不重写正确正文', async () => {
    const f = await textAdventureQualityRecoveryFixture('invalid-review-phantom-missing-edge-rollback')
    const seeded = await seedFrozenTextAdventureQualityReviewEpoch({
      fixture: f,
      issueScope: 'act-1',
      issue: {
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: '[owningKey=choice.001] scene.001 缺少通往 scene.002 的出边选择。',
        recommendation: '为 scene.001 新增通往 scene.002 的选择。',
      },
    })
    expect(await invalidTextAdventureQualityReviewRollbackEpochV1({
      buildId: f.build.id!, beforeControlEpoch: seeded.originEpoch + 1,
    })).toBe(seeded.originEpoch)
  })

  it('合法句读与跨幕选择目标边界不会触发旧审查回滚', async () => {
    const f = await textAdventureQualityRecoveryFixture('valid-review-boundary-no-rollback')
    const seeded = await seedFrozenTextAdventureQualityReviewEpoch({
      fixture: f,
      issueScope: 'act-1',
      issue: {
        severity: 'blocking', artifactKey: 'content.dialogue-pass.act-1',
        detail: '[owningKey=choice.001] choice.001: 的文案没有充分预告目标 scene.002. 的开场动作。',
        recommendation: '只重写 choice.001.description，保持 sourceNodeKey 与 targetNodeKey 不变。',
      },
    })
    expect(await invalidTextAdventureQualityReviewRollbackEpochV1({
      buildId: f.build.id!, beforeControlEpoch: seeded.originEpoch + 1,
    })).toBeNull()
  })

  it('冻结 source hash 在审查原产 epoch 缺失时不回退拾取更早同 hash 工件', async () => {
    const f = await textAdventureQualityRecoveryFixture('invalid-review-no-source-fallback')
    const seeded = await seedFrozenTextAdventureQualityReviewEpoch({
      fixture: f,
      issueScope: 'act-1',
      issue: {
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: 'choice.999 引用了不存在的目标。',
        recommendation: '重写 choice.999。',
      },
    })
    const reviewRows = (await db.productBuildArtifacts.where('buildId').equals(f.build.id!).toArray())
      .filter(row => row.artifactKey === 'quality.adventure-review'
        || row.artifactKey.startsWith('quality.adventure-review.'))
    await db.productBuildArtifacts.where('id').anyOf(reviewRows.map(row => row.id!)).modify({
      controlEpoch: seeded.originEpoch + 1,
    })
    expect(await invalidTextAdventureQualityReviewRollbackEpochV1({
      buildId: f.build.id!, beforeControlEpoch: seeded.originEpoch + 2,
    })).toBeNull()
  })

  it('审查引用幽灵稳定 key 时重跑四个专业批次，而不是只重放确定性总报告', async () => {
    const f = await textAdventureQualityRecoveryFixture('quality-review-invalid-reference')
    await acceptProductBuildArtifact({
      scope: f.scope, buildId: f.build.id!, controlEpoch: f.build.controlEpoch,
      artifactKey: 'quality.adventure-review', kind: 'playtest-report',
      payload: failedTextAdventureReview({
        issues: [{
          severity: 'blocking', artifactKey: 'content.narrative',
          detail: 'choice.999 的 targetNodeKey 指向未登记的 scene.999。',
          recommendation: '修改 choice.999 并重写 scene.999。',
        }],
      }),
      inputHash: '1'.repeat(64), producerReceiptHash: '2'.repeat(64),
    })
    const invalidated = await recoveryInvalidatedTaskKeys({
      buildId: f.build.id!,
      previousControlEpoch: f.build.controlEpoch,
      plan: f.recoveryPlan,
      failureJson: JSON.stringify({
        code: 'user-resumed',
        previousFailure: {
          taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
          detail: '文字冒险叙事质量审查未通过，必须先修复阻塞问题并重新生产',
          taskFailures: {
            'integration.narrative': {
              taskKey: 'integration.narrative', code: 'task-executor-failed', attempt: 1,
              detail: '历史诊断：旧对白工件曾与场景包不兼容，当前 epoch 已修复。',
            },
          },
        },
      }),
    })
    expect([...invalidated].sort()).toEqual([
      'content.adventure-quality-review',
      'content.adventure-quality-review.act-1',
      'content.adventure-quality-review.act-2',
      'content.adventure-quality-review.act-3',
      'content.adventure-quality-review.structure',
    ].sort())
  })

  it('角色视觉锚点确认不会把审计历史中的旧叙事质检失败重新激活', () => {
    const historicalQualityFailure = {
      taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
      detail: '文字冒险叙事质量审查未通过，必须先修复阻塞问题并重新生产',
    }
    const resolvedAnchorGate = {
      commandId: 'media-anchor.confirm',
      blockerKey: 'media.anchor-author-gate',
      resolution: {
        action: 'confirm-character-anchors',
        note: '已核对角色视觉锚点并继续媒资生产',
      },
      resolvedAt: Date.now(),
      previousFailure: {
        taskKey: 'media.anchor-author-gate', code: 'task-executor-failed', attempt: 1,
        detail: '主要角色视觉锚点等待作者确认',
        repairCause: historicalQualityFailure,
        taskFailures: { 'integration.package': historicalQualityFailure },
      },
    }
    expect(activeTextAdventureQualityRepairCauseV1(resolvedAnchorGate)).toBeNull()
    expect(activeTextAdventureQualityRepairCauseV1({
      code: 'user-resumed',
      previousFailure: {
        code: 'user-paused',
        previousFailure: resolvedAnchorGate,
      },
    })).toBeNull()

    expect(activeTextAdventureQualityRepairCauseV1(historicalQualityFailure))
      .toMatchObject({ taskKey: 'integration.package' })
    expect(activeTextAdventureQualityRepairCauseV1({
      taskKey: 'content.adventure-quality-review.act-2',
      code: 'provider-result-unknown',
      detail: '质量审查 provider 结果未知',
      repairCause: historicalQualityFailure,
    })).toMatchObject({ taskKey: 'integration.package' })
    expect(activeTextAdventureQualityRepairCauseV1({
      code: 'user-resumed',
      previousFailure: historicalQualityFailure,
    })).toMatchObject({ taskKey: 'integration.package' })
  })

  it('旧失败审查批次覆盖较新通过批次时恢复到最近完整通过 epoch', async () => {
    const f = await textAdventureQualityRecoveryFixture('quality-review-regressed-carry')
    const batchKeys = [
      'quality.adventure-review.structure',
      'quality.adventure-review.act-1',
      'quality.adventure-review.act-2',
      'quality.adventure-review.act-3',
    ]
    const seedEpoch = async (controlEpoch: number, passed: boolean, tag: string) => {
      await db.productBuilds.update(f.build.id!, { controlEpoch })
      for (const [index, artifactKey] of batchKeys.entries()) {
        await acceptProductBuildArtifact({
          scope: f.scope, buildId: f.build.id!, controlEpoch,
          artifactKey, kind: 'playtest-report',
          payload: { schema: 'fixture.quality-batch', version: 1, tag, index },
          inputHash: `${index + 1}`.repeat(64), producerReceiptHash: `${index + 5}`.repeat(64),
        })
      }
      await acceptProductBuildArtifact({
        scope: f.scope, buildId: f.build.id!, controlEpoch,
        artifactKey: 'quality.adventure-review', kind: 'playtest-report',
        payload: { schema: 'fixture.quality-review', version: 1, tag, passed },
        inputHash: '9'.repeat(64), producerReceiptHash: 'a'.repeat(64),
      })
    }
    await seedEpoch(1, false, 'old-failed')
    await seedEpoch(2, true, 'newer-passed')
    await db.productBuilds.update(f.build.id!, { controlEpoch: 3 })
    const carried = await carryForwardProductBuildArtifactsToEpochV1({
      scope: f.scope, buildId: f.build.id!, fromControlEpoch: 1, toControlEpoch: 3,
      artifactKeys: batchKeys, allowInvalidSourceAtFromEpoch: true,
    })
    await acceptProductBuildArtifact({
      scope: f.scope, buildId: f.build.id!, controlEpoch: 3,
      artifactKey: 'quality.adventure-review', kind: 'playtest-report',
      payload: { schema: 'fixture.quality-review', version: 1, tag: 'regressed', passed: false },
      inputHash: 'b'.repeat(64), producerReceiptHash: 'c'.repeat(64),
    })
    expect(await regressedTextAdventureQualityPassEpochV1({
      buildId: f.build.id!, failedControlEpoch: 3,
    })).toBe(2)

    await db.productBuildArtifacts.update(carried[0].id!, { status: 'accepted' })
    expect(await regressedTextAdventureQualityPassEpochV1({
      buildId: f.build.id!, failedControlEpoch: 3,
    })).toBeNull()
  })

  it('已通过叙事质检的当前 epoch 暂停恢复时不再重放旧质量修复因果', async () => {
    const f = await textAdventureQualityRecoveryFixture('passed-quality-pause-does-not-rewind')
    await acceptProductBuildArtifact({
      scope: f.scope, buildId: f.build.id!, controlEpoch: f.build.controlEpoch,
      artifactKey: 'quality.adventure-review', kind: 'playtest-report',
      payload: { schema: 'fixture.quality-review', version: 1, passed: true },
      inputHash: 'd'.repeat(64), producerReceiptHash: 'e'.repeat(64),
    })
    const invalidated = await recoveryInvalidatedTaskKeys({
      buildId: f.build.id!, previousControlEpoch: f.build.controlEpoch,
      plan: f.recoveryPlan,
      failureJson: canonicalProductProductionJsonV2({
        code: 'user-resumed',
        previousFailure: {
          code: 'user-paused',
          previousFailure: {
            taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
            detail: '文字冒险叙事质量审查未通过，必须先修复阻塞问题并重新生产',
          },
        },
      }),
    })
    expect([...invalidated].some(taskKey => (
      taskKey === 'content.adventure-quality-review'
      || taskKey.startsWith('content.adventure-quality-review.')
    ))).toBe(false)
  })

  it('锚点确认后的暂停恢复可回到最近完整签名 epoch，不被历史失败重放正文', async () => {
    const f = await textAdventureQualityRecoveryFixture('confirmed-anchor-pause-source')
    const controlEpoch = f.build.controlEpoch
    const accept = async (
      artifactKey: string,
      kind: ProductBuildArtifactKindV1,
      payload: Record<string, unknown>,
    ) => acceptProductBuildArtifact({
      scope: f.scope, buildId: f.build.id!, controlEpoch,
      artifactKey, kind, payload,
      inputHash: '1'.repeat(64), producerReceiptHash: '2'.repeat(64),
    })
    for (const artifactKey of [
      'quality.adventure-review.structure',
      'quality.adventure-review.act-1',
      'quality.adventure-review.act-2',
      'quality.adventure-review.act-3',
    ]) {
      await accept(artifactKey, 'playtest-report', {
        schema: 'fixture.quality-review-batch', version: 1, artifactKey,
      })
    }
    await accept('quality.adventure-review', 'playtest-report', {
      schema: 'fixture.quality-review', version: 1, passed: true,
    })
    await accept('media.requirements', 'asset-manifest', {
      schema: 'fixture.media-requirements', version: 1,
    })
    await accept('media.vision-preflight', 'integration-report', {
      schema: 'fixture.vision-preflight', version: 1, passed: true,
    })
    const visualBible = {
      schema: 'fixture.visual-bible', version: 1,
      characterAnchors: [{ characterKey: 'character.player', description: '冻结锚点' }],
    }
    await accept('media.visual-bible', 'visual-bible', visualBible)
    const visualBibleHash = await hashProductProductionValueV2({
      schema: 'storyforge.text-adventure-visual-anchor-confirmation', version: 1,
      visualBible,
    })
    await accept('media.anchor-decision', 'visual-bible', {
      schema: 'storyforge.text-adventure-media-anchor-decision-artifact', version: 1,
      decision: 'confirm-character-anchors', visualBibleHash,
    })
    await db.productBuildArtifacts.where('buildId').equals(f.build.id!).and(row => (
      row.controlEpoch === controlEpoch
    )).modify({ status: 'invalid' })

    const failureJson = canonicalProductProductionJsonV2({
      code: 'user-resumed',
      previousFailure: {
        taskKey: 'media.anchor-author-gate', code: 'task-executor-failed',
        detail: '商业候选生成图片前需要作者明确确认角色视觉锚点',
        taskFailures: {
          'content.scene-script.act-1.part-1': {
            taskKey: 'content.scene-script.act-1.part-1', code: 'task-executor-failed',
            detail: '已经修复的历史正文失败',
          },
        },
      },
    })
    await expect(latestConfirmedTextAdventureAnchorRecoveryEpochV1({
      buildId: f.build.id!, beforeControlEpoch: controlEpoch + 3, failureJson,
    })).resolves.toBe(controlEpoch)
    await expect(latestConfirmedTextAdventureAnchorRecoveryEpochV1({
      buildId: f.build.id!, beforeControlEpoch: controlEpoch + 3,
      failureJson: canonicalProductProductionJsonV2({
        code: 'user-resumed', previousFailure: {
          taskKey: 'content.scene-script.act-1.part-1', code: 'task-executor-failed',
          detail: '当前正文失败',
        },
      }),
    })).resolves.toBeNull()
  })

  it('句读紧邻已登记 choice/scene key 时仍精确路由到对应幕对白，不误判为幽灵引用', async () => {
    const f = await textAdventureQualityRecoveryFixture('quality-review-punctuated-reference')
    await acceptProductBuildArtifact({
      scope: f.scope, buildId: f.build.id!, controlEpoch: f.build.controlEpoch,
      artifactKey: 'content.scene-script.act-1.part-1', kind: 'narrative',
      payload: {
        schema: 'fixture.scene-script-part', version: 1,
        scenes: [{ sceneKey: 'scene.001' }],
        choices: [{
          choiceKey: 'choice.001', sourceNodeKey: 'scene.001', targetNodeKey: 'scene.002',
        }],
      },
      inputHash: '5'.repeat(64), producerReceiptHash: '6'.repeat(64),
    })
    await acceptProductBuildArtifact({
      scope: f.scope, buildId: f.build.id!, controlEpoch: f.build.controlEpoch,
      artifactKey: 'quality.adventure-review', kind: 'playtest-report',
      payload: failedTextAdventureReview({
        issues: [{
          severity: 'blocking', artifactKey: 'content.narrative',
          detail: 'choice.001: 选择承诺与 scene.002. 的目标开场不一致。',
          recommendation: '只重写 choice.001.description，保持 sourceNodeKey 与 targetNodeKey 不变。',
        }],
      }),
      inputHash: '7'.repeat(64), producerReceiptHash: '8'.repeat(64),
    })
    const invalidated = await recoveryInvalidatedTaskKeys({
      buildId: f.build.id!,
      previousControlEpoch: f.build.controlEpoch,
      plan: f.recoveryPlan,
      failureJson: JSON.stringify({
        taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
        detail: '文字冒险叙事质量审查未通过，必须先修复阻塞问题并重新生产',
      }),
    })
    expect(invalidated).toContain('content.dialogue-pass.act-1')
    expect(invalidated).not.toContain('content.scene-script.act-1.part-1')
    expect(invalidated).not.toContain('content.dialogue-pass.act-2')
    expect(invalidated).not.toContain('content.dialogue-pass.act-3')
    expect(invalidated).not.toContain('content.narrative-decision-plan')
    expect(invalidated).not.toContain('content.main-quest-plan')
  })

  it('审查字段路径保留 stable key owner，精确路由 choice.label 到对应幕对白', async () => {
    const f = await textAdventureQualityRecoveryFixture('quality-review-field-path-owner')
    await acceptProductBuildArtifact({
      scope: f.scope, buildId: f.build.id!, controlEpoch: f.build.controlEpoch,
      artifactKey: 'content.scene-script.act-1.part-1', kind: 'narrative',
      payload: {
        schema: 'fixture.scene-script-part', version: 1,
        scenes: [{ sceneKey: 'scene.001' }, { sceneKey: 'scene.002' }],
        choices: [{
          choiceKey: 'choice.001', sourceNodeKey: 'scene.001', targetNodeKey: 'scene.002',
        }],
      },
      inputHash: '5'.repeat(64), producerReceiptHash: '6'.repeat(64),
    })
    await acceptProductBuildArtifact({
      scope: f.scope, buildId: f.build.id!, controlEpoch: f.build.controlEpoch,
      artifactKey: 'quality.adventure-review', kind: 'playtest-report',
      payload: failedTextAdventureReview({
        issues: [{
          severity: 'blocking', artifactKey: 'content.narrative',
          detail: 'choice.001.label 承诺了并不存在的移动，和 scene.002 开场不一致。',
          recommendation: '只重写 choice.001.description，保持 targetNodeKey 不变。',
        }],
      }),
      inputHash: '7'.repeat(64), producerReceiptHash: '8'.repeat(64),
    })
    const invalidated = await recoveryInvalidatedTaskKeys({
      buildId: f.build.id!, previousControlEpoch: f.build.controlEpoch,
      plan: f.recoveryPlan,
      failureJson: JSON.stringify({
        taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
        detail: '文字冒险叙事质量审查未通过，必须先修复阻塞问题并重新生产',
      }),
    })
    expect(invalidated).toContain('content.dialogue-pass.act-1')
    expect(invalidated).not.toContain('content.dialogue-pass.act-2')
    expect(invalidated).not.toContain('content.dialogue-pass.act-3')
    expect(invalidated).not.toContain('content.narrative-decision-plan')

    const nestedAfterInterruptedReview = await recoveryInvalidatedTaskKeys({
      buildId: f.build.id!, previousControlEpoch: f.build.controlEpoch,
      plan: f.recoveryPlan,
      failureJson: JSON.stringify({
        taskKey: 'content.adventure-quality-review.structure',
        code: 'provider-result-unknown',
        detail: 'provider 请求后页面进程中断，结果未知',
        repairCause: {
          taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
          detail: '文字冒险叙事质量审查未通过，必须先修复阻塞问题并重新生产',
        },
      }),
    })
    expect(nestedAfterInterruptedReview).toContain('content.dialogue-pass.act-1')
    expect(nestedAfterInterruptedReview).not.toContain('content.dialogue-pass.act-2')
  })

  it('对白审查发现 speakerKey 错标时回到对应幕 Scene Writer，而非重跑无权改 speaker 的 Dialogue Pass', async () => {
    const f = await textAdventureQualityRecoveryFixture('quality-review-speaker-owner')
    await acceptProductBuildArtifact({
      scope: f.scope, buildId: f.build.id!, controlEpoch: f.build.controlEpoch,
      artifactKey: 'quality.adventure-review', kind: 'playtest-report',
      payload: failedTextAdventureReview({
        issues: [{
          severity: 'blocking', artifactKey: 'content.dialogue-pass.act-2',
          detail: 'beat.act-2.017 的 speakerKey 错标，当前角色不可能说出这句话。',
          recommendation: '修正说话人归属，保留对白含义。',
        }],
      }),
      inputHash: '9'.repeat(64), producerReceiptHash: 'a'.repeat(64),
    })
    const invalidated = await recoveryInvalidatedTaskKeys({
      buildId: f.build.id!, previousControlEpoch: f.build.controlEpoch,
      plan: f.recoveryPlan,
      failureJson: JSON.stringify({
        taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
        detail: '文字冒险叙事质量审查未通过，必须先修复阻塞问题并重新生产',
      }),
    })
    expect([...invalidated]).toEqual(expect.arrayContaining([
      'content.scene-script.act-2.part-1',
      'content.scene-script.act-2',
      'content.dialogue-pass.act-2',
      'integration.narrative',
    ]))
    expect(invalidated).not.toContain('content.scene-script.act-1.part-1')
    expect(invalidated).not.toContain('content.scene-script.act-3.part-1')
    expect(invalidated).not.toContain('content.dialogue-pass.act-1')
    expect(invalidated).not.toContain('content.dialogue-pass.act-3')
  })

  it('叙事集成点名不兼容对白工件时只重跑对应幕 Dialogue Pass', async () => {
    const f = await textAdventureQualityRecoveryFixture('integration-dialogue-owner')
    const invalidated = await recoveryInvalidatedTaskKeys({
      buildId: f.build.id!, previousControlEpoch: f.build.controlEpoch,
      plan: f.recoveryPlan,
      failureJson: JSON.stringify({
        blockerKey: 'integration.narrative', resolution: { action: 'retry' },
        previousFailure: {
          taskKey: 'integration.narrative', code: 'task-executor-failed', attempt: 1,
          detail: 'content.dialogue-pass.act-3 与当前场景包不兼容:不同 speakerKey 之间复制对白',
        },
      }),
    })
    expect(invalidated).toContain('content.dialogue-pass.act-3')
    expect(invalidated).toContain('integration.narrative')
    expect(invalidated).not.toContain('content.dialogue-pass.act-1')
    expect(invalidated).not.toContain('content.dialogue-pass.act-2')
    expect(invalidated).not.toContain('content.scene-script.act-3.part-1')
  })

  it('多幕确定性装配同时拒绝旧正文时回溯全部对应 Scene Writer 分包', async () => {
    const f = await textAdventureQualityRecoveryFixture('multi-act-assembly-owner')
    const failure = (taskKey: string, detail: string) => ({
      taskKey, code: 'task-executor-failed', attempt: 1, detail,
    })
    const act1 = failure(
      'content.scene-script.act-1',
      'scene.001 以玩家姓名进行第三人称叙事；narration/action 必须使用第二人称「你」',
    )
    const act2 = failure(
      'content.scene-script.act-2',
      'scene.008 正文让未授权角色克罗当面发言；不得用已授权 speakerKey 包装越界登场',
    )
    const act3 = failure(
      'content.scene-script.act-3',
      'scene.011 以玩家姓名进行第三人称叙事；narration/action 必须使用第二人称「你」',
    )
    const invalidated = await recoveryInvalidatedTaskKeys({
      buildId: f.build.id!, previousControlEpoch: f.build.controlEpoch,
      plan: f.recoveryPlan,
      failureJson: JSON.stringify({
        blockerKey: 'content.scene-script.act-1', resolution: { action: 'retry' },
        previousFailure: {
          ...act1,
          taskFailures: {
            'content.scene-script.act-1': act1,
            'content.scene-script.act-2': act2,
            'content.scene-script.act-3': act3,
          },
        },
      }),
    })
    expect([...invalidated]).toEqual(expect.arrayContaining([
      'content.scene-script.act-1.part-1', 'content.scene-script.act-1.part-2',
      'content.scene-script.act-2.part-1', 'content.scene-script.act-2.part-2',
      'content.scene-script.act-3.part-1', 'content.scene-script.act-3.part-2',
      'content.scene-script.act-1', 'content.scene-script.act-2', 'content.scene-script.act-3',
      'integration.narrative',
    ]))
  })

  it('quest-script 聚合失败回溯到陈旧专业分片，补充分片与主线分片互不误伤', async () => {
    const f = await textAdventureQualityRecoveryFixture('quest-script-aggregate-owner')
    const supplemental = await recoveryInvalidatedTaskKeys({
      buildId: f.build.id!, previousControlEpoch: f.build.controlEpoch,
      plan: f.recoveryPlan,
      failureJson: JSON.stringify({
        blockerKey: 'content.quest-script', resolution: { action: 'retry' },
        previousFailure: {
          taskKey: 'content.quest-script', code: 'task-executor-failed', attempt: 1,
          detail: '[text-adventure-production-artifact-v2] questScript.sideQuestScripts[0] 引用未知任务条目',
        },
      }),
    })
    expect(supplemental).toContain('content.quest-script.supplemental')
    expect(supplemental).toContain('content.quest-script')
    expect([...supplemental].some(taskKey => taskKey.startsWith('content.quest-script.main.'))).toBe(false)

    const main = await recoveryInvalidatedTaskKeys({
      buildId: f.build.id!, previousControlEpoch: f.build.controlEpoch,
      plan: f.recoveryPlan,
      failureJson: JSON.stringify({
        blockerKey: 'content.quest-script', resolution: { action: 'retry' },
        previousFailure: {
          taskKey: 'content.quest-script', code: 'task-executor-failed', attempt: 1,
          detail: '[text-adventure-production-artifact-v2] mainObjectiveScripts[0] 引用未知目标',
        },
      }),
    })
    expect([...main].filter(taskKey => taskKey.startsWith('content.quest-script.main.'))).toHaveLength(6)
    expect(main).toContain('content.quest-script')
    expect(main).not.toContain('content.quest-script.supplemental')
  })

  it('低分但没有 blocking issue 时也重跑四个专业批次，避免聚合器永久复现旧分数', async () => {
    const f = await textAdventureQualityRecoveryFixture('quality-review-empty-fallback')
    await acceptProductBuildArtifact({
      scope: f.scope, buildId: f.build.id!, controlEpoch: f.build.controlEpoch,
      artifactKey: 'quality.adventure-review', kind: 'playtest-report',
      payload: failedTextAdventureReview({ issues: [], pacing: 2 }),
      inputHash: '3'.repeat(64), producerReceiptHash: '4'.repeat(64),
    })
    const invalidated = await recoveryInvalidatedTaskKeys({
      buildId: f.build.id!,
      previousControlEpoch: f.build.controlEpoch,
      plan: f.recoveryPlan,
      failureJson: JSON.stringify({
        taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
        detail: '文字冒险叙事质量审查未通过，必须先修复阻塞问题并重新生产',
      }),
    })
    expect([...invalidated]).toEqual(expect.arrayContaining([
      'content.adventure-quality-review.structure',
      'content.adventure-quality-review.act-1',
      'content.adventure-quality-review.act-2',
      'content.adventure-quality-review.act-3',
      'content.adventure-quality-review',
    ]))
  })

  beforeAll(async () => { await db.delete(); await db.open() })
  beforeEach(async () => {
    // Repeated versionchange/delete cycles can leave fake-indexeddb waiting on
    // an old Dexie connection under the full coverage run. These tests only
    // require row isolation, so clear the already-open schema atomically.
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map(table => table.clear()))
    })
  })
  afterAll(() => db.close())

  it('结构校验失败前保留模型原文证据，失败候选不成为正式产物', async () => {
    const owned = await fixture('scheduler-rejected-output')
    const raw = '{"scene":"未完成的候选"'
    let calls = 0
    const result = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: async request => {
        calls++
        await request.onModelOutput?.(raw)
        throw new ProductProductionDraftRejectedErrorV1('JSON 不完整', {
          modelCalls: 1, inputTokens: 100, outputTokens: 10, mediaCalls: 0,
          costUsd: null, durationMs: 100, storageBytes: 0,
        })
      },
      capabilityBindings: [{ requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: 'a'.repeat(64) }],
    })
    expect(result.tasks.find(item => item.taskKey === 'content.design')?.status).toBe('blocked')
    expect((await db.agentRunArtifacts.toArray()).some(item => item.artifactKind === 'raw-response' && item.content === raw)).toBe(true)
    expect(await db.productBuildArtifacts.count()).toBe(0)
    expect(calls).toBe(1)
    expect(result.budget.usage.modelCalls).toBe(1)
    expect(result.budget.usage.costUsd).toBeNull()
    const evidence = await readProductProductionTaskEvidenceV1({
      scope: owned.scope, productionId: owned.productionId, taskKey: 'content.design',
    })
    expect(evidence.some(item => item.kind === 'raw-response' && item.content === raw)).toBe(true)
    expect(evidence.some(item => item.kind === 'tool-result' && item.content.includes('JSON 不完整'))).toBe(true)
    const repair = JSON.parse(await readProductProductionRepairFeedback({
      projectId: owned.scope.projectId, scope: owned.scope, productProductionId: owned.productionId,
      productBuildId: result.buildId, productProductionTaskKey: 'content.design',
    }))
    expect(repair.previous.evidence.some((item: { content: string }) => item.content === raw)).toBe(true)
    const other = await fixture('scheduler-other-owner')
    await expect(readProductProductionTaskEvidenceV1({
      scope: other.scope, productionId: owned.productionId, taskKey: 'content.design',
    })).rejects.toThrow()
  })

  it.each([
    new AIError(401, 'invalid token'),
    new AICompletionResponseErrorV1('empty', 'content=0; finish=length'),
  ])('授权拒绝与空响应不隐藏重试: %s', async error => {
    const owned = await fixture('scheduler-nonretryable')
    let calls = 0
    const input = { scope: owned.scope, productionId: owned.productionId,
      executor: async () => { calls++; throw error },
      capabilityBindings: [{ requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: 'a'.repeat(64) }] }
    const result = await runProductProductionUntilBlockedV1(input)
    expect(calls).toBe(1)
    expect(result.tasks.find(item => item.taskKey === 'content.design')?.status).toBe('blocked')
    await runProductProductionUntilBlockedV1(input)
    expect(calls).toBe(1)
  })

  it('长 Brief 超过单源软上限仍全文交付；尾部约束与 V3 证据一致', async () => {
    const owned = await fixture('scheduler-long-contract', Array.from({ length: 6 }, (_, i) => `${i}：${'潮'.repeat(800)}`))
    const calls = new Map<string, number>()
    const executor = executorFor(owned, calls, { active: 0, peak: 0 })
    const projection = await runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: async request => {
        expect(request.contextText).toContain('不得写回世界正式表')
        expect(request.contextText).not.toContain('…（上下文已截断）')
        for (const fact of owned.brief.intent.requiredFacts) expect(request.contextText).toContain(fact)
        return executor(request)
      },
      capabilityBindings: [{ requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: 'a'.repeat(64) }],
    })
    const task = projection.tasks.find(item => item.taskKey === 'content.design')!
    expect(task.status).toBe('completed')
    expect(calls.get('content.design')).toBe(1)
    const evidence = await readContextGatewayManifestV3ForAttemptV1({ scope: owned.scope,
      runId: task.runId!, stepId: 'content.design', attempt: 1 })
    const source = evidence.manifest.sources.find(item => item.key === 'product-production.brief')!
    expect(source.delivery).toBe('full')
    expect(source.originalTokens).toBeGreaterThan(8000)
    expect(source.tokens).toBe(source.originalTokens)
  })

  it('超过任务总预算在调用前持久化阻塞；重新调度不自动花费模型调用', async () => {
    const owned = await fixture('scheduler-oversized-contract', Array.from({ length: 20 }, (_, i) => `${i}：${'潮'.repeat(1900)}`))
    const calls = new Map<string, number>()
    const input = { scope: owned.scope, productionId: owned.productionId,
      executor: executorFor(owned, calls, { active: 0, peak: 0 }),
      capabilityBindings: [{ requirementKey: owned.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: 'a'.repeat(64) }] }
    const projection = await runProductProductionUntilBlockedV1(input)
    expect(calls.size).toBe(0)
    expect(projection.tasks.find(item => item.taskKey === 'content.design')?.status).toBe('blocked')
    const build = await db.productBuilds.get(projection.buildId)
    expect(build?.status).toBe('recovery-required')
    expect(build?.failureJson).toContain('task-context-budget-exceeded')
    await runProductProductionUntilBlockedV1(input)
    expect(calls.size).toBe(0)
  })

  it('同一专业 task 跨多 epoch 失败时，修复上下文与调度投影都保留最新直接因果失败', async () => {
    const f = await textAdventureQualityRecoveryFixture('same-task-cross-epoch-failure-cause')
    const taskKey = 'content.quest-script.supplemental'
    const latestDetail = 'epoch 278 直接失败：ambientEventScripts[0] 引用了当前规则表中不存在的 abilityKey。'
    const previousDetail = 'epoch 277 旧失败：sideQuestScripts[0] 缺少 entryKey。'
    const oldestDetail = 'epoch 276 更旧失败：任务脚本输出不是合法 JSON。'
    const failureJson = canonicalProductProductionJsonV2({
      blockerKey: taskKey,
      resolution: { action: 'retry', note: '按最新直接失败修复' },
      previousFailure: {
        taskKey, code: 'task-executor-failed', attempt: 3, detail: latestDetail,
        previousFailure: {
          taskKey, code: 'task-executor-failed', attempt: 2, detail: previousDetail,
          previousFailure: {
            taskKey, code: 'task-executor-failed', attempt: 1, detail: oldestDetail,
          },
        },
      },
      repairCause: {
        taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
        detail: '文字冒险叙事质量审查未通过，必须先修复阻塞问题并重新生产',
      },
      taskFailures: {
        [taskKey]: { taskKey, code: 'task-executor-failed', attempt: 1, detail: oldestDetail },
      },
    })
    await db.productBuilds.update(f.build.id!, { failureJson })

    const schedulerFailures = textAdventureTaskFailures(failureJson)
    expect(schedulerFailures.get(taskKey)).toMatchObject({
      taskKey, attempt: 3, detail: latestDetail,
    })

    const feedback = JSON.parse(await readTextAdventureRepairFeedbackV1({
      projectId: f.scope.projectId,
      scope: f.scope,
      productProductionId: f.productionId,
      productBuildId: f.build.id!,
      productProductionTaskKey: taskKey,
    })) as {
      lastTaskFailures: Array<{ taskKey: string; attempt: number | null; detail: string }>
    }
    expect(feedback.lastTaskFailures.filter(row => row.taskKey === taskKey)).toEqual([{
      taskKey, attempt: 3, detail: latestDetail, code: 'task-executor-failed',
    }])
    expect(JSON.stringify(feedback.lastTaskFailures)).not.toContain(previousDetail)
    expect(JSON.stringify(feedback.lastTaskFailures)).not.toContain(oldestDetail)
  })

  it('暂停覆盖 failureJson 后仍从同一 Build 最近失败审查恢复精确返修证据', async () => {
    const f = await textAdventureQualityRecoveryFixture('paused-quality-repair-evidence')
    const issue = {
      severity: 'blocking' as const,
      artifactKey: 'content.narrative-arc-plan',
      detail: '[owningKey=decision.001] decision.001 的两个路线回响文案没有体现代价差异。',
      recommendation: '保持冻结 option 与 echoSceneKeys，只改写两个条件化回响的玩家可见语义。',
    }
    await seedFrozenTextAdventureQualityReviewEpoch({
      fixture: f, issueScope: 'structure', issue,
    })
    await db.productBuilds.update(f.build.id!, {
      status: 'paused', controlEpoch: f.build.controlEpoch + 1,
      resumeState: 'building',
      failureJson: canonicalProductProductionJsonV2({
        code: 'user-paused', reason: '作者从制作工作台暂停',
      }),
    })
    await db.productProductions.update(f.productionId, {
      status: 'paused', controlEpoch: f.build.controlEpoch + 1,
    })
    const feedback = JSON.parse(await readTextAdventureRepairFeedbackV1({
      projectId: f.scope.projectId,
      scope: f.scope,
      productProductionId: f.productionId,
      productBuildId: f.build.id!,
      productProductionTaskKey: 'content.narrative-decision-plan',
    })) as {
      source: { controlEpoch: number }
      blockingIssues: Array<{ detail: string; repairTaskKeys: string[] }>
      lastTaskFailures: unknown[]
    }
    expect(feedback.source.controlEpoch).toBe(f.build.controlEpoch)
    expect(feedback.blockingIssues).toEqual([expect.objectContaining({
      detail: expect.stringContaining('decision.001'),
      repairTaskKeys: ['content.narrative-decision-plan'],
    })])
    expect(feedback.lastTaskFailures).toEqual([])
    await db.productBuilds.update(f.build.id!, {
      status: 'building', failureJson: '{}',
    })
    await db.productProductions.update(f.productionId, { status: 'producing' })
    const resumedFeedback = JSON.parse(await readTextAdventureRepairFeedbackV1({
      projectId: f.scope.projectId,
      scope: f.scope,
      productProductionId: f.productionId,
      productBuildId: f.build.id!,
      productProductionTaskKey: 'content.narrative-decision-plan',
    })) as typeof feedback
    expect(resumedFeedback.blockingIssues).toEqual(feedback.blockingIssues)
  })

  it('旧审查看不到已编译条件回响时只重审质量，不扇出重写决定计划和分场', async () => {
    const f = await textAdventureQualityRecoveryFixture('compiled-echo-supersedes-old-review')
    await seedFrozenTextAdventureQualityReviewEpoch({
      fixture: f,
      issueScope: 'structure',
      issue: {
        severity: 'blocking', artifactKey: 'content.narrative-arc-plan',
        detail: '[owningKey=decision.001] decision.001 的两条路线在 scene.002 没有任何玩家可见回响差异。',
        recommendation: '在 scene.002 增加由两个 persistentEffectKey 分别控制的条件化段落。',
      },
    })
    await db.productBuilds.update(f.build.id!, {
      status: 'paused', controlEpoch: f.build.controlEpoch + 1,
      resumeState: 'building',
      failureJson: canonicalProductProductionJsonV2({
        code: 'user-paused', reason: '作者从制作工作台暂停',
      }),
    })
    await db.productProductions.update(f.productionId, {
      status: 'paused', controlEpoch: f.build.controlEpoch + 1,
    })
    const invalidated = await recoveryInvalidatedTaskKeys({
      buildId: f.build.id!, previousControlEpoch: f.build.controlEpoch,
      plan: f.recoveryPlan,
      failureJson: canonicalProductProductionJsonV2({
        code: 'user-paused', reason: '作者从制作工作台暂停',
      }),
    })
    expect([...invalidated]).toEqual(expect.arrayContaining([
      'content.adventure-quality-review.structure',
      'content.adventure-quality-review.act-1',
      'content.adventure-quality-review.act-2',
      'content.adventure-quality-review.act-3',
      'content.adventure-quality-review',
    ]))
    expect(invalidated.has('content.narrative-decision-plan')).toBe(false)
    expect([...invalidated].some(taskKey => taskKey.startsWith('content.scene-script.'))).toBe(false)
    expect(await readTextAdventureRepairFeedbackV1({
      projectId: f.scope.projectId,
      scope: f.scope,
      productProductionId: f.productionId,
      productBuildId: f.build.id!,
      productProductionTaskKey: 'content.narrative-decision-plan',
    })).toBe('')
  })

  it('长失败证据有界保留首尾，使同一审查失败的 owning 与批次外引用都可返修', async () => {
    const f = await textAdventureQualityRecoveryFixture('repair-feedback-head-tail-evidence')
    const taskKey = 'content.adventure-quality-review.act-2'
    const detail = '叙事质量审查越过批次 owning coverage:'
      + 'act-2 审查 issue.detail 的 owningKey 未登记或不归本批:choice.015；'
      + '中间诊断='.padEnd(900, '甲')
      + '；act-2 审查把批次外内容当作返修目标:ending.001'
    await db.productBuilds.update(f.build.id!, {
      controlEpoch: f.build.controlEpoch + 1,
      failureJson: canonicalProductProductionJsonV2({
        blockerKey: taskKey,
        resolution: { action: 'retry' },
        previousFailure: { taskKey, code: 'task-executor-failed', attempt: 2, detail },
      }),
    })
    const feedback = JSON.parse(await readTextAdventureRepairFeedbackV1({
      projectId: f.scope.projectId,
      scope: f.scope,
      productProductionId: f.productionId,
      productBuildId: f.build.id!,
      productProductionTaskKey: taskKey,
    })) as { lastTaskFailures: Array<{ detail: string }> }
    expect(feedback.lastTaskFailures[0].detail).toContain('owningKey 未登记或不归本批:choice.015')
    expect(feedback.lastTaskFailures[0].detail).toContain('把批次外内容当作返修目标:ending.001')
    expect(feedback.lastTaskFailures[0].detail.length).toBeLessThanOrEqual(800)
  })

  it('返修上下文携带上一轮已验收的完整本任务工件，防止局部修复覆盖整批正文', async () => {
    const f = await textAdventureQualityRecoveryFixture('repair-feedback-complete-baseline')
    const taskKey = 'content.scene-script.act-1.part-2'
    const baselinePayload = {
      schema: 'storyforge.text-adventure-scene-script-bundle-artifact',
      version: 1,
      actKey: 'act.1',
      moduleTitle: '潮门旧稿',
      scenes: [{
        sceneKey: 'scene.003', title: '潮声下的约定', summary: '这段完整正文必须保留。',
        beats: [{
          beatKey: 'beat.act-1.003', kind: 'narration', speakerKey: null,
          text: '玩家沿着旧潮道抵达灯塔，并记住守灯人的警告。', order: 0,
        }],
      }],
      choices: [], endings: [],
    }
    const baselineHash = '9'.repeat(64)
    await acceptProductBuildArtifact({
      scope: f.scope, buildId: f.build.id!, controlEpoch: f.build.controlEpoch,
      artifactKey: taskKey, kind: 'narrative', payload: baselinePayload,
      inputHash: '8'.repeat(64), producerReceiptHash: '7'.repeat(64),
    })
    await db.productBuilds.update(f.build.id!, {
      controlEpoch: f.build.controlEpoch + 1,
      failureJson: canonicalProductProductionJsonV2({
        blockerKey: taskKey,
        resolution: { action: 'retry' },
        previousFailure: {
          taskKey, code: 'task-executor-failed', attempt: 2,
          detail: '[text-adventure-scene-script] 第 1 幕正文不足:586/1440',
        },
      }),
    })
    const feedback = JSON.parse(await readTextAdventureRepairFeedbackV1({
      projectId: f.scope.projectId,
      scope: f.scope,
      productProductionId: f.productionId,
      productBuildId: f.build.id!,
      productProductionTaskKey: taskKey,
    })) as {
      instruction: string
      baselineArtifact: {
        artifactKey: string
        controlEpoch: number
        contentHash: string
        payload: typeof baselinePayload
      }
    }
    expect(feedback.instruction).toContain('补丁协议错误仍继续提交补丁')
    expect(feedback.instruction).toContain('底稿结构错误才提交完整工件')
    expect(feedback.baselineArtifact).toMatchObject({
      artifactKey: taskKey,
      controlEpoch: f.build.controlEpoch,
      payload: baselinePayload,
    })
    expect(feedback.baselineArtifact.contentHash).not.toBe(baselineHash)
    expect(feedback.baselineArtifact.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('从授权 Brief 自主并行执行 DAG、冻结 child receipts、编译 Preview 并完成 root join', async () => {
    const owned = await fixture('scheduler-parallel')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0, proveSiblingOverlap: true }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: executorFor(owned, calls, concurrency),
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    expect(projection.terminal).toBe(true)
    expect(projection.tasks.every(task => task.status === 'completed')).toBe(true)
    expect(projection.budget.usage.modelCalls).toBeGreaterThan(0)
    expect(projection.budget.usage.modelCalls).toBeLessThanOrEqual(projection.budget.limits.maximumModelCalls)
    expect(projection.budget.usage.storageBytes).toBeLessThanOrEqual(projection.budget.limits.maximumStorageBytes)
    expect(concurrency.peak).toBeGreaterThanOrEqual(2)
    expect([...calls.values()].every(count => count === 1)).toBe(true)
    const build = await db.productBuilds.get(projection.buildId)
    expect(build).toMatchObject({ status: 'release-ready' })
    expect(build!.rootTerminalReceiptHash).toBe((await db.agentRuns.get(projection.rootRunId))!.terminalReceiptHash)
    const children = await db.agentRuns.where('productBuildId').equals(projection.buildId).toArray()
    expect(children.filter(row => row.parentRunId === projection.rootRunId)).toHaveLength(projection.tasks.length)
    expect(new Set(children.filter(row => row.parentRunId === projection.rootRunId).map(row => row.parentRelation)).size)
      .toBe(projection.tasks.length)
    const integrationRun = children.find(row => row.parentRelation === 'task:integration.package')!
    const evidence = await readContextGatewayManifestV3ForAttemptV1({
      scope: owned.scope,
      runId: integrationRun.id!,
      stepId: 'integration.package',
      attempt: 1,
    })
    const catalog = await openWorldSemanticResourceCatalogV1({
      localReleaseRecordId: owned.release.id!,
      expectedProjectId: owned.scope.projectId,
      expectedWorldId: owned.scope.worldId,
    })
    const compilationKeys = resolveProductProductionWorldCompilationDescriptorsV2({
      descriptors: catalog.resources,
      selection: owned.brief.source.selection,
    }).map(descriptor => descriptor.resourceKey)
    const traced = [
      ...evidence.manifest.gateway.retrievalTrace.mandatory,
      ...evidence.manifest.gateway.retrievalTrace.autoSelected,
    ]
    expect(compilationKeys.every(resourceKey => traced.some(decision => (
      decision.resourceKey === resourceKey && decision.depth === 'original'
    )))).toBe(true)
  }, 30_000)

  it('同 epoch 并发 sibling 相继失败时保留首个 blocker，并结算全部用量与脱敏错误证据', async () => {
    const owned = await fixture('scheduler-sibling-failure-evidence')
    const basePlan = await createProductProductionPlanV3({
      buildNumber: 1,
      briefHash: await hashProductProductionValueV2(owned.brief),
      brief: owned.brief,
    })
    const failingTaskKeys = new Set(['content.narrative', 'media.requirements'])
    const plan = {
      ...basePlan,
      tasks: basePlan.tasks.map(task => failingTaskKeys.has(task.taskKey)
        ? { ...task, maxAttempts: 1 }
        : task),
    }
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const successExecutor = executorFor(owned, calls, concurrency)
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    const first = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor: successExecutor,
      suppliedPlan: plan,
      capabilityBindings,
    })
    expect(first.tasks.find(task => task.taskKey === 'content.design')?.status).toBe('completed')

    let siblingArrivals = 0
    let releaseSiblings!: () => void
    const siblingsStarted = new Promise<void>(resolve => { releaseSiblings = resolve })
    const paidFailure = (message: string, inputTokens: number, outputTokens: number) => Object.assign(
      new Error(message),
      {
        productProductionUsage: {
          modelCalls: 1, inputTokens, outputTokens, mediaCalls: 0,
          costUsd: 0.01, durationMs: 7, storageBytes: 0,
        },
      },
    )
    const executor: ProductProductionTaskExecutorV1 = async request => {
      if (!failingTaskKeys.has(request.task.taskKey)) return successExecutor(request)
      calls.set(request.task.taskKey, (calls.get(request.task.taskKey) ?? 0) + 1)
      siblingArrivals += 1
      if (siblingArrivals === failingTaskKeys.size) releaseSiblings()
      await siblingsStarted
      if (request.task.taskKey === 'content.narrative') {
        throw paidFailure('primary narrative failure', 101, 11)
      }
      for (let spin = 0; spin < 200; spin += 1) {
        const build = await db.productBuilds.get(request.buildId)
        if (build?.status === 'recovery-required') {
          throw paidFailure('secondary provider failure api-key=sk-proj-secondarysecret999', 202, 22)
        }
        await new Promise(resolve => globalThis.setTimeout(resolve, 0))
      }
      throw new Error('secondary sibling did not observe primary recovery state')
    }

    const blocked = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      suppliedPlan: plan,
      capabilityBindings,
    })
    expect(blocked.buildStatus).toBe('recovery-required')
    const build = (await db.productBuilds.get(blocked.buildId))!
    const failure = JSON.parse(build.failureJson) as {
      taskKey: string
      detail: string
      taskFailures: Record<string, { detail: string }>
    }
    expect(failure).toMatchObject({
      taskKey: 'content.narrative',
      detail: 'primary narrative failure',
    })
    expect(failure.taskFailures['content.narrative'].detail).toBe('primary narrative failure')
    expect(failure.taskFailures['media.requirements'].detail).toContain('[redacted]')
    expect(build.failureJson).not.toContain('secondarysecret999')

    const ledger = JSON.parse(build.budgetLedgerJson) as {
      attempts: Array<{
        taskKey: string
        outcome: string
        usageKnown: boolean
        usage: { inputTokens: number; outputTokens: number } | null
      }>
    }
    const failedAttempts = ledger.attempts
      .filter(attempt => failingTaskKeys.has(attempt.taskKey))
      .sort((left, right) => left.taskKey.localeCompare(right.taskKey))
    expect(failedAttempts).toMatchObject([
      {
        taskKey: 'content.narrative', outcome: 'failed', usageKnown: true,
        usage: { inputTokens: 101, outputTokens: 11 },
      },
      {
        taskKey: 'media.requirements', outcome: 'failed', usageKnown: true,
        usage: { inputTokens: 202, outputTokens: 22 },
      },
    ])

    const mediaRun = (await db.agentRuns.where('productBuildId').equals(blocked.buildId).toArray())
      .find(run => run.parentRelation === 'task:media.requirements')!
    const cancellation = (await db.agentRunEvents.where('runId').equals(mediaRun.id!).toArray())
      .find(event => event.type === 'run.cancelled')!
    const cancellationPayload = JSON.parse(cancellation.payloadJson) as { reason: string }
    expect(cancellationPayload.reason).toContain('task-failed-after-sibling-build-stop')
    expect(cancellationPayload.reason).toContain('secondary provider failure')
    expect(cancellationPayload.reason).toContain('[redacted]')
    expect(cancellationPayload.reason).not.toContain('secondarysecret999')
  }, 30_000)

  it('并发兄弟先留下可重试失败、随后另一任务终止 Build 时回收非终态 child Run', async () => {
    const owned = await fixture('scheduler-retryable-sibling-cleanup')
    const basePlan = await createProductProductionPlanV3({
      buildNumber: 1,
      briefHash: await hashProductProductionValueV2(owned.brief),
      brief: owned.brief,
    })
    const plan = {
      ...basePlan,
      tasks: basePlan.tasks.map(task => task.taskKey === 'content.narrative'
        ? { ...task, maxAttempts: 1 }
        : task.taskKey === 'media.requirements'
          ? { ...task, maxAttempts: 2 }
          : task),
    }
    const calls = new Map<string, number>()
    const successExecutor = executorFor(owned, calls, { active: 0, peak: 0 })
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    await runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: successExecutor, suppliedPlan: plan, capabilityBindings,
    })

    let siblingArrivals = 0
    let releaseSiblings!: () => void
    const siblingsStarted = new Promise<void>(resolve => { releaseSiblings = resolve })
    const executor: ProductProductionTaskExecutorV1 = async request => {
      if (!['content.narrative', 'media.requirements'].includes(request.task.taskKey)) {
        return successExecutor(request)
      }
      siblingArrivals += 1
      if (siblingArrivals === 2) releaseSiblings()
      await siblingsStarted
      if (request.task.taskKey === 'media.requirements') {
        throw new Error('retryable sibling protocol failure')
      }
      for (let spin = 0; spin < 200; spin += 1) {
        const mediaRun = (await db.agentRuns.where('productBuildId').equals(request.buildId).toArray())
          .find(run => run.parentRelation === 'task:media.requirements')
        if (mediaRun?.id) {
          const events = await db.agentRunEvents.where('runId').equals(mediaRun.id).toArray()
          if (events.some(event => event.type === 'step.failed')) {
            throw new Error('terminal sibling failure after retryable peer')
          }
        }
        await new Promise(resolve => globalThis.setTimeout(resolve, 0))
      }
      throw new Error('retryable sibling failure was not durably observed')
    }

    const blocked = await runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId,
      executor, suppliedPlan: plan, capabilityBindings,
    })
    expect(blocked.buildStatus).toBe('recovery-required')
    const mediaRun = (await db.agentRuns.where('productBuildId').equals(blocked.buildId).toArray())
      .find(run => run.parentRelation === 'task:media.requirements')!
    expect(mediaRun.status).toBe('cancelled')
    const rootRun = (await db.agentRuns.where('productBuildId').equals(blocked.buildId).toArray())
      .find(run => run.parentRunId == null)!
    expect(rootRun.status).toBe('cancelled')
    expect((await db.agentRunEvents.where('runId').equals(rootRun.id!).toArray())
      .some(event => event.type === 'run.cancelled')).toBe(true)
    const cancellation = (await db.agentRunEvents.where('runId').equals(mediaRun.id!).toArray())
      .find(event => event.type === 'run.cancelled')
    expect(cancellation).toBeDefined()
    expect(JSON.parse(cancellation!.payloadJson)).toEqual({
      reason: 'scheduler-cycle-ended-after-build-stop',
    })
  }, 30_000)

  it('Build 停止时同时回收先前 control epoch 遗留的非终态根 Run', async () => {
    const owned = await fixture('scheduler-superseded-root-cleanup')
    const plan = await createProductProductionPlanV3({
      buildNumber: 1,
      briefHash: await hashProductProductionValueV2(owned.brief),
      brief: owned.brief,
    })
    const capabilityBindings = await Promise.all(owned.brief.capabilityRequirements
      .filter(requirement => requirement.mediaClass === 'text')
      .map(async requirement => ({
        requirementKey: requirement.requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: await hashProductProductionValueV2({ requirementKey: requirement.requirementKey }),
      })))
    await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      suppliedPlan: plan,
      capabilityBindings,
      executor: executorFor(owned, new Map(), { active: 0, peak: 0 }),
    })
    const build = (await db.productBuilds.where('productionId').equals(owned.productionId).first())!
    const oldRoot = (await db.agentRuns.where('productBuildId').equals(build.id!).toArray())
      .find(run => run.parentRunId == null)!
    expect(oldRoot.status).toBe('running')

    const nextEpoch = build.controlEpoch + 1
    await db.transaction('rw', db.productBuilds, db.productProductions, async () => {
      await db.productBuilds.update(build.id!, {
        status: 'recovery-required',
        controlEpoch: nextEpoch,
        failureJson: JSON.stringify({
          taskKey: 'content.narrative',
          code: 'task-executor-failed',
          detail: 'fixture blocker',
        }),
      })
      await db.productProductions.update(owned.productionId, { controlEpoch: nextEpoch })
    })

    const stopped = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor: async () => { throw new Error('停止 Build 不应再执行任务') },
    })
    expect(stopped.buildStatus).toBe('recovery-required')
    expect(await db.agentRuns.get(oldRoot.id!)).toMatchObject({ status: 'cancelled' })
    const cancellation = (await db.agentRunEvents.where('runId').equals(oldRoot.id!).toArray())
      .find(event => event.type === 'run.cancelled')
    expect(JSON.parse(cancellation!.payloadJson)).toEqual({
      reason: 'scheduler-cycle-ended-after-build-stop',
    })
  })

  it('provider 失败返回前 control epoch 已变化时，在取消事件保留有界脱敏诊断', async () => {
    const owned = await fixture('scheduler-stale-failure-evidence')
    let rejectProvider!: (error: Error) => void
    let markProviderStarted!: () => void
    const providerStarted = new Promise<void>(resolve => { markProviderStarted = resolve })
    const executor: ProductProductionTaskExecutorV1 = async request => {
      if (request.task.taskKey !== 'content.design') {
        throw new Error('epoch 变化后不应执行下游任务')
      }
      markProviderStarted()
      return await new Promise<ProductProductionTaskExecutionResultV1>((_resolve, reject) => {
        rejectProvider = reject
      })
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const cycle = runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    await providerStarted
    const production = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'pause', commandId: 'scheduler-stale-failure-evidence.pause',
        expectedStateRevision: production.stateRevision, reason: '模拟 provider 返回前作者暂停',
      },
    })
    rejectProvider(Object.assign(
      new Error(`epoch shifted failure api-key=sk-proj-stalecredential999 ${'x'.repeat(2_000)}`),
      {
        productProductionUsage: {
          modelCalls: 1, inputTokens: 303, outputTokens: 33, mediaCalls: 0,
          costUsd: 0.02, durationMs: 9, storageBytes: 0,
        },
      },
    ))
    const paused = await cycle
    expect(paused.buildStatus).toBe('paused')
    const designRun = (await db.agentRuns.where('productBuildId').equals(paused.buildId).toArray())
      .find(run => run.parentRelation === 'task:content.design')!
    const cancellation = (await db.agentRunEvents.where('runId').equals(designRun.id!).toArray())
      .find(event => event.type === 'run.cancelled')!
    const cancellationPayload = JSON.parse(cancellation.payloadJson) as { reason: string }
    expect(cancellationPayload.reason).toContain('task-failed-after-control-epoch-change')
    expect(cancellationPayload.reason).toContain('epoch shifted failure')
    expect(cancellationPayload.reason).toContain('[redacted]')
    expect(cancellationPayload.reason).not.toContain('stalecredential999')
    expect(cancellationPayload.reason.length).toBeLessThanOrEqual(1_000)
  }, 30_000)

  it('候选检查点后崩溃会从 durable payload 恢复，不重复调用已计费 executor', async () => {
    const owned = await fixture('scheduler-recovery')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const executor = executorFor(owned, calls, concurrency)
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    let injected = false
    await expect(runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
      onDurableBoundary(boundary, snapshot) {
        if (!injected && boundary === 'candidate.checkpoint'
          && snapshot.contract.scope.productProduction?.taskKey === 'content.design') {
          injected = true
          throw new Error('injected-process-crash')
        }
      },
    })).rejects.toThrow('injected-process-crash')
    expect(calls.get('content.design')).toBe(1)

    const recovered = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(recovered.terminal).toBe(true)
    expect(calls.get('content.design')).toBe(1)
    expect(await db.agentRunCheckpoints.count()).toBeGreaterThan(0)
    expect((await db.productBuildArtifacts.where('buildId').equals(recovered.buildId).toArray())
      .filter(row => row.artifactKey === 'design.game' && row.status === 'accepted')).toHaveLength(1)
  }, 30_000)

  it('provider 请求后的页面进程中断不会永久 building、近期并发不被误判且作者确认前绝不重复付费调用', async () => {
    const owned = await fixture('scheduler-provider-result-unknown', { retryModelCallHeadroom: 1 })
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    let releaseProvider!: (result: ProductProductionTaskExecutionResultV1) => void
    let markProviderStarted!: () => void
    const providerStarted = new Promise<void>(resolve => { markProviderStarted = resolve })
    let firstProviderCalls = 0
    const interruptedExecutor: ProductProductionTaskExecutorV1 = async request => {
      if (request.task.taskKey !== 'content.design') throw new Error('中断前只应执行首个设计任务')
      firstProviderCalls += 1
      markProviderStarted()
      return await new Promise<ProductProductionTaskExecutionResultV1>(resolve => {
        releaseProvider = resolve
      })
    }
    const abandonedCycle = runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor: interruptedExecutor,
      capabilityBindings,
    })
    await providerStarted
    expect(firstProviderCalls).toBe(1)

    // resetModules simulates HMR/reload: durable IndexedDB survives while the
    // old module-local ownership set is no longer visible to the new scheduler.
    vi.resetModules()
    const reloadedScheduler = await import('../../src/lib/product-production/scheduler')
    let duplicateProviderCalls = 0
    const mustNotRepeat: ProductProductionTaskExecutorV1 = async () => {
      duplicateProviderCalls += 1
      throw new Error('近期或结果未知的 provider 请求不得自动重发')
    }
    const recent = await reloadedScheduler.runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor: mustNotRepeat,
      capabilityBindings,
    })
    expect(recent).toMatchObject({ terminal: false, buildStatus: 'building' })
    expect(duplicateProviderCalls).toBe(0)

    const requestedAt = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(requestedAt + 24 * 60 * 60 * 1_000)
    let blocked
    try {
      blocked = await reloadedScheduler.runProductProductionSchedulerCycleV1({
        scope: owned.scope,
        productionId: owned.productionId,
        executor: mustNotRepeat,
        capabilityBindings,
      })
    } finally {
      vi.useRealTimers()
    }
    expect(blocked).toMatchObject({ terminal: false, buildStatus: 'recovery-required' })
    expect(duplicateProviderCalls).toBe(0)
    const blockedBuild = (await db.productBuilds.get(blocked.buildId))!
    expect(blockedBuild.failureJson).toContain('provider-result-unknown')
    const ledger = JSON.parse(blockedBuild.budgetLedgerJson) as {
      attempts: Array<{ taskKey: string; outcome: string; usageKnown: boolean }>
    }
    expect(ledger.attempts).toContainEqual(expect.objectContaining({
      taskKey: 'content.design', outcome: 'failed', usageKnown: false,
    }))

    // Let the old promise unwind only after durable recovery has classified
    // the attempt. Its late bytes are no longer accepted as a verified result.
    releaseProvider({
      artifacts: [], passedGateIds: [],
      usage: {
        modelCalls: 1, inputTokens: 1, outputTokens: 1, mediaCalls: 0,
        costUsd: 0, durationMs: 1, storageBytes: 0,
      },
    })
    await abandonedCycle.catch(() => undefined)

    const production = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope,
      productionId: owned.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'scheduler-provider-result-unknown.resolve',
        expectedStateRevision: production.stateRevision,
        blockerKey: 'content.design',
        resolution: { action: 'retry', note: '作者确认未知结果不会被采用，并同意新 epoch 重试' },
      },
    })
    const retryCalls = new Map<string, number>()
    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor: executorFor(owned, retryCalls, { active: 0, peak: 0 }),
      capabilityBindings,
    })
    expect(completed.terminal).toBe(true)
    expect(firstProviderCalls).toBe(1)
    expect(duplicateProviderCalls).toBe(0)
    expect(retryCalls.get('content.design')).toBe(1)
  }, 30_000)

  it('同一浏览器的过期 ACTIVE 标记也不得绕过绝对任务截止时间', async () => {
    const owned = await fixture('scheduler-active-deadline', { retryModelCallHeadroom: 1 })
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    let releaseProvider!: (result: ProductProductionTaskExecutionResultV1) => void
    let markProviderStarted!: () => void
    const providerStarted = new Promise<void>(resolve => { markProviderStarted = resolve })
    const activeCycle = runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId, capabilityBindings,
      executor: async request => {
        if (request.task.taskKey !== 'content.design') throw new Error('只应执行首个设计任务')
        markProviderStarted()
        return await new Promise<ProductProductionTaskExecutionResultV1>(resolve => {
          releaseProvider = resolve
        })
      },
    })
    await providerStarted

    const requestedAt = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(requestedAt + 24 * 60 * 60 * 1_000)
    let blocked
    try {
      blocked = await runProductProductionSchedulerCycleV1({
        scope: owned.scope, productionId: owned.productionId, capabilityBindings,
        executor: async () => { throw new Error('过期 ACTIVE 请求不得自动重发') },
      })
    } finally {
      vi.useRealTimers()
    }
    expect(blocked).toMatchObject({ terminal: false, buildStatus: 'recovery-required' })
    const build = (await db.productBuilds.get(blocked.buildId))!
    expect(build.failureJson).toContain('provider-result-unknown')

    releaseProvider({
      artifacts: [], passedGateIds: [],
      usage: {
        modelCalls: 1, inputTokens: 1, outputTokens: 1, mediaCalls: 0,
        costUsd: 0, durationMs: 1, storageBytes: 0,
      },
    })
    await activeCycle.catch(() => undefined)
  }, 30_000)

  it('provider 调用前的过期领取可安全重领同一 child Run，且近期领取不会被另一 scheduler 抢占', async () => {
    const owned = await fixture('scheduler-pre-provider-reclaim')
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    let releaseClaim!: () => void
    let markClaimed!: () => void
    const claimedBoundary = new Promise<void>(resolve => { markClaimed = resolve })
    const holdClaim = new Promise<void>(resolve => { releaseClaim = resolve })
    let abandonedProviderCalls = 0
    const abandonedCycle = runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      capabilityBindings,
      executor: async () => {
        abandonedProviderCalls += 1
        throw new Error('旧进程不应越过已丢失的 task.claimed boundary')
      },
      async onDurableBoundary(boundary, snapshot) {
        if (boundary === 'task.claimed'
          && snapshot.contract.scope.productProduction?.taskKey === 'content.design') {
          markClaimed()
          await holdClaim
        }
      },
    })
    await claimedBoundary

    vi.resetModules()
    const reloadedScheduler = await import('../../src/lib/product-production/scheduler')
    const recoveredCalls = new Map<string, number>()
    const recoveredExecutor = executorFor(owned, recoveredCalls, { active: 0, peak: 0 })
    const recent = await reloadedScheduler.runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor: recoveredExecutor,
      capabilityBindings,
    })
    expect(recent).toMatchObject({ terminal: false, buildStatus: 'building' })
    expect(recoveredCalls.get('content.design')).toBeUndefined()

    const claimedAt = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(claimedAt + 24 * 60 * 60 * 1_000)
    let reclaimed
    try {
      reclaimed = await reloadedScheduler.runProductProductionSchedulerCycleV1({
        scope: owned.scope,
        productionId: owned.productionId,
        executor: recoveredExecutor,
        capabilityBindings,
      })
    } finally {
      vi.useRealTimers()
    }
    expect(reclaimed.buildStatus).toBe('building')
    expect(recoveredCalls.get('content.design')).toBe(1)
    expect(abandonedProviderCalls).toBe(0)
    const designRuns = (await db.agentRuns.where('productBuildId').equals(reclaimed.buildId).toArray())
      .filter(run => run.parentRelation === 'task:content.design')
    expect(designRuns).toHaveLength(1)
    expect(JSON.parse(designRuns[0].projectionJson)).toMatchObject({ state: 'completed' })

    releaseClaim()
    await abandonedCycle.catch(() => undefined)
    expect(abandonedProviderCalls).toBe(0)
  }, 30_000)

  it('任务领取后输入工件丢失会落正式失败回执，不留下永久 running child Run', async () => {
    const owned = await fixture('scheduler-preflight-failure')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const executor = executorFor(owned, calls, concurrency)
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1',
      bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    const first = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      capabilityBindings,
    })
    expect(calls.get('content.design')).toBe(1)
    const design = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([first.buildId, 'design.game']).first()
    await db.productBuildArtifacts.delete(design!.id!)
    const designRun = await db.agentRuns
      .where('[parentRunId+parentRelation]')
      .equals([first.rootRunId!, 'task:content.design'])
      .first()
    await db.agentRunCheckpoints.where('runId').equals(designRun!.id!).delete()

    const failed = await runProductProductionSchedulerCycleV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      capabilityBindings,
    })
    const narrative = failed.tasks.find(task => task.taskKey === 'content.narrative')
    expect(narrative).toMatchObject({ status: 'blocked', blocker: expect.stringContaining('Artifact 缺失') })
    expect(calls.get('content.narrative')).toBeUndefined()
    const child = await db.agentRuns.get(narrative!.runId!)
    expect(JSON.parse(child!.projectionJson)).toMatchObject({
      state: 'failed',
      steps: { 'content.narrative': { status: 'failed', failureCode: 'task-preflight-failed' } },
    })
    expect((await db.productBuilds.get(first.buildId))!.status).toBe('recovery-required')
  }, 30_000)

  it('作者暂停并恢复后复用已验收产物，只为新 epoch 补签收据而不重复调用 executor', async () => {
    const owned = await fixture('scheduler-pause-resume')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const executor = executorFor(owned, calls, concurrency)
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]

    const partial = await runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(partial.terminal).toBe(false)
    expect(calls.get('content.design')).toBe(1)
    expect([...calls.entries()].filter(([taskKey]) => taskKey !== 'content.design')).toHaveLength(0)

    const beforePause = await db.productProductions.get(owned.productionId)
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'pause', commandId: 'scheduler-pause-resume.pause',
        expectedStateRevision: beforePause!.stateRevision, reason: '作者主动暂停检查进度',
      },
    })
    const paused = await db.productProductions.get(owned.productionId)
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resume', commandId: 'scheduler-pause-resume.resume',
        expectedStateRevision: paused!.stateRevision,
      },
    })

    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(completed.terminal).toBe(true)
    expect([...calls.values()].every(count => count === 1)).toBe(true)
    expect(calls.get('content.design')).toBe(1)

    const designRows = (await db.productBuildArtifacts.where('buildId').equals(completed.buildId).toArray())
      .filter(row => row.artifactKey === 'design.game')
      .sort((left, right) => left.controlEpoch - right.controlEpoch)
    expect(designRows).toHaveLength(2)
    expect(designRows[0]).toMatchObject({ controlEpoch: 0, status: 'invalid' })
    expect(designRows[1]).toMatchObject({
      controlEpoch: 2, status: 'carried-forward', parentArtifactHash: designRows[0].contentHash,
    })
    expect(designRows[1].producerRunId).toBe(designRows[0].producerRunId)
    expect(designRows[1].producerReceiptHash).toBe(designRows[0].producerReceiptHash)
    expect(designRows[1].inputHash).toBe(designRows[0].inputHash)
  }, 30_000)

  it('再次暂停发生在合成 carry Run 之前时，用保留的原生产 Run 验证 binding 而不误判为需付费重试', async () => {
    const owned = await fixture('scheduler-partial-carry-provenance')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const executor = executorFor(owned, calls, concurrency)
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    const partial = await runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(calls.get('content.design')).toBe(1)

    const beforePause = await db.productProductions.get(owned.productionId)
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'pause', commandId: 'scheduler-partial-carry-provenance.pause',
        expectedStateRevision: beforePause!.stateRevision, reason: '制造未结算 carry Run 的恢复边界',
      },
    })
    const paused = await db.productProductions.get(owned.productionId)
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resume', commandId: 'scheduler-partial-carry-provenance.resume',
        expectedStateRevision: paused!.stateRevision,
      },
    })
    const resumedBuild = (await db.productBuilds.get(partial.buildId))!
    await carryForwardProductBuildArtifactsToEpochV1({
      scope: owned.scope, buildId: partial.buildId,
      fromControlEpoch: partial.controlEpoch, toControlEpoch: resumedBuild.controlEpoch,
      artifactKeys: ['design.game'],
    })
    const plan = await createProductProductionPlanV3({
      brief: owned.brief, briefHash: resumedBuild.briefHash,
      buildNumber: resumedBuild.buildNumber, controlEpoch: resumedBuild.controlEpoch,
    })
    const stable = await executionBindingDriftInvalidatedTaskKeysV1({
      scope: owned.scope, buildId: partial.buildId,
      previousControlEpoch: resumedBuild.controlEpoch, plan,
      allowHistoricalProducerFallback: true,
    })
    expect(stable.has('content.design')).toBe(false)

    const carriedDesign = (await db.productBuildArtifacts.where('buildId').equals(partial.buildId).toArray())
      .find(row => row.artifactKey === 'design.game'
        && row.controlEpoch === resumedBuild.controlEpoch
        && row.status === 'carried-forward')!
    await db.productBuildArtifacts.update(carriedDesign.id!, { status: 'invalid', updatedAt: Date.now() })

    const noHistoricalFallback = await executionBindingDriftInvalidatedTaskKeysV1({
      scope: owned.scope, buildId: partial.buildId,
      previousControlEpoch: resumedBuild.controlEpoch + 1, plan,
    })
    expect(noHistoricalFallback.has('content.design')).toBe(true)

    const historicalStable = await executionBindingDriftInvalidatedTaskKeysV1({
      scope: owned.scope, buildId: partial.buildId,
      previousControlEpoch: resumedBuild.controlEpoch + 1, plan,
      allowHistoricalProducerFallback: true,
    })
    expect(historicalStable.has('content.design')).toBe(false)

    await db.productBuilds.update(partial.buildId, { controlEpoch: resumedBuild.controlEpoch + 2 })
    const recovered = await carryForwardProductBuildArtifactsToEpochV1({
      scope: owned.scope, buildId: partial.buildId,
      fromControlEpoch: resumedBuild.controlEpoch + 1,
      toControlEpoch: resumedBuild.controlEpoch + 2,
      artifactKeys: ['design.game'],
      allowHistoricalInvalidSourceBeforeEpoch: true,
    })
    expect(recovered).toHaveLength(1)
    expect(recovered[0]).toMatchObject({
      artifactKey: 'design.game', controlEpoch: resumedBuild.controlEpoch + 2,
      status: 'carried-forward', contentHash: carriedDesign.contentHash,
      producerRunId: carriedDesign.producerRunId,
      producerReceiptHash: carriedDesign.producerReceiptHash,
    })

    const designTask = plan.tasks.find(task => task.taskKey === 'content.design')!
    const skill = getAgentSkillV1(designTask.skillId!)
    const mutableSkill = skill as typeof skill & { promptVersion: string }
    const originalPromptVersion = mutableSkill.promptVersion
    mutableSkill.promptVersion = `${originalPromptVersion}.drifted`
    try {
      const drifted = await executionBindingDriftInvalidatedTaskKeysV1({
        scope: owned.scope, buildId: partial.buildId,
        previousControlEpoch: resumedBuild.controlEpoch + 2, plan,
        allowHistoricalProducerFallback: true,
      })
      expect(drifted.has('content.design')).toBe(true)
    } finally {
      mutableSkill.promptVersion = originalPromptVersion
    }
  }, 30_000)

  it('跨 Build 复用清空直接 producerRunId 后，沿 carriedFrom 签名链找到原生产 Run 并安全恢复历史工件', async () => {
    const owned = await fixture('scheduler-cross-build-carry-origin-provenance')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const executor = executorFor(owned, calls, concurrency)
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    const partial = await runProductProductionSchedulerCycleV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    const sourceBuild = (await db.productBuilds.get(partial.buildId))!
    const origin = (await db.productBuildArtifacts.where('buildId').equals(partial.buildId).toArray())
      .find(row => row.artifactKey === 'design.game' && row.status === 'accepted')!
    expect(origin.producerRunId).not.toBeNull()
    await db.productBuilds.update(sourceBuild.id!, { status: 'preview-ready' })

    const childBuildNumber = sourceBuild.buildNumber + 1
    const childEpoch = sourceBuild.controlEpoch + 1
    const childPlan = await createProductProductionPlanV3({
      brief: owned.brief, briefHash: sourceBuild.briefHash,
      buildNumber: childBuildNumber, controlEpoch: childEpoch,
    })
    const childPlanHash = await hashProductProductionValueV2(childPlan)
    const { id: _sourceBuildId, ...sourceBuildFields } = sourceBuild
    const childBuildId = await db.productBuilds.add({
      ...sourceBuildFields,
      buildNumber: childBuildNumber,
      parentBuildNumber: sourceBuild.buildNumber,
      status: 'authorized',
      stateRevision: 0,
      controlEpoch: childEpoch,
      planRevision: 1,
      planJson: canonicalProductProductionJsonV2(childPlan),
      planHash: childPlanHash,
      failureJson: '{}',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }) as number
    const [crossBuildCarry] = await carryForwardProductBuildArtifactsAcrossBuildsV1({
      scope: owned.scope,
      sourceBuildId: sourceBuild.id!,
      targetBuildId: childBuildId,
      targetControlEpoch: childEpoch,
      artifactKeys: ['design.game'],
    })
    expect(crossBuildCarry).toMatchObject({
      producerRunId: null,
      producerReceiptHash: origin.producerReceiptHash,
      contentHash: origin.contentHash,
      carriedFrom: {
        buildNumber: sourceBuild.buildNumber,
        artifactKey: 'design.game',
        version: origin.version,
        contentHash: origin.contentHash,
      },
    })

    await db.productBuildArtifacts.update(crossBuildCarry.id!, { status: 'invalid', updatedAt: Date.now() })
    const historicalStable = await executionBindingDriftInvalidatedTaskKeysV1({
      scope: owned.scope,
      buildId: childBuildId,
      previousControlEpoch: childEpoch + 1,
      plan: childPlan,
      allowHistoricalProducerFallback: true,
    })
    expect(historicalStable.has('content.design')).toBe(false)

    const finalEpoch = childEpoch + 2
    await db.productBuilds.update(childBuildId, { controlEpoch: finalEpoch })
    const [sameBuildCarry] = await carryForwardProductBuildArtifactsToEpochV1({
      scope: owned.scope,
      buildId: childBuildId,
      fromControlEpoch: childEpoch + 1,
      toControlEpoch: finalEpoch,
      artifactKeys: ['design.game'],
      allowHistoricalInvalidSourceBeforeEpoch: true,
    })
    expect(sameBuildCarry).toMatchObject({
      producerRunId: null,
      producerReceiptHash: origin.producerReceiptHash,
      contentHash: origin.contentHash,
      parentArtifactHash: origin.contentHash,
      status: 'carried-forward',
      controlEpoch: finalEpoch,
    })

    const finalPlan = await createProductProductionPlanV3({
      brief: owned.brief, briefHash: sourceBuild.briefHash,
      buildNumber: childBuildNumber, controlEpoch: finalEpoch,
    })
    const finalStable = await executionBindingDriftInvalidatedTaskKeysV1({
      scope: owned.scope,
      buildId: childBuildId,
      previousControlEpoch: finalEpoch,
      plan: finalPlan,
      allowHistoricalProducerFallback: true,
    })
    expect(finalStable.has('content.design')).toBe(false)

    const designTask = finalPlan.tasks.find(task => task.taskKey === 'content.design')!
    const skill = getAgentSkillV1(designTask.skillId!)
    const mutableSkill = skill as typeof skill & { promptVersion: string }
    const originalPromptVersion = mutableSkill.promptVersion
    mutableSkill.promptVersion = `${originalPromptVersion}.drifted`
    try {
      const drifted = await executionBindingDriftInvalidatedTaskKeysV1({
        scope: owned.scope,
        buildId: childBuildId,
        previousControlEpoch: finalEpoch,
        plan: finalPlan,
        allowHistoricalProducerFallback: true,
      })
      expect(drifted.has('content.design')).toBe(true)
    } finally {
      mutableSkill.promptVersion = originalPromptVersion
    }
  }, 30_000)

  it('Skill promptVersion 从 v4 漂移到 v5 时重跑真实模型任务、失效下游并更换请求 bindingHash', async () => {
    const owned = await fixture('scheduler-prompt-binding-drift')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const executor = executorFor(owned, calls, concurrency)
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    const build = (await db.productBuilds
      .where('[productionId+buildNumber]').equals([owned.productionId, 1]).first())!
    const plan = await createProductProductionPlanV3({
      brief: owned.brief,
      briefHash: build.briefHash,
      buildNumber: build.buildNumber,
      controlEpoch: build.controlEpoch,
    })
    const designTask = plan.tasks.find(task => task.taskKey === 'content.design')!
    const skill = getAgentSkillV1(designTask.skillId!)
    const mutableSkill = skill as typeof skill & { promptVersion: string }
    const originalPromptVersion = mutableSkill.promptVersion
    mutableSkill.promptVersion = 'fixture-product-production-design-v4'
    try {
      const partial = await runProductProductionSchedulerCycleV1({
        scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
      })
      expect(partial.terminal).toBe(false)
      expect(calls.get('content.design')).toBe(1)
      const firstArtifact = await db.productBuildArtifacts
        .where('[buildId+artifactKey]').equals([partial.buildId, 'design.game']).first()
      expect(firstArtifact?.producerRunId).not.toBeNull()

      mutableSkill.promptVersion = 'fixture-product-production-design-v5'
      const drifted = await executionBindingDriftInvalidatedTaskKeysV1({
        scope: owned.scope,
        buildId: partial.buildId,
        previousControlEpoch: partial.controlEpoch,
        plan,
      })
      expect(drifted).toContain('content.design')
      expect(drifted).toContain('content.narrative')
      expect(drifted).toContain('integration.package')

      const beforePause = await db.productProductions.get(owned.productionId)
      await executeProductProductionCommand({
        scope: owned.scope, productionId: owned.productionId,
        command: {
          type: 'pause', commandId: 'scheduler-prompt-binding-drift.pause',
          expectedStateRevision: beforePause!.stateRevision, reason: '验证 Skill binding 漂移恢复',
        },
      })
      const paused = await db.productProductions.get(owned.productionId)
      await executeProductProductionCommand({
        scope: owned.scope, productionId: owned.productionId,
        command: {
          type: 'resume', commandId: 'scheduler-prompt-binding-drift.resume',
          expectedStateRevision: paused!.stateRevision,
        },
      })

      const completed = await runProductProductionUntilBlockedV1({
        scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
      })
      expect(completed.terminal).toBe(true)
      expect(calls.get('content.design')).toBe(2)
      expect(calls.get('content.narrative')).toBe(1)

      const designRows = (await db.productBuildArtifacts.where('buildId').equals(completed.buildId).toArray())
        .filter(row => row.artifactKey === 'design.game')
        .sort((left, right) => left.controlEpoch - right.controlEpoch)
      expect(designRows).toHaveLength(2)
      expect(designRows[0]).toMatchObject({ controlEpoch: 0, status: 'invalid' })
      expect(designRows[1]).toMatchObject({ controlEpoch: 2, status: 'accepted', parentArtifactHash: null })
      expect(designRows[1].producerRunId).not.toBe(designRows[0].producerRunId)
      expect(designRows[1].inputHash).not.toBe(designRows[0].inputHash)

      const designRuns = (await db.agentRuns.where('productBuildId').equals(completed.buildId).toArray())
        .filter(row => row.parentRelation === 'task:content.design')
        .sort((left, right) => left.createdAt - right.createdAt)
      expect(designRuns).toHaveLength(2)
      const requestBindingHashes = []
      for (const run of designRuns) {
        const requested = (await db.agentRunEvents.where('runId').equals(run.id!).toArray())
          .find(event => event.type === 'model.requested')
        const payload = JSON.parse(requested!.payloadJson) as { bindingHash: string }
        requestBindingHashes.push(payload.bindingHash)
      }
      expect(requestBindingHashes[0]).not.toBe(requestBindingHashes[1])
    } finally {
      mutableSkill.promptVersion = originalPromptVersion
    }
  }, 30_000)

  it('供应商连续失败停在用户 blocker，作者重试后新 epoch 继续且错误信息不泄露密钥', async () => {
    const owned = await fixture('scheduler-user-retry', { retryModelCallHeadroom: 2 })
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const successExecutor = executorFor(owned, calls, concurrency)
    let injectedFailures = 0
    const executor: ProductProductionTaskExecutorV1 = async request => {
      if (request.task.taskKey === 'content.design' && injectedFailures < 2) {
        injectedFailures++
        calls.set(request.task.taskKey, (calls.get(request.task.taskKey) ?? 0) + 1)
        throw new Error('provider 503 api-key=sk-proj-supersecret123')
      }
      return successExecutor(request)
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const capabilityBindings = [{
      requirementKey: textRequirement.requirementKey,
      adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
    }]
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(blocked.buildStatus).toBe('recovery-required')
    const blockedBuild = (await db.productBuilds.get(blocked.buildId))!
    expect(blockedBuild.failureJson).toContain('[redacted]')
    expect(blockedBuild.failureJson).not.toContain('supersecret')

    const production = (await db.productProductions.get(owned.productionId))!
    const resolved = await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'scheduler-user-retry.resolve',
        expectedStateRevision: production.stateRevision, blockerKey: 'content.design',
        resolution: { action: 'retry', note: '作者确认重试' },
      },
    })
    expect(resolved).toMatchObject({ ok: true, result: { controlEpoch: 1, action: 'retry' } })
    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor, capabilityBindings,
    })
    expect(completed.terminal, JSON.stringify({
      status: completed.buildStatus, budget: completed.budget,
      blockers: completed.tasks.filter(task => task.blocker),
    })).toBe(true)
    expect(calls.get('content.design')).toBe(3)
    expect([...calls.entries()].filter(([key]) => key !== 'content.design').every(([, count]) => count === 1)).toBe(true)
    const finalBuild = (await db.productBuilds.get(completed.buildId))!
    const ledger = JSON.parse(finalBuild.budgetLedgerJson) as {
      version: number
      attempts: Array<{ taskKey: string; outcome: string; usageKnown: boolean }>
    }
    expect(ledger.version).toBe(2)
    expect(ledger.attempts.filter(attempt => attempt.taskKey === 'content.design')).toHaveLength(3)
    expect(ledger.attempts.filter(attempt => attempt.taskKey === 'content.design' && !attempt.usageKnown)).toHaveLength(2)
    expect(completed.budget.usage.modelCalls).toBe(6)
  }, 30_000)

  it('provider safety refusal 不自动改写或重试，第一次即暂停等待用户决定', async () => {
    const owned = await fixture('scheduler-safety-refusal')
    let calls = 0
    const executor: ProductProductionTaskExecutorV1 = async request => {
      if (request.task.taskKey === 'content.design') {
        calls += 1
        throw new Error('[product-media-adapter] provider-safety-refusal')
      }
      throw new Error('safety refusal 后不应继续其他任务')
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor,
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    expect(calls).toBe(1)
    expect(blocked.buildStatus).toBe('recovery-required')
    expect(blocked.tasks.find(task => task.taskKey === 'content.design')).toMatchObject({ status: 'blocked' })
    expect((await db.productBuilds.get(blocked.buildId))?.failureJson).toContain('provider-safety-refusal')
  }, 30_000)

  it('provider 请求后的网络级 Failed to fetch 记为结果未知且绝不自动重复调用', async () => {
    const owned = await fixture('scheduler-immediate-provider-result-unknown')
    let calls = 0
    const executor: ProductProductionTaskExecutorV1 = async request => {
      if (request.task.taskKey !== 'content.design') throw new Error('结果未知后不应领取下游任务')
      calls += 1
      throw new TypeError('Failed to fetch')
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor,
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1', bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    expect(calls).toBe(1)
    expect(blocked.buildStatus).toBe('recovery-required')
    const build = (await db.productBuilds.get(blocked.buildId))!
    expect(build.failureJson).toContain('task-result-unknown')
    const ledger = JSON.parse(build.budgetLedgerJson) as {
      attempts: Array<{ taskKey: string; outcome: string; usageKnown: boolean }>
    }
    expect(ledger.attempts).toContainEqual(expect.objectContaining({
      taskKey: 'content.design', outcome: 'failed', usageKnown: false,
    }))
  }, 30_000)

  it('已付费结果超出单任务预留时记录真实用量并立即暂停，不盲目自动重试', async () => {
    const owned = await fixture('scheduler-task-budget-exceeded')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const basePlan = await createProductProductionPlanV3({
      buildNumber: 1,
      briefHash: await hashProductProductionValueV2(owned.brief),
      brief: owned.brief,
    })
    const plan = {
      ...basePlan,
      tasks: basePlan.tasks.map(task => task.taskKey === 'content.design'
        ? {
            ...task,
            maxAttempts: 2,
            budgetReservation: { ...task.budgetReservation, outputTokens: 5 },
          }
        : task),
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor: executorFor(owned, calls, concurrency),
      suppliedPlan: plan,
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    expect(calls.get('content.design')).toBe(1)
    expect(blocked.buildStatus).toBe('recovery-required')
    expect(blocked.tasks.find(task => task.taskKey === 'content.design')).toMatchObject({
      status: 'blocked', attempt: 1, blocker: expect.stringContaining('outputTokens=10/5'),
    })
    expect(blocked.budget.usage).toMatchObject({ modelCalls: 1, inputTokens: 10, outputTokens: 10 })
    expect((await db.productBuilds.get(blocked.buildId))?.failureJson).toContain('task-budget-exceeded')
  }, 30_000)

  it('仅容纳 provider 隐藏推理的微小计费偏差，并仍按真实用量计入 Build 总账', async () => {
    const owned = await fixture('scheduler-provider-accounting-tolerance')
    const calls = new Map<string, number>()
    const concurrency = { active: 0, peak: 0 }
    const basePlan = await createProductProductionPlanV3({
      buildNumber: 1,
      briefHash: await hashProductProductionValueV2(owned.brief),
      brief: owned.brief,
    })
    const plan = {
      ...basePlan,
      tasks: basePlan.tasks.map(task => task.taskKey === 'content.design'
        ? { ...task, budgetReservation: { ...task.budgetReservation, outputTokens: 1_000 } }
        : task),
    }
    const baseExecutor = executorFor(owned, calls, concurrency)
    const executor: ProductProductionTaskExecutorV1 = async request => {
      const result = await baseExecutor(request)
      return request.task.taskKey === 'content.design'
        ? { ...result, usage: { ...result.usage, outputTokens: 1_020 } }
        : result
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const completed = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      suppliedPlan: plan,
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    expect(completed).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
    expect(completed.budget.usage.outputTokens).toBeGreaterThanOrEqual(1_020)
    const build = await db.productBuilds.get(completed.buildId)
    expect(() => assertProductProductionBudgetLedgerV1(build!.budgetLedgerJson)).not.toThrow()
  }, 30_000)

  it('即使 provider 忽略 abort 也按任务合同强制结算超时，并保存 task-timeout 恢复证据', async () => {
    const owned = await fixture('scheduler-task-timeout')
    const basePlan = await createProductProductionPlanV3({
      buildNumber: 1,
      briefHash: await hashProductProductionValueV2(owned.brief),
      brief: owned.brief,
    })
    const plan = {
      ...basePlan,
      tasks: basePlan.tasks.map(task => task.taskKey === 'content.design'
        ? { ...task, maxAttempts: 1, timeoutMs: 10 }
        : task),
    }
    let aborted = false
    const executor: ProductProductionTaskExecutorV1 = async request => {
      if (request.task.taskKey !== 'content.design') throw new Error('超时后不应领取下游任务')
      return await new Promise<ProductProductionTaskExecutionResultV1>(() => {
        request.signal.addEventListener('abort', () => {
          aborted = true
        }, { once: true })
      })
    }
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const blocked = await runProductProductionUntilBlockedV1({
      scope: owned.scope,
      productionId: owned.productionId,
      executor,
      suppliedPlan: plan,
      capabilityBindings: [{
        requirementKey: textRequirement.requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: await hashProductProductionValueV2({ provider: 'configured' }),
      }],
    })
    expect(aborted).toBe(true)
    expect(blocked.buildStatus).toBe('recovery-required')
    expect((await db.productBuilds.get(blocked.buildId))?.failureJson).toContain('task-timeout')
  })

  it('拒绝带未知字段或伪造结算数据的 budget ledger', () => {
    const emptyLedger = {
      schema: 'storyforge.product-production-budget-ledger', version: 1,
      rootRunId: null, rootClaim: null, tasks: {},
    }
    expect(() => assertProductProductionBudgetLedgerV1(JSON.stringify({
      ...emptyLedger, forgedSettlement: true,
    }))).toThrow('budget ledger 字段不精确')
    expect(() => assertProductProductionBudgetLedgerV1(JSON.stringify({
      ...emptyLedger,
      tasks: {
        'content.design': {
          runId: 1, attempt: 1, status: 'settled', idempotencyKey: '',
          candidateHash: null, terminalReceiptHash: null, passedGateIds: [],
          usage: {
            modelCalls: 1, inputTokens: 10, outputTokens: 10, mediaCalls: 0,
            costUsd: -100, durationMs: 1, storageBytes: 0,
          },
          errorCode: null,
        },
      },
    }))).toThrow('costUsd 无效')
  })
})
