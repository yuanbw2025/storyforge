import type { TtrpgOpenAuthoringDesignPatchV1, TtrpgOpenAuthoringDesignSectionV1 as Section } from '../../lib/ttrpg/open-authoring-design'

export const OPEN_DESIGN_SECTION_LABELS: Record<Section, string> = {
  situationTemplates: '局势与动机', openingSituationKeys: '开局局势', effectPlanTemplates: '后果与代价',
  pressure: '压力与威胁', dynamicEntityTemplates: '即兴实体', factProposals: '新增世界事实',
}

/** Readable proposal review; the full typed patch remains available for details.
 * This view does not turn structure or provenance into semantic acceptance. */
export default function TtrpgOpenDesignComparison({ patch }: { patch: TtrpgOpenAuthoringDesignPatchV1 }) {
  return <>
    {patch.situationTemplates?.map(item => <section key={item.templateKey}>
      <h6>{item.title}</h6><p>驱动目标：{item.driverGoal}</p>
      <p>介入方式：{item.interventionPoints.map(point => point.affordanceHint).join('；') || '尚无'}</p>
      <p>不介入的变化：{item.noInterventionOutcome.afterWorldTurns} 轮后，{item.noInterventionOutcome.description}</p>
      <p>障碍 {item.obstacles.length} 项，后果 {item.consequences.length} 项，线索 {item.evidence.length} 项。</p>
    </section>)}
    {patch.openingSituationKeys && <p>开局局势：{patch.openingSituationKeys.join('、') || '尚无'}</p>}
    {patch.pressure && <section><h6>压力与威胁</h6>
      {patch.pressure.clocks.map(item => <p key={item.clockKey}>{item.title}：上限 {item.maximum}；
        检定失败推进 {item.autoAdvance.onFailedCheck}，空闲推进 {item.autoAdvance.onIdleWorldTurns}。</p>)}
      {patch.pressure.fronts.map(item => <p key={item.frontKey}>{item.title}：{item.escalationStages.length} 次升级，{item.telegraph.length} 条提前征兆。</p>)}
      {!patch.pressure.clocks.length && !patch.pressure.fronts.length && <p>本方向未新增压力。</p>}
    </section>}
    {patch.effectPlanTemplates?.map(item => <p key={item.planKey}>后果 {item.planKey}：{item.reason}（{item.effects.length} 项效果，{item.alternatives.length} 个替代选择）</p>)}
    {patch.dynamicEntityTemplates?.map(item => <p key={item.templateKey}>即兴实体 {item.templateKey}：{item.description}；最多 {item.maximumInstances} 个。</p>)}
    {patch.factProposals && <p>新增世界事实 {patch.factProposals.length} 条，须逐条核对。来源核验不能替代内容判断。</p>}
    <details><summary>查看完整分区、条件与来源</summary><pre className="ttrpg-design-json">{JSON.stringify(patch, null, 2)}</pre></details>
  </>
}
