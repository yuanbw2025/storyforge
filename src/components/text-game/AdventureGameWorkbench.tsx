import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileJson2,
  GitBranch,
  Loader2,
  Map,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import {
  deleteAdventureGameDraft,
  loadAdventureAuthoringSnapshot,
  publishAdventureGameDraft,
  saveAdventureContent,
  seedAdventureAcceptanceGame,
  updateAdventureGameDefinition,
  validateAdventureGameDraft,
  type AdventureAuthoringSnapshot,
  type AdventureDraftReport,
} from '../../lib/adventure/authoring'
import {
  availableAdventureActions,
  createInitialAdventureState,
  parseAdventureContent,
  validateAdventureContent,
} from '../../lib/adventure/runtime'
import type { WorkspaceScope } from '../../lib/types'
import { useDialog } from '../shared/Dialog'

type View = 'overview' | 'content' | 'preview' | 'diagnostics' | 'release'

const EMPTY: AdventureAuthoringSnapshot = {
  definitions: [], modules: [], nodes: [], adventureModules: [], releases: [],
}

function messages(report: AdventureDraftReport | null): string[] {
  if (!report) return []
  return [
    ...report.errors,
    ...report.warnings,
    ...report.adventure.unreachableLocationKeys.map(key => `不可达地点：${key}`),
    ...report.adventure.unavailableQuestKeys.map(key => `无法接受任务：${key}`),
    ...report.adventure.sourceLessItemKeys.map(key => `无来源物品：${key}`),
    ...report.narrative.danglingSuccessors.map(item => `Narrative 断链：${item.nodeKey} → ${item.successorKey}`),
    ...report.narrative.invalidChoiceTargets.map(item => `Choice 目标无效：${item.choiceKey} → ${item.targetNodeKey}`),
    ...report.narrative.unreachableNodeKeys.map(key => `Narrative 不可达：${key}`),
    ...report.narrative.blockingCycleKeys.map(keys => `Narrative 无出口循环：${keys.join(' → ')}`),
    ...report.interaction.diagnostics.map(item => `角色互动${item.severity === 'error' ? '错误' : '警告'}：${item.message}`),
  ]
}

export default function AdventureGameWorkbench(props: { scope: WorkspaceScope }) {
  const dialog = useDialog()
  const [snapshot, setSnapshot] = useState(EMPTY)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [view, setView] = useState<View>('overview')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [report, setReport] = useState<AdventureDraftReport | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [editor, setEditor] = useState('')
  const [previewLocation, setPreviewLocation] = useState('')

  const load = async (preferId?: number | null) => {
    const next = await loadAdventureAuthoringSnapshot(props.scope)
    setSnapshot(next)
    setSelectedId(previous => {
      const desired = preferId === undefined ? previous : preferId
      return desired != null && next.definitions.some(item => item.id === desired)
        ? desired
        : next.definitions[0]?.id ?? null
    })
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true); setError(''); setMessage(''); setReport(null)
    void load().catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scope.projectId, props.scope.worldId, props.scope.workId])

  const definition = snapshot.definitions.find(item => item.id === selectedId) ?? null
  const module = snapshot.adventureModules.find(item => item.gameDefinitionId === selectedId) ?? null
  const releases = snapshot.releases.filter(item => item.gameDefinitionId === selectedId)
  const parsed = useMemo(() => {
    try { return { content: parseAdventureContent(editor), error: '' } }
    catch (reason) { return { content: null, error: reason instanceof Error ? reason.message : String(reason) } }
  }, [editor])
  const draftReport = useMemo(() => parsed.content ? validateAdventureContent(parsed.content) : null, [parsed.content])
  const preview = useMemo(() => {
    if (!parsed.content) return null
    const state = createInitialAdventureState(parsed.content, '0'.repeat(64))
    if (previewLocation && parsed.content.locations.some(item => item.key === previewLocation)) {
      state.currentLocationKey = previewLocation
      if (!state.visitedLocationKeys.includes(previewLocation)) state.visitedLocationKeys.push(previewLocation)
    }
    return {
      state,
      location: parsed.content.locations.find(item => item.key === state.currentLocationKey)!,
      actions: availableAdventureActions(parsed.content, state),
    }
  }, [parsed.content, previewLocation])

  useEffect(() => {
    if (!definition || !module) { setTitle(''); setDescription(''); setEditor(''); return }
    setTitle(definition.title); setDescription(definition.description); setEditor(module.contentJson)
    try { setPreviewLocation(parseAdventureContent(module.contentJson).initialLocationKey) } catch { setPreviewLocation('') }
    setReport(null)
  }, [definition, module])

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const refresh = async () => { await load(selectedId); setReport(null) }
  const createSample = () => run(async () => {
    const created = await seedAdventureAcceptanceGame({
      scope: props.scope, title: '雾港潮汐钟', gameKey: `mist-harbor-${Date.now().toString(36)}`,
    })
    await load(created.id!); setView('overview'); setMessage('已创建可发布验收冒险，包含地点、物品、能力、任务、判定与三种结局。')
  })
  const save = () => run(async () => {
    if (!definition || !parsed.content) throw new Error(parsed.error || '冒险内容无效。')
    await updateAdventureGameDefinition({ scope: props.scope, gameDefinitionId: definition.id!, title, description })
    await saveAdventureContent({ scope: props.scope, gameDefinitionId: definition.id!, contentJson: JSON.stringify(parsed.content) })
    await refresh(); setMessage('冒险定义与内容已保存。')
  })
  const validate = () => run(async () => {
    if (!definition) return
    const next = await validateAdventureGameDraft(props.scope, definition.id!)
    setReport(next); setView('diagnostics')
    setMessage(next.valid ? '内容图、任务图和共享 Narrative 图均通过发布校验。' : '')
  })
  const publish = () => run(async () => {
    if (!definition) return
    const result = await publishAdventureGameDraft({ scope: props.scope, gameDefinitionId: definition.id! })
    setReport(result.report); await refresh(); setView('release')
    setMessage(`已冻结 GameRelease v${result.gameRelease.version}；后续草稿修改不会改变该发布。`)
  })
  const remove = () => run(async () => {
    if (!definition) return
    const confirmed = await dialog.confirm({
      title: `删除草稿“${definition.title}”？`,
      message: 'AdventureModule 和专属 Narrative 草稿会清理；不可变发布及已有玩家存档保持可回放。',
      confirmText: '删除草稿', tone: 'danger',
    })
    if (!confirmed) return
    await deleteAdventureGameDraft({ scope: props.scope, gameDefinitionId: definition.id! })
    await load(null); setMessage('草稿已删除；历史发布保持冻结。')
  })

  const counts = parsed.content ? [
    ['地点', parsed.content.locations.length], ['交互物', parsed.content.objects.length],
    ['物品', parsed.content.items.length], ['行动', parsed.content.actions.length],
    ['任务', parsed.content.quests.length], ['能力 / 资源', parsed.content.abilities.length + parsed.content.resources.length],
  ] : []

  return <div className="storygame-author" data-testid="adventure-game-workbench">
    <aside className="storygame-author-sidebar">
      <div className="storygame-author-sidebar-head"><strong>文字冒险草稿</strong><button title="刷新" onClick={() => void refresh()}><RefreshCw className="h-3.5 w-3.5" /></button></div>
      <div className="storygame-author-game-list">{snapshot.definitions.map(item => <button key={item.id} className={item.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(item.id!)}><strong>{item.title}</strong><small>{item.gameKey}</small></button>)}</div>
      <button className="storygame-author-create sample" disabled={busy} onClick={() => void createSample()}><Plus className="h-3.5 w-3.5" />创建验收冒险</button>
      <p>内容保存在 AdventureModule；发布复用 WorldRevision、WorldRelease 与统一 GameRelease。</p>
    </aside>
    <main className="storygame-author-main">
      <header className="storygame-author-toolbar"><div><strong>{definition?.title ?? '文字冒险作者工作台'}</strong><span>TEXTADV-1 · DETERMINISTIC ADVENTURE</span></div><nav>{([
        ['overview', '总览'], ['content', '内容 JSON'], ['preview', '状态预览'], ['diagnostics', '发布检查'], ['release', '发布版本'],
      ] as Array<[View, string]>).map(([key, label]) => <button key={key} disabled={!definition} className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}</button>)}</nav></header>
      {message && <div className="storygame-author-notice success"><CheckCircle2 className="h-4 w-4" /><span>{message}</span></div>}
      {error && <div className="storygame-author-notice error" role="alert"><AlertTriangle className="h-4 w-4" /><span>{error}</span></div>}
      {loading && <div className="storygame-empty"><Loader2 className="h-7 w-7 animate-spin" /><p>正在加载作者数据…</p></div>}
      {!loading && !definition && <div className="storygame-empty"><Map className="h-8 w-8" /><h2>创建第一份有限地点冒险</h2><p>验收模板提供 6 个地点、4 条任务、物品/资源/能力判定、替代解法和三种状态驱动结局。</p><button className="storygame-author-create" onClick={() => void createSample()}><Plus className="h-4 w-4" />创建验收冒险</button></div>}
      {!loading && definition && <>
        {view === 'overview' && <section className="storygame-author-pane"><div className="storygame-author-heading"><div><small>GAME DEFINITION</small><h2>冒险定义与内容概览</h2></div><div className="storygame-author-actions"><button onClick={() => void save()} disabled={busy || !!parsed.error}><Save className="h-3.5 w-3.5" />保存</button><button className="danger" onClick={() => void remove()} disabled={busy}><Trash2 className="h-3.5 w-3.5" />删除</button></div></div><div className="storygame-author-form-grid"><label>标题<input value={title} onChange={event => setTitle(event.target.value)} /></label><label>稳定标识<input value={definition.gameKey} readOnly /></label><label className="wide">简介<textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label></div><div className="storygame-author-summary-grid">{counts.map(([label, value]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}</div><div className="storygame-author-contract"><ShieldCheck className="h-5 w-5" /><div><strong>统一架构边界</strong><p>世界事实来自 WorldRelease；故事走 NarrativeModule/Node/Beat/Choice；运行状态只写 SIM 事件流；AI 自由输入仅产生待确认的 action key 候选。</p></div></div></section>}
        {view === 'content' && <section className="storygame-author-pane"><div className="storygame-author-heading"><div><small>ADVENTURE MODULE</small><h2>正式内容契约</h2></div><button disabled={busy || !!parsed.error} onClick={() => void save()}><Save className="h-3.5 w-3.5" />校验并保存</button></div>{parsed.error && <div className="storygame-author-notice error"><AlertTriangle className="h-4 w-4" /><span>{parsed.error}</span></div>}<label className="storygame-json-editor">AdventureContentV1<textarea aria-label="AdventureContentV1 JSON" rows={34} spellCheck={false} value={editor} onChange={event => setEditor(event.target.value)} /></label>{draftReport && <div className={`storygame-author-notice ${draftReport.valid ? 'success' : 'error'}`}><FileJson2 className="h-4 w-4" /><span>{draftReport.valid ? '结构、引用、可达性和任务替代路线有效。' : draftReport.errors.join('；')}</span></div>}</section>}
        {view === 'preview' && <section className="storygame-author-pane"><div className="storygame-author-heading"><div><small>DRAFT STATE PREVIEW</small><h2>从任意地点检查初始可玩状态</h2></div><Play className="h-5 w-5 text-accent" /></div>{parsed.content && preview && <><div className="storygame-preview-start"><label>预览地点<select value={preview.location.key} onChange={event => setPreviewLocation(event.target.value)}>{parsed.content.locations.map(item => <option key={item.key} value={item.key}>{item.title} · {item.key}</option>)}</select></label></div><div className="storygame-author-card-grid"><article className="storygame-author-card"><small>CURRENT LOCATION</small><h3>{preview.location.title}</h3><p>{preview.location.description}</p><code>{preview.location.key}</code></article><article className="storygame-author-card"><small>INITIAL STATE</small><p>物品 {preview.state.inventory.length} · 任务 {preview.state.quests.length} · 能力 {Object.keys(preview.state.abilities).length} · 资源 {Object.keys(preview.state.resources).length}</p></article></div><h3 className="storygame-author-subheading">该状态下的地点行动</h3><div className="storygame-author-card-grid">{preview.actions.map(item => <article key={item.action.key} className="storygame-author-card"><div className="storygame-author-card-head"><strong>{item.action.label}</strong><code>{item.action.kind}</code></div><p>{item.action.description}</p><small>{item.available ? '初始可用' : item.reason}</small></article>)}</div></>}</section>}
        {view === 'diagnostics' && <section className="storygame-author-pane"><div className="storygame-author-heading"><div><small>GRAPH & RELEASE GATE</small><h2>发布前诊断</h2></div><button disabled={busy} onClick={() => void validate()}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}运行校验</button></div>{!report && <div className="storygame-empty"><GitBranch className="h-7 w-7" /><p>检查断链、无效目标、不可达地点/节点、任务锁死、缺失结局与循环风险。</p></div>}{report && <><div className={`storygame-author-notice ${report.valid ? 'success' : 'error'}`}>{report.valid ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}<span>{report.valid ? '所有发布闸门通过。' : '存在阻断问题。'}</span></div><div className="storygame-diagnostic-list">{messages(report).map((item, index) => <article key={`${index}:${item}`}><AlertTriangle className="h-3.5 w-3.5" /><span>{item}</span></article>)}{report.valid && !messages(report).length && <article><CheckCircle2 className="h-3.5 w-3.5" /><span>没有错误或警告。</span></article>}</div></>}</section>}
        {view === 'release' && <section className="storygame-author-pane"><div className="storygame-author-heading"><div><small>IMMUTABLE GAME RELEASE</small><h2>发布冻结</h2></div><button disabled={busy} onClick={() => void publish()}><Rocket className="h-3.5 w-3.5" />校验并发布</button></div><div className="storygame-author-contract"><ShieldCheck className="h-5 w-5" /><div><strong>发布只冻结正式依赖</strong><p>当前 WorldRevision 与 Narrative/Adventure 内容被复制进带 hash 的 GameRelease；玩家实例始终绑定该不可变版本。</p></div></div><div className="storygame-release-list-author">{releases.map(item => <article key={item.id}><div><strong>v{item.version} · {item.label}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.contentHash.slice(0, 12)}</small></div><CheckCircle2 className="h-4 w-4" /></article>)}{!releases.length && <p>尚无正式发布。</p>}</div></section>}
      </>}
    </main>
  </div>
}
