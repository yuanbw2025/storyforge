import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import * as ownership from '../../src/lib/workspace/scope'
import { useStorylineProgressStore } from '../../src/stores/storyline-progress'

function deferred() { let resolve!: (rows: any[]) => void; let reject!: (error: Error) => void; const promise = new Promise<any[]>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
async function fixture(name: string) {
  const f = await seedCurrentWorkspace(name)
  const base = { projectId: f.scope.projectId, createdAt: 1, updatedAt: 1 }
  const arcId = await db.storyArcs.add(ownership.stampNewRecord(f.scope, 'storyArcs', { ...base, name, type: 'main', description: '原稿', stages: '[]' }, { owner: 'work' })) as number
  const progressId = await db.storylineProgress.add(ownership.stampNewRecord(f.scope, 'storylineProgress', { ...base, arcId, currentStageId: null, status: 'active', progressNote: name, lastActiveChapterId: null, lastActiveChapterTitle: '', involvedEntities: '[]', evidenceQuote: '' }, { owner: 'work' })) as number
  return { ...f, row: (await db.storylineProgress.get(progressId))! }
}
describe.sequential('STAB · story progress load failure and scope handoff', () => {
  beforeEach(async () => { await db.delete(); await db.open(); useStorylineProgressStore.setState({ progress: [], crossings: [], loading: false }) })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('read failure is observable, clears stale projections and stops loading without claiming empty success', async () => {
    const f = await fixture('需保留的正式进度'); await useStorylineProgressStore.getState().loadAll(f.scope)
    vi.spyOn(ownership, 'readOwnedRows').mockRejectedValue(new Error('隔离进度读取故障'))
    await expect(useStorylineProgressStore.getState().loadAll(f.scope)).rejects.toThrow('隔离进度读取故障')
    const state = useStorylineProgressStore.getState() as any
    expect(state.loading).toBe(false); expect(state.progress).toEqual([]); expect(state.crossings).toEqual([])
    expect(state.loadError).toContain('隔离进度读取故障'); expect(state.loadedScope).toBeNull()
    expect(await db.storylineProgress.get(f.row.id!)).toEqual(f.row)
  })
  it('late data from a previous Work cannot replace the newer Work projection', async () => {
    const a = await fixture('旧作品进度'); const b = await fixture('新作品进度'); const progress = deferred(); const crossings = deferred()
    const read = ownership.readOwnedRows
    vi.spyOn(ownership, 'readOwnedRows').mockImplementation(((scope: any, table: string, options: any) => scope.workId === a.scope.workId ? (table === 'storylineProgress' ? progress.promise : crossings.promise) : read(scope, table, options)) as any)
    const older = useStorylineProgressStore.getState().loadAll(a.scope)
    await vi.waitFor(() => expect(ownership.readOwnedRows).toHaveBeenCalledTimes(2))
    await useStorylineProgressStore.getState().loadAll(b.scope)
    progress.resolve([a.row]); crossings.resolve([]); await older
    expect(useStorylineProgressStore.getState().progress).toEqual([b.row])
    expect((useStorylineProgressStore.getState() as any).loadedScope).toEqual(b.scope)
  })
  it('an old failed request cannot clear a successful newer Work or replace its error state', async () => {
    const a = await fixture('旧作品'); const b = await fixture('当前作品'); const progress = deferred(); const crossings = deferred()
    const read = ownership.readOwnedRows
    vi.spyOn(ownership, 'readOwnedRows').mockImplementation(((scope: any, table: string, options: any) => scope.workId === a.scope.workId ? (table === 'storylineProgress' ? progress.promise : crossings.promise) : read(scope, table, options)) as any)
    const older = useStorylineProgressStore.getState().loadAll(a.scope).catch(error => error)
    await vi.waitFor(() => expect(ownership.readOwnedRows).toHaveBeenCalledTimes(2))
    await useStorylineProgressStore.getState().loadAll(b.scope)
    progress.reject(new Error('旧页迟到的读取故障')); crossings.resolve([]); await older
    const state = useStorylineProgressStore.getState() as any
    expect(state.progress).toEqual([b.row]); expect(state.loadError).toBeNull(); expect(state.loadedScope).toEqual(b.scope)
  })
})
