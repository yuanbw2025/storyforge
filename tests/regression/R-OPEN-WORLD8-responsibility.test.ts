import { beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import type { ProductProductionPlanV3 } from '../../src/lib/types'
import type { ProductProductionSchedulerProjectionV1 } from '../../src/lib/product-production/scheduler'
import type { TextOpenWorldArtifactGovernanceProjectionV1 } from '../../src/lib/open-world/creator-artifact-governance'
import {
  createTextOpenWorldResponsibilityMatrixV1,
  textOpenWorldArtifactResponsibilityV1,
  textOpenWorldTaskResponsibilityV1,
} from '../../src/lib/open-world/responsibility-contract'
import { projectTextOpenWorldResponsibilitiesV1 } from '../../src/lib/open-world/responsibility-progress'
import { textOpenWorldProductionTaskDescendantsV1 } from '../../src/lib/open-world/production-contract'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedAuthorizedTextOpenWorldCreatorBuildV1 } from '../helpers/text-open-world-creator-build'

const HASH = 'a'.repeat(64)
let plan: ProductProductionPlanV3

beforeAll(async () => {
  const world = await seedCurrentProductWorld('W1 三线合同工程夹具')
  const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
    source: { kind: 'world-release', scope: world.scope, localReleaseRecordId: world.release.id!,
      expectedReleaseHash: world.release.contentHash },
    sessionKey: 'responsibility-contract',
  })
  const build = await db.productBuilds.get(creator.buildId)
  plan = parseProductProductionPlanV3(build!.planJson)
})

function fixture() {
  const matrix = createTextOpenWorldResponsibilityMatrixV1(plan)
  const progress: ProductProductionSchedulerProjectionV1 = {
    productionId: 1, buildId: 1, buildNumber: plan.buildNumber, buildStatus: 'building',
    controlEpoch: plan.controlEpoch, planHash: HASH, rootRunId: 1, terminal: false,
    budget: { usage: { modelCalls: 0, mediaCalls: 0, inputTokens: 0, outputTokens: 0,
      costUsd: 0, durationMs: 0, storageBytes: 0 }, limits: {} as never },
    tasks: plan.tasks.map(task => ({
      taskKey: task.taskKey, lane: task.lane, status: 'completed', runId: 1, attempt: 1,
      terminalReceiptHash: HASH, blocker: null, recoveryCheckAt: null,
      latestDurableBoundary: null, checkpoint: null, steps: [],
    })),
  }
  const governance: TextOpenWorldArtifactGovernanceProjectionV1 = {
    schema: 'storyforge.text-open-world-artifact-governance-projection', version: 1,
    production: { id: 1, productionKey: 'test', title: '工程状态测试', status: 'producing', stateRevision: 1 },
    build: { id: 1, buildNumber: plan.buildNumber, status: 'building', controlEpoch: plan.controlEpoch, planHash: HASH },
    snapshotHash: HASH, summary: {} as never, entities: [],
    artifacts: matrix.artifacts.map((row, index) => ({
      rowId: index + 1, artifactKey: row.artifactKey, requirementKey: null, kind: row.artifactKey,
      label: row.artifactKey, group: 'governance', version: 1, artifactStatus: 'accepted', health: 'verified',
      productionValidation: 'production-validated', validatorId: 'unit-test', validationReceiptHash: HASH,
      currentEpoch: true, controlEpoch: plan.controlEpoch, ownerTaskKey: row.ownerTaskKey, ownerLane: null,
      producerRunId: 1, producerRunState: 'completed', producerReceiptHash: HASH, inputHash: HASH,
      contentHash: HASH, schema: null, byteSize: 1, mediaKind: null, mimeType: null, sourceEvidence: [],
      sourceEvidenceCount: 0, truncatedSourceEvidenceCount: 0, entityIdentities: [], diagnostics: [],
      createdAt: 1, updatedAt: 1,
    })),
  }
  return { plan, progress, governance, usage: [], degradations: ['声音：silent（冻结需求）'] }
}

describe('R-OPEN-WORLD8 责任合同与六态', () => {
  it('counts cross-line task usage once and preserves unknown retry costs', () => {
    const input = fixture()
    const usage = { modelCalls: 1, mediaCalls: 0, inputTokens: 40, outputTokens: 20,
      costUsd: 0.01, durationMs: 10, storageBytes: 0 }
    const result = projectTextOpenWorldResponsibilitiesV1({ ...input, usage: [
      { taskKey: 'p10.system-finalize', usage, usageKnown: true },
      { taskKey: 'p10.system-finalize', usage: { ...usage, costUsd: null }, usageKnown: false },
    ] })
    expect(result.tracks.find(track => track.responsibilityTrack === 'product-system')?.usage)
      .toMatchObject({ modelCalls: 2, costUsd: null, known: false })
    expect(result.tracks.find(track => track.responsibilityTrack === 'media')?.usage.modelCalls).toBe(0)
  })

  it('覆盖所有正式任务/产物，分类不改写历史 Plan 或 lane', async () => {
    const before = await hashProductProductionValueV2(plan)
    const matrix = createTextOpenWorldResponsibilityMatrixV1(plan)
    expect(matrix.tasks).toHaveLength(plan.tasks.length)
    expect(new Set(matrix.artifacts.map(row => row.artifactKey)).size).toBe(matrix.artifacts.length)
    expect(textOpenWorldTaskResponsibilityV1('p8.catalog.progression')).toBe('product-system')
    expect(plan.tasks.find(task => task.taskKey === 'p8.catalog.progression')?.lane).toBe('content')
    expect(textOpenWorldArtifactResponsibilityV1('text-open-world.media-requirements')).toMatchObject({
      responsibilityTrack: 'media', ownerTaskKey: 'p10.system-finalize',
    })
    expect(textOpenWorldArtifactResponsibilityV1('text-open-world.action-bindings').responsibilityTrack).toBe('product-system')
    expect(await hashProductProductionValueV2(plan)).toBe(before)
    expect(parseProductProductionPlanV3(plan)).toEqual(plan)
  })
  it('未知任务、缺失正式任务或产物、重复 owner 失败关闭', () => {
    expect(() => textOpenWorldTaskResponsibilityV1('content.unknown')).toThrow('未登记')
    const missing = structuredClone(plan)
    missing.tasks = missing.tasks.filter(task => task.taskKey !== 'p5.mainline')
    expect(() => createTextOpenWorldResponsibilityMatrixV1(missing)).toThrow('不完整')
    const output = structuredClone(plan)
    output.tasks.find(task => task.taskKey === 'p10.system-finalize')!.outputArtifactKeys.pop()
    expect(() => createTextOpenWorldResponsibilityMatrixV1(output)).toThrow('缺少正式输出')
    const duplicate = structuredClone(plan)
    duplicate.tasks[1].outputArtifactKeys.push('text-open-world.source-pin')
    expect(() => createTextOpenWorldResponsibilityMatrixV1(duplicate)).toThrow('owner')
  })
  it('V3/QA 不形成自依赖；三线必需产物和签收闭合后才可进入组装', () => {
    const input = fixture()
    for (const task of input.progress.tasks.filter(task => ['v3.runtime-package', 'qa.release'].includes(task.taskKey))) {
      task.status = 'waiting'; task.terminalReceiptHash = null
    }
    const result = projectTextOpenWorldResponsibilitiesV1(input)
    expect(result.tracks.map(track => track.state)).toEqual(['ready', 'ready', 'ready'])
    expect(result.assemblyTasks).toHaveLength(2)
    expect(result.readyForAssembly).toBe(true)
    expect(result.tracks[2].degradations).toHaveLength(1)
  })
  it('任务全部完成也不能掩盖缺件、仅完整性验证或缺失回执', () => {
    const input = fixture()
    input.governance.artifacts = input.governance.artifacts.filter(row => row.artifactKey !== 'text-open-world.mainline-thread')
    expect(projectTextOpenWorldResponsibilitiesV1(input).tracks[0].state).toBe('blocked')
    const integrity = fixture()
    integrity.governance.artifacts.find(row => row.artifactKey === 'text-open-world.system-configs')!.productionValidation = 'integrity-only'
    expect(projectTextOpenWorldResponsibilitiesV1(integrity).tracks[1].readyForAssembly).toBe(false)
    const receipt = fixture()
    receipt.progress.tasks[0].terminalReceiptHash = null
    expect(projectTextOpenWorldResponsibilitiesV1(receipt).readyForAssembly).toBe(false)
  })
  it('区分尚未开始、运行、失败、失效及未知结果阻断', () => {
    const input = fixture()
    input.governance.artifacts = []
    for (const task of input.progress.tasks) { task.status = 'waiting'; task.runId = null; task.terminalReceiptHash = null }
    expect(projectTextOpenWorldResponsibilitiesV1(input).tracks.every(track => track.state === 'not-started')).toBe(true)
    input.progress.tasks[0].status = 'running'; input.progress.tasks[0].runId = 1
    expect(projectTextOpenWorldResponsibilitiesV1(input).tracks[0].state).toBe('running')
    const failed = fixture()
    failed.governance.artifacts[0].health = 'corrupt'
    expect(projectTextOpenWorldResponsibilitiesV1(failed).tracks[0].state).toBe('failed')
    const stale = fixture()
    stale.governance.artifacts[0].currentEpoch = false
    expect(projectTextOpenWorldResponsibilitiesV1(stale).tracks[0].state).toBe('stale')
    const unknown = fixture()
    const media = unknown.progress.tasks.find(task => task.taskKey === 'media.visual')!
    media.status = 'blocked'; media.blocker = 'provider-result-unknown'
    expect(projectTextOpenWorldResponsibilitiesV1(unknown).tracks[2]).toMatchObject({
      state: 'blocked', failures: [{ taskKey: 'media.visual', retryReady: false }],
    })
  })
  it('拒绝快照竞态；旧 epoch 产物不影响新的有效版本', () => {
    const input = fixture()
    input.progress.controlEpoch += 1
    expect(() => projectTextOpenWorldResponsibilitiesV1(input)).toThrow('快照已变化')
    const history = fixture()
    history.governance.artifacts.push({ ...history.governance.artifacts[0], currentEpoch: false,
      controlEpoch: -1, health: 'stale', version: 0 })
    expect(projectTextOpenWorldResponsibilitiesV1(history).readyForAssembly).toBe(true)
  })
  it('跨线失效使用冻结 DAG：系统变更重验场景，媒资返修保留内容和系统', () => {
    const system = textOpenWorldProductionTaskDescendantsV1('p8.catalog.progression', plan.tasks)
    expect(system).toContain('p9.scene-scripts')
    expect(system).not.toContain('p5.mainline')
    const media = textOpenWorldProductionTaskDescendantsV1('media.visual', plan.tasks)
    expect(new Set(media)).toEqual(new Set(['media.visual', 'v3.runtime-package', 'qa.release']))
    expect(textOpenWorldProductionTaskDescendantsV1('p4.region-skeleton', plan.tasks)).toContain('media.visual')
  })
})
