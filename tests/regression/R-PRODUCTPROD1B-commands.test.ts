import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import {
  ProductProductionDraftRejectedErrorV1,
  runProductProductionUntilBlockedV1,
} from '../../src/lib/product-production/scheduler'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

async function fixture() {
  const owned = await seedCurrentProductWorld('PRODUCTPROD commands')
  const worldReleaseId = owned.release.id!
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId })
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope,
    worldReleaseId,
    suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'avg',
    scale: 'scene',
    visualLevel: 'none',
    audioLevel: 'none',
    playerRole: '扮演林舟',
    openingSituation: '在潮门关闭前作出选择。',
    coreExperience: ['选择与后果'],
    requiredFacts: ['潮门只在满月开启'],
    forbiddenChanges: ['不得改写冻结世界'],
    contentBoundaries: ['不含露骨内容'],
    tone: ['克制', '紧张'],
  })
  return { ...owned, worldReleaseId, brief }
}

async function recoverableFixture(key: string, options: { durableFailure?: boolean } = {}) {
  const f = await fixture()
  const created = await executeProductProductionCommand({
    scope: f.scope,
    command: {
      type: 'create-intent', commandId: `${key}.intent`, productionKey: key,
      productType: 'avg', worldReleaseId: f.worldReleaseId, userText: '恢复边界测试',
    },
  })
  const saved = await executeProductProductionCommand({
    scope: f.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: `${key}.brief`, expectedStateRevision: 0,
      parentRevision: null, brief: f.brief,
    },
  })
  await executeProductProductionCommand({
    scope: f.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: `${key}.start`, expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: `${key}.click`,
    },
  })
  const build = (await db.productBuilds.where('productionId').equals(created.productionId).first())!
  const plan = await createProductProductionPlanV3({
    brief: f.brief,
    briefHash: saved.result.briefHash as string,
    buildNumber: build.buildNumber,
    controlEpoch: build.controlEpoch,
  })
  const planHash = await hashProductProductionValueV2(plan)
  if (options.durableFailure) {
    await db.productBuilds.update(build.id!, {
      planJson: JSON.stringify(plan), planHash, failureJson: '{}',
    })
    await runProductProductionUntilBlockedV1({
      scope: f.scope,
      productionId: created.productionId,
      suppliedPlan: plan,
      capabilityBindings: [{
        requirementKey: f.brief.capabilityRequirements[0].requirementKey,
        adapterId: 'configured-text-provider.v1',
        bindingHash: 'a'.repeat(64),
      }],
      executor: async () => {
        throw new ProductProductionDraftRejectedErrorV1('候选需要作者修订', {
          modelCalls: 1, inputTokens: 10, outputTokens: 10, mediaCalls: 0,
          costUsd: 0, durationMs: 1, storageBytes: 0,
        })
      },
    })
    const failedBuild = (await db.productBuilds.get(build.id!))!
    return {
      ...f,
      productionId: created.productionId,
      buildId: build.id!,
      failureJson: failedBuild.failureJson,
    }
  }
  const failureJson = JSON.stringify({
    taskKey: 'content.design', code: 'task-draft-rejected', attempt: 1,
  })
  await db.productBuilds.update(build.id!, {
    status: 'recovery-required', planJson: JSON.stringify(plan), planHash, failureJson,
  })
  return { ...f, productionId: created.productionId, buildId: build.id!, failureJson }
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

  it('只允许 resolve-blocker 命中数据库当前失败任务，拒绝把修复说明延迟注入后续任务', async () => {
    const f = await recoverableFixture('recovery-task-binding')
    for (const [index, action] of (['retry', 'change-capability', 'author-edit'] as const).entries()) {
      const receipt = await executeProductProductionCommand({
        scope: f.scope, productionId: f.productionId,
        command: {
          type: 'resolve-blocker', commandId: `wrong-blocker.${index}`,
          expectedStateRevision: 2, blockerKey: 'content.narrative',
          resolution: {
            action,
            note: '这段说明绝不能进入未来任务',
            ...(action === 'author-edit' ? { authorDraftJson: '{"draft":"forged"}' } : {}),
          },
        },
      })
      expect(receipt).toMatchObject({ ok: false, errorCode: 'invalid-state-transition', stateRevision: 2 })
    }
    expect(await db.productBuilds.get(f.buildId)).toMatchObject({
      status: 'recovery-required', controlEpoch: 0, failureJson: f.failureJson,
    })
  })

  it('legacy blocker 只兼容普通重试，不允许无 failureProvenance 的作者完整 JSON', async () => {
    const legacy = await recoverableFixture('recovery-legacy-boundary')
    const rejected = await executeProductProductionCommand({
      scope: legacy.scope,
      productionId: legacy.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'legacy-author-edit.rejected',
        expectedStateRevision: 2,
        blockerKey: 'content.design',
        resolution: { action: 'author-edit', note: '旧 blocker 作者稿', authorDraftJson: '{"legacy":true}' },
      },
    })
    expect(rejected).toMatchObject({ ok: false, errorCode: 'invalid-state-transition', stateRevision: 2 })
    expect(await db.productBuilds.get(legacy.buildId)).toMatchObject({
      status: 'recovery-required', controlEpoch: 0, failureJson: legacy.failureJson,
    })

    await expect(executeProductProductionCommand({
      scope: legacy.scope,
      productionId: legacy.productionId,
      command: {
        type: 'resolve-blocker',
        commandId: 'legacy-retry.accepted',
        expectedStateRevision: 2,
        blockerKey: 'content.design',
        resolution: { action: 'retry', note: '仅保留普通重试兼容' },
      },
    })).resolves.toMatchObject({ ok: true, stateRevision: 3, result: { controlEpoch: 1 } })
  })

  it('作者修订命令在写入 resolved directive 前校验精确 Run、epoch、Plan 与 attempt', async () => {
    const current = await recoverableFixture('recovery-provenance-command', { durableFailure: true })
    const pristine = JSON.parse(current.failureJson)
    const corruptions: Array<[string, (value: typeof pristine) => void]> = [
      ['runId', value => { value.failureProvenance.runId += 999_999 }],
      ['controlEpoch', value => { value.failureProvenance.controlEpoch += 1 }],
      ['planHash', value => { value.failureProvenance.planHash = 'b'.repeat(64) }],
      ['attempt', value => { value.failureProvenance.attempt += 1 }],
    ]
    for (const [label, corrupt] of corruptions) {
      const failure = structuredClone(pristine)
      corrupt(failure)
      await db.productBuilds.update(current.buildId, { failureJson: JSON.stringify(failure) })
      const receipt = await executeProductProductionCommand({
        scope: current.scope,
        productionId: current.productionId,
        command: {
          type: 'resolve-blocker',
          commandId: `recovery-provenance-command.${label}`,
          expectedStateRevision: 2,
          blockerKey: 'content.design',
          resolution: { action: 'author-edit', note: label, authorDraftJson: '{"fixed":true}' },
        },
      })
      expect(receipt, label).toMatchObject({
        ok: false, errorCode: 'invalid-state-transition', stateRevision: 2,
      })
    }
    await db.productBuilds.update(current.buildId, { failureJson: current.failureJson })
  })

  it('接受合同上限内的大型作者 JSON，并在超限时保持恢复状态不变', async () => {
    const accepted = await recoverableFixture('recovery-large-draft', { durableFailure: true })
    const authorDraftJson = JSON.stringify({ body: '潮'.repeat(119_000) })
    await expect(executeProductProductionCommand({
      scope: accepted.scope, productionId: accepted.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'large-draft.accepted',
        expectedStateRevision: 2, blockerKey: 'content.design',
        resolution: { action: 'author-edit', note: '作者完整修订', authorDraftJson },
      },
    })).resolves.toMatchObject({ ok: true, stateRevision: 3 })
    const acceptedBuild = (await db.productBuilds.get(accepted.buildId))!
    expect(acceptedBuild).toMatchObject({ status: 'building', controlEpoch: 1 })
    expect(acceptedBuild.failureJson.length).toBeGreaterThan(100_000)

    const rejected = await recoverableFixture('recovery-oversize-draft', { durableFailure: true })
    const oversizedJson = JSON.stringify({ body: '潮'.repeat(120_000) })
    await expect(executeProductProductionCommand({
      scope: rejected.scope, productionId: rejected.productionId,
      command: {
        type: 'resolve-blocker', commandId: 'large-draft.rejected',
        expectedStateRevision: 2, blockerKey: 'content.design',
        resolution: { action: 'author-edit', note: '超限修订', authorDraftJson: oversizedJson },
      },
    })).rejects.toThrow(/authorDraftJson/)
    expect(await db.productBuilds.get(rejected.buildId)).toMatchObject({
      status: 'recovery-required', controlEpoch: 0, failureJson: rejected.failureJson,
    })
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
})
