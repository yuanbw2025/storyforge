import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { useCharacterStore } from '../../src/stores/character'
import { useStateCardStore } from '../../src/stores/state-card'
import { stringifyFields } from '../../src/lib/types/state-card'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import StatePanel from '../../src/components/state/StatePanel'

const original = 'A正式状态'
const draft = '作者尚未保存的新输入 e\u0301 😀'
const external = 'B其他页面正式更新的状态'
let host: HTMLDivElement
let mounted: ReturnType<typeof createRoot> | undefined

beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  resetPendingEditCoordinatorForTestsV1()
  await db.delete(); await db.open()
  useCharacterStore.setState({ characters: [], loading: false, loadedScope: null, loadError: null })
  useStateCardStore.setState({ cards: [], loading: false, loadedScope: null })
  host = document.createElement('div'); document.body.append(host); mounted = createRoot(host)
})
afterEach(async () => {
  await act(async () => mounted?.unmount())
  host.remove(); vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1(); db.close()
})

async function fixture(kind: 'character' | 'standalone') {
  const created = await createWorkspace({ name: '状态字段编辑', description: '', genres: ['fantasy'], status: 'drafting', targetWordCount: 100_000 },
    { purpose: 'independent-work', kind: 'novel', novelProfile: 'long', importedNovelText: '作者隔离测试章节，作为真实状态来源。' })
  const entityName = kind === 'character' ? '李明' : '独立门口'
  if (kind === 'character') await useCharacterStore.getState().addCharacter({
    projectId: created.scope.projectId, name: entityName, roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral',
    shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '[]', arc: '',
  })
  const id = await useStateCardStore.getState().addCard({ projectId: created.scope.projectId,
    category: kind === 'character' ? 'character' : 'location', entityName, fields: stringifyFields([{ key: '状态', value: original }]) })
  await act(async () => mounted!.render(createElement(StatePanel, { project: created.project,
    ...(kind === 'standalone' ? { initialStateCardId: id } : {}) })))
  await vi.waitFor(() => expect(host.querySelector('button[title="编辑状态"]')).not.toBeNull())
  await act(async () => (host.querySelector('button[title="编辑状态"]') as HTMLButtonElement).click())
  await vi.waitFor(() => expect(valueInput().value).toBe(original))
  return { ...created, id }
}

function valueInput() { return host.querySelector<HTMLInputElement>('input[placeholder="当前值"]')! }
async function typeDraft(value = draft) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(valueInput(), value)
    valueInput().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function click(text: string) {
  await act(async () => {
    [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === text)!.click()
    await flushPendingEditsV1().catch(() => undefined)
  })
}
async function save() { await click('保存') }

describe.each(['character', 'standalone'] as const)('SFQA-126 · %s author buffer', kind => {
  it('keeps the local author draft through metadata-only updates and normally saves the exact input', async () => {
    const f = await fixture(kind)
    await typeDraft()
    const chapter = await db.chapters.where('projectId').equals(f.scope.projectId).first()
    expect(chapter?.id).toBeDefined()
    await act(async () => { await useStateCardStore.getState().updateCard(f.id, { lastChapterId: chapter!.id! }, { scope: f.scope }) })
    expect(valueInput().value).toBe(draft)
    await save()
    expect((await db.stateCards.get(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: draft }]))
  })

  it('keeps the local draft when another public update changes fields, and exposes the conflict without overwriting it', async () => {
    const f = await fixture(kind)
    await typeDraft()
    const committed = stringifyFields([{ key: '状态', value: external }])
    await act(async () => { await useStateCardStore.getState().updateCard(f.id, { fields: committed }, { scope: f.scope }) })
    expect((await db.stateCards.get(f.id))?.fields).toBe(committed)
    expect(valueInput().value).toBe(draft)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('其他页面')
    expect(host.textContent).toContain(external)
  })

  it('preserves a named field with the valid empty-string value when the author clears it', async () => {
    const f = await fixture(kind)
    await typeDraft('')
    await save()
    expect((await db.stateCards.get(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: '' }]))
  })

  it('observes a persisted peer update without resetting or unmounting the dirty editor', async () => {
    const f = await fixture(kind)
    await typeDraft()
    const input = valueInput()
    const committed = stringifyFields([{ key: '状态', value: external }])
    await act(async () => { await db.stateCards.update(f.id, { fields: committed }) })
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
      expect(host.textContent).toContain(external)
    })
    expect(valueInput()).toBe(input)
    expect(valueInput().value).toBe(draft)
    await save()
    expect((await db.stateCards.get(f.id))?.fields).toBe(committed)
    await click('用本地输入替换已查看版本')
    expect((await db.stateCards.get(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: draft }]))
  })

  it('blocks unreviewed saves and pending navigation, then explicitly reloads the external version', async () => {
    const f = await fixture(kind)
    await typeDraft()
    const committed = stringifyFields([{ key: '状态', value: external }])
    await act(async () => { await useStateCardStore.getState().updateCard(f.id, { fields: committed }, { scope: f.scope }) })
    await save()
    expect(valueInput().value).toBe(draft)
    expect((await db.stateCards.get(f.id))?.fields).toBe(committed)
    await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('其他页面') })
    expect(valueInput().value).toBe(draft)
    await click('重载外部版本（舍弃本地输入）')
    expect(valueInput().value).toBe(external)
    await act(async () => { await flushPendingEditsV1() })
    expect((await db.stateCards.get(f.id))?.fields).toBe(committed)
  })

  it('uses the displayed external version as CAS when explicitly replacing, and rejects another intervening update', async () => {
    const f = await fixture(kind)
    await typeDraft()
    await act(async () => { await useStateCardStore.getState().updateCard(f.id, {
      fields: stringifyFields([{ key: '状态', value: external }]),
    }, { scope: f.scope }) })
    const realUpdate = useStateCardStore.getState().updateCard
    const hashing = await import('../../src/lib/registry/adopt')
    const originalHash = hashing.hashAdoptRecordFieldsV1
    let actualInterveningWrites = 0
    // Let the real public writer commit C after the UI captured reviewed B,
    // then return the original B hash: production CAS must reject this race.
    const hash = vi.spyOn(hashing, 'hashAdoptRecordFieldsV1').mockImplementationOnce(async (...args) => {
      hash.mockRestore()
      await realUpdate(f.id, { fields: stringifyFields([{ key: '状态', value: 'C稍后提交' }]) }, { scope: f.scope })
      actualInterveningWrites++
      return originalHash(...args)
    })
    await click('用本地输入替换已查看版本')
    expect(host.textContent).toContain('另一页面修改')
    expect(actualInterveningWrites).toBe(1)
    expect(valueInput().value).toBe(draft)
    expect((await db.stateCards.get(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: 'C稍后提交' }]))
    await click('用本地输入替换已查看版本')
    expect((await db.stateCards.get(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: draft }]))
  })

  it('still requires an explicit conflict decision when the author returns to the original text', async () => {
    const f = await fixture(kind)
    await typeDraft()
    await act(async () => { await useStateCardStore.getState().updateCard(f.id, {
      fields: stringifyFields([{ key: '状态', value: external }]),
    }, { scope: f.scope }) })
    await typeDraft(original)
    await save()
    expect(valueInput().value).toBe(original)
    expect((await db.stateCards.get(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: external }]))
    await click('用本地输入替换已查看版本')
    expect((await db.stateCards.get(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: original }]))
  })

  it('retains the draft on a real storage failure, blocks closing, and permits an explicit retry', async () => {
    const f = await fixture(kind)
    await typeDraft()
    const failure = new Error('隔离状态读取失败')
    const realGet = db.stateCards.get.bind(db.stateCards)
    const get = vi.spyOn(db.stateCards, 'get').mockRejectedValueOnce(failure)
    await save()
    expect(host.textContent).toContain(failure.message)
    expect(valueInput().value).toBe(draft)
    get.mockRestore()
    expect((await realGet(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: original }]))
    await act(async () => { (host.querySelector('button[title="编辑状态"]') as HTMLButtonElement).click() })
    expect(valueInput().value).toBe(draft)
    await save()
    expect((await realGet(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: draft }]))
  })

  it('flushes the pending exact draft before navigation or a normal Work switch', async () => {
    const f = await fixture(kind)
    await typeDraft()
    const work = await createWorldWork(f.scope.projectId, { kind: 'novel', novelProfile: 'long', title: '后续作品' })
    await act(async () => { await flushPendingEditsV1(); await switchActiveWork(f.scope.projectId, work.id!) })
    expect((await db.stateCards.get(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: draft }]))
    expect((await db.projects.get(f.scope.projectId))?.activeWorkId).toBe(work.id)
    expect((await db.stateCards.toArray()).filter(card => Reflect.get(card, 'workId') === work.id)).toHaveLength(0)
  })

  it('keeps its original Work writer if an external pointer change occurs before the save barrier', async () => {
    const f = await fixture(kind)
    await typeDraft()
    const work = await createWorldWork(f.scope.projectId, { kind: 'novel', novelProfile: 'long', title: '独立新作品' })
    await act(async () => {
      await switchActiveWork(f.scope.projectId, work.id!)
      const project = await db.projects.get(f.scope.projectId)
      if (!project) throw new Error('切换后的真实Project不存在')
      mounted!.render(createElement(StatePanel, { project, ...(kind === 'standalone' ? { initialStateCardId: f.id } : {}) }))
    })
    const before = await db.works.get(work.id!)
    await save()
    expect((await db.stateCards.get(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: draft }]))
    expect(await db.works.get(work.id!)).toEqual(before)
    expect((await db.stateCards.toArray()).filter(card => Reflect.get(card, 'workId') === work.id)).toHaveLength(0)
  })

  it('protects a composing or dirty draft on close and releases the guard only after an explicit discard', async () => {
    await fixture(kind)
    await act(async () => valueInput().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('输入法') })
    await act(async () => valueInput().dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
    await typeDraft()
    const blocked = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(blocked)
    expect(blocked.defaultPrevented).toBe(true)
    await click('放弃未保存输入')
    expect(host.querySelector('input[placeholder="当前值"]')).toBeNull()
    const allowed = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(allowed)
    expect(allowed.defaultPrevented).toBe(false)
    await act(async () => { await flushPendingEditsV1() })
  })

  it('does not acknowledge newer input received in the same tick as a pending save', async () => {
    const f = await fixture(kind)
    await typeDraft()
    let navigationError = ''
    const newer = '保存期间新输入，不能误报已落盘'
    await act(async () => {
      const pending = flushPendingEditsV1()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(valueInput(), newer)
      valueInput().dispatchEvent(new Event('input', { bubbles: true }))
      await pending.catch(cause => { navigationError = cause instanceof Error ? cause.message : String(cause) })
    })
    expect((await db.stateCards.get(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: draft }]))
    expect(valueInput().value).toBe(newer)
    expect(navigationError).toContain('新输入')
    await save()
    expect((await db.stateCards.get(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: newer }]))
  })
})

it('flushes before choosing another character, and a failed save keeps the first editor open', async () => {
  const f = await fixture('character')
  await act(async () => { await useCharacterStore.getState().addCharacter({
    projectId: f.scope.projectId, name: '第二角色', roleWeight: 'secondary', moralAxis: 'good', orderAxis: 'neutral',
    shortDescription: '', appearance: '', personality: '', background: '', motivation: '', abilities: '', relationships: '[]', arc: '',
  }) })
  await typeDraft()
  const get = vi.spyOn(db.stateCards, 'get').mockRejectedValueOnce(new Error('角色切换保存失败'))
  await act(async () => {
    const next = host.querySelectorAll<HTMLButtonElement>('button[title="编辑状态"]')[1]
    next.click()
    await flushPendingEditsV1().catch(() => undefined)
  })
  get.mockRestore()
  expect(valueInput().value).toBe(draft)
  expect(host.textContent).toContain('角色切换保存失败')
  expect((await db.stateCards.get(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: original }]))
  await save()
  await act(async () => host.querySelectorAll<HTMLButtonElement>('button[title="编辑状态"]')[1].click())
  await vi.waitFor(() => expect(valueInput().value).toBe(''))
  expect((await db.stateCards.get(f.id))?.fields).toBe(stringifyFields([{ key: '状态', value: draft }]))
})

it('creates a missing character card once and keeps later pending edits on that saved record', async () => {
  const f = await fixture('character')
  await save()
  await act(async () => { await useStateCardStore.getState().deleteCard(f.id) })
  await act(async () => (host.querySelector('button[title="编辑状态"]') as HTMLButtonElement).click())
  await vi.waitFor(() => expect(valueInput().value).toBe(''))
  await typeDraft()
  await act(async () => { await flushPendingEditsV1() })
  const [saved] = await db.stateCards.toArray()
  expect(saved?.id).not.toBe(f.id)
  expect(saved?.fields).toBe(stringifyFields([{ key: '当前状态', value: draft }]))
  await typeDraft('同一新卡继续编辑')
  await act(async () => { await flushPendingEditsV1() })
  expect(await db.stateCards.toArray()).toEqual([expect.objectContaining({ id: saved.id,
    fields: stringifyFields([{ key: '当前状态', value: '同一新卡继续编辑' }]),
  })])
})

it('freezes the new-card Work owner across a real switch between the Panel check and the public writer', async () => {
  const realAdd = useStateCardStore.getState().addCard
  let switchBeforeAdd: (() => Promise<void>) | undefined
  let actualSwitches = 0
  useStateCardStore.setState({ addCard: async (...args) => {
    if (switchBeforeAdd) {
      const switchNow = switchBeforeAdd; switchBeforeAdd = undefined
      await switchNow(); actualSwitches++
    }
    return realAdd(...args)
  } })
  try {
    const f = await fixture('character')
    await save()
    await act(async () => { await useStateCardStore.getState().deleteCard(f.id) })
    await act(async () => (host.querySelector('button[title="编辑状态"]') as HTMLButtonElement).click())
    await vi.waitFor(() => expect(valueInput().value).toBe(''))
    await typeDraft()
    const next = await createWorldWork(f.scope.projectId, { title: '不会接收旧作者输入的作品', kind: 'novel', novelProfile: 'long' })
    switchBeforeAdd = async () => {
      const current = await switchActiveWork(f.scope.projectId, next.id!)
      await useStateCardStore.getState().loadAll(current)
      const project = await db.projects.get(f.scope.projectId)
      if (!project) throw new Error('真实新作品的Project不存在')
      mounted!.render(createElement(StatePanel, { project }))
    }
    await save()
    const rows = await db.stateCards.toArray()
    console.info('SFQA126_ACTUAL_CREATE_OWNER', JSON.stringify({ actualSwitches, originalWorkId: f.scope.workId,
      activeWorkId: (await db.projects.get(f.scope.projectId))?.activeWorkId,
      rows: rows.map(row => ({ id: row.id, workId: Reflect.get(row, 'workId'), fields: row.fields })),
      visibleRows: useStateCardStore.getState().cards.map(row => row.id),
    }))
    expect(actualSwitches).toBe(1)
    expect(rows.filter(row => Reflect.get(row, 'workId') === next.id)).toHaveLength(0)
    expect(rows).toEqual([expect.objectContaining({ fields: stringifyFields([{ key: '当前状态', value: draft }]) })])
    expect(Reflect.get(rows[0], 'workId')).toBe(f.scope.workId)
    expect(useStateCardStore.getState().cards).toEqual([])
    expect(host.textContent).not.toContain(draft)
  } finally {
    await act(async () => useStateCardStore.setState({ addCard: realAdd }))
  }
})
