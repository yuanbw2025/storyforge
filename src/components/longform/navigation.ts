import type { SidebarModule } from '../layout/sidebar-tree'

export const LONGFORM_SECTIONS = [
  ['library', '作品库'], ['workbench', '长篇工作台'], ['versions', '版本与导出'],
  ['derive', '派生世界'], ['import', '文档导入'], ['community', '社区与发行'], ['settings', '通用设置'],
] as const
export type LongformSection = typeof LONGFORM_SECTIONS[number][0]
export type LongformMode = 'steps' | 'nodes' | 'agent'
export const LONGFORM_STEPS: { label: string; modules: [SidebarModule, string][]; auxiliary?: boolean }[] = [
  { label: '作品概况', modules: [['info', '基本信息'], ['world-overview', '多世界设置']] },
  { label: '灵感与参考', modules: [['inspiration', '灵感与定位'], ['references', '项目参考与分析']] },
  { label: '世界与设定', modules: [['world-rules', '真实与幻想'], ['worldview-origin', '世界起源'], ['worldview-natural', '自然环境'], ['worldview-humanity', '人文环境'], ['history', '历史年表']] },
  { label: '故事设计', modules: [['story-design', '故事核心'], ['rules', '创作规则']] },
  { label: '人物与关系', modules: [['characters', '角色生成'], ['characters-main', '主要角色'], ['characters-minor', '次要角色'], ['characters-npc', 'NPC'], ['characters-extra', '路人']] },
  { label: '关系网络', modules: [['relations', '关系网']] },
  { label: '大纲与章纲', modules: [['outline', '卷纲与章纲']] },
  { label: '场景细纲', modules: [['detailed-outline', '细纲']] },
  { label: '正文', modules: [['chapters-list', '章节与正文']] },
  { label: '改稿影响', modules: [['editor', '章节改稿与影响检查']], auxiliary: true },
  { label: '故事线', modules: [['story-arc', '主支线与进度']], auxiliary: true },
  { label: '角色驱动', modules: [['character-driven-plot', '角色驱动剧情']], auxiliary: true },
  { label: '伏笔看板', modules: [['foreshadow', '伏笔']], auxiliary: true },
  { label: '事实与认知', modules: [['fact-library', '事实库']], auxiliary: true },
  { label: '状态与物品', modules: [['state-table', '状态表'], ['inventory', '物品栏']], auxiliary: true },
  { label: '故事年表', modules: [['story-timeline', '故事年表']], auxiliary: true },
  { label: '地点与地图', modules: [['locations', '地点与地图']], auxiliary: true },
  { label: '修炼进度', modules: [['cultivation-progress', '修炼进度']], auxiliary: true },
  { label: '场景考证', modules: [['scene-verify', '场景考证']], auxiliary: true },
  { label: '文风学习', modules: [['style-learning', '文风学习']], auxiliary: true },
  { label: '资料与检索', modules: [['rag-library', '资料与检索']], auxiliary: true },
  { label: '提示词', modules: [['prompts', '提示词库']], auxiliary: true },
  { label: '查找与替换', modules: [['global-replace', '全局替换']], auxiliary: true },
]
export function sectionForModule(module: SidebarModule): LongformSection {
  if (['version-history', 'export', 'data-management'].includes(module)) return 'versions'
  if (module === 'import-doc') return 'import'
  if (['settings', 'usage-stats'].includes(module)) return 'settings'
  return 'workbench'
}
