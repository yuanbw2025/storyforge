import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import Assistant from '../../src/components/ttrpg/TtrpgOpenDesignAssistant'
import * as design from '../../src/lib/ttrpg/open-authoring-design'
import { readTtrpgDraft, saveTtrpgDraft } from '../../src/lib/ttrpg/authoring-service'
import { settingsFromTtrpgDraft } from '../../src/lib/ttrpg/authoring-contract'
import { flushPendingEditsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { createSavedOpenDesignFixtureV1, openDesignResponseFixtureV1 } from '../helpers/ttrpg-open-design'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
describe('R-TTRPGOPEN2 normal S2 design comparison and explicit adoption', () => {
  let root: Root, host: HTMLDivElement, f: Awaited<ReturnType<typeof createSavedOpenDesignFixtureV1>>
  const onAdopted = vi.fn(), beforeAdopt = vi.fn(async () => { await flushPendingEditsV1() })
  beforeEach(async () => {
    await db.delete(); await db.open(); f = await createSavedOpenDesignFixtureV1()
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    onAdopted.mockReset(); beforeAdopt.mockClear()
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); db.close() })
  const button = (text: string) => [...host.querySelectorAll('button')].find(item => item.textContent === text)!
  async function rendered(check: () => boolean) {
    for (let i = 0; i < 200; i++) { await act(async () => { await new Promise(done => setTimeout(done, 5)) }); if (check()) return }
    throw new Error(`assistant did not settle: ${host.textContent}`)
  }
  async function render(dirty = false) {
    await act(async () => root.render(createElement(Assistant, { scope: f.scope, revision: f.revision, hasUnsavedEdits: dirty, needsInitialFacts: true,
      beforeGenerate: async () => { await flushPendingEditsV1(); return f.revision }, beforeAdopt, onAdopted })))
    await rendered(() => !host.textContent?.includes('正在读取原记录'))
  }
  async function candidate() {
    return design.generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI: async messages => openDesignResponseFixtureV1(messages) })
  }
  it('mounts and refreshes an empty author desk without creating any Run, model call, draft revision or production', async () => {
    const before = await readTtrpgDraft(f.scope); await render()
    await act(async () => button('刷新原请求状态').click())
    await rendered(() => !host.textContent?.includes('正在读取原记录'))
    expect(await db.agentRuns.count()).toBe(0); expect(await db.productProductions.count()).toBe(0)
    expect(await readTtrpgDraft(f.scope)).toEqual(before)
  })
  it('visibly includes unconfirmed source facts for a blank design and blocks an impossible situation request while allowing pressure-only work', async () => {
    await render()
    const checkbox = (text: string) => [...host.querySelectorAll('label')].find(label => label.textContent === text)!.querySelector<HTMLInputElement>('input')!
    expect(checkbox('新增世界事实').checked).toBe(true)
    expect(host.textContent?.replace(/\s+/g, '')).toContain('输出验收上限24,000tokens')
    await act(async () => checkbox('新增世界事实').click())
    expect(host.textContent).toContain('空白作品的局势需要事实来源')
    expect(button('生成三个开放设计方向').disabled).toBe(true)
    await act(async () => checkbox('局势与动机').click())
    expect(host.textContent?.replace(/\s+/g, '')).toContain('输出验收上限16,000tokens')
    expect(host.textContent).not.toContain('空白作品的局势需要事实来源')
    expect(await db.agentRuns.count()).toBe(0); expect(await db.productProductions.count()).toBe(0)
  })
  it('shows three original directions and readable pressure, blocks navigation for local choices, and adopts only after the explicit button', async () => {
    const c = await candidate(), before = await readTtrpgDraft(f.scope); await render()
    await rendered(() => host.querySelectorAll('.ttrpg-design-proposal').length === 3)
    expect(host.textContent).toContain('上限 14'); expect(host.textContent).toContain('查看与下载模型原始回答')
    expect(host.textContent).toContain('原请求冻结的输出验收上限：16,000 tokens。')
    await act(async () => button('选择整套：候选标题1不能重命名作品').click())
    expect(await readTtrpgDraft(f.scope)).toEqual(before)
    await expect(flushPendingEditsV1()).rejects.toThrow(/未保存的选择/)
    await act(async () => button('确认选择并保存到开放草稿').click())
    await rendered(() => (host.textContent ?? '').includes(`这份设计已保存到草稿版本 ${f.revision + 1}`))
    expect(beforeAdopt).toHaveBeenCalledOnce(); expect(onAdopted).toHaveBeenCalledOnce()
    const saved = await readTtrpgDraft(f.scope)
    expect(saved.revision).toBe(f.revision + 1)
    expect(JSON.parse(saved.settingsJson).openAuthoring.pressure.clocks[0].maximum).toBe(14)
    expect((await db.works.get(f.scope.workId))!.title).toBe('作者保留的战役名称')
    expect((await readAgentRunV1(f.scope, c.runId)).run.status).toBe('completed')
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
    expect(await db.productProductions.count()).toBe(0); expect(await db.productBuilds.count()).toBe(0)
  })
  it('keeps a candidate read-only after another author save, and blocks adoption while this form has unsaved human edits', async () => {
    await candidate(); await render(true)
    await rendered(() => host.querySelectorAll('.ttrpg-design-proposal').length === 3)
    expect(button('确认选择并保存到开放草稿').disabled).toBe(true)
    expect(host.textContent).toContain('本窗口还有人工修改')
    const saved = await saveTtrpgDraft(f.scope, f.revision, f.settings, '另一窗口新名称')
    await act(async () => button('刷新原请求状态').click())
    await rendered(() => (host.textContent ?? '').includes('这份设计只可参考'))
    expect(button('确认选择并保存到开放草稿').disabled).toBe(true)
    expect(await readTtrpgDraft(f.scope)).toEqual(saved); expect(onAdopted).not.toHaveBeenCalled()
  })
  it('explicitly discards local proposal choices without discarding the original candidate or its raw answer', async () => {
    const c = await candidate(); await render(); await rendered(() => host.querySelectorAll('.ttrpg-design-proposal').length === 3)
    await act(async () => button('选择整套：候选标题2不能重命名作品').click())
    await expect(flushPendingEditsV1()).rejects.toThrow()
    await act(async () => button('放弃本页未保存的要求与选择').click())
    await expect(flushPendingEditsV1()).resolves.toMatchObject({ version: 1 })
    expect((await readAgentRunV1(f.scope, c.runId)).run.status).toBe('awaiting_confirmation')
    expect(await db.agentRuns.count()).toBe(1); expect((await readTtrpgDraft(f.scope)).revision).toBe(f.revision)
  })
  it('requires the separate unknown-result acknowledgment and never resends when reading a missing original answer', async () => {
    const call = vi.fn(async () => { throw new Error('network disconnected') })
    await expect(design.generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI: call })).rejects.toThrow()
    await render(); await rendered(() => (host.textContent ?? '').includes('我已核对原请求'))
    expect(host.textContent).toContain('原请求冻结的输出验收上限：16,000 tokens。')
    expect(button('结束这份请求，不采用候选').disabled).toBe(true)
    await act(async () => button('读取原回答并恢复候选').click())
    await rendered(() => (host.textContent ?? '').includes('没有唯一已保存回答'))
    expect(call).toHaveBeenCalledOnce()
    const ack = [...host.querySelectorAll('label')].find(item => item.textContent?.includes('我已核对原请求'))!.querySelector('input')!
    await act(async () => ack.click())
    await act(async () => button('结束这份请求，不采用候选').click())
    await rendered(() => (host.textContent ?? '').includes('这份请求已明确结束'))
    expect((await design.listTtrpgOpenAuthoringDesignRunsV1(f.scope))[0].status).toBe('cancelled')
    expect(call).toHaveBeenCalledOnce(); expect((await readTtrpgDraft(f.scope)).revision).toBe(f.revision)
  })
  it('reloads historical adoption without rewriting later human settings or borrowing the model title', async () => {
    const c = await candidate()
    await design.adoptTtrpgOpenAuthoringDesignV1({ scope: f.scope, runId: c.runId, candidateHash: c.candidateHash,
      selection: { pressure: 'design.2' }, confirmedFactKeys: [], confirmation: 'confirm-design-selection-v1' })
    const old = await readTtrpgDraft(f.scope), settings = settingsFromTtrpgDraft(old); settings.openingSituation = '后续人工开场'
    const human = await saveTtrpgDraft(f.scope, old.revision, settings, '后续人工标题'); await render()
    await rendered(() => (host.textContent ?? '').includes('这份设计已保存到草稿版本'))
    expect(host.textContent).not.toContain('这份设计只可参考')
    expect(await readTtrpgDraft(f.scope)).toEqual(human); expect(onAdopted).not.toHaveBeenCalled()
    expect((await db.works.get(f.scope.workId))!.title).toBe('后续人工标题')
  })
})
