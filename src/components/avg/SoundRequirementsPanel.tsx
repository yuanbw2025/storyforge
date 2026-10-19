import { useEffect, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import type { AvgSoundTemplateV1 } from '../../lib/avg/sound-scope-contract'
import { listAvgSoundLibraryMetadataV1 } from '../../lib/avg/sound-provider-contract'
import { avgSoundPreparationEnabledV1, avgSoundProductionExecutionReadyV1 } from '../../lib/avg/sound-production-brief'
import { saveAvgSoundProductionDraftV1, clearAvgSoundProductionDraftV1, validateAvgSoundDraftSourcesV1 } from '../../lib/avg/sound-draft-service'
import { prepareAvgAssemblyBriefV1 } from '../../lib/avg/assembly-service'

type Props = {
  scope: WorkspaceScope; workspace: AvgAuthorWorkspaceV1; expectedDraftRevision: number
  disabled: boolean; canEdit: boolean; onPending: (value: boolean) => void
  onAction: (action: () => Promise<void>) => Promise<void>; onReload: () => Promise<void>; onNotice: (text: string) => void
}
const NAMES = { bgm: '背景音乐', ambience: '环境声', sfx: '一次性音效' }
const curated = listAvgSoundLibraryMetadataV1()

/** Author requirements only; original bytes and hearing are reviewed later.
 * The separate draft-editor switch cannot grant any formal execution rights. */
export default function SoundRequirementsPanel({ scope, workspace, expectedDraftRevision, disabled, canEdit,
  onPending, onAction, onReload, onNotice }: Props) {
  const saved = workspace.soundProduction?.scope
  const [templates, setTemplates] = useState<AvgSoundTemplateV1[]>(() => structuredClone(saved?.templates ?? []))
  const [dirty, setDirty] = useState(false)
  const [sourceStale, setSourceStale] = useState(false)
  const enabled = avgSoundPreparationEnabledV1()
  const library = [...curated, ...(saved?.librarySources.filter(s => !curated.some(c => c.sourceKey === s.sourceKey)) ?? [])]
  const lines = workspace.scripts.flatMap(script => script.lines.map(line => ({ ...line, sceneKey: script.sceneKey })))
  const locked = disabled || !canEdit || !enabled
  useEffect(() => { onPending(dirty); return () => onPending(false) }, [dirty, onPending])
  useEffect(() => {
    let active = true
    if (!workspace.soundProduction) { setSourceStale(false); return }
    void validateAvgSoundDraftSourcesV1(workspace.soundProduction, workspace).then(() => { if (active) setSourceStale(false) })
      .catch(() => { if (active) setSourceStale(true) })
    return () => { active = false }
  }, [workspace])
  const update = (index: number, change: (row: AvgSoundTemplateV1) => void) => {
    setTemplates(old => { const next = structuredClone(old); change(next[index]); return next }); setDirty(true)
  }
  const add = (channel: AvgSoundTemplateV1['channel']) => {
    const line = lines.find(l => !templates.some(t => t.channel === channel && t.cue.beatKey === l.lineKey && t.cue.phase === 'before')) ?? lines[0]
    if (!line) return
    const id = crypto.randomUUID(), key = `sound.${id}`
    setTemplates(old => [...old, { requirementKey: key, assetKey: key, channel, purpose: '', constraints: ['为对白留出空间，使用原创或已授权声音'],
      consumer: { consumerKey: `consumer.${id}`, domain: 'stage', slot: channel, subjectKey: line.sceneKey, sceneKey: line.sceneKey,
        lineKey: null, required: true, fallback: 'none' },
      cue: { cueKey: `cue.${id}`, beatKey: line.lineKey, phase: 'before', order: 10 + old.length, volume: channel === 'bgm' ? .2 : .6, loop: channel === 'bgm' },
      source: channel === 'bgm' ? { kind: 'generate-music', durationSeconds: 12, seed: 103, bpm: 68, keyscale: 'A Minor' }
        : { kind: 'licensed-library', allowedSourceKeys: curated[0] ? [curated[0].sourceKey] : [] } }])
    setDirty(true)
  }
  return <section className="lf-paper avg-sound-requirements" aria-label="音乐环境与音效需求（实验）">
    <h4>音乐、环境声与音效需求（实验）</h4>
    <p>先保存声音用途、触发位置与来源，再核对制作方案并明确开始。每批最多8项；本机音乐为10～30秒纯器乐，环境声与音效从已登记的Kenney CC0目录选择。</p>
    {!enabled && <p>已保存的声音需求仍保留，需求编辑入口尚未启用。可明确清除尚未用于演出的需求，继续普通制作。</p>}
    {!avgSoundProductionExecutionReadyV1() && <p role="status">正式声音制作与审听入口暂未开放。需求可独立保存和恢复。</p>}
    {sourceStale && <p role="status">规则、对白或画幅已变化，请重新核对触发位置并保存声音需求。</p>}
    {!lines.length && <p>请先保存场景中的对白或旁白，再添加声音触发位置。</p>}
    <fieldset disabled={locked}>
      {templates.map((t, index) => <fieldset className="avg-assembly-row" key={t.requirementKey} aria-label={`声音需求 ${index + 1}`}>
        <legend>{NAMES[t.channel]} {index + 1}</legend>
        <label>声音用途<textarea value={t.purpose} maxLength={2000} rows={2} placeholder="说明情绪、节奏、空间和叙事用途" onChange={e => update(index, r => { r.purpose = e.target.value })} /></label>
        <label>类别<select value={t.channel} onChange={e => update(index, r => {
          const channel = e.target.value as AvgSoundTemplateV1['channel']; r.channel = channel; r.consumer.slot = channel
          if (channel === 'bgm' && r.source.kind !== 'generate-music') r.source = { kind: 'generate-music', durationSeconds: 12, seed: 103, bpm: 68, keyscale: 'A Minor' }
          if (channel !== 'bgm' && r.source.kind !== 'licensed-library') r.source = { kind: 'licensed-library', allowedSourceKeys: [curated[0].sourceKey] }
          if (channel === 'sfx') r.cue.loop = false
        })}><option value="bgm">背景音乐</option><option value="ambience">环境声</option><option value="sfx">一次性音效</option></select></label>
        <label>触发台词<select value={t.cue.beatKey} onChange={e => update(index, r => {
          const line = lines.find(l => l.lineKey === e.target.value)
          if (line) { r.cue.beatKey = line.lineKey; r.consumer.sceneKey = line.sceneKey; r.consumer.subjectKey = line.sceneKey }
        })}>{!lines.some(line => line.lineKey === t.cue.beatKey) && <option value={t.cue.beatKey} disabled>原触发位置已失效，请重新选择</option>}{lines.map(line => <option key={line.lineKey} value={line.lineKey}>{workspace.systemPlan.scenes.find(s => s.key === line.sceneKey)?.title} · {line.text.slice(0, 60)}</option>)}</select></label>
        <label>时机<select value={t.cue.phase} onChange={e => update(index, r => { r.cue.phase = e.target.value as AvgSoundTemplateV1['cue']['phase'] })}><option value="before">句前</option><option value="during">句中</option><option value="after">句后</option></select></label>
        <label>音量<input type="number" min="0" max="1" step="0.05" value={t.cue.volume} onChange={e => update(index, r => { r.cue.volume = Number(e.target.value) })} /></label>
        <label><input type="checkbox" disabled={locked || t.channel === 'sfx'} checked={t.cue.loop} onChange={e => update(index, r => { r.cue.loop = e.target.checked })} />循环播放</label>
        <label>制作约束<textarea rows={2} value={t.constraints.join('\n')} onChange={e => update(index, r => { r.constraints = e.target.value.split('\n') })} /></label>
        {t.source.kind === 'generate-music' ? <>
          <label>时长（秒）<input type="number" min="10" max="30" value={t.source.durationSeconds} onChange={e => update(index, r => { if (r.source.kind === 'generate-music') r.source.durationSeconds = Number(e.target.value) })} /></label>
          <label>速度（BPM）<input type="number" min="30" max="300" value={t.source.bpm} onChange={e => update(index, r => { if (r.source.kind === 'generate-music') r.source.bpm = Number(e.target.value) })} /></label>
          <label>调性<input value={t.source.keyscale} placeholder="A Minor" onChange={e => update(index, r => { if (r.source.kind === 'generate-music') r.source.keyscale = e.target.value })} /></label>
          <label>生成种子<input type="number" min="0" max="2147483647" value={t.source.seed} onChange={e => update(index, r => { if (r.source.kind === 'generate-music') r.source.seed = Number(e.target.value) })} /></label>
          <p>本机固定模型只生成一次；供应商费为0，设备、电力和人工另计。实际听感与循环接缝须在原音频产出后核对。</p>
        </> : <><label>允许的音效来源<select multiple size={4} value={t.source.allowedSourceKeys} onChange={e => {
          const values = [...e.target.selectedOptions].map(o => o.value)
          update(index, r => { if (r.source.kind === 'licensed-library') r.source.allowedSourceKeys = values })
        }}>{library.map(source => <option key={source.sourceKey} value={source.sourceKey}>{source.publisherPage.split('/').pop()} · {source.memberPath}</option>)}</select></label><p>每项选择1～8个允许来源；方案只在所选范围内定向。生产时另核对原包、许可和原始音频，目录不代表审听通过。</p></>}
        <button className="lf-action" onClick={() => { setTemplates(old => old.filter((_, i) => i !== index)); setDirty(true) }}>移除此声音需求</button>
      </fieldset>)}
      <div className="avg-actions">{(['bgm', 'ambience', 'sfx'] as const).map(channel => <button key={channel} className="lf-action" disabled={!lines.length || templates.length >= 8} onClick={() => add(channel)}>添加{NAMES[channel]}</button>)}</div>
      <div className="avg-actions"><button className="lf-action lf-action-primary" disabled={(!dirty && !sourceStale) || !templates.length} onClick={() => void onAction(async () => {
        const keys = new Set(templates.flatMap(t => t.source.kind === 'licensed-library' ? t.source.allowedSourceKeys : []))
        const sources = [...keys].map(key => { const found = library.find(s => s.sourceKey === key); if (!found) throw new Error('声音来源已变化，请重新选择'); return found })
        await saveAvgSoundProductionDraftV1({ scope, expectedDraftRevision, planning: { schema: 'storyforge.avg.sound-planning-scope', version: 1,
          templates: templates.map(t => ({ ...t, constraints: t.constraints.map(s => s.trim()).filter(Boolean) })), librarySources: sources } })
        setDirty(false); await onReload(); onNotice('声音用途与准确位置已保存，可在刷新后继续核对。')
      })}>保存声音需求</button>
      <button className="lf-action" disabled={!dirty} onClick={() => { setTemplates(structuredClone(saved?.templates ?? [])); setDirty(false) }}>撤销声音需求输入</button>
      </div>
    </fieldset>
    <div className="avg-actions">
      <button className="lf-action" disabled={disabled || !canEdit || dirty || !saved} onClick={() => void onAction(async () => {
        await clearAvgSoundProductionDraftV1({ scope, expectedDraftRevision }); await onReload(); onNotice('未进入演出的声音需求已清除，原始产物与记录保留。')
      })}>清除未使用声音需求</button>
    <button className="lf-action" disabled={locked || dirty || !saved || !avgSoundProductionExecutionReadyV1()} onClick={() => void onAction(async () => {
      await prepareAvgAssemblyBriefV1({ scope, expectedDraftRevision }); await onReload(); onNotice('声音制作方案已保存，请到制作页核对后明确开始。')
    })}>核对并准备声音制作</button></div>
  </section>
}
