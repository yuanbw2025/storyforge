import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { useWorldRulesStore } from '../../src/stores/world-rules'
import { addCurrentWorkFixtureV1, addCurrentWorldFixtureV1 } from '../helpers/current-workspace'
import { switchActiveWork } from '../../src/lib/workspace/works'
import { createPortableResourceUidV1 } from '../../src/lib/context-gateway/resource-uid'
import { getTableSpec } from '../../src/lib/workspace/scope'
import type { RagDocumentMetadata } from '../../src/lib/types/rag-library'
import { useWorldGroupStore } from '../../src/stores/world-group'
import WorldRulesPanel from '../../src/components/worldview/WorldRulesPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

const initialStore = useWorldRulesStore.getState()
const initialGroups = useWorldGroupStore.getState()
const draft = '作者世界规则输入 e\u0301 😀，不能在未保存时声称成功。'
let host: HTMLDivElement | undefined
let mounted: ReturnType<typeof createRoot> | undefined
beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  resetPendingEditCoordinatorForTestsV1()
  useWorldRulesStore.setState({ ...initialStore, profile: null, loading: false, activeWorldGroupId: null }, true)
  useWorldGroupStore.setState(initialGroups, true)
  await db.delete(); await db.open()
})
afterEach(async () => {
  if (mounted) await act(async () => mounted?.unmount())
  mounted = undefined; host?.remove(); host = undefined
  vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1(); db.close()
})

async function fixture(multi = false) {
  const made = await createWorkspace({ name: '世界规则可靠保存', description: '', genres: [], status: 'drafting', targetWordCount: 100_000, enableMultiWorld: multi },
    { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
  let primaryId: number | null = null, otherId: number | null = null
  if (multi) {
    primaryId = await useWorldGroupStore.getState().ensurePrimaryGroup(made.scope)
    otherId = await useWorldGroupStore.getState().createGroup({ projectId: made.scope.projectId, name: '平行乙', type: 'parallel', description: '', order: 1 }, made.scope)
    await useWorldGroupStore.getState().loadAll(made.scope)
  }
  await useWorldRulesStore.getState().loadProfile(made.scope, primaryId)
  const profile = useWorldRulesStore.getState().profile
  if (!profile?.id) throw new Error('真实规则profile未加载')
  return { ...made, profile, primaryId, otherId }
}

it('rejects a target deleted after loading, retains the author draft, and does not recreate the target', async () => {
  const f = await fixture()
  const realUpdate = db.worldRulesProfiles.update.bind(db.worldRulesProfiles)
  const counts: number[] = []
  vi.spyOn(db.worldRulesProfiles, 'update').mockImplementation((key, patch) => realUpdate(key, patch).then(count => { counts.push(count); return count }))
  await db.worldRulesProfiles.delete(f.profile.id!)
  const [outcome] = await Promise.allSettled([useWorldRulesStore.getState().updateGlobalNote(draft)])
  console.info('SFQA121_ACTUAL_DELETED_SAVE', JSON.stringify({ status: outcome.status, updateResults: counts,
    targetExists: (await db.worldRulesProfiles.get(f.profile.id!)) != null, retainedNote: useWorldRulesStore.getState().profile?.globalNote }))
  expect(outcome.status).toBe('rejected')
  expect(useWorldRulesStore.getState().profile?.globalNote).toBe(draft)
  expect(await db.worldRulesProfiles.get(f.profile.id!)).toBeUndefined()
  await expect(flushPendingEditsV1()).rejects.toThrow('保存失败')
})

it('rejects an actual row-owner change instead of trusting the stale cached profile', async () => {
  const f = await fixture()
  const otherWorld = await addCurrentWorldFixtureV1({ projectId: f.scope.projectId, name: '不得被写入的World' })
  await db.worldRulesProfiles.update(f.profile.id!, { worldId: otherWorld.id! } as Partial<typeof f.profile>)
  const before = await db.worldRulesProfiles.get(f.profile.id!)
  const [outcome] = await Promise.allSettled([useWorldRulesStore.getState().updateGlobalNote(draft)])
  const after = await db.worldRulesProfiles.get(f.profile.id!)
  console.info('SFQA121_ACTUAL_OWNER_SAVE', JSON.stringify({ status: outcome.status,
    originalWorld: f.scope.worldId, currentRowWorld: Reflect.get(after!, 'worldId'), storedNote: after?.globalNote }))
  expect(outcome.status).toBe('rejected')
  expect(after).toEqual(before)
  expect(useWorldRulesStore.getState().profile?.globalNote).toBe(draft)
  await expect(flushPendingEditsV1()).rejects.toThrow('保存失败')
})

it('normally persists entries, custom nodes and global notes through the same writer and refresh', async () => {
  const f = await fixture(), store = useWorldRulesStore.getState()
  await store.updateEntry('era.period', 'historicalAnchors', draft)
  await store.updateEntry('era.period', 'fictionalAdaptations', '作者架空设定\r\n第二行')
  await store.updateEntry('era.period', 'priority', 'fictional')
  await store.updateGlobalNote(draft)
  const id = await store.addCustomNode({ parentId: null, label: '作者自定义', icon: '🔖' })
  await store.updateCustomNode(id, { label: '自定义修订', hints: ['仍由作者决定'] })
  await store.updateEntry(id, 'historicalAnchors', '自定义依据')
  const expected = useWorldRulesStore.getState().profile!
  await store.loadProfile(f.scope)
  const readback = useWorldRulesStore.getState().profile!
  expect([readback.entries, readback.customNodes, readback.globalNote]).toEqual([expected.entries, expected.customNodes, expected.globalNote])
  expect(readback.id).toBe(f.profile.id)
  expect(useWorldRulesStore.getState().dirty).toBe(false)
  await store.deleteEntry('era.period'); await store.deleteCustomNode(id)
  const saved = (await db.worldRulesProfiles.get(f.profile.id!))!
  expect(saved.entries).toEqual({}); expect(saved.customNodes).toEqual([]); expect(saved.globalNote).toBe(draft)
  await flushPendingEditsV1()
})

it('rejects a real zero-row UPDATE after a native deletion in the same transaction and rolls it back', async () => {
  const f = await fixture(), before = await db.worldRulesProfiles.get(f.profile.id!)
  const update = db.worldRulesProfiles.update.bind(db.worldRulesProfiles), counts: number[] = []
  const spy = vi.spyOn(db.worldRulesProfiles, 'update').mockImplementationOnce((key, patch) =>
    db.worldRulesProfiles.delete(f.profile.id!).then(() => update(key, patch).then(count => { counts.push(count); return count })))
  await expect(useWorldRulesStore.getState().updateGlobalNote(draft)).rejects.toThrow('未更新')
  expect(counts).toEqual([0]); spy.mockRestore()
  expect(await db.worldRulesProfiles.get(f.profile.id!)).toEqual(before)
  expect(useWorldRulesStore.getState().profile?.globalNote).toBe(draft)
  await expect(flushPendingEditsV1()).rejects.toThrow('保存失败')
})

it('retains the draft after a transaction failure, blocks reloading another owner, and explicitly retries', async () => {
  const f = await fixture(), before = await db.worldRulesProfiles.get(f.profile.id!)
  const update = db.worldRulesProfiles.update.bind(db.worldRulesProfiles)
  const failure = new Error('隔离事务提交前失败')
  const spy = vi.spyOn(db.worldRulesProfiles, 'update').mockImplementationOnce((key, patch) => update(key, patch).then(() => { throw failure }))
  await expect(useWorldRulesStore.getState().updateGlobalNote(draft)).rejects.toBe(failure)
  spy.mockRestore()
  expect(await db.worldRulesProfiles.get(f.profile.id!)).toEqual(before)
  expect(useWorldRulesStore.getState().profile?.globalNote).toBe(draft)
  expect(useWorldRulesStore.getState().failureToken).not.toBeNull()
  await expect(useWorldRulesStore.getState().loadProfile(f.scope, 999)).rejects.toThrow('草稿尚未保存')
  expect(await db.worldRulesProfiles.count()).toBe(1)
  await expect(flushPendingEditsV1()).rejects.toThrow('保存失败')
  await useWorldRulesStore.getState()._persist()
  expect((await db.worldRulesProfiles.get(f.profile.id!))?.globalNote).toBe(draft)
  expect(useWorldRulesStore.getState().dirty).toBe(false)
  await flushPendingEditsV1()
})

it('keeps its original World writer after actual active roots switch to another valid World', async () => {
  const f = await fixture()
  const world = await addCurrentWorldFixtureV1({ projectId: f.scope.projectId, name: '活动World乙' })
  const work = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: world.id!, create: { title: '乙作品', kind: 'novel', novelProfile: 'long' } })
  const other = { projectId: f.scope.projectId, worldId: world.id!, workId: work.id! }
  await useWorldRulesStore.getState().loadProfile(other)
  const otherProfile = useWorldRulesStore.getState().profile!
  const before = await db.worldRulesProfiles.get(otherProfile.id!)
  await useWorldRulesStore.getState().loadProfile(f.scope)
  await switchActiveWork(f.scope.projectId, work.id!)
  await useWorldRulesStore.getState().updateGlobalNote(draft)
  expect((await db.worldRulesProfiles.get(f.profile.id!))?.globalNote).toBe(draft)
  expect(await db.worldRulesProfiles.get(otherProfile.id!)).toEqual(before)
  expect(useWorldRulesStore.getState().loadedScope).toEqual(f.scope)
})

it('rejects a replacement UID on the same physical row without overwriting the replacement', async () => {
  const f = await fixture(), identity = getTableSpec('worldRulesProfiles').resourceIdentity!
  await db.worldRulesProfiles.update(f.profile.id!, { [identity.field]: createPortableResourceUidV1(identity.resourceKind) } as Partial<typeof f.profile & RagDocumentMetadata>)
  const before = await db.worldRulesProfiles.get(f.profile.id!)
  await expect(useWorldRulesStore.getState().updateGlobalNote(draft)).rejects.toThrow('身份已变化')
  expect(await db.worldRulesProfiles.get(f.profile.id!)).toEqual(before)
  expect(useWorldRulesStore.getState().profile?.globalNote).toBe(draft)
})

it('rejects a changed real WorldGroup target even when the Project and World still match', async () => {
  const f = await fixture(true)
  await db.worldRulesProfiles.update(f.profile.id!, { worldGroupId: f.otherId! })
  const before = await db.worldRulesProfiles.get(f.profile.id!)
  await expect(useWorldRulesStore.getState().updateGlobalNote(draft)).rejects.toThrow('归属已变化')
  expect(await db.worldRulesProfiles.get(f.profile.id!)).toEqual(before)
  expect(useWorldRulesStore.getState().profile?.worldGroupId).toBe(f.primaryId)
  expect(useWorldRulesStore.getState().profile?.globalNote).toBe(draft)
})

it('saves rapid immutable author snapshots in order without acknowledging an older snapshot as the latest', async () => {
  const f = await fixture(), store = useWorldRulesStore.getState()
  await Promise.all([store.updateEntry('era.period', 'historicalAnchors', draft), store.updateGlobalNote('前一个版本'), store.updateGlobalNote(draft)])
  const saved = (await db.worldRulesProfiles.get(f.profile.id!))!
  expect(saved.entries['era.period'].historicalAnchors).toBe(draft)
  expect(saved.globalNote).toBe(draft)
  expect(useWorldRulesStore.getState().pendingSaves).toBe(0)
  expect(useWorldRulesStore.getState().dirty).toBe(false)
  await flushPendingEditsV1()
})

it('rejects a missing saved readback and rolls back the attempted write', async () => {
  const f = await fixture(), before = await db.worldRulesProfiles.get(f.profile.id!)
  const get = db.worldRulesProfiles.get.bind(db.worldRulesProfiles)
  let reads = 0
  const spy = vi.spyOn(db.worldRulesProfiles, 'get').mockImplementation(key => get(key).then(row => ++reads === 2 ? undefined : row))
  await expect(useWorldRulesStore.getState().updateGlobalNote(draft)).rejects.toThrow('回读未通过')
  spy.mockRestore()
  expect(reads).toBe(2)
  expect(await db.worldRulesProfiles.get(f.profile.id!)).toEqual(before)
  expect(useWorldRulesStore.getState().profile?.globalNote).toBe(draft)
})

async function mountPanel(f: Awaited<ReturnType<typeof fixture>>) {
  host = document.createElement('div'); document.body.append(host); mounted = createRoot(host)
  await act(async () => mounted!.render(createElement(DialogProvider, { children: createElement(WorldRulesPanel, { project: f.project }) })))
  await vi.waitFor(() => expect(host!.querySelector('textarea[placeholder^="例如：本作"]')).not.toBeNull())
}
function noteInput() { return host!.querySelector<HTMLTextAreaElement>('textarea[placeholder^="例如：本作"]')! }
async function typeNote(value = draft) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(noteInput(), value)
    noteInput().dispatchEvent(new Event('input', { bubbles: true }))
    await flushPendingEditsV1().catch(() => undefined)
  })
}
async function click(text: string) {
  await act(async () => {
    [...host!.querySelectorAll('button')].find(button => button.textContent?.trim() === text)!.click()
    await flushPendingEditsV1().catch(() => undefined)
  })
}

it('actual Panel forwards entry and custom-node input to the same durable profile', async () => {
  const f = await fixture(); await mountPanel(f)
  await act(async () => [...host!.querySelectorAll('button')].find(button => button.textContent?.includes('总览'))!.click())
  const field = host!.querySelector<HTMLTextAreaElement>('textarea[placeholder^="这个维度中有哪些内容是取自真实"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, draft)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPendingEditsV1()
  })
  await act(async () => [...host!.querySelectorAll('button')].find(button => button.textContent?.includes('添加大类'))!.click())
  const label = host!.querySelector<HTMLInputElement>('input[placeholder="新大类名称"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(label, '作者自定义类目')
    label.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    host!.querySelector<HTMLButtonElement>('button[aria-label="确认添加大类"]')!.click()
    await flushPendingEditsV1()
  })
  const saved = (await db.worldRulesProfiles.get(f.profile.id!))!
  expect(saved.entries.era.historicalAnchors).toBe(draft)
  expect(saved.customNodes).toEqual([expect.objectContaining({ label: '作者自定义类目' })])
  expect(host!.querySelector('input[placeholder="新大类名称"]')).toBeNull()
})

it('actual Panel keeps input and a visible quota failure, guards close, and retries the original writer', async () => {
  const f = await fixture(); await mountPanel(f)
  const spy = vi.spyOn(db.worldRulesProfiles, 'update').mockRejectedValueOnce(new DOMException('隔离Quota写入失败', 'QuotaExceededError'))
  await typeNote(); spy.mockRestore()
  expect(noteInput().value).toBe(draft)
  expect(host!.querySelector('[role="alert"]')?.textContent).toContain('输入仍保留')
  expect((await db.worldRulesProfiles.get(f.profile.id!))?.globalNote).toBe('')
  const blocked = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(blocked)
  expect(blocked.defaultPrevented).toBe(true)
  await click('重试保存规则')
  expect((await db.worldRulesProfiles.get(f.profile.id!))?.globalNote).toBe(draft)
  expect(useWorldRulesStore.getState().dirty).toBe(false)
  await flushPendingEditsV1()
})

it('actual Panel does not publish an older failed edit after a newer queued edit has really saved', async () => {
  const f = await fixture(); await mountPanel(f)
  const update = db.worldRulesProfiles.update.bind(db.worldRulesProfiles)
  let attempts = 0, injectedFailures = 0
  const spy = vi.spyOn(db.worldRulesProfiles, 'update').mockImplementation((key, patch) => {
    const attempt = ++attempts
    return update(key, patch).then(result => {
      if (attempt === 1) { injectedFailures++; throw new Error('A较早保存失败') }
      return result
    })
  })
  const newer = 'B随后输入已经真实保存'
  await act(async () => {
    for (const value of ['A旧输入', newer]) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(noteInput(), value)
      noteInput().dispatchEvent(new Event('input', { bubbles: true }))
    }
    await flushPendingEditsV1()
  })
  spy.mockRestore()
  expect(attempts).toBe(2); expect(injectedFailures).toBe(1)
  expect((await db.worldRulesProfiles.get(f.profile.id!))?.globalNote).toBe(newer)
  expect(noteInput().value).toBe(newer)
  expect(useWorldRulesStore.getState().dirty).toBe(false)
  expect(useWorldRulesStore.getState().saveError).toBe('')
  console.info('SFQA121_ACTION_ORDER', JSON.stringify({ attempts, injectedFailures, saved: newer,
    storeDirty: useWorldRulesStore.getState().dirty, visibleAlert: host!.querySelector('[role="alert"]')?.textContent ?? null }))
  expect(host!.querySelector('[role="alert"]')).toBeNull()
})

it('actual Panel preserves an independent real load failure across a successful edit until loading is retried', async () => {
  const f = await fixture()
  let actualReadFailures = 0
  const fault = () => {
    db.worldRulesProfiles.hook('reading').unsubscribe(fault)
    actualReadFailures++
    throw new Error('真实规则加载失败')
  }
  db.worldRulesProfiles.hook('reading', fault)
  await mountPanel(f)
  expect(actualReadFailures).toBe(1)
  expect(host!.querySelector('[role="alert"]')?.textContent).toContain('真实规则加载失败')
  await typeNote()
  expect((await db.worldRulesProfiles.get(f.profile.id!))?.globalNote).toBe(draft)
  expect(useWorldRulesStore.getState().dirty).toBe(false)
  expect(host!.querySelector('[role="alert"]')?.textContent).toContain('真实规则加载失败')
  await click('重试加载规则')
  await act(async () => { await vi.waitFor(() => expect(useWorldRulesStore.getState().loading).toBe(false)) })
  expect(host!.querySelector('[role="alert"]')).toBeNull()
  expect(noteInput().value).toBe(draft)
})

it('actual Panel blocks a world-tab switch after deletion and explicitly abandons only its failed draft', async () => {
  const f = await fixture(true); await mountPanel(f)
  await db.worldRulesProfiles.delete(f.profile.id!)
  await typeNote()
  expect(noteInput().value).toBe(draft)
  await act(async () => {
    [...host!.querySelectorAll('button')].find(button => button.textContent?.includes('平行乙'))!.click()
    await flushPendingEditsV1().catch(() => undefined)
  })
  expect(useWorldRulesStore.getState().activeWorldGroupId).toBe(f.primaryId)
  expect(noteInput().value).toBe(draft)
  expect(await db.worldRulesProfiles.count()).toBe(0)
  await click('放弃未保存规则输入')
  expect(useWorldRulesStore.getState().profile).toBeNull()
  expect(host!.textContent).toContain('可以切换页面')
  await flushPendingEditsV1()
  expect(await db.worldRulesProfiles.count()).toBe(0)
})
