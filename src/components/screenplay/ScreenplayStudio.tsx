import ScreenplayPlanning, { type PlanningStage } from './ScreenplayPlanning'
import ScreenplaySource from './ScreenplaySource'
import type { ScreenplayProfessionalStageV1 } from '../../lib/screenplay/durable-production'
import { readScreenplayAuthorDraft, saveScreenplayAuthorDraft } from '../../lib/screenplay/author-drafts'
import { queueCandidateDraftV1, flushCandidateDraftsV1 } from '../../lib/agent/candidate-draft-coordinator'
import { registerPendingDraftFlusherV1, flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { useDialog } from '../shared/Dialog'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Download, FileText, Lock, Merge, Plus, Printer, RefreshCw, Save, Scissors, Trash2, Undo2, Unlock } from 'lucide-react'
import { nanoid } from 'nanoid'
import { db } from '../../lib/db/schema'
import type { AdaptationFreshnessReport } from '../../lib/adaptation/source-manifest'
import { inspectAdaptationFreshness, listActiveSourceUnits, resyncAdaptationSource } from '../../lib/adaptation/source-manifest'
import { reopenAdaptationProductionV1 } from '../../lib/adaptation/completion'
import type { AdaptationProject, AdaptationSourceUnit, CreationReleaseV1, ScreenplayBlock, ScreenplayScene, Work, WorkspaceScope } from '../../lib/types'
import {
  createScreenplayScene,
  deleteScreenplayScene,
  duplicateScreenplayScene,
  listScreenplayScenes,
  mergeScreenplayScenes,
  reorderScreenplayScenes,
  setScreenplaySceneLocked,
  splitScreenplayScene,
  updateScreenplayScene,
} from '../../lib/screenplay/service'
import { renderScreenplayFdxV1, renderScreenplayFountainV1, renderScreenplayPrintHtmlV1, screenplayRenderDocumentFromReleaseV1 } from '../../lib/screenplay/renderers'
import { validateScreenplayBlocksV1 } from '../../lib/screenplay/contracts'
import { inspectScreenplayCompletionV1, type ScreenplayCompletionReportV1 } from '../../lib/screenplay/production'
import { listScreenplayReleasesV1, publishScreenplayReleaseV1, readScreenplayReleaseManifestV1 } from '../../lib/screenplay/release'
import ScreenplayPipelinePanel from './ScreenplayPipelinePanel'
import ScreenplayShowcase from './ScreenplayShowcase'
import './screenplay-studio.css'

interface Props { scope: WorkspaceScope; page?: string }
const BLOCK_TYPES: ScreenplayBlock['type'][] = ['action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'note']
const BLOCK_LABEL: Record<ScreenplayBlock['type'], string> = { action: '动作', character: '角色', parenthetical: '括注', dialogue: '对白', transition: '转场', shot: '镜头', note: '作者注释' }

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function newBlock(type: ScreenplayBlock['type']): ScreenplayBlock {
  const id = `block_${nanoid(12)}`
  return type === 'character' ? { id, type, name: '' } : { id, type, text: '' } as ScreenplayBlock
}

function convertBlock(block: ScreenplayBlock, type: ScreenplayBlock['type']): ScreenplayBlock {
  const value = block.type === 'character' ? block.name : block.text
  return type === 'character' ? { id: block.id, type, name: value } : { id: block.id, type, text: value } as ScreenplayBlock
}

function editableScene(scene:ScreenplayScene) {
  return {planSectionKey:scene.planSectionKey,episodeNumber:scene.episodeNumber,sceneNumber:scene.sceneNumber,intExt:scene.intExt,location:scene.location,timeOfDay:scene.timeOfDay,summary:scene.summary,estimatedSeconds:scene.estimatedSeconds,sourceUnitIds:scene.sourceUnitIds,blocks:scene.blocks,status:scene.status}
}

function portableSceneDraft(scene:ScreenplayScene) {
  const {sourceUnitIds:_sourceIds,...body}=editableScene(scene)
  return {...body,blocks:scene.blocks.map(block=>{if(block.type!=='character')return block;const {characterId:_id,...cue}=block;return cue})}
}
function restoreSceneDraft(scene:ScreenplayScene,draft:ReturnType<typeof portableSceneDraft>):ScreenplayScene {
  return {...scene,...editableScene({...scene,...draft}),sourceUnitIds:scene.sourceUnitIds,blocks:draft.blocks.map(block=>{const current=scene.blocks.find(row=>row.id===block.id);return block.type==='character'&&current?.type==='character'?{...block,characterId:current.characterId}:block})}
}

export default function ScreenplayStudio({ scope, page }: Props) {
  const dialog = useDialog()
  const [sub,setSub] = useState('')
  const sections: Record<string, [string,string][]> = {source:[['source','原文与范围'],['facts','原作事实'],['edges','因果关系']],brief:[['brief','改编要求'],['decisions','删改决定'],['settings','剧本与署名']],structure:[['beats','结构与节拍']],scenes:[['cards','场次规划'],['scenes','成稿目录']]}
  const activeSub = sections[page??'']?.some(([id])=>id===sub)?sub:sections[page??'']?.[0]?.[0]
  const allowed: Record<string,ScreenplayProfessionalStageV1[]> = {source:['source-analysis','causal-graph'],brief:['adaptation-brief','decision-pass'],structure:['beat-sheet'],scenes:['scene-card'],editor:['scene-draft'],grounding:['grounding-review','targeted-rewrite'],review:['dramaturgy-review','targeted-rewrite']}
  const draftPrefix=`screenplay:${scope.workId}:scene:`
  const editCounter=useRef(0)
  useEffect(()=>registerPendingDraftFlusherV1(()=>flushCandidateDraftsV1(draftPrefix)),[draftPrefix])
  const [adaptation, setAdaptation] = useState<AdaptationProject | null>(null)
  const [work, setWork] = useState<Work | null>(null)
  const [units, setUnits] = useState<AdaptationSourceUnit[]>([])
  const [scenes, setScenes] = useState<ScreenplayScene[]>([])
  const [releases, setReleases] = useState<CreationReleaseV1[]>([])
  const [selectedReleaseId, setSelectedReleaseId] = useState<number | null>(null)
  const [completion, setCompletion] = useState<ScreenplayCompletionReportV1 | null>(null)
  const [freshness, setFreshness] = useState<AdaptationFreshnessReport | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editing, setEditingRaw] = useState<ScreenplayScene | null>(null)
  const setEditing = (next:ScreenplayScene|null) => {
    editCounter.current++;setEditingRaw(next)
    if(next)queueCandidateDraftV1({key:draftPrefix+next.id,draft:JSON.stringify(portableSceneDraft(next)),debounceMs:250,persist:text=>saveScreenplayAuthorDraft(scope,`scene:${next.stableKey}:r${next.revision}`,text),onError:c=>setError(c.message)})
  }
  const assertSaved = () => {
    const stored=scenes.find(scene=>scene.id===editing?.id)
    if(editing&&stored&&JSON.stringify(editableScene(editing))!==JSON.stringify(editableScene(stored)))throw new Error('当前场景有未保存修改，请先保存场景，再生成、审查或改变状态。编辑草稿会为你保留。')
  }
  const [history, setHistory] = useState<ScreenplayBlock[][]>([])
  const [future, setFuture] = useState<ScreenplayBlock[][]>([])
  const [dragId, setDragId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    const [root, targetWork] = await Promise.all([db.adaptationProjects.where('workId').equals(scope.workId).first(), db.works.get(scope.workId)])
    if (!root || root.medium !== 'screenplay' || !targetWork) throw new Error('当前作品不是有效剧本改编。')
    const [sourceUnits, rows, fresh, releaseRows, completionReport] = await Promise.all([listActiveSourceUnits(root.id!), listScreenplayScenes(scope), inspectAdaptationFreshness(root.id!), listScreenplayReleasesV1(scope), inspectScreenplayCompletionV1(scope)])
    setAdaptation(root); setWork(targetWork); setUnits(sourceUnits); setScenes(rows); setFreshness(fresh); setReleases(releaseRows); setCompletion(completionReport)
    setSelectedReleaseId(current => current != null && releaseRows.some(row => row.id === current) ? current : releaseRows[releaseRows.length - 1]?.id ?? null)
    setSelectedId(current => current != null && rows.some(row => row.id === current) ? current : rows[0]?.id ?? null)
  }, [scope])
  useEffect(() => { void reload().catch(cause => setError(cause instanceof Error ? cause.message : '读取剧本失败')) }, [reload])
  const selectedScene=scenes.find(scene=>scene.id===selectedId)
  useEffect(() => {
    let cancelled=false;const initial=editCounter.current
    setEditingRaw(selectedScene?structuredClone(selectedScene):null);setHistory([]);setFuture([])
    if(selectedScene)void readScreenplayAuthorDraft(scope,`scene:${selectedScene.stableKey}:r${selectedScene.revision}`).then(text=>{
      if(!cancelled&&initial===editCounter.current&&text)setEditingRaw(restoreSceneDraft(selectedScene,JSON.parse(text)))
    }).catch(c=>setError(String(c)))
    return()=>{cancelled=true}
  // Reloads with the same scene revision must not replace unsaved author text.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[selectedScene?.id,selectedScene?.revision,scope])

  const act = async (action: () => Promise<unknown>, allowDirty = false) => { if (busy) return; setBusy(true); setError(''); try { if(!allowDirty)assertSaved(); await flushPendingEditsV1(); await action(); await reload() } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败') } finally { setBusy(false) } }
  const pushBlocks = (blocks: ScreenplayBlock[]) => { if (!editing) return; setHistory(current => [...current.slice(-39), structuredClone(editing.blocks)]); setFuture([]); setEditing({ ...editing, blocks }) }
  const updateBlock = (index: number, block: ScreenplayBlock) => pushBlocks(editing!.blocks.map((item, itemIndex) => itemIndex === index ? block : item))
  const undo = () => { if (!editing || !history.length) return; const previous = history[history.length - 1]; setFuture(current => [structuredClone(editing.blocks), ...current]); setHistory(current => current.slice(0, -1)); setEditing({ ...editing, blocks: previous }) }
  const redo = () => { if (!editing || !future.length) return; const next = future[0]; setHistory(current => [...current, structuredClone(editing.blocks)]); setFuture(current => current.slice(1)); setEditing({ ...editing, blocks: next }) }

  const stats = useMemo(() => {
    const blocks = scenes.flatMap(scene => scene.blocks)
    const dialogueChars = blocks.filter(block => block.type === 'dialogue').reduce((sum, block) => sum + block.text.length, 0)
    return {
      seconds: scenes.reduce((sum, scene) => sum + scene.estimatedSeconds, 0),
      dialogueChars,
      locations: new Set(scenes.map(scene => `${scene.intExt}:${scene.location}:${scene.timeOfDay}`)).size,
      cues: blocks.filter(block => block.type === 'character').length,
    }
  }, [scenes])

  if (!adaptation || !work) return <div className="screenplay-loading">{error || '正在打开剧本工作台…'}</div>
  if (adaptation.medium !== 'screenplay') return <div className="screenplay-loading">当前改编媒介不是剧本。</div>
  const productionReady = !page || ['editor','versions'].includes(page) || activeSub==='scenes'
  const isComplete = adaptation.status === 'complete'
  const sourceLabel = freshness?.status === 'unchanged' ? '来源未变化' : freshness?.status === 'changed' ? '来源已变化' : freshness?.status === 'missing' ? '来源缺失' : '已脱离来源'

  const createScene = () => {
    void act(async () => {
      const cards = await db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals([adaptation.id!, adaptation.activeSourceManifestVersion]).sortBy('order')
      const card = cards.find(item => !scenes.some(scene => scene.stableKey === item.stableKey))
      if (!card) throw new Error('没有尚未写作的 Scene Card。')
      const beat = await db.screenplayBeats.where('[adaptationProjectId+manifestVersion]').equals([adaptation.id!, adaptation.activeSourceManifestVersion]).filter(item => item.stableKey === card.beatKey).first()
      if (!beat) throw new Error('Scene Card 对应的 Beat 已缺失。')
      const unitByKey = new Map(units.map(unit => [unit.sourceUnitKey, unit]))
      const sourceUnitIds = card.sourceUnitKeys.map(key => unitByKey.get(key)?.id).filter((id): id is number => Number.isInteger(id))
      return createScreenplayScene(scope, { stableKey: card.stableKey, planSectionKey: beat.sectionKey, episodeNumber: card.episodeNumber, sceneNumber: card.sceneNumber, order: card.order, intExt: 'INT', location: '待确认地点', timeOfDay: '日', summary: card.purpose, estimatedSeconds: card.estimatedSeconds, sourceUnitIds, blocks: [{ id: `block_${nanoid(12)}`, type: 'action', text: card.visibleAction }] })
    })
  }

  const save = () => {
    if (!editing?.id) return
    const report = validateScreenplayBlocksV1(editing.blocks)
    if (!report.valid) { setError(report.issues.filter(item => item.level === 'error').map(item => item.message).join('；')); return }
    void act(() => updateScreenplayScene({ scope, sceneId: editing.id!, expectedRevision: editing.revision, patch: { planSectionKey: editing.planSectionKey, episodeNumber: editing.episodeNumber, sceneNumber: editing.sceneNumber, intExt: editing.intExt, location: editing.location, timeOfDay: editing.timeOfDay, summary: editing.summary, estimatedSeconds: editing.estimatedSeconds, sourceUnitIds: editing.sourceUnitIds, blocks: editing.blocks, status: editing.status === 'card' ? 'draft' : editing.status } }), true)
  }

  const reorder = (fromId: number, toId: number) => {
    const ids = scenes.map(scene => scene.id!)
    const from = ids.indexOf(fromId); const to = ids.indexOf(toId)
    if (from < 0 || to < 0 || from === to) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    void act(() => reorderScreenplayScenes({ scope, orderedSceneIds: ids }))
  }
  const exportRelease = async (format: 'fountain' | 'fdx' | 'print') => {
    if (!selectedReleaseId) { setError('请先发布一个不可变剧本版本。'); return }
    try {
      const manifest = await readScreenplayReleaseManifestV1(scope, selectedReleaseId)
      const document = screenplayRenderDocumentFromReleaseV1(manifest)
      if (format === 'fountain') download(`${work.title}-v${releases.find(row => row.id === selectedReleaseId)?.version}.fountain`, renderScreenplayFountainV1(document), 'text/plain;charset=utf-8')
      else if (format === 'fdx') download(`${work.title}-v${releases.find(row => row.id === selectedReleaseId)?.version}.fdx`, renderScreenplayFdxV1(document), 'application/xml;charset=utf-8')
      else { const popup = window.open('', '_blank'); if (popup) { popup.document.write(renderScreenplayPrintHtmlV1(document)); popup.document.close(); popup.focus(); setTimeout(() => popup.print(), 250) } }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导出 Release 失败') }
  }
  return <div className="screenplay-studio">
    <header className="screenplay-top"><div><h2>{work.title}</h2><p>{adaptation.targetSpec.format === 'film' ? '电影' : adaptation.targetSpec.format === 'series' ? '剧集' : '短剧'}</p></div><div className={`screenplay-source ${freshness?.status ?? ''}`}><strong>{isComplete ? '正式完稿 · 当前只读' : sourceLabel}</strong><small>manifest v{adaptation.activeSourceManifestVersion}</small>{isComplete ? <button onClick={() => void act(() => reopenAdaptationProductionV1({ scope, expectedRevision: adaptation.revision }))}><Unlock className="h-4 w-4" />重新打开审校</button> : freshness?.status === 'changed' && <button onClick={() => void act(() => resyncAdaptationSource({ adaptationProjectId: adaptation.id!, expectedRevision: adaptation.revision }))}><RefreshCw className="h-4 w-4" />确认同步</button>}</div></header>
    {page&&sections[page]&&<nav className="sp-subnav" aria-label="页面内导航">{sections[page].map(([id,label])=><button key={id} className={activeSub===id?'active':''} onClick={()=>{void flushPendingEditsV1().then(()=>setSub(id)).catch(c=>setError(String(c)))}}>{label}</button>)}</nav>}
    {activeSub==='source'&&<ScreenplaySource scope={scope} root={adaptation} units={units}/>}
    {activeSub&&activeSub!=='source'&&activeSub!=='scenes'&&<ScreenplayPlanning key={`${scope.projectId}:${scope.worldId}:${scope.workId}:${adaptation.id}:${adaptation.revision}:${activeSub}`} scope={scope} root={adaptation} units={units} stage={activeSub as PlanningStage} onChanged={reload}/>}

    {productionReady && <>
      <nav className="screenplay-toolbar">
        <button hidden={page==='versions'} onClick={createScene} disabled={isComplete || busy || freshness?.status !== 'unchanged'}><Plus className="h-4 w-4" />从下一张 Scene Card 新建</button>
        <details className="screenplay-export-tools" open={page==='versions'}><summary>版本与导出</summary><div className="screenplay-export-actions">
        <label className="screenplay-release-picker">版本<select value={selectedReleaseId ?? ''} onChange={event => setSelectedReleaseId(event.target.value ? Number(event.target.value) : null)}><option value="">尚未发布</option>{releases.map(release => <option key={release.id} value={release.id}>v{release.version}</option>)}</select></label>
        <button onClick={() => void exportRelease('fountain')} disabled={!selectedReleaseId}><Download className="h-4 w-4" />Fountain</button>
        <button onClick={() => void exportRelease('fdx')} disabled={!selectedReleaseId}><FileText className="h-4 w-4" />FDX</button>
        <button onClick={() => void exportRelease('print')} disabled={!selectedReleaseId}><Printer className="h-4 w-4" />PDF 打印</button>
        <button className="primary" onClick={() => void act(() => publishScreenplayReleaseV1({ scope, expectedAdaptationRevision: adaptation.revision }))} disabled={busy || isComplete || !completion?.ready}><Check className="h-4 w-4" />{isComplete ? `已发布 v${releases[releases.length - 1]?.version ?? 1}` : '发布不可变版本'}</button>
        </div></details>
        <span>{Math.round(stats.seconds / 60)} 分钟 · {stats.locations} 个场景地点 · {stats.cues} 次角色 cue · {stats.dialogueChars} 字对白</span>
      </nav>
      {completion && !completion.ready && <details className="screenplay-completion" open={page==='versions'}><summary>发布前还需处理 {completion.blockers.length} 项</summary>{completion.blockers.map(item => <p key={item}>{item}</p>)}{completion.warnings.map(item => <small key={item}>{item}</small>)}</details>}
      {page!=='versions'&&<div className="screenplay-layout">
        <aside className="screenplay-tree"><header><strong>场景树</strong><small>{scenes.length} 场</small></header>{scenes.map((scene, index) => <button key={scene.id} draggable onDragStart={() => setDragId(scene.id!)} onDragOver={event => event.preventDefault()} onDrop={() => { if (dragId) reorder(dragId, scene.id!); setDragId(null) }} className={scene.id === selectedId ? 'active' : ''} onClick={() => void flushPendingEditsV1().then(()=>setSelectedId(scene.id!)).catch(c=>setError(String(c)))}><span>{index + 1}</span><div><strong>{scene.intExt === 'INT_EXT' ? 'INT./EXT.' : scene.intExt} {scene.location} - {scene.timeOfDay}</strong><small>第 {scene.episodeNumber} 集 · 场 {scene.sceneNumber} · {Math.round(scene.estimatedSeconds / 60)} 分</small></div>{scene.status === 'locked' && <Lock className="h-3.5 w-3.5" />}</button>)}</aside>
        <main className="screenplay-editor"><fieldset disabled={isComplete||editing?.status==='locked'}>{editing ? <><div className="screenplay-scene-meta"><select value={editing.planSectionKey} onChange={event => setEditing({ ...editing, planSectionKey: event.target.value })}>{adaptation.plan?.sections.map(section => <option key={section.stableKey} value={section.stableKey}>{section.title}</option>)}</select><label>集<input type="number" min={1} value={editing.episodeNumber} onChange={event => setEditing({ ...editing, episodeNumber: Number(event.target.value) })} /></label><label>场<input type="number" min={1} value={editing.sceneNumber} onChange={event => setEditing({ ...editing, sceneNumber: Number(event.target.value) })} /></label><select value={editing.intExt} onChange={event => setEditing({ ...editing, intExt: event.target.value as ScreenplayScene['intExt'] })}><option value="INT">INT.</option><option value="EXT">EXT.</option><option value="INT_EXT">INT./EXT.</option></select><input value={editing.location} onChange={event => setEditing({ ...editing, location: event.target.value })} placeholder="地点" /><input value={editing.timeOfDay} onChange={event => setEditing({ ...editing, timeOfDay: event.target.value })} placeholder="时间" /><label>秒<input type="number" min={1} value={editing.estimatedSeconds} onChange={event => setEditing({ ...editing, estimatedSeconds: Number(event.target.value) })} /></label></div><textarea className="screenplay-summary" value={editing.summary} onChange={event => setEditing({ ...editing, summary: event.target.value })} placeholder="场景目的、冲突和转折" />
          <div className="screenplay-edit-actions"><button onClick={undo} disabled={!history.length}><Undo2 className="h-4 w-4" />撤销</button><button onClick={redo} disabled={!future.length}><Undo2 className="h-4 w-4 rotate-180" />重做</button><button onClick={() => pushBlocks([...editing.blocks, newBlock('action')])}><Plus className="h-4 w-4" />增加块</button><button onClick={save} disabled={isComplete || busy || editing.status === 'locked'}><Save className="h-4 w-4" />保存场景</button></div>
          <div className="screenplay-blocks">{editing.blocks.map((block, index) => <article key={block.id} className={block.type}><div><select value={block.type} onChange={event => updateBlock(index, convertBlock(block, event.target.value as ScreenplayBlock['type']))}>{BLOCK_TYPES.map(type => <option key={type} value={type}>{BLOCK_LABEL[type]}</option>)}</select><button onClick={() => pushBlocks(editing.blocks.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-3.5 w-3.5" /></button></div>{block.type === 'character' ? <div className="screenplay-cue-edit"><input value={block.name} onChange={event => updateBlock(index, { ...block, name: event.target.value })} placeholder="角色名" /><select value={block.extension ?? ''} onChange={event => updateBlock(index, { ...block, extension: event.target.value ? event.target.value as any : undefined })}><option value="">无扩展</option><option value="V.O.">V.O.</option><option value="O.S.">O.S.</option><option value="O.C.">O.C.</option><option value="CONT'D">CONT'D</option></select><label><input type="checkbox" checked={block.dualDialogue === true} onChange={event => updateBlock(index, { ...block, dualDialogue: event.target.checked })} />双栏对白</label></div> : <textarea value={block.text} onChange={event => updateBlock(index, { ...block, text: event.target.value } as ScreenplayBlock)} onKeyDown={event => { if (event.key === 'Tab') { event.preventDefault(); const next = BLOCK_TYPES[(BLOCK_TYPES.indexOf(block.type) + (event.shiftKey ? BLOCK_TYPES.length - 1 : 1)) % BLOCK_TYPES.length]; updateBlock(index, convertBlock(block, next)) } if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save() } }} />}</article>)}</div>
        </> : <div className="screenplay-empty">新建或选择一个场景开始。</div>}</fieldset></main>
        <aside className="screenplay-inspector"><section><h3>来源证据</h3><p>{sourceLabel}</p>{editing?.sourceUnitIds.map(id => { const unit = units.find(item => item.id === id); return unit ? <div key={id}><strong>{unit.label}</strong><small>{unit.summary}</small></div> : <div key={id}>历史来源单元 #{id}</div> })}</section>{editing && <section><h3>场景操作</h3><button onClick={() => void act(() => updateScreenplayScene({ scope, sceneId: editing.id!, expectedRevision: editing.revision, patch: { status: 'reviewed' } }))} disabled={isComplete || editing.status === 'locked' || editing.status === 'reviewed'}><Check className="h-4 w-4" />标记已审定</button><button onClick={() => void act(() => setScreenplaySceneLocked({ scope, sceneId: editing.id!, expectedRevision: editing.revision, locked: editing.status !== 'locked' }))} disabled={isComplete}>{editing.status === 'locked' ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}{editing.status === 'locked' ? '解锁' : '锁定'}</button><button onClick={() => void act(() => duplicateScreenplayScene({ scope, sceneId: editing.id! }))} disabled={isComplete}><Copy className="h-4 w-4" />复制</button><button onClick={() => void act(async () => { const index=await dialog.prompt({title:'从哪一段之前拆分？',message:`当前 ${editing.blocks.length} 段。输入 2～${editing.blocks.length}；角色与对白请放在同一场。`,defaultValue:String(Math.max(2,Math.floor(editing.blocks.length/2)+1))}); if(index!==null)await splitScreenplayScene({scope,sceneId:editing.id!,blockIndex:Number(index)-1,expectedRevision:editing.revision}) })} disabled={isComplete || editing.blocks.length < 2}><Scissors className="h-4 w-4" />拆分</button>{(() => { const index = scenes.findIndex(scene => scene.id === editing.id); const next = scenes[index + 1]; return next ? <button onClick={() => void act(() => mergeScreenplayScenes({ scope, firstSceneId: editing.id!, secondSceneId: next.id!, expectedFirstRevision: editing.revision, expectedSecondRevision: next.revision }))} disabled={isComplete}><Merge className="h-4 w-4" />与下一场合并</button> : null })()}<button className="danger" onClick={() => void act(async () => { if(await dialog.confirm({title:'删除当前成稿？',message:'保留场次卡，之后可以重新写作。',confirmText:'删除成稿'}))await deleteScreenplayScene({scope,sceneId:editing.id!}) })} disabled={isComplete}><Trash2 className="h-4 w-4" />删除</button></section>}</aside>
      </div>}
    </>}
    {(!page||allowed[page])&&<details className="sp-ai-tools" open={page!=='editor'}><summary>AI 辅助与候选审阅</summary><ScreenplayPipelinePanel scope={scope} adaptation={adaptation} sourceUnits={units} scenes={scenes} onChanged={reload} beforeAction={assertSaved} allowedStages={page?allowed[page]:undefined}/></details>}
    {error && <div className="screenplay-error" role="alert">{error}</div>}
    {!page&&<ScreenplayShowcase />}
  </div>
}
