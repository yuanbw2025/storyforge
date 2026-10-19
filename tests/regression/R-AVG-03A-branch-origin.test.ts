import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedAvgReadingPreview } from '../helpers/avg-reading-fixture'
import { createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { branchProductRuntimeSession, commitNarrativeChoice, createPreviewProductRuntimeSession, deleteProductRuntimeSession,
  readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-core'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-commands'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

async function start() {
  const source = await seedAvgReadingPreview({ voices: [] })
  const parent = await createProductRuntimeInstance({ scope: source.scope, kind: 'avg', title: '原存档',
    productSource: { kind: 'build', productBuildId: source.buildId, expectedPreviewHash: source.preview.previewHash } })
  const base = async () => { const b = await readProductRuntimeStateVersion(parent.id!); return {
    sessionId: parent.id!, baseSequence: b.sequence, baseStateHash: b.stateHash, commandId: crypto.randomUUID() } }
  await reachAvgPresentationBeat({ ...await base(), beatKey: 'line.desk' })
  await commitNarrativeChoice({ ...await base(), choiceKey: 'inspect' })
  const through = (await readProductRuntimeStateVersion(parent.id!)).sequence
  const child = await branchProductRuntimeSession({ parentSessionId: parent.id!, throughSequence: through, title: '派生存档' })
  return { ...source, parent, child, through }
}

describe('native AVG portable detached branch provenance', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('preserves actual reading/rules after deleting parent, rebranching and two backup/remap round trips', async () => {
    const s = await start(), before = await readProductRuntimeState(s.child.id!)
    expect(before.avgReading!.history.length).toBeGreaterThan(0)
    const canonBefore = s.child.canonSnapshotJson
    await deleteProductRuntimeSession(s.parent.id!)
    expect(await db.productRuntimeSessions.get(s.parent.id!)).toBeUndefined()
    const detached = (await db.productRuntimeSessions.get(s.child.id!))!
    expect(detached).toMatchObject({ parentSessionId: null, parentThroughSequence: null, canonSnapshotJson: canonBefore })
    expect(await readProductRuntimeState(detached.id!)).toEqual(before)
    const next = await branchProductRuntimeSession({ parentSessionId: detached.id!, throughSequence: 0, title: '再次分支' })
    expect(await readProductRuntimeState(next.id!)).toEqual(before)
    for (const projectId of [s.scope.projectId, await importProjectJSON(await exportProjectJSON(s.scope.projectId))]) {
      const imported = await importProjectJSON(await exportProjectJSON(projectId))
      const restored = (await db.productRuntimeSessions.where('projectId').equals(imported).toArray()).find(row => row.title === '派生存档')!
      expect(restored.id).not.toBe(detached.id)
      expect(restored.parentSessionId).toBeNull()
      expect(restored.canonSnapshotJson).toBe(canonBefore)
      expect(await readProductRuntimeState(restored.id!)).toEqual(before)
    }
  })

  it('materializes legacy native branch evidence from the real parent prefix atomically before deletion', async () => {
    const s = await start(), canon = JSON.parse(s.child.canonSnapshotJson), before = await readProductRuntimeState(s.child.id!)
    delete canon.avgBranchOrigin
    await db.productRuntimeSessions.update(s.child.id!, { canonSnapshotJson: JSON.stringify(canon) })
    expect(await readProductRuntimeState(s.child.id!)).toEqual(before)
    await deleteProductRuntimeSession(s.parent.id!)
    const child = (await db.productRuntimeSessions.get(s.child.id!))!
    expect(JSON.parse(child.canonSnapshotJson).avgBranchOrigin).toBeDefined()
    expect(child.parentSessionId).toBeNull()
    expect(await readProductRuntimeState(child.id!)).toEqual(before)
  })

  it.each(['receipt', 'source', 'initial'] as const)('rejects corrupt %s on read/export/import and aborts parent deletion without partial writes', async field => {
    const s = await start(), snapshot = await exportProjectJSON(s.scope.projectId)
    const child = (await db.productRuntimeSessions.get(s.child.id!))!, canon = JSON.parse(child.canonSnapshotJson)
    let initial = child.initialStateJson
    if (field === 'receipt') canon.avgBranchOrigin.receiptHash = '0'.repeat(64)
    if (field === 'source') canon.avgBranchOrigin.runtimeSourceHash = '1'.repeat(64)
    if (field === 'initial') { const state = JSON.parse(initial); state.avgReading.history = []; initial = JSON.stringify(state) }
    const patch = { canonSnapshotJson: JSON.stringify(canon), initialStateJson: initial }
    const forged = structuredClone(snapshot), portable = forged.productRuntimeSessions!.find(row => row.title === '派生存档')!
    Object.assign(portable, patch)
    const projects = await db.projects.count(), sessions = await db.productRuntimeSessions.count(), events = await db.productRuntimeEvents.count()
    await expect(importProjectJSON(forged)).rejects.toThrow(/avg-branch-origin/)
    expect(await db.projects.count()).toBe(projects)
    await db.productRuntimeSessions.update(child.id!, patch)
    await expect(readProductRuntimeState(child.id!)).rejects.toThrow(/avg-branch-origin/)
    await expect(exportProjectJSON(s.scope.projectId)).rejects.toThrow(/avg-branch-origin/)
    await expect(deleteProductRuntimeSession(s.parent.id!)).rejects.toThrow(/avg-branch-origin/)
    expect(await db.productRuntimeSessions.count()).toBe(sessions)
    expect(await db.productRuntimeEvents.count()).toBe(events)
    expect((await db.productRuntimeSessions.get(child.id!))!.parentSessionId).toBe(s.parent.id)
    expect(await db.productRuntimeSessions.get(s.parent.id!)).toBeDefined()
  })

  it('refuses a legacy branch with a mismatching parent prefix, and keeps both saves', async () => {
    const s = await start(), canon = JSON.parse(s.child.canonSnapshotJson)
    delete canon.avgBranchOrigin
    await db.productRuntimeSessions.update(s.child.id!, { canonSnapshotJson: JSON.stringify(canon), parentThroughSequence: 0 })
    await expect(deleteProductRuntimeSession(s.parent.id!)).rejects.toThrow(/无法重建/)
    expect(await db.productRuntimeSessions.get(s.parent.id!)).toBeDefined()
    expect((await db.productRuntimeSessions.get(s.child.id!))!.parentSessionId).toBe(s.parent.id)
  })

  it('rolls back a valid legacy repair when another child has a corrupt receipt', async () => {
    const s = await start(), canon = JSON.parse(s.child.canonSnapshotJson)
    delete canon.avgBranchOrigin
    const legacyJson = JSON.stringify(canon)
    await db.productRuntimeSessions.update(s.child.id!, { canonSnapshotJson: legacyJson })
    const second = await branchProductRuntimeSession({ parentSessionId: s.parent.id!, throughSequence: s.through, title: '损坏的另一个分支' })
    const bad = JSON.parse(second.canonSnapshotJson); bad.avgBranchOrigin.receiptHash = '0'.repeat(64)
    await db.productRuntimeSessions.update(second.id!, { canonSnapshotJson: JSON.stringify(bad) })
    await expect(deleteProductRuntimeSession(s.parent.id!)).rejects.toThrow(/avg-branch-origin/)
    expect(await db.productRuntimeSessions.get(s.parent.id!)).toBeDefined()
    expect(await db.productRuntimeSessions.get(s.child.id!)).toMatchObject({ canonSnapshotJson: legacyJson, parentSessionId: s.parent.id })
  })

  it('does not treat a detached branch marker or caller branch label as permission to preseed a new game', async () => {
    const s = await start(), count = await db.productRuntimeSessions.count()
    const input = { ...s.scope, kind: 'avg' as const, productBuildId: s.buildId, title: '禁止伪装新游戏',
      expectedPreviewHash: s.preview.previewHash, runtimeSourceHash: s.child.runtimeSourceHash,
      canonSnapshot: JSON.parse(s.child.canonSnapshotJson), initialState: JSON.parse(s.child.initialStateJson) }
    await expect(createPreviewProductRuntimeSession({ ...input, origin: 'preview' })).rejects.toThrow(/初始|初态|新游戏/)
    delete input.canonSnapshot.avgBranchOrigin
    await expect(createPreviewProductRuntimeSession({ ...input, origin: 'branch' })).rejects.toThrow(/缺少来源/)
    const empty = await branchProductRuntimeSession({ parentSessionId: s.parent.id!, throughSequence: 0, title: '零事件分支' })
    await expect(createPreviewProductRuntimeSession({ ...input, origin: 'preview',
      canonSnapshot: JSON.parse(empty.canonSnapshotJson), initialState: JSON.parse(empty.initialStateJson) })).rejects.toThrow(/新游戏不能携带/)
    await deleteProductRuntimeSession(empty.id!)
    expect(await db.productRuntimeSessions.count()).toBe(count)
  })
})
