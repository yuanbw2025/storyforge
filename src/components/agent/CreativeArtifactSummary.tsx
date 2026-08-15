import type { CreativeArtifactV1 } from '../../lib/agent/creative-reliability'
import type { NarrativeBriefV1 } from '../../lib/agent/narrative-brief'

const STATUS_VIEW = {
  ready: {
    label: '可直接采纳',
    className: 'border-success/30 bg-success/5 text-success',
  },
  'usable-with-warnings': {
    label: '可用，但有提示',
    className: 'border-warning/40 bg-warning/5 text-warning',
  },
  'manual-repair': {
    label: '需要手动修复',
    className: 'border-warning/40 bg-warning/5 text-warning',
  },
  blocked: {
    label: '存在阻断问题',
    className: 'border-error/40 bg-error/5 text-error',
  },
} as const

const REPAIR_LABELS = {
  repaired: '定向修复成功',
  partial: '定向修复后仍有提示',
  failed: '定向修复未成功，已停止自动调用',
} as const

export default function CreativeArtifactSummary({
  artifact,
  narrativeBrief,
}: {
  artifact: CreativeArtifactV1
  narrativeBrief?: NarrativeBriefV1
}) {
  const view = STATUS_VIEW[artifact.status]
  const totalTokens = artifact.callEvidence.reduce(
    (sum, call) => sum + (call.totalTokens ?? 0),
    0,
  )
  const tokenEvidenceComplete = artifact.callEvidence.every(call => call.totalTokens != null)
  const totalLatencyMs = artifact.callEvidence.reduce((sum, call) => sum + (call.latencyMs ?? 0), 0)
  const latencyEvidenceComplete = artifact.callEvidence.every(call => call.latencyMs != null)
  const totalCostUsd = artifact.callEvidence.reduce(
    (sum, call) => sum + (call.estimatedCostUsd ?? 0),
    0,
  )
  const costEvidenceComplete = artifact.callEvidence.every(call => call.estimatedCostUsd != null)

  return (
    <section
      aria-label="创作产物状态"
      className={`mt-2 rounded border px-2.5 py-2 text-[10px] ${view.className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-[11px]">{view.label}</strong>
        <span>
          {artifact.callEvidence.length} 次模型调用
          {tokenEvidenceComplete ? ` · ${totalTokens.toLocaleString()} tokens` : ' · token 用量不完整'}
        </span>
      </div>
      <p className="mt-1">
        {costEvidenceComplete ? `估算费用 $${totalCostUsd.toFixed(6)}` : '费用暂无法估算'}
        {' · '}
        {latencyEvidenceComplete ? `模型耗时 ${totalLatencyMs.toLocaleString()}ms` : '耗时证据不完整'}
      </p>
      {artifact.repair && (
        <p className="mt-1">{REPAIR_LABELS[artifact.repair.result]}</p>
      )}
      {artifact.validFragments.length > 0 && artifact.rejectedFragments.length > 0 && (
        <p className="mt-1">
          已保留 {artifact.validFragments.length} 个合法片段，拒绝 {artifact.rejectedFragments.length} 个损坏片段。
        </p>
      )}
      {narrativeBrief && (
        <details className="mt-1.5">
          <summary className="cursor-pointer">查看本轮故事推进目标</summary>
          <div className="mt-1 space-y-0.5">
            <p>目标：{narrativeBrief.creativeGoal}</p>
            <p>进入时：{narrativeBrief.entryState}</p>
            <p>人物想要：{narrativeBrief.protagonistDesire}</p>
            <p>当前阻力：{narrativeBrief.obstacle}</p>
            <p>必须面对的选择：{narrativeBrief.requiredChoice}</p>
            <p>失败代价：{narrativeBrief.stakes}</p>
            <p>要发生的变化：{narrativeBrief.exitChange}</p>
            <p>下一步压力：{narrativeBrief.nextPressure}</p>
            {narrativeBrief.mustHonor.length > 0 && (
              <div className="pt-0.5">
                <p>本轮采用的项目依据（来自已登记正式数据）：</p>
                <ul className="list-disc pl-4">
                  {narrativeBrief.mustHonor.slice(0, 8).map((item, index) => (
                    <li key={`${index}:${item}`}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
      {artifact.assumptions.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer">
            查看 {artifact.assumptions.length} 项临时假设（采纳前不是正式设定）
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {artifact.assumptions.slice(0, 12).map(assumption => (
              <li key={assumption.id}>{assumption.text}</li>
            ))}
          </ul>
        </details>
      )}
      {artifact.issues.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer">查看 {artifact.issues.length} 个问题</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {artifact.issues.slice(0, 8).map((issue, index) => (
              <li key={`${issue.code}:${issue.path}:${index}`}>{issue.message}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
