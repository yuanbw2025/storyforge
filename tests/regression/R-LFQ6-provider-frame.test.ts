import { describe, expect, it } from 'vitest'
import { observeDuplicatedProseFrameV1, observeSeparatedProseFrameV1 } from '../../src/lib/prose/provider-frame-observation'
import { parseProseCandidateDraft } from '../../src/lib/agent/prose-copilot'

const prose = '回廊里的光线深了一层。许照合上笔记，决定先核对断口，不把未验证的推断当成事实。'.repeat(20)
describe('LFQ6 · 回复分隔与原文保护', () => {
  it('识别独立分隔符两侧相同开篇的长正文，记录可核对后段，不自动改字', () => {
    const text = `# 第7章 验证\n${prose}\n</think>\n# 第7章 验证\n${prose}`
    const found = observeDuplicatedProseFrameV1(text)!
    expect(found.kind).toBe('duplicated-answer-frame')
    expect(text.slice(found.afterSeparator)).toBe(`# 第7章 验证\n${prose}`)
    expect(() => parseProseCandidateDraft(text)).toThrow('原响应保留')
  })
  it('保留正文中嵌入的字面标签、技术样例和普通重复，不按关键词删掉原文', () => {
    for (const text of [`正文里写着 </think>，它是字面文本。${prose}`, `${prose}\n</think>\n故事结尾的另一段。`, `<think>\n代码样例\n</think>\n${prose}`, `${prose}\n${prose}`]) expect(observeDuplicatedProseFrameV1(text)).toBeNull()
  })
  it('不同正文不会因为相同分隔标签而被认作重复；少量编辑仍能辨别真实重复响应', () => {
    expect(observeDuplicatedProseFrameV1(`${prose}\n</think>\n${'另一位人物在海港中寻找灯塔。'.repeat(50)}`)).toBeNull()
    expect(observeDuplicatedProseFrameV1(`${prose}\n</think>\n${prose.replace('决定先核对断口', '决定先核对断口') + '他把门关好。'}`)).not.toBeNull()
  })
  it('不同开篇的长稿提供作者核对位置，原文仍可保留，不靠相同前48字才能看见提示', () => {
    const after = '许照走到门前，放下钥匙，决定把另一份账册先交给同伴核对。'.repeat(20)
    const text = `${prose}\r\n</think>\r\n${after}`
    expect(observeDuplicatedProseFrameV1(text)).toBeNull()
    const observed = observeSeparatedProseFrameV1(text)!
    expect(observed.kind).toBe('separated-answer-frame')
    expect(text.slice(observed.afterSeparator)).toBe(after)
    expect(parseProseCandidateDraft(text)).toBe(text)
    expect(observed.message).toContain('可以保留全文')
  })
  it('多处分隔定位最后一段，短前缀同样可核对；内嵌标签和围栏中的字面标签保留', () => {
    const after = '街口的人决定合上窗户，把未完成的记录放回桌上。'.repeat(20)
    const text = `${prose}\n</think>\n${prose}\n</think>\n${after}`
    expect(text.slice(observeSeparatedProseFrameV1(text)!.afterSeparator)).toBe(after)
    expect(observeSeparatedProseFrameV1(`说明文字\n</think>\n${after}`)).not.toBeNull()
    for (const marker of ['```', '~~~~']) {
      const literal = `${marker}html\n${prose}\n</think>\n${prose}\n${marker}`
      expect(observeSeparatedProseFrameV1(literal)).toBeNull()
      expect(observeDuplicatedProseFrameV1(literal)).toBeNull()
    }
    expect(observeSeparatedProseFrameV1(`${prose}它写着 </think>，只是字面标签。${after}`)).toBeNull()
  })
})
