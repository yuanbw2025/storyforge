import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { ProductRuntimeState } from '../../src/lib/types'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import TtrpgOpenBriefPanel from '../../src/components/ttrpg/TtrpgOpenBriefPanel'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { closeTtrpgOpenEpochV1, startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { confirmTtrpgOpenBriefDeskV1, finishTtrpgOpenBriefDeskV1, readTtrpgOpenBriefDeskV1, requestTtrpgOpenBriefDeskV1, type TtrpgOpenBriefDeskInputV1 } from '../../src/lib/ttrpg/open-brief-service'
import * as briefService from '../../src/lib/ttrpg/open-brief-service'
import { seedTtrpgOpenBriefDeskV1 } from '../helpers/open-ttrpg-brief-desk'
import { openEnvelopeV1 } from '../helpers/open-ttrpg-session'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const output = JSON.stringify({ paragraphs: [{ text: '英雄仍怀疑旧港船只的问题，尚未获得确证。', sourceKeys: ['memory.brief-desk.shared'] }] })
const roots: Root[] = []
let fixture: Awaited<ReturnType<typeof seedTtrpgOpenBriefDeskV1>>
function openRun(state: ProductRuntimeState) {
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.openRun) throw new Error('Expected the official initialized open runtime')
  return runtime.openRun
}
async function saved(host: TtrpgOpenBriefDeskInputV1, submissionKey: string, send: () => Promise<string>) {
  await requestTtrpgOpenBriefDeskV1({ ...host, submissionKey, rawInput: '复盘当前共同经历，保留推测和原观察者。', maximumCostUsd: 0.1, runAI: send })
  const page = await readTtrpgOpenBriefDeskV1(host)
  if (!page?.canConfirm || !page.candidate) throw new Error('Expected the actual reviewable candidate')
  await confirmTtrpgOpenBriefDeskV1({ ...host, candidateHash: page.candidate.candidateHash })
  const epochKey = openRun(await readProductRuntimeState(host.sessionId)).coordination.activeEpochKey
  if (!epochKey) throw new Error('Expected the original recap window')
  return epochKey
}
async function completeSaved(host: TtrpgOpenBriefDeskInputV1, submissionKey: string, send: () => Promise<string>) {
  const started = performance.now(), epochKey = await saved(host, submissionKey, send), savedAt = performance.now()
  if (submissionKey === 'second') { db.close(); await db.open() }
  const before = await readProductRuntimeState(host.sessionId)
  const calls = openRun(before).coordination.calls, memories = await db.ttrpgNarrativeMemories.toArray()
  const artifacts = await db.agentRunArtifacts.toArray()
  const event = await finishTtrpgOpenBriefDeskV1({ ...host, epochKey }), finishedAt = performance.now()
  if (!event.commandId) throw new Error('Expected the exact persisted finish identity')
  const after = await readProductRuntimeState(host.sessionId)
  expect(openRun(after).coordination.activeEpochKey).toBeNull()
  expect(openRun(after).coordination.calls).toEqual(calls)
  expect(await db.ttrpgNarrativeMemories.toArray()).toEqual(memories)
  expect(await db.agentRunArtifacts.toArray()).toEqual(artifacts)
  expect((await readTtrpgOpenBriefDeskV1(host))?.canRequest).toBe(true)
  console.info('SFQA101 public-cycle timings', { submissionKey, saveMs: savedAt - started, finishMs: finishedAt - savedAt, verifyMs: performance.now() - finishedAt })
  return event.commandId
}
async function completeSavedFromPanel(host: TtrpgOpenBriefDeskInputV1, submissionKey: string, send: () => Promise<string>) {
  const started = performance.now(), epochKey = await saved(host, submissionKey, send), savedAt = performance.now()
  db.close(); await db.open()
  const container = document.createElement('div'), root = createRoot(container); roots.push(root)
  const actualRead = briefService.readTtrpgOpenBriefDeskV1
  let pageRead: ReturnType<typeof actualRead> | undefined
  const readObserver = vi.spyOn(briefService, 'readTtrpgOpenBriefDeskV1').mockImplementation(input => {
    const result = actualRead(input); pageRead = result; return result
  })
  let pending = Promise.resolve()
  const perform = (job: (signal?: AbortSignal) => Promise<void>) => (pending = job())
  await act(async () => root.render(createElement(TtrpgOpenBriefPanel, { input: host, sequence: (await readProductRuntimeState(host.sessionId)).lastSequence, busy: false, perform })))
  await act(async () => {
    if (!pageRead) throw new Error('Expected the real initial panel read')
    await pageRead
  })
  let finish: HTMLButtonElement | undefined
  await vi.waitFor(async () => {
    await act(async () => { await Promise.resolve() })
    finish = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '结束本次复盘')
    expect(finish).toBeDefined()
  })
  const click = finish
  if (!click) throw new Error('Expected the actual finish button')
  await act(async () => { click.click(); await pending })
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect((await readTtrpgOpenBriefDeskV1(host))?.canRequest).toBe(true)
  const after = await readProductRuntimeState(host.sessionId)
  expect(openRun(after).coordination.epochs.find(epoch => epoch.epochKey === epochKey)?.status).toBe('closed')
  const event = (await db.productRuntimeEvents.where('sessionId').equals(host.sessionId).toArray())
    .find(event => event.type === 'ttrpg.open.epoch.closed' && JSON.parse(event.payloadJson).epochKey === epochKey)
  if (!event?.commandId) throw new Error('Expected the actual panel finish event')
  await act(async () => root.unmount()); roots.splice(roots.indexOf(root), 1)
  readObserver.mockRestore()
  console.info('SFQA101 panel-cycle timings', { submissionKey, saveMs: savedAt - started, panelFinishMs: performance.now() - savedAt })
  return event.commandId
}
beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('No real model or external network authorized') }))
  fixture = await seedTtrpgOpenBriefDeskV1()
})
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  try { expect(fetch).not.toHaveBeenCalled() }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() }
})

describe('SFQA101 recap-window finish identity through public services and the real panel', () => {
  describe('two consecutive production windows', () => {
    const send = vi.fn(async () => output)
    let firstCommand: string | undefined
    beforeEach(async () => {
      send.mockClear()
      // Establish the first fully generated, confirmed and closed window as
      // the required prestate. The second real production remains timed by
      // the unchanged default 5s budget and retains every two-window check.
      firstCommand = await completeSaved(fixture.host, 'first', send)
    })
    it('saves and finishes two consecutive recaps, including a second-window reopen, without rewriting original answers or usage', async () => {
      if (!firstCommand) throw new Error('Expected the first real completed window')
      const secondCommand = await completeSaved(fixture.host, 'second', send)
      expect(new Set([firstCommand, secondCommand]).size).toBe(2)
      expect(send).toHaveBeenCalledTimes(2)
    })
  })

  it('reuses the exact original finish baseline and intent after acknowledgement loss, without closing a later window', async () => {
    const { host, other } = fixture
    const rawInput = '结束空复盘窗口的幂等恢复。'
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(host.sessionId, 'first.empty'), viewerKey: host.viewerKey, triggerKind: 'request-brief', rawInput })
    const state = await readProductRuntimeState(host.sessionId), epochKey = openRun(state).coordination.activeEpochKey
    if (!epochKey) throw new Error('Expected the real empty recap window')
    const original = await finishTtrpgOpenBriefDeskV1({ ...host, epochKey })
    db.close(); await db.open()
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(host.sessionId, 'second.empty'), viewerKey: host.viewerKey, triggerKind: 'request-brief', rawInput })
    const next = await readProductRuntimeState(host.sessionId)
    expect(openRun(next).coordination.activeEpochKey).not.toBe(epochKey)
    expect(await finishTtrpgOpenBriefDeskV1({ ...host, epochKey })).toEqual(original)
    expect(await readProductRuntimeState(host.sessionId)).toEqual(next)
    await expect(finishTtrpgOpenBriefDeskV1({ ...other, epochKey })).rejects.toThrow(/本人|主持/)
    await expect(finishTtrpgOpenBriefDeskV1({ ...host, epochKey: 'epoch.not-real' })).rejects.toThrow(/本人|复盘/)
    if (!original.commandId || original.baseSequence == null || !original.baseStateHash) throw new Error('Expected the original command preimage')
    await expect(closeTtrpgOpenEpochV1({ sessionId: host.sessionId, commandId: original.commandId,
      baseSequence: original.baseSequence, baseStateHash: original.baseStateHash, viewerKey: host.viewerKey,
      epochKey, reason: '试图用同一编号改写原结束意图。' })).rejects.toThrow(/不同命令/)
    expect(await readProductRuntimeState(host.sessionId)).toEqual(next)
  })

  describe('two panel windows', () => {
    const send = vi.fn(async () => output)
    let firstCommand: string | undefined
    beforeEach(async () => {
      send.mockClear()
      firstCommand = await completeSavedFromPanel(fixture.host, 'panel.first', send)
    })
    it('the current panel can finish both actual saved windows after remounting, with zero model calls from reads or clicks', async () => {
      if (!firstCommand) throw new Error('Expected the first actual panel finish')
      const secondCommand = await completeSavedFromPanel(fixture.host, 'panel.second', send)
      expect(new Set([firstCommand, secondCommand]).size).toBe(2)
      expect(send).toHaveBeenCalledTimes(2)
    })
  })

  it('reads an already committed legacy finish only by its exact closed-window event, without rewriting it', async () => {
    const { host } = fixture
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(host.sessionId, 'legacy.empty'), viewerKey: host.viewerKey, triggerKind: 'request-brief', rawInput: '既有窗口关闭回读。' })
    const epochKey = openRun(await readProductRuntimeState(host.sessionId)).coordination.activeEpochKey
    if (!epochKey) throw new Error('Expected the original legacy window')
    const legacy = await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(host.sessionId, 'brief.desk.finish'), viewerKey: host.viewerKey, epochKey, reason: '真人明确结束本次复盘' })
    const rows = await db.productRuntimeEvents.where('sessionId').equals(host.sessionId).toArray()
    db.close(); await db.open()
    expect(await finishTtrpgOpenBriefDeskV1({ ...host, epochKey })).toEqual(legacy)
    expect(await db.productRuntimeEvents.where('sessionId').equals(host.sessionId).toArray()).toEqual(rows)
  })
})
