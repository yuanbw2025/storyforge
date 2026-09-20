import { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, MessageCircle, MousePointerClick, ScrollText, Send, TerminalSquare } from 'lucide-react'
import type {
  TextOpenWorldActionAvailabilityV1,
  TextOpenWorldCommandSourceV1,
  TextOpenWorldFeedbackReceiptV1,
  TextOpenWorldLongTermMemoryRecordV1,
} from '../../lib/types'
import type {
  TextOpenWorldProjectedSceneV1,
  TextOpenWorldSceneProjectionV1,
} from '../../lib/open-world/scene-projection'
import { isTextOpenWorldSceneSurfaceActionV1 } from '../../lib/open-world/scene-projection'
import type {
  TextOpenWorldRuntimeIntentAuthorizationV1,
  TextOpenWorldRuntimeIntentResolutionV1,
} from '../../lib/open-world/runtime-intent'
import type {
  TextOpenWorldRuntimeDialogueHistoryTurnV1,
  TextOpenWorldRuntimeDialoguePresentationV1,
} from '../../lib/open-world/runtime-dialogue'
import type {
  TextOpenWorldRuntimeMemoryDialogueTurnV1,
  TextOpenWorldRuntimeMemoryPresentationV1,
} from '../../lib/open-world/runtime-memory'
import {
  textOpenWorldRuntimeAIPlayerFailureV1,
  type TextOpenWorldRuntimeAIFailureV1,
} from '../../lib/open-world/runtime-ai-error'
import TextOpenWorldRuntimeAIFailureNotice from './TextOpenWorldRuntimeAIFailureNotice'
import type { TextOpenWorldPlayerMediaVisualV1 } from '../../lib/open-world/player-media'

export interface TextOpenWorldSceneTutorialAvailabilityV1 {
  systemActions: boolean
  fixedChoices: boolean
  naturalInput: boolean
  /** Action keys rendered for the selected scene, including governed ambient actions. */
  actionKeys: readonly string[]
}

interface TextOpenWorldScenePanelProps {
  sessionKey: string | number
  eventSequence: number
  projection: TextOpenWorldSceneProjectionV1
  availableActions: TextOpenWorldActionAvailabilityV1[]
  feedback: TextOpenWorldFeedbackReceiptV1 | null
  busy: boolean
  fallback: {
    regionTitle: string
    locationTitle: string
    description: string
    playerName: string
  }
  background?: TextOpenWorldPlayerMediaVisualV1 | null
  onExecute(
    actionKey: string,
    targetKey: string | null,
    source: TextOpenWorldCommandSourceV1,
    options?: {
      expectedBaseSequence: number
      runtimeIntentAuthorization: TextOpenWorldRuntimeIntentAuthorizationV1
    },
  ): void
  onInterpretNaturalInput?(request: {
    utterance: string
    selectedSceneKey: string
    recentDialogue: readonly TextOpenWorldRuntimeDialogueHistoryTurnV1[]
  }): Promise<TextOpenWorldSceneNaturalInputResolutionV1>
  longTermMemories?: readonly TextOpenWorldLongTermMemoryRecordV1[]
  memoryAvailable?: boolean
  onCommitMemory?(request: {
    selectedSceneKey: string
    actorKey: string
    dialogue: readonly TextOpenWorldRuntimeMemoryDialogueTurnV1[]
  }): Promise<TextOpenWorldRuntimeMemoryPresentationV1>
  /** Reports only controls rendered for the currently selected scene. */
  onTutorialAvailabilityChange?(availability: TextOpenWorldSceneTutorialAvailabilityV1): void
}

export interface TextOpenWorldSceneNaturalInputResolutionV1 extends TextOpenWorldRuntimeIntentResolutionV1 {
  dialogue?: TextOpenWorldRuntimeDialoguePresentationV1
  runtimeAIFailure?: TextOpenWorldRuntimeAIFailureV1
}

type InteractionNotice = {
  tone: 'mapped' | 'boundary'
  message: string
} | null

interface PendingIntentOption {
  optionKey: string
  actionKey: string
  targetKey: string | null
  label: string
  description: string
  expectedBaseSequence?: number
  runtimeIntentAuthorization?: TextOpenWorldRuntimeIntentAuthorizationV1
}

interface PresentedDialogueTurn extends TextOpenWorldRuntimeDialogueHistoryTurnV1 {
  actorName: string | null
  source: TextOpenWorldRuntimeDialoguePresentationV1['source'] | null
  tone: TextOpenWorldRuntimeDialoguePresentationV1['tone'] | null
  recommendedActionKeys: string[]
  recommendedChoiceKeys: string[]
  boundaryExplanation: string | null
  citedKnowledgeKeys: string[]
  candidateHash: string | null
  contextManifestHash: string | null
  runId: number | null
}

const ATTITUDE_LABELS = { bad: '态度较差', neutral: '态度一般', good: '态度友好' } as const
function normalizeUtterance(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase('zh-CN')
}

function targetForAction(action: TextOpenWorldActionAvailabilityV1): {
  targetKey: string | null
  error: string | null
} {
  if (action.targetScope === 'none') return { targetKey: null, error: null }
  if (action.validTargetKeys.length === 1) return { targetKey: action.validTargetKeys[0]!, error: null }
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

function PublishedScene({
  scene,
  background,
}: {
  scene: TextOpenWorldProjectedSceneV1
  background?: TextOpenWorldPlayerMediaVisualV1 | null
}) {
  return <article
    className="open-world-scene-narrative"
    data-testid="text-open-world-published-scene"
    data-media-slot={background?.slotKey ?? undefined}
    data-media-fallback={background && !background.url ? 'true' : undefined}
  >
    {background?.url && <img
      className="open-world-scene-background"
      src={background.url}
      alt={background.altText}
      data-asset-key={background.assetKey ?? undefined}
    />}
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
  fallback,
  background = null,
  onExecute,
  onInterpretNaturalInput,
  longTermMemories = [],
  memoryAvailable = false,
  onCommitMemory,
  onTutorialAvailabilityChange,
}: TextOpenWorldScenePanelProps) {
  const [selectedSceneKey, setSelectedSceneKey] = useState<string | null>(projection.recommendedSceneKey)
  const [naturalInput, setNaturalInput] = useState('')
  const [notice, setNotice] = useState<InteractionNotice>(null)
  const [interpreting, setInterpreting] = useState(false)
  const [pendingIntentOptions, setPendingIntentOptions] = useState<PendingIntentOption[]>([])
  const [dialogueTurns, setDialogueTurns] = useState<PresentedDialogueTurn[]>([])
  const [memoryBusy, setMemoryBusy] = useState(false)
  const [memoryNotice, setMemoryNotice] = useState<string | null>(null)
  const [runtimeAIFailure, setRuntimeAIFailure] = useState<{
    failure: TextOpenWorldRuntimeAIFailureV1
    operation: 'natural-input' | 'memory'
  } | null>(null)
  const interpretationRevision = useRef(0)

  useEffect(() => {
    setSelectedSceneKey(projection.recommendedSceneKey)
    setNaturalInput('')
    setNotice(null)
    setInterpreting(false)
    setPendingIntentOptions([])
    setDialogueTurns([])
    setMemoryBusy(false)
    setMemoryNotice(null)
    setRuntimeAIFailure(null)
    interpretationRevision.current += 1
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
  const compatibilityActions = availableActions.filter(isTextOpenWorldSceneSurfaceActionV1)
  const ambientActions = projection.status === 'ready'
    ? projection.ambientActionKeys
      .flatMap(actionKey => actionByKey.get(actionKey) ?? [])
      .filter(isTextOpenWorldSceneSurfaceActionV1)
    : []
  const selectedSceneActions = scene
    ? scene.actionKeys.flatMap(actionKey => actionByKey.get(actionKey) ?? [])
    : []
  const sceneAndAmbientActions = [...selectedSceneActions, ...ambientActions]
    .filter((action, index, all) => all.findIndex(candidate => candidate.action.key === action.action.key) === index)
  const sceneActions = projection.status === 'ready'
    ? sceneAndAmbientActions
    : compatibilityActions
  const tutorialActionKeys = sceneActions.map(action => action.action.key).sort()
  const tutorialActionSignature = tutorialActionKeys.join('\u0000')
  const naturalCandidates = scene?.naturalLanguageExamples.flatMap(entry => (
    entry.exampleUtterances.map(example => ({ actionKey: entry.actionKey, example }))
  )) ?? []
  const naturalInputEnabled = projection.status === 'ready'
    && scene != null
    && (naturalCandidates.length > 0 || onInterpretNaturalInput != null)

  useEffect(() => {
    onTutorialAvailabilityChange?.({
      systemActions: sceneActions.length > 0,
      fixedChoices: (scene?.fixedChoices.length ?? 0) > 0,
      naturalInput: naturalInputEnabled,
      actionKeys: tutorialActionSignature ? tutorialActionSignature.split('\u0000') : [],
    })
  }, [
    naturalInputEnabled,
    onTutorialAvailabilityChange,
    scene?.fixedChoices.length,
    sceneActions.length,
    tutorialActionSignature,
  ])

  const execute = (
    action: TextOpenWorldActionAvailabilityV1 | undefined,
    source: TextOpenWorldCommandSourceV1,
    governed?: {
      targetKey: string | null
      expectedBaseSequence: number
      runtimeIntentAuthorization: TextOpenWorldRuntimeIntentAuthorizationV1
    },
  ) => {
    if (!action?.available) {
      setNotice({ tone: 'boundary', message: '该行动已经不在当前合法投影中，未写入任何状态。' })
      return
    }
    const target = governed
      ? action.targetScope === 'none'
        ? governed.targetKey == null
          ? { targetKey: null, error: null }
          : { targetKey: null, error: `“${action.action.label}”不接受目标，未执行任何行动。` }
        : governed.targetKey != null && action.validTargetKeys.includes(governed.targetKey)
          ? { targetKey: governed.targetKey, error: null }
          : { targetKey: null, error: `“${action.action.label}”的目标已经不在当前合法投影中。` }
      : targetForAction(action)
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
    onExecute(action.action.key, target.targetKey, source, governed == null ? undefined : {
      expectedBaseSequence: governed.expectedBaseSequence,
      runtimeIntentAuthorization: governed.runtimeIntentAuthorization,
    })
  }

  const submitNaturalInput = async () => {
    const normalized = normalizeUtterance(naturalInput)
    if (!normalized || !naturalInputEnabled) return
    setRuntimeAIFailure(null)
    const matches = naturalCandidates.filter(candidate => normalizeUtterance(candidate.example) === normalized)
    const actionKeys = [...new Set(matches.map(match => match.actionKey))]
    if (actionKeys.length === 1) {
      setPendingIntentOptions([])
      execute(actionByKey.get(actionKeys[0]!), 'mapped-intent')
      setNaturalInput('')
      return
    }
    if (actionKeys.length > 1) {
      const options = actionKeys.flatMap(actionKey => {
        const action = actionByKey.get(actionKey)
        if (!action?.available) return []
        const target = targetForAction(action)
        if (target.error) return []
        return [{
          optionKey: `frozen:${actionKey}:${target.targetKey ?? 'none'}`,
          actionKey,
          targetKey: target.targetKey,
          label: action.action.label,
          description: action.action.description,
        }]
      })
      if (options.length) {
        setPendingIntentOptions(options)
        setNotice({ tone: 'boundary', message: '这句话对应多个当前可执行行动，请明确选择一个；选择前不会改变世界状态。' })
        setNaturalInput('')
        return
      }
    }
    if (!onInterpretNaturalInput || !scene) {
      const alternatives = sceneActions.slice(0, 3).map(action => `“${action.action.label}”`).join('、')
      setNotice({
        tone: 'boundary',
        message: `这句话暂时不能映射为当前场景的唯一行动，因此没有改变世界状态。${alternatives ? `你可以改用 ${alternatives}。` : ''}`,
      })
      return
    }
    const requestRevision = ++interpretationRevision.current
    setPendingIntentOptions([])
    setInterpreting(true)
    setNotice({ tone: 'boundary', message: 'AI正在按当前场景理解这句话；完成前没有改变世界状态，你仍可使用系统行动。' })
    try {
      const resolution = await onInterpretNaturalInput({
        utterance: naturalInput.normalize('NFC').trim(),
        selectedSceneKey: scene.key,
        recentDialogue: dialogueTurns.map(turn => ({
          speaker: turn.speaker,
          actorKey: turn.actorKey,
          text: turn.text,
        })),
      })
      if (interpretationRevision.current !== requestRevision || resolution.selectedSceneKey !== scene.key) return
      if (resolution.status === 'mapped' && resolution.options.length === 1) {
        const option = resolution.options[0]!
        execute(actionByKey.get(option.actionKey), 'mapped-intent', {
          targetKey: option.targetKey,
          expectedBaseSequence: resolution.baseSequence,
          runtimeIntentAuthorization: option.authorization,
        })
        setNaturalInput('')
        return
      }
      if (resolution.status === 'needs-selection' && resolution.options.length > 1) {
        setPendingIntentOptions(resolution.options.map(option => ({
          optionKey: option.optionKey,
          actionKey: option.actionKey,
          targetKey: option.targetKey,
          label: option.label,
          description: option.description,
          expectedBaseSequence: resolution.baseSequence,
          runtimeIntentAuthorization: option.authorization,
        })))
        setNotice({ tone: 'boundary', message: 'AI找到了多个合法解释，请明确选择一个；选择前不会改变世界状态。' })
        setNaturalInput('')
        return
      }
      if (resolution.status === 'reply-only' && resolution.dialogue) {
        const dialogue = resolution.dialogue
        if (dialogue.selectedSceneKey !== scene.key || dialogue.actorKey !== scene.actor?.key) return
        const addedTurns: PresentedDialogueTurn[] = [{
          speaker: 'player', actorKey: null, text: naturalInput.normalize('NFC').trim(),
          actorName: null, source: null, tone: null,
          recommendedActionKeys: [], recommendedChoiceKeys: [], boundaryExplanation: null,
          citedKnowledgeKeys: [], candidateHash: null, contextManifestHash: null,
          runId: null,
        }, {
          speaker: 'npc', actorKey: dialogue.actorKey, text: dialogue.replyText,
          actorName: dialogue.actorName, source: dialogue.source, tone: dialogue.tone,
          recommendedActionKeys: [...dialogue.recommendedActionKeys],
          recommendedChoiceKeys: [...dialogue.recommendedChoiceKeys],
          boundaryExplanation: dialogue.boundaryExplanation,
          citedKnowledgeKeys: [...dialogue.citedKnowledgeKeys],
          candidateHash: dialogue.candidateHash,
          contextManifestHash: dialogue.contextManifestHash,
          runId: dialogue.runId,
        }]
        setDialogueTurns(current => [...current, ...addedTurns].slice(-12))
        setNotice({
          tone: 'boundary',
          message: dialogue.source === 'ai-candidate'
            ? 'NPC已按当前人格、态度和可说知识回应；这段对白没有直接改变游戏状态。'
            : dialogue.boundaryExplanation,
        })
        if (resolution.runtimeAIFailure) {
          setRuntimeAIFailure({
            failure: resolution.runtimeAIFailure,
            operation: 'natural-input',
          })
        }
        if (!resolution.runtimeAIFailure) setNaturalInput('')
        return
      }
      const alternatives = sceneActions.slice(0, 3).map(action => `“${action.action.label}”`).join('、')
      const safeReply = resolution.replyText || resolution.boundaryExplanation || '这句话暂时不能映射为当前行动。'
      setNotice({
        tone: 'boundary',
        message: `${safeReply} 当前没有改变世界状态。${alternatives ? `你可以改用 ${alternatives}。` : ''}`,
      })
    } catch (error) {
      if (interpretationRevision.current !== requestRevision) return
      const failure = textOpenWorldRuntimeAIPlayerFailureV1(error)
      if (failure) setRuntimeAIFailure({ failure, operation: 'natural-input' })
      const alternatives = sceneActions.slice(0, 3).map(action => `“${action.action.label}”`).join('、')
      setNotice({
        tone: 'boundary',
        message: `${failure?.message ?? 'AI理解当前不可用'}，因此没有改变世界状态。${alternatives ? `你仍可改用 ${alternatives}，或输入发布时给出的示例。` : ''}`,
      })
    } finally {
      if (interpretationRevision.current === requestRevision) setInterpreting(false)
    }
  }

  const commitDialogueMemory = async () => {
    if (!scene?.actor || !onCommitMemory || dialogueTurns.length < 2 || memoryBusy) return
    setRuntimeAIFailure(null)
    setMemoryBusy(true)
    setMemoryNotice('正在把本场景对白压缩为最小长期记忆；完成前不会改变游戏状态。')
    try {
      const result = await onCommitMemory({
        selectedSceneKey: scene.key,
        actorKey: scene.actor.key,
        dialogue: dialogueTurns.map(turn => ({
          speaker: turn.speaker,
          actorKey: turn.actorKey,
          text: turn.text,
          source: turn.speaker === 'player'
            ? 'player-input'
            : turn.source === 'ai-candidate'
              ? 'ai-candidate'
              : 'frozen-scene-fallback',
          citedKnowledgeKeys: [...turn.citedKnowledgeKeys],
          dialogueCandidateHash: turn.candidateHash,
          dialogueContextManifestHash: turn.contextManifestHash,
          dialogueRunId: turn.runId,
        })),
      })
      setDialogueTurns([])
      setMemoryNotice(`已写入长期记忆：${result.summary}`)
    } catch (error) {
      const failure = textOpenWorldRuntimeAIPlayerFailureV1(error)
      if (failure) setRuntimeAIFailure({ failure, operation: 'memory' })
      setMemoryNotice(`${failure?.message ?? '长期记忆整理失败'}；临时对白和确定性玩法不受影响。`)
    } finally {
      setMemoryBusy(false)
    }
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
          interpretationRevision.current += 1
          setSelectedSceneKey(item.key)
          setNaturalInput('')
          setNotice(null)
          setInterpreting(false)
          setPendingIntentOptions([])
          setDialogueTurns([])
        }}
      >
        {item.actor ? `${item.actor.name} · ${item.title}` : item.title}
      </button>)}
    </nav>}

    {scene ? <PublishedScene scene={scene} background={background} /> : <article
      className={`open-world-game-scene-card${background?.url ? ' has-background-media' : ''}`}
      data-media-slot={background?.slotKey ?? undefined}
      data-media-fallback={background && !background.url ? 'true' : undefined}
    >
      {background?.url && <img
        className="open-world-scene-background"
        src={background.url}
        alt={background.altText}
        data-asset-key={background.assetKey ?? undefined}
      />}
      <small>{fallback.regionTitle} · 兼容场景</small>
      <h1>{fallback.locationTitle}</h1>
      <p>{fallback.description}</p>
      <span>{fallback.playerName} · 事件 #{eventSequence}</span>
      {projection.status === 'unsupported' && <aside className="open-world-scene-compatibility" role="note">
        此存档绑定的是旧版运行包，不含冻结的 P9 场景正文和三类输入绑定；系统行动仍可继续，叙事与自然输入不会被伪造。
      </aside>}
    </article>}

    <SystemReceipt feedback={feedback} />

    {dialogueTurns.length > 0 && <section
      className="open-world-runtime-dialogue-log"
      data-testid="text-open-world-runtime-dialogue"
      role="log"
      aria-live="polite"
      aria-label="本场景临时对白"
    >
      <header><MessageCircle aria-hidden="true" /><strong>本场景临时对白</strong><small>不直接写入游戏状态</small></header>
      {dialogueTurns.map((turn, index) => {
        const actionLabels = turn.recommendedActionKeys.flatMap(key => actionByKey.get(key)?.action.label ?? [])
        const choiceLabels = turn.recommendedChoiceKeys.flatMap(key => scene?.fixedChoices.find(choice => choice.key === key)?.label ?? [])
        const recommendations = [...actionLabels, ...choiceLabels]
        return <article
          key={`${turn.speaker}:${index}`}
          className={`open-world-runtime-dialogue-turn is-${turn.speaker}`}
        >
          <header>
            <strong>{turn.speaker === 'player' ? '你' : turn.actorName}</strong>
            {turn.source && <small>
              {turn.source === 'ai-candidate' ? `${ATTITUDE_LABELS[turn.tone!]} · AI只读候选` : '冻结安全回退'}
            </small>}
          </header>
          <p>{turn.text}</p>
          {recommendations.length > 0 && <small>可考虑：{recommendations.join('、')}（未执行）</small>}
          {turn.source === 'frozen-scene-fallback' && turn.boundaryExplanation && <small>{turn.boundaryExplanation}</small>}
        </article>
      })}
      {scene?.actor && <footer className="open-world-runtime-memory-actions">
        <button
          type="button"
          disabled={busy || memoryBusy || !memoryAvailable || !onCommitMemory || dialogueTurns.length < 2}
          onClick={() => void commitDialogueMemory()}
        >
          <Archive aria-hidden="true" />{memoryBusy ? '整理中…' : '整理并保存长期记忆'}
        </button>
        <small>{memoryAvailable
          ? '只保存摘要、知识键和证据指纹；不保存完整聊天正文。'
          : '配置可用的文字模型后，才能整理长期记忆。'}</small>
      </footer>}
    </section>}

    {scene?.actor && longTermMemories.some(memory => memory.actorKey === scene.actor?.key) && <section
      className="open-world-runtime-memory-log"
      data-testid="text-open-world-runtime-memory"
      aria-label={`${scene.actor.name}的长期记忆`}
    >
      <header><Archive aria-hidden="true" /><strong>{scene.actor.name}的长期记忆</strong><small>随当前存档分支重放</small></header>
      {longTermMemories.filter(memory => memory.actorKey === scene.actor?.key).slice(-4).reverse().map(memory => <article key={memory.memoryKey}>
        <p>{memory.summary}</p>
        <small>第 {Math.floor(memory.worldMinute / 1_440) + 1} 天 · {memory.inherited ? '继承自父分支' : `事件 #${memory.committedSequence}`}</small>
      </article>)}
    </section>}

    {memoryNotice && <div className="open-world-scene-notice is-boundary" role="status" aria-live="polite" data-testid="text-open-world-memory-notice">
      {memoryNotice}
    </div>}
    {runtimeAIFailure && <TextOpenWorldRuntimeAIFailureNotice
      failure={runtimeAIFailure.failure}
      busy={interpreting || memoryBusy}
      retryLabel={runtimeAIFailure.operation === 'memory' ? '明确重试记忆整理' : '明确重试这句话'}
      onRetry={runtimeAIFailure.operation === 'memory'
        ? () => void commitDialogueMemory()
        : () => void submitNaturalInput()}
    />}

    {scene?.fixedChoices.length ? <section
      className="open-world-scene-input-card"
      data-testid="text-open-world-fixed-choices"
      data-open-world-ui-key="play.fixed-choices"
    >
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

    <section
      className="open-world-scene-input-card"
      data-testid="text-open-world-system-actions"
      data-open-world-ui-key="play.system-actions"
    >
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

    <section
      className="open-world-scene-input-card open-world-scene-natural"
      data-testid="text-open-world-natural-input"
      data-open-world-ui-key="play.natural-language"
    >
      <header><MessageCircle aria-hidden="true" /><strong>自然语言</strong><small>冻结例句 + AI 语义理解</small></header>
      <form onSubmit={event => { event.preventDefault(); void submitNaturalInput() }}>
        <label htmlFor="text-open-world-natural-command">你想怎么做？</label>
        <div>
          <input
            id="text-open-world-natural-command"
            value={naturalInput}
            onChange={event => setNaturalInput(event.target.value)}
            disabled={!naturalInputEnabled || busy || interpreting}
            placeholder={naturalInputEnabled ? '输入本场景中的行动表达' : '当前场景没有自然语言绑定'}
          />
          <button type="submit" disabled={!naturalInput.trim() || !naturalInputEnabled || busy || interpreting}>
            <Send aria-hidden="true" />{interpreting ? '理解中…' : '提交'}
          </button>
        </div>
      </form>
      {naturalCandidates.length > 0 && <p className="open-world-scene-examples">
        可识别示例：{naturalCandidates.slice(0, 3).map(candidate => candidate.example).join(' / ')}
      </p>}
      <p className="open-world-scene-boundary-copy">
        AI只可选择当前已投影的既有行动；角色对白场景还可生成不写状态的受限对白。无法识别的描述不会创建任务、地点、结果或直接修改状态。
      </p>
      {pendingIntentOptions.length > 0 && <div
        className="open-world-scene-choice-list"
        role="group"
        aria-label="请选择自由输入的解释"
        data-testid="text-open-world-intent-options"
      >
        {pendingIntentOptions.map(option => <button
          key={option.optionKey}
          type="button"
          disabled={busy || interpreting}
          onClick={() => {
            setPendingIntentOptions([])
            const authorization = option.runtimeIntentAuthorization
            const expectedBaseSequence = option.expectedBaseSequence
            if (authorization && expectedBaseSequence != null) {
              execute(actionByKey.get(option.actionKey), 'mapped-intent', {
                targetKey: option.targetKey,
                expectedBaseSequence,
                runtimeIntentAuthorization: authorization,
              })
            } else {
              execute(actionByKey.get(option.actionKey), 'mapped-intent')
            }
          }}
        >
          <strong>{option.label}</strong><small>{option.description}</small>
        </button>)}
      </div>}
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
