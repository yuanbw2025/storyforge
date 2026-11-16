import { act, createElement, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldScenePanel from '../../src/components/text-game/TextOpenWorldScenePanel'
import { projectTextOpenWorldScenesV1 } from '../../src/lib/open-world/scene-projection'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { createTextOpenWorldRuntimeDialogueFallbackV1 } from '../../src/lib/open-world/runtime-dialogue'
import type { TextOpenWorldRuntimeMemoryPresentationV1 } from '../../src/lib/open-world/runtime-memory'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'
import TextOpenWorldVNextPlayer from '../../src/components/text-game/TextOpenWorldVNextPlayer'
import * as scenePanelModule from '../../src/components/text-game/TextOpenWorldScenePanel'
import * as runtimeMemory from '../../src/lib/open-world/runtime-memory'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { db } from '../../src/lib/db/schema'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import * as runEvents from '../../src/lib/agent/run/event-store'
import * as attemptEvidence from '../../src/lib/context-gateway/attempt-evidence'
import Dexie from 'dexie'


type SceneProps = ComponentProps<typeof TextOpenWorldScenePanel>
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function memory(summary: string): TextOpenWorldRuntimeMemoryPresentationV1 {
  return { version: 1, source: 'ai-memory', status: 'committed', memoryKey: 'memory.dialogue.fixture',
    actorKey: 'actor.caretaker', actorName: '岑阿婆', sceneKey: 'scene.actor.caretaker', summary,
    playerKnowledgeKeys: [], actorKnowledgeKeys: [], openThreadKeys: [], coveredEventSequences: [],
    eventSequence: 1, candidateHash: 'a'.repeat(64), contextManifestHash: 'b'.repeat(64), runId: 1 }
}

// This first family isolates the real ScenePanel callback contract. It does
// not fake a paid service receipt; service/DB/transport controls are separate.
describe('SFQA085 · selected scene memory acknowledgement', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })

  function button(text: string) {
    const value = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(text))
    if (!value) throw new Error('Missing actual085 button: ' + text)
    return value
  }
  async function click(text: string) { await act(async () => { button(text).click() }) }
  async function input(text: string) {
    const node = host.querySelector<HTMLInputElement>('#text-open-world-natural-command')
    if (!node) throw new Error('Missing actual085 input')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, text)
      node.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  function props(sessionKey: string, commit: NonNullable<SceneProps['onCommitMemory']>): SceneProps {
    const runtime = createInitialTextOpenWorldSessionProjectionV1(createTextOpenWorldVNextP9Fixture())
    const projection = projectTextOpenWorldScenesV1(runtime)
    if (projection.status !== 'ready') throw new Error('085 requires actual ready P9 projection')
    const scene = projection.scenes.find(row => row.key === 'scene.actor.caretaker')
    if (!scene?.actor) throw new Error('085 requires actual actor scene')
    projection.recommendedSceneKey = scene.key
    return { sessionKey, eventSequence: 0, projection, availableActions: [], feedback: null, busy: false,
      fallback: { regionTitle: '盐港', locationTitle: '旧渠', description: '085隔离场景', playerName: '来客' },
      onExecute: vi.fn(), memoryAvailable: true, onCommitMemory: commit,
      onInterpretNaturalInput: async request => ({ version: 1, source: 'ai-candidate', status: 'reply-only', selectedSceneKey: request.selectedSceneKey,
        baseSequence: 0, candidateHash: '', contextManifestHash: '', runId: 0, confidence: 0, options: [], replyText: '', boundaryExplanation: null,
        dialogue: createTextOpenWorldRuntimeDialogueFallbackV1(scene) }) }
  }
  async function render(sessionKey: string, commit: NonNullable<SceneProps['onCommitMemory']>) {
    await act(async () => root.render(createElement(TextOpenWorldScenePanel, props(sessionKey, commit))))
  }
  async function dialogue(text: string) { await input(text); await click('提交') }

  it.each(['success', 'failure'] as const)('late A %s leaves B dialogue, input and its own pending memory request untouched', async outcome => {
    const a = deferred<TextOpenWorldRuntimeMemoryPresentationV1>(), b = deferred<TextOpenWorldRuntimeMemoryPresentationV1>()
    const commitA = vi.fn(() => a.promise), commitB = vi.fn(() => b.promise)
    await render('session-A', commitA)
    await dialogue('A的独立对白')
    await click('整理并保存长期记忆')
    expect(commitA).toHaveBeenCalledOnce()
    await render('session-B', commitB)
    await dialogue('B的独立对白不得丢失')
    await input('B尚未提交的输入')
    await click('整理并保存长期记忆')
    expect(commitB).toHaveBeenCalledOnce()
    const progress = host.querySelector('[data-testid="text-open-world-memory-notice"]')?.textContent
    await act(async () => {
      if (outcome === 'success') a.resolve(memory('A的旧完成消息'))
      else a.reject(new Error('A的旧失败'))
    })
    expect(host.querySelector('[data-testid="text-open-world-runtime-dialogue"]')?.textContent).toContain('B的独立对白不得丢失')
    expect(host.querySelector<HTMLInputElement>('#text-open-world-natural-command')?.value).toBe('B尚未提交的输入')
    expect(host.querySelector('[data-testid="text-open-world-memory-notice"]')?.textContent).toBe(progress)
    expect(button('整理中')).toHaveProperty('disabled', true)
    expect(host.textContent).not.toContain('A的旧完成消息')
    expect(commitA).toHaveBeenCalledOnce(); expect(commitB).toHaveBeenCalledOnce()
    await act(async () => b.resolve(memory('B自己的合法完成')))
    expect(host.querySelector('[data-testid="text-open-world-memory-notice"]')?.textContent).toContain('B自己的合法完成')
  })
  it('the unchanged selected scene completes once and keeps its ordinary completion message', async () => {
    const commit = vi.fn(async () => memory('当前窗口的合法结果'))
    await render('same-session', commit)
    await dialogue('当前窗口的原对白')
    await click('整理并保存长期记忆')
    expect(commit).toHaveBeenCalledOnce()
    expect(host.querySelector('[data-testid="text-open-world-runtime-dialogue"]')).toBeNull()
    expect(host.querySelector('[data-testid="text-open-world-memory-notice"]')?.textContent).toContain('当前窗口的合法结果')
  })

})


// Real VNext caller + real selected-session store and runtime memory service.
// Only HTTP is synthetic. The first control holds the already committed
// service acknowledgement, so rejecting a stale UI result cannot erase A.
describe('SFQA085 · real memory caller and durable original session', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    await db.delete(); await db.open(); localStorage.clear()
    useTextOpenWorldPlayerStore.setState(useTextOpenWorldPlayerStore.getInitialState(), true)
    useAIConfigStore.getState().setConfig({ provider: 'openai', apiKey: 'synthetic-sfqa085-key',
      model: 'gpt-4o-mini', baseUrl: 'https://sfqa085.invalid/v1', temperature: 0.2, maxTokens: 800, contextWindow: 128000 })
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  })
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close(); localStorage.clear()
  })

  it('a completed A memory acknowledgement cannot reselect A after the author selects B', async () => {
    const made = await createGovernedTextOpenWorldSessionFixtureV1({ name: '085 real memory owner',
      textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(), runtimeShape: 'vnext-only', title: 'A存档', seed: 'sfqa085-A' })
    const second = await createTextOpenWorldInstance({ scope: made.scope, productReleaseId: made.release.id!, title: 'B存档', seed: 'sfqa085-B' })
    if (made.session.id == null || second.id == null) throw new Error('085 requires two real public sessions')
    const beforeB = JSON.stringify({ session: await db.productRuntimeSessions.get(second.id),
      events: await db.productRuntimeEvents.where('sessionId').equals(second.id).sortBy('sequence') })
    await useTextOpenWorldPlayerStore.getState().load(made.scope, null, made.session.id)
    const actualPanel = scenePanelModule.default
    let commit: SceneProps['onCommitMemory']
    vi.spyOn(scenePanelModule, 'default').mockImplementation(props => {
      commit = props.onCommitMemory
      return createElement(actualPanel, props)
    })
    const output = JSON.stringify({ kind: 'dialogue-window', subjectKey: 'actor.caretaker', summary: '来客与岑阿婆谈论旧渠。',
      coveredEventSequences: [], playerKnowledgeKeys: [], actorKnowledgeKeys: [], openThreadKeys: [] })
    const transport = vi.fn(async () => new Response(JSON.stringify({ id: 'sfqa085-only-response', object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', transport)
    const acknowledge = deferred<void>(), completed = deferred<TextOpenWorldRuntimeMemoryPresentationV1>()
    const actualMemory = runtimeMemory.generateAndCommitTextOpenWorldRuntimeMemoryV1
    vi.spyOn(runtimeMemory, 'generateAndCommitTextOpenWorldRuntimeMemoryV1').mockImplementation(async input => {
      try {
        const result = await actualMemory(input)
        completed.resolve(result)
        await acknowledge.promise
        return result
      } catch (cause) { completed.reject(cause); throw cause }
    })
    await act(async () => root.render(createElement(DialogProvider, null, createElement(TextOpenWorldVNextPlayer))))
    if (!commit) throw new Error('085 actual VNext callback not mounted')
    const projection = projectTextOpenWorldScenesV1(useTextOpenWorldPlayerStore.getState().runtimeState.textOpenWorld!)
    if (projection.status !== 'ready') throw new Error('085 actual session needs P9 scenes')
    const scene = projection.scenes.find(value => value.key === 'scene.actor.caretaker')
    if (!scene) throw new Error('085 actual actor scene missing')
    const fallback = createTextOpenWorldRuntimeDialogueFallbackV1(scene)
    let pending!: Promise<TextOpenWorldRuntimeMemoryPresentationV1>
    let committed!: TextOpenWorldRuntimeMemoryPresentationV1
    await act(async () => {
      pending = commit!({ selectedSceneKey: scene.key, actorKey: fallback.actorKey, dialogue: [
        { speaker: 'player', actorKey: null, text: '请说说旧渠。', source: 'player-input', citedKnowledgeKeys: [],
          dialogueCandidateHash: null, dialogueContextManifestHash: null, dialogueRunId: null },
        { speaker: 'npc', actorKey: fallback.actorKey, text: fallback.replyText, source: 'frozen-scene-fallback', citedKnowledgeKeys: [],
          dialogueCandidateHash: null, dialogueContextManifestHash: null, dialogueRunId: null },
      ] })
      void pending.catch(() => {})
      committed = await completed.promise
    })
    const run = await readInstanceAgentRunV1(made.scope, committed.runId)
    expect(run.projection.state).toBe('completed')
    expect(run.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(transport).toHaveBeenCalledOnce()
    expect((await db.aiUsageLog.toArray()).map(row => [row.inputTokens, row.outputTokens])).toEqual([[31, 7]])
    expect((await db.agentRunArtifacts.where('projectId').equals(made.scope.projectId).toArray())
      .some(row => row.artifactKind === 'raw-response' && row.content === output)).toBe(true)
    const eventsA = await db.productRuntimeEvents.where('sessionId').equals(made.session.id).sortBy('sequence')
    expect(eventsA.filter(row => row.type === 'text-open-world.memory.committed')).toHaveLength(1)
    await act(async () => useTextOpenWorldPlayerStore.getState().select(second.id!))
    expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).toBe(second.id)
    await act(async () => { acknowledge.resolve(); await pending })
    expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).toBe(second.id)
    expect(JSON.stringify({ session: await db.productRuntimeSessions.get(second.id),
      events: await db.productRuntimeEvents.where('sessionId').equals(second.id).sortBy('sequence') })).toBe(beforeB)
    expect(await db.productRuntimeEvents.where('sessionId').equals(made.session.id).sortBy('sequence')).toEqual(eventsA)
    expect(transport).toHaveBeenCalledOnce()
  })

  type Boundary = 'model-response' | 'model-responded-event' | 'before-manifest' | 'after-manifest'
    | 'before-memory-event' | 'after-memory-event' | 'B-still-loading' | 'no-switch'

  async function actualBoundary(phase: Boundary) {
    const made = await createGovernedTextOpenWorldSessionFixtureV1({ name: '085 boundary ' + phase,
      textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(), runtimeShape: 'vnext-only', title: '原A', seed: '085-A' })
    const second = await createTextOpenWorldInstance({ scope: made.scope, productReleaseId: made.release.id!, title: '目标B', seed: '085-B' })
    if (made.session.id == null || second.id == null) throw new Error('085 boundary needs real public session IDs')
    const beforeB = JSON.stringify({ session: await db.productRuntimeSessions.get(second.id),
      events: await db.productRuntimeEvents.where('sessionId').equals(second.id).sortBy('sequence') })
    await useTextOpenWorldPlayerStore.getState().load(made.scope, null, made.session.id)
    const realPanel = scenePanelModule.default
    let latest: SceneProps['onCommitMemory']
    vi.spyOn(scenePanelModule, 'default').mockImplementation(props => { latest = props.onCommitMemory; return createElement(realPanel, props) })
    const hit = deferred<void>(), release = deferred<void>()
    const output = JSON.stringify({ kind: 'dialogue-window', subjectKey: 'actor.caretaker', summary: '独立A保存一段真实有据的对白。',
      coveredEventSequences: [], playerKnowledgeKeys: [], actorKnowledgeKeys: [], openThreadKeys: [] })
    const transport = vi.fn(async () => {
      if (phase === 'model-response') { hit.resolve(); await release.promise }
      // A late response is allowed to ignore an abort request. Retain its
      // actually returned raw/usage instead of pretending it never arrived.
      return new Response(JSON.stringify({ id: '085-boundary-response', object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: output }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', transport)
    if (phase === 'model-responded-event') {
      const original = runEvents.appendAgentRunEventV1
      vi.spyOn(runEvents, 'appendAgentRunEventV1').mockImplementation(async input => {
        const result = await original(input)
        if (input.type === 'model.responded' && 'stepId' in input.payload
          && input.payload.stepId === runtimeMemory.TEXT_OPEN_WORLD_RUNTIME_MEMORY_STEP_ID_V1) {
          hit.resolve(); await release.promise
        }
        return result
      })
    }
    if (phase === 'before-manifest' || phase === 'after-manifest') {
      const original = attemptEvidence.finalizeContextGatewayAttemptEvidenceV1
      vi.spyOn(attemptEvidence, 'finalizeContextGatewayAttemptEvidenceV1').mockImplementation(async input => {
        const target = input.stepId === runtimeMemory.TEXT_OPEN_WORLD_RUNTIME_MEMORY_STEP_ID_V1
        if (target && phase === 'before-manifest') { hit.resolve(); await release.promise }
        const result = await original(input)
        if (target && phase === 'after-manifest') { hit.resolve(); await release.promise }
        return result
      })
    }
    if (phase === 'B-still-loading') {
      const original = runtimeMemory.generateAndCommitTextOpenWorldRuntimeMemoryV1
      vi.spyOn(runtimeMemory, 'generateAndCommitTextOpenWorldRuntimeMemoryV1').mockImplementation(async input => {
        const result = await original(input); hit.resolve(); await release.promise; return result
      })
    }
    let switchToB: Promise<void> | undefined, eventBoundaryCount = 0
    const eventHook = (_key: unknown, row: { type: string }) => {
      if (row.type !== 'text-open-world.memory.committed') return
      const selectB = () => { eventBoundaryCount++; switchToB = Dexie.ignoreTransaction(() => useTextOpenWorldPlayerStore.getState().select(second.id!)) }
      if (phase === 'before-memory-event') selectB()
      if (phase === 'after-memory-event') {
        let transaction = Dexie.currentTransaction
        if (!transaction) throw new Error('085 actual memory event needs its native transaction')
        while (transaction.parent) transaction = transaction.parent
        transaction.on('complete', selectB)
      }
    }
    if (phase === 'before-memory-event' || phase === 'after-memory-event') db.productRuntimeEvents.hook('creating', eventHook)
    try {
      await act(async () => root.render(createElement(DialogProvider, null, createElement(TextOpenWorldVNextPlayer))))
      const caller = latest
      if (!caller) throw new Error('085 real caller not rendered')
      const scenes = projectTextOpenWorldScenesV1(useTextOpenWorldPlayerStore.getState().runtimeState.textOpenWorld!)
      if (scenes.status !== 'ready') throw new Error('085 real scene projection missing')
      const scene = scenes.scenes.find(row => row.key === 'scene.actor.caretaker')
      if (!scene) throw new Error('085 actor missing')
      const fallback = createTextOpenWorldRuntimeDialogueFallbackV1(scene)
      let pending!: Promise<TextOpenWorldRuntimeMemoryPresentationV1>
      let result!: TextOpenWorldRuntimeMemoryPresentationV1
      const start = () => {
        pending = caller({ selectedSceneKey: scene.key, actorKey: fallback.actorKey, dialogue: [
          { speaker: 'player', actorKey: null, text: '请告诉我这里的情况。', source: 'player-input', citedKnowledgeKeys: [], dialogueCandidateHash: null, dialogueContextManifestHash: null, dialogueRunId: null },
          { speaker: 'npc', actorKey: fallback.actorKey, text: fallback.replyText, source: 'frozen-scene-fallback', citedKnowledgeKeys: [], dialogueCandidateHash: null, dialogueContextManifestHash: null, dialogueRunId: null },
        ] }); void pending.catch(() => {})
      }
      if (phase === 'no-switch' || phase === 'before-memory-event' || phase === 'after-memory-event') {
        await act(async () => { start(); result = await pending; await switchToB })
      } else {
        await act(async () => { start(); await hit.promise })
        if (phase === 'B-still-loading') {
          await act(async () => {
            switchToB = useTextOpenWorldPlayerStore.getState().select(second.id!)
            expect(useTextOpenWorldPlayerStore.getState().loading).toBe(true)
            expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).toBe(made.session.id)
            release.resolve(); result = await pending; await switchToB
          })
        } else {
          await act(async () => useTextOpenWorldPlayerStore.getState().select(second.id!))
          expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).toBe(second.id)
          await act(async () => { release.resolve(); result = await pending })
        }
      }
      expect(useTextOpenWorldPlayerStore.getState().selectedSessionId).toBe(phase === 'no-switch' ? made.session.id : second.id)
      if (phase === 'before-memory-event' || phase === 'after-memory-event') expect(eventBoundaryCount).toBe(1)
      expect(JSON.stringify({ session: await db.productRuntimeSessions.get(second.id),
        events: await db.productRuntimeEvents.where('sessionId').equals(second.id).sortBy('sequence') })).toBe(beforeB)
      const run = await readInstanceAgentRunV1(made.scope, result.runId)
      expect(run.projection.state).toBe('completed')
      expect(run.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
      expect((await db.productRuntimeEvents.where('sessionId').equals(made.session.id).toArray())
        .filter(row => row.type === 'text-open-world.memory.committed')).toHaveLength(1)
      expect((await db.agentRunArtifacts.where('projectId').equals(made.scope.projectId).toArray())
        .some(row => row.artifactKind === 'raw-response' && row.content === output)).toBe(true)
      expect((await db.aiUsageLog.toArray()).map(row => [row.inputTokens, row.outputTokens])).toEqual([[31, 7]])
      expect(transport).toHaveBeenCalledOnce()
    } finally {
      release.resolve()
      if (phase === 'before-memory-event' || phase === 'after-memory-event') db.productRuntimeEvents.hook('creating').unsubscribe(eventHook)
    }
  }

  it.each(['model-response', 'model-responded-event', 'before-manifest', 'after-manifest',
    'before-memory-event', 'after-memory-event', 'B-still-loading', 'no-switch'] as const)(
    'actual boundary %s retains A evidence once and never borrows B state', actualBoundary)
})
