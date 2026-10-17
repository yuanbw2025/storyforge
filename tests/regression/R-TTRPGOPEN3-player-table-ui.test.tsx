import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import TtrpgOpenPlayTable from '../../src/components/ttrpg/TtrpgOpenPlayTable'
import TtrpgPlayTable from '../../src/components/ttrpg/TtrpgPlayTable'
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import * as table from '../../src/lib/ttrpg/open-table-service'
import { TtrpgOpenReadConflictV1 } from '../../src/lib/ttrpg/open-read-conflict'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
describe('R-TTRPGOPEN3 real player desk identity and preview boundary', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(async () => { await db.delete();await db.open();host = document.createElement('div');document.body.append(host);root = createRoot(host) })
  afterEach(async () => { await act(async () => root.unmount());host.remove();db.close();vi.unstubAllEnvs();vi.restoreAllMocks() })
  async function until(check: () => boolean) {
    for (let n = 0; n < 200; n++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) });if (check()) return }
    throw new Error(`view did not resolve: ${host.textContent}`)
  }
  async function fixture() {
    const f = await readyOpenTtrpgSessionV1('scoped player screen', pkg => {
      pkg.ttrpg!.campaign.characterTemplates[0].playerProfile!.secret = 'HERO-PRIVATE-SCREEN'
      pkg.ttrpg!.campaign.characterTemplates[1].playerProfile!.secret = 'AI-PRIVATE-SCREEN'
    })
    const props = { session: (await db.productRuntimeSessions.get(f.sessionId))!, scope: f.scope, state: await readProductRuntimeState(f.sessionId), onChanged: vi.fn(async () => {}), onCheckpoint: vi.fn(async () => {}) }
    return { f, props }
  }
  it('keeps the unfinished public open player disabled by default without passing V2 to the old scripted runner', async () => {
    vi.stubEnv('VITE_ENABLE_TTRPG_OPEN_PREVIEW', '')
    const { props } = await fixture()
    await act(async () => root.render(createElement(TtrpgPlayTable, props)))
    expect(host.textContent).toContain('此冒险尚未开放游玩');expect(host.textContent).not.toContain('HERO-PRIVATE-SCREEN')
    expect(host.querySelector('[data-testid="ttrpg-open-player-table"]')).toBeNull();expect(props.onChanged).not.toHaveBeenCalled()
  })
  it('requires identity confirmation, renders only the owned secret and clears private state during handoff', async () => {
    const { props } = await fixture()
    await act(async () => root.render(createElement(TtrpgOpenPlayTable, props)))
    await until(() => Boolean(host.querySelector('select')))
    expect(host.textContent).not.toContain('HERO-PRIVATE-SCREEN');expect(host.textContent).not.toContain('AI-PRIVATE-SCREEN')
    const select = host.querySelector('select')!
    await act(async () => { select.value = OPEN_HUMAN_VIEWER;select.dispatchEvent(new Event('change', { bubbles: true })) })
    const enter = [...host.querySelectorAll('button')].find(b => b.textContent === '确认身份并进入')!
    await act(async () => enter.click())
    await until(() => (host.textContent ?? '').includes('HERO-PRIVATE-SCREEN'))
    expect(host.textContent).not.toContain('AI-PRIVATE-SCREEN')
    const leave = [...host.querySelectorAll('button')].find(b => b.textContent === '交接给另一位玩家')!
    await act(async () => leave.click())
    expect(host.textContent).not.toContain('HERO-PRIVATE-SCREEN')
    await until(() => Boolean(host.querySelector('select')))
    expect(host.textContent).not.toContain('HERO-PRIVATE-SCREEN');expect(host.querySelector('textarea')).toBeNull()
  })
  it('retries a concurrent display read without repeating a saved action or exposing private identity', async () => {
    const { f, props } = await fixture(), before = await readProductRuntimeState(f.sessionId)
    const actual = table.readTtrpgOpenTableV1
    const read = vi.spyOn(table, 'readTtrpgOpenTableV1').mockRejectedValueOnce(new TtrpgOpenReadConflictV1('current head advanced'))
      .mockRejectedValueOnce(new TtrpgOpenReadConflictV1('current head advanced again')).mockImplementation(actual)
    await act(async () => root.render(createElement(TtrpgOpenPlayTable, props)))
    await until(() => Boolean(host.querySelector('select')))
    expect(read).toHaveBeenCalledTimes(3);expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.textContent).not.toContain('HERO-PRIVATE-SCREEN');expect(host.textContent).not.toContain('AI-PRIVATE-SCREEN')
    expect(props.onChanged).not.toHaveBeenCalled();expect(await db.agentRuns.count()).toBe(0)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  })
  it('bounds changing-head reads and leaves a visible explicit refresh without retrying an authority denial', async () => {
    const { props } = await fixture(), actual = table.readTtrpgOpenTableV1
    const read = vi.spyOn(table, 'readTtrpgOpenTableV1').mockRejectedValue(new TtrpgOpenReadConflictV1('进度持续变化'))
    await act(async () => root.render(createElement(TtrpgOpenPlayTable, props)))
    await until(() => Boolean(host.querySelector('[role="alert"]')))
    expect(read).toHaveBeenCalledTimes(3);expect(host.textContent).not.toContain('HERO-PRIVATE-SCREEN')
    read.mockRejectedValue(new Error('当前身份已失效，请重新确认'))
    const refresh = [...host.querySelectorAll('button')].find(b => b.textContent === '重新读取进度')!
    await act(async () => refresh.click())
    await until(() => (host.textContent ?? '').includes('当前身份已失效'))
    expect(read).toHaveBeenCalledTimes(4)
    read.mockImplementation(actual)
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '重新读取进度')!.click())
    await until(() => Boolean(host.querySelector('select')))
    expect(host.textContent).not.toContain('HERO-PRIVATE-SCREEN');expect(props.onChanged).not.toHaveBeenCalled()
  })
})
