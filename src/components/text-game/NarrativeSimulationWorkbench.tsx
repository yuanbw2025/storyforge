import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileJson2,
  FlaskConical,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import {
  createNarrativeSimulationAcceptanceContent,
  createNarrativeSimulationGame,
  deleteNarrativeSimulationGameDraft,
  loadNarrativeSimulationAuthoringSnapshot,
  saveNarrativeSimulationContent,
  updateNarrativeSimulationDefinition,
  validateNarrativeSimulationGame,
  type NarrativeSimulationAuthoringSnapshot,
  type NarrativeSimulationDraftReport,
} from '../../lib/narrative-simulation/authoring'
import {
  parseNarrativeSimulationContent,
  runNarrativeSimulationBatch,
  validateNarrativeSimulationContent,
} from '../../lib/narrative-simulation/runtime'
import type { WorkspaceScope } from '../../lib/types'
import { useDialog } from '../shared/Dialog'

type View = 'overview' | 'content' | 'balance' | 'diagnostics' | 'release'
const EMPTY: NarrativeSimulationAuthoringSnapshot = {
  definitions: [], narrativeModules: [], narrativeNodes: [], simulationModules: [], releases: [],
}

function diagnostics(report: NarrativeSimulationDraftReport | null): string[] {
  if (!report) return []
  return [
    ...report.errors,
    ...report.warnings,
    ...report.simulation.missingReferences.map(item => `缺失引用：${item}`),
    ...report.simulation.dominatedActionKeys.map(item => `行动被严格支配：${item}`),
    ...report.simulation.unboundedGrowthKeys.map(item => `无限增长风险：${item}`),
    ...report.simulation.conservedMutationKeys.map(item => `守恒值被修改：${item}`),
    ...report.simulation.unsolvedCrisisKeys.map(item => `危机没有缓解路径：${item}`),
    ...report.simulation.unreachableEndingKeys.map(item => `结局不可达：${item}`),
    ...report.narrative.danglingSuccessors.map(item => `Narrative 断链：${item.nodeKey} → ${item.successorKey}`),
    ...report.narrative.blockingCycleKeys.map(keys => `Narrative 无出口循环：${keys.join(' → ')}`),
  ]
}

export default function NarrativeSimulationWorkbench({ scope, onOpenProduction }: { scope: WorkspaceScope; onOpenProduction?: () => void }) {
  const dialog = useDialog()
  const [snapshot, setSnapshot] = useState(EMPTY)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [view, setView] = useState<View>('overview')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [editor, setEditor] = useState('')
  const [report, setReport] = useState<NarrativeSimulationDraftReport | null>(null)
  const [batchTurns, setBatchTurns] = useState<10 | 100 | 500>(100)
  const [batchResult, setBatchResult] = useState<ReturnType<typeof runNarrativeSimulationBatch> | null>(null)

  const load = async (preferId?: number | null) => {
    const next = await loadNarrativeSimulationAuthoringSnapshot(scope)
    setSnapshot(next)
    setSelectedId(previous => {
      const desired = preferId === undefined ? previous : preferId
      return desired != null && next.definitions.some(item => item.id === desired)
        ? desired : next.definitions[0]?.id ?? null
    })
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true); setError(''); setMessage(''); setReport(null); setBatchResult(null)
    void load().catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.projectId, scope.worldId, scope.workId])

  const definition = snapshot.definitions.find(item => item.id === selectedId) ?? null
  const module = snapshot.simulationModules.find(item => item.gameDefinitionId === selectedId) ?? null
  const releases = snapshot.releases.filter(item => item.gameDefinitionId === selectedId)
  const parsed = useMemo(() => {
    try { return { content: parseNarrativeSimulationContent(editor), error: '' } }
    catch (reason) { return { content: null, error: reason instanceof Error ? reason.message : String(reason) } }
  }, [editor])
  const liveReport = useMemo(() => parsed.content
    ? validateNarrativeSimulationContent({
        content: parsed.content,
        narrativeNodeKeys: snapshot.narrativeNodes
          .filter(node => node.moduleId === definition?.narrativeModuleId).map(node => node.key),
      })
    : null, [parsed.content, snapshot.narrativeNodes, definition?.narrativeModuleId])

  useEffect(() => {
    if (!definition || !module) { setTitle(''); setDescription(''); setEditor(''); return }
    setTitle(definition.title); setDescription(definition.description); setEditor(module.contentJson)
    setReport(null); setBatchResult(null)
  }, [definition, module])

  const run = async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await operation() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const refresh = async () => { await load(selectedId); setReport(null); setBatchResult(null) }
  const createSample = () => run(async () => {
    const created = await createNarrativeSimulationGame({
      scope,
      gameKey: `closed-district-${Date.now().toString(36)}`,
      title: '十二街区治理录',
      content: createNarrativeSimulationAcceptanceContent(),
    })
    await load(created.id!); setView('overview')
    setMessage('已创建 30 回合验收模拟：六种资源/指标、五个主体、十项行动、三条问题链、两场危机和四个结局。')
  })
  const save = () => run(async () => {
    if (!definition || !parsed.content) throw new Error(parsed.error || '模拟内容无效。')
    await updateNarrativeSimulationDefinition({ scope, gameDefinitionId: definition.id!, title, description })
    await saveNarrativeSimulationContent({ scope, gameDefinitionId: definition.id!, content: parsed.content })
    await refresh(); setMessage('叙事模拟定义与规则内容已保存。')
  })
  const validate = () => run(async () => {
    if (!definition) return
    const next = await validateNarrativeSimulationGame(scope, definition.id!)
    setReport(next); setView('diagnostics')
    setMessage(next.valid ? '模拟规则、引用和 Narrative 内容图均通过发布校验。' : '')
  })
  const publish = () => {
    if (onOpenProduction) {
      onOpenProduction()
      return
    }
    setError('正式发布必须进入制作中心，由来源计划、用户确认、Build 校验和原子发布共同完成。')
  }
  const remove = () => run(async () => {
    if (!definition) return
    const confirmed = await dialog.confirm({
      title: `删除草稿“${definition.title}”？`,
      message: '模拟规则模块与专属 Narrative 草稿会清理；不可变发布及已有存档保持可回放。',
      confirmText: '删除草稿',
      tone: 'danger',
    })
    if (!confirmed) return
    await deleteNarrativeSimulationGameDraft({ scope, gameDefinitionId: definition.id! })
    await load(null); setMessage('草稿已删除；历史发布与玩家实例保持冻结。')
  })
  const simulate = () => {
    if (!parsed.content) return
    try {
      const next = runNarrativeSimulationBatch({
        content: parsed.content,
        contentHash: '0'.repeat(64),
        seed: 'author-balance-preview',
        turns: batchTurns,
        decide: (_state, available) => available.slice(0, 1),
      })
      setBatchResult(next); setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const counts = parsed.content ? [
    ['资源 / 指标', parsed.content.resources.length + parsed.content.metrics.length],
    ['主体 / 组织', parsed.content.actors.length],
    ['行动 / 政策', parsed.content.actions.length],
    ['Modifier', parsed.content.modifiers.length],
    ['问题 / 危机', parsed.content.issues.length],
    ['结局 / 题材', parsed.content.endings.length + parsed.content.themes.length],
  ] : []

  return <div className="storygame-author" data-testid="narrative-simulation-workbench">
    <aside className="storygame-author-sidebar">
      <div className="storygame-author-sidebar-head"><strong>叙事模拟草稿</strong><button title="刷新" onClick={() => void refresh()}><RefreshCw className="h-3.5 w-3.5" /></button></div>
      <div className="storygame-author-game-list">{snapshot.definitions.map(item => <button key={item.id} className={item.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(item.id!)}><strong>{item.title}</strong><small>{item.gameKey}</small></button>)}</div>
      {!onOpenProduction && <button className="storygame-author-create sample" disabled={busy} onClick={() => void createSample()}><Plus className="h-3.5 w-3.5" />创建验收模拟</button>}
      <p>规则保存在 NarrativeSimulationModule；回合事实只进入共享 SIM 事件与检查点。</p>
    </aside>
    <main className="storygame-author-main">
      <header className="storygame-author-toolbar"><div><strong>{definition?.title ?? '叙事模拟作者工作台'}</strong><span>TEXTSIM-1 · DETERMINISTIC SYSTEM</span></div><nav>{([
        ['overview', '总览'], ['content', '规则 JSON'], ['balance', '批量模拟'], ['diagnostics', '发布检查'], ['release', '发布版本'],
      ] as Array<[View, string]>).map(([key, label]) => <button key={key} disabled={!definition} className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}</button>)}</nav></header>
      {message && <div className="storygame-author-notice success"><CheckCircle2 className="h-4 w-4" /><span>{message}</span></div>}
      {error && <div className="storygame-author-notice error" role="alert"><AlertTriangle className="h-4 w-4" /><span>{error}</span></div>}
      {loading && <div className="storygame-empty"><Loader2 className="h-7 w-7 animate-spin" /><p>正在加载作者数据…</p></div>}
      {!loading && !definition && <div className="storygame-empty"><Activity className="h-8 w-8" /><h2>{onOpenProduction ? '没有需要维护的旧草稿' : '创建第一份封闭系统模拟'}</h2><p>{onOpenProduction ? '新游戏统一从制作中心开始。' : '验收模板提供 30 回合、多资源、多主体、延迟效果、危机和四个规则结局。'}</p><button className="storygame-author-create" onClick={() => onOpenProduction ? onOpenProduction() : void createSample()}>{onOpenProduction ? <Rocket className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{onOpenProduction ? '进入制作中心' : '创建验收模拟'}</button></div>}
      {!loading && definition && <>
        {view === 'overview' && <section className="storygame-author-pane"><div className="storygame-author-heading"><div><small>GAME DEFINITION</small><h2>叙事模拟定义与规模</h2></div><div className="storygame-author-actions"><button onClick={() => void save()} disabled={busy || !!parsed.error}><Save className="h-3.5 w-3.5" />保存</button><button className="danger" onClick={() => void remove()} disabled={busy}><Trash2 className="h-3.5 w-3.5" />删除</button></div></div><div className="storygame-author-form-grid"><label>标题<input value={title} onChange={event => setTitle(event.target.value)} /></label><label>稳定标识<input value={definition.gameKey} readOnly /></label><label className="wide">简介<textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} /></label></div><div className="storygame-author-summary-grid">{counts.map(([label, value]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}</div><div className="storygame-author-contract"><ShieldCheck className="h-5 w-5" /><div><strong>统一架构边界</strong><p>世界事实来自 WorldRelease；结局走 Narrative；所有资源、问题和长期后果只由确定性 SIM 事件写入；Harness 保持零写目标。</p></div></div></section>}
        {view === 'content' && <section className="storygame-author-pane"><div className="storygame-author-heading"><div><small>NARRATIVE SIMULATION MODULE</small><h2>白名单规则契约</h2></div><button disabled={busy || !!parsed.error} onClick={() => void save()}><Save className="h-3.5 w-3.5" />校验并保存</button></div>{parsed.error && <div className="storygame-author-notice error"><AlertTriangle className="h-4 w-4" /><span>{parsed.error}</span></div>}<label className="storygame-json-editor">NarrativeSimulationContentV1<textarea aria-label="NarrativeSimulationContentV1 JSON" rows={36} spellCheck={false} value={editor} onChange={event => setEditor(event.target.value)} /></label>{liveReport && <div className={`storygame-author-notice ${liveReport.valid ? 'success' : 'error'}`}><FileJson2 className="h-4 w-4" /><span>{liveReport.valid ? '结构、引用、危机缓解路径和结局条件有效。' : liveReport.errors.join('；')}</span></div>}</section>}
        {view === 'balance' && <section className="storygame-author-pane"><div className="storygame-author-heading"><div><small>DETERMINISTIC BATCH</small><h2>长局稳定性与平衡预览</h2></div><FlaskConical className="h-5 w-5 text-accent" /></div><div className="storygame-preview-start"><label>最大回合<select value={batchTurns} onChange={event => setBatchTurns(Number(event.target.value) as 10 | 100 | 500)}><option value={10}>10 回合</option><option value={100}>100 回合</option><option value={500}>500 回合</option></select></label><button disabled={!parsed.content} onClick={simulate}><FlaskConical className="h-3.5 w-3.5" />运行固定种子</button></div>{batchResult && <><div className="storygame-author-summary-grid"><article><strong>{batchResult.state.turn}</strong><span>停止回合</span></article><article><strong>{batchResult.events.length}</strong><span>事件数</span></article><article><strong>{batchResult.state.qualifiedEndingKey ?? '未结束'}</strong><span>规则结局</span></article><article><strong>{batchResult.state.schedules.filter(item => item.status === 'pending').length}</strong><span>待结延迟效果</span></article></div><div className="storygame-author-contract"><CheckCircle2 className="h-5 w-5" /><div><strong>可复现平衡证据</strong><p>同一内容哈希、种子与决策函数会得到同一事件序列；AI 不参与该批量结算。</p></div></div></>}</section>}
        {view === 'diagnostics' && <section className="storygame-author-pane"><div className="storygame-author-heading"><div><small>RULE & RELEASE GATE</small><h2>发布前诊断</h2></div><button disabled={busy} onClick={() => void validate()}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}运行校验</button></div>{!report && <div className="storygame-empty"><FlaskConical className="h-7 w-7" /><p>检查缺失引用、无解危机、不可达结局、严格支配、无限增长与 Narrative 内容图。</p></div>}{report && <><div className={`storygame-author-notice ${report.valid ? 'success' : 'error'}`}>{report.valid ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}<span>{report.valid ? '所有发布闸门通过。' : '存在阻断问题。'}</span></div><div className="storygame-diagnostic-list">{diagnostics(report).map((item, index) => <article key={`${index}:${item}`}><AlertTriangle className="h-3.5 w-3.5" /><span>{item}</span></article>)}{report.valid && !diagnostics(report).length && <article><CheckCircle2 className="h-3.5 w-3.5" /><span>没有错误或警告。</span></article>}</div></>}</section>}
        {view === 'release' && <section className="storygame-author-pane"><div className="storygame-author-heading"><div><small>IMMUTABLE GAME RELEASE</small><h2>发布冻结</h2></div><button disabled={busy} onClick={publish}><Rocket className="h-3.5 w-3.5" />交由制作中心发布</button></div><div className="storygame-author-contract"><ShieldCheck className="h-5 w-5" /><div><strong>规则与 Narrative 同时冻结</strong><p>制作中心冻结世界来源、用户目标、模拟规则和产品内容，并由通过校验的 Build 原子生成不可变 ProductRelease。</p></div></div><div className="storygame-release-list-author">{releases.map(item => <article key={item.id}><div><strong>v{item.version} · {item.label}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.contentHash.slice(0, 12)}</small></div><CheckCircle2 className="h-4 w-4" /></article>)}{!releases.length && <p>尚无正式发布。</p>}</div></section>}
      </>}
    </main>
  </div>
}
