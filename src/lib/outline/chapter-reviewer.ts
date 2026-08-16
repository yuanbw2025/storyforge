import { chat } from '../ai/client'
import { useAIConfigStore } from '../../stores/ai-config'
import type { OutlineNode } from '../types'

export type ChapterIssueType = 'logic' | 'consistency' | 'plot' | 'character' | 'timeline' | 'other'
export type IssueSeverity = 'low' | 'medium' | 'high'

/** 诊断阶段：只找问题，不生成改写 */
export interface ChapterReviewIssue {
  id: string
  issueType: ChapterIssueType
  severity: IssueSeverity
  description: string
  affectedChapters: number[]
  suggestion: string
}

export interface ChapterReviewResult {
  issues: ChapterReviewIssue[]
  summary: string
}

export interface ReviewChapter {
  index: number
  title: string
  summary: string
}

/** 智能改写阶段：针对单个问题生成最小化修改 */
export interface ChangeItem {
  id: string
  chapterIndex: number
  chapterTitle: string
  chapterName: string
  before: string
  after: string
  reason: string
}

export interface RewriteResult {
  originalSummary: string
  revisedSummary: string
  changes: ChangeItem[]
  summary: string
}

// ========== 诊断阶段 ==========

const DIAGNOSE_PROMPT = (chapters: ReviewChapter[], worldContext?: string, userQuestion?: string): string => `
你是一位专业的小说编辑。请仔细阅读以下章节大纲，结合设定背景，诊断潜在问题。

${worldContext ? `【设定背景（用于检查设定一致性）】\n${worldContext.slice(0, 2000)}\n\n` : ''}

【章节大纲】
${chapters.map(ch => `第${ch.index + 1}章：${ch.title}\n${ch.summary}`).join('\n\n')}

${userQuestion ? `\n【用户特别关注】${userQuestion}\n` : ''}

【诊断维度】
1. 跨章节逻辑：角色动机、物品、能力、时间线是否前后一致
2. 设定符合性：是否违反设定背景中的规则/设定
3. 角色合理性：决策、行动是否符合性格和处境
4. 情节连贯：伏笔与回收、因果关系是否清晰
5. 叙事节奏：爽点分布、高潮铺垫是否合理

【输出格式】严格 JSON：

\`\`\`json
{
  "summary": "总体诊断（30-80字）",
  "issues": [
    {
      "id": "issue-1",
      "issueType": "logic",
      "severity": "high",
      "description": "问题描述（30-80字，说清楚哪里矛盾/不合理）",
      "affectedChapters": [1, 2],
      "suggestion": "修改方向（说清楚应该改成什么样，不要写具体改写内容）"
    }
  ]
}
\`\`\`

【字段说明】
- issueType: logic/consistency/plot/character/timeline/other
- severity: low(轻微)/medium(中等)/high(严重)
- affectedChapters: 涉及矛盾的章节序号
- suggestion: 只说修改方向，例如"将倚天剑改为破云剑"，不要生成完整章节摘要

【严格规则】
1. 不要生成 rewrite 字段！改写由后续步骤完成
2. 如果能通过解释解决，说明原因即可，不要列为问题
3. 按严重程度排序
4. 无问题则 issues 返回空数组
`

export async function reviewChapterOutlines(
  chapters: ReviewChapter[],
  userQuestion?: string,
  context?: string,
): Promise<ChapterReviewResult> {
  const config = useAIConfigStore.getState().config

  const processedChapters = chapters.length > 40
    ? compressChapters(chapters)
    : chapters

  const messages = [
    {
      role: 'system' as const,
      content: '你是一位经验丰富的小说编辑，擅长诊断章节大纲的逻辑漏洞和设定冲突。',
    },
    {
      role: 'user' as const,
      content: DIAGNOSE_PROMPT(processedChapters, context, userQuestion),
    },
  ]

  try {
    const rawOutput = await chat(messages, config, {
      category: 'outline.review',
    })

    return parseDiagnoseResult(rawOutput)
  } catch (error) {
    console.error('[ChapterReview] 诊断失败:', error)
    return {
      issues: [],
      summary: `诊断失败：${error instanceof Error ? error.message : '未知错误'}`,
    }
  }
}

// ========== 改写阶段 ==========

const REWRITE_PROMPT = (
  targetChapter: ReviewChapter,
  surroundingChapters: ReviewChapter[],
  issue: ChapterReviewIssue,
  worldContext?: string,
): string => `
你是一位精准的小说编辑。请针对以下问题，对目标章节的摘要进行最小化修改。

${worldContext ? `【设定背景】\n${worldContext.slice(0, 1500)}\n\n` : ''}

【问题详情】
- 问题类型：${issue.issueType}（${issue.severity}）
- 问题描述：${issue.description}
- 修改方向：${issue.suggestion}

【目标章节（需要修改）】
第${targetChapter.index + 1}章：${targetChapter.title}
原摘要：${targetChapter.summary}

【上下文章节】
${surroundingChapters.map(ch => 
  ch.index === targetChapter.index 
    ? `（目标章节，见上方）`
    : `第${ch.index + 1}章：${ch.title}\n${ch.summary}`
).filter(Boolean).join('\n\n')}

【输出格式】严格 JSON：

\`\`\`json
{
  "originalSummary": "原摘要（原文照抄）",
  "revisedSummary": "修改后的完整摘要（保留所有未修改的内容）",
  "changes": [
    {
      "id": "change-1",
      "chapterIndex": ${targetChapter.index},
      "chapterTitle": "${targetChapter.title}",
      "chapterName": "第${targetChapter.index + 1}章",
      "before": "原摘要中需要修改的那段话",
      "after": "修改后的那段话",
      "reason": "为什么这样改"
    }
  ],
  "summary": "修改说明（一句话）"
}
\`\`\`

【严格规则】
1. 只修改必要的部分，保留其他所有内容
2. 如果问题涉及多章，用 changes 数组表示每章的修改
3. before/after 要能直接定位到原文中的具体片段
4. revisedSummary 是修改后的完整章节摘要，必须包含所有未修改的内容
5. 如果该问题不应该修改（用户可能忽略），返回空的 changes
`

export async function rewriteChapterOutline(
  allChapters: ReviewChapter[],
  issue: ChapterReviewIssue,
  context?: string,
  customSuggestion?: string,
): Promise<RewriteResult> {
  const config = useAIConfigStore.getState().config

  // 找到第一个需要修改的目标章节
  const targetIndex = issue.affectedChapters[0]
  const targetChapter = allChapters.find(ch => ch.index === targetIndex)

  if (!targetChapter) {
    return {
      originalSummary: '',
      revisedSummary: '',
      changes: [],
      summary: '未找到目标章节',
    }
  }

  // 获取上下文（前后各2章）
  const surroundingChapters = allChapters.filter(ch => 
    ch.index >= targetIndex - 2 && ch.index <= targetIndex + 2
  )

  // 如果用户提供了自定义建议，使用它
  const effectiveIssue = customSuggestion 
    ? { ...issue, suggestion: customSuggestion }
    : issue

  const messages = [
    {
      role: 'system' as const,
      content: '你是一位专业的小说编辑，擅长对章节摘要进行精准的最小化修改。',
    },
    {
      role: 'user' as const,
      content: REWRITE_PROMPT(targetChapter, surroundingChapters, effectiveIssue, context),
    },
  ]

  try {
    const rawOutput = await chat(messages, config, {
      category: 'outline.rewrite',
    })

    return parseRewriteResult(rawOutput, targetChapter)
  } catch (error) {
    console.error('[ChapterReview] 改写失败:', error)
    return {
      originalSummary: targetChapter.summary,
      revisedSummary: targetChapter.summary,
      changes: [],
      summary: `改写失败：${error instanceof Error ? error.message : '未知错误'}`,
    }
  }
}

// ========== 工具函数 ==========

function compressChapters(chapters: ReviewChapter[]): ReviewChapter[] {
  const result: ReviewChapter[] = []
  for (let i = 0; i < chapters.length; i += 3) {
    const group = chapters.slice(i, i + 3)
    const combinedSummary = group
      .map(c => `第${c.index + 1}章(${c.title})：${c.summary}`)
      .join(' | ')
    result.push({
      index: i,
      title: `第${i + 1}-${Math.min(i + 3, chapters.length)}章（合并）`,
      summary: combinedSummary,
    })
  }
  return result
}

function parseDiagnoseResult(rawOutput: string): ChapterReviewResult {
  const jsonMatch = rawOutput.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return { issues: [], summary: '未能解析 AI 输出' }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    const issues: ChapterReviewIssue[] = Array.isArray(parsed.issues)
      ? parsed.issues.map((issue: {
          id?: string
          issueType?: string
          severity?: string
          description?: string
          affectedChapters?: number[]
          suggestion?: string
        }, idx: number) => ({
          id: issue.id || `issue-${idx}`,
          issueType: (issue.issueType as ChapterReviewIssue['issueType']) || 'other',
          severity: (issue.severity as ChapterReviewIssue['severity']) || 'medium',
          description: issue.description || '未描述的问题',
          affectedChapters: Array.isArray(issue.affectedChapters) ? issue.affectedChapters : [],
          suggestion: issue.suggestion || '无建议',
        }))
      : []

    return {
      issues,
      summary: parsed.summary || '诊断完成',
    }
  } catch {
    return { issues: [], summary: `解析失败：${rawOutput.slice(0, 200)}` }
  }
}

function parseRewriteResult(rawOutput: string, fallbackChapter: ReviewChapter): RewriteResult {
  const jsonMatch = rawOutput.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return {
      originalSummary: fallbackChapter.summary,
      revisedSummary: fallbackChapter.summary,
      changes: [],
      summary: '未能解析改写结果',
    }
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    const changes: ChangeItem[] = Array.isArray(parsed.changes)
      ? parsed.changes.map((change: {
          id?: string
          chapterIndex?: number
          chapterTitle?: string
          chapterName?: string
          before?: string
          after?: string
          reason?: string
        }, idx: number) => ({
          id: change.id || `change-${idx}`,
          chapterIndex: change.chapterIndex ?? fallbackChapter.index,
          chapterTitle: change.chapterTitle || fallbackChapter.title,
          chapterName: change.chapterName || `第${fallbackChapter.index + 1}章`,
          before: change.before || '',
          after: change.after || '',
          reason: change.reason || '',
        }))
      : []

    return {
      originalSummary: parsed.originalSummary || fallbackChapter.summary,
      revisedSummary: parsed.revisedSummary || fallbackChapter.summary,
      changes,
      summary: parsed.summary || '改写完成',
    }
  } catch {
    return {
      originalSummary: fallbackChapter.summary,
      revisedSummary: fallbackChapter.summary,
      changes: [],
      summary: `解析失败：${rawOutput.slice(0, 200)}`,
    }
  }
}

export function toReviewChapters(nodes: OutlineNode[]): ReviewChapter[] {
  return nodes
    .filter(n => n.type === 'chapter')
    .sort((a, b) => a.order - b.order)
    .map((n, idx) => ({
      index: idx,
      title: n.title || `第${idx + 1}章`,
      summary: n.summary || '（无摘要）',
    }))
}
