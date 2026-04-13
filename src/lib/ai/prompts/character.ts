import type { ChatMessage } from '../../types'

const CHARACTER_SYSTEM_PROMPT = `你是一位角色设计大师，擅长创造有深度、有弧光的小说角色。

设计原则：
1. 角色要有鲜明的性格特征和内在矛盾
2. 外貌描写要有辨识度
3. 动机要合理且有层次（表面动机 + 深层动机）
4. 角色弧光要有成长和变化

输出格式：直接输出内容，使用 Markdown`

/** 生成角色设定 */
export function buildCharacterPrompt(
  projectName: string,
  genre: string,
  worldContext: string,
  existingCharacters: string,
  userHint?: string,
): ChatMessage[] {
  let userContent = `小说：${projectName}（${genre}）

世界观摘要：
${worldContext || '（暂无）'}

已有角色：
${existingCharacters || '（暂无）'}

请设计一个新角色，包含：
- 姓名
- 定位（主角/反派/重要配角/次要角色）
- 一句话简介
- 外貌特征
- 性格特点
- 背景故事
- 核心动机
- 能力/技能
- 角色弧光（成长线）`

  if (userHint) {
    userContent += `\n\n用户要求：${userHint}`
  }

  return [
    { role: 'system', content: CHARACTER_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]
}

/** AI 丰富角色某个维度 */
export function buildCharacterDimensionPrompt(
  characterName: string,
  dimension: string,
  existingInfo: string,
  worldContext: string,
): ChatMessage[] {
  return [
    { role: 'system', content: CHARACTER_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `角色：${characterName}
已有信息：${existingInfo}
世界观：${worldContext || '（暂无）'}

请为这个角色丰富"${dimension}"这个维度的描写，要具体生动，约 200-400 字。`,
    },
  ]
}
