import { ttrpgCampaignNavigationV1 } from '../../lib/ttrpg/campaign-navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, BookOpen, Check, Compass, Dices, Flag, LockKeyhole, Pause, Play, Save, Send, Sparkles, Users, X } from 'lucide-react'
import type { ProductRuntimeSession, ProductRuntimeState, TtrpgSessionParticipantRecordV2, WorkspaceScope } from '../../lib/types'
import { useAIConfigStore } from '../../stores/ai-config'
import { loadTtrpgRuntimeContentV1 } from '../../lib/ttrpg/runtime-content'
import { createTtrpgViewerProjectionV1 } from '../../lib/ttrpg/viewer-projection'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../lib/ttrpg/participants'
import { changeTtrpgSafetyStatus, completeTtrpgCampaignEnding, completeTtrpgSessionZero, openTtrpgCampaignScene,
  recordTtrpgHumanResponseV2, resolveTtrpgEffectChoiceV2, readProductRuntimeStateVersion, submitTtrpgActionIntentV2 } from '../../lib/ttrpg/runtime-api'
import { runTtrpgKpCycleV1, type TtrpgKpPhaseV1 } from '../../lib/ttrpg/kp-coordinator'
import { useTtrpgMediaUrls } from './useTtrpgMediaUrls'
import './ttrpg-play.css'

const phaseLabels: Record<TtrpgKpPhaseV1, string> = { opening: '灯亮了，故事即将开始', directing: 'KP 正在回应你的行动', narrating: '故事正在发生', npc: '场景中的人物正在行动', companion: '你的 AI 同伴正在行动' }
const outcomeLabels: Record<string, string> = { automatic: '直接完成', success: '成功', 'partial-success': '成功，伴随代价', failure: '受挫',
  'critical-success': '大成功', 'critical-failure': '大失败', 'hard-success': '困难成功', 'extreme-success': '极难成功', hidden: '暗骰' }

export default function TtrpgPlayTable(props: {
  session: ProductRuntimeSession
  state: ProductRuntimeState
  scope: WorkspaceScope
  onChanged: () => Promise<void>
  onCheckpoint: (name: string) => Promise<void>
  onBusyChange?: (busy: boolean) => void
}) {
  const config = useAIConfigStore(store => store.config)
  const [content, setContent] = useState<Awaited<ReturnType<typeof loadTtrpgRuntimeContentV1>> | null>(null)
  const [seats, setSeats] = useState<TtrpgSessionParticipantRecordV2[]>([])
  const [heroKey, setHeroKey] = useState('')
  const [mode, setMode] = useState<'solo' | 'local'>('solo')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState('')
  const [actionKey, setActionKey] = useState('')
  const [targetKey, setTargetKey] = useState('')
  const [privateOpen, setPrivateOpen] = useState(false)
  const [viewerConfirmed, setViewerConfirmed] = useState(false)
  const [privacyLocked, setPrivacyLocked] = useState(false)
  const [privateQuestion, setPrivateQuestion] = useState('')
  const [responseText, setResponseText] = useState('')
  const [actionAdvice, setActionAdvice] = useState<{ actorKey: string; draft: string; advice: string; suggestedActionKey: string | null } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const transcriptEnd = useRef<HTMLDivElement>(null)
  const sessionId = props.session.id!
  const tableTitle = props.session.title.split(' · ')[0] || props.session.title
  const product = props.state.ttrpg!.product!
  useEffect(() => {
    let stale = false
    void loadTtrpgRuntimeContentV1({ scope: props.scope, productRuntimeSessionId: sessionId }).then(result => {
      if (!stale) setContent(result)
    }).catch(cause => { if (!stale) setError(String(cause instanceof Error ? cause.message : cause)) })
    return () => { stale = true; controller.current?.abort() }
  }, [sessionId, props.scope.projectId, props.scope.worldId, props.scope.workId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let stale = false
    void readTtrpgSessionParticipantsV2(sessionId).then(rows => {
      if (stale) return
      setSeats(rows)
      setHeroKey(current => rows.some(seat => seat.actorKey === current && seat.role === 'player' && (!product.sessionZero.completed || seat.controller === 'human'))
        ? current : rows.find(seat => seat.role === 'player' && seat.controller === 'human')?.actorKey || rows.find(seat => seat.role === 'player')?.actorKey || '')
    }).catch(cause => { if (!stale) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { stale = true }
  }, [sessionId, props.state.lastSequence, product.sessionZero.completed])
  useEffect(() => { transcriptEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [props.state.lastSequence])
  const hasHumanSeat = seats.some(seat => seat.actorKey === heroKey && seat.role === 'player' && seat.controller === 'human')
  const projection = useMemo(() => !content || !heroKey ? null : createTtrpgViewerProjectionV1({
    state: props.state, campaign: content.campaign, rulePack: content.rulePack, role: product.sessionZero.completed && hasHumanSeat ? 'player' : 'spectator', actorKey: product.sessionZero.completed && hasHumanSeat ? heroKey : null,
    participantControllers: Object.fromEntries(seats.filter(seat => seat.actorKey).map(seat => [seat.actorKey!, seat.controller])),
  }), [content, props.state, heroKey, seats, product.sessionZero.completed, hasHumanSeat])
  const actions = projection?.availableActions.filter(action => action.phase !== 'reaction') ?? []
  const action = actions.find(item => item.actionKey === actionKey) ?? actions[0]
  const hero = projection?.actors.find(actor => actor.actorKey === heroKey)
  const scene = projection?.scenes.find(item => item.status === 'current')
  const mediaUrls = useTtrpgMediaUrls({ scope: props.scope, sessionId, source: content?.source ?? null,
    viewerKey: seats.find(seat => seat.actorKey === heroKey)?.viewerKey ?? null, media: projection?.media ?? null })
  const portrait = (actorKey: string) => projection?.media?.slots.find(slot => slot.kind === 'character-portrait' && slot.targetRef === actorKey && mediaUrls[slot.slotKey])
  const sceneArt = projection?.media?.slots.find(slot => slot.kind === 'scene' && slot.targetRef === scene?.sceneKey && mediaUrls[slot.slotKey])
  const active = projection?.actors.find(actor => actor.actorKey === projection.turn.activeActorKey)
  const myTurn = active?.actorKey === heroKey && seats.some(seat => seat.actorKey === heroKey && seat.controller === 'human')
  const targets = !action || !projection ? [] : projection.actors.filter(actor => action.target === 'self' ? actor.actorKey === heroKey
    : actor.actorKey !== heroKey && actor.role === (action.target === 'single-ally' ? 'player' : 'npc'))
  const navigation = content ? ttrpgCampaignNavigationV1(props.state, content.campaign) : { nextScenes: [], endings: [] }
  const pendingResponse = projection?.pendingHumanResponses[0]
  const pendingChoice = projection?.pendingEffectChoices[0]
  const responseOwnerKey = product.actionHistory.flatMap(action => action.receipt?.context.observers.filter(observer =>
    observer.responsePolicy === 'prompt-human' && action.receipt!.context.reactionWindows.some(window => window.status !== 'closed'
      && window.layer === 'immediate-character' && window.humanConfirmationRequiredActorKeys.includes(observer.actorKey))
      && !product.humanResponses?.some(response => response.actionSequence === action.eventSequence && response.actorKey === observer.actorKey))
    .map(observer => observer.actorKey) ?? []).find(key => seats.some(seat => seat.actorKey === key && seat.controller === 'human'))
  const effectOwnerKey = product.effectLedger?.pendingChoices.find(choice => seats.some(seat => seat.actorKey === choice.ownerActorKey && seat.controller === 'human'))?.ownerActorKey
  const waitingKey = effectOwnerKey ?? responseOwnerKey
  const handoffActor = waitingKey && waitingKey !== heroKey ? projection?.actors.find(actor => actor.actorKey === waitingKey) : null
  const multipleHumans = seats.filter(seat => seat.role === 'player' && seat.controller === 'human').length > 1
  const recipient = waitingKey ? projection?.actors.find(actor => actor.actorKey === waitingKey)
    : active?.controller === 'human' ? active : hero
  const privacyGate = product.sessionZero.completed && (privacyLocked || (multipleHumans && (!viewerConfirmed || recipient?.actorKey !== heroKey)))
  const handoff = (actorKey: string) => {
    setHeroKey(actorKey); setPrivateOpen(false); setPrivateQuestion(''); setResponseText(''); setDraft(''); setActionAdvice(null)
    setActionKey(''); setTargetKey(''); setError(''); setNotice(''); setViewerConfirmed(true); setPrivacyLocked(false)
  }

  const ending = content?.campaign.endings.find(ending => ending.endingKey === product.ending?.endingKey)
  const envelope = async (label: string) => {
    const version = await readProductRuntimeStateVersion(sessionId)
    return { sessionId, commandId: `table.${label}.${crypto.randomUUID()}`, baseSequence: version.sequence, baseStateHash: version.stateHash }
  }
  const coordinate = async (signal: AbortSignal, stay = false) => {
    if (!config.apiKey && config.provider !== 'ollama') throw new Error('请在 API 设置中填入可用配置，再邀请 AI KP 开始主持。')
    const result = await runTtrpgKpCycleV1({ scope: props.scope, productRuntimeSessionId: sessionId, aiConfig: config, signal,
      stayInScene: stay, onPhase: phase => setPhase(phaseLabels[phase]), onChanged: props.onChanged })
    setNotice(result.status === 'budget-limit' ? '这一轮 AI 回合已完成。可以继续邀请 KP 主持。'
      : result.status === 'confirmation' ? '混合主持模式有一个待确认候选，请在主持工具中审阅。'
        : result.status === 'busy' ? '另一个窗口正在主持，稍后会同步进度。' : '')
  }
  const perform = async (job: (signal: AbortSignal) => Promise<void>) => {
    if (controller.current) return
    const abort = new AbortController(); controller.current = abort
    setBusy(true); props.onBusyChange?.(true); setError(''); setNotice('')
    try { await job(abort.signal) }
    catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); else setNotice('已停止。完成的行动已经保存，可以从这里继续。') }
    finally {
      try { await props.onChanged() }
      catch (cause) { setError(`进度暂时无法读取：${cause instanceof Error ? cause.message : String(cause)}`) }
      setBusy(false); props.onBusyChange?.(false); setPhase(''); controller.current = null
    }
  }
  const begin = () => perform(async signal => {
    if (!accepted || !content) return
    setViewerConfirmed(true)
    setPhase('正在确认角色与开团约定')
    const rows = await readTtrpgSessionParticipantsV2(sessionId)
    for (const seat of rows) {
      if (seat.role === 'spectator') continue
      await configureTtrpgSessionParticipantV2({ sessionId, seatKey: seat.seatKey, expectedRevision: seat.revision,
        commandId: `table.setup.${seat.seatKey}.${seat.revision}`, requestedByViewerKey: 'viewer.gm',
        controller: seat.role === 'gm' ? 'ai' : mode === 'local' || seat.actorKey === heroKey ? 'human' : 'ai',
        activation: seat.role === 'gm' ? 'manual' : mode === 'local' || seat.actorKey === heroKey ? 'manual' : 'initiative',
        consent: { aiIdentityDisclosed: true, aiAdviceAllowed: true },
      })
    }
    await completeTtrpgSessionZero({ ...await envelope('zero'), acceptedItemKeys: product.sessionZero.requiredItemKeys,
      selectedCharacterKeys: content.campaign.characterTemplates.filter(actor => actor.role === 'player').map(actor => actor.characterKey), completedBy: 'local-owner' })
    await props.onChanged(); await coordinate(signal)
  })
  const submit = () => perform(async signal => {
    if (!draft.trim() || !myTurn || !action) return
    const seat = seats.find(seat => seat.actorKey === heroKey)!
    setPhase('正在结算你的行动')
    await submitTtrpgActionIntentV2({ ...await envelope('action'), intentKey: `intent.${crypto.randomUUID()}`, actorKey: heroKey,
      rawInput: draft.trim(), actionKey: action.actionKey,
      targetKey: action.target === 'scene' ? null : action.target === 'self' ? heroKey : targets.find(actor => actor.actorKey === targetKey)?.actorKey ?? targets[0]?.actorKey ?? null,
      goal: draft.trim(), difficulty: action.defaultDifficulty ?? undefined, submittedBy: { role: 'player', viewerKey: seat.viewerKey } })
    setDraft(''); setActionAdvice(null); await props.onChanged(); await coordinate(signal)
  })
  const askForRuling = () => perform(async signal => {
    if (!draft.trim() || !myTurn) return
    setPhase('KP 正在解释可行的方法与规则')
    const { generateTtrpgPrivateGuidanceV1, adoptTtrpgPrivateGuidanceV1 } = await import('../../lib/ttrpg/private-guidance')
    const generated = await generateTtrpgPrivateGuidanceV1({ scope: props.scope, productRuntimeSessionId: sessionId,
      actorKey: heroKey, objective: `玩家在执行前询问这段想法如何处理：${draft.trim()}\n请区分行动意图、规则问题和场外讨论。对行动意图，只从 availableActions 建议相符的方法，解释已登记的检定和资源代价；无法表达的行动先澄清，不强行套用。规则问题仅按 ruleReference 回答，场外讨论只回应约定。不要执行行动或宣告成功，非行动问题的 suggestedActionKey 必须为 null。`, aiConfig: config, signal })
    await adoptTtrpgPrivateGuidanceV1({ scope: props.scope, runId: generated.candidate.runId, actorKey: heroKey })
    setActionAdvice({ actorKey: heroKey, draft, advice: generated.candidate.payload.advice, suggestedActionKey: generated.candidate.payload.suggestedActionKey })
  })
  const move = (sceneKey: string) => perform(async signal => {
    await props.onCheckpoint(`离开${scene?.title ?? '场景'}`)
    await openTtrpgCampaignScene({ ...await envelope('travel'), sceneKey })
    setPrivateOpen(false); setActionAdvice(null); await props.onChanged(); await coordinate(signal)
  })
  const pause = async () => {
    controller.current?.abort()
    try { await changeTtrpgSafetyStatus({ ...await envelope('pause'), status: product.safety.status === 'paused' ? 'active' : 'paused',
      reason: product.safety.status === 'paused' ? null : '玩家暂停', changedBy: heroKey || 'local-owner' }); await props.onChanged() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  if (!content || !projection) return <div className="sf-ttrpg-loading">{error || '正在布置游戏桌面…'}</div>
  const players = content.campaign.characterTemplates.filter(actor => actor.role === 'player')
  const rows = [
    ...projection.recentActions.map(action => ({ sequence: action.eventSequence, kind: 'action' as const, action })),
    ...projection.recentNarrations.map(narration => ({ sequence: narration.eventSequence, kind: 'narration' as const, narration })),
    ...projection.humanResponses.filter(response => response.kind !== 'decline').map(response => ({ sequence: response.eventSequence, kind: 'response' as const, response })),
  ].sort((left, right) => left.sequence - right.sequence)

  return <section className="sf-ttrpg" data-testid="ttrpg-play-table">
    <header className="sf-ttrpg-banner">
      <div className="sf-ttrpg-beacon" aria-hidden="true" /><span className="sf-ttrpg-eyebrow">STORYFORGE · AI GAME MASTER</span>
      <h2>{tableTitle}</h2><p>{content.campaign.pitch}</p>
      <div className="sf-ttrpg-meta"><span><Dices size={14} />{content.rulePack.title}</span><span><Users size={14} />{players.length} 位角色</span><span><Compass size={14} />约 {content.campaign.estimatedMinutes} 分钟</span></div>
      {props.session.title !== tableTitle && <small className="sf-ttrpg-save-label">当前存档：{props.session.title}</small>}
    </header>
    {!product.sessionZero.completed ? <div className="sf-ttrpg-setup">
      <span className="sf-ttrpg-eyebrow">你的故事，从一个角色开始</span><h3>选择你要扮演的人</h3>
      <div className="sf-ttrpg-character-grid">{players.map((actor, index) => <button key={actor.characterKey} disabled={busy} className={`sf-ttrpg-character ${heroKey === actor.characterKey ? 'selected' : ''}`} onClick={() => setHeroKey(actor.characterKey)}>
        <span className="sf-ttrpg-character-number">0{index + 1}</span><strong>{actor.name}</strong><p>{actor.description}</p><span>{heroKey === actor.characterKey ? <><Check size={14} /> 你的角色</> : '选择角色'}</span>
      </button>)}</div>
      <div className="sf-ttrpg-modes"><button disabled={busy} className={mode === 'solo' ? 'selected' : ''} onClick={() => setMode('solo')}><Sparkles size={17} /><strong>单人 + AI 同伴</strong><span>你做决定，AI 扮演其余队友与 KP。</span></button>
        <button disabled={busy} className={mode === 'local' ? 'selected' : ''} onClick={() => setMode('local')}><Users size={17} /><strong>本地多人轮流玩</strong><span>在同一设备交接角色，AI 担任 KP。</span></button></div>
      <div className="sf-ttrpg-agreement"><h4>开团约定</h4><p>{content.campaign.sessionZero.premise}</p>
        {content.campaign.contentWarnings.length > 0 && <p>内容提示：{content.campaign.contentWarnings.join('、')}</p>}
        {content.campaign.sessionZero.lines.length > 0 && <p>不出现：{content.campaign.sessionZero.lines.join('、')}</p>}
        {content.campaign.sessionZero.veils.length > 0 && <p>淡出处理：{content.campaign.sessionZero.veils.join('、')}</p>}
        <ul>{content.campaign.sessionZero.consentChecklist.map(item => <li key={item}>{item}</li>)}</ul>
        <label><input type="checkbox" disabled={busy} checked={accepted} onChange={event => setAccepted(event.target.checked)} />我接受这些约定，并授权 AI KP 主持、AI 同伴自主行动，并启用本人私密指引。我的角色选择仍由我决定；随时可以暂停。</label>
      </div>
      <button className="sf-ttrpg-primary" disabled={!accepted || busy} onClick={() => void begin()}><Play size={17} />{busy ? phase : '与 AI KP 开始冒险'}</button>
    </div> : <>
      <div className="sf-ttrpg-toolbar"><div><span className="sf-ttrpg-dot" />{product.safety.status === 'paused' ? '已暂停' : ending ? '本次冒险已落幕' : scene?.title ?? '等待开场'}</div>
        <div>{!privacyGate && <button onClick={() => setPrivacyLocked(true)}><LockKeyhole size={15} />遮住桌面</button>}
          <button onClick={() => void perform(async () => props.onCheckpoint(`${scene?.title ?? '冒险'} · 手动存档`))} disabled={busy || privacyGate}><Save size={15} />存档</button>
          <button onClick={() => void pause()}><Pause size={15} />{product.safety.status === 'paused' ? '恢复' : '暂停'}</button></div></div>
      {privacyGate ? <div className="sf-ttrpg-privacy-gate" role="region" aria-label="交接桌面"><LockKeyhole size={30} />
        <span className="sf-ttrpg-eyebrow">桌面已遮住</span><h3>{recipient ? `请交给 ${recipient.name}` : '等待玩家入座'}</h3>
        <p>确认后才显示这位角色的记录与手记。个人秘密保持收起。</p>
        {recipient && <button className="sf-ttrpg-primary" disabled={busy} onClick={() => handoff(recipient.actorKey)}>我是 {recipient.name}，继续冒险</button>}
      </div> : <div className="sf-ttrpg-layout"><aside className="sf-ttrpg-party">
        <span className="sf-ttrpg-eyebrow">同行者</span>{projection.actors.map(actor => <div key={actor.actorKey} className={`sf-ttrpg-seat ${actor.actorKey === active?.actorKey ? 'active' : ''}`}>
          <span className="sf-ttrpg-avatar">{portrait(actor.actorKey) ? <img src={mediaUrls[portrait(actor.actorKey)!.slotKey]} alt={portrait(actor.actorKey)!.altText} /> : actor.name.slice(0, 1)}</span><div><strong>{actor.name}</strong><small>{actor.actorKey === heroKey ? '你' : actor.role === 'npc' ? '场景人物' : actor.controller === 'ai' ? 'AI 同伴' : '真人玩家'}</small>
            {actor.resources.map(resource => <span className="sf-ttrpg-resource" key={resource.key}>{resource.name} <b>{resource.current}/{resource.maximum}</b></span>)}</div>
        </div>)}
        <div className="sf-ttrpg-goals"><span className="sf-ttrpg-eyebrow">共同目标</span>{projection.quests.map(quest => <div key={quest.questKey}><strong>{quest.status === 'completed' ? '✓ ' : '○ '}{quest.title}</strong><p>{quest.objective}</p></div>)}</div>
        {hero?.privateProfile && <div className="sf-ttrpg-private"><button onClick={() => setPrivateOpen(open => !open)}><LockKeyhole size={15} />我的秘密 <span>{privateOpen ? '收起' : '查看'}</span></button>
          {privateOpen && <div><strong>只有你知道</strong><p>{hero.privateProfile.secret}</p><strong>你的个人目标</strong><p>{hero.privateProfile.privateGoal}</p>
            {(product.privateGuidance ?? []).filter(item => item.actorKey === heroKey).map(item => <article key={item.eventSequence} className="sf-ttrpg-whisper"><strong>你问：{item.question}</strong><p>{item.advice}</p></article>)}
            <label className="sf-ttrpg-input-label" htmlFor={`private-${sessionId}`}>悄悄询问 KP</label><textarea id={`private-${sessionId}`} value={privateQuestion} maxLength={1000} onChange={event => setPrivateQuestion(event.target.value)} placeholder="结合我的目标，现在有什么思路？" />
            <button className="sf-ttrpg-primary" disabled={busy || !privateQuestion.trim()} onClick={() => void perform(async signal => {
              setPhase('KP 正在为你准备私密指引')
              const { generateTtrpgPrivateGuidanceV1, adoptTtrpgPrivateGuidanceV1 } = await import('../../lib/ttrpg/private-guidance')
              const generated = await generateTtrpgPrivateGuidanceV1({ scope: props.scope, productRuntimeSessionId: sessionId,
                actorKey: heroKey, objective: privateQuestion.trim(), aiConfig: config, signal })
              await adoptTtrpgPrivateGuidanceV1({ scope: props.scope, runId: generated.candidate.runId, actorKey: heroKey })
              setPrivateQuestion('')
            })}>只给我的指引</button>
          </div>}</div>}
      </aside><main className="sf-ttrpg-story">
        {sceneArt && <figure className="sf-ttrpg-scene-art"><img src={mediaUrls[sceneArt.slotKey]} alt={sceneArt.altText} /></figure>}
        <article className="sf-ttrpg-scene"><span className="sf-ttrpg-eyebrow">当前场景</span><h3>{scene?.title ?? '序幕'}</h3><p>{scene?.description ?? content.campaign.sessionZero.premise}</p></article>
        <div className="sf-ttrpg-transcript" role="log" aria-label="跑团记录">
          {rows.map(row => row.kind === 'action' ? <article key={row.sequence} className={`sf-ttrpg-action ${row.action.actorKey === heroKey ? 'own' : ''}`}>
            <div><strong>{projection.actors.find(actor => actor.actorKey === row.action.actorKey)?.name ?? '角色'}</strong><span>{row.action.actionName}</span></div>
            {row.action.receipt?.declaredIntent && <p>{row.action.receipt.declaredIntent.rawInput}</p>}
            <details><summary><Dices size={14} />{outcomeLabels[row.action.outcome] ?? row.action.outcome}{row.action.total != null && <span>{row.action.total}{row.action.difficulty == null ? '' : ` / ${row.action.difficulty}`}</span>}</summary>
              <p>{row.action.receipt?.mechanicalSummary}</p>{row.action.dice.length > 0 && <p>骰点：{row.action.dice.join(' + ')}；修正：{row.action.modifier}</p>}</details>
          </article> : row.kind === 'response' ? <article key={row.sequence} className="sf-ttrpg-action"><strong>{projection.actors.find(actor => actor.actorKey === row.response.actorKey)?.name ?? '角色'}{row.response.audience === 'gm-only' ? ' · 悄悄说' : ''}</strong><p>{row.response.text}</p></article> : <article key={row.sequence} className="sf-ttrpg-kp"><span className="sf-ttrpg-kp-label"><Sparkles size={14} />AI KP</span><p>{row.narration.text}</p></article>)}
          {ending && <article className="sf-ttrpg-ending"><Flag size={26} /><span className="sf-ttrpg-eyebrow">冒险终章</span><h3>{ending.title}</h3><p>{ending.epilogue}</p><small>你的选择与同行者的行动，留下了这一版故事。</small></article>}
          <div ref={transcriptEnd} />
        </div>
        {!ending && product.safety.status === 'active' && <div className="sf-ttrpg-composer">
          {(navigation.nextScenes.length > 0 || navigation.endings.length > 0) && !pendingResponse && !pendingChoice && <div className="sf-ttrpg-routes"><span>接下来，由你决定</span>
            {navigation.nextScenes.map(next => <button disabled={busy} key={next.sceneKey} onClick={() => void move(next.sceneKey)}>{next.title}<ArrowRight size={14} /></button>)}
            {navigation.endings.map(next => <button disabled={busy} key={next.endingKey} onClick={() => void perform(async () => {
              await props.onCheckpoint('终章之前'); await completeTtrpgCampaignEnding({ ...await envelope('ending'), endingKey: next.endingKey, completedBy: heroKey })
            })}>{next.title}<Flag size={14} /></button>)}</div>}
          {handoffActor ? <div className="sf-ttrpg-handoff"><Users size={20} /><p>请把设备交给 {handoffActor.name}，故事正在等待这位玩家的回应。</p><button className="sf-ttrpg-primary" disabled={busy} onClick={() => handoff(handoffActor.actorKey)}>我是 {handoffActor.name}</button></div> : pendingChoice ? <div className="sf-ttrpg-reaction"><h4>这份代价，由你选择</h4><p>{pendingChoice.reason}</p>{pendingChoice.options.map(option => <button disabled={busy} key={option.effectKey} onClick={() => void perform(async signal => {
            await resolveTtrpgEffectChoiceV2({ ...await envelope('consequence'), choiceKey: pendingChoice.choiceKey, selectedEffectKey: option.effectKey, requestedBy: { role: 'player', actorKey: heroKey } })
            await props.onChanged(); await coordinate(signal)
          })}>{option.detail}</button>)}</div> : pendingResponse ? <div className="sf-ttrpg-reaction"><h4>这件事发生在你眼前，你想回应吗？</h4>
            <textarea aria-label="角色回应" value={responseText} maxLength={2000} disabled={busy} onChange={event => setResponseText(event.target.value)} placeholder="说一句话，或描述一个不涉及规则判定的反应。" />
            {(['speak', 'decline'] as const).map(kind => <button disabled={busy || (kind === 'speak' && !responseText.trim())} key={kind} onClick={() => void perform(async signal => {
              await recordTtrpgHumanResponseV2({ ...await envelope('response'), ...pendingResponse, kind, text: responseText.trim(), audience: 'party', viewerKey: seats.find(seat => seat.actorKey === heroKey)!.viewerKey })
              setResponseText(''); await props.onChanged(); await coordinate(signal)
            })}>{kind === 'speak' ? '回应同伴' : '暂时观察，让故事继续'}</button>)}</div> :
          myTurn ? <><label className="sf-ttrpg-input-label" htmlFor={`intent-${sessionId}`}>现在是你的回合，{hero?.name}。</label>
            <textarea id={`intent-${sessionId}`} value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} disabled={busy}
              placeholder="描述你想做的事。比如：我蹲下来，仔细检查石阶上的水痕……" onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submit() } }} />
            {actionAdvice?.actorKey === heroKey && actionAdvice.draft === draft && <aside className="sf-ttrpg-ruling" aria-label="KP 的判定建议"><strong><LockKeyhole size={14} /> KP 给你的建议</strong><p>{actionAdvice.advice}</p>
              {actions.some(item => item.actionKey === actionAdvice.suggestedActionKey) && <button disabled={busy} onClick={() => { setActionKey(actionAdvice.suggestedActionKey!); setTargetKey('') }}>采用这个行动方式</button>}
              <small>你点击“采取行动”后才会结算。这次询问不会消耗角色的行动。</small></aside>}
            <div className="sf-ttrpg-compose-actions"><select aria-label="行动方式" value={action?.actionKey ?? ''} onChange={event => { setActionKey(event.target.value); setTargetKey('') }} disabled={busy}>
              {actions.map(action => <option key={action.actionKey} value={action.actionKey}>{action.name}</option>)}</select>
              {action && ['single-ally', 'single-enemy'].includes(action.target) && <select aria-label="行动目标" value={targets.find(actor => actor.actorKey === targetKey)?.actorKey ?? targets[0]?.actorKey ?? ''} onChange={event => setTargetKey(event.target.value)} disabled={busy}>
                {targets.map(actor => <option key={actor.actorKey} value={actor.actorKey}>{actor.name}</option>)}</select>}
              <button disabled={busy || !draft.trim()} onClick={() => void askForRuling()}><Sparkles size={15} />先询问 KP</button>
              <button className="sf-ttrpg-primary" disabled={busy || !draft.trim() || !action} onClick={() => void submit()}><Send size={15} />采取行动</button></div>
            {action && <p className="sf-ttrpg-action-summary">{action.description}{action.costAmount > 0 && ` · 消耗 ${action.costAmount} ${action.costResourceName ?? '资源'}`}{action.defaultDifficulty != null && ` · 默认难度 ${action.defaultDifficulty}`}</p>}
          </> : active?.controller === 'human' ? <div className="sf-ttrpg-handoff"><Users size={20} /><p>请把设备交给 {active.name}。个人秘密在交接后保持收起。</p>
            <button className="sf-ttrpg-primary" disabled={busy} onClick={() => handoff(active.actorKey)}>我是 {active.name}</button></div>
            : <button className="sf-ttrpg-primary" disabled={busy} onClick={() => void perform(signal => coordinate(signal, true))}><Play size={15} />{busy ? phase : '继续主持'}</button>}
        </div>}
      </main><aside className="sf-ttrpg-notebook"><span className="sf-ttrpg-eyebrow"><BookOpen size={14} /> 调查手记</span>
        {projection.visibleClues.length === 0 ? <p className="sf-ttrpg-empty">第一条线索，正在等你发现。</p> : projection.visibleClues.map(clue => <article key={clue.clueKey}>
          <small>{clue.visibility === 'private' ? '只对你可见' : '队伍已知'}</small><h4>{clue.title}</h4><p>{clue.description}</p></article>)}
        {projection.visibleHandouts.map(handout => <details key={handout.handoutKey}><summary>{handout.title}</summary><p>{handout.body}</p>
          {projection.media?.slots.filter(slot => slot.kind === 'handout' && slot.targetRef === handout.handoutKey && mediaUrls[slot.slotKey]).map(slot => <img className="sf-ttrpg-handout-art" key={slot.slotKey} src={mediaUrls[slot.slotKey]} alt={slot.altText} loading="lazy" />)}</details>)}
        <details className="sf-ttrpg-rules"><summary>规则速查</summary>{projection.ruleReference.map(rule => <div key={rule.key}><strong>{rule.title}</strong><p>{rule.body}</p></div>)}</details>
      </aside></div>}
    </>}
    {busy && <div className="sf-ttrpg-progress" role="status"><span className="sf-ttrpg-spinner" />{phase || '正在保存'}<button onClick={() => controller.current?.abort()} aria-label="停止主持"><X size={16} /></button></div>}
    {notice && !privacyGate && <p className="sf-ttrpg-notice" role="status">{notice}</p>}
    {error && !privacyGate && <div className="sf-ttrpg-error" role="alert"><strong>主持暂时停在这里</strong><p>{error}</p><span>已完成的行动会保留。处理后点击继续主持即可从当前进度恢复。</span><a href={`${import.meta.env.BASE_URL}settings?returnTo=${encodeURIComponent(`/play/session/${sessionId}`)}`}>API 设置</a>{product.sessionZero.completed && product.safety.status === 'active' && <button disabled={busy} onClick={() => void perform(signal => coordinate(signal))}>从当前进度继续主持</button>}</div>}
  </section>
}
