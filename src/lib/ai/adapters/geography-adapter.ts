import type { ChatMessage, Location } from '../../types'
import { usePromptStore } from '../../../stores/prompt'
import { useWorldviewStore } from '../../../stores/worldview'
import { renderPrompt } from '../prompt-engine'

/** 从世界观 store 提取与地理相关的上下文 */
function getWorldviewGeoContext(): string {
  const wv = useWorldviewStore.getState().worldview
  if (!wv) return ''
  const parts: string[] = []
  if (wv.worldOrigin)      parts.push(`【世界来源】${wv.worldOrigin.slice(0, 150)}`)
  if (wv.worldStructure)   parts.push(`【世界结构】${wv.worldStructure.slice(0, 150)}`)
  if (wv.continentLayout)  parts.push(`【地貌分布】${wv.continentLayout.slice(0, 200)}`)
  if (wv.mountainsRivers)  parts.push(`【山川水系】${wv.mountainsRivers.slice(0, 150)}`)
  if (wv.climateByRegion)  parts.push(`【气候环境】${wv.climateByRegion.slice(0, 100)}`)
  if (wv.regionDimensions) parts.push(`【重镇分布】${wv.regionDimensions.slice(0, 100)}`)
  return parts.length ? `\n\n=== 世界观已有设定（请保持一致）===\n${parts.join('\n')}` : ''
}

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

  // 注入世界观自然环境上下文，让概念地图与世界观设定保持一致
  const worldCtx = getWorldviewGeoContext()

  const tpl = usePromptStore.getState().getActive('geography.concept-map')
  const { messages } = renderPrompt(tpl, {
    overview: (overview || '（无）') + worldCtx,
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
