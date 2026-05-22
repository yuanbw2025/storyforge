import type { ComponentType } from 'react'
import {
  FileText, Library, Globe, Mountain, Users2, Sparkles,
  UserCircle, UsersRound, User, Footprints, Network,
  Ruler, BookOpen, ListTree, FilePen, PenTool, Eye,
  FileCog, History, Upload, Download, Settings,
  Map, ClipboardList,
} from 'lucide-react'

/**
 * Phase 4 起的侧边栏模块 ID。
 * 一个叶子 = 一个 panel。新加的占位叶子也在这里登记。
 */
export type SidebarModule =
  // 著作信息
  | 'info'
  | 'references'

  // 设定库
  | 'worldview-origin'      // 占位 (P5)
  | 'worldview-natural'     // 占位 (P5)
  | 'worldview-humanity'    // 占位 (P6)
  | 'story-design'          // = 旧 story-core
  | 'characters'            // 主要角色（暂用 CharacterPanel 全量）
  | 'characters-minor'      // 占位 (P7)
  | 'characters-npc'        // 占位 (P7)
  | 'characters-extra'      // 占位 (P7)
  | 'relations'             // 关系网

  // 创作区
  | 'rules'
  | 'outline'
  | 'detailed-outline'      // 占位 (P8)
  | 'chapters-list'         // 占位 (P8)
  | 'editor'
  | 'foreshadow'

  // 作品学习（一级）
  | 'master-studies'

  // 提示词库（一级）
  | 'prompts'

  // 设置区
  | 'version-history'       // 占位 (P9)
  | 'import-doc'            // 占位 (P10)
  | 'export'                // = DataManagementPanel (export 入口)
  | 'settings'              // = AIConfigPanel
  | 'data-management'       // 数据管理

  // 状态表（A1）
  | 'state-table'

  // 世界地图（Phase 20）
  | 'world-map'
  // legacy aliases，路由仍兼容但不再出现在 sidebar
  | 'worldview' | 'geography' | 'history' | 'power-system' | 'items'
  | 'story-core' | 'factions' | 'backup'

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
      leaf('info',       '项目概况', FileText),
      leaf('references', '项目参考', Library),
    ],
  },
  {
    sectionId: 'lib',
    label: '设定库',
    children: [
      {
        kind: 'branch',
        branchId: 'lib.worldview',
        label: '世界观',
        icon: Globe,
        children: [
          leaf('worldview-origin',   '世界起源', Sparkles),
          leaf('worldview-natural',  '自然环境', Mountain),
          leaf('worldview-humanity', '人文环境', Users2),
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
          leaf('characters',         '主要角色', UserCircle),
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
      leaf('detailed-outline', '细纲',     ListTree),
      leaf('chapters-list',    '章节',     FilePen),
      leaf('editor',           '正文',     PenTool),
      leaf('foreshadow',       '伏笔',     Eye),
      leaf('state-table',      '状态表',   ClipboardList),
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
      leaf('import-doc',       '导入',     Upload),
      leaf('export',           '导出',     Download),
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
