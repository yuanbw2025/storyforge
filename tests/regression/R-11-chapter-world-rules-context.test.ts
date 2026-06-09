/**
 * R-11: chapter.content prompt must receive worldRulesContext.
 *
 * Regression target:
 *   The `chapter.content` seed declared `worldRulesContext`, but
 *   `buildChapterContentPrompt` did not pass it to renderPrompt, so
 *   chapter prose generation silently ignored real-vs-fiction rules.
 */
import { describe, it, expect } from 'vitest'
import { buildChapterContentPrompt } from '../../src/lib/ai/adapters/chapter-adapter'

describe('R-11: chapter.content worldRulesContext wiring', () => {
  it('renders worldRulesContext into the actual prompt messages', () => {
    const messages = buildChapterContentPrompt(
      '第一章 镜城开埠',
      '主角进入镜城，发现市舶司与镜税冲突。',
      '【世界观】镜城是一座港口城市。',
      '【角色】沈砚：账房出身。',
      '上一章结尾文本',
      '【真实与幻想规则】镜城沿用宋代市舶司制度；镜税为架空改造。',
    )

    const fullPrompt = messages.map(message => message.content).join('\n\n')
    expect(fullPrompt).toContain('镜城沿用宋代市舶司制度')
    expect(fullPrompt).toContain('镜税为架空改造')
  })
})
