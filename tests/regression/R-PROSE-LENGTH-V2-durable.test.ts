import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { installEvalWebLocksFixtureV1 } from '../helpers/eval-web-locks'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { usePromptStore } from '../../src/stores/prompt'
import { CORE_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-core'
import { useAIStream, type UseAIStreamReturn } from '../../src/hooks/useAIStream'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { buildChapterTaskRequestV2 } from '../../src/lib/ai/adapters/chapter-adapter'
import { createAuthorLengthIntentV1, resolveTaskLengthPlanV1 } from '../../src/lib/ai/author-length-intent'
import { captureWorkspaceContentRevisionV1 } from '../../src/lib/authoring/content-revision'
import { buildChapterInformationBoundaryV1 } from '../../src/lib/agent/information-boundary'
import { runProseLengthTaskV2, readProseLengthTaskV2, publishProseLengthTaskCandidateV2 } from '../../src/lib/agent/run/prose-length-task-v2'
import { commitProseGenerationAdoptionV1, reviseProseGenerationCandidateV1, PROSE_GENERATION_VERIFIER_SET_V4 } from '../../src/lib/agent/run/prose-generation-durable'
import { plainTextToHtml, countWords } from '../../src/lib/utils/html'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import { createChapterPostAdoptionDurableRunV1 } from '../../src/lib/agent/run/chapter-post-adoption-durable'
import type { AIConfig } from '../../src/lib/types'

const config: AIConfig = { provider: 'custom', model: 'b03-durable-synthetic', baseUrl: 'https://b03.invalid/v1', apiKey: 'synthetic-only', temperature: 0, maxTokens: 12 }
const priorConfig = useAIConfigStore.getState(), priorPrompts = usePromptStore.getState()
let restoreLocks: () => void
beforeEach(async () => {
  restoreLocks = installEvalWebLocksFixtureV1(); await db.delete(); await db.open()
  useAIConfigStore.setState({ config, presets: [], taskRoutes: {} })
  usePromptStore.setState({ templates: CORE_PROMPT_SEEDS.filter(seed => ['chapter.content', 'chapter.continue'].includes(seed.moduleKey))
    .map((seed, index) => ({ ...seed, id: 800 + index, createdAt: 1, updatedAt: 1, isActive: true })) })
})
afterEach(() => { restoreLocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useAIConfigStore.setState(priorConfig, true); usePromptStore.setState(priorPrompts, true); db.close() })
async function fixture(operation: 'generate' | 'continue' = 'generate') {
  const f = await seedCurrentWorkspace('B03 运行字数修订')
  const put = (table: string, data: Record<string, unknown>) => db.table(table).add(stampNewRecord(f.scope, table,
    { projectId: f.scope.projectId, createdAt: 1, updatedAt: 1, ...data }, { owner: 'work' })) as Promise<number>
  const outlineNodeId = await put('outlineNodes', { type: 'chapter', parentId: null, title: '盐门', summary: '检查名单后停笔，不追加未来情节', order: 0 })
  const chapterId = await put('chapters', { outlineNodeId, title: '盐门', content: operation === 'continue' ? '<p>已有原稿不计新增。</p>' : '', wordCount: 0, status: 'outline', order: 0, notes: '' })
  await put('detailedOutlines', { outlineNodeId, scenes: [{ sceneId: 's1', title: '核对名单', summary: '核对完毕即停笔', conflict: '', location: '盐门', characterIds: [], pace: 'slow', estimatedWords: 100, notes: '' }] })
  const assembled = await prepareProseGatewayAssemblyV1({ projectId: f.scope.projectId, scope: f.scope, chapterId, outlineNodeId, worldGroupId: null,
    operation, authorRequest: '核对名单后停笔', taskRequestV2: true, config })
  const contentRevision = await captureWorkspaceContentRevisionV1({ scope: f.scope, worldGroupId: null })
  const informationBoundary = await buildChapterInformationBoundaryV1({ scope: f.scope, chapterId, outlineNodeId, worldGroupId: null })
  const lengthPlan = resolveTaskLengthPlanV1({ taskKind: 'chapter', operation: operation === 'continue' ? 'continue' : 'create',
    intent: createAuthorLengthIntentV1({ quantifier: 'exact', targetWords: 100, basis: operation === 'continue' ? 'additional-text' : 'final-text', source: 'control' }) })
  const prompt = buildChapterTaskRequestV2({ operation, chapterTitle: '盐门', chapterSummary: '核对名单后停笔', lengthPlan, gatewayContext: assembled.text,
    existingContent: operation === 'continue' ? '已有原稿不计新增。' : '' })
  return { ...f, chapterId, task: { chapterId, chapterTitle: '盐门', worldGroupId: null, operation, messages: prompt.messages,
    assembled, lengthPlan, contentRevision, informationBoundary } }
}
function http(answers: Array<string | Error>, beforePost?: (index: number) => void | Promise<void>) {
  const posts: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method !== 'POST') return new Response(JSON.stringify({ models: [] }), { headers: { 'Content-Type': 'application/json' } })
    const index = posts.length; posts.push(String(init.body)); await beforePost?.(index)
    const answer = answers[index]; if (answer instanceof Error) throw answer
    if (answer === undefined) throw new Error('Unexpected additional model POST')
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: answer.length, total_tokens: answer.length + 10 } }) + '\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } })
  }))
  return posts
}
async function withHook(body: (read: () => UseAIStreamReturn) => Promise<void>) {
  const reactGlobal: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis; reactGlobal.IS_REACT_ACT_ENVIRONMENT = true
  let hook!: UseAIStreamReturn
  function Probe() { hook = useAIStream(); return createElement('div', null, hook.output) }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  try { await act(async () => root.render(createElement(Probe))); await body(() => hook) }
  finally { await act(async () => root.unmount()); host.remove() }
}

describe('B03 actual durable request generations and length revision', () => {
  it.each(['ready', 'best-author-edit'] as const)('publishes %s through the original candidate/adoption writer and records a V4 terminal receipt', async kind => {
    const f = await fixture(), posts = http(kind === 'ready' ? ['甲'.repeat(100)] : ['甲'.repeat(40), '甲'.repeat(30)])
    await withHook(async read => {
      let saved!: Awaited<ReturnType<typeof runProseLengthTaskV2>>
      await act(async () => { saved = await runProseLengthTaskV2({ scope: f.scope, task: f.task, ai: read() }) })
      const published = await publishProseLengthTaskCandidateV2({ scope: f.scope, result: saved })
      let candidate = published.candidate
      const { snapshot } = published
      expect(snapshot.projection.state).toBe('awaiting_confirmation')
      expect((await db.chapters.get(f.chapterId))?.content).toBe('')
      if (kind === 'best-author-edit') {
        await expect(commitProseGenerationAdoptionV1({ scope: f.scope, runId: saved.runId, candidate,
          contentHtml: plainTextToHtml(candidate.outputText), wordCount: countWords(candidate.outputText) })).rejects.toThrow('未满足篇幅')
        const forged = { ...candidate, taskLengthV2: { ...candidate.taskLengthV2!, disposition: 'ready' as const } }
        await expect(commitProseGenerationAdoptionV1({ scope: f.scope, runId: saved.runId, candidate: forged,
          contentHtml: plainTextToHtml(candidate.outputText), wordCount: countWords(candidate.outputText) })).rejects.toThrow()
        candidate = await reviseProseGenerationCandidateV1({ scope: f.scope, candidate, outputText: candidate.outputText + '作者已经明确核对并补入的原稿。' })
        expect(candidate.taskLengthV2?.disposition).toBe('author-edited')
        expect(candidate.taskLengthV2?.observation.measuredWords).toBe(countWords(candidate.outputText))
      }
      const adopted = await commitProseGenerationAdoptionV1({ scope: f.scope, runId: saved.runId, candidate,
        contentHtml: plainTextToHtml(candidate.outputText), wordCount: countWords(candidate.outputText) })
      expect(adopted.snapshot.projection.state).toBe('completed')
      expect(adopted.receipt?.verifierSetVersion).toBe(PROSE_GENERATION_VERIFIER_SET_V4)
      const parent = { runId: saved.runId, receiptHash: adopted.receiptHash, artifactHash: candidate.expectedContentHash }
      const child = await createChapterPostAdoptionDurableRunV1({ scope: f.scope, worldGroupId: null, chapterId: f.chapterId, parent })
      expect(child.contract.lineage?.parent).toMatchObject(parent)
      await expect(createChapterPostAdoptionDurableRunV1({ scope: f.scope, worldGroupId: null, chapterId: f.chapterId,
        parent: { ...parent, artifactHash: candidate.sourceTextHash } })).rejects.toThrow('脱离父 Run')
      expect((await db.chapters.get(f.chapterId))?.content).toBe(plainTextToHtml(candidate.outputText))
      expect(posts).toHaveLength(kind === 'ready' ? 1 : 2)
    })
  }, 30_000)

  it('atomic publication rolls back candidate rows with a failed Run write and can recover without rePOST', async () => {
    const f = await fixture(), posts = http(['甲'.repeat(100)])
    await withHook(async read => {
      let saved!: Awaited<ReturnType<typeof runProseLengthTaskV2>>
      await act(async () => { saved = await runProseLengthTaskV2({ scope: f.scope, task: f.task, ai: read() }) })
      const rejectCandidate = (_key: unknown, row: { type?: string }) => { if (row.type === 'candidate.persisted') throw new Error('synthetic candidate journal failure') }
      db.agentRunEvents.hook('creating', rejectCandidate)
      try { await expect(publishProseLengthTaskCandidateV2({ scope: f.scope, result: saved })).rejects.toThrow('candidate journal') }
      finally { db.agentRunEvents.hook('creating').unsubscribe(rejectCandidate) }
      expect(await db.agentConversations.count()).toBe(0)
      expect((await db.agentEvents.toArray()).filter(event => event.kind === 'candidate')).toHaveLength(0)
      const published = await publishProseLengthTaskCandidateV2({ scope: f.scope, result: saved })
      expect(published.snapshot.projection.state).toBe('awaiting_confirmation')
      expect(posts).toHaveLength(1); expect((await db.chapters.get(f.chapterId))?.content).toBe('')
    })
  }, 30_000)

  it.each(['no-progress', 'unknown'] as const)('%s stops visibly with the best complete draft; restoration makes no new POST', async kind => {
    const f = await fixture(), posts = http(['甲'.repeat(40), kind === 'unknown' ? new Error('network result unknown') : '甲'.repeat(30)])
    await withHook(async read => {
      let saved!: Awaited<ReturnType<typeof runProseLengthTaskV2>>
      await act(async () => { saved = await runProseLengthTaskV2({ scope: f.scope, task: f.task, ai: read() }) })
      expect(saved.disposition).toBe('needs-attention'); expect(saved.text).toBe('甲'.repeat(40)); expect(posts).toHaveLength(2)
      await act(async () => { const again = await runProseLengthTaskV2({ scope: f.scope, runId: saved.runId, ai: read() }); expect(again.text).toBe(saved.text) })
      expect(posts).toHaveLength(2); expect((await db.chapters.get(f.chapterId))?.content).toBe('')
    })
  })

  it('continuation counts only the new fragment while retaining the true frozen original count', async () => {
    const f = await fixture('continue'), posts = http(['甲'.repeat(100)])
    await withHook(async read => {
      await act(async () => {
        const saved = await runProseLengthTaskV2({ scope: f.scope, task: f.task, ai: read() })
        expect(saved.disposition, saved.reason).toBe('ready')
        expect(saved.observation).toMatchObject({ measuredWords: 100, additionalWords: 100, baselineWords: '已有原稿不计新增。'.length,
          finalWords: '已有原稿不计新增。'.length + 100 })
      })
      expect(posts).toHaveLength(1)
      expect((await db.chapters.get(f.chapterId))?.content).toBe('<p>已有原稿不计新增。</p>')
    })
  })

  it('a failed final checkpoint recovers the already-paid compiled draft without another call or false repeated-result failure', async () => {
    const f = await fixture(), posts = http(['甲'.repeat(100)])
    const createCheckpoint = checkpoints.createAgentRunCheckpointV1
    let failed = false
    const spy = vi.spyOn(checkpoints, 'createAgentRunCheckpointV1').mockImplementation(async input => {
      const payload = input.resumePayload as { stateRef?: { artifactKind: 'tool-result'; contentHash: string } }
      if (!failed && payload.stateRef) {
        const state = JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, ...payload.stateRef }))
        if (state.resultRef) { failed = true; throw new Error('synthetic final checkpoint write failure') }
      }
      return createCheckpoint(input)
    })
    await withHook(async read => {
      await act(async () => { await expect(runProseLengthTaskV2({ scope: f.scope, task: f.task, ai: read() })).rejects.toThrow('final checkpoint') })
      spy.mockRestore()
      const run = (await db.agentRuns.toArray())[0]
      await act(async () => {
        const restored = await runProseLengthTaskV2({ scope: f.scope, runId: run.id!, ai: read() })
        expect(restored.disposition, restored.reason).toBe('ready'); expect(restored.text).toBe('甲'.repeat(100))
        expect(restored.roundRefs).toHaveLength(1)
      })
      expect(posts).toHaveLength(1)
    })
  })

  it('four progressing paid drafts reach the exact goal; originals and checkpoints restore with zero additional POST', async () => {
    const f = await fixture(), posts = http([40, 60, 80, 100].map(n => '甲'.repeat(n)))
    await withHook(async read => {
      let completed!: Awaited<ReturnType<typeof runProseLengthTaskV2>>
      await act(async () => { completed = await runProseLengthTaskV2({ scope: f.scope, task: f.task, ai: read() }) })
      expect(completed.reason).not.toContain('错误')
      expect(completed.disposition, completed.reason).toBe('ready')
      expect(completed.text).toBe('甲'.repeat(100)); expect(completed.observation?.measuredWords).toBe(100)
      expect(posts).toHaveLength(4); expect(completed.roundRefs).toHaveLength(4)
      expect(completed.snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(4)
      expect((await db.chapters.get(f.chapterId))?.content).toBe('')
      const restored = await readProseLengthTaskV2(f.scope, completed.runId)
      expect(restored.state.roundRefs).toHaveLength(4)
      let again!: typeof completed
      await act(async () => { again = await runProseLengthTaskV2({ scope: f.scope, runId: completed.runId, ai: read() }) })
      expect(again.text).toBe(completed.text); expect(again.disposition).toBe('ready'); expect(posts).toHaveLength(4)
      const originals = new Map<string, string>()
      for (const event of again.snapshot.events) {
        if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'raw-response') continue
        const raw = JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: event.payload.contentHash }))
        if (raw.version === 'prose-task-response-v2') originals.set(event.payload.contentHash, raw.response.text)
      }
      expect([...originals.values()].map(text => text.length)).toEqual([40, 60, 80, 100])
    })
  }, 30_000)
})
