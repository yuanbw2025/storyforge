import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FilePlus2,
  Loader2,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react'
import type {
  InteractionCharacterProfile,
  InteractionSceneTemplate,
  WorkspaceScope,
} from '../../lib/types'
import {
  addWorldGroundedInteractionCharacter,
  createInteractionAcceptanceSample,
  createGuestInteractionCharacterProfile,
  createStarterInteractionGame,
  deleteInteractionCharacterProfile,
  deleteInteractionGameDraft,
  deleteInteractionSceneTemplate,
  inspectInteractionContext,
  loadInteractionAuthoringSnapshot,
  saveInteractionCharacterProfile,
  saveInteractionSceneTemplate,
  validateInteractionGameDraft,
  type InteractionAuthoringSnapshot,
  type InteractionContextInspection,
  type InteractionDraftReport,
} from '../../lib/character-interaction/authoring'
import { useDialog } from '../shared/Dialog'

const EMPTY: InteractionAuthoringSnapshot = {
  definitions: [], modules: [], nodes: [], profiles: [], scenes: [], releases: [], characters: [],
}

function ProfileEditor(props: {
  scope: WorkspaceScope
  profile: InteractionCharacterProfile
  characters: InteractionAuthoringSnapshot['characters']
  onChanged: () => Promise<void>
}) {
  const isPortable = props.profile.characterId == null
  const portableSource = useMemo(() => {
    if (!isPortable) return { name: '', label: '' }
    try {
      const parsed = JSON.parse(props.profile.sourceSnapshotJson ?? '{}')
      return {
        name: String(parsed.name ?? '未命名便携角色'),
        label: parsed.schema === 'storyforge.interaction-guest-character' ? '互动自建角色' : '冻结来源角色',
      }
    } catch { return { name: '无效便携角色来源', label: '便携角色' } }
  }, [isPortable, props.profile.sourceSnapshotJson])
  const [participantKey, setParticipantKey] = useState(props.profile.participantKey)
  const [characterId, setCharacterId] = useState(props.profile.characterId ?? props.characters[0]?.id ?? 0)
  const [roleLabel, setRoleLabel] = useState(props.profile.roleLabel)
  const [voiceRules, setVoiceRules] = useState(props.profile.voiceRules)
  const [knowledge, setKnowledge] = useState(props.profile.initialKnowledgeJson)
  const [dimensions, setDimensions] = useState(props.profile.relationshipDimensionsJson)
  const [capacity, setCapacity] = useState(props.profile.maxMemoryEntries)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await saveInteractionCharacterProfile({
        scope: props.scope,
        gameDefinitionId: props.profile.gameDefinitionId,
        profileId: props.profile.id,
        characterId: isPortable ? null : characterId,
        sourceSnapshotJson: isPortable ? props.profile.sourceSnapshotJson : undefined,
        participantKey,
        roleLabel,
        voiceRules,
        initialKnowledgeJson: knowledge,
        relationshipDimensionsJson: dimensions,
        maxMemoryEntries: capacity,
      })
      await props.onChanged()
    } finally { setBusy(false) }
  }
  return <article className="storygame-author-card"><div className="storygame-author-card-head"><code>{props.profile.participantKey}</code><label>记忆上限<input type="number" value={capacity} onChange={event => setCapacity(Number(event.target.value))} /></label></div><div className="storygame-author-inline">{isPortable ? <label>角色来源<input value={`${portableSource.label} · ${portableSource.name}`} disabled /></label> : <label>世界角色<select value={characterId} onChange={event => setCharacterId(Number(event.target.value))}>{props.characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}<label>稳定参与者 key<input value={participantKey} onChange={event => setParticipantKey(event.target.value)} /></label></div><label>角色定位<input value={roleLabel} onChange={event => setRoleLabel(event.target.value)} /></label><label>口吻与边界规则<textarea rows={3} value={voiceRules} onChange={event => setVoiceRules(event.target.value)} /></label><div className="storygame-author-json-grid"><label>初始知识（public/private）<textarea rows={7} value={knowledge} onChange={event => setKnowledge(event.target.value)} /></label><label>关系维度<textarea rows={7} value={dimensions} onChange={event => setDimensions(event.target.value)} /></label></div><div className="storygame-author-actions"><button disabled={busy} onClick={() => void save()}><Save className="h-3.5 w-3.5" />保存角色</button><button className="danger" disabled={busy} onClick={() => void (async () => { setBusy(true); try { await deleteInteractionCharacterProfile({ scope: props.scope, profileId: props.profile.id! }); await props.onChanged() } finally { setBusy(false) } })()}><Trash2 className="h-3.5 w-3.5" />删除</button></div></article>
}

function SceneEditor(props: {
  scope: WorkspaceScope
  scene: InteractionSceneTemplate
  nodes: InteractionAuthoringSnapshot['nodes']
  onChanged: () => Promise<void>
}) {
  const [draft, setDraft] = useState({
    sceneKey: props.scene.sceneKey, title: props.scene.title, purpose: props.scene.purpose,
    location: props.scene.location, timeLabel: props.scene.timeLabel,
    participantKeysJson: props.scene.participantKeysJson,
    publicKnowledgeKeysJson: props.scene.publicKnowledgeKeysJson,
    goalsJson: props.scene.goalsJson, endingConditionsJson: props.scene.endingConditionsJson,
    safetyBoundariesJson: props.scene.safetyBoundariesJson,
    relationshipRulesJson: props.scene.relationshipRulesJson ?? '[]',
    openingNodeKey: props.scene.openingNodeKey ?? '', endingNodeKey: props.scene.endingNodeKey ?? '',
    maxTurns: props.scene.maxTurns, directorBudget: props.scene.directorBudget, order: props.scene.order,
  })
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => setDraft(current => ({ ...current, [key]: value }))
  const save = async () => {
    setBusy(true)
    try {
      await saveInteractionSceneTemplate({
        scope: props.scope,
        gameDefinitionId: props.scene.gameDefinitionId,
        sceneId: props.scene.id,
        ...draft,
      })
      await props.onChanged()
    } finally { setBusy(false) }
  }
  return <article className="storygame-author-card"><div className="storygame-author-card-head"><code>{props.scene.sceneKey}</code><label>顺序<input type="number" value={draft.order} onChange={event => set('order', Number(event.target.value))} /></label></div><div className="storygame-author-inline"><label>场景 key<input value={draft.sceneKey} onChange={event => set('sceneKey', event.target.value)} /></label><label>标题<input value={draft.title} onChange={event => set('title', event.target.value)} /></label></div><label>目的<textarea rows={2} value={draft.purpose} onChange={event => set('purpose', event.target.value)} /></label><div className="storygame-author-inline"><label>地点<input value={draft.location} onChange={event => set('location', event.target.value)} /></label><label>时间<input value={draft.timeLabel} onChange={event => set('timeLabel', event.target.value)} /></label></div><div className="storygame-author-json-grid"><label>参与者 key 数组<textarea rows={4} value={draft.participantKeysJson} onChange={event => set('participantKeysJson', event.target.value)} /></label><label>场景公开知识 key 数组<textarea rows={4} value={draft.publicKnowledgeKeysJson} onChange={event => set('publicKnowledgeKeysJson', event.target.value)} /></label><label>目标<textarea rows={4} value={draft.goalsJson} onChange={event => set('goalsJson', event.target.value)} /></label><label>结束条件<textarea rows={4} value={draft.endingConditionsJson} onChange={event => set('endingConditionsJson', event.target.value)} /></label><label>安全边界<textarea rows={4} value={draft.safetyBoundariesJson} onChange={event => set('safetyBoundariesJson', event.target.value)} /></label><label>固定关系行动规则<textarea rows={7} value={draft.relationshipRulesJson} onChange={event => set('relationshipRulesJson', event.target.value)} /></label></div><div className="storygame-author-inline"><label>开场 Narrative Node<select value={draft.openingNodeKey} onChange={event => set('openingNodeKey', event.target.value)}><option value="">不绑定</option>{props.nodes.map(item => <option key={item.key} value={item.key}>{item.title} · {item.key}</option>)}</select></label><label>结束 Narrative Node<select value={draft.endingNodeKey} onChange={event => set('endingNodeKey', event.target.value)}><option value="">不绑定</option>{props.nodes.map(item => <option key={item.key} value={item.key}>{item.title} · {item.key}</option>)}</select></label></div><div className="storygame-author-inline"><label>最大玩家回合<input type="number" value={draft.maxTurns} onChange={event => set('maxTurns', Number(event.target.value))} /></label><label>多角色导演预算<input type="number" value={draft.directorBudget} onChange={event => set('directorBudget', Number(event.target.value))} /></label></div><div className="storygame-author-actions"><button disabled={busy} onClick={() => void save()}><Save className="h-3.5 w-3.5" />保存场景</button><button className="danger" disabled={busy} onClick={() => void (async () => { setBusy(true); try { await deleteInteractionSceneTemplate({ scope: props.scope, sceneId: props.scene.id! }); await props.onChanged() } finally { setBusy(false) } })()}><Trash2 className="h-3.5 w-3.5" />删除</button></div></article>
}

export default function InteractionGameWorkbench({ scope }: { scope: WorkspaceScope }) {
  const dialog = useDialog()
  const [snapshot, setSnapshot] = useState<InteractionAuthoringSnapshot>(EMPTY)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<number[]>([])
  const [newProfileCharacterId, setNewProfileCharacterId] = useState<number | null>(null)
  const [title, setTitle] = useState('未命名角色互动')
  const [sceneLocation, setSceneLocation] = useState('')
  const [sceneTimeLabel, setSceneTimeLabel] = useState('')
  const [scenePurpose, setScenePurpose] = useState('')
  const [chatDirection, setChatDirection] = useState('')
  const [guestName, setGuestName] = useState('')
  const [guestRole, setGuestRole] = useState('')
  const [guestBackground, setGuestBackground] = useState('')
  const [guestRelation, setGuestRelation] = useState('')
  const [view, setView] = useState<'profiles' | 'scenes' | 'context' | 'release'>('profiles')
  const [report, setReport] = useState<InteractionDraftReport | null>(null)
  const [inspection, setInspection] = useState<InteractionContextInspection | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const load = async () => {
    const result = await loadInteractionAuthoringSnapshot(scope)
    setSnapshot(result)
    setSelectedId(current => result.definitions.some(item => item.id === current) ? current : result.definitions[0]?.id ?? null)
    setSelectedCharacterIds(current => current.length ? current : result.characters.slice(0, 3).flatMap(item => item.id == null ? [] : [item.id]))
    setLoading(false)
  }
  useEffect(() => { setLoading(true); setError(''); void load().catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.projectId, scope.worldId, scope.workId])
  const definition = snapshot.definitions.find(item => item.id === selectedId) ?? null
  const profiles = useMemo(() => snapshot.profiles.filter(item => item.gameDefinitionId === definition?.id), [definition?.id, snapshot.profiles])
  const scenes = useMemo(() => snapshot.scenes.filter(item => item.gameDefinitionId === definition?.id), [definition?.id, snapshot.scenes])
  const module = snapshot.modules.find(item => item.id === definition?.narrativeModuleId)
  const nodes = snapshot.nodes.filter(item => item.moduleId === module?.id)
  const releases = snapshot.releases.filter(item => item.gameDefinitionId === definition?.id)
  const availableCharacters = snapshot.characters.filter(item => !profiles.some(profile => profile.characterId === item.id))
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); setMessage(''); try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) } }
  const refresh = async () => { await load(); setReport(null); setInspection(null) }
  const createGame = () => run(async () => {
    const created = await createStarterInteractionGame({
      scope, title, characterIds: selectedCharacterIds,
      sceneLocation, sceneTimeLabel, scenePurpose, chatDirection,
    })
    await load(); setSelectedId(created.id!); setMessage('已从世界人物、作品终局、关系与确认认知生成可发布角色互动。')
  })
  const createSample = () => run(async () => {
    const created = await createInteractionAcceptanceSample({ scope, characterIds: selectedCharacterIds.slice(0, 3) })
    await load(); setSelectedId(created.id!); setMessage('已创建三角色、五场景确定性验收样例。')
  })
  const addProfile = () => run(async () => {
    if (!definition) return
    const character = snapshot.characters.find(item => item.id === (newProfileCharacterId ?? availableCharacters[0]?.id))
    if (!character?.id) throw new Error('没有可添加的世界角色。')
    await addWorldGroundedInteractionCharacter({ scope, gameDefinitionId: definition.id!, characterId: character.id })
    setNewProfileCharacterId(null); await refresh(); setMessage(`已从当前世界资料生成并添加角色 ${character.name}。`)
  })
  const addGuest = () => run(async () => {
    if (!definition) return
    const guest = await createGuestInteractionCharacterProfile({
      scope,
      gameDefinitionId: definition.id!,
      name: guestName,
      roleLabel: guestRole,
      background: guestBackground,
      relationToWorld: guestRelation,
    })
    setGuestName(''); setGuestRole(''); setGuestBackground(''); setGuestRelation('')
    await refresh(); setMessage(`已创建互动专属角色 ${JSON.parse(guest.sourceSnapshotJson ?? '{}').name}；它尚未写入世界 Canon，可在场景页加入所需场景。`)
  })
  const addScene = () => run(async () => {
    if (!definition || !profiles.length) throw new Error('至少添加一个互动角色后才能建立场景。')
    const publicKnowledge = profiles.flatMap(profile => {
      try {
        return (JSON.parse(profile.initialKnowledgeJson) as Array<{ key: string; visibility: string }>)
          .filter(item => item.visibility === 'public').map(item => item.key)
      } catch { return [] }
    })
    const suffix = `${scenes.length + 1}-${Date.now().toString(36)}`
    await saveInteractionSceneTemplate({
      scope, gameDefinitionId: definition.id!, sceneKey: `scene-${suffix}`, title: `新场景 ${scenes.length + 1}`,
      purpose: '定义这个场景要推动的角色互动目标。', location: '待设置地点', timeLabel: '待设置时间',
      participantKeysJson: JSON.stringify(profiles.map(item => item.participantKey)),
      publicKnowledgeKeysJson: JSON.stringify([...new Set(publicKnowledge)]),
      goalsJson: '["完成一个明确的互动目标"]', endingConditionsJson: '["玩家主动结束场景"]',
      safetyBoundariesJson: '["不替玩家决定感受或行动"]', relationshipRulesJson: '[]',
      openingNodeKey: nodes.find(item => item.kind === 'entry')?.key ?? null,
      endingNodeKey: nodes.find(item => item.kind === 'ending')?.key ?? null,
      maxTurns: 20, directorBudget: Math.min(3, profiles.length), order: scenes.length,
    })
    await refresh(); setMessage('已添加场景模板。')
  })
  if (loading) return <div className="storygame-author-empty"><Loader2 className="h-7 w-7 animate-spin" /><h2>加载互动作者工作台…</h2></div>
  return <div className="storygame-author">
    <aside className="storygame-author-sidebar">
      <div className="storygame-author-sidebar-head"><strong>互动游戏</strong><FilePlus2 className="h-4 w-4 text-accent" /></div>
      <div className="storygame-author-game-list">{snapshot.definitions.map(item => <button key={item.id} className={item.id === definition?.id ? 'active' : ''} onClick={() => { setSelectedId(item.id!); setReport(null); setInspection(null) }}><strong>{item.title}</strong><small>{item.gameKey}</small></button>)}</div>
      <div className="mt-4 space-y-2 border-t border-border pt-4">
        <input value={title} onChange={event => setTitle(event.target.value)} placeholder="新游戏标题" />
        <input value={sceneLocation} onChange={event => setSceneLocation(event.target.value)} placeholder="聊天起点地点（可选）" />
        <input value={sceneTimeLabel} onChange={event => setSceneTimeLabel(event.target.value)} placeholder="聊天起点时间（可选）" />
        <textarea rows={2} value={scenePurpose} onChange={event => setScenePurpose(event.target.value)} placeholder="聊天背景/为什么会在这里（可选）" />
        <textarea rows={2} value={chatDirection} onChange={event => setChatDirection(event.target.value)} placeholder="希望这次聊天向哪里发展（可选）" />
        <div className="max-h-36 space-y-1 overflow-y-auto">{snapshot.characters.map(item => <label key={item.id} className="flex items-start gap-2 text-[9px] text-text-secondary"><input type="checkbox" checked={selectedCharacterIds.includes(item.id!)} onChange={() => setSelectedCharacterIds(current => current.includes(item.id!) ? current.filter(id => id !== item.id) : [...current, item.id!])} />{item.name}</label>)}</div>
        <button className="storygame-author-create" disabled={!selectedCharacterIds.length || busy} onClick={createGame}><FilePlus2 className="h-3.5 w-3.5" />用所选角色创建</button>
        <button className="storygame-author-create" disabled={selectedCharacterIds.length < 3 || busy} onClick={createSample}><ShieldCheck className="h-3.5 w-3.5" />创建五场景验收样例</button>
      </div>
      <p>创建时会提取人物设定、当前 Work 的角色作用与终局、结构化关系及已确认认知；私密内容只进入本人视角，发布后不随上游漂移。</p>
    </aside>
    <main className="storygame-author-main">
      {message && <div className="storygame-author-notice success"><CheckCircle2 className="h-4 w-4" /><span>{message}</span></div>}
      {error && <div className="storygame-author-notice error"><AlertTriangle className="h-4 w-4" /><span>{error}</span></div>}
      {!definition ? <div className="storygame-author-empty"><UserRound className="h-8 w-8" /><h2>选择角色创建第一个互动游戏</h2><p>创建后会建立共享 Narrative 入口/结局、世界落地角色档案和场景模板；所有结果仍可在发布前编辑。</p></div> : <>
        <div className="storygame-author-toolbar"><div><strong>{definition.title}</strong><span>{profiles.length} 角色 · {scenes.length} 场景 · {releases.length} 发布</span></div><nav><button className={view === 'profiles' ? 'active' : ''} onClick={() => setView('profiles')}>角色与知识</button><button className={view === 'scenes' ? 'active' : ''} onClick={() => setView('scenes')}>场景与规则</button><button className={view === 'context' ? 'active' : ''} onClick={() => setView('context')}>上下文检查</button><button className={view === 'release' ? 'active' : ''} onClick={() => setView('release')}>校验与发布</button></nav></div>
        <section className="storygame-author-pane">
          {view === 'profiles' && <><div className="storygame-author-heading"><div><small>AUTHOR / PROFILES</small><h2>角色知识、秘密与关系维度</h2></div><div className="storygame-author-actions">{!!availableCharacters.length && <><select value={newProfileCharacterId ?? availableCharacters[0]?.id ?? ''} onChange={event => setNewProfileCharacterId(Number(event.target.value))}>{availableCharacters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button disabled={busy} onClick={addProfile}><FilePlus2 className="h-3.5 w-3.5" />添加世界角色</button></>}</div></div><article className="storygame-author-contract"><UserRound className="h-5 w-5" /><div className="w-full"><strong>创建互动专属角色</strong><p>它可以与原世界人物有关，也可以是全新来客；默认只进入当前互动草稿和发布，不会写入世界 Canon。</p><div className="storygame-author-inline mt-3"><label>姓名<input value={guestName} onChange={event => setGuestName(event.target.value)} placeholder="新角色姓名" /></label><label>角色定位<input value={guestRole} onChange={event => setGuestRole(event.target.value)} placeholder="身份、作用或与玩家的关系" /></label></div><div className="storygame-author-json-grid"><label>背景<textarea rows={3} value={guestBackground} onChange={event => setGuestBackground(event.target.value)} /></label><label>与既有世界/人物的关联<textarea rows={3} value={guestRelation} onChange={event => setGuestRelation(event.target.value)} /></label></div><div className="storygame-author-actions"><button disabled={busy || !guestName.trim() || !guestRole.trim()} onClick={addGuest}><FilePlus2 className="h-3.5 w-3.5" />创建专属角色</button></div></div></article>{profiles.map(profile => <ProfileEditor key={profile.id} scope={scope} profile={profile} characters={snapshot.characters} onChanged={refresh} />)}</>}
          {view === 'scenes' && <><div className="storygame-author-heading"><div><small>AUTHOR / SCENES</small><h2>场景、固定行动与 Narrative 连接</h2></div><div className="storygame-author-actions"><button disabled={busy || !profiles.length} onClick={addScene}><FilePlus2 className="h-3.5 w-3.5" />添加场景</button></div></div>{scenes.map(scene => <SceneEditor key={scene.id} scope={scope} scene={scene} nodes={nodes} onChanged={refresh} />)}</>}
          {view === 'context' && <><div className="storygame-author-heading"><div><small>VISIBILITY / INSPECTOR</small><h2>角色实际可见来源</h2></div></div><div className="storygame-author-actions">{profiles.map(profile => <button key={profile.id} onClick={() => void run(async () => { setInspection(await inspectInteractionContext({ scope, gameDefinitionId: definition.id!, participantKey: profile.participantKey })) })}><Eye className="h-3.5 w-3.5" />检查 {snapshot.characters.find(item => item.id === profile.characterId)?.name ?? profile.participantKey}</button>)}</div>{inspection && <article className="storygame-author-contract"><Eye className="h-5 w-5" /><div><strong>{inspection.profile.characterName} · {inspection.participantKey}</strong><p>统一上下文源：{inspection.sourceKeys.join(', ')}；可见知识：{inspection.visibleKnowledgeKeys.join('、') || '无'}；明确隐藏：{inspection.hiddenKnowledgeKeys.join('、') || '无'}；记忆上限 {inspection.memoryCapacity}。</p></div></article>}</>}
          {view === 'release' && <><div className="storygame-author-heading"><div><small>VALIDATE / LEGACY HISTORY</small><h2>草稿诊断与历史 GameRelease</h2><p>该旧工作台只保留草稿维护与历史查看；正式发布请进入“正式制作”，完成世界引用、Brief、开始授权和产品生产。</p></div><div className="storygame-author-actions"><button onClick={() => void run(async () => { setReport(await validateInteractionGameDraft(scope, definition.id!)) })}><ShieldCheck className="h-3.5 w-3.5" />运行检查</button></div></div>{report && <><div className={`storygame-graph-summary ${report.valid ? 'valid' : 'invalid'}`}>{report.valid ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}<div><strong>{report.valid ? '草稿检查通过' : '存在阻断问题'}</strong><span>{report.participantCount} 角色 · {report.sceneCount} 场景 · Narrative {report.narrative.valid ? '通过' : '失败'}</span></div></div><ul className="storygame-graph-issues">{report.diagnostics.map((item, index) => <li key={`${item.code}:${index}`}>{item.severity === 'error' ? '阻断' : '提示'} · {item.message}</li>)}</ul></>}<div className="storygame-version-list">{releases.map(item => <article key={item.id}><div><strong>{item.label}</strong><span>历史 GameRelease v{item.version}</span></div><code>{item.contentHash.slice(0, 16)}…</code></article>)}</div><div className="storygame-author-actions mt-6"><button className="danger" onClick={() => void run(async () => { const ok = await dialog.confirm({ title: `删除草稿“${definition.title}”？`, message: '已发布版本与玩家存档保留；专属作者草稿和可变叙事将删除。', confirmText: '删除草稿', tone: 'danger' }); if (!ok) return; await deleteInteractionGameDraft({ scope, gameDefinitionId: definition.id! }); await refresh(); setMessage('已删除作者草稿，旧发布和存档保留。') })}><Trash2 className="h-3.5 w-3.5" />删除草稿</button></div></>}
        </section>
      </>}
    </main>
  </div>
}
