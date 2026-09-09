import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Coins,
  Database,
  ExternalLink,
  KeyRound,
  Loader2,
  Server,
  ShieldCheck,
} from 'lucide-react'
import type { TextOpenWorldCreatorProductionPreflightConfirmationV1 } from '../../lib/types'
import type { TextOpenWorldCreatorBriefSessionV1 } from '../../lib/open-world/creator-brief'
import {
  confirmTextOpenWorldCreatorProductionPreflightV1,
  createTextOpenWorldCreatorProductionPreflightV1,
  defaultTextOpenWorldCreatorPricingModeV1,
  isTextOpenWorldCreatorLocalEndpointV1,
  type TextOpenWorldCreatorManualPriceV1,
  type TextOpenWorldCreatorPreflightAcknowledgementV1,
  type TextOpenWorldCreatorPricingModeV1,
} from '../../lib/open-world/creator-production-preflight'
import { knownProviderModelPrice } from '../../lib/ai/usage-log'
import { useAIConfigStore } from '../../stores/ai-config'

export interface TextOpenWorldCreatorProductionReadinessProps {
  session: TextOpenWorldCreatorBriefSessionV1
  onBack: () => void
  onOpenSettings?: () => void
  onConfirmed?: (confirmation: TextOpenWorldCreatorProductionPreflightConfirmationV1) => void
}

const EMPTY_ACKNOWLEDGEMENT: TextOpenWorldCreatorPreflightAcknowledgementV1 = {
  credentialPolicyReviewed: false,
  providerAndModelReviewed: false,
  priceAndBudgetReviewed: false,
  mediaCostBoundaryReviewed: false,
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000)
  return minutes >= 60 ? `${(minutes / 60).toFixed(1)} 小时` : `${minutes} 分钟`
}

function formatBytes(value: number): string {
  return `${(value / 1_000_000).toFixed(0)} MB`
}

function compactHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

function cost(value: number | null): string {
  return value == null ? '未知' : `$${value.toFixed(value >= 1 ? 2 : 4)}`
}

export function TextOpenWorldCreatorProductionReadiness(
  props: TextOpenWorldCreatorProductionReadinessProps,
) {
  const aiConfig = useAIConfigStore(state => state.config)
  const rememberApiKey = useAIConfigStore(state => state.rememberApiKey)
  const presets = useAIConfigStore(state => state.presets)
  const taskRoutes = useAIConfigStore(state => state.taskRoutes)
  const [pricingMode, setPricingMode] = useState<TextOpenWorldCreatorPricingModeV1>(() => (
    defaultTextOpenWorldCreatorPricingModeV1(aiConfig, props.session.scope.projectId)
  ))
  const [manualPrice, setManualPrice] = useState<TextOpenWorldCreatorManualPriceV1>({
    inputUsdPerMillionTokens: null,
    outputUsdPerMillionTokens: null,
    sourceLabel: '',
    asOf: new Date().toISOString().slice(0, 10),
  })
  const [preflight, setPreflight] = useState<Awaited<ReturnType<
    typeof createTextOpenWorldCreatorProductionPreflightV1
  >> | null>(null)
  const [acknowledgement, setAcknowledgement] = useState(EMPTY_ACKNOWLEDGEMENT)
  const [confirmation, setConfirmation] = useState<TextOpenWorldCreatorProductionPreflightConfirmationV1 | null>(null)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const brief = props.session.confirmedBrief
  const hasCatalogPrice = Boolean(preflight && knownProviderModelPrice(
    preflight.providerBinding.provider,
    preflight.providerBinding.model,
  ) && preflight.providerBinding.catalogPricingEligible)
  const localEndpoint = Boolean(preflight
    && isTextOpenWorldCreatorLocalEndpointV1(preflight.providerBinding.endpointOrigin))
  const pricing = useMemo(() => ({
    mode: pricingMode,
    ...(pricingMode === 'manual' ? { manual: manualPrice } : {}),
  }), [manualPrice, pricingMode])

  useEffect(() => {
    setPricingMode(defaultTextOpenWorldCreatorPricingModeV1(aiConfig, props.session.scope.projectId))
    setAcknowledgement(EMPTY_ACKNOWLEDGEMENT)
    setConfirmation(null)
  }, [aiConfig, presets, props.session.scope.projectId, rememberApiKey, taskRoutes])

  useEffect(() => {
    const current = ++generation.current
    setPreflight(null)
    setConfirmation(null)
    setAcknowledgement(EMPTY_ACKNOWLEDGEMENT)
    setError('')
    if (!brief) return
    void createTextOpenWorldCreatorProductionPreflightV1({
      brief, projectId: props.session.scope.projectId, aiConfig, rememberApiKey, pricing,
    }).then(result => {
      if (generation.current === current) setPreflight(result)
    }).catch(() => {
      if (generation.current === current) setError('无法完成生产前检查；没有创建 Build 或发出模型请求。')
    })
    return () => { generation.current += 1 }
  }, [aiConfig, brief, presets, pricing, props.session.scope.projectId, rememberApiKey, taskRoutes])

  const confirmedCandidate = brief && props.session.candidate?.candidateHash === brief.candidateEvidence.candidateHash
    ? props.session.candidate : null
  const consultationCalls = confirmedCandidate?.modelCalls ?? []
  const consultationTotals = consultationCalls.reduce((sum, item) => ({
    inputTokens: sum.inputTokens + item.inputTokens,
    outputTokens: sum.outputTokens + item.outputTokens,
    latencyMs: sum.latencyMs + item.latencyMs,
    costUsd: sum.costUsd == null || item.estimatedCostUsd == null
      ? null : sum.costUsd + item.estimatedCostUsd,
  }), { inputTokens: 0, outputTokens: 0, latencyMs: 0, costUsd: 0 as number | null })
  const allAcknowledged = Object.values(acknowledgement).every(Boolean)

  const confirm = async () => {
    if (!brief || !preflight) return
    setError('')
    try {
      const next = await confirmTextOpenWorldCreatorProductionPreflightV1({
        brief,
        preflight,
        projectId: props.session.scope.projectId,
        aiConfig,
        rememberApiKey,
        acknowledgement,
      })
      setConfirmation(next)
      props.onConfirmed?.(next)
    } catch {
      setError('当前检查尚未全部通过，或确认项不完整。')
    }
  }

  if (!brief) return <main className="mx-auto w-full max-w-6xl p-5">
    <section role="alert" className="rounded-xl border border-danger/40 bg-danger/5 p-5 text-sm text-danger">
      缺少已确认的 Creator Brief，不能进入模型与预算检查。
      <button type="button" onClick={props.onBack} className="ml-3 underline">返回 Brief</button>
    </section>
  </main>

  return <main
    className="mx-auto w-full max-w-6xl space-y-5 p-4 text-text-primary md:p-6"
    data-testid="text-open-world-creator-production-readiness"
  >
    <header className="rounded-xl border border-border bg-bg-elevated p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-[10px] font-semibold tracking-[0.2em] text-accent">TEXT OPEN WORLD · PREFLIGHT</span>
          <h1 className="mt-2 text-xl font-semibold">核对模型、凭证与生产预算</h1>
          <p className="mt-2 max-w-3xl text-xs leading-6 text-text-muted">
            这里只形成不含密钥的检查快照。确认不会创建 Build、SourcePlan 或启动计费；正式生产将在下一阶段再次复验 Brief、模型和报价。
          </p>
        </div>
        <button type="button" onClick={props.onBack}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:border-accent">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />返回 Brief
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-[10px] text-text-muted">
        <span className="rounded-full border border-border bg-bg-base px-3 py-1">Brief v{brief.revision}</span>
        <span className="rounded-full border border-border bg-bg-base px-3 py-1 font-mono">{compactHash(brief.briefHash)}</span>
        <span className="rounded-full border border-border bg-bg-base px-3 py-1">Build 0 · 未启动</span>
      </div>
    </header>

    {error && <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-4 text-sm text-danger">{error}</div>}
    {!preflight && !error && <div role="status" className="rounded-lg border border-border bg-bg-elevated p-4 text-sm text-text-muted">
      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />正在本地计算检查快照…
    </div>}

    {preflight && <>
      <section className="rounded-xl border border-border bg-bg-elevated p-5" aria-labelledby="tow-provider-heading">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="tow-provider-heading" className="flex items-center gap-2 text-base font-semibold"><Server className="h-4 w-4 text-accent" />1. 当前模型绑定</h2>
            <p className="mt-1 text-xs leading-5 text-text-muted">复用全局 AI 设置；本页没有第二个 Key 输入框，也不会读取或显示 Key 内容。</p>
          </div>
          {props.onOpenSettings
            ? <button type="button" onClick={props.onOpenSettings} className="inline-flex items-center gap-2 rounded-lg border border-accent/40 px-3 py-2 text-xs text-accent">
              打开 AI 设置<ExternalLink className="h-3.5 w-3.5" />
            </button>
            : <a href="/settings" className="inline-flex items-center gap-2 rounded-lg border border-accent/40 px-3 py-2 text-xs text-accent">打开 AI 设置<ExternalLink className="h-3.5 w-3.5" /></a>}
        </div>
        <dl className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-bg-base p-3"><dt className="text-[10px] text-text-muted">提供商</dt><dd className="mt-1 break-words text-sm font-medium">{preflight.providerBinding.provider}</dd></div>
          <div className="rounded-lg border border-border bg-bg-base p-3"><dt className="text-[10px] text-text-muted">模型</dt><dd className="mt-1 break-words text-sm font-medium">{preflight.providerBinding.model || '未配置'}</dd></div>
          <div className="rounded-lg border border-border bg-bg-base p-3"><dt className="text-[10px] text-text-muted">安全端点域名</dt><dd className="mt-1 break-all font-mono text-xs">{preflight.providerBinding.endpointOrigin || '无效地址'}</dd></div>
          <div className="rounded-lg border border-border bg-bg-base p-3"><dt className="text-[10px] text-text-muted">凭证状态</dt><dd className="mt-1 flex items-center gap-1.5 text-sm font-medium"><KeyRound className="h-3.5 w-3.5" />{
            preflight.providerBinding.credentialMode === 'session' ? '已配置 · 仅当前会话'
              : preflight.providerBinding.credentialMode === 'remembered-browser' ? '已配置 · 作者选择本地记住'
                : preflight.providerBinding.credentialMode === 'local-no-key' ? '本地服务 · 无需 Key'
                  : '缺少远程服务 Key'
          }</dd></div>
        </dl>
        <p className="mt-3 text-[11px] leading-5 text-text-muted">绑定 Hash：<span className="font-mono">{compactHash(preflight.providerBinding.bindingHash)}</span>。只含提供商、模型、端点 origin、不可反显的基础路径 Hash 和非敏感生成参数。</p>
      </section>

      <section className="rounded-xl border border-border bg-bg-elevated p-5" aria-labelledby="tow-price-heading">
        <h2 id="tow-price-heading" className="flex items-center gap-2 text-base font-semibold"><Coins className="h-4 w-4 text-accent" />2. 文本模型价格快照</h2>
        <p className="mt-1 text-xs leading-5 text-text-muted">价格按提供商与模型共同识别。中转站、同名模型或未知目录不会套用其他平台价格。</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5 text-xs font-medium" htmlFor="tow-pricing-mode">报价方式
            <select id="tow-pricing-mode" value={pricingMode}
              onChange={event => setPricingMode(event.target.value as TextOpenWorldCreatorPricingModeV1)}
              className="mt-1 w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm">
              <option value="catalog" disabled={!hasCatalogPrice}>StoryForge 内置工程报价{hasCatalogPrice ? '' : '（当前模型无条目）'}</option>
              <option value="manual">作者核对并录入供应商报价</option>
              <option value="local-zero" disabled={!localEndpoint || !preflight
                || !['ollama', 'custom'].includes(preflight.providerBinding.provider)}>本地自托管 token 零费用</option>
            </select>
          </label>
          {preflight.priceQuote && <div className="rounded-lg border border-border bg-bg-base p-3 text-xs">
            <div className="text-text-muted">当前快照</div>
            <div className="mt-1 font-medium">{preflight.priceQuote.sourceLabel} · {preflight.priceQuote.asOf}</div>
            <div className="mt-2 font-mono text-[11px]">输入 ${preflight.priceQuote.inputUsdPerMillionTokens}/1M · 输出 ${preflight.priceQuote.outputUsdPerMillionTokens}/1M</div>
          </div>}
        </div>
        {pricingMode === 'manual' && <div className="mt-4 grid gap-3 rounded-lg border border-border bg-bg-base p-4 md:grid-cols-2" data-testid="text-open-world-manual-price-fields">
          <label className="text-xs text-text-muted" htmlFor="tow-input-price">输入价格（USD / 1M tokens）
            <input id="tow-input-price" type="number" min={0} step="0.0001" value={manualPrice.inputUsdPerMillionTokens ?? ''}
              onChange={event => setManualPrice(current => ({ ...current, inputUsdPerMillionTokens: event.target.value === '' ? null : Number(event.target.value) }))}
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary" />
          </label>
          <label className="text-xs text-text-muted" htmlFor="tow-output-price">输出价格（USD / 1M tokens）
            <input id="tow-output-price" type="number" min={0} step="0.0001" value={manualPrice.outputUsdPerMillionTokens ?? ''}
              onChange={event => setManualPrice(current => ({ ...current, outputUsdPerMillionTokens: event.target.value === '' ? null : Number(event.target.value) }))}
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary" />
          </label>
          <label className="text-xs text-text-muted" htmlFor="tow-price-source">报价来源说明（短文字，不填 URL）
            <input id="tow-price-source" maxLength={100} value={manualPrice.sourceLabel}
              onChange={event => setManualPrice(current => ({ ...current, sourceLabel: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary" placeholder="例如：供应商官方定价页，作者已核对" />
          </label>
          <label className="text-xs text-text-muted" htmlFor="tow-price-date">核对日期
            <input id="tow-price-date" type="date" value={manualPrice.asOf}
              onChange={event => setManualPrice(current => ({ ...current, asOf: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary" />
          </label>
        </div>}
      </section>

      <section className="rounded-xl border border-border bg-bg-elevated p-5" aria-labelledby="tow-budget-heading">
        <h2 id="tow-budget-heading" className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="h-4 w-4 text-accent" />3. 单 Build 生产保护</h2>
        <p className="mt-1 text-xs leading-5 text-text-muted">下列 token 数是完整 DAG 的授权保留上界，不是承诺一定消耗；费用是按冻结单价计算的文本模型上界，不是供应商实际账单。</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="text-open-world-preflight-budget">
          <div className="rounded-lg border border-border bg-bg-base p-3"><dt className="text-[10px] text-text-muted">模型调用</dt><dd className="mt-1 text-sm font-semibold">{preflight.estimate.recommendedModelCalls} / {preflight.estimate.maximumModelCalls}</dd><small className="text-[10px] text-text-muted">计划授权 / 硬上限</small></div>
          <div className="rounded-lg border border-border bg-bg-base p-3"><dt className="text-[10px] text-text-muted">输入 token 上界</dt><dd className="mt-1 text-sm font-semibold">{formatTokens(preflight.estimate.reservedInputTokens)}</dd></div>
          <div className="rounded-lg border border-border bg-bg-base p-3"><dt className="text-[10px] text-text-muted">输出 token 上界</dt><dd className="mt-1 text-sm font-semibold">{formatTokens(preflight.estimate.reservedOutputTokens)}</dd></div>
          <div className="rounded-lg border border-border bg-bg-base p-3"><dt className="text-[10px] text-text-muted">文本模型估算上界</dt><dd className="mt-1 text-sm font-semibold">{cost(preflight.estimate.estimatedTextCostUsd)} / ${preflight.estimate.maximumCostUsd.toFixed(2)}</dd></div>
          <div className="rounded-lg border border-border bg-bg-base p-3"><dt className="text-[10px] text-text-muted">资源保护</dt><dd className="mt-1 text-sm font-semibold">{formatDuration(preflight.estimate.maximumDurationMs)}</dd><small className="text-[10px] text-text-muted">新增存储 {formatBytes(preflight.estimate.maximumStorageBytes)}</small></div>
        </dl>
      </section>

      <section className="rounded-xl border border-border bg-bg-elevated p-5" aria-labelledby="tow-usage-heading">
        <h2 id="tow-usage-heading" className="flex items-center gap-2 text-base font-semibold"><Clock3 className="h-4 w-4 text-accent" />4. 已发生的 Creator Brief 会谈用量</h2>
        {consultationCalls.length ? <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="text-open-world-consultation-usage">
            <div className="rounded-lg border border-border bg-bg-base p-3"><span className="text-[10px] text-text-muted">实际请求</span><strong className="mt-1 block text-sm">{consultationCalls.length} 次</strong></div>
            <div className="rounded-lg border border-border bg-bg-base p-3"><span className="text-[10px] text-text-muted">输入 / 输出</span><strong className="mt-1 block text-sm">{formatTokens(consultationTotals.inputTokens)} / {formatTokens(consultationTotals.outputTokens)}</strong></div>
            <div className="rounded-lg border border-border bg-bg-base p-3"><span className="text-[10px] text-text-muted">累计耗时</span><strong className="mt-1 block text-sm">{(consultationTotals.latencyMs / 1_000).toFixed(1)} 秒</strong></div>
            <div className="rounded-lg border border-border bg-bg-base p-3"><span className="text-[10px] text-text-muted">按已知价格估算</span><strong className="mt-1 block text-sm">{cost(consultationTotals.costUsd)}</strong><small className="text-[10px] text-text-muted">不是 Provider 实际账单</small></div>
          </div>
          <ul className="mt-3 space-y-1 text-[11px] text-text-muted">
            {consultationCalls.map((item, index) => <li key={`${item.provider}:${item.model}:${index}`}>
              #{index + 1} {item.provider} / {item.model} · {item.usageSource === 'provider' ? 'Provider token 回传' : '本地 token 估算'}
            </li>)}
          </ul>
        </> : <p className="mt-3 rounded-lg border border-border bg-bg-base p-3 text-xs text-text-muted">
          本次 Brief 由作者人工确认，没有发生模型调用或费用。
        </p>}
      </section>

      {preflight.blockers.length > 0 && <section role="alert" className="rounded-xl border border-danger/40 bg-danger/5 p-5 text-sm text-danger" data-testid="text-open-world-preflight-blockers">
        <h2 className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />尚不能确认生产准备</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">{preflight.blockers.map(item => <li key={item}>{item}</li>)}</ul>
      </section>}
      {preflight.warnings.length > 0 && <section className="rounded-xl border border-warning/35 bg-warning/5 p-5 text-xs leading-5 text-text-muted">
        <h2 className="font-semibold text-text-primary">必须理解的估算边界</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">{preflight.warnings.map(item => <li key={item}>{item}</li>)}</ul>
      </section>}

      <section className="rounded-xl border border-border bg-bg-elevated p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Database className="h-4 w-4 text-accent" />5. 作者确认</h2>
        <div className="mt-4 space-y-2">
          {([
            ['credentialPolicyReviewed', '我理解 Key 只由全局凭证设置持有，不进入 Prompt、Artifact、日志、项目备份或本检查快照'],
            ['providerAndModelReviewed', '我确认当前提供商、模型、安全端点域名和凭证存储方式'],
            ['priceAndBudgetReviewed', '我已核对价格来源，并理解调用、token 和费用均为单 Build 上限'],
            ['mediaCostBoundaryReviewed', '我理解本次金额只覆盖文本模型；实际媒资排产必须另行报价确认'],
          ] as const).map(([key, label]) => <label key={key} className="flex items-start gap-2 text-xs leading-5">
            <input type="checkbox" className="mt-1" checked={acknowledgement[key]}
              onChange={event => setAcknowledgement(current => ({ ...current, [key]: event.target.checked }))} />
            <span>{label}</span>
          </label>)}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-text-muted">{confirmation
            ? <><CheckCircle2 className="mr-1 inline h-4 w-4 text-success" />检查快照已确认；Build 仍为 0，尚未产生生产费用。</>
            : '刷新或更换 Brief、模型、Key 状态、端点、价格后必须重新确认。'}</p>
          <button type="button" onClick={confirm}
            disabled={!preflight.ready || !allAcknowledged || Boolean(confirmation)}
            data-testid="text-open-world-preflight-confirm"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
            <ShieldCheck className="h-4 w-4" />确认当前模型与预算
          </button>
        </div>
      </section>
    </>}
  </main>
}

export default TextOpenWorldCreatorProductionReadiness
