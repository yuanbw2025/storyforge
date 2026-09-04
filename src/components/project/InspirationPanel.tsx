/**
 * Phase 26.4 — 灵感反推面板
 *
 * 用户写碎片灵感 → AI 反向生成世界观草稿 + 故事核心 + 初始角色卡 → 选择性采纳
 */

import { useState } from 'react'
import {
  Lightbulb, Sparkles, Loader2, Download, Plus,
} from 'lucide-react'
import { useWorldGroupStore } from '../../stores/world-group'
import { adopt } from '../../lib/registry/adopt'
import { CHARACTER_DIMENSIONS } from '../../lib/character/character-dimensions'
import AIStreamOutput from '../shared/AIStreamOutput'
import AutoResizeTextarea from '../shared/AutoResizeTextarea'
import type { Project } from '../../lib/types'
import { characterAxesLabel } from '../../lib/character/character-axes'
import InspirationMultiWorldResult from './InspirationMultiWorldResult'
import InspirationSingleResult from './InspirationSingleResult'
import InspirationFusionReview from './InspirationFusionReview'
import type { InspirationSourceKind } from '../../lib/types/inspiration-workspace'
import { useIncrementalInspiration } from '../../hooks/useIncrementalInspiration'
import { MAX_INSPIRATION_FRAGMENT_CHARS } from '../../lib/inspiration/workspace'
import { useActiveWork } from '../../hooks/useActiveWork'

interface Props {
  project: Project
}

export default function InspirationPanel({ project }: Props) {
  const activeWork = useActiveWork(project)
  const wgStore = useWorldGroupStore()
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['worldview', 'storyCore', 'characters']))
  const [adoptedSections, setAdoptedSections] = useState<Set<string>>(new Set())
  const [adopting, setAdopting] = useState(false)
  const fusion = useIncrementalInspiration(project, () => setAdoptedSections(new Set()))
  const {
    ai,
    isMultiWorld: isMW,
    mode,
    workspace: inspirationWorkspace,
    inspiration,
    setInspiration,
    userHint,
    setUserHint,
    result,
    mwResult,
    mwAdopted,
    setMwAdopted,
    selectedChars,
    setSelectedChars,
    fragmentLabel,
    setFragmentLabel,
    sourceKind,
    setSourceKind,
    selectedFragmentIds,
    setSelectedFragmentIds,
    pendingDiff,
    confirmingFusion,
    fusionError,
    addCurrentFragment,
    generate: handleGenerate,
    confirmFusion: handleConfirmFusion,
    discardFusion: handleDiscardFusion,
    removeFragment: handleRemoveFragment,
    copilot,
    pendingCandidate,
  } = fusion
  const hasOtherPendingCandidates = copilot.pendingCandidates.some(candidate => (
    candidate !== pendingCandidate
      && (candidate.payload.agentId !== 'inspiration' || candidate.payload.skillId !== 'inspiration.reverse')
  ))

  // ── 多世界：一键采纳（创建世界组 + 各世界世界观 + 故事核心 + 角色归属）──
  const handleAdoptMultiWorld = async () => {
    if (!mwResult || mwAdopted) return
    setAdopting(true)
    try {
      // 确保多世界已开启 + 主世界组存在
      const enabled = await wgStore.enableMultiWorld(project.id!)
      if (!enabled) return

      // 1. 故事核心（项目级）
      const sc = mwResult.storyCore
      await adopt({
        projectId: project.id!,
        target: 'storyCores',
        mode: 'replace',
        data: {
          theme: sc.theme || undefined,
          centralConflict: sc.centralConflict || undefined,
          plotPattern: sc.plotPattern || undefined,
          mainPlot: sc.mainPlot || undefined,
          logline: sc.logline || undefined,
        },
      })

      // 2. 逐个世界：创建世界组 + 写入该世界的世界观（字段严格对齐 Worldview）
      const nameToGroupId = new Map<string, number>()
      // 复用现有主世界组给输出中的 primary 世界（读取最新 Store 状态）。
      const primaryGroupId = useWorldGroupStore.getState().groups.find(g => g.type === 'primary')?.id ?? null
      let primaryClaimed = false
      for (let i = 0; i < mwResult.worlds.length; i++) {
        const w = mwResult.worlds[i]
        let groupId: number
        if (w.type === 'primary' && primaryGroupId != null && !primaryClaimed) {
          groupId = primaryGroupId
          primaryClaimed = true
          await wgStore.updateGroup(groupId, {
            name: w.name, description: w.worldOrigin?.slice(0, 100) || '',
          })
        } else {
          groupId = await wgStore.createGroup({
            projectId: project.id!,
            name: w.name,
            description: w.worldOrigin?.slice(0, 100) || '',
            type: w.type,
            icon: '🌐',
            order: i,
            entryCondition: w.entryCondition || undefined,
            powerRestriction: w.powerRestriction || undefined,
          })
        }
        nameToGroupId.set(w.name, groupId)
        await adopt({
          projectId: project.id!,
          worldGroupId: groupId,
          target: 'worldviews',
          mode: 'replace',
          data: {
            worldOrigin: w.worldOrigin || '',
            powerHierarchy: w.powerHierarchy || '',
            continentLayout: w.continentLayout || '',
            climateByRegion: w.climateByRegion || '',
            races: w.races || '',
            factionLayout: w.factionLayout || '',
          },
        })
        if (w.historyOverview) {
          await adopt({
            projectId: project.id!,
            worldGroupId: groupId,
            target: 'histories',
            mode: 'replace',
            data: { overview: w.historyOverview },
          })
        }
      }

      // 3. 角色：按 homeWorld 归属，跨世界角色标记
      for (const c of mwResult.characters) {
        if (!c.name) continue
        const homeGroupId = c.isCrossWorld ? null : (nameToGroupId.get(c.homeWorld) ?? null)
        await adopt({
          projectId: project.id!,
          worldGroupId: homeGroupId,
          target: 'characters',
          mode: 'add',
          data: {
            name: c.name,
            roleWeight: c.roleWeight,
            moralAxis: c.moralAxis,
            orderAxis: c.orderAxis,
            isCrossWorld: c.isCrossWorld,
            // 维度字段从 CHARACTER_DIMENSIONS 单源派生：解析对象带什么就写什么，
            // 不硬编码字段表(空值由 adopt 跳过；缺的维度用户可后续 C1 补全)。
            ...Object.fromEntries(
              CHARACTER_DIMENSIONS
                .map(d => [d.key, (c as unknown as Record<string, unknown>)[d.key]])
                .filter(([, v]) => typeof v === 'string' && v),
            ),
          },
        })
      }

      // 刷新世界组 store
      await wgStore.loadAll(project.id!)
      setMwAdopted(true)
    } finally {
      setAdopting(false)
    }
  }

  // 导出反推结果为 Markdown 文件
  const handleExportResult = () => {
    const workTitle = activeWork?.title ?? '当前作品'
    const lines: string[] = [`# ${workTitle} — 灵感反推结果\n`]
    if (inspiration.trim()) lines.push(`## 原始灵感\n${inspiration}\n`)
    if (mwResult) {
      const sc = mwResult.storyCore
      lines.push(`## 故事主线`)
      if (sc.logline) lines.push(`- 一句话：${sc.logline}`)
      if (sc.theme) lines.push(`- 主题：${sc.theme}`)
      if (sc.centralConflict) lines.push(`- 核心冲突：${sc.centralConflict}`)
      if (sc.mainPlot) lines.push(`- 主线：${sc.mainPlot}`)
      lines.push('')
      mwResult.worlds.forEach((w, i) => {
        lines.push(`## 世界 ${i + 1}：${w.name}（${w.type}）`)
        if (w.worldOrigin) lines.push(`- 世界来源：${w.worldOrigin}`)
        if (w.powerHierarchy) lines.push(`- 力量体系：${w.powerHierarchy}`)
        if (w.continentLayout) lines.push(`- 地貌分布：${w.continentLayout}`)
        if (w.historyOverview) lines.push(`- 世界历史：${w.historyOverview}`)
        if (w.factionLayout) lines.push(`- 势力分布：${w.factionLayout}`)
        if (w.entryCondition) lines.push(`- 进入条件：${w.entryCondition}`)
        if (w.powerRestriction) lines.push(`- 能力限制：${w.powerRestriction}`)
        lines.push('')
      })
      if (mwResult.characters.length) {
        lines.push(`## 初始角色`)
        mwResult.characters.forEach(c => {
          const home = c.isCrossWorld ? '跨世界' : (c.homeWorld || '')
          lines.push(`- **${c.name}**（${characterAxesLabel(c)}${home ? ` · ${home}` : ''}）：${c.shortDescription}`)
        })
      }
    } else if (result) {
      const wv = result.worldview, sc = result.storyCore
      lines.push(`## 世界观`)
      if (wv.worldOrigin) lines.push(`- 世界来源：${wv.worldOrigin}`)
      if (wv.powerHierarchy) lines.push(`- 力量体系：${wv.powerHierarchy}`)
      if (wv.continentLayout) lines.push(`- 地貌分布：${wv.continentLayout}`)
      if (result.history.overview) lines.push(`- 世界历史：${result.history.overview}`)
      if (wv.factionLayout) lines.push(`- 势力分布：${wv.factionLayout}`)
      lines.push(`\n## 故事核心`)
      if (sc.logline) lines.push(`- 一句话：${sc.logline}`)
      if (sc.theme) lines.push(`- 主题：${sc.theme}`)
      if (sc.centralConflict) lines.push(`- 核心冲突：${sc.centralConflict}`)
      if (sc.mainPlot) lines.push(`- 主线：${sc.mainPlot}`)
      if (result.characters.length) {
        lines.push(`\n## 初始角色`)
        result.characters.forEach(c => lines.push(`- **${c.name}**（${characterAxesLabel(c)}）：${c.shortDescription}`))
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${workTitle}-灵感反推.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleChar = (idx: number) => {
    setSelectedChars(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  // ── 采纳世界基础与独立历史 ─────────────────────
  const handleAdoptWorldview = async () => {
    if (!result || adoptedSections.has('worldview')) return
    setAdopting(true)
    const wv = result.worldview
    await adopt({
      projectId: project.id!,
      target: 'worldviews',
      mode: 'replace',
      data: {
        worldOrigin: wv.worldOrigin || undefined,
        powerHierarchy: wv.powerHierarchy || undefined,
        continentLayout: wv.continentLayout || undefined,
        climateByRegion: wv.climateByRegion || undefined,
        races: wv.races || undefined,
        factionLayout: wv.factionLayout || undefined,
      },
    })
    if (result.history.overview) {
      await adopt({
        projectId: project.id!,
        target: 'histories',
        mode: 'replace',
        data: { overview: result.history.overview },
      })
    }
    setAdoptedSections(prev => new Set(prev).add('worldview'))
    setAdopting(false)
  }

  // ── 采纳故事核心 ─────────────────────────────────
  const handleAdoptStoryCore = async () => {
    if (!result || adoptedSections.has('storyCore')) return
    setAdopting(true)
    const sc = result.storyCore
    await adopt({
      projectId: project.id!,
      target: 'storyCores',
      mode: 'replace',
      data: {
        theme: sc.theme || undefined,
        centralConflict: sc.centralConflict || undefined,
        plotPattern: sc.plotPattern || undefined,
        mainPlot: sc.mainPlot || undefined,
        logline: sc.logline || undefined,
      },
    })
    setAdoptedSections(prev => new Set(prev).add('storyCore'))
    setAdopting(false)
  }

  // ── 采纳角色 ─────────────────────────────────────
  const handleAdoptCharacters = async () => {
    if (!result || adoptedSections.has('characters')) return
    setAdopting(true)
    for (const idx of Array.from(selectedChars).sort()) {
      const c = result.characters[idx]
      if (!c || !c.name) continue
      await adopt({
        projectId: project.id!,
        target: 'characters',
        mode: 'add',
        data: {
          name: c.name,
          roleWeight: c.roleWeight,
          moralAxis: c.moralAxis,
          orderAxis: c.orderAxis,
          // 维度字段从 CHARACTER_DIMENSIONS 单源派生（同上：不硬编码字段表）
          ...Object.fromEntries(
            CHARACTER_DIMENSIONS
              .map(d => [d.key, (c as unknown as Record<string, unknown>)[d.key]])
              .filter(([, v]) => typeof v === 'string' && v),
          ),
        },
      })
    }
    setAdoptedSections(prev => new Set(prev).add('characters'))
    setAdopting(false)
  }

  // ── 一键全部采纳 ─────────────────────────────────
  const handleAdoptAll = async () => {
    if (!result) return
    setAdopting(true)
    if (!adoptedSections.has('worldview')) await handleAdoptWorldview()
    if (!adoptedSections.has('storyCore')) await handleAdoptStoryCore()
    if (!adoptedSections.has('characters')) await handleAdoptCharacters()
    setAdopting(false)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部标题 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-bg-surface">
        <Lightbulb className="w-5 h-5 text-yellow-500" />
        <h2 className="text-lg font-semibold text-text-primary">灵感反推</h2>
        <span className="text-xs text-text-muted ml-2">从碎片想法反推完整故事框架</span>
        {(result || mwResult) && (
          <button
            onClick={handleExportResult}
            className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-bg-elevated text-text-secondary border border-border hover:text-accent hover:border-accent/50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> 导出结果
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* ── 灵感输入 ────────────────────────────── */}
        <section>
          <label className="block text-sm font-medium text-text-primary mb-1">
            写下你的灵感
          </label>
          {/* CF-5: 明确适用边界，避免用户误把长篇正文粘进来 */}
          <p className="text-xs text-text-muted mb-2">
            适合<strong>短灵感 / 梗概 / 片段想法</strong>（几句到一两段）。要从<strong>整章 / 整本正文</strong>提取设定，请用「文档解析 / 项目参考导入」，效果更完整。
          </p>
          <AutoResizeTextarea
            value={inspiration}
            onChange={e => setInspiration(e.target.value)}
            placeholder={"随便写点什么...\n\n例如：\n- 一个在末世废墟中寻找失踪妹妹的退役军人\n- 古代宫廷里，一个替身公主发现了皇帝的秘密\n- 赛博朋克 + 修仙，用代码修炼的程序员\n- 甚至只是几个关键词：深海、孤岛、失忆、怪物"}
            className="w-full text-sm bg-bg-base border border-border rounded-lg px-4 py-3 text-text-primary placeholder:text-text-muted resize-none"
            minRows={5}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={sourceKind}
              onChange={event => setSourceKind(event.target.value as InspirationSourceKind)}
              className="rounded border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text-secondary"
              aria-label="灵感来源"
            >
              <option value="author">本人灵感</option>
              <option value="reference">参考启发</option>
              <option value="research">研究资料</option>
              <option value="other">其他</option>
            </select>
            <input
              value={fragmentLabel}
              onChange={event => setFragmentLabel(event.target.value)}
              maxLength={80}
              placeholder="碎片标题（可选）"
              className="min-w-44 flex-1 rounded border border-border bg-bg-elevated px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted"
            />
            <button
              onClick={() => { void addCurrentFragment() }}
              disabled={!inspiration.trim() || inspiration.trim().length > MAX_INSPIRATION_FRAGMENT_CHARS}
              className="flex items-center gap-1 rounded border border-accent/40 px-3 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> 加入素材库
            </button>
          </div>
          {/* CF-5: 超长非阻断提示——不静默截断，明确告知只适合短文本 */}
          {inspiration.trim().length > 1500 && (
            <p className={`mt-1.5 text-xs ${
              inspiration.trim().length > MAX_INSPIRATION_FRAGMENT_CHARS ? 'text-red-400' : 'text-warning'
            }`}>
              {inspiration.trim().length > MAX_INSPIRATION_FRAGMENT_CHARS
                ? `当前输入 ${inspiration.trim().length} 字，超过单碎片 ${MAX_INSPIRATION_FRAGMENT_CHARS} 字上限。请拆成多个碎片；系统不会静默截断。`
                : `⚠️ 当前输入约 ${inspiration.trim().length} 字，偏长。灵感反推面向短灵感设计；长篇正文请改用「文档解析 / 项目参考导入」。`}
            </p>
          )}
        </section>

        {fusionError && (
          <p role="alert" className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400">
            {fusionError}
          </p>
        )}

        <InspirationFusionReview
          fragments={inspirationWorkspace.fragments}
          versions={inspirationWorkspace.versions}
          selectedIds={selectedFragmentIds}
          mode={mode}
          pendingDiff={pendingDiff}
          confirming={confirmingFusion}
          candidateDraft={pendingCandidate?.event.content ?? null}
          candidateInputSummary={pendingCandidate?.payload.contextEvidence
            ? '实际输入：' + (pendingCandidate.payload.contextEvidence.included.join('、') || '无')
              + '；估算 ' + pendingCandidate.payload.contextEvidence.estimatedInputTokens.toLocaleString() + ' tokens'
            : undefined}
          onCandidateChange={draft => {
            if (pendingCandidate?.event.id != null) {
              void copilot.updateCandidate(pendingCandidate.event.id, draft)
            }
          }}
          onToggle={fragmentId => {
            setSelectedFragmentIds(current => {
              const next = new Set(current)
              if (next.has(fragmentId)) next.delete(fragmentId)
              else next.add(fragmentId)
              return next
            })
          }}
          onRemove={fragmentId => { void handleRemoveFragment(fragmentId) }}
          onConfirm={() => { void handleConfirmFusion() }}
          onDiscard={handleDiscardFusion}
        />

        {/* ── 补充说明 ────────────────────────────── */}
        <section>
          <label className="block text-xs text-text-muted mb-1">补充说明（可选）</label>
          <AutoResizeTextarea
            value={userHint}
            onChange={e => setUserHint(e.target.value)}
            placeholder="例如：偏黑暗风格、需要感情线、主角要有反转..."
            className="w-full text-sm bg-bg-base border border-border rounded px-3 py-2 text-text-primary placeholder:text-text-muted resize-none"
            minRows={2}
          />
        </section>

        {/* ── 生成按钮 ────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleGenerate}
            disabled={
              (!inspiration.trim() && selectedFragmentIds.size === 0)
              || inspiration.trim().length > MAX_INSPIRATION_FRAGMENT_CHARS
              || ai.isStreaming
              || copilot.loading
              || copilot.pendingCandidates.length > 0
            }
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {ai.isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {ai.isStreaming ? '融合中...' : inspirationWorkspace.versions.some(version => version.mode === mode) ? '融合并更新' : '开始反推'}
          </button>
          {ai.isStreaming && (
            <button onClick={ai.stop} className="text-xs text-text-muted hover:text-red-500 transition-colors">
              停止
            </button>
          )}
          {copilot.recoveryAvailable && !copilot.busy && (
            <button
              onClick={() => { void copilot.resume() }}
              className="text-xs text-accent hover:text-accent-hover transition-colors"
            >
              恢复中断任务
            </button>
          )}
        </div>
        {hasOtherPendingCandidates && (
          <p className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
            主 Agent 还有其他待确认候选，请先在右侧副驾中处理。
          </p>
        )}

        {/* ── AI 流式输出 ────────────────────────── */}
        {(ai.output || ai.isStreaming || ai.error) && (
          <AIStreamOutput
            output={ai.output}
            isStreaming={ai.isStreaming}
            error={ai.error}
            tokenUsage={ai.tokenUsage}
            onStop={ai.stop}
            onRetry={handleGenerate}
            placeholder="等待 AI 反推故事框架..."
            moduleKey={isMW ? 'inspiration.reverse.multiworld' : 'inspiration.reverse'}
          />
        )}

        {/* ── 多世界反推结果预览 ─────────────────────── */}
        {isMW && mwResult && !ai.isStreaming && (
          <InspirationMultiWorldResult
            result={mwResult}
            adopted={mwAdopted}
            adopting={adopting}
            adoptionLocked={pendingDiff !== null}
            onAdopt={handleAdoptMultiWorld}
          />
        )}

        {/* ── 结构化结果预览 ─────────────────────── */}
        {result && !ai.isStreaming && (
          <InspirationSingleResult
            result={result}
            expandedSections={expandedSections}
            adoptedSections={adoptedSections}
            selectedChars={selectedChars}
            adopting={adopting}
            adoptionLocked={pendingDiff !== null}
            onToggleSection={toggleSection}
            onToggleCharacter={toggleChar}
            onAdoptWorldview={handleAdoptWorldview}
            onAdoptStoryCore={handleAdoptStoryCore}
            onAdoptCharacters={handleAdoptCharacters}
            onAdoptAll={handleAdoptAll}
          />
        )}
      </div>
    </div>
  )
}
