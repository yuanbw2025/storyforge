/**
 * WorldMapPanel — 世界地图主面板
 * 顶层容器：世界树导航 + AI 生成按钮 + Voronoi/2D/3D 切换 + Canvas + 属性编辑器
 */

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { Check, Sparkles, Loader2, RefreshCw, Map, Box, Globe, X } from 'lucide-react'
import { useWorldNodeStore } from '../../stores/world-node'
import { useWorldGroupStore } from '../../stores/world-group'
import { useAIConfigStore } from '../../stores/ai-config'
import WorldGroupSwitcher from '../world-group/WorldGroupSwitcher'
import {
  abandonWorldMapConfigRunV1,
  adoptWorldMapConfigCandidateV1,
  generateWorldMapConfigCandidateV1,
  readPendingWorldMapConfigCandidateV1,
  readRecoverableWorldMapConfigRunV1,
  rejectWorldMapConfigCandidateV1,
  type WorldMapConfigCandidateV1,
} from '../../lib/agent/run/world-map-config-durable'
import { resolveScopeLike } from '../../lib/workspace/scope'
import type { Project, WorkspaceScope } from '../../lib/types'
import type { MapGenConfig } from '../../lib/world-map/engine'
import WorldTreeSidebar from './WorldTreeSidebar'

// Voronoi 地图引擎组件懒加载
const WorldMapVoronoi = lazy(() => import('./WorldMapVoronoi'))

interface Props {
  project: Project
}

type ViewMode = '3d' | 'voronoi'

export default function WorldMapPanel({ project }: Props) {
  const { nodes, activeWorldId, loadNodes, ensureRootWorld, updateNode } = useWorldNodeStore()
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  const aiConfig = useAIConfigStore(state => state.config)

  const [viewMode, setViewMode] = useState<ViewMode>('voronoi')

  // 当前活跃世界的 Voronoi 配置
  const [voronoiConfig, setVoronoiConfig] = useState<Partial<MapGenConfig> | undefined>(undefined)
  const [scope, setScope] = useState<WorkspaceScope | null>(null)
  const [candidate, setCandidate] = useState<WorldMapConfigCandidateV1 | null>(null)
  const [runId, setRunId] = useState<number | null>(null)
  const [unsafeRunId, setUnsafeRunId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const modelInFlightNodeId = useRef<number | null>(null)

  // 多世界模式下世界树按世界组隔离；单世界传 null 走原逻辑
  const scopedGroupId = project.enableMultiWorld ? activeGroupId : null
  const isCurrentTarget = (worldNodeId: number, worldGroupId: number | null) => (
    useWorldNodeStore.getState().activeWorldId === worldNodeId
    && (!project.enableMultiWorld
      || (useWorldGroupStore.getState().activeGroupId ?? null) === worldGroupId)
  )

  // ── 初始化世界树（按世界组作用域） ──
  useEffect(() => {
    if (!project.id) return
    let cancelled = false
    void resolveScopeLike(project.id).then(async resolved => {
      await ensureRootWorld(resolved, scopedGroupId)
      await loadNodes(resolved, scopedGroupId)
      if (!cancelled) setScope(resolved)
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { cancelled = true }
  }, [project.id, scopedGroupId, ensureRootWorld, loadNodes])

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

  useEffect(() => {
    setCandidate(null)
    setRunId(null)
    setUnsafeRunId(null)
    setError(null)
    if (!scope || !activeWorldId) return
    let cancelled = false
    void (async () => {
      try {
        const pending = await readPendingWorldMapConfigCandidateV1({
          scope,
          worldGroupId: scopedGroupId,
          worldNodeId: activeWorldId,
        })
        if (cancelled) return
        if (pending) {
          setCandidate(pending.candidate)
          setRunId(pending.snapshot.run.id)
          return
        }
        if (modelInFlightNodeId.current === activeWorldId) return
        const recoverable = await readRecoverableWorldMapConfigRunV1({
          scope,
          worldGroupId: scopedGroupId,
          worldNodeId: activeWorldId,
        })
        if (!cancelled && recoverable && !recoverable.safeToResume) {
          setUnsafeRunId(recoverable.snapshot.run.id)
          setError('上次地图运行停在模型结果不可判定窗口，系统不会自动重试。请放弃后重新生成。')
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      }
    })()
    return () => { cancelled = true }
  }, [activeWorldId, scope, scopedGroupId])

  // ── AI 生成地图 ─────────────────────────────────────────
  const handleGenerate = async () => {
    if (!scope || !activeWorldId || busy || candidate || unsafeRunId) return
    const targetWorldNodeId = activeWorldId
    const targetWorldGroupId = scopedGroupId
    modelInFlightNodeId.current = targetWorldNodeId
    setBusy(true)
    setError(null)
    try {
      const generated = await generateWorldMapConfigCandidateV1({
        scope,
        worldGroupId: targetWorldGroupId,
        worldNodeId: targetWorldNodeId,
        aiConfig,
      })
      if (isCurrentTarget(targetWorldNodeId, targetWorldGroupId)) {
        setCandidate(generated.candidate)
        setRunId(generated.snapshot.run.id)
      }
    } catch (reason) {
      const recoverable = await readRecoverableWorldMapConfigRunV1({
        scope,
        worldGroupId: targetWorldGroupId,
        worldNodeId: targetWorldNodeId,
      }).catch(() => null)
      if (isCurrentTarget(targetWorldNodeId, targetWorldGroupId)) {
        setError(reason instanceof Error ? reason.message : String(reason))
        if (recoverable && !recoverable.safeToResume) setUnsafeRunId(recoverable.snapshot.run.id)
      }
    } finally {
      if (modelInFlightNodeId.current === targetWorldNodeId) modelInFlightNodeId.current = null
      setBusy(false)
    }
  }

  const handleAcceptCandidate = async () => {
    if (!scope || runId == null || !candidate || busy) return
    const targetWorldNodeId = candidate.worldNodeId
    const targetWorldGroupId = candidate.worldGroupId
    setBusy(true)
    setError(null)
    try {
      const adopted = await adoptWorldMapConfigCandidateV1({
        scope,
        worldGroupId: scopedGroupId,
        runId,
      })
      useWorldNodeStore.setState(state => ({
        nodes: state.nodes.map(node => node.id === targetWorldNodeId
          ? { ...node, mapConfigJSON: adopted.candidate.mapConfigJSON }
          : node),
      }))
      if (isCurrentTarget(targetWorldNodeId, targetWorldGroupId)) {
        setVoronoiConfig(adopted.candidate.mapConfig)
        setCandidate(null)
        setRunId(null)
      }
    } catch (reason) {
      if (isCurrentTarget(targetWorldNodeId, targetWorldGroupId)) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      setBusy(false)
    }
  }

  const handleRejectCandidate = async () => {
    if (!scope || runId == null || busy) return
    const targetWorldNodeId = candidate?.worldNodeId ?? activeWorldId
    const targetWorldGroupId = candidate?.worldGroupId ?? scopedGroupId
    if (targetWorldNodeId == null) return
    setBusy(true)
    setError(null)
    try {
      await rejectWorldMapConfigCandidateV1({ scope, worldGroupId: scopedGroupId, runId })
      if (isCurrentTarget(targetWorldNodeId, targetWorldGroupId)) {
        setCandidate(null)
        setRunId(null)
      }
    } catch (reason) {
      if (isCurrentTarget(targetWorldNodeId, targetWorldGroupId)) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      setBusy(false)
    }
  }

  const handleAbandonUnsafeRun = async () => {
    if (!scope || unsafeRunId == null || busy || activeWorldId == null) return
    const targetWorldNodeId = activeWorldId
    const targetWorldGroupId = scopedGroupId
    setBusy(true)
    try {
      await abandonWorldMapConfigRunV1({ scope, runId: unsafeRunId })
      if (isCurrentTarget(targetWorldNodeId, targetWorldGroupId)) {
        setUnsafeRunId(null)
        setError(null)
      }
    } catch (reason) {
      if (isCurrentTarget(targetWorldNodeId, targetWorldGroupId)) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      setBusy(false)
    }
  }

  const handleMapConfigChange = useCallback(async (patch: Partial<MapGenConfig>) => {
    const nextConfig = { ...(voronoiConfig ?? {}), ...patch }
    setVoronoiConfig(nextConfig)
    if (activeWorldId) {
      await updateNode(activeWorldId, {
        mapConfigJSON: JSON.stringify(nextConfig),
      })
    }
  }, [activeWorldId, updateNode, voronoiConfig])

  // ── 渲染 ─────────────────────────────────────────────────
  const generateButtonLabel = voronoiConfig ? 'AI 重新生成' : 'AI 生成地图'

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
          {/* 多世界：世界组切换（切换后整套世界树+地图跟随） */}
          {project.enableMultiWorld && <WorldGroupSwitcher />}
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
              type="button"
              disabled
              title="3D 地图仍处于 Labs 阶段，当前不可用"
              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors text-text-muted/50 cursor-not-allowed"
            >
              <Box className="w-3 h-3" /> 3D Labs
            </button>
          </div>

          <button
            onClick={handleGenerate}
            disabled={busy || !scope || !activeWorldId || !!candidate || unsafeRunId != null}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded-lg hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {busy ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                记录可恢复运行...
              </>
            ) : voronoiConfig ? (
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
      {error && (
        <div className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
          {unsafeRunId != null && (
            <button type="button" onClick={() => { void handleAbandonUnsafeRun() }} disabled={busy}
              className="ml-3 rounded px-2 py-1 text-xs text-red-300 hover:bg-red-400/10 disabled:opacity-50">
              放弃未知运行
            </button>
          )}
        </div>
      )}

      {candidate && (
        <div className="mb-3 p-3 bg-accent/10 border border-accent/20 rounded-lg">
          <div className="text-xs text-amber-400 mb-1">地图候选尚未写入</div>
          <div className="text-sm text-text-primary mb-1">
            {candidate.mapConfig.mapName} · {candidate.mapConfig.stateCount ?? 0} 国 · {candidate.mapConfig.heightmapTemplate}
          </div>
          <div className="text-xs text-text-muted mb-2">
            命名实体 {candidate.mapConfig.spatialEntities?.length ?? 0} 个，空间关系 {candidate.mapConfig.spatialRelations?.length ?? 0} 条。确认前主地图和正式数据保持不变。
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { void handleAcceptCandidate() }} disabled={busy}
              className="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50">
              <Check className="h-3 w-3" />确认使用此地图
            </button>
            <button type="button" onClick={() => { void handleRejectCandidate() }} disabled={busy}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-50">
              <X className="h-3 w-3" />放弃候选
            </button>
          </div>
        </div>
      )}

      {/* 主内容区域：世界树 + 地图 */}
      <div className="flex-1 flex min-h-0 rounded-lg overflow-hidden border border-border">
        {/* 世界树侧边栏 */}
        <WorldTreeSidebar projectId={project.id!} />

        {/* 地图区域 — 奇幻 Voronoi 地图 */}
        <div className="flex-1 min-w-0">
          <Suspense fallback={
            <div className="w-full h-full flex items-center justify-center bg-[#1a1f2e]">
              <div className="text-center text-text-muted">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-accent" />
                <p className="text-sm">加载地图引擎...</p>
              </div>
            </div>
          }>
            <WorldMapVoronoi
              key={activeWorldId ?? 'default'}
              config={voronoiConfig}
              onConfigChange={handleMapConfigChange}
            />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
