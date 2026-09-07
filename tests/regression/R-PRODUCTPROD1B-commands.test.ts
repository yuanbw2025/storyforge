import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionPlanV3, parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { putMediaBlobObject } from '../../src/lib/product-production/media-blob-store'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import type { ProductBuildArtifactRecordV1 } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

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
  return { ...f, productionId: created.productionId, build, plan, blob }
}

describe('PRODUCTPROD-1B · user command control plane', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

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
    expect(await db.productBuilds.where('productionId').equals(created.productionId).first()).toMatchObject({ status: 'paused', controlEpoch: 1 })

    const resumed = await executeProductProductionCommand({
      scope: f.scope, productionId: created.productionId,
      command: { type: 'resume', commandId: 'resume-1', expectedStateRevision: 3 },
    })
    expect(resumed).toMatchObject({ ok: true, stateRevision: 4, result: { controlEpoch: 2, restored: 'authorized' } })

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
      capabilityBindings: f.brief.capabilityRequirements.map(requirement => ({
        requirementKey: requirement.requirementKey,
        adapterId: `fixture.${requirement.mediaClass}`,
        bindingHash: 'f'.repeat(64),
      })),
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
      producerRunId: targetRun!.id, producerReceiptHash: targetRun!.terminalReceiptHash,
    })

    await db.productBuilds.update(child!.id!, { status: 'preview-ready' })
    await db.productProductions.update(f.productionId, { status: 'preview-ready' })
    await expect(executeProductProductionCommand({
      scope: f.scope, productionId: f.productionId,
      command: {
        type: 'revise-media-asset', commandId: 'media-revision.regenerate-locked', expectedStateRevision: 3,
        buildNumber: 2, artifactKey: childTarget.artifactKey, expectedArtifactHash: childTarget.contentHash,
        action: 'regenerate', replacement: null,
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
})
