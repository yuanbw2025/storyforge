/**
 * Phase 26.4 — 灵感反推面板
 *
 * 用户写碎片灵感 → AI 反向生成世界观草稿 + 故事核心 + 初始角色卡 → 选择性采纳
 */

import { useState, useEffect, useRef } from 'react'
import {
  Lightbulb, Sparkles, Loader2, Check, ChevronDown, ChevronRight,
  Globe, BookOpen, UserCircle, ArrowDownToLine, Download,
} from 'lucide-react'
import { useWorldGroupStore } from '../../stores/world-group'
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import {
  buildInspirationReversePrompt,
  parseReverseOutput,
  buildInspirationReverseMultiWorldPrompt,
  parseReverseMultiWorldOutput,
  type ReverseResult,
  type ReverseCharacter,
  type ReverseMultiWorldResult,
} from '../../lib/ai/inspiration-reverse'
import { adopt } from '../../lib/registry/adopt'
import { CHARACTER_DIMENSIONS } from '../../lib/character/character-dimensions'
import AIStreamOutput from '../shared/AIStreamOutput'
import AutoResizeTextarea from '../shared/AutoResizeTextarea'
import type { Project } from '../../lib/types'
import { characterAxesLabel } from '../../lib/character/character-axes'

interface Props {
  project: Project
}

export default function InspirationPanel({ project }: Props) {
  const wgStore = useWorldGroupStore()
  const ai = useAIStream(createAISessionKey(project.id!, 'inspiration.reverse'))
  const isMW = !!project.enableMultiWorld

  const draftKey = `sf-inspiration-draft-${project.id}`
  const [inspiration, setInspiration] = useState('')
  const [userHint, setUserHint] = useState('')
  const [result, setResult] = useState<ReverseResult | null>(null)
  const [mwResult, setMwResult] = useState<ReverseMultiWorldResult | null>(null)
  const [mwAdopted, setMwAdopted] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['worldview', 'storyCore', 'characters']))
  const [adoptedSections, setAdoptedSections] = useState<Set<string>>(new Set())
  const [selectedChars, setSelectedChars] = useState<Set<number>>(new Set())
  const [adopting, setAdopting] = useState(false)
  const draftLoaded = useRef(false)

  // 草稿持久化：进入时加载灵感输入 + 已生成的反推结果（切走再回来不丢）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey)
      if (saved) {
        const d = JSON.parse(saved)
        setInspiration(d.inspiration || '')
        setUserHint(d.userHint || '')
        if (d.result) setResult(d.result)
        if (d.mwResult) {
          setMwResult(d.mwResult)
          setMwAdopted(!!d.mwAdopted)
        }
        if (d.result?.characters) setSelectedChars(new Set(d.result.characters.map((_: unknown, i: number) => i)))
      }
    } catch { /* ignore */ }
    draftLoaded.current = true
  }, [draftKey])
  // 变化时保存（含反推结果），首次加载完成后才开始写，避免覆盖已存草稿
  useEffect(() => {
    if (!draftLoaded.current) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify({ inspiration, userHint, result, mwResult, mwAdopted }))
      } catch { /* ignore */ }
    }, 500)
    return () => clearTimeout(t)
  }, [draftKey, inspiration, userHint, result, mwResult, mwAdopted])

  // 解析 AI 输出（多世界 / 单世界两条路径）
  useEffect(() => {
    if (ai.isStreaming || !ai.output) return
    if (isMW) {
      const parsed = parseReverseMultiWorldOutput(ai.output)
      if (parsed) setMwResult(parsed)
    } else {
      const parsed = parseReverseOutput(ai.output)
      if (parsed) {
        setResult(parsed)
        setSelectedChars(new Set(parsed.characters.map((_, i) => i)))
      }
    }
  }, [ai.isStreaming, ai.output, isMW])

  const handleGenerate = async () => {
    if (!inspiration.trim()) return
    setResult(null)
    setMwResult(null)
    setMwAdopted(false)
    setAdoptedSections(new Set())

    const genres = project.genres?.join('/') || project.genre || ''
    const messages = isMW
      ? buildInspirationReverseMultiWorldPrompt(project.name, genres, inspiration, userHint || undefined)
      : buildInspirationReversePrompt(project.name, genres, inspiration, userHint || undefined)
    await ai.start(messages, undefined, { category: 'inspiration.reverse', projectId: project.id! })
  }

  // ── 多世界：一键采纳（创建世界组 + 各世界世界观 + 故事核心 + 角色归属）──
  const handleAdoptMultiWorld = async () => {
    if (!mwResult || mwAdopted) return
    setAdopting(true)
    try {
      // 确保多世界已开启 + 主世界组存在
      await wgStore.migrateToMultiWorld(project.id!)

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
      // 已有主世界组（migrate 创建）：复用给输出中的 primary 世界（读最新 store 状态）
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
            historyLine: w.historyLine || '',
            races: w.races || '',
            factionLayout: w.factionLayout || '',
          },
        })
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
    const lines: string[] = [`# ${project.name} — 灵感反推结果\n`]
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
        if (w.historyLine) lines.push(`- 世界历史：${w.historyLine}`)
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
      if (wv.historyLine) lines.push(`- 世界历史：${wv.historyLine}`)
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
    a.download = `${project.name}-灵感反推.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const toggleChar = (idx: number) => {
    setSelectedChars(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  // ── 采纳世界观 ─────────────────────────────────
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
        historyLine: wv.historyLine || undefined,
        races: wv.races || undefined,
        factionLayout: wv.factionLayout || undefined,
      },
    })
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

  const allAdopted = adoptedSections.has('worldview') && adoptedSections.has('storyCore') && adoptedSections.has('characters')

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
          {/* CF-5: 超长非阻断提示——不静默截断，明确告知只适合短文本 */}
          {inspiration.length > 1500 && (
            <p className="mt-1.5 text-xs text-warning">
              ⚠️ 当前输入约 {inspiration.length} 字，偏长。灵感反推面向短灵感设计，过长内容 AI 可能只吃前半段；长篇正文请改用「文档解析 / 项目参考导入」。
            </p>
          )}
        </section>

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
            disabled={!inspiration.trim() || ai.isStreaming}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {ai.isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {ai.isStreaming ? '推演中...' : '开始反推'}
          </button>
          {ai.isStreaming && (
            <button onClick={ai.stop} className="text-xs text-text-muted hover:text-red-500 transition-colors">
              停止
            </button>
          )}
        </div>

        {/* ── AI 流式输出 ────────────────────────── */}
        {(ai.output || ai.isStreaming || ai.error) && (
          <AIStreamOutput
            output={ai.output}
            isStreaming={ai.isStreaming}
            error={ai.error}
            tokenUsage={ai.tokenUsage}
            onStop={ai.stop}
            onAccept={() => {
              if (isMW) {
                const parsed = parseReverseMultiWorldOutput(ai.output)
                if (parsed) setMwResult(parsed)
              } else {
                const parsed = parseReverseOutput(ai.output)
                if (parsed) {
                  setResult(parsed)
                  setSelectedChars(new Set(parsed.characters.map((_, i) => i)))
                }
              }
            }}
            onRetry={handleGenerate}
            placeholder="等待 AI 反推故事框架..."
            moduleKey={isMW ? 'inspiration.reverse.multiworld' : 'inspiration.reverse'}
          />
        )}

        {/* ── 多世界反推结果预览 ─────────────────────── */}
        {isMW && mwResult && !ai.isStreaming && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-text-primary">多世界反推结果（{mwResult.worlds.length} 个世界）</h3>
              <button
                onClick={handleAdoptMultiWorld}
                disabled={adopting || mwAdopted}
                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-40 transition-colors"
              >
                {adopting ? <Loader2 className="w-3 h-3 animate-spin" /> : mwAdopted ? <Check className="w-3 h-3" /> : <ArrowDownToLine className="w-3 h-3" />}
                {mwAdopted ? '已采纳' : '一键创建多世界'}
              </button>
            </div>

            {/* 故事核心 */}
            <div className="bg-bg-surface border border-border rounded-lg p-3 space-y-1 text-sm">
              <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary mb-1"><BookOpen className="w-3.5 h-3.5" /> 故事主线</div>
              {mwResult.storyCore.logline && <FieldRow label="一句话" value={mwResult.storyCore.logline} />}
              {mwResult.storyCore.mainPlot && <FieldRow label="主线" value={mwResult.storyCore.mainPlot} />}
              {mwResult.storyCore.centralConflict && <FieldRow label="核心冲突" value={mwResult.storyCore.centralConflict} />}
            </div>

            {/* 各世界 */}
            {mwResult.worlds.map((w, i) => (
              <div key={i} className="bg-bg-surface border border-border rounded-lg p-3 space-y-1 text-sm">
                <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary mb-1">
                  <Globe className="w-3.5 h-3.5" /> {w.name}
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-muted">{w.type}</span>
                </div>
                {w.worldOrigin && <FieldRow label="世界来源" value={w.worldOrigin} />}
                {w.powerHierarchy && <FieldRow label="力量体系" value={w.powerHierarchy} />}
                {w.factionLayout && <FieldRow label="势力分布" value={w.factionLayout} />}
                {w.entryCondition && <FieldRow label="进入条件" value={w.entryCondition} />}
                {w.powerRestriction && <FieldRow label="能力限制" value={w.powerRestriction} />}
              </div>
            ))}

            {/* 角色 */}
            {mwResult.characters.length > 0 && (
              <div className="bg-bg-surface border border-border rounded-lg p-3 space-y-1.5 text-sm">
                <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary mb-1"><UserCircle className="w-3.5 h-3.5" /> 初始角色（{mwResult.characters.length}）</div>
                {mwResult.characters.map((c, i) => (
                  <div key={i} className="text-xs">
                    <span className="text-text-primary font-medium">{c.name}</span>
                    <span className="text-text-muted"> · {characterAxesLabel(c)}</span>
                    {c.isCrossWorld ? <span className="ml-1 text-accent">🌐 跨世界</span> : c.homeWorld && <span className="ml-1 text-text-muted">@{c.homeWorld}</span>}
                    {c.shortDescription && <span className="text-text-muted"> — {c.shortDescription}</span>}
                  </div>
                ))}
              </div>
            )}

            {mwAdopted && (
              <p className="text-xs text-green-400">✓ 已创建 {mwResult.worlds.length} 个世界。前往「世界总览」查看，或在世界观面板切换世界编辑。</p>
            )}
          </section>
        )}

        {/* ── 结构化结果预览 ─────────────────────── */}
        {result && !ai.isStreaming && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-text-primary">反推结果</h3>
              {!allAdopted && (
                <button
                  onClick={handleAdoptAll}
                  disabled={adopting}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-40 transition-colors"
                >
                  {adopting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
                  一键全部采纳
                </button>
              )}
            </div>

            {/* ── 世界观卡片 ──────────────────────── */}
            <ResultCard
              title="世界观草稿"
              icon={<Globe className="w-4 h-4 text-blue-500" />}
              expanded={expandedSections.has('worldview')}
              onToggle={() => toggleSection('worldview')}
              adopted={adoptedSections.has('worldview')}
              onAdopt={handleAdoptWorldview}
              adopting={adopting}
              adoptLabel="写入世界观"
            >
              <div className="space-y-2 text-sm">
                {result.worldview.worldOrigin && (
                  <FieldRow label="世界来源" value={result.worldview.worldOrigin} />
                )}
                {result.worldview.powerHierarchy && (
                  <FieldRow label="力量体系" value={result.worldview.powerHierarchy} />
                )}
                {result.worldview.continentLayout && (
                  <FieldRow label="地貌分布" value={result.worldview.continentLayout} />
                )}
                {result.worldview.climateByRegion && (
                  <FieldRow label="气候环境" value={result.worldview.climateByRegion} />
                )}
                {result.worldview.historyLine && (
                  <FieldRow label="世界历史" value={result.worldview.historyLine} />
                )}
                {result.worldview.races && (
                  <FieldRow label="种族民族" value={result.worldview.races} />
                )}
                {result.worldview.factionLayout && (
                  <FieldRow label="势力分布" value={result.worldview.factionLayout} />
                )}
              </div>
            </ResultCard>

            {/* ── 故事核心卡片 ────────────────────── */}
            <ResultCard
              title="故事核心"
              icon={<BookOpen className="w-4 h-4 text-purple-500" />}
              expanded={expandedSections.has('storyCore')}
              onToggle={() => toggleSection('storyCore')}
              adopted={adoptedSections.has('storyCore')}
              onAdopt={handleAdoptStoryCore}
              adopting={adopting}
              adoptLabel="写入故事设计"
            >
              <div className="space-y-2 text-sm">
                {result.storyCore.logline && (
                  <FieldRow label="一句话故事" value={result.storyCore.logline} highlight />
                )}
                {result.storyCore.theme && (
                  <FieldRow label="主题" value={result.storyCore.theme} />
                )}
                {result.storyCore.centralConflict && (
                  <FieldRow label="核心冲突" value={result.storyCore.centralConflict} />
                )}
                {result.storyCore.plotPattern && (
                  <FieldRow label="情节模式" value={result.storyCore.plotPattern} />
                )}
                {result.storyCore.mainPlot && (
                  <FieldRow label="主线" value={result.storyCore.mainPlot} />
                )}
              </div>
            </ResultCard>

            {/* ── 角色卡片 ────────────────────────── */}
            <ResultCard
              title={`初始角色（${result.characters.length} 个）`}
              icon={<UserCircle className="w-4 h-4 text-orange-500" />}
              expanded={expandedSections.has('characters')}
              onToggle={() => toggleSection('characters')}
              adopted={adoptedSections.has('characters')}
              onAdopt={handleAdoptCharacters}
              adopting={adopting}
              adoptLabel={`写入角色库（${selectedChars.size} 个）`}
            >
              <div className="space-y-3">
                {result.characters.map((ch, i) => (
                  <CharacterCard
                    key={i}
                    char={ch}
                    selected={selectedChars.has(i)}
                    onToggle={() => toggleChar(i)}
                    adopted={adoptedSections.has('characters')}
                  />
                ))}
              </div>
            </ResultCard>
          </section>
        )}
      </div>
    </div>
  )
}

// ── 子组件 ──────────────────────────────────────────────────────────────

function ResultCard({
  title, icon, expanded, onToggle, adopted, onAdopt, adopting, adoptLabel, children,
}: {
  title: string
  icon: React.ReactNode
  expanded: boolean
  onToggle: () => void
  adopted: boolean
  onAdopt: () => void
  adopting: boolean
  adoptLabel: string
  children: React.ReactNode
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-2.5 bg-bg-surface cursor-pointer hover:bg-bg-hover transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
          {icon}
          <span className="text-sm font-medium text-text-primary">{title}</span>
        </div>
        {adopted ? (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Check className="w-3.5 h-3.5" /> 已采纳
          </span>
        ) : (
          <button
            onClick={e => { e.stopPropagation(); onAdopt() }}
            disabled={adopting}
            className="flex items-center gap-1 px-2.5 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            {adopting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
            {adoptLabel}
          </button>
        )}
      </div>
      {expanded && (
        <div className="px-4 py-3 border-t border-border">
          {children}
        </div>
      )}
    </div>
  )
}

function FieldRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <span className="text-xs text-text-muted">{label}：</span>
      <span className={`text-text-primary ${highlight ? 'font-medium text-accent' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function CharacterCard({
  char, selected, onToggle, adopted,
}: {
  char: ReverseCharacter
  selected: boolean
  onToggle: () => void
  adopted: boolean
}) {
  return (
    <div className={`border rounded-lg p-3 transition-colors ${selected ? 'border-accent bg-accent/10' : 'border-border'}`}>
      <div className="flex items-center gap-2 mb-2">
        {!adopted && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="accent-accent"
          />
        )}
        <span className="text-sm font-medium text-text-primary">{char.name}</span>
        <span className="text-xs px-1.5 py-0.5 bg-bg-hover rounded text-text-muted">
          {characterAxesLabel(char)}
        </span>
      </div>
      {char.shortDescription && (
        <p className="text-xs text-accent mb-1">{char.shortDescription}</p>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-muted">
        {char.personality && <span>性格：{char.personality}</span>}
        {char.motivation && <span>动机：{char.motivation}</span>}
        {char.background && <span className="col-span-2">背景：{char.background}</span>}
        {char.arc && <span className="col-span-2">弧光：{char.arc}</span>}
      </div>
    </div>
  )
}
