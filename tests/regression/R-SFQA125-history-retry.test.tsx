import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { buildWorkRecord, createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import { generateWorkspaceScopeCode } from '../../src/lib/workspace/identity'
import { useHistoricalStore } from '../../src/stores/historical'
import { useWorldGroupStore } from '../../src/stores/world-group'
import * as durable from '../../src/lib/agent/run/history-agent-durable'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import type { AIConfig, Project } from '../../src/lib/types'
import type { HistoryAIMode } from '../../src/lib/history/ai-plan'
import HistoryPanel from '../../src/components/history/HistoryPanel'
import { useHistoryAI } from '../../src/components/history/useHistoryAI'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const generate = durable.generateHistoryAgentCandidateV1
const reject = durable.rejectHistoryAgentCandidateV1
const aiConfig: AIConfig = { provider: 'ollama', apiKey: '', baseUrl: 'http://localhost:1234/v1', model: 'isolated-history', temperature: 0, maxTokens: 0 }
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let calls: number
const errors = vi.fn()
let controller: ReturnType<typeof useHistoryAI>

function result(mode: HistoryAIMode, number: number) {
  return mode === 'consult'
    ? `## 前提识别\n- 合成考据${number}：镜税署与盐票是作者明确的架空设定。\n## 可能存在的问题\n- 制度执行成本仍需要说明。\n## 修改方案 / 折中方案\n- 补充验票与连带责任制度。\n## 时代质感补充\n- 可以描写封签簿册与码头抽验；类比史实待考。`
    : `## 场景画面\n- 合成风暴${number}：镜灯照出盐票上的暗纹。\n## 人物与对白触点\n- 脚夫抱怨兑票只能在指定行栈使用。\n## 可写进小说的冲突灵感\n- 黑市调换封签，引发官商之间的追责。\n## 可选的史实补强\n- 票据制度的历史类比仍需要进一步查证。`
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function settle(assertion: () => void) {
  const deadline = Date.now() + 2_000
  while (true) {
    await act(async () => { await new Promise(done => setTimeout(done, 5)) })
    try { assertion(); return } catch (error) {
      if (Date.now() >= deadline) throw error
    }
  }
}

function button(text: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(item => item.textContent?.includes(text))
  if (!found) throw new Error(`Missing history button: ${text}`)
  return found
}

async function seed(mode: HistoryAIMode, name = '历史重试') {
  const fixture = await createWorkspace({ name, genres: ['fantasy'], description: '', status: 'drafting', targetWordCount: 10_000 })
  const eventId = await useHistoricalStore.getState().addEvent({
    projectId: fixture.scope.projectId, era: 'custom', year: 300, date: '星历三百年',
    title: `${name}盐晶新律`, description: '镜税署要求每枚盐晶登记来源。',
    conceptNote: '允许借鉴盐铁专卖。', impact: '地下交易兴起。', isHistorical: false,
    consultPrompt: '核对制度成本。', stormPrompt: '发散街市场景。',
  })
  const generated = await generate({
    scope: fixture.scope, worldGroupId: null, mode, targetKind: 'event', targetId: eventId,
    runAI: async () => result(mode, ++calls),
  })
  return { ...fixture, eventId, generated }
}

async function mountPanel(project: Project) {
  await act(async () => root.render(createElement(ToastProvider, null,
    createElement(DialogProvider, null, createElement(HistoryPanel, { project })))))
  await settle(() => expect(host.textContent).toContain('盐晶新律'))
  await act(async () => button('盐晶新律').click())
  await settle(() => expect(host.textContent).toContain('已恢复待确认候选'))
}

function Controller({ project, worldGroupId = null }: { project: Project; worldGroupId?: number | null }) {
  controller = useHistoryAI({
    projectId: project.id!, activeWorldId: project.activeWorldId, activeWorkId: project.activeWorkId,
    worldGroupId, aiConfig, reloadEvents: async () => undefined,
    reloadKeywords: async () => undefined, onError: errors,
  })
  return createElement('div', null, controller.consult.candidate?.result)
}

async function mountController(project: Project, mode: HistoryAIMode = 'consult', worldGroupId: number | null = null) {
  await act(async () => root.render(createElement(Controller, { project, worldGroupId })))
  await settle(() => expect(controller[mode].candidate).not.toBeNull())
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  localStorage.clear()
  useHistoricalStore.setState({ events: [], keywords: [], loading: false, loadingKeywords: false })
  useWorldGroupStore.setState({ groups: [], links: [], activeGroupId: null, loadedScope: null, loading: false })
  calls = 0
  errors.mockClear()
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No real network in history regression') }))
  vi.spyOn(durable, 'generateHistoryAgentCandidateV1').mockImplementation(input => generate({
    ...input, runAI: async () => result(input.mode, ++calls),
  }))
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  db.close()
})

describe('SFQA-125 · author rejection and explicit history retry', () => {
  for (const mode of ['consult', 'storm'] as const) {
    for (const combined of [true, false]) {
      it(`${mode}: ${combined ? 'one retry click' : 'separate rejection and generation'} creates exactly one new durable candidate`, async () => {
        const fixture = await seed(mode)
        const rejection = vi.spyOn(durable, 'rejectHistoryAgentCandidateV1')
        await mountPanel(fixture.project)
        await act(async () => button(combined ? '拒绝并重试' : '拒绝候选').click())
        if (!combined) {
          await settle(() => expect(host.textContent).not.toContain('拒绝候选'))
          await act(async () => button(mode === 'consult' ? 'AI 历史考据' : 'AI 头脑风暴').click())
        }
        await settle(() => {
          expect(calls).toBe(2)
          expect(host.textContent).toContain(result(mode, 2))
        })
        expect(rejection).toHaveBeenCalledTimes(1)
        const previous = await readAgentRunV1(fixture.scope, fixture.generated.snapshot.run.id)
        expect(previous.projection.state).toBe('cancelled')
        expect(previous.events.slice(0, fixture.generated.snapshot.events.length)).toEqual(fixture.generated.snapshot.events)
        expect(previous.events.filter(event => event.type === 'run.cancelled')).toHaveLength(1)
        const pending = await durable.readPendingHistoryAgentCandidateV1({ scope: fixture.scope, worldGroupId: null, mode })
        expect(pending?.snapshot.run.id).not.toBe(previous.run.id)
        expect(pending?.candidate.result).toBe(result(mode, 2))
        expect(await db.agentRuns.count()).toBe(2)
        const event = await db.historicalTimelineEvents.get(fixture.eventId)
        expect(event?.aiConsult).toBeUndefined()
        expect(event?.aiBrainstorm).toBeUndefined()
        expect(fetch).not.toHaveBeenCalled()
      })
    }
  }

  it('failed rejection retains the actual pending candidate and does not generate', async () => {
    const fixture = await seed('consult')
    vi.spyOn(durable, 'rejectHistoryAgentCandidateV1').mockRejectedValueOnce(new Error('拒绝保存失败'))
    await mountPanel(fixture.project)
    await act(async () => button('拒绝并重试').click())
    await settle(() => expect(host.textContent).toContain('拒绝保存失败'))
    expect(calls).toBe(1)
    expect(host.textContent).toContain(result('consult', 1))
    expect(button('拒绝并重试').disabled).toBe(false)
    expect((await readAgentRunV1(fixture.scope, fixture.generated.snapshot.run.id)).projection.state).toBe('awaiting_confirmation')
  })

  it('two same-turn retry invocations cannot reject or generate twice', async () => {
    const fixture = await seed('consult')
    const gate = deferred()
    const rejection = vi.spyOn(durable, 'rejectHistoryAgentCandidateV1').mockImplementation(async input => {
      await gate.promise
      return reject(input)
    })
    await mountController(fixture.project)
    await act(async () => {
      const first = controller.retry('consult')
      const duplicate = controller.retry('consult')
      gate.resolve()
      await Promise.all([first, duplicate])
    })
    expect(rejection).toHaveBeenCalledTimes(1)
    expect(calls).toBe(2)
    expect(controller.consult.candidate?.result).toBe(result('consult', 2))
    expect(errors).not.toHaveBeenCalled()
  })

  it.each([false, true])('late old-project rejection (failure=%s) cannot start or replace the new project lane', async fail => {
    const old = await seed('consult', '原工作区')
    const next = await seed('consult', '新工作区')
    const gate = deferred()
    const rejection = vi.spyOn(durable, 'rejectHistoryAgentCandidateV1').mockImplementationOnce(async input => {
      await gate.promise
      if (fail) throw new Error('旧项目拒绝失败')
      return reject(input)
    })
    await mountController(old.project)
    let operation!: Promise<void>
    await act(async () => { operation = controller.retry('consult') })
    await settle(() => expect(rejection).toHaveBeenCalledTimes(1))
    await mountController(next.project)
    const nextRun = controller.consult.runId
    await act(async () => { gate.resolve(); await operation })
    expect(controller.consult.runId).toBe(nextRun)
    expect(controller.consult.candidate?.projectId).toBe(next.scope.projectId)
    expect(calls).toBe(2)
    expect(errors).not.toHaveBeenCalled()
  })

  it('same-project Work switch invalidates a waiting retry without losing either durable candidate', async () => {
    const fixture = await seed('consult')
    const gate = deferred()
    const rejection = vi.spyOn(durable, 'rejectHistoryAgentCandidateV1').mockImplementationOnce(async input => {
      await gate.promise
      return reject(input)
    })
    await mountController(fixture.project)
    let operation!: Promise<void>
    await act(async () => { operation = controller.retry('consult') })
    await settle(() => expect(rejection).toHaveBeenCalledTimes(1))
    const work = await createWorldWork(fixture.scope.projectId, { title: '新叙事作品', kind: 'novel', novelProfile: 'long' })
    const scope = await switchActiveWork(fixture.scope.projectId, work.id!)
    const generated = await generate({
      scope, worldGroupId: null, mode: 'consult', targetKind: 'event', targetId: fixture.eventId,
      runAI: async () => result('consult', ++calls),
    })
    await mountController({ ...fixture.project, activeWorkId: work.id! })
    await act(async () => { gate.resolve(); await operation })
    expect(controller.consult.runId).toBe(generated.snapshot.run.id)
    expect(controller.consult.candidate?.workId).toBe(work.id)
    expect(calls).toBe(2)
    expect(await db.agentRuns.count()).toBe(2)
  })

  it('an unsafe run blocks both retry and generation until explicit abandonment', async () => {
    const fixture = await seed('consult')
    await reject({ scope: fixture.scope, runId: fixture.generated.snapshot.run.id })
    await expect(generate({
      scope: fixture.scope, worldGroupId: null, mode: 'consult', targetKind: 'event', targetId: fixture.eventId,
      runAI: async () => result('consult', ++calls),
      onDurableBoundary: boundary => { if (boundary === 'model.requested') throw new Error('unknown model window') },
    })).rejects.toThrow('unknown model window')
    const rejection = vi.spyOn(durable, 'rejectHistoryAgentCandidateV1')
    await act(async () => root.render(createElement(Controller, { project: fixture.project })))
    await settle(() => expect(controller.consult.unsafeRunId).not.toBeNull())
    const event = await db.historicalTimelineEvents.get(fixture.eventId)
    if (!event) throw new Error('Missing historical event fixture')
    await act(async () => {
      await controller.retry('consult')
      await controller.run('consult', { kind: 'event', item: event })
    })
    expect(rejection).not.toHaveBeenCalled()
    expect(calls).toBe(1)
    expect(controller.consult.unsafeRunId).not.toBeNull()
  })

  it('a frozen adoption intent cannot be rejected or regenerated and still completes normally', async () => {
    const fixture = await seed('storm')
    await expect(durable.adoptHistoryAgentCandidateV1({
      scope: fixture.scope, runId: fixture.generated.snapshot.run.id,
      onDurableBoundary: boundary => { if (boundary === 'intent.checkpoint') throw new Error('interrupted intent') },
    })).rejects.toThrow('interrupted intent')
    const rejection = vi.spyOn(durable, 'rejectHistoryAgentCandidateV1')
    await mountController(fixture.project, 'storm')
    expect(controller.storm.adoptionPending).toBe(true)
    await act(async () => { await controller.retry('storm'); await controller.reject('storm') })
    expect(rejection).not.toHaveBeenCalled()
    expect(calls).toBe(1)
    await act(async () => { await controller.accept('storm') })
    expect((await db.historicalTimelineEvents.get(fixture.eventId))?.aiBrainstorm).toBe(result('storm', 1))
    expect(controller.storm.candidate).toBeNull()
    expect(calls).toBe(1)
  })

  it('unmounting while rejection is pending prevents the next model call', async () => {
    const fixture = await seed('consult')
    const gate = deferred()
    const rejection = vi.spyOn(durable, 'rejectHistoryAgentCandidateV1').mockImplementationOnce(async input => {
      await gate.promise
      return reject(input)
    })
    await mountController(fixture.project)
    let operation!: Promise<void>
    await act(async () => { operation = controller.retry('consult') })
    await settle(() => expect(rejection).toHaveBeenCalledTimes(1))
    await act(async () => root.unmount())
    root = createRoot(host)
    await act(async () => { gate.resolve(); await operation })
    expect(calls).toBe(1)
    expect((await readAgentRunV1(fixture.scope, fixture.generated.snapshot.run.id)).projection.state).toBe('cancelled')
  })

  it('a model result from a retry already started in the old scope stays durable without replacing the new lane', async () => {
    const old = await seed('consult', '原工作区')
    const next = await seed('consult', '新工作区')
    const gate = deferred()
    const started = deferred()
    vi.mocked(durable.generateHistoryAgentCandidateV1).mockImplementationOnce(input => generate({
      ...input,
      runAI: async () => {
        calls++
        started.resolve()
        await gate.promise
        return result('consult', calls)
      },
    }))
    await mountController(old.project)
    let operation!: Promise<void>
    await act(async () => { operation = controller.retry('consult'); await started.promise })
    await mountController(next.project)
    await act(async () => { gate.resolve(); await operation })
    expect(controller.consult.runId).toBe(next.generated.snapshot.run.id)
    expect(controller.consult.candidate?.projectId).toBe(next.scope.projectId)
    const oldPending = await durable.readPendingHistoryAgentCandidateV1({ scope: old.scope, worldGroupId: null, mode: 'consult' })
    expect(oldPending?.candidate.projectId).toBe(old.scope.projectId)
    expect(oldPending?.candidate.result).toBe(result('consult', 3))
    expect(calls).toBe(3)
    expect(errors).not.toHaveBeenCalled()
  })

  it('a failed initial read can be explicitly rechecked without generating or discarding the durable candidate', async () => {
    const fixture = await seed('consult')
    vi.spyOn(durable, 'readPendingHistoryAgentCandidateV1').mockRejectedValueOnce(new Error('临时读取失败'))
    await act(async () => root.render(createElement(ToastProvider, null,
      createElement(DialogProvider, null, createElement(HistoryPanel, { project: fixture.project })))))
    await settle(() => expect(host.textContent).toContain('重新检查历史候选'))
    await act(async () => button('盐晶新律').click())
    expect(button('AI 历史考据').disabled).toBe(true)
    expect(calls).toBe(1)
    await act(async () => button('重新检查历史候选').click())
    await settle(() => expect(host.textContent).toContain('已恢复待确认候选'))
    expect(host.textContent).not.toContain('重新检查历史候选')
    expect(host.textContent).toContain(result('consult', 1))
    expect((await readAgentRunV1(fixture.scope, fixture.generated.snapshot.run.id)).projection.state).toBe('awaiting_confirmation')
    expect(calls).toBe(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['world', 'worldGroup'] as const)('%s switch invalidates pending rejection without replacing the new lane', async kind => {
    const fixture = await seed('consult')
    const gate = deferred()
    const rejection = vi.spyOn(durable, 'rejectHistoryAgentCandidateV1').mockImplementationOnce(async input => {
      await gate.promise
      return reject(input)
    })
    await mountController(fixture.project)
    let operation!: Promise<void>
    await act(async () => { operation = controller.retry('consult') })
    await settle(() => expect(rejection).toHaveBeenCalledTimes(1))
    let scope = fixture.scope
    let worldGroupId: number | null = null
    if (kind === 'world') {
      const now = Date.now()
      const worldId = await db.worlds.add({
        projectId: scope.projectId, identityKind: 'workspace-scope', code: generateWorkspaceScopeCode(now),
        name: '另一真实世界', description: '', currentVersion: 0, createdAt: now, updatedAt: now,
      }) as number
      const workId = await db.works.add(buildWorkRecord({
        projectId: scope.projectId, worldId, fallback: fixture.work, now,
        create: { title: '新世界的作品', kind: 'novel', novelProfile: 'long' },
      })) as number
      scope = await switchActiveWork(scope.projectId, workId)
    } else {
      worldGroupId = await useWorldGroupStore.getState().createGroup({
        projectId: scope.projectId, name: '另一世界组', description: '', type: 'primary', icon: '🌍', order: 0,
      })
    }
    const eventId = await useHistoricalStore.getState().addEvent({
      projectId: scope.projectId, ...(worldGroupId == null ? {} : { worldGroupId }),
      era: 'custom', year: 1, date: '元年', title: '新作用域的历史', description: '新世界自己的历史条目。', isHistorical: false,
    }, scope)
    const generated = await generate({
      scope, worldGroupId, mode: 'consult', targetKind: 'event', targetId: eventId,
      runAI: async () => result('consult', ++calls),
    })
    await mountController({ ...fixture.project, activeWorldId: scope.worldId, activeWorkId: scope.workId }, 'consult', worldGroupId)
    await act(async () => { gate.resolve(); await operation })
    expect(controller.consult.runId).toBe(generated.snapshot.run.id)
    expect(controller.consult.candidate?.worldId).toBe(scope.worldId)
    expect(controller.consult.candidate?.request.worldGroupId).toBe(worldGroupId)
    expect(calls).toBe(2)
    expect(errors).not.toHaveBeenCalled()
  })
})
