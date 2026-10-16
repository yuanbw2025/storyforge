import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { prepareProseCopilot } from '../../src/lib/agent/prose-copilot'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { usePromptStore } from '../../src/stores/prompt'
import { buildChapterContentRequestV1 } from '../../src/lib/ai/adapters/chapter-adapter'
import { CORE_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-core'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'

const oldPrompts = usePromptStore.getState()
const oldConfig = useAIConfigStore.getState().config

async function seed() {
  const f = await seedCurrentWorkspace('安静的收店章', { genres: ['realism'] })
  await db.works.update(f.scope.workId, { writingStyleId: 'luxun', description: '合作经营，未领取次日奖励', updatedAt: 50 })
  const put = (table: string, row: Record<string, unknown>) => (db as any)[table].add(stampNewRecord(f.scope, table, { projectId: f.scope.projectId, createdAt: 1, updatedAt: 1, ...row }, { owner: 'work' })) as Promise<number>
  const volume = await put('outlineNodes', { type: 'volume', parentId: null, title: '店里', summary: '整理和约定', order: 0 })
  const outlineNodeId = await put('outlineNodes', { type: 'chapter', parentId: volume, title: '关灯', summary: '两人收好工具，约定明天的分工；关灯即停笔。', order: 0 })
  const chapterId = await put('chapters', { outlineNodeId, title: '关灯', content: '', wordCount: 0, status: 'outline', order: 0, notes: '' })
  await put('detailedOutlines', { outlineNodeId, scenes: [{ sceneId: 'closing', title: '收店', summary: '整理工具，安静道别', conflict: '', location: '小店', characterIds: [], pace: 'slow', estimatedWords: 500, notes: '不要强加冲突、敌人或系统惩罚。', sceneFunction: '缓冲与关系变化', exitState: '关灯停笔，次日签到尚未发生。' }] })
  const profile = '【自有文风完整尾部】口语对白保留人物不同的说话习惯。'
  const pair = '[{"id":"p1","before":"测试改稿前原文","after":"测试改稿后原文","intent":"保留两人的口语差异","createdAt":1}]'
  const styleId = await put('userStyleProfiles', { enabled: true, profile, revisionPairs: pair, sourceChapterIds: '[]', sampleCount: 0, sampleWords: 0 })
  return { ...f, chapterId, outlineNodeId, styleId, profile, pair }
}

describe('LFQ6 · 共用正文任务与文风控制', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.unstubAllGlobals(); usePromptStore.setState(oldPrompts, true); useAIConfigStore.setState({ config: oldConfig }); db.close() })

  it('生成、续写、评审和修订均必读 Work 偏好及启用的画像/改稿原文，停用后排除', async () => {
    const f = await seed()
    const base = { projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, authorRequest: '只写安静收店，在关灯处停笔', config: oldConfig }
    for (const operation of ['generate', 'continue', 'review', 'revise'] as const) {
      const assembled = await prepareProseGatewayAssemblyV1({ ...base, operation })
      expect(assembled.text).toContain('合作经营，未领取次日奖励')
      expect(assembled.text).toContain('鲁迅式犀利')
      expect(assembled.text).toContain(f.profile)
      expect(assembled.text).toContain(f.pair)
      expect(assembled.contextGatewayExecution.sourceSnapshots.some(item => item.sourceKey === 'workAuthoringIntent')).toBe(true)
      expect(assembled.text).toBe(assembled.contextGatewayExecution.contextPacket.content)
      expect(assembled.segments.reduce((sum, segment) => sum + segment.tokens, 0)).toBe(assembled.totalInputTokens)
      for (const [index, key] of assembled.included.entries()) {
        expect(assembled.sourceEvidence!.find(item => item.key === key)!.sourceHash).toBe(await sha256Text(assembled.segments[index].content))
      }
    }
    await db.userStyleProfiles.update(f.styleId, { enabled: false, updatedAt: 2 })
    const disabled = await prepareProseGatewayAssemblyV1({ ...base, operation: 'generate' })
    expect(disabled.text).not.toContain(f.profile)
    expect(disabled.text).not.toContain('测试改稿前原文')
    expect((await db.userStyleProfiles.get(f.styleId))!.profile).toBe(f.profile)
  })

  it('节点字数覆盖进入真实模板，温度零与输出上限进入实际请求；节点显式参数优先', async () => {
    const f = await seed()
    const template = { ...oldPrompts.getActive('chapter.content'), modelOverride: { temperature: 0, maxTokens: 3200 } }
    usePromptStore.setState({ getActive: key => key === 'chapter.content' ? template : oldPrompts.getActive(key) })
    const config = { ...oldConfig, provider: 'deepseek' as const, model: 'deepseek-chat', apiKey: 'test-only', baseUrl: 'http://localhost:1234/v1', temperature: 0.7, maxTokens: 0 }
    useAIConfigStore.setState({ config })
    const bodies: any[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ choices: [{ message: { content: '收好工具，两人依次关灯道别。'.repeat(12) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const input = { projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, chapterId: f.chapterId, outlineNodeId: f.outlineNodeId, authorRequest: '只写收店', aiConfig: config, parameterValues: { wordCount: 501 } }
    const first = await prepareProseCopilot(input)
    expect(first.prepared.messages.map(item => item.content).join('\n')).toContain('字数约 501 字/章')
    await first.runRaw(first.prepared.messages)
    expect(bodies[0].temperature).toBe(0)
    expect(bodies[0].max_tokens).toBe(3200)
    expect(first.input.generationOverrides).toEqual({ temperature: 0, maxTokens: 3200 })
    const explicit = await prepareProseCopilot({ ...input, generationOverrides: { temperature: 0.2, maxTokens: 4000 } })
    await explicit.runRaw(explicit.prepared.messages)
    expect(bodies[1].temperature).toBe(0.2)
    expect(bodies[1].max_tokens).toBe(4000)
    await db.chapters.update(f.chapterId, { content: '<p>两人开始清点工具，店里还亮着灯。</p>', wordCount: 18 })
    const continuation = await prepareProseCopilot({ ...input, skillId: 'prose.continue', authorRequest: '续写收店，在关灯处停笔' })
    const continuationWire = continuation.prepared.messages.map(item => item.content).join('\n').replace(/\s/g, '')
    expect(continuationWire).toContain('续写篇幅501字')
    expect(continuationWire).not.toContain('1000-2000')
  })

  it('默认章法允许缓冲和明确停笔；自有模板与显式关闭可选参数仍保留', () => {
    const seed = CORE_PROMPT_SEEDS.find(item => item.moduleKey === 'chapter.content')!
    expect(seed.systemPrompt).toContain('不强制每章反转或悬念')
    expect(seed.systemPrompt).toContain('缓冲、日常与安静场景可以保留')
    expect(seed.systemPrompt).not.toContain('第一段就要制造悬念或冲突')
    const template = { ...oldPrompts.getActive('chapter.content'), systemPrompt: '作者自有模板{{#if usesTone}}，{{tone}}{{/if}}', userPromptTemplate: '{{userHint}}', modelOverride: { temperature: 0, maxTokens: 2000 } }
    usePromptStore.setState({ getActive: () => template })
    const request = buildChapterContentRequestV1('关灯', '收店', '完整资料', '', '', undefined, '安静结束', { parameterValues: {}, requiredGatewayContext: '完整资料' })
    expect(request.messages[0].content).toContain('作者自有模板')
    expect(request.messages[0].content).not.toContain('严肃')
    expect(request.messages.some(item => item.content.includes('完整资料'))).toBe(true)
    expect(request.modelOverride).toEqual({ temperature: 0, maxTokens: 2000 })
  })
})
