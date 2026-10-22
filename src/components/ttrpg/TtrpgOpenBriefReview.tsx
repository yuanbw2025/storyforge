import type { ProductProductionBriefV3 } from '../../lib/types'

const CONTROLLERS = { human: '真人', ai: 'AI 队友', open: '待认领' } as const
const GM_MODES = { human: '真人主持', ai: 'AI 主持', hybrid: '共同主持' } as const

/** Review the actual frozen open production brief; this view never grants start authorization. */
export default function TtrpgOpenBriefReview({ brief, started, onProduction }: {
  brief: ProductProductionBriefV3; started: boolean; onProduction?: () => void
}) {
  const open = brief.ttrpgOpen
  if (!open) return null
  const { settings } = open
  return <section className="lf-paper" data-testid="ttrpg-open-brief-review">
    <h3>开放跑团方案</h3>
    <p>实验性开放模式。先核对本版开场、角色和边界，再到制作页明确开始。</p>
    <h4>开场与玩家身份</h4>
    <p>{settings.openingSituation}</p><p>{settings.playerRole}</p>
    <p>{GM_MODES[settings.wizard.gmMode]} · 冻结世界版本 {open.worldReference.releaseVersion}</p>
    <h4>本桌席位</h4>
    <ul>{settings.wizard.seats.map(seat => <li key={seat.seatKey}>
      {seat.label} · {CONTROLLERS[seat.controller]} · {seat.characterName || '角色将在制作时确认'}
    </li>)}</ul>
    <h4>确认的运行边界</h4>
    {open.rulePack.interactionBindings?.length ? <><h4>冻结的游戏内互动</h4>
      <ul>{open.rulePack.interactionBindings.map(binding => <li key={binding.interactionKey}>
        {binding.title} · 耗时 {binding.timeCostWorldTurns} 个世界回合{binding.effectPlanRef ? ' · 制作时须补齐并复核互动后果' : ''}
      </li>)}</ul></> : null}
    <p>队友 {settings.openAuthoring.companionPolicy?.minimumCompanions}～{settings.openAuthoring.companionPolicy?.maximumCompanions} 名；
      涉及不可逆后果、花费资源、队伍关系或秘密披露时，仍需相应真人确认。</p>
    <p>每阶段最多 {settings.openAuthoring.stageClosurePolicy?.maximumWorldTurns} 个世界轮次。
      每次授权窗口最多 {settings.openAuthoring.runtimePolicy?.maximumCallsPerEpoch} 次模型调用。</p>
    {settings.openAuthoring.contextPolicy && <p>已冻结情境策略：上下文上限 {settings.openAuthoring.contextPolicy.maximumContextTokens} tokens，
      {settings.openAuthoring.contextPolicy.triggers.length} 条作者指引；中文短语匹配{settings.openAuthoring.contextPolicy.cjkTextMatching === 'explicit-phrase' ? '已明确启用' : '未启用'}。
      指引只影响表达，不自动改变规则、事实或角色知识。</p>}
    <h4>制作投入上限</h4>
    <p>最多 {brief.productionBudget.maximumModelCalls} 次文本调用，
      输入 {brief.productionBudget.maximumInputTokens.toLocaleString()}、输出 {brief.productionBudget.maximumOutputTokens.toLocaleString()} tokens；
      费用上限 {brief.productionBudget.maximumCostUsd === null ? '尚未设置金额上限' : `$${brief.productionBudget.maximumCostUsd}`}。</p>
    <h4>制作与人工确认</h4>
    <ol><li>读取所选世界资料，确认事实解释。</li><li>建立规则与角色，确认数值和控制权。</li>
      <li>制作局势、压力与素材要求。</li><li>编译战役，检查来源、规则和开放游玩结构，再预览。</li></ol>
    <p>{started ? '本版已经开始制作，方向修改请生成新的方案版本。' : '当前只是已保存的方案，尚未授权开始制作。'}</p>
    <p>改变开场、席位、预算或边界时，请回配置与确认页生成新方案；旧记录会保留。</p>
    {onProduction && <button className="lf-action lf-action-primary" onClick={onProduction}>前往制作页</button>}
  </section>
}
