import type { ChatMessage } from '../types'
import { parseStructuredOutputV1 } from '../agent/structured-output-pipeline'

export const INSPIRATION_PREPARATION_MODES = ['organize', 'compare', 'deepen'] as const
export type InspirationPreparationMode = typeof INSPIRATION_PREPARATION_MODES[number]
export const INSPIRATION_PREPARATION_LABELS: Record<InspirationPreparationMode, string> = {
  organize: '轻量整理', compare: '方向比较', deepen: '局部深化',
}
export interface InspirationPreparationResult {
  summary: string
  authorMaterial: string
  proposals: { title: string; content: string }[]
  openQuestions: string[]
}
export function isInspirationPreparationMode(mode: unknown): mode is InspirationPreparationMode {
  return INSPIRATION_PREPARATION_MODES.includes(mode as InspirationPreparationMode)
}
export function inspirationPreparationModeFromRequest(request: string): InspirationPreparationMode {
  const mode = /灵感准备任务\s*=\s*(organize|compare|deepen)\b/.exec(request)?.[1]
  if (!isInspirationPreparationMode(mode)) throw new Error('灵感准备缺少明确动作，请选择整理、比较或深化。')
  return mode
}
export function parseInspirationPreparationDraft(raw: string, mode: InspirationPreparationMode): InspirationPreparationResult {
  return parseStructuredOutputV1({ raw, contract: { version: 1, schemaId: `inspiration-preparation-${mode}.v1`, target: 'inspirationWorkspaces.versions', root: 'object', maxChars: 40000, allowedRootFields: ['summary', 'authorMaterial', 'proposals', 'openQuestions'], requiredRootFields: ['summary', 'authorMaterial', 'proposals', 'openQuestions'] }, parse: value => {
    const source = value as Record<string, unknown>
    const readText = (text: unknown, max: number) => {
      if (typeof text !== 'string' || !text.trim() || text.length > max) throw new Error('灵感准备文本为空或超长。')
      return text.trim()
    }
    if (!Array.isArray(source.proposals) || source.proposals.length > 4
      || (mode === 'compare' && source.proposals.length < 2)
      || (mode === 'deepen' && source.proposals.length < 1)
      || (mode === 'organize' && source.proposals.length > 1)) throw new Error('方向比较需要2—4个方向，局部深化需要1—4个同方向的深化要点，轻量整理至多1项提议。')
    const proposals = source.proposals.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'content,title') throw new Error('提议只能包含title和content。')
      return { title: readText(item.title, 120), content: readText(item.content, 16000) }
    })
    if (!Array.isArray(source.openQuestions) || source.openQuestions.length > 6) throw new Error('待决定问题至多6项。')
    return { summary: readText(source.summary, 8000), authorMaterial: readText(source.authorMaterial, 8000), proposals, openQuestions: source.openQuestions.map(q => readText(q, 600)) }
  } })
}
export function buildInspirationPreparationPrompt(mode: InspirationPreparationMode, context: string, request: string): ChatMessage[] {
  const method = {
    organize: '只整理作者已有兴趣、画面、人物、关系与可相连的碎片，保留具体性。可以提出一项最值得继续探索的联系，也可以不加提议。不补完整世界史、人物卡、主线和结局。',
    compare: '作者方向未定：提出2—4个实质不同、可选择组合的方向。差别应在人物处境、持续内容来源、阅读体验或叙述重心，不能只换背景名词。各提议给具体内容与取舍，帮助作者判断是否愿意写；不要自动选定某个方向。',
    deepen: '作者已定方向：只沿本轮选中的问题提出一份具体深化，可以用1—4个相互兼容的要点组成；这些是同一方向的细部，不是重新选方向。深入已有联系、活动和体验，说明能继续写什么，保留未定部分；不能把外观变化推成材料凭空增加、功能变化或额外能力，新增前提必须标明是提议，不靠它偷偷解决既定难题。不要重新给三套互斥方案，不顺势重写全书结构。',
  }[mode]
  return [{ role: 'system', content: `你是StoryForge长篇创作准备助手。本轮为${INSPIRATION_PREPARATION_LABELS[mode]}，产物是可审阅的准备材料，不是已确认世界或人物事实。
${method}
来源标签author是作者原创，reference是参考启发，research是研究材料，other来源未明。珍惜原创姓名、物件、意象与表达，不统一去专名。参考只提炼方法，不把原作专名情节当成本作事实；研究材料与已核实事实分开，无检索证据不能冒称考证。来源不明时说明不确定，不能擅删作者个性。作者明确给出的事实应保留，不要改成“可能只是想象”再要求作者重选。
温暖、幽默、宁静、美感、归属、探索都有价值；不要默认复仇、系统升级或幕后阴谋。故事萌芽只连接具体情境与可能变化，不强造完整人物、卷章纲或终局。作者可从世界、人物、片段或已有稿任一起步，不要求先填完准备表。
summary交代本轮整理或判断；authorMaterial明确作者已给且应保留的内容；proposals是本次新增提议，不能冒充原素材；openQuestions只保留真正影响下一步的决定，不用长问题清单代替创作。
只输出严格JSON，不带代码块、解释或额外键：{"summary":"本轮整理","authorMaterial":"作者已有内容","proposals":[{"title":"提议名","content":"具体内容与取舍"}],"openQuestions":[]}。按本轮动作决定proposals数量。` }, { role: 'user', content: `【作者本轮要求】\n${request}\n\n【登记来源中的所选素材与同类历史版本】\n${context}` }]
}
