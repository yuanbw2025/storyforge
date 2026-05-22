/**
 * 情感节拍卡 AI 适配器
 * 根据章节大纲 + 上下文生成情感节拍规划
 */
import type { ChatMessage } from '../../types'
import type { EmotionBeat } from '../../types/emotion-beat'

export function buildEmotionBeatPrompt(
  chapterTitle: string,
  chapterSummary: string,
  worldContext: string,
  characterContext: string,
  prevChapterEnding: string,
): ChatMessage[] {
  const system = `你是一位资深小说编辑，擅长分析和规划章节的情感节奏。
你的任务是为即将创作的章节生成一份「情感节拍卡」，帮助作者在写作前理清叙事节奏。

要求：
1. 将章节拆分为 3~6 个关键节拍（如"开场铺垫"、"冲突升级"、"情感转折"、"高潮"、"余韵"等）
2. 每个节拍需要说明：场景目标、情感基调、期望读者感受、角色变化
3. 整体要形成完整的情感弧线（有起有伏）
4. 节拍之间要有情感的递进或反转，避免单调
5. 用简洁有力的语言

输出严格的 JSON 格式（不要 markdown 围栏）：
{
  "overallArc": "整章情感概述（1-2句）",
  "beats": [
    {
      "label": "节拍名称",
      "sceneGoal": "这个段落要完成什么叙事任务",
      "emotionTone": "情感基调关键词",
      "readerFeeling": "期望读者产生什么感受",
      "characterGrowth": "角色在此处的变化或展现"
    }
  ]
}`

  const userParts: string[] = []
  userParts.push(`## 章节：${chapterTitle}`)
  userParts.push(`## 大纲摘要：\n${chapterSummary}`)
  if (worldContext) userParts.push(`## 世界观背景：\n${worldContext.slice(0, 1500)}`)
  if (characterContext) userParts.push(`## 涉及角色：\n${characterContext.slice(0, 1000)}`)
  if (prevChapterEnding) userParts.push(`## 上一章结尾：\n${prevChapterEnding}`)
  userParts.push('\n请为该章节生成情感节拍卡。')

  return [
    { role: 'system', content: system },
    { role: 'user', content: userParts.join('\n\n') },
  ]
}

/** 解析 AI 返回的情感节拍 JSON */
export function parseEmotionBeats(raw: string): {
  overallArc: string
  beats: EmotionBeat[]
  error?: string
} {
  try {
    // 移除 markdown 围栏
    let cleaned = raw.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '')
    }

    const parsed = JSON.parse(cleaned)

    if (!parsed || typeof parsed !== 'object') {
      console.error('[EmotionBeat] 解析结果不是对象:', cleaned.slice(0, 200))
      return { overallArc: '', beats: [], error: '解析结果不是对象' }
    }

    const overallArc = parsed.overallArc || ''
    const beats: EmotionBeat[] = []

    if (Array.isArray(parsed.beats)) {
      for (const b of parsed.beats) {
        beats.push({
          label: b.label || '未命名节拍',
          sceneGoal: b.sceneGoal || '',
          emotionTone: b.emotionTone || '',
          readerFeeling: b.readerFeeling || '',
          characterGrowth: b.characterGrowth || '',
        })
      }
    }

    console.log(`[EmotionBeat] 解析成功: ${beats.length} 个节拍`)
    return { overallArc, beats }
  } catch (err) {
    console.error('[EmotionBeat] JSON 解析失败:', err, raw.slice(0, 300))

    // 尝试从部分 JSON 中提取
    try {
      const arrMatch = raw.match(/"beats"\s*:\s*(\[[\s\S]*?\])/)?.[1]
      if (arrMatch) {
        const beats = JSON.parse(arrMatch) as EmotionBeat[]
        console.log(`[EmotionBeat] 回退解析: 提取到 ${beats.length} 个节拍`)
        return { overallArc: '', beats, error: '主解析失败，已回退提取 beats 数组' }
      }
    } catch {
      // ignore
    }

    return { overallArc: '', beats: [], error: `JSON 解析失败: ${String(err)}` }
  }
}
