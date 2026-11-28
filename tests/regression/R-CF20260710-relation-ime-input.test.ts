import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CharacterRelationPanel from '../../src/components/relations/CharacterRelationPanel'
import { AuthorRecordSaveScopeV1 } from '../../src/components/shared/AuthorRecordSaveScope'
import { ToastProvider } from '../../src/components/shared/Toast'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { useCharacterRelationStore } from '../../src/stores/character-relation'
import { useCharacterStore } from '../../src/stores/character'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

// Graph geometry is unrelated to IME; the actual panel, inputs, stores and DB remain native.
vi.mock('../../src/components/relations/RelationGraph', () => ({ default: () => null }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); db.close()
  resetPendingEditCoordinatorForTestsV1(); vi.unstubAllGlobals(); vi.restoreAllMocks()
})
async function waitFor(check: () => void | Promise<void>) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }); await check() })
}
async function fixture() {
  const { scope, project } = await seedCurrentWorkspace('CF-20260710 native IME')
  const ids: number[] = []
  for (const name of ['原角色甲', '原角色乙']) ids.push(await db.characters.add(stampNewRecord(scope, 'characters', {
    projectId: scope.projectId, name, roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral',
    relationships: '原手写角色关系不改。', homeWorldGroupId: null, isCrossWorld: false, createdAt: 1, updatedAt: 1,
  }, { owner: 'world' }) as never) as number)
  await useCharacterStore.getState().loadAll(scope)
  await useCharacterRelationStore.getState().loadAll(scope)
  await useCharacterRelationStore.getState().addRelation({ projectId: scope.projectId, fromCharacterId: ids[0], toCharacterId: ids[1],
    relationType: 'friend', label: '原标签', description: '原描述', isBidirectional: true }, scope)
  const before = useCharacterRelationStore.getState().relations[0], characters = await db.characters.toArray()
  await act(async () => root.render(createElement(ToastProvider, null,
    createElement(AuthorRecordSaveScopeV1.Provider, { value: scope }, createElement(CharacterRelationPanel, { project, worldGroupId: null, initialRelationId: before.id })))))
  await waitFor(() => expect([...host.querySelectorAll('button')].some(button => button.textContent === '编辑')).toBe(true))
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '编辑')!.click())
  await waitFor(() => expect(host.querySelector('[data-local-save-status]')?.getAttribute('data-local-save-status')).toBe('saved'))
  return { scope, before, characters }
}
function enter(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(control, value)
  control.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertCompositionText', isComposing: true }))
}

describe('CF-20260710 · 角色关系编辑输入法组合态保护', () => {
  it.each([['label', '关系标签'], ['description', '关系描述']] as const)('%s keeps composing syllables out of the native row, then saves and reopens the complete Chinese value', async (field, label) => {
    const f = await fixture()
    if (field === 'description') {
      await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '编辑源码')!.click())
    }
    const control = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!
    expect(control).toBeTruthy()
    await act(async () => { control.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); enter(control, 'zhongwen') })
    // Wait past the real field's debounce. Neither the native row nor the
    // explicit navigation barrier may accept an unfinished composition.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)) })
    expect(await db.characterRelations.get(f.before.id!)).toEqual(f.before)
    await expect(flushPendingEditsV1()).rejects.toThrow('输入法')
    const value = field === 'label' ? '中文关系 e\u0301 🌙　' : '# 中文关系\n\n原文 e\u0301 🌙 保留尾空白。  '
    await act(async () => {
      enter(control, value)
      control.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }))
    })
    await waitFor(async () => expect((await db.characterRelations.get(f.before.id!))?.[field]).toBe(value))
    await act(async () => { await flushPendingEditsV1() })
    const expected = { ...f.before, [field]: value, updatedAt: expect.any(Number) }
    expect(await db.characterRelations.get(f.before.id!)).toEqual(expected)
    expect(await db.characters.toArray()).toEqual(f.characters)
    db.close(); await db.open(); await act(async () => useCharacterRelationStore.getState().loadAll(f.scope))
    expect(await db.characterRelations.get(f.before.id!)).toEqual(expected)
    expect(await db.characterRelations.count()).toBe(1)
    expect(await db.agentRuns.count()).toBe(0)
  })
})
