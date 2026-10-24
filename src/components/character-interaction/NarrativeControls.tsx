import {useState} from 'react'
import type { AIProvider, CharacterInteractionRuntimeState } from '../../lib/types'
import type { ChatNarrativeTurnResumeV1, ChatPlayerTriggerV1 } from '../../lib/character-interaction/narrative-turn'
import {createChatScheduledDirectionV1, type ChatSchedulingModeV1} from '../../lib/character-interaction/narrative-scheduling'
import {resolveChatTurnAudienceV1} from '../../lib/character-interaction/narrative-audience'
import {chatNewTurnAllowanceV1, chatPreparedTurnAllowanceV1, chatSituationAndActionAllowanceV1} from '../../lib/character-interaction/narrative-budget'
import {chatSituationConstructionRequestV1} from '../../lib/character-interaction/narrative-progression'

export default function NarrativeControls(props: {
  interaction: CharacterInteractionRuntimeState
  runtimeSequence: number
  actionProvider?: AIProvider
  participantKey: string
  audienceKeys?: string[] | null
  onParticipantChange: (key: string) => void
  actionLimit: number
  onActionLimitChange: (limit: number) => void
  schedulingMode: ChatSchedulingModeV1
  onSchedulingModeChange: (mode: ChatSchedulingModeV1) => void
  disabled: boolean
  actionDisabled?: boolean
  onAdvance: (kind: ChatPlayerTriggerV1) => void
  turnResume: ChatNarrativeTurnResumeV1 | null
  onResume: () => void
  onCompare: (kind: ChatPlayerTriggerV1) => void
  comparisonDisabled?: boolean
  situationDisabled?: boolean
  onCreateSituation: (seed: string) => void
}) {
  const [seed, setSeed] = useState('')
  const {interaction, participantKey} = props
  const story = interaction.chatNarrative, scene = interaction.activeScene
  if (!story || !scene) return null
  const active = interaction.profiles.filter(p => scene.activeParticipantKeys.includes(p.participantKey) && (!props.audienceKeys || props.audienceKeys.includes(p.participantKey)))
  const trigger = story.triggers.slice(-1)[0]
  const canOpen = !interaction.messages.some(m => m.eventSequence > scene.startedAtSequence)
    && !story.triggers.some(t => t.kind === 'scene-start' && t.sourceEventSequence === scene.startedAtSequence)
  const automatic = props.schedulingMode !== 'manual'
  const disabled = props.disabled || !automatic && !participantKey
  const compareKind = canOpen && story.permissions.triggers.includes('scene-start') ? 'scene-start' : 'continue'
  const resumeActor = props.turnResume?.actorKey || participantKey
  const needsSituation = !!chatSituationConstructionRequestV1(interaction, resumeActor)
  function preview(kind: ChatPlayerTriggerV1, compare = false): {allowance: number; blockedReason?: string} {
    try {
      const source = kind === 'scene-start' ? scene!.startedAtSequence : props.runtimeSequence
      const conversation = resolveChatTurnAudienceV1(interaction, kind, source, props.audienceKeys)
      const direction = automatic ? createChatScheduledDirectionV1(interaction, {mode: props.schedulingMode as Exclude<ChatSchedulingModeV1, 'manual'>,
        kind, sourceSequence: source, actionLimit: props.actionLimit, audienceParticipantKeys: conversation.audienceParticipantKeys})
        : {actorKey: participantKey, actionLimit: props.actionLimit}
      return {allowance: chatNewTurnAllowanceV1(interaction, {sequence: props.runtimeSequence + 1, kind, sourceEventSequence: source,
        seed: null, direction: {...direction, ...conversation}}, direction.actorKey, compare)}
    } catch (error) {
      return {allowance: Infinity, blockedReason: error instanceof Error ? error.message : '当前无法开始这一轮，请刷新后再试。'}
    }
  }
  const next = preview(compareKind), comparison = preview(compareKind, true)
  const expands = comparison.allowance === 4
  const continuation = compareKind === 'continue' ? next : preview('continue')
  const returning = !canOpen && story.permissions.triggers.includes('return') ? preview('return') : null
  const resumeAllowance = props.turnResume ? chatPreparedTurnAllowanceV1(interaction, resumeActor) : 0
  const situationAllowance = chatSituationAndActionAllowanceV1()
  const insufficient = (allowance: number) => interaction.remainingDirectorBudget < allowance
  const allowanceHint = (allowance: number) => `当前剩余 ${interaction.remainingDirectorBudget} 次场景调用额度，开始这一步至少需要 ${allowance} 次。`
  return <section data-testid="chat-narrative-controls" className="space-y-2 rounded border border-border bg-bg-surface p-3">
    <div><h2 className="text-sm font-semibold">{story.situation.title}</h2><p className="mt-1 text-xs text-text-muted">你扮演 {story.persona.name} · {story.situation.location} · {story.situation.timeLabel}</p></div>
    {props.actionProvider === 'codex' && <details className="text-xs text-text-muted"><summary className="cursor-pointer">用量说明</summary><p>场景额度限制调用次数。使用 Codex 时，单次生成的 token 用量无法提前锁定，以实际返回的用量为准。</p></details>}
    <details className="text-xs"><summary className="cursor-pointer text-text-muted">当前已知的局面</summary><ul className="mt-2 list-disc space-y-1 pl-4">{story.situation.facts.filter(f => f.audienceKeys.includes(interaction.playerKey)).map(f => <li key={f.factKey}>{f.text}</li>)}</ul></details>
    {active.length > 1 && !automatic && <label className="block text-xs">本轮行动角色<select aria-label="本轮行动角色" value={participantKey} disabled={props.disabled} onChange={event => props.onParticipantChange(event.target.value)} className="ml-2 max-w-full rounded border border-border bg-bg-base p-2"><option value="">请选择</option>{active.map(p => <option key={p.participantKey} value={p.participantKey}>{p.name}</option>)}</select></label>}
    <p role="status" className="text-xs text-text-muted">{trigger?.controlHandoff?.version === 3 ? '角色暂时保持原来的安排。你可以继续交谈，或提出新的情境。' : trigger?.status === 'waiting-player' ? '角色正在等你的回应。你可以接受、拒绝、换个办法，或请其自行继续。' : '继续会开始下一次行动；需要你决定时会停下。'}</p>
    {props.turnResume && <div data-testid="chat-turn-resume" className="space-y-2 rounded border border-border p-3"><p className="text-xs text-text-muted">{props.turnResume.pendingSituation ? '角色这一步已保存，还需补齐已审查方向所需的情境；这不会再增加角色行动。' : <>这一轮还有最多 {props.turnResume.remainingActions} 次行动额度。</>}{props.turnResume.schedulingMode ? `补齐沿用本轮原有的${props.turnResume.schedulingMode === 'natural' ? '按局面接续' : '依次接续'}安排；下一位是 ${interaction.profiles.find(profile => profile.participantKey === props.turnResume!.actorKey)?.name ?? '暂无可行动角色'}。` : <>补齐会沿用{props.turnResume.actorKey ? ` ${interaction.profiles.find(profile => profile.participantKey === props.turnResume!.actorKey)?.name ?? props.turnResume.actorKey} 的` : '所选角色的'}当前轮次。</>}保留已发生的内容；遇到需要你回应时仍会停下。</p><button disabled={props.disabled || props.actionDisabled || !resumeActor || !!props.turnResume.blockedReason || insufficient(resumeAllowance) || needsSituation && props.situationDisabled} onClick={props.onResume} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">{props.turnResume.pendingSituation ? '补齐本轮情境' : '补齐未完成本轮'}</button>{props.turnResume.blockedReason ? <p className="text-xs text-text-muted">{props.turnResume.blockedReason}</p> : insufficient(resumeAllowance) && <p className="text-xs text-text-muted">{allowanceHint(resumeAllowance)}</p>}</div>}
    <div className="flex flex-wrap gap-2">{canOpen && story.permissions.triggers.includes('scene-start') && <button disabled={disabled || props.actionDisabled || insufficient(next.allowance)} onClick={() => props.onAdvance('scene-start')} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40">让角色开场</button>}{story.permissions.triggers.includes('continue') && <button disabled={disabled || props.actionDisabled || insufficient(continuation.allowance)} onClick={() => props.onAdvance('continue')} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">让角色继续</button>}{!canOpen && story.permissions.triggers.includes('return') && <button disabled={disabled || props.actionDisabled || !returning || insufficient(returning.allowance)} onClick={() => props.onAdvance('return')} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">从上次局面继续</button>}</div>
    {!disabled && (next.blockedReason ? <p className="text-xs text-text-muted">{next.blockedReason}</p> : insufficient(next.allowance) && <p className="text-xs text-text-muted">{allowanceHint(next.allowance)}</p>)}
    <details className="chat-narrative-tools text-xs" data-testid="chat-narrative-tools"><summary className="cursor-pointer py-2 text-text-muted">剧情设置与新情境</summary><div className="mt-2 space-y-3">
    <label className="block text-xs">角色接续方式<select aria-label="角色接续方式" value={props.schedulingMode} disabled={props.disabled} onChange={event => props.onSchedulingModeChange(event.target.value as ChatSchedulingModeV1)} className="ml-2 rounded border border-border bg-bg-base p-2"><option value="manual">指定角色</option><option value="natural">按局面接续</option><option value="round-robin">依次接续</option></select><span className="mt-1 block text-text-muted">{automatic ? props.schedulingMode === 'natural' ? '结合可见对话、被提及的角色和各自目标选择下一位；没有可推进内容时可以停下。' : '在本轮能听到对话的在场角色间依次行动，跳过已暂停或结束的目标。' : '由你选择本轮行动的角色。'} 改变方式不会立即生成，也不会改动已经开始的轮次。</span></label>
    <label className="block text-xs">演绎节奏<select aria-label="演绎节奏" value={props.actionLimit} disabled={props.disabled} onChange={event => props.onActionLimitChange(Number(event.target.value))} className="ml-2 rounded border border-border bg-bg-base p-2">{Array.from({length: story.permissions.maxActionsPerTrigger}, (_, index) => index + 1).map(limit => <option key={limit} value={limit}>{limit === 1 ? '一步一停' : `最多连续 ${limit} 步`}</option>)}</select><span className="mt-1 block text-text-muted">只影响下一轮开场、回应或继续。连续演绎遇到需要你决定、角色暂停或额度上限就停；你可以取消或发消息打断。补齐未完成本轮仍沿用本轮原有的角色安排和剩余额度。{story.permissions.allowActorSituationExpansion && '每步结束后会补齐已审查方向所需的情境，并计入本轮用量；不会额外替角色行动。'}</span></label>
    {story.permissions.triggers.includes(compareKind) && <div className="space-y-2"><button disabled={disabled || props.comparisonDisabled || insufficient(comparison.allowance)} onClick={() => props.onCompare(compareKind)} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-40">{expands ? '发展局面并比较行动' : '比较两种行动'}</button><p className="text-xs text-text-muted">{expands ? '先承接角色已有方向，保存共同背景，再生成两条行动供你选择。取消候选会保留已经发展的背景。' : '生成并审查两条行动，选择前不会把它们写进故事。'}</p></div>}
    {story.permissions.triggers.includes('player-seed') && <details className="text-xs"><summary className="cursor-pointer text-text-muted">提出新的情境或矛盾</summary><div className="mt-2 space-y-2"><p className="text-text-muted">写下你希望引入的局面。系统会先结合已有故事形成背景与开放方向，通过检查后，再由本轮选定或调度的角色演绎。这里的内容不会作为你的角色台词发送。</p><textarea aria-label="新的情境或矛盾" value={seed} maxLength={4000} disabled={props.disabled} onChange={event => setSeed(event.target.value)} placeholder="例如：门外突然传来敲门声，来者的身份暂时不明。" rows={3} className="w-full rounded border border-border bg-bg-base p-2" /><button disabled={disabled || props.situationDisabled || insufficient(situationAllowance) || !seed.trim()} onClick={() => props.onCreateSituation(seed.trim())} className="rounded border border-border px-3 py-2 disabled:opacity-40">构建情境并演绎</button>{insufficient(situationAllowance) && <p className="text-text-muted">{allowanceHint(situationAllowance)}</p>}</div></details>}
    </div></details>
  </section>
}
