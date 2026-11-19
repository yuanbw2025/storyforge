/**
 * 场景考证 — Phase 27.2a
 *
 * 写作/构思时一键考证：用户描述当前场景，AI 结合本作品的
 * 世界观 + 历史年表 + 真实与幻想规则，给出符合背景的细节、
 * 设定校验与情节灵感。
 */
import { useState, useEffect, useRef } from 'react'
import { ScanSearch, Sparkles, Loader2 } from 'lucide-react'
import { useWorldGroupStore } from '../../stores/world-group'
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { assembleContext } from '../../lib/registry/assemble-context'
import { buildSceneVerifyPrompt } from '../../lib/ai/adapters/scene-verify-adapter'
import AIStreamOutput from '../shared/AIStreamOutput'
import AutoResizeTextarea from '../shared/AutoResizeTextarea'
import { CInput } from '../shared/CompositionInput'
import WorldGroupSwitcher from '../world-group/WorldGroupSwitcher'
import type { Project } from '../../lib/types'

interface Props {
  project: Project
}

export default function SceneVerifyPanel({ project }: Props) {
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  const ai = useAIStream(createAISessionKey(
    project.id!,
    'scene.verify',
    `${project.activeWorldId}:${project.activeWorkId}:${project.enableMultiWorld ? activeGroupId ?? 'global' : 'project'}`,
  ))

  const scopeKey = `${project.id}:${project.activeWorldId}:${project.activeWorkId}:${project.enableMultiWorld ? activeGroupId : 'single'}`
  const currentScope = useRef(scopeKey); currentScope.current = scopeKey
  const draftKey = `sf-scene-verify-v2-${scopeKey}`
  const [scene, setScene] = useState('')
  const [sceneEra, setSceneEra] = useState('')
  const [sceneLocation, setSceneLocation] = useState('')
  const [researchMode, setResearchMode] = useState<'scene' | 'plan' | 'sources'>('scene')
  const [sources, setSources] = useState('')
  const [readSources, setReadSources] = useState<string[]>([])
  const [building, setBuilding] = useState(false)
  const [researchError, setResearchError] = useState('')
  const [hasLegacyDraft, setHasLegacyDraft] = useState(false)
  const [legacyText, setLegacyText] = useState('')

  // 草稿持久化
  useEffect(() => {
    setLegacyText(''); setHasLegacyDraft(false); setResearchError(''); setScene(''); setSceneEra(''); setSceneLocation(''); setSources(''); setReadSources([]); setResearchMode('scene')
    try {
      setHasLegacyDraft(!!localStorage.getItem(`sf-scene-verify-${project.id}`))
      const saved = localStorage.getItem(draftKey)
      if (saved) {
        const d = JSON.parse(saved)
        setScene(d.scene || ''); setSceneEra(d.sceneEra || ''); setSceneLocation(d.sceneLocation || ''); setSources(d.sources || ''); if (['scene', 'plan', 'sources'].includes(d.researchMode)) setResearchMode(d.researchMode)
      }
    } catch { /* ignore */ }
  }, [draftKey, project.id])
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify({ scene, sceneEra, sceneLocation, sources, researchMode })) } catch { /* ignore */ }
    }, 500)
    return () => clearTimeout(t)
  }, [draftKey, scene, sceneEra, sceneLocation, sources, researchMode])

  const handleVerify = async () => {
    if (!scene.trim() || !project.activeWorldId || !project.activeWorkId) return
    const operationScope = scopeKey
    setBuilding(true)
    setResearchError('')
    try {
      const assembled = await assembleContext({
        projectId: project.id!,
        scope: { projectId: project.id!, worldId: project.activeWorldId, workId: project.activeWorkId },
        manualSourceText: sources.trim() ? `【作者本轮提供的资料（未经本系统核验）】\n${sources.trim()}` : '',
        worldGroupId: project.enableMultiWorld ? activeGroupId ?? null : null,
        sourceKeys: ['canonAssertions', 'worldview', 'storyCore', 'powerSystem', 'codex', 'historical', 'worldRules', 'locations', 'references', 'manualText'],
      })
      if (currentScope.current !== operationScope) return
      if (sources.trim() && (!assembled.included.includes('manualText') || assembled.trimmed?.includes('manualText') || assembled.sourceEvidence?.some(source => source.key === 'manualText' && source.delivery === 'truncated'))) throw new Error('本次资料未完整进入上下文预算，请减少材料或缩小研究问题；未发起模型分析。')
      setReadSources(assembled.segments.map(segment => segment.label).filter(Boolean))
      const part = (key: string) => {
        const idx = assembled.included.indexOf(key)
        return idx >= 0 ? assembled.segments[idx]?.content ?? '' : ''
      }
      const worldContext = assembled.text
      const historyContext = part('historical')
      const worldRulesContext = part('worldRules')
      setBuilding(false)
      const messages = buildSceneVerifyPrompt({
        worldContext,
        historyContext,
        worldRulesContext,
        scene,
        sceneEra: sceneEra || undefined,
        sceneLocation: sceneLocation || undefined,
        researchMode, hasSuppliedSources: !!sources.trim() || assembled.included.includes('references'),
      })
      await ai.start(messages, undefined, {
        formalEntryId: 'world.scene.verify', category: 'scene.verify', projectId: project.id!,
      })
    } catch (error) {
      if (currentScope.current === operationScope) setResearchError(error instanceof Error ? error.message : '研究资料读取失败，请检查后重试。')
    } finally {
      setBuilding(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      {/* 顶部 */}
      <div className="pb-4 border-b border-border/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
              <ScanSearch className="w-5 h-5" /> 场景考证
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              描述你正在构思的场景，AI 结合本作品的世界观、历史年表与「真实与幻想」规则，给出资料分析、待核实问题与写作建议。本入口不联网检索，模型建议不代表已完成考证。
            </p>
          </div>
          {project.enableMultiWorld && <WorldGroupSwitcher />}
        </div>
      </div>

      {hasLegacyDraft && <aside className="rounded border border-border p-3 text-xs text-text-muted">
        发现旧版项目级场景草稿，未标明所属作品。原文保留，可查看后手动复制到当前作品；不会自动交给模型。
        <button type="button" className="ml-2 text-accent" onClick={() => setLegacyText(localStorage.getItem(`sf-scene-verify-${project.id}`) || '')}>查看旧草稿</button>
        {legacyText && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">{legacyText}</pre>}
      </aside>}
      <label className="block text-sm">本轮研究任务
        <select aria-label="研究任务" value={researchMode} onChange={event => setResearchMode(event.target.value as typeof researchMode)} disabled={building || ai.isStreaming} className="ml-3 rounded border border-border bg-bg-base p-2">
          <option value="scene">场景与设定分析</option><option value="plan">研究计划</option><option value="sources">已有资料审读</option>
        </select>
      </label>
      <label className="block text-sm">本次资料与出处（可空，保留原文、时间、地区和来源说明）
        <AutoResizeTextarea aria-label="研究资料" value={sources} onChange={event => setSources(event.target.value)} minRows={3} className="mt-2 w-full rounded border border-border bg-bg-base p-3" />
      </label>
      {readSources.length > 0 && <p className="text-xs text-text-muted">本次实际读取：{readSources.join('、')}；未联网核验。</p>}

      {/* 场景输入 */}
      <section>
        <label className="block text-sm font-medium text-text-primary mb-2">当前场景</label>
        <AutoResizeTextarea
          value={scene}
          onChange={e => setScene(e.target.value)}
          placeholder={'描述你正在写或构思的场景，越具体越好。\n\n例如：主角在宋代汴京的酒楼里，与一名丝绸商人讨价还价，想压低一批江南绸缎的进货价。'}
          className="w-full text-sm bg-bg-base border border-border rounded-lg px-4 py-3 text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent"
          minRows={4}
        />
      </section>

      {/* 时代 / 地点（可选） */}
      <section className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">时代/时间背景（可选）</label>
          <CInput
            value={sceneEra}
            onChange={e => setSceneEra(e.target.value)}
            placeholder="如：北宋仁宗年间 / 穿越后第三年"
            className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">地点（可选）</label>
          <CInput
            value={sceneLocation}
            onChange={e => setSceneLocation(e.target.value)}
            placeholder="如：汴京樊楼 / 斗气大陆乌坦城"
            className="w-full px-3 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>
      </section>

      {/* 考证按钮 */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleVerify}
          disabled={!scene.trim() || !project.activeWorldId || !project.activeWorkId || ai.isStreaming || building}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {building || ai.isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {building ? '读取设定中...' : ai.isStreaming ? '分析中...' : '生成研究建议'}
        </button>
        {ai.isStreaming && (
          <button onClick={ai.stop} className="text-xs text-text-muted hover:text-red-500 transition-colors">停止</button>
        )}
      </div>

      {researchError && <p role="alert" className="text-sm text-error">{researchError}</p>}
      {/* 只读研究建议，不提供虚假的采纳按钮 */}
      {(ai.output || ai.isStreaming || ai.error) && (
        <AIStreamOutput
          output={ai.output}
          isStreaming={ai.isStreaming}
          error={ai.error}
          tokenUsage={ai.tokenUsage}
          onStop={ai.stop}
          onRetry={handleVerify}
          placeholder="研究计划、资料分析与待核实事项会显示在这里..."
          moduleKey="scene.verify"
        />
      )}
    </div>
  )
}
