import 'fake-indexeddb/auto'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMasterCopilot, type MasterCopilotController } from '../../src/components/agent/useMasterCopilot'
import WorldviewAgentControls from '../../src/components/worldview/WorldviewAgentControls'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { flushCandidateDraftsV1, resetCandidateDraftCoordinatorForTestsV1 } from '../../src/lib/agent/candidate-draft-coordinator'
import * as conversations from '../../src/lib/agent/conversations'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { db } from '../../src/lib/db/schema'
import { seedCurrentMasterCandidate } from '../helpers/current-master-candidate'
import { seedSfqa118ObjectCandidate } from '../helpers/sfqa118-worldview-candidate'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)

const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('SFQA118 forbids real model or network calls') })
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let currentController: MasterCopilotController | undefined

beforeEach(async () => {
  resetCandidateDraftCoordinatorForTestsV1()
  await db.delete()
  await db.open()
  fetcher.mockClear()
  vi.stubGlobal('fetch', fetcher)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  const id = currentController?.pendingCandidates[0]?.event.id
  if (id != null) await act(async () => { await currentController?.discardVisibleCandidateDraft?.(id) })
  await act(async () => root.unmount())
  await flushCandidateDraftsV1().catch(() => undefined)
  resetCandidateDraftCoordinatorForTestsV1()
  host.remove()
  expect(fetcher).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  currentController = undefined
  await db.delete()
})

function enterText(editor: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, value)
  editor.dispatchEvent(new Event('input', { bubbles: true }))
  editor.dispatchEvent(new Event('change', { bubbles: true }))
}

type Fixture = Awaited<ReturnType<typeof seedCurrentMasterCandidate>>

function button(label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label)
  if (!result) throw new Error(`Expected real control ${label}`)
  return result
}

async function renderField(fixture: Fixture, field: 'worldOrigin' | 'divineDesign' = 'worldOrigin') {
  let controller: MasterCopilotController | undefined
  let decision: Promise<unknown> | undefined
  function Harness() {
    const copilot = useMasterCopilot({ project: fixture.project, worldGroupId: null })
    controller = copilot
    currentController = copilot
    return <WorldviewAgentControls
      field={field}
      project={fixture.project}
      activeGroupId={null}
      copilot={copilot}
      candidate={copilot.pendingCandidates[0]}
      hasOtherPendingCandidates={false}
      onRunningChange={() => undefined}
      onAdopted={async candidate => { decision = copilot.adoptCandidate(candidate); await decision }}
    />
  }
  await act(async () => root.render(<DialogProvider><ToastProvider><Harness /></ToastProvider></DialogProvider>))
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!controller?.loading && controller?.pendingCandidates.length === 1) break
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  }
  const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label$="候选内容"]')
  if (!editor) throw new Error('Expected the real worldview candidate editor')
  const current = () => {
    if (!controller) throw new Error('Expected actual Master Copilot controller')
    return controller
  }
  return { editor, adopt: button('采纳'), decision: () => decision, current }
}

const worldviewRows = (fixture: Fixture) => db.worldviews.where('projectId').equals(fixture.scope.projectId).toArray()
const runEvents = (fixture: Fixture) => db.agentRunEvents.where('runId').equals(fixture.result.runId).toArray()

async function currentSavedEvent(fixture: Fixture) {
  const events = await conversations.readAgentEvents(fixture.conversation.id!, fixture.scope)
  return events.find(event => event.id === fixture.candidate.event.id)
}

async function adoptThroughUi(ui: Awaited<ReturnType<typeof renderField>>) {
  await act(async () => { ui.adopt.click(); await ui.decision() })
}

describe('SFQA118 · visible worldview draft is the candidate decision input', () => {
  it('does not adopt an older saved value while the real editor visibly contains one character', async () => {
    const fixture = await seedCurrentMasterCandidate('SFQA118 隔离候选', '旧的完整世界来源候选不能替代作者当前的输入。')
    const before = await db.worldviews.where('projectId').equals(fixture.scope.projectId).toArray()
    const ui = await renderField(fixture)
    await act(async () => enterText(ui.editor, '字'))
    expect(ui.editor.value).toBe('字')
    await act(async () => { ui.adopt.click(); await ui.decision() })
    expect(await db.worldviews.where('projectId').equals(fixture.scope.projectId).toArray()).toEqual(before)
    const events = await conversations.readAgentEvents(fixture.conversation.id!, fixture.scope)
    expect(events.filter(event => event.kind === 'confirmation')).toHaveLength(0)
    expect(ui.editor.value).toBe('字')
    expect(ui.adopt.disabled).toBe(true)
    expect(host.textContent).toContain('至少需要 2 个字符')
  })

  it('empty visible text blocks the same candidate public decision and explicit discard restores only its saved version', async () => {
    const fixture = await seedCurrentMasterCandidate('SFQA118 清空后放弃', '保存的世界来源文本。')
    const ui = await renderField(fixture)
    const saved = await currentSavedEvent(fixture)
    const before = await runEvents(fixture)
    await act(async () => enterText(ui.editor, ''))
    let adopted: boolean | undefined
    await act(async () => { const otherSurface = ui.current(); adopted = await otherSurface.adoptCandidate(otherSurface.pendingCandidates[0]) })
    expect(adopted).toBe(false)
    expect(ui.editor.value).toBe('')
    expect(await currentSavedEvent(fixture)).toEqual(saved)
    expect(await worldviewRows(fixture)).toEqual([])
    await act(async () => button('放弃未保存修改').click())
    for (let attempt = 0; ui.adopt.disabled && attempt < 100; attempt += 1) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    }
    expect(ui.editor.value).toBe('保存的世界来源文本。')
    expect(await runEvents(fixture)).toEqual(before)
    await adoptThroughUi(ui)
    expect((await worldviewRows(fixture))[0]?.worldOrigin).toBe('保存的世界来源文本。')
  })

  it('keeps a delayed valid edit blocked until acknowledgment, then restores and adopts that exact draft with same-run evidence', async () => {
    const fixture = await seedCurrentMasterCandidate('SFQA118 持久化确认', '等待作者调整的原始世界来源。')
    const ui = await renderField(fixture)
    const draft = '作者确认的世界来源：海退三次后，盐印才允许进入城门。'
    const saved = await currentSavedEvent(fixture)
    const originalEvents = await runEvents(fixture)
    const originalUpdate = conversations.updateAgentEventCandidate
    let enter!: () => void, release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(conversations, 'updateAgentEventCandidate').mockImplementationOnce(async (...args) => {
      enter(); await gate
      return originalUpdate(...args)
    })
    let saving: Promise<void> | undefined
    await act(async () => { enterText(ui.editor, draft); saving = flushCandidateDraftsV1(); await entered })
    try {
      expect(ui.adopt.disabled).toBe(true)
      expect(host.textContent).toContain('正在保存当前候选编辑')
      expect(await currentSavedEvent(fixture)).toEqual(saved)
      await adoptThroughUi(ui)
      expect(await worldviewRows(fixture)).toEqual([])
    } finally { await act(async () => { release(); await saving }) }
    const restored = await renderField(fixture)
    expect(restored.editor.value).toBe(draft)
    expect(restored.adopt.disabled).toBe(false)
    await adoptThroughUi(restored)
    expect((await worldviewRows(fixture))[0]?.worldOrigin).toBe(draft)
    const evidence = await runEvents(fixture)
    expect(evidence.slice(0, originalEvents.length)).toEqual(originalEvents)
    expect(evidence.filter(event => event.type === 'candidate.revised')).toHaveLength(1)
    const verification = await verifyMasterAgentRunV1({ scope: fixture.scope, runId: fixture.result.runId })
    expect(verification.accepted).toBe(true)
    expect(verification.snapshot.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('keeps a failed valid save visible and refuses to adopt the hidden persisted value', async () => {
    const fixture = await seedCurrentMasterCandidate('SFQA118 保存故障', '保存故障前的世界来源。')
    const ui = await renderField(fixture)
    const old = await currentSavedEvent(fixture)
    vi.spyOn(conversations, 'updateAgentEventCandidate').mockRejectedValueOnce(new Error('注入的候选保存失败'))
    const draft = '可见但尚未保存的作者文本。'
    await act(async () => enterText(ui.editor, draft))
    let adopted: boolean | undefined
    await act(async () => { const caller = ui.current(); adopted = await caller.adoptCandidate(caller.pendingCandidates[0]) })
    expect(adopted).toBe(false)
    expect(ui.editor.value).toBe(draft)
    expect(ui.adopt.disabled).toBe(true)
    expect(host.textContent).toContain('注入的候选保存失败')
    expect(await currentSavedEvent(fixture)).toEqual(old)
    expect(await worldviewRows(fixture)).toEqual([])
  })

  it('blocks IME input across panel selection and warns on exit after the editor unmounts', async () => {
    const fixture = await seedCurrentMasterCandidate('SFQA118 组合输入', '组合输入前已保存的文本。')
    const ui = await renderField(fixture)
    const saved = await currentSavedEvent(fixture)
    await act(async () => {
      ui.editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      enterText(ui.editor, 'zu he')
    })
    expect(ui.editor.value).toBe('zu he')
    expect(ui.adopt.disabled).toBe(true)
    expect(host.textContent).toContain('正在组合输入')
    await act(async () => root.render(null))
    const closing = new Event('beforeunload', { cancelable: true })
    await act(async () => { window.dispatchEvent(closing); await Promise.resolve() })
    expect(closing.defaultPrevented).toBe(true)
    expect(await currentSavedEvent(fixture)).toEqual(saved)
    const restored = await renderField(fixture)
    expect(restored.editor.value).toBe('zu he')
    expect(restored.adopt.disabled).toBe(true)
    await act(async () => { enterText(restored.editor, '组合输入结束后的作者定稿。'); await flushCandidateDraftsV1() })
    await adoptThroughUi(restored)
    expect((await worldviewRows(fixture))[0]?.worldOrigin).toBe('组合输入结束后的作者定稿。')
  })

  it('retains incomplete object JSON and adopts only the repaired complete object after remount', async () => {
    const fixture = await seedSfqa118ObjectCandidate()
    const ui = await renderField(fixture, 'divineDesign')
    const broken = '{"hasDivinity":'
    await act(async () => enterText(ui.editor, broken))
    expect(ui.editor.value).toBe(broken)
    expect(host.textContent).toContain('对象 JSON 无效')
    expect(ui.adopt.disabled).toBe(true)
    await adoptThroughUi(ui)
    expect(await worldviewRows(fixture)).toEqual([])
    const repaired = { hasDivinity: true, divineRank: '潮汐议会', divineNames: '受誓者', divineRules: '不取未许可的记忆。' }
    await act(async () => { enterText(ui.editor, JSON.stringify(repaired)); await flushCandidateDraftsV1() })
    const restored = await renderField(fixture, 'divineDesign')
    expect(JSON.parse(restored.editor.value)).toEqual(repaired)
    expect(restored.adopt.disabled).toBe(false)
    await adoptThroughUi(restored)
    expect((await worldviewRows(fixture))[0]?.divineDesign).toEqual(repaired)
  })
})
