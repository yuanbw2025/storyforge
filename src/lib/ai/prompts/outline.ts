import type { ChatMessage } from '../../types'

const OUTLINE_SYSTEM_PROMPT = `你是一位经验丰富的小说大纲师，擅长设计跌宕起伏的故事结构。

你的职责：
1. 根据世界观和故事核心，设计精彩的故事大纲
2. 每一卷要有明确的主线冲突、角色成长和高潮转折
3. 章节安排要有节奏感：开篇引入 → 矛盾升级 → 高潮 → 过渡/伏笔

输出格式要求：
- 卷级大纲：每卷包含标题和 2-3 句情节摘要
- 章节大纲：每章包含标题和 1-2 句情节摘要
- 使用编号列表
- 直接输出内容`

/** 生成卷级大纲 */
export function buildVolumeOutlinePrompt(
  projectName: string,
  genre: string,
  worldContext: string,
  storyCoreContext: string,
  targetWordCount: number,
  userHint?: string,
): ChatMessage[] {
  const estimatedVolumes = Math.max(1, Math.ceil(targetWordCount / 300000))

  let userContent = `小说名称：${projectName}
小说类型：${genre}
目标字数：约 ${targetWordCount} 字
建议卷数：约 ${estimatedVolumes} 卷

世界观设定：
${worldContext || '（暂无，请自由发挥）'}

故事核心：
${storyCoreContext || '（暂无，请自由发挥）'}

请生成卷级大纲，每卷包含：
1. 卷标题
2. 情节摘要（3-5 句，说明本卷的核心冲突和关键转折）`

  if (userHint) {
    userContent += `\n\n用户补充要求：${userHint}`
  }

  return [
    { role: 'system', content: OUTLINE_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]
}

/** 将卷展开为章节大纲 */
export function buildChapterOutlinePrompt(
  volumeTitle: string,
  volumeSummary: string,
  worldContext: string,
  prevVolumeSummary: string,
  userHint?: string,
): ChatMessage[] {
  let userContent = `请将以下卷展开为具体章节大纲（每卷约 15-25 章）：

卷标题：${volumeTitle}
卷情节摘要：${volumeSummary}

世界观摘要：
${worldContext || '（暂无）'}

前一卷摘要（衔接用）：
${prevVolumeSummary || '（这是第一卷）'}

每章包含：
1. 章节标题
2. 情节摘要（1-2 句）
3. 涉及的主要角色（如有）`

  if (userHint) {
    userContent += `\n\n用户补充要求：${userHint}`
  }

  return [
    { role: 'system', content: OUTLINE_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]
}
