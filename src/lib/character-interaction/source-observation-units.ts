import {CHAT_SOURCE_UNITS_PROMPT_V1} from './source-units-candidate'

// Source interpretation only. Visibility and discovery remain separately
// reviewed, author-confirmed permissions; the runtime never splits old facts.
const observableUnits = `整理复合事实时，区分原文已经确立、可以分别核实的背景与其中的隐藏内容、人物行为和历史原因。例如，若原文确立某件东西在一个特定容器内，可分别提出容器本身的存在与位置、其中物品的位置；看见容器不等于看见内容，更不等于知道谁放进去或为什么。每项均须有原文连续引用，不得增添材质、外观、可见性、通行或检查许可。
只有原文确实支持背景独立成立、且与另一项存在不同核实范围时才这样拆分，不机械提取所有名词、不凑事实数量。否定、可能、未来打算、比喻和人物猜测中的对象不因此成为既有实物；条件与限制保留原作用范围。不能把尚未确立的人物在场、可交谈、知情或愿意回答当作背景事实。
这些都只是待审候选。可分别观察不代表现在可见或已知，所有初始未知限制完整保留；不生成 audienceKeys、discovery 或作者授权，不替作者决定初知者或发现条件，不把隐藏内容改为公开线索。后续复核仍独立检查每项是否忠实、可单独证明及完整覆盖原文。`

export function chatSourceUnitsPromptV1(promptVersion: string): string {
  if (promptVersion === 'chat-source-units-v1') return CHAT_SOURCE_UNITS_PROMPT_V1
  if (promptVersion === 'chat-source-units-v2') return observableUnits + '\n' + CHAT_SOURCE_UNITS_PROMPT_V1
  throw new Error('未知的事实整理版本，不能自动换约')
}
