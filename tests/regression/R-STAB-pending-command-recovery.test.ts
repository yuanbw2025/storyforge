import { afterEach, describe, expect, it } from 'vitest'
import { acknowledgePendingEditFailureV1, capturePendingEditFailureV1, coordinatePendingEditV1, flushPendingEditsV1, pendingEditDiagnosticsV1, registerPendingDraftFlusherV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

describe('STAB · command failure acknowledgement preserves other author barriers', () => {
  afterEach(resetPendingEditCoordinatorForTestsV1)
  async function fail(key: string, error = new Error(key)) {
    await expect(coordinatePendingEditV1({ key, persist: async () => { throw error } })).rejects.toBe(error)
    return capturePendingEditFailureV1(error)!
  }
  it('explicit abandonment clears only the received failure and does not perform a write', async () => {
    const first = await fail('arc:1'); await fail('arc:2')
    acknowledgePendingEditFailureV1({ token: first, decision: 'abandon-command' })
    expect(pendingEditDiagnosticsV1().failedKeys).toEqual(['arc:2'])
    await expect(flushPendingEditsV1()).rejects.toThrow('arc:2')
  })
  it('an older token cannot acknowledge a newer rejected write for the same record', async () => {
    const old = await fail('arc:1'); const current = await fail('arc:1')
    expect(() => acknowledgePendingEditFailureV1({ token: old, decision: 'retry-command' })).toThrow('变化')
    expect(current.writeId).not.toBe(old.writeId)
    expect(pendingEditDiagnosticsV1().failedKeys).toEqual(['arc:1'])
  })
  it('acknowledgement cannot hide an in-flight write', async () => {
    const token = await fail('arc:1'); let release!: () => void
    const pending = coordinatePendingEditV1({ key: 'arc:1', persist: () => new Promise<void>(resolve => { release = resolve }) })
    await Promise.resolve(); await Promise.resolve()
    expect(() => acknowledgePendingEditFailureV1({ token, decision: 'abandon-command' })).toThrow('仍在执行')
    release(); await pending
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
  })
  it('a retry acknowledgement still cannot bypass a dirty or failed text draft', async () => {
    const token = await fail('arc:1')
    const unregister = registerPendingDraftFlusherV1(() => { throw new Error('未保存的作者文字') })
    acknowledgePendingEditFailureV1({ token, decision: 'retry-command' })
    await expect(flushPendingEditsV1()).rejects.toThrow('未保存的作者文字')
    unregister(); await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
  })
  it('forged, ambiguous and invalid decisions cannot erase failures', async () => {
    const error = new Error('shared'); const token = await fail('arc:1', error)
    await fail('arc:2', error)
    expect(capturePendingEditFailureV1(error)).toBeUndefined()
    expect(() => acknowledgePendingEditFailureV1({ token: { ...token, writeId: 999 }, decision: 'abandon-command' })).toThrow('变化')
    expect(() => acknowledgePendingEditFailureV1({ token, decision: 'saved' as any })).toThrow('无效')
    expect(pendingEditDiagnosticsV1().failedKeys).toEqual(['arc:1', 'arc:2'])
  })
})
