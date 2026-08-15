import type { AIConfigPreset } from '../../lib/types'
import {
  AGENT_ROLE_TASK_KINDS,
  GENERAL_AI_TASK_KINDS,
  type AITaskKind,
  type AITaskRoutes,
} from '../../lib/ai/task-routing'
import {
  AGENT_CONTEXT_TASK_KINDS,
  type AgentContextProfile,
  type AgentContextProfiles,
  type AgentContextTaskKind,
} from '../../lib/agent/context-policy'
import type { AgentTeamBudgetProfile } from '../../lib/agent/team-budget'
import type { CreativeQualityModeV1 } from '../../lib/agent/creative-reliability'

const TASK_ROUTE_META: Record<AITaskKind, { label: string; description: string }> = {
  creation: { label: '创作生成', description: '正文、大纲、细纲、世界观与角色生成' },
  extraction: { label: '结构提取', description: '状态、事实、物品、关系、词条与导入解析' },
  analysis: { label: '分析总结', description: '参考资料、摘要、文风学习与检索分析' },
  review: { label: '审查校验', description: '章节审校、一致性检查、场景与历史考证' },
  'agent-orchestrator': { label: '主 Agent 编排', description: '理解目标、拆分任务和安排依赖；不直接生成作品' },
  'agent-world-origin': { label: '世界领域 Agent', description: '主 Agent 幕后的世界来源与文明起点生成' },
  'agent-character': { label: '角色领域 Agent', description: '主 Agent 幕后的新角色设计' },
  'agent-inspiration': { label: '灵感领域 Agent', description: '主 Agent 幕后的项目灵感反推' },
  'agent-outline': { label: '大纲领域 Agent', description: '主 Agent 幕后的卷纲与章纲生成' },
  'agent-prose': { label: '正文领域 Agent', description: '主 Agent 幕后的空白章生成与显式续写' },
}

interface Props {
  presets: AIConfigPreset[]
  routes: AITaskRoutes
  contextProfiles: AgentContextProfiles
  teamBudgetProfile: AgentTeamBudgetProfile
  creativeQualityMode: CreativeQualityModeV1
  onSetRoute: (taskKind: AITaskKind, presetId: string | null) => void
  onSetContextProfile: (taskKind: AgentContextTaskKind, profile: AgentContextProfile) => void
  onSetTeamBudgetProfile: (profile: AgentTeamBudgetProfile) => void
  onSetCreativeQualityMode: (mode: CreativeQualityModeV1) => void
}

const CONTEXT_PROFILE_META: Record<AgentContextProfile, { label: string; description: string }> = {
  lean: { label: '精简', description: '约 45% 登记源预算，优先节省输入' },
  balanced: { label: '均衡（推荐）', description: '约 72% 登记源预算，兼顾质量与成本' },
  full: { label: '完整', description: '沿用登记源完整预算，适合高风险长上下文任务' },
}

const TEAM_BUDGET_META: Record<AgentTeamBudgetProfile, { label: string; description: string }> = {
  economy: { label: '节省', description: '每轮最多约 80K tokens' },
  balanced: { label: '均衡（推荐）', description: '每轮最多约 160K tokens' },
  expanded: { label: '充分', description: '每轮最多约 240K tokens' },
}

const CREATIVE_QUALITY_META: Record<CreativeQualityModeV1, { label: string; description: string }> = {
  economy: { label: '节省', description: '一次生成，只做免费本地校验' },
  balanced: { label: '均衡（推荐）', description: '必要时最多一次定向修复' },
  refine: { label: '精修', description: '自动调用仍为 1+1；语义评审由作者另行触发' },
}

function isContextTaskKind(taskKind: AITaskKind): taskKind is AgentContextTaskKind {
  return AGENT_CONTEXT_TASK_KINDS.includes(taskKind as AgentContextTaskKind)
}

export default function AITaskRoutingSection({
  presets,
  routes,
  contextProfiles,
  teamBudgetProfile,
  creativeQualityMode,
  onSetRoute,
  onSetContextProfile,
  onSetTeamBudgetProfile,
  onSetCreativeQualityMode,
}: Props) {
  const renderRoutes = (taskKinds: readonly AITaskKind[]) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {taskKinds.map(taskKind => {
        const selectedPreset = presets.find(preset => preset.id === routes[taskKind])
        const routeMeta = TASK_ROUTE_META[taskKind]
        const contextTask = isContextTaskKind(taskKind)
        return (
          <label key={taskKind} className="block rounded border border-border bg-bg-base p-2.5">
            <span className="block text-xs font-medium text-text-primary">{routeMeta.label}</span>
            <span className="mb-2 block min-h-8 text-[11px] leading-4 text-text-muted">{routeMeta.description}</span>
            <select value={selectedPreset?.id ?? ''}
              onChange={event => onSetRoute(taskKind, event.target.value || null)}
              aria-label={`${routeMeta.label}模型预设`}
              className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none">
              <option value="">使用当前全局模型</option>
              {presets.map(preset => (
                <option key={preset.id} value={preset.id}>{preset.name} · {preset.config.provider}/{preset.config.model}</option>
              ))}
            </select>
            {contextTask && (
              <>
                <span className="mb-1 mt-2 block text-[10px] text-text-muted">上下文输入档位</span>
                <select
                  value={contextProfiles[taskKind]}
                  onChange={event => onSetContextProfile(taskKind, event.target.value as AgentContextProfile)}
                  aria-label={`${routeMeta.label}上下文输入档位`}
                  className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                >
                  {(Object.entries(CONTEXT_PROFILE_META) as Array<[AgentContextProfile, typeof CONTEXT_PROFILE_META[AgentContextProfile]]>)
                    .map(([profile, meta]) => (
                      <option key={profile} value={profile}>{meta.label} · {meta.description}</option>
                    ))}
                </select>
              </>
            )}
          </label>
        )
      })}
    </div>
  )

  return (
    <div className="mb-4 border-b border-border/50 pb-4">
      <div className="mb-2">
        <h4 className="text-sm font-medium text-text-secondary">任务模型路由</h4>
        <p className="mt-1 text-[11px] text-text-muted">
          按任务自动使用已保存预设；未绑定、预设被删除或专用预设缺少 API Key 时，回退到当前全局模型。云端预设会接收对应任务的提示词与上下文。
        </p>
      </div>
      {renderRoutes(GENERAL_AI_TASK_KINDS)}
      <div className="mb-2 mt-4">
        <h5 className="text-xs font-medium text-text-secondary">主 Agent 团队角色</h5>
        <p className="mt-1 text-[11px] text-text-muted">
          只影响主 Agent 幕后执行；手工面板仍使用上方四类路由。未绑定的角色沿用当前全局模型。
          五个领域还可独立收窄登记源预算；“完整”保持原上下文上限。
        </p>
      </div>
      <label className="mb-2 block rounded border border-border bg-bg-base p-2.5">
        <span className="block text-xs font-medium text-text-primary">创作结果模式</span>
        <span className="mt-0.5 block text-[10px] text-text-muted">
          控制单个创作产物的自动调用；任何模式都禁止隐藏第三次调用和自动切换服务商。
        </span>
        <select
          value={creativeQualityMode}
          onChange={event => onSetCreativeQualityMode(event.target.value as CreativeQualityModeV1)}
          aria-label="创作结果模式"
          className="mt-2 w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
        >
          {(Object.entries(CREATIVE_QUALITY_META) as Array<[CreativeQualityModeV1, typeof CREATIVE_QUALITY_META[CreativeQualityModeV1]]>)
            .map(([mode, meta]) => (
              <option key={mode} value={mode}>{meta.label} · {meta.description}</option>
            ))}
        </select>
      </label>
      <label className="mb-2 block rounded border border-border bg-bg-base p-2.5">
        <span className="block text-xs font-medium text-text-primary">本轮团队总预算</span>
        <span className="mt-0.5 block text-[10px] text-text-muted">
          覆盖主 Agent、领域生成和一次受控 Canon 打回；达到上限会在下一次调用前停止。
        </span>
        <select
          value={teamBudgetProfile}
          onChange={event => onSetTeamBudgetProfile(event.target.value as AgentTeamBudgetProfile)}
          aria-label="主 Agent 团队总预算"
          className="mt-2 w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
        >
          {(Object.entries(TEAM_BUDGET_META) as Array<[AgentTeamBudgetProfile, typeof TEAM_BUDGET_META[AgentTeamBudgetProfile]]>)
            .map(([profile, meta]) => (
              <option key={profile} value={profile}>{meta.label} · {meta.description}</option>
            ))}
        </select>
      </label>
      {renderRoutes(AGENT_ROLE_TASK_KINDS)}
      {presets.length === 0 && (
        <p className="mt-2 text-[11px] text-amber-400">先保存至少一个配置预设，才能给任务绑定专用模型。</p>
      )}
    </div>
  )
}
