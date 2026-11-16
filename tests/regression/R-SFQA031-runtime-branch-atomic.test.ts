import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { branchProductRuntimeSession, deleteProductRuntimeSession, readProductRuntimeState } from '../../src/lib/product/runtime-api'
import { appendProductRuntimeEvent } from '../../src/lib/product/runtime-core'
import { bindPreparedProductRuntimeBranchLineageV1 } from '../../src/lib/product/runtime-branch-lineage'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { createProductRuntimeInstanceFromSource } from '../../src/lib/product/runtime-instances'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import type { ProductRuntimeSession } from '../../src/lib/types'
import { seedAiTownRuntimeFixture } from '../helpers/ai-town-runtime'
import { createCurrentTtrpgRuntimeTestBedV1 } from '../helpers/current-product-runtime'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import { resolveScope } from '../../src/lib/workspace/scope'
import { createWorldWork } from '../../src/lib/workspace/works'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })

async function tableCounts() {
  return Promise.all(PROJECT_TABLES.map(async spec => [spec.name, await spec.table.count()]))
}

async function releasedTownParent() {
  const f = await seedAiTownRuntimeFixture()
  const manifest = await createFixtureProductReleaseManifestV1({
    runtimePackage: parseProductRuntimePackageV1(f.preview.runtimePackage), productionKey: 'sfqa031.release.fixture',
  })
  const releaseId = await db.productReleases.add({ ...f.scope, productType: 'ai-town',
    productionKey: manifest.productionProvenance!.productionKey, worldReleaseId: null, version: 1,
    label: '031冻结正式产品版本', manifestJson: JSON.stringify(manifest),
    contentHash: await hashProductProductionValueV2(manifest), createdAt: 1_700_000_000_000,
  }) as number
  const parent = await createProductRuntimeInstanceFromSource({ scope: f.scope,
    source: { kind: 'release', productReleaseId: releaseId }, title: '031正式Release父档' })
  return { ...f, parent, releaseId }
}

/** Interrupt only the real prepared-state digest, then finish that same digest. */
function mutateDuringPreparedStateHash(mutate: () => Promise<unknown>) {
  const original = crypto.subtle.digest.bind(crypto.subtle)
  let reached = false
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
    let preparedState = false
    try {
      const body = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>
      preparedState = body.lastSequence === 0 && 'town' in body && 'narratives' in body
    } catch { /* Other real source digests are not the prepared runtime state. */ }
    if (!reached && preparedState) { reached = true; await mutate() }
    return original(algorithm, data)
  })
  return () => expect(reached, 'the concurrent edit must occur during actual async state preparation').toBe(true)
}

describe('SFQA031 · generic runtime branches commit their lineage atomically', () => {
  it('rolls back the actual child and all registered writes when lineage storage fails', async () => {
    const f = await seedAiTownRuntimeFixture()
    const parent = (await db.productRuntimeSessions.get(f.session.id!))!
    const state = await readProductRuntimeState(parent.id!)
    const original = await db.productRuntimeSessions.toArray()
    const counts = await tableCounts()
    const fault = new Error('031 final lineage storage failed')
    const creating = (_key: unknown, row: ProductRuntimeSession) => {
      if (row.parentSessionId === parent.id) throw fault
    }
    const updating = (mods: Partial<ProductRuntimeSession>) => {
      if (mods.parentSessionId === parent.id) throw fault
    }
    db.productRuntimeSessions.hook('creating', creating)
    db.productRuntimeSessions.hook('updating', updating)
    try {
      await expect(branchProductRuntimeSession({ parentSessionId: parent.id!, throughSequence: state.lastSequence,
        title: '失败不可留下半个子档' })).rejects.toThrow(fault.message)
      expect(await db.productRuntimeSessions.toArray()).toEqual(original)
      expect(await tableCounts()).toEqual(counts)
    } finally {
      db.productRuntimeSessions.hook('creating').unsubscribe(creating)
      db.productRuntimeSessions.hook('updating').unsubscribe(updating)
    }
  })

  it('rolls back a rejected child insert without modifying the parent or any existing table', async () => {
    const f = await seedAiTownRuntimeFixture()
    const parent = (await db.productRuntimeSessions.get(f.session.id!))!
    const counts = await tableCounts()
    const creating = (_key: unknown, row: ProductRuntimeSession) => {
      if (row.title === '插入失败分支') throw new Error('031 child insert failed')
    }
    db.productRuntimeSessions.hook('creating', creating)
    try {
      await expect(branchProductRuntimeSession({ parentSessionId: parent.id!, throughSequence: 0,
        title: '插入失败分支' })).rejects.toThrow('031 child insert failed')
      expect(await db.productRuntimeSessions.toArray()).toEqual([parent])
      expect(await tableCounts()).toEqual(counts)
    } finally { db.productRuntimeSessions.hook('creating').unsubscribe(creating) }
  })

  it('rolls back child plus real scripted TTRPG seat clones when an extension write fails', async () => {
    const f = await createCurrentTtrpgRuntimeTestBedV1({ title: '031真实席位回滚' })
    const parent = (await db.productRuntimeSessions.get(f.session.id!))!
    const seats = await db.ttrpgSessionParticipants.toArray()
    expect(seats.length).toBeGreaterThan(1)
    const counts = await tableCounts()
    let clonedRows = 0
    const creating = (_key: unknown, row: { sessionId: number }) => {
      if (row.sessionId !== parent.id && ++clonedRows === 2) throw new Error('031 seat clone failed')
    }
    db.ttrpgSessionParticipants.hook('creating', creating)
    try {
      await expect(branchProductRuntimeSession({ parentSessionId: parent.id!, throughSequence: 0,
        title: '席位失败子档' })).rejects.toThrow('031 seat clone failed')
      expect(clonedRows).toBeGreaterThanOrEqual(2)
      expect(await db.productRuntimeSessions.toArray()).toEqual([parent])
      expect(await db.ttrpgSessionParticipants.toArray()).toEqual(seats)
      expect(await tableCounts()).toEqual(counts)
    } finally { db.ttrpgSessionParticipants.hook('creating').unsubscribe(creating) }
  })

  it('preserves a valid legacy parent whose optional runtime head cache is absent', async () => {
    const f = await seedAiTownRuntimeFixture()
    const parentId = f.session.id!
    const state = await readProductRuntimeState(parentId)
    expect(state.lastSequence).toBeGreaterThan(0)
    await db.productRuntimeSessions.update(parentId, {
      runtimeHeadSequence: undefined, runtimeHeadStateJson: undefined, runtimeHeadStateHash: undefined,
    })
    const original = await db.productRuntimeSessions.get(parentId)
    const child = await branchProductRuntimeSession({
      parentSessionId: parentId, throughSequence: state.lastSequence, title: '无缓存旧档的分支',
    })
    expect(child).toMatchObject({ parentSessionId: parentId, parentThroughSequence: state.lastSequence })
    expect((await readProductRuntimeState(child.id!)).lastSequence).toBe(0)
    expect(await db.productRuntimeSessions.get(parentId)).toEqual(original)
  })

  it.each([-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid legacy cut %s before binding lineage', async throughSequence => {
    const f = await seedAiTownRuntimeFixture()
    await db.productRuntimeSessions.update(f.session.id!, { runtimeHeadSequence: undefined })
    const parent = (await db.productRuntimeSessions.get(f.session.id!))!
    const candidate = { ...parent, id: undefined }
    await expect(bindPreparedProductRuntimeBranchLineageV1(candidate, 'branch', {
      parentSessionId: parent.id!, parentThroughSequence: throughSequence,
    })).rejects.toThrow('父会话或序列不属于当前作用域')
    expect(candidate.parentSessionId).toBeNull()
  })

  it('uses actual legacy event bounds and still rejects a future or foreign-owner lineage', async () => {
    const f = await seedAiTownRuntimeFixture()
    const state = await readProductRuntimeState(f.session.id!)
    await db.productRuntimeSessions.update(f.session.id!, { runtimeHeadSequence: undefined })
    const parent = (await db.productRuntimeSessions.get(f.session.id!))!
    const lineage = { parentSessionId: parent.id!, parentThroughSequence: state.lastSequence }
    await expect(bindPreparedProductRuntimeBranchLineageV1({ ...parent, id: undefined }, 'branch', {
      ...lineage, parentThroughSequence: state.lastSequence + 1,
    })).rejects.toThrow('父会话或序列不属于当前作用域')
    for (const change of [{ projectId: parent.projectId + 1 }, { worldId: parent.worldId! + 1 },
      { workId: parent.workId! + 1 }, { kind: 'avg' as const }]) {
      await expect(bindPreparedProductRuntimeBranchLineageV1({ ...parent, ...change, id: undefined }, 'branch', lineage))
        .rejects.toThrow('父会话或序列不属于当前作用域')
    }
    await expect(bindPreparedProductRuntimeBranchLineageV1({ ...parent, id: undefined }, 'preview', lineage))
      .rejects.toThrow('父会话或序列不属于当前作用域')
    expect(await db.productRuntimeSessions.toArray()).toEqual([parent])
  })

  it.each([0, 999])('uses real event bounds rather than an existing stale cache %s', async cachedHead => {
    const f = await seedAiTownRuntimeFixture()
    const state = await readProductRuntimeState(f.session.id!)
    expect(state.lastSequence).toBeGreaterThan(0)
    await db.productRuntimeSessions.update(f.session.id!, { runtimeHeadSequence: cachedHead })
    const parent = (await db.productRuntimeSessions.get(f.session.id!))!
    console.info('031 actual event/cache boundary', { cached: parent.runtimeHeadSequence, actual: state.lastSequence })
    await expect(bindPreparedProductRuntimeBranchLineageV1({ ...parent, id: undefined }, 'branch', {
      parentSessionId: parent.id!, parentThroughSequence: state.lastSequence + 1,
    })).rejects.toThrow('父会话或序列不属于当前作用域')
    const child = await branchProductRuntimeSession({ parentSessionId: parent.id!, throughSequence: state.lastSequence,
      title: '缓存不能授权或阻断真实切点' })
    expect(child).toMatchObject({ parentSessionId: parent.id, parentThroughSequence: state.lastSequence })
    expect(await db.productRuntimeSessions.get(parent.id!)).toEqual(parent)
  })

  it('rejects a parent deleted during actual preparation without leaving a child', async () => {
    const f = await seedAiTownRuntimeFixture()
    const state = await readProductRuntimeState(f.session.id!)
    const assertReached = mutateDuringPreparedStateHash(() => db.productRuntimeSessions.delete(f.session.id!))
    await expect(branchProductRuntimeSession({ parentSessionId: f.session.id!, throughSequence: state.lastSequence,
      title: '并发删父不得残留' })).rejects.toThrow(/父会话/)
    assertReached()
    expect(await db.productRuntimeSessions.count()).toBe(0)
  })

  it('rejects a changed Work binding during actual preparation and preserves that newer edit', async () => {
    const f = await seedAiTownRuntimeFixture()
    const original = (await db.productRuntimeSessions.get(f.session.id!))!
    const state = await readProductRuntimeState(original.id!)
    const assertReached = mutateDuringPreparedStateHash(() => db.productRuntimeSessions.update(original.id!, {
      workId: original.workId! + 100,
    }))
    await expect(branchProductRuntimeSession({ parentSessionId: original.id!, throughSequence: state.lastSequence,
      title: '并发改owner不得残留' })).rejects.toThrow(/父会话/)
    assertReached()
    expect(await db.productRuntimeSessions.toArray()).toEqual([{ ...original, workId: original.workId! + 100 }])
  })

  it('rejects a changed frozen Build tuple at the commit boundary', async () => {
    const f = await seedAiTownRuntimeFixture()
    const parent = (await db.productRuntimeSessions.get(f.session.id!))!
    const state = await readProductRuntimeState(parent.id!)
    const production = (await db.productProductions.get(f.productionId))!
    const assertReached = mutateDuringPreparedStateHash(() => db.productProductions.update(f.productionId, {
      controlEpoch: production.controlEpoch + 1,
    }))
    await expect(branchProductRuntimeSession({ parentSessionId: parent.id!, throughSequence: state.lastSequence,
      title: '冻结来源并发变化' })).rejects.toThrow('Product Build/Production/Brief 在命令提交期间发生变化')
    assertReached()
    expect(await db.productRuntimeSessions.toArray()).toEqual([parent])
    expect((await db.productProductions.get(f.productionId))!.controlEpoch).toBe(production.controlEpoch + 1)
  })

  it.each(['rewrite', 'truncate'] as const)('rejects actual cut-prefix %s during preparation', async mode => {
    const f = await seedAiTownRuntimeFixture()
    const parent = (await db.productRuntimeSessions.get(f.session.id!))!
    const state = await readProductRuntimeState(parent.id!)
    const first = (await db.productRuntimeEvents.where('sessionId').equals(parent.id!).first())!
    expect(first).toBeDefined()
    const assertReached = mutateDuringPreparedStateHash(() => mode === 'rewrite'
      ? db.productRuntimeEvents.update(first.id!, { payloadJson: first.payloadJson + ' ' })
      : db.productRuntimeEvents.delete(first.id!))
    await expect(branchProductRuntimeSession({ parentSessionId: parent.id!, throughSequence: state.lastSequence,
      title: '切点原事件变化' })).rejects.toThrow('切点事件发生变化')
    assertReached()
    expect(await db.productRuntimeSessions.toArray()).toEqual([parent])
    expect(await db.productRuntimeEvents.get(first.id!)).toEqual(mode === 'rewrite'
      ? { ...first, payloadJson: first.payloadJson + ' ' } : undefined)
  })

  it('allows an actual legitimate parent suffix while committing the original cut', async () => {
    const f = await seedAiTownRuntimeFixture()
    const state = await readProductRuntimeState(f.session.id!)
    const parentPrefix = await db.productRuntimeEvents.where('sessionId').equals(f.session.id!).toArray()
    const assertReached = mutateDuringPreparedStateHash(() => appendProductRuntimeEvent({
      sessionId: f.session.id!, type: 'narrative.recorded', payload: { text: '父时间线独立追加的原话' },
    }))
    const child = await branchProductRuntimeSession({ parentSessionId: f.session.id!, throughSequence: state.lastSequence,
      title: '保留原切点、允许父后缀' })
    assertReached()
    expect(child).toMatchObject({ parentSessionId: f.session.id, parentThroughSequence: state.lastSequence })
    expect((await readProductRuntimeState(f.session.id!)).lastSequence).toBe(state.lastSequence + 1)
    expect((await readProductRuntimeState(child.id!)).lastSequence).toBe(0)
    expect((await readProductRuntimeState(child.id!)).narratives.some(item => item.text === '父时间线独立追加的原话')).toBe(false)
    expect((await db.productRuntimeEvents.where('sessionId').equals(f.session.id!).toArray())
      .filter(event => event.sequence <= state.lastSequence)).toEqual(parentPrefix)
  })

  it('persists a complete successful generic branch through reopen, backup, and parent deletion', async () => {
    const f = await seedAiTownRuntimeFixture()
    const parent = (await db.productRuntimeSessions.get(f.session.id!))!
    const state = await readProductRuntimeState(parent.id!)
    const worlds = await db.worldReleases.toArray()
    const child = await branchProductRuntimeSession({ parentSessionId: parent.id!, throughSequence: state.lastSequence,
      title: '完整成功的独立分支' })
    await appendProductRuntimeEvent({ sessionId: child.id!, type: 'narrative.recorded', payload: { text: '只有子分支的后续' } })
    db.close(); await db.open()
    expect(await db.productRuntimeSessions.get(parent.id!)).toEqual(parent)
    expect(await db.productRuntimeSessions.get(child.id!)).toMatchObject({ parentSessionId: parent.id, parentThroughSequence: state.lastSequence })
    expect((await readProductRuntimeState(parent.id!)).narratives.some(item => item.text === '只有子分支的后续')).toBe(false)
    const backup = await exportProjectJSON(parent.projectId)
    const originalBackup = JSON.stringify(backup)
    const restoredProject = await importProjectJSON(backup)
    const restored = await db.productRuntimeSessions.where('projectId').equals(restoredProject).toArray()
    const restoredParent = restored.find(row => row.title === parent.title)!
    const restoredChild = restored.find(row => row.title === child.title)!
    expect(restoredChild).toMatchObject({ parentSessionId: restoredParent.id, parentThroughSequence: state.lastSequence })
    const restoredNarratives = (await readProductRuntimeState(restoredChild.id!)).narratives
    expect(restoredNarratives[restoredNarratives.length - 1]!.text).toBe('只有子分支的后续')
    expect(JSON.stringify(backup)).toBe(originalBackup)
    await deleteProductRuntimeSession(parent.id!)
    expect(await db.productRuntimeSessions.get(child.id!)).toMatchObject({ parentSessionId: null, parentThroughSequence: null })
    const survivingNarratives = (await readProductRuntimeState(child.id!)).narratives
    expect(survivingNarratives[survivingNarratives.length - 1]!.text).toBe('只有子分支的后续')
    expect(await db.worldReleases.where('projectId').equals(parent.projectId).toArray()).toEqual(worlds)
  })

  it('commits the successful scripted TTRPG child and applicable seats together', async () => {
    const f = await createCurrentTtrpgRuntimeTestBedV1({ title: '031成功席位分支' })
    const parent = (await db.productRuntimeSessions.get(f.session.id!))!
    const seats = await db.ttrpgSessionParticipants.where('sessionId').equals(parent.id!).toArray()
    expect(await db.productRuntimeEvents.where('sessionId').equals(parent.id!).count()).toBe(0)
    const child = await branchProductRuntimeSession({ parentSessionId: parent.id!, throughSequence: 0, title: '席位完整子档' })
    const cloned = await db.ttrpgSessionParticipants.where('sessionId').equals(child.id!).toArray()
    expect(child).toMatchObject({ parentSessionId: parent.id, parentThroughSequence: 0 })
    expect(cloned.map(row => row.seatKey)).toEqual(seats.map(row => row.seatKey))
    expect(cloned.every(row => row.workId === child.workId && row.worldId === child.worldId)).toBe(true)
    expect(await db.productRuntimeSessions.get(parent.id!)).toEqual(parent)
    expect(await db.ttrpgSessionParticipants.where('sessionId').equals(parent.id!).toArray()).toEqual(seats)
  })

  it('commits a Release-owned generic child with the same immutable source and no world writes', async () => {
    const f = await releasedTownParent()
    const parent = (await db.productRuntimeSessions.get(f.parent.id!))!
    const cut = (await readProductRuntimeState(parent.id!)).lastSequence
    const originalRelease = await db.productReleases.get(f.releaseId)
    const worlds = await db.worldReleases.toArray()
    const child = await branchProductRuntimeSession({ parentSessionId: parent.id!, throughSequence: cut,
      title: '正式Release原子子档' })
    expect(child).toMatchObject({ parentSessionId: parent.id, parentThroughSequence: cut,
      productReleaseId: f.releaseId, productBuildId: null, runtimeSourceHash: parent.runtimeSourceHash })
    db.close(); await db.open()
    expect((await readProductRuntimeState(child.id!)).lastSequence).toBe(0)
    expect(await db.productRuntimeSessions.get(parent.id!)).toEqual(parent)
    expect(await db.productReleases.get(f.releaseId)).toEqual(originalRelease)
    expect(await db.worldReleases.toArray()).toEqual(worlds)
  })

  it('rejects an actual Release-owned source mutation during preparation without a partial child', async () => {
    const f = await releasedTownParent()
    const sessions = await db.productRuntimeSessions.toArray()
    const cut = (await readProductRuntimeState(f.parent.id!)).lastSequence
    const assertReached = mutateDuringPreparedStateHash(() => db.productReleases.update(f.releaseId, {
      label: '并发改变的正式发行行',
    }))
    await expect(branchProductRuntimeSession({ parentSessionId: f.parent.id!, throughSequence: cut,
      title: '发行变化不得留下子档' })).rejects.toThrow('Product Release 在命令提交期间发生变化')
    assertReached()
    expect(await db.productRuntimeSessions.toArray()).toEqual(sessions)
    expect((await db.productReleases.get(f.releaseId))!.label).toBe('并发改变的正式发行行')
  })

  it.each(['work-world', 'world-project', 'project-deleted'] as const)('revalidates the actual owner-root %s before child insertion', async mode => {
    const f = await seedAiTownRuntimeFixture()
    const sessions = await db.productRuntimeSessions.toArray()
    const cut = (await readProductRuntimeState(f.session.id!)).lastSequence
    let rootRejected = false
    const assertReached = mutateDuringPreparedStateHash(async () => {
      if (mode === 'work-world') await db.works.update(f.scope.workId, { worldId: f.scope.worldId + 100 })
      else if (mode === 'world-project') await db.worlds.update(f.scope.worldId, { projectId: f.scope.projectId + 100 })
      else await db.projects.delete(f.scope.projectId)
      try { await resolveScope({ scope: f.scope }) } catch { rootRejected = true }
    })
    await expect(branchProductRuntimeSession({ parentSessionId: f.session.id!, throughSequence: cut,
      title: '实际owner根已变不得提交' })).rejects.toThrow('WorkspaceScope')
    assertReached()
    expect(rootRejected).toBe(true)
    expect(await db.productRuntimeSessions.toArray()).toEqual(sessions)
  })

  it('keeps an unchanged frozen Work usable when the author changes active-root pointers', async () => {
    const f = await seedAiTownRuntimeFixture()
    const other = await createWorldWork(f.scope.projectId, { title: '其它活动作品' })
    await db.projects.update(f.scope.projectId, { activeWorldId: f.scope.worldId, activeWorkId: f.scope.workId })
    const parent = (await db.productRuntimeSessions.get(f.session.id!))!
    const cut = (await readProductRuntimeState(parent.id!)).lastSequence
    const assertReached = mutateDuringPreparedStateHash(() => db.projects.update(f.scope.projectId, { activeWorkId: other.id! }))
    const child = await branchProductRuntimeSession({ parentSessionId: parent.id!, throughSequence: cut,
      title: '仍属于原作品的分支' })
    assertReached()
    expect(child).toMatchObject({ workId: f.scope.workId, worldId: f.scope.worldId, parentSessionId: parent.id })
    expect((await db.projects.get(f.scope.projectId))!.activeWorkId).toBe(other.id)
    expect(await db.productRuntimeSessions.get(parent.id!)).toEqual(parent)
  })
})
