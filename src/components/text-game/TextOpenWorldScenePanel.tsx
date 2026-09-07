import { useEffect, useMemo, useState } from 'react'
import { MessageCircle, MousePointerClick, ScrollText, Send, TerminalSquare } from 'lucide-react'
import type {
  TextOpenWorldActionAvailabilityV1,
  TextOpenWorldCommandSourceV1,
  TextOpenWorldFeedbackReceiptV1,
} from '../../lib/types'
import type {
  TextOpenWorldProjectedSceneV1,
  TextOpenWorldSceneProjectionV1,
} from '../../lib/open-world/scene-projection'

interface TextOpenWorldScenePanelProps {
  sessionKey: string | number
  eventSequence: number
  projection: TextOpenWorldSceneProjectionV1
  availableActions: TextOpenWorldActionAvailabilityV1[]
  feedback: TextOpenWorldFeedbackReceiptV1 | null
  busy: boolean
  combatActive: boolean
  fallback: {
    regionTitle: string
    locationTitle: string
    description: string
    playerName: string
  }
  onExecute(
    actionKey: string,
    targetKey: string | null,
    source: TextOpenWorldCommandSourceV1,
  ): void
}

type InteractionNotice = {
  tone: 'mapped' | 'boundary'
  message: string
} | null

const ATTITUDE_LABELS = { bad: '态度较差', neutral: '态度一般', good: '态度友好' } as const
const SPECIALIZED_ACTION_CATEGORIES = new Set([
  'respawn', 'equip', 'unequip', 'travel', 'fast-travel', 'buy', 'sell', 'craft',
])

function normalizeUtterance(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('zh-CN')
}

function targetForAction(action: TextOpenWorldActionAvailabilityV1): {
  targetKey: string | null
  error: string | null
} {
  if (action.targetScope === 'none') return { targetKey: null, error: null }
  if (action.validTargetKeys.length === 1) return { targetKey: action.validTargetKeys[0]!, error: null }
  if (action.targetScope === 'combatant' && action.validTargetKeys.length > 1) {
    // G4-09 owns the full enemy target picker. Until then the combat shortcut
    // deterministically chooses the first living target from the authoritative
    // projection so a legal multi-enemy encounter cannot deadlock.
    return { targetKey: action.validTargetKeys[0]!, error: null }
  }
  if (action.validTargetKeys.length > 1) {
    return {
      targetKey: null,
      error: `“${action.action.label}”当前有多个合法目标，请使用对应的正式功能页选择目标。`,
    }
  }
  return { targetKey: null, error: `“${action.action.label}”当前没有合法目标，未执行任何行动。` }
}

function SystemReceipt({ feedback }: { feedback: TextOpenWorldFeedbackReceiptV1 | null }) {
  if (!feedback) return null
  return <section
    className={`open-world-scene-receipt ${feedback.presentation.mayNarrateSuccess ? 'is-success' : 'is-warning'}`}
    data-testid="text-open-world-feedback"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    aria-label="系统结算回执"
  >
    <header><TerminalSquare aria-hidden="true" /><strong>系统结算回执</strong></header>
    <h3>{feedback.presentation.headline}</h3>
    {feedback.presentation.details.map((detail, index) => <p key={index}>{detail}</p>)}
    <small>
      正式证据 {feedback.evidenceEventSequences.map(sequence => `#${sequence}`).join('、') || '预检'}
      {' · '}{feedback.status}
    </small>
  </section>
}

function PublishedScene({ scene }: { scene: TextOpenWorldProjectedSceneV1 }) {
  return <article className="open-world-scene-narrative" data-testid="text-open-world-published-scene">
    <header>
      <span><ScrollText aria-hidden="true" />冻结叙事</span>
      <small>{scene.sourceKind}</small>
    </header>
    <h1>{scene.title}</h1>
    {scene.compatibilityNotice && <aside className="open-world-scene-compatibility" role="note">
      {scene.compatibilityNotice}
    </aside>}
    <p className="open-world-scene-opening">{scene.authoredOpeningText}</p>
    <p>{scene.bodyText}</p>
    {scene.sourceKind === 'actor-dialogue' && scene.actor && <section className="open-world-scene-dialogue" data-testid="text-open-world-npc-dialogue">
      <header>
        <span><MessageCircle aria-hidden="true" />NPC 对话 · {scene.actor.name}</span>
        <small>{ATTITUDE_LABELS[scene.actor.attitude]} · {scene.actor.greetingTone}</small>
      </header>
      <blockquote>{scene.openingText}</blockquote>
    </section>}
  </article>
}

export default function TextOpenWorldScenePanel({
  sessionKey,
  eventSequence,
  projection,
  availableActions,
  feedback,
  busy,
  combatActive,
  fallback,
  onExecute,
}: TextOpenWorldScenePanelProps) {
  const [selectedSceneKey, setSelectedSceneKey] = useState<string | null>(projection.recommendedSceneKey)
  const [naturalInput, setNaturalInput] = useState('')
  const [notice, setNotice] = useState<InteractionNotice>(null)

  useEffect(() => {
    setSelectedSceneKey(projection.recommendedSceneKey)
    setNaturalInput('')
    setNotice(null)
  }, [eventSequence, projection.recommendedSceneKey, sessionKey])

  const actionByKey = useMemo(
    () => new Map(availableActions.map(action => [action.action.key, action])),
    [availableActions],
  )
  const scenes = projection.status === 'ready' ? projection.scenes : []
  const scene = scenes.find(item => item.key === selectedSceneKey)
    ?? scenes.find(item => item.key === projection.recommendedSceneKey)
    ?? scenes[0]
    ?? null
  const combatActionCategories = new Set([
    'continue-combat', 'combat-basic-attack', 'combat-skill', 'combat-item', 'escape',
  ])
  const isSceneSurfaceAction = (action: TextOpenWorldActionAvailabilityV1) => (
    action.targetScope !== 'quest' && !SPECIALIZED_ACTION_CATEGORIES.has(action.action.category)
  )
  const compatibilityActions = availableActions.filter(isSceneSurfaceAction)
  const ambientActions = projection.status === 'ready'
    ? projection.ambientActionKeys
      .flatMap(actionKey => actionByKey.get(actionKey) ?? [])
      .filter(isSceneSurfaceAction)
    : []
  const selectedSceneActions = scene
    ? scene.actionKeys.flatMap(actionKey => actionByKey.get(actionKey) ?? [])
    : []
  const sceneAndAmbientActions = [...selectedSceneActions, ...ambientActions]
    .filter((action, index, all) => all.findIndex(candidate => candidate.action.key === action.action.key) === index)
  const sceneActions = combatActive
    ? availableActions.filter(action => combatActionCategories.has(action.action.category))
    : projection.status === 'ready'
      ? sceneAndAmbientActions
      : compatibilityActions
  const naturalCandidates = scene?.naturalLanguageExamples.flatMap(entry => (
    entry.exampleUtterances.map(example => ({ actionKey: entry.actionKey, example }))
  )) ?? []
  const naturalInputEnabled = projection.status === 'ready'
    && !combatActive
    && naturalCandidates.length > 0

  const execute = (
    action: TextOpenWorldActionAvailabilityV1 | undefined,
    source: TextOpenWorldCommandSourceV1,
  ) => {
    if (!action?.available) {
      setNotice({ tone: 'boundary', message: '该行动已经不在当前合法投影中，未写入任何状态。' })
      return
    }
    const target = targetForAction(action)
    if (target.error) {
      setNotice({ tone: 'boundary', message: target.error })
      return
    }
    setNotice({
      tone: 'mapped',
      message: source === 'mapped-intent'
        ? `已把这句话映射为“${action.action.label}”；实际结果仍由正式规则结算。`
        : source === 'fixed-choice'
          ? `已选择“${action.action.label}”；实际结果仍由正式规则结算。`
          : `已提交系统行动“${action.action.label}”。`,
    })
    onExecute(action.action.key, target.targetKey, source)
  }

  const submitNaturalInput = () => {
    const normalized = normalizeUtterance(naturalInput)
    if (!normalized || !naturalInputEnabled) return
    const matches = naturalCandidates.filter(candidate => normalizeUtterance(candidate.example) === normalized)
    const actionKeys = [...new Set(matches.map(match => match.actionKey))]
    if (actionKeys.length !== 1) {
      const alternatives = sceneActions.slice(0, 3).map(action => `“${action.action.label}”`).join('、')
      setNotice({
        tone: 'boundary',
        message: `这句话暂时不能映射为当前场景的唯一行动，因此没有改变世界状态。${alternatives ? `你可以改用 ${alternatives}。` : ''}`,
      })
      return
    }
    execute(actionByKey.get(actionKeys[0]!), 'mapped-intent')
    setNaturalInput('')
  }

  return <div className="open-world-scene-stack">
    {projection.status === 'ready' && scenes.length > 1 && <nav
      className="open-world-scene-selector"
      aria-label="当前可演绎场景"
    >
      {scenes.map(item => <button
        key={item.key}
        type="button"
        aria-current={item.key === scene?.key ? 'page' : undefined}
        onClick={() => {
          setSelectedSceneKey(item.key)
          setNaturalInput('')
          setNotice(null)
        }}
      >
        {item.actor ? `${item.actor.name} · ${item.title}` : item.title}
      </button>)}
    </nav>}

    {scene ? <PublishedScene scene={scene} /> : <article className="open-world-game-scene-card">
      <small>{fallback.regionTitle} · 兼容场景</small>
      <h1>{fallback.locationTitle}</h1>
      <p>{fallback.description}</p>
      <span>{fallback.playerName} · 事件 #{eventSequence}</span>
      {projection.status === 'unsupported' && <aside className="open-world-scene-compatibility" role="note">
        此存档绑定的是旧版运行包，不含冻结的 P9 场景正文和三类输入绑定；系统行动仍可继续，叙事与自然输入不会被伪造。
      </aside>}
    </article>}

    <SystemReceipt feedback={feedback} />

    {scene?.fixedChoices.length && !combatActive ? <section className="open-world-scene-input-card" data-testid="text-open-world-fixed-choices">
      <header><MousePointerClick aria-hidden="true" /><strong>固定选项</strong><small>选择后进入同一 Action 规则</small></header>
      <div className="open-world-scene-choice-list">
        {scene.fixedChoices.map(choice => <button
          key={choice.key}
          type="button"
          disabled={busy}
          onClick={() => execute(actionByKey.get(choice.actionKey), 'fixed-choice')}
        >
          <strong>{choice.label}</strong><small>{choice.description}</small>
        </button>)}
      </div>
    </section> : null}

    <section className="open-world-scene-input-card" data-testid="text-open-world-system-actions">
      <header><TerminalSquare aria-hidden="true" /><strong>系统 Action · 当前可执行行动</strong><small>由确定性规则直接校验</small></header>
      <div className="open-world-scene-action-list">
        {sceneActions.map(action => <button
          key={action.action.key}
          type="button"
          disabled={busy}
          onClick={() => execute(action, 'system-action')}
        >
          <strong>{action.action.label}</strong><small>{action.action.description}</small>
        </button>)}
        {!sceneActions.length && <p>当前场景没有可执行的系统行动。</p>}
      </div>
    </section>

    <section className="open-world-scene-input-card open-world-scene-natural" data-testid="text-open-world-natural-input">
      <header><MessageCircle aria-hidden="true" /><strong>自然语言</strong><small>首版确定性理解</small></header>
      <form onSubmit={event => { event.preventDefault(); submitNaturalInput() }}>
        <label htmlFor="text-open-world-natural-command">你想怎么做？</label>
        <div>
          <input
            id="text-open-world-natural-command"
            value={naturalInput}
            onChange={event => setNaturalInput(event.target.value)}
            disabled={!naturalInputEnabled || busy}
            placeholder={combatActive
              ? '战斗中只允许正式按钮操作'
              : naturalInputEnabled ? '输入本场景中的行动表达' : '当前场景没有自然语言绑定'}
          />
          <button type="submit" disabled={!naturalInput.trim() || !naturalInputEnabled || busy}>
            <Send aria-hidden="true" />提交
          </button>
        </div>
      </form>
      {naturalCandidates.length > 0 && !combatActive && <p className="open-world-scene-examples">
        可识别示例：{naturalCandidates.slice(0, 3).map(candidate => candidate.example).join(' / ')}
      </p>}
      <p className="open-world-scene-boundary-copy">
        当前只映射发布时冻结的既有行动；无法识别的描述不会创建任务、地点、结果或直接修改状态。
      </p>
    </section>

    <div
      className={`open-world-scene-notice ${notice?.tone === 'mapped' ? 'is-mapped' : 'is-boundary'}`}
      role="status"
      aria-live="polite"
      hidden={!notice}
      data-testid="text-open-world-input-notice"
    >
      {notice?.message}
    </div>
  </div>
}
