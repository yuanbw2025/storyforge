import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  appendAgentEvent,
  getOrCreateAgentConversation,
  readAgentEvents,
  updateAgentEventCandidate,
} from '../../lib/agent/conversations'
import {
  adoptMasterCandidate,
  createMasterAgentPlan,
  executeMasterAgentPlan,
  type ExecutedMasterCandidate,
  type PinnedMasterAgentTaskV1,
  type MasterCandidatePayload,
} from '../../lib/agent/orchestrator'
import {
  findResumableMasterAgentRunV1,
  isMasterAgentDurableHarnessEnabledV1,
  runDurableMasterAgentPlanV1,
} from '../../lib/agent/run/master-durable'
import {
  commitMasterAgentCandidateAdoptionV1,
  recoverPendingMasterAgentAdoptionsV1,
  rejectMasterAgentCandidateV1,
} from '../../lib/agent/run/master-adoption'
import { verifyMasterAgentRunV1 } from '../../lib/agent/run/master-verification'
import type { AgentEvent, Project, WorkspaceScope } from '../../lib/types'
import { parseAgentEventPayload } from '../../lib/types'
import { AgentTeamBudgetTracker } from '../../lib/agent/team-budget'
import { useAIConfigStore } from '../../stores/ai-config'
import { revalidateStoryArcCreativeDraftV1 } from '../../lib/agent/story-arc-copilot'
import { revalidateOutlineCreativeDraftV1 } from '../../lib/agent/outline-copilot'
import { revalidateProseCreativeDraftV1 } from '../../lib/agent/prose-copilot'

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return '操作失败，请稍后重试。'
}

const MASTER_COPILOT_SYNC_EVENT = 'storyforge:master-copilot-sync-v1'
const MASTER_COPILOT_SCOPE_OWNERS = new Map<string, symbol>()

interface MasterCopilotSyncDetail {
  scopeKey: string
  busy: boolean
}

function notifyMasterCopilotSync(scopeKey: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<MasterCopilotSyncDetail>(MASTER_COPILOT_SYNC_EVENT, {
    detail: {
      scopeKey,
      busy: MASTER_COPILOT_SCOPE_OWNERS.has(scopeKey),
    },
  }))
}

function claimMasterCopilotScope(scopeKey: string): symbol | null {
  if (MASTER_COPILOT_SCOPE_OWNERS.has(scopeKey)) return null
  const owner = Symbol(scopeKey)
  MASTER_COPILOT_SCOPE_OWNERS.set(scopeKey, owner)
  notifyMasterCopilotSync(scopeKey)
  return owner
}

function releaseMasterCopilotScope(scopeKey: string, owner: symbol): void {
  if (MASTER_COPILOT_SCOPE_OWNERS.get(scopeKey) !== owner) return
  MASTER_COPILOT_SCOPE_OWNERS.delete(scopeKey)
  notifyMasterCopilotSync(scopeKey)
}

export interface PendingMasterCandidate {
  event: AgentEvent
  payload: MasterCandidatePayload
}

export function useMasterCopilot(input: {
  project: Project
  worldGroupId: number | null
}) {
  const { project, worldGroupId } = input
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [authorRequest, setAuthorRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [recoveryAvailable, setRecoveryAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const runtimeCandidates = useRef(new Map<number, ExecutedMasterCandidate>())
  const workspaceScope = useMemo<WorkspaceScope | undefined>(() => (
    project.id != null && project.activeWorldId != null && project.activeWorkId != null
      ? { projectId: project.id, worldId: project.activeWorldId, workId: project.activeWorkId }
      : undefined
  ), [project.activeWorkId, project.activeWorldId, project.id])
  const scopeKey = `${project.id}:${project.activeWorldId ?? 'legacy'}:${project.activeWorkId ?? 'legacy'}:${worldGroupId ?? 'global'}`

  const reload = useCallback(async (id: number) => {
    setEvents(await readAgentEvents(id, workspaceScope))
  }, [workspaceScope])

  useEffect(() => {
    if (conversationId == null || typeof window === 'undefined') return
    const handleSync = (event: Event) => {
      const detail = (event as CustomEvent<MasterCopilotSyncDetail>).detail
      if (detail?.scopeKey !== scopeKey) return
      setBusy(detail.busy)
      void reload(conversationId)
    }
    window.addEventListener(MASTER_COPILOT_SYNC_EVENT, handleSync)
    return () => window.removeEventListener(MASTER_COPILOT_SYNC_EVENT, handleSync)
  }, [conversationId, reload, scopeKey])

  const recordTask = useCallback(async (
    task: Parameters<NonNullable<Parameters<typeof executeMasterAgentPlan>[0]['onTask']>>[0],
    status: 'running' | 'completed' | 'failed',
    error?: string,
  ) => {
    if (conversationId == null) return
    await appendAgentEvent({
      projectId: project.id!,
      conversationId,
      kind: 'task',
      content: error || task.instruction,
      payload: { taskId: task.id, agentId: task.agentId, status, error },
      scope: workspaceScope,
    })
  }, [conversationId, project.id, workspaceScope])

  useEffect(() => {
    let active = true
    abortRef.current?.abort()
    runtimeCandidates.current.clear()
    setBusy(MASTER_COPILOT_SCOPE_OWNERS.has(scopeKey))
    setRecoveryAvailable(false)
    setError(null)
    setLoading(true)
    void (async () => {
      const conversation = await getOrCreateAgentConversation({
        projectId: project.id!,
        worldGroupId,
        scope: workspaceScope,
      })
      if (!active) return
      setConversationId(conversation.id!)
      if (workspaceScope) {
        const recovered = await recoverPendingMasterAgentAdoptionsV1(workspaceScope)
        for (const runId of recovered.recoveredRunIds) {
          await verifyMasterAgentRunV1({ scope: workspaceScope, runId })
        }
      }
      let rows = await readAgentEvents(conversation.id!, workspaceScope)
      if (!rows.length) {
        await appendAgentEvent({
          projectId: project.id!,
          conversationId: conversation.id!,
          kind: 'message',
          role: 'assistant',
          content: '直接告诉我你想完成什么。我会理解目标、调用需要的领域 Agent，并把结果统一交给你确认。',
          scope: workspaceScope,
        })
        rows = await readAgentEvents(conversation.id!, workspaceScope)
      }
      if (active) {
        setEvents(rows)
        setRecoveryAvailable(workspaceScope
          ? await findResumableMasterAgentRunV1({
              scope: workspaceScope,
              conversationId: conversation.id!,
            }) != null
          : false)
        setLoading(false)
      }
    })().catch(error => {
      if (active) {
        console.error('[master-copilot] load failed', error)
        setLoading(false)
      }
    })
    return () => {
      active = false
      abortRef.current?.abort()
    }
  }, [project.id, scopeKey, workspaceScope, worldGroupId])

  const pendingCandidates = useMemo(() => {
    const resolved = new Set<number>()
    events.filter(event => event.kind === 'confirmation').forEach(event => {
      const payload = parseAgentEventPayload<{ candidateEventId?: number }>(event, {})
      if (typeof payload.candidateEventId === 'number') resolved.add(payload.candidateEventId)
    })
    return events
      .filter(event => event.kind === 'candidate' && event.id != null && !resolved.has(event.id))
      .map(event => ({
        event,
        payload: parseAgentEventPayload<MasterCandidatePayload>(event, {
          version: 1,
          taskId: '',
          agentId: 'character',
          label: '候选',
          contextSources: [],
          baseSnapshot: {},
        }),
      }))
  }, [events])

  const submitRequest = useCallback(async (
    requestOverride?: string,
    options?: { pinnedTask?: PinnedMasterAgentTaskV1 },
  ) => {
    const request = (requestOverride ?? authorRequest).trim()
    if (!request || busy || conversationId == null) return
    if (pendingCandidates.length) return
    const scopeOwner = claimMasterCopilotScope(scopeKey)
    if (!scopeOwner) return
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setBusy(true)
    setError(null)
    if (requestOverride === undefined) setAuthorRequest('')
    try {
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'user',
        content: request,
        scope: workspaceScope,
      })
      await reload(conversationId)
      const teamBudget = new AgentTeamBudgetTracker(
        useAIConfigStore.getState().agentTeamBudgetProfile,
      )
      const plan = await createMasterAgentPlan({
        projectId: project.id!,
        scope: workspaceScope,
        worldGroupId,
        request,
        budget: teamBudget,
        signal: controller.signal,
        pinnedTask: options?.pinnedTask,
      })
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'plan',
        content: plan.summary,
        payload: plan,
        scope: workspaceScope,
      })
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'assistant',
        content: `${plan.summary} 我会在后台完成 ${plan.tasks.length} 个领域任务。`,
        scope: workspaceScope,
      })
      await reload(conversationId)

      const durable = workspaceScope && isMasterAgentDurableHarnessEnabledV1()
        ? await runDurableMasterAgentPlanV1({
            scope: workspaceScope,
            worldGroupId,
            conversationId,
            plan,
            budget: teamBudget,
            signal: controller.signal,
            onTask: recordTask,
          })
        : null
      const candidates = durable
        ? durable.candidates.map(candidate => ({
            payload: candidate.payload,
            draft: candidate.draft,
            runtimeNode: candidate.runtime?.runtimeNode ?? ({} as any),
            runtimeOutput: candidate.runtime?.runtimeOutput ?? candidate.draft,
          }))
        : await executeMasterAgentPlan({
            projectId: project.id!,
            scope: workspaceScope,
            worldGroupId,
            plan,
            budget: teamBudget,
            signal: controller.signal,
            onTask: recordTask,
          })
      if (!durable) {
        for (const candidate of candidates) {
          const event = await appendAgentEvent({
            projectId: project.id!,
            conversationId,
            kind: 'candidate',
            content: candidate.draft,
            payload: candidate.payload,
            scope: workspaceScope,
          })
          runtimeCandidates.current.set(event.id!, candidate)
        }
      } else {
        for (const candidate of durable.candidates) {
          if (candidate.event.id != null && candidate.runtime) {
            runtimeCandidates.current.set(candidate.event.id, candidate.runtime)
          }
        }
      }
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'assistant',
          content: [
          `后台领域 Agent 已完成，生成了 ${candidates.length} 份候选。请检查、编辑并决定是否采纳。`,
          `本轮团队约使用 ${teamBudget.snapshot().usedTokens.toLocaleString()} / `
          + `${teamBudget.snapshot().maxTokens.toLocaleString()} tokens，`
          + `${teamBudget.snapshot().calls} 次调用，`
          + `Canon 受控打回 ${teamBudget.snapshot().canonRetries} 次。`,
          ].join(' '),
          scope: workspaceScope,
      })
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = errorMessage(error)
        setError(message)
        await appendAgentEvent({
          projectId: project.id!,
          conversationId,
          kind: 'error',
          content: message,
          scope: workspaceScope,
        })
        await appendAgentEvent({
          projectId: project.id!,
          conversationId,
          kind: 'message',
          role: 'assistant',
          content: `本轮没有完成：${message}`,
          scope: workspaceScope,
        })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      releaseMasterCopilotScope(scopeKey, scopeOwner)
      await reload(conversationId)
      notifyMasterCopilotSync(scopeKey)
    }
  }, [
    authorRequest,
    busy,
    conversationId,
    pendingCandidates.length,
    project.id,
    recordTask,
    reload,
    scopeKey,
    worldGroupId,
    workspaceScope,
  ])

  const submit = useCallback(() => submitRequest(), [submitRequest])

  const submitTargetedRequest = useCallback((
    request: string,
    pinnedTask: PinnedMasterAgentTaskV1,
  ) => submitRequest(request, { pinnedTask }), [submitRequest])

  const resume = useCallback(async () => {
    if (busy || conversationId == null || !workspaceScope) return
    const runId = await findResumableMasterAgentRunV1({
      scope: workspaceScope,
      conversationId,
    })
    if (runId == null) {
      setRecoveryAvailable(false)
      return
    }
    const scopeOwner = claimMasterCopilotScope(scopeKey)
    if (!scopeOwner) return
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setBusy(true)
    setError(null)
    try {
      const result = await runDurableMasterAgentPlanV1({
        scope: workspaceScope,
        worldGroupId,
        runId,
        signal: controller.signal,
        onTask: recordTask,
      })
      for (const candidate of result.candidates) {
        if (candidate.event.id != null && candidate.runtime) {
          runtimeCandidates.current.set(candidate.event.id, candidate.runtime)
        }
      }
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'assistant',
        content: `已从中断处恢复本轮执行，当前生成了 ${result.candidates.length} 份候选。请检查并确认。`,
        scope: workspaceScope,
      })
      setRecoveryAvailable(false)
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(errorMessage(error))
        await appendAgentEvent({
          projectId: project.id!,
          conversationId,
          kind: 'message',
          role: 'assistant',
          content: `恢复本轮失败：${errorMessage(error)}`,
          scope: workspaceScope,
        })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      releaseMasterCopilotScope(scopeKey, scopeOwner)
      await reload(conversationId)
      setRecoveryAvailable(await findResumableMasterAgentRunV1({
        scope: workspaceScope,
        conversationId,
      }) != null)
      notifyMasterCopilotSync(scopeKey)
    }
  }, [busy, conversationId, project.id, recordTask, reload, scopeKey, worldGroupId, workspaceScope])

  const updateCandidate = useCallback(async (eventId: number, draft: string) => {
    const candidate = pendingCandidates.find(item => item.event.id === eventId)
    let creativeArtifact = candidate?.payload.creativeArtifact
    if (creativeArtifact && candidate?.payload.skillId === 'outline.story-arcs' && candidate.payload.storyArcKind) {
      creativeArtifact = revalidateStoryArcCreativeDraftV1({
          draft,
          snapshot: candidate.payload.baseSnapshot as Parameters<typeof revalidateStoryArcCreativeDraftV1>[0]['snapshot'],
          kind: candidate.payload.storyArcKind,
          previousArtifact: creativeArtifact,
        })
    } else if (creativeArtifact && candidate?.payload.agentId === 'outline' && candidate.payload.outlineMode) {
      creativeArtifact = revalidateOutlineCreativeDraftV1({
        draft,
        snapshot: candidate.payload.baseSnapshot as Parameters<typeof revalidateOutlineCreativeDraftV1>[0]['snapshot'],
        previousArtifact: creativeArtifact,
      })
    } else if (creativeArtifact && candidate?.payload.agentId === 'prose' && candidate.payload.informationBoundary) {
      creativeArtifact = revalidateProseCreativeDraftV1({
        draft,
        informationBoundary: candidate.payload.informationBoundary,
        previousArtifact: creativeArtifact,
      })
    }
    const nextPayload = await updateAgentEventCandidate(
      eventId,
      project.id!,
      draft,
      workspaceScope,
      { creativeArtifact },
    )
    setEvents(current => current.map(event => event.id === eventId
      ? { ...event, content: draft, ...(nextPayload ? { payload: nextPayload } : {}) }
      : event))
    notifyMasterCopilotSync(scopeKey)
  }, [pendingCandidates, project.id, scopeKey, workspaceScope])

  const resolveCandidate = useCallback(async (
    candidate: PendingMasterCandidate,
    decision: 'adopted' | 'rejected',
  ) => {
    if (busy || conversationId == null || candidate.event.id == null) return
    const scopeOwner = claimMasterCopilotScope(scopeKey)
    if (!scopeOwner) return
    setBusy(true)
    setError(null)
    try {
      let message = '候选已拒绝，没有写入项目。'
      let terminalMessage: string | null = null
      const durableCandidate = candidate.payload.runId != null && candidate.payload.runStepId
      if (durableCandidate && decision === 'adopted') {
        const adoption = await commitMasterAgentCandidateAdoptionV1({
          scope: workspaceScope!,
          runId: candidate.payload.runId!,
          candidateEventId: candidate.event.id,
          runtime: runtimeCandidates.current.get(candidate.event.id),
        })
        message = adoption.message
        const verification = await verifyMasterAgentRunV1({
          scope: workspaceScope!,
          runId: candidate.payload.runId!,
        })
        if (verification.accepted) {
          // Keep the business-adoption message stable for existing callers and
          // surface terminal verification as a separate auditable event.
          terminalMessage = '本轮所有步骤均已通过终态校验。'
        } else if (!verification.codes.includes('run-not-ready')) {
          message = `${message} 终态校验未通过：${verification.codes.join('、')}。`
        }
      } else if (durableCandidate) {
        await rejectMasterAgentCandidateV1({
          scope: workspaceScope!,
          runId: candidate.payload.runId!,
          candidateEventId: candidate.event.id,
        })
      } else if (decision === 'adopted') {
        message = await adoptMasterCandidate({
          projectId: project.id!,
          scope: workspaceScope,
          worldGroupId,
          event: candidate.event,
          payload: candidate.payload,
          draft: candidate.event.content,
          runtime: runtimeCandidates.current.get(candidate.event.id),
        })
      }
      if (!durableCandidate) {
        await appendAgentEvent({
          projectId: project.id!,
          conversationId,
          kind: 'confirmation',
          content: message,
          payload: { candidateEventId: candidate.event.id, decision },
          scope: workspaceScope,
        })
      }
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'assistant',
        content: message,
        scope: workspaceScope,
      })
      if (terminalMessage) {
        await appendAgentEvent({
          projectId: project.id!,
          conversationId,
          kind: 'message',
          role: 'assistant',
          content: terminalMessage,
          scope: workspaceScope,
        })
      }
      runtimeCandidates.current.delete(candidate.event.id)
      return true
    } catch (error) {
      setError(errorMessage(error))
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'assistant',
        content: errorMessage(error),
        scope: workspaceScope,
      })
      return false
    } finally {
      releaseMasterCopilotScope(scopeKey, scopeOwner)
      await reload(conversationId)
      notifyMasterCopilotSync(scopeKey)
    }
  }, [busy, conversationId, project.id, reload, scopeKey, workspaceScope, worldGroupId])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return {
    authorRequest,
    setAuthorRequest,
    events,
    pendingCandidates,
    busy,
    loading,
    recoveryAvailable,
    error,
    submit,
    submitRequest,
    submitTargetedRequest,
    resume,
    stop,
    updateCandidate,
    adoptCandidate: (candidate: PendingMasterCandidate) => resolveCandidate(candidate, 'adopted'),
    rejectCandidate: (candidate: PendingMasterCandidate) => resolveCandidate(candidate, 'rejected'),
  }
}

export type MasterCopilotController = ReturnType<typeof useMasterCopilot>
