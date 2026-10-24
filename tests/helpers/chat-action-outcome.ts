/** Transport shape for injected engineering responses. This helper never runs
 * in production, validates no content, and leaves historical prompts unchanged.
 * Deliberately malformed wire-output tests must bypass it. */
export function chatActionOutcomeFixture(messages: ReadonlyArray<{content: string}>, value: unknown): unknown {
  if (!messages.some(message => message.content.includes('最终输出使用互斥结果外层：'))
    || (value && typeof value === 'object' && 'outcome' in value)) return value
  return {outcome: 'action', action: value, handoff: null}
}

/** Match injected selector fixtures to the explicitly requested wire version.
 * Production parsing never uses this helper or repairs missing evidence. */
export function chatActionChoiceFixture(messages: ReadonlyArray<{content: string}>, value: unknown): unknown {
  if (!messages[0]?.content.startsWith('这是尚未发生的角色行动选择草稿') || !value || typeof value !== 'object'
    || !('directions' in value) || !Array.isArray(value.directions)) return value
  const current = messages[0].content.includes('evidenceMessageIds')
  const continuation = messages[0].content.includes('possibilityChecks') && !('possibilityChecks' in value)
  const roleLine = continuation ? messages[1]?.content.split('\n').find(line => line.startsWith('{"situationKey"')) : undefined
  // Explicit engineering assumptions for old scripted fixtures, not a semantic
  // classifier. New contract counterexamples supply their own checks directly.
  const plans = roleLine ? JSON.parse(roleLine).possibilities as unknown[] : []
  const checks = continuation ? {possibilityChecks: plans.map((_, index) => ({index, disposition: 'not-useful',
    reason: '工程夹具假设此旧方向本轮不再有新增作用；不代表真实模型质量'}))} : {}
  return {...checks, ...value, directions: value.directions.map((direction: Record<string, unknown>) => {
    const {evidenceMessageIds, ...old} = direction
    return current ? {...old, evidenceMessageIds: evidenceMessageIds ?? []} : old
  })}
}
