import type { CreativeArtifactV1 } from '../../lib/agent/creative-reliability'

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

export default function CreativeArtifactSummary({ artifact }: { artifact: CreativeArtifactV1 }) {
  const view = STATUS_VIEW[artifact.status]
  const totalTokens = artifact.callEvidence.reduce(
    (sum, call) => sum + (call.totalTokens ?? 0),
    0,
  )
  const tokenEvidenceComplete = artifact.callEvidence.every(call => call.totalTokens != null)

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
      {artifact.repair && (
        <p className="mt-1">{REPAIR_LABELS[artifact.repair.result]}</p>
      )}
      {artifact.validFragments.length > 0 && artifact.rejectedFragments.length > 0 && (
        <p className="mt-1">
          已保留 {artifact.validFragments.length} 个合法片段，拒绝 {artifact.rejectedFragments.length} 个损坏片段。
        </p>
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
