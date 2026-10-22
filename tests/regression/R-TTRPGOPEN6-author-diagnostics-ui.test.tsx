import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import TtrpgOpenAuthorDiagnostics from '../../src/components/ttrpg/TtrpgOpenAuthorDiagnostics'
import { setupGateHintFixtureV1 } from '../helpers/open-ttrpg-gate-recovery'
import { readyOpenTtrpgSessionV1, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { changeTtrpgSafetyStatus } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import * as textExport from '../../src/lib/export/text-export'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
describe('R-TTRPGOPEN6 author-only diagnostic UI', { timeout: 60000 }, () => {
  let host: HTMLDivElement, root: Root
  beforeEach(async () => { await db.delete();await db.open();host = document.createElement('div');document.body.append(host);root = createRoot(host) })
  afterEach(async () => { await act(async () => root.unmount());host.remove();db.close();vi.restoreAllMocks() })
  async function until(check: () => boolean) {
    for (let i = 0; i < 200; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve,5)) });if (check()) return }
    throw new Error(`did not resolve: ${host.textContent}`)
  }
  async function click(text: string) {
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === text)!
    await act(async () => button.click());await until(() => !button.disabled)
  }
  it('requires explicit read, exports real diagnosis, and only drafts revision without runtime writes', async () => {
    const f = await setupGateHintFixtureV1();await resumeTtrpgOpenChecksV1(f.command)
    const before = await readProductRuntimeState(f.command.sessionId), draft = vi.fn(() => true)
    const download = vi.spyOn(textExport,'downloadTextFile').mockImplementation(() => {})
    await act(async () => root.render(createElement(TtrpgOpenAuthorDiagnostics,{ scope: f.f.scope,productionId: f.f.productionId,onRevisionDraft: draft })))
    expect(host.querySelector('select')).toBeNull();expect(host.textContent).not.toContain('角色 hero 的最新检查')
    await click('读取本作品的试玩记录');await click('读取诊断')
    expect(host.textContent).toContain('线索能够形成假设：未通过');expect(host.textContent).toContain('依据版本')
    expect(host.textContent).not.toContain('RECOVERY-PRIVATE-OBSERVATION')
    await click('导出诊断');expect(download).toHaveBeenCalledOnce()
    expect(JSON.parse(download.mock.calls[0][0] as string).evaluations.length).toBeGreaterThan(0)
    await click('加入修订要求');expect(draft).toHaveBeenCalledOnce();expect(draft.mock.calls[0][0]).toContain('线索能够形成假设未通过')
    expect(host.textContent).toContain('明确创建修订轮次')
    expect(await readProductRuntimeState(f.command.sessionId)).toEqual(before)
  })
  it('rejects a stale draft and clears another Work selection and diagnosis on scope switch', async () => {
    const f = await readyOpenTtrpgSessionV1(), draft = vi.fn(() => true)
    await act(async () => root.render(createElement(TtrpgOpenAuthorDiagnostics,{ scope: f.scope,productionId: f.productionId,onRevisionDraft: draft })))
    await click('读取本作品的试玩记录');await click('读取诊断')
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(f.sessionId,'pause'),status: 'paused',reason: '暂停',changedBy: 'hero',viewerKey: 'viewer.seat.hero' })
    await click('加入修订要求');expect(draft).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')?.textContent).toContain('过期')
    const other = await readyOpenTtrpgSessionV1('another Work')
    await act(async () => root.render(createElement(TtrpgOpenAuthorDiagnostics,{ scope: other.scope,productionId: other.productionId,onRevisionDraft: draft })))
    expect(host.querySelector('select')).toBeNull();expect(host.textContent).not.toContain('版本与来源')
  })
  it('keeps an overlong existing revision intact and explains exporting instead', async () => {
    const f = await readyOpenTtrpgSessionV1(), draft = vi.fn(() => false)
    await act(async () => root.render(createElement(TtrpgOpenAuthorDiagnostics,{ scope: f.scope,productionId: f.productionId,onRevisionDraft: draft })))
    await click('读取本作品的试玩记录');await click('读取诊断');await click('加入修订要求')
    expect(draft).toHaveBeenCalledOnce();expect(host.querySelector('[role="alert"]')?.textContent).toContain('已保留原文')
  })
})
