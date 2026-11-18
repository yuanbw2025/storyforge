import './ai-task-routing.css'
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
  'agent-orchestrator': { label: '主 Agent 编排', description: '拆分任务、安排依赖；不直接生成作品' },
  'agent-world-origin': { label: '世界领域 Agent', description: '世界来源与文明起点生成' },
  'agent-character': { label: '角色领域 Agent', description: '新角色设计' },
  'agent-inspiration': { label: '灵感领域 Agent', description: '项目灵感反推' },
  'agent-outline': { label: '大纲领域 Agent', description: '卷纲与章纲生成' },
  'agent-prose': { label: '正文领域 Agent', description: '空白章生成与显式续写' },
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
  const renderModelSelect = (taskKind: AITaskKind) => {
    const selectedPreset = presets.find(preset => preset.id === routes[taskKind])
    return (
      <select value={selectedPreset?.id ?? ''}
        onChange={event => onSetRoute(taskKind, event.target.value || null)}
        aria-label={`${TASK_ROUTE_META[taskKind].label}模型预设`}
        className="ai-route-select rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none">
        <option value="">使用当前全局模型</option>
        {presets.map(preset => (
          <option key={preset.id} value={preset.id}>{preset.name} · {preset.config.provider}/{preset.config.model}</option>
        ))}
      </select>
    )
  }

  const renderGeneralRoutes = () => (
    <div className="ai-routing-grid ai-routing-general">
      {GENERAL_AI_TASK_KINDS.map(taskKind => (
        <label key={taskKind} className="ai-route-card rounded border border-border bg-bg-base p-2.5">
          <span className="block text-sm font-medium text-text-primary">{TASK_ROUTE_META[taskKind].label}</span>
          <span className="block text-[13px] leading-4 text-text-muted">{TASK_ROUTE_META[taskKind].description}</span>
          {renderModelSelect(taskKind)}
        </label>
      ))}
    </div>
  )

  return (
    <div className="ai-task-routing mb-4 border-b border-border/50 pb-4">
      <div className="mb-2">
        <h4 className="text-sm font-medium text-text-secondary">任务模型路由</h4>
        <p className="mt-1 text-[13px] text-text-muted">
          按任务自动使用已保存预设；未绑定、预设被删除或专用预设缺少 API Key 时，回退到当前全局模型。Codex 预设无需 Key；其登录或连接失败会停止，不会回退到付费 API。云端预设会接收对应任务的提示词与上下文。
        </p>
      </div>
      {renderGeneralRoutes()}
      <div className="mb-2 mt-4">
        <h5 className="text-sm font-medium text-text-secondary">主 Agent 团队角色</h5>
        <p className="mt-1 text-[13px] text-text-muted">
          只影响主 Agent 幕后执行；手工面板仍使用上方四类路由。未绑定的角色沿用当前全局模型。
          五个领域可独立设置输入预算：精简约 45%、均衡约 72%、完整 100%（登记源原上限）。
        </p>
      </div>
      <section className="ai-team-strategy rounded-lg border border-border bg-bg-base" aria-label="团队策略">
        <h6 className="text-xs font-medium text-text-secondary">团队策略</h6>
        <div className="ai-team-controls">
          <label className="ai-team-control">
            <span className="block text-sm font-medium text-text-primary">创作结果模式</span>
            <select
              value={creativeQualityMode}
              onChange={event => onSetCreativeQualityMode(event.target.value as CreativeQualityModeV1)}
              aria-label="创作结果模式"
              className="ai-route-select mt-2 w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              {(Object.entries(CREATIVE_QUALITY_META) as Array<[CreativeQualityModeV1, typeof CREATIVE_QUALITY_META[CreativeQualityModeV1]]>)
                .map(([mode, meta]) => (
                  <option key={mode} value={mode}>{meta.label}</option>
                ))}
            </select>
            <span className="ai-team-selected-detail text-text-muted">{CREATIVE_QUALITY_META[creativeQualityMode].description}；不自动切换服务商。</span>
          </label>
          <label className="ai-team-control">
            <span className="block text-sm font-medium text-text-primary">本轮团队总预算</span>
            <select
              value={teamBudgetProfile}
              onChange={event => onSetTeamBudgetProfile(event.target.value as AgentTeamBudgetProfile)}
              aria-label="主 Agent 团队总预算"
              className="ai-route-select mt-2 w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              {(Object.entries(TEAM_BUDGET_META) as Array<[AgentTeamBudgetProfile, typeof TEAM_BUDGET_META[AgentTeamBudgetProfile]]>)
                .map(([profile, meta]) => (
                  <option key={profile} value={profile}>{meta.label}</option>
                ))}
            </select>
            <span className="ai-team-selected-detail text-text-muted">{TEAM_BUDGET_META[teamBudgetProfile].description}；覆盖编排、生成与一次 Canon 打回，到限后停止调用。</span>
          </label>
        </div>
      </section>
      <div className="ai-team-roles rounded-lg border border-border" role="group" aria-label="团队角色配置">
        <div className="ai-team-role-head text-xs text-text-muted" aria-hidden="true">
          <span>角色</span><span>模型预设</span><span>上下文输入档位</span>
        </div>
        {AGENT_ROLE_TASK_KINDS.map(taskKind => {
          const selectedPreset = presets.find(preset => preset.id === routes[taskKind])
          const contextTask = isContextTaskKind(taskKind)
          return <div key={taskKind} className="ai-team-role-row">
            <div className="ai-team-role-info">
              <span className="block text-sm font-medium text-text-primary">{TASK_ROUTE_META[taskKind].label}</span>
              <span className="ai-team-description text-text-muted">{TASK_ROUTE_META[taskKind].description}</span>
            </div>
            <label className="ai-team-role-model">
              <span className="ai-team-mobile-label text-xs text-text-muted">模型预设</span>
              {renderModelSelect(taskKind)}
              {selectedPreset && <span className="ai-team-description text-text-muted">
                {selectedPreset.name} · {selectedPreset.config.provider}/{selectedPreset.config.model}
              </span>}
            </label>
            {contextTask ? <label className="ai-team-role-context">
              <span className="ai-team-mobile-label text-xs text-text-muted">上下文输入档位</span>
              <select value={contextProfiles[taskKind]}
                title={CONTEXT_PROFILE_META[contextProfiles[taskKind]].description}
                onChange={event => onSetContextProfile(taskKind, event.target.value as AgentContextProfile)}
                aria-label={`${TASK_ROUTE_META[taskKind].label}上下文输入档位`}
                className="ai-route-select rounded border border-border bg-bg-surface text-text-primary focus:border-accent focus:outline-none">
                {(Object.entries(CONTEXT_PROFILE_META) as Array<[AgentContextProfile, typeof CONTEXT_PROFILE_META[AgentContextProfile]]>)
                  .map(([profile, meta]) => <option key={profile} value={profile}>{meta.label}</option>)}
              </select>
            </label> : <div className="ai-team-description ai-team-orchestrator-note text-text-muted">仅编排任务，无领域输入档位</div>}
          </div>
        })}
      </div>
      {presets.length === 0 && (
        <p className="mt-2 text-[13px] text-amber-400">先保存至少一个配置预设，才能给任务绑定专用模型。</p>
      )}
    </div>
  )
}
