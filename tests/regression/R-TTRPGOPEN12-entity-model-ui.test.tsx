import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import TtrpgOpenEntityModelPanel from '../../src/components/ttrpg/TtrpgOpenEntityModelPanel'
import { setupOpenEntityModelV1 } from '../helpers/open-entity-model'
import { readTtrpgOpenEntityModelDeskV1, requestTtrpgOpenEntityModelDeskV1 } from '../../src/lib/ttrpg/open-entity-model-desk'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('R-TTRPGOPEN12 actual entity model review component', { timeout: 60000 }, () => {
  let host: HTMLDivElement, root: Root
  beforeEach(async () => { await db.delete(); await db.open(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); db.close(); vi.restoreAllMocks() })
  async function until(check: () => boolean) {
    for (let n = 0; n < 600; n++) { await act(async () => { await new Promise(r => setTimeout(r, 5)) }); if (check()) return }
    throw new Error('entity model view did not settle: ' + host.textContent)
  }
  const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!
  const checkbox = (text: string) => [...host.querySelectorAll('label')].find(l => l.textContent?.includes(text))!.querySelector('input')!
  it('requires fresh consent after scope changes and reads without dispatching or writing', async () => {
    const s = await setupOpenEntityModelV1('private'), input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: s.viewerKey }, before = await readProductRuntimeState(s.f.sessionId)
    const perform = vi.fn(async (job: () => Promise<void>) => job())
    await act(async () => root.render(createElement(TtrpgOpenEntityModelPanel, { input, sequence: before.lastSequence, oracleSourceRef: s.selection.oracleSourceRef, busy: false, perform })))
    await until(() => Boolean(host.querySelector('select[aria-label="AI 实体提案范围"]')))
    const scope = host.querySelector('select[aria-label="AI 实体提案范围"]') as HTMLSelectElement
    await act(async () => { scope.value = s.selection.scope.scopeKey; scope.dispatchEvent(new Event('change', { bubbles: true })) })
    await until(() => Boolean(host.querySelector('[data-testid="entity-ai-template-dynamic.npc"]')))
    await act(async () => {
      const template = host.querySelector('[data-testid="entity-ai-template-dynamic.npc"]') as HTMLInputElement
      const placement = host.querySelector('[data-testid="entity-ai-placement-harbor"]') as HTMLInputElement
      template.click(); placement.click()
    })
    await act(async () => checkbox('我同意 AI 仅按以上本次资料和预留上限起草候选。').click())
    expect(button('按本次选择请求 AI 起草').disabled).toBe(false)
    const party = s.context.directory.find(d => d.scope.audience === 'party')!
    await act(async () => { scope.value = party.scope.scopeKey; scope.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(checkbox('我同意 AI 仅按以上本次资料和预留上限起草候选。').checked).toBe(false)
    expect(button('按本次选择请求 AI 起草').disabled).toBe(true)
    expect(await db.agentRuns.count()).toBe(0); expect(perform).not.toHaveBeenCalled(); expect(await readProductRuntimeState(s.f.sessionId)).toEqual(before)
  })
  it('requires separate exact-candidate review and clears private content immediately when the human input changes', async () => {
    const s = await setupOpenEntityModelV1('private', pkg => { pkg.ttrpg!.campaign.characterTemplates.find(c => c.characterKey === 'companion.1')!.controller = 'hybrid' })
    const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: s.viewerKey }, page = await readTtrpgOpenEntityModelDeskV1(input)
    await requestTtrpgOpenEntityModelDeskV1({ ...input, expectedSequence: page!.sequence, selection: s.selection, submissionKey: 'private.model.ui', maximumCostUsd: 0.1,
      decision: 'request-this-entity-draft', runAI: async () => JSON.stringify({ proposals: [{ ...s.proposal, name: 'PRIVATE-UI-CANARY' }] }) })
    const before = await readProductRuntimeState(s.f.sessionId), perform = vi.fn(async (job: () => Promise<void>) => job())
    const props = { input, sequence: before.lastSequence, oracleSourceRef: s.selection.oracleSourceRef, busy: false, perform }
    await act(async () => root.render(createElement(TtrpgOpenEntityModelPanel, props)))
    await until(() => (host.textContent ?? '').includes('PRIVATE-UI-CANARY'))
    expect(button('采用原模型候选为待确认计划').disabled).toBe(true)
    await act(async () => checkbox('我已审阅以上原模型候选及本次范围').click())
    expect(button('采用原模型候选为待确认计划').disabled).toBe(false)
    await act(async () => button('采用原模型候选为待确认计划').click())
    await until(() => (host.textContent ?? '').includes('本候选已保存为计划'))
    const adopted = await readProductRuntimeState(s.f.sessionId)
    expect(adopted.entities).toEqual(before.entities); expect(adopted.ttrpg!.openRun!.entityOperations![0].plan.version).toBe(2)
    expect(adopted.ttrpg!.openRun!.entityOperations![0].approvals).toEqual([]); expect(perform).toHaveBeenCalledTimes(1)
    // Deliberately keep the same React instance: its own reader binding must guard old content.
    await act(async () => root.render(createElement(TtrpgOpenEntityModelPanel, { ...props, input: { ...input, viewerKey: 'viewer.seat.companion.1' }, sequence: adopted.lastSequence })))
    expect(host.textContent).not.toContain('PRIVATE-UI-CANARY')
    for (let n = 0; n < 25; n++) await act(async () => { await new Promise(r => setTimeout(r, 5)) })
    expect(host.textContent).not.toContain('PRIVATE-UI-CANARY'); expect(host.querySelector('input[type="checkbox"]')).toBeNull()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(adopted)
  })
})
