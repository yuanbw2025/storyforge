import type { ChatMessage } from '../../types'
import type { MapGenConfig, SpatialEntityKind } from '../engine/types'
import { parseAtlasReference, type AtlasKind } from './geometry'

/** In this experimental view the model proposes spatial composition. Coordinates
 * remain inferred, including when a feature's name occurs in the source. */
export function atlasDraftPrompt(source: string, target: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是二维小说地图制图师。只输出 JSON 对象 {"mapName":"目标名称","features":[["land","大陆名",0,"120,40 180,60 210,120 150,180 105,100"],["city","城名",0,"152,109"]]}。例子只解释格式。不得输出 markdown、代码、注释或其它键。
图幅为1200×700，左上是0,0，右下是1200,700，北向上。所有坐标是推测的制图布局。按下列登记资料构图，尊重已有名称、沿岸/岛屿/河口/山口/道路/疆域关系，缺处按地理规律补全。大洲和每座海岛以 land 闭环表现，主大陆至少30个轮廓折点，布置海湾、狭颈和半岛；沿图幅边缘裁切合理。每个点格式为 x,y，点之间用空格。
features每行固定四项：类型、中文地名、标注级别0/1/2（0最重要）、坐标字符串。land=陆岛面；ridge=山脊线；wood=林带；marsh=湿地；desert=荒漠；river=河流折线自源到口；road=道路折线；wall=长城类人工屏障线；sea=水域标注点；region=区域标注点；city=城镇、城堡或关隘点。面至少三点，线至少两点，点类单点。关键城市和关口都给city点，放在陆地上，用地标、河流和路网共用端点来表达关系。河港就在河的入海口，海峡两岸分属不同陆块，城墙以线横过它保护的走廊。大地区配置region标注。照顾整图和局部，优先完成关键地理事实，勿让同一座城市重复。每条河、山和陆块有自己的坐标；不要用现成图像。没有坐标资料时自行推测，并将全部几何留给作者确认。`,
    },
    { role: 'user', content: '目标名称：' + target + '\n已登记的作品资料：\n' + source },
  ]
}
const semanticKind: Partial<Record<AtlasKind, SpatialEntityKind>> = {
  land: 'region',
  sea: 'region',
  region: 'region',
  city: 'settlement',
  ridge: 'mountain',
  river: 'river',
  wall: 'landmark',
}
export function parseAtlasDraft(raw: string, source: string): MapGenConfig {
  const doc = JSON.parse(raw)
  if (
    !doc ||
    Object.keys(doc).sort().join(',') !== 'features,mapName' ||
    typeof doc.mapName !== 'string' ||
    doc.mapName.length > 120 ||
    !Array.isArray(doc.features) ||
    doc.features.length > 300
  )
    throw Error('地图草图只接受名称和至多 300 个地理要素。')
  const features = doc.features.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== 4 || typeof row[3] !== 'string' || row[3].length > 4000)
      throw Error('地图草图中的地理要素格式无效。')
    const points = row[3]
      .trim()
      .split(/\s+/)
      .map((p: string) => {
        if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(p)) throw Error('地图坐标必须为 x,y。')
        return p.split(',').map(Number)
      })
    return { kind: row[0], name: row[1], rank: row[2], points }
  })
  const atlasDraft = parseAtlasReference({ version: 1, width: 1200, height: 700, features })
  const entities = new Map<string, SpatialEntityKind>()
  for (const f of atlasDraft.features) {
    const kind = semanticKind[f.kind]
    if (kind && f.name) entities.set(f.name, kind)
  }
  const names = (kind: AtlasKind) => [
    ...new Set(
      atlasDraft.features
        .filter((f) => f.kind === kind)
        .map((f) => f.name)
        .filter(Boolean),
    ),
  ]
  return {
    mapName: doc.mapName,
    seed: 'atlas-' + doc.mapName,
    width: 1200,
    height: 700,
    atlasDraft,
    burgNames: names('city'),
    riverNames: names('river'),
    spatialEntities: Array.from(entities, ([name, kind]) => ({
      name,
      kind,
      source: source.includes(name) && name.length > 1 ? 'explicit' : 'inferred',
      ...(source.includes(name) && name.length > 1 ? { evidenceQuote: name } : {}),
    })),
    spatialRelations: [],
  }
}
