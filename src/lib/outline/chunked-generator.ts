/**
 * 分块章纲生成器 — Phase 2
 *
 * 将一卷分为 N 块，按黄金比例分配章数。
 * 采用迭代式交互：每次生成一个剧情走向方案，用户可收藏/重生成/选定。
 * 5轨引擎仅在生成章节细纲时使用，不在走向规划阶段使用。
 */
import type { ChatMessage } from '../types'
import { chat } from '../ai/client'
import { parseChapterOutlineSmart, type ParsedChapter } from '../ai/parse-outline-output'
import { useAIConfigStore } from '../../stores/ai-config'
import { divideChaptersIntoBlocks, getBlockLabels, type ChunkedGenerationConfig } from './generation-modes'
import { NarrativeEngine, type ChapterFocus } from './narrative-engine'
import { 
  type DirectionTemplate, 
  parseDirectionTemplate, 
  DIRECTION_TEMPLATE_PROMPT,
  EMPTY_DIRECTION_TEMPLATE 
} from './direction-template'

export interface StoryArcCompliance {
  score: number                    // 0-100, 故事线符合度评分
  coveredEvents: string[]          // 已覆盖的关键事件
  missingEvents: string[]          // 缺失的关键事件
  suggestions: string[]            // AI 建议添加的内容
  storyArcStage?: string           // 对应的故事线阶段名称
}

export interface BlockChoice {
  id: string
  title: string
  description: string
  template: DirectionTemplate
  focus: ChapterFocus
  storyArcCompliance?: StoryArcCompliance  // 故事线符合度
}

export interface BlockGenerationResult {
  blockIndex: number
  blockLabel: string
  chapterRange: [number, number]
  chapters: ParsedChapter[]
  selectedChoiceId?: string
  selectedChoice?: BlockChoice
}

export interface ChunkedGenerationProgress {
  currentBlockIndex: number
  totalBlocks: number
  currentBlockLabel: string
  stage: string
  waitingForChoice: boolean
  choices?: BlockChoice[]
}

export interface ChunkedGenerationResult {
  blocks: BlockGenerationResult[]
  totalChapters: number
  cancelled: boolean
  elapsed: number
}

export type ChoiceAction = 
  | { type: 'accept'; choiceId: string }
  | { type: 'regenerate'; choiceId?: string }
  | { type: 'favorite'; choiceId: string; isFavorite: boolean }
  | { type: 'cancel' }

export interface ChunkedGenerationOptions {
  volumeId: number
  volumeTitle: string
  volumeSummary: string
  worldContext: string
  characterContext: string
  worldRulesContext: string
  storyArcContext?: string  // 故事线上下文（新增）
  storyArcStage?: string   // 当前块对应的故事线阶段（新增）
  previousVolumeSummary?: string
  userHint?: string
  config: ChunkedGenerationConfig
  totalChapters: number
  onProgress?: (progress: ChunkedGenerationProgress) => void
  onChoiceNeeded?: (
    currentChoice: BlockChoice | null,
    favoriteChoices: BlockChoice[],
    regenerate: () => Promise<BlockChoice>,
  ) => Promise<{ action: 'accept'; choiceId: string } | { action: 'cancel' }>
  signal?: AbortSignal
}

export async function generateSingleDirection(
  options: ChunkedGenerationOptions,
  blockIndex: number,
  blockLabel: string,
  chapterRange: [number, number],
  engine: NarrativeEngine,
  choiceIndex: number = 0,
  variationHint?: string,
): Promise<BlockChoice> {
  const blockCount = chapterRange[1] - chapterRange[0] + 1

  const blockPrompt = DIRECTION_TEMPLATE_PROMPT(
    blockIndex,
    blockLabel,
    chapterRange,
    blockCount,
    undefined,
  )

  const variationPrompt = variationHint
    ? `\n\n【重要】${variationHint}\n`
    : ''

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `你是一位专业的小说结构师。请基于以下信息为「${options.volumeTitle}」设计一个剧情走向方案。

${options.storyArcContext 
  ? `【必须遵守的故事线框架】\n${options.storyArcContext}\n${options.storyArcStage ? `\n【当前块对应阶段】${options.storyArcStage}\n你必须在这个框架内设计剧情，建议包含该阶段的关键事件。` : '\n你必须在这个框架内设计剧情。'}` 
  : '⚠️ 没有预设的故事线框架，你可以自由设计剧情走向。'}

卷大纲：${options.volumeSummary}

世界观：${options.worldContext}

角色：${options.characterContext}

世界规则：${options.worldRulesContext}

${options.storyArcContext ? '重要：你可以返回一个可选的 JSON 对象放在响应末尾，包含 "compliance" 字段（对象，含 "score"(0-100)、"coveredEvents"(数组)、"missingEvents"(数组)、"suggestions"(数组)）和 "storyArcStage"(字符串)，用于说明你的方案与故事线的符合程度。JSON 格式：{"compliance": {...}, "storyArcStage": "..."}' : ''}`,
    },
    ...(options.previousVolumeSummary
      ? [{ role: 'user' as const, content: `前一卷概要：${options.previousVolumeSummary}` }]
      : []),
    {
      role: 'user',
      content: `${options.userHint ? `补充说明：${options.userHint}\n\n` : ''}${variationPrompt}${blockPrompt}`,
    },
  ]

  const config = useAIConfigStore.getState().config
  try {
    const rawOutput = await chat(messages, config, {
      category: 'outline.chapter',
      projectId: options.volumeId,
    })

    const template = parseDirectionTemplate(rawOutput)
    const title = template.title || `方案 ${choiceIndex + 1}`
    
    const focus = engine.calculateChapterFocus(
      chapterRange[0] + Math.floor(blockCount / 2),
      options.totalChapters,
    )
    
    // Use AI's self-assessed tension if available, otherwise fall back to engine calculation
    const aiTension = template.tension > 0 ? template.tension : focus.targetTension
    const finalFocus: ChapterFocus = {
      ...focus,
      targetTension: Math.round(aiTension * 10) / 10,
    }

    // 解析故事线符合度（如果有故事线约束）
    let storyArcCompliance: StoryArcCompliance | undefined
    if (options.storyArcContext) {
      storyArcCompliance = parseStoryArcCompliance(rawOutput, options.storyArcStage)
    }

    return {
      id: `choice-${blockIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      description: rawOutput,
      template,
      focus: finalFocus,
      storyArcCompliance,
    }
  } catch {
    const fallbackTitle = `方案 ${choiceIndex + 1}`
    const focus = engine.calculateChapterFocus(
      chapterRange[0] + Math.floor(blockCount / 2),
      options.totalChapters,
    )
    return {
      id: `choice-${blockIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: fallbackTitle,
      description: `${fallbackTitle}（AI 生成失败，使用默认方案）`,
      template: {
        ...EMPTY_DIRECTION_TEMPLATE,
        title: fallbackTitle,
        coreConflict: '（AI 生成失败，请手动描述本方案的核心冲突）',
        keyEvents: ['（AI 生成失败，请手动补充关键事件）'],
      },
      focus,
      storyArcCompliance: options.storyArcContext ? {
        score: 0,
        coveredEvents: [],
        missingEvents: ['AI 生成失败'],
        suggestions: ['请重新生成或手动设计'],
      } : undefined,
    }
  }
}

export async function regenerateDirection(
  options: ChunkedGenerationOptions,
  blockIndex: number,
  blockLabel: string,
  chapterRange: [number, number],
  engine: NarrativeEngine,
  previousChoices: BlockChoice[] = [],
): Promise<BlockChoice> {
  const variationStrategies = [
    '请提供一个与之前完全不同的剧情走向方案，采用截然不同的核心冲突和叙事角度',
    '请换一个思路，聚焦于不同角色的视角和成长轨迹，形成全新的剧情脉络',
    '请重新构思，改变关键事件的排列顺序和侧重点，创造意料之外的转折',
    '请尝试另一种风格，加强或减弱某类叙事张力（如悬疑、情感、冲突），探索不同的情感基调',
    '请突破常规思维，引入一个全新的关键变量或转折点，使整体走向产生质的变化',
  ]
  
  const strategyIndex = previousChoices.length % variationStrategies.length
  const variationHint = variationStrategies[strategyIndex]
  
  if (previousChoices.length > 0) {
    const previousTitles = previousChoices.map(c => c.title).join('、')
    return generateSingleDirection(
      options,
      blockIndex,
      blockLabel,
      chapterRange,
      engine,
      previousChoices.length,
      `${variationHint}\n\n已生成的方案：${previousTitles}。请确保新方案与以上所有方案在核心思路上有显著差异。`,
    )
  }
  
  return generateSingleDirection(
    options,
    blockIndex,
    blockLabel,
    chapterRange,
    engine,
    0,
    variationHint,
  )
}

export async function runChunkedOutlineGeneration(
  options: ChunkedGenerationOptions,
): Promise<ChunkedGenerationResult> {
  const { config } = options
  const engine = new NarrativeEngine()
  const blocks = divideChaptersIntoBlocks(options.totalChapters, config.blockCount)
  const startTime = Date.now()
  const results: BlockGenerationResult[] = []

  const blockLabels = getBlockLabels(config.blockCount)

  for (let i = 0; i < blocks.length; i++) {
    if (options.signal?.aborted) {
      return { 
        blocks: results, 
        totalChapters: results.reduce((s, b) => s + b.chapters.length, 0), 
        cancelled: true, 
        elapsed: Date.now() - startTime 
      }
    }

    const block = blocks[i]
    const blockLabel = blockLabels[i] || `第${i + 1}块`

    options.onProgress?.({
      currentBlockIndex: i,
      totalBlocks: blocks.length,
      currentBlockLabel: blockLabel,
      stage: `正在为「${blockLabel}」生成剧情走向...`,
      waitingForChoice: false,
    })

    let currentChoice = await generateSingleDirection(options, i, blockLabel, block.chapterRange, engine)
    const favoriteChoices: BlockChoice[] = []
    let selectedChoice: BlockChoice | null = null

    while (!selectedChoice && !options.signal?.aborted) {
      options.onProgress?.({
        currentBlockIndex: i,
        totalBlocks: blocks.length,
        currentBlockLabel: blockLabel,
        stage: `请审阅「${blockLabel}」的剧情走向（可收藏或重新生成）`,
        waitingForChoice: true,
        choices: [currentChoice, ...favoriteChoices],
      })

      if (options.onChoiceNeeded) {
        const result = await options.onChoiceNeeded(
          currentChoice,
          favoriteChoices,
          async () => {
            const allPreviousChoices = [currentChoice, ...favoriteChoices]
            const newChoice = await regenerateDirection(
              options, i, blockLabel, block.chapterRange, engine,
              allPreviousChoices,
            )
            currentChoice = newChoice
            return newChoice
          },
        )

        if (result.action === 'accept') {
          selectedChoice = [currentChoice, ...favoriteChoices].find(c => c.id === result.choiceId) || currentChoice
        } else if (result.action === 'cancel') {
          return {
            blocks: results,
            totalChapters: results.reduce((s, b) => s + b.chapters.length, 0),
            cancelled: true,
            elapsed: Date.now() - startTime,
          }
        }
      } else {
        selectedChoice = currentChoice
      }
    }

    if (options.signal?.aborted || !selectedChoice) {
      return {
        blocks: results,
        totalChapters: results.reduce((s, b) => s + b.chapters.length, 0),
        cancelled: true,
        elapsed: Date.now() - startTime,
      }
    }

    options.onProgress?.({
      currentBlockIndex: i,
      totalBlocks: blocks.length,
      currentBlockLabel: blockLabel,
      stage: `正在生成「${blockLabel}」的 ${block.chapterCount} 章内容...`,
      waitingForChoice: false,
    })

    const chapters = await generateBlockChapters(options, i, block.chapterRange, selectedChoice, engine)

    results.push({
      blockIndex: i,
      blockLabel,
      chapterRange: block.chapterRange,
      chapters,
      selectedChoiceId: selectedChoice.id,
      selectedChoice,
    })
  }

  return {
    blocks: results,
    totalChapters: results.reduce((s, b) => s + b.chapters.length, 0),
    cancelled: false,
    elapsed: Date.now() - startTime,
  }
}

async function generateBlockChapters(
  options: ChunkedGenerationOptions,
  blockIndex: number,
  chapterRange: [number, number],
  choice: BlockChoice,
  engine: NarrativeEngine,
): Promise<ParsedChapter[]> {
  const chapterCount = chapterRange[1] - chapterRange[0] + 1

  const systemPrompt = `你是一位专业的小说章节大纲撰写者。请基于以下信息为「${options.volumeTitle}」的第 ${chapterRange[0] + 1}-${chapterRange[1] + 1} 章生成详细的章节大纲。`

  const choiceContext = formatDirectionTemplate(choice.template, choice.description)
  
  const narrativeHint = options.config.enableNarrativeEngine 
    ? choice.focus.promptHint 
    : ''

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
    ...(options.previousVolumeSummary
      ? [{ role: 'user' as const, content: `前一卷概要：${options.previousVolumeSummary}` }]
      : []),
    {
      role: 'user',
      content: `卷大纲：${options.volumeSummary}\n\n世界观：${options.worldContext}\n\n角色：${options.characterContext}\n\n世界规则：${options.worldRulesContext}\n\n${narrativeHint}${narrativeHint ? '\n\n' : ''}选定的剧情走向方案：\n${choiceContext}\n\n请严格按照以上走向方案，为第 ${chapterRange[0] + 1}-${chapterRange[1] + 1} 章生成 ${chapterCount} 章的详细大纲。格式为：\n1. 章节标题：章节内容摘要\n2. 章节标题：章节内容摘要\n...`,
    },
  ]

  const config = useAIConfigStore.getState().config
  try {
    const rawOutput = await chat(messages, config, {
      category: 'outline.chapter',
      projectId: options.volumeId,
    })

    const parsed = await parseChapterOutlineSmart(rawOutput, config)

    if (options.config.enableNarrativeEngine && parsed.length > 0) {
      const hasReveal = parsed.some(ch => /揭秘|发现|真相/.test(ch.summary))
      const hasDevelopment = parsed.some(ch => /成长|转变|领悟/.test(ch.summary))
      engine.commitFeedback({
        isMajorReveal: hasReveal,
        characterDevelopment: hasDevelopment,
      })
    }

    return parsed
  } catch (error) {
    console.error(`[ChunkedGenerator] 块 ${blockIndex} 生成失败:`, error)
    return []
  }
}

function formatDirectionTemplate(template: DirectionTemplate, rawDescription: string): string {
  const parts: string[] = []
  
  if (template.title && template.title !== rawDescription) {
    parts.push(`方案标题：《${template.title}》`)
  }
  if (template.coreConflict) {
    parts.push(`核心冲突：${template.coreConflict}`)
  }
  if (template.characterChange) {
    parts.push(`角色关系变化：${template.characterChange}`)
  }
  if (template.keyEvents.length > 0) {
    parts.push(`关键事件序列：\n${template.keyEvents.map((e, i) => `${i + 1}. ${e}`).join('\n')}`)
  }
  if (template.mainNarrativeTrack) {
    parts.push(`主叙事侧重：${template.mainNarrativeTrack}`)
  }
  if (template.tension > 0) {
    parts.push(`目标张力：${template.tension}/10`)
  }
  
  if (parts.length === 0) {
    return rawDescription
  }
  
  return parts.join('\n')
}

/**
 * 解析 AI 返回的故事线符合度信息
 */
function parseStoryArcCompliance(rawOutput: string, expectedStage?: string): StoryArcCompliance {
  // 尝试找到 JSON 部分
  const jsonMatch = rawOutput.match(/\{[\s\S]*?"compliance"[\s\S]*?\}/)
  if (!jsonMatch) {
    // 如果没有找到 JSON，返回一个默认值
    return {
      score: 70,  // 默认给一个中等分数
      coveredEvents: [],
      missingEvents: [],
      suggestions: ['AI 未返回符合度评估，建议人工检查'],
      storyArcStage: expectedStage,
    }
  }

  try {
    const jsonStr = jsonMatch[0]
    const parsed = JSON.parse(jsonStr)
    
    const compliance = parsed.compliance || {}
    return {
      score: Math.min(100, Math.max(0, compliance.score || 70)),
      coveredEvents: compliance.coveredEvents || [],
      missingEvents: compliance.missingEvents || [],
      suggestions: compliance.suggestions || [],
      storyArcStage: parsed.storyArcStage || expectedStage,
    }
  } catch {
    // JSON 解析失败，返回默认值
    return {
      score: 60,
      coveredEvents: [],
      missingEvents: [],
      suggestions: ['AI 返回格式异常，建议人工检查'],
      storyArcStage: expectedStage,
    }
  }
}
