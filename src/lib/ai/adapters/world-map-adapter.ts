import type { ChatMessage, Location, Worldview } from '../../types'

/**
 * 构建世界地图生成 prompt
 * AI 返回结构化 JSON，包含不规则多边形区域、山脉、河流、城市等
 */
export function buildWorldMapPrompt(
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
  if (overview)
    contextParts.push(`【地理总述】${overview}`)

  // 已有地点列表
  const locationList = locations.length > 0
    ? locations
        .map(l => `- ${l.name}（${l.type}）：${l.description || '无描述'}`)
        .join('\n')
    : '（用户未添加地点，请根据世界观描述自行设计合理的城镇和据点）'

  const worldContext = contextParts.length > 0
    ? contextParts.join('\n')
    : '（用户未填写世界观描述，请生成一个奇幻风格的示例世界地图）'

  const systemPrompt = `你是一位专业的奇幻世界地图设计师。你需要根据用户提供的世界观文字描述，生成一份结构化 JSON 数据，用于在 Canvas 上渲染一张仿魔兽世界/权游风格的世界地图。

**严格要求**：
1. 返回 **纯 JSON**，不要用 markdown code block 包裹，不要添加任何解释文字
2. JSON 必须能被 JSON.parse() 直接解析
3. 画布尺寸固定为 1200×800 像素，所有坐标必须在此范围内
4. 每个区域用 **不规则多边形顶点数组** 定义（polygon 字段），绝对不要用圆或椭圆
5. 海岸线必须自然不规则，带有半岛、海湾、峡湾等特征
6. 大陆多边形至少 25-40 个顶点，子区域至少 12-20 个顶点，小岛至少 8-12 个顶点
7. 山脉用脊线路径点（ridgeLine）表示，至少 5 个点
8. 河流用路径点（path）表示，至少 4 个点，从山脉发源流向海洋

**AI 主动补充原则**：
用户通常只提供几个关键大陆和城市。你必须主动补充以下细节使地图丰满：
- 至少 5-8 个补充城镇/村庄/据点
- 至少 1-2 条次要河流或支流
- 丘陵、湖泊等地形细节区域
- 至少 2-3 条连接主要城市的道路/商路
- 符合地理逻辑的细节（山脉旁有河流发源、沙漠边有绿洲、港口在海岸线上等）

**JSON Schema**：
{
  "title": "世界名称",
  "width": 1200,
  "height": 800,
  "regions": [
    {
      "id": "唯一ID",
      "name": "区域名",
      "type": "ocean|deepocean|coast|plains|forest|dense-forest|desert|tundra|swamp|mountain-region|hills|volcanic|ice|grassland",
      "polygon": [[x,y], [x,y], ...],
      "color": "#hex色值",
      "isContinent": true/false,
      "zIndex": 0-2
    }
  ],
  "mountains": [
    {
      "id": "唯一ID",
      "name": "山脉名",
      "ridgeLine": [[x,y], ...],
      "width": 数字,
      "height": "low|medium|high|epic"
    }
  ],
  "rivers": [
    {
      "id": "唯一ID",
      "name": "河流名",
      "path": [[x,y], ...],
      "width": 数字,
      "underground": false,
      "tributaries": [{"path": [[x,y],...], "width": 数字}]
    }
  ],
  "roads": [
    {
      "id": "唯一ID",
      "name": "道路名",
      "path": [[x,y], ...],
      "type": "major|minor|trade|ancient"
    }
  ],
  "markers": [
    {
      "id": "唯一ID",
      "name": "城市名",
      "x": 数字,
      "y": 数字,
      "type": "capital|city|town|village|sect|fortress|port|academy|ruin|dungeon|oasis|bridge|lighthouse|mine|shrine|custom",
      "faction": "势力名",
      "icon": "emoji图标",
      "importance": 1-5,
      "userAdded": false
    }
  ],
  "labels": [
    {
      "id": "唯一ID",
      "text": "标注文字",
      "x": 数字,
      "y": 数字,
      "fontSize": 数字,
      "color": "#hex",
      "fontStyle": "normal|italic"
    }
  ],
  "version": 1
}`

  const userPrompt = `请根据以下世界观描述生成世界地图 JSON 数据：

${worldContext}

已设定的地点：
${locationList}

请生成完整的世界地图 JSON。记住：
1. 所有区域必须用不规则多边形（polygon 顶点数组）
2. 在用户设定的地点基础上主动补充细节
3. 确保地理逻辑合理（河流从山脉流向海洋、港口在海岸线等）
4. 返回纯 JSON，不要包含任何其他文字`

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]
}

/**
 * 清理 AI 返回的 JSON 字符串（去掉可能的 markdown 包裹）
 */
export function cleanMapJSON(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim()
}

/**
 * 计算输入文本的简单 hash（用于检测世界观是否变化）
 */
export function computeSourceHash(text: string): string {
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash.toString(36)
}
