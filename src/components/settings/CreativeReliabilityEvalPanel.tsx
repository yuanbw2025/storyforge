import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, LoaderCircle, Pause, Play, RotateCcw, Save, Upload } from 'lucide-react'
import { isAIConfigReady } from '../../lib/ai/config-readiness'
import { hashCanonicalValue } from '../../lib/agent/run/hash'
import {
  cleanupStrandedCreativeReliabilityWorkspacesV1,
  createCreativeReliabilityBrowserDependenciesV1,
} from '../../lib/evals/creative-reliability/browser'
import {
  claimCreativeReliabilityHeldoutRunV1,
} from '../../lib/evals/creative-reliability/evidence'
import {
  CREATIVE_RELIABILITY_FIXTURE_SET_VERSION_V1,
  getCreativeReliabilityFixturesV1,
} from '../../lib/evals/creative-reliability/fixtures'
import {
  CREATIVE_RELIABILITY_VERIFIER_PROMPT_VERSION_V1,
} from '../../lib/evals/creative-reliability/protocol'
import {
  applyCreativeReliabilityReviewsToCheckpointV1,
  archiveCreativeReliabilityEvalCheckpointV1,
  clearCreativeReliabilityEvalCheckpointV1,
  exportCreativeReliabilityEvalCheckpointV1,
  importCreativeReliabilityEvalCheckpointV1,
  loadCreativeReliabilityEvalCheckpointArchivesV1,
  loadCreativeReliabilityEvalCheckpointV1,
  persistCreativeReliabilityEvalCheckpointV1,
  runCreativeReliabilityEvalV1,
  verifyCreativeReliabilityEvalCheckpointV1,
  type CreativeReliabilityEvalCheckpointV1,
} from '../../lib/evals/creative-reliability/runner'
import type {
  CreativeReliabilityBlindVerdictV1,
  CreativeReliabilityEvalSplitV1,
  CreativeReliabilityEvalVariantV1,
  CreativeReliabilityHumanReviewV1,
} from '../../lib/evals/creative-reliability/types'
import type { AIConfig, AIConfigPreset } from '../../lib/types'
import { APP_BUILD_ID } from '../../lib/version'
import {
  getAIConfigPresetSessionApiKey,
  useAIConfigStore,
} from '../../stores/ai-config'
import { useDialog } from '../shared/Dialog'

const GENERATOR_PAIR_VERSION = 'crel-story-arc-paired-v1'

function presetConfig(preset: AIConfigPreset, current: AIConfig): AIConfig {
  const apiKey = preset.config.apiKey
    || getAIConfigPresetSessionApiKey(preset.id)
    || (preset.config.provider === current.provider ? current.apiKey : '')
  return { ...preset.config, apiKey }
}

function defaultPresetId(presets: AIConfigPreset[], pattern: RegExp, exclude?: string): string {
  return presets.find(item => item.id !== exclude && pattern.test(`${item.name} ${item.config.model}`))?.id
    ?? presets.find(item => item.id !== exclude)?.id
    ?? ''
}

function attemptedSteps(checkpoint: CreativeReliabilityEvalCheckpointV1 | null): number {
  if (!checkpoint) return 0
  return checkpoint.cases.reduce((sum, item) => (
    sum + Object.keys(item.generations).length + Object.keys(item.verifications).length
  ), 0)
}

function downloadJson(raw: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function blindOrder(
  checkpoint: CreativeReliabilityEvalCheckpointV1,
  fixtureId: string,
): [CreativeReliabilityEvalVariantV1, CreativeReliabilityEvalVariantV1] {
  const nibble = Number.parseInt(checkpoint.checkpointHash.slice(-1), 16)
  const index = checkpoint.cases.findIndex(item => item.fixtureId === fixtureId)
  return (nibble + index) % 2 === 0
    ? ['baseline-direct', 'creative-reliability']
    : ['creative-reliability', 'baseline-direct']
}

function initialVerdict(output: string, label: 'A' | 'B'): CreativeReliabilityBlindVerdictV1 {
  return {
    label,
    willingToEdit: Boolean(output.trim()),
    estimatedEditMinutes: output.trim() ? 15 : 0,
    retainedRatio: output.trim() ? 0.7 : 0,
  }
}

function CandidateReview(props: {
  label: 'A' | 'B'
  output: string
  verdict: CreativeReliabilityBlindVerdictV1
  onChange: (value: CreativeReliabilityBlindVerdictV1) => void
}) {
  return (
    <div className="rounded-md border border-border bg-bg-base p-2">
      <h6 className="text-xs font-medium text-text-primary">候选 {props.label}</h6>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-bg-elevated p-2 text-[10px] text-text-secondary">
        {props.output || '（没有可编辑产物）'}
      </pre>
      <label className="mt-2 flex items-center gap-2 text-[10px] text-text-muted">
        <input
          type="checkbox"
          aria-label={`候选 ${props.label} 愿意继续编辑`}
          checked={props.verdict.willingToEdit}
          onChange={event => props.onChange({ ...props.verdict, willingToEdit: event.target.checked })}
        />
        我愿意基于它继续编辑
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[10px] text-text-muted">
          预计修改分钟
          <input
            type="number"
            min={0}
            max={9_999}
            value={props.verdict.estimatedEditMinutes}
            onChange={event => props.onChange({
              ...props.verdict,
              estimatedEditMinutes: Math.max(0, Number(event.target.value) || 0),
            })}
            className="mt-1 w-full rounded border border-border bg-bg-elevated px-2 py-1 text-xs text-text-primary"
          />
        </label>
        <label className="text-[10px] text-text-muted">
          可保留比例 %
          <input
            type="number"
            min={0}
            max={100}
            value={Math.round(props.verdict.retainedRatio * 100)}
            onChange={event => props.onChange({
              ...props.verdict,
              retainedRatio: Math.max(0, Math.min(1, (Number(event.target.value) || 0) / 100)),
            })}
            className="mt-1 w-full rounded border border-border bg-bg-elevated px-2 py-1 text-xs text-text-primary"
          />
        </label>
      </div>
    </div>
  )
}

export default function CreativeReliabilityEvalPanel() {
  const currentConfig = useAIConfigStore(state => state.config)
  const presets = useAIConfigStore(state => state.presets)
  const dialog = useDialog()
  const [generatorPresetId, setGeneratorPresetId] = useState('')
  const [verifierPresetId, setVerifierPresetId] = useState('')
  const [split, setSplit] = useState<CreativeReliabilityEvalSplitV1>('development')
  const [checkpoint, setCheckpoint] = useState<CreativeReliabilityEvalCheckpointV1 | null>(null)
  const [archives, setArchives] = useState<CreativeReliabilityEvalCheckpointV1[]>(() => (
    loadCreativeReliabilityEvalCheckpointArchivesV1()
  ))
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [reviewer, setReviewer] = useState('')
  const [verdictA, setVerdictA] = useState(() => initialVerdict('', 'A'))
  const [verdictB, setVerdictB] = useState(() => initialVerdict('', 'B'))
  const [preferred, setPreferred] = useState<'A' | 'B' | 'tie'>('tie')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const stopRequested = useRef(false)

  useEffect(() => {
    setGeneratorPresetId(current => current || defaultPresetId(presets, /agnes-2\.5-flash|agnes.*2\.5/i))
    setVerifierPresetId(current => current || defaultPresetId(
      presets,
      /deepseek-v4-pro-260425|deepseek.*v4.*pro/i,
      generatorPresetId,
    ))
  }, [generatorPresetId, presets])

  useEffect(() => {
    const stored = loadCreativeReliabilityEvalCheckpointV1()
    if (!stored) return
    const fixtures = getCreativeReliabilityFixturesV1(stored.split)
    void verifyCreativeReliabilityEvalCheckpointV1(stored, fixtures).then(valid => {
      if (!valid) {
        setError('本机 CREL checkpoint 验签失败；请导出排查后清除。')
        return
      }
      setCheckpoint(stored)
      setSplit(stored.split)
    })
  }, [])

  const generatorPreset = presets.find(item => item.id === generatorPresetId) ?? null
  const verifierPreset = presets.find(item => item.id === verifierPresetId) ?? null
  const generatorConfig = useMemo(() => (
    generatorPreset ? presetConfig(generatorPreset, currentConfig) : null
  ), [currentConfig, generatorPreset])
  const verifierConfig = useMemo(() => (
    verifierPreset ? presetConfig(verifierPreset, currentConfig) : null
  ), [currentConfig, verifierPreset])
  const fixtures = getCreativeReliabilityFixturesV1(checkpoint?.split ?? split)
  const record = checkpoint?.record ?? null
  const currentReviewCase = record?.cases.find(item => item.humanReview == null) ?? null
  const currentFixture = currentReviewCase
    ? fixtures.find(item => item.id === currentReviewCase.fixtureId) ?? null
    : null
  const currentBlindOrder = checkpoint && currentReviewCase
    ? blindOrder(checkpoint, currentReviewCase.fixtureId)
    : null
  const outputFor = (label: 'A' | 'B') => {
    if (!currentReviewCase || !currentBlindOrder) return ''
    const variant = currentBlindOrder[label === 'A' ? 0 : 1]
    return currentReviewCase.generations[variant].presentedText
  }

  useEffect(() => {
    setVerdictA(initialVerdict(outputFor('A'), 'A'))
    setVerdictB(initialVerdict(outputFor('B'), 'B'))
    setPreferred('tie')
    // outputFor intentionally derives from the newly selected case.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentReviewCase?.fixtureId, checkpoint?.checkpointHash])

  const run = async () => {
    setRunning(true)
    setError('')
    stopRequested.current = false
    try {
      const completedDevelopment = checkpoint?.status === 'completed' && checkpoint.split === 'development'
      if (checkpoint?.status === 'completed' && checkpoint.split === 'held-out') {
        throw new Error('sealed held-out 已完成，禁止创建第二次运行')
      }
      const resumeCheckpoint = completedDevelopment ? null : checkpoint
      if (completedDevelopment) {
        setArchives(await archiveCreativeReliabilityEvalCheckpointV1(
          checkpoint,
          getCreativeReliabilityFixturesV1(checkpoint.split),
        ))
      }
      if (!generatorConfig || !verifierConfig) throw new Error('请先选择 generator 与独立 verifier 预设')
      if (!isAIConfigReady(generatorConfig) || !isAIConfigReady(verifierConfig)) {
        throw new Error('所选预设缺少可用 API Key、Base URL 或模型')
      }
      if (generatorConfig.provider === verifierConfig.provider && generatorConfig.model === verifierConfig.model) {
        throw new Error('generator 与 verifier 必须使用不同 provider/model 身份')
      }
      const selectedFixtures = getCreativeReliabilityFixturesV1(resumeCheckpoint?.split ?? split)
      if (!resumeCheckpoint && split === 'held-out') {
        const confirmed = await dialog.confirm({
          title: '运行一次性封存集？',
          message: '这 6 例结果只允许保留原样并运行一次，失败也不能清除后调参重跑。上限 30 次 API 调用。',
          confirmText: '确认运行一次',
          cancelText: '先不运行',
          tone: 'danger',
        })
        if (!confirmed) return
      }
      const runId = resumeCheckpoint?.runId ?? `crel-${split}-${crypto.randomUUID()}`
      if ((resumeCheckpoint?.split ?? split) === 'held-out') {
        claimCreativeReliabilityHeldoutRunV1({
          runId,
          fixtureSetHash: await hashCanonicalValue(selectedFixtures),
        })
      }
      if (resumeCheckpoint && (
        resumeCheckpoint.generator.provider !== generatorConfig.provider
        || resumeCheckpoint.generator.model !== generatorConfig.model
        || resumeCheckpoint.verifier.provider !== verifierConfig.provider
        || resumeCheckpoint.verifier.model !== verifierConfig.model
      )) throw new Error('当前预设与 checkpoint 冻结模型身份不一致')
      await cleanupStrandedCreativeReliabilityWorkspacesV1()
      const next = await runCreativeReliabilityEvalV1({
        suiteVersion: CREATIVE_RELIABILITY_FIXTURE_SET_VERSION_V1,
        runId,
        codeRevision: resumeCheckpoint?.codeRevision ?? APP_BUILD_ID,
        fixtures: selectedFixtures,
        generator: resumeCheckpoint?.generator ?? {
          provider: generatorConfig.provider,
          model: generatorConfig.model,
          promptVersion: GENERATOR_PAIR_VERSION,
        },
        verifier: resumeCheckpoint?.verifier ?? {
          provider: verifierConfig.provider,
          model: verifierConfig.model,
          promptVersion: CREATIVE_RELIABILITY_VERIFIER_PROMPT_VERSION_V1,
        },
        parameters: { temperature: 0.55, maxOutputTokens: 6_000 },
        dependencies: createCreativeReliabilityBrowserDependenciesV1({
          generatorConfig,
          verifierConfig,
        }),
        ...(resumeCheckpoint ? { resumeFrom: resumeCheckpoint } : {}),
        onCheckpoint: async value => {
          await persistCreativeReliabilityEvalCheckpointV1(value)
          setCheckpoint(value)
          if (stopRequested.current) throw new Error('CREL_RUN_STOPPED')
        },
      })
      setCheckpoint(next)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message === 'CREL_RUN_STOPPED'
        ? '已在当前 API 调用完成并保存证据后停止；可以继续。'
        : message)
    } finally {
      setRunning(false)
    }
  }

  const reset = async () => {
    if (!checkpoint) return
    const confirmed = await dialog.confirm({
      title: `清除 ${checkpoint.split} checkpoint？`,
      message: checkpoint.split === 'held-out'
        ? '封存集运行声明不会被清除；删除 checkpoint 后不能重新运行，请务必先下载。'
        : '请先下载需要保留的证据。development 可重新运行。',
      confirmText: '清除 checkpoint',
      cancelText: '保留',
      tone: 'danger',
    })
    if (!confirmed) return
    clearCreativeReliabilityEvalCheckpointV1()
    await cleanupStrandedCreativeReliabilityWorkspacesV1()
    setCheckpoint(null)
    setError('')
  }

  const exportCheckpoint = async () => {
    if (!checkpoint) return
    try {
      downloadJson(
        await exportCreativeReliabilityEvalCheckpointV1(checkpoint, fixtures),
        `storyforge-crel-${checkpoint.split}-${checkpoint.status}-${Date.now()}.json`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const exportLatestArchive = async () => {
    const archived = archives[0]
    if (!archived) return
    try {
      downloadJson(
        await exportCreativeReliabilityEvalCheckpointV1(
          archived,
          getCreativeReliabilityFixturesV1(archived.split),
        ),
        `storyforge-crel-${archived.split}-archived-${archived.runId}.json`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const importFile = async (file: File) => {
    try {
      const raw = await file.text()
      const parsed = JSON.parse(raw) as { split?: CreativeReliabilityEvalSplitV1 }
      if (parsed.split !== 'development' && parsed.split !== 'held-out') throw new Error('CREL split 无效')
      const imported = await importCreativeReliabilityEvalCheckpointV1(
        raw,
        getCreativeReliabilityFixturesV1(parsed.split),
      )
      await persistCreativeReliabilityEvalCheckpointV1(imported)
      setCheckpoint(imported)
      setSplit(imported.split)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const saveReview = async () => {
    if (!checkpoint || !record || !currentReviewCase || !currentBlindOrder || !reviewer.trim()) return
    try {
      const reviewerIdHash = await hashCanonicalValue(reviewer.trim())
      const existingReviewer = record.cases.find(item => item.humanReview)?.humanReview?.reviewerIdHash
      if (existingReviewer && existingReviewer !== reviewerIdHash) {
        throw new Error('请使用与已有盲评相同的复核者标识')
      }
      const reviews = Object.fromEntries(record.cases.flatMap(item => (
        item.humanReview ? [[item.fixtureId, item.humanReview] as const] : []
      )))
      reviews[currentReviewCase.fixtureId] = {
        reviewerIdHash,
        completedAt: Date.now(),
        blindOrder: currentBlindOrder,
        verdicts: [verdictA, verdictB],
        preferred,
      } satisfies CreativeReliabilityHumanReviewV1
      const next = await applyCreativeReliabilityReviewsToCheckpointV1({
        checkpoint,
        fixtures,
        reviews,
      })
      await persistCreativeReliabilityEvalCheckpointV1(next)
      setCheckpoint(next)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const aggregate = record?.aggregate
  const reviewedCount = record?.cases.filter(item => item.humanReview != null).length ?? 0

  return (
    <section data-testid="crel-eval-panel" className="border-t border-border pt-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-xs font-medium text-text-primary">CREL-13 创作可靠性验收</h4>
          <p className="mt-1 text-[10px] text-text-muted">
            6 组成对 A/B · 最多 18 次生成（旧 6 + 新 12）+ 12 次独立验证 = 30 次调用
          </p>
          <p className="mt-1 text-[10px] text-text-muted">
            每次调用后落盘；停止不会丢证据。模型价格未知时只把真实 tokens/调用数作为硬成本证据。
          </p>
        </div>
        <div className="flex gap-2">
          {running && (
            <button
              type="button"
              data-testid="crel-stop"
              onClick={() => { stopRequested.current = true }}
              className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-warning"
            >
              <Pause className="h-3.5 w-3.5" />当前调用后停止
            </button>
          )}
          <button
            type="button"
            data-testid="crel-run"
            onClick={() => { void run() }}
            disabled={running || checkpoint?.split === 'held-out' && checkpoint.status === 'completed'}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-400 disabled:opacity-40"
          >
            {running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {running
              ? `${attemptedSteps(checkpoint)}/24`
              : checkpoint?.status === 'completed' && checkpoint.split === 'development'
                ? '归档并重跑 Development'
                : checkpoint && checkpoint.status !== 'completed' ? '继续' : '运行'}
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="text-[10px] text-text-muted">
          数据集
          <select
            data-testid="crel-split"
            value={checkpoint?.split ?? split}
            disabled={running || checkpoint != null}
            onChange={event => setSplit(event.target.value as CreativeReliabilityEvalSplitV1)}
            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
          >
            <option value="development">Development（可调试）</option>
            <option value="held-out">Sealed held-out（仅一次）</option>
          </select>
        </label>
        <label className="text-[10px] text-text-muted">
          Generator 预设
          <select
            data-testid="crel-generator"
            value={generatorPresetId}
            disabled={running || checkpoint != null}
            onChange={event => setGeneratorPresetId(event.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
          >
            <option value="">请选择</option>
            {presets.map(item => <option key={item.id} value={item.id}>{item.name} · {item.config.model}</option>)}
          </select>
        </label>
        <label className="text-[10px] text-text-muted">
          独立 Verifier 预设
          <select
            data-testid="crel-verifier"
            value={verifierPresetId}
            disabled={running || checkpoint != null}
            onChange={event => setVerifierPresetId(event.target.value)}
            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
          >
            <option value="">请选择</option>
            {presets.map(item => <option key={item.id} value={item.id}>{item.name} · {item.config.model}</option>)}
          </select>
        </label>
      </div>

      {checkpoint && (
        <div className="mt-3 rounded-md border border-border bg-bg-base p-2 text-[11px] text-text-secondary">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            <span>状态 {checkpoint.status}</span>
            <span>步骤 {attemptedSteps(checkpoint)}/24</span>
            <span>{checkpoint.split}</span>
            <span>{checkpoint.generator.model} → {checkpoint.verifier.model}</span>
          </div>
          {aggregate && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-[10px]">
                <thead className="text-text-muted"><tr><th>方案</th><th>可编辑</th><th>可采纳</th><th>平均调用</th><th>tokens/可采纳</th><th>语义</th><th>推进</th></tr></thead>
                <tbody>
                  <tr className="border-t border-border/50">
                    <td>旧直连</td>
                    <td>{(aggregate.baselineDirect.editableArtifactRate * 100).toFixed(0)}%</td>
                    <td>{(aggregate.baselineDirect.adoptableRate * 100).toFixed(0)}%</td>
                    <td>{aggregate.baselineDirect.averageArtifactModelCalls.toFixed(2)}</td>
                    <td>{aggregate.baselineDirect.tokensPerAdoptableArtifact?.toFixed(0) ?? '—'}</td>
                    <td>{(aggregate.baselineDirect.semanticScore * 100).toFixed(0)}%</td>
                    <td>{(aggregate.baselineDirect.narrativeProgressRate * 100).toFixed(0)}%</td>
                  </tr>
                  <tr className="border-t border-border/50">
                    <td>CREL</td>
                    <td>{(aggregate.creativeReliability.editableArtifactRate * 100).toFixed(0)}%</td>
                    <td>{(aggregate.creativeReliability.adoptableRate * 100).toFixed(0)}%</td>
                    <td>{aggregate.creativeReliability.averageArtifactModelCalls.toFixed(2)}</td>
                    <td>{aggregate.creativeReliability.tokensPerAdoptableArtifact?.toFixed(0) ?? '—'}</td>
                    <td>{(aggregate.creativeReliability.semanticScore * 100).toFixed(0)}%</td>
                    <td>{(aggregate.creativeReliability.narrativeProgressRate * 100).toFixed(0)}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {record && (
            <div className="mt-2 space-y-1">
              <p data-testid="crel-machine-gate" className={record.machineGate.passed ? 'text-success' : 'text-error'}>
                机器门：{record.machineGate.passed ? 'PASS' : `FAIL · ${record.machineGate.failures.join(', ')}`}
              </p>
              <p data-testid="crel-community-gate" className={record.communityGate.passed ? 'text-success' : 'text-warning'}>
                社区体验门：{record.communityGate.passed ? 'PASS' : `待完成/未达标 · ${record.communityGate.failures.join(', ')}`}
              </p>
            </div>
          )}
          <p className="mt-2 break-all font-mono text-[10px] text-text-muted">checkpoint {checkpoint.checkpointHash}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button type="button" onClick={() => { void exportCheckpoint() }} className="inline-flex items-center gap-1 text-accent">
              <Download className="h-3 w-3" />下载验签证据
            </button>
            <button type="button" onClick={() => { void reset() }} className="inline-flex items-center gap-1 text-error">
              <RotateCcw className="h-3 w-3" />清除
            </button>
            {archives.length > 0 && (
              <button type="button" onClick={() => { void exportLatestArchive() }} className="inline-flex items-center gap-1 text-text-muted">
                <Download className="h-3 w-3" />下载上一轮归档（共 {archives.length} 轮）
              </button>
            )}
          </div>
        </div>
      )}

      {checkpoint?.status === 'completed' && record && currentReviewCase && currentFixture && (
        <div data-testid="crel-human-review" className="mt-3 rounded-md border border-border bg-bg-base p-3">
          <h5 className="text-xs font-medium text-text-primary">独立作者 A/B 盲评 · {reviewedCount}/6</h5>
          <p className="mt-1 text-[10px] text-text-muted">页面只显示候选 A/B；完成本例前不揭示其来自哪条路径。</p>
          <div className="mt-2 rounded bg-bg-elevated p-2 text-[10px] text-text-secondary">
            <p>{currentFixture.projectName} · {currentFixture.authorRequest}</p>
            <p className="mt-1">硬规则：{currentFixture.worldRules || '未提供'}</p>
            <p className="mt-1">必须满足：{currentFixture.requiredFacts.map(item => item.description).join('；')}</p>
          </div>
          <label className="mt-2 block text-[10px] text-text-muted">
            复核者标识（只写入 SHA-256）
            <input
              data-testid="crel-reviewer"
              value={reviewer}
              onChange={event => setReviewer(event.target.value)}
              className="mt-1 w-full rounded border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text-primary"
            />
          </label>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            <CandidateReview label="A" output={outputFor('A')} verdict={verdictA} onChange={setVerdictA} />
            <CandidateReview label="B" output={outputFor('B')} verdict={verdictB} onChange={setVerdictB} />
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-[10px] text-text-muted">
              偏好
              <select
                value={preferred}
                onChange={event => setPreferred(event.target.value as 'A' | 'B' | 'tie')}
                className="ml-2 rounded border border-border bg-bg-elevated px-2 py-1 text-xs text-text-primary"
              >
                <option value="A">候选 A</option>
                <option value="B">候选 B</option>
                <option value="tie">平局</option>
              </select>
            </label>
            <button
              type="button"
              data-testid="crel-save-review"
              disabled={!reviewer.trim()}
              onClick={() => { void saveReview() }}
              className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-400 disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" />保存并进入下一例
            </button>
          </div>
        </div>
      )}

      {checkpoint?.status === 'completed' && record && !currentReviewCase && (
        <p data-testid="crel-human-complete" className="mt-3 text-[11px] text-success">
          6/6 盲评完成；已重新验签，社区体验门结果见上方。
        </p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={event => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.currentTarget.value = ''
        }}
      />
      <button
        type="button"
        disabled={running}
        onClick={() => fileInputRef.current?.click()}
        className="mt-2 inline-flex items-center gap-1 text-[10px] text-text-muted disabled:opacity-40"
      >
        <Upload className="h-3 w-3" />导入 CREL checkpoint
      </button>
      {error && <p data-testid="crel-error" className="mt-2 text-[11px] text-error">{error}</p>}
    </section>
  )
}
