import { useState, type ComponentType, type ReactElement } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, Settings } from 'lucide-react'
import {
  NAV_TREE, getBranchChain,
  type SidebarModule, type TreeLeaf, type TreeNode,
} from './sidebar-tree'

// 重导出供其他组件用（保留旧 import 路径）
export type { SidebarModule }

// ── Props ─────────────────────────────────────────────────────────────
interface SidebarProps {
  active: SidebarModule
  onSelect: (module: SidebarModule) => void
  onBack: () => void
  projectName: string
  collapsed: boolean
  onToggleCollapse: () => void
  /** 需要隐藏的模块 ID 集合（如多世界关闭时隐藏 world-overview） */
  hiddenModules?: Set<SidebarModule>
}

/** legacy → new 别名映射（路由层兼容） */
const LEGACY_ALIASES: Partial<Record<SidebarModule, SidebarModule>> = {
  'story-core':      'story-design',
  'backup':          'data-management',
  'detailed-outline': 'chapters-list',
  'editor':          'chapters-list',
}

function normalize(m: SidebarModule): SidebarModule {
  return LEGACY_ALIASES[m] ?? m
}

export default function Sidebar({
  active, onSelect, onBack, projectName, collapsed, onToggleCollapse, hiddenModules,
}: SidebarProps) {
  const normActive = normalize(active)

  // 默认展开 active 所在的 branch + 全部 branch（首次打开）
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const init = new Set<string>(getBranchChain(normActive))
    // 默认全部 branch 展开（避免用户找不到）
    for (const sec of NAV_TREE) {
      if (sec.children) collectBranchIds(sec.children, init)
    }
    return init
  })

  const toggle = (branchId: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(branchId)) next.delete(branchId)
      else next.add(branchId)
      return next
    })
  }

  return (
    <aside
      className={`${collapsed ? 'w-14' : 'w-56'} bg-bg-surface border-r border-border flex flex-col h-full shrink-0 transition-[width] duration-200`}
    >
      {/* 顶部：返回 + 项目名 */}
      <div className={`border-b border-border ${collapsed ? 'p-2' : 'p-3'}`}>
        <button
          onClick={onBack}
          title="返回首页"
          className={`flex items-center gap-1.5 text-text-secondary hover:text-text-primary text-sm transition-colors ${collapsed ? 'justify-center w-full' : 'mb-2'}`}
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          {!collapsed && <span>返回首页</span>}
        </button>
        {!collapsed && (
          <h2 className="text-text-primary font-semibold text-sm truncate px-1 mt-1" title={projectName}>
            {projectName}
          </h2>
        )}
      </div>

      {/* 导航 */}
      <nav className="flex-1 py-1.5 overflow-y-auto overflow-x-hidden">
        {NAV_TREE.map(section => (
          <div key={section.sectionId} className="mb-1">
            {/* section 标题 — 当 section 本身就是个单叶子（如「提示词库」），用按钮代替标题，避免重复 */}
            {!collapsed && !section.rootLeaf ? (
              <div className="px-3 pt-2 pb-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-text-muted/60 select-none">
                  {section.label}
                </span>
              </div>
            ) : !section.rootLeaf ? (
              <div className="mx-2 my-1 border-t border-border/50" />
            ) : null}

            {/* section 直接是叶子（提示词库） */}
            {section.rootLeaf && (
              <NavLeafButton
                leaf={section.rootLeaf}
                active={normActive === section.rootLeaf.id}
                collapsed={collapsed}
                depth={0}
                onSelect={onSelect}
              />
            )}

            {/* section 有子树 */}
            {section.children?.map(child => renderNode({
              node: child,
              depth: 0,
              collapsed,
              expanded,
              normActive,
              onSelect,
              onToggle: toggle,
              hiddenModules,
            }))}
          </div>
        ))}
      </nav>

      {/* 底部：设置快捷入口 + 折叠切换 */}
      <div className="border-t border-border p-2 flex items-center justify-between">
        <button
          onClick={() => onSelect('settings')}
          title="设置"
          className={`p-1.5 rounded transition-colors ${
            normActive === 'settings'
              ? 'text-accent bg-accent/10'
              : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'
          }`}
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={onToggleCollapse}
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  )
}

// ── 渲染单个节点（递归） ───────────────────────────────────────────────

interface RenderArgs {
  node: TreeNode
  depth: number
  collapsed: boolean
  expanded: Set<string>
  normActive: SidebarModule
  onSelect: (m: SidebarModule) => void
  onToggle: (branchId: string) => void
  hiddenModules?: Set<SidebarModule>
}

function renderNode(args: RenderArgs): ReactElement | null {
  const { node, depth, collapsed, expanded, normActive, onSelect, onToggle, hiddenModules } = args
  if (node.kind === 'leaf' && hiddenModules?.has(node.id)) return null
  if (node.kind === 'leaf') {
    return (
      <NavLeafButton
        key={node.id}
        leaf={node}
        active={normActive === node.id}
        collapsed={collapsed}
        depth={depth}
        onSelect={onSelect}
      />
    )
  }
  // branch
  const isOpen = expanded.has(node.branchId)
  return (
    <div key={node.branchId}>
      {!collapsed && (
        <button
          onClick={() => onToggle(node.branchId)}
          className="w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-secondary transition-colors group"
          style={{ paddingLeft: `${12 + depth * 12}px` }}
        >
          <div className="flex items-center gap-1.5">
            {node.icon && <node.icon className="w-3 h-3" />}
            <span>{node.label}</span>
          </div>
          <ChevronDown
            className={`w-3 h-3 transition-transform ${isOpen ? '' : '-rotate-90'}`}
          />
        </button>
      )}
      {(collapsed || isOpen) && (
        <div className={!collapsed ? 'ml-2 border-l border-border/40' : ''}>
          {node.children.map(child => renderNode({ ...args, node: child, depth: depth + 1 }))}
        </div>
      )}
    </div>
  )
}

// ── 叶子按钮 ──────────────────────────────────────────────────────────

function NavLeafButton({
  leaf, active, collapsed, depth, onSelect,
}: {
  leaf: TreeLeaf
  active: boolean
  collapsed: boolean
  depth: number
  onSelect: (id: SidebarModule) => void
}) {
  const Icon: ComponentType<{ className?: string }> = leaf.icon
  return (
    <button
      onClick={() => onSelect(leaf.id)}
      title={collapsed ? leaf.label : undefined}
      className={`
        w-full flex items-center gap-2 text-sm transition-colors
        ${collapsed ? 'justify-center px-0 py-2.5' : 'pr-3 py-1.5'}
        ${active
          ? 'text-accent bg-accent/10 border-r-2 border-accent'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
        }
      `}
      style={collapsed ? undefined : { paddingLeft: `${12 + depth * 12}px` }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {!collapsed && <span className={depth > 0 ? 'text-[13px]' : ''}>{leaf.label}</span>}
    </button>
  )
}

// ── 工具 ──────────────────────────────────────────────────────────────

function collectBranchIds(nodes: TreeNode[], out: Set<string>) {
  for (const n of nodes) {
    if (n.kind === 'branch') {
      out.add(n.branchId)
      collectBranchIds(n.children, out)
    }
  }
}
