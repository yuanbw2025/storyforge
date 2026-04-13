import type { ChatMessage } from '../../types'

const SYSTEM_PROMPT = `你是一位资深的奇幻/科幻世界设计师，擅长构建宏大、自洽、有深度的虚构世界。

你的职责：
1. 根据用户提供的小说类型和基本设定，为其构建详细的世界观要素
2. 确保世界观各维度之间逻辑自洽
3. 提供具体、生动的细节，而非泛泛而谈
4. 用条理清晰的格式组织内容

输出要求：
- 直接输出内容，不需要重复用户的输入
- 使用 Markdown 格式
- 内容要丰富具体，有画面感
- 注意与已有世界观设定保持一致`

/** 生成世界观某个维度 */
export function buildWorldviewPrompt(
  dimension: string,
  projectName: string,
  genre: string,
  existingContext: string,
  userHint?: string,
): ChatMessage[] {
  const dimensionLabels: Record<string, string> = {
    geography: '地理环境',
    history: '历史年表',
    society: '社会结构',
    culture: '文化与宗教',
    economy: '经济体系',
    rules: '世界规则/物理法则',
    summary: '世界观精华摘要',
  }

  const label = dimensionLabels[dimension] || dimension

  let userContent = `小说名称：${projectName}
小说类型：${genre}
需要生成的维度：${label}`

  if (existingContext) {
    userContent += `\n\n已有世界观设定（请保持一致）：\n${existingContext}`
  }

  if (userHint) {
    userContent += `\n\n用户补充说明：${userHint}`
  }

  if (dimension === 'summary') {
    userContent += '\n\n请将上述世界观浓缩为 200-400 字的精华摘要，后续 AI 写作时会作为核心上下文参考。'
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]
}
