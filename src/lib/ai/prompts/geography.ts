import type { ChatMessage } from '../../types'
import type { Location } from '../../types'

/**
 * 构建 AI 概念地图 prompt
 * AI 返回一段合法的 SVG 代码，描绘各地点的位置关系
 */
export function buildConceptMapPrompt(
  overview: string,
  locations: Location[],
): ChatMessage[] {
  const locationList = locations
    .map(l => `- ${l.name}（${l.type}）：${l.description || '无描述'}${l.parentId ? `，隶属于 ${locations.find(p => p.id === l.parentId)?.name || '未知'}` : ''}`)
    .join('\n')

  const system = `你是一位专业的奇幻世界地图设计师。你的任务是根据给定的世界地理信息，生成一段 SVG 代码来可视化这个世界的地点分布。

要求：
1. 输出**只包含**一段完整的 SVG 代码，不要有任何其他文字说明
2. SVG 尺寸固定为 width="800" height="500"
3. 背景用深色（#0f172a 或类似色），整体风格是奇幻地图
4. 每个地点用一个圆圈 + 标签表示，按照地理逻辑合理分布（大陆最大最中央，国家次之，城市更小）
5. 用不同颜色区分地点类型：大陆#f59e0b 国家#6366f1 城市#22c55e 门派#ec4899 秘境#a78bfa 遗迹#94a3b8 战场#ef4444 自然#14b8a6 建筑#60a5fa 其他#94a3b8
6. 父子关系用虚线连接
7. 添加简单的装饰元素（如边框、图例）使其更像地图
8. 文字使用 font-family="PingFang SC, Microsoft YaHei, sans-serif"，确保中文可读
9. 地点数量较多时适当缩小节点，保证不重叠`

  const user = `世界总述：${overview || '（无）'}

地点列表：
${locationList || '（暂无地点）'}

请生成 SVG 概念地图代码。`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/**
 * 构建世界地图图像生成 prompt（用于 Midjourney / DALL-E / Stable Diffusion）
 */
export function buildImageMapPrompt(
  projectName: string,
  overview: string,
  locations: Location[],
): string {
  const locationNames = locations.slice(0, 12).map(l => l.name).join(', ')
  const locationTypes = [...new Set(locations.map(l => l.type))].join(', ')

  const hasFantasy = overview.includes('修') || overview.includes('仙') || overview.includes('魔') || overview.includes('武')
  const style = hasFantasy ? 'fantasy RPG world map, hand-drawn parchment style' : 'epic fantasy world map, aged parchment'

  return `${style}, top-down view, detailed cartography, ${projectName} world, featuring locations: ${locationNames || 'various kingdoms and cities'}, terrain types: ${locationTypes}, ornate compass rose, decorative border, illustrated mountains forests oceans, old map aesthetic, warm sepia tones with color accents, highly detailed, 4k, --ar 16:9`
}
