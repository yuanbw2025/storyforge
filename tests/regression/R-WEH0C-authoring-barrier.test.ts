import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  coordinatePendingEditV1,
  flushPendingEditsV1,
  pendingEditDiagnosticsV1,
  registerPendingDraftFlusherV1,
  resetPendingEditCoordinatorForTestsV1,
} from '../../src/lib/authoring/pending-edit-coordinator'
import {
  captureWorkspaceContentRevisionV1,
  contentRevisionTableSpecsV1,
  verifyWorkspaceContentRevisionV1,
} from '../../src/lib/authoring/content-revision'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function seed(): Promise<{
  scope: WorkspaceScope
  primaryGroupId: number
  siblingGroupId: number
  primaryWorldviewId: number
  siblingWorldviewId: number
}> {
  const now = Date.now()
  const createdWorkspaceV1 = await seedCurrentWorkspace('WEH-0C 修订向量', { enableMultiWorld: true })
  const { projectId, worldId, workId } = createdWorkspaceV1.scope
  const primaryGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主世界', description: '', type: 'primary', order: 0,
    createdAt: now, updatedAt: now,
  } as any) as number
  const siblingGroupId = await db.worldGroups.add({
    projectId, worldId, name: '镜世界', description: '', type: 'parallel', order: 1,
    createdAt: now, updatedAt: now,
  } as any) as number
  const primaryWorldviewId = await db.worldviews.add({
    projectId, worldId, worldGroupId: primaryGroupId, races: '潮民',
    createdAt: now, updatedAt: now,
  } as any) as number
  const siblingWorldviewId = await db.worldviews.add({
    projectId, worldId, worldGroupId: siblingGroupId, races: '镜民',
    createdAt: now, updatedAt: now,
  } as any) as number
  return {
    scope: { projectId, worldId, workId },
    primaryGroupId,
    siblingGroupId,
    primaryWorldviewId,
    siblingWorldviewId,
  }
}

describe.sequential('WEH-0C · 作者编辑保存屏障', () => {
  beforeEach(() => resetPendingEditCoordinatorForTestsV1())
  afterEach(() => resetPendingEditCoordinatorForTestsV1())

  it('先调用 draft flusher，并等待它同步登记的持久化写入', async () => {
    const gate = deferred<void>()
    const order: string[] = []
    const unregister = registerPendingDraftFlusherV1(() => {
      order.push('flush-draft')
      void coordinatePendingEditV1({
        key: 'worldview:1',
        persist: async () => {
          order.push('write-start')
          await gate.promise
          order.push('write-end')
        },
      })
    })

    let settled = false
    const flushing = flushPendingEditsV1().then(receipt => {
      settled = true
      return receipt
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['flush-draft', 'write-start'])
    expect(settled).toBe(false)

    gate.resolve()
    await expect(flushing).resolves.toEqual({
      version: 1,
      draftFlushersInvoked: 1,
      writesAwaited: 1,
    })
    expect(order).toEqual(['flush-draft', 'write-start', 'write-end'])
    unregister()
  })

  it('同一记录写入严格串行，失败在后续成功保存前持续阻断正式生成', async () => {
    const first = coordinatePendingEditV1({
      key: 'character:7',
      persist: async () => { throw new Error('磁盘写入失败') },
    })
    await expect(first).rejects.toThrow('磁盘写入失败')
    await expect(flushPendingEditsV1()).rejects.toThrow('作者编辑保存失败')
    expect(pendingEditDiagnosticsV1().failedKeys).toEqual(['character:7'])

    await coordinatePendingEditV1({ key: 'character:7', persist: async () => undefined })
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
    expect(pendingEditDiagnosticsV1().failedKeys).toEqual([])
  })
})

describe.sequential('WEH-0C · PROJECT_TABLES 派生内容修订向量', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })
  afterEach(() => db.close())

  it('只纳入注册表声明的 Canon/工作区投影表，不另建手写表清单', () => {
    const names = contentRevisionTableSpecsV1().map(spec => spec.name)
    expect(names).toContain('worldviews')
    expect(names).toContain('storyCores')
    expect(names).toContain('outlineNodes')
    expect(names).not.toContain('agentEvents')
    expect(names).not.toContain('agentRuns')
    expect(names).not.toContain('narrativeSummaryNodes')
    expect(names).toEqual([...names].sort((left, right) => left.localeCompare(right)))
  })

  it('当前世界的 Canon 变化使候选 stale，兄弟世界的 world-scoped 正文不会串入', async () => {
    const fixture = await seed()
    const frozen = await captureWorkspaceContentRevisionV1({
      scope: fixture.scope,
      worldGroupId: fixture.primaryGroupId,
    })

    await db.worldviews.update(fixture.siblingWorldviewId, { races: '镜民新版' })
    await expect(verifyWorkspaceContentRevisionV1(frozen, {
      scope: fixture.scope,
      worldGroupId: fixture.primaryGroupId,
    })).resolves.toMatchObject({ fresh: true, changedTables: [] })

    await db.worldviews.update(fixture.primaryWorldviewId, { races: '潮民新版' })
    const stale = await verifyWorkspaceContentRevisionV1(frozen, {
      scope: fixture.scope,
      worldGroupId: fixture.primaryGroupId,
    })
    expect(stale.fresh).toBe(false)
    expect(stale.changedTables).toContain('worldviews')
  })
})
