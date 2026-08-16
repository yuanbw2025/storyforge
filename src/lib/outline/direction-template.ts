export interface DirectionTemplate {
  title: string
  coreConflict: string
  characterChange: string
  keyEvents: string[]
  mainNarrativeTrack: string
  tension: number
}

export const EMPTY_DIRECTION_TEMPLATE: DirectionTemplate = {
  title: '',
  coreConflict: '',
  characterChange: '',
  keyEvents: [],
  mainNarrativeTrack: '',
  tension: 5,
}

export function parseDirectionTemplate(rawOutput: string): DirectionTemplate {
  const jsonMatch = rawOutput.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    return fallbackParse(rawOutput)
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      title: parsed.title || extractTitle(rawOutput),
      coreConflict: parsed.coreConflict || '',
      characterChange: parsed.characterChange || '',
      keyEvents: Array.isArray(parsed.keyEvents) ? parsed.keyEvents : [],
      mainNarrativeTrack: parsed.mainNarrativeTrack || '',
      tension: typeof parsed.tension === 'number' ? parsed.tension : 5,
    }
  } catch {
    return fallbackParse(rawOutput)
  }
}

function fallbackParse(rawOutput: string): DirectionTemplate {
  const title = extractTitle(rawOutput)
  const lines = rawOutput.split('\n').map(l => l.trim()).filter(l => l)
  
  const sections: Record<string, string> = {}
  let currentKey = ''
  
  for (const line of lines) {
    if (/^(核心冲突|角色关系|关键事件|叙事|张力|tension|冲突|角色|事件)/.test(line)) {
      currentKey = line.split(/[:：]/)[0].trim()
      sections[currentKey] = ''
    } else if (currentKey && !line.startsWith('{') && !line.startsWith('}')) {
      sections[currentKey] += (sections[currentKey] ? '\n' : '') + line
    }
  }
  
  const keyEvents: string[] = []
  const eventSection = sections['关键事件'] || sections['事件'] || ''
  if (eventSection) {
    const eventLines = eventSection.split('\n').filter(l => /^[\d]+\.|^[-*•]/.test(l.trim()))
    for (const el of eventLines) {
      const cleaned = el.replace(/^[\d]+\.|^[-*•]\s*/, '').trim()
      if (cleaned) keyEvents.push(cleaned)
    }
  }
  
  let tension = 5
  const tensionMatch = rawOutput.match(/tension[:：]\s*(\d+)/i) || rawOutput.match(/张力[:：]\s*(\d+)/)
  if (tensionMatch) {
    tension = Math.max(1, Math.min(10, parseInt(tensionMatch[1], 10)))
  }
  
  return {
    title,
    coreConflict: sections['核心冲突'] || sections['冲突'] || lines.find(l => l.includes('冲突')) || '',
    characterChange: sections['角色关系'] || sections['角色'] || lines.find(l => l.includes('关系')) || '',
    keyEvents,
    mainNarrativeTrack: sections['叙事'] || '',
    tension,
  }
}

function extractTitle(text: string): string {
  const match = text.match(/《(.+?)》/)
  if (match) return match[1]
  const firstLine = text.split('\n').find(l => l.trim()) || ''
  if (firstLine.length > 30) return firstLine.slice(0, 30)
  return firstLine || '未命名方案'
}

export const DIRECTION_TEMPLATE_PROMPT = (blockIndex: number, blockLabel: string, chapterRange: [number, number], blockCount: number, hint?: string): string => `
【当前块定位】第 ${blockIndex + 1} 块，标题为「${blockLabel}」，章节 ${chapterRange[0] + 1}-${chapterRange[1] + 1}，共 ${blockCount} 章

${hint ? `【补充说明】${hint}\n` : ''}
【固定输出格式】请严格使用以下 JSON 格式输出剧情走向方案：

\`\`\`json
{
  "title": "方案标题（用《》包裹，如《暗流涌动》）",
  "coreConflict": "核心冲突与转折点（50-100字）",
  "characterChange": "角色关系变化（50-100字）",
  "keyEvents": ["事件1描述", "事件2描述", "事件3描述"],
  "mainNarrativeTrack": "主叙事侧重（如：角色动力轨/危机轨/关系轨/信息轨/环境轨）",
  "tension": 5
}
\`\`\`

【格式要求】
1. 严格使用 JSON 格式，用 \`\`\`json 和 \`\`\` 包裹
2. 所有字段必须填写，不允许空值
3. keyEvents 数组包含 3-5 个关键事件
4. tension 范围 1-10，表示本块的整体紧张度（1最舒缓，10最紧张）
5. mainNarrativeTrack 选择：角色动力轨、危机轨、关系轨、信息轨、环境轨

【内容要求】
- 本方案必须是独立且完整的剧情走向，覆盖整个 ${blockCount} 章
- 冲突设计要有层次，体现从开篇到收尾的完整弧线
- 角色变化要具体，不能泛泛而谈
- 关键事件要具体到能直接作为章纲核心
`

export const NARRATIVE_TRACKS = {
  momentum: '角色动力轨',
  crisis: '危机轨',
  relationship: '关系轨',
  info: '信息轨',
  environment: '环境轨',
} as const

export type NarrativeTrackKey = keyof typeof NARRATIVE_TRACKS

export function translateTrackName(track: string): string {
  return NARRATIVE_TRACKS[track as NarrativeTrackKey] || track
}
