import { expect, type Page } from '@playwright/test'

const groups: Record<string, [string, string?]> = {
  '项目概况': ['作品概况'], '世界总览': ['作品概况', '多世界设置'],
  '灵感反推': ['灵感与参考', '灵感反推'], '项目参考': ['灵感与参考', '项目参考与分析'],
  '真实与幻想': ['世界与设定', '真实与幻想'], '世界起源': ['世界与设定', '世界起源'],
  '自然环境': ['世界与设定', '自然环境'], '人文环境': ['世界与设定', '人文环境'], '历史年表': ['世界与设定', '历史年表'],
  '力量体系': ['世界与设定', '力量体系'], '故事设计': ['故事设计'], '创作规则': ['故事设计', '创作规则'],
  '角色生成': ['人物与关系', '角色生成'], '主要角色': ['人物与关系', '主要角色'], '次要角色': ['人物与关系', '次要角色'],
  'NPC': ['人物与关系', 'NPC'], '路人': ['人物与关系', '路人'], '关系网': ['关系网络'],
  '大纲': ['大纲与章纲'], '细纲': ['场景细纲'], '章节': ['正文'], '伏笔': ['伏笔看板'],
  '角色驱动': ['角色驱动'], '故事线': ['故事线'], '事实库': ['事实与认知'],
  '状态表': ['状态与物品', '状态表'], '物品栏': ['状态与物品', '物品栏'],
  '地理设定': ['地点与地图', '地理设定'], '重要地点': ['地点与地图', '地点库'], '世界地图': ['地点与地图', '世界地图'],
  '文风学习': ['文风学习'], '资料与检索库': ['资料与检索'], '提示词库': ['提示词'],
  '故事年表': ['故事年表'], '修炼进度': ['修炼进度'], '场景考证': ['场景考证'], '全局替换': ['查找与替换'],
}
export async function openLongformLeaf(page: Page, name: string): Promise<boolean> {
  // Frozen Vite acceptance serves the source module graph with network routing
  // enabled. Retain the app/data assertions after allowing that graph to settle.
  await expect(page.locator('[data-workspace-ready]')).toBeVisible({ timeout: 15_000 })
  if (name === '文档解析') name = '文档导入'
  const primary = page.getByRole('navigation', { name: '长篇一级导航' })
  if (await primary.count() === 0) return false
  if (['设置', '数据管理', '版本历史', '文档导入', '用量统计', '导出'].includes(name)) {
    const section = name === '设置' || name === '用量统计' ? '通用设置' : name === '文档导入' ? '文档导入' : '版本与导出'
    await primary.getByRole('button', { name: section, exact: true }).click()
    if (['数据管理', '导出'].includes(name)) await page.getByRole('navigation', { name: '版本与导出', exact: true }).getByRole('button', { name: '导出与备份', exact: true }).click()
    if (name === '用量统计') await page.getByRole('navigation', { name: '通用设置', exact: true }).getByRole('button', { name: '用量统计', exact: true }).click()
    return true
  }
  await primary.getByRole('button', { name: '长篇工作台', exact: true }).click()
  const modes = page.getByRole('navigation', { name: '工作台创作方式' })
  await modes.getByRole('button', { name: name === '节点模式' ? '节点创作' : '分步骤模式', exact: true }).click()
  if (name === '节点模式') return true
  const item = groups[name]
  if (!item) throw new Error(`长篇验收导航未映射：${name}`)
  const steps = page.getByRole('navigation', { name: '长篇工作台二级导航' })
  await steps.getByRole('button', { name: item[0], exact: true }).click()
  if (item[1]) await page.getByRole('navigation', { name: item[0] === '地点与地图' ? '地点与地图视图' : `${item[0]}三级导航`, exact: true }).getByRole('button', { name: item[1], exact: true }).click()
  await expect(steps).toBeVisible()
  return true
}
