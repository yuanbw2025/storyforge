/**
 * R-12: single-field AI generation must include current field value.
 *
 * Regression target:
 *   Field-level AI generation used only user hints and surrounding context,
 *   so when the user had already typed half a field, AI generation could
 *   ignore it and start over.
 */
import { describe, it, expect } from 'vitest'
import { buildStoryGeneratePrompt } from '../../src/lib/ai/adapters/story-adapter'
import { buildWorldviewPrompt } from '../../src/lib/ai/adapters/worldview-adapter'

describe('R-12: AI field current value injection', () => {
  it('story.generate renders current field value and mode guidance', () => {
    const messages = buildStoryGeneratePrompt(
      '核心冲突',
      '镜城纪事',
      'fantasy',
      '【世界观】镜城按港口城邦运行。',
      '加强主角个人代价',
      undefined,
      '主角想废除镜税，但父亲正是镜税账房。',
      'expand',
    )

    const prompt = messages.map(m => m.content).join('\n\n')
    expect(prompt).toContain('主角想废除镜税')
    expect(prompt).toContain('本次生成模式】扩写')
    expect(prompt).toContain('加强主角个人代价')
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
})
