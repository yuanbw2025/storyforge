import type { ChatMessage } from '../../types'

const CHAPTER_SYSTEM_PROMPT = `你是一位网文"老贼"级别的写手，擅长写出让读者欲罢不能的章节。

你的写作风格：
1. 开篇即抓人——第一段就要制造悬念或冲突
2. 善用对话推进剧情，对话自然有性格
3. 动作场面要有画面感，节奏快
4. 每章结尾留钩子（伏笔/悬念/反转）
5. 文笔流畅，不用生硬的过渡

写作原则：
- 展示而非告知（Show, don't tell）
- 角色行为要符合其性格和动机
- 保持世界观一致性
- 注意前后文的连贯性

输出要求：
- 直接输出正文内容
- 不需要输出章节标题
- 字数约 2000-3000 字/章`

/** 生成章节正文 */
export function buildChapterContentPrompt(
  chapterTitle: string,
  chapterSummary: string,
  worldContext: string,
  characterContext: string,
  previousChapterEnding: string,
  userHint?: string,
): ChatMessage[] {
  let userContent = `请根据以下信息写一章小说正文：

章节标题：${chapterTitle}
章节大纲：${chapterSummary}

世界观摘要：
${worldContext || '（暂无）'}

涉及角色：
${characterContext || '（暂无角色设定）'}

前一章结尾（衔接用）：
${previousChapterEnding || '（这是第一章）'}`

  if (userHint) {
    userContent += `\n\n用户额外要求：${userHint}`
  }

  return [
    { role: 'system', content: CHAPTER_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]
}

/** 续写正文 */
export function buildContinuePrompt(
  existingContent: string,
  chapterSummary: string,
  worldContext: string,
  userHint?: string,
): ChatMessage[] {
  let userContent = `请续写以下小说正文，保持风格和情节连贯：

章节大纲：${chapterSummary}

世界观摘要：
${worldContext || '（暂无）'}

已有正文（请从最后继续写，约 1000-2000 字）：
---
${existingContent.slice(-3000)}
---`

  if (userHint) {
    userContent += `\n\n用户额外要求：${userHint}`
  }

  return [
    { role: 'system', content: CHAPTER_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]
}

/** 润色 */
export function buildPolishPrompt(text: string, instruction: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: '你是一位文字润色专家。根据用户的指令修改文本，保持原意不变，只优化表达。直接输出修改后的文本，不要解释。',
    },
    {
      role: 'user',
      content: `指令：${instruction}\n\n原文：\n${text}`,
    },
  ]
}

/** 扩写 */
export function buildExpandPrompt(text: string, hint?: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: '你是一位小说扩写专家。将用户提供的文本扩展丰富，增加细节描写、心理活动、环境氛围，但保持情节走向不变。直接输出扩写后的文本。',
    },
    {
      role: 'user',
      content: `${hint ? `要求：${hint}\n\n` : ''}请扩写以下内容：\n${text}`,
    },
  ]
}

/** 去 AI 味 */
export function buildDeAIPrompt(text: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是一位文字风格化专家。你的任务是将 AI 味道重的文本改写得更像真人写的。

去 AI 味技巧：
1. 去掉"的确""毫无疑问""不禁"等 AI 常用词
2. 缩短过长的句子
3. 用更口语化/个性化的表达
4. 增加不完美感（口吻、断句、语气词）
5. 减少排比和对仗
6. 保持原意不变

直接输出修改后的文本。`,
    },
    { role: 'user', content: text },
  ]
}
