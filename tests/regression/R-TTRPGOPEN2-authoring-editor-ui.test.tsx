import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TtrpgOpenAuthoringEditor from '../../src/components/ttrpg/TtrpgOpenAuthoringEditor'
import { defaultTtrpgSettingsV2 } from '../../src/lib/ttrpg/authoring-contract-v2'
import { initializeTtrpgOpenAuthoringPoliciesV1 } from '../../src/lib/ttrpg/open-authoring-edit'
import { flushPendingEditsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import type { TtrpgOpenAuthoringV1 } from '../../src/lib/ttrpg/open-contract'
import { openCampaignFixture } from '../helpers/ttrpg-open-content'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
describe('R-TTRPGOPEN2 author editor pending and identity boundaries', () => {
  let root: Root, host: HTMLDivElement, value: TtrpgOpenAuthoringV1
  const changed = vi.fn()
  beforeEach(() => {
    const settings = defaultTtrpgSettingsV2('open'); if (settings.runFormat !== 'open') throw Error('format')
    value = settings.openAuthoring; changed.mockReset()
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove() })
  async function render(next = value) { await act(async () => root.render(createElement(TtrpgOpenAuthoringEditor, { value: next, onChange: changed }))) }
  const button = (text: string) => [...host.querySelectorAll('button')].find(button => button.textContent === text)!
  async function file(read: () => Promise<string>) {
    const input = host.querySelector('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size: 100, text: read }] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve() })
  }
  it('keeps a checked imported candidate separate until explicit apply, with the real pending-edit barrier blocking navigation or production', async () => {
    await render(); const candidate = initializeTtrpgOpenAuthoringPoliciesV1(value)
    await file(async () => JSON.stringify(candidate))
    expect(host.querySelector('[data-testid="ttrpg-open-authoring-candidate"]')).not.toBeNull(); expect(changed).not.toHaveBeenCalled()
    await expect(flushPendingEditsV1()).rejects.toThrow(/应用或放弃/)
    await act(async () => button('应用到开放设计草稿').click())
    expect(changed).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledWith(candidate)
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
  })
  it('preserves malformed input and the original draft until an explicit discard, then releases the edit barrier', async () => {
    await render(); await file(async () => '{"situationTemplates":')
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(changed).not.toHaveBeenCalled()
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('{"situationTemplates":')
    await expect(flushPendingEditsV1()).rejects.toThrow()
    await act(async () => button('放弃未应用的设计修改').click())
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe(JSON.stringify(value, null, 2))
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
  })
  it('rejects applying against changed draft bytes without discarding the checked candidate', async () => {
    await render(); await file(async () => JSON.stringify(initializeTtrpgOpenAuthoringPoliciesV1(value)))
    await render(initializeTtrpgOpenAuthoringPoliciesV1(value))
    await act(async () => button('应用到开放设计草稿').click())
    expect(changed).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain('原草稿已变化')
    expect(host.querySelector('[data-testid="ttrpg-open-authoring-candidate"]')).not.toBeNull()
    await expect(flushPendingEditsV1()).rejects.toThrow()
  })
  it('does not deliver a late file after the author discards it or switches the mounted Work', async () => {
    await render(); let resolve!: (text: string) => void
    await file(() => new Promise(done => { resolve = done }))
    await expect(flushPendingEditsV1()).rejects.toThrow()
    await act(async () => button('放弃未应用的设计修改').click())
    await act(async () => { resolve(JSON.stringify(initializeTtrpgOpenAuthoringPoliciesV1(value))); await Promise.resolve() })
    expect(host.querySelector('[data-testid="ttrpg-open-authoring-candidate"]')).toBeNull(); expect(changed).not.toHaveBeenCalled()
    await file(() => new Promise(done => { resolve = done }))
    await act(async () => root.render(createElement(TtrpgOpenAuthoringEditor, { key: 'another-work', value, onChange: changed })))
    await act(async () => { resolve(JSON.stringify(initializeTtrpgOpenAuthoringPoliciesV1(value))); await Promise.resolve() })
    expect(host.querySelector('[data-testid="ttrpg-open-authoring-candidate"]')).toBeNull(); expect(changed).not.toHaveBeenCalled()
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
  })
  it('lets a saved incomplete draft resume per-fact review while retaining its already explicit unchanged confirmations', async () => {
    const fact = openCampaignFixture().frozenWorldPredicateIndex.entries[0]
    value = { ...value, factPolicy: [{ fact, authorConfirmed: true }, { fact: { ...fact, factKey: fact.factKey + '.second' }, authorConfirmed: false }] }
    await render(); await act(async () => button('继续核对草稿事实').click())
    const checkboxes = [...host.querySelectorAll('[data-testid="ttrpg-open-authoring-candidate"] input[type="checkbox"]')] as HTMLInputElement[]
    expect(checkboxes.map(input => input.checked)).toEqual([true, false])
    await act(async () => checkboxes[1].click())
    await act(async () => button('应用到开放设计草稿').click())
    expect(changed.mock.calls[0][0].factPolicy.every((item: { authorConfirmed: boolean }) => item.authorConfirmed)).toBe(true)
  })
})
