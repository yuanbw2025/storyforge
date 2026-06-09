# PHASE 20 — 世界地图（World Map Canvas）

> 用户在「世界观 → 自然环境」填写世界结构、大陆分布、山川河流等文字描述 →
> 点击「生成世界地图」→ AI 提取结构化 JSON（含不规则多边形顶点）→
> Canvas 渲染类魔兽世界风格地图 → 用户可拖拽编辑 → 修改后存回 IndexedDB。
>
> **核心理念：用户提供骨架，AI 生成血肉，用户可修改。**

---

## § 1. 元信息

```yaml
phase: 20
title: 世界地图（World Map Canvas）
prerequisites: [PHASE-05 worldview-natural 完成]
estimated_hours: 14-18
recommended_model: Sonnet 4.6 / Gemini 3 Pro
status: not-started
```

---

## § 2. 本 Phase 的目标（What）

### 做完之后系统会有什么

1. 侧边栏「设定库 → 世界观」下新增 **「世界地图」** 叶子节点
2. 用户点击进入世界地图面板，有三种使用方式：
   - **AI 生成**：读取 worldview 中的自然环境字段（worldStructure、continentLayout、mountainsRivers 等），AI 返回结构化 JSON，Canvas 渲染为不规则多边形地图
   - **手动编辑**：在已生成的地图上拖拽城市/标记位置、编辑名称、添加/删除标记
   - **重新生成**：保留用户手动添加的标记，AI 重新生成地形布局
3. 地图风格：仿魔兽世界/权游——不规则海岸线、自然的大陆轮廓、半岛海湾、羊皮纸背景
4. AI 会主动补充细节：小城镇、河流支流、丘陵湖泊、道路、地名等
5. 地图数据存储在 `geographies` 表的 `worldMapData` 字段中（JSON string）

### 不在本 Phase 范围

- 缩放/平移（Phase 21 考虑）
- 多层级地图（大世界 → 点击进入区域 → 点击进入城市）
- 地图导出为图片
- 与 locations 列表的双向同步（仅单向：locations 作为 AI 输入）

---

## § 3. 改动清单

### 整体分 3 个里程碑

| 里程碑 | commit message | 工时 |
|---|---|---|
| **P20-a 数据层 + AI Prompt** | `feat(storyforge): Phase 20a - 世界地图数据模型与AI生成` | 4-5h |
| **P20-b Canvas 渲染引擎** | `feat(storyforge): Phase 20b - 世界地图Canvas渲染` | 5-6h |
| **P20-c 交互编辑 + 侧边栏** | `feat(storyforge): Phase 20c - 地图交互编辑与侧边栏集成` | 5-7h |

### 新增文件

- `src/lib/types/world-map.ts` — WorldMapData 及所有子类型定义
- `src/lib/ai/adapters/world-map-adapter.ts` — AI prompt 构建器
- `src/lib/world-map/perlin.ts` — Perlin Noise 生成器（海岸线锯齿化）
- `src/lib/world-map/renderer.ts` — Canvas 纯渲染函数（无 React 依赖）
- `src/lib/world-map/interaction.ts` — 拖拽 / 点击 / 选中逻辑
- `src/components/geography/WorldMapPanel.tsx` — 面板容器（按钮 + Canvas + 属性编辑）
- `src/components/geography/WorldMapCanvas.tsx` — React Canvas 包装组件
- `src/components/geography/MapMarkerEditor.tsx` — 右侧属性编辑面板

### 修改文件

- `src/lib/types/geography.ts` — Geography 接口增加 `worldMapData?: string`
- `src/lib/types/index.ts` — 新增 `export * from './world-map'`
- `src/components/layout/sidebar-tree.ts` — 世界观分支下添加"世界地图"叶子
- `src/stores/project-singletons.ts` — defaults 增加 `worldMapData: ''`
- `src/pages/WorkspacePage.tsx` — 路由映射增加 `world-map` → WorldMapPanel

---

## § 4. 数据模型

### 4.1 WorldMapData 类型定义 (`src/lib/types/world-map.ts`)

```typescript
/** 二维坐标点 */
export type Point2D = [number, number]

/** 地形类型 */
export type TerrainType =
  | 'ocean' | 'deepocean' | 'coast'
  | 'plains' | 'forest' | 'dense-forest'
  | 'desert' | 'tundra' | 'swamp' | 'mountain-region'
  | 'hills' | 'volcanic' | 'ice' | 'grassland'

/** 地图区域（大陆/海洋/子区域）— 用不规则多边形定义 */
export interface MapRegion {
  id: string
  name: string
  type: TerrainType
  /** 不规则多边形顶点坐标（顺时针） */
  polygon: Point2D[]
  /** 填充色 */
  color: string
  /** 是否为大陆级（影响渲染层级） */
  isContinent?: boolean
  /** 区域层级：0=海洋底层 1=大陆 2=子区域 */
  zIndex: number
}

/** 山脉 */
export interface MapMountainRange {
  id: string
  name: string
  /** 山脊线路径点 */
  ridgeLine: Point2D[]
  /** 山脉宽度（像素） */
  width: number
  /** 高度等级影响山峰绘制：'low' | 'medium' | 'high' | 'epic' */
  height: 'low' | 'medium' | 'high' | 'epic'
}

/** 河流 */
export interface MapRiver {
  id: string
  name: string
  /** 河流路径点（贝塞尔控制点） */
  path: Point2D[]
  /** 河宽（像素） */
  width: number
  /** 是否为暗河/地下河（虚线） */
  underground?: boolean
  /** 支流 */
  tributaries?: { path: Point2D[]; width: number }[]
}

/** 道路/商路 */
export interface MapRoad {
  id: string
  name: string
  path: Point2D[]
  type: 'major' | 'minor' | 'trade' | 'ancient'
}

/** 城市/标记点类型 */
export type MarkerType =
  | 'capital' | 'city' | 'town' | 'village'
  | 'sect' | 'fortress' | 'port' | 'academy'
  | 'ruin' | 'dungeon' | 'oasis' | 'bridge'
  | 'lighthouse' | 'mine' | 'shrine' | 'custom'

/** 城市/标记点 */
export interface MapMarker {
  id: string
  name: string
  x: number
  y: number
  type: MarkerType
  /** 所属势力/阵营 */
  faction?: string
  /** 简短说明 */
  note?: string
  /** 图标 emoji（可自定义） */
  icon?: string
  /** 重要度 1-5（影响图标大小和文字显示） */
  importance: number
  /** 是否为用户手动添加 */
  userAdded?: boolean
}

/** 文字标注（区域名、海洋名等） */
export interface MapLabel {
  id: string
  text: string
  x: number
  y: number
  fontSize: number
  color: string
  rotation?: number
  fontStyle?: 'normal' | 'italic'
}

/** 世界地图完整数据 */
export interface WorldMapData {
  /** 地图标题 */
  title: string
  /** Canvas 宽度 */
  width: number
  /** Canvas 高度 */
  height: number
  /** 区域（海洋 + 大陆 + 子地形） */
  regions: MapRegion[]
  /** 山脉 */
  mountains: MapMountainRange[]
  /** 河流 */
  rivers: MapRiver[]
  /** 道路 */
  roads: MapRoad[]
  /** 城市/标记点 */
  markers: MapMarker[]
  /** 文字标注 */
  labels: MapLabel[]
  /** 地图版本号（用于检测是否需要重新生成） */
  version: number
  /** 上次 AI 生成时的输入文本指纹（用于判断内容是否变化） */
  sourceHash?: string
}
```

### 4.2 Geography 接口变更

```typescript
// src/lib/types/geography.ts — 增加一个字段
export interface Geography {
  // ... 现有字段保持不变 ...
  worldMapData?: string  // WorldMapData JSON string
}
```

**无需 Dexie schema 版本变更** — `worldMapData` 是可选字段，IndexedDB 不索引此列，直接存即可。

### 4.3 AI Prompt 策略

**输入**：从 worldview store 中读取：
- `worldStructure`（世界结构）
- `worldDimensions`（世界尺寸）
- `continentLayout`（大陆分布）
- `mountainsRivers`（山川河流）
- `climateByRegion`（气候分区）
- Geography 的 `overview`（地理总述）
- Geography 的 `locations`（已有地点列表）

**Prompt 核心指令**：
```
你是一位奇幻世界地图设计师。根据用户提供的世界观描述，生成一份结构化 JSON 数据，用于在 Canvas 上渲染世界地图。

关键要求：
1. 每个区域（大陆/海洋/地形）用【不规则多边形顶点数组】定义，而非圆/椭圆
2. 海岸线必须自然锯齿，有半岛、海湾、峡湾等地理特征
3. 用户只提供了主要地点，你需要主动补充：
   - 小城镇/村庄（至少5-8个补充城镇）
   - 次要河流和支流
   - 丘陵/湖泊等地形细节
   - 主要道路/商路连接
   - 自然地理逻辑（山脉旁发源河流，沙漠边有绿洲等）
4. 整体布局参考画布 1200×800 像素
5. 多边形顶点数量：大陆≥30个点，子区域≥15个点，小岛≥10个点
6. 山脉用脊线路径表示（≥5个点），河流用路径表示（≥4个点）
```

**输出格式**：纯 JSON（不含 markdown code block），直接 `JSON.parse` 可解析。

---

## § 5. Canvas 渲染引擎设计

### 渲染层级（由底到顶）

1. **羊皮纸背景** — 径向渐变 + 纸张纹理噪点 + 装饰边框
2. **海洋层** — 深海/浅海多边形 + 波浪纹理
3. **大陆轮廓** — 不规则多边形 + Perlin Noise 边缘扰动 + 阴影
4. **子区域地形** — 森林（树形纹理）、沙漠（点纹理）、冰原（雪花纹理）等
5. **山脉** — 沿脊线绘制三角山峰 + 雪顶 + 阴影
6. **河流** — 贝塞尔曲线 + 宽度渐变（源头窄→入海宽）
7. **道路** — 虚线/点线
8. **城市标记** — 图标 + 光晕 + 文字描边
9. **文字标注** — 区域名/海洋名（斜体、透明度）
10. **UI 叠加层** — 罗盘、比例尺、标题框、图例

### Perlin Noise 海岸线处理

AI 生成的多边形顶点是"骨架"（约30个点），渲染时在每两个相邻顶点之间插入 Perlin Noise 扰动点，使边缘呈现自然锯齿：

```
原始顶点 A → B（直线段）
→ 细分为 8 段，每个插值点加 Perlin(x,y) * amplitude 偏移
→ 得到自然弯曲的海岸线
```

---

## § 6. 交互编辑设计

### 6.1 选中与拖拽

- **点击城市/标记** → 选中（蓝色高亮圈）→ 右侧弹出属性面板
- **拖拽城市/标记** → 实时更新坐标 → mouseup 时存回 store
- **双击空白处** → 弹出"添加标记"菜单（选类型 + 输入名称）
- **右键标记** → 删除

### 6.2 属性编辑面板 (MapMarkerEditor)

选中标记后，右侧显示可编辑字段：
- 名称（input）
- 类型（select）
- 所属势力（input）
- 重要度（1-5 radio）
- 备注（textarea）
- 图标（emoji picker 或预设选择）
- 删除按钮

### 6.3 数据保存

- 每次拖拽结束 / 属性修改 → 调用 `useGeographyStore().save({ worldMapData: JSON.stringify(data) })`
- 使用 debounce 300ms 防止频繁写库

---

## § 7. 验收标准（Definition of Done）

```markdown
- [ ] `npm run build` 输出 "built in" 且无 error
- [ ] 侧边栏「世界观」下出现「世界地图」入口
- [ ] 点击「生成世界地图」，AI 返回 JSON，Canvas 渲染出不规则多边形地图
- [ ] 地图海岸线明显不规则（有半岛/海湾/锯齿感）
- [ ] AI 在用户输入的城市基础上自动补充了至少 5 个细节标记
- [ ] 可拖拽移动城市标记位置
- [ ] 可点击城市标记编辑属性（名称/类型/势力）
- [ ] 可双击空白处添加新标记
- [ ] 修改后的数据持久化到 IndexedDB
- [ ] 刷新页面后地图数据仍在
- [ ] 没有已有功能的回归
```

---

## § 8. 故障排查

| 症状 | 可能原因 | 应对 |
|------|---------|------|
| AI 返回的 JSON 无法解析 | 返回了 markdown code block | strip ` ```json ` 和 ` ``` ` |
| Canvas 上只有背景没有地形 | regions 数组为空或坐标超出画布 | 验证 JSON 后 fallback 到 demo 数据 |
| 拖拽卡顿 | 每次 mousemove 都触发 full re-render | 使用 offscreen canvas 缓存静态层 |
| 海岸线太平滑 | Perlin Noise amplitude 太小 | 调大 amplitude 参数（建议 8-15px） |
| 数据保存后刷新丢失 | worldMapData 字段没写入 | 检查 store save 逻辑是否包含该字段 |

---

## § 9. 提交规范

```bash
# P20-a
git add .
git commit -m "feat(storyforge): Phase 20a - 世界地图数据模型与AI生成 [verified]"

# P20-b
git add .
git commit -m "feat(storyforge): Phase 20b - 世界地图Canvas渲染引擎 [verified]"

# P20-c
git add .
git commit -m "feat(storyforge): Phase 20c - 地图交互编辑与侧边栏集成 [verified]"

git push origin main
```
