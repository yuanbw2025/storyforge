/**
 * Voronoi 地图 AI 适配器
 * AI 分析世界观设定 → 生成 MapGenConfig 参数（含地形模板 + 命名风格） → 引擎生成地图
 */

import type { ChatMessage, Location, Worldview } from '../../types'
import type {
  MapGenConfig,
  HeightmapTemplate,
  NamingStyle,
  MapSpatialEntity,
  MapSpatialRelation,
  SpatialEntityKind,
  SpatialScaleTier,
  SpatialDirection,
  SpatialDistanceTier,
  SpatialDistanceUnit,
} from '../../world-map/engine'

/** 合法值白名单 */
const VALID_TEMPLATES: HeightmapTemplate[] = [
  'continents', 'pangea', 'archipelago', 'volcano', 'isthmus',
  'peninsula', 'mediterranean', 'atoll', 'shattered', 'highland',
]
const VALID_NAMING: NamingStyle[] = [
  'chinese', 'japanese', 'european', 'arabic', 'highFantasy', 'darkFantasy',
]
const VALID_ENTITY_KINDS: SpatialEntityKind[] = [
  'state', 'settlement', 'fortress', 'mountain', 'river', 'region', 'landmark',
]
const VALID_SCALE_TIERS: SpatialScaleTier[] = [
  'supercontinent', 'empire', 'kingdom', 'province', 'metropolis',
  'city', 'town', 'village', 'fortress', 'landmark',
]
const VALID_DIRECTIONS: SpatialDirection[] = [
  'north', 'north-east', 'east', 'south-east',
  'south', 'south-west', 'west', 'north-west',
]
const VALID_DISTANCE_TIERS: SpatialDistanceTier[] = [
  'adjacent', 'near', 'medium', 'far', 'very-far',
]
const VALID_DISTANCE_UNITS: SpatialDistanceUnit[] = ['km', 'li', 'day', 'month']

export const VORONOI_MAP_PROMPT_VERSION_V1 = 'world-map-config-v1' as const

/**
 * 构建 AI prompt，让 AI 根据世界观描述输出 MapGenConfig
 */
export function buildVoronoiMapPrompt(
  worldview: Partial<Worldview> | null,
  overview: string,
  locations: Location[],
  /** 自然/人文词条上下文（用户逐条登记的具体山川/势力/城池等），由 buildCodexContext 提供 */
  codexContext = '',
): ChatMessage[] {
  // 拼接世界观上下文 —— 读全用户已填的一切相关内容,一项不漏
  const contextParts: string[] = []

  if (worldview?.worldStructure)
    contextParts.push(`【世界结构】${worldview.worldStructure}`)
  if (worldview?.worldDimensions)
    contextParts.push(`【世界尺寸/疆域】${worldview.worldDimensions}`)
  if (worldview?.continentLayout)
    contextParts.push(`【地貌/大陆分布】${worldview.continentLayout}`)
  if (worldview?.mountainsRivers)
    contextParts.push(`【山川水系】${worldview.mountainsRivers}`)
  if (worldview?.climateByRegion)
    contextParts.push(`【气候环境】${worldview.climateByRegion}`)
  if (worldview?.naturalResourceOverview)
    contextParts.push(`【自然资源】${worldview.naturalResourceOverview}`)
  if (worldview?.factionLayout)
    contextParts.push(`【势力分布】${worldview.factionLayout}`)
  if (worldview?.regionDimensions)
    contextParts.push(`【城池重镇】${worldview.regionDimensions}`)
  if (worldview?.races)
    contextParts.push(`【种族设定】${worldview.races}`)
  if (worldview?.politicsOverview)
    contextParts.push(`【政治制度】${worldview.politicsOverview}`)
  if (worldview?.economyOverview)
    contextParts.push(`【经济制度】${worldview.economyOverview}`)
  if (worldview?.cultureOverview)
    contextParts.push(`【文化制度】${worldview.cultureOverview}`)
  if (overview)
    contextParts.push(`【地理总述】${overview}`)
  if (codexContext && codexContext.trim())
    contextParts.push(`【已登记词条（具体山川/势力/城池等，名字务必采用）】\n${codexContext.trim()}`)

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
分析用户的世界设定文字，将其转化为以下参数。你不需要指定具体的坐标或多边形——本地约束求解器会计算坐标，引擎会自动生成地形。你只需要控制宏观参数、命名和定性空间关系。

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
  "riverNames": ["河流1", "河流2", ...],
  "mapWidthKm": 3000,
  "mapWidthEvidenceQuote": "东西横跨三千公里",
  "spatialEntities": [
    {
      "name": "天南帝国",
      "kind": "state",
      "scaleTier": "empire",
      "capitalName": "天南城",
      "source": "explicit",
      "evidenceQuote": "天南帝国以天南城为都"
    },
    {
      "name": "落雁镇",
      "kind": "settlement",
      "scaleTier": "town",
      "source": "explicit",
      "evidenceQuote": "边陲·落雁镇"
    },
    {
      "name": "天南城",
      "kind": "settlement",
      "scaleTier": "metropolis",
      "source": "explicit",
      "evidenceQuote": "天南城"
    }
  ],
  "spatialRelations": [
    {
      "from": "落雁镇",
      "to": "天南城",
      "direction": "north-west",
      "distanceTier": "far",
      "distanceValue": 100,
      "distanceUnit": "li",
      "source": "explicit",
      "evidenceQuote": "落雁镇在天南城西北百里"
    }
  ]
}

**空间约束枚举**：
- kind 只能是 state / settlement / fortress / mountain / river / region / landmark
- scaleTier 只能是 supercontinent / empire / kingdom / province / metropolis / city / town / village / fortress / landmark
- direction 表示 from 位于 to 的哪个方向，只能是 north / north-east / east / south-east / south / south-west / west / north-west
- distanceTier 只能是 adjacent / near / medium / far / very-far
- distanceUnit 只能是 km（公里）/ li（里）/ day（日程）/ month（月程）

**【铁律 · 必须尊重用户已设定的内容】**：
- 用户在上文写明的**势力 / 国家名**，必须原样放进 stateNames；写明的**城池 / 重镇 / 重要地点名**（含「城池重镇」「已登记词条」「已设定地点」里的），必须原样放进 burgNames；写明的**山川 / 河流名**（含「山川水系」「词条」里的），必须原样放进 riverNames。**一个都不许漏、不许改名。**
- **数量以用户为准**：用户写了几个势力，stateCount 就按几个（再适当±）；用户列了多少城池，burgNames 至少要含全这些。
- 用户没给、但地图需要的元素（还缺多少城镇名、地形走向、温湿度档、大陆数等），你**在不与用户已给内容冲突的前提下合理补全**——这是补全，不是覆盖。
- 用户明确写出的国家、聚落、要塞、山脉、河流、区域和地标放入 spatialEntities；明确写出的相对方位、远近或里程放入 spatialRelations。关系两端必须先出现在 spatialEntities 中。
- source="explicit" 时 evidenceQuote 必须是下方用户资料里可以逐字搜索到的连续原文，不得改写、拼接或伪造；没有逐字证据就必须标记 source="inferred" 且不要伪造证据。
- 用户明确提供世界/疆域横向尺寸时才输出 mapWidthKm，并同时给出逐字 mapWidthEvidenceQuote；不要把面积、人口或你的推测当成横向尺寸。
- 不要输出 x/y、经纬度、数据库 ID 或多边形；不要为了凑关系而覆盖用户设定。冲突关系都保留给本地诊断。

**参数设计指导**：
- **遵循历史地理学 · 人地互动常识**：城镇 / 国家依水土而聚——大河流域、海岸、河口、绿洲、平原、交通要冲（渡口 / 关隘 / 港口 / 商路）与矿盐良田是人口与城池密集区；沙漠、极地、高山、密林地广人稀。据此推断：① burgDensity（水土丰美的世界设高，荒漠极地世界设低）；② stateCount 与国界——大山脉 / 宽河 / 沙海是天然疆界，国家依地形分块而非均分；③ 生态配色随气候带。整体让"哪里该有城、哪里该荒、国界沿何处"符合地理逻辑，避免把城镇均匀撒满或撒进不毛之地。
- 根据世界观风格选择 heightmapTemplate：比如"诸岛"用 archipelago，"一块大陆"用 pangea，"高原"用 highland
- 根据世界观文化氛围选择 namingStyle：中式修仙/武侠 → chinese；和风 → japanese；西方奇幻 → european 或 highFantasy
- 如果世界观提到"北方寒冷"，设 temperatureShift 为负值；"干旱沙漠"，设 precipitationFactor < 0.6；"群岛"，设 landRatio=0.25-0.35 + heightmapTemplate="archipelago"
- burgNames 的前 stateCount 个会作为首都名，之后的作为普通城镇名；burgNames 长度至少为 stateCount 的 2-3 倍
- 补全的名字（用户没给的）必须符合所选 namingStyle 风格`

  const userPrompt = `请根据以下世界观描述，设计地图生成参数 JSON：

${worldContext}
${locationList ? `\n已设定的地点：\n${locationList}` : ''}

请输出纯 JSON 格式的地图参数。`

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]
}

/** HARNESS-66: the model-visible project facts are exactly the registered
 * Context Gateway output. The target node name is a frozen write anchor, not a
 * second data-reading path. */
export function buildVoronoiMapPromptFromRegisteredContextV1(
  contextText: string,
  targetNodeName: string,
): ChatMessage[] {
  const messages = buildVoronoiMapPrompt(null, '', [], '')
  messages[1] = {
    role: 'user',
    content: `请根据以下经过登记的当前世界资料，为目标世界“${targetNodeName}”设计地图生成参数 JSON。\n\n${contextText || '（当前登记来源均为空，请生成最小可用地图。）'}\n\nmapName 必须填写目标世界名称“${targetNodeName}”。请输出纯 JSON 格式的地图参数。`,
  }
  return messages
}

export function readVoronoiMapPromptTemplateSnapshotV1(): ChatMessage[] {
  return buildVoronoiMapPromptFromRegisteredContextV1('{{REGISTERED_CONTEXT}}', '{{TARGET_WORLD_NODE}}')
}

const STRICT_TOP_LEVEL_KEYS = [
  'seed', 'mapName', 'pointCount', 'landRatio', 'continentCount', 'stateCount',
  'burgDensity', 'temperatureShift', 'precipitationFactor', 'heightmapTemplate',
  'namingStyle', 'stateNames', 'burgNames', 'riverNames', 'mapWidthKm',
  'mapWidthEvidenceQuote', 'spatialEntities', 'spatialRelations',
] as const
const STRICT_REQUIRED_KEYS = [
  'seed', 'mapName', 'pointCount', 'landRatio', 'continentCount', 'stateCount',
  'burgDensity', 'temperatureShift', 'precipitationFactor', 'heightmapTemplate',
  'namingStyle', 'stateNames', 'burgNames', 'riverNames', 'spatialEntities',
  'spatialRelations',
] as const

function assertExactObjectKeys(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label}必须是对象。`)
  const keys = Object.keys(value)
  const unknown = keys.find(key => !allowed.includes(key))
  const missing = required.find(key => !Object.prototype.hasOwnProperty.call(value, key))
  if (unknown) throw new Error(`${label}包含未允许字段 ${unknown}。`)
  if (missing) throw new Error(`${label}缺少字段 ${missing}。`)
}

function strictNumber(value: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label}超出允许范围。`)
  }
  return value
}

function strictText(value: unknown, label: string, max = 100): string {
  if (typeof value !== 'string' || value.trim().length < 1 || value.trim().length > max) {
    throw new Error(`${label}必须是 1～${max} 字符的非空字符串。`)
  }
  return value.trim()
}

function strictNames(value: unknown, label: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label}必须是不超过 ${max} 项的数组。`)
  const names = value.map((item, index) => strictText(item, `${label}[${index}]`))
  if (new Set(names).size !== names.length) throw new Error(`${label}不得包含重名。`)
  return names
}

/** Current closed map protocol. Malformed model output is rejected, never normalized into new facts. */
export function parseVoronoiMapConfig(raw: string, sourceText: string): MapGenConfig {
  const cleaned = raw.trim()
  if (cleaned.startsWith('```') || cleaned.endsWith('```')) {
    throw new Error('地图配置必须是纯 JSON，不得包含 Markdown 代码围栏。')
  }
  const parsed: unknown = JSON.parse(cleaned)
  assertExactObjectKeys(parsed, STRICT_TOP_LEVEL_KEYS, STRICT_REQUIRED_KEYS, '地图配置')

  const stateCount = strictNumber(parsed.stateCount, 'stateCount', 2, 15, true)
  const stateNames = strictNames(parsed.stateNames, 'stateNames', 15)
  const burgNames = strictNames(parsed.burgNames, 'burgNames', 100)
  const riverNames = strictNames(parsed.riverNames, 'riverNames', 100)
  if (stateNames.length < stateCount) throw new Error('stateNames 数量不得少于 stateCount。')
  if (burgNames.length < stateCount) throw new Error('burgNames 数量不得少于 stateCount。')
  if (!isAllowed(parsed.heightmapTemplate, VALID_TEMPLATES)) throw new Error('heightmapTemplate 不在闭集。')
  if (!isAllowed(parsed.namingStyle, VALID_NAMING)) throw new Error('namingStyle 不在闭集。')

  if (!Array.isArray(parsed.spatialEntities) || parsed.spatialEntities.length > 120) {
    throw new Error('spatialEntities 必须是不超过 120 项的数组。')
  }
  const entityNames = new Set<string>()
  const spatialEntities = parsed.spatialEntities.map((value, index): MapSpatialEntity => {
    assertExactObjectKeys(
      value,
      ['name', 'kind', 'scaleTier', 'capitalName', 'source', 'evidenceQuote'],
      ['name', 'kind', 'source'],
      `spatialEntities[${index}]`,
    )
    const name = strictText(value.name, `spatialEntities[${index}].name`)
    if (entityNames.has(name)) throw new Error(`spatialEntities 出现重复实体 ${name}。`)
    entityNames.add(name)
    if (!isAllowed(value.kind, VALID_ENTITY_KINDS)) throw new Error(`spatialEntities[${index}].kind 不在闭集。`)
    if (value.scaleTier !== undefined && !isAllowed(value.scaleTier, VALID_SCALE_TIERS)) {
      throw new Error(`spatialEntities[${index}].scaleTier 不在闭集。`)
    }
    if (value.capitalName !== undefined && value.kind !== 'state') throw new Error('只有 state 实体可声明 capitalName。')
    if (value.source !== 'explicit' && value.source !== 'inferred') throw new Error('实体 source 不在闭集。')
    const evidenceQuote = value.evidenceQuote === undefined ? undefined : strictText(value.evidenceQuote, '实体 evidenceQuote', 300)
    if (value.source === 'explicit' && (!evidenceQuote || !hasExactEvidence(sourceText, evidenceQuote))) {
      throw new Error(`实体 ${name} 的 explicit 证据不是登记来源逐字引文。`)
    }
    if (value.source === 'inferred' && evidenceQuote !== undefined) throw new Error(`推断实体 ${name} 不得伪装逐字证据。`)
    return {
      name,
      kind: value.kind,
      ...(value.scaleTier === undefined ? {} : { scaleTier: value.scaleTier }),
      ...(value.capitalName === undefined ? {} : { capitalName: strictText(value.capitalName, 'capitalName') }),
      source: value.source,
      ...(evidenceQuote === undefined ? {} : { evidenceQuote }),
    }
  })

  if (!Array.isArray(parsed.spatialRelations) || parsed.spatialRelations.length > 240) {
    throw new Error('spatialRelations 必须是不超过 240 项的数组。')
  }
  const spatialRelations = parsed.spatialRelations.map((value, index): MapSpatialRelation => {
    assertExactObjectKeys(
      value,
      ['from', 'to', 'direction', 'distanceTier', 'distanceValue', 'distanceUnit', 'source', 'evidenceQuote'],
      ['from', 'to', 'source'],
      `spatialRelations[${index}]`,
    )
    const from = strictText(value.from, 'relation.from')
    const to = strictText(value.to, 'relation.to')
    if (from === to || !entityNames.has(from) || !entityNames.has(to)) throw new Error('空间关系端点必须是两个不同的登记实体。')
    if (value.direction !== undefined && !isAllowed(value.direction, VALID_DIRECTIONS)) throw new Error('relation.direction 不在闭集。')
    if (value.distanceTier !== undefined && !isAllowed(value.distanceTier, VALID_DISTANCE_TIERS)) throw new Error('relation.distanceTier 不在闭集。')
    const hasDistance = value.distanceValue !== undefined || value.distanceUnit !== undefined
    if (hasDistance && (value.distanceValue === undefined || !isAllowed(value.distanceUnit, VALID_DISTANCE_UNITS))) {
      throw new Error('distanceValue 与 distanceUnit 必须成对出现。')
    }
    const distanceValue = value.distanceValue === undefined
      ? undefined
      : strictNumber(value.distanceValue, 'relation.distanceValue', 0.001, 10_000_000)
    if (value.direction === undefined && value.distanceTier === undefined && distanceValue === undefined) {
      throw new Error('空间关系至少需要方向、距离档或精确距离之一。')
    }
    if (value.source !== 'explicit' && value.source !== 'inferred') throw new Error('关系 source 不在闭集。')
    const evidenceQuote = value.evidenceQuote === undefined ? undefined : strictText(value.evidenceQuote, '关系 evidenceQuote', 300)
    if (value.source === 'explicit' && (!evidenceQuote || !hasExactEvidence(sourceText, evidenceQuote))) {
      throw new Error(`${from}→${to} 的 explicit 证据不是登记来源逐字引文。`)
    }
    if (value.source === 'inferred' && evidenceQuote !== undefined) throw new Error('推断关系不得伪装逐字证据。')
    return {
      from,
      to,
      ...(value.direction === undefined ? {} : { direction: value.direction }),
      ...(value.distanceTier === undefined ? {} : { distanceTier: value.distanceTier }),
      ...(distanceValue === undefined ? {} : { distanceValue, distanceUnit: value.distanceUnit as SpatialDistanceUnit }),
      source: value.source,
      ...(evidenceQuote === undefined ? {} : { evidenceQuote }),
    }
  })

  const hasMapWidth = parsed.mapWidthKm !== undefined || parsed.mapWidthEvidenceQuote !== undefined
  if (hasMapWidth && (parsed.mapWidthKm === undefined || parsed.mapWidthEvidenceQuote === undefined)) {
    throw new Error('mapWidthKm 与 mapWidthEvidenceQuote 必须成对出现。')
  }
  const mapWidthEvidenceQuote = parsed.mapWidthEvidenceQuote === undefined
    ? undefined
    : strictText(parsed.mapWidthEvidenceQuote, 'mapWidthEvidenceQuote', 300)
  if (mapWidthEvidenceQuote && !hasExactEvidence(sourceText, mapWidthEvidenceQuote)) {
    throw new Error('mapWidthEvidenceQuote 不是登记来源逐字引文。')
  }

  return {
    width: 1200,
    height: 800,
    seed: strictText(parsed.seed, 'seed', 200),
    mapName: strictText(parsed.mapName, 'mapName', 200),
    pointCount: strictNumber(parsed.pointCount, 'pointCount', 5_000, 20_000, true),
    landRatio: strictNumber(parsed.landRatio, 'landRatio', 0.15, 0.8),
    continentCount: strictNumber(parsed.continentCount, 'continentCount', 1, 5, true),
    stateCount,
    burgDensity: strictNumber(parsed.burgDensity, 'burgDensity', 0.1, 1.5),
    temperatureShift: strictNumber(parsed.temperatureShift, 'temperatureShift', -20, 20),
    precipitationFactor: strictNumber(parsed.precipitationFactor, 'precipitationFactor', 0.2, 3),
    heightmapTemplate: parsed.heightmapTemplate,
    namingStyle: parsed.namingStyle,
    stateNames,
    burgNames,
    riverNames,
    spatialEntities,
    spatialRelations,
    ...(parsed.mapWidthKm === undefined ? {} : {
      mapWidthKm: strictNumber(parsed.mapWidthKm, 'mapWidthKm', 1, 1_000_000),
      mapWidthEvidenceQuote,
    }),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAllowed<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T)
}

function hasExactEvidence(sourceText: string, quote: string): boolean {
  return quote.length >= 2 && sourceText.includes(quote)
}
