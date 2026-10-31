import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { AgentEvent, AgentRunRecord, Project, WorkspaceScope } from '../../src/lib/types'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import * as runEvents from '../../src/lib/agent/run/event-store'
import { DialogProvider } from '../../src/components/shared/Dialog'
import ComicPipelinePanel from '../../src/components/comic/ComicPipelinePanel'
import MotionDramaStudio from '../../src/components/motion-drama/MotionDramaStudio'
import * as comic from '../../src/lib/comic/durable-production'
import * as motion from '../../src/lib/motion-drama/durable-production'
import * as comicDrafts from '../../src/lib/comic/authoring'
import * as motionDrafts from '../../src/lib/motion-drama/author-drafts'
import * as assembly from '../../src/lib/registry/assemble-context'
import * as transport from '../../src/lib/ai/client'
import { useAIConfigStore } from '../../src/stores/ai-config'
import {
  createQualityCreationFixture, generateQualityCreationCandidate, qualityMotionBible,
  type QualityCreationMedium,
} from '../helpers/quality001016-creation-fixtures'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
type Fixture = Awaited<ReturnType<typeof createQualityCreationFixture>>
const media: QualityCreationMedium[] = ['comic', 'motion-drama']
const taskTestId = (medium: QualityCreationMedium, id: number) => `${medium === 'comic' ? 'comic' : 'motion'}-task-${id}`

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function payload(medium: QualityCreationMedium, item: Fixture, marker: string) {
  return JSON.stringify(medium === 'motion-drama' ? { ...qualityMotionBible, titlePromise: marker } : [{
    stableKey: 'fact_ticket', kind: 'event', statement: marker, subjectKeys: [],
    sourceUnitKeys: [item.unit.sourceUnitKey], confidence: 1,
  }])
}
async function currentRun(scope: WorkspaceScope) {
  const rows = await readOwnedRows<AgentRunRecord>(scope, 'agentRuns', { owner: 'work' })
  expect(rows).toHaveLength(1)
  return readAgentRunV1(scope, rows[0].id!)
}
async function taskControls(scope: WorkspaceScope) {
  return (await readOwnedRows<AgentEvent>(scope, 'agentEvents', { owner: 'work' })).filter(row => row.kind === 'task')
}
async function waitFor(check: () => void) {
  const until = Date.now() + 4_000
  let failure: unknown
  do {
    try { await act(async () => check()); return } catch (cause) { failure = cause }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  } while (Date.now() < until)
  throw failure
}
function button(container: ParentNode, text: string) {
  const result = Array.from(container.querySelectorAll('button')).find(row => row.textContent?.trim() === text)
  if (!result) throw new Error(`没有找到按钮：${text}`)
  return result
}

describe('SFQA-001/016 · actual independent creation task interfaces', () => {
  let host: HTMLDivElement
  let root: Root | null
  beforeEach(async () => {
    await db.delete(); await db.open()
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    useAIConfigStore.setState({ config: { provider: 'openai', apiKey: 'SYNTHETIC_UI_ONLY_001016',
      baseUrl: 'http://127.0.0.1:9/v1', model: 'isolated-model', maxTokens: 1_024, temperature: 0 } })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('This isolated UI test prohibits all network requests') }))
  })
  afterEach(async () => {
    if (root) await act(async () => root!.unmount())
    root = null; host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete()
  })
  async function renderItem(medium: QualityCreationMedium, item: Fixture) {
    if (!root) root = createRoot(host)
    const project = await db.projects.get(item.scope.projectId) as Project
    const content = medium === 'comic'
      ? createElement(ComicPipelinePanel, { scope: item.scope, adaptation: item.adaptation,
        sourceUnits: [item.unit], pages: [], panels: [], subjectCount: 0, onChanged: async () => {} })
      : createElement(MotionDramaStudio, { scope: item.scope, project, page: 'series' })
    await act(async () => root!.render(createElement(MemoryRouter, null, createElement(DialogProvider, null, content))))
  }
  async function remount(medium: QualityCreationMedium, item: Fixture) {
    await act(async () => root!.unmount()); root = null
    await renderItem(medium, item)
  }

  for (const medium of media) {
    it(`${medium}: a task action read failure stays visible even when the professional editor is collapsed`, async () => {
      const item = await createQualityCreationFixture(medium)
      await expect(generateQualityCreationCandidate(medium, item, async () => { throw new Error('isolated unknown result') })).rejects.toThrow('isolated unknown result')
      const before = await currentRun(item.scope)
      await renderItem(medium, item)
      const selector = `[data-testid="${taskTestId(medium, before.run.id)}"]`
      await waitFor(() => expect(host.querySelector(selector)).toBeTruthy())
      if (medium === 'comic') await act(async () => button(host, '收起专业流程').click())
      const marker = 'isolated task action evidence read failure'
      if (medium === 'comic') vi.spyOn(comic, 'readComicProfessionalTaskV1').mockRejectedValueOnce(new Error(marker))
      else vi.spyOn(motion, 'readMotionDramaTaskV1').mockRejectedValueOnce(new Error(marker))
      await act(async () => button(host.querySelector(selector)!, '停止等待').click())
      await waitFor(() => expect(Array.from(host.querySelectorAll('[role="alert"]')).some(row => row.textContent?.includes(marker))).toBe(true))
      expect(await currentRun(item.scope)).toEqual(before)
      expect(await taskControls(item.scope)).toHaveLength(0)
      expect(fetch).not.toHaveBeenCalled()
    })

    it(`${medium}: cold-loads a no-candidate preparation failure and inspects its original evidence without a request`, async () => {
      const item = await createQualityCreationFixture(medium)
      const marker = `isolated ${medium} preparation diagnostic`
      const prepare = vi.spyOn(assembly, 'assembleContext').mockRejectedValueOnce(new Error(marker))
      const runAI = vi.fn(async () => payload(medium, item, '正常对照'))
      await expect(generateQualityCreationCandidate(medium, item, runAI)).rejects.toThrow(marker)
      prepare.mockRestore()
      const before = await currentRun(item.scope)
      const generate = medium === 'comic' ? vi.spyOn(comic, 'generateComicProfessionalCandidateV1') : vi.spyOn(motion, 'generateMotionDramaCandidateV1')
      await renderItem(medium, item)
      await waitFor(() => expect(host.querySelector(`[data-testid="${taskTestId(medium, before.run.id)}"]`)?.textContent).toContain('运行失败'))
      const task = host.querySelector(`[data-testid="${taskTestId(medium, before.run.id)}"]`)!
      expect(task.textContent).toContain(marker)
      await act(async () => button(task, '查看运行证据').click())
      await waitFor(() => expect(host.textContent).toContain('当前没有可核验的原响应正文'))
      expect(await currentRun(item.scope)).toEqual(before)
      expect(generate).not.toHaveBeenCalled(); expect(runAI).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    })

    it(`${medium}: the actual stop-waiting control survives remount without ending an unknown Run`, async () => {
      const item = await createQualityCreationFixture(medium)
      const runAI = vi.fn(async () => { throw new Error('synthetic unknown provider outcome') })
      await expect(generateQualityCreationCandidate(medium, item, runAI)).rejects.toThrow('synthetic unknown provider outcome')
      const before = await currentRun(item.scope)
      const generate = medium === 'comic' ? vi.spyOn(comic, 'generateComicProfessionalCandidateV1') : vi.spyOn(motion, 'generateMotionDramaCandidateV1')
      await renderItem(medium, item)
      await waitFor(() => expect(host.querySelector(`[data-testid="${taskTestId(medium, before.run.id)}"]`)?.textContent).toContain('原请求结果未确认'))
      const task = host.querySelector(`[data-testid="${taskTestId(medium, before.run.id)}"]`)!
      await act(async () => { const stop = button(task, '停止等待'); stop.click(); stop.click() })
      await waitFor(() => expect(task.textContent).toContain('已停止等待'))
      expect(await taskControls(item.scope)).toHaveLength(1)
      expect(await currentRun(item.scope)).toEqual(before)
      await remount(medium, item)
      await waitFor(() => expect(host.querySelector(`[data-testid="${taskTestId(medium, before.run.id)}"]`)?.textContent).toContain('已停止等待'))
      expect(await currentRun(item.scope)).toEqual(before)
      expect(generate).not.toHaveBeenCalled(); expect(runAI).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled()
    })

    it(`${medium}: a normal saved candidate still opens and its actual author button commits the candidate`, async () => {
      const item = await createQualityCreationFixture(medium)
      const marker = `正常作者确认 ${medium}`
      const generated = await generateQualityCreationCandidate(medium, item, async () => payload(medium, item, marker))
      const before = await readAgentRunV1(item.scope, generated.snapshot.run.id)
      await renderItem(medium, item)
      const acceptText = medium === 'comic' ? '作者确认并采纳' : '确认写入'
      await waitFor(() => expect(Array.from(host.querySelectorAll('textarea')).some(row => row.value.includes(marker))).toBe(true))
      // Draft channel initialization is allowed; the canonical Run remains read-only until the author acts.
      expect(await readAgentRunV1(item.scope, generated.snapshot.run.id)).toEqual(before)
      await act(async () => button(host, acceptText).click())
      await waitFor(() => expect(host.textContent).not.toContain('尚未写入'))
      await waitFor(() => expect(button(host, '查看运行证据')).toBeTruthy())
      await vi.waitFor(async () => expect((await readAgentRunV1(item.scope, generated.snapshot.run.id)).projection.state).toBe('completed'))
      if (medium === 'comic') expect((await db.adaptationSourceFacts.toArray()).map(row => row.statement)).toEqual([marker])
      else expect((await db.motionDramaSeriesBibles.toArray()).map(row => row.bible.titlePromise)).toEqual([marker])
      expect(fetch).not.toHaveBeenCalled()
    })

    it(`${medium}: an in-flight result arriving after the actual stop control remains explicitly openable`, async () => {
      const item = await createQualityCreationFixture(medium)
      const response = deferred<void>(); let entered = false
      const marker = `晚到候选 ${medium}`
      const runAI = vi.fn(async () => { entered = true; await response.promise; return payload(medium, item, marker) })
      const result = generateQualityCreationCandidate(medium, item, runAI)
      try {
        await vi.waitFor(() => expect(entered).toBe(true))
        const before = await currentRun(item.scope)
        await renderItem(medium, item)
        await waitFor(() => expect(host.querySelector(`[data-testid="${taskTestId(medium, before.run.id)}"]`)).toBeTruthy())
        const task = host.querySelector(`[data-testid="${taskTestId(medium, before.run.id)}"]`)!
        await act(async () => button(task, '停止等待').click())
        await waitFor(() => expect(task.textContent).toContain('已停止等待'))
        expect(await currentRun(item.scope)).toEqual(before)
      } finally { response.resolve() }
      const generated = await result
      const taskSelector = `[data-testid="${taskTestId(medium, generated.snapshot.run.id)}"]`
      await waitFor(() => expect(button(host.querySelector(taskSelector)!, '查看晚到候选').disabled).toBe(false))
      expect(Array.from(host.querySelectorAll('textarea')).some(row => row.value.includes(marker))).toBe(false)
      await act(async () => button(host.querySelector(taskSelector)!, '查看晚到候选').click())
      await waitFor(() => expect(Array.from(host.querySelectorAll('textarea')).some(row => row.value.includes(marker))).toBe(true))
      expect(await db.adaptationSourceFacts.count()).toBe(0); expect(await db.motionDramaSeriesBibles.count()).toBe(0)
      expect(runAI).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled()
    })

    it(`${medium}: an original author-draft read that returns late cannot replace another Work's candidate`, async () => {
      const a = await createQualityCreationFixture(medium); const b = await createQualityCreationFixture(medium)
      const aMarker = `A旧候选-${a.scope.workId}`; const bMarker = `B当前候选-${b.scope.workId}`
      await generateQualityCreationCandidate(medium, a, async () => payload(medium, a, aMarker))
      await generateQualityCreationCandidate(medium, b, async () => payload(medium, b, bMarker))
      const released = deferred<void>(); let entered = false
      if (medium === 'comic') {
        const original = comicDrafts.readComicAuthorDraft
        vi.spyOn(comicDrafts, 'readComicAuthorDraft').mockImplementation(async (scope, key) => {
          const value = await original(scope, key)
          if (scope.workId === a.scope.workId && key.startsWith('candidate:')) { entered = true; await released.promise }
          return value
        })
      } else {
        const original = motionDrafts.readMotionAuthorDraft
        vi.spyOn(motionDrafts, 'readMotionAuthorDraft').mockImplementation(async (scope, key) => {
          const value = await original(scope, key)
          if (scope.workId === a.scope.workId && key.startsWith('candidate:')) { entered = true; await released.promise }
          return value
        })
      }
      try {
        await renderItem(medium, a)
        await waitFor(() => expect(entered).toBe(true))
        await renderItem(medium, b)
        await waitFor(() => expect(Array.from(host.querySelectorAll('textarea')).some(row => row.value.includes(bMarker))).toBe(true))
      } finally { released.resolve() }
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
      expect(Array.from(host.querySelectorAll('textarea')).some(row => row.value.includes(aMarker))).toBe(false)
      expect(Array.from(host.querySelectorAll('textarea')).some(row => row.value.includes(bMarker))).toBe(true)
      const aRun = await currentRun(a.scope)
      expect(host.querySelector(`[data-testid="${taskTestId(medium, aRun.run.id)}"]`)).toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    })

    it(`${medium}: cancelling the explicit new-request question does not resume an unknown request`, async () => {
      const item = await createQualityCreationFixture(medium)
      await expect(generateQualityCreationCandidate(medium, item, async () => { throw new Error('unknown original request') })).rejects.toThrow('unknown original request')
      const before = await currentRun(item.scope)
      const send = vi.spyOn(transport, 'chat').mockRejectedValue(new Error('unexpected extra request'))
      await renderItem(medium, item)
      const generateText = medium === 'comic' ? '来源事实' : '生成专业候选'
      await waitFor(() => expect(Array.from(host.querySelectorAll('button')).find(row => row.textContent?.includes(generateText))?.disabled).toBe(false))
      const generate = Array.from(host.querySelectorAll('button')).find(row => row.textContent?.includes(generateText))!
      await act(async () => generate.click())
      await waitFor(() => expect(host.querySelector('[role="dialog"]')?.textContent).toContain('原请求结果仍未确认'))
      await act(async () => button(host.querySelector('[role="dialog"]')!, '取消').click())
      await waitFor(() => expect(host.querySelector('[role="dialog"]')).toBeNull())
      expect(await currentRun(item.scope)).toEqual(before)
      expect(send).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    })

    it(`${medium}: its real generate button binds stop-waiting to the Run and preserves a late transport result`, async () => {
      const item = await createQualityCreationFixture(medium)
      const response = deferred<void>(); let entered = false; let signal: AbortSignal | undefined
      const marker = `真实按钮晚到结果 ${medium}`
      const send = vi.spyOn(transport, 'chat').mockImplementation(async (_messages, _config, _options, originalSignal) => {
        signal = originalSignal; entered = true; await response.promise; return payload(medium, item, marker)
      })
      try {
        await renderItem(medium, item)
        const label = medium === 'comic' ? '来源事实' : '生成专业候选'
        await waitFor(() => expect(Array.from(host.querySelectorAll('button')).find(row => row.textContent?.includes(label))?.disabled).toBe(false))
        await act(async () => Array.from(host.querySelectorAll('button')).find(row => row.textContent?.includes(label))!.click())
        await waitFor(() => expect(entered).toBe(true))
        const before = await currentRun(item.scope)
        await waitFor(() => expect(host.querySelector(`[data-testid="${taskTestId(medium, before.run.id)}"]`)).toBeTruthy())
        await act(async () => button(host.querySelector(`[data-testid="${taskTestId(medium, before.run.id)}"]`)!, '停止等待').click())
        await waitFor(() => expect(host.querySelector(`[data-testid="${taskTestId(medium, before.run.id)}"]`)?.textContent).toContain('已停止等待'))
        expect(signal).toBeInstanceOf(AbortSignal); expect(signal?.aborted).toBe(false)
        expect(await currentRun(item.scope)).toEqual(before)
      } finally { response.resolve() }
      const original = await currentRun(item.scope)
      const selector = `[data-testid="${taskTestId(medium, original.run.id)}"]`
      await waitFor(() => expect(button(host.querySelector(selector)!, '查看晚到候选').disabled).toBe(false))
      expect(Array.from(host.querySelectorAll('textarea')).some(row => row.value.includes(marker))).toBe(false)
      expect((await currentRun(item.scope)).projection.state).toBe('awaiting_confirmation')
      await remount(medium, item)
      await waitFor(() => expect(button(host.querySelector(selector)!, '查看晚到候选').disabled).toBe(false))
      await act(async () => button(host.querySelector(selector)!, '查看晚到候选').click())
      await waitFor(() => expect(Array.from(host.querySelectorAll('textarea')).some(row => row.value.includes(marker))).toBe(true))
      expect(send).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled()
    })

    it(`${medium}: navigating to another Work detaches the view while the original sent response is retained`, async () => {
      const a = await createQualityCreationFixture(medium); const b = await createQualityCreationFixture(medium)
      const response = deferred<void>(); let entered = false; let signal: AbortSignal | undefined
      const marker = `A在途原结果 ${medium}`
      const send = vi.spyOn(transport, 'chat').mockImplementation(async (_messages, _config, _options, originalSignal) => {
        signal = originalSignal; entered = true; await response.promise; return payload(medium, a, marker)
      })
      try {
        await renderItem(medium, a)
        const label = medium === 'comic' ? '来源事实' : '生成专业候选'
        await waitFor(() => expect(Array.from(host.querySelectorAll('button')).find(row => row.textContent?.includes(label))?.disabled).toBe(false))
        await act(async () => Array.from(host.querySelectorAll('button')).find(row => row.textContent?.includes(label))!.click())
        await waitFor(() => expect(entered).toBe(true))
        await renderItem(medium, b)
        expect(signal).toBeInstanceOf(AbortSignal); expect(signal?.aborted).toBe(false)
      } finally { response.resolve() }
      await vi.waitFor(async () => expect((await currentRun(a.scope)).projection.state).toBe('awaiting_confirmation'))
      const aRun = await currentRun(a.scope)
      expect(host.querySelector(`[data-testid="${taskTestId(medium, aRun.run.id)}"]`)).toBeNull()
      expect(Array.from(host.querySelectorAll('textarea')).some(row => row.value.includes(marker))).toBe(false)
      expect(await readOwnedRows<AgentRunRecord>(b.scope, 'agentRuns', { owner: 'work' })).toHaveLength(0)
      expect(send).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled()
    })

    it(`${medium}: an explicit new-request confirmation creates one independent Run and preserves the old unknown prefix`, async () => {
      const item = await createQualityCreationFixture(medium)
      await expect(generateQualityCreationCandidate(medium, item, async () => { throw new Error('original unknown result') })).rejects.toThrow('original unknown result')
      const before = await currentRun(item.scope)
      const marker = `明确授权的新候选 ${medium}`
      const send = vi.spyOn(transport, 'chat').mockResolvedValue(payload(medium, item, marker))
      await renderItem(medium, item)
      const label = medium === 'comic' ? '来源事实' : '生成专业候选'
      await waitFor(() => expect(Array.from(host.querySelectorAll('button')).find(row => row.textContent?.includes(label))?.disabled).toBe(false))
      await act(async () => Array.from(host.querySelectorAll('button')).find(row => row.textContent?.includes(label))!.click())
      await waitFor(() => expect(host.querySelector('[role="dialog"]')?.textContent).toContain('独立的新请求'))
      await act(async () => button(host.querySelector('[role="dialog"]')!, '明确发起新请求').click())
      await waitFor(() => expect(Array.from(host.querySelectorAll('textarea')).some(row => row.value.includes(marker))).toBe(true))
      expect(await readAgentRunV1(item.scope, before.run.id)).toEqual(before)
      const all = await readOwnedRows<AgentRunRecord>(item.scope, 'agentRuns', { owner: 'work' })
      expect(all).toHaveLength(2)
      expect(send).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled()
    })

    it(`${medium}: the actual recovery editor and button preserve a frozen author payload`, async () => {
      const item = await createQualityCreationFixture(medium)
      const proposal = payload(medium, item, `原模型提案 ${medium}`)
      const authorMarker = `已确认作者修改 ${medium}`
      const generated = await generateQualityCreationCandidate(medium, item, async () => proposal)
      const original = runEvents.appendAgentRunEventV1
      const interrupted = vi.spyOn(runEvents, 'appendAgentRunEventV1').mockImplementation(async input => {
        const result = await original(input)
        if (input.type === 'adoption.started') throw new Error('isolated author adoption interruption')
        return result
      })
      const adopt = medium === 'comic' ? comic.adoptComicProfessionalCandidateV1 : motion.adoptMotionDramaProfessionalCandidateV1
      await expect(adopt({ scope: item.scope, runId: generated.snapshot.run.id, authorPayload: JSON.parse(payload(medium, item, authorMarker)) })).rejects.toThrow('isolated author adoption interruption')
      interrupted.mockRestore()
      const before = await readAgentRunV1(item.scope, generated.snapshot.run.id)
      const send = vi.spyOn(transport, 'chat').mockRejectedValue(new Error('recovery cannot call a model'))
      await renderItem(medium, item)
      await waitFor(() => expect(Array.from(host.querySelectorAll('textarea')).some(row => row.value.includes(authorMarker))).toBe(true))
      expect(host.textContent).toContain('已确认作者采纳待恢复')
      expect(Array.from(host.querySelectorAll('textarea')).filter(row => row.value.includes(authorMarker)).every(row => row.disabled || row.matches('fieldset[disabled] textarea'))).toBe(true)
      expect(await readAgentRunV1(item.scope, generated.snapshot.run.id)).toEqual(before)
      await act(async () => button(host, medium === 'comic' ? '继续完成已确认的采纳' : '继续采纳').click())
      await vi.waitFor(async () => expect((await readAgentRunV1(item.scope, generated.snapshot.run.id)).projection.state).toBe('completed'))
      if (medium === 'comic') expect((await db.adaptationSourceFacts.toArray()).map(row => row.statement)).toEqual([authorMarker])
      else expect((await db.motionDramaSeriesBibles.toArray()).map(row => row.bible.titlePromise)).toEqual([authorMarker])
      expect(send).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    })

    it(`${medium}: a saved checkpoint is restored only by the actual zero-model recovery button`, async () => {
      const item = await createQualityCreationFixture(medium)
      const marker = `已保存待恢复的候选 ${medium}`
      const original = runEvents.appendAgentRunEventV1
      const interrupted = vi.spyOn(runEvents, 'appendAgentRunEventV1').mockImplementation(async input => {
        if (input.type === 'candidate.persisted') throw new Error('isolated candidate-event persistence failure')
        return original(input)
      })
      const runAI = vi.fn(async () => payload(medium, item, marker))
      await expect(generateQualityCreationCandidate(medium, item, runAI)).rejects.toThrow('isolated candidate-event persistence failure')
      interrupted.mockRestore()
      const before = await currentRun(item.scope)
      const send = vi.spyOn(transport, 'chat').mockRejectedValue(new Error('checkpoint recovery cannot call a model'))
      await renderItem(medium, item)
      const selector = `[data-testid="${taskTestId(medium, before.run.id)}"]`
      await waitFor(() => expect(button(host.querySelector(selector)!, '恢复已保存候选（不调用模型）').disabled).toBe(false))
      expect(await currentRun(item.scope)).toEqual(before)
      expect(Array.from(host.querySelectorAll('textarea')).some(row => row.value.includes(marker))).toBe(false)
      await act(async () => button(host.querySelector(selector)!, '恢复已保存候选（不调用模型）').click())
      await waitFor(() => expect(Array.from(host.querySelectorAll('textarea')).some(row => row.value.includes(marker))).toBe(true))
      expect((await currentRun(item.scope)).projection.state).toBe('awaiting_confirmation')
      expect(runAI).toHaveBeenCalledTimes(1); expect(send).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
      expect(await db.adaptationSourceFacts.count()).toBe(0); expect(await db.motionDramaSeriesBibles.count()).toBe(0)
    })

    it(`${medium}: refusal of the terminal storage write remains visible as an unverified ending`, async () => {
      const item = await createQualityCreationFixture(medium)
      const marker = 'isolated preparation failure while terminal storage is unavailable'
      vi.spyOn(assembly, 'assembleContext').mockRejectedValueOnce(new Error(marker))
      const original = runEvents.appendAgentRunEventV1
      const interrupted = vi.spyOn(runEvents, 'appendAgentRunEventV1').mockImplementation(async input => {
        if (input.type === 'run.failed') throw new Error('isolated terminal storage failure')
        return original(input)
      })
      await expect(generateQualityCreationCandidate(medium, item, async () => '[]')).rejects.toThrow('任务诊断或状态未能完整保存')
      interrupted.mockRestore()
      const before = await currentRun(item.scope)
      await renderItem(medium, item)
      const selector = `[data-testid="${taskTestId(medium, before.run.id)}"]`
      await waitFor(() => expect(host.querySelector(selector)?.textContent).toContain('准备中断，终态待核验'))
      expect(host.querySelector(selector)?.textContent).toContain(marker)
      await act(async () => button(host.querySelector(selector)!, '停止等待').click())
      await waitFor(() => expect(host.querySelector(selector)?.textContent).toContain('已停止等待'))
      expect(await currentRun(item.scope)).toEqual(before)
      expect(fetch).not.toHaveBeenCalled()
    })
  }
})
