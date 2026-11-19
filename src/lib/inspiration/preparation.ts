import type { ChatMessage } from '../types'
import { parseStructuredOutputV1 } from '../agent/structured-output-pipeline'

export const INSPIRATION_PREPARATION_MODES = ['organize', 'compare', 'deepen', 'position-open', 'position-defined'] as const
export type InspirationPreparationMode = typeof INSPIRATION_PREPARATION_MODES[number]
export const INSPIRATION_PREPARATION_LABELS: Record<InspirationPreparationMode, string> = {
  organize: '轻量整理', compare: '方向比较', deepen: '局部深化',
  'position-open': '创作定位·方向未定', 'position-defined': '创作定位·方向明确',
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
  const mode = /灵感准备任务\s*=\s*(organize|compare|deepen|position-open|position-defined)\b/.exec(request)?.[1]
  if (!isInspirationPreparationMode(mode)) throw new Error('灵感准备缺少明确动作，请选择整理、比较、深化或创作定位。')
  return mode
}
/** The last explicit selection is the author's current choice. */
export function inspirationDirectionIndexFromRequest(request: string): number | undefined {
  const matches = [...request.matchAll(/灵感方向选择\s*=\s*([^\s。；，,;]*)/g)]
  const match = matches[matches.length - 1]
  if (!match) return undefined
  if (!/^[1-4]$/.test(match[1])) throw new Error('方向序号须为1—4的整数，请重新选择明确的比较方向。')
  return Number(match[1])
}
export function parseInspirationPreparationDraft(raw: string, mode: InspirationPreparationMode): InspirationPreparationResult {
  return parseStructuredOutputV1({ raw, contract: { version: 1, schemaId: `inspiration-preparation-${mode}.v1`, target: 'inspirationWorkspaces.versions', root: 'object', maxChars: 40000, allowedRootFields: ['summary', 'authorMaterial', 'proposals', 'openQuestions'], requiredRootFields: ['summary', 'authorMaterial', 'proposals', 'openQuestions'] }, parse: value => {
    const source = value as Record<string, unknown>
    const readText = (text: unknown, max: number) => {
      if (typeof text !== 'string' || !text.trim() || text.length > max) throw new Error('灵感准备文本为空或超长。')
      return text.trim()
    }
    if (!Array.isArray(source.proposals)) throw new Error('准备提议必须是数组。')
    const count = source.proposals.length
    const min = mode === 'compare' || mode === 'position-open' ? 2 : mode === 'organize' ? 0 : 1
    const max = mode === 'organize' || mode === 'position-defined' ? 1 : 4
    if (count < min || count > max) throw new Error('方向未定需2—4个选择，明确定位需一份方向稿，深化需1—4个兼容要点，整理至多1项提议。')
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
    'position-open': '本轮只做创作定位：作者尚未确定方向，比较2—4个实质不同、可以选择组合的定位。每项说明关注谁/什么处境、主要阅读体验与承诺、面向何种兴趣的读者、篇幅/是否连载的取舍、差异与持续内容来源，最后给一个短故事萌芽。未知项可以暂留，不替作者选定，也不把题材标签换名当实质差异。',
    'position-defined': '本轮只做创作定位：作者方向已经明确，只交一份方向稿，不再强制给互斥方案。proposals必须恰好只有一个对象；以下各维度是这一个content里的小段，不能拆成七项proposals。说明关注谁/什么处境、主要阅读体验与承诺、面向何种兴趣的读者、篇幅/是否连载的取舍、差异与持续内容来源，最后给一个短故事萌芽。明确保留作者选择；可指出需要决定或值得试写之处，作者也有权显式改方向。',
    deepen: '作者已定方向：只沿本轮选中的问题提出一份具体深化，可以用1—4个相互兼容的要点组成；这些是同一方向的细部，不是重新选方向。深入已有联系、活动和体验，说明能继续写什么，保留未定部分；不能把外观变化推成材料凭空增加、功能变化或额外能力，新增前提必须标明是提议，不靠它偷偷解决既定难题。不要重新给三套互斥方案，不顺势重写全书结构。',
  }[mode]
  return [{ role: 'system', content: `你是StoryForge长篇创作准备助手。本轮为${INSPIRATION_PREPARATION_LABELS[mode]}，产物是可审阅的准备材料，不是已确认世界或人物事实。
${method}
来源标签author是作者原创，reference是参考启发，research是研究材料，other来源未明。珍惜原创姓名、物件、意象与表达，不统一去专名。参考只提炼方法，不把原作专名情节当成本作事实；研究材料与已核实事实分开，无检索证据不能冒称考证。来源不明时说明不确定，不能擅删作者个性。作者明确给出的事实应保留，不要改成“可能只是想象”再要求作者重选。
温暖、幽默、宁静、美感、归属、探索都有价值；不要默认复仇、系统升级或幕后阴谋。故事萌芽只连接具体情境与可能变化，不强造完整人物、卷章纲或终局。作者可从世界、人物、片段或已有稿任一起步，不要求先填完准备表。
各方向都必须保留作者明确给定的开放时段、频率、数量和能力边界；不能为显得内容充足就增加次数、改作用条件或把组合选择写成既定事实。
定位中的读者指兴趣与期待，不凭题材臆测年龄、性别或市场规模；无实际来源不报市场、平台、热门榜或收益数据，也不宣称必然受欢迎。阅读承诺可以组合，不强制所有作品只有一种体验；短篇/长篇与连载/一次成稿是不同选择，持续内容指本作从开头到收束能生长出哪些不同内容，完整稿也需要，不是只有改为连载才需要；它来自不同人物、活动、关系或环境变化，不等于无限升级。简短萌芽只交接情境和可能变化，不改写完整人物、卷章纲、结局。
summary交代本轮整理或判断；authorMaterial明确作者已给且应保留的内容；proposals是本次新增提议，不能冒充原素材；openQuestions只保留真正影响下一步的决定，不用长问题清单代替创作。
只输出严格JSON，不带代码块、解释或额外键：{"summary":"本轮整理","authorMaterial":"作者已有内容","proposals":[{"title":"提议名","content":"具体内容与取舍"}],"openQuestions":[]}。每项proposals只能有title和content，不另加source等属性；来源说明写在authorMaterial或content内。按本轮动作决定proposals数量。` }, { role: 'user', content: `【作者本轮要求】\n${request}\n\n【登记来源中的所选素材与同类历史版本】\n${context}` }]
}
