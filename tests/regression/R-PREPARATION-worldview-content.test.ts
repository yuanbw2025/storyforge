import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { prepareWorldviewFieldCopilot, formatWorldviewFieldGenerationRequestV1 } from '../../src/lib/agent/worldview-field-copilot'
import { createPromptExecutionRequestV1, freezePromptExecutionOptionsV1 } from '../../src/lib/agent/prompt-execution'
import { worldviewFieldContentGuidanceV1 } from '../../src/lib/creation/worldview-content-skill'
import { formatWorldviewBlock } from '../../src/lib/ai/context-builder'
import { adoptGenerationNodeOutput, runGenerationNode } from '../../src/lib/generation/generation-node'

describe('创作准备 · 世界方法实际冻结与作者模板', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.unstubAllGlobals(); db.close() })

  it.each([false, true])('共同入口实际发送目标领域方法，作者模板路径=%s，生成不提前写入', async custom => {
    const { project, scope } = await seedCurrentWorkspace('阿照修船铺')
    const template = { id: 71, scope: 'user' as const, moduleKey: 'worldview.dimension' as const, promptType: 'generate', name: '作者经济模板', description: '', systemPrompt: '以朴素口吻写修船行业', userPromptTemplate: '{{dimension}}：{{projectName}}', variables: ['dimension', 'projectName'], isActive: true, createdAt: 10, updatedAt: 20 }
    const original = JSON.stringify(template)
    const options = custom ? await freezePromptExecutionOptionsV1({ request: createPromptExecutionRequestV1({ moduleKey: 'worldview.dimension' }), template }) : undefined
    let sent = ''
    const prepared = await prepareWorldviewFieldCopilot({ projectId: project.id!, scope, worldGroupId: null, authorRequest: formatWorldviewFieldGenerationRequestV1({ field: 'economyOverview', mode: 'expand', hint: '保留阿照修船铺，温暖经营' }), promptExecution: options }, { runAI: async messages => { sent = messages.map(m => m.content).join('\n'); return JSON.stringify({ field: 'economyOverview', value: '阿照提前预订晒干木料；公用船台按出航日期协商排期。' }) } })
    const result = await runGenerationNode(prepared.node, prepared.prepared)
    expect(result.gate?.status).toBe('pass')
    if (custom) expect(sent).not.toContain(worldviewFieldContentGuidanceV1('economyOverview'))
    else expect(sent).toContain(worldviewFieldContentGuidanceV1('economyOverview'))
    expect(sent).not.toContain(worldviewFieldContentGuidanceV1('divineDesign'))
    expect(sent).toContain('只允许生成这个字段')
    if (custom) { expect(sent).toContain(template.systemPrompt); expect(prepared.promptExecutionEvidence?.templateId).toBe(71) }
    expect(JSON.stringify(template)).toBe(original)
    expect(await db.worldviews.count()).toBe(0)
  })
  it.each(['agnes', 'custom'] as const)('同一冻结调用传递格式选项且不假设未知服务能力：%s', async provider => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })))
    const { project, scope } = await seedCurrentWorkspace('能力规则实测')
    let observed: unknown
    let calls = 0
    const prepared = await prepareWorldviewFieldCopilot({
      projectId: project.id!, scope, worldGroupId: null,
      authorRequest: formatWorldviewFieldGenerationRequestV1({ field: 'powerHierarchy', mode: 'expand', hint: '保留触铜和一分钟恢复规则' }),
      configOverride: { provider, apiKey: 'synthetic-eval-key', baseUrl: 'https://example.invalid/v1', model: provider === 'agnes' ? 'agnes-2.5-flash' : 'unknown-test-model', temperature: 0.3, maxTokens: 3000 },
    }, { runModel: async (assertCurrent, ...request) => {
      await assertCurrent()
      calls++
      observed = request[5]
      return JSON.stringify({ field: 'powerHierarchy', value: '掌心触铜可塑形；离手一分钟恢复硬度，不恢复形状。' })
    } })
    const result = await runGenerationNode(prepared.node, prepared.prepared)
    expect(result.gate?.status).toBe('pass')
    expect(observed).toEqual(provider === 'agnes' ? { responseFormat: 'json_object', thinkingMode: 'disabled' } : {})
    expect(calls).toBe(1)
    expect(await db.worldviews.count()).toBe(0)
  })

  it('有居民信仰并不等于证实有神；作者确认后未知正文进入原世界上下文', async () => {
    const { project, scope } = await seedCurrentWorkspace('雨夜村庄')
    const candidate = { field: 'divineDesign' as const, value: { hasDivinity: true, divineRank: '没有统一神谱', divineNames: '居民俗称山背后那位', divineRules: '神明存在未获确认；老人留灯，年轻人不信，居民照常生活。' } }
    let sent = ''
    const prepared = await prepareWorldviewFieldCopilot({ projectId: project.id!, scope, worldGroupId: null, authorRequest: formatWorldviewFieldGenerationRequestV1({ field: 'divineDesign', mode: 'expand', hint: '保留神明是否存在的未知，只设计村民信仰' }) }, { runAI: async messages => { sent = messages.map(m => m.content).join('\n'); return JSON.stringify(candidate) } })
    const generated = await runGenerationNode(prepared.node, prepared.prepared)
    expect(generated.gate?.status).toBe('pass')
    expect(sent).toContain('有居民信仰时为true，并不证明有神')
    expect(await db.worldviews.count()).toBe(0)
    await adoptGenerationNodeOutput(prepared.node, candidate)
    const saved = (await db.worldviews.toArray())[0]
    expect(saved.divineDesign).toEqual(candidate.value)
    expect(formatWorldviewBlock(saved)).toContain('神明存在未获确认')
  })

})
