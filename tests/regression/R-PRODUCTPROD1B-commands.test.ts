import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  canReviseTextAdventureRuntimeCopyFromRecoveryV1,
  canUpgradeTextAdventureExecutionPlanV1,
  executeProductProductionCommand,
  isTextAdventureBuildLifetimeBudgetExhaustedV1,
} from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import {
  beginProductProductionEvolutionV1,
  readProductProductionDetailsV1,
  upgradeTextAdventureProductionPlanV1,
} from '../../src/lib/product-production/service'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionPlanV3, parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { putMediaBlobObject } from '../../src/lib/product-production/media-blob-store'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { recordTextAdventureHumanVisualReviewV1 } from '../../src/lib/product-production/quality-receipts'
import type { ProductBuildArtifactRecordV1, ProductProductionPlanV3 } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedTextAdventureMediaRevisionWorkbenchV1 } from '../helpers/text-adventure-media-revision-workbench'

const STRICT_VISUAL_REVIEW_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8WgWQAAAABJRU5ErkJggg=='

async function fixture(
  productType: 'avg' | 'text-adventure' = 'avg',
  visualLevel: 'none' | 'key-scenes' = 'none',
) {
  const owned = await seedCurrentProductWorld('PRODUCTPROD commands')
  const worldReleaseId = owned.release.id!
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId })
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope,
    worldReleaseId,
    suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType,
    qualityProfile: 'prototype',
    scale: productType === 'text-adventure' ? 'short-arc' : 'scene',
    visualLevel,
    audioLevel: 'none',
    playerRole: '扮演林舟',
    openingSituation: '在潮门关闭前作出选择。',
    coreExperience: ['选择与后果'],
    requiredFacts: ['潮门只在满月开启'],
    forbiddenChanges: ['不得改写冻结世界'],
    contentBoundaries: ['不含露骨内容'],
    tone: ['克制', '紧张'],
    ...(productType === 'text-adventure' ? { textAdventure: { confirmAll: true } } : {}),
  })
  return { ...owned, worldReleaseId, brief }
}

async function completedTextAdventureMediaFixture() {
  const f = await fixture('text-adventure', 'key-scenes')
  const created = await executeProductProductionCommand({
    scope: f.scope,
    command: {
      type: 'create-intent', commandId: 'media-revision.intent', productionKey: 'media-revision-story',
      productType: 'text-adventure', worldReleaseId: f.worldReleaseId, userText: '媒资修订测试',
    },
  })
  const saved = await executeProductProductionCommand({
    scope: f.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: 'media-revision.brief', expectedStateRevision: 0,
      parentRevision: null, brief: f.brief,
    },
  })
  await executeProductProductionCommand({
    scope: f.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: 'media-revision.start', expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'author.media-revision',
    },
  })
  const build = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
  const plan = await createProductProductionPlanV3({
    buildNumber: build.buildNumber, controlEpoch: build.controlEpoch,
    briefHash: saved.result.briefHash as string, brief: f.brief,
  })
  const planHash = await hashProductProductionValueV2(plan)
  const capabilityBindings = f.brief.capabilityRequirements.map(requirement => ({
    requirementKey: requirement.requirementKey,
    adapterId: `fixture.${requirement.mediaClass}`,
    bindingHash: 'f'.repeat(64),
    provider: 'fixture-provider',
    model: 'fixture-text-model',
  }))
  const preflightBindingHash = await hashProductProductionValueV2({
    schema: 'storyforge.text-adventure-vision-preflight-binding', version: 1,
    capabilityHash: 'f'.repeat(64), provider: 'fixture-provider', model: 'fixture-text-model',
  })
  const visualBiblePayload = {
    schema: 'storyforge.test-visual-bible', version: 1,
    assetRequirements: [{ assetKey: 'media.visual.001', sceneKey: 'scene.opening' }],
  }
  const visualAnchorConfirmationHash = await hashProductProductionValueV2({
    schema: 'storyforge.text-adventure-visual-anchor-confirmation', version: 1,
    visualBible: visualBiblePayload,
  })
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer
  const blob = await putMediaBlobObject({ scope: f.scope, data: bytes, mimeType: 'image/png' })
  const now = Date.now()
  for (const task of plan.tasks) {
    for (const artifactKey of task.outputArtifactKeys) {
      const image = artifactKey.startsWith('media.visual.')
      const payload = image ? {
        schema: 'storyforge.generated-media-artifact', version: 1,
        assetKey: `media-revision-story.build-1.${artifactKey}`,
        request: { beatKey: 'beat.opening', width: 1280, height: 720 },
      } : artifactKey === 'media.vision-preflight' ? {
        schema: 'storyforge.text-adventure-vision-capability-preflight', version: 2,
        buildNumber: build.buildNumber,
        imageContentHash: 'e'.repeat(64),
        observedQuadrants: ['red', 'cyan', 'black', 'yellow'],
        capabilityHash: 'f'.repeat(64),
        provider: 'fixture-provider', model: 'fixture-text-model',
        textCapabilityBindingHash: preflightBindingHash,
        passed: true,
      } : artifactKey === 'media.visual-bible' ? visualBiblePayload
        : artifactKey === 'media.anchor-decision' ? {
            schema: 'storyforge.text-adventure-media-anchor-decision-artifact', version: 1,
            visualBibleHash: visualAnchorConfirmationHash,
            decision: 'confirm-character-anchors',
      } : artifactKey === 'quality.adventure-review' ? {
        schema: 'storyforge.text-adventure-quality-review-artifact', version: 1,
        scores: {
          causality: 5, playerAgency: 5, routeDifferentiation: 5, pacing: 5,
          setupPayoff: 5, characterMotivation: 5, emotionalImpact: 5,
        },
        issues: [], passed: true,
      } : { schema: 'test-artifact', version: 1, artifactKey }
      const payloadJson = canonicalProductProductionJsonV2(payload)
      const contentHash = image ? blob.contentHash : await hashProductProductionValueV2(payload)
      await db.productBuildArtifacts.add({
        projectId: f.scope.projectId, worldId: f.scope.worldId, workId: f.scope.workId,
        buildId: build.id!, artifactKey, requirementKey: null, version: 1,
        kind: image ? 'image' : 'narrative', mediaKind: image ? 'illustration' : null,
        status: 'accepted', producerRunId: null, producerReceiptHash: null,
        controlEpoch: build.controlEpoch, inputHash: await hashProductProductionValueV2({ artifactKey }),
        contentHash, payloadJson,
        metadataJson: canonicalProductProductionJsonV2(image ? {
          assetKey: `media-revision-story.build-1.${artifactKey}`,
          name: artifactKey, width: 1280, height: 720, durationMs: null,
          source: 'test-provider', license: 'CC0-1.0', altText: '潮门前的关键场景',
          characterTag: '', sceneTag: 'beat.opening',
        } : {}),
        qualityJson: '{}',
        rightsJson: canonicalProductProductionJsonV2(image
          ? { origin: 'test-provider', license: 'CC0-1.0', commercialUse: true, redistribution: true }
          : {}),
        blobObjectId: image ? blob.id! : null, mimeType: image ? 'image/png' : null,
        byteSize: image ? blob.byteSize : new TextEncoder().encode(payloadJson).byteLength,
        parentArtifactHash: null, carriedFrom: null, createdAt: now, updatedAt: now,
      } satisfies ProductBuildArtifactRecordV1)
    }
  }
  await db.productBuilds.update(build.id!, {
    status: 'preview-ready', planRevision: 1,
    planJson: canonicalProductProductionJsonV2(plan), planHash,
    previewHash: await hashProductProductionValueV2({ preview: 1 }),
  })
  await db.productProductions.update(created.productionId, { status: 'preview-ready' })
  return { ...f, productionId: created.productionId, build, plan, blob, capabilityBindings }
}

function legacySingleQualityReviewPlan(
  plan: ProductProductionPlanV3,
): ProductProductionPlanV3 {
  const existing = plan.tasks.find(task => task.taskKey === 'content.adventure-quality-review')!
  if (existing.executionMode === 'model'
    && !plan.tasks.some(task => /^content\.adventure-quality-review\./.test(task.taskKey))) return plan
  const modelTemplate = plan.tasks.find(task => (
    task.skillId === 'text-adventure.production-quality-review.v1' && task.executionMode === 'model'
  ))!
  const dependsOn = [
    'production.supervision',
    'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
    'content.product-module', 'content.narrative-arc-plan', 'content.main-quest-plan',
    'content.adventure-side-quests', 'content.adventure-ambient-events', 'content.quest-script',
    'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2',
    'content.dialogue-pass.act-3', 'integration.narrative',
  ]
  const inputArtifactKeys = [
    'production.supervision',
    'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
    'content.product-module', 'content.narrative-arc-plan', 'content.main-quest-plan',
    'content.adventure-side-quests', 'content.adventure-ambient-events', 'content.quest-script',
    'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2',
    'content.dialogue-pass.act-3', 'content.narrative',
  ]
  return {
    ...plan,
    tasks: plan.tasks
      .filter(task => task.taskKey === existing.taskKey
        || task.skillId !== 'text-adventure.production-quality-review.v1')
      .map(task => task.taskKey === existing.taskKey ? {
        ...existing,
        kind: 'text-adventure-quality-review', skillId: 'text-adventure.production-quality-review.v1',
        executionMode: 'model' as const, dependsOn,
        requiredReceipts: dependsOn.map(taskKey => ({ taskKey, receiptHash: null })),
        inputArtifactKeys, outputArtifactKeys: ['quality.adventure-review'],
        capabilityRequirementKeys: modelTemplate.capabilityRequirementKeys,
        concurrencyGroup: 'text-provider', subjectLockKeys: ['quality.adventure-review'],
        priority: 75, budgetReservation: modelTemplate.budgetReservation,
        maxAttempts: 2, timeoutMs: 240_000, failurePolicy: 'pause' as const,
        fallbackTaskKey: null,
        acceptanceGateIds: ['artifact.protocol', 'adventure.narrative-quality-review'],
      } : task),
  }
}

async function legacyOversizedQualityReviewRecoveryFixture() {
  const f = await fixture('text-adventure', 'key-scenes')
  const created = await executeProductProductionCommand({
    scope: f.scope,
    command: {
      type: 'create-intent', commandId: 'quality-plan-upgrade.intent',
      productionKey: `quality-plan-upgrade-${crypto.randomUUID()}`,
      productType: 'text-adventure', worldReleaseId: f.worldReleaseId,
      userText: '验证旧单体叙事审查计划的不可变升级',
    },
  })
  const saved = await executeProductProductionCommand({
    scope: f.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: 'quality-plan-upgrade.brief', expectedStateRevision: 0,
      parentRevision: null, brief: f.brief,
    },
  })
  await executeProductProductionCommand({
    scope: f.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: 'quality-plan-upgrade.start', expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string,
      authorizationNonce: 'quality-plan-upgrade.click',
    },
  })
  const build = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
  const currentPlan = await createProductProductionPlanV3({
    buildNumber: 50, controlEpoch: build.controlEpoch,
    briefHash: saved.result.briefHash as string, brief: f.brief,
  })
  const legacyPlan = parseProductProductionPlanV3(
    legacySingleQualityReviewPlan(currentPlan), f.brief, saved.result.briefHash as string,
  )
  const planHash = await hashProductProductionValueV2(legacyPlan)
  await db.productBuilds.update(build.id!, {
    buildNumber: 50, status: 'recovery-required', planRevision: 1,
    planJson: canonicalProductProductionJsonV2(legacyPlan), planHash,
    failureJson: canonicalProductProductionJsonV2({
      taskKey: 'content.adventure-quality-review', code: 'task-preflight-failed', attempt: 1,
      detail: '[product-production-context] 文字冒险质量审查投影超过登记预算:46236/31500，必须拆分审查任务',
    }),
  })
  await db.productProductions.update(created.productionId, { currentBuildNumber: 50 })
  return { ...f, productionId: created.productionId, build: { ...build, buildNumber: 50 }, legacyPlan, planHash }
}

describe('PRODUCTPROD-1B · user command control plane', () => {
  it('公开文案质量失败只允许派生 runtime-only 恢复 Build', async () => {
    const f = await fixture('text-adventure')
    const briefHash = await hashProductProductionValueV2(f.brief)
    const plan = await createProductProductionPlanV3({ buildNumber: 1, briefHash, brief: f.brief })
    const candidate = {
      status: 'recovery-required' as const,
      releasedProductReleaseId: null,
      planJson: canonicalProductProductionJsonV2(plan),
      failureJson: canonicalProductProductionJsonV2({
        taskKey: 'qa.release', code: 'task-executor-failed',
        detail: '[product-production-executor] QA 硬门失败:product.adventure.recommendation-copy',
      }),
    }
    expect(canReviseTextAdventureRuntimeCopyFromRecoveryV1(candidate)).toBe(true)
    expect(canReviseTextAdventureRuntimeCopyFromRecoveryV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: 'qa.release', code: 'task-executor-failed',
        detail: '[product-production-executor] QA 硬门失败:product.adventure.recommendation-route-volume',
      }),
    })).toBe(false)
    expect(canReviseTextAdventureRuntimeCopyFromRecoveryV1({
      ...candidate, status: 'preview-ready',
    })).toBe(false)
  })

  it('只有真实 Build lifetime budget blocker 可获得子 Build 续建资格', () => {
    expect(isTextAdventureBuildLifetimeBudgetExhaustedV1({
      status: 'recovery-required',
      failureJson: JSON.stringify({ detail: 'Build lifetime budget 不足:modelCalls=109/108' }),
    })).toBe(true)
    expect(isTextAdventureBuildLifetimeBudgetExhaustedV1({
      status: 'recovery-required',
      failureJson: JSON.stringify({ detail: 'provider safety refusal' }),
    })).toBe(false)
    expect(isTextAdventureBuildLifetimeBudgetExhaustedV1({
      status: 'building',
      failureJson: JSON.stringify({ detail: '不得借用历史错误' }),
    })).toBe(false)
  })

  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('preserves earlier Brief revisions when an author restores the same content, requiring fresh start authorization', async () => {
    const f = await fixture()
    const created = await executeProductProductionCommand({ scope: f.scope, command: {
      type: 'create-intent', commandId: 'repeat.intent', productionKey: 'repeat-brief', productType: 'avg', worldReleaseId: f.worldReleaseId, userText: 'test',
    } })
    const hashes: string[] = []
    for (let index = 0; index < 3; index++) {
      const brief = index === 1 ? { ...f.brief, intent: { ...f.brief.intent, openingSituation: '另一种开场' } } : f.brief
      const receipt = await executeProductProductionCommand({ scope: f.scope, productionId: created.productionId, command: {
        type: 'save-brief-revision', commandId: `repeat.${index}`, expectedStateRevision: index, parentRevision: index || null, brief,
      } })
      expect(receipt.ok).toBe(true)
      hashes.push(String(receipt.result.briefHash))
    }
    expect(hashes[0]).toBe(hashes[2])
    expect(hashes[0]).not.toBe(hashes[1])
    const revisions = await db.productProductionBriefs.where('productionId').equals(created.productionId).sortBy('revision')
    expect(revisions.map(r => r.revision)).toEqual([1, 2, 3])
    expect(revisions.every(r => r.authorizedAt === null)).toBe(true)
    expect(await db.productBuilds.count()).toBe(0)
    const stale = await executeProductProductionCommand({ scope: f.scope, productionId: created.productionId, command: {
      type: 'save-brief-revision', commandId: 'repeat.stale', expectedStateRevision: 1, parentRevision: 1, brief: f.brief,
    } })
    expect(stale).toMatchObject({ ok: false, errorCode: 'production-state-conflict' })
  })

  it('offers explainable registered-source options without starting production', async () => {
    const f = await fixture()
    const suggestions = await suggestProductStartingPoints({ scope: f.scope, worldReleaseId: f.worldReleaseId })
    expect(suggestions.suggestions.length).toBeGreaterThanOrEqual(3)
    expect(suggestions.suggestions.length).toBeLessThanOrEqual(6)
    expect(suggestions.suggestions.map(item => item.kind)).toEqual(expect.arrayContaining(['mainline', 'branch', 'custom']))
    expect(suggestions.suggestionSetHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await db.productProductions.where('projectId').equals(f.scope.projectId).count()).toBe(0)
    expect(await db.productBuilds.where('projectId').equals(f.scope.projectId).count()).toBe(0)
  })

  it('keeps consultation non-producing, authorizes once, then pause/resume/stop invalidates old epochs', async () => {
    const f = await fixture()
    const created = await executeProductProductionCommand({
      scope: f.scope,
      command: { type: 'create-intent', commandId: 'intent-1', productionKey: 'gate-story', productType: 'avg', worldReleaseId: f.worldReleaseId, userText: '把山门主线做成游戏' },
    })
    expect(created).toMatchObject({ ok: true, stateRevision: 0, replayed: false })
    const replay = await executeProductProductionCommand({
      scope: f.scope,
      command: { type: 'create-intent', commandId: 'intent-1', productionKey: 'gate-story', productType: 'avg', worldReleaseId: f.worldReleaseId, userText: '把山门主线做成游戏' },
    })
    expect(replay).toMatchObject({ ok: true, productionId: created.productionId, replayed: true })
    expect(await db.productBuilds.where('productionId').equals(created.productionId).count()).toBe(0)
    expect(await db.agentRuns.where('projectId').equals(f.scope.projectId).count()).toBe(0)

    const saved = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'save-brief-revision', commandId: 'brief-1', expectedStateRevision: 0, parentRevision: null, brief: f.brief },
    })
    expect(saved).toMatchObject({ ok: true, stateRevision: 1, result: { briefRevision: 1, status: 'brief-ready' } })
    expect(await db.productBuilds.where('productionId').equals(created.productionId).count()).toBe(0)

    const authorized = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'start-1', expectedStateRevision: 1,
        briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'author-click-1',
      },
    })
    expect(authorized).toMatchObject({ ok: true, stateRevision: 2, result: { buildNumber: 1 } })
    expect(await db.productBuilds.where('productionId').equals(created.productionId).count()).toBe(1)

    const paused = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'pause', commandId: 'pause-1', expectedStateRevision: 2, reason: '用户检查预算' },
    })
    expect(paused).toMatchObject({ ok: true, stateRevision: 3, result: { controlEpoch: 1 } })
    const pausedBuild = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
    expect(pausedBuild).toMatchObject({ status: 'paused', controlEpoch: 1 })
    expect(JSON.parse(pausedBuild.failureJson)).toMatchObject({
      code: 'user-paused', reason: '用户检查预算', pausedFromControlEpoch: 0,
    })

    const resumed = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'resume', commandId: 'resume-1', expectedStateRevision: 3 },
    })
    expect(resumed).toMatchObject({ ok: true, stateRevision: 4, result: { controlEpoch: 2, restored: 'authorized' } })
    const resumedBuild = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
    expect(JSON.parse(resumedBuild.failureJson)).toMatchObject({
      code: 'user-resumed', resumedFromControlEpoch: 1,
      pauseReceipt: {
        code: 'user-paused', reason: '用户检查预算', pausedFromControlEpoch: 0,
      },
      previousFailure: { code: 'user-paused' },
    })

    const stopped = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'stop', commandId: 'stop-1', expectedStateRevision: 4, retention: 'keep-build' },
    })
    expect(stopped).toMatchObject({ ok: true, stateRevision: 5, result: { controlEpoch: 3 } })
    expect(await db.productBuilds.where('productionId').equals(created.productionId).first()).toMatchObject({ status: 'cancelled', controlEpoch: 3 })
    const archived = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'archive', commandId: 'archive-1', expectedStateRevision: 5, reason: '作者整理版本列表' },
    })
    expect(archived).toMatchObject({ ok: true, stateRevision: 6, result: { previousStatus: 'stopped' } })
    expect(await db.productProductions.get(created.productionId)).toMatchObject({ status: 'archived' })
    const restored = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'restore', commandId: 'restore-1', expectedStateRevision: 6 },
    })
    expect(restored).toMatchObject({ ok: true, stateRevision: 7, result: { restoredStatus: 'stopped' } })
    expect(await db.productProductions.get(created.productionId)).toMatchObject({ status: 'stopped' })
    expect(await db.productBuilds.where('productionId').equals(created.productionId).count()).toBe(1)
    const details = await readProductProductionDetailsV1(f.scope, created.productionId)
    expect(details.recentCommands.map(row => [row.type, row.status])).toEqual([
      ['restore', 'succeeded'], ['archive', 'succeeded'], ['stop', 'succeeded'], ['resume', 'succeeded'], ['pause', 'succeeded'],
      ['authorize-start', 'succeeded'], ['save-brief-revision', 'succeeded'], ['create-intent', 'succeeded'],
    ])
    expect(details.briefHistory.map(row => row.revision)).toEqual([1])
    expect(details.buildHistory.map(row => row.buildNumber)).toEqual([1])
  })

  it('pause/resume preserves the bounded causal failure chain for deterministic recovery', async () => {
    const f = await fixture('text-adventure')
    const created = await executeProductProductionCommand({
      scope: f.scope,
      command: {
        type: 'create-intent', commandId: 'pause-cause.intent',
        productionKey: 'pause-cause-story', productType: 'text-adventure',
        worldReleaseId: f.worldReleaseId, userText: '制作文字冒险',
      },
    })
    const saved = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'save-brief-revision', commandId: 'pause-cause.brief',
        expectedStateRevision: 0, parentRevision: null, brief: f.brief,
      },
    })
    await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'pause-cause.start', expectedStateRevision: 1,
        briefRevision: 1, briefHash: saved.result.briefHash as string,
        authorizationNonce: 'pause-cause.click',
      },
    })
    const build = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
    await db.productBuilds.update(build.id!, {
      status: 'building',
      failureJson: JSON.stringify({
        taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
        detail: '文字冒险叙事质量审查未通过：需要局部返修',
      }),
    })
    await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'pause', commandId: 'pause-cause.pause', expectedStateRevision: 2,
        reason: '检查质量返修',
      },
    })
    const paused = (await db.productBuilds.get(build.id!))!
    expect(JSON.parse(paused.failureJson)).toMatchObject({
      code: 'user-paused', pausedFromControlEpoch: 0,
      previousFailure: {
        taskKey: 'integration.package', code: 'task-executor-failed',
        detail: expect.stringContaining('文字冒险叙事质量审查未通过'),
      },
    })
    await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'resume', commandId: 'pause-cause.resume', expectedStateRevision: 3 },
    })
    const resumed = (await db.productBuilds.get(build.id!))!
    expect(JSON.parse(resumed.failureJson)).toMatchObject({
      code: 'user-resumed', resumedFromControlEpoch: 1,
      pauseReceipt: { code: 'user-paused', pausedFromControlEpoch: 0 },
      previousFailure: {
        taskKey: 'integration.package', code: 'task-executor-failed',
        detail: expect.stringContaining('文字冒险叙事质量审查未通过'),
      },
    })
  })

  it('uses command payload hashes and revision CAS to make double-submit deterministic', async () => {
    const f = await fixture()
    const created = await executeProductProductionCommand({
      scope: f.scope,
      command: { type: 'create-intent', commandId: 'intent-cas', productionKey: 'cas-story', productType: 'avg', worldReleaseId: f.worldReleaseId, userText: 'CAS 游戏' },
    })
    const [left, right] = await Promise.all([
      executeProductProductionCommand({
        scope: f.scope, productionId: created.productionId,
        command: { type: 'save-brief-revision', commandId: 'brief-left', expectedStateRevision: 0, parentRevision: null, brief: f.brief },
      }),
      executeProductProductionCommand({
        scope: f.scope, productionId: created.productionId,
        command: { type: 'save-brief-revision', commandId: 'brief-right', expectedStateRevision: 0, parentRevision: null, brief: f.brief },
      }),
    ])
    expect([left, right].filter(item => item.ok)).toHaveLength(1)
    expect([left, right].find(item => !item.ok)).toMatchObject({ errorCode: 'production-state-conflict' })
    expect(await db.productProductionBriefs.where('productionId').equals(created.productionId).count()).toBe(1)

    await expect(executeProductProductionCommand({
      scope: f.scope,
      command: { type: 'create-intent', commandId: 'intent-cas', productionKey: 'cas-story', productType: 'avg', worldReleaseId: f.worldReleaseId, userText: '不同 payload' },
    })).rejects.toThrow('payload')
    expect(await db.productProductions.where('workId').equals(f.scope.workId).count()).toBe(1)
  })

  it('刷新重放已完成的 Brief/开始命令时只读 durable receipt，不重新依赖本地世界来源', async () => {
    const f = await fixture()
    const created = await executeProductProductionCommand({
      scope: f.scope,
      command: {
        type: 'create-intent', commandId: 'replay.intent', productionKey: 'replay-story',
        productType: 'avg', worldReleaseId: f.worldReleaseId, userText: '验证持久回执',
      },
    })
    const saveCommand = {
      type: 'save-brief-revision' as const,
      commandId: 'replay.brief',
      expectedStateRevision: 0,
      parentRevision: null,
      brief: f.brief,
    }
    const saved = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId, command: saveCommand,
    })
    const startCommand = {
      type: 'authorize-start' as const,
      commandId: 'replay.start',
      expectedStateRevision: 1,
      briefRevision: 1,
      briefHash: saved.result.briefHash as string,
      authorizationNonce: 'replay.click',
    }
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId, command: startCommand,
    })).resolves.toMatchObject({ ok: true, replayed: false })

    await db.worldReleases.delete(f.worldReleaseId)
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId, command: saveCommand,
    })).resolves.toMatchObject({ ok: true, replayed: true, stateRevision: 2 })
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId, command: startCommand,
    })).resolves.toMatchObject({ ok: true, replayed: true, stateRevision: 2 })
    expect(await db.productProductionBriefs.where('productionId').equals(created.productionId).count()).toBe(1)
    expect(await db.productBuilds.where('productionId').equals(created.productionId).count()).toBe(1)
  })

  it('可恢复归档 Preview Build，不删除 lineage、receipt 或冻结状态', async () => {
    const f = await fixture()
    const created = await executeProductProductionCommand({
      scope: f.scope,
      command: { type: 'create-intent', commandId: 'archive.intent', productionKey: 'archive-preview', productType: 'avg', worldReleaseId: f.worldReleaseId, userText: '归档预览' },
    })
    const saved = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'save-brief-revision', commandId: 'archive.brief', expectedStateRevision: 0, parentRevision: null, brief: f.brief },
    })
    await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'authorize-start', commandId: 'archive.start', expectedStateRevision: 1, briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'archive.click' },
    })
    const build = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
    await db.productProductions.update(created.productionId, { status: 'preview-ready' })
    await db.productBuilds.update(build.id!, { status: 'release-ready' })
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'archive', commandId: 'archive.preview', expectedStateRevision: 2, reason: '稍后继续' },
    })).resolves.toMatchObject({ ok: true, result: { previousStatus: 'preview-ready' } })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({ status: 'archived', resumeState: 'release-ready' })
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'restore', commandId: 'archive.restore', expectedStateRevision: 3 },
    })).resolves.toMatchObject({ ok: true, result: { restoredStatus: 'preview-ready', restoredBuildStatus: 'release-ready' } })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({ status: 'release-ready', resumeState: null })
    expect(await db.productProductionBriefs.where('productionId').equals(created.productionId).count()).toBe(1)
    expect(await db.productProductionCommands.where('productionId').equals(created.productionId).count()).toBe(5)
  })

  it('归档失败态后恢复原错误证据，不让版本整理覆盖诊断', async () => {
    const f = await fixture()
    const created = await executeProductProductionCommand({
      scope: f.scope,
      command: { type: 'create-intent', commandId: 'archive.failed.intent', productionKey: 'archive-failed', productType: 'avg', worldReleaseId: f.worldReleaseId, userText: '失败态归档' },
    })
    const failureEvidence = JSON.stringify({ code: 'provider-failed', taskKey: 'visual.hero', retryable: false })
    await db.productProductions.update(created.productionId, { status: 'failed', lastErrorJson: failureEvidence })
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'archive', commandId: 'archive.failed', expectedStateRevision: 0, reason: '收起失败版本' },
    })).resolves.toMatchObject({ ok: true, result: { previousStatus: 'failed' } })
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'restore', commandId: 'archive.failed.restore', expectedStateRevision: 1 },
    })).resolves.toMatchObject({ ok: true, result: { restoredStatus: 'failed' } })
    expect(await db.productProductions.get(created.productionId)).toMatchObject({
      status: 'failed', lastErrorJson: failureEvidence,
    })
  })

  it('允许升级前已终止的确定性装配失败在修复后进入新 epoch，仍拒绝无关终态失败', async () => {
    const f = await fixture()
    const created = await executeProductProductionCommand({
      scope: f.scope,
      command: {
        type: 'create-intent', commandId: 'repair.intent', productionKey: 'repair-terminal-build',
        productType: 'avg', worldReleaseId: f.worldReleaseId, userText: '修复装配失败',
      },
    })
    const saved = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'save-brief-revision', commandId: 'repair.brief', expectedStateRevision: 0,
        parentRevision: null, brief: f.brief,
      },
    })
    await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'repair.start', expectedStateRevision: 1,
        briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'repair.click',
      },
    })
    const build = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
    await db.productProductions.update(created.productionId, { status: 'failed' })
    await db.productBuilds.update(build.id!, {
      status: 'failed', failureJson: JSON.stringify({
        taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
      }),
    })
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'repair.retry', expectedStateRevision: 2,
        blockerKey: 'integration.package', resolution: { action: 'retry', note: '代码修复后重试装配' },
      },
    })).resolves.toMatchObject({ ok: true, stateRevision: 3, result: { controlEpoch: 1 } })
    expect(await db.productProductions.get(created.productionId)).toMatchObject({ status: 'producing', controlEpoch: 1 })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({ status: 'building', controlEpoch: 1, completedAt: null })

    await db.productProductions.update(created.productionId, { status: 'failed', stateRevision: 4 })
    await db.productBuilds.update(build.id!, {
      status: 'failed', failureJson: JSON.stringify({ taskKey: 'media.visual', code: 'task-executor-failed' }),
    })
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'repair.reject', expectedStateRevision: 4,
        blockerKey: 'media.visual', resolution: { action: 'retry', note: '不应复活普通终态失败' },
      },
    })).resolves.toMatchObject({ ok: false, errorCode: 'invalid-state-transition' })
  })

  it('多轮恢复压缩重复故障历史，保留当前因果、任务索引和最初质量返修原因', async () => {
    const f = await fixture('text-adventure')
    const created = await executeProductProductionCommand({
      scope: f.scope,
      command: {
        type: 'create-intent', commandId: 'bounded-recovery.intent',
        productionKey: 'bounded-recovery-history', productType: 'text-adventure',
        worldReleaseId: f.worldReleaseId, userText: '验证恢复证据有界压缩',
      },
    })
    const saved = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'save-brief-revision', commandId: 'bounded-recovery.brief',
        expectedStateRevision: 0, parentRevision: null, brief: f.brief,
      },
    })
    await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'bounded-recovery.start', expectedStateRevision: 1,
        briefRevision: 1, briefHash: saved.result.briefHash as string,
        authorizationNonce: 'bounded-recovery.click',
      },
    })
    const build = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
    const repairCause = {
      taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
      detail: '文字冒险叙事质量审查未通过，必须先修复阻塞问题并重新生产',
    }
    const taskFailures = Object.fromEntries(Array.from({ length: 40 }, (_, index) => {
      const taskKey = `content.synthetic-${String(index).padStart(2, '0')}`
      return [taskKey, {
        taskKey, code: 'task-executor-failed', attempt: index + 1,
        detail: `failure-${index}:` + '长'.repeat(1_500),
      }]
    }))
    const directFailure = {
      taskKey: 'content.quest-script.main.act-3.single', code: 'task-executor-failed', attempt: 2,
      detail: '[text-adventure-production-artifact-v2] resolution 字段不精确',
      repairCause, taskFailures,
    }
    const oversizedFailure = {
      ...directFailure,
      previousFailure: { ...directFailure, previousFailure: directFailure },
    }
    expect(JSON.stringify(oversizedFailure).length).toBeGreaterThan(100_000)
    await db.productBuilds.update(build.id!, {
      status: 'recovery-required', failureJson: JSON.stringify(oversizedFailure),
    })

    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'bounded-recovery.retry', expectedStateRevision: 2,
        blockerKey: directFailure.taskKey, resolution: { action: 'retry', note: '按当前失败恢复' },
      },
    })).resolves.toMatchObject({ ok: true, result: { controlEpoch: 1 } })
    const recovered = (await db.productBuilds.get(build.id!))!
    expect(recovered.failureJson.length).toBeLessThan(100_000)
    const envelope = JSON.parse(recovered.failureJson) as {
      previousFailure: {
        taskKey: string
        repairCause: { taskKey: string }
        taskFailures: Record<string, { taskKey: string }>
      }
    }
    expect(envelope.previousFailure.taskKey).toBe(directFailure.taskKey)
    expect(envelope.previousFailure.repairCause.taskKey).toBe('integration.package')
    expect(envelope.previousFailure.taskFailures[directFailure.taskKey]).toMatchObject({
      taskKey: directFailure.taskKey,
    })
  })

  it('预算耗尽时创建不可变恢复子 Build，并只继承已签收的专业生产工件', async () => {
    const f = await fixture('text-adventure')
    const lowBudgetBrief = parseProductProductionBriefV3({
      ...f.brief,
      productionBudget: { ...f.brief.productionBudget, maximumModelCalls: 64 },
    })
    const created = await executeProductProductionCommand({
      scope: f.scope,
      command: {
        type: 'create-intent', commandId: 'budget-recovery.intent',
        productionKey: 'budget-recovery-story', productType: 'text-adventure',
        worldReleaseId: f.worldReleaseId, userText: '制作专业文字冒险并验证预算续建',
      },
    })
    const saved = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'save-brief-revision', commandId: 'budget-recovery.brief', expectedStateRevision: 0,
        parentRevision: null, brief: lowBudgetBrief,
      },
    })
    await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'budget-recovery.start', expectedStateRevision: 1,
        briefRevision: 1, briefHash: saved.result.briefHash as string,
        authorizationNonce: 'budget-recovery.click',
      },
    })
    const parent = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
    const parentPlan = await createProductProductionPlanV3({
      buildNumber: parent.buildNumber, controlEpoch: parent.controlEpoch,
      briefHash: saved.result.briefHash as string, brief: lowBudgetBrief,
    })
    const parentPlanHash = await hashProductProductionValueV2(parentPlan)
    const supervisionTask = parentPlan.tasks.find(task => task.taskKey === 'production.supervision')!
    const supervisionPayload = {
      schema: 'fixture.accepted-artifact', version: 1, taskKey: supervisionTask.taskKey,
    }
    const supervisionHash = await hashProductProductionValueV2(supervisionPayload)
    await db.productBuildArtifacts.add({
      projectId: f.scope.projectId, worldId: f.scope.worldId, workId: f.scope.workId,
      buildId: parent.id!, artifactKey: supervisionTask.outputArtifactKeys[0],
      requirementKey: null, version: 1, kind: 'narrative', mediaKind: null,
      status: 'accepted', producerRunId: null, producerReceiptHash: null,
      controlEpoch: parent.controlEpoch, inputHash: await hashProductProductionValueV2({ input: 1 }),
      contentHash: supervisionHash, payloadJson: canonicalProductProductionJsonV2(supervisionPayload),
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null,
      mimeType: null, byteSize: 1, parentArtifactHash: null, carriedFrom: null,
      createdAt: Date.now(), updatedAt: Date.now(),
    } satisfies ProductBuildArtifactRecordV1)
    await db.productBuilds.update(parent.id!, {
      status: 'recovery-required', planRevision: 1,
      planJson: canonicalProductProductionJsonV2(parentPlan), planHash: parentPlanHash,
      failureJson: JSON.stringify({
        taskKey: 'content.dialogue-pass.act-3', code: 'task-executor-failed',
        detail: 'Build lifetime budget 不足:modelCalls=64/64',
      }),
    })

    const evolved = await beginProductProductionEvolutionV1({
      scope: f.scope, productionId: created.productionId,
      userText: '仅扩充专业文字冒险生产预算并继承已签收工件继续生产。',
      affectedLanes: ['production-budget'],
    })
    const recoveredBriefRow = (await db.productProductionBriefs
      .where('[productionId+revision]').equals([created.productionId, evolved.briefRevision]).first())!
    const recoveredBrief = parseProductProductionBriefV3(recoveredBriefRow.briefJson)
    expect(recoveredBrief.productionBudget.maximumModelCalls).toBeGreaterThan(64)
    expect(recoveredBrief.evolution).toMatchObject({
      affectedLanes: ['production-budget'],
      base: {
        kind: 'recovery-build', buildNumber: 1, briefHash: saved.result.briefHash,
        planHash: parentPlanHash, controlEpoch: parent.controlEpoch,
      },
    })
    expect(await db.productBuilds.get(parent.id!)).toMatchObject({
      status: 'recovery-required', briefHash: saved.result.briefHash, planHash: parentPlanHash,
    })

    const production = (await db.productProductions.get(created.productionId))!
    await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'budget-recovery.restart',
        expectedStateRevision: production.stateRevision, briefRevision: evolved.briefRevision,
        briefHash: recoveredBriefRow.briefHash, authorizationNonce: 'budget-recovery.restart-click',
      },
    })
    const child = (await db.productBuilds
      .where('[productionId+buildNumber]').equals([created.productionId, 2]).first())!
    expect(child).toMatchObject({ parentBuildNumber: 1, status: 'authorized' })
    await runProductProductionSchedulerCycleV1({
      scope: f.scope, productionId: created.productionId,
      capabilityBindings: recoveredBrief.capabilityRequirements.map(requirement => ({
        requirementKey: requirement.requirementKey,
        adapterId: `fixture.${requirement.mediaClass}`,
        bindingHash: 'f'.repeat(64),
      })),
      executor: async () => { throw new Error('fixture stops after reuse materialization') },
    })
    const carried = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([child.id!, supervisionTask.outputArtifactKeys[0]]).first()
    expect(carried).toMatchObject({
      status: 'carried-forward', contentHash: supervisionHash,
      parentArtifactHash: supervisionHash,
    })
  })

  it('旧版多图 Visual QA 失败时通过审查 Brief 派生逐图审查 Build', async () => {
    const f = await fixture('text-adventure', 'key-scenes')
    const created = await executeProductProductionCommand({
      scope: f.scope,
      command: {
        type: 'create-intent', commandId: 'visual-plan-upgrade.intent',
        productionKey: 'visual-plan-upgrade-story', productType: 'text-adventure',
        worldReleaseId: f.worldReleaseId, userText: '验证旧版多图审图计划的不可变升级',
      },
    })
    const saved = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'save-brief-revision', commandId: 'visual-plan-upgrade.brief', expectedStateRevision: 0,
        parentRevision: null, brief: f.brief,
      },
    })
    await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'visual-plan-upgrade.start', expectedStateRevision: 1,
        briefRevision: 1, briefHash: saved.result.briefHash as string,
        authorizationNonce: 'visual-plan-upgrade.click',
      },
    })
    const parent = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
    const currentPlan = await createProductProductionPlanV3({
      buildNumber: parent.buildNumber, controlEpoch: parent.controlEpoch,
      briefHash: saved.result.briefHash as string, brief: f.brief,
    })
    const batches = currentPlan.tasks
      .filter(task => task.kind === 'text-adventure-visual-quality-review-batch')
    expect(batches.length).toBeGreaterThanOrEqual(2)
    const first = batches[0]
    const second = batches[1]
    const legacyCandidate = {
      ...currentPlan,
      tasks: currentPlan.tasks
        .filter(task => task.taskKey !== second.taskKey)
        .map(task => task.taskKey === first.taskKey ? {
          ...task,
          inputArtifactKeys: [...task.inputArtifactKeys, ...second.inputArtifactKeys
            .filter(key => /^media\.visual\.\d{3}$/.test(key))],
        } : task.taskKey === 'media.visual-quality-review' ? {
          ...task,
          dependsOn: task.dependsOn.filter(key => key !== second.taskKey),
          requiredReceipts: task.requiredReceipts.filter(item => item.taskKey !== second.taskKey),
          inputArtifactKeys: task.inputArtifactKeys
            .filter(key => !second.outputArtifactKeys.includes(key)),
        } : task),
    }
    const legacyPlan = parseProductProductionPlanV3(legacyCandidate, f.brief, saved.result.briefHash as string)
    const legacyPlanHash = await hashProductProductionValueV2(legacyPlan)
    await db.productBuilds.update(parent.id!, {
      status: 'recovery-required', planRevision: 1,
      planJson: canonicalProductProductionJsonV2(legacyPlan), planHash: legacyPlanHash,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: first.taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '旧版多图审查返回数量不匹配',
      }),
    })

    const evolved = await beginProductProductionEvolutionV1({
      scope: f.scope, productionId: created.productionId,
      userText: '只升级旧版多图 Visual QA 为逐图审查，不改变正文与图片。',
      affectedLanes: ['execution-plan'],
    })
    const evolvedBriefRow = (await db.productProductionBriefs
      .where('[productionId+revision]').equals([created.productionId, evolved.briefRevision]).first())!
    const evolvedBrief = parseProductProductionBriefV3(evolvedBriefRow.briefJson)
    expect(evolvedBrief.evolution).toMatchObject({
      affectedLanes: ['execution-plan'],
      base: { kind: 'recovery-build', buildNumber: 1, planHash: legacyPlanHash },
    })
    expect(await db.productBuilds.get(parent.id!)).toMatchObject({
      status: 'recovery-required', planHash: legacyPlanHash,
    })

    const production = (await db.productProductions.get(created.productionId))!
    const authorized = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'visual-plan-upgrade.restart',
        expectedStateRevision: production.stateRevision, briefRevision: evolved.briefRevision,
        briefHash: evolvedBriefRow.briefHash, authorizationNonce: 'visual-plan-upgrade.restart-click',
      },
    })
    expect(authorized).toMatchObject({ ok: true, result: { buildNumber: 2 } })
    const child = (await db.productBuilds
      .where('[productionId+buildNumber]').equals([created.productionId, 2]).first())!
    const childPlan = await createProductProductionPlanV3({
      buildNumber: child.buildNumber, controlEpoch: child.controlEpoch,
      briefHash: child.briefHash, brief: evolvedBrief,
    })
    const childBatches = childPlan.tasks
      .filter(task => task.kind === 'text-adventure-visual-quality-review-batch')
    expect(childBatches.length).toBeGreaterThan(legacyPlan.tasks
      .filter(task => task.kind === 'text-adventure-visual-quality-review-batch').length)
    expect(childBatches.every(task => task.inputArtifactKeys
      .filter(key => /^media\.visual\.\d{3}$/.test(key)).length === 1)).toBe(true)
  })

  it('任一正式任务的实测用量超过旧冻结预留时允许派生执行计划升级', async () => {
    const f = await fixture('text-adventure', 'key-scenes')
    const briefHash = await hashProductProductionValueV2(f.brief)
    const plan = await createProductProductionPlanV3({ buildNumber: 1, briefHash, brief: f.brief })
    const batch = plan.tasks.find(task => task.kind === 'text-adventure-visual-quality-review-batch')!
    expect(batch.inputArtifactKeys.filter(key => /^media\.visual\.\d{3}$/.test(key))).toHaveLength(1)
    const candidate = {
      status: 'recovery-required' as const,
      releasedProductReleaseId: null,
      planJson: canonicalProductProductionJsonV2(plan),
      failureJson: canonicalProductProductionJsonV2({
        taskKey: batch.taskKey, code: 'task-budget-exceeded', attempt: 1,
        detail: 'task usage 超出 Plan 预算预留:outputTokens=2782/2040',
      }),
    }
    expect(canUpgradeTextAdventureExecutionPlanV1(candidate)).toBe(true)
    const supplemental = plan.tasks.find(task => task.taskKey === 'content.quest-script.supplemental')!
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: supplemental.taskKey, code: 'task-budget-exceeded', attempt: 1,
        detail: 'task usage 超出 Plan 预算预留:durationMs=128946/107462',
      }),
    })).toBe(true)
    const sceneWriter = plan.tasks.find(task => task.kind === 'text-adventure-scene-script-part')!
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: sceneWriter.taskKey, code: 'task-timeout', attempt: 2,
        detail: `[product-production-scheduler] ${sceneWriter.taskKey} `
          + `超过任务合同 ${sceneWriter.timeoutMs}ms`,
      }),
    })).toBe(true)
    const narrativeReviewer = plan.tasks.find(task => (
      task.taskKey === 'content.adventure-quality-review.act-2'
    ))!
    expect(narrativeReviewer.budgetReservation.outputTokens).toBe(32_000)
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: narrativeReviewer.taskKey, code: 'task-budget-exceeded', attempt: 1,
        detail: 'task usage 超出 Plan 预算预留:outputTokens=27915/24128',
      }),
    })).toBe(true)
    const dialogueEditor = plan.tasks.find(task => task.taskKey === 'content.dialogue-pass.act-3')!
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: dialogueEditor.taskKey, code: 'task-preflight-failed', attempt: 1,
        detail: '[product-production-context] 第 3 幕对白审校投影超过登记预算:'
          + '17425/16500，必须增加更小的有界对白分包计划',
      }),
    })).toBe(true)
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: dialogueEditor.taskKey, code: 'task-preflight-failed', attempt: 1,
        detail: '[product-production-context] 第 3 幕对白审校投影超过登记预算:'
          + '16500/16500，必须增加更小的有界对白分包计划',
      }),
    })).toBe(false)
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: sceneWriter.taskKey, code: 'task-preflight-failed', attempt: 1,
        detail: '[product-production-context] 第 3 幕对白审校投影超过登记预算:'
          + '17425/16500，必须增加更小的有界对白分包计划',
      }),
    })).toBe(false)
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: sceneWriter.taskKey, code: 'task-timeout', attempt: 2,
        detail: `[product-production-scheduler] ${sceneWriter.taskKey} 超过伪造合同 1ms`,
      }),
    })).toBe(false)
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: batch.taskKey, code: 'task-executor-failed', attempt: 1,
        detail: '其他不可重试错误',
      }),
    })).toBe(false)
    const narrativeReview = plan.tasks.find(task => (
      task.taskKey === 'content.adventure-quality-review.act-1'
    ))!
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: narrativeReview.taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[product-production-executor] 叙事质量审查错误引用冻结身份:'
          + '审查 引用未登记 key:scene.03',
      }),
    })).toBe(true)
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: narrativeReview.taskKey, code: 'task-executor-failed', attempt: 2,
        detail: '[product-production-executor] 叙事质量审查越过地点字段权威:'
          + '通用叙事决定固定拥有两个立场选项；第三结局必须由跨决定状态组合进入，不得增删单个 decision 的 option',
      }),
    })).toBe(true)
  })

  it('仅把缺少真实图片输入预检的旧锚点 Plan 识别为可升级，现行或伪造失败不得误放行', async () => {
    const f = await fixture('text-adventure', 'key-scenes')
    const briefHash = await hashProductProductionValueV2(f.brief)
    const currentPlan = await createProductProductionPlanV3({
      buildNumber: 52, controlEpoch: 3, briefHash, brief: f.brief,
    })
    const legacyPlan = {
      ...currentPlan,
      tasks: currentPlan.tasks
        .filter(task => task.taskKey !== 'media.vision-preflight')
        .map(task => task.taskKey === 'media.anchor-author-gate' ? {
          ...task,
          dependsOn: ['media.visual-bible.compile'],
          requiredReceipts: [{ taskKey: 'media.visual-bible.compile', receiptHash: null }],
          inputArtifactKeys: task.inputArtifactKeys.filter(key => key !== 'media.vision-preflight'),
        } : task),
    }
    const candidate = {
      status: 'recovery-required' as const,
      releasedProductReleaseId: null,
      planJson: canonicalProductProductionJsonV2(legacyPlan),
      failureJson: canonicalProductProductionJsonV2({
        taskKey: 'media.anchor-author-gate', code: 'task-executor-failed', attempt: 1,
        detail: '旧计划在角色锚点闸门停住，尚未登记真实图片输入预检。',
      }),
    }
    expect(canUpgradeTextAdventureExecutionPlanV1(candidate)).toBe(true)
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      planJson: canonicalProductProductionJsonV2(currentPlan),
    })).toBe(false)
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: 'media.visual-bible.compile', code: 'task-executor-failed', attempt: 1,
        detail: '伪造为其他任务的普通失败。',
      }),
    })).toBe(false)
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      releasedProductReleaseId: 91,
    })).toBe(false)
  })

  it('缺少独立结局路线 Agent 的旧文字冒险 Plan 必须升级，现行 Plan 不误判', async () => {
    const f = await fixture('text-adventure', 'key-scenes')
    const briefHash = await hashProductProductionValueV2(f.brief)
    const currentPlan = await createProductProductionPlanV3({
      buildNumber: 88, controlEpoch: 438, briefHash, brief: f.brief,
    })
    const legacyPlan = {
      ...currentPlan,
      tasks: currentPlan.tasks
        .filter(task => task.taskKey !== 'content.ending-route-plan')
        .map(task => ({
          ...task,
          dependsOn: task.dependsOn.filter(key => key !== 'content.ending-route-plan'),
          requiredReceipts: task.requiredReceipts.filter(receipt => (
            receipt.taskKey !== 'content.ending-route-plan'
          )),
          inputArtifactKeys: task.inputArtifactKeys.filter(key => key !== 'content.ending-route-plan'),
        })),
    }
    const candidate = {
      status: 'recovery-required' as const,
      releasedProductReleaseId: null,
      planJson: canonicalProductProductionJsonV2(legacyPlan),
      failureJson: canonicalProductProductionJsonV2({
        taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
        detail: '[product-production-executor] 文字冒险叙事质量审查未通过，必须先修复阻塞问题并重新生产',
      }),
    }
    expect(canUpgradeTextAdventureExecutionPlanV1(candidate)).toBe(true)
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      planJson: canonicalProductProductionJsonV2(currentPlan),
    })).toBe(false)
  })

  it('旧 Scene Writer 的 29,343 实测计费用量可幂等升级为六个 32k 预留的新计划', async () => {
    const f = await fixture('text-adventure', 'key-scenes')
    const created = await executeProductProductionCommand({
      scope: f.scope,
      command: {
        type: 'create-intent', commandId: 'scene-budget-plan-upgrade.intent',
        productionKey: `scene-budget-plan-upgrade-${crypto.randomUUID()}`,
        productType: 'text-adventure', worldReleaseId: f.worldReleaseId,
        userText: '验证 Scene Writer 的实测计费预留升级',
      },
    })
    const saved = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'save-brief-revision', commandId: 'scene-budget-plan-upgrade.brief',
        expectedStateRevision: 0, parentRevision: null, brief: f.brief,
      },
    })
    await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'scene-budget-plan-upgrade.start',
        expectedStateRevision: 1, briefRevision: 1,
        briefHash: saved.result.briefHash as string,
        authorizationNonce: 'scene-budget-plan-upgrade.click',
      },
    })
    const parent = (await db.productBuilds
      .where('productionId').equals(created.productionId).first())!
    const currentPlan = await createProductProductionPlanV3({
      buildNumber: parent.buildNumber, controlEpoch: parent.controlEpoch,
      briefHash: saved.result.briefHash as string, brief: f.brief,
    })
    const sceneTaskKeys = currentPlan.tasks
      .filter(task => task.kind === 'text-adventure-scene-script-part')
      .map(task => task.taskKey)
    expect(sceneTaskKeys).toHaveLength(6)
    const legacyPlan = parseProductProductionPlanV3({
      ...currentPlan,
      tasks: currentPlan.tasks.map(task => sceneTaskKeys.includes(task.taskKey) ? {
        ...task,
        budgetReservation: { ...task.budgetReservation, outputTokens: 24_128 },
      } : task),
    }, f.brief, saved.result.briefHash as string)
    const legacyPlanHash = await hashProductProductionValueV2(legacyPlan)
    await db.productBuilds.update(parent.id!, {
      status: 'recovery-required', planRevision: 1,
      planJson: canonicalProductProductionJsonV2(legacyPlan), planHash: legacyPlanHash,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: 'content.scene-script.act-1.part-1', code: 'task-budget-exceeded', attempt: 1,
        detail: 'task usage 超出 Plan 预算预留:outputTokens=29343/24128',
      }),
    })
    const failedBuild = (await db.productBuilds.get(parent.id!))!
    expect(canUpgradeTextAdventureExecutionPlanV1(failedBuild)).toBe(true)

    const first = await upgradeTextAdventureProductionPlanV1({
      scope: f.scope, productionId: created.productionId,
    })
    const replay = await upgradeTextAdventureProductionPlanV1({
      scope: f.scope, productionId: created.productionId,
    })
    expect(replay).toEqual(first)
    expect(await db.productProductionBriefs
      .where('productionId').equals(created.productionId).count()).toBe(2)

    const evolvedBriefRow = (await db.productProductionBriefs
      .where('[productionId+revision]')
      .equals([created.productionId, first.briefRevision]).first())!
    const evolvedBrief = parseProductProductionBriefV3(evolvedBriefRow.briefJson)
    const production = (await db.productProductions.get(created.productionId))!
    const authorized = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'scene-budget-plan-upgrade.restart',
        expectedStateRevision: production.stateRevision, briefRevision: first.briefRevision,
        briefHash: evolvedBriefRow.briefHash,
        authorizationNonce: 'scene-budget-plan-upgrade.restart-click',
      },
    })
    expect(authorized).toMatchObject({ ok: true, result: { buildNumber: 2 } })
    const child = (await db.productBuilds
      .where('[productionId+buildNumber]').equals([created.productionId, 2]).first())!
    const childPlan = await createProductProductionPlanV3({
      buildNumber: child.buildNumber, controlEpoch: child.controlEpoch,
      briefHash: child.briefHash, brief: evolvedBrief,
    })
    const childSceneReservations = childPlan.tasks
      .filter(task => task.kind === 'text-adventure-scene-script-part')
      .map(task => task.budgetReservation.outputTokens)
    expect(childSceneReservations).toEqual(Array.from({ length: 6 }, () => 32_000))
    expect(childSceneReservations.every(tokens => tokens > 29_343)).toBe(true)
    const childQuestReservations = childPlan.tasks
      .filter(task => task.kind === 'text-adventure-quest-script-part'
        && /^content\.quest-script\.main\./.test(task.taskKey))
      .map(task => task.budgetReservation.outputTokens)
    expect(childQuestReservations).toEqual(Array.from({ length: 6 }, () => 8_000))
    expect(childQuestReservations.every(tokens => tokens > 6_831)).toBe(true)
    const childPlanHash = await hashProductProductionValueV2(childPlan)
    expect(childPlanHash).not.toBe(legacyPlanHash)
    expect(childPlan.tasks.reduce(
      (sum, task) => sum + task.budgetReservation.outputTokens, 0,
    )).toBeLessThanOrEqual(Math.floor(evolvedBrief.productionBudget.maximumOutputTokens * 1.3))
    expect(await db.productBuilds.get(parent.id!)).toMatchObject({
      status: 'recovery-required', planHash: legacyPlanHash,
    })
  })

  it('Build #50 只有旧单体质量审查真实超过 31500 时可幂等派生现行执行计划', async () => {
    const f = await legacyOversizedQualityReviewRecoveryFixture()
    const candidate = (await db.productBuilds
      .where('[productionId+buildNumber]').equals([f.productionId, 50]).first())!
    expect(canUpgradeTextAdventureExecutionPlanV1(candidate)).toBe(true)
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: 'content.adventure-quality-review', code: 'task-preflight-failed', attempt: 1,
        detail: '[product-production-context] 旧版整包文字冒险质量审查不可继续执行；'
          + '必须升级冻结生产计划后按 structure/act scope 重跑',
      }),
    })).toBe(true)

    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      failureJson: canonicalProductProductionJsonV2({
        taskKey: 'content.adventure-quality-review', code: 'task-preflight-failed', attempt: 1,
        detail: '文字冒险质量审查投影超过登记预算:31500/31500，必须拆分审查任务',
      }),
    })).toBe(false)
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate, releasedProductReleaseId: 9,
    })).toBe(false)
    const currentPlan = parseProductProductionPlanV3({
      ...f.legacyPlan,
      tasks: f.legacyPlan.tasks.map(task => task.taskKey === 'content.adventure-quality-review'
        ? { ...task, executionMode: 'deterministic', skillId: null }
        : task),
    }, f.brief, candidate.briefHash)
    expect(canUpgradeTextAdventureExecutionPlanV1({
      ...candidate,
      planJson: canonicalProductProductionJsonV2(currentPlan),
    })).toBe(false)

    const first = await upgradeTextAdventureProductionPlanV1({
      scope: f.scope, productionId: f.productionId,
    })
    const replay = await upgradeTextAdventureProductionPlanV1({
      scope: f.scope, productionId: f.productionId,
    })
    expect(replay).toEqual(first)
    expect(await db.productProductionBriefs.where('productionId').equals(f.productionId).count()).toBe(2)
    expect(await db.productBuilds.where('productionId').equals(f.productionId).count()).toBe(1)

    const evolvedBriefRow = (await db.productProductionBriefs
      .where('[productionId+revision]').equals([f.productionId, first.briefRevision]).first())!
    const production = (await db.productProductions.get(f.productionId))!
    const authorized = await executeProductProductionCommand({
      scope: f.scope, productionId: f.productionId,
      command: {
        type: 'authorize-start', commandId: 'quality-plan-upgrade.restart',
        expectedStateRevision: production.stateRevision, briefRevision: first.briefRevision,
        briefHash: evolvedBriefRow.briefHash, authorizationNonce: 'quality-plan-upgrade.restart-click',
      },
    })
    expect(authorized).toMatchObject({ ok: true, result: { buildNumber: 51 } })
    expect(await db.productBuilds.get(candidate.id!)).toMatchObject({
      buildNumber: 50, status: 'recovery-required', planHash: f.planHash,
    })
    expect(await db.productBuilds
      .where('[productionId+buildNumber]').equals([f.productionId, 51]).first()).toMatchObject({
      parentBuildNumber: 50, status: 'authorized',
    })
  })

  it('旧单体质量审查已有当前 epoch 通过证据时拒绝执行计划升级', async () => {
    const f = await legacyOversizedQualityReviewRecoveryFixture()
    const build = (await db.productBuilds
      .where('[productionId+buildNumber]').equals([f.productionId, 50]).first())!
    const payload = {
      schema: 'storyforge.text-adventure-quality-review-artifact', version: 1,
      scores: {
        causality: 5, playerAgency: 5, routeDifferentiation: 5, pacing: 5,
        setupPayoff: 5, characterMotivation: 5, emotionalImpact: 5,
      },
      issues: [], passed: true,
    }
    const payloadJson = canonicalProductProductionJsonV2(payload)
    await db.productBuildArtifacts.add({
      projectId: f.scope.projectId, worldId: f.scope.worldId, workId: f.scope.workId,
      buildId: build.id!, artifactKey: 'quality.adventure-review', requirementKey: null,
      version: 1, kind: 'playtest-report', mediaKind: null, status: 'accepted',
      producerRunId: null, producerReceiptHash: null, controlEpoch: build.controlEpoch,
      inputHash: await hashProductProductionValueV2({ artifactKey: 'quality.adventure-review' }),
      contentHash: await hashProductProductionValueV2(payload), payloadJson,
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null,
      mimeType: null, byteSize: new TextEncoder().encode(payloadJson).byteLength,
      parentArtifactHash: null, carriedFrom: null, createdAt: Date.now(), updatedAt: Date.now(),
    })
    await expect(upgradeTextAdventureProductionPlanV1({
      scope: f.scope, productionId: f.productionId,
    })).rejects.toThrow('叙事质量审查已经通过')
    expect(await db.productProductionBriefs.where('productionId').equals(f.productionId).count()).toBe(1)
  })

  it('视觉合同质量失败可派生 visual-only 恢复 Build，非视觉装配失败不能冒用该通道', async () => {
    const prepareRecovery = async (productionKey: string, failureDetail: string) => {
      const f = await fixture('text-adventure', 'key-scenes')
      const created = await executeProductProductionCommand({
        scope: f.scope,
        command: {
          type: 'create-intent', commandId: `${productionKey}.intent`, productionKey,
          productType: 'text-adventure', worldReleaseId: f.worldReleaseId,
          userText: '验证视觉合同的受治理恢复路径',
        },
      })
      const saved = await executeProductProductionCommand({
        scope: f.scope, productionId: created.productionId,
        command: {
          type: 'save-brief-revision', commandId: `${productionKey}.brief`, expectedStateRevision: 0,
          parentRevision: null, brief: f.brief,
        },
      })
      await executeProductProductionCommand({
        scope: f.scope, productionId: created.productionId,
        command: {
          type: 'authorize-start', commandId: `${productionKey}.start`, expectedStateRevision: 1,
          briefRevision: 1, briefHash: saved.result.briefHash as string,
          authorizationNonce: `${productionKey}.click`,
        },
      })
      const build = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
      const plan = await createProductProductionPlanV3({
        buildNumber: build.buildNumber, controlEpoch: build.controlEpoch,
        briefHash: saved.result.briefHash as string, brief: f.brief,
      })
      const planHash = await hashProductProductionValueV2(plan)
      await db.productBuilds.update(build.id!, {
        status: 'recovery-required', planRevision: 1,
        planJson: canonicalProductProductionJsonV2(plan), planHash,
        failureJson: canonicalProductProductionJsonV2({
          taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
          detail: failureDetail,
        }),
      })
      return { ...f, productionId: created.productionId, build, plan, planHash, briefHash: saved.result.briefHash as string }
    }

    const visual = await prepareRecovery(
      'visual-contract-recovery',
      '商业候选的独立图片审查发现媒资规划重复，必须修订 visual contract',
    )
    const evolved = await beginProductProductionEvolutionV1({
      scope: visual.scope, productionId: visual.productionId,
      userText: '只重建十二项不可重复的媒资规划，保留剧情、任务和玩法。',
      affectedLanes: ['visual'],
    })
    const evolvedBriefRow = (await db.productProductionBriefs
      .where('[productionId+revision]').equals([visual.productionId, evolved.briefRevision]).first())!
    expect(parseProductProductionBriefV3(evolvedBriefRow.briefJson).evolution).toMatchObject({
      affectedLanes: ['visual'],
      base: {
        kind: 'recovery-build', buildNumber: 1,
        briefHash: visual.briefHash, planHash: visual.planHash,
        controlEpoch: visual.build.controlEpoch,
      },
    })
    const production = (await db.productProductions.get(visual.productionId))!
    const authorized = await executeProductProductionCommand({
      scope: visual.scope, productionId: visual.productionId,
      command: {
        type: 'authorize-start', commandId: 'visual-contract-recovery.restart',
        expectedStateRevision: production.stateRevision, briefRevision: evolved.briefRevision,
        briefHash: evolvedBriefRow.briefHash, authorizationNonce: 'visual-contract-recovery.restart-click',
      },
    })
    expect(authorized).toMatchObject({ ok: true, result: { buildNumber: 2 } })
    expect(await db.productBuilds.get(visual.build.id!)).toMatchObject({
      status: 'recovery-required', planHash: visual.planHash,
    })

    const preMediaContent = await prepareRecovery(
      'pre-media-content-recovery',
      '角色视觉锚点等待作者判断',
    )
    await db.productBuilds.update(preMediaContent.build.id!, {
      failureJson: canonicalProductProductionJsonV2({
        taskKey: 'media.anchor-author-gate', code: 'task-executor-failed', attempt: 1,
        detail: '[product-production-executor] 商业候选生成图片前需要作者明确确认角色视觉锚点',
      }),
    })
    const contentEvolution = await beginProductProductionEvolutionV1({
      scope: preMediaContent.scope, productionId: preMediaContent.productionId,
      userText: '作者发现正文在给出选项前已经执行了其中一个互斥行动；返修正文并让全部视觉需求跟随新正文重建。',
      affectedLanes: ['content', 'visual'],
    })
    const contentBrief = (await db.productProductionBriefs
      .where('[productionId+revision]').equals([
        preMediaContent.productionId, contentEvolution.briefRevision,
      ]).first())!
    const parsedContentBrief = parseProductProductionBriefV3(contentBrief.briefJson)
    expect(parsedContentBrief.evolution).toMatchObject({
      affectedLanes: ['content', 'visual'],
      base: { kind: 'recovery-build', buildNumber: 1 },
      userGoal: '作者发现正文在给出选项前已经执行了其中一个互斥行动；返修正文并让全部视觉需求跟随新正文重建。',
    })
    expect(parsedContentBrief.intent).toEqual(preMediaContent.brief.intent)
    expect(parsedContentBrief.source.startingPoint).toEqual(preMediaContent.brief.source.startingPoint)

    const preMediaWithImage = await prepareRecovery(
      'pre-media-content-recovery-after-image',
      '角色视觉锚点等待作者判断',
    )
    await db.productBuilds.update(preMediaWithImage.build.id!, {
      failureJson: canonicalProductProductionJsonV2({
        taskKey: 'media.anchor-author-gate', code: 'task-executor-failed', attempt: 1,
        detail: '[product-production-executor] 商业候选生成图片前需要作者明确确认角色视觉锚点',
      }),
    })
    await db.productBuildArtifacts.add({
      projectId: preMediaWithImage.scope.projectId, worldId: preMediaWithImage.scope.worldId,
      workId: preMediaWithImage.scope.workId, buildId: preMediaWithImage.build.id!,
      artifactKey: 'media.visual.001', requirementKey: null, version: 1, kind: 'image', mediaKind: 'cg',
      status: 'accepted', producerRunId: null, producerReceiptHash: null,
      controlEpoch: preMediaWithImage.build.controlEpoch, inputHash: 'a'.repeat(64),
      contentHash: 'b'.repeat(64), payloadJson: '{}', metadataJson: '{}', qualityJson: '{}',
      rightsJson: '{}', blobObjectId: null, mimeType: 'image/png', byteSize: 8,
      parentArtifactHash: null, carriedFrom: null, createdAt: Date.now(), updatedAt: Date.now(),
    })
    await expect(beginProductProductionEvolutionV1({
      scope: preMediaWithImage.scope, productionId: preMediaWithImage.productionId,
      userText: '错误地尝试在正式图片生成后冒用生成前正文返修通道。',
      affectedLanes: ['content', 'visual'],
    })).rejects.toThrow('已生成正式图片')

    const rejected = await prepareRecovery(
      'rejected-anchor-visual-recovery',
      '角色视觉锚点等待作者判断',
    )
    const supervisionTask = rejected.plan.tasks.find(task => task.taskKey === 'production.supervision')!
    const supervisionHash = await hashProductProductionValueV2({ accepted: true })
    await db.productBuildArtifacts.add({
      projectId: rejected.scope.projectId, worldId: rejected.scope.worldId, workId: rejected.scope.workId,
      buildId: rejected.build.id!, artifactKey: supervisionTask.outputArtifactKeys[0], requirementKey: null,
      version: 1, kind: 'product-design', mediaKind: null, status: 'accepted', producerRunId: null,
      producerReceiptHash: null, controlEpoch: rejected.build.controlEpoch, inputHash: 'a'.repeat(64),
      contentHash: supervisionHash, payloadJson: canonicalProductProductionJsonV2({ accepted: true }),
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null, mimeType: null,
      byteSize: 16, parentArtifactHash: null, carriedFrom: null, createdAt: Date.now(), updatedAt: Date.now(),
    } satisfies ProductBuildArtifactRecordV1)
    await db.productBuilds.update(rejected.build.id!, {
      failureJson: canonicalProductProductionJsonV2({
        taskKey: 'media.anchor-author-gate', code: 'task-executor-failed', attempt: 1,
        detail: '商业候选生成图片前需要作者明确确认角色视觉锚点',
      }),
    })
    const beforeReject = (await db.productProductions.get(rejected.productionId))!
    const cancelled = await executeProductProductionCommand({
      scope: rejected.scope, productionId: rejected.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'rejected-anchor.cancel',
        expectedStateRevision: beforeReject.stateRevision,
        blockerKey: 'media.anchor-author-gate',
        resolution: { action: 'cancel', note: '角色描述与冻结视觉锚点冲突，需要重建媒资规划。' },
      },
    })
    expect(cancelled).toMatchObject({ ok: true, result: { action: 'cancel' } })
    expect(await db.productProductions.get(rejected.productionId)).toMatchObject({ status: 'stopped' })
    expect(await db.productBuilds.get(rejected.build.id!)).toMatchObject({ status: 'cancelled' })
    const rejectedEvolution = await beginProductProductionEvolutionV1({
      scope: rejected.scope, productionId: rejected.productionId,
      userText: '只修订被作者退回的媒资规划与角色锚点绑定。', affectedLanes: ['visual'],
    })
    const rejectedBrief = (await db.productProductionBriefs
      .where('[productionId+revision]').equals([rejected.productionId, rejectedEvolution.briefRevision]).first())!
    expect(parseProductProductionBriefV3(rejectedBrief.briefJson).evolution).toMatchObject({
      affectedLanes: ['visual'],
      base: { kind: 'recovery-build', buildNumber: 1, controlEpoch: rejected.build.controlEpoch },
    })
    const rejectedProduction = (await db.productProductions.get(rejected.productionId))!
    await executeProductProductionCommand({
      scope: rejected.scope, productionId: rejected.productionId,
      command: {
        type: 'authorize-start', commandId: 'rejected-anchor.restart',
        expectedStateRevision: rejectedProduction.stateRevision,
        briefRevision: rejectedEvolution.briefRevision, briefHash: rejectedBrief.briefHash,
        authorizationNonce: 'rejected-anchor.restart-click',
      },
    })
    const rejectedChild = (await db.productBuilds
      .where('[productionId+buildNumber]').equals([rejected.productionId, 2]).first())!
    const evolvedRejectedBrief = parseProductProductionBriefV3(rejectedBrief.briefJson)
    await runProductProductionSchedulerCycleV1({
      scope: rejected.scope, productionId: rejected.productionId,
      capabilityBindings: evolvedRejectedBrief.capabilityRequirements.map(requirement => ({
        requirementKey: requirement.requirementKey,
        adapterId: `fixture.${requirement.mediaClass}`,
        bindingHash: 'f'.repeat(64),
      })),
      executor: async () => { throw new Error('fixture stops after rejected-anchor reuse materialization') },
    })
    expect(await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([rejectedChild.id!, supervisionTask.outputArtifactKeys[0]]).first())
      .toMatchObject({
        status: 'carried-forward', contentHash: supervisionHash, parentArtifactHash: supervisionHash,
      })

    const runtime = await prepareRecovery(
      'runtime-failure-no-visual-recovery',
      '运行包中的行动注册表缺少必需命令',
    )
    await expect(beginProductProductionEvolutionV1({
      scope: runtime.scope, productionId: runtime.productionId,
      userText: '尝试借视觉通道跳过运行包错误。', affectedLanes: ['visual'],
    })).rejects.toThrow('没有可验证的视觉合同或媒资质量阻断')
  })

  it('只允许文字冒险来源作者闸门接受产品私域补充，并冻结命令证据', async () => {
    const f = await fixture('text-adventure')
    const created = await executeProductProductionCommand({
      scope: f.scope,
      command: {
        type: 'create-intent', commandId: 'source-gate.intent', productionKey: 'source-gate-story',
        productType: 'text-adventure', worldReleaseId: f.worldReleaseId, userText: '制作完整文字冒险',
      },
    })
    const saved = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'save-brief-revision', commandId: 'source-gate.brief', expectedStateRevision: 0,
        parentRevision: null, brief: f.brief,
      },
    })
    await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'source-gate.start', expectedStateRevision: 1,
        briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'source-gate.click',
      },
    })
    const build = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
    await db.productBuilds.update(build.id!, {
      status: 'recovery-required',
      failureJson: JSON.stringify({
        taskKey: 'source.author-gate', code: 'task-executor-failed', attempt: 1,
        detail: '文字冒险来源需要作者明确接受产品私域补充清单',
      }),
    })
    const accepted = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'source-gate.accept', expectedStateRevision: 2,
        blockerKey: 'source.author-gate',
        resolution: { action: 'accept-product-private-expansion', note: '接受当前私域补充清单' },
      },
    })
    expect(accepted).toMatchObject({ ok: true, stateRevision: 3, result: { controlEpoch: 1 } })
    const resumed = (await db.productBuilds.get(build.id!))!
    expect(resumed).toMatchObject({ status: 'building', controlEpoch: 1 })
    expect(JSON.parse(resumed.failureJson)).toMatchObject({
      commandId: 'source-gate.accept', blockerKey: 'source.author-gate',
      resolution: { action: 'accept-product-private-expansion' },
      previousFailure: { taskKey: 'source.author-gate' },
    })

    await db.productBuilds.update(build.id!, {
      status: 'recovery-required',
      failureJson: JSON.stringify({ taskKey: 'content.design', code: 'task-executor-failed' }),
    })
    await db.productProductions.update(created.productionId, { stateRevision: 4 })
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'source-gate.reject', expectedStateRevision: 4,
        blockerKey: 'content.design',
        resolution: { action: 'accept-product-private-expansion', note: '不得用于普通 blocker' },
      },
    })).resolves.toMatchObject({ ok: false, errorCode: 'invalid-state-transition' })
  })

  it('只允许文字冒险美术作者闸门确认角色锚点，并把确认写入新 epoch 证据', async () => {
    const f = await fixture('text-adventure')
    const created = await executeProductProductionCommand({
      scope: f.scope,
      command: {
        type: 'create-intent', commandId: 'media-anchor.intent', productionKey: 'media-anchor-story',
        productType: 'text-adventure', worldReleaseId: f.worldReleaseId, userText: '制作带插图的文字冒险',
      },
    })
    const saved = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'save-brief-revision', commandId: 'media-anchor.brief', expectedStateRevision: 0,
        parentRevision: null, brief: f.brief,
      },
    })
    await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'authorize-start', commandId: 'media-anchor.start', expectedStateRevision: 1,
        briefRevision: 1, briefHash: saved.result.briefHash as string,
        authorizationNonce: 'media-anchor.click',
      },
    })
    const build = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
    await db.productBuilds.update(build.id!, {
      status: 'recovery-required',
      failureJson: JSON.stringify({
        taskKey: 'media.anchor-author-gate', code: 'task-executor-failed', attempt: 1,
        detail: '商业候选生成图片前需要作者明确确认角色视觉锚点',
      }),
    })
    const accepted = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'media-anchor.confirm', expectedStateRevision: 2,
        blockerKey: 'media.anchor-author-gate',
        resolution: { action: 'confirm-character-anchors', note: '已逐项核对并确认角色视觉锚点' },
      },
    })
    expect(accepted).toMatchObject({ ok: true, stateRevision: 3, result: { controlEpoch: 1 } })
    const resumed = (await db.productBuilds.get(build.id!))!
    expect(JSON.parse(resumed.failureJson)).toMatchObject({
      commandId: 'media-anchor.confirm', blockerKey: 'media.anchor-author-gate',
      resolution: { action: 'confirm-character-anchors' },
      previousFailure: { taskKey: 'media.anchor-author-gate' },
    })
    await db.productBuilds.update(build.id!, {
      status: 'recovery-required',
      failureJson: JSON.stringify({ taskKey: 'media.visual.001', code: 'task-executor-failed' }),
    })
    await db.productProductions.update(created.productionId, { stateRevision: 4 })
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'media-anchor.reject', expectedStateRevision: 4,
        blockerKey: 'media.visual.001',
        resolution: { action: 'confirm-character-anchors', note: '不能用于普通图片任务' },
      },
    })).resolves.toMatchObject({ ok: false, errorCode: 'invalid-state-transition' })
  })

  it('把图片锁定派生为不可变子 Build，并拒绝锁定素材绕过解锁直接重生成', async () => {
    const f = await completedTextAdventureMediaFixture()
    const before = await db.productBuilds.get(f.build.id!)
    const target = (await db.productBuildArtifacts.where('buildId').equals(f.build.id!).toArray())
      .find(row => row.artifactKey === 'media.visual.001')!
    const locked = await executeProductProductionCommand({
      scope: f.scope, productionId: f.productionId,
      command: {
        type: 'revise-media-asset', commandId: 'media-revision.lock', expectedStateRevision: 2,
        buildNumber: 1, artifactKey: target.artifactKey, expectedArtifactHash: target.contentHash,
        action: 'lock', replacement: null,
      },
    })
    expect(locked).toMatchObject({
      ok: true, stateRevision: 3,
      result: { action: 'lock', parentBuildNumber: 1, buildNumber: 2 },
    })
    expect(await db.productBuilds.get(f.build.id!)).toEqual(before)
    const child = await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, 2]).first()
    expect(child).toMatchObject({ parentBuildNumber: 1, status: 'building', controlEpoch: 1, planRevision: 1 })
    const childPlan = parseProductProductionPlanV3(child!.planJson, f.brief, child!.briefHash)
    expect(childPlan.tasks.find(task => task.taskKey === 'media.visual.001')).toMatchObject({
      executionMode: 'human-import', skillId: null,
      budgetReservation: expect.objectContaining({ mediaCalls: 0, storageBytes: 0 }),
    })
    expect(childPlan.tasks.find(task => task.taskKey === 'media.visual.002')?.reuse).not.toBeNull()
    expect(childPlan.tasks.find(task => task.taskKey === 'media.audit')?.reuse).toBeNull()
    expect(childPlan.tasks.find(task => task.taskKey === 'integration.package')?.reuse).toBeNull()
    expect(childPlan.tasks.find(task => task.taskKey === 'qa.autoplay')?.reuse).toBeNull()
    expect(childPlan.tasks.find(task => task.taskKey === 'qa.release')?.reuse).toBeNull()
    const childTarget = (await db.productBuildArtifacts.where('buildId').equals(child!.id!).toArray())
      .find(row => row.artifactKey === 'media.visual.001')!
    expect(childTarget).toMatchObject({
      contentHash: target.contentHash, blobObjectId: target.blobObjectId,
      parentArtifactHash: target.contentHash, status: 'accepted', producerRunId: null,
    })
    expect(JSON.parse(childTarget.metadataJson)).toMatchObject({
      authorRevision: { action: 'lock', locked: true, parentBuildNumber: 1 },
    })
    const carriedImage = (await db.productBuildArtifacts.where('buildId').equals(child!.id!).toArray())
      .find(row => row.artifactKey === 'media.visual.002')!
    const parentCarriedImage = (await db.productBuildArtifacts.where('buildId').equals(f.build.id!).toArray())
      .find(row => row.artifactKey === 'media.visual.002')!
    expect(carriedImage).toMatchObject({
      status: 'carried-forward', contentHash: target.contentHash, blobObjectId: target.blobObjectId,
      parentArtifactHash: target.contentHash,
    })
    expect(JSON.parse(carriedImage.payloadJson)).toMatchObject({
      assetKey: 'media-revision-story.build-2.media.visual.002',
    })
    expect(JSON.parse(carriedImage.metadataJson)).toMatchObject({
      assetKey: 'media-revision-story.build-2.media.visual.002',
    })
    expect(carriedImage.inputHash).not.toBe(parentCarriedImage.inputHash)

    const executorCalls: string[] = []
    await runProductProductionSchedulerCycleV1({
      scope: f.scope, productionId: f.productionId,
      capabilityBindings: f.capabilityBindings,
      executor: async input => {
        executorCalls.push(input.task.taskKey)
        throw new Error('fixture stops after zero-provider human-import receipt')
      },
    })
    expect(executorCalls).toEqual(['media.audit'])
    const targetRun = (await db.agentRuns.where('productBuildId').equals(child!.id!).toArray())
      .find(row => JSON.parse(row.contractJson).scope?.productProduction?.taskKey === 'media.visual.001')
    expect(targetRun).toMatchObject({ status: 'completed', terminalReceiptHash: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(await db.productBuildArtifacts.get(childTarget.id!)).toMatchObject({
      // The human-import Run signs the current epoch carry in the ledger. It
      // does not launder authorship of immutable bytes onto the Artifact.
      producerRunId: null, producerReceiptHash: null,
    })

    await db.productBuilds.update(child!.id!, { status: 'preview-ready' })
    await db.productProductions.update(f.productionId, { status: 'preview-ready' })
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: f.productionId,
      command: {
        type: 'revise-media-asset', commandId: 'media-revision.regenerate-locked', expectedStateRevision: 3,
        buildNumber: 2, artifactKey: childTarget.artifactKey, expectedArtifactHash: childTarget.contentHash,
        action: 'regenerate', repairFeedback: {
          sourceGateReceiptHash: '1'.repeat(64), sourceEvidenceHash: '2'.repeat(64),
          priorContentHash: childTarget.contentHash, note: '锁定图片不得绕过解锁返修',
        }, replacement: null,
      },
    })).resolves.toMatchObject({ ok: false, errorCode: 'media-revision-invalid' })
    expect(await db.productBuilds.where('productionId').equals(f.productionId).count()).toBe(2)
  })

  it('校验作者上传图片的 Blob 与权利合同，并在新 Build 保存可追溯替换', async () => {
    const f = await completedTextAdventureMediaFixture()
    const target = (await db.productBuildArtifacts.where('buildId').equals(f.build.id!).toArray())
      .find(row => row.artifactKey === 'media.visual.001')!
    const replacementBlob = await putMediaBlobObject({
      scope: f.scope, data: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]).buffer,
      mimeType: 'image/webp',
    })
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: f.productionId,
      command: {
        type: 'revise-media-asset', commandId: 'media-revision.bad-mime', expectedStateRevision: 2,
        buildNumber: 1, artifactKey: target.artifactKey, expectedArtifactHash: target.contentHash,
        action: 'upload-replacement', replacement: {
          blobObjectId: replacementBlob.id!, contentHash: replacementBlob.contentHash,
          mimeType: 'image/gif', byteSize: replacementBlob.byteSize, width: 1280, height: 720,
          altText: '作者替换图', license: 'author-license', commercialUse: true,
          redistribution: true, declaration: '拥有完整权利', attribution: '无需署名',
        },
      },
    })).rejects.toThrow(/mimeType|枚举/)
    expect(await db.productBuilds.where('productionId').equals(f.productionId).count()).toBe(1)

    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: f.productionId,
      command: {
        type: 'revise-media-asset', commandId: 'media-revision.bad-dimensions', expectedStateRevision: 2,
        buildNumber: 1, artifactKey: target.artifactKey, expectedArtifactHash: target.contentHash,
        action: 'upload-replacement', replacement: {
          blobObjectId: replacementBlob.id!, contentHash: replacementBlob.contentHash,
          mimeType: 'image/webp', byteSize: replacementBlob.byteSize, width: 1024, height: 576,
          altText: '作者替换图', license: 'author-license', commercialUse: true,
          redistribution: true, declaration: '拥有完整权利', attribution: '无需署名',
        },
      },
    })).resolves.toMatchObject({ ok: false, errorCode: 'media-revision-invalid' })
    expect(await db.productBuilds.where('productionId').equals(f.productionId).count()).toBe(1)

    const receipt = await executeProductProductionCommand({
      scope: f.scope, productionId: f.productionId,
      command: {
        type: 'revise-media-asset', commandId: 'media-revision.upload', expectedStateRevision: 2,
        buildNumber: 1, artifactKey: target.artifactKey, expectedArtifactHash: target.contentHash,
        action: 'upload-replacement', replacement: {
          blobObjectId: replacementBlob.id!, contentHash: replacementBlob.contentHash,
          mimeType: 'image/webp', byteSize: replacementBlob.byteSize, width: 1280, height: 720,
          altText: '作者绘制的雾港潮门', license: 'author-community-v1', commercialUse: true,
          redistribution: true, declaration: '作者确认拥有完整权利', attribution: '作者甲',
        },
      },
    })
    expect(receipt).toMatchObject({ ok: true, result: { parentBuildNumber: 1, buildNumber: 2 } })
    const child = await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, 2]).first()
    const replacement = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([child!.id!, target.artifactKey]).first()
    expect(replacement).toMatchObject({
      status: 'accepted', contentHash: replacementBlob.contentHash,
      blobObjectId: replacementBlob.id, mimeType: 'image/webp', byteSize: replacementBlob.byteSize,
      parentArtifactHash: target.contentHash,
    })
    expect(JSON.parse(replacement!.metadataJson)).toMatchObject({
      source: 'author-upload', width: 1280, height: 720,
      altText: '作者绘制的雾港潮门', license: 'author-community-v1',
      authorRevision: { action: 'upload-replacement', priorContentHash: target.contentHash },
    })
    expect(JSON.parse(replacement!.rightsJson)).toEqual({
      origin: 'author-upload', license: 'author-community-v1', commercialUse: true,
      redistribution: true, declaration: '作者确认拥有完整权利', attribution: '作者甲',
    })
    expect(await db.productBuildArtifacts.get(target.id!)).toMatchObject({
      contentHash: target.contentHash, blobObjectId: target.blobObjectId, status: 'accepted',
    })
  })

  it('只允许按 Visual QA 退回证据批量返修，并把逐图建议送入新 Build 的图片任务', async () => {
    const f = await completedTextAdventureMediaFixture()
    const artifacts = await db.productBuildArtifacts.where('buildId').equals(f.build.id!).toArray()
    const rejected = artifacts.find(row => row.artifactKey === 'media.visual.001')!
    const accepted = artifacts.find(row => row.artifactKey === 'media.visual.002')!
    const reviewArtifact = artifacts.find(row => row.artifactKey === 'quality.visual-review')!
    const reviewPayload = {
      schema: 'storyforge.text-adventure-visual-quality-review-artifact', version: 1,
      buildNumber: 1, mediaAuditHash: 'a'.repeat(64), status: 'revision-required',
      reviews: [
        {
          artifactKey: rejected.artifactKey, contentHash: rejected.contentHash, verdict: 'replace',
          scores: {
            requirementFit: 2, identityContinuity: 3, styleContinuity: 4,
            composition: 3, technicalCleanliness: 1,
          },
          issues: [{
            severity: 'blocking', category: 'text', detail: '画面出现不可读伪文字',
            recommendation: '移除全部字符、标牌和类似字形的纹理',
          }],
          reviewSource: 'multimodal-model',
        },
        {
          artifactKey: accepted.artifactKey, contentHash: accepted.contentHash, verdict: 'accept',
          scores: {
            requirementFit: 5, identityContinuity: 5, styleContinuity: 5,
            composition: 5, technicalCleanliness: 5,
          },
          issues: [], reviewSource: 'multimodal-model',
        },
      ],
      blockingIssueCount: 1, providerReviewCompleted: true,
    }
    const reviewPayloadJson = canonicalProductProductionJsonV2(reviewPayload)
    const reviewHash = await hashProductProductionValueV2(reviewPayload)
    await db.productBuildArtifacts.update(reviewArtifact.id!, {
      payloadJson: reviewPayloadJson, contentHash: reviewHash,
    })
    await db.productBuilds.update(f.build.id!, {
      status: 'recovery-required',
      failureJson: canonicalProductProductionJsonV2({
        taskKey: 'integration.package', code: 'task-executor-failed', attempt: 1,
        detail: '商业候选的独立图片审查未通过:revision-required',
      }),
    })
    await db.productProductions.update(f.productionId, { status: 'producing' })

    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: f.productionId,
      command: {
        type: 'revise-media-assets', commandId: 'visual-repair.accepted-must-fail',
        expectedStateRevision: 2, buildNumber: 1, action: 'regenerate',
        targets: [{ artifactKey: accepted.artifactKey, expectedArtifactHash: accepted.contentHash }],
      },
    })).resolves.toMatchObject({ ok: false, errorCode: 'media-revision-invalid' })

    const repaired = await executeProductProductionCommand({
      scope: f.scope, productionId: f.productionId,
      command: {
        type: 'revise-media-assets', commandId: 'visual-repair.rejected',
        expectedStateRevision: 2, buildNumber: 1, action: 'regenerate',
        targets: [{ artifactKey: rejected.artifactKey, expectedArtifactHash: rejected.contentHash }],
      },
    })
    expect(repaired).toMatchObject({
      ok: true, stateRevision: 3,
      result: {
        action: 'regenerate', artifactKeys: [rejected.artifactKey],
        parentBuildNumber: 1, buildNumber: 2,
      },
    })
    const child = await db.productBuilds.where('[productionId+buildNumber]').equals([f.productionId, 2]).first()
    const childPlan = parseProductProductionPlanV3(child!.planJson, f.brief, child!.briefHash)
    expect(childPlan.tasks.find(task => task.taskKey === 'media.repair-feedback')).toMatchObject({
      executionMode: 'human-import', outputArtifactKeys: ['media.repair-feedback'],
      acceptanceGateIds: ['artifact.protocol', 'media.visual-repair-feedback'],
    })
    expect(childPlan.tasks.find(task => task.taskKey === rejected.artifactKey)).toMatchObject({
      executionMode: 'media-provider',
      dependsOn: expect.arrayContaining(['media.repair-feedback']),
      inputArtifactKeys: expect.arrayContaining(['media.repair-feedback']),
      reuse: null,
    })
    expect(childPlan.tasks.find(task => task.taskKey === accepted.artifactKey)?.reuse).not.toBeNull()
    expect(childPlan.tasks.find(task => task.kind === 'text-adventure-visual-quality-review-batch'))
      .toMatchObject({
        dependsOn: expect.arrayContaining(['media.repair-feedback']),
        inputArtifactKeys: expect.arrayContaining(['media.repair-feedback']),
      })
    const feedback = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([child!.id!, 'media.repair-feedback']).first()
    expect(feedback).toMatchObject({
      status: 'accepted', kind: 'integration-report', parentArtifactHash: reviewHash,
    })
    expect(JSON.parse(feedback!.payloadJson)).toMatchObject({
      sourceBuildNumber: 1, sourceReviewArtifactHash: reviewHash,
      sourceReview: reviewPayload,
      targets: [{
        artifactKey: rejected.artifactKey, priorContentHash: rejected.contentHash,
        verdict: 'replace',
        issues: [{ detail: '画面出现不可读伪文字', recommendation: '移除全部字符、标牌和类似字形的纹理' }],
      }],
    })
  })

  it('拒绝手工拼装但未通过完整 Build/Preview/Audit/Blob 闭包复验的作者退回回执', async () => {
    const f = await completedTextAdventureMediaFixture()
    const target = (await db.productBuildArtifacts.where('buildId').equals(f.build.id!).toArray())
      .find(row => row.artifactKey === 'media.visual.001')!
    const targetMetadata = JSON.parse(target.metadataJson) as { assetKey: string }
    const note = '人物面部与已确认锚点不一致；保留服装与构图，重做五官和年龄特征。'
    const evidence = {
      schema: 'storyforge.text-adventure-human-visual-review-evidence' as const,
      version: 1 as const, buildNumber: f.build.buildNumber,
      packageHash: '3'.repeat(64), previewHash: '4'.repeat(64), briefHash: f.build.briefHash,
      mediaAuditHash: '5'.repeat(64), visualReviewHash: '6'.repeat(64),
      assets: [{
        assetKey: targetMetadata.assetKey, artifactKey: target.artifactKey,
        contentHash: target.contentHash, blobContentHash: target.contentHash,
        mimeType: target.mimeType!, decision: 'rejected' as const, note,
      }],
      confirmedAt: Date.now(), passed: false,
    }
    const evidenceHash = await hashProductProductionValueV2(evidence)
    const receiptBody = {
      schema: 'storyforge.product-quality-gate-receipt' as const, version: 1 as const,
      gateId: 'text-adventure.visual.author-approval', gateVersion: '1',
      verifierId: 'storyforge.author-visual-confirmation', verifierVersion: '1',
      verifierKind: 'human-evidence' as const,
      inputHashes: [target.contentHash], environmentHash: null,
      measuredJson: canonicalProductProductionJsonV2(evidence), status: 'failed' as const,
      thresholdProfileId: 'storyforge.text-adventure-human-visual-review.v1',
      thresholdProfileVersion: '1', evidenceRefs: [target.contentHash], createdAt: evidence.confirmedAt,
    }
    const receiptHash = await hashProductProductionValueV2(receiptBody)
    const receipt = { ...receiptBody, receiptHash }
    await db.productQualityGateReceipts.add({
      projectId: f.scope.projectId, worldId: f.scope.worldId, workId: f.scope.workId,
      buildId: f.build.id!, gateId: receipt.gateId, gateVersion: receipt.gateVersion,
      verifierId: receipt.verifierId, verifierVersion: receipt.verifierVersion,
      status: receipt.status, receiptJson: canonicalProductProductionJsonV2(receipt),
      receiptHash, createdAt: receipt.createdAt,
    })

    const repaired = await executeProductProductionCommand({
      scope: f.scope, productionId: f.productionId,
      command: {
        type: 'revise-media-asset', commandId: 'author-visual-repair.rejected',
        expectedStateRevision: 2, buildNumber: 1,
        artifactKey: target.artifactKey, expectedArtifactHash: target.contentHash,
        action: 'regenerate', repairFeedback: {
          sourceGateReceiptHash: receiptHash, sourceEvidenceHash: evidenceHash,
          priorContentHash: target.contentHash, note,
        }, replacement: null,
      },
    })
    expect(repaired).toMatchObject({ ok: false, errorCode: 'media-revision-invalid' })
    expect(await db.productBuilds.where('productionId').equals(f.productionId).count()).toBe(1)
  })

  it('只把 recordTextAdventureHumanVisualReviewV1 冻结并严格复验的退回决定送入单图重生成', async () => {
    const seeded = await seedTextAdventureMediaRevisionWorkbenchV1(STRICT_VISUAL_REVIEW_PNG_BASE64)
    const build = (await db.productBuilds.get(seeded.parentBuildId))!
    const images = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
      .filter(row => row.kind === 'image').sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
    const target = images[0]
    const targetAssetKey = String((JSON.parse(target.metadataJson) as Record<string, unknown>).assetKey)
    const note = '人物面部与已确认锚点不一致；保留服装与构图，重做五官和年龄特征。'
    const gate = await recordTextAdventureHumanVisualReviewV1({
      scope: seeded.scope,
      productBuildId: build.id!,
      decisions: images.map(image => ({
        assetKey: String((JSON.parse(image.metadataJson) as Record<string, unknown>).assetKey),
        decision: image.id === target.id ? 'rejected' as const : 'approved' as const,
        note: image.id === target.id ? note : '当前图片可接受。',
      })),
    })
    expect(gate.gateReceipt.status).toBe('failed')
    expect(gate.evidence.assets.find(asset => asset.assetKey === targetAssetKey)).toMatchObject({
      artifactKey: target.artifactKey, contentHash: target.contentHash, decision: 'rejected', note,
    })
    const production = (await db.productProductions.get(seeded.productionId))!
    const repaired = await executeProductProductionCommand({
      scope: seeded.scope,
      productionId: seeded.productionId,
      command: {
        type: 'revise-media-asset', commandId: 'author-visual-repair.strict-receipt',
        expectedStateRevision: production.stateRevision,
        buildNumber: build.buildNumber,
        artifactKey: target.artifactKey,
        expectedArtifactHash: target.contentHash,
        action: 'regenerate',
        repairFeedback: {
          sourceGateReceiptHash: gate.gateReceipt.receiptHash,
          sourceEvidenceHash: await hashProductProductionValueV2(gate.evidence),
          priorContentHash: target.contentHash,
          note,
        },
        replacement: null,
      },
    })
    expect(repaired).toMatchObject({
      ok: true,
      result: { action: 'regenerate', parentBuildNumber: 1, buildNumber: 2 },
    })
    const child = await db.productBuilds
      .where('[productionId+buildNumber]').equals([seeded.productionId, 2]).first()
    const feedback = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([child!.id!, 'media.repair-feedback']).first()
    expect(feedback).toMatchObject({
      status: 'accepted', kind: 'integration-report',
      parentArtifactHash: gate.gateReceipt.receiptHash, carriedFrom: null,
    })
    expect(JSON.parse(feedback!.payloadJson)).toMatchObject({
      schema: 'storyforge.text-adventure-visual-repair-feedback', sourceBuildNumber: 1,
      sourceReview: {
        gateReceiptHash: gate.gateReceipt.receiptHash,
        evidence: gate.evidence,
      },
      targets: [{
        artifactKey: target.artifactKey, priorContentHash: target.contentHash,
        verdict: 'human-review',
        issues: [{ severity: 'blocking', category: 'author-direction', detail: note, recommendation: note }],
      }],
    })
  })

  it('单图重生成拒绝伪造回执、缺失回执、旧 Build、旧图片 hash 与缺失图片', async () => {
    const seeded = await seedTextAdventureMediaRevisionWorkbenchV1(STRICT_VISUAL_REVIEW_PNG_BASE64)
    const build = (await db.productBuilds.get(seeded.parentBuildId))!
    const images = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
      .filter(row => row.kind === 'image').sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
    const target = images[0]
    const note = '角色身份特征与锚点不一致，需要定向重做。'
    const gate = await recordTextAdventureHumanVisualReviewV1({
      scope: seeded.scope,
      productBuildId: build.id!,
      decisions: images.map(image => ({
        assetKey: String((JSON.parse(image.metadataJson) as Record<string, unknown>).assetKey),
        decision: image.id === target.id ? 'rejected' as const : 'approved' as const,
        note: image.id === target.id ? note : '',
      })),
    })
    const production = (await db.productProductions.get(seeded.productionId))!
    const evidenceHash = await hashProductProductionValueV2(gate.evidence)
    const command = (commandId: string, overrides: Record<string, unknown> = {}) => ({
      type: 'revise-media-asset' as const,
      commandId,
      expectedStateRevision: production.stateRevision,
      buildNumber: build.buildNumber,
      artifactKey: target.artifactKey,
      expectedArtifactHash: target.contentHash,
      action: 'regenerate' as const,
      repairFeedback: {
        sourceGateReceiptHash: gate.gateReceipt.receiptHash,
        sourceEvidenceHash: evidenceHash,
        priorContentHash: target.contentHash,
        note,
      },
      replacement: null,
      ...overrides,
    })

    await expect(executeProductProductionCommand({
      scope: seeded.scope, productionId: seeded.productionId,
      command: command('strict-negative.missing', {
        repairFeedback: {
          sourceGateReceiptHash: 'f'.repeat(64), sourceEvidenceHash: evidenceHash,
          priorContentHash: target.contentHash, note,
        },
      }),
    })).resolves.toMatchObject({ ok: false, errorCode: 'media-revision-invalid' })

    await expect(executeProductProductionCommand({
      scope: seeded.scope, productionId: seeded.productionId,
      command: command('strict-negative.old-hash', {
        expectedArtifactHash: 'e'.repeat(64),
        repairFeedback: {
          sourceGateReceiptHash: gate.gateReceipt.receiptHash, sourceEvidenceHash: evidenceHash,
          priorContentHash: 'e'.repeat(64), note,
        },
      }),
    })).resolves.toMatchObject({ ok: false, errorCode: 'source-stale' })

    const receiptRow = (await db.productQualityGateReceipts.get(gate.row.id!))!
    const forgedHash = 'd'.repeat(64)
    await db.productQualityGateReceipts.add({
      ...receiptRow, id: undefined, receiptHash: forgedHash,
    })
    await expect(executeProductProductionCommand({
      scope: seeded.scope, productionId: seeded.productionId,
      command: command('strict-negative.forged', {
        repairFeedback: {
          sourceGateReceiptHash: forgedHash, sourceEvidenceHash: evidenceHash,
          priorContentHash: target.contentHash, note,
        },
      }),
    })).resolves.toMatchObject({ ok: false, errorCode: 'media-revision-invalid' })

    await db.productQualityGateReceipts.update(gate.row.id!, { buildId: build.id! + 10_000 })
    await expect(executeProductProductionCommand({
      scope: seeded.scope, productionId: seeded.productionId,
      command: command('strict-negative.old-build'),
    })).resolves.toMatchObject({ ok: false, errorCode: 'media-revision-invalid' })
    await db.productQualityGateReceipts.update(gate.row.id!, { buildId: build.id! })

    await db.productBuildArtifacts.delete(target.id!)
    await expect(executeProductProductionCommand({
      scope: seeded.scope, productionId: seeded.productionId,
      command: command('strict-negative.missing-image'),
    })).resolves.toMatchObject({ ok: false, errorCode: 'media-revision-invalid' })
    expect(await db.productBuilds.where('productionId').equals(seeded.productionId).count()).toBe(1)
  })
})
