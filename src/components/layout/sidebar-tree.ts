import type { ComponentType } from 'react'
import {
  FileText, Library, Globe, Mountain, Users2, Sparkles,
  UserCircle, UsersRound, User, Footprints, Network,
  Ruler, BookOpen, FilePen, Eye,
  FileCog, History, Upload, Download, Settings,
  Map, ClipboardList, GitBranch, Clock, MapPin, Scale,
  Drama, Package, CalendarClock, ScanSearch, Coins, Feather, Database,
} from 'lucide-react'

/**
 * Phase 4 起的侧边栏模块 ID。
 * 一个叶子 = 一个 panel。新加的占位叶子也在这里登记。
 */
export type SidebarModule =
  // 著作信息
  | 'info'
  | 'references'
  | 'inspiration'              // Phase 26.4 — 灵感反推

  // 设定库
  | 'world-overview'        // Phase 25.4 — 世界总览（多世界）
  | 'world-rules'           // Phase 32 — 真实与幻想
  | 'worldview-origin'      // 占位 (P5)
  | 'worldview-natural'     // 占位 (P5)
  | 'worldview-humanity'    // 占位 (P6)
  | 'story-design'          // = 旧 story-core
  | 'characters'            // 角色生成
  | 'characters-main'       // 主要角色
  | 'characters-minor'      // 占位 (P7)
  | 'characters-npc'        // 占位 (P7)
  | 'characters-extra'      // 占位 (P7)
  | 'relations'             // 关系网
  | 'geography'             // 地理环境（legacy）
  | 'locations'             // 重要地点（Phase 25.3）
  | 'history'               // 历史年表
  // 'codex' 独立侧栏入口已于 C4 移除：词条改在「自然环境」「人文环境」面板内就地编辑

  // 创作区
  | 'rules'
  | 'outline'
  | 'character-driven-plot'  // Phase 26.3 — 角色驱动剧情
  | 'detailed-outline'      // 占位 (P8)
  | 'chapters-list'         // 占位 (P8)
  | 'editor'
  | 'foreshadow'
  | 'style-learning'        // FB-5 自适应文风学习

  // 作品学习（一级）
  | 'master-studies'

  // 提示词库（一级）
  | 'prompts'

  // 设置区
  | 'version-history'       // 占位 (P9)
  | 'import-doc'            // 占位 (P10)
  | 'export'                // = DataManagementPanel (export 入口)
  | 'usage-stats'           // = UsageStatsPage（AI 消耗统计）
  | 'settings'              // = AIConfigPanel
  | 'data-management'       // 数据管理

  // 状态表（A1）
  | 'state-table'

  // 物品栏（Phase 25.5.2-b）
  | 'inventory'

  // 事实库（NS-4 时序事实账本）
  | 'fact-library'

  // 故事进程年表（Phase 25.5.2-a）
  | 'story-timeline'

  // 场景考证（Phase 27.2a）
  | 'scene-verify'

  // 全局故事线（Phase B）
  | 'story-arc'

  // 世界地图（Phase 20）
  | 'world-map'
  // legacy aliases，路由仍兼容但不再出现在 sidebar
  | 'power-system'
  | 'story-core' | 'backup'

// ── 树节点 ────────────────────────────────────────────────────────────

export interface TreeLeaf {
  kind: 'leaf'
  id: SidebarModule
  label: string
  icon: ComponentType<{ className?: string }>
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
  ({ kind: 'leaf', id, label, icon })

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
      leaf('story-arc',        '故事线',   GitBranch),
      leaf('chapters-list',    '章节',     FilePen),
      leaf('foreshadow',       '伏笔',     Eye),
      leaf('style-learning',   '文风学习', Feather),
      leaf('locations',        '重要地点', MapPin),
      leaf('state-table',      '状态表',   ClipboardList),
      leaf('inventory',        '物品栏',   Package),
      leaf('fact-library',     '事实库',   Database),
      leaf('story-timeline',   '故事年表', CalendarClock),
      leaf('scene-verify',     '场景考证', ScanSearch),
    ],
  },
  // 作品学习已整合进「项目参考 → 深度分析」tab（Phase 20）
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
