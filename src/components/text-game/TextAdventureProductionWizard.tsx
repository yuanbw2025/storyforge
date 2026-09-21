import type { ProductProductionScaleV1 } from '../../lib/types'
import {
  createDefaultTextAdventureProductionBriefDraftV1,
  type TextAdventureProductionBriefDraftV1,
} from '../../lib/adventure/production-brief'

export type TextAdventureProductionWizardValueV1 = Required<TextAdventureProductionBriefDraftV1>

export function createDefaultTextAdventureProductionWizardValueV1(
  scope: ProductProductionScaleV1['scope'] = 'short-arc',
): TextAdventureProductionWizardValueV1 {
  return createDefaultTextAdventureProductionBriefDraftV1(scope) as TextAdventureProductionWizardValueV1
}

export function toTextAdventureProductionBriefDraftV1(
  value: TextAdventureProductionWizardValueV1,
): TextAdventureProductionBriefDraftV1 {
  return structuredClone(value)
}

function CountField(props: {
  label: string
  value: number
  minimum: number
  maximum: number
  onChange: (value: number) => void
}) {
  return <label className="grid gap-1 text-[10px] text-text-muted">
    {props.label}
    <input
      type="number"
      min={props.minimum}
      max={props.maximum}
      value={props.value}
      onChange={event => props.onChange(Number(event.target.value))}
      className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
    />
  </label>
}

export default function TextAdventureProductionWizard(props: {
  value: TextAdventureProductionWizardValueV1
  onChange: (value: TextAdventureProductionWizardValueV1) => void
}) {
  const update = <K extends keyof TextAdventureProductionWizardValueV1>(
    key: K,
    value: TextAdventureProductionWizardValueV1[K],
  ) => props.onChange({ ...props.value, [key]: value })

  return <section className="rounded border border-accent/25 bg-accent/5 p-4 md:col-span-2" data-testid="text-adventure-production-wizard">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-xs font-semibold text-text-primary">文字冒险产品契约</h3>
        <p className="mt-1 max-w-3xl text-[10px] leading-5 text-text-muted">先冻结空间层级、内容量、角色成长、失败推进和产品边界。主协调 Agent 会据此拆分世界架构、主线、支线、区域事件、系统与美术需求。</p>
      </div>
      <label className="flex items-center gap-2 text-[10px] text-text-muted">
        <span>配置深度</span>
        <select value={props.value.creationMode} onChange={event => update('creationMode', event.target.value as 'quick' | 'advanced')} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary">
          <option value="quick">快速向导</option>
          <option value="advanced">高级控制</option>
        </select>
      </label>
    </div>

    <div className="mt-4 grid gap-3 md:grid-cols-3">
      <label className="grid gap-1 text-[10px] text-text-muted">来源处理
        <select value={props.value.sourceTreatment} onChange={event => update('sourceTreatment', event.target.value as TextAdventureProductionWizardValueV1['sourceTreatment'])} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary">
          <option value="expand-sparse">稀疏来源先扩充</option>
          <option value="adapt-rich">丰富来源保留深度</option>
          <option value="author-outline">按作者大纲编排</option>
        </select>
      </label>
      <label className="grid gap-1 text-[10px] text-text-muted">叙事视角
        <select value={props.value.perspective} onChange={event => update('perspective', event.target.value as TextAdventureProductionWizardValueV1['perspective'])} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary">
          <option value="second-person">第二人称</option>
          <option value="first-person">第一人称</option>
        </select>
      </label>
      <label className="grid gap-1 text-[10px] text-text-muted">后果透明度
        <select value={props.value.consequenceVisibility} onChange={event => update('consequenceVisibility', event.target.value as TextAdventureProductionWizardValueV1['consequenceVisibility'])} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary">
          <option value="explicit">明确展示</option>
          <option value="partial">部分展示</option>
          <option value="hidden">隐藏数值</option>
        </select>
      </label>
    </div>

    {props.value.creationMode === 'advanced' && <div className="mt-4 grid gap-3 md:grid-cols-4">
      <CountField label="大区域" value={props.value.targetRegionCount} minimum={1} maximum={8} onChange={value => update('targetRegionCount', value)} />
      <CountField label="区域" value={props.value.targetAreaCount} minimum={1} maximum={24} onChange={value => update('targetAreaCount', value)} />
      <CountField label="地点" value={props.value.targetLocationCount} minimum={2} maximum={48} onChange={value => update('targetLocationCount', value)} />
      <CountField label="场景" value={props.value.targetSceneCount} minimum={3} maximum={80} onChange={value => update('targetSceneCount', value)} />
      <CountField label="支线任务" value={props.value.targetSideQuestCount} minimum={0} maximum={16} onChange={value => update('targetSideQuestCount', value)} />
      <CountField label="区域/随机事件" value={props.value.targetAmbientEventCount} minimum={1} maximum={32} onChange={value => update('targetAmbientEventCount', value)} />
      <CountField label="最低有效路线" value={props.value.minimumDistinctRoutes} minimum={1} maximum={8} onChange={value => update('minimumDistinctRoutes', value)} />
      <label className="grid gap-1 text-[10px] text-text-muted">选择密度
        <select value={props.value.choiceDensity} onChange={event => update('choiceDensity', event.target.value as TextAdventureProductionWizardValueV1['choiceDensity'])} className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary">
          <option value="focused">聚焦主干</option>
          <option value="balanced">平衡</option>
          <option value="dense">密集选择</option>
        </select>
      </label>
    </div>}

    <label className="mt-4 grid gap-1 text-[10px] text-text-muted">情绪体验目标
      <textarea rows={3} maxLength={1000} value={props.value.emotionalTarget} onChange={event => update('emotionalTarget', event.target.value)} className="rounded border border-border bg-bg-base p-3 text-xs text-text-primary" />
    </label>
    <div className="mt-4 rounded border border-border bg-bg-base p-3 text-[10px] leading-5 text-text-muted">
      <strong className="block text-xs text-text-primary">固定通用系统</strong>
      属性、技能、生命/法力/体力、经验与技能点、货币、世界时间、背包、装备槽、任务、storylet、存档/分支/重放和因果结局均纳入第一版。调查证据盘、法庭、生存、政治、恋爱阶段等专用机制不进入通用内核。
    </div>
    <label className="mt-4 flex items-start gap-2 rounded border border-accent/30 bg-accent/5 p-3 text-[10px] leading-5 text-text-muted">
      <input type="checkbox" checked={props.value.confirmAll} onChange={event => update('confirmAll', event.target.checked)} className="mt-1" />
      <span><strong className="block text-xs text-text-primary">确认文字冒险四项边界</strong>冻结世界只读；确定性规则与事件日志拥有运行状态权威；通用内核不混入专用玩法；产品媒资权利、替换和发布生命周期由本产品负责。</span>
    </label>
  </section>
}
