/**
 * WorldMapPanel — 世界地图主面板
 * 顶层容器：世界树导航 + AI 生成按钮 + Voronoi/2D/3D 切换 + Canvas + 属性编辑器
 */

import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Sparkles, Loader2, RefreshCw, Map, Box, Layers, Globe } from 'lucide-react'
import { useGeographyStore } from '../../stores/project-singletons'
import { useWorldviewStore } from '../../stores/worldview'
import { useWorldNodeStore } from '../../stores/world-node'
import { useAIStream } from '../../hooks/useAIStream'
import {
  buildWorldMapPrompt,
  cleanMapJSON,
  computeSourceHash,
} from '../../lib/ai/adapters/world-map-adapter'
import {
  buildVoronoiMapPrompt,
  parseVoronoiMapConfig,
} from '../../lib/ai/adapters/voronoi-map-adapter'
import { nanoid } from '../../lib/utils/id'
import type { Project, Location } from '../../lib/types'
import type { WorldMapData, MapMarker } from '../../lib/types/world-map'
import type { MapGenConfig } from '../../lib/world-map/engine'
import WorldMapCanvas from './WorldMapCanvas'
import MapMarkerEditor from './MapMarkerEditor'
import WorldTreeSidebar from './WorldTreeSidebar'

// 3D 组件懒加载（Three.js 很大）
const WorldMap3DCanvas = lazy(() => import('./WorldMap3DCanvas'))
// Voronoi 地图引擎组件懒加载
const WorldMapVoronoi = lazy(() => import('./WorldMapVoronoi'))

interface Props {
  project: Project
}

type ViewMode = '2d' | '3d' | 'voronoi'

export default function WorldMapPanel({ project }: Props) {
  const { geography, save } = useGeographyStore()
  const { worldview } = useWorldviewStore()
  const { nodes, activeWorldId, loadNodes, ensureRootWorld, updateNode } = useWorldNodeStore()
  const ai = useAIStream()

  const [mapData, setMapData] = useState<WorldMapData | null>(null)
  const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('voronoi')

  // 当前活跃世界的 Voronoi 配置
  const [voronoiConfig, setVoronoiConfig] = useState<Partial<MapGenConfig> | undefined>(undefined)

  // ── 初始化世界树 ──
  useEffect(() => {
    if (!project.id) return
    ensureRootWorld(project.id).then(() => loadNodes(project.id!))
  }, [project.id, ensureRootWorld, loadNodes])

  // ── 切换世界时加载该世界的地图配置 ──
  const activeNode = nodes.find(n => n.id === activeWorldId)

  useEffect(() => {
    if (!activeNode) {
      setVoronoiConfig(undefined)
      return
    }
    // 从世界节点加载地图配置
    if (activeNode.mapConfigJSON) {
      try {
        setVoronoiConfig(JSON.parse(activeNode.mapConfigJSON))
      } catch {
        setVoronoiConfig(undefined)
      }
    } else {
      setVoronoiConfig(undefined)
    }
  }, [activeNode])

  // 从 geography.worldMapData 加载 2D/3D 地图数据（仅主世界用）
  useEffect(() => {
    if (geography?.worldMapData) {
      try {
        const parsed = JSON.parse(geography.worldMapData) as WorldMapData
        setMapData(parsed)
      } catch {
        setMapData(null)
      }
    } else {
      setMapData(null)
    }
  }, [geography?.worldMapData])

  // 持久化 2D/3D 地图数据到 IndexedDB
  const persistMapData = useCallback(
    async (data: WorldMapData) => {
      setMapData(data)
      await save({
        projectId: project.id!,
        worldMapData: JSON.stringify(data),
      })
    },
    [project.id, save],
  )

  // ── AI 生成地图 ─────────────────────────────────────────
  const handleGenerate = async () => {
    const overview = geography?.overview || ''
    let locations: Location[] = []
    try {
      locations = JSON.parse(geography?.locations || '[]')
    } catch { /* empty */ }

    if (viewMode === 'voronoi') {
      // Voronoi 模式：AI 生成 MapGenConfig
      const messages = buildVoronoiMapPrompt(worldview, overview, locations)
      const result = await ai.start(messages)
      if (!result) return

      try {
        const config = parseVoronoiMapConfig(result)
        // 注入当前世界名称
        if (activeNode) {
          config.mapName = activeNode.name
        }
        console.log('[WorldMapPanel] AI generated Voronoi config:', config)
        setVoronoiConfig(config)

        // 持久化到世界节点
        if (activeWorldId) {
          await updateNode(activeWorldId, {
            mapConfigJSON: JSON.stringify(config),
          })
        }
      } catch (err) {
        console.error('Failed to parse AI Voronoi config:', err)
      }
    } else {
      // 2D/3D 模式：原有的 polygon 方式
      const messages = buildWorldMapPrompt(worldview, overview, locations)
      const result = await ai.start(messages)
      if (!result) return

      try {
        const cleaned = cleanMapJSON(result)
        const parsed = JSON.parse(cleaned) as WorldMapData

        parsed.version = (mapData?.version || 0) + 1
        parsed.sourceHash = computeSourceHash(overview + JSON.stringify(locations))
        if (!parsed.width) parsed.width = 1200
        if (!parsed.height) parsed.height = 800

        for (const m of parsed.markers) {
          if (!m.id) m.id = nanoid()
          if (!m.importance) m.importance = 3
        }

        await persistMapData(parsed)
      } catch (err) {
        console.error('Failed to parse AI map JSON:', err)
      }
    }
  }

  // ── 交互回调 ─────────────────────────────────────────────
  const handleSelectMarker = useCallback((marker: MapMarker | null) => {
    setSelectedMarker(marker)
    setShowEditor(!!marker)
  }, [])

  const handleMarkerDragEnd = useCallback(
    (markerId: string, newX: number, newY: number) => {
      if (!mapData) return
      const updated: WorldMapData = {
        ...mapData,
        markers: mapData.markers.map(m =>
          m.id === markerId ? { ...m, x: newX, y: newY } : m,
        ),
      }
      persistMapData(updated)
    },
    [mapData, persistMapData],
  )

  const handleDoubleClickEmpty = useCallback(
    (x: number, y: number) => {
      if (!mapData) return
      const newMarker: MapMarker = {
        id: nanoid(),
        name: '新地点',
        x,
        y,
        type: 'custom',
        importance: 3,
        userAdded: true,
      }
      const updated: WorldMapData = {
        ...mapData,
        markers: [...mapData.markers, newMarker],
      }
      persistMapData(updated)
      setSelectedMarker(newMarker)
      setShowEditor(true)
    },
    [mapData, persistMapData],
  )

  const handleUpdateMarker = useCallback(
    (markerId: string, changes: Partial<MapMarker>) => {
      if (!mapData) return
      const updated: WorldMapData = {
        ...mapData,
        markers: mapData.markers.map(m =>
          m.id === markerId ? { ...m, ...changes } : m,
        ),
      }
      persistMapData(updated)
      const found = updated.markers.find(m => m.id === markerId)
      if (found) setSelectedMarker(found)
    },
    [mapData, persistMapData],
  )

  const handleDeleteMarker = useCallback(
    (markerId: string) => {
      if (!mapData) return
      const updated: WorldMapData = {
        ...mapData,
        markers: mapData.markers.filter(m => m.id !== markerId),
      }
      persistMapData(updated)
      setSelectedMarker(null)
      setShowEditor(false)
    },
    [mapData, persistMapData],
  )

  // ── 渲染 ─────────────────────────────────────────────────
  const generateButtonLabel = viewMode === 'voronoi'
    ? (voronoiConfig ? 'AI 重新生成' : 'AI 生成地图')
    : (mapData ? '重新生成' : 'AI 生成地图')

  return (
    <div className="h-full flex flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
          <Map className="w-5 h-5" />
          世界地图
          {activeNode && (
            <span className="text-sm font-normal text-text-muted ml-1">
              — {activeNode.icon} {activeNode.name}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {/* 视图切换 */}
          <div className="flex bg-bg-elevated rounded-lg p-0.5 border border-border">
            <button
              onClick={() => setViewMode('voronoi')}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
                viewMode === 'voronoi'
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Globe className="w-3 h-3" /> 奇幻
            </button>
            <button
              onClick={() => setViewMode('2d')}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
                viewMode === '2d'
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Layers className="w-3 h-3" /> 2D
            </button>
            <button
              onClick={() => setViewMode('3d')}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
                viewMode === '3d'
                  ? 'bg-accent text-white'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <Box className="w-3 h-3" /> 3D
            </button>
          </div>

          {mapData && viewMode !== 'voronoi' && (
            <span className="text-xs text-text-muted">
              v{mapData.version} · {mapData.markers.length} 标记 · {mapData.regions.length} 区域
            </span>
          )}

          <button
            onClick={handleGenerate}
            disabled={ai.isStreaming}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {ai.isStreaming ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                AI 分析中...
              </>
            ) : voronoiConfig || mapData ? (
              <>
                <RefreshCw className="w-4 h-4" />
                {generateButtonLabel}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                AI 生成地图
              </>
            )}
          </button>
        </div>
      </div>

      {/* AI 错误提示 */}
      {ai.error && (
        <div className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {ai.error}
        </div>
      )}

      {/* AI 流式输出进度 */}
      {ai.isStreaming && (
        <div className="mb-3 p-3 bg-accent/10 border border-accent/20 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-accent mb-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {viewMode === 'voronoi'
              ? 'AI 正在分析世界设定，生成地图参数...'
              : 'AI 正在设计世界地图...'}
          </div>
          <div className="text-xs text-text-muted max-h-20 overflow-y-auto font-mono">
            {ai.output.slice(0, 200)}
            {ai.output.length > 200 && '...'}
          </div>
        </div>
      )}

      {/* 主内容区域：世界树 + 地图 */}
      <div className="flex-1 flex min-h-0 rounded-lg overflow-hidden border border-border">
        {/* 世界树侧边栏 */}
        <WorldTreeSidebar projectId={project.id!} />

        {/* 地图区域 */}
        {viewMode === 'voronoi' ? (
          /* Voronoi 地图 — 始终显示（默认生成 + AI 配置更新） */
          <div className="flex-1 min-w-0">
            <Suspense fallback={
              <div className="w-full h-full flex items-center justify-center bg-[#1a1f2e]">
                <div className="text-center text-text-muted">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-accent" />
                  <p className="text-sm">加载 Voronoi 地图引擎...</p>
                </div>
              </div>
            }>
              <WorldMapVoronoi
                key={activeWorldId ?? 'default'}
                config={voronoiConfig}
              />
            </Suspense>
          </div>
        ) : mapData ? (
          <>
            {/* 2D/3D 地图渲染区 */}
            <div className="flex-1 min-w-0">
              {viewMode === '2d' ? (
                <WorldMapCanvas
                  data={mapData}
                  selectedMarkerId={selectedMarker?.id || null}
                  onSelectMarker={handleSelectMarker}
                  onMarkerDragEnd={handleMarkerDragEnd}
                  onDoubleClickEmpty={handleDoubleClickEmpty}
                />
              ) : (
                <Suspense fallback={
                  <div className="w-full h-full flex items-center justify-center bg-[#1a1810]">
                    <div className="text-center text-text-muted">
                      <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-accent" />
                      <p className="text-sm">加载 3D 引擎...</p>
                    </div>
                  </div>
                }>
                  <WorldMap3DCanvas
                    data={mapData}
                    selectedMarkerId={selectedMarker?.id || null}
                    onSelectMarker={handleSelectMarker}
                  />
                </Suspense>
              )}
            </div>

            {/* 属性编辑面板 */}
            {showEditor && selectedMarker && (
              <MapMarkerEditor
                marker={selectedMarker}
                onUpdate={handleUpdateMarker}
                onDelete={handleDeleteMarker}
                onClose={() => {
                  setShowEditor(false)
                  setSelectedMarker(null)
                }}
              />
            )}
          </>
        ) : (
          /* 空状态（仅 2D/3D 模式无数据时） */
          !ai.isStreaming && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center max-w-md">
                <Map className="w-16 h-16 text-text-muted/30 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-text-primary mb-2">还没有世界地图</h3>
                <p className="text-sm text-text-muted mb-6 leading-relaxed">
                  点击「AI 生成地图」，系统会根据你在世界观和地理环境中填写的内容，
                  自动生成一张包含大陆、山脉、河流、城市的奇幻世界地图。
                  <br />
                  <span className="text-text-secondary mt-1 inline-block">
                    提示：先在「自然环境」和「地理环境」中填写越详细，生成效果越好
                  </span>
                </p>
                <button
                  onClick={handleGenerate}
                  disabled={ai.isStreaming}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors"
                >
                  <Sparkles className="w-5 h-5" />
                  AI 生成地图
                </button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  )
}
