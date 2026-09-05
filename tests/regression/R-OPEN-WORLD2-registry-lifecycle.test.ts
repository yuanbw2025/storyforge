import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { createTextOpenWorldCheckpointV1, inspectTextOpenWorldCheckpointV1 } from '../../src/lib/open-world/checkpoints'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { createTextOpenWorldEffectCatalogV1 } from '../../src/lib/open-world/effect-dsl'
import { commitTextOpenWorldOutcomeBatchV1 } from '../../src/lib/open-world/events'
import { verifyTextOpenWorldVNextSessionBindingV1 } from '../../src/lib/open-world/session-binding'
import { assertProductReleaseUnchanged } from '../../src/lib/product/releases'
import {
  deleteProductRuntimeSession,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from '../../src/lib/product/runtime-core'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { ADOPTION_EXTENSIONS } from '../../src/lib/registry/adoption-schema'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { REGISTRY_BY_NAME } from '../../src/lib/registry/project-tables'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

async function fixture() {
  const textOpenWorldVNext = createTextOpenWorldVNextFixture()
  ;(textOpenWorldVNext.modules.knowledge.payload as any).entries.push({
    key: 'knowledge.hidden-origin', kind: 'lore', title: '不应看见的真相',
    content: '渠水断流由尚未登场的幕后人物造成。', sourceRefs: ['world-release:hidden'],
    initialPlayerVisibility: 'hidden', actorKeys: [],
  })
  const created = await createGovernedTextOpenWorldSessionFixtureV1({
    name: `TEXT-OPEN-WORLD 注册表生命周期验收-${crypto.randomUUID()}`,
    textOpenWorldVNext,
    title: '盐脊正式存档',
    seed: 'registry-lifecycle',
  })
  return { ...created, textOpenWorldVNext }
}

async function completeAction(created: Awaited<ReturnType<typeof fixture>>) {
  const base = await readProductRuntimeStateVersion(created.session.id!)
  await commitTextOpenWorldCommandV1({
    schema: 'storyforge.text-open-world.command', version: 1, commandId: 'command.registry-lifecycle.1',
    sessionId: created.session.id!, actorKey: 'player', actionKey: 'action.investigate-channel',
    payload: { targetKey: 'location.salt-port' }, baseSequence: base.sequence, baseStateHash: base.stateHash,
    source: 'system-action', requestedAt: 1_000,
  })
  const pending = (await readProductRuntimeState(created.session.id!)).textOpenWorld!
  const catalog = createTextOpenWorldEffectCatalogV1(created.textOpenWorldVNext)
  const plan = await catalog.plan({ effectKeys: ['effect.reward-currency'], claimKey: 'claim.registry-lifecycle.1', state: pending.state })
  const { receipt } = await catalog.apply({ plan, state: pending.state })
  await commitTextOpenWorldOutcomeBatchV1({
    sessionId: created.session.id!, commandId: 'command.registry-lifecycle.1',
    ruleset: { key: 'storyforge.standard', version: 1 }, randomRequests: [], plan, receipt,
    outcome: 'success', reason: null, degradation: null,
  })
}

describe('Text Open World vNext · three registries and complete data lifecycle', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('openWorldRuntime只装配vNext玩家可见状态、Action闭集和正式结果', async () => {
    const created = await fixture()
    await completeAction(created)
    const context = await assembleContext({
      projectId: created.scope.projectId, scope: created.scope,
      productRuntimeSessionId: created.session.id!, sourceKeys: ['openWorldRuntime'],
    })
    expect(context.included).toEqual(['openWorldRuntime'])
    expect(context.text).toContain('【文字开放世界vNext玩家视角】')
    expect(context.text).toContain('action.investigate-channel')
    expect(context.text).toContain('command.registry-lifecycle.1｜succeeded')
    expect(context.text).toContain('岑阿婆')
    expect(context.text).not.toContain('盐港最后一位老守渠人')
    expect(context.text).not.toContain('不应看见的真相')
    expect(context.text).not.toContain('渠水断流由尚未登场')
    expect(context.text).not.toContain('短缺物资')
    expect(context.text).not.toContain('protected')
    expect(context.text).not.toContain('schedule.caretaker')

    const foreignWorkspace = await createWorkspace({
      name: `TEXT-OPEN-WORLD 跨项目隔离-${crypto.randomUUID()}`,
      genres: ['open-world'], status: 'drafting', description: '', targetWordCount: 1,
      enableMultiWorld: false,
    }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
    const foreign = await assembleContext({
      projectId: foreignWorkspace.scope.projectId, scope: foreignWorkspace.scope,
      productRuntimeSessionId: created.session.id!, sourceKeys: ['openWorldRuntime'],
    })
    expect(foreign.included).toEqual([])
    expect(foreign.text).toBe('')
  }, 20_000)

  it('PROJECT_TABLES派生的备份恢复会重映射完整ProductRelease、Session、Event与Checkpoint链', async () => {
    const created = await fixture()
    await completeAction(created)
    const checkpoint = await createTextOpenWorldCheckpointV1({ sessionId: created.session.id!, name: '调查完成' })
    const portableCanon = JSON.parse(created.session.canonSnapshotJson)
    expect(portableCanon).not.toHaveProperty('productReleaseId')
    expect(portableCanon).not.toHaveProperty('productBuildId')
    expect(portableCanon).toMatchObject({
      schema: 'storyforge.product-runtime-source', productType: 'text-open-world',
      runtimeSourceHash: created.manifest.packageHash,
      sourceWorldContentHash: created.textOpenWorldVNext.sourceManifest.contentHash,
    })

    const backup = await exportProjectJSON(created.scope.projectId)
    expect(backup.productReleases).toHaveLength(1)
    expect(backup.productRuntimeSessions).toHaveLength(1)
    expect(backup.productRuntimeEvents).toHaveLength(4)
    expect(backup.productRuntimeCheckpoints).toHaveLength(1)
    expect(backup.productRuntimeSessions[0]._productReleaseExportId).toBe(backup.productReleases[0]._exportId)
    expect(backup.productRuntimeEvents.every(row => row._productRuntimeSessionExportId === backup.productRuntimeSessions[0]._exportId)).toBe(true)
    expect(backup.productRuntimeCheckpoints[0]._productRuntimeSessionExportId).toBe(backup.productRuntimeSessions[0]._exportId)
    const portableCommandEvent = backup.productRuntimeEvents.find(event => event.type === 'text-open-world.command.committed') as any
    expect(portableCommandEvent.payloadJson).toBeUndefined()
    expect(JSON.parse(portableCommandEvent._portablePayloadJson).envelope.sessionId).toBe(backup.productRuntimeSessions[0]._exportId)

    const importedProjectId = await importProjectJSON(backup)
    const importedOwnership = await resolveWorkspaceOwnership(importedProjectId)
    const importedRelease = await db.productReleases.where('projectId').equals(importedProjectId).first()
    const importedSession = await db.productRuntimeSessions.where('projectId').equals(importedProjectId).first()
    const importedEvents = await db.productRuntimeEvents.where('projectId').equals(importedProjectId).sortBy('sequence')
    const importedCheckpoint = await db.productRuntimeCheckpoints.where('projectId').equals(importedProjectId).first()
    expect(importedRelease).toMatchObject({
      worldId: importedOwnership.scope.worldId, workId: importedOwnership.scope.workId,
      contentHash: created.release.contentHash,
    })
    expect(importedSession).toMatchObject({
      worldId: importedOwnership.scope.worldId, workId: importedOwnership.scope.workId,
      productReleaseId: importedRelease?.id, runtimeSourceHash: created.manifest.packageHash,
    })
    expect(importedSession?.id).not.toBe(created.session.id)
    expect(importedEvents).toHaveLength(4)
    expect(importedEvents.every(event => event.sessionId === importedSession?.id)).toBe(true)
    expect(JSON.parse(importedEvents.find(event => event.type === 'text-open-world.command.committed')!.payloadJson).envelope.sessionId)
      .toBe(importedSession?.id)
    expect(importedCheckpoint?.sessionId).toBe(importedSession?.id)
    await expect(assertProductReleaseUnchanged(importedRelease!.id!)).resolves.toMatchObject({ contentHash: created.release.contentHash })
    await expect(verifyTextOpenWorldVNextSessionBindingV1(importedSession!)).resolves.toMatchObject({ runtimePackage: created.textOpenWorldVNext })
    const importedInspection = await inspectTextOpenWorldCheckpointV1(importedCheckpoint!.id!)
    expect(importedInspection, importedInspection.detail).toMatchObject({ valid: true, code: 'valid' })
    const importedCommand = JSON.parse(importedEvents.find(event => event.type === 'text-open-world.command.committed')!.payloadJson).envelope
    await expect(commitTextOpenWorldCommandV1({ ...importedCommand, requestedAt: 9_999 }))
      .resolves.toMatchObject({ replayed: true, resultingSequence: 3 })

    await deleteProductRuntimeSession(importedSession!.id!)
    expect(await db.productRuntimeEvents.where('sessionId').equals(importedSession!.id!).count()).toBe(0)
    expect(await db.productRuntimeCheckpoints.where('sessionId').equals(importedSession!.id!).count()).toBe(0)
    expect(await db.productReleases.get(importedRelease!.id!)).toBeDefined()
    expect(await db.productRuntimeCheckpoints.get(checkpoint.id!)).toBeDefined()
  }, 30_000)

  it('AI正式写入与确定性运行时写入分治，不给Session、Event、Checkpoint开放通用adopt旁路', () => {
    for (const table of ['productReleases', 'productRuntimeSessions', 'productRuntimeEvents', 'productRuntimeCheckpoints']) {
      expect(REGISTRY_BY_NAME.get(table)).toMatchObject({ exportable: true })
    }
    expect(FIELD_BY_TARGET.has('productRuntimeSessions')).toBe(false)
    expect(FIELD_BY_TARGET.has('productRuntimeEvents')).toBe(false)
    expect(FIELD_BY_TARGET.has('productRuntimeCheckpoints')).toBe(false)
    expect(ADOPTION_EXTENSIONS.find(extension => extension.id === 'product-production-release-adoption'))
      .toMatchObject({ target: 'productReleases', entrypoints: expect.arrayContaining(['src/lib/product/releases.ts']) })
  })
})
