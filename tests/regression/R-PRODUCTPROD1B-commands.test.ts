import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

async function fixture(productType: 'avg' | 'text-adventure' = 'avg') {
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
    visualLevel: 'none',
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
})
