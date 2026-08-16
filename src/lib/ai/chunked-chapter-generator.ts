import { chat } from './client'
import { buildChapterOutlinePrompt } from './adapters/outline-adapter'
import { parseChapterOutlineSmart, type ParsedChapter } from './parse-outline-output'
import { useAIConfigStore } from '../../stores/ai-config'
import type { OutlineNode } from '../types'

export interface ChunkConfig {
  startChapter: number
  endChapter: number
  title: string
  purpose: string
  emotionalTone: '平静' | '紧张' | '高潮' | '低落' | '转折'
  pace: '慢' | '中' | '快' | '极快'
}

export interface DeviationAnalysis {
  score: number
  dimensionScores: {
    plotGoal: number
    characterState: number
    worldConsistency: number
    foreshadowing: number
    mainLine: number
  }
  warnings: string[]
  suggestions: string[]
}

export interface ChunkGenerationResult {
  chunk: ChunkConfig
  chapters: ParsedChapter[]
  deviation: DeviationAnalysis
  needsSalvage: boolean
}

export interface SalvageOption {
  type: 'auto-adjust' | 'transition-chapters' | 'regenerate' | 'ignore'
  label: string
  description: string
  estimatedAdditionalChapters?: number
}

export interface ChunkOption {
  id: string
  chapters: ParsedChapter[]
  description: string
  deviation: DeviationAnalysis
}

export interface ChunkedGenerationOptions {
  volume: OutlineNode
  worldContext: string
  prevVolumeSummary: string
  characterContext?: string
  worldRulesContext?: string
  userHint?: string
  targetChapterCount: number
  onProgress?: (stage: string, current: number, total: number) => void
  onChunkReady?: (chunk: ChunkConfig, options: ChunkOption[]) => Promise<ChunkOption>
  signal?: AbortSignal
}

function generateChunks(targetChapterCount: number): ChunkConfig[] {
  const chunks: ChunkConfig[] = []
  
  const ratios = [0.15, 0.25, 0.30, 0.20, 0.10]
  const purposes = ['铺垫引入', '发展冲突', '高潮前酝酿', '高潮爆发', '收尾铺垫']
  const tones: ChunkConfig['emotionalTone'][] = ['平静', '紧张', '紧张', '高潮', '转折']
  const paces: ChunkConfig['pace'][] = ['慢', '中', '快', '极快', '慢']
  
  let currentChapter = 1
  
  for (let i = 0; i < ratios.length; i++) {
    const chapterCount = Math.max(1, Math.round(targetChapterCount * ratios[i]))
    const start = currentChapter
    const end = Math.min(start + chapterCount - 1, targetChapterCount)
    
    chunks.push({
      startChapter: start,
      endChapter: end,
      title: `第${i + 1}块：${purposes[i]}`,
      purpose: purposes[i],
      emotionalTone: tones[i],
      pace: paces[i],
    })
    
    currentChapter = end + 1
    if (currentChapter > targetChapterCount) break
  }
  
  return chunks
}

async function analyzeDeviation(
  volumeSummary: string,
  generatedChapters: ParsedChapter[],
  worldRulesContext: string = '',
): Promise<DeviationAnalysis> {
  const config = useAIConfigStore.getState().config
  
  const messages = [
    {
      role: 'system' as const,
      content: `你是一位专业的小说编辑和剧情分析师。请分析生成的章节大纲是否偏离了卷纲设定。

分析维度：
1. 剧情目标（权重40%）：章节是否达成卷纲设定的目标
2. 角色状态（权重25%）：角色能力/关系是否符合预期
3. 世界观一致性（权重20%）：是否违反已设定的世界规则
4. 伏笔状态（权重10%）：伏笔是否按计划埋设/回收
5. 主线推进（权重5%）：是否推进主线

评分标准（0-100）：
- 0-30：正常，基本符合预期
- 31-60：轻微偏离，需要关注
- 61-100：严重偏离，需要挽救

输出格式：JSON
{
  "score": 偏离度总分,
  "dimensionScores": {
    "plotGoal": 分数,
    "characterState": 分数,
    "worldConsistency": 分数,
    "foreshadowing": 分数,
    "mainLine": 分数
  },
  "warnings": ["警告1", "警告2", ...],
  "suggestions": ["建议1", "建议2", ...]
}`,
    },
    {
      role: 'user' as const,
      content: `请分析以下生成的章节大纲是否偏离了卷纲设定：

【卷纲】
${volumeSummary}

【世界规则】
${worldRulesContext || '暂无'}

【生成的章节】
${generatedChapters.map((ch, i) => `${i + 1}. ${ch.title}：${ch.summary}`).join('\n')}`,
    },
  ]
  
  try {
    const rawOutput = await chat(messages, config, { category: 'outline.deviation', projectId: 0 })
    const trimmed = rawOutput.replace(/```json/g, '').replace(/```/g, '').trim()
    const result = JSON.parse(trimmed) as DeviationAnalysis
    return result
  } catch {
    return {
      score: 0,
      dimensionScores: { plotGoal: 0, characterState: 0, worldConsistency: 0, foreshadowing: 0, mainLine: 0 },
      warnings: [],
      suggestions: [],
    }
  }
}

export async function generateChunkedChapterOutline(
  options: ChunkedGenerationOptions,
): Promise<ParsedChapter[]> {
  const {
    volume,
    worldContext,
    prevVolumeSummary,
    characterContext,
    worldRulesContext,
    userHint,
    targetChapterCount,
    onProgress,
    onChunkReady,
    signal,
  } = options
  
  const config = useAIConfigStore.getState().config
  const chunks = generateChunks(targetChapterCount)
  const allChapters: ParsedChapter[] = []
  let prevChunkEnding = prevVolumeSummary
  
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    if (signal?.aborted) {
      return allChapters
    }
    
    const chunk = chunks[chunkIndex]
    const chaptersInChunk = chunk.endChapter - chunk.startChapter + 1
    
    onProgress?.(
      `正在生成「${chunk.title}」（第${chunk.startChapter}-${chunk.endChapter}章）`,
      chunkIndex + 1,
      chunks.length,
    )
    
    const optionsCount = onChunkReady ? 3 : 1
    const chunkOptions: ChunkOption[] = []
    
    const variantDescriptions = [
      '标准剧情走向',
      '冲突增强版（更多悬念和转折）',
      '情感细腻版（注重角色发展）',
    ]
    
    for (let optIndex = 0; optIndex < optionsCount; optIndex++) {
      if (signal?.aborted) {
        return allChapters
      }
      
      onProgress?.(
        `正在生成选项${optIndex + 1}：「${variantDescriptions[optIndex]}」...`,
        chunkIndex + 1,
        chunks.length,
      )
      
      const variantHints = [
        '',
        '\n\n【变体要求】请采用更具冲突性的剧情走向，增加更多悬念和转折。',
        '\n\n【变体要求】请采用更温和的剧情走向，注重角色情感发展和细节描写。',
      ]
      
      const messages = buildChapterOutlinePrompt(
        volume.title,
        volume.summary,
        worldContext,
        prevChunkEnding,
        `${userHint || ''}\n\n【分块约束】\n本块目标：${chunk.purpose}\n情绪基调：${chunk.emotionalTone}\n节奏：${chunk.pace}\n本块章节数：${chaptersInChunk}章\n本块章节范围：第${chunk.startChapter}-${chunk.endChapter}章\n\n【边界约束】\n1. 本块结束时，主角能力等级不能超过卷纲设定的上限\n2. 本块不能引入超过2个新角色\n3. 本块必须推进主线至少1个阶段\n4. 本块结束状态必须能够平滑过渡到下一块${variantHints[optIndex]}`,
        {
          parameterValues: {
            chaptersPerVolume: chaptersInChunk,
            pace: chunk.pace,
          },
        },
        characterContext,
        worldRulesContext,
      )
      
      let rawOutput: string
      try {
        rawOutput = await chat(messages, config, { category: 'outline.chapter', projectId: volume.projectId })
      } catch (err) {
        console.error(`[ChunkedOutline] 块「${chunk.title}」选项${optIndex + 1}生成失败:`, err)
        continue
      }
      
      onProgress?.(
        `正在解析选项${optIndex + 1}的章节结构...`,
        chunkIndex + 1,
        chunks.length,
      )
      
      const parsed = await parseChapterOutlineSmart(rawOutput, config)
      
      onProgress?.(
        `正在检测选项${optIndex + 1}的情节偏离度...`,
        chunkIndex + 1,
        chunks.length,
      )
      
      const deviation = await analyzeDeviation(
        volume.summary,
        parsed,
        worldRulesContext || '',
      )
      
      let finalChapters = parsed
      if (deviation.score > 60) {
        onProgress?.(
          `⚠️ 选项${optIndex + 1}情节偏离（偏离度${deviation.score}%），正在自动调整...`,
          chunkIndex + 1,
          chunks.length,
        )
        
        const adjustedMessages = buildChapterOutlinePrompt(
          volume.title,
          volume.summary,
          worldContext,
          prevChunkEnding,
          `${userHint || ''}\n\n【分块约束】\n本块目标：${chunk.purpose}\n情绪基调：${chunk.emotionalTone}\n节奏：${chunk.pace}\n本块章节数：${chaptersInChunk}章\n\n【挽救约束】\n检测到以下偏离：\n${deviation.warnings.join('\n')}\n\n请在保持情节合理性的前提下，将上述偏离修正，确保本块结束时能够回归卷纲设定的轨道。`,
          {
            parameterValues: {
              chaptersPerVolume: chaptersInChunk,
              pace: chunk.pace,
            },
          },
          characterContext,
          worldRulesContext,
        )
        
        try {
          rawOutput = await chat(adjustedMessages, config, { category: 'outline.chapter', projectId: volume.projectId })
          const adjusted = await parseChapterOutlineSmart(rawOutput, config)
          finalChapters = adjusted
        } catch {
        }
      }
      
      chunkOptions.push({
        id: `opt-${chunkIndex}-${optIndex}`,
        chapters: finalChapters,
        description: variantDescriptions[optIndex],
        deviation: deviation,
      })
      
      onProgress?.(
        `选项${optIndex + 1}「${variantDescriptions[optIndex]}」完成（偏离度${deviation.score}%）`,
        chunkIndex + 1,
        chunks.length,
      )
    }
    
    let selectedOption: ChunkOption
    
    if (chunkOptions.length === 0) {
      onProgress?.(
        `⚠️ 块「${chunk.title}」所有选项生成失败，使用空章节继续`,
        chunkIndex + 1,
        chunks.length,
      )
      selectedOption = {
        id: `opt-${chunkIndex}-0`,
        chapters: [],
        description: '默认',
        deviation: {
          score: 0,
          dimensionScores: { plotGoal: 0, characterState: 0, worldConsistency: 0, foreshadowing: 0, mainLine: 0 },
          warnings: [],
          suggestions: [],
        },
      }
    } else if (onChunkReady) {
      onProgress?.(
        `「${chunk.title}」已生成 ${chunkOptions.length} 个选项，请选择...`,
        chunkIndex + 1,
        chunks.length,
      )
      const result = await onChunkReady(chunk, chunkOptions)
      selectedOption = result || chunkOptions[0]
    } else {
      selectedOption = chunkOptions[0]
    }
    
    const renumbered = selectedOption.chapters.map((ch, idx) => ({
      ...ch,
      title: ch.title.replace(/第\d+章/, `第${allChapters.length + idx + 1}章`),
    }))
    
    allChapters.push(...renumbered)
    
    if (renumbered.length > 0) {
      prevChunkEnding = renumbered[renumbered.length - 1].summary
    }
    
    onProgress?.(
      `「${chunk.title}」完成（${renumbered.length}章）`,
      chunkIndex + 1,
      chunks.length,
    )
  }
  
  const finalChapters = allChapters.slice(0, targetChapterCount)
  finalChapters.forEach((ch, idx) => {
    ch.title = ch.title.replace(/第\d+章/, `第${idx + 1}章`)
  })
  
  return finalChapters
}

export function getSalvageOptions(deviation: DeviationAnalysis): SalvageOption[] {
  const options: SalvageOption[] = [
    {
      type: 'auto-adjust',
      label: '自动微调',
      description: '在后续章节中自然调整，不引入专门的挽救章节',
    },
  ]
  
  if (deviation.score > 60) {
    options.push({
      type: 'transition-chapters',
      label: '生成过渡章节',
      description: '添加专门的过渡章节，将情节拉回正轨',
      estimatedAdditionalChapters: 2,
    })
  }
  
  options.push(
    {
      type: 'regenerate',
      label: '重新生成',
      description: '丢弃当前块，基于之前的状态重新生成',
    },
    {
      type: 'ignore',
      label: '忽略',
      description: '继续当前方向（可能导致后续断层）',
    },
  )
  
  return options
}

export { generateChunks }
