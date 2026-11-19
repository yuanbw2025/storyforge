import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { InlineTextarea, type InlineSave } from '../../src/components/shared/InlineEdit'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import type { LocalSaveAckV1, LocalSaveContractV1, LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: { root: ReturnType<typeof createRoot>; host: HTMLDivElement }[] = []
afterEach(async () => { for (const ui of mounted.splice(0)) { await act(async () => ui.root.unmount()); ui.host.remove() } resetPendingEditCoordinatorForTestsV1(); vi.restoreAllMocks() })
const identity = { projectId: 1, worldId: 2, workId: 3, worldGroupId: null, table: 'worldviews' as const, field: 'worldStructure' as const }
function contract(value = 'old'): LocalSaveContractV1 { return { identity, witness: { version: 1, source: 'database-read', identity, recordId: 4, resourceUid: 'uid1', present: true, value, valueHash: 'hash-' + value, confirmedAt: 1 } } }
function ack(text: string, intent: LocalSaveIntentV1): LocalSaveAckV1 { return { kind: 'natural-field-local-save-ack-v1', session: intent.session, generation: intent.generation, witness: { ...intent.expected, source: 'committed-write', value: text, valueHash: 'hash-' + text } } }
async function mount(save: InlineSave, evidence: LocalSaveContractV1 | undefined = contract()) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const ui = { host, root }; mounted.push(ui)
  const render = async (value = 'old', next = evidence) => { await act(async () => root.render(<InlineTextarea value={value} localSave={next} onChange={save} />)) }
  await render(); return { ...ui, render }
}
const status = (host: HTMLElement) => host.querySelector('[data-local-save-status]')?.getAttribute('data-local-save-status')
async function begin(host: HTMLElement) { await act(async () => (host.querySelector('.cursor-text') as HTMLElement).click()); return host.querySelector('textarea')! }
async function edit(area: HTMLTextAreaElement, text: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text); area.dispatchEvent(new Event('input', { bubbles: true })) }) }
it('requires an actual matching initial witness and immediately removes success on input; void resolve is failure and keeps draft', async () => {
  const ui = await mount(vi.fn().mockResolvedValue(undefined)); expect(status(ui.host)).toBe('saved')
  const area = await begin(ui.host); await edit(area, 'new'); expect(status(ui.host)).toBe('dirty')
  await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('没有匹配') })
  expect(status(ui.host)).toBe('failed'); expect(ui.host.querySelector('textarea')?.value).toBe('new')
  await act(async () => area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(ui.host.querySelector('textarea')?.value).toBe('new')
})
it('does not confirm optimistic props, missing witness, or verified absent fallback empty', async () => {
  const initial = contract(); initial.witness = null; const ui = await mount(vi.fn(), initial)
  expect(status(ui.host)).toBe('unconfirmed'); await ui.render('optimistic', initial); expect(status(ui.host)).toBe('unconfirmed')
  const absent = contract(''); absent.witness = { ...absent.witness!, recordId: null, resourceUid: null, present: false, value: undefined }
  await ui.render('', absent); expect(status(ui.host)).toBe('unconfirmed')
})
it('drains a newer dirty generation after old save completes and accepts only latest ack', async () => {
  const pending: { text: string; intent: LocalSaveIntentV1; resolve: (ack: LocalSaveAckV1) => void }[] = []
  const save = vi.fn((text: string, intent?: LocalSaveIntentV1) => new Promise<LocalSaveAckV1>(resolve => pending.push({ text, intent: intent!, resolve })))
  const ui = await mount(save); const area = await begin(ui.host); await edit(area, 'first')
  let flush!: Promise<unknown>; await act(async () => { flush = flushPendingEditsV1(); await Promise.resolve() })
  expect(pending).toHaveLength(1); expect(status(ui.host)).toBe('saving'); expect(area.disabled).toBe(false)
  await edit(area, 'latest🌊'); await ui.render('late load old')
  await act(async () => { pending[0].resolve(ack(pending[0].text, pending[0].intent)); await Promise.resolve() })
  expect(pending).toHaveLength(2); expect(status(ui.host)).not.toBe('saved'); expect(area.value).toBe('latest🌊')
  expect(pending[1].intent.expected.value).toBe('first'); expect(pending[1].intent.generation).toBeGreaterThan(pending[0].intent.generation)
  await act(async () => { pending[1].resolve(ack(pending[1].text, pending[1].intent)); await flush })
  await ui.render('latest🌊'); expect(status(ui.host)).toBe('saved'); expect(save).toHaveBeenCalledTimes(2)
})
it('rejects flush while IME tail is pending, then saves completed tail once; failed retry keeps the source', async () => {
  let fail = true; const save = vi.fn(async (text: string, intent?: LocalSaveIntentV1) => { if (fail) throw new Error('simulated quota'); return ack(text, intent!) })
  const ui = await mount(save); const area = await begin(ui.host)
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))); await edit(area, '中文尾')
  await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('输入法') }); expect(save).not.toHaveBeenCalled()
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('simulated quota') }); expect(area.value).toBe('中文尾')
  fail = false; await act(async () => { (ui.host.querySelector('button') as HTMLButtonElement).click(); await Promise.resolve() })
  await ui.render('中文尾'); expect(status(ui.host)).toBe('saved'); expect(save).toHaveBeenCalledTimes(2)
})
it('does not consume a late ack after identity switch or overwrite the old draft with new props', async () => {
  let resolve!: (ack: LocalSaveAckV1) => void; let request!: LocalSaveIntentV1
  const ui = await mount((_text, intent) => { request = intent!; return new Promise<LocalSaveAckV1>(r => { resolve = r }) })
  const area = await begin(ui.host); await edit(area, 'draft')
  let flush!: Promise<unknown>; await act(async () => { flush = flushPendingEditsV1(); void flush.catch(() => undefined); await Promise.resolve() })
  const next = contract('other work'); next.identity = { ...identity, workId: 99 }; next.witness = { ...next.witness!, identity: next.identity }
  await ui.render('other work', next)
  await act(async () => { resolve(ack('draft', request)); await expect(flush).rejects.toThrow('没有匹配') })
  expect(area.value).toBe('draft'); expect(status(ui.host)).toBe('failed')
})
it('keeps legacy consumers free of saved claims and invokes their callback with its original single argument', async () => {
  const save = vi.fn().mockResolvedValue(undefined); const ui = await mount(save, undefined)
  // mount's default applies to undefined, so explicitly remove the prop.
  await act(async () => ui.root.render(<InlineTextarea value="old" onChange={save} />))
  expect(status(ui.host)).toBeUndefined(); const area = await begin(ui.host); await edit(area, 'legacy')
  await act(async () => flushPendingEditsV1()); expect(save).toHaveBeenCalledExactlyOnceWith('legacy'); expect(status(ui.host)).toBeUndefined()
})

it('returning to the original value still checks the frozen field witness after an edit; failed stale is not silently cancelled', async () => {
  const save = vi.fn().mockRejectedValue(new Error('same-field stale; explicit reload required'))
  const ui = await mount(save); const area = await begin(ui.host); await edit(area, 'draft'); await edit(area, 'old')
  await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('same-field stale') })
  expect(save).toHaveBeenCalledOnce(); expect(area.value).toBe('old'); expect(status(ui.host)).toBe('failed')
  await act(async () => area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(ui.host.querySelector('textarea')).toBe(area); expect(status(ui.host)).toBe('failed')
})
