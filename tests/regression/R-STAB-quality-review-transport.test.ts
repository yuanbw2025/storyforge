import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { describeResolvedAIRequestSettingsV1, resolveRequestConfig } from '../../src/lib/ai/client'
import { runWholeChapterQualityReviewV1, readLatestWholeChapterQualityReviewV1 } from '../../src/lib/agent/run/quality-review-durable'
import { createWholeChapterQualityCallV1 } from '../../src/lib/prose/quality-transport'
import { parseProseRequestSettingsV1 } from '../../src/lib/prose/request-evidence'
import { wholeChapterQualityRequestOptionsV1 } from '../../src/lib/prose/quality-review-request-options'

const old = useAIConfigStore.getState()
const config = { ...old.config, provider: 'agnes' as const, model: 'agnes-2.5-flash', baseUrl: 'https://review.invalid/v1', apiKey: 'isolated-test-token', temperature: 0, maxTokens: 2400, contextWindow: 128000 }
async function fixture() {
  const f = await seedCurrentWorkspace('评审传输与真实回执')
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', { projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '试路', summary: '试绳后记录实测数据', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', { projectId: f.scope.projectId, outlineNodeId, title: '试路', content: '<p>她先试绳，再记录实测数据。</p>', wordCount: 14, order: 0, status: 'draft', notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  return { ...f, outlineNodeId, chapterId }
}
describe.sequential('STAB · bounded whole review transport preserves its actual request', () => {
  beforeEach(async () => { await db.delete(); await db.open(); useAIConfigStore.setState({ config, presets: [], taskRoutes: {} }) })
  afterEach(() => { vi.unstubAllGlobals(); useAIConfigStore.setState(old, true); db.close() })
  it.each(['quality', 'style', 'readability'] as const)('%s: scoped Agnes thinking option matches wire, report and reload without a Canon write', async mode => {
    const f = await fixture(); const original = await db.chapters.get(f.chapterId)
    const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); bodies.push(body)
      expect(body.chat_template_kwargs).toEqual({ enable_thinking: false })
      expect(body.response_format).toEqual({ type: 'json_object' })
      expect(body.max_tokens).toBe(2400); expect(body.temperature).toBe(0)
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '保留先实测后记录的顺序。', strengths: ['行动依据明确'], issues: [] }) } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }))
    }))
    const result = await runWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, worldGroupId: null, mode, call: createWholeChapterQualityCallV1(f.scope.projectId, mode) })
    expect(result.report.reviewer.settings.parameters.chat_template_kwargs).toEqual(bodies[0].chat_template_kwargs)
    const restored = await readLatestWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, mode })
    expect(restored?.current).toBe(true); expect(restored?.report.artifactHash).toBe(result.report.artifactHash)
    expect(await db.chapters.get(f.chapterId)).toEqual(original); expect(bodies).toHaveLength(1)
  })
  it('safe descriptor includes the exact boolean option, while historical JSON-object settings remain unchanged', () => {
    const resolution = resolveRequestConfig(config)
    const settings = describeResolvedAIRequestSettingsV1(resolution, false, { responseFormat: 'json_object', thinkingMode: 'disabled' })
    expect(settings.parameters.chat_template_kwargs).toEqual({ enable_thinking: false })
    expect(parseProseRequestSettingsV1(settings)).toEqual(settings)
    const legacy = describeResolvedAIRequestSettingsV1(resolution, false, { responseFormat: 'json_object' })
    expect(legacy.parameters).not.toHaveProperty('chat_template_kwargs')
    expect(parseProseRequestSettingsV1(legacy)).toEqual(legacy)
    expect(JSON.stringify(settings)).not.toContain(config.apiKey); expect(JSON.stringify(settings)).not.toContain('review.invalid')
  })
  it.each([{ enable_thinking: 'false' }, { enable_thinking: false, apiKey: 'do-not-store' }, { other: false }])('malformed or secret-bearing option never enters prose evidence: %j', value => {
    const settings = describeResolvedAIRequestSettingsV1(resolveRequestConfig(config), false)
    expect(() => parseProseRequestSettingsV1({ ...settings, parameters: { ...settings.parameters, chat_template_kwargs: value } })).toThrow()
  })
  it('HTTP rejection of the option is one request with no fallback that removes it', async () => {
    const f = await fixture(); const original = await db.chapters.get(f.chapterId)
    const fetch = vi.fn(async () => new Response('unsupported request option', { status: 400 }))
    vi.stubGlobal('fetch', fetch)
    await expect(runWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, worldGroupId: null, mode: 'readability', call: createWholeChapterQualityCallV1(f.scope.projectId, 'readability') })).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1); expect(await db.chapters.get(f.chapterId)).toEqual(original)
    expect((await db.agentRuns.toArray())[0].status).toBe('failed')
  })
  it.each([
    { provider: 'agnes' as const, model: 'unsupported-model' },
    { provider: 'openai' as const, model: 'agnes-2.5-flash' },
    { provider: 'ollama' as const, model: 'local-model' },
  ])('other provider/model keeps the existing JSON-object transport: %j', other => {
    expect(wholeChapterQualityRequestOptionsV1(other)).toEqual({ responseFormat: 'json_object' })
    const settings = describeResolvedAIRequestSettingsV1(resolveRequestConfig({ ...config, ...other }), false)
    expect(() => parseProseRequestSettingsV1({ ...settings, parameters: { chat_template_kwargs: { enable_thinking: false } } })).toThrow('思考')
  })
  it.each(['enabled', 'disabled'] as const)('existing Agnes 3.0 explicit thinking option still has valid exact evidence: %s', thinkingMode => {
    const other = { ...config, model: 'agnes-3.0-flash' }
    expect(wholeChapterQualityRequestOptionsV1(other)).toEqual({ responseFormat: 'json_object' })
    const settings = describeResolvedAIRequestSettingsV1(resolveRequestConfig(other), false, { thinkingMode })
    expect(settings.parameters.chat_template_kwargs).toEqual({ enable_thinking: thinkingMode === 'enabled' })
    expect(parseProseRequestSettingsV1(settings)).toEqual(settings)
  })
  it('route change during the response cannot replace the frozen transport or report parameters', async () => {
    const f = await fixture(); const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      useAIConfigStore.setState({ config: { ...config, provider: 'ollama', model: 'changed-while-running' } })
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '保留动作顺序。', strengths: [], issues: [] }) } }] }))
    }))
    const result = await runWholeChapterQualityReviewV1({ scope: f.scope, chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, worldGroupId: null, mode: 'readability', call: createWholeChapterQualityCallV1(f.scope.projectId, 'readability') })
    expect(bodies[0].model).toBe('agnes-2.5-flash')
    expect(result.report.reviewer.settings.model).toBe(bodies[0].model)
    expect(result.report.reviewer.settings.parameters.chat_template_kwargs).toEqual(bodies[0].chat_template_kwargs)
    expect(bodies).toHaveLength(1)
  })
})
