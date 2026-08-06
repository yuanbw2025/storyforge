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
  type MasterCandidatePayload,
} from '../../lib/agent/orchestrator'
import type { AgentEvent, Project, WorkspaceScope } from '../../lib/types'
import { parseAgentEventPayload } from '../../lib/types'
import { AgentTeamBudgetTracker } from '../../lib/agent/team-budget'
import { useAIConfigStore } from '../../stores/ai-config'

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return '操作失败，请稍后重试。'
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
    let active = true
    abortRef.current?.abort()
    runtimeCandidates.current.clear()
    setBusy(false)
    setLoading(true)
    void (async () => {
      const conversation = await getOrCreateAgentConversation({
        projectId: project.id!,
        worldGroupId,
        scope: workspaceScope,
      })
      if (!active) return
      setConversationId(conversation.id!)
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

  const submit = useCallback(async () => {
    const request = authorRequest.trim()
    if (!request || busy || conversationId == null) return
    if (pendingCandidates.length) return
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setBusy(true)
    setAuthorRequest('')
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

      let taskQueue = Promise.resolve()
      const candidates = await executeMasterAgentPlan({
        projectId: project.id!,
        scope: workspaceScope,
        worldGroupId,
        plan,
        budget: teamBudget,
        signal: controller.signal,
        onTask: (task, status, error) => {
          taskQueue = taskQueue.then(async () => {
            await appendAgentEvent({
              projectId: project.id!,
              conversationId,
              kind: 'task',
              content: error || task.instruction,
              payload: { taskId: task.id, agentId: task.agentId, status, error },
              scope: workspaceScope,
            })
          })
        },
      })
      await taskQueue
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
      setBusy(false)
      await reload(conversationId)
    }
  }, [
    authorRequest,
    busy,
    conversationId,
    pendingCandidates.length,
    project.id,
    reload,
    worldGroupId,
    workspaceScope,
  ])

  const updateCandidate = useCallback(async (eventId: number, draft: string) => {
    await updateAgentEventCandidate(eventId, project.id!, draft, workspaceScope)
    setEvents(current => current.map(event => event.id === eventId ? { ...event, content: draft } : event))
  }, [project.id, workspaceScope])

  const resolveCandidate = useCallback(async (
    candidate: PendingMasterCandidate,
    decision: 'adopted' | 'rejected',
  ) => {
    if (busy || conversationId == null || candidate.event.id == null) return
    setBusy(true)
    try {
      let message = '候选已拒绝，没有写入项目。'
      if (decision === 'adopted') {
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
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'confirmation',
        content: message,
        payload: { candidateEventId: candidate.event.id, decision },
        scope: workspaceScope,
      })
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'assistant',
        content: message,
        scope: workspaceScope,
      })
      runtimeCandidates.current.delete(candidate.event.id)
    } catch (error) {
      await appendAgentEvent({
        projectId: project.id!,
        conversationId,
        kind: 'message',
        role: 'assistant',
        content: errorMessage(error),
        scope: workspaceScope,
      })
    } finally {
      setBusy(false)
      await reload(conversationId)
    }
  }, [busy, conversationId, project.id, reload, workspaceScope, worldGroupId])

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return {
    authorRequest,
    setAuthorRequest,
    events,
    pendingCandidates,
    busy,
    loading,
    submit,
    stop,
    updateCandidate,
    adoptCandidate: (candidate: PendingMasterCandidate) => resolveCandidate(candidate, 'adopted'),
    rejectCandidate: (candidate: PendingMasterCandidate) => resolveCandidate(candidate, 'rejected'),
  }
}
