import './agent-workspace.css'
import LongformAgentProgress from '../longform/LongformAgentProgress'
import type { MasterAgentPlan } from '../../lib/agent/orchestrator'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Mic,
  RotateCcw,
  Send,
  Square,
  Settings2,
  Volume2,
  Trash2,
  X,
} from 'lucide-react'
import type { Project } from '../../lib/types'
import { parseAgentEventPayload } from '../../lib/types'
import { creativeArtifactCanAdoptV1 } from '../../lib/agent/creative-reliability'
import { estimateCreativeRunPreviewV1 } from '../../lib/agent/creative-run-preview'
import { useAIConfigStore } from '../../stores/ai-config'
import { useMasterCopilot } from './useMasterCopilot'
import CandidateDraftEditor from './CandidateDraftEditor'
import CreativeArtifactSummary from './CreativeArtifactSummary'
import HarnessEvidencePanel from './HarnessEvidencePanel'
import type { HarnessLifecycleEvidenceV1 } from '../../lib/agent/harness-evidence'
import { useActiveWork } from '../../hooks/useActiveWork'
import { useCompanionStore } from '../../stores/companion'
import CompanionPortrait, { companionPose, COMPANION_POSES } from './CompanionPortrait'
import CompanionSettings from './CompanionSettings'
import { useCompanionVoice } from './useCompanionVoice'

interface Props {
  project: Project
  worldGroupId: number | null
  worldName: string
  embedded?: boolean
  onClose: () => void
  onOpenModule?: (module: string, chapter?: number) => void
}

const CONTEXT_PROFILE_LABELS = {
  lean: '精简',
  balanced: '均衡',
  full: '完整',
} as const

export default function ChatCopilotPanel({
  project,
  worldGroupId,
  worldName,
  onClose,
  embedded = false,
  onOpenModule,
}: Props) {
  const activeWork = useActiveWork(project)
  const copilot = useMasterCopilot({ project, worldGroupId })
  const creativeQualityMode = useAIConfigStore((state) => state.creativeQualityMode)
  const teamBudgetProfile = useAIConfigStore((state) => state.agentTeamBudgetProfile)
  const [showDetails, setShowDetails] = useState(false)
  const [planningSummary, setPlanningSummary] = useState('')
  const [mobilePane, setMobilePane] = useState<'dialogue' | 'draft'>('dialogue')
  const [elapsed, setElapsed] = useState(0)
  const [showCompanionSettings, setShowCompanionSettings] = useState(false)
  const [overflowTranscript, setOverflowTranscript] = useState('')
  const companionVisible = useCompanionStore((state) => state.preferences.visible)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const followLatest = useRef(true)
  const messages = copilot.events.filter((event) => event.kind === 'message')
  const latestReply = [...messages].reverse().find((event) => event.role === 'assistant')
  const voice = useCompanionVoice(
    `${project.id}:${activeWork?.id}:${worldGroupId}`,
    copilot.loading, copilot.busy, latestReply,
    (text) => {
      const combined = [copilot.authorRequest.trim(), text].filter(Boolean).join('\n')
      if (combined.length <= 2000) copilot.setAuthorRequest(combined)
      else setOverflowTranscript(text)
    },
  )
  const pose = companionPose(voice.state.phase, copilot.busy, copilot.pendingCandidates.length > 0, !!(copilot.error || voice.state.error))
  const recording = ['requesting', 'listening', 'transcribing'].includes(voice.state.phase)
  useEffect(() => { setOverflowTranscript('') }, [project.id, activeWork?.id, worldGroupId])
  const latestTasks = useMemo(() => {
    const result = new Map<string, { taskId: string; instruction: string; status: string; error?: string }>()
    const latestPlan = [...copilot.events]
      .reverse()
      .find(
        (event) =>
          event.kind === 'plan' &&
          Array.isArray(parseAgentEventPayload<Partial<MasterAgentPlan>>(event, {}).tasks),
      )
    const plan = latestPlan ? parseAgentEventPayload<Partial<MasterAgentPlan>>(latestPlan, {}) : null
    for (const task of plan?.tasks ?? [])
      result.set(task.id, { taskId: task.id, instruction: task.instruction, status: 'pending' })
    for (const event of copilot.events.filter(
      (event) => event.kind === 'task' && (!latestPlan || event.sequence > latestPlan.sequence),
    )) {
      const value = parseAgentEventPayload<{ taskId?: string; status?: string; error?: string }>(event, {})
      if (value.taskId)
        result.set(value.taskId, {
          taskId: value.taskId,
          instruction: result.get(value.taskId)?.instruction ?? event.content,
          status: value.status ?? 'running',
          error: value.error,
        })
    }
    return [...result.values()]
  }, [copilot.events])
  const previewRequest = copilot.activeRequest ?? copilot.authorRequest
  const runPreview = useMemo(
    () =>
      previewRequest.trim().length >= 2
        ? estimateCreativeRunPreviewV1({
            request: previewRequest,
            qualityMode: creativeQualityMode,
            teamBudgetProfile,
          })
        : null,
    [creativeQualityMode, previewRequest, teamBudgetProfile],
  )

  useEffect(() => {
    if (followLatest.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [copilot.events.length, copilot.busy])
  useEffect(() => {
    if (!copilot.busy) return
    setElapsed(0)
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [copilot.busy])
  const busyLabel = latestTasks.some((task) => task.status === 'running')
    ? '正在生成候选'
    : copilot.pendingCandidates.length
      ? '正在处理候选或回复问题'
      : '正在理解你的要求'

  return (
    <aside
      aria-label="主 Agent 创作副驾"
      className={`agent-workspace ${embedded ? 'lf-agent-page agent-workspace-embedded' : 'agent-workspace-side'}`}
    >
      <header className="agent-header">
        <div className="flex min-w-0 items-center gap-2">
          <CompanionPortrait pose={pose} compact />
          <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold">
            {!companionVisible && <Bot className="h-4 w-4 text-accent" />}主 Agent{' '}
            <span className="text-[10px] font-normal text-text-muted">{companionVisible ? '墨灵 · ' + COMPANION_POSES[pose].label : '创作伙伴'}</span>
          </div>
          <p className="truncate text-xs text-text-muted" title={worldName}>
            {activeWork?.title ?? '当前作品'} · {worldName}
          </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <button type="button" aria-label="助手与语音设置" title="助手与语音设置" className="rounded p-2 hover:bg-bg-hover" onClick={() => { voice.cancel(); setShowCompanionSettings(true) }}><Settings2 className="h-4 w-4" /></button>
        <button
          type="button"
          aria-label="关闭主 Agent"
          onClick={onClose}
          className="rounded p-2 hover:bg-bg-hover"
        >
          <X className="h-4 w-4" />
        </button>
        </div>
      </header>
      {showCompanionSettings && <CompanionSettings onClose={() => setShowCompanionSettings(false)} />}
      {embedded && (
        <LongformAgentProgress
          project={project}
          worldGroupId={worldGroupId}
          busy={copilot.busy}
          onRequest={copilot.setAuthorRequest}
        />
      )}
      <nav className="agent-mobile-tabs" aria-label="Agent 工作区视图">
        <button
          type="button"
          aria-pressed={mobilePane === 'dialogue'}
          onClick={() => setMobilePane('dialogue')}
        >
          对话与计划
        </button>
        <button type="button" aria-pressed={mobilePane === 'draft'} onClick={() => setMobilePane('draft')}>
          创作区{copilot.pendingCandidates.length ? ` · ${copilot.pendingCandidates.length} 份待确认` : ''}
        </button>
      </nav>
      <div className="agent-panes" data-pane={mobilePane}>
        <section className="agent-dialogue" aria-label="对话与计划">
          <div
            className="agent-messages"
            ref={scrollRef}
            onScroll={(event) => {
              const el = event.currentTarget
              followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64
            }}
          >
            {copilot.loading && (
              <p role="status" className="text-xs text-text-muted">
                正在恢复对话与候选…
              </p>
            )}
            {messages.map((message) => {
              const payload = parseAgentEventPayload<{
                kind?: string
                lifecycle?: HarnessLifecycleEvidenceV1
              }>(message, {})
              return (
                <div
                  key={message.id}
                  className={`agent-message ${message.role === 'user' ? 'agent-message-user' : ''}`}
                >
                  <p className="whitespace-pre-wrap break-words">{message.content}</p>
                  {message.role === 'assistant' && payload.kind !== 'harness-lifecycle' && (
                    <button type="button" className="mt-2 flex items-center gap-1 text-[11px] text-text-muted hover:text-accent" onClick={() => voice.speak(message.content)} aria-label="朗读这条回复" title="朗读开头，最多 2000 字"><Volume2 size={13} />朗读</button>
                  )}
                  {payload.kind === 'harness-lifecycle' && payload.lifecycle && (
                    <HarnessEvidencePanel lifecycle={payload.lifecycle} />
                  )}
                </div>
              )
            })}
            {latestTasks.length > 0 && (
              <section className="rounded border border-border p-2 text-xs">
                <button
                  type="button"
                  aria-expanded={showDetails}
                  onClick={() => setShowDetails((value) => !value)}
                  className="flex w-full items-center justify-between"
                >
                  执行进度 · {latestTasks.filter((task) => task.status === 'completed').length}/
                  {latestTasks.length}
                  {showDetails ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {showDetails && (
                  <ol className="mt-2 space-y-2">
                    {latestTasks.map((task) => (
                      <li key={task.taskId}>
                        <p>{task.instruction}</p>
                        <span className={task.status === 'failed' ? 'text-error' : 'text-text-muted'}>
                          {task.status === 'completed'
                            ? '候选已生成'
                            : task.status === 'failed'
                              ? task.error || '未完成'
                              : task.status === 'pending'
                                ? '等待前序采纳'
                                : '执行中'}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
            {copilot.recoveryAvailable && !copilot.pendingCandidates.length && (
              <section className="rounded border border-warning/40 p-3 text-xs">
                <p>有一轮未完成任务。恢复前会检查已保存的结果。</p>
                <button
                  type="button"
                  disabled={copilot.busy}
                  onClick={() => {
                    void copilot.resume()
                  }}
                  className="mt-2 flex items-center gap-1 text-accent"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  从中断处恢复
                </button>
              </section>
            )}
            {copilot.pendingPlan && !copilot.pendingCandidates.length && (
              <section className="agent-plan" aria-label="待确认创作计划">
                <h3 className="font-semibold">本轮创作计划</h3>
                <p>{copilot.pendingPlan.summary}</p>
                <ol className="list-decimal space-y-2 pl-4">
                  {copilot.pendingPlan.tasks.map((task) => (
                    <li key={task.id}>{task.instruction}</li>
                  ))}
                </ol>
                <button
                  type="button"
                  className="mt-3 rounded bg-accent px-3 py-2 text-white disabled:opacity-50"
                  disabled={copilot.busy || !!copilot.authorRequest.trim()}
                  onClick={() => {
                    void copilot.confirmPlan()
                  }}
                >
                  确认计划并开始
                </button>
                <p className="mt-2 text-xs text-text-muted">
                  可以继续对话调整计划；确认后生成候选，采纳后才写入作品。
                  {copilot.authorRequest.trim() && '请先发送或清空输入框中的新要求。'}
                </p>
              </section>
            )}
            <details className="text-xs text-text-muted">
              <summary className="cursor-pointer">整理需求摘要</summary>
              <p className="my-2">
                保存已确认的方向与约束，后续规划读取摘要及之后的对话；原记录保留，不调用模型。
              </p>
              <textarea
                aria-label="已确认的需求摘要"
                value={planningSummary}
                onChange={(event) => setPlanningSummary(event.target.value)}
                maxLength={8000}
                rows={4}
                className="w-full rounded border border-border p-2"
                disabled={copilot.busy || copilot.loading || copilot.pendingCandidates.length > 0}
              />
              <button
                type="button"
                className="mt-2 rounded border border-border px-3 py-2"
                disabled={
                  !planningSummary.trim() ||
                  copilot.busy ||
                  copilot.loading ||
                  copilot.pendingCandidates.length > 0
                }
                onClick={() => {
                  void copilot.savePlanningSummary(planningSummary).then((saved) => {
                    if (saved) setPlanningSummary('')
                  })
                }}
              >
                确认保存需求摘要
              </button>
            </details>
            {runPreview && copilot.pendingCandidates.length === 0 && (
              <details aria-label="本轮调用预估" className="text-xs text-text-muted">
                <summary className="cursor-pointer">调用预估与预算上限</summary>
                <p>
                  本轮预计 {runPreview.artifactCount} 份可编辑候选：
                  {runPreview.artifactLabels.join('、') || '先讨论明确目标'}
                </p>
                <p>
                  通常 {runPreview.usualModelCalls} 次模型调用；本轮硬上限 {runPreview.hardMaxModelCalls} 次 /{' '}
                  {runPreview.hardMaxTokens.toLocaleString()} tokens。
                </p>
                <p>只有可定位的结构问题才允许定向修复；不会为主观质量自动重试。</p>
                {runPreview.deferredArtifactLabels.length > 0 && (
                  <p>{runPreview.deferredArtifactLabels.join('、')}会等你先确认故事规划后，下一轮再生成。</p>
                )}
                <p>执行中可随时停止。此处为执行预估，会谈本身也会调用模型。</p>
              </details>
            )}
          </div>
          <form
            className="agent-composer"
            onSubmit={(event) => {
              event.preventDefault()
              voice.cancel()
              setElapsed(0)
              void copilot.discuss()
            }}
          >
            {copilot.error && (
              <div role="alert" className="agent-error">
                <p>{copilot.error}</p>
                {onOpenModule && (
                  <div className="mt-1 flex flex-wrap gap-3">
                    {/章纲|卷|章节|保存位置|目标/.test(copilot.error) && (
                      <button type="button" onClick={() => onOpenModule('outline')}>
                        打开大纲与章纲
                      </button>
                    )}
                    {/正文|手稿|章后/.test(copilot.error) && (
                      <button type="button" onClick={() => onOpenModule('chapters-list')}>
                        打开正文
                      </button>
                    )}
                    {/模型|连接|授权|密钥|余额|限流|超时|API|401|403|429|provider|key/i.test(copilot.error) && (
                      <button type="button" onClick={() => onOpenModule('settings')}>
                        检查模型设置
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {copilot.busy && (
              <p role="status" className="mb-2 flex items-center gap-2 text-xs text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {busyLabel} · {elapsed} 秒{elapsed >= 20 && ' · 仍在等待，可停止；不会自动重发'}
              </p>
            )}
            {(voice.state.phase !== 'idle' || voice.state.error) && (
              <div className="companion-voice-status" role={voice.state.error ? 'alert' : 'status'}>
                <span>{voice.state.error || ({
                  requesting: '请允许麦克风访问…', listening: '正在听，结束后可编辑文字',
                  transcribing: '正在识别，可随时放弃', preparing: '正在准备声音…', speaking: '正在朗读',
                  idle: '',
                }[voice.state.phase])}</span>
                {voice.state.preview && <p className="line-clamp-2">{voice.state.preview}</p>}
                {voice.state.phase !== 'idle' && <button type="button" onClick={voice.cancel}>{recording ? '放弃本次语音' : '停止朗读'}</button>}
              </div>
            )}
            {overflowTranscript && <div className="companion-voice-status">
              <p>输入框空间不足，识别文字暂存在这里，请先整理输入框。</p>
              <textarea aria-label="暂存的语音识别文字" value={overflowTranscript} onChange={(e) => setOverflowTranscript(e.target.value)} rows={2} />
              <button type="button" disabled={copilot.busy || copilot.authorRequest.length + overflowTranscript.length + 1 > 2000} onClick={() => { copilot.setAuthorRequest([copilot.authorRequest, overflowTranscript].filter(Boolean).join('\n')); setOverflowTranscript('') }}>加入输入框</button>
              <button type="button" onClick={() => setOverflowTranscript('')}>放弃这段识别文字</button>
            </div>}
            <textarea
              aria-label="告诉主 Agent 你的目标"
              value={copilot.authorRequest}
              disabled={copilot.loading || copilot.busy}
              maxLength={2000}
              rows={2}
              onChange={(event) => copilot.setAuthorRequest(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                ) {
                  event.preventDefault()
                  voice.cancel()
                  setElapsed(0)
                  void copilot.discuss()
                }
              }}
              placeholder={
                copilot.pendingCandidates.length
                  ? '可以先问候选哪里需要调整；采纳或拒绝后再开始新任务'
                  : '想先写哪一小步？可以跳过设定，直接描述一个场景…'
              }
              className="w-full resize-none rounded border border-border bg-bg-base px-3 py-2 text-sm leading-6 outline-none focus:border-accent disabled:opacity-60"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button type="button" className="companion-mic" disabled={copilot.loading || copilot.busy || (recording && voice.state.phase !== 'listening')} onClick={voice.state.phase === 'listening' ? voice.finish : voice.listen} aria-label={voice.state.phase === 'listening' ? '结束说话并识别' : '语音输入'}><Mic size={15} />{voice.state.phase === 'listening' ? '说完了' : '说话'}</button>
                <span className="agent-keyboard-hint text-[10px] text-text-muted">Enter 发送</span>
              </div>
              {copilot.busy ? (
                <button
                  type="button"
                  onClick={copilot.stop}
                  className="flex items-center gap-1 rounded border border-border px-3 py-2 text-xs"
                >
                  <Square className="h-3.5 w-3.5" />
                  停止
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={copilot.loading || copilot.authorRequest.trim().length < 2}
                  className="flex items-center gap-1 rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                  {copilot.pendingCandidates.length ? '讨论候选' : '讨论与规划'}
                </button>
              )}
            </div>
          </form>
        </section>
        <section className="agent-drafts" aria-label="创作区">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              创作区
              {copilot.pendingCandidates.length > 0 && ` · ${copilot.pendingCandidates.length} 份待确认`}
            </h2>
            {onOpenModule && (
              <button
                type="button"
                className="text-xs text-accent"
                onClick={() => onOpenModule('chapters-list')}
              >
                打开作品正文
              </button>
            )}
          </div>
          {!copilot.pendingCandidates.length && (
            <div className="agent-empty">
              <CompanionPortrait pose={pose} />
              <h3>从你最想写的地方开始</h3>
              <p>一个场景、一位人物、一条设定，都可以。无需按顺序填完所有资料。</p>
              <p>先讨论想法，确认计划后，生成的候选会出现在这里。你可以编辑，满意后再采纳。</p>
              <div className="flex flex-wrap gap-2">
                {['先写一个场景', '只设计一位角色', '讨论已有章节'].map((label, index) => (
                  <button
                    key={label}
                    type="button"
                    disabled={copilot.busy || copilot.loading}
                    className="rounded border border-border px-3 py-2 text-xs"
                    onClick={() => {
                      copilot.setAuthorRequest(
                        [
                          '我想先写一个场景，其他设定以后再补。请帮我明确这个场景和保存位置。',
                          '这次只设计一位角色，不需要先补全世界观。',
                          '我们先讨论已有章节可以怎样改进，暂时不要生成或覆盖正文。',
                        ][index],
                      )
                      setMobilePane('dialogue')
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {copilot.pendingCandidates.map((candidate) => (
            <section
              key={candidate.event.id}
              className="agent-candidate rounded-lg border border-accent/30 bg-bg-base p-3"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-text-primary">
                  待确认 · {candidate.payload.label}
                </span>
                <span
                  className="max-w-[45%] truncate text-[10px] text-text-muted"
                  title={candidate.payload.contextSources.join('、')}
                >
                  {candidate.payload.contextEvidence
                    ? `${CONTEXT_PROFILE_LABELS[candidate.payload.contextEvidence.profile]} · 资料 ≈${candidate.payload.contextEvidence.estimatedInputTokens.toLocaleString()} tokens`
                    : `${candidate.payload.contextSources.length} 个输入来源`}
                </span>
              </div>
              <p className="mb-2 text-xs text-text-secondary">
                写入位置：{candidate.payload.label}
                {candidate.payload.proseOperation === 'continue' ? ' · 追加到原文末尾' : ''}
                。确认采纳前，作品原文保持不变。
              </p>
              {candidate.payload.agentId === 'prose' && <button type="button" className="mb-2 flex items-center gap-1 text-xs text-accent" onClick={() => voice.speak(candidate.event.content)}><Volume2 size={14} />朗读正文开头（最多 2000 字）</button>}
              <CandidateDraftEditor
                payload={candidate.payload}
                value={candidate.event.content}
                disabled={copilot.busy}
                onChange={(draft) => {
                  void copilot.updateCandidate(candidate.event.id!, draft)
                }}
              />
              <p className="mt-1 text-[10px] text-text-muted">
                候选保存在本地，刷新后仍会保留；只有采纳才会写入作品。
              </p>
              <details className="mt-2 text-xs text-text-muted">
                <summary className="cursor-pointer">质量提示与运行详情</summary>
                {candidate.payload.creativeArtifact && (
                  <CreativeArtifactSummary
                    artifact={candidate.payload.creativeArtifact}
                    narrativeBrief={candidate.payload.narrativeBrief}
                  />
                )}
                <HarnessEvidencePanel
                  contextEvidence={candidate.payload.contextEvidence}
                  lifecycle={candidate.lifecycle}
                  promptExecutionEvidence={candidate.payload.promptExecutionEvidence}
                />
                {candidate.payload.teamBudgetEvidence && (
                  <p className="mt-2 rounded border border-border/60 bg-bg-surface px-2 py-1.5 text-[10px] text-text-muted">
                    本轮团队预算约 {candidate.payload.teamBudgetEvidence.usedTokens.toLocaleString()} /{' '}
                    {candidate.payload.teamBudgetEvidence.maxTokens.toLocaleString()} tokens
                    {' · '}
                    {candidate.payload.teamBudgetEvidence.calls}/
                    {candidate.payload.teamBudgetEvidence.maxCalls} 次调用
                    {' · '}Canon 打回 {candidate.payload.teamBudgetEvidence.canonRetries}/
                    {candidate.payload.teamBudgetEvidence.maxCanonRetries}
                  </p>
                )}
                {(candidate.payload.dependsOnTaskIds?.length ?? 0) > 0 && (
                  <p className="mt-1 text-[10px] text-warning">
                    采纳前需先采纳上游任务：{candidate.payload.dependsOnTaskIds!.join('、')}
                  </p>
                )}
              </details>
              {candidate.payload.creativeArtifact &&
                !creativeArtifactCanAdoptV1(candidate.payload.creativeArtifact) && (
                  <p role="status" className="mt-2 text-xs text-warning">
                    这份候选需要修改后才能采纳：
                    {candidate.payload.creativeArtifact.issues.map((issue) => issue.message).join('；') ||
                      '请展开质量提示查看原因。'}
                  </p>
                )}
              <div className="agent-candidate-actions mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={copilot.busy}
                  onClick={() => {
                    void copilot.rejectCandidate(candidate)
                  }}
                  className="flex items-center gap-1 rounded px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  拒绝
                </button>
                <button
                  type="button"
                  disabled={
                    copilot.busy ||
                    (candidate.payload.creativeArtifact != null &&
                      !creativeArtifactCanAdoptV1(candidate.payload.creativeArtifact))
                  }
                  onClick={() => {
                    void copilot.adoptCandidate(candidate)
                  }}
                  className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 disabled:opacity-50"
                >
                  {copilot.busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  {candidate.payload.creativeArtifact?.status === 'usable-with-warnings'
                    ? '接受提示并采纳'
                    : '采纳'}
                </button>
              </div>
            </section>
          ))}
        </section>
      </div>
    </aside>
  )
}
