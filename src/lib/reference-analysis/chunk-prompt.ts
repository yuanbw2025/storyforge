import type { ChatMessage, Reference, ReferenceAnalysisDepth } from '../types'
import type { ChunkPlan } from '../import/chunker'
import { FICTION_DIMENSIONS, HISTORY_DIMENSIONS, DIMENSION_LABELS } from '../types/reference'
import { REFERENCE_READING_SKILL } from './content-skill'

export type ReferenceChunkInput = {
  runId: number
  ref: Reference
  depth: ReferenceAnalysisDepth
  chunk: ChunkPlan
  totalChunks: number
  maxTokens: number
  signal?: AbortSignal
}

export function referenceChunkMessages(args: ReferenceChunkInput): ChatMessage[] {
  const { ref, depth, chunk, totalChunks } = args

  const dimensions = ref.type === 'historical' ? [
    ...FICTION_DIMENSIONS, ...HISTORY_DIMENSIONS,
  ] : [...FICTION_DIMENSIONS]
  const contract = Object.fromEntries(dimensions.map(key => [key,
    `${DIMENSION_LABELS[key]}：有证据时用“观察与短引文 → 有边界的解释 → 可迁移决定及失效条件”；否则写材料不足或本块未涉及`,
  ]))
  return [
    { role: 'system', content: `你是谨慎的作品细读编辑。任务是解释实际创作决定，帮助作者原创，不是赞美作品或套文学术语。
${REFERENCE_READING_SKILL}
【交付格式】只返回纯 JSON，键严格使用下面的合同，值为 Markdown 字符串，不返回围栏。
${JSON.stringify({ ...contract, rawExcerpt: '从本块逐字选取一处短引文；无合适材料可为空字符串，不拼接、不改写。' })}
${depth === 'deep' ? '有材料的重点维度写清事实、证据、解释边界和方法；不以长篇幅为目标。重要方法给短原创例和失效例。' : '快速摸底：只保留有证据的观察和边界，不扩写理论。'}
【提交前逐句核查】
1. 每句引文的说话者、行动者与知情者是否对应原文？旁白告知读者的事不等于人物知道。
2. 是否偷偷新增了身份属性、死亡、行动原因、计划、共同动机或后续情节？无明示则删除或并列可行解释，不能先断言后加“可能”搪塞。
3. 样本起点不等于作品开头；只见意象首次出现不能认证伏笔，未给后文不能说未回收或要求补回收；日常呼应不必发展为秘密。
4. 先按文本实际用途解释，不机械分起承转合。缺页是材料问题；突发的感官变化不必意味着袭击；沉默不能直接认证隐秘同盟或死亡。
5. 本块不支持的维度直接说明材料不足（指出所需上下文）；一项关系或潜台词至少给一种竞争解释。读者效果只写有依据的假设。` },
    { role: 'user', content: `【材料元信息，仅供定位】
作品：${ref.title}；作者：${ref.author || '未知'}；来源类型：${ref.type}；分类标签：${ref.genre || '未知'}（不得当作正文证据）。
第 ${chunk.index + 1}/${totalChunks} 块；${chunk.label || '未标章节'}；文件字符范围 ${chunk.startChar ?? '未知'}—${chunk.endChar ?? '未知'}。
这只表示上传材料的分块进度，不证明已提供全书或已完结。若历史资料，分析其记载和立场，不冒充外部史实核验。
【原文开始】
${chunk.text}
【原文结束】` },
  ]
}
