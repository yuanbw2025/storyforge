/**
 * 章纲生成模式定义
 * Phase 1: 快速模式 vs 精细模式（五块型）
 */

export type GenerationMode = 'quick' | 'chunked'

/**
 * 分块配置（用于精细模式）
 */
export interface ChunkedBlockConfig {
  /** 块序号 (0-based) */
  index: number
  /** 该块章节数 */
  chapterCount: number
  /** 该块占总章数比例 */
  ratio: number
  /** 该块章节序号范围 [start, end] */
  chapterRange: [number, number]
  /** 该块的叙事侧重提示（预生成，可由5轨引擎计算） */
  narrativeFocus?: string
}

/**
 * 黄金比例分块配置（支持 3-7 块）
 */
export const BLOCK_CONFIGS: Record<number, Array<{ label: string; ratio: number }>> = {
  3: [
    { label: '开篇铺垫', ratio: 0.20 },
    { label: '矛盾升级', ratio: 0.50 },
    { label: '高潮与收尾', ratio: 0.30 },
  ],
  4: [
    { label: '铺垫', ratio: 0.15 },
    { label: '发展', ratio: 0.30 },
    { label: '高潮', ratio: 0.35 },
    { label: '收尾', ratio: 0.20 },
  ],
  5: [
    { label: '铺垫', ratio: 0.15 },
    { label: '发展', ratio: 0.25 },
    { label: '高潮积累', ratio: 0.30 },
    { label: '高潮爆发', ratio: 0.20 },
    { label: '收尾', ratio: 0.10 },
  ],
  6: [
    { label: '开篇', ratio: 0.12 },
    { label: '铺垫', ratio: 0.18 },
    { label: '发展', ratio: 0.22 },
    { label: '高潮积累', ratio: 0.18 },
    { label: '高潮爆发', ratio: 0.20 },
    { label: '收尾', ratio: 0.10 },
  ],
  7: [
    { label: '序章', ratio: 0.08 },
    { label: '铺垫', ratio: 0.14 },
    { label: '发展', ratio: 0.18 },
    { label: '转折', ratio: 0.16 },
    { label: '高潮积累', ratio: 0.16 },
    { label: '高潮爆发', ratio: 0.18 },
    { label: '收尾', ratio: 0.10 },
  ],
}

export const GOLDEN_RATIO_BLOCKS = BLOCK_CONFIGS[5]

/**
 * 精细模式配置
 */
export interface ChunkedGenerationConfig {
  /** 分块数（默认 5） */
  blockCount: number
  /** 每章目标字数 */
  wordsPerChapter: number
  /** 每块剧情走向选项数（n选一，默认 3） */
  choicesPerBlock: number
  /** 是否启用5轨叙事引擎（章内细纲） */
  enableNarrativeEngine: boolean
}

/**
 * 默认为精细模式配置
 */
export const DEFAULT_CHUNKED_CONFIG: ChunkedGenerationConfig = {
  blockCount: 5,
  wordsPerChapter: 3000,
  choicesPerBlock: 1,
  enableNarrativeEngine: false,
}

/**
 * 将总章数按黄金比例分为 N 块
 * @param totalChapters 总章数
 * @param blockCount 分块数
 * @returns 各块的章节配置
 */
export function divideChaptersIntoBlocks(
  totalChapters: number,
  blockCount: number = 5,
): ChunkedBlockConfig[] {
  if (totalChapters <= 0) return []
  
  const config = BLOCK_CONFIGS[blockCount] || BLOCK_CONFIGS[5]
  const ratios = config.map(b => b.ratio)
  const labels = config.map(b => b.label)
  const normalizedRatios = ratios.map(r => r / ratios.reduce((a, b) => a + b, 0))
  
  const blocks: ChunkedBlockConfig[] = []
  let assigned = 0
  const remainders: number[] = []
  
  for (let i = 0; i < blockCount; i++) {
    const exact = totalChapters * normalizedRatios[i]
    const floor = Math.floor(exact)
    blocks.push({
      index: i,
      chapterCount: floor,
      ratio: normalizedRatios[i],
      chapterRange: [0, 0],
      narrativeFocus: labels[i],
    })
    remainders.push(exact - floor)
    assigned += floor
  }
  
  let remaining = totalChapters - assigned
  const sortedRemainders = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r - a.r)
  
  for (let i = 0; i < remaining; i++) {
    blocks[sortedRemainders[i % sortedRemainders.length].i].chapterCount++
  }
  
  let start = 0
  for (const block of blocks) {
    const end = start + block.chapterCount - 1
    block.chapterRange = [start, end]
    start = end + 1
  }
  
  return blocks
}

/**
 * 获取指定块数配置的标签列表
 */
export function getBlockLabels(blockCount: number): string[] {
  const config = BLOCK_CONFIGS[blockCount] || BLOCK_CONFIGS[5]
  return config.map(b => b.label)
}

/**
 * 生成模式的用户友好描述
 */
export const GENERATION_MODE_LABELS: Record<GenerationMode, { label: string; description: string }> = {
  quick: {
    label: '快速生成',
    description: '一次性生成所有章节大纲，速度快，适合快速填充或草稿创作',
  },
  chunked: {
    label: '精细生成',
    description: '分块生成 + 剧情走向选择，质量高，适合正式创作',
  },
}
