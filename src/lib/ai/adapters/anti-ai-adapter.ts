/**
 * 去AI味增强适配器 — Phase F2
 *
 * 五维检测：词汇、句法、叙事、情感、对话
 */

export interface AntiAIDimension {
  dimension: 'vocabulary' | 'syntax' | 'narrative' | 'emotion' | 'dialogue'
  score: number  // 0-100, 越高越好（越少AI味）
  markers: string[]  // 发现的典型AI痕迹
  suggestion: string
}

export interface AntiAIResult {
  overallScore: number
  dimensions: AntiAIDimension[]
  highFreqWords: string[]  // 高频重复词汇
  rewriteSuggestions: string[]
}

export const ANTI_AI_DIMENSION_LABELS: Record<string, string> = {
  vocabulary: '词汇多样性',
  syntax: '句式变化',
  narrative: '展示vs告知',
  emotion: '情感真实感',
  dialogue: '对话自然度',
}

/**
 * 统计正文中的高频词（辅助 AI 检测）
 */
export function extractHighFreqWords(text: string, threshold = 5): string[] {
  // 常见的 AI 高频词列表
  const suspects = [
    '不禁', '缓缓', '竟然', '顿时', '微微', '淡淡', '一丝', '不由得',
    '嘴角', '心中', '脸上', '眼中', '此刻', '瞬间', '随即', '紧接着',
    '说道', '答道', '笑道', '冷哼', '沉声', '低语',
    '居然', '忍不住', '情不自禁', '若有所思', '恍然大悟',
  ]

  const counts: Record<string, number> = {}
  for (const word of suspects) {
    const regex = new RegExp(word, 'g')
    const matches = text.match(regex)
    if (matches && matches.length >= threshold) {
      counts[word] = matches.length
    }
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([word, count]) => `${word}(${count}次)`)
}
