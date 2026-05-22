import type { ChatMessage, Location } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'

/**
 * 构建 AI 概念地图 prompt（API 与旧 src/lib/ai/prompts/geography.ts 一致）
 * AI 返回一段合法的 SVG 代码，描绘各地点的位置关系。
 */
export function buildConceptMapPrompt(
  overview: string,
  locations: Location[],
): ChatMessage[] {
  const locationList = locations
    .map(l => `- ${l.name}（${l.type}）：${l.description || '无描述'}${l.parentId ? `，隶属于 ${locations.find(p => p.id === l.parentId)?.name || '未知'}` : ''}`)
    .join('\n')

  const tpl = usePromptStore.getState().getActive('geography.concept-map')
  const { messages } = renderPrompt(tpl, {
    overview: overview || '（无）',
    locationList: locationList || '（暂无地点）',
  })
  return messages
}

/** 构建世界地图图像生成 prompt（用于 Midjourney / DALL-E / Stable Diffusion） */
export function buildImageMapPrompt(
  projectName: string,
  overview: string,
  locations: Location[],
): string {
  const locationNames = locations.slice(0, 12).map(l => l.name).join(', ') || 'various kingdoms and cities'
  const locationTypes = [...new Set(locations.map(l => l.type))].join(', ')

  const hasFantasy = overview.includes('修') || overview.includes('仙') || overview.includes('魔') || overview.includes('武')
  const imageStyle = hasFantasy
    ? 'fantasy RPG world map, hand-drawn parchment style'
    : 'epic fantasy world map, aged parchment'

  const tpl = usePromptStore.getState().getActive('geography.image-map-prompt')
  const { messages } = renderPrompt(tpl, {
    imageStyle,
    projectName,
    locationNames,
    locationTypes,
  })
  // 该模板没有 system prompt，messages[0] 即 user 内容字符串
  return messages[0]?.content ?? ''
}
