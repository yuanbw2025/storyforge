/**
 * Voronoi 地图 AI 适配器
 * AI 分析世界观设定 → 生成 MapGenConfig 参数（含地形模板 + 命名风格） → 引擎生成地图
 */

import type { ChatMessage, Location, Worldview } from '../../types'
import type { MapGenConfig, HeightmapTemplate, NamingStyle } from '../../world-map/engine'

/** 合法值白名单 */
const VALID_TEMPLATES: HeightmapTemplate[] = [
  'continents', 'pangea', 'archipelago', 'volcano', 'isthmus',
  'peninsula', 'mediterranean', 'atoll', 'shattered', 'highland',
]
const VALID_NAMING: NamingStyle[] = [
  'chinese', 'japanese', 'european', 'arabic', 'highFantasy', 'darkFantasy',
]

/**
 * 构建 AI prompt，让 AI 根据世界观描述输出 MapGenConfig
 */
export function buildVoronoiMapPrompt(
  worldview: Partial<Worldview> | null,
  overview: string,
  locations: Location[],
): ChatMessage[] {
  // 拼接世界观上下文
  const contextParts: string[] = []

  if (worldview?.worldStructure)
    contextParts.push(`【世界结构】${worldview.worldStructure}`)
  if (worldview?.worldDimensions)
    contextParts.push(`【世界尺寸】${worldview.worldDimensions}`)
  if (worldview?.continentLayout)
    contextParts.push(`【大陆分布】${worldview.continentLayout}`)
  if (worldview?.mountainsRivers)
    contextParts.push(`【山川河流】${worldview.mountainsRivers}`)
  if (worldview?.climateByRegion)
    contextParts.push(`【气候分区】${worldview.climateByRegion}`)
  if (worldview?.factionLayout)
    contextParts.push(`【势力分布】${worldview.factionLayout}`)
  if (worldview?.races)
    contextParts.push(`【种族设定】${worldview.races}`)
  if (worldview?.politicsEconomyCulture)
    contextParts.push(`【政治经济文化】${worldview.politicsEconomyCulture}`)
  if (overview)
    contextParts.push(`【地理总述】${overview}`)

  const locationList = locations.length > 0
    ? locations
        .map(l => `- ${l.name}（${l.type}）：${l.description || '无描述'}`)
        .join('\n')
    : ''

  const worldContext = contextParts.length > 0
    ? contextParts.join('\n')
    : '（用户未填写世界观描述，请生成一个中文古风奇幻世界）'

  const systemPrompt = `你是一位奇幻世界地图参数设计师。你需要根据用户的世界观文字描述，输出一组地图生成引擎的配置参数（JSON），引擎会用 Voronoi 细分算法自动生成完整的地形、河流、生态群落和城市。

**你的任务**：
分析用户的世界设定文字，将其转化为以下参数。你不需要指定具体的坐标或多边形——引擎会自动生成地形。你只需要控制宏观参数和命名。

**严格要求**：
1. 返回**纯 JSON**，不要用 markdown 包裹，不要添加解释文字
2. JSON 必须能被 JSON.parse() 直接解析

**参数说明**：
{
  "seed": "随机种子字符串",
  "mapName": "世界名称",
  "pointCount": 10000,
  "landRatio": 0.45,
  "continentCount": 2,
  "stateCount": 8,
  "burgDensity": 0.5,
  "temperatureShift": 0,
  "precipitationFactor": 1.0,

  "heightmapTemplate": "continents",
  // 地形模板，从以下选一个：
  // "continents"    — 多大陆（默认，多块独立大陆+海洋）
  // "pangea"        — 盘古大陆（一整块超级大陆）
  // "archipelago"   — 群岛（大量分散小岛）
  // "volcano"       — 火山岛（中心高峰的单体岛屿）
  // "isthmus"       — 地峡（两块大陆以窄桥相连）
  // "peninsula"     — 半岛（从大陆延伸出的狭长半岛）
  // "mediterranean" — 内海/地中海（大陆环绕中心海域）
  // "atoll"         — 环礁（环状珊瑚岛链）
  // "shattered"     — 碎裂大陆（原本一体后来碎裂）
  // "highland"      — 高原（大面积平坦高地+边缘山脉）

  "namingStyle": "chinese",
  // 命名风格，从以下选一个：
  // "chinese"     — 中文古风（修仙/武侠/东方奇幻）
  // "japanese"    — 日式和风（和风/忍者/阴阳师）
  // "european"    — 欧洲中世纪（骑士/城堡/剑与魔法）
  // "arabic"      — 阿拉伯/沙漠（一千零一夜风格）
  // "highFantasy" — 高魔奇幻（精灵/矮人/龙）
  // "darkFantasy" — 暗黑奇幻（末世/亡灵/恐怖）

  "stateNames": ["国家1", "国家2", ...],
  "burgNames":  ["首都1", "首都2", ..., "城镇1", "城镇2", ...],
  "riverNames": ["河流1", "河流2", ...]
}

**设计指导**：
- 根据世界观风格选择 heightmapTemplate：比如"诸岛"用 archipelago，"一块大陆"用 pangea，"高原"用 highland
- 根据世界观文化氛围选择 namingStyle：中式修仙/武侠 → chinese；和风 → japanese；西方奇幻 → european 或 highFantasy
- 如果世界观提到"北方寒冷"，设 temperatureShift 为负值
- 如果世界观提到"干旱沙漠"，设 precipitationFactor < 0.6
- 如果提到"群岛"，设 landRatio=0.25-0.35 + heightmapTemplate="archipelago"
- 国家名和城市名必须完全匹配所选的 namingStyle 风格
- 如果用户已设定地点名/势力名，优先使用它们，补充的名字风格一致
- burgNames 的前 stateCount 个会作为首都名，之后的作为普通城镇名
- burgNames 长度至少为 stateCount 的 2-3 倍
- **注意**：stateNames/burgNames/riverNames 中的每个名字都必须符合 namingStyle 风格`

  const userPrompt = `请根据以下世界观描述，设计地图生成参数 JSON：

${worldContext}
${locationList ? `\n已设定的地点：\n${locationList}` : ''}

请输出纯 JSON 格式的地图参数。`

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]
}

/**
 * 解析 AI 返回的 JSON 为 MapGenConfig
 */
export function parseVoronoiMapConfig(raw: string): MapGenConfig {
  const cleaned = raw
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim()

  const parsed = JSON.parse(cleaned)

  const config: MapGenConfig = {
    width: 1200,
    height: 800,
    seed: String(parsed.seed || Math.floor(Math.random() * 1e10)),
    mapName: parsed.mapName || 'Fantasy World',
    pointCount: clamp(parsed.pointCount || 10000, 5000, 20000),
    landRatio: clamp(parsed.landRatio || 0.45, 0.15, 0.8),
    continentCount: clamp(parsed.continentCount || 2, 1, 5),
    stateCount: clamp(parsed.stateCount || 8, 2, 15),
    burgDensity: clamp(parsed.burgDensity || 0.5, 0.1, 1.5),
    temperatureShift: clamp(parsed.temperatureShift || 0, -20, 20),
    precipitationFactor: clamp(parsed.precipitationFactor || 1.0, 0.2, 3.0),
  }

  // 地形模板
  if (parsed.heightmapTemplate && VALID_TEMPLATES.includes(parsed.heightmapTemplate)) {
    config.heightmapTemplate = parsed.heightmapTemplate
  }

  // 命名风格
  if (parsed.namingStyle && VALID_NAMING.includes(parsed.namingStyle)) {
    config.namingStyle = parsed.namingStyle
  }

  // 名称列表
  if (Array.isArray(parsed.stateNames) && parsed.stateNames.length > 0) {
    config.stateNames = parsed.stateNames.map(String)
  }
  if (Array.isArray(parsed.burgNames) && parsed.burgNames.length > 0) {
    config.burgNames = parsed.burgNames.map(String)
  }
  if (Array.isArray(parsed.riverNames) && parsed.riverNames.length > 0) {
    config.riverNames = parsed.riverNames.map(String)
  }

  return config
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}
