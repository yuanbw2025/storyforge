import type { ComponentType } from 'react'
import {
  FileText, Library, Globe, Mountain, Users2, Sparkles,
  UserCircle, UsersRound, User, Footprints, Network,
  Ruler, BookOpen, FilePen, Eye,
  FileCog, History, Upload, Download, Settings,
  Map, ClipboardList, GitBranch, Clock, MapPin, Scale,
  Drama, Package, CalendarClock, ScanSearch, Coins, Feather, Database, TrendingUp, Workflow,
  Replace,
} from 'lucide-react'

/** 当前侧边栏模块 ID；一个叶子对应一个正式 panel。 */
export type SidebarModule =
  // 著作信息
  | 'info'
  | 'references'
  | 'inspiration'

  // 设定库
  | 'world-overview'
  | 'world-rules'
  | 'worldview-origin'
  | 'worldview-natural'
  | 'worldview-humanity'
  | 'story-design'
  | 'characters'
  | 'characters-main'
  | 'characters-minor'
  | 'characters-npc'
  | 'characters-extra'
  | 'relations'
  | 'geography'
  | 'locations'
  | 'history'

  // 创作区
  | 'rules'
  | 'outline'
  | 'character-driven-plot'
  | 'visual-workflows'
  | 'rag-library'
  | 'detailed-outline'
  | 'chapters-list'
  | 'editor'
  | 'foreshadow'
  | 'style-learning'
  | 'global-replace'

  // 提示词库（一级）
  | 'prompts'

  // 设置区
  | 'version-history'
  | 'import-doc'
  | 'export'
  | 'usage-stats'
  | 'settings'
  | 'data-management'

  // 状态表（A1）
  | 'state-table'

  // 物品栏（Phase 25.5.2-b）
  | 'inventory'

  // 事实库（NS-4 时序事实账本）
  | 'fact-library'

  // 故事进程年表（Phase 25.5.2-a）
  | 'story-timeline'

  // Phase 34 正文修炼阶段追踪
  | 'cultivation-progress'

  // 场景考证（Phase 27.2a）
  | 'scene-verify'

  // 全局故事线（Phase B）
  | 'story-arc'

  // 世界地图（Phase 20）
  | 'world-map'
  | 'power-system'

export type ModuleContentType = 'upstream' | 'writing' | 'downstream' | 'tool' | 'experience' | 'system'

export interface ModuleContentTypeDefinition {
  label: string
  description: string
}

export const MODULE_CONTENT_TYPE_DEFINITIONS: Record<ModuleContentType, ModuleContentTypeDefinition> = {
  upstream: {
    label: '设定',
    description: '你填写或规划的内容，会作为 AI 创作的上游依据。',
  },
  writing: {
    label: '创作',
    description: '小说正文的实际写作与编辑区域。',
  },
  downstream: {
    label: '产物',
    description: '从已写正文提取或整理的内容，可由作者校正。',
  },
  tool: {
    label: 'AI 工具',
    description: '用于生成、反推、分析或考证的辅助工具。',
  },
  experience: {
    label: '体验',
    description: '独立于创作 Canon 的互动运行、存档与事件区域。',
  },
  system: {
    label: '系统',
    description: '项目导入、导出、版本、提示词与应用配置。',
  },
}

/**
 * Phase 36 的模块内容类型单一事实源。
 * 所有正式模块都必须显式登记，避免新增入口丢失内容类型标记。
 */
export const MODULE_CONTENT_TYPES: Record<SidebarModule, ModuleContentType> = {
  info: 'upstream',
  references: 'upstream',
  inspiration: 'tool',
  'world-overview': 'upstream',
  'world-rules': 'upstream',
  'worldview-origin': 'upstream',
  'worldview-natural': 'upstream',
  'worldview-humanity': 'upstream',
  'story-design': 'upstream',
  characters: 'upstream',
  'characters-main': 'upstream',
  'characters-minor': 'upstream',
  'characters-npc': 'upstream',
  'characters-extra': 'upstream',
  relations: 'upstream',
  geography: 'upstream',
  locations: 'upstream',
  history: 'upstream',
  rules: 'upstream',
  outline: 'upstream',
  'character-driven-plot': 'tool',
  'visual-workflows': 'tool',
  'rag-library': 'tool',
  'detailed-outline': 'upstream',
  'chapters-list': 'writing',
  editor: 'writing',
  foreshadow: 'upstream',
  'style-learning': 'tool',
  'global-replace': 'tool',
  prompts: 'system',
  'version-history': 'system',
  'import-doc': 'system',
  export: 'system',
  'usage-stats': 'system',
  settings: 'system',
  'data-management': 'system',
  'state-table': 'downstream',
  inventory: 'downstream',
  'fact-library': 'downstream',
  'story-timeline': 'downstream',
  'cultivation-progress': 'downstream',
  'scene-verify': 'tool',
  'story-arc': 'upstream',
  'world-map': 'upstream',
  'power-system': 'upstream',
}

export function getModuleContentType(module: SidebarModule): ModuleContentType {
  return MODULE_CONTENT_TYPES[module]
}

// ── 树节点 ────────────────────────────────────────────────────────────

export interface TreeLeaf {
  kind: 'leaf'
  id: SidebarModule
  label: string
  icon: ComponentType<{ className?: string }>
  contentType: ModuleContentType
}

export interface TreeBranch {
  kind: 'branch'
  /** 折叠状态 key，需保证唯一 */
  branchId: string
  label: string
  icon?: ComponentType<{ className?: string }>
  children: TreeNode[]
}

export type TreeNode = TreeLeaf | TreeBranch

export interface TreeSection {
  /** section 标识，section 一级也可能是个直接叶子（如 提示词库） */
  sectionId: string
  label: string
  icon?: ComponentType<{ className?: string }>
  /** 一级直接是叶子（提示词库）—— 单击进入对应 panel */
  rootLeaf?: TreeLeaf
  /** 否则有树形结构 */
  children?: TreeNode[]
}

// ── 数据 ─────────────────────────────────────────────────────────────

const leaf = (id: SidebarModule, label: string, icon: ComponentType<{ className?: string }>): TreeLeaf =>
  ({ kind: 'leaf', id, label, icon, contentType: getModuleContentType(id) })

export const NAV_TREE: TreeSection[] = [
  {
    sectionId: 'project',
    label: '著作信息',
    children: [
      leaf('info',         '项目概况', FileText),
      leaf('inspiration',  '灵感反推', Sparkles),
      leaf('references',   '项目参考', Library),
    ],
  },
  {
    sectionId: 'lib',
    label: '设定库',
    children: [
      leaf('world-overview', '世界总览', Globe),
      {
        kind: 'branch',
        branchId: 'lib.worldview',
        label: '世界观',
        icon: Globe,
        children: [
          leaf('world-rules',        '真实与幻想', Scale),
          leaf('worldview-origin',   '世界起源', Sparkles),
          leaf('worldview-natural',  '自然环境', Mountain),
          leaf('worldview-humanity', '人文环境', Users2),
          leaf('history',            '历史年表', Clock),
          leaf('world-map',          '世界地图', Map),
        ],
      },
      leaf('story-design', '故事设计', BookOpen),
      {
        kind: 'branch',
        branchId: 'lib.characters',
        label: '角色设计',
        icon: UsersRound,
        children: [
          leaf('characters',         '角色生成', UserCircle),
          leaf('characters-main',    '主要角色', UserCircle),
          leaf('characters-minor',   '次要角色', User),
          leaf('characters-npc',     'NPC',      UsersRound),
          leaf('characters-extra',   '路人',     Footprints),
          leaf('relations',          '关系网',   Network),
        ],
      },
    ],
  },
  {
    sectionId: 'create',
    label: '创作区',
    children: [
      leaf('rules',            '创作规则', Ruler),
      leaf('outline',          '大纲',     BookOpen),
      leaf('character-driven-plot', '角色驱动', Drama),
      leaf('rag-library',      '资料与检索库', Database),
      leaf('visual-workflows', '节点模式', Workflow),
      leaf('story-arc',        '故事线',   GitBranch),
      leaf('chapters-list',    '章节',     FilePen),
      leaf('foreshadow',       '伏笔',     Eye),
      leaf('style-learning',   '文风学习', Feather),
      leaf('global-replace',   '全局替换', Replace),
      leaf('locations',        '重要地点', MapPin),
      leaf('state-table',      '状态表',   ClipboardList),
      leaf('inventory',        '物品栏',   Package),
      leaf('fact-library',     '事实库',   Database),
      leaf('story-timeline',   '故事年表', CalendarClock),
      leaf('cultivation-progress', '修炼进度', TrendingUp),
      leaf('scene-verify',     '场景考证', ScanSearch),
    ],
  },
  {
    sectionId: 'prompts',
    label: '提示词库',
    icon: FileCog,
    rootLeaf: leaf('prompts', '提示词库', FileCog),
  },
  {
    sectionId: 'system',
    label: '设置区',
    children: [
      leaf('version-history',  '版本历史', History),
      leaf('import-doc',       '文档解析', Upload),
      leaf('export',           '数据管理', Download),
      leaf('usage-stats',      '消耗统计', Coins),
      leaf('settings',         '设置',     Settings),
    ],
  },
]

// ── 工具 ─────────────────────────────────────────────────────────────

/** 找到包含某 module 的所有 branch 的 branchId 链（用于默认展开） */
export function getBranchChain(target: SidebarModule): string[] {
  const chain: string[] = []
  function walk(nodes: TreeNode[], path: string[]): boolean {
    for (const n of nodes) {
      if (n.kind === 'leaf' && n.id === target) {
        chain.push(...path)
        return true
      }
      if (n.kind === 'branch' && walk(n.children, [...path, n.branchId])) {
        return true
      }
    }
    return false
  }
  for (const sec of NAV_TREE) {
    if (sec.children && walk(sec.children, [])) break
    if (sec.rootLeaf?.id === target) break
  }
  return chain
}
