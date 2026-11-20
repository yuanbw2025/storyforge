import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { submitClientFeedback, type ClientFeedback } from '../../src/lib/feedback/client-support'
import { feedbackProgressSchema, feedbackBuildMessage, type FeedbackProgress } from '../../src/lib/feedback/followup-contract'
import { acknowledgeFeedback, changeFeedback, createFeedbackToken, feedbackSnapshot, FEEDBACK_FOLLOWUP_KEY, rememberFeedback, rememberFeedbackNotices } from '../../src/lib/feedback/followup-storage'
import { readFeedbackProgress, refreshFeedbacks, stopFeedbackFollowup } from '../../src/lib/feedback/followup-service'

const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
beforeEach(() => {
  localStorage.clear()
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const tails = new Map<string, Promise<unknown>>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (name: string, options: unknown, callback?: (lock: unknown) => unknown) => {
    const fn = typeof options === 'function' ? options as (lock: unknown) => unknown : callback!
    if ((options as { ifAvailable?: boolean })?.ifAvailable && tails.has(name)) return fn(null)
    const previous = tails.get(name) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(() => fn({ name }))
    tails.set(name, next)
    try { return await next } finally { if (tails.get(name) === next) tails.delete(name) }
  } } })
})
afterEach(() => {
  vi.restoreAllMocks()
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks)
  else Reflect.deleteProperty(navigator, 'locks')
})
const progress = (revision = 1): FeedbackProgress => ({ revision, stage: 'investigating', message: '维护者已受理。', issueUrl: 'https://github.com/yuanbw2025/storyforge/issues/541', updatedAt: Date.now(), expiresAt: Date.now() + 86400_000 })
const report = (): ClientFeedback => ({ version: 1, id: crypto.randomUUID(), kind: 'bug', title: '按钮问题', description: '私有反馈原文不能进入通知记录', steps: '点击按钮', expected: '正常操作', client: { build: 'v4.0.8+1234567', platform: 'Windows', distribution: 'desktop' }, followup: { token: createFeedbackToken() } })

it('a late submission acknowledgment cannot cancel a pending withdrawal', async () => {
  const a = report(); await rememberFeedback(a.id, a.followup!.token, a.title)
  await changeFeedback(rows => rows.map(row => ({ ...row, state: 'revoking' })))
  await acknowledgeFeedback(a.id)
  expect(feedbackSnapshot().entries[0]?.state).toBe('revoking')
})

it('requires a deployed follow-up capability and refuses to lose an opted-in claim through a silent legacy fallback', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ diagnosticContext: 1 })))
  await expect(submitClientFeedback(report())).rejects.toThrow('尚未支持进展跟进')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(feedbackSnapshot().entries).toEqual([])
})

it('persists a separate credential before POST, recovers an unknown submission without another report, and uploads no manuscript or telemetry identity', async () => {
  const body = report(), sent: { url: string; body: unknown }[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).endsWith('/capabilities')) return new Response(JSON.stringify({ feedbackFollowup: 1, diagnosticContext: 1 }))
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    if (String(url).endsWith('/feedback')) {
      expect(feedbackSnapshot().entries[0]).toMatchObject({ id: body.id, token: body.followup!.token, state: 'pending' })
      throw new TypeError('Synthetic lost receipt')
    }
    expect(init?.credentials).toBe('omit')
    return new Response(JSON.stringify({ progress: progress() }))
  })
  await expect(submitClientFeedback(body)).rejects.toThrow('Synthetic lost receipt')
  expect(localStorage.getItem(FEEDBACK_FOLLOWUP_KEY)).not.toContain(body.description)
  await refreshFeedbacks(true)
  expect(feedbackSnapshot().entries[0]).toMatchObject({ state: 'active', progress: { revision: 1 } })
  expect(sent.filter(row => row.url.endsWith('/feedback'))).toHaveLength(1)
  const read = sent.find(row => row.url.endsWith('/feedback-followup'))!
  expect(read.body).toMatchObject({ id: body.id, token: body.followup!.token })
  expect(read.body).not.toHaveProperty('installationId')
})

it('does not discard a live credential when two receipts are added concurrently', async () => {
  const a = report(), b = report()
  await Promise.all([rememberFeedback(a.id, a.followup!.token, a.title), rememberFeedback(b.id, b.followup!.token, b.title)])
  expect(feedbackSnapshot().entries.map(row => row.id).sort()).toEqual([a.id, b.id].sort())
})

it('acknowledges exactly what was read and keeps a newer concurrently published update unread', async () => {
  const a = report(); await rememberFeedback(a.id, a.followup!.token, a.title); await acknowledgeFeedback(a.id)
  await changeFeedback(rows => rows.map(row => ({ ...row, progress: progress(1) })))
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ progress: progress(2) })))
  await readFeedbackProgress(a.id)
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).acknowledgment).toEqual({ receivedRevision: 1, readRevision: 1 })
  expect(feedbackSnapshot().entries[0]).toMatchObject({ readRevision: 1, progress: { revision: 2 } })
})

it('retains withdrawal offline and an old in-flight progress response cannot undo withdrawal', async () => {
  const a = report(); await rememberFeedback(a.id, a.followup!.token, a.title); await acknowledgeFeedback(a.id)
  let resolve!: (value: Response) => void
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise<Response>(done => { resolve = done }))
  const checking = refreshFeedbacks(true)
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
  const stopping = stopFeedbackFollowup(a.id)
  await vi.waitFor(() => expect(feedbackSnapshot().entries[0]?.state).toBe('revoking'))
  resolve(new Response(JSON.stringify({ progress: progress(8) })))
  await Promise.all([checking, stopping])
  expect(feedbackSnapshot().entries[0]).toMatchObject({ state: 'revoking' })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ revoked: true })))
  await refreshFeedbacks(true)
  expect(feedbackSnapshot().entries).toEqual([])
})

it('pauses after bounded failures, preserves the record, and allows an explicit successful retry', async () => {
  const a = report(); await rememberFeedback(a.id, a.followup!.token, a.title)
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))
  for (let i = 0; i < 5; i++) await refreshFeedbacks(true)
  expect(feedbackSnapshot().entries[0]?.failures).toBe(5)
  await refreshFeedbacks()
  expect(fetcher).toHaveBeenCalledTimes(5)
  fetcher.mockResolvedValue(new Response(JSON.stringify({ progress: progress() })))
  await refreshFeedbacks(true)
  expect(feedbackSnapshot().entries[0]?.failures).toBe(0)
})

it('rejects unexpected notification URLs and an unverified released state without replacing previous progress', async () => {
  expect(feedbackProgressSchema.safeParse({ ...progress(), issueUrl: 'https://attacker.test/' }).success).toBe(false)
  expect(feedbackProgressSchema.safeParse({ ...progress(), stage: 'released' }).success).toBe(false)
  const a = report(); await rememberFeedback(a.id, a.followup!.token, a.title)
  await changeFeedback(rows => rows.map(row => ({ ...row, progress: progress(3) })))
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ progress: { ...progress(4), stage: 'released' } })))
  await refreshFeedbacks(true)
  expect(feedbackSnapshot().entries[0]?.progress?.revision).toBe(3)
})

it('leaves corrupt storage intact and refuses opt-in when cross-tab-safe storage is unavailable', async () => {
  localStorage.setItem(FEEDBACK_FOLLOWUP_KEY, '{broken')
  const a = report()
  await expect(rememberFeedback(a.id, a.followup!.token, a.title)).rejects.toThrow()
  expect(localStorage.getItem(FEEDBACK_FOLLOWUP_KEY)).toBe('{broken')
  expect(feedbackSnapshot().error).toContain('原记录未覆盖')
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  await expect(changeFeedback(() => [])).rejects.toThrow('不支持安全保存')
})

it('calls a build repaired only for a verified source identity, never merely a newer version or local source checkout', () => {
  const p: FeedbackProgress = { ...progress(), stage: 'released', release: { tag: 'v4.0.9', sourceSha: 'a'.repeat(40), fixSha: 'b'.repeat(40), url: 'https://github.com/yuanbw2025/storyforge/releases/tag/v4.0.9', publishedAt: new Date().toISOString(), verifiedAt: new Date().toISOString(), runId: 1, distributions: ['desktop','web'], platforms: ['Windows'] } }
  expect(feedbackBuildMessage(p, 'v4.0.9+aaaaaaa', 'desktop', 'Windows')).toContain('已包含')
  expect(feedbackBuildMessage(p, 'v4.0.10+bbbbbbb', 'desktop', 'Windows')).toContain('尚未核实')
  expect(feedbackBuildMessage(p, 'v4.0.9+local', 'web', 'Windows')).toContain('源码')
  expect(feedbackBuildMessage(p, 'v4.0.9+aaaaaaa', 'android', 'Android')).toContain('未声明')
})


it('cleans expired metadata even offline without calling it resolved or sending a request', async () => {
  const a = report(); await rememberFeedback(a.id, a.followup!.token, a.title)
  await changeFeedback(rows => rows.map(row => ({ ...row, createdAt: Date.now() - 91 * 86400_000 })))
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const fetcher = vi.spyOn(globalThis, 'fetch')
  await refreshFeedbacks()
  expect(feedbackSnapshot().entries).toEqual([])
  expect(fetcher).not.toHaveBeenCalled()
})

it('persists notice dismissal separately from reading and keeps subsequent revisions eligible', async () => {
  const a = report(); await rememberFeedback(a.id, a.followup!.token, a.title)
  await changeFeedback(rows => rows.map(row => ({ ...row, progress: progress(2) })))
  await rememberFeedbackNotices([{ id: a.id, revision: 2 }])
  await rememberFeedbackNotices([{ id: a.id, revision: 1 }])
  expect(feedbackSnapshot().entries[0]).toMatchObject({ notifiedRevision: 2, readRevision: 0 })
  expect(JSON.parse(localStorage.getItem(FEEDBACK_FOLLOWUP_KEY)!).entries[0].notifiedRevision).toBe(2)
  await changeFeedback(rows => rows.map(row => ({ ...row, progress: progress(3) })))
  expect(feedbackSnapshot().entries[0]!.progress!.revision).toBeGreaterThan(feedbackSnapshot().entries[0]!.notifiedRevision)
})
