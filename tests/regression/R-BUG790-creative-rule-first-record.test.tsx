import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CreativeRulesPanel from '../../src/components/rules/CreativeRulesPanel'
import { db } from '../../src/lib/db/schema'
import { coordinatePendingEditV1, flushPendingEditsV1, pendingEditDiagnosticsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { createSystemFictionElementsV1 } from '../../src/lib/prose/system-fiction-contract'
import { useCreativeRulesStore } from '../../src/stores/project-singletons'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

// Only the inactive AI sidecar is isolated; the author panel, original singleton
// writer, queue, scoped reads and IndexedDB transactions remain real.
vi.mock('../../src/components/agent/useMasterCopilot', () => ({ useMasterCopilot: () => ({
  pendingCandidates: [], loading: false, busy: false, recoveryAvailable: false, error: null,
}) }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const raw = '  # 作者原文\r\n中文 e\u0301 🌙 保留尾空白。  '
beforeEach(async () => {
  await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model or external API is authorized') }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  await waitFor(() => expect(pendingEditDiagnosticsV1().writeCount).toBe(0))
  expect(fetch).not.toHaveBeenCalled(); resetPendingEditCoordinatorForTestsV1()
  vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close()
})
async function waitFor(check: () => void | Promise<void>) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }); await check() })
}
const elementInput = () => host.querySelector<HTMLTextAreaElement>('[aria-label="系统文元素 · 系统机制"]')!
const status = () => host.querySelector('[aria-label="系统文元素配置"] [data-local-save-status]')!.getAttribute('data-local-save-status')
async function change(input: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function saveElements() { await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '保存元素')!.click()) }
async function fixture() {
  const f = await seedCurrentWorkspace('790 first native rules record')
  await useCreativeRulesStore.getState().loadAll(f.scope)
  await act(async () => root.render(createElement(CreativeRulesPanel, { project: f.project, confirmedLocalSaves: true })))
  await waitFor(() => { expect(elementInput()).toBeTruthy(); expect(elementInput().closest('fieldset')!.disabled).toBe(false) })
  return f
}
async function startOwnStyle(scope: Awaited<ReturnType<typeof fixture>>['scope']) {
  let release!: () => void, reached!: () => void
  const started = new Promise<void>(resolve => { reached = resolve })
  const barrier = coordinatePendingEditV1({ key: `project-singleton:creativeRules:${scope.projectId}:${scope.workId}:default`,
    persist: () => new Promise<void>(resolve => { release = resolve; reached() }) })
  await started
  await act(async () => [...host.querySelectorAll('div.cursor-text')].find(e => e.textContent?.startsWith('描述期望的写作风格'))!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  const input = host.querySelector<HTMLTextAreaElement>('textarea[placeholder^="描述期望的写作风格"]')!
  await change(input, '原文风，不由元素保存改写')
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  return { release, barrier }
}
async function editSibling(labelText: string) {
  const label = [...host.querySelectorAll('label')].find(e => e.textContent === labelText)!
  const container = label.parentElement!.parentElement!
  await act(async () => container.querySelector<HTMLElement>('.cursor-text')!.click())
  const input = container.querySelector<HTMLTextAreaElement>('textarea')!
  await change(input, raw)
  return input
}

it.each([['atmosphere', '基调和氛围'], ['specialRequirements', '特殊创作要求']] as const)('also keeps a queued ordinary text sibling on the same page creation (%s)', async (field, label) => {
  const f = await fixture(), held = await startOwnStyle(f.scope)
  try {
    const input = await editSibling(label)
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    await act(async () => { held.release(); await held.barrier })
    await waitFor(async () => expect((await db.creativeRules.toArray())[0]?.[field]).toBe(raw))
    await act(async () => { await flushPendingEditsV1() })
    const before = (await db.creativeRules.toArray())[0]
    expect(before.writingStyle).toBe('原文风，不由元素保存改写')
    expect(await db.creativeRules.count()).toBe(1)
    db.close(); await db.open(); expect(await db.creativeRules.get(before.id!)).toEqual(before)
  } finally { held.release(); await held.barrier }
})

it('does not turn native text initialization into permission to overwrite another page nonempty text', async () => {
  const f = await fixture(), held = await startOwnStyle(f.scope)
  try {
    const input = await editSibling('基调和氛围')
    await act(async () => { held.release(); await held.barrier })
    await waitFor(async () => expect(await db.creativeRules.count()).toBe(1))
    await act(async () => useCreativeRulesStore.getState().save({ projectId: f.scope.projectId, atmosphere: '另一页已提交氛围' }, f.scope))
    const before = await db.creativeRules.toArray()
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    await waitFor(() => expect(input.parentElement!.querySelector('[data-local-save-status]')?.getAttribute('data-local-save-status')).toBe('failed'))
    expect(await db.creativeRules.toArray()).toEqual(before); expect(input.value).toBe(raw)
  } finally { held.release(); await held.barrier }
})

it('does not launder a forged missing-record text preimage through its own later creation receipt', async () => {
  const evidence = await import('../../src/lib/authoring/creative-rules-local-save-evidence')
  const nativeRead = evidence.readCreativeRuleSaveWitnessesV1
  vi.spyOn(evidence, 'readCreativeRuleSaveWitnessesV1').mockImplementation(async scope => {
    const actual = await nativeRead(scope)
    return actual.atmosphere?.recordId === null ? { ...actual,
      atmosphere: { ...actual.atmosphere, valueHash: '790 forged old empty hash' },
    } : actual
  })
  const f = await fixture(), held = await startOwnStyle(f.scope)
  try {
    const input = await editSibling('基调和氛围')
    await act(async () => { held.release(); await held.barrier })
    await waitFor(async () => expect(await db.creativeRules.count()).toBe(1))
    const before = await db.creativeRules.toArray()
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    await waitFor(() => expect(input.parentElement!.querySelector('[data-local-save-status]')?.getAttribute('data-local-save-status')).toBe('failed'))
    expect(await db.creativeRules.toArray()).toEqual(before); expect(input.value).toBe(raw)
  } finally { held.release(); await held.barrier }
})

it.each(['after-own-create', 'while-own-create-pending'] as const)('preserves a structured draft while this page creates the same native singleton through another field (%s)', async timing => {
  const f = await fixture(), held = await startOwnStyle(f.scope)
  try {
    await change(elementInput(), raw)
    expect(await db.creativeRules.count()).toBe(0)
    if (timing === 'while-own-create-pending') await saveElements()
    await act(async () => { held.release(); await held.barrier })
    await waitFor(async () => expect((await db.creativeRules.toArray())[0]?.writingStyle).toBe('原文风，不由元素保存改写'))
    if (timing === 'after-own-create') await saveElements()
    await waitFor(() => expect(status()).toBe('saved'))
    await act(async () => { await flushPendingEditsV1() })
    const before = (await db.creativeRules.toArray())[0]
    expect(before).toMatchObject({ workId: f.scope.workId, systemFictionElements: { ...createSystemFictionElementsV1(), systemMechanism: raw }, writingStyle: '原文风，不由元素保存改写' })
    expect(await db.creativeRules.count()).toBe(1)
    db.close(); await db.open(); expect(await db.creativeRules.get(before.id!)).toEqual(before)
  } finally { held.release(); await held.barrier }
})

it('also sequences a native structured first creation before the same page text draft', async () => {
  const f = await fixture()
  let release!: () => void, reached!: () => void
  const started = new Promise<void>(resolve => { reached = resolve })
  const barrier = coordinatePendingEditV1({ key: `project-singleton:creativeRules:${f.scope.projectId}:${f.scope.workId}:default`,
    persist: () => new Promise<void>(resolve => { release = resolve; reached() }) })
  await started
  try {
    await change(elementInput(), raw); await saveElements()
    await waitFor(() => expect(status()).toBe('saving'))
    const input = await editSibling('写作风格')
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(await db.creativeRules.count()).toBe(0)
    await act(async () => { release(); await barrier })
    await waitFor(async () => expect((await db.creativeRules.toArray())[0]?.writingStyle).toBe(raw))
    await act(async () => { await flushPendingEditsV1() })
    const before = (await db.creativeRules.toArray())[0]
    expect(before).toMatchObject({ workId: f.scope.workId, systemFictionElements: { ...createSystemFictionElementsV1(), systemMechanism: raw } })
    expect(await db.creativeRules.count()).toBe(1)
    db.close(); await db.open(); expect(await db.creativeRules.toArray()).toEqual([before])
  } finally { release(); await barrier }
})

it('does not borrow another page creation as its own commit or erase the complete unsaved author text', async () => {
  const f = await fixture(); await change(elementInput(), raw)
  await act(async () => useCreativeRulesStore.getState().save({ projectId: f.scope.projectId, writingStyle: '另一页创建的规则' }, f.scope))
  const before = await db.creativeRules.toArray(); await saveElements()
  await waitFor(() => expect(status()).toBe('failed'))
  expect(await db.creativeRules.toArray()).toEqual(before); expect(elementInput().value).toBe(raw)
})

it.each(['same-field-change', 'replaced-record'] as const)('retains the original stale/record protections after this page created the singleton (%s)', async kind => {
  const f = await fixture(), held = await startOwnStyle(f.scope)
  try {
    await change(elementInput(), raw)
    await act(async () => { held.release(); await held.barrier })
    await waitFor(async () => expect(await db.creativeRules.count()).toBe(1))
    await act(async () => {
      if (kind === 'replaced-record') await db.creativeRules.clear()
      await useCreativeRulesStore.getState().save({ projectId: f.scope.projectId,
        ...(kind === 'same-field-change' ? { systemFictionElements: { ...createSystemFictionElementsV1(), systemMechanism: '另一页已提交元素' } } : { writingStyle: '另一份新记录' }),
      }, f.scope)
    })
    const before = await db.creativeRules.toArray(); await saveElements()
    await waitFor(() => expect(status()).toBe('failed'))
    expect(await db.creativeRules.toArray()).toEqual(before); expect(elementInput().value).toBe(raw)
  } finally { held.release(); await held.barrier }
})

it.each(['native-write-failure', 'corrupt-poststate'] as const)('retains both fields and the new native identity through a failed structured save and explicit retry (%s)', async kind => {
  const f = await fixture(), held = await startOwnStyle(f.scope)
  const fail = (patch: Record<string, unknown>) => {
    if (!Object.prototype.hasOwnProperty.call(patch, 'systemFictionElements')) return
    if (kind === 'native-write-failure') throw new DOMException('790 native quota failure', 'QuotaExceededError')
    return { systemFictionElements: { ...createSystemFictionElementsV1(), systemMechanism: 'invalid poststate' } }
  }
  try {
    await change(elementInput(), raw)
    await act(async () => { held.release(); await held.barrier })
    await waitFor(async () => expect((await db.creativeRules.toArray())[0]?.writingStyle).toBe('原文风，不由元素保存改写'))
    const before = await db.creativeRules.toArray()
    db.creativeRules.hook('updating', fail)
    await saveElements(); await waitFor(() => expect(status()).toBe('failed'))
    expect(await db.creativeRules.toArray()).toEqual(before); expect(elementInput().value).toBe(raw)
    db.creativeRules.hook('updating').unsubscribe(fail)
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="重试保存系统文元素"]')!.click())
    await waitFor(() => expect(status()).toBe('saved'))
    await act(async () => { await flushPendingEditsV1() })
    const after = (await db.creativeRules.toArray())[0]
    expect(after).toMatchObject({ id: before[0].id, ragDocumentId: before[0].ragDocumentId,
      writingStyle: before[0].writingStyle, systemFictionElements: { ...createSystemFictionElementsV1(), systemMechanism: raw } })
    db.close(); await db.open(); expect(await db.creativeRules.toArray()).toEqual([after])
  } finally { held.release(); await held.barrier; db.creativeRules.hook('updating').unsubscribe(fail) }
})
