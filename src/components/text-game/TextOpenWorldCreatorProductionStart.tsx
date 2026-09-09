import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  GitFork,
  Loader2,
  Play,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'
import type { TextOpenWorldCreatorBriefSessionV1 } from '../../lib/open-world/creator-brief'
import { createTextOpenWorldCreatorSourceLocatorV1 } from '../../lib/open-world/creator-brief-persistence'
import type { TextOpenWorldCreatorStartPreparationV1 } from '../../lib/open-world/creator-production-start'
import {
  authorizeTextOpenWorldCreatorProductionStartV1,
  previewTextOpenWorldCreatorProductionStartV1,
} from '../../lib/product-production/service'
import type {
  TextOpenWorldCreatorProductionPreflightConfirmationV1,
  TextOpenWorldCreatorProductionPreflightV1,
  TextOpenWorldSourceRightsBasisV1,
} from '../../lib/types'

export interface TextOpenWorldCreatorProductionStartProps {
  session: TextOpenWorldCreatorBriefSessionV1
  preflight: TextOpenWorldCreatorProductionPreflightV1
  confirmation: TextOpenWorldCreatorProductionPreflightConfirmationV1
  onBack: () => void
  onStarted: (productionId: number) => void
}

function compactHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1_000))
  return seconds >= 3_600 ? `${(seconds / 3_600).toFixed(1)} 小时`
    : seconds >= 60 ? `${Math.round(seconds / 60)} 分钟` : `${seconds} 秒`
}

function taskCost(value: number | null): string {
  return value == null ? '待供应商回执' : `$${value.toFixed(value >= 1 ? 2 : 4)}`
}

function defaultRightsNote(basis: TextOpenWorldSourceRightsBasisV1): string {
  if (basis === 'author-owned') return '我确认拥有该来源内容，并授权本次文字开放世界产品进行派生制作。'
  if (basis === 'licensed') return '我确认已取得该来源用于本次文字开放世界派生制作的有效许可。'
  return '我确认该来源属于公版内容，并已核对适用地域与版本。'
}

export function TextOpenWorldCreatorProductionStart(props: TextOpenWorldCreatorProductionStartProps) {
  const brief = props.session.confirmedBrief
  const [rightsBasis, setRightsBasis] = useState<TextOpenWorldSourceRightsBasisV1 | ''>('')
  const [rightsNote, setRightsNote] = useState('')
  const [preparation, setPreparation] = useState<TextOpenWorldCreatorStartPreparationV1 | null>(null)
  const [busy, setBusy] = useState<'preview' | 'start' | null>(null)
  const [error, setError] = useState('')
  const nonce = useRef(crypto.randomUUID())
  const authorizedAt = useRef<number | null>(null)
  const sourceLocator = useMemo(() => (
    props.session.selection ? createTextOpenWorldCreatorSourceLocatorV1(props.session.selection) : null
  ), [props.session.selection])

  const chooseRights = (value: TextOpenWorldSourceRightsBasisV1 | '') => {
    setRightsBasis(value)
    setRightsNote(value ? defaultRightsNote(value) : '')
    setPreparation(null)
    authorizedAt.current = null
  }

  const preview = async () => {
    if (!brief || !sourceLocator || !rightsBasis || !rightsNote.trim()) return
    setBusy('preview')
    setError('')
    try {
      const frozenAt = Date.now()
      const next = await previewTextOpenWorldCreatorProductionStartV1({
        scope: props.session.scope,
        productionId: props.session.production.id,
        briefRevision: brief.revision,
        briefHash: brief.briefHash,
        expectedStateRevision: props.session.production.stateRevision,
        sourceLocator,
        preflight: props.preflight,
        confirmation: props.confirmation,
        rightsBasis,
        rightsNote,
        authorizationNonce: nonce.current,
        authorizedAt: frozenAt,
      })
      authorizedAt.current = frozenAt
      setPreparation(next)
    } catch (cause) {
      authorizedAt.current = null
      setPreparation(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const start = async () => {
    if (!brief || !sourceLocator || !rightsBasis || !rightsNote.trim()
      || !preparation || authorizedAt.current == null) return
    setBusy('start')
    setError('')
    try {
      await authorizeTextOpenWorldCreatorProductionStartV1({
        scope: props.session.scope,
        productionId: props.session.production.id,
        briefRevision: brief.revision,
        briefHash: brief.briefHash,
        expectedStateRevision: props.session.production.stateRevision,
        sourceLocator,
        preflight: props.preflight,
        confirmation: props.confirmation,
        rightsBasis,
        rightsNote,
        authorizationNonce: nonce.current,
        authorizedAt: authorizedAt.current,
        expectedPlanHash: preparation.start.productionPlanHash,
      })
      props.onStarted(props.session.production.id)
    } catch (cause) {
      setPreparation(null)
      authorizedAt.current = null
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  if (!brief || !sourceLocator) return <main className="mx-auto w-full max-w-6xl p-5">
    <section role="alert" className="rounded-xl border border-danger/40 bg-danger/5 p-5 text-sm text-danger">
      当前 Creator Brief 缺少可复验的本地来源坐标，不能创建 Build。请返回重新核验来源。
      <button type="button" onClick={props.onBack} className="ml-3 underline">返回</button>
    </section>
  </main>

  const tasks = preparation?.plan.tasks ?? []
  const groups = [...new Set(tasks.map(task => task.concurrencyGroup))]
  const total = tasks.reduce((sum, task) => ({
    modelCalls: sum.modelCalls + task.budgetReservation.modelCalls,
    inputTokens: sum.inputTokens + task.budgetReservation.inputTokens,
    outputTokens: sum.outputTokens + task.budgetReservation.outputTokens,
    mediaCalls: sum.mediaCalls + task.budgetReservation.mediaCalls,
    durationMs: sum.durationMs + task.budgetReservation.durationMs,
    storageBytes: sum.storageBytes + task.budgetReservation.storageBytes,
    maximumCostUsd: sum.maximumCostUsd == null || task.budgetReservation.maximumCostUsd == null
      ? null : sum.maximumCostUsd + task.budgetReservation.maximumCostUsd,
  }), {
    modelCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    mediaCalls: 0,
    durationMs: 0,
    storageBytes: 0,
    maximumCostUsd: 0 as number | null,
  })

  return <main className="mx-auto w-full max-w-7xl space-y-5 p-4 text-text-primary md:p-6"
    data-testid="text-open-world-creator-production-start">
    <header className="rounded-xl border border-border bg-bg-elevated p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.2em] text-accent">TEXT OPEN WORLD · BUILD PLAN</span>
          <h1 className="mt-2 text-xl font-semibold">冻结来源、生产计划与作者授权</h1>
          <p className="mt-2 max-w-4xl text-xs leading-6 text-text-muted">
            先生成零写入计划供你检查。点击正式开始时，系统会再次复验 Brief、来源、模型、报价与预算，并在同一事务中冻结 SourcePlan、Start、Plan 和 Build；成功前不会调用模型。
          </p>
        </div>
        <button type="button" onClick={props.onBack} disabled={busy != null}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">
          <ArrowLeft className="h-4 w-4" />返回模型与预算
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-[10px] text-text-muted">
        <span className="rounded-full border border-border bg-bg-base px-3 py-1">Brief r{brief.revision}</span>
        <span className="rounded-full border border-border bg-bg-base px-3 py-1">{brief.sourceBinding.kind === 'world-release' ? 'WorldRelease' : '小说'}来源</span>
        <span className="rounded-full border border-border bg-bg-base px-3 py-1 font-mono">{compactHash(brief.briefHash)}</span>
      </div>
    </header>

    {error && <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
      <AlertTriangle className="mr-2 inline h-4 w-4" />{error}
      <p className="mt-2 text-xs text-text-muted">没有按旧快照继续启动。请返回检查变化，或重新生成计划。</p>
    </div>}

    <section className="rounded-xl border border-border bg-bg-elevated p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="h-4 w-4 text-accent" />1. 来源权利声明</h2>
      <p className="mt-1 text-xs leading-5 text-text-muted">权利声明只约束本次 Build；更换来源版本或 Brief 后必须重新授权。</p>
      <div className="mt-4 grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <label className="grid gap-1.5 text-xs font-medium">权利基础
          <select value={rightsBasis} onChange={event => chooseRights(event.target.value as TextOpenWorldSourceRightsBasisV1 | '')}
            className="rounded-lg border border-border bg-bg-base px-3 py-2 text-sm">
            <option value="">请选择并确认</option>
            <option value="author-owned">作者拥有</option>
            <option value="licensed">已取得许可</option>
            <option value="public-domain">公版内容</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-xs font-medium">说明
          <textarea value={rightsNote} rows={3} maxLength={2_000}
            onChange={event => { setRightsNote(event.target.value); setPreparation(null); authorizedAt.current = null }}
            className="rounded-lg border border-border bg-bg-base px-3 py-2 text-sm" />
        </label>
      </div>
      <button type="button" onClick={() => void preview()}
        disabled={busy != null || !rightsBasis || !rightsNote.trim()}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-xs font-semibold text-accent disabled:opacity-40">
        {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitFork className="h-4 w-4" />}
        生成并检查冻结计划
      </button>
    </section>

    {preparation && <>
      <section className="rounded-xl border border-border bg-bg-elevated p-5" data-testid="text-open-world-creator-plan-preview">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold"><WalletCards className="h-4 w-4 text-accent" />2. Build #{preparation.buildNumber} 预算与执行边界</h2>
            <p className="mt-1 text-xs text-text-muted">{props.preflight.providerBinding.provider} · {props.preflight.providerBinding.model} · {tasks.length} 个任务 · {groups.length} 个并行组</p>
          </div>
          <span className="rounded-full border border-success/30 bg-success/5 px-3 py-1 text-[10px] text-success"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />零写预览已复验</span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-lg bg-bg-base p-3 text-xs"><span className="text-text-muted">模型调用</span><strong className="mt-1 block">{total.modelCalls}</strong></article>
          <article className="rounded-lg bg-bg-base p-3 text-xs"><span className="text-text-muted">输入 / 输出 token</span><strong className="mt-1 block">{formatNumber(total.inputTokens)} / {formatNumber(total.outputTokens)}</strong></article>
          <article className="rounded-lg bg-bg-base p-3 text-xs"><span className="text-text-muted">冻结最高文本费用</span><strong className="mt-1 block">{taskCost(total.maximumCostUsd)}</strong></article>
          <article className="rounded-lg bg-bg-base p-3 text-xs"><span className="text-text-muted">总时长 / 存储上限</span><strong className="mt-1 block">{formatDuration(total.durationMs)} / {(total.storageBytes / 1_000_000).toFixed(0)} MB</strong></article>
        </div>
        <dl className="mt-4 grid gap-2 text-[10px] text-text-muted md:grid-cols-3">
          <div className="rounded border border-border bg-bg-base p-3"><dt>Creator Brief</dt><dd className="mt-1 font-mono" title={brief.briefHash}>{compactHash(brief.briefHash)}</dd></div>
          <div className="rounded border border-border bg-bg-base p-3"><dt>SourcePlan</dt><dd className="mt-1 font-mono" title={preparation.sourcePlan.planHash}>{compactHash(preparation.sourcePlan.planHash)}</dd></div>
          <div className="rounded border border-border bg-bg-base p-3"><dt>Production Plan</dt><dd className="mt-1 font-mono" title={preparation.start.productionPlanHash}>{compactHash(preparation.start.productionPlanHash)}</dd></div>
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-bg-elevated p-5">
        <h2 className="text-base font-semibold">3. DAG 任务、依赖与恢复边界</h2>
        <p className="mt-1 text-xs leading-5 text-text-muted">每个外部调用都有独立 attempt、预算预留、checkpoint 与结果未知停机边界。依赖回执未通过时，下游不会执行。</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2" data-testid="text-open-world-creator-plan-tasks">
          {tasks.map(task => <article key={task.taskKey} className="rounded-lg border border-border bg-bg-base p-4">
            <div className="flex items-start justify-between gap-3"><strong className="text-xs">{task.taskKey}</strong><span className="rounded bg-bg-elevated px-2 py-1 text-[9px] text-accent">{task.lane} · {task.executionMode}</span></div>
            <p className="mt-2 text-[10px] leading-5 text-text-muted">
              依赖：{task.dependsOn.length ? task.dependsOn.join('、') : '起点'}<br />
              并行组：{task.concurrencyGroup} · 尝试 {task.maxAttempts} 次 · 超时 {formatDuration(task.timeoutMs)}<br />
              预算：{task.budgetReservation.modelCalls} 次模型 / {formatNumber(task.budgetReservation.inputTokens)} 入 / {formatNumber(task.budgetReservation.outputTokens)} 出 / {taskCost(task.budgetReservation.maximumCostUsd)}<br />
              完成门：{task.acceptanceGateIds.length ? task.acceptanceGateIds.join('、') : '仅结构与回执校验'}
            </p>
          </article>)}
        </div>
      </section>

      <section className="rounded-xl border border-success/30 bg-success/5 p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Play className="h-4 w-4" />4. 正式开始</h2>
        <p className="mt-2 text-xs leading-6 text-text-muted">
          开始后会自动进入持久化制作工作台。关闭页面或刷新不会丢失已完成任务；遇到来源、配置、预算、协议或结果未知问题时会停在明确恢复点。
        </p>
        <button type="button" onClick={() => void start()} disabled={busy != null}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-success px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-40">
          {busy === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}
          再次复验并创建 Build
        </button>
      </section>
    </>}
  </main>
}

export default TextOpenWorldCreatorProductionStart
