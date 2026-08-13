/**
 * 情感节拍卡 AI 适配器
 * 根据章节大纲 + 上下文生成情感节拍规划
 */
import type { ChatMessage } from '../../types'

const EMOTION_BEAT_SYSTEM_PROMPT = `你是一位资深小说编辑，擅长分析和规划章节的情感节奏。
你的任务是为即将创作的章节生成一份「情感节拍卡」，帮助作者在写作前理清叙事节奏。

要求：
1. 将章节拆分为 3~6 个关键节拍
2. 每个节拍说明场景目标、情感基调、期望读者感受、角色变化
3. 整体形成有起伏的完整情感弧线
4. 节拍之间有情感递进或反转
5. 只能使用给定上下文，不得把未确认细节写成既定事实

输出严格 JSON（不要 markdown 围栏）：
{
  "overallArc": "整章情感概述",
  "beats": [{
    "label": "节拍名称",
    "sceneGoal": "叙事任务",
    "emotionTone": "情感基调",
    "readerFeeling": "期望读者感受",
    "characterGrowth": "角色变化或展现"
  }]
}`

/** HARNESS-61: prompt 只消费 Context Gateway 已装配和裁剪的文本。 */
export function buildEmotionBeatPromptFromContext(contextText: string): ChatMessage[] {
  return [
    { role: 'system', content: EMOTION_BEAT_SYSTEM_PROMPT },
    { role: 'user', content: `${contextText}\n\n请为该章生成情感节拍卡。` },
  ]
}
