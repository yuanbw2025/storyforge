/**
 * 场景考证 — Phase 27.2a
 *
 * 写作/构思时一键考证：用户描述当前场景，AI 结合本作品的
 * 世界观 + 历史年表 + 真实与幻想规则，给出符合背景的细节、
 * 设定校验与情节灵感。
 */
import { useState, useEffect } from 'react'
import { ScanSearch, Sparkles, Loader2 } from 'lucide-react'
import { useWorldGroupStore } from '../../stores/world-group'
import { useAIStream } from '../../hooks/useAIStream'
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
  const ai = useAIStream()

  const draftKey = `sf-scene-verify-${project.id}`
  const [scene, setScene] = useState('')
  const [sceneEra, setSceneEra] = useState('')
  const [sceneLocation, setSceneLocation] = useState('')
  const [building, setBuilding] = useState(false)

  // 草稿持久化
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey)
      if (saved) {
        const d = JSON.parse(saved)
        setScene(d.scene || ''); setSceneEra(d.sceneEra || ''); setSceneLocation(d.sceneLocation || '')
      }
    } catch { /* ignore */ }
  }, [draftKey])
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(draftKey, JSON.stringify({ scene, sceneEra, sceneLocation })) } catch { /* ignore */ }
    }, 500)
    return () => clearTimeout(t)
  }, [draftKey, scene, sceneEra, sceneLocation])

  const handleVerify = async () => {
    if (!scene.trim()) return
    setBuilding(true)
    try {
      const assembled = await assembleContext({
        projectId: project.id!,
        worldGroupId: project.enableMultiWorld ? activeGroupId ?? null : null,
        sourceKeys: ['worldview', 'storyCore', 'powerSystem', 'codex', 'historical', 'worldRules', 'locations'],
      })
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
      })
      await ai.start(messages)
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
              描述你正在构思的场景，AI 结合本作品的世界观、历史年表与「真实与幻想」规则，给出符合背景的细节、设定校验与情节灵感。
            </p>
          </div>
          {project.enableMultiWorld && <WorldGroupSwitcher />}
        </div>
      </div>

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
          disabled={!scene.trim() || ai.isStreaming || building}
          className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {building || ai.isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {building ? '读取设定中...' : ai.isStreaming ? '考证中...' : '场景考证'}
        </button>
        {ai.isStreaming && (
          <button onClick={ai.stop} className="text-xs text-text-muted hover:text-red-500 transition-colors">停止</button>
        )}
      </div>

      {/* AI 输出（考证结果是 Markdown 散文，直接展示） */}
      {(ai.output || ai.isStreaming || ai.error) && (
        <AIStreamOutput
          output={ai.output}
          isStreaming={ai.isStreaming}
          error={ai.error}
          tokenUsage={ai.tokenUsage}
          onStop={ai.stop}
          onAccept={() => { /* 考证结果供参考，无需写入数据，采纳=无操作 */ }}
          onRetry={handleVerify}
          placeholder="考证结果会显示在这里..."
          moduleKey="scene.verify"
        />
      )}
    </div>
  )
}
