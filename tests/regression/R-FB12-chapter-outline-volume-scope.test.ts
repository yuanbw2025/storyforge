/**
 * R-FB12: 章节大纲展开必须「锁定本卷 + 遵守设定的章节数」(社区反馈)
 *
 * 反馈(买辣椒也用券):章节展开总是在第一卷就展开了整本书的内容,
 * 并且不按照设置的章节数;生成内容跟卷情节摘要不搭。
 *
 * 根因:outline.chapter 模板写死「每卷约 15-25 章」,且 chaptersPerVolume
 * 参数虽已定义却从未被任何占位符引用 —— 用户拖滑块设的章节数完全失效;
 * 模板也没有「只展开本卷、严格围绕卷情节摘要」的约束 → AI 随意发挥跑完整本书。
 *
 * 修复:① 接通 {{chaptersPerVolume}}(带 uses/notUses 守卫防空串);
 *       ② 加铁律「只展开本卷 / 不许把整本书讲完 / 严格贴合卷情节摘要 / 均匀拆分」。
 */
import { describe, it, expect } from 'vitest'
import { buildChapterOutlinePrompt } from '../../src/lib/ai/adapters/outline-adapter'

const VOL_TITLE = '第一卷·初入剑宗'
const VOL_SUMMARY = '主角拜入剑宗，初露锋芒，遭师门排挤，结交同伴，迎来第一次大战。'

describe('R-FB12: 章节大纲展开锁定本卷 + 遵守章节数', () => {
  it('默认(无参数)按内置默认章节数(20)严格输出，并锁定本卷范围', () => {
    const messages = buildChapterOutlinePrompt(VOL_TITLE, VOL_SUMMARY, '【世界观】剑宗。', '', undefined)
    const full = messages.map(m => m.content).join('\n\n')

    // 章节数被接通(默认 20),不再是写死的「约 15-25 章」放任发挥
    expect(full).toContain('恰好 20 章')
    expect(full).toContain('数组长度必须恰好为 20')

    // 只展开本卷 + 不许讲完整本书 的硬约束存在
    expect(full).toContain('只展开【本卷】')
    expect(full).toContain('整本书')

    // 卷信息确实进了 prompt
    expect(full).toContain(VOL_TITLE)
    expect(full).toContain(VOL_SUMMARY)
  })

  it('用户设定 chaptersPerVolume=30 时，prompt 要求恰好 30 章', () => {
    const messages = buildChapterOutlinePrompt(
      VOL_TITLE, VOL_SUMMARY, '【世界观】剑宗。', '', undefined,
      { parameterValues: { chaptersPerVolume: 30 } },
    )
    const full = messages.map(m => m.content).join('\n\n')

    expect(full).toContain('恰好 30 章')
    expect(full).toContain('数组长度必须恰好为 30')
    expect(full).not.toContain('恰好 20 章')

    // 卷摘要与滑块冲突时,显式裁决以滑块设定为准(社区追问:摘要写100、滑块80按哪个)
    expect(full).toContain('以此处设定的 30 章为准')
  })

  it('启用了其它参数但未设章节数时，不会渲染出空的 {{chaptersPerVolume}}', () => {
    // parameterValues 非空(用户调了节奏),但没设 chaptersPerVolume → 走 notUses 兜底
    const messages = buildChapterOutlinePrompt(
      VOL_TITLE, VOL_SUMMARY, '【世界观】剑宗。', '', undefined,
      { parameterValues: { pace: '快' } },
    )
    const full = messages.map(m => m.content).join('\n\n')

    // 不能出现「恰好  章」这种空串渲染事故
    expect(full).not.toMatch(/恰好\s+章/)
    expect(full).not.toContain('恰好  章')
    // 兜底到约 15-25 章，且本卷约束仍在
    expect(full).toContain('约 15-25 章')
    expect(full).toContain('只展开【本卷】')
  })
})
