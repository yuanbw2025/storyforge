import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Eye,
  FilePlus2,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { addNarrativeNode } from '../../lib/narrative/blueprint'
import type {
  NarrativeBeat,
  NarrativeBeatKind,
  NarrativeChoice,
  NarrativeContentGraphReport,
  NarrativeNode,
  NarrativeNodeKind,
  WorkspaceScope,
} from '../../lib/types'
import { NARRATIVE_BEAT_KINDS, NARRATIVE_NODE_KINDS } from '../../lib/types'
import {
  advanceStoryGameDraftPreview,
  buildStoryGameDraftPreview,
  createStarterStoryGame,
  deleteStoryGameDraft,
  deleteNarrativeBeat,
  deleteNarrativeChoice,
  deleteNarrativeNode,
  loadStoryGameAuthoringSnapshot,
  publishStoryGameDraft,
  seedStoryGameAcceptanceSample,
  updateGameDefinition,
  updateNarrativeBeat,
  updateNarrativeChoice,
  updateNarrativeModule,
  updateNarrativeNode,
  type StoryGameAuthoringSnapshot,
  type StoryGameDraftPreview,
} from '../../lib/text-game/authoring'
import {
  addNarrativeBeat,
  addNarrativeChoice,
  validateStoryGameContent,
} from '../../lib/text-game/content'
import { useDialog } from '../shared/Dialog'

type WorkbenchView = 'game' | 'content' | 'graph' | 'preview' | 'release' | 'help'

const EMPTY_SNAPSHOT: StoryGameAuthoringSnapshot = {
  definitions: [], modules: [], nodes: [], beats: [], choices: [], releases: [], characters: [],
}

const NODE_LABELS: Record<NarrativeNodeKind, string> = {
  entry: '入口', scene: '场景', choice: '抉择', ending: '结局',
}
const BEAT_LABELS: Record<NarrativeBeatKind, string> = {
  narration: '旁白', dialogue: '对话', action: '动作', system: '提示',
}

function reportMessages(report: NarrativeContentGraphReport | null): string[] {
  if (!report) return []
  return [
    ...report.errors,
    ...report.danglingSuccessors.map(item => `旧后继断链：${item.nodeKey} → ${item.successorKey}`),
    ...report.invalidChoiceTargets.map(item => `Choice 目标无效：${item.choiceKey} → ${item.targetNodeKey}`),
    ...report.unreachableNodeKeys.map(key => `不可达节点：${key}`),
    ...report.orphanBeatKeys.map(key => `游离 Beat：${key}`),
    ...report.orphanChoiceKeys.map(key => `游离 Choice：${key}`),
    ...report.blockingCycleKeys.map(keys => `无退出循环：${keys.join(' → ')}`),
  ]
}

function BeatEditor(props: {
  scope: WorkspaceScope
  beat: NarrativeBeat
  characters: StoryGameAuthoringSnapshot['characters']
  onChanged: () => Promise<void>
}) {
  const [kind, setKind] = useState(props.beat.kind)
  const [text, setText] = useState(props.beat.text)
  const [speaker, setSpeaker] = useState(props.beat.speakerCharacterId?.toString() ?? '')
  const [order, setOrder] = useState(props.beat.order)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await updateNarrativeBeat({
        scope: props.scope,
        beatId: props.beat.id!,
        kind,
        speakerCharacterId: kind === 'dialogue' && speaker ? Number(speaker) : null,
        text,
        order,
      })
      await props.onChanged()
    } finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true)
    try { await deleteNarrativeBeat({ scope: props.scope, beatId: props.beat.id! }); await props.onChanged() } finally { setBusy(false) }
  }
  return <article className="storygame-author-card storygame-beat-editor">
    <div className="storygame-author-card-head"><code>{props.beat.beatKey}</code><label>顺序<input type="number" value={order} onChange={event => setOrder(Number(event.target.value))} /></label></div>
    <div className="storygame-author-inline">
      <label>类型<select value={kind} onChange={event => setKind(event.target.value as NarrativeBeatKind)}>{NARRATIVE_BEAT_KINDS.map(value => <option key={value} value={value}>{BEAT_LABELS[value]}</option>)}</select></label>
      {kind === 'dialogue' && <label>说话人<select value={speaker} onChange={event => setSpeaker(event.target.value)}><option value="">请选择角色</option>{props.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>}
    </div>
    <label>文本<textarea rows={3} value={text} onChange={event => setText(event.target.value)} /></label>
    <div className="storygame-author-actions"><button type="button" onClick={() => void save()} disabled={busy || !text.trim()}><Save className="h-3.5 w-3.5" />保存</button><button type="button" className="danger" onClick={() => void remove()} disabled={busy}><Trash2 className="h-3.5 w-3.5" />删除</button></div>
  </article>
}

function ChoiceEditor(props: {
  scope: WorkspaceScope
  choice: NarrativeChoice
  nodes: NarrativeNode[]
  onChanged: () => Promise<void>
}) {
  const [text, setText] = useState(props.choice.text)
  const [description, setDescription] = useState(props.choice.description)
  const [target, setTarget] = useState(props.choice.targetNodeKey)
  const [display, setDisplay] = useState(props.choice.displayConditionJson)
  const [available, setAvailable] = useState(props.choice.availableConditionJson)
  const [reason, setReason] = useState(props.choice.unavailableReason)
  const [effects, setEffects] = useState(props.choice.effectsJson)
  const [tags, setTags] = useState(props.choice.tagsJson)
  const [order, setOrder] = useState(props.choice.order)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await updateNarrativeChoice({
        scope: props.scope,
        choiceId: props.choice.id!,
        text,
        description,
        unavailableReason: reason,
        targetNodeKey: target,
        displayConditionJson: display,
        availableConditionJson: available,
        effectsJson: effects,
        tagsJson: tags,
        order,
      })
      await props.onChanged()
    } finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true)
    try { await deleteNarrativeChoice({ scope: props.scope, choiceId: props.choice.id! }); await props.onChanged() } finally { setBusy(false) }
  }
  return <article className="storygame-author-card storygame-choice-editor">
    <div className="storygame-author-card-head"><code>{props.choice.choiceKey}</code><label>顺序<input type="number" value={order} onChange={event => setOrder(Number(event.target.value))} /></label></div>
    <label>选项文本<input value={text} onChange={event => setText(event.target.value)} /></label>
    <label>补充说明<input value={description} onChange={event => setDescription(event.target.value)} /></label>
    <div className="storygame-author-inline"><label>目标节点<select value={target} onChange={event => setTarget(event.target.value)}>{props.nodes.map(node => <option key={node.key} value={node.key}>{node.title} · {node.key}</option>)}</select></label><label>不可用原因<input value={reason} onChange={event => setReason(event.target.value)} placeholder="条件不满足时展示" /></label></div>
    <details><summary>条件、效果与标签</summary><div className="storygame-author-json-grid"><label>显示条件<textarea rows={3} value={display} onChange={event => setDisplay(event.target.value)} /></label><label>可用条件<textarea rows={3} value={available} onChange={event => setAvailable(event.target.value)} /></label><label>确定性效果<textarea rows={3} value={effects} onChange={event => setEffects(event.target.value)} /></label><label>标签数组<textarea rows={3} value={tags} onChange={event => setTags(event.target.value)} /></label></div></details>
    <div className="storygame-author-actions"><button type="button" onClick={() => void save()} disabled={busy || !text.trim() || !target}><Save className="h-3.5 w-3.5" />保存</button><button type="button" className="danger" onClick={() => void remove()} disabled={busy}><Trash2 className="h-3.5 w-3.5" />删除</button></div>
  </article>
}

export default function StoryGameWorkbench(props: { scope: WorkspaceScope }) {
  const dialog = useDialog()
  const [snapshot, setSnapshot] = useState<StoryGameAuthoringSnapshot>(EMPTY_SNAPSHOT)
  const [selectedDefinitionId, setSelectedDefinitionId] = useState<number | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null)
  const [view, setView] = useState<WorkbenchView>('game')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [report, setReport] = useState<NarrativeContentGraphReport | null>(null)
  const [preview, setPreview] = useState<StoryGameDraftPreview | null>(null)
  const [previewStart, setPreviewStart] = useState('')
  const [gameTitle, setGameTitle] = useState('')
  const [gameDescription, setGameDescription] = useState('')
  const [initialVariables, setInitialVariables] = useState('{}')
  const [moduleTitle, setModuleTitle] = useState('')
  const [moduleDescription, setModuleDescription] = useState('')
  const [entryNodeKey, setEntryNodeKey] = useState('')
  const [nodeTitle, setNodeTitle] = useState('')
  const [nodeSummary, setNodeSummary] = useState('')
  const [nodeKind, setNodeKind] = useState<NarrativeNodeKind>('scene')
  const [nodeCondition, setNodeCondition] = useState('{}')
  const [nodeEffects, setNodeEffects] = useState('[]')
  const [newNodeKey, setNewNodeKey] = useState('')
  const [newNodeTitle, setNewNodeTitle] = useState('')
  const [newNodeKind, setNewNodeKind] = useState<NarrativeNodeKind>('scene')
  const [newBeatText, setNewBeatText] = useState('')
  const [newBeatKind, setNewBeatKind] = useState<NarrativeBeatKind>('narration')
  const [newBeatSpeaker, setNewBeatSpeaker] = useState('')
  const [newChoiceText, setNewChoiceText] = useState('')
  const [newChoiceTarget, setNewChoiceTarget] = useState('')

  const load = async () => {
    const loaded = await loadStoryGameAuthoringSnapshot(props.scope)
    setSnapshot(loaded)
    setSelectedDefinitionId(previous => loaded.definitions.some(item => item.id === previous) ? previous : loaded.definitions[0]?.id ?? null)
    setLoading(false)
  }
  useEffect(() => {
    setLoading(true); setError(''); setMessage(''); setPreview(null); setReport(null)
    void load().catch(cause => { setError(cause instanceof Error ? cause.message : '作者工作台加载失败'); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scope.projectId, props.scope.worldId, props.scope.workId])

  const definition = snapshot.definitions.find(item => item.id === selectedDefinitionId) ?? null
  const module = snapshot.modules.find(item => item.id === definition?.narrativeModuleId) ?? null
  const nodes = useMemo(() => snapshot.nodes.filter(item => item.moduleId === module?.id).sort((a, b) => a.order - b.order), [module?.id, snapshot.nodes])
  const selectedNode = nodes.find(item => item.id === selectedNodeId) ?? nodes[0] ?? null
  const beats = useMemo(() => snapshot.beats.filter(item => item.moduleId === module?.id && item.nodeKey === selectedNode?.key).sort((a, b) => a.order - b.order), [module?.id, selectedNode?.key, snapshot.beats])
  const choices = useMemo(() => snapshot.choices.filter(item => item.moduleId === module?.id && item.sourceNodeKey === selectedNode?.key).sort((a, b) => a.order - b.order), [module?.id, selectedNode?.key, snapshot.choices])
  const releases = useMemo(() => snapshot.releases.filter(item => item.gameDefinitionId === definition?.id), [definition?.id, snapshot.releases])

  useEffect(() => {
    if (!definition || !module) return
    setGameTitle(definition.title); setGameDescription(definition.description); setInitialVariables(definition.initialVariablesJson)
    setModuleTitle(module.title); setModuleDescription(module.description); setEntryNodeKey(module.entryNodeKey ?? '')
    setPreview(null); setReport(null)
  }, [definition, module])
  useEffect(() => {
    if (!selectedNode) return
    setSelectedNodeId(selectedNode.id!); setNodeTitle(selectedNode.title); setNodeSummary(selectedNode.summary)
    setNodeKind(selectedNode.kind); setNodeCondition(selectedNode.conditionJson); setNodeEffects(selectedNode.effectsJson)
    setNewChoiceTarget(nodes.find(node => node.id !== selectedNode.id)?.key ?? '')
  }, [selectedNode, nodes])

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败') } finally { setBusy(false) }
  }
  const refresh = async () => { await load(); setPreview(null); setReport(null) }
  const createBlank = () => run(async () => {
    const created = await createStarterStoryGame({ scope: props.scope })
    await load(); setSelectedDefinitionId(created.id!); setMessage('已创建最小可发布故事，可从内容编辑继续扩展。')
  })
  const createSample = () => run(async () => {
    const created = await seedStoryGameAcceptanceSample({ scope: props.scope })
    await load(); setSelectedDefinitionId(created.id!); setMessage('已载入三章验收样例：25 节点、45 Beat、30 Choice、3 个结局。')
  })
  const saveGame = () => run(async () => {
    if (!definition || !module) return
    await updateGameDefinition({ scope: props.scope, gameDefinitionId: definition.id!, title: gameTitle, description: gameDescription, initialVariablesJson: initialVariables })
    await updateNarrativeModule({ scope: props.scope, moduleId: module.id!, title: moduleTitle, description: moduleDescription, entryNodeKey })
    await refresh(); setMessage('游戏与模块设置已保存。')
  })
  const removeGame = () => run(async () => {
    if (!definition) return
    const confirmed = await dialog.confirm({
      title: `删除草稿“${definition.title}”？`,
      message: '专属 NarrativeModule、节点、Beat 和 Choice 会一起删除；共享模块、已发布版本和玩家存档保持不变。',
      confirmText: '删除草稿',
      tone: 'danger',
    })
    if (!confirmed) return
    await deleteStoryGameDraft({ scope: props.scope, gameDefinitionId: definition.id! }); await refresh(); setMessage('草稿及其专属内容已删除，旧发布仍可游玩。')
  })
  const addNode = () => run(async () => {
    if (!module) return
    const created = await addNarrativeNode({ scope: props.scope, moduleId: module.id!, key: newNodeKey, kind: newNodeKind, title: newNodeTitle, order: nodes.length })
    setNewNodeKey(''); setNewNodeTitle(''); await load(); setSelectedNodeId(created.id!); setMessage('节点已创建。')
  })
  const saveNode = () => run(async () => {
    if (!selectedNode) return
    await updateNarrativeNode({ scope: props.scope, nodeId: selectedNode.id!, kind: nodeKind, title: nodeTitle, summary: nodeSummary, conditionJson: nodeCondition, effectsJson: nodeEffects })
    await refresh(); setMessage('节点已保存。')
  })
  const removeNode = () => run(async () => {
    if (!selectedNode) return
    const confirmed = await dialog.confirm({ title: `删除节点“${selectedNode.title}”？`, message: '节点内 Beat 及指向/来自该节点的 Choice 会一起删除。', confirmText: '删除节点', tone: 'danger' })
    if (!confirmed) return
    await deleteNarrativeNode({ scope: props.scope, nodeId: selectedNode.id! }); setSelectedNodeId(null); await refresh(); setMessage('节点和关联内容已删除。')
  })
  const addBeat = () => run(async () => {
    if (!module || !selectedNode) return
    await addNarrativeBeat({
      scope: props.scope,
      moduleId: module.id!,
      nodeKey: selectedNode.key,
      beatKey: `${selectedNode.key}.beat-${Date.now().toString(36)}`,
      kind: newBeatKind,
      speakerCharacterId: newBeatKind === 'dialogue' && newBeatSpeaker ? Number(newBeatSpeaker) : null,
      text: newBeatText,
      order: beats.length,
    })
    setNewBeatText(''); await refresh(); setMessage('内容段已添加。')
  })
  const addChoice = () => run(async () => {
    if (!module || !selectedNode) return
    await addNarrativeChoice({
      scope: props.scope,
      moduleId: module.id!,
      sourceNodeKey: selectedNode.key,
      choiceKey: `${selectedNode.key}.choice-${Date.now().toString(36)}`,
      text: newChoiceText,
      targetNodeKey: newChoiceTarget,
      order: choices.length,
    })
    setNewChoiceText(''); await refresh(); setMessage('选择已添加。')
  })
  const checkGraph = () => run(async () => {
    if (!module) return
    const next = await validateStoryGameContent(props.scope, module.id!); setReport(next)
    setMessage(next.valid ? '内容图检查通过，可以发布。' : `发现 ${reportMessages(next).length} 项需处理的问题。`)
  })
  const startPreview = (nodeKey?: string) => run(async () => {
    if (!definition) return
    const next = await buildStoryGameDraftPreview({ scope: props.scope, gameDefinitionId: definition.id!, startNodeKey: nodeKey || previewStart || undefined })
    setPreview(next); setPreviewStart(next.state.currentNodeKey ?? '')
  })
  const choosePreview = (choiceKey: string) => {
    try { if (preview) setPreview(advanceStoryGameDraftPreview(preview, choiceKey)) } catch (cause) { setError(cause instanceof Error ? cause.message : '试玩推进失败') }
  }
  const publish = () => run(async () => {
    if (!definition) return
    const confirmed = await dialog.confirm({ title: `发布“${definition.title}”？`, message: '将依次冻结新的 WorldRevision、WorldRelease 与不可变 GameRelease；旧版本和存档不会被覆盖。', confirmText: '检查并发布' })
    if (!confirmed) return
    const published = await publishStoryGameDraft({ scope: props.scope, gameDefinitionId: definition.id!, label: `${definition.title} v${releases.length + 1}` })
    setReport(published.report); await load(); setMessage(`已发布 GameRelease v${published.gameRelease.version}。`)
  })

  const previewNode = preview?.state.nodes.find(node => node.key === preview.state.currentNodeKey) ?? null
  const previewBeats = (preview?.state.beats ?? []).filter(beat => beat.nodeKey === previewNode?.key).sort((a, b) => a.order - b.order)
  const previewChoices = (preview?.state.visibleChoiceKeys ?? []).map(key => preview?.state.choices?.find(choice => choice.choiceKey === key)).filter((choice): choice is NonNullable<typeof choice> => choice != null)
  const issues = reportMessages(report)

  if (loading) return <div className="storygame-author-empty"><Loader2 className="h-6 w-6 animate-spin" />正在加载作者工作台…</div>
  return <section className="storygame-author" aria-label="文字游戏作者工作台" data-testid="storygame-workbench">
    <aside className="storygame-author-sidebar">
      <div className="storygame-author-sidebar-head"><strong>游戏草稿</strong><button type="button" aria-label="刷新作者工作台" onClick={() => void run(refresh)}><RefreshCw className="h-3.5 w-3.5" /></button></div>
      <div className="storygame-author-game-list">{snapshot.definitions.map(item => <button type="button" className={item.id === definition?.id ? 'active' : ''} key={item.id} onClick={() => setSelectedDefinitionId(item.id!)}><strong>{item.title}</strong><small>{item.gameKey} · {item.status === 'draft' ? '草稿' : '已归档'}</small></button>)}</div>
      <button type="button" className="storygame-author-create" onClick={createBlank} disabled={busy}><FilePlus2 className="h-4 w-4" />新建空白游戏</button>
      <button type="button" className="storygame-author-create sample" onClick={createSample} disabled={busy}><Sparkles className="h-4 w-4" />载入验收样例</button>
      <p>样例包含 3 章、25 节点、45 Beat、30 Choice、2+ 次汇流、条件选项与 3 个结局。</p>
    </aside>
    <div className="storygame-author-main">
      <header className="storygame-author-toolbar">
        <div><strong>{definition?.title ?? '文字游戏作者工作台'}</strong><span>{module ? `${module.title} · ${nodes.length} 节点 · ${snapshot.beats.filter(item => item.moduleId === module.id).length} Beat · ${snapshot.choices.filter(item => item.moduleId === module.id).length} Choice` : '先创建一个游戏草稿'}</span></div>
        <nav aria-label="作者工作台视图">
          {([
            ['game', '游戏'], ['content', '内容'], ['graph', '路径'], ['preview', '试玩'], ['release', '发布'], ['help', '说明'],
          ] as Array<[WorkbenchView, string]>).map(([id, label]) => <button key={id} type="button" className={view === id ? 'active' : ''} onClick={() => setView(id)} disabled={!definition && id !== 'help'}>{label}</button>)}
        </nav>
      </header>
      {(error || message) && <div className={`storygame-author-notice ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{error ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}<span>{error || message}</span><button type="button" aria-label="关闭提示" onClick={() => { setError(''); setMessage('') }}>×</button></div>}
      {!definition && view !== 'help' ? <div className="storygame-author-empty"><BookOpenCheck className="h-8 w-8" /><h2>创建第一个分支故事</h2><p>可从两节点空白游戏开始，也可载入完整验收样例学习条件、效果与汇流。</p></div> : view === 'game' && definition && module ? <div className="storygame-author-pane">
        <div className="storygame-author-heading"><div><small>GAME DEFINITION</small><h2>游戏与入口模块</h2></div><div className="storygame-author-actions"><button type="button" onClick={saveGame} disabled={busy}><Save className="h-4 w-4" />保存设置</button><button type="button" className="danger" onClick={removeGame} disabled={busy}><Trash2 className="h-4 w-4" />删除草稿</button></div></div>
        <div className="storygame-author-form-grid"><label>游戏标题<input value={gameTitle} onChange={event => setGameTitle(event.target.value)} /></label><label>稳定 gameKey<input value={definition.gameKey} readOnly /></label><label className="wide">游戏简介<textarea rows={3} value={gameDescription} onChange={event => setGameDescription(event.target.value)} /></label><label>模块标题<input value={moduleTitle} onChange={event => setModuleTitle(event.target.value)} /></label><label>入口节点<select value={entryNodeKey} onChange={event => setEntryNodeKey(event.target.value)}>{nodes.map(node => <option key={node.key} value={node.key}>{node.title} · {node.key}</option>)}</select></label><label className="wide">模块说明<textarea rows={3} value={moduleDescription} onChange={event => setModuleDescription(event.target.value)} /></label><label className="wide">初始变量 JSON<textarea rows={5} value={initialVariables} onChange={event => setInitialVariables(event.target.value)} spellCheck={false} /></label></div>
        <div className="storygame-author-contract"><ShieldCheck className="h-5 w-5" /><div><strong>稳定身份与发布边界</strong><p>gameKey、节点 key、Beat key 与 Choice key 创建后保持稳定；玩家只读取不可变 GameRelease，草稿修改不会反写旧存档。</p></div></div>
      </div> : view === 'content' && module ? <div className="storygame-content-layout">
        <aside className="storygame-node-list-author"><div className="storygame-author-card-head"><strong>节点</strong><span>{nodes.length}</span></div>{nodes.map(node => <button type="button" key={node.id} className={node.id === selectedNode?.id ? 'active' : ''} onClick={() => setSelectedNodeId(node.id!)}><span>{NODE_LABELS[node.kind]}</span><strong>{node.title}</strong><code>{node.key}</code></button>)}<div className="storygame-new-node"><input aria-label="新节点 key" value={newNodeKey} onChange={event => setNewNodeKey(event.target.value)} placeholder="稳定 key" /><input aria-label="新节点标题" value={newNodeTitle} onChange={event => setNewNodeTitle(event.target.value)} placeholder="节点标题" /><select aria-label="新节点类型" value={newNodeKind} onChange={event => setNewNodeKind(event.target.value as NarrativeNodeKind)}>{NARRATIVE_NODE_KINDS.map(value => <option key={value} value={value}>{NODE_LABELS[value]}</option>)}</select><button type="button" onClick={addNode} disabled={busy || !newNodeKey.trim() || !newNodeTitle.trim()}><Plus className="h-3.5 w-3.5" />添加节点</button></div></aside>
        {selectedNode ? <div className="storygame-node-editor">
          <div className="storygame-author-heading"><div><small>{NODE_LABELS[selectedNode.kind]} · {selectedNode.key}</small><h2>{selectedNode.title}</h2></div><div className="storygame-author-actions"><button type="button" onClick={saveNode} disabled={busy}><Save className="h-4 w-4" />保存节点</button><button type="button" className="danger" onClick={removeNode} disabled={busy}><Trash2 className="h-4 w-4" />删除</button></div></div>
          <div className="storygame-author-form-grid"><label>节点标题<input value={nodeTitle} onChange={event => setNodeTitle(event.target.value)} /></label><label>类型<select value={nodeKind} onChange={event => setNodeKind(event.target.value as NarrativeNodeKind)}>{NARRATIVE_NODE_KINDS.map(value => <option key={value} value={value}>{NODE_LABELS[value]}</option>)}</select></label><label className="wide">摘要<textarea rows={2} value={nodeSummary} onChange={event => setNodeSummary(event.target.value)} /></label><label>进入条件 JSON<textarea rows={4} value={nodeCondition} onChange={event => setNodeCondition(event.target.value)} spellCheck={false} /></label><label>进入效果 JSON<textarea rows={4} value={nodeEffects} onChange={event => setNodeEffects(event.target.value)} spellCheck={false} /></label></div>
          <section className="storygame-author-section"><div className="storygame-author-section-head"><div><h3>内容段 Beat</h3><small>按顺序展示旁白、人物对话、动作和系统提示</small></div><span>{beats.length}</span></div>{beats.map(beat => <BeatEditor key={beat.id} scope={props.scope} beat={beat} characters={snapshot.characters} onChanged={refresh} />)}<div className="storygame-author-add-row"><select aria-label="新 Beat 类型" value={newBeatKind} onChange={event => setNewBeatKind(event.target.value as NarrativeBeatKind)}>{NARRATIVE_BEAT_KINDS.map(value => <option key={value} value={value}>{BEAT_LABELS[value]}</option>)}</select>{newBeatKind === 'dialogue' && <select aria-label="新 Beat 说话人" value={newBeatSpeaker} onChange={event => setNewBeatSpeaker(event.target.value)}><option value="">选择角色</option>{snapshot.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select>}<textarea aria-label="新 Beat 文本" rows={2} value={newBeatText} onChange={event => setNewBeatText(event.target.value)} placeholder="添加一段内容" /><button type="button" onClick={addBeat} disabled={busy || !newBeatText.trim() || (newBeatKind === 'dialogue' && !newBeatSpeaker)}><Plus className="h-3.5 w-3.5" />添加 Beat</button></div></section>
          <section className="storygame-author-section"><div className="storygame-author-section-head"><div><h3>剧情选择 Choice</h3><small>Choice 是唯一正式执行边；节点 legacy successor 不参与新发布执行</small></div><span>{choices.length}</span></div>{choices.map(choice => <ChoiceEditor key={choice.id} scope={props.scope} choice={choice} nodes={nodes} onChanged={refresh} />)}{selectedNode.kind !== 'ending' && <div className="storygame-author-add-row choice"><input aria-label="新 Choice 文本" value={newChoiceText} onChange={event => setNewChoiceText(event.target.value)} placeholder="选择文本" /><select aria-label="新 Choice 目标" value={newChoiceTarget} onChange={event => setNewChoiceTarget(event.target.value)}>{nodes.filter(node => node.id !== selectedNode.id).map(node => <option key={node.key} value={node.key}>{node.title} · {node.key}</option>)}</select><button type="button" onClick={addChoice} disabled={busy || !newChoiceText.trim() || !newChoiceTarget}><Plus className="h-3.5 w-3.5" />添加 Choice</button></div>}</section>
        </div> : null}
      </div> : view === 'graph' && module ? <div className="storygame-author-pane">
        <div className="storygame-author-heading"><div><small>CONTENT GRAPH</small><h2>路径与发布诊断</h2></div><button type="button" onClick={checkGraph} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}运行完整检查</button></div>
        {report && <div className={`storygame-graph-summary ${report.valid ? 'valid' : 'invalid'}`}>{report.valid ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}<div><strong>{report.valid ? '内容图可以发布' : `发现 ${issues.length} 项阻塞`}</strong><span>{report.reachableNodeKeys.length}/{nodes.length} 节点可达 · {report.reachableEndingKeys.length}/{report.endingNodeKeys.length} 结局可达 · {report.cycleRisks.length} 个循环提示</span></div></div>}
        {issues.length > 0 && <ul className="storygame-graph-issues">{issues.map((issue, index) => <li key={`${issue}-${index}`}><AlertTriangle className="h-3.5 w-3.5" />{issue}</li>)}</ul>}
        <div className="storygame-graph">{nodes.map(node => { const outgoing = snapshot.choices.filter(choice => choice.moduleId === module.id && choice.sourceNodeKey === node.key); return <article key={node.key} className={`storygame-graph-node ${report?.unreachableNodeKeys.includes(node.key) ? 'unreachable' : ''}`}><div><span>{NODE_LABELS[node.kind]}</span><code>{node.key}</code></div><strong>{node.title}</strong><ul>{outgoing.map(choice => <li key={choice.id}><span>{choice.text}</span><ChevronRight className="h-3 w-3" /><code>{choice.targetNodeKey}</code></li>)}</ul>{node.kind !== 'ending' && outgoing.length === 0 && <small>没有出口</small>}</article> })}</div>
      </div> : view === 'preview' && definition ? <div className="storygame-author-pane">
        <div className="storygame-author-heading"><div><small>DRAFT PREVIEW</small><h2>从任意节点试玩</h2></div><div className="storygame-preview-start"><select aria-label="试玩起点" value={previewStart} onChange={event => setPreviewStart(event.target.value)}><option value="">模块入口</option>{nodes.map(node => <option key={node.key} value={node.key}>{node.title} · {node.key}</option>)}</select><button type="button" onClick={() => void startPreview()} disabled={busy}><Eye className="h-4 w-4" />开始 / 重置</button></div></div>
        <div className="storygame-preview-note"><ShieldCheck className="h-4 w-4" />试玩直接复用正式事件回放的条件、效果和进入节点语义，但不创建 SIM 存档、不写事件，也不伪装成发布版本。</div>
        {preview && previewNode ? <section className="storygame-draft-player"><div className="storygame-draft-meta"><span>{preview.state.moduleTitle}</span><span>{preview.state.visitedNodeKeys.length} 个节点 · {(preview.state.choiceHistory ?? []).length} 次选择</span></div><small>{NODE_LABELS[previewNode.kind]} · {previewNode.key}</small><h2>{previewNode.title}</h2>{previewNode.summary && <p className="summary">{previewNode.summary}</p>}<div className="storygame-draft-beats">{previewBeats.map(beat => <article key={beat.beatKey}><strong>{beat.kind === 'dialogue' ? preview.speakerNames[beat.speakerKey ?? ''] ?? '未知角色' : BEAT_LABELS[beat.kind]}</strong><p>{beat.text}</p></article>)}</div>{preview.state.completed ? <div className="storygame-draft-ending"><CheckCircle2 className="h-6 w-6" /><strong>已抵达结局</strong><button type="button" onClick={() => void startPreview()}>重新试玩</button></div> : <div className="storygame-draft-choices">{previewChoices.map(choice => { const available = preview.state.availableChoiceKeys?.includes(choice.choiceKey) ?? false; return <div key={choice.choiceKey}><button type="button" onClick={() => choosePreview(choice.choiceKey)} disabled={!available}><strong>{choice.text}</strong><span>{choice.description}</span></button>{!available && <small>{choice.unavailableReason || '当前条件未满足。'}</small>}</div> })}</div>}</section> : <div className="storygame-author-empty compact"><Eye className="h-7 w-7" /><h2>选择起点开始草稿试玩</h2><p>可以从模块入口完整走一遍，也可以从中段节点快速检查内容。</p></div>}
      </div> : view === 'release' && definition && module ? <div className="storygame-author-pane">
        <div className="storygame-author-heading"><div><small>IMMUTABLE RELEASE</small><h2>检查、冻结与版本</h2></div><div className="storygame-author-actions"><button type="button" onClick={checkGraph} disabled={busy}><ShieldCheck className="h-4 w-4" />发布检查</button><button type="button" onClick={publish} disabled={busy || report?.valid !== true}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}发布新版本</button></div></div>
        <div className="storygame-release-pipeline"><article><span>1</span><div><strong>内容图检查</strong><p>入口、断链、目标、可达性、结局、死路、循环与 JSON 语法。</p></div></article><article><span>2</span><div><strong>WorldRevision / WorldRelease</strong><p>调用现有世界发布系统冻结注册表派生的便携快照。</p></div></article><article><span>3</span><div><strong>GameRelease</strong><p>绑定世界哈希并冻结 GameDefinition、节点、Beat 与 Choice。</p></div></article></div>
        <div className="storygame-version-list"><div className="storygame-author-section-head"><div><h3>不可变版本</h3><small>旧版本始终保留，现有玩家存档继续绑定原内容哈希</small></div><span>{releases.length}</span></div>{releases.map(release => <article key={release.id}><div><strong>v{release.version} · {release.label}</strong><span>{new Date(release.createdAt).toLocaleString('zh-CN')}</span></div><code>{release.contentHash.slice(0, 16)}…</code><span>WorldRelease #{release.worldReleaseId}</span></article>)}{releases.length === 0 && <div className="storygame-author-empty compact"><Rocket className="h-7 w-7" /><h2>尚未正式发布</h2><p>先运行检查，再发布第一个不可变版本。</p></div>}</div>
      </div> : view === 'help' ? <div className="storygame-author-pane storygame-author-help">
        <div className="storygame-author-heading"><div><small>AUTHOR GUIDE</small><h2>制作一个可发布的分支故事</h2></div><CircleHelp className="h-6 w-6" /></div>
        <div className="storygame-help-grid"><article><span>1</span><div><strong>先定义入口与结局</strong><p>每个游戏绑定一个 NarrativeModule。先保留唯一入口和至少一个可达 ending，再扩展中间场景。</p></div></article><article><span>2</span><div><strong>用 Beat 写节点内容</strong><p>旁白、动作和系统提示无需角色；对话必须选择当前 World 的角色。order 决定展示顺序。</p></div></article><article><span>3</span><div><strong>用 Choice 连接路径</strong><p>Choice 是新发布唯一执行边，可设置显示条件、可用条件、不可用原因与 set / increment / unset 效果。</p></div></article><article><span>4</span><div><strong>先试玩再诊断</strong><p>从任意节点快速检查局部语义；正式发布前仍须保证所有内容从入口可达且非结局节点没有死路。</p></div></article><article><span>5</span><div><strong>发布生成新版本</strong><p>每次内容变化都进入新的世界修订和 GameRelease。旧发布、旧存档和分支不会被覆盖。</p></div></article><article><span>6</span><div><strong>AI 仍遵守统一 Harness</strong><p>本阶段不需要 AI。未来作者辅助只能通过 CONTEXT_SOURCES、FIELD_REGISTRY / Adoption 和统一 Harness 接入。</p></div></article></div>
        <div className="storygame-author-contract"><GitBranch className="h-5 w-5" /><div><strong>推荐路径</strong><p>载入验收样例 → 内容页查看 Beat/Choice → 路径页运行检查 → 试玩不同路线 → 发布 → 切换到玩家模式新建存档。</p></div></div>
      </div> : null}
    </div>
  </section>
}
