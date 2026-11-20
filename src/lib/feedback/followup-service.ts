import { CLIENT_SUPPORT_URL } from './client-support'
import { feedbackProgressSchema, type FeedbackRecord } from './followup-contract'
import { changeFeedback, feedbackSnapshot } from './followup-storage'

const lifetime = 90 * 86400_000
let refreshing: Promise<void> | undefined
let storageBlocked = false
async function request(entry: FeedbackRecord, revoke: boolean) {
  return fetch(CLIENT_SUPPORT_URL + '/feedback-followup', {
    method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ id: entry.id, token: entry.token, revoke,
      acknowledgment: { receivedRevision: entry.progress?.revision ?? 0, readRevision: Math.min(entry.readRevision, entry.progress?.revision ?? 0) } }),
  })
}
async function update(id: string, token: string, change: (entry: FeedbackRecord) => FeedbackRecord | null) {
  await changeFeedback(entries => entries.flatMap(row => {
    if (row.id !== id || row.token !== token) return [row]
    const next = change(row)
    return next ? [next] : []
  }))
}
async function check(entry: FeedbackRecord, force: boolean) {
  const now = Date.now()
  if (entry.createdAt + lifetime <= now) {
    await update(entry.id, entry.token, row => ({ ...row, state: 'unavailable' })); return
  }
  if (!force && (entry.nextCheckAt > now || entry.failures >= 5 || entry.state === 'unavailable')) return
  try {
    const revoking = entry.state === 'revoking'
    const response = await request(entry, revoking)
    if (revoking && response.ok) {
      if (response.ok && (await response.json() as { revoked?: boolean }).revoked !== true) throw new Error('Invalid revocation receipt')
      await update(entry.id, entry.token, () => null); return
    }
    if (response.status === 404 && entry.state !== 'pending') {
      await update(entry.id, entry.token, row => row.state === 'revoking' ? row : { ...row, state: 'unavailable' }); return
    }
    if (!response.ok) throw new Error('Feedback follow-up unavailable')
    const body = await response.json() as { progress?: unknown }
    const progress = feedbackProgressSchema.parse(body.progress)
    if (progress.expiresAt <= now || progress.updatedAt > now + 300_000) throw new Error('Invalid progress time')
    await update(entry.id, entry.token, row => row.state === 'revoking' ? row : {
      ...row, state: 'active', failures: 0, nextCheckAt: now + 10 * 60_000,
      progress: progress.revision >= (row.progress?.revision ?? 0) ? progress : row.progress,
    })
  } catch {
    await update(entry.id, entry.token, row => ({ ...row, failures: Math.min(5, row.failures + 1), nextCheckAt: now + Math.min(60 * 60_000, 60_000 * 2 ** row.failures) }))
  }
}
export function refreshFeedbacks(force = false): Promise<void> {
  if (refreshing) return refreshing
  if (storageBlocked && !force) return Promise.resolve()
  if (force) storageBlocked = false
  refreshing = (async () => {
    if (!navigator.locks?.request) return
    if (feedbackSnapshot().entries.some(row => (row.progress?.expiresAt ?? row.createdAt + lifetime) <= Date.now()))
      await changeFeedback(rows => rows.filter(row => (row.progress?.expiresAt ?? row.createdAt + lifetime) > Date.now()))
    if (!navigator.onLine || (!force && document.visibilityState !== 'visible')) return
    await navigator.locks.request('storyforge-feedback-poll-v1', { ifAvailable: true }, async lock => {
      if (!lock) return
      const due = feedbackSnapshot().entries.filter(row => row.state !== 'unavailable' && (force || (row.nextCheckAt <= Date.now() && row.failures < 5)))
        .sort((a, b) => Number(b.state === 'revoking') - Number(a.state === 'revoking') || a.nextCheckAt - b.nextCheckAt).slice(0, 6)
      for (let index = 0; index < due.length; index += 3) {
        if (!navigator.onLine || (!force && document.visibilityState !== 'visible')) break
        // At most two batches of three timed requests per tick. Clearing or
        // withdrawal during an await must win over a late progress response.
        await Promise.all(due.slice(index, index + 3).map(async row => {
          const current = feedbackSnapshot().entries.find(entry => entry.id === row.id && entry.token === row.token)
          if (current) await check(current, force)
        }))
      }
    })
  })().catch(error => { storageBlocked = true; throw error }).finally(() => { refreshing = undefined })
  return refreshing
}
export function installFeedbackFollowup(onFailure: () => void = () => {}) {
  const tick = () => { void refreshFeedbacks().catch(onFailure) }
  tick()
  const timer = window.setInterval(tick, 60_000)
  window.addEventListener('online', tick)
  document.addEventListener('visibilitychange', tick)
  return () => { clearInterval(timer); window.removeEventListener('online', tick); document.removeEventListener('visibilitychange', tick) }
}
export async function readFeedbackProgress(id: string) {
  await changeFeedback(entries => entries.map(row => row.id === id ? { ...row, readRevision: Math.max(row.readRevision, row.progress?.revision ?? 0), nextCheckAt: 0 } : row))
  await refreshFeedbacks(true)
}
export async function stopFeedbackFollowup(id: string) {
  await changeFeedback(entries => entries.map(row => row.id === id ? { ...row, state: 'revoking', failures: 0, nextCheckAt: 0 } : row))
  await refreshFeedbacks(true)
}
export async function removeExpiredFeedback(id: string) {
  await changeFeedback(entries => entries.filter(row => row.id !== id || row.state !== 'unavailable'))
}
