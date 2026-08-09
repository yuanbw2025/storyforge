/**
 * R-12: single-field AI generation must preserve field-level author intent.
 *
 * Regression target:
 *   Worldview still uses the legacy field prompt boundary. Story core now
 *   reads its current value from the registered storyCore source; that runtime
 *   evidence is covered by R-HARNESS31-story-core-agent.
 */
import { describe, it, expect } from 'vitest'
import { formatStoryCoreGenerationRequestV1 } from '../../src/lib/agent/story-core-copilot'
import { buildWorldviewPrompt } from '../../src/lib/ai/adapters/worldview-adapter'

describe('R-12: AI field current value injection', () => {
  it('story-core request freezes the governed field, mode and author hint', () => {
    const request = formatStoryCoreGenerationRequestV1({
      field: 'centralConflict',
      mode: 'expand',
      hint: '加强主角个人代价',
    })

    expect(request).toContain('目标字段=centralConflict')
    expect(request).toContain('生成模式=expand')
    expect(request).toContain('加强主角个人代价')
  })

  it('worldview.dimension rewrite mode ignores current field value', () => {
    const messages = buildWorldviewPrompt(
      '政治制度',
      '镜城纪事',
      'fantasy',
      '【世界历史线】镜城刚刚开埠。',
      '让制度更有矛盾',
      undefined,
      '镜城由市舶司、商会、镜税署三方共治。',
      'rewrite',
    )

    const prompt = messages.map(m => m.content).join('\n\n')
    expect(prompt).not.toContain('镜城由市舶司、商会、镜税署三方共治')
    expect(prompt).toContain('本次生成模式】重写')
    expect(prompt).toContain('忽略当前字段已有内容')
    expect(prompt).toContain('让制度更有矛盾')
  })

  it('worldview origin and power generation include field boundary guards', () => {
    const originPrompt = buildWorldviewPrompt(
      'origin',
      '镜城纪事',
      'fantasy',
      '【力量体系】镜术分九阶。',
      '',
      undefined,
      '镜城由陨星镜海诞生。',
      'expand',
    ).map(m => m.content).join('\n\n')

    expect(originPrompt).toContain('本次只生成“世界来源”')
    expect(originPrompt).toContain('不要展开力量等级')
    expect(originPrompt).toContain('力量体系”只能作为约束条件')

    const powerPrompt = buildWorldviewPrompt(
      'power',
      '镜城纪事',
      'fantasy',
      '【世界来源】镜城由陨星镜海诞生。',
      '',
      undefined,
      '镜术来自镜海潮汐。',
      'expand',
    ).map(m => m.content).join('\n\n')

    expect(powerPrompt).toContain('本次只生成“力量体系”')
    expect(powerPrompt).toContain('不要改写世界来源')
    expect(powerPrompt).toContain('给出兼容方案')
  })
})
