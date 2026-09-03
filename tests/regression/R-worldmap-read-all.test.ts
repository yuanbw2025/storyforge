/**
 * R-WORLDMAP(段一)· 世界地图生成「读全用户已填内容」
 *
 * 背景:此前地图生成漏读「城池重镇(regionDimensions)」「自然资源」「自然/人文词条」,
 * 等于无视用户已填内容。段一:读全这些 + 提示词要求"尊重已填的名字/数量,缺的才补全"。
 *
 * 本测试锁定:这些此前漏读的内容会进 prompt,且铁律措辞在场。
 */
import { describe, it, expect } from 'vitest'
import { buildVoronoiMapPrompt } from '../../src/lib/ai/adapters/voronoi-map-adapter'

describe('R-WORLDMAP 段一 · 地图生成读全已填内容', () => {
  it('城池重镇 / 自然资源 / 词条 都进 prompt,且要求尊重已填', () => {
    const wv: any = {
      worldStructure: '单一大陆',
      mountainsRivers: '苍澜江自北向南',
      factionLayout: '天南帝国、迦南圣地',
      regionDimensions: '帝都·天南城；边陲·落雁镇',     // 城池重镇:此前漏读
      naturalResourceOverview: '北境多寒铁',              // 自然资源:此前漏读
      politicsOverview: '宗门议会治理疆域',
      economyOverview: '灵石与商路维系交换',
      cultureOverview: '修仙文明尊崇师承',
    }
    const codexCtx = '【势力】血衣楼：盘踞东海\n【城池】落雁镇：边陲重镇'  // 词条:此前漏读
    const messages = buildVoronoiMapPrompt(wv, '大陆东高西低', [], codexCtx)
    const full = messages.map(m => m.content).join('\n\n')

    // 此前漏读的三类已填内容,现在都在 prompt 里
    expect(full).toContain('城池重镇')
    expect(full).toContain('天南城')
    expect(full).toContain('自然资源')
    expect(full).toContain('寒铁')
    expect(full).toContain('血衣楼')      // 词条内容
    expect(full).toContain('落雁镇')

    // 尊重已填 + 补全缺口的铁律措辞
    expect(full).toContain('必须尊重用户已设定')
    expect(full).toContain('数量以用户为准')
    expect(full).toMatch(/补全/)

    // 人地互动常识已内化进地图生成
    expect(full).toContain('人地互动')
    expect(full).toMatch(/依水而聚|大河流域/)
  })

  it('用户没填时仍给出兜底(不报错)', () => {
    const messages = buildVoronoiMapPrompt(null, '', [])
    const full = messages.map(m => m.content).join('\n\n')
    expect(full).toContain('未填写世界观描述')
  })
})
