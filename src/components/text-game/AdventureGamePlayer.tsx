import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Backpack,
  BookOpenCheck,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Compass,
  Eye,
  Footprints,
  Gem,
  GitBranch,
  Heart,
  History,
  KeyRound,
  Loader2,
  Map,
  MapPin,
  MessageCircle,
  PackageOpen,
  Plus,
  Save,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  Swords,
  Trash2,
  UserRound,
  WandSparkles,
  X,
} from 'lucide-react'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
import { resolveRequestConfig } from '../../lib/ai/client'
import type { AdventureActionKind, Project, WorkspaceScope } from '../../lib/types'
import { useAdventureGamePlayerStore, selectAdventureActions } from '../../stores/adventure-game-player'
import { useAIConfigStore } from '../../stores/ai-config'
import { useDialog } from '../shared/Dialog'
import './player-roadshow.css'

type AdventurePanel = 'inventory' | 'skills' | 'quests' | 'journal' | 'saves' | 'free' | null

const QUEST_STATUS: Record<string, string> = {
  locked: '未解锁', available: '可接取', active: '进行中', completed: '已完成', failed: '已失败',
}

const ACTION_KIND: Record<AdventureActionKind, string> = {
  look: '观察', move: '移动', talk: '交谈', take: '拾取', give: '交付', use: '使用',
  inspect: '调查', attempt: '尝试', rest: '休整', 'quest-action': '任务',
}

const COMMON_LABELS: Record<string, string> = {
  notice: '失物告示', gate: '集市门闩', ledger: '档案簿', lock: '档案柜锁',
  grate: '水渠格栅', mechanism: '水渠机关', keeper: '守钟人', beacon: '旧灯塔',
  rope: '旧绳', 'brass-key': '黄铜钥匙', 'ledger-page': '档案抄页', 'lamp-oil': '灯油',
  herb: '水渠草药', seal: '旧印章', gear: '备用齿轮', letter: '未寄出的信',
  coin: '港币', 'bell-shard': '潮汐钟片', observe: '观察', agility: '灵巧',
  reason: '推理', empathy: '共情', wounded: '受伤', inspired: '振奋', wanted: '被通缉',
}

function friendlyName(title: string | undefined, key: string): string {
  const value = title?.trim()
  return !value || value.toLowerCase() === key.toLowerCase() ? COMMON_LABELS[key] ?? value ?? key : value
}

function friendlyDescription(description: string | undefined, key: string, kind: 'object' | 'item' | 'ability' | 'condition'): string {
  const value = description?.trim() ?? ''
  if (value && !value.toLowerCase().startsWith(key.toLowerCase())) return value
  if (kind === 'object') return '可调查的场景要素，可能藏着推进冒险的线索。'
  if (kind === 'item') return '可在任务、判定或场景行动中使用的物品。'
  if (kind === 'condition') return '当前状态会影响后续行动与剧情结果。'
  const abilityCopy: Record<string, string> = {
    observe: '发现环境细节与未被说出的线索。', agility: '完成需要身手与反应的行动。',
    reason: '分析记录、机关与相互矛盾的证据。', empathy: '理解人物动机并建立信任。',
  }
  return abilityCopy[key] ?? '用于解决冒险中的能力检定。'
}

function actionIcon(kind: AdventureActionKind) {
  if (kind === 'move') return <Footprints />
  if (kind === 'talk') return <MessageCircle />
  if (kind === 'look' || kind === 'inspect') return <Eye />
  if (kind === 'take' || kind === 'give') return <Backpack />
  if (kind === 'use') return <WandSparkles />
  if (kind === 'attempt' || kind === 'quest-action') return <Swords />
  return <CircleDot />
}

function itemIcon(tags: string[], key: string) {
  const text = `${tags.join(' ')} ${key}`.toLowerCase()
  if (text.includes('key') || text.includes('钥')) return <KeyRound />
  if (text.includes('record') || text.includes('document') || text.includes('记录')) return <ScrollText />
  if (text.includes('artifact') || text.includes('bell') || text.includes('宝物')) return <Gem />
  return <PackageOpen />
}

function gauge(value: number, minimum: number, maximum: number): number {
  if (maximum <= minimum) return 100
  return Math.min(100, Math.max(0, (value - minimum) / (maximum - minimum) * 100))
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(value)
}

export default function AdventureGamePlayer(props: {
  project: Project
  scope: WorkspaceScope
  worldGroupId: number | null
}) {
  const store = useAdventureGamePlayerStore()
  const { config } = useAIConfigStore()
  const dialog = useDialog()
  const [panel, setPanel] = useState<AdventurePanel>(null)
  const [freeText, setFreeText] = useState('')
  const [checkpointName, setCheckpointName] = useState('')
  const [branchTitle, setBranchTitle] = useState('')
  const [localError, setLocalError] = useState('')

  useEffect(() => {
    void store.load(props.scope, props.worldGroupId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.scope.projectId, props.scope.worldId, props.scope.workId, props.worldGroupId])

  const selected = store.sessions.find(item => item.id === store.selectedSessionId) ?? null
  const adventure = store.runtimeState.adventure
  const manifest = store.selectedManifest
  const location = manifest?.adventure.locations.find(item => item.key === adventure?.currentLocationKey) ?? null
  const locationIndex = manifest && location ? manifest.adventure.locations.findIndex(item => item.key === location.key) : 0
  const objects = useMemo(() => manifest?.adventure.objects.filter(item => item.locationKey === location?.key) ?? [], [manifest, location?.key])
  const actions = selectAdventureActions(store)
  const visibleChoices = (store.runtimeState.narrative?.choices ?? []).filter(choice => store.runtimeState.narrative?.visibleChoiceKeys?.includes(choice.choiceKey))
  const resolved = resolveRequestConfig(config, { category: 'runtime.prose.adventure-intent-parser' })
  const aiReady = isAIConfigReady(resolved.config)
  const generating = store.generatingRunId != null
  const error = localError || store.error
  const lastAction = adventure?.actionHistory[adventure.actionHistory.length - 1] ?? null
  const playerItems = adventure?.inventory.filter(item => item.ownerKey === 'player') ?? []
  const currentParticipantKeys = useMemo(() => new Set(actions
    .filter(item => item.action.locationKey === location?.key && item.action.interaction)
    .map(item => item.action.interaction!.participantKey)), [actions, location?.key])
  const currentProfiles = useMemo(() => {
    const profiles = manifest?.interaction.profiles ?? []
    const present = profiles.filter(profile => currentParticipantKeys.has(profile.participantKey))
    return present.length ? present : profiles
  }, [currentParticipantKeys, manifest?.interaction.profiles])

  const run = async (action: () => Promise<unknown>) => {
    setLocalError('')
    try { await action() } catch (reason) { setLocalError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const submitFreeText = async () => {
    if (!freeText.trim() || !aiReady) return
    await store.generateIntent(freeText.trim(), resolved.config)
  }

  const removeSession = async (sessionId: number, title: string) => {
    const confirmed = await dialog.confirm({
      title: `删除冒险存档“${title}”？`, message: '该存档的事件与检查点将一起删除。', confirmText: '删除', tone: 'danger',
    })
    if (confirmed) await run(() => store.remove(sessionId))
  }

  if (store.loading && !selected) return <div className="adventure-launcher adventure-player-v2"><Loader2 className="adventure-loading" /><span>正在整理行囊…</span></div>

  if (!selected || !adventure || !manifest || !location) return <div className="adventure-launcher adventure-player-v2" data-testid="adventure-game-player">
    <div className="adventure-launcher-atmosphere" />
    <div className="adventure-launcher-content">
      <span className="adventure-kicker"><Compass /> TEXT ADVENTURE</span>
      <h2>踏入故事世界</h2>
      <p>探索地点、结识人物、收集物品并运用能力推进任务。所有行动都会自动保存。</p>
      {error && <div role="alert" className="adventure-alert">{error}</div>}
      <section className="adventure-release-grid" aria-label="文字冒险发布">
        {store.releases.map(item => <article key={item.release.id}>
          <div className="adventure-release-cover"><MapPin /><span>{item.manifest?.adventure.locations.length ?? 0} 个可探索地点</span></div>
          <div><small>正式发布 · v{item.release.version}</small><h3>{item.manifest?.definition.title ?? item.release.label}</h3><p>{item.manifest?.definition.description || '一场由选择、探索和任务共同推进的冒险。'}</p><div className="adventure-release-stats"><span>{item.manifest?.interaction.profiles.length ?? 0} 角色</span><span>{item.manifest?.adventure.items.length ?? 0} 物品</span><span>{item.manifest?.adventure.abilities.length ?? 0} 技能</span><span>{item.manifest?.adventure.quests.length ?? 0} 任务</span></div>{item.error && <p className="adventure-error">{item.error}</p>}<button disabled={!item.manifest || !!item.error || store.busy} onClick={() => void run(() => store.start(item.release.id!))}><Plus />新建冒险</button></div>
        </article>)}
        {!store.releases.length && <div className="adventure-empty">尚无文字冒险发布。请先在作者工作台完成发布。</div>}
      </section>
      {!!store.sessions.length && <section className="adventure-launcher-saves"><h3><Save />继续冒险</h3>{store.sessions.map(session => <div key={session.id}><button onClick={() => void store.select(session.id!)}><strong>{session.title}</strong><small>{formatTime(session.updatedAt)} · 可继续</small></button><button aria-label="删除冒险存档" onClick={() => void removeSession(session.id!, session.title)}><Trash2 /></button></div>)}</section>}
    </div>
  </div>

  return <div className="adventure-game adventure-player-v2" data-testid="adventure-game-player">
    <header className="adventure-gamebar">
      <button aria-label="返回冒险列表" onClick={() => void store.select(null)}><ArrowLeft /></button>
      <div><small>{manifest.definition.title}</small><strong>{location.title}</strong></div>
      <span className="adventure-autosave"><CircleDot />已自动保存 · 行动 {adventure.actionHistory.length}</span>
      <nav aria-label="冒险功能">
        <button onClick={() => setPanel('inventory')}><Backpack />背包 <b>{playerItems.reduce((sum, item) => sum + item.quantity, 0)}</b></button>
        <button onClick={() => setPanel('skills')}><WandSparkles />技能</button>
        <button onClick={() => setPanel('quests')}><ScrollText />任务</button>
        <button onClick={() => setPanel('journal')}><History />记录</button>
        <button onClick={() => setPanel('saves')}><Save />存档</button>
      </nav>
    </header>

    {error && <div role="alert" className="adventure-alert adventure-game-alert">{error}</div>}
    <div className="adventure-layout">
      <aside className="adventure-map-rail" aria-label="探索地图">
        <div className="adventure-rail-heading"><Map /><span>探索地图</span><small>{adventure.visitedLocationKeys.length}/{manifest.adventure.locations.length}</small></div>
        <div className="adventure-route">{manifest.adventure.locations.map((place, index) => { const visited = adventure.visitedLocationKeys.includes(place.key); const current = place.key === location.key; return <div className={`${visited ? 'visited' : ''} ${current ? 'current' : ''}`} key={place.key}><i>{current ? <MapPin /> : index + 1}</i><span><strong>{visited || current ? place.title : '未知地点'}</strong><small>{current ? '你在这里' : visited ? '已探索' : '尚未发现'}</small></span></div> })}</div>
        <div className="adventure-rail-legend"><Compass /><span>继续行动会发现新的道路与线索。</span></div>
      </aside>

      <main className="adventure-scene-column">
        <section className={`adventure-scene scene-${Math.abs(locationIndex) % 4}`}>
          <div className="adventure-scene-fog" />
          <header><span><MapPin />当前位置</span><h1>{location.title}</h1><p>{location.description}</p></header>
          {!!currentProfiles.length && <div className="adventure-scene-characters" aria-label="在场角色">{currentProfiles.map(profile => <article key={profile.participantKey}><span className="adventure-character-avatar">{profile.name.slice(0, 1)}</span><div><small>{currentParticipantKeys.has(profile.participantKey) ? '在场角色' : '已知人物'}</small><strong>{profile.name}</strong><p>{profile.roleLabel || '世界中的人物'}</p></div>{currentParticipantKeys.has(profile.participantKey) && <i>可交谈</i>}</article>)}</div>}
          <div className="adventure-scene-objects"><span>可调查</span>{objects.map(item => <article key={item.key}><CircleDot /><div><strong>{friendlyName(item.title, item.key)}</strong><p>{friendlyDescription(item.description, item.key, 'object')}</p></div></article>)}{!objects.length && <p>这里暂时没有显眼的交互物。</p>}</div>
        </section>

        {lastAction && <section className={`adventure-result result-${lastAction.outcome}`} aria-live="polite"><div>{lastAction.outcome === 'success' ? <Check /> : <Sparkles />}</div><span><small>刚刚发生 · {lastAction.outcome === 'success' ? '行动成功' : lastAction.outcome === 'costly-success' ? '付出代价' : '行动结果'}</small><strong>{manifest.adventure.actions.find(value => value.key === lastAction.actionKey)?.label ?? lastAction.actionKey}</strong><p>{store.generatedNarrative?.narrative ?? lastAction.narrative}</p></span>{aiReady && <button disabled={store.busy || generating} onClick={() => void run(() => store.narrateLastResult(resolved.config))}><Sparkles />润色</button>}</section>}

        <section className="adventure-actions" aria-label="可执行行动">
          <header><div><small>CHOOSE AN ACTION</small><h2>你要做什么？</h2></div><button onClick={() => setPanel('free')}><Sparkles />自由行动</button></header>
          <div>{actions.map(item => <button key={item.action.key} title={item.available ? item.action.description : item.reason} disabled={!item.available || store.busy || generating} onClick={() => void run(() => store.act(item.action.key))}><i>{actionIcon(item.action.kind)}</i><span><small>{ACTION_KIND[item.action.kind]}</small><strong>{item.action.label}</strong><p>{item.available ? item.action.description : item.reason}</p></span><ChevronRight /></button>)}</div>
        </section>

        {!!visibleChoices.length && !store.runtimeState.narrative?.completed && <section className="adventure-story-choices"><small>关键剧情</small><h2>这会改变冒险的结局</h2><div>{visibleChoices.map(choice => <button key={choice.choiceKey} disabled={!store.runtimeState.narrative?.availableChoiceKeys?.includes(choice.choiceKey) || store.busy} onClick={() => void run(() => store.choose(choice.choiceKey))}><strong>{choice.text}</strong><ChevronRight /></button>)}</div></section>}
        {store.runtimeState.narrative?.completed && <section className="adventure-ending"><BookOpenCheck /><small>ADVENTURE COMPLETE</small><h2>已抵达结局：{store.runtimeState.narrative.nodes.find(item => item.key === store.runtimeState.narrative?.endingKey)?.title}</h2><p>这条时间线已经完整保存。你仍可从检查点建立另一条分支。</p><button onClick={() => setPanel('saves')}><GitBranch />从检查点继续</button></section>}
      </main>

      <aside className="adventure-status-rail" aria-label="角色状态">
        <section className="adventure-player-card"><span><UserRound /></span><div><small>旅行者</small><strong>雾港调查者</strong><p>{selected.title}</p></div></section>
        <section className="adventure-status-section"><h2><Heart />生存状态</h2>{Object.entries(adventure.resources).map(([key, value]) => { const definition = manifest.adventure.resources.find(item => item.key === key); return <div className="adventure-gauge" key={key}><span><b>{definition?.title ?? key}</b><strong>{value}</strong></span><i><b style={{ width: `${gauge(value, definition?.minimum ?? 0, definition?.maximum ?? 100)}%` }} /></i></div> })}{!!adventure.conditions.length && <div className="adventure-conditions">{adventure.conditions.map(item => { const definition = manifest.adventure.conditions.find(value => value.key === item.conditionKey); return <span key={item.conditionKey} title={friendlyDescription(definition?.description, item.conditionKey, 'condition')}>{friendlyName(definition?.title, item.conditionKey)}{item.duration == null ? '' : ` · ${item.duration}`}</span> })}</div>}</section>
        <section className="adventure-status-section"><h2><WandSparkles />能力</h2>{Object.entries(adventure.abilities).map(([key, value]) => { const definition = manifest.adventure.abilities.find(item => item.key === key); return <div className="adventure-skill-row" key={key}><span><b>{friendlyName(definition?.title, key)}</b><small>{friendlyDescription(definition?.description, key, 'ability')}</small></span><strong>{value}</strong></div> })}<button className="adventure-more" onClick={() => setPanel('skills')}>查看能力详情 <ChevronRight /></button></section>
        <section className="adventure-status-section"><h2><ShieldCheck />任务追踪</h2>{adventure.quests.filter(item => ['active', 'available'].includes(item.status)).slice(0, 2).map(quest => { const definition = manifest.adventure.quests.find(item => item.key === quest.questKey); const done = quest.objectives.filter(item => item.completed).length; return <article className="adventure-quest-mini" key={quest.questKey}><small>{QUEST_STATUS[quest.status]}</small><strong>{definition?.title ?? quest.questKey}</strong><span>{done}/{quest.objectives.length} 项目标</span></article> })}<button className="adventure-more" onClick={() => setPanel('quests')}>查看全部任务 <ChevronRight /></button></section>
        {!!store.runtimeState.interaction?.relationships.length && <section className="adventure-status-section"><h2><Bot />人物关系</h2>{store.runtimeState.interaction.relationships.map(item => { const profile = manifest.interaction.profiles.find(value => value.participantKey === item.toParticipantKey); return <div className="adventure-relationship" key={`${item.fromParticipantKey}:${item.toParticipantKey}:${item.dimensionKey}`}><span><b>{profile?.name ?? item.toParticipantKey}</b><small>{item.fromParticipantKey} · {item.dimensionKey}</small></span><strong>{item.value}</strong></div> })}</section>}
      </aside>
    </div>

    <nav className="adventure-mobile-dock" aria-label="冒险快捷功能"><button onClick={() => setPanel('inventory')}><Backpack /><span>背包</span></button><button onClick={() => setPanel('skills')}><WandSparkles /><span>技能</span></button><button onClick={() => setPanel('quests')}><ScrollText /><span>任务</span></button><button onClick={() => setPanel('journal')}><History /><span>记录</span></button><button onClick={() => setPanel('saves')}><Save /><span>存档</span></button></nav>

    {panel && <div className="adventure-panel-backdrop" role="presentation"><section className="adventure-panel" aria-label={{ inventory: '背包', skills: '技能', quests: '任务', journal: '冒险记录', saves: '存档与时间线', free: '自由行动' }[panel]}><header><div><small>ADVENTURER'S JOURNAL</small><h2>{{ inventory: '背包与物品', skills: '角色能力', quests: '任务日志', journal: '冒险记录', saves: '存档与时间线', free: '自由行动' }[panel]}</h2></div><button aria-label="关闭面板" onClick={() => setPanel(null)}><X /></button></header><div className="adventure-panel-content">
      {panel === 'inventory' && <div className="adventure-inventory-grid">{playerItems.map(item => { const definition = manifest.adventure.items.find(value => value.key === item.itemKey); return <article key={`${item.itemKey}:${item.state}`}><i>{itemIcon(definition?.tags ?? [], item.itemKey)}</i><div><small>{item.state === 'equipped' ? '已装备' : definition?.consumable ? '消耗品' : '携带中'}</small><strong>{friendlyName(definition?.title, item.itemKey)}</strong><p>{friendlyDescription(definition?.description, item.itemKey, 'item')}</p></div><b>×{item.quantity}</b></article> })}{!playerItems.length && <div className="adventure-empty">背包还是空的，探索场景会找到可携带的物品。</div>}</div>}
      {panel === 'skills' && <div className="adventure-skills-grid">{Object.entries(adventure.abilities).map(([key, value]) => { const definition = manifest.adventure.abilities.find(item => item.key === key); return <article key={key}><i><WandSparkles /></i><div><small>能力等级 {value}</small><strong>{friendlyName(definition?.title, key)}</strong><p>{friendlyDescription(definition?.description, key, 'ability')}</p><span><b style={{ width: `${gauge(value, definition?.minimum ?? 0, definition?.maximum ?? 10)}%` }} /></span></div></article> })}</div>}
      {panel === 'quests' && <div className="adventure-quest-list">{adventure.quests.map(quest => { const definition = manifest.adventure.quests.find(item => item.key === quest.questKey); return <article className={`status-${quest.status}`} key={quest.questKey}><header><span>{QUEST_STATUS[quest.status]}</span><strong>{definition?.title ?? quest.questKey}</strong></header><p>{definition?.description}</p><ul>{quest.objectives.map(item => <li className={item.completed ? 'done' : ''} key={item.objectiveKey}>{item.completed ? <Check /> : <CircleDot />}{definition?.objectives.find(value => value.key === item.objectiveKey)?.title ?? item.objectiveKey}</li>)}</ul></article> })}</div>}
      {panel === 'journal' && <div className="adventure-journal">{[...adventure.actionHistory].reverse().map(item => <article key={item.eventSequence}><i>{item.eventSequence}</i><div><small>{ACTION_KIND[item.kind]} · {item.outcome === 'success' ? '成功' : item.outcome}</small><strong>{manifest.adventure.actions.find(value => value.key === item.actionKey)?.label ?? item.actionKey}</strong><p>{item.narrative}</p></div></article>)}{!adventure.actionHistory.length && <div className="adventure-empty">你的冒险还没有留下行动记录。</div>}</div>}
      {panel === 'saves' && <div className="adventure-save-panel"><section><h3><Save />保存检查点</h3><div><input value={checkpointName} onChange={event => setCheckpointName(event.target.value)} placeholder="为此刻命名" /><button disabled={!checkpointName.trim()} onClick={() => void run(async () => { await store.saveCheckpoint(checkpointName); setCheckpointName('') })}>保存</button></div></section><section><h3><GitBranch />已有检查点</h3>{store.checkpoints.map(item => <button key={item.id} onClick={() => void run(() => store.forkCheckpoint(item.id!))}><span><strong>{item.name}</strong><small>事件 #{item.throughSequence} · {formatTime(item.createdAt)}</small></span><b>从这里分支</b></button>)}{!store.checkpoints.length && <p>行动会自动保存；你也可以为重要时刻建立手动检查点。</p>}</section><section><h3><GitBranch />当前时间线分支</h3><div><input value={branchTitle} onChange={event => setBranchTitle(event.target.value)} placeholder="新时间线名称" /><button disabled={!branchTitle.trim()} onClick={() => void run(async () => { await store.forkCurrent(branchTitle); setBranchTitle(''); setPanel(null) })}>建立分支</button></div></section></div>}
      {panel === 'free' && <div className="adventure-free-action"><Sparkles /><h3>用自己的话描述行动</h3><p>{aiReady ? '主 Agent 会把你的表达理解为当前世界中可执行的正式行动，确认后再推进存档。' : '尚未配置 AI。你仍可使用场景中的全部固定行动完成冒险。'}</p><textarea value={freeText} onChange={event => setFreeText(event.target.value)} disabled={!aiReady || store.busy || generating} placeholder={aiReady ? '例如：我想仔细看看码头上的告示…' : '配置 AI 后可使用自由行动'} rows={4} /><div>{generating && <button onClick={() => void store.cancelGeneration()}><Square />取消</button>}<button disabled={!aiReady || !freeText.trim() || store.busy || generating} onClick={() => void run(submitFreeText)}>{generating ? <Loader2 /> : <Send />}理解行动</button></div>{store.pendingIntent && <article><small>准备执行</small><strong>{manifest.adventure.actions.find(item => item.key === store.pendingIntent?.actionKey)?.label ?? store.pendingIntent.actionKey}</strong><p>{store.pendingIntent.rationale}</p><div><button onClick={() => void run(async () => { await store.adoptPendingIntent(); setPanel(null); setFreeText('') })}><Check />确认执行</button><button onClick={() => void run(() => store.rejectPendingIntent())}>换一个说法</button></div></article>}{!!store.recoverableRunIds.length && <details><summary>恢复未完成的自由行动</summary>{store.recoverableRunIds.map(runId => <button key={runId} disabled={store.busy} onClick={() => void run(() => store.resumeRun(runId))}>恢复 #{runId}</button>)}</details>}</div>}
    </div></section></div>}
  </div>
}
