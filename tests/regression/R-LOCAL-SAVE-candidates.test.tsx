import { act } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CandidateSaveFeedback from '../../src/components/agent/CandidateSaveFeedback'
import CandidateMarkdownField from '../../src/components/agent/CandidateMarkdownField'
import { CTextarea } from '../../src/components/shared/CompositionInput'
import { useMasterCopilot, type MasterCopilotController } from '../../src/components/agent/useMasterCopilot'
import { db } from '../../src/lib/db/schema'
import * as conversations from '../../src/lib/agent/conversations'
import { readCandidateLocalSaveWitnessV1 } from '../../src/lib/authoring/candidate-local-save-evidence'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { flushCandidateDraftsV1, resetCandidateDraftCoordinatorForTestsV1 } from '../../src/lib/agent/candidate-draft-coordinator'
import { seedCurrentMasterCandidate } from '../helpers/current-master-candidate'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { currentWorldOriginDraftV1 } from '../helpers/current-worldview-field'
import type { AgentEvent, Project } from '../../src/lib/types'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let controller: MasterCopilotController, host: HTMLDivElement, root: ReturnType<typeof createRoot>, project: Project
const raw = '# 原候选\r\n\r\n军税17枚，不可夜航。　 '
const status = () => host.querySelector('[data-candidate-local-save-status]')?.getAttribute('data-candidate-local-save-status')
function Harness({ rawControl = false }: { rawControl?: boolean }) {
  controller = useMasterCopilot({ project, worldGroupId: null })
  const candidate = controller.pendingCandidates[0]
  return candidate ? <CandidateSaveFeedback event={candidate.event} scope={controller.candidateLocalSaveScope}
    draftState={controller.readCandidateLocalDraftState(candidate.event.id!)} busy={controller.busy}
    onRetry={() => controller.flushCandidateDraft(candidate.event.id!)}>
    {rawControl ? <CTextarea value={JSON.parse(candidate.event.content).value}
      onChange={event => { void controller.updateCandidate(candidate.event.id!, currentWorldOriginDraftV1(event.target.value)) }} /> : <CandidateMarkdownField value={JSON.parse(candidate.event.content).value} disabled={controller.busy}
      onCommit={() => controller.flushCandidateDraft(candidate.event.id!)}>
      <CTextarea value={JSON.parse(candidate.event.content).value}
        onChange={event => { void controller.updateCandidate(candidate.event.id!, currentWorldOriginDraftV1(event.target.value)) }} />
    </CandidateMarkdownField>}
  </CandidateSaveFeedback> : null
}
beforeEach(async () => {
  resetPendingEditCoordinatorForTestsV1(); resetCandidateDraftCoordinatorForTestsV1()
  await db.delete(); await db.open(); host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('No model or external calls') }))
})
afterEach(async () => {
  await act(async () => root.unmount()); await flushCandidateDraftsV1().catch(() => undefined)
  host.remove(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  resetPendingEditCoordinatorForTestsV1(); resetCandidateDraftCoordinatorForTestsV1(); await db.delete()
})
async function waitFor(check: () => void | Promise<void>) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }); await check() })
}
async function fixture() {
  const f = await seedCurrentMasterCandidate('050 candidate save', raw); project = f.project
  await act(async () => root.render(<Harness />))
  await waitFor(() => expect(status()).toBe('saved'))
  return f
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(row => row.textContent === text)!
  expect(button).toBeTruthy(); await act(async () => button.click())
}
async function input(text: string) {
  const area = host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return area
}
it('confirms the original durable candidate read and a reopened record without writing the formal target', async () => {
  const f = await fixture(), before = (await db.agentEvents.get(f.candidate.event.id!))!
  expect(host.textContent).toContain('候选已保存到本机 · 尚未采纳')
  expect(await readCandidateLocalSaveWitnessV1(f.scope, before)).toMatchObject({ eventId: before.id, runId: before.durableRunId })
  await click('查看源码'); expect(host.querySelector('[data-markdown-source]')?.textContent).toBe(raw)
  expect(await db.agentEvents.get(before.id!)).toEqual(before); expect(await db.worldviews.count()).toBe(0)
  await act(async () => root.unmount()); db.close(); await db.open(); root = createRoot(host)
  await act(async () => root.render(<Harness />)); await waitFor(() => expect(status()).toBe('saved'))
  expect(await db.agentEvents.get(before.id!)).toEqual(before)
})
it('retains failed source and an honest failure label, then verifies the same visible retry against the DB', async () => {
  const f = await fixture(), before = (await db.agentEvents.get(f.candidate.event.id!))!
  await click('编辑源码'); const area = await input('# 修改候选\n\n仍为17枚。　 ')
  expect(status()).not.toBe('saved')
  const fault = () => { throw new DOMException('candidate quota', 'QuotaExceededError') }; db.agentEvents.hook('updating', fault)
  try { await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('candidate quota') }) }
  finally { db.agentEvents.hook('updating').unsubscribe(fault) }
  expect(status()).toBe('failed'); expect(area.value).toBe('# 修改候选\n\n仍为17枚。　 ')
  expect(await db.agentEvents.get(before.id!)).toEqual(before)
  await click('重试保存候选'); await waitFor(() => expect(status()).toBe('saved'))
  expect(controller.error).toBeNull()
  expect(JSON.parse((await db.agentEvents.get(before.id!))!.content).value).toBe('# 修改候选\n\n仍为17枚。　 ')
  expect(await db.worldviews.count()).toBe(0)
})
it('invalidates the old saved label during composition and confirms its final tail before explicit adoption', async () => {
  await fixture(); await click('编辑源码'); const area = host.querySelector('textarea')!
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  await input('# 中文尾字🌊'); expect(status()).toBe('dirty')
  await act(async () => { expect(await controller.adoptCandidate(controller.pendingCandidates[0])).toBe(false) })
  expect(await db.worldviews.count()).toBe(0); expect(status()).not.toBe('saved')
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await act(async () => flushPendingEditsV1()); await waitFor(() => expect(status()).toBe('saved'))
  await act(async () => { expect(await controller.adoptCandidate(controller.pendingCandidates[0])).toBe(true) })
  expect((await db.worldviews.toArray())[0]?.worldOrigin).toBe('# 中文尾字🌊')
  expect(host.querySelector('[data-candidate-local-save-status]')).toBeNull()
})
it('does not allow an earlier committed candidate to confirm later typing while the queue is draining', async () => {
  const f = await fixture(), original = conversations.updateAgentEventCandidate
  let release!: () => void, held = false, calls = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(conversations, 'updateAgentEventCandidate').mockImplementation(async (...args) => {
    const result = await original(...args)
    if (++calls === 1) { held = true; await gate }
    return result
  })
  await click('编辑源码'); await input('# 第一稿')
  await waitFor(() => expect(held).toBe(true)); await input('# 第二稿')
  expect(JSON.parse((await db.agentEvents.get(f.candidate.event.id!))!.content).value).toBe('# 第一稿')
  expect(status()).not.toBe('saved')
  await act(async () => { release(); await flushPendingEditsV1() }); await waitFor(() => expect(status()).toBe('saved'))
  expect(JSON.parse((await db.agentEvents.get(f.candidate.event.id!))!.content).value).toBe('# 第二稿'); expect(calls).toBe(2)
})
it.each(['snapshot', 'failure'])('ignores an older read %s arriving after the latest committed author draft', async kind => {
  const f = await fixture(), oldRows = await conversations.readAgentEvents(f.conversation.id!, f.scope)
  const read = conversations.readAgentEvents
  let release!: () => void, intercepted = false
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(conversations, 'readAgentEvents').mockImplementation(async (...args) => {
    if (!intercepted) { intercepted = true; await gate; if (kind === 'failure') throw Error('obsolete read failure'); return oldRows }
    return read(...args)
  })
  await click('编辑源码'); await input('# 第一稿已提交')
  await act(async () => flushPendingEditsV1()); await waitFor(() => expect(intercepted).toBe(true))
  await click('编辑源码')
  await input('# 第二稿已提交'); await act(async () => flushPendingEditsV1())
  await waitFor(() => expect(status()).toBe('saved'))
  await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 20)) })
  await waitFor(() => expect(status()).toBe('saved'))
  expect(JSON.parse(controller.pendingCandidates[0].event.content).value).toBe('# 第二稿已提交')
  expect(controller.error).toBeNull()
  expect(JSON.parse((await db.agentEvents.get(f.candidate.event.id!))!.content).value).toBe('# 第二稿已提交')
})
it('withholds success for a changed draft, forged stored text or missing run proof', async () => {
  const f = await fixture(), before = (await db.agentEvents.get(f.candidate.event.id!))!
  expect(await readCandidateLocalSaveWitnessV1(f.scope, { ...before, content: 'memory-only' })).toBeNull()
  await db.agentEvents.update(before.id!, { content: 'forged durable text' })
  expect(await readCandidateLocalSaveWitnessV1(f.scope, (await db.agentEvents.get(before.id!))!)).toBeNull()
  await db.agentEvents.put(before); await db.agentRuns.delete(before.durableRunId!)
  await expect(readCandidateLocalSaveWitnessV1(f.scope, before)).rejects.toThrow()
})
it('rejects another Work and a resolved void callback cannot manufacture saved state', async () => {
  const f = await fixture(), before = (await db.agentEvents.get(f.candidate.event.id!))!
  const other = await seedCurrentWorkspace('foreign save proof')
  expect(await readCandidateLocalSaveWitnessV1(other.scope, before)).toBeNull()
  const memory: AgentEvent = { ...before, content: 'only in memory' }
  const retry = vi.fn(async () => undefined)
  await act(async () => root.render(<CandidateSaveFeedback event={memory} scope={f.scope} busy={false} onRetry={retry}><span>retained draft</span></CandidateSaveFeedback>))
  await click('重试保存候选'); await waitFor(() => expect(retry).toHaveBeenCalledTimes(1))
  expect(status()).toBe('unconfirmed'); expect(await db.agentEvents.get(before.id!)).toEqual(before)
})

it('keeps the actual author input when the real parent rerenders between native input capture and bubble', async () => {
  const f = await fixture()
  await click('编辑源码')
  const area = host.querySelector('textarea')!
  // A browser may run the capture update before the controlled textarea's
  // bubble onChange. Force precisely that existing scheduling boundary.
  area.addEventListener('input', () => flushSync(() => root.render(<Harness />)), { capture: true })
  const edited = '# 作者在当前候选改稿\n\n只采纳明确修改后的来源。'
  await input(edited)
  expect(area.value).toBe(edited)
  await act(async () => flushPendingEditsV1())
  await waitFor(() => expect(status()).toBe('saved'))
  expect(JSON.parse((await db.agentEvents.get(f.candidate.event.id!))!.content).value).toBe(edited)
  expect(await db.worldviews.count()).toBe(0)
})

it('guards a direct typed-candidate textarea during composition and confirms only its original durable event after retry', async () => {
  const f = await fixture()
  await act(async () => root.render(<Harness rawControl />))
  await waitFor(() => expect(status()).toBe('saved'))
  const area = host.querySelector('textarea')!
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  await input('# 直接候选输入法尾字 é 🌋。  ')
  expect(status()).toBe('dirty')
  await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('候选输入法') })
  await act(async () => { expect(await controller.adoptCandidate(controller.pendingCandidates[0])).toBe(false) })
  expect(await db.worldviews.count()).toBe(0)
  const fault = () => { throw new DOMException('typed candidate quota', 'QuotaExceededError') }
  db.agentEvents.hook('updating', fault)
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('typed candidate quota') })
  expect(status()).toBe('failed'); expect(area.value).toBe('# 直接候选输入法尾字 é 🌋。  ')
  db.agentEvents.hook('updating').unsubscribe(fault)
  await click('重试保存候选'); await waitFor(() => expect(status()).toBe('saved'))
  const actual = (await db.agentEvents.get(f.candidate.event.id!))!
  expect(JSON.parse(actual.content).value).toBe('# 直接候选输入法尾字 é 🌋。  ')
  expect(actual.durableRunId).toBe(f.candidate.event.durableRunId)
  expect(await db.worldviews.count()).toBe(0)
})
