import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import CandidateMarkdownField from '../../src/components/agent/CandidateMarkdownField'
import CandidateDraftEditor from '../../src/components/agent/CandidateDraftEditor'
import { CTextarea } from '../../src/components/shared/CompositionInput'
import { useMasterCopilot, type MasterCopilotController } from '../../src/components/agent/useMasterCopilot'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { flushCandidateDraftsV1, resetCandidateDraftCoordinatorForTestsV1 } from '../../src/lib/agent/candidate-draft-coordinator'
import { db } from '../../src/lib/db/schema'
import { seedCurrentMasterCandidate } from '../helpers/current-master-candidate'
import { currentWorldOriginDraftV1 } from '../helpers/current-worldview-field'
import type { Project } from '../../src/lib/types'
import type { MasterCandidatePayload } from '../../src/lib/agent/orchestrator'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let controller: MasterCopilotController
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, project: Project
const raw = '# 候选原文\r\n\r\n**事实**：第七年。\r\n\r\n<script>globalThis.candidateBad=1</script>\r\n![外图](https://blocked.invalid/candidate.png)\r\n  '
function Harness() {
  controller = useMasterCopilot({ project, worldGroupId: null })
  const candidate = controller.pendingCandidates[0]
  if (!candidate) return null
  const value: string = JSON.parse(candidate.event.content).value
  return <CandidateMarkdownField key={candidate.event.id} value={value} disabled={controller.busy}
    onCommit={() => controller.flushCandidateDraft(candidate.event.id!)}>
    <CTextarea value={value} onChange={event => { void controller.updateCandidate(candidate.event.id!, currentWorldOriginDraftV1(event.target.value)) }} />
  </CandidateMarkdownField>
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
async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    if (predicate()) return
  }
  throw Error('Candidate UI did not settle')
}
async function fixture() {
  const fixture = await seedCurrentMasterCandidate('候选 Markdown', raw); project = fixture.project
  await act(async () => root.render(<Harness />))
  await waitFor(() => host.querySelector('[data-markdown-read-view]') !== null)
  return fixture
}
async function click(label: string) {
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === label)!.click())
}
async function input(text: string) {
  const area = host.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return area
}

it('reads the existing durable candidate safely without changing its exact source, hash, or formal target', async () => {
  const fixtureValue = await fixture(), id = fixtureValue.candidate.event.id!
  const before = await db.agentEvents.get(id)
  expect(host.querySelector('h1')?.textContent).toBe('候选原文')
  expect(host.querySelector('script,img,iframe,svg')).toBeNull(); expect(Reflect.get(globalThis, 'candidateBad')).toBeUndefined()
  await click('查看源码'); expect(host.querySelector('[data-markdown-source]')?.textContent).toBe(raw)
  expect(await db.agentEvents.get(id)).toEqual(before); expect(await db.worldviews.count()).toBe(0)
})

it('keeps the original editor after failed durable synchronization and reads only after the same queue commits a retry', async () => {
  const fixtureValue = await fixture(), id = fixtureValue.candidate.event.id!
  const before = await db.agentEvents.get(id)
  await click('编辑源码'); const area = await input('# 修订候选\n\n仍为第七年。  ')
  const reject = () => { throw Error('candidate-write-failure') }; db.agentEvents.hook('updating', reject)
  try { await act(async () => { await expect(flushPendingEditsV1()).rejects.toThrow('candidate-write-failure') }) }
  finally { db.agentEvents.hook('updating').unsubscribe(reject) }
  expect(host.querySelector('textarea')).toBe(area); expect(area.value).toBe('# 修订候选\n\n仍为第七年。  ')
  expect((await db.agentEvents.get(id))?.content).toBe(before?.content)
  await click('重试同步候选')
  await waitFor(() => host.querySelector('textarea') === null)
  expect(JSON.parse((await db.agentEvents.get(id))!.content).value).toBe('# 修订候选\n\n仍为第七年。  ')
  expect(host.querySelector('h1')?.textContent).toBe('修订候选'); expect(await db.worldviews.count()).toBe(0)
  await act(async () => root.unmount()); root = createRoot(host)
  await act(async () => root.render(<Harness />))
  await waitFor(() => host.querySelector('h1')?.textContent === '修订候选')
})

it('blocks adoption during composition, then synchronizes its final tail before the original explicit adoption', async () => {
  await fixture(); await click('编辑源码'); const area = host.querySelector('textarea')!
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  await input('# 中文尾字🌊')
  await act(async () => { expect(await controller.adoptCandidate(controller.pendingCandidates[0])).toBe(false) })
  expect(await db.worldviews.count()).toBe(0); expect(host.querySelector('textarea')).toBe(area)
  await act(async () => area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await act(async () => { await flushPendingEditsV1() })
  expect(host.querySelector('h1')?.textContent).toBe('中文尾字🌊')
  await act(async () => { expect(await controller.adoptCandidate(controller.pendingCandidates[0])).toBe(true) })
  expect((await db.worldviews.toArray())[0]?.worldOrigin).toBe('# 中文尾字🌊')
})

it('opts only registered longtext fields into Markdown while names, enums and raw JSON keep their original controls', async () => {
  const payload = { skillId: 'character.create', agentId: 'character', label: '角色' } as MasterCandidatePayload
  const value = JSON.stringify({ name: '# 字面名称', roleWeight: 'main', background: '# 背景\n\n保留原文。' })
  const change = vi.fn(), commit = vi.fn(async () => undefined)
  await act(async () => root.render(<CandidateDraftEditor payload={payload} value={value} disabled={false} onChange={change} onCommit={commit} />))
  expect(host.querySelectorAll('[data-markdown-read-view]')).toHaveLength(1)
  expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="姓名 · 候选 1"]')?.value).toBe('# 字面名称')
  expect(host.querySelector('select')).not.toBeNull(); expect(change).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled()
  await click('查看原始结构')
  expect(host.querySelectorAll('[data-markdown-read-view]')).toHaveLength(0)
  expect(host.querySelector('textarea')?.value).toBe(value)
})
