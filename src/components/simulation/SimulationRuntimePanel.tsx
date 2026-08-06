import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  CalendarClock,
  Clock3,
  CopyPlus,
  ClipboardList,
  Dices,
  GitBranch,
  Plus,
  RotateCcw,
  Save,
  ScrollText,
  Snowflake,
  Trash2,
  Loader2,
  Sparkles,
} from 'lucide-react'
import {
  loadSimulationCanonCandidates,
  parseSimulationCanonSnapshot,
  verifySimulationCanonSnapshot,
} from '../../lib/simulation/canon-snapshot'
import type {
  Project,
  SimulationCanonCandidate,
  SimulationCanonSourceKind,
  SimulationSessionKind,
  SimulationTtrpgEncounterCandidate,
  SimulationTtrpgTurnCandidate,
  WorkspaceScope,
} from '../../lib/types'
import { useSimulationRuntimeStore } from '../../stores/simulation-runtime'
import { useDialog } from '../shared/Dialog'
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { useAIConfigStore } from '../../stores/ai-config'
import { resolveRequestConfig } from '../../lib/ai/client'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
import { assembleContext } from '../../lib/registry/assemble-context'
import { buildNpcEvolutionPrompt, parseNpcEvolutionCandidate } from '../../lib/simulation/npc-evolution'
import {
  buildTtrpgEncounterPrompt,
  buildTtrpgGmPrompt,
  parseTtrpgEncounterCandidate,
  parseTtrpgTurnCandidate,
} from '../../lib/simulation/ttrpg'
import { isNpcRuntimeEntity } from '../../lib/simulation/runtime'

const KIND_LABELS: Record<SimulationSessionKind, string> = {
  sandbox: '沙盒',
  'npc-evolution': 'NPC 演进',
  ttrpg: '跑团',
  chatgame: '角色聊天',
  storygame: '文字游戏',
}

const SOURCE_KIND_LABELS: Record<SimulationCanonSourceKind, string> = {
  world: '世界',
  character: '角色',
  location: '地点',
  item: '物品',
  rule: '规则',
}

const SOURCE_KIND_ORDER: SimulationCanonSourceKind[] = [
  'world',
  'character',
  'location',
  'item',
  'rule',
]

function eventSummary(type: string, payloadJson: string): string {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>
    if (type === 'time.advanced') return `时间 +${payload.amount}`
    if (type === 'random.resolved') {
      const dice = Array.isArray(payload.dice) ? payload.dice.join(', ') : ''
      return `${payload.expression}: [${dice}] = ${payload.total}`
    }
    if (type === 'narrative.recorded') return String(payload.text ?? '')
    if (type === 'narrative.node.advanced') return `叙事推进：${payload.fromNodeKey ?? ''} → ${payload.toNodeKey ?? ''}`
    if (type === 'ttrpg.scene.opened') return `场景开始：${(payload.scene as Record<string, unknown>)?.title ?? ''}`
    if (type === 'ttrpg.action.recorded') return `动作：${payload.text ?? ''}`
    if (type === 'ttrpg.check.resolved') {
      const check = payload.check as Record<string, unknown> | undefined
      return `检定：${check?.skill ?? ''} ${check?.total ?? ''}/${check?.dc ?? ''}`
    }
    if (type === 'ttrpg.gm.response.recorded') return `GM：${payload.text ?? ''}`
    if (type === 'ttrpg.turn.advanced') return `回合推进至 ${payload.nextActorKey ?? ''}`
    if (type === 'ttrpg.encounter.started') return `遭遇开始：${(payload.encounter as Record<string, unknown>)?.title ?? ''}`
    if (type === 'ttrpg.encounter.resolved') return `遭遇结束：${payload.reason ?? ''}`
    if (type === 'ttrpg.combat.attack.resolved') {
      const attack = payload.attack as Record<string, unknown> | undefined
      return `攻击：${attack?.actorKey ?? ''} → ${attack?.targetKey ?? ''}｜${attack?.hit ? `命中 ${attack?.damageTotal ?? 0}` : '未命中'}`
    }
    if (type === 'ttrpg.combat.resource.changed') return `资源：${payload.entityKey ?? ''} ${payload.resourceKey ?? ''} ${payload.delta ?? ''}`
    if (type === 'ttrpg.combat.condition.applied') return `状态：${payload.entityKey ?? ''} 获得 ${(payload.condition as Record<string, unknown>)?.name ?? ''}`
    if (type === 'ttrpg.combat.condition.removed') return `状态：${payload.entityKey ?? ''} 移除 ${payload.conditionId ?? ''}`
    if (type === 'ttrpg.combat.turn.advanced') return `战斗回合推进至 ${payload.nextActorKey ?? ''}`
    if (type === 'ttrpg.campaign.summary.updated') return '更新长期战役摘要'
    if (type === 'ttrpg.campaign.quest.upserted') return `任务：${(payload.quest as Record<string, unknown>)?.title ?? ''}`
    if (type === 'ttrpg.campaign.schedule.upserted') return `日程：${(payload.schedule as Record<string, unknown>)?.activity ?? ''}`
    if (type === 'chat.session.configured') return `聊天场景：${(payload.scene as Record<string, unknown>)?.title ?? ''}`
    if (type === 'chat.message.recorded') return `用户：${payload.text ?? ''}`
    if (type === 'chat.reply.recorded') return `角色：${payload.text ?? ''}`
    if (type.startsWith('entity.')) return String(payload.entityKey ?? type)
    return type
  } catch {
    return type
  }
}

export default function SimulationRuntimePanel(props: {
  project: Project
  worldGroupId: number | null
  /** 产品入口锁定为单一会话类型；旧工作区不传时仍管理全部互动存档。 */
  sessionKind?: SimulationSessionKind
  workspaceScope?: WorkspaceScope
}) {
  const store = useSimulationRuntimeStore()
  const dialog = useDialog()
  const [newTitle, setNewTitle] = useState('')
  const [newKind, setNewKind] = useState<SimulationSessionKind>(props.sessionKind ?? 'sandbox')
  const [dice, setDice] = useState('1d20')
  const [timeAmount, setTimeAmount] = useState('1')
  const [narrativeText, setNarrativeText] = useState('')
  const [checkpointName, setCheckpointName] = useState('')
  const [branchTitle, setBranchTitle] = useState('')
  const [canonCandidates, setCanonCandidates] = useState<SimulationCanonCandidate[]>([])
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<Set<string>>(new Set())
  const [canonLoading, setCanonLoading] = useState(false)
  const [snapshotVerified, setSnapshotVerified] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [npcTargetKey, setNpcTargetKey] = useState('')
  const [npcRequest, setNpcRequest] = useState('')
  const [ttrpgSceneTitle, setTtrpgSceneTitle] = useState('')
  const [ttrpgSceneDescription, setTtrpgSceneDescription] = useState('')
  const [ttrpgSceneLocationKey, setTtrpgSceneLocationKey] = useState('')
  const [ttrpgTurnOrderText, setTtrpgTurnOrderText] = useState('')
  const [ttrpgActorKey, setTtrpgActorKey] = useState('')
  const [ttrpgAction, setTtrpgAction] = useState('')
  const [ttrpgSkill, setTtrpgSkill] = useState('')
  const [ttrpgExpression, setTtrpgExpression] = useState('1d20')
  const [ttrpgDc, setTtrpgDc] = useState('12')
  const [ttrpgCandidate, setTtrpgCandidate] = useState<SimulationTtrpgTurnCandidate | null>(null)
  const [ttrpgEncounterTitle, setTtrpgEncounterTitle] = useState('')
  const [ttrpgEncounterDescription, setTtrpgEncounterDescription] = useState('')
  const [ttrpgParticipantKeys, setTtrpgParticipantKeys] = useState<string[]>([])
  const [ttrpgEncounterCandidate, setTtrpgEncounterCandidate] = useState<SimulationTtrpgEncounterCandidate | null>(null)
  const [ttrpgAttackTargetKey, setTtrpgAttackTargetKey] = useState('')
  const [ttrpgAttackExpression, setTtrpgAttackExpression] = useState('1d20')
  const [ttrpgDamageExpression, setTtrpgDamageExpression] = useState('1d6')
  const [ttrpgResourceKey] = useState('hp')
  const [ttrpgAttackReason, setTtrpgAttackReason] = useState('')
  const [ttrpgResourceEntityKey, setTtrpgResourceEntityKey] = useState('')
  const [ttrpgResourceName, setTtrpgResourceName] = useState('hp')
  const [ttrpgResourceDelta, setTtrpgResourceDelta] = useState('-1')
  const [ttrpgConditionEntityKey, setTtrpgConditionEntityKey] = useState('')
  const [ttrpgConditionName, setTtrpgConditionName] = useState('')
  const [ttrpgConditionDuration, setTtrpgConditionDuration] = useState('1')
  const [ttrpgConditionDescription, setTtrpgConditionDescription] = useState('')
  const [campaignSummary, setCampaignSummary] = useState('')
  const [campaignQuestId, setCampaignQuestId] = useState('')
  const [campaignQuestTitle, setCampaignQuestTitle] = useState('')
  const [campaignQuestDescription, setCampaignQuestDescription] = useState('')
  const [campaignQuestStatus, setCampaignQuestStatus] = useState<'active' | 'paused' | 'completed' | 'failed'>('active')
  const [campaignQuestPriority, setCampaignQuestPriority] = useState('0')
  const [campaignQuestDueClock, setCampaignQuestDueClock] = useState('')
  const [campaignScheduleId, setCampaignScheduleId] = useState('')
  const [campaignScheduleEntityKey, setCampaignScheduleEntityKey] = useState('')
  const [campaignScheduleStartClock, setCampaignScheduleStartClock] = useState('0')
  const [campaignScheduleEndClock, setCampaignScheduleEndClock] = useState('')
  const [campaignScheduleLocationKey, setCampaignScheduleLocationKey] = useState('')
  const scopeProjectId = props.workspaceScope?.projectId
  const scopeWorldId = props.workspaceScope?.worldId
  const scopeWorkId = props.workspaceScope?.workId
  const [campaignScheduleActivity, setCampaignScheduleActivity] = useState('')
  const [campaignScheduleRecurrence, setCampaignScheduleRecurrence] = useState<'once' | 'daily' | 'weekly'>('once')
  const { config } = useAIConfigStore()

  useEffect(() => {
    void store.load(props.project.id!, props.worldGroupId)
  // Zustand action identity is stable; project change is the actual reload boundary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.project.id, props.worldGroupId])

  useEffect(() => {
    let cancelled = false
    setCanonLoading(true)
    setSelectedSourceKeys(new Set())
    void loadSimulationCanonCandidates({
      projectId: props.project.id!,
      scope: scopeProjectId != null && scopeWorldId != null && scopeWorkId != null
        ? { projectId: scopeProjectId, worldId: scopeWorldId, workId: scopeWorkId }
        : undefined,
      worldGroupId: props.worldGroupId,
    }).then(result => {
      if (!cancelled) setCanonCandidates(result.candidates)
    }).catch(error => {
      if (!cancelled) setActionError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (!cancelled) setCanonLoading(false)
    })
    return () => { cancelled = true }
  }, [props.project.id, props.worldGroupId, scopeProjectId, scopeWorldId, scopeWorkId])

  const visibleSessions = useMemo(
    () => store.sessions.filter(session => (
      session.projectId === props.project.id
      && (session.worldGroupId ?? null) === props.worldGroupId
      && (!props.workspaceScope || (
        (session.worldId == null && session.workId == null)
        || (session.worldId === props.workspaceScope.worldId && session.workId === props.workspaceScope.workId)
      ))
      && (!props.sessionKind || session.kind === props.sessionKind)
    )),
    [props.project.id, props.sessionKind, props.workspaceScope, props.worldGroupId, store.sessions],
  )
  const selected = useMemo(
    () => visibleSessions.find(session => session.id === store.selectedSessionId) ?? null,
    [store.selectedSessionId, visibleSessions],
  )
  useEffect(() => {
    if (selected?.id == null) return
    setCampaignSummary(store.runtimeState.ttrpg?.campaign?.summary ?? '')
  }, [selected?.id, store.runtimeState.ttrpg?.campaign?.summary])
  const selectedSnapshot = useMemo(
    () => selected ? parseSimulationCanonSnapshot(selected.canonSnapshotJson) : null,
    [selected],
  )
  const narrative = store.runtimeState.narrative ?? null
  const currentNarrativeNode = narrative?.nodes.find(node => node.key === narrative.currentNodeKey) ?? null
  const narrativeChoices = narrative?.availableNodeKeys
    .map(key => narrative.nodes.find(node => node.key === key))
    .filter((node): node is NonNullable<typeof node> => node != null) ?? []
  const npcAI = useAIStream(createAISessionKey(
    props.project.id!,
    'simulation.npc-evolution',
    selected?.id ?? 'none',
  ))
  const ttrpgAI = useAIStream(createAISessionKey(
    props.project.id!,
    'simulation.ttrpg-gm',
    selected?.id ?? 'none',
  ))
  const encounterAI = useAIStream(createAISessionKey(
    props.project.id!,
    'simulation.ttrpg-encounter',
    selected?.id ?? 'none',
  ))
  const npcEntities = useMemo(
    () => Object.values(store.runtimeState.entities).filter(isNpcRuntimeEntity),
    [store.runtimeState.entities],
  )
  const selectedNpc = npcEntities.find(entity => entity.entityKey === npcTargetKey) ?? npcEntities[0] ?? null
  const ttrpgActors = useMemo(
    () => Object.values(store.runtimeState.entities).filter(entity => (
      entity.kind === 'player' || entity.kind === 'character' || entity.kind === 'npc'
    )),
    [store.runtimeState.entities],
  )
  const selectedTtrpgActor = ttrpgActors.find(entity => entity.entityKey === ttrpgActorKey)
    ?? ttrpgActors.find(entity => entity.entityKey === store.runtimeState.ttrpg?.activeActorKey)
    ?? ttrpgActors[0]
  const combatEncounter = store.runtimeState.ttrpg?.encounter ?? null
  const combatants = useMemo(
    () => combatEncounter ? combatEncounter.turnOrder.map(key => combatEncounter.combatants[key]).filter(Boolean) : [],
    [combatEncounter],
  )
  const combatTargetEntities = useMemo(
    () => combatants.map(combatant => store.runtimeState.entities[combatant.entityKey]).filter(Boolean),
    [combatants, store.runtimeState.entities],
  )
  const campaign = store.runtimeState.ttrpg?.campaign ?? { summary: '', quests: [], npcSchedules: [] }
  const campaignNpcs = useMemo(
    () => Object.values(store.runtimeState.entities).filter(isNpcRuntimeEntity),
    [store.runtimeState.entities],
  )
  const activeCampaignSchedules = useMemo(
    () => campaign.npcSchedules.filter(schedule => (
      store.runtimeState.clock >= schedule.startClock
      && (schedule.endClock == null || store.runtimeState.clock <= schedule.endClock)
    )),
    [campaign.npcSchedules, store.runtimeState.clock],
  )
  const {
    loading: sessionsLoading,
    projectId: loadedProjectId,
    selectedSessionId,
    select: selectSession,
    worldGroupId: loadedWorldGroupId,
  } = store
  const candidatesByKind = useMemo(() => Object.fromEntries(SOURCE_KIND_ORDER.map(kind => [
    kind,
    canonCandidates.filter(candidate => candidate.kind === kind),
  ])) as Record<SimulationCanonSourceKind, SimulationCanonCandidate[]>, [canonCandidates])

  useEffect(() => {
    if (sessionsLoading || loadedProjectId !== props.project.id || loadedWorldGroupId !== props.worldGroupId) return
    if (visibleSessions.some(session => session.id === selectedSessionId)) return
    void selectSession(visibleSessions[0]?.id ?? null)
  }, [
    loadedProjectId,
    loadedWorldGroupId,
    props.project.id,
    props.worldGroupId,
    selectedSessionId,
    selectSession,
    sessionsLoading,
    visibleSessions,
  ])

  useEffect(() => {
    let cancelled = false
    setSnapshotVerified(null)
    if (selectedSnapshot) {
      void verifySimulationCanonSnapshot(selectedSnapshot).then(result => {
        if (!cancelled) setSnapshotVerified(result)
      })
    }
    return () => { cancelled = true }
  }, [selectedSnapshot])

  useEffect(() => {
    if (selected?.kind !== 'npc-evolution') return
    if (!npcTargetKey || !npcEntities.some(entity => entity.entityKey === npcTargetKey)) {
      setNpcTargetKey(npcEntities[0]?.entityKey ?? '')
    }
  }, [selected?.kind, selected?.id, npcEntities, npcTargetKey])

  useEffect(() => {
    if (selected?.kind !== 'ttrpg') return
    const active = combatEncounter?.activeActorKey ?? store.runtimeState.ttrpg?.activeActorKey
    if (!ttrpgActorKey || !ttrpgActors.some(entity => entity.entityKey === ttrpgActorKey)) {
      setTtrpgActorKey(active && ttrpgActors.some(entity => entity.entityKey === active)
        ? active
        : ttrpgActors[0]?.entityKey ?? '')
    }
  }, [selected?.kind, selected?.id, ttrpgActors, ttrpgActorKey, combatEncounter?.activeActorKey, store.runtimeState.ttrpg?.activeActorKey])

  useEffect(() => {
    if (selected?.kind !== 'ttrpg') return
    setTtrpgParticipantKeys(current => {
      const valid = current.filter(key => ttrpgActors.some(entity => entity.entityKey === key))
      if (valid.length >= 2) return valid
      return ttrpgActors.slice(0, Math.max(2, Math.min(4, ttrpgActors.length))).map(entity => entity.entityKey)
    })
  }, [selected?.kind, selected?.id, ttrpgActors])

  useEffect(() => {
    if (!combatTargetEntities.length) return
    if (!ttrpgAttackTargetKey || !combatTargetEntities.some(entity => entity.entityKey === ttrpgAttackTargetKey)) {
      setTtrpgAttackTargetKey(combatTargetEntities.find(entity => entity.entityKey !== ttrpgActorKey)?.entityKey ?? combatTargetEntities[0].entityKey)
    }
    if (!ttrpgResourceEntityKey || !combatTargetEntities.some(entity => entity.entityKey === ttrpgResourceEntityKey)) {
      setTtrpgResourceEntityKey(combatTargetEntities[0].entityKey)
    }
    if (!ttrpgConditionEntityKey || !combatTargetEntities.some(entity => entity.entityKey === ttrpgConditionEntityKey)) {
      setTtrpgConditionEntityKey(combatTargetEntities[0].entityKey)
    }
  }, [combatTargetEntities, ttrpgAttackTargetKey, ttrpgConditionEntityKey, ttrpgActorKey, ttrpgResourceEntityKey])

  const toggleSource = (sourceKey: string) => {
    setSelectedSourceKeys(current => {
      const next = new Set(current)
      if (next.has(sourceKey)) next.delete(sourceKey)
      else next.add(sourceKey)
      return next
    })
  }

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setActionError('')
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const generateNpcEvolution = async () => {
    if (!selected || selected.kind !== 'npc-evolution' || !selectedNpc) return
    const runtimeContext = await assembleContext({
      projectId: props.project.id!,
      worldGroupId: selected.worldGroupId ?? null,
      simulationSessionId: selected.id,
      sourceKeys: ['simulationRuntime'],
      provider: config.provider,
      model: config.model,
    })
    const baseSequence = store.runtimeState.lastSequence
    const draft = await npcAI.start(buildNpcEvolutionPrompt({
      authorRequest: npcRequest,
      targetEntityKey: selectedNpc.entityKey,
      targetName: selectedNpc.name,
      runtimeContext: runtimeContext.text,
    }), undefined, { category: 'simulation.npc-evolution', projectId: props.project.id! })
    if (!draft.trim()) return
    const candidate = parseNpcEvolutionCandidate({
      draft,
      state: store.runtimeState,
      targetEntityKey: selectedNpc.entityKey,
      baseSequence,
    })
    await store.proposeNpcEvolution(candidate)
  }

  const generateTtrpgTurn = async () => {
    if (!selected || selected.kind !== 'ttrpg' || !selectedTtrpgActor) return
    if (!store.runtimeState.ttrpg?.scene) throw new Error('请先开始一个跑团场景。')
    const runtimeContext = await assembleContext({
      projectId: props.project.id!,
      worldGroupId: selected.worldGroupId ?? null,
      simulationSessionId: selected.id,
      sourceKeys: ['simulationRuntime'],
      provider: config.provider,
      model: config.model,
    })
    const draft = await ttrpgAI.start(buildTtrpgGmPrompt({
      actorKey: selectedTtrpgActor.entityKey,
      actorName: selectedTtrpgActor.name,
      action: ttrpgAction,
      runtimeContext: runtimeContext.text,
    }), undefined, { category: 'simulation.ttrpg-gm', projectId: props.project.id! })
    if (!draft.trim()) return
    setTtrpgCandidate(parseTtrpgTurnCandidate({
      draft,
      state: store.runtimeState,
      actorKey: selectedTtrpgActor.entityKey,
      action: ttrpgAction,
      baseSequence: store.runtimeState.lastSequence,
    }))
  }

  const generateTtrpgEncounter = async () => {
    if (!selected || selected.kind !== 'ttrpg') return
    if (ttrpgParticipantKeys.length < 2) throw new Error('遭遇至少需要两个参与者。')
    const runtimeContext = await assembleContext({
      projectId: props.project.id!,
      worldGroupId: selected.worldGroupId ?? null,
      simulationSessionId: selected.id,
      sourceKeys: ['simulationRuntime'],
      provider: config.provider,
      model: config.model,
    })
    const draft = await encounterAI.start(buildTtrpgEncounterPrompt({
      runtimeContext: runtimeContext.text,
      participantKeys: ttrpgParticipantKeys,
    }), undefined, { category: 'simulation.ttrpg-encounter', projectId: props.project.id! })
    if (!draft.trim()) return
    setTtrpgEncounterCandidate(parseTtrpgEncounterCandidate({
      draft,
      state: store.runtimeState,
      participantKeys: ttrpgParticipantKeys,
      baseSequence: store.runtimeState.lastSequence,
    }))
  }

  return (
    <div className="flex h-full min-h-[36rem] flex-col bg-bg-base lg:flex-row">
      <aside className="max-h-[28rem] w-full shrink-0 overflow-y-auto border-b border-border bg-bg-surface p-4 lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r">
        <div className="mb-4">
          <div className="mb-1 flex items-center gap-2">
            <Box className="h-4 w-4 text-accent" />
            <h2 className="font-semibold text-text-primary">互动运行时</h2>
          </div>
          <p className="text-xs leading-relaxed text-text-muted">
            {props.sessionKind
              ? `${KIND_LABELS[props.sessionKind]}使用独立存档，事件不会反写小说 Canon。`
              : 'NPC、跑团和角色聊天共用的独立存档。这里的事件不会反写小说 Canon。'}
          </p>
        </div>

        <div className="mb-4 space-y-2 rounded-lg border border-border bg-bg-base p-3">
          <input
            value={newTitle}
            onChange={event => setNewTitle(event.target.value)}
            placeholder="新会话名称"
            className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary"
          />
          {props.sessionKind ? (
            <div
              data-testid="runtime-kind-lock"
              className="flex w-full items-center gap-2 rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary"
            >
              <Dices className="h-3.5 w-3.5 text-accent" />
              {KIND_LABELS[props.sessionKind]}存档
            </div>
          ) : (
            <select
              value={newKind}
              onChange={event => setNewKind(event.target.value as SimulationSessionKind)}
              aria-label="运行时类型"
              className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary"
            >
              {Object.entries(KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          )}
          <fieldset className="space-y-2 border-t border-border pt-2">
            <legend className="flex items-center gap-1.5 px-1 text-xs font-medium text-text-secondary">
              <Snowflake className="h-3.5 w-3.5" />
              冻结来源
            </legend>
            <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
              {SOURCE_KIND_ORDER.map(kind => candidatesByKind[kind].length > 0 && (
                <div key={kind}>
                  <div className="mb-1 text-[11px] font-medium text-text-muted">
                    {SOURCE_KIND_LABELS[kind]}
                  </div>
                  <div className="space-y-1">
                    {candidatesByKind[kind].map(candidate => (
                      <label
                        key={candidate.sourceKey}
                        className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-xs hover:bg-bg-hover"
                      >
                        <input
                          type="checkbox"
                          checked={selectedSourceKeys.has(candidate.sourceKey)}
                          onChange={() => toggleSource(candidate.sourceKey)}
                          aria-label={`冻结 ${SOURCE_KIND_LABELS[kind]} ${candidate.name}`}
                          className="mt-0.5 h-3.5 w-3.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-text-secondary">{candidate.name}</span>
                          {candidate.summary && (
                            <span className="block truncate text-[10px] text-text-muted">
                              {candidate.summary}
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {canonLoading && <p className="py-2 text-center text-xs text-text-muted">读取中...</p>}
            </div>
          </fieldset>
          <button
            disabled={busy || canonLoading || !newTitle.trim() || selectedSourceKeys.size === 0}
            onClick={() => void run(async () => {
              await store.createSession({
                projectId: props.project.id!,
                worldGroupId: props.worldGroupId,
                kind: props.sessionKind ?? newKind,
                title: newTitle,
                sourceKeys: [...selectedSourceKeys],
                scope: props.workspaceScope,
              })
              setNewTitle('')
              setSelectedSourceKeys(new Set())
            })}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            创建并冻结
          </button>
        </div>

        <div className="space-y-1">
          {visibleSessions.map(session => (
            <button
              key={session.id}
              onClick={() => void store.select(session.id!)}
              className={`w-full rounded px-3 py-2 text-left ${
                session.id === store.selectedSessionId
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:bg-bg-hover'
              }`}
            >
              <div className="truncate text-sm font-medium">{session.title}</div>
              <div className="mt-0.5 text-[11px] text-text-muted">
                {KIND_LABELS[session.kind]} · {session.status}
              </div>
            </button>
          ))}
          {!store.loading && visibleSessions.length === 0 && (
            <p className="py-6 text-center text-xs text-text-muted">
              {props.sessionKind ? `还没有${KIND_LABELS[props.sessionKind]}存档` : '还没有互动存档'}
            </p>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            {props.sessionKind
              ? `创建一个${KIND_LABELS[props.sessionKind]}会话，开始新的互动存档。`
              : '创建一个沙盒会话，开始验证共享运行时。'}
          </div>
        ) : (
          <div className="mx-auto max-w-5xl space-y-5">
            <header className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-1 text-xs text-text-muted">体验中心 · {KIND_LABELS[selected.kind]}</div>
                <h1 className="text-xl font-semibold text-text-primary">{selected.title}</h1>
                <p className="mt-1 text-xs text-text-muted">
                  规则 v{selected.rulesetVersion} · 来源 {selectedSnapshot?.sources.length ?? 0} · 事件 {store.runtimeState.lastSequence} · 检查点 {store.checkpoints.length}
                </p>
              </div>
              <button
                onClick={() => void run(async () => {
                  const confirmed = await dialog.confirm({
                    title: `删除互动会话“${selected.title}”？`,
                    message: '该会话的全部事件和检查点将一并删除；子分支会保留并解除父会话关联。',
                    confirmText: '删除',
                    tone: 'danger',
                  })
                  if (confirmed) await store.remove(selected.id!)
                })}
                className="rounded p-2 text-danger hover:bg-danger/10"
                title="删除会话"
                aria-label={`删除会话 ${selected.title}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </header>

            {(store.error || actionError) && (
              <div className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {actionError || store.error}
              </div>
            )}

            <section className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-bg-surface p-4">
                <Clock3 className="mb-2 h-4 w-4 text-accent" />
                <div className="text-2xl font-semibold text-text-primary">{store.runtimeState.clock}</div>
                <div className="text-xs text-text-muted">逻辑时间</div>
              </div>
              <div className="rounded-lg border border-border bg-bg-surface p-4">
                <Box className="mb-2 h-4 w-4 text-accent" />
                <div className="text-2xl font-semibold text-text-primary">
                  {Object.keys(store.runtimeState.entities).length}
                </div>
                <div className="text-xs text-text-muted">运行时实体</div>
              </div>
              <div className="rounded-lg border border-border bg-bg-surface p-4">
                <ScrollText className="mb-2 h-4 w-4 text-accent" />
                <div className="text-2xl font-semibold text-text-primary">
                  {store.runtimeState.narratives.length}
                </div>
                <div className="text-xs text-text-muted">叙事记录</div>
              </div>
            </section>

            {narrative && currentNarrativeNode && (
              <section className="rounded-lg border border-accent/30 bg-bg-surface" aria-label="冻结叙事进度">
                <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                      <GitBranch className="h-4 w-4 text-accent" />
                      {narrative.moduleTitle}
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      冻结叙事 · 已访问 {narrative.visitedNodeKeys.length} 个节点
                    </p>
                  </div>
                  <span className={narrative.completed ? 'text-xs text-accent' : 'text-xs text-text-muted'}>
                    {narrative.completed ? '已到达结局' : '进行中'}
                  </span>
                </div>
                <div className="space-y-3 p-4">
                  <div>
                    <div className="text-sm font-medium text-text-primary">{currentNarrativeNode.title}</div>
                    {currentNarrativeNode.summary && <p className="mt-1 text-sm leading-6 text-text-secondary">{currentNarrativeNode.summary}</p>}
                  </div>
                  {!narrative.completed && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {narrativeChoices.map(node => (
                        <button
                          key={node.key}
                          disabled={busy}
                          onClick={() => void run(() => store.advanceNarrative(node.key))}
                          className="rounded border border-border bg-bg-base px-3 py-2 text-left hover:border-accent/50 hover:bg-accent/5 disabled:opacity-40"
                        >
                          <span className="block text-sm font-medium text-text-primary">{node.title}</span>
                          {node.summary && <span className="mt-1 block line-clamp-2 text-xs text-text-muted">{node.summary}</span>}
                        </button>
                      ))}
                      {narrativeChoices.length === 0 && <p className="text-sm text-danger">当前条件下没有可进入的后继节点。</p>}
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="rounded-lg border border-border bg-bg-surface">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  <Snowflake className="h-4 w-4 text-accent" />
                  Canon 冻结审计
                </div>
                {selectedSnapshot && (
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className={snapshotVerified === false ? 'text-danger' : 'text-text-muted'}>
                      {snapshotVerified == null ? '校验中' : snapshotVerified ? '完整' : '校验失败'}
                    </span>
                    <span className="font-mono text-text-muted" title={selectedSnapshot.snapshotHash}>
                      {selectedSnapshot.snapshotHash.slice(0, 12)}
                    </span>
                  </div>
                )}
              </div>
              {selectedSnapshot ? (
                <div className="divide-y divide-border">
                  {selectedSnapshot.sources.map(source => (
                    <div key={source.sourceKey} className="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_1fr_auto] sm:gap-3">
                      <div className="text-xs font-medium text-text-primary">
                        {SOURCE_KIND_LABELS[source.kind]} · {source.name}
                      </div>
                      <div className="min-w-0 text-xs text-text-secondary">
                        <div className="truncate">{source.summary || '未填写摘要'}</div>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-text-muted">
                          {source.sourceKey}
                        </div>
                      </div>
                      <span className="font-mono text-[10px] text-text-muted" title={source.contentHash}>
                        {source.contentHash.slice(0, 10)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-4 py-5 text-sm text-text-muted">旧会话没有结构化冻结审计。</p>
              )}
            </section>

            {selected.kind === 'npc-evolution' && (
              <section className="rounded-lg border border-accent/30 bg-bg-surface">
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                      <Sparkles className="h-4 w-4 text-accent" />
                      NPC 演进候选
                    </div>
                    <p className="mt-1 text-xs text-text-muted">AI 只生成候选；确认后才追加运行时事件，不会修改 Canon。</p>
                  </div>
                  {npcAI.tokenUsage && (
                    <span className="text-[10px] text-text-muted">
                      {npcAI.tokenUsage.inputTokens + npcAI.tokenUsage.outputTokens} tokens
                    </span>
                  )}
                </div>
                <div className="space-y-3 p-4">
                  <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
                    <select
                      value={selectedNpc?.entityKey ?? ''}
                      onChange={event => setNpcTargetKey(event.target.value)}
                      aria-label="选择 NPC"
                      disabled={npcEntities.length === 0 || npcAI.isStreaming}
                      className="rounded border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary disabled:opacity-50"
                    >
                      {npcEntities.length === 0 && <option value="">暂无 NPC 实体</option>}
                      {npcEntities.map(entity => (
                        <option key={entity.entityKey} value={entity.entityKey}>{entity.name}</option>
                      ))}
                    </select>
                    <textarea
                      value={npcRequest}
                      onChange={event => setNpcRequest(event.target.value)}
                      placeholder="描述这次 NPC 演进，例如：经历冲突后变得警惕，并转移到已冻结的地点。"
                      className="min-h-20 rounded border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary"
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      disabled={busy || npcAI.isStreaming || !selectedNpc || npcRequest.trim().length < 2 || !isAIConfigReady(resolveRequestConfig(config, { category: 'simulation.npc-evolution' }).config)}
                      onClick={() => void run(generateNpcEvolution)}
                      className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40"
                    >
                      {npcAI.isStreaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {npcAI.isStreaming ? '生成中…' : '生成演进候选'}
                    </button>
                    {npcAI.error && <span className="text-xs text-danger">{npcAI.error}</span>}
                  </div>
                  {npcAI.output && (
                    <details className="rounded border border-border bg-bg-base px-3 py-2 text-xs">
                      <summary className="cursor-pointer text-text-secondary">本次 AI 原始输出</summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-text-muted">{npcAI.output}</pre>
                    </details>
                  )}
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-text-secondary">待作者确认（已持久化）</div>
                    {store.pendingProposals.map(proposal => {
                      const stale = store.runtimeState.lastSequence > proposal.proposalSequence
                      return (
                        <div key={proposal.proposalSequence} className="rounded border border-border bg-bg-base p-3 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-text-primary">{proposal.entityKey}</span>
                            <span className={stale ? 'text-danger' : 'text-accent'}>{stale ? '已过期' : `提案 #${proposal.proposalSequence}`}</span>
                          </div>
                          <div className="mt-2 grid gap-1 text-xs text-text-secondary sm:grid-cols-2">
                            <span>地点：{proposal.locationKey ?? '不变/无'}</span>
                            <span>生命周期：{proposal.lifecycleStatus}</span>
                            <span className="sm:col-span-2">属性：{Object.entries(proposal.attributes).map(([key, value]) => `${key}=${String(value)}`).join('、') || '无'}</span>
                            {proposal.narrative && <span className="sm:col-span-2">经历：{proposal.narrative}</span>}
                            {proposal.memory && <span className="sm:col-span-2">记忆：{proposal.memory.content}（{proposal.memory.status}）</span>}
                            {proposal.rationale && <span className="sm:col-span-2">理由：{proposal.rationale}</span>}
                          </div>
                          <div className="mt-3 flex gap-2">
                            <button
                              disabled={busy || stale}
                              onClick={() => void run(() => store.acceptNpcEvolution(proposal.proposalSequence))}
                              className="rounded bg-accent px-3 py-1 text-xs text-white disabled:opacity-40"
                            >
                              确认并应用
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => void run(() => store.rejectNpcEvolution(proposal.proposalSequence, '作者拒绝该候选'))}
                              className="rounded border border-border px-3 py-1 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                            >
                              拒绝
                            </button>
                          </div>
                        </div>
                      )
                    })}
                    {store.pendingProposals.length === 0 && (
                      <p className="text-xs text-text-muted">暂无待确认候选</p>
                    )}
                  </div>
                </div>
              </section>
            )}

            {selected.kind === 'ttrpg' && (
              <section className="rounded-lg border border-accent/30 bg-bg-surface">
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                      <Dices className="h-4 w-4 text-accent" />
                      单机战役主持
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      玩家动作、确定性检定和 AI GM 叙事会作为一个可回放回合记录；AI 不直接修改运行时状态。
                    </p>
                  </div>
                  {ttrpgAI.tokenUsage && (
                    <span className="text-[10px] text-text-muted">
                      {ttrpgAI.tokenUsage.inputTokens + ttrpgAI.tokenUsage.outputTokens} tokens
                    </span>
                  )}
                </div>
                <div className="space-y-4 p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <input
                        value={ttrpgSceneTitle}
                        onChange={event => setTtrpgSceneTitle(event.target.value)}
                        placeholder="场景标题"
                        aria-label="跑团场景标题"
                        className="w-full rounded border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary"
                      />
                      <textarea
                        value={ttrpgSceneDescription}
                        onChange={event => setTtrpgSceneDescription(event.target.value)}
                        placeholder="场景描述与当前目标"
                        aria-label="跑团场景描述"
                        className="min-h-16 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary"
                      />
                    </div>
                    <div className="space-y-2">
                      <select
                        value={ttrpgSceneLocationKey}
                        onChange={event => setTtrpgSceneLocationKey(event.target.value)}
                        aria-label="跑团场景地点"
                        className="w-full rounded border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary"
                      >
                        <option value="">不绑定地点</option>
                        {Object.values(store.runtimeState.entities)
                          .filter(entity => entity.kind === 'location')
                          .map(entity => <option key={entity.entityKey} value={entity.entityKey}>{entity.name}</option>)}
                      </select>
                      <input
                        value={ttrpgTurnOrderText}
                        onChange={event => setTtrpgTurnOrderText(event.target.value)}
                        placeholder="回合顺序：角色键，用逗号分隔"
                        aria-label="跑团回合顺序"
                        className="w-full rounded border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary"
                      />
                      <button
                        disabled={busy || !ttrpgSceneTitle.trim() || !ttrpgTurnOrderText.trim()}
                        onClick={() => void run(async () => {
                          await store.openTtrpgScene({
                            title: ttrpgSceneTitle,
                            description: ttrpgSceneDescription,
                            locationKey: ttrpgSceneLocationKey || null,
                            turnOrder: ttrpgTurnOrderText.split(/[,，\n]/).map(value => value.trim()).filter(Boolean),
                          })
                        })}
                        className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40"
                      >
                        开始场景
                      </button>
                    </div>
                  </div>

                  {store.runtimeState.ttrpg?.scene && (
                    <div className="rounded border border-border bg-bg-base px-3 py-2 text-xs text-text-secondary">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium text-text-primary">{store.runtimeState.ttrpg.scene.title}</span>
                        <span>第 {store.runtimeState.ttrpg.round} 回合</span>
                        <span>当前：{store.runtimeState.entities[store.runtimeState.ttrpg.activeActorKey ?? '']?.name ?? store.runtimeState.ttrpg.activeActorKey ?? '无'}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap">{store.runtimeState.ttrpg.scene.description || '未填写场景描述'}</p>
                      <div className="mt-1 text-[10px] text-text-muted">
                        顺序：{store.runtimeState.ttrpg.turnOrder.map(key => store.runtimeState.entities[key]?.name ?? key).join(' → ')}
                      </div>
                    </div>
                  )}

                  <section className="rounded border border-accent/30 bg-bg-base p-3" data-testid="ttrpg-combat-panel">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                          <Dices className="h-4 w-4 text-accent" />
                          战斗遭遇与规则
                        </div>
                        <p className="mt-1 text-xs text-text-muted">先攻、攻击骰、资源和状态效果都由事件回放；AI 只提供遭遇描述候选。</p>
                      </div>
                      {encounterAI.tokenUsage && (
                        <span className="text-[10px] text-text-muted">
                          AI {encounterAI.tokenUsage.inputTokens + encounterAI.tokenUsage.outputTokens} tokens
                        </span>
                      )}
                    </div>

                    {!combatEncounter || combatEncounter.status === 'resolved' ? (
                      <div className="mt-3 space-y-3">
                        <div className="grid gap-2 md:grid-cols-2">
                          <input
                            value={ttrpgEncounterTitle}
                            onChange={event => setTtrpgEncounterTitle(event.target.value)}
                            placeholder="遭遇标题，例如：雾港伏击"
                            aria-label="跑团遭遇标题"
                            className="rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary"
                          />
                          <textarea
                            value={ttrpgEncounterDescription}
                            onChange={event => setTtrpgEncounterDescription(event.target.value)}
                            placeholder="战斗环境、目标和胜负条件"
                            aria-label="跑团遭遇描述"
                            className="min-h-16 rounded border border-border bg-bg-surface px-2 py-1.5 text-sm text-text-primary"
                          />
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-text-secondary">参与者（先攻由固定种子计算）</div>
                          <div className="flex flex-wrap gap-2">
                            {ttrpgActors.map(entity => (
                              <label key={entity.entityKey} className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-text-secondary">
                                <input
                                  type="checkbox"
                                  checked={ttrpgParticipantKeys.includes(entity.entityKey)}
                                  onChange={() => setTtrpgParticipantKeys(current => current.includes(entity.entityKey)
                                    ? current.filter(key => key !== entity.entityKey)
                                    : [...current, entity.entityKey])}
                                  aria-label={`遭遇参与者 ${entity.name}`}
                                />
                                {entity.name}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            disabled={busy || !store.runtimeState.ttrpg?.scene || ttrpgParticipantKeys.length < 2 || !ttrpgEncounterTitle.trim() || !ttrpgEncounterDescription.trim()}
                            onClick={() => void run(() => store.startTtrpgEncounter({
                              baseSequence: store.runtimeState.lastSequence,
                              title: ttrpgEncounterTitle,
                              description: ttrpgEncounterDescription,
                              participantKeys: ttrpgParticipantKeys,
                            }))}
                            className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40"
                          >
                            直接开始遭遇
                          </button>
                          <button
                            disabled={busy || encounterAI.isStreaming || !store.runtimeState.ttrpg?.scene || ttrpgParticipantKeys.length < 2 || !isAIConfigReady(resolveRequestConfig(config, { category: 'simulation.ttrpg-encounter' }).config)}
                            onClick={() => void run(generateTtrpgEncounter)}
                            className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                          >
                            {encounterAI.isStreaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                            {encounterAI.isStreaming ? '生成中…' : '生成 AI 遭遇候选'}
                          </button>
                        </div>
                        {encounterAI.error && <span className="text-xs text-danger">{encounterAI.error}</span>}
                        {ttrpgEncounterCandidate && (
                          <div className="rounded border border-accent/30 bg-bg-surface p-3 text-sm">
                            <div className="font-medium text-text-primary">{ttrpgEncounterCandidate.title}</div>
                            <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">{ttrpgEncounterCandidate.description}</p>
                            <div className="mt-1 text-[10px] text-text-muted">参与者：{ttrpgEncounterCandidate.participantKeys.join('、')} · 基线 #{ttrpgEncounterCandidate.baseSequence}</div>
                            <div className="mt-3 flex gap-2">
                              <button
                                disabled={busy || store.runtimeState.lastSequence !== ttrpgEncounterCandidate.baseSequence}
                                onClick={() => void run(async () => {
                                  await store.startTtrpgEncounter(ttrpgEncounterCandidate)
                                  setTtrpgEncounterCandidate(null)
                                })}
                                className="rounded bg-accent px-3 py-1 text-xs text-white disabled:opacity-40"
                              >
                                确认并开始
                              </button>
                              <button disabled={busy} onClick={() => setTtrpgEncounterCandidate(null)} className="rounded border border-border px-3 py-1 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-40">丢弃候选</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3">
                        <div className="rounded border border-border bg-bg-surface px-3 py-2 text-xs text-text-secondary">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="font-medium text-text-primary">{combatEncounter.title}</span>
                            <span>战斗第 {combatEncounter.round} 回合</span>
                            <span>当前：{store.runtimeState.entities[combatEncounter.activeActorKey ?? '']?.name ?? combatEncounter.activeActorKey ?? '无'}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap">{combatEncounter.description}</p>
                          <button
                            disabled={busy}
                            onClick={() => void run(() => store.resolveTtrpgEncounter('作者结束遭遇'))}
                            className="mt-2 rounded border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                          >
                            结束遭遇
                          </button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {combatEncounter.turnOrder.map(entityKey => {
                            const combatant = combatEncounter.combatants[entityKey]
                            const entity = store.runtimeState.entities[entityKey]
                            if (!combatant || !entity) return null
                            const hp = combatant.resources.hp
                            return (
                              <div key={entityKey} className={`rounded border px-3 py-2 text-xs ${combatEncounter.activeActorKey === entityKey ? 'border-accent bg-accent/5' : 'border-border bg-bg-surface'}`}>
                                <div className="flex items-center justify-between gap-2"><span className="font-medium text-text-primary">{entity.name}</span><span className="text-text-muted">先攻 {combatant.initiative} · AC {combatant.armorClass}</span></div>
                                <div className="mt-1">HP {hp.current}/{hp.maximum} · {Object.entries(combatant.resources).filter(([key]) => key !== 'hp').map(([key, resource]) => `${key} ${resource.current}/${resource.maximum}`).join(' · ') || '无额外资源'}</div>
                                <div className="mt-1 text-text-muted">状态：{combatant.conditions.map(condition => `${condition.name}${condition.stacks > 1 ? `×${condition.stacks}` : ''}${condition.duration != null ? `(${condition.duration}回合)` : ''}`).join('、') || '无'}</div>
                              </div>
                            )
                          })}
                        </div>
                        <div className="grid gap-2 md:grid-cols-[8rem_8rem_7rem_1fr_auto]">
                          <select value={ttrpgActorKey} onChange={event => setTtrpgActorKey(event.target.value)} aria-label="战斗攻击者" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary">
                            {combatTargetEntities.map(entity => <option key={entity.entityKey} value={entity.entityKey}>{entity.name}</option>)}
                          </select>
                          <select value={ttrpgAttackTargetKey} onChange={event => setTtrpgAttackTargetKey(event.target.value)} aria-label="战斗攻击目标" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary">
                            {combatTargetEntities.filter(entity => entity.entityKey !== ttrpgActorKey).map(entity => <option key={entity.entityKey} value={entity.entityKey}>{entity.name}</option>)}
                          </select>
                          <input value={ttrpgAttackExpression} onChange={event => setTtrpgAttackExpression(event.target.value)} aria-label="攻击骰式" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary" />
                          <input value={ttrpgDamageExpression} onChange={event => setTtrpgDamageExpression(event.target.value)} aria-label="伤害骰式" placeholder="伤害骰式，可空" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary" />
                          <button disabled={busy || combatEncounter.activeActorKey !== ttrpgActorKey || !ttrpgAttackTargetKey} onClick={() => void run(() => store.resolveTtrpgAttack({ actorKey: ttrpgActorKey, targetKey: ttrpgAttackTargetKey, attackExpression: ttrpgAttackExpression, damageExpression: ttrpgDamageExpression || null, resourceKey: ttrpgResourceKey, reason: ttrpgAttackReason }))} className="rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-40">执行攻击</button>
                        </div>
                        <input value={ttrpgAttackReason} onChange={event => setTtrpgAttackReason(event.target.value)} aria-label="攻击说明" placeholder="攻击说明（可选）" className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary" />
                        <div className="grid gap-2 md:grid-cols-[8rem_7rem_6rem_1fr_auto]">
                          <select value={ttrpgResourceEntityKey} onChange={event => setTtrpgResourceEntityKey(event.target.value)} aria-label="资源目标" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary">
                            {combatTargetEntities.map(entity => <option key={entity.entityKey} value={entity.entityKey}>{entity.name}</option>)}
                          </select>
                          <input value={ttrpgResourceName} onChange={event => setTtrpgResourceName(event.target.value)} aria-label="资源名称" placeholder="资源名" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary" />
                          <input value={ttrpgResourceDelta} onChange={event => setTtrpgResourceDelta(event.target.value)} aria-label="资源变化" placeholder="变化量" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary" />
                          <span className="self-center text-[10px] text-text-muted">手动调整已登记资源（不会超过 0 / 上限）</span>
                          <button disabled={busy || !ttrpgResourceEntityKey || !ttrpgResourceName.trim()} onClick={() => void run(() => store.changeTtrpgResource({ entityKey: ttrpgResourceEntityKey, resourceKey: ttrpgResourceName, delta: Number(ttrpgResourceDelta), reason: '作者手动调整' }))} className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-40">调整资源</button>
                        </div>
                        <div className="grid gap-2 md:grid-cols-[8rem_7rem_6rem_1fr_auto]">
                          <select value={ttrpgConditionEntityKey} onChange={event => setTtrpgConditionEntityKey(event.target.value)} aria-label="状态目标" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary">
                            {combatTargetEntities.map(entity => <option key={entity.entityKey} value={entity.entityKey}>{entity.name}</option>)}
                          </select>
                          <input value={ttrpgConditionName} onChange={event => setTtrpgConditionName(event.target.value)} aria-label="状态名称" placeholder="状态名称" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary" />
                          <input value={ttrpgConditionDuration} onChange={event => setTtrpgConditionDuration(event.target.value)} aria-label="状态持续回合" placeholder="回合数" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary" />
                          <input value={ttrpgConditionDescription} onChange={event => setTtrpgConditionDescription(event.target.value)} aria-label="状态说明" placeholder="状态效果说明（可选）" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary" />
                          <button disabled={busy || !ttrpgConditionEntityKey || !ttrpgConditionName.trim()} onClick={() => void run(() => store.applyTtrpgCondition({ entityKey: ttrpgConditionEntityKey, condition: { conditionId: `manual:${Date.now()}`, name: ttrpgConditionName, description: ttrpgConditionDescription, duration: Number(ttrpgConditionDuration) > 0 ? Number(ttrpgConditionDuration) : null, stacks: 1 } }))} className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-40">施加状态</button>
                        </div>
                        <div className="grid gap-2 md:grid-cols-[8rem_1fr_auto]">
                          <select value={ttrpgConditionEntityKey} onChange={event => setTtrpgConditionEntityKey(event.target.value)} aria-label="移除状态目标" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary">
                            {combatTargetEntities.map(entity => <option key={entity.entityKey} value={entity.entityKey}>{entity.name}</option>)}
                          </select>
                          <select aria-label="移除状态" defaultValue="" onChange={event => { if (event.target.value) void run(() => store.removeTtrpgCondition({ entityKey: ttrpgConditionEntityKey, conditionId: event.target.value })) }} className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary">
                            <option value="">选择要移除的状态</option>
                            {(combatEncounter.combatants[ttrpgConditionEntityKey]?.conditions ?? []).map(condition => <option key={condition.conditionId} value={condition.conditionId}>{condition.name}</option>)}
                          </select>
                          <span className="self-center text-[10px] text-text-muted">状态持续回合在该行动者结束回合时递减</span>
                        </div>
                      </div>
                    )}
                  </section>

                  <div className="grid gap-3 md:grid-cols-[12rem_1fr]">
                    <select
                      value={selectedTtrpgActor?.entityKey ?? ''}
                      onChange={event => setTtrpgActorKey(event.target.value)}
                      aria-label="跑团行动者"
                      disabled={ttrpgActors.length === 0 || ttrpgAI.isStreaming}
                      className="rounded border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary disabled:opacity-50"
                    >
                      {ttrpgActors.length === 0 && <option value="">暂无角色实体</option>}
                      {ttrpgActors.map(entity => <option key={entity.entityKey} value={entity.entityKey}>{entity.name}</option>)}
                    </select>
                    <textarea
                      value={ttrpgAction}
                      onChange={event => setTtrpgAction(event.target.value)}
                      placeholder="描述当前行动，例如：我检查石门上的潮汐刻痕。"
                      aria-label="跑团玩家动作"
                      className="min-h-16 rounded border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      disabled={busy || ttrpgAI.isStreaming || !store.runtimeState.ttrpg?.scene || !selectedTtrpgActor || !ttrpgAction.trim() || !isAIConfigReady(resolveRequestConfig(config, { category: 'simulation.ttrpg-gm' }).config)}
                      onClick={() => void run(generateTtrpgTurn)}
                      className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40"
                    >
                      {ttrpgAI.isStreaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {ttrpgAI.isStreaming ? 'GM 生成中…' : '请求 AI GM'}
                    </button>
                    {ttrpgAI.error && <span className="text-xs text-danger">{ttrpgAI.error}</span>}
                  </div>
                  {ttrpgAI.output && (
                    <details className="rounded border border-border bg-bg-base px-3 py-2 text-xs">
                      <summary className="cursor-pointer text-text-secondary">本次 GM 原始输出</summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-text-muted">{ttrpgAI.output}</pre>
                    </details>
                  )}
                  {ttrpgCandidate && (
                    <div className="rounded border border-accent/30 bg-bg-base p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-text-primary">待记录回合</span>
                        <span className="text-[10px] text-text-muted">基线事件 #{ttrpgCandidate.baseSequence}</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-text-secondary">{ttrpgCandidate.narrative}</p>
                      {ttrpgCandidate.check && ttrpgCandidate.outcomes && (
                        <div className="mt-2 space-y-1 text-xs text-text-secondary">
                          <div>检定：{ttrpgCandidate.check.skill} · {ttrpgCandidate.check.expression} · DC {ttrpgCandidate.check.dc}</div>
                          <div>成功：{ttrpgCandidate.outcomes.success}</div>
                          <div>失败：{ttrpgCandidate.outcomes.failure}</div>
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button
                          disabled={busy || store.runtimeState.lastSequence !== ttrpgCandidate.baseSequence}
                          onClick={() => void run(async () => {
                            await store.recordTtrpgTurn(ttrpgCandidate)
                            setTtrpgCandidate(null)
                            setTtrpgAction('')
                          })}
                          className="rounded bg-accent px-3 py-1 text-xs text-white disabled:opacity-40"
                        >
                          记录回合
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => setTtrpgCandidate(null)}
                          className="rounded border border-border px-3 py-1 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                        >
                          丢弃候选
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-2 sm:grid-cols-[8rem_6rem_6rem_auto]">
                    <input
                      value={ttrpgSkill}
                      onChange={event => setTtrpgSkill(event.target.value)}
                      placeholder="技能"
                      aria-label="跑团检定技能"
                      className="rounded border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary"
                    />
                    <input
                      value={ttrpgExpression}
                      onChange={event => setTtrpgExpression(event.target.value)}
                      aria-label="跑团技能表达式"
                      className="rounded border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary"
                    />
                    <input
                      value={ttrpgDc}
                      onChange={event => setTtrpgDc(event.target.value)}
                      aria-label="跑团检定难度"
                      className="rounded border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary"
                    />
                    <button
                      disabled={busy || !store.runtimeState.ttrpg?.scene || !selectedTtrpgActor || !ttrpgSkill.trim()}
                      onClick={() => void run(() => store.resolveTtrpgCheck({
                        actorKey: selectedTtrpgActor?.entityKey ?? '',
                        skill: ttrpgSkill,
                        expression: ttrpgExpression,
                        dc: Number(ttrpgDc),
                      }))}
                      className="rounded border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                    >
                      技能检定
                    </button>
                  </div>
                </div>
              </section>
            )}

            {selected.kind === 'ttrpg' && (
              <section className="rounded-lg border border-accent/30 bg-bg-surface" data-testid="ttrpg-campaign-panel">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <CalendarClock className="h-4 w-4 text-accent" />
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">长期战役</h3>
                    <p className="mt-1 text-xs text-text-muted">战役摘要、任务和 NPC 日程跟随运行时事件流，可在分支会话中继续推进。</p>
                  </div>
                </div>
                <div className="space-y-4 p-4">
                  <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-text-secondary" htmlFor="ttrpg-campaign-summary">战役摘要</label>
                      <textarea
                        id="ttrpg-campaign-summary"
                        value={campaignSummary}
                        onChange={event => setCampaignSummary(event.target.value)}
                        placeholder="记录跨场景、跨会话需要保留的剧情进展、未决冲突和下一步节奏。"
                        className="min-h-28 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-sm text-text-primary"
                      />
                      <button
                        disabled={busy || campaignSummary === campaign.summary}
                        onClick={() => void run(() => store.updateTtrpgCampaignSummary(campaignSummary, store.runtimeState.lastSequence))}
                        className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40"
                      >
                        保存摘要
                      </button>
                    </div>
                    <div className="rounded border border-border bg-bg-base p-3">
                      <div className="flex items-center justify-between gap-2 text-xs font-medium text-text-secondary">
                        <span>世界时间</span>
                        <span className="font-mono text-accent">T+{store.runtimeState.clock}</span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-text-muted">推进时间后，任务期限和 NPC 日程会按同一个运行时时钟重新计算。</p>
                      <div className="mt-3 text-xs text-text-secondary">当前活动日程：{activeCampaignSchedules.length} 条</div>
                      {activeCampaignSchedules.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {activeCampaignSchedules.map(schedule => (
                            <div key={schedule.scheduleId} className="rounded bg-bg-surface px-2 py-1 text-xs text-text-secondary">
                              {store.runtimeState.entities[schedule.entityKey]?.name ?? schedule.entityKey}：{schedule.activity}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2 rounded border border-border bg-bg-base p-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><ClipboardList className="h-4 w-4 text-accent" />任务管理</div>
                      <input value={campaignQuestId} onChange={event => setCampaignQuestId(event.target.value)} placeholder="任务 ID（用于更新同一任务）" aria-label="战役任务 ID" className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-sm" />
                      <input value={campaignQuestTitle} onChange={event => setCampaignQuestTitle(event.target.value)} placeholder="任务标题" aria-label="战役任务标题" className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-sm" />
                      <textarea value={campaignQuestDescription} onChange={event => setCampaignQuestDescription(event.target.value)} placeholder="任务目标、阻碍和完成条件" aria-label="战役任务描述" className="min-h-16 w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-sm" />
                      <div className="grid gap-2 sm:grid-cols-3">
                        <select value={campaignQuestStatus} onChange={event => setCampaignQuestStatus(event.target.value as typeof campaignQuestStatus)} aria-label="战役任务状态" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-sm">
                          <option value="active">进行中</option><option value="paused">暂停</option><option value="completed">已完成</option><option value="failed">已失败</option>
                        </select>
                        <input type="number" min="0" max="5" value={campaignQuestPriority} onChange={event => setCampaignQuestPriority(event.target.value)} placeholder="优先级" aria-label="战役任务优先级" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-sm" />
                        <input type="number" min="0" value={campaignQuestDueClock} onChange={event => setCampaignQuestDueClock(event.target.value)} placeholder="期限 T+（可空）" aria-label="战役任务期限" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-sm" />
                      </div>
                      <button
                        disabled={busy || !campaignQuestId.trim() || !campaignQuestTitle.trim()}
                        onClick={() => void run(async () => {
                          await store.upsertTtrpgQuest({
                            questId: campaignQuestId,
                            title: campaignQuestTitle,
                            description: campaignQuestDescription,
                            status: campaignQuestStatus,
                            priority: Number(campaignQuestPriority),
                            dueClock: campaignQuestDueClock.trim() ? Number(campaignQuestDueClock) : null,
                          })
                          setCampaignQuestId(''); setCampaignQuestTitle(''); setCampaignQuestDescription('');
                        })}
                        className="rounded border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                      >
                        保存任务
                      </button>
                      <div className="max-h-40 space-y-1 overflow-y-auto">
                        {campaign.quests.map(quest => (
                          <button key={quest.questId} type="button" onClick={() => { setCampaignQuestId(quest.questId); setCampaignQuestTitle(quest.title); setCampaignQuestDescription(quest.description); setCampaignQuestStatus(quest.status); setCampaignQuestPriority(String(quest.priority)); setCampaignQuestDueClock(quest.dueClock == null ? '' : String(quest.dueClock)) }} className="flex w-full items-center gap-2 rounded bg-bg-surface px-2 py-1.5 text-left text-xs hover:bg-bg-hover">
                            <span className="flex-1 truncate text-text-secondary">{quest.title}</span><span className="text-text-muted">{quest.status}</span>{quest.dueClock != null && <span className="text-text-muted">T+{quest.dueClock}</span>}
                          </button>
                        ))}
                        {campaign.quests.length === 0 && <p className="text-xs text-text-muted">还没有战役任务。</p>}
                      </div>
                    </div>

                    <div className="space-y-2 rounded border border-border bg-bg-base p-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><CalendarClock className="h-4 w-4 text-accent" />NPC 日程</div>
                      <input value={campaignScheduleId} onChange={event => setCampaignScheduleId(event.target.value)} placeholder="日程 ID（用于更新同一日程）" aria-label="NPC 日程 ID" className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-sm" />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <select value={campaignScheduleEntityKey} onChange={event => setCampaignScheduleEntityKey(event.target.value)} aria-label="NPC 日程角色" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-sm">
                          <option value="">选择 NPC</option>{campaignNpcs.map(entity => <option key={entity.entityKey} value={entity.entityKey}>{entity.name}</option>)}
                        </select>
                        <select value={campaignScheduleLocationKey} onChange={event => setCampaignScheduleLocationKey(event.target.value)} aria-label="NPC 日程地点" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-sm">
                          <option value="">不绑定地点</option>{Object.values(store.runtimeState.entities).filter(entity => entity.kind === 'location').map(entity => <option key={entity.entityKey} value={entity.entityKey}>{entity.name}</option>)}
                        </select>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <input type="number" min="0" value={campaignScheduleStartClock} onChange={event => setCampaignScheduleStartClock(event.target.value)} placeholder="开始 T+" aria-label="NPC 日程开始时间" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-sm" />
                        <input type="number" min="0" value={campaignScheduleEndClock} onChange={event => setCampaignScheduleEndClock(event.target.value)} placeholder="结束 T+（可空）" aria-label="NPC 日程结束时间" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-sm" />
                        <select value={campaignScheduleRecurrence} onChange={event => setCampaignScheduleRecurrence(event.target.value as typeof campaignScheduleRecurrence)} aria-label="NPC 日程重复方式" className="rounded border border-border bg-bg-surface px-2 py-1.5 text-sm">
                          <option value="once">一次</option><option value="daily">每日</option><option value="weekly">每周</option>
                        </select>
                      </div>
                      <input value={campaignScheduleActivity} onChange={event => setCampaignScheduleActivity(event.target.value)} placeholder="活动，例如：在码头巡逻" aria-label="NPC 日程活动" className="w-full rounded border border-border bg-bg-surface px-2 py-1.5 text-sm" />
                      <button
                        disabled={busy || !campaignScheduleId.trim() || !campaignScheduleEntityKey || !campaignScheduleActivity.trim()}
                        onClick={() => void run(async () => {
                          await store.upsertTtrpgNpcSchedule({
                            scheduleId: campaignScheduleId,
                            entityKey: campaignScheduleEntityKey,
                            startClock: Number(campaignScheduleStartClock),
                            endClock: campaignScheduleEndClock.trim() ? Number(campaignScheduleEndClock) : null,
                            locationKey: campaignScheduleLocationKey || null,
                            activity: campaignScheduleActivity,
                            recurrence: campaignScheduleRecurrence,
                          })
                          setCampaignScheduleId(''); setCampaignScheduleActivity('')
                        })}
                        className="rounded border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                      >
                        保存日程
                      </button>
                      <div className="max-h-40 space-y-1 overflow-y-auto">
                        {campaign.npcSchedules.map(schedule => (
                          <button key={schedule.scheduleId} type="button" onClick={() => { setCampaignScheduleId(schedule.scheduleId); setCampaignScheduleEntityKey(schedule.entityKey); setCampaignScheduleStartClock(String(schedule.startClock)); setCampaignScheduleEndClock(schedule.endClock == null ? '' : String(schedule.endClock)); setCampaignScheduleLocationKey(schedule.locationKey ?? ''); setCampaignScheduleActivity(schedule.activity); setCampaignScheduleRecurrence(schedule.recurrence) }} className="flex w-full items-center gap-2 rounded bg-bg-surface px-2 py-1.5 text-left text-xs hover:bg-bg-hover">
                            <span className="flex-1 truncate text-text-secondary">{store.runtimeState.entities[schedule.entityKey]?.name ?? schedule.entityKey}：{schedule.activity}</span><span className="text-text-muted">T+{schedule.startClock}</span>
                          </button>
                        ))}
                        {campaign.npcSchedules.length === 0 && <p className="text-xs text-text-muted">还没有 NPC 日程。</p>}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-3 rounded-lg border border-border bg-bg-surface p-4">
                <h3 className="text-sm font-semibold text-text-primary">确定性动作</h3>
                <div className="flex gap-2">
                  <input
                    value={timeAmount}
                    onChange={event => setTimeAmount(event.target.value)}
                    aria-label="推进时间"
                    className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1.5 text-sm"
                  />
                  <button
                    disabled={busy}
                    onClick={() => void run(() => store.advanceTime(Number(timeAmount)))}
                    className="rounded border border-border px-3 py-1.5 text-sm hover:bg-bg-hover"
                  >
                    推进时间
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    value={dice}
                    onChange={event => setDice(event.target.value)}
                    aria-label="骰式"
                    className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1.5 text-sm"
                  />
                  <button
                    disabled={busy}
                    onClick={() => void run(() => store.rollDice(dice))}
                    className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-sm hover:bg-bg-hover"
                  >
                    <Dices className="h-3.5 w-3.5" />
                    判定
                  </button>
                </div>
                <textarea
                  value={narrativeText}
                  onChange={event => setNarrativeText(event.target.value)}
                  placeholder="记录只属于该会话的叙事…"
                  className="min-h-20 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-sm"
                />
                <button
                  disabled={busy || !narrativeText.trim()}
                  onClick={() => void run(async () => {
                    await store.recordNarrative(narrativeText)
                    setNarrativeText('')
                  })}
                  className="rounded border border-border px-3 py-1.5 text-sm hover:bg-bg-hover disabled:opacity-40"
                >
                  追加叙事事件
                </button>
              </div>

              <div className="space-y-3 rounded-lg border border-border bg-bg-surface p-4">
                <h3 className="text-sm font-semibold text-text-primary">存档与分支</h3>
                <div className="flex gap-2">
                  <input
                    value={checkpointName}
                    onChange={event => setCheckpointName(event.target.value)}
                    placeholder="检查点名称"
                    className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1.5 text-sm"
                  />
                  <button
                    disabled={busy}
                    onClick={() => void run(async () => {
                      await store.checkpoint(checkpointName)
                      setCheckpointName('')
                    })}
                    className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-sm hover:bg-bg-hover"
                  >
                    <Save className="h-3.5 w-3.5" />
                    保存
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    value={branchTitle}
                    onChange={event => setBranchTitle(event.target.value)}
                    placeholder="新分支名称"
                    className="min-w-0 flex-1 rounded border border-border bg-bg-base px-2 py-1.5 text-sm"
                  />
                  <button
                    disabled={busy || !branchTitle.trim()}
                    onClick={() => void run(async () => {
                      await store.branch(branchTitle)
                      setBranchTitle('')
                    })}
                    className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-sm hover:bg-bg-hover disabled:opacity-40"
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                    分支
                  </button>
                </div>
                <div className="space-y-2">
                  {store.checkpoints.map(checkpoint => (
                    <div key={checkpoint.id} className="flex items-center gap-2 rounded bg-bg-base px-2 py-1.5 text-xs">
                      <CopyPlus className="h-3.5 w-3.5 text-text-muted" />
                      <span className="flex-1 truncate">{checkpoint.name}</span>
                      <span className="text-text-muted">#{checkpoint.throughSequence}</span>
                      <button
                        disabled={busy}
                        onClick={() => void run(() => store.restoreCheckpoint(checkpoint.id!))}
                        className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-accent disabled:opacity-40"
                        title="从检查点建立恢复分支"
                        aria-label={`恢复检查点 ${checkpoint.name}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {store.checkpoints.length === 0 && (
                    <p className="text-xs text-text-muted">暂无检查点</p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-border bg-bg-surface">
              <div className="border-b border-border px-4 py-3 text-sm font-semibold text-text-primary">
                运行时实体
              </div>
              <div className="divide-y divide-border">
                {Object.values(store.runtimeState.entities).map(entity => (
                  <div key={entity.entityKey} className="grid gap-2 px-4 py-3 sm:grid-cols-[10rem_8rem_1fr]">
                    <div>
                      <div className="text-sm font-medium text-text-primary">{entity.name}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-text-muted">{entity.entityKey}</div>
                    </div>
                    <div className="text-xs text-text-secondary">
                      {entity.kind} · {entity.lifecycleStatus}
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
                      {Object.entries(entity.attributes).map(([key, value]) => (
                        <span key={key} className="max-w-full break-words">{key}: {String(value)}</span>
                      ))}
                    </div>
                  </div>
                ))}
                {Object.keys(store.runtimeState.entities).length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-text-muted">暂无运行时实体</p>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-bg-surface">
              <div className="border-b border-border px-4 py-3">
                <div className="text-sm font-semibold text-text-primary">当前叙事状态</div>
                <p className="mt-0.5 text-xs text-text-muted">
                  包含从父会话继承的叙事；下方事件日志只记录当前会话自身追加的事件。
                </p>
              </div>
              <div className="divide-y divide-border">
                {store.runtimeState.narratives.map((narrativeItem, index) => (
                  <div
                    key={`${narrativeItem.eventSequence}-${index}`}
                    className="flex gap-3 px-4 py-3 text-sm"
                  >
                    <span className="w-10 shrink-0 font-mono text-xs text-text-muted">
                      #{narrativeItem.eventSequence}
                    </span>
                    <span className="min-w-0 flex-1 break-words text-text-secondary">
                      {narrativeItem.text}
                    </span>
                  </div>
                ))}
                {store.runtimeState.narratives.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-text-muted">暂无叙事状态</p>
                )}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-bg-surface">
              <div className="border-b border-border px-4 py-3 text-sm font-semibold text-text-primary">
                追加事件日志
              </div>
              <div className="divide-y divide-border">
                {[...store.events].reverse().map(event => (
                  <div key={event.id} className="flex gap-3 px-4 py-3 text-sm">
                    <span className="w-10 shrink-0 font-mono text-xs text-text-muted">#{event.sequence}</span>
                    <span className="w-32 shrink-0 text-xs text-accent">{event.type}</span>
                    <span className="min-w-0 flex-1 break-words text-text-secondary">
                      {eventSummary(event.type, event.payloadJson)}
                    </span>
                  </div>
                ))}
                {store.events.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-text-muted">尚无事件</p>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
