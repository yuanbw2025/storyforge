/** UI routing only. Durable Run/attempt, zero new usage and the complete
 * signed prefix must still be verified before a child can be authorized. */
export function isTextOpenWorldBudgetRecoveryFailureV1(failureJson: string): boolean {
  try {
    const failure = JSON.parse(failureJson) as Record<string, unknown> | null
    if (!failure || Array.isArray(failure) || typeof failure.detail !== 'string') return false
    if (failure.code === 'task-budget-exceeded') {
      return failure.detail.startsWith('[product-production-scheduler] Build lifetime budget 不足:')
    }
    // P1 checks the remaining input/output reservation against its actual
    // frozen batches. That refusal is a draft-rejected boundary, even when
    // some model calls remain. Do not mistake arbitrary draft errors for it.
    return failure.taskKey === 'p1.source-curation' && failure.code === 'task-draft-rejected'
      && (/^P1本次attempt剩余模型预算不足:\d+\/\d+\/\d+$/.test(failure.detail)
        || /^P1本次attempt剩余预算不能覆盖未执行批次:source-curation\.batch\.\d{3}$/.test(failure.detail))
  } catch {
    return false
  }
}
