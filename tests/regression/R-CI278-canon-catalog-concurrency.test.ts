import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'
import { contextGatewayCacheEpochV1, invalidateContextGatewayCacheV1, restoreContextGatewayCacheReliabilityV1 } from '../../src/lib/context-gateway/provider-cache'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampCurrentFixtureResourceUidsV1 } from '../helpers/current-resource-identity'
import type { ResourcePageV1 } from '../../src/lib/registry/types'

beforeEach(async () => { await db.delete(); await db.open(); restoreContextGatewayCacheReliabilityV1() })
afterEach(() => { vi.restoreAllMocks(); db.close() })

async function fixture() {
  const f = await seedCurrentWorkspace('CI278目录与执行账本')
  const worldviewId = await db.worldviews.add(stampNewRecord(f.scope, 'worldviews', {
    projectId: f.scope.projectId,
    worldGroupId: null, worldOrigin: '第一座城在潮汐退去后出现。', powerHierarchy: '潮印由月轮驱动。',
    createdAt: 1, updatedAt: 1,
  }, { owner: 'world' })) as number
  await stampCurrentFixtureResourceUidsV1(f.scope.projectId)
  return { ...f, worldviewId }
}

// Keep all domain reads and hashes real. Only pause the native digest after a
// real Canon row was read, so a real DB commit deterministically overlaps it.
async function overlap(f: Awaited<ReturnType<typeof fixture>>, write: () => Promise<unknown>) {
  let rowRead = false
  let gated = false
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const resume = new Promise<void>(resolve => { release = resolve })
  const reading = (row: unknown) => { rowRead = true; return row }
  db.worldviews.hook('reading', reading)
  const digest = crypto.subtle.digest.bind(crypto.subtle)
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => {
    if (rowRead && !gated) { gated = true; entered(); await resume }
    return digest(algorithm, bytes)
  })
  const result = CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: f.scope, limit: 100 }).then(
    value => ({ value, error: null } as { value: ResourcePageV1 | null; error: unknown }),
    error => ({ value: null, error } as { value: ResourcePageV1 | null; error: unknown }),
  )
  try {
    await started
    const epoch = contextGatewayCacheEpochV1()
    await write()
    await expect.poll(() => contextGatewayCacheEpochV1()).toBeGreaterThan(epoch)
    release()
    return await result
  } finally {
    release()
    db.worldviews.hook('reading').unsubscribe(reading)
    spy.mockRestore()
  }
}

it('normal Harness conversation persistence does not invalidate an in-flight Canon catalog', async () => {
  const f = await fixture()
  const result = await overlap(f, () => getOrCreateAgentConversation({
    projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, purpose: 'master-authoring',
  }))
  expect(result.error).toBeNull()
  expect(result.value!.items.some(item => item.sourceRefs.some(ref => ref.table === 'worldviews'))).toBe(true)
  expect(await db.agentConversations.count()).toBe(1)
})

it('a real Canon edit still rejects the in-flight catalog rather than certifying mixed versions', async () => {
  const f = await fixture()
  const result = await overlap(f, () => db.worldviews.update(f.worldviewId, { worldOrigin: '作者已把旧城改为新岛。' }))
  expect(result.value).toBeNull()
  expect(String(result.error)).toContain('[canon-resource:catalog-mutated]')
  expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe('作者已把旧城改为新岛。')
})

it('deleting the owner during catalog construction fails closed', async () => {
  const f = await fixture()
  const result = await overlap(f, () => db.works.delete(f.scope.workId))
  expect(result.value).toBeNull()
  expect(result.error).toBeInstanceOf(Error)
})

it('a cursor survives unrelated Harness persistence while retaining the same Canon page boundary', async () => {
  const f = await fixture()
  const first = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: f.scope, limit: 1 })
  expect(first.nextCursor).not.toBeNull()
  const epoch = contextGatewayCacheEpochV1()
  await getOrCreateAgentConversation({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, purpose: 'master-authoring' })
  await expect.poll(() => contextGatewayCacheEpochV1()).toBeGreaterThan(epoch)
  const next = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: f.scope, limit: 1, cursor: first.nextCursor! })
  expect(next.items).toHaveLength(1)
  expect(next.items[0].resourceKey).not.toBe(first.items[0].resourceKey)
})

it('a cursor still rejects an actual Canon change between pages', async () => {
  const f = await fixture()
  const first = await CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: f.scope, limit: 1 })
  expect(first.nextCursor).not.toBeNull()
  const epoch = contextGatewayCacheEpochV1()
  await db.worldviews.update(f.worldviewId, { worldOrigin: '作者在翻页期间改写城的起源。' })
  await expect.poll(() => contextGatewayCacheEpochV1()).toBeGreaterThan(epoch)
  await expect(CANON_RESOURCE_PROVIDER_V1.listMetadata({ scope: f.scope, limit: 1, cursor: first.nextCursor! })).rejects.toThrow()
})

it('a real source policy change still rejects the in-flight catalog', async () => {
  const f = await fixture()
  const result = await overlap(f, () => db.worldviews.update(f.worldviewId, { ragPolicy: { enabled: false } }))
  expect(result.value).toBeNull()
  expect(String(result.error)).toContain('[canon-resource:catalog-mutated]')
})

it('explicit cache uncertainty still fences an in-flight catalog across all tables', async () => {
  const f = await fixture()
  const result = await overlap(f, async () => { invalidateContextGatewayCacheV1('explicit-unknown-boundary') })
  expect(result.value).toBeNull()
  expect(String(result.error)).toContain('[canon-resource:catalog-mutated]')
})
