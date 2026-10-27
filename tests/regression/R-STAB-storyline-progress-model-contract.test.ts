import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { prepareStorylineProgressCopilotV1 } from '../../src/lib/agent/storyline-progress-copilot'
import { runGenerationNode } from '../../src/lib/generation/generation-node'
import { supportsVerifiedJsonObjectResponseForModelV1 } from '../../src/lib/ai/provider-capabilities'

const old = useAIConfigStore.getState()
async function fixture() {
  const f = await seedCurrentWorkspace('映射请求的闭集合同')
  const base = { projectId: f.scope.projectId, createdAt: 1, updatedAt: 1 }
  const nodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', { ...base, parentId: null, type: 'chapter', title: '交付', summary: '先交付再取得路线', order: 0 }, { owner: 'work' })) as number
  const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', { ...base, outlineNodeId: nodeId, title: '交付', content: '<p>林飞交出青铜钥匙，换得运粮路线。</p>', wordCount: 18, order: 0, status: 'draft', notes: '' }, { owner: 'work' })) as number
  const arcId = await db.storyArcs.add(stampNewRecord(f.scope, 'storyArcs', { ...base, id: 41, name: '寻钥主线', type: 'main', description: '交付钥匙', stages: JSON.stringify([{ id: 'exact opaque stage', title: '交接', description: '交付后确认路线', keyEvents: ['先交后取'] }]) }, { owner: 'work' })) as number
  const raw = JSON.stringify({ progress: [{ arcId, currentStageId: 'exact opaque stage', status: 'active', progressNote: '交付已完成', involvedEntities: ['林飞'], quote: '林飞交出青铜钥匙' }], crossings: [], newArcs: [] })
  return { ...f, chapterId, arcId, raw }
}
describe.sequential('STAB · explicit mapping model contract', () => {
  beforeEach(async () => { await db.delete(); await db.open(); useAIConfigStore.setState({ config: { ...old.config, provider: 'agnes', model: 'agnes-2.5-flash', apiKey: 'isolated-test-token', baseUrl: 'https://mapping.invalid/v1', contextWindow: 128000, maxTokens: 8000 }, presets: [], taskRoutes: {} }) })
  afterEach(() => { vi.unstubAllGlobals(); useAIConfigStore.setState(old, true); db.close() })
  it('supplies numeric Arc bindings, exact stage IDs, item fields and literal chapter rather than asking for unseen IDs', async () => {
    const f = await fixture()
    const runAI = vi.fn(async (messages: any[]) => {
      const system = messages[0].content; const user = messages[1].content
      for (const field of ['progressNote', 'involvedEntities', 'currentStageId', 'arcIdA', 'arcIdB', 'description']) expect(system).toContain(field)
      expect(user).toContain(`"id":${f.arcId}`)
      expect(user).toContain('exact opaque stage')
      expect(user).toContain('林飞交出青铜钥匙，换得运粮路线。')
      return f.raw
    })
    const p = await prepareStorylineProgressCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, chapterId: f.chapterId, authorRequest: '按已写章节映射' }, { runAI })
    expect((await runGenerationNode(p.node, p.prepared)).gate?.status).toBe('pass')
    expect(runAI).toHaveBeenCalledTimes(1)
  })
  it('actual default transport requests a non-stream JSON object and preserves raw output for the same strict gate', async () => {
    const f = await fixture(); const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); bodies.push(body)
      expect(body.response_format).toEqual({ type: 'json_object' }); expect(body.stream).toBe(false)
      return new Response(JSON.stringify({ choices: [{ message: { content: f.raw }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }))
    }))
    const p = await prepareStorylineProgressCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, chapterId: f.chapterId, authorRequest: '按已写章节映射' })
    expect((await runGenerationNode(p.node, p.prepared)).gate?.status).toBe('pass')
    expect(bodies).toHaveLength(1)
    expect(await db.storylineProgress.count()).toBe(0)
  })
  it('mixed valid and invalid model rows are not silently dropped into a writable partial mapping', async () => {
    const f = await fixture(); const value = JSON.parse(f.raw)
    value.progress.push({ ...value.progress[0], arcId: 'not-a-numeric-binding' })
    const p = await prepareStorylineProgressCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, chapterId: f.chapterId, authorRequest: '按已写章节映射' }, { runAI: vi.fn(async () => JSON.stringify(value)) })
    await expect(runGenerationNode(p.node, p.prepared)).rejects.toThrow('闭集')
    expect(await db.storylineProgress.count()).toBe(0)
  })
  it.each(['agnes-3.0-flash', 'unverified-model'])('Agnes model-specific verification does not widen provider capability: %s', model => {
    expect(supportsVerifiedJsonObjectResponseForModelV1({ provider: 'agnes', model })).toBe(false)
  })
})
