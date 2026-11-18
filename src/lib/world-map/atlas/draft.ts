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
图幅为1200×700，左上是0,0，右下是1200,700，天内/大陆内部北向上。所有坐标是推测的制图布局。按下列登记资料构图，尊重已有名称、沿岸/岛屿/河口/山口/道路/疆域关系。不得编造地名、河流、城池、道路或原文未支持的空间关系；没有名字的地形填充用空名称，不把岩石材质、植被或气候描述合成为新的地名。大洲和每座海岛以 land 闭环表现，主大陆至少30个轮廓折点，布置海湾、狭颈和半岛；沿图幅边缘裁切合理。每个点格式为 x,y，点之间用空格。
每张图必须至少有一个 land 或 realm 面。湖泊、内海、海湾、海峡可用 water 多边形从陆地中剪出真实水面，不能只放一个 sea 标签。海港必须紧贴通海的水面边缘，内陆湖不能当海港；海峡要真实隔开两岸。资料描述单个位面但没有可确认的陆地轮廓，或主要为空城、幽冥等特殊空间时，用 realm 作为空间示意图框，既不伪造大陆，也不只画几个点。允许用未命名的山林、丘陵等补足资料所述的自然景观，保持地理合理与清晰留白；不新造正式地点。
先识别目标范围：目标名称指向单个位面或地区时，只绘该目标内部地理，其余空间资料仅用于核对边界，不另画整套诸天。目标为总览且资料明确存在互相隔离的诸天、位面或秘境时，用 realm 闭环表示独立空间的分区，各分区不重叠；分区在图上的相对位置只是排版，不表示实际东南西北、大小或相邻。不能把诸天假画成同一海洋里的岛屿。realm 面必须至少三点，名称用真实位面名，并在其内部另放单点 region 标签；没有资料的空间仅画空间图框与名称，不伪造地形和城池。rift 与 passage 必须为至少两点的线；入口或地标的单点请用 landmark。仅在原文支持时用 passage 跨区虚线表示可通行关系，名称注明通行条件；没有确切连接位置时不连线。rift 是天壑等天然空间屏障线，区别于人工wall；landmark 是山门、寺院、遗迹等非城镇地点，不应画成城池。可用绘本地形表达各空间内部已知山水，不假设各天共用比例尺。
features每行固定四项：类型、中文地名、标注级别0/1/2（0最重要）、坐标字符串。land=陆岛面；water=有形状的湖泊/内海/海峡水面；ridge=山脊线；wood=林带；marsh=湿地；desert=荒漠；river=河流折线自源到口；road=道路折线；seaRoute=海上航线；wall=长城类人工屏障线；border=国界线；province=省界线；sea=水域标注点；region=区域标注点；city=城镇点；fortress=城堡、关隘或要塞点。面至少三点，线至少两点，点类单点。wood、marsh、desert 的区域优先用至少五点的闭合多边形，狭窄带状地形可用两点线段。关键城市用city，关口和要塞用fortress，放在陆地或空间分区内，用地标、河流和路网共用端点来表达关系；只有资料明确国家/省区疆域才画相应界线。河港就在河的入海口，海峡两岸分属不同陆块，城墙以线横过它保护的走廊。大地区配置region标注。照顾整图和局部，优先完成关键地理事实，勿让同一座城市重复。每条河、山和陆块有自己的坐标；不要用现成图像。没有坐标资料时自行推测，并将全部几何留给作者确认。`,
    },
    {
      role: 'user',
      content: '目标名称：' + target + '\n已登记的作品资料：\n' + source,
    },
  ]
}
const semanticKind: Partial<Record<AtlasKind, SpatialEntityKind>> = {
  land: 'region',
  realm: 'region',
  water: 'region',
  sea: 'region',
  region: 'region',
  city: 'settlement',
  fortress: 'fortress',
  ridge: 'mountain',
  river: 'river',
  wall: 'landmark',
  landmark: 'landmark',
  rift: 'landmark',
}
export function parseAtlasDraft(raw: string, source: string, options: { existingNamesOnly?: boolean } = {}): MapGenConfig {
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
    if (
      !Array.isArray(row) ||
      row.length !== 4 ||
      typeof row[3] !== 'string' ||
      row[3].length > 4000
    )
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
  const validated = parseAtlasReference({ version: 1, width: 1200, height: 700, features })
  const admittedFeatures = options.existingNamesOnly ? validated.features.flatMap(feature => {
    if (!feature.name || source.includes(feature.name)) return [feature]
    if (feature.kind === 'city' || feature.kind === 'fortress') return []
    if (feature.kind === 'ridge' || feature.kind === 'river') return [{ ...feature, name: '' }]
    return [feature]
  }) : validated.features
  const atlasDraft = parseAtlasReference({
    version: 1,
    width: 1200,
    height: 700,
    features: admittedFeatures,
  })
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
    burgNames: [...names('city'), ...names('fortress')],
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
