import { MapPinned, Sparkles } from 'lucide-react'
import type {
  TextOpenWorldRuntimeQuestPackagingPresentationV1,
  TextOpenWorldRuntimeQuestPackagingSlotV1,
} from '../../lib/open-world/runtime-quest-packaging'

export interface TextOpenWorldQuestPackagingPanelProps {
  slot: TextOpenWorldRuntimeQuestPackagingSlotV1
  presentation: TextOpenWorldRuntimeQuestPackagingPresentationV1 | null
  completed: boolean
  busy: boolean
  issue: string | null
  onGenerate(questInstanceKey: string): void
}

export default function TextOpenWorldQuestPackagingPanel(
  props: TextOpenWorldQuestPackagingPanelProps,
) {
  const presentation = props.presentation?.questInstanceKey === props.slot.questInstanceKey
    && props.presentation.templateKey === props.slot.templateKey
    && props.presentation.regionKey === props.slot.regionKey
    ? props.presentation
    : null
  const canGenerate = props.slot.generation.available && !props.busy
  return <section
    className="open-world-runtime-quest-packaging"
    data-testid="text-open-world-runtime-quest-packaging"
    data-packaging-state={props.busy ? 'generating' : presentation ? 'generated' : props.issue ? 'fallback' : 'ready'}
    aria-busy={props.busy || undefined}
  >
    <header>
      <span><MapPinned aria-hidden="true" /><strong>地区任务演绎</strong></span>
      <small>AI只改文案，不改任务规则</small>
    </header>
    {presentation ? <div className="open-world-runtime-quest-packaging-copy">
      <small>{props.slot.regionTitle} · AI只读候选</small>
      <h3>{presentation.title}</h3>
      <p>{presentation.summary}</p>
      <p>{presentation.introText}</p>
      <div>
        <strong>叙事目标</strong>
        <p>{presentation.objectiveText}</p>
      </div>
      {props.completed && <div data-testid="text-open-world-runtime-quest-packaging-resolution">
        <strong>旅程收束</strong>
        <p>{presentation.resolutionText}</p>
      </div>}
      <small>正式目标、奖励、期限与状态仍以下方任务规则和系统回执为准。</small>
    </div> : <p>
      当前显示的是{props.slot.fallback.source === 'frozen-release-variant' ? '发布时预制变体' : '冻结任务定义'}。
      你可以让AI依据这次正式发牌的地区、模板与角色成长补充一次不改规则的故事包装。
    </p>}
    {props.issue && <p role="status" className="open-world-runtime-quest-packaging-issue">
      AI包装当前不可用；预制任务文案、任务状态和继续游玩不受影响。
    </p>}
    {!props.slot.generation.available && <p role="status" className="open-world-runtime-quest-packaging-issue">
      你已经离开任务发放地区；本次继续使用预制文案，回到该地区后可再生成。
    </p>}
    <button
      type="button"
      disabled={!canGenerate}
      onClick={() => props.onGenerate(props.slot.questInstanceKey)}
    >
      <Sparkles aria-hidden="true" />
      {props.busy ? '正在核对任务槽并包装…' : presentation ? '重新生成地区文案' : props.issue ? '重新尝试AI包装' : 'AI包装这个地区任务'}
    </button>
  </section>
}
