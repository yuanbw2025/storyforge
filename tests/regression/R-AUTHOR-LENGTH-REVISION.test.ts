import { describe, expect, it } from 'vitest'
import { resolveTaskLengthPlanV1 } from '../../src/lib/ai/author-length-intent'
import { observeAuthorLengthV1, planAuthorLengthRevisionV1 } from '../../src/lib/ai/author-length-revision'
const plan = resolveTaskLengthPlanV1({ taskKind: 'chapter', operation: 'create', control: { mode: 'exact', targetWords: 100, minWords: null, maxWords: null } })
const round = (n: number, hex: string) => ({ resultHash: hex.repeat(64), observation: observeAuthorLengthV1({ plan, text: '字'.repeat(n), representation: 'plain-text', candidateKind: 'complete-replacement' }) })
const context = { completion: 'complete' as const, structuralValid: true, semanticComplete: true, semanticProgress: 'advanced' as const }
describe('author length revision progress', () => {
  it('revises toward an explicit range, then stops on ready, repeat, worse or unknown result', () => {
    expect(planAuthorLengthRevisionV1({ ...context, plan, current: round(60, 'a') }).action).toBe('revise-length')
    expect(planAuthorLengthRevisionV1({ ...context, plan, current: round(80, 'b'), priorValidRounds: [round(60, 'a')] }).action).toBe('revise-length')
    expect(planAuthorLengthRevisionV1({ ...context, plan, current: round(75, 'c'), priorValidRounds: [round(80, 'b')] }).action).toBe('needs-attention')
    expect(planAuthorLengthRevisionV1({ ...context, plan, current: round(60, 'a'), priorValidRounds: [round(60, 'a')] }).action).toBe('needs-attention')
    expect(planAuthorLengthRevisionV1({ ...context, plan, current: round(100, 'd') }).action).toBe('ready')
    expect(planAuthorLengthRevisionV1({ ...context, plan, current: round(100, 'd'), completion: 'unknown' }).action).toBe('needs-attention')
  })
  it('rejects forged counts and hashes instead of accepting a plausible claimed distance', () => {
    const current = round(60, 'a')
    expect(() => planAuthorLengthRevisionV1({ ...context, plan, current: { ...current, observation: { ...current.observation, distance: 0 } } })).toThrow('不一致')
    expect(() => planAuthorLengthRevisionV1({ ...context, plan, current: { ...current, resultHash: 'not-a-hash' } })).toThrow('无效')
    expect(() => observeAuthorLengthV1({ plan: resolveTaskLengthPlanV1({ taskKind: 'setting-field', operation: 'expand' }), text: '完整稿', representation: 'plain-text', candidateKind: 'complete-replacement' })).toThrow('冻结原稿')
  })
  it('retains model-visible markup and counts continuation or expansion in the declared basis', () => {
    const explicit = resolveTaskLengthPlanV1({ taskKind: 'setting-field', operation: 'expand', instruction: '净新增至少4字' })
    const observed = observeAuthorLengthV1({ plan: explicit, text: '旧稿补齐细节', representation: 'plain-text', candidateKind: 'complete-replacement', baseline: { text: '旧稿', representation: 'plain-text' } })
    expect(observed.additionalWords).toBe(4)
    expect(observeAuthorLengthV1({ plan, text: '<tag>', representation: 'plain-text', candidateKind: 'complete-replacement' }).textWords).toBe(5)
    expect(observeAuthorLengthV1({ plan, text: '<p>正文</p>', representation: 'editor-html', candidateKind: 'complete-replacement' }).textWords).toBe(2)
  })
  it('does not force automatic long answers down to the 4000 reference', () => {
    const automatic = resolveTaskLengthPlanV1({ taskKind: 'chapter', operation: 'create' })
    const current = { resultHash: 'e'.repeat(64), observation: observeAuthorLengthV1({ plan: automatic, text: '字'.repeat(6500), representation: 'plain-text', candidateKind: 'complete-replacement' }) }
    expect(planAuthorLengthRevisionV1({ ...context, plan: automatic, current }).action).toBe('ready')
    expect(planAuthorLengthRevisionV1({ ...context, plan: automatic, current, structuralValid: false }).action).toBe('needs-attention')
    expect(planAuthorLengthRevisionV1({ ...context, plan: automatic, current, semanticComplete: false, semanticProgress: 'stalled' }).action).toBe('needs-attention')
  })
})
